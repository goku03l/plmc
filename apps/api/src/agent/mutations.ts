import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { mailEnabled, sendMail } from "../mail.js";
import {
  bomLineCreate,
  bomLineUpdate,
  categoryCreate,
  categoryUpdate,
  materialCreate,
  materialUpdate,
  nodeCreate,
  nodeUpdate,
  projectCreate,
  projectUpdate,
  rfqCreate,
  rfqUpdate,
  supplierCreate,
  supplierUpdate,
} from "../schemas.js";
import { str, projectByRef, nodePath, subtreeIds, type AgentTool, type FlatNode } from "./helpers.js";

const rfqToken = () => randomBytes(24).toString("base64url");
const portalUrl = (t: string) => `${env.appBaseUrl}/portal/${t}`;

/**
 * Mutating tools: create / update / delete. Every one follows the same
 * two-phase shape:
 *   1. called WITHOUT `confirm` — validates everything, computes what WOULD
 *      happen (including cascade counts for deletes), and returns it as a
 *      `pending` preview. Nothing touches the database.
 *   2. called again WITH `confirm: true` — actually performs the change.
 * The agentic loop in chat.ts additionally refuses step 2 unless step 1's
 * exact preview already appears earlier in the conversation (see actionKey()
 * in helpers.ts), so a single model turn can never propose-and-execute at once.
 */

const DEFAULT_CATEGORIES = [
  { key: "structure", label: "Structure", color: "#64748b" },
  { key: "exteriors", label: "Exteriors", color: "#0ea5e9" },
  { key: "interiors", label: "Interiors", color: "#f59e0b" },
  { key: "mep", label: "MEP", color: "#10b981" },
  { key: "sitework", label: "Sitework", color: "#a855f7" },
];

const bool = (v: unknown) => v === true;
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

function zerr(e: unknown) {
  if (e instanceof ZodError) return { error: e.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  return { error: (e as Error).message };
}

function pending(action: string, summary: string, extra: Record<string, unknown> = {}) {
  return {
    pending: true,
    action,
    summary,
    note: "Nothing has changed yet. Describe this to the user in your own words and ask them to confirm — only call this same tool again with confirm:true after they clearly agree in their next reply.",
    ...extra,
  };
}
function done(action: string, summary: string, extra: Record<string, unknown> = {}) {
  return { done: true, action, summary, ...extra };
}

async function categoryByRef(projectId: string, ref?: string) {
  if (!ref) return null;
  return prisma.category.findFirst({
    where: { projectId, OR: [{ id: ref }, { key: { equals: ref, mode: "insensitive" } }, { label: { equals: ref, mode: "insensitive" } }] },
  });
}
async function materialByRef(ref?: string) {
  if (!ref) return null;
  return prisma.material.findFirst({
    where: { OR: [{ id: ref }, { code: { equals: ref, mode: "insensitive" } }, { name: { contains: ref, mode: "insensitive" } }] },
  });
}
async function supplierByRef(ref?: string) {
  if (!ref) return null;
  return prisma.supplier.findFirst({ where: { OR: [{ id: ref }, { name: { contains: ref, mode: "insensitive" } }] } });
}
async function rfqByRef(ref?: string) {
  if (!ref) return null;
  return prisma.rfq.findFirst({ where: { OR: [{ id: ref }, { number: { equals: ref, mode: "insensitive" } }] } });
}
async function projectNodes(projectId: string) {
  return (await prisma.node.findMany({
    where: { projectId },
    select: { id: true, name: true, parentId: true, type: true, quantity: true },
  })) as FlatNode[];
}

const changeList = (data: Record<string, unknown>) =>
  Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k} → ${Array.isArray(v) ? v.join(", ") : v}`)
    .join(", ");

type RawRfqItem = { description?: unknown; quantity?: unknown; uom?: unknown; targetCost?: unknown; bomLineId?: unknown };

/** Turn the model's free-form item list into RfqItem rows, checking any
 *  bomLineId references are real. Lets one RFQ bundle lines gathered from many
 *  different nodes (e.g. search_bom_lines across 24 units) instead of forcing
 *  one RFQ per node. */
async function parseRfqItems(raw: unknown): Promise<{ items: { description: string; quantity: number; uom: string; targetCost: number | null; bomLineId: string | null }[] } | { error: string }> {
  const list = Array.isArray(raw) ? (raw as RawRfqItem[]) : [];
  if (!list.length) return { items: [] };
  const ids = list.map((it) => str(it.bomLineId)).filter((x): x is string => Boolean(x));
  const found = ids.length ? new Set((await prisma.bomLine.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((l) => l.id)) : new Set<string>();
  const bad = ids.filter((id) => !found.has(id));
  if (bad.length) return { error: `bomLineId not found: ${bad.join(", ")}` };
  return {
    items: list.map((it) => ({
      description: str(it.description) ?? "Item",
      quantity: typeof it.quantity === "number" && it.quantity > 0 ? it.quantity : 1,
      uom: str(it.uom) || "ea",
      targetCost: typeof it.targetCost === "number" ? it.targetCost : null,
      bomLineId: str(it.bomLineId) || null,
    })),
  };
}
const rfqItemSchema = {
  type: "object" as const,
  properties: {
    description: { type: "string" },
    quantity: { type: "number" },
    uom: { type: "string" },
    targetCost: { type: "number" },
    bomLineId: { type: "string", description: "optional — link to a real BOM line (from search_bom_lines/get_node) for cost traceability" },
  },
  required: ["description", "quantity"],
};

export const MUTATING_TOOLS: AgentTool[] = [
  // ---- projects -----------------------------------------------------------
  {
    mutating: true,
    def: {
      name: "create_project",
      description: "Create a new construction project. Seeds the 5 standard sub-groups (Structure, Exteriors, Interiors, MEP, Sitework).",
      input_schema: {
        type: "object",
        properties: {
          code: { type: "string", description: "short unique project code, e.g. THU-002" },
          name: { type: "string" },
          client: { type: "string" },
          location: { type: "string" },
          currency: { type: "string", description: "3-letter ISO code, e.g. INR" },
          status: { type: "string", enum: ["DRAFT", "ACTIVE", "ON_HOLD", "CLOSED"] },
          confirm: { type: "boolean", description: "set true only after the user has confirmed the previewed action" },
        },
        required: ["code", "name"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      let data;
      try {
        data = projectCreate.parse({
          code: str(input.code),
          name: str(input.name),
          client: str(input.client),
          location: str(input.location),
          currency: str(input.currency) || undefined,
          status: str(input.status) || undefined,
        });
      } catch (e) {
        return zerr(e);
      }
      const summary = `Create project "${data.name}" (${data.code}), currency ${data.currency}, status ${data.status}.`;
      if (!bool(input.confirm)) return pending("create_project", summary, { key: input.__confirmKey });
      const project = await prisma.project.create({
        data: { ...data, categories: { create: DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })) } },
      });
      return done("create_project", summary, { key: input.__confirmKey, projectId: project.id, code: project.code });
    },
  },
  {
    mutating: true,
    def: {
      name: "update_project",
      description: "Update a project's name, client, location, currency or status. Only send the fields that should change.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string", description: "project id, code or name" },
          name: { type: "string" },
          description: { type: "string" },
          client: { type: "string" },
          location: { type: "string" },
          currency: { type: "string" },
          status: { type: "string", enum: ["DRAFT", "ACTIVE", "ON_HOLD", "CLOSED"] },
          confirm: { type: "boolean" },
        },
        required: ["project"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      let data;
      try {
        data = projectUpdate.parse({
          name: str(input.name),
          description: str(input.description),
          client: str(input.client),
          location: str(input.location),
          currency: str(input.currency),
          status: str(input.status),
        });
      } catch (e) {
        return zerr(e);
      }
      const changes = changeList(data);
      if (!changes) return { error: "Nothing to update — specify at least one field" };
      const summary = `Update project "${project.code} — ${project.name}": ${changes}.`;
      if (!bool(input.confirm)) return pending("update_project", summary, { key: input.__confirmKey });
      await prisma.project.update({ where: { id: project.id }, data });
      return done("update_project", summary, { key: input.__confirmKey });
    },
  },
  {
    mutating: true,
    destructive: true,
    def: {
      name: "delete_project",
      description: "PERMANENTLY delete a project and everything in it (nodes, BOM lines, categories, RFQs). No undo, no trash.",
      input_schema: {
        type: "object",
        properties: { project: { type: "string" }, confirm: { type: "boolean" } },
        required: ["project"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const [nodes, categories, rfqs] = await Promise.all([
        prisma.node.count({ where: { projectId: project.id } }),
        prisma.category.count({ where: { projectId: project.id } }),
        prisma.rfq.count({ where: { projectId: project.id } }),
      ]);
      const bomLines = await prisma.bomLine.count({ where: { node: { projectId: project.id } } });
      const summary =
        `PERMANENTLY delete project "${project.code} — ${project.name}" and everything in it: ` +
        `${nodes} node(s), ${bomLines} BOM line(s), ${categories} categories, ${rfqs} RFQ(s) with their suppliers and quotes. ` +
        `This cannot be undone — there is no trash or history.`;
      if (!bool(input.confirm)) return pending("delete_project", summary, { key: input.__confirmKey, destructive: true });
      await prisma.project.delete({ where: { id: project.id } });
      return done("delete_project", summary, { key: input.__confirmKey });
    },
  },

  // ---- categories -----------------------------------------------------------
  {
    mutating: true,
    def: {
      name: "create_category",
      description: "Add a configurable sub-group (cost bucket) to a project, e.g. \"Landscaping\".",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string" },
          key: { type: "string", description: "short machine key: letters, digits, - and _ only" },
          label: { type: "string" },
          color: { type: "string", description: "hex color like #64748b" },
          confirm: { type: "boolean" },
        },
        required: ["project", "key", "label"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      let data;
      try {
        data = categoryCreate.parse({ key: str(input.key), label: str(input.label), color: str(input.color) || undefined });
      } catch (e) {
        return zerr(e);
      }
      const summary = `Add sub-group "${data.label}" (key "${data.key}") to project "${project.code}".`;
      if (!bool(input.confirm)) return pending("create_category", summary, { key: input.__confirmKey });
      const cat = await prisma.category.create({ data: { ...data, projectId: project.id } });
      return done("create_category", summary, { key: input.__confirmKey, categoryId: cat.id });
    },
  },
  {
    mutating: true,
    def: {
      name: "update_category",
      description: "Rename or recolor a project's sub-group.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string" },
          category: { type: "string", description: "category id, key or label" },
          label: { type: "string" },
          color: { type: "string" },
          confirm: { type: "boolean" },
        },
        required: ["project", "category"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const cat = await categoryByRef(project.id, str(input.category));
      if (!cat) return { error: "category not found in this project" };
      let data;
      try {
        data = categoryUpdate.parse({ label: str(input.label), color: str(input.color) });
      } catch (e) {
        return zerr(e);
      }
      const changes = changeList(data);
      if (!changes) return { error: "Nothing to update" };
      const summary = `Update sub-group "${cat.label}": ${changes}.`;
      if (!bool(input.confirm)) return pending("update_category", summary, { key: input.__confirmKey });
      await prisma.category.update({ where: { id: cat.id }, data });
      return done("update_category", summary, { key: input.__confirmKey });
    },
  },
  {
    mutating: true,
    destructive: true,
    def: {
      name: "delete_category",
      description: "Delete a project's sub-group. Nodes tagged with it are not deleted — they just lose the tag.",
      input_schema: {
        type: "object",
        properties: { project: { type: "string" }, category: { type: "string" }, confirm: { type: "boolean" } },
        required: ["project", "category"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const cat = await categoryByRef(project.id, str(input.category));
      if (!cat) return { error: "category not found in this project" };
      const nodeCount = await prisma.node.count({ where: { categoryId: cat.id } });
      const summary = `Delete sub-group "${cat.label}". ${nodeCount} node(s) tagged with it will keep their data but lose this tag.`;
      if (!bool(input.confirm)) return pending("delete_category", summary, { key: input.__confirmKey, destructive: nodeCount > 0 });
      await prisma.category.delete({ where: { id: cat.id } });
      return done("delete_category", summary, { key: input.__confirmKey });
    },
  },

  // ---- nodes (the DMU tree) -------------------------------------------------
  {
    mutating: true,
    def: {
      name: "create_node",
      description: "Add a node (group/sub-group/assembly/component) to a project's DMU tree, optionally under a parent node.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ["GROUP", "SUBGROUP", "ASSEMBLY", "COMPONENT"] },
          parentNodeId: { type: "string", description: "id of the parent node (from search_nodes/get_project_tree); omit for a top-level node" },
          category: { type: "string", description: "sub-group id, key or label" },
          refCode: { type: "string" },
          quantity: { type: "number", description: "how many of this subtree the parent contains, default 1" },
          uom: { type: "string" },
          notes: { type: "string" },
          confirm: { type: "boolean" },
        },
        required: ["project", "name"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      let parentId: string | null = null;
      if (input.parentNodeId) {
        const parent = await prisma.node.findUnique({ where: { id: str(input.parentNodeId) ?? "" } });
        if (!parent || parent.projectId !== project.id) return { error: "parentNodeId is not a node of this project" };
        parentId = parent.id;
      }
      let categoryId: string | null = null;
      if (input.category) {
        const cat = await categoryByRef(project.id, str(input.category));
        if (!cat) return { error: "category not found in this project" };
        categoryId = cat.id;
      }
      let data;
      try {
        data = nodeCreate.parse({
          name: str(input.name),
          type: str(input.type) || undefined,
          refCode: str(input.refCode),
          quantity: num(input.quantity),
          uom: str(input.uom) || undefined,
          notes: str(input.notes),
        });
      } catch (e) {
        return zerr(e);
      }
      const parentLabel = parentId ? nodePath(await projectNodes(project.id))(parentId) : "the top level";
      const summary = `Add ${data.type} "${data.name}" under ${parentLabel} in "${project.code}"${data.quantity !== 1 ? `, quantity ${data.quantity} ${data.uom}` : ""}.`;
      if (!bool(input.confirm)) return pending("create_node", summary, { key: input.__confirmKey });
      const last = await prisma.node.findFirst({ where: { projectId: project.id, parentId }, orderBy: { sortOrder: "desc" } });
      const node = await prisma.node.create({
        data: {
          projectId: project.id,
          name: data.name,
          type: data.type,
          parentId,
          categoryId,
          refCode: data.refCode ?? null,
          quantity: data.quantity,
          uom: data.uom,
          notes: data.notes ?? null,
          attributes: {},
          sortOrder: last ? last.sortOrder + 10 : 0,
        },
      });
      return done("create_node", summary, { key: input.__confirmKey, nodeId: node.id });
    },
  },
  {
    mutating: true,
    def: {
      name: "update_node",
      description: "Change a node's name, type, category, ref code, quantity, unit of measure or notes. Get the nodeId from search_nodes or get_node first.",
      input_schema: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ["GROUP", "SUBGROUP", "ASSEMBLY", "COMPONENT"] },
          category: { type: "string", description: "sub-group id, key or label; empty string clears it" },
          refCode: { type: "string" },
          quantity: { type: "number" },
          uom: { type: "string" },
          notes: { type: "string" },
          confirm: { type: "boolean" },
        },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const node = await prisma.node.findUnique({ where: { id: str(input.nodeId) ?? "" } });
      if (!node) return { error: "node not found" };
      let categoryId: string | null | undefined;
      if (input.category !== undefined) {
        const ref = str(input.category);
        if (!ref) categoryId = null;
        else {
          const cat = await categoryByRef(node.projectId, ref);
          if (!cat) return { error: "category not found in this project" };
          categoryId = cat.id;
        }
      }
      let data;
      try {
        data = nodeUpdate.parse({
          name: str(input.name),
          type: str(input.type),
          refCode: str(input.refCode),
          quantity: num(input.quantity),
          uom: str(input.uom),
          notes: str(input.notes),
        });
      } catch (e) {
        return zerr(e);
      }
      const changes = changeList(data) + (categoryId !== undefined ? `${changeList(data) ? ", " : ""}category → ${categoryId ?? "(cleared)"}` : "");
      if (!changes) return { error: "Nothing to update" };
      const summary = `Update "${node.name}": ${changes}.`;
      if (!bool(input.confirm)) return pending("update_node", summary, { key: input.__confirmKey });
      await prisma.node.update({ where: { id: node.id }, data: { ...data, categoryId } });
      return done("update_node", summary, { key: input.__confirmKey });
    },
  },
  {
    mutating: true,
    def: {
      name: "move_node",
      description: "Move a node to a new parent (or to the top level), changing where it sits in the DMU tree.",
      input_schema: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          newParentId: { type: "string", description: "omit or empty for the top level" },
          sortOrder: { type: "integer" },
          confirm: { type: "boolean" },
        },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const node = await prisma.node.findUnique({ where: { id: str(input.nodeId) ?? "" } });
      if (!node) return { error: "node not found" };
      const newParentId = str(input.newParentId) || null;
      if (newParentId) {
        if (newParentId === node.id) return { error: "A node cannot be its own parent" };
        let cur = await prisma.node.findUnique({ where: { id: newParentId } });
        if (!cur || cur.projectId !== node.projectId) return { error: "newParentId is not a node of this project" };
        while (cur?.parentId) {
          if (cur.parentId === node.id) return { error: "That move would create a cycle" };
          cur = await prisma.node.findUnique({ where: { id: cur.parentId } });
        }
      }
      const path = nodePath(await projectNodes(node.projectId));
      const summary = `Move "${path(node.id)}" to ${newParentId ? `under "${path(newParentId)}"` : "the top level"}.`;
      if (!bool(input.confirm)) return pending("move_node", summary, { key: input.__confirmKey });
      await prisma.node.update({ where: { id: node.id }, data: { parentId: newParentId, sortOrder: num(input.sortOrder) ?? node.sortOrder } });
      return done("move_node", summary, { key: input.__confirmKey });
    },
  },
  {
    mutating: true,
    destructive: true,
    def: {
      name: "delete_node",
      description: "PERMANENTLY delete a node, its whole subtree, and their BOM lines. No undo.",
      input_schema: {
        type: "object",
        properties: { nodeId: { type: "string" }, confirm: { type: "boolean" } },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const node = await prisma.node.findUnique({ where: { id: str(input.nodeId) ?? "" } });
      if (!node) return { error: "node not found" };
      const nodes = await projectNodes(node.projectId);
      const path = nodePath(nodes);
      const scope = subtreeIds(nodes, node.id);
      const descendants = scope.size - 1;
      const [bomLines, rfqs] = await Promise.all([
        prisma.bomLine.count({ where: { nodeId: { in: [...scope] } } }),
        prisma.rfq.count({ where: { nodeId: { in: [...scope] } } }),
      ]);
      const summary =
        `PERMANENTLY delete "${path(node.id)}"${descendants ? ` and its ${descendants} descendant node(s)` : ""}, ` +
        `along with ${bomLines} BOM line(s)${rfqs ? `. ${rfqs} RFQ(s) linked to it will keep their data but lose the node link` : ""}. ` +
        `This cannot be undone.`;
      if (!bool(input.confirm)) return pending("delete_node", summary, { key: input.__confirmKey, destructive: true });
      await prisma.node.delete({ where: { id: node.id } });
      return done("delete_node", summary, { key: input.__confirmKey });
    },
  },

  // ---- BOM lines --------------------------------------------------------
  {
    mutating: true,
    def: {
      name: "add_bom_line",
      description: "Add a BOM line to a node — either a catalog material (kind MATERIAL) or a flat LABOR/EQUIPMENT/TRANSPORT/OVERHEAD item.",
      input_schema: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          kind: { type: "string", enum: ["MATERIAL", "LABOR", "EQUIPMENT", "TRANSPORT", "OVERHEAD"] },
          material: { type: "string", description: "catalog material id, code or name (MATERIAL kind only)" },
          supplier: { type: "string", description: "supplier id or name to assign to this line" },
          description: { type: "string", description: "required unless material is given" },
          quantity: { type: "number" },
          uom: { type: "string" },
          unitCost: { type: "number" },
          wastagePct: { type: "number" },
          laborCost: { type: "number", description: "install labour per unit of quantity (MATERIAL kind only)" },
          confirm: { type: "boolean" },
        },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const node = await prisma.node.findUnique({ where: { id: str(input.nodeId) ?? "" } });
      if (!node) return { error: "node not found" };
      let data;
      try {
        data = bomLineCreate.parse({
          kind: str(input.kind) || undefined,
          description: str(input.description),
          quantity: num(input.quantity),
          uom: str(input.uom),
          unitCost: num(input.unitCost),
          wastagePct: num(input.wastagePct),
          laborCost: num(input.laborCost),
        });
      } catch (e) {
        return zerr(e);
      }
      const isMaterial = data.kind === "MATERIAL";
      let material: { id: string; name: string; uom: string; unitCost: number; wastagePct: number } | null = null;
      if (input.material) {
        if (!isMaterial) return { error: "Only MATERIAL-kind lines can link to a catalog material" };
        material = await materialByRef(str(input.material));
        if (!material) return { error: "material not found in the catalog" };
      }
      if (isMaterial && !material && !data.description) return { error: "Provide a material or a description" };
      if (!isMaterial && !data.description) return { error: "A description is required for non-material lines" };
      let supplier: { id: string; name: string } | null = null;
      if (input.supplier) {
        supplier = await supplierByRef(str(input.supplier));
        if (!supplier) return { error: "supplier not found" };
      }
      const desc = data.description ?? material?.name ?? "Item";
      const cost = data.unitCost ?? material?.unitCost ?? 0;
      const uom = data.uom ?? material?.uom ?? "ea";
      const summary =
        `Add a ${data.kind} BOM line to "${node.name}": "${desc}", qty ${data.quantity} ${uom}, unit cost ${cost}` +
        `${supplier ? `, supplier "${supplier.name}"` : ""}.`;
      if (!bool(input.confirm)) return pending("add_bom_line", summary, { key: input.__confirmKey });
      const last = await prisma.bomLine.findFirst({ where: { nodeId: node.id }, orderBy: { sortOrder: "desc" } });
      const created = await prisma.bomLine.create({
        data: {
          nodeId: node.id,
          kind: data.kind,
          materialId: isMaterial ? material?.id ?? null : null,
          supplierId: supplier?.id ?? null,
          description: desc,
          quantity: data.quantity,
          uom,
          unitCost: cost,
          wastagePct: isMaterial ? data.wastagePct ?? material?.wastagePct ?? 0 : 0,
          laborCost: isMaterial ? data.laborCost : 0,
          constructionDetail: {},
          sortOrder: last ? last.sortOrder + 10 : 0,
        },
      });
      return done("add_bom_line", summary, { key: input.__confirmKey, bomLineId: created.id });
    },
  },
  {
    mutating: true,
    def: {
      name: "update_bom_line",
      description: "Change a BOM line's quantity, cost, wastage, labour, material link, supplier or description. Get the bomLineId from get_node.",
      input_schema: {
        type: "object",
        properties: {
          bomLineId: { type: "string" },
          kind: { type: "string", enum: ["MATERIAL", "LABOR", "EQUIPMENT", "TRANSPORT", "OVERHEAD"] },
          material: { type: "string", description: "catalog material id/code/name; empty string clears it" },
          supplier: { type: "string", description: "supplier id/name; empty string clears it" },
          description: { type: "string" },
          quantity: { type: "number" },
          uom: { type: "string" },
          unitCost: { type: "number" },
          wastagePct: { type: "number" },
          laborCost: { type: "number" },
          confirm: { type: "boolean" },
        },
        required: ["bomLineId"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const line = await prisma.bomLine.findUnique({ where: { id: str(input.bomLineId) ?? "" } });
      if (!line) return { error: "BOM line not found" };
      const kind = str(input.kind) ?? line.kind;
      const isMaterial = kind === "MATERIAL";
      let materialId: string | null | undefined;
      if (input.material !== undefined) {
        const ref = str(input.material);
        if (!ref) materialId = null;
        else {
          if (!isMaterial) return { error: "Only MATERIAL-kind lines can link to a catalog material" };
          const m = await materialByRef(ref);
          if (!m) return { error: "material not found" };
          materialId = m.id;
        }
      }
      let supplierId: string | null | undefined;
      if (input.supplier !== undefined) {
        const ref = str(input.supplier);
        if (!ref) supplierId = null;
        else {
          const s = await supplierByRef(ref);
          if (!s) return { error: "supplier not found" };
          supplierId = s.id;
        }
      }
      let data;
      try {
        data = bomLineUpdate.parse({
          kind: str(input.kind),
          description: str(input.description),
          quantity: num(input.quantity),
          uom: str(input.uom),
          unitCost: num(input.unitCost),
          wastagePct: num(input.wastagePct),
          laborCost: num(input.laborCost),
        });
      } catch (e) {
        return zerr(e);
      }
      let changes = changeList(data);
      if (materialId !== undefined) changes += `${changes ? ", " : ""}material → ${materialId ?? "(cleared)"}`;
      if (supplierId !== undefined) changes += `${changes ? ", " : ""}supplier → ${supplierId ?? "(cleared)"}`;
      if (!changes) return { error: "Nothing to update" };
      const summary = `Update BOM line "${line.description}": ${changes}.`;
      if (!bool(input.confirm)) return pending("update_bom_line", summary, { key: input.__confirmKey });
      await prisma.bomLine.update({
        where: { id: line.id },
        data: {
          ...data,
          materialId: isMaterial ? materialId : null,
          supplierId,
          wastagePct: isMaterial ? data.wastagePct : 0,
          laborCost: isMaterial ? data.laborCost : 0,
        },
      });
      return done("update_bom_line", summary, { key: input.__confirmKey });
    },
  },
  {
    mutating: true,
    destructive: true,
    def: {
      name: "delete_bom_line",
      description: "Permanently delete one BOM line.",
      input_schema: {
        type: "object",
        properties: { bomLineId: { type: "string" }, confirm: { type: "boolean" } },
        required: ["bomLineId"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const line = await prisma.bomLine.findUnique({ where: { id: str(input.bomLineId) ?? "" } });
      if (!line) return { error: "BOM line not found" };
      const summary = `Delete BOM line "${line.description}" (qty ${line.quantity} ${line.uom}, unit cost ${line.unitCost}).`;
      if (!bool(input.confirm)) return pending("delete_bom_line", summary, { key: input.__confirmKey, destructive: true });
      await prisma.bomLine.delete({ where: { id: line.id } });
      return done("delete_bom_line", summary, { key: input.__confirmKey });
    },
  },

  // ---- material catalog ---------------------------------------------------
  {
    mutating: true,
    def: {
      name: "create_material",
      description: "Add a material to the (global) catalog.",
      input_schema: {
        type: "object",
        properties: {
          code: { type: "string" },
          name: { type: "string" },
          category: { type: "string" },
          uom: { type: "string" },
          unitCost: { type: "number" },
          wastagePct: { type: "number" },
          confirm: { type: "boolean" },
        },
        required: ["code", "name"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      let data;
      try {
        data = materialCreate.parse({
          code: str(input.code),
          name: str(input.name),
          category: str(input.category),
          uom: str(input.uom) || undefined,
          unitCost: num(input.unitCost),
          wastagePct: num(input.wastagePct),
        });
      } catch (e) {
        return zerr(e);
      }
      const summary = `Add material "${data.code} — ${data.name}" to the catalog, unit cost ${data.unitCost} per ${data.uom}.`;
      if (!bool(input.confirm)) return pending("create_material", summary, { key: input.__confirmKey });
      const m = await prisma.material.create({ data });
      return done("create_material", summary, { key: input.__confirmKey, materialId: m.id });
    },
  },
  {
    mutating: true,
    def: {
      name: "update_material",
      description: "Update a catalog material's name, category, unit, cost or wastage. Note: this changes the catalog rate, not existing BOM lines (they keep their own snapshot cost).",
      input_schema: {
        type: "object",
        properties: {
          material: { type: "string", description: "material id, code or name" },
          code: { type: "string" },
          name: { type: "string" },
          category: { type: "string" },
          uom: { type: "string" },
          unitCost: { type: "number" },
          wastagePct: { type: "number" },
          confirm: { type: "boolean" },
        },
        required: ["material"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const material = await materialByRef(str(input.material));
      if (!material) return { error: "material not found" };
      let data;
      try {
        data = materialUpdate.parse({
          code: str(input.code),
          name: str(input.name),
          category: str(input.category),
          uom: str(input.uom),
          unitCost: num(input.unitCost),
          wastagePct: num(input.wastagePct),
        });
      } catch (e) {
        return zerr(e);
      }
      const changes = changeList(data);
      if (!changes) return { error: "Nothing to update" };
      const summary = `Update material "${material.code} — ${material.name}": ${changes}.`;
      if (!bool(input.confirm)) return pending("update_material", summary, { key: input.__confirmKey });
      await prisma.material.update({ where: { id: material.id }, data });
      return done("update_material", summary, { key: input.__confirmKey });
    },
  },
  {
    mutating: true,
    destructive: true,
    def: {
      name: "delete_material",
      description: "Delete a material from the catalog. BOM lines using it are not deleted — they keep their cost but unlink from the catalog.",
      input_schema: {
        type: "object",
        properties: { material: { type: "string" }, confirm: { type: "boolean" } },
        required: ["material"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const material = await materialByRef(str(input.material));
      if (!material) return { error: "material not found" };
      const [lines, links] = await Promise.all([
        prisma.bomLine.count({ where: { materialId: material.id } }),
        prisma.materialSupplier.count({ where: { materialId: material.id } }),
      ]);
      const summary =
        `Delete material "${material.code} — ${material.name}" from the catalog. ` +
        `${lines} BOM line(s) using it will keep their cost but unlink from the catalog; ${links} supplier link(s) will be removed.`;
      if (!bool(input.confirm)) return pending("delete_material", summary, { key: input.__confirmKey, destructive: lines > 0 });
      await prisma.material.delete({ where: { id: material.id } });
      return done("delete_material", summary, { key: input.__confirmKey });
    },
  },

  // ---- suppliers ----------------------------------------------------------
  {
    mutating: true,
    def: {
      name: "create_supplier",
      description: "Add a supplier/vendor to the directory.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          trades: { type: "array", items: { type: "string" }, description: "trade tags, e.g. Concrete, Joinery, MEP" },
          email: { type: "string" },
          phone: { type: "string" },
          city: { type: "string" },
          notes: { type: "string" },
          contactName: { type: "string" },
          contactEmail: { type: "string", description: "if given, adds a primary contact" },
          contactPhone: { type: "string" },
          confirm: { type: "boolean" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const contacts = input.contactEmail
        ? [
            {
              name: str(input.contactName) ?? str(input.name) ?? "Primary",
              email: str(input.contactEmail) ?? "",
              phone: str(input.contactPhone) ?? null,
              role: null,
              isPrimary: true,
            },
          ]
        : [];
      let data;
      try {
        data = supplierCreate.parse({
          name: str(input.name),
          trades: Array.isArray(input.trades) ? input.trades.filter((t: unknown) => typeof t === "string") : undefined,
          email: str(input.email),
          phone: str(input.phone),
          city: str(input.city),
          notes: str(input.notes),
          contacts,
        });
      } catch (e) {
        return zerr(e);
      }
      const summary = `Add supplier "${data.name}"${data.trades.length ? ` (${data.trades.join(", ")})` : ""}${data.city ? ` in ${data.city}` : ""}.`;
      if (!bool(input.confirm)) return pending("create_supplier", summary, { key: input.__confirmKey });
      const { contacts: c, ...rest } = data;
      const s = await prisma.supplier.create({ data: { ...rest, contacts: { create: c } } });
      return done("create_supplier", summary, { key: input.__confirmKey, supplierId: s.id });
    },
  },
  {
    mutating: true,
    def: {
      name: "update_supplier",
      description: "Update a supplier's name, trades, email, phone, city or notes.",
      input_schema: {
        type: "object",
        properties: {
          supplier: { type: "string", description: "supplier id or name" },
          name: { type: "string" },
          trades: { type: "array", items: { type: "string" } },
          email: { type: "string" },
          phone: { type: "string" },
          city: { type: "string" },
          notes: { type: "string" },
          confirm: { type: "boolean" },
        },
        required: ["supplier"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const supplier = await supplierByRef(str(input.supplier));
      if (!supplier) return { error: "supplier not found" };
      let data;
      try {
        data = supplierUpdate.parse({
          name: str(input.name),
          trades: Array.isArray(input.trades) ? input.trades.filter((t: unknown) => typeof t === "string") : undefined,
          email: str(input.email),
          phone: str(input.phone),
          city: str(input.city),
          notes: str(input.notes),
        });
      } catch (e) {
        return zerr(e);
      }
      const changes = changeList(data);
      if (!changes) return { error: "Nothing to update" };
      const summary = `Update supplier "${supplier.name}": ${changes}.`;
      if (!bool(input.confirm)) return pending("update_supplier", summary, { key: input.__confirmKey });
      const { contacts: _contacts, ...rest } = data;
      void _contacts; // this tool never touches contacts — updating them stays a UI action
      await prisma.supplier.update({ where: { id: supplier.id }, data: rest });
      return done("update_supplier", summary, { key: input.__confirmKey });
    },
  },
  {
    mutating: true,
    destructive: true,
    def: {
      name: "delete_supplier",
      description: "PERMANENTLY delete a supplier: their contacts, RFQ invitations (with any quotes/files submitted), and every material link. BOM lines assigned to them just lose the assignment.",
      input_schema: {
        type: "object",
        properties: { supplier: { type: "string" }, confirm: { type: "boolean" } },
        required: ["supplier"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const supplier = await supplierByRef(str(input.supplier));
      if (!supplier) return { error: "supplier not found" };
      const [lines, invites, contacts] = await Promise.all([
        prisma.bomLine.count({ where: { supplierId: supplier.id } }),
        prisma.rfqSupplier.count({ where: { supplierId: supplier.id } }),
        prisma.supplierContact.count({ where: { supplierId: supplier.id } }),
      ]);
      const summary =
        `PERMANENTLY delete supplier "${supplier.name}". ${lines} BOM line(s) will keep their cost but lose this supplier assignment. ` +
        `${invites} RFQ invitation(s) for them — including any quotes and files submitted — will be deleted. ${contacts} contact(s) removed. This cannot be undone.`;
      if (!bool(input.confirm)) return pending("delete_supplier", summary, { key: input.__confirmKey, destructive: true });
      await prisma.supplier.delete({ where: { id: supplier.id } });
      return done("delete_supplier", summary, { key: input.__confirmKey });
    },
  },
  {
    mutating: true,
    def: {
      name: "assign_supplier",
      description: "Bulk-assign (or clear) the supplier on every BOM line of a material in a project, optionally limited to one node's subtree (e.g. one tower).",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string" },
          material: { type: "string", description: "material id, code or name" },
          supplier: { type: "string", description: "supplier id or name; omit/empty to clear the assignment" },
          node: { type: "string", description: "optional node id to limit to that subtree" },
          confirm: { type: "boolean" },
        },
        required: ["project", "material"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const material = await materialByRef(str(input.material));
      if (!material) return { error: "material not found" };
      let supplier: { id: string; name: string } | null = null;
      if (input.supplier) {
        supplier = await supplierByRef(str(input.supplier));
        if (!supplier) return { error: "supplier not found" };
      }
      let nodeFilter: { in: string[] } | undefined;
      let scopeLabel = "the whole project";
      if (input.node) {
        const nodes = await projectNodes(project.id);
        const target = nodes.find((n) => n.id === input.node);
        if (!target) return { error: "node not found in this project" };
        nodeFilter = { in: [...subtreeIds(nodes, target.id)] };
        scopeLabel = `"${nodePath(nodes)(target.id)}"`;
      }
      const where = { materialId: material.id, node: { projectId: project.id }, ...(nodeFilter ? { nodeId: nodeFilter } : {}) };
      const affected = await prisma.bomLine.count({ where });
      if (!affected) return { error: `No BOM lines of "${material.name}" found in ${scopeLabel}` };
      const summary = supplier
        ? `Assign supplier "${supplier.name}" to ${affected} BOM line(s) of "${material.name}" in ${scopeLabel}.`
        : `Clear the supplier assignment on ${affected} BOM line(s) of "${material.name}" in ${scopeLabel}.`;
      if (!bool(input.confirm)) return pending("assign_supplier", summary, { key: input.__confirmKey });
      const res = await prisma.bomLine.updateMany({ where, data: { supplierId: supplier?.id ?? null } });
      return done("assign_supplier", summary, { key: input.__confirmKey, updated: res.count });
    },
  },

  // ---- RFQs -----------------------------------------------------------
  {
    mutating: true,
    def: {
      name: "create_rfq",
      description:
        "Create a Request for Quotation. Either scope it to one node (seeds line items from that node's BOM), or pass `items` explicitly to bundle lines from MANY nodes into a single RFQ — e.g. one RFQ for '24 windows' gathered from 24 different apartment units via search_bom_lines, instead of raising 24 separate RFQs.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string" },
          node: { type: "string", description: "optional node id to scope the RFQ to" },
          title: { type: "string" },
          scope: { type: "string", description: "instructions to bidders" },
          dueDate: { type: "string", description: "ISO datetime" },
          fromNodeBom: { type: "boolean", description: "seed line items from the node's BOM (default true when a node is given and no items are passed)" },
          items: {
            type: "array",
            items: rfqItemSchema,
            description:
              "explicit line items — use this to combine BOM lines from several different nodes into ONE RFQ (one aggregated item with a summed quantity, or one item per bomLineId for traceability). Overrides fromNodeBom seeding when given.",
          },
          confirm: { type: "boolean" },
        },
        required: ["project", "title"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      let node: { id: string; name: string; projectId: string } | null = null;
      if (input.node) {
        node = await prisma.node.findUnique({ where: { id: str(input.node) ?? "" } });
        if (!node || node.projectId !== project.id) return { error: "node not found in this project" };
      }
      const explicit = await parseRfqItems(input.items);
      if ("error" in explicit) return explicit;
      let data;
      try {
        data = rfqCreate.parse({
          projectId: project.id,
          nodeId: node?.id,
          title: str(input.title),
          scope: str(input.scope),
          dueDate: str(input.dueDate),
          fromNodeBom: input.fromNodeBom === undefined ? undefined : bool(input.fromNodeBom),
          items: explicit.items.length ? explicit.items : undefined,
        });
      } catch (e) {
        return zerr(e);
      }
      const summary =
        `Create RFQ "${data.title}" for project "${project.code}"` +
        (data.items.length
          ? `, with ${data.items.length} line item(s) you specified (total qty ${data.items.reduce((s, it) => s + it.quantity, 0)})`
          : node
            ? `, scoped to "${node.name}"${data.fromNodeBom ? " (seeded from its BOM)" : ""}`
            : "") +
        `${data.dueDate ? `, due ${data.dueDate}` : ""}.`;
      if (!bool(input.confirm)) return pending("create_rfq", summary, { key: input.__confirmKey });
      let items = data.items.map((it, i) => ({ ...it, sortOrder: i * 10 }));
      if (node && data.fromNodeBom && items.length === 0) {
        const withBom = await prisma.node.findUnique({
          where: { id: node.id },
          include: { bomLines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
        });
        items = (withBom?.bomLines ?? []).map((l, i) => ({
          description: l.description,
          quantity: l.quantity,
          uom: l.uom,
          targetCost: l.unitCost || null,
          bomLineId: l.id,
          sortOrder: i * 10,
        }));
      }
      const count = await prisma.rfq.count();
      const rfq = await prisma.rfq.create({
        data: {
          projectId: project.id,
          nodeId: node?.id ?? null,
          number: `RFQ-${String(count + 1).padStart(4, "0")}`,
          title: data.title,
          scope: data.scope ?? null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          items: { create: items },
        },
      });
      return done("create_rfq", summary, { key: input.__confirmKey, rfqId: rfq.id, number: rfq.number });
    },
  },
  {
    mutating: true,
    def: {
      name: "add_rfq_items",
      description:
        "Add more line items to an RFQ that already exists — the other way to bundle BOM lines from several nodes into one RFQ (create it first, possibly empty or from one node, then add the rest here) instead of creating a separate RFQ per node.",
      input_schema: {
        type: "object",
        properties: {
          rfq: { type: "string", description: "RFQ id or number" },
          items: { type: "array", items: rfqItemSchema },
        },
        required: ["rfq", "items"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const rfq = await rfqByRef(str(input.rfq));
      if (!rfq) return { error: "RFQ not found" };
      const parsed = await parseRfqItems(input.items);
      if ("error" in parsed) return parsed;
      if (!parsed.items.length) return { error: "Provide at least one item" };
      const last = await prisma.rfqItem.findFirst({ where: { rfqId: rfq.id }, orderBy: { sortOrder: "desc" } });
      let sortOrder = last ? last.sortOrder + 10 : 0;
      const added: string[] = [];
      for (const it of parsed.items) {
        await prisma.rfqItem.create({ data: { rfqId: rfq.id, ...it, sortOrder } });
        sortOrder += 10;
        added.push(it.description);
      }
      return done("add_rfq_items", `Added ${added.length} item(s) to RFQ ${rfq.number}: ${added.join(", ")}.`, { added });
    },
  },
  {
    mutating: true,
    def: {
      name: "update_rfq",
      description: "Update an RFQ's title, scope, due date or status.",
      input_schema: {
        type: "object",
        properties: {
          rfq: { type: "string", description: "RFQ id or number, e.g. RFQ-0001" },
          title: { type: "string" },
          scope: { type: "string" },
          dueDate: { type: "string", description: "ISO datetime" },
          status: { type: "string", enum: ["DRAFT", "SENT", "RESPONSES", "AWARDED", "CLOSED", "CANCELLED"] },
          confirm: { type: "boolean" },
        },
        required: ["rfq"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const rfq = await rfqByRef(str(input.rfq));
      if (!rfq) return { error: "RFQ not found" };
      let data;
      try {
        data = rfqUpdate.parse({ title: str(input.title), scope: str(input.scope), dueDate: str(input.dueDate), status: str(input.status) });
      } catch (e) {
        return zerr(e);
      }
      const changes = changeList(data);
      if (!changes) return { error: "Nothing to update" };
      const summary = `Update RFQ ${rfq.number}: ${changes}.`;
      if (!bool(input.confirm)) return pending("update_rfq", summary, { key: input.__confirmKey });
      await prisma.rfq.update({ where: { id: rfq.id }, data: { ...data, dueDate: data.dueDate ? new Date(data.dueDate) : undefined } });
      return done("update_rfq", summary, { key: input.__confirmKey });
    },
  },
  {
    mutating: true,
    destructive: true,
    def: {
      name: "delete_rfq",
      description: "PERMANENTLY delete an RFQ, its line items and invited suppliers (with any quotes/files they submitted).",
      input_schema: {
        type: "object",
        properties: { rfq: { type: "string" }, confirm: { type: "boolean" } },
        required: ["rfq"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const rfq = await rfqByRef(str(input.rfq));
      if (!rfq) return { error: "RFQ not found" };
      const [items, suppliers] = await Promise.all([
        prisma.rfqItem.count({ where: { rfqId: rfq.id } }),
        prisma.rfqSupplier.count({ where: { rfqId: rfq.id } }),
      ]);
      const summary = `PERMANENTLY delete RFQ ${rfq.number} — "${rfq.title}": ${items} line item(s) and ${suppliers} invited supplier(s) with any quotes/files submitted. This cannot be undone.`;
      if (!bool(input.confirm)) return pending("delete_rfq", summary, { key: input.__confirmKey, destructive: true });
      await prisma.rfq.delete({ where: { id: rfq.id } });
      return done("delete_rfq", summary, { key: input.__confirmKey });
    },
  },
  {
    mutating: true,
    def: {
      name: "award_rfq",
      description: "Mark a supplier as the awarded bidder on an RFQ (un-awards any previous winner).",
      input_schema: {
        type: "object",
        properties: {
          rfq: { type: "string", description: "RFQ id or number" },
          supplier: { type: "string", description: "supplier id or name — must already be invited on this RFQ" },
          confirm: { type: "boolean" },
        },
        required: ["rfq", "supplier"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const rfq = await rfqByRef(str(input.rfq));
      if (!rfq) return { error: "RFQ not found" };
      const supplier = await supplierByRef(str(input.supplier));
      if (!supplier) return { error: "supplier not found" };
      const rs = await prisma.rfqSupplier.findFirst({ where: { rfqId: rfq.id, supplierId: supplier.id } });
      if (!rs) return { error: `"${supplier.name}" is not invited on RFQ ${rfq.number}` };
      const summary = `Award RFQ ${rfq.number} to "${supplier.name}". Any other supplier previously marked awarded on this RFQ will be un-awarded.`;
      if (!bool(input.confirm)) return pending("award_rfq", summary, { key: input.__confirmKey });
      await prisma.$transaction([
        prisma.rfqSupplier.updateMany({ where: { rfqId: rfq.id }, data: { awarded: false } }),
        prisma.rfqSupplier.update({ where: { id: rs.id }, data: { awarded: true } }),
        prisma.rfq.update({ where: { id: rfq.id }, data: { status: "AWARDED" } }),
      ]);
      return done("award_rfq", summary, { key: input.__confirmKey });
    },
  },

  // ---- RFQ email / supplier invitations ----------------------------------
  {
    mutating: true,
    def: {
      name: "invite_rfq_suppliers",
      description:
        "Invite one or more suppliers onto an RFQ, generating their portal link. This only creates the invitation — call send_rfq_emails afterward to actually email them.",
      input_schema: {
        type: "object",
        properties: {
          rfq: { type: "string", description: "RFQ id or number, e.g. RFQ-0001" },
          suppliers: { type: "array", items: { type: "string" }, description: "supplier ids or names" },
        },
        required: ["rfq", "suppliers"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const rfq = await rfqByRef(str(input.rfq));
      if (!rfq) return { error: "RFQ not found" };
      const refs = Array.isArray(input.suppliers) ? input.suppliers.filter((s: unknown) => typeof s === "string") : [];
      if (!refs.length) return { error: "Provide at least one supplier" };

      const invited: string[] = [];
      const problems: string[] = [];
      for (const ref of refs) {
        const s = await prisma.supplier.findFirst({
          where: { OR: [{ id: ref }, { name: { contains: ref, mode: "insensitive" } }] },
          include: { contacts: { orderBy: { isPrimary: "desc" } } },
        });
        if (!s) {
          problems.push(`"${ref}" — supplier not found`);
          continue;
        }
        const email = s.contacts.find((c) => c.isPrimary)?.email ?? s.contacts[0]?.email ?? s.email;
        if (!email) {
          problems.push(`"${s.name}" has no email address on file`);
          continue;
        }
        await prisma.rfqSupplier.upsert({
          where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: s.id } },
          create: { rfqId: rfq.id, supplierId: s.id, token: rfqToken(), email },
          update: {},
        });
        invited.push(s.name);
      }
      if (!invited.length) return { error: `Nothing invited. ${problems.join("; ")}` };
      const summary = `Invited ${invited.join(", ")} onto RFQ ${rfq.number}${problems.length ? `. Skipped: ${problems.join("; ")}` : ""}.`;
      return done("invite_rfq_suppliers", summary, { invited, problems });
    },
  },
  {
    mutating: true,
    destructive: true, // sends a real external email — can't be unsent, same care as a delete
    def: {
      name: "send_rfq_emails",
      description:
        "Actually email the RFQ invitation (with each supplier's portal link) to suppliers already invited via invite_rfq_suppliers. Sends a real email — irreversible, cannot be unsent.",
      input_schema: {
        type: "object",
        properties: {
          rfq: { type: "string", description: "RFQ id or number" },
          suppliers: {
            type: "array",
            items: { type: "string" },
            description: "optional: limit to these supplier ids/names; default is everyone invited but not yet sent",
          },
          message: { type: "string", description: "optional extra note to include in the email body" },
          confirm: { type: "boolean" },
        },
        required: ["rfq"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const rfq = await prisma.rfq.findFirst({
        where: { OR: [{ id: str(input.rfq) }, { number: { equals: str(input.rfq) ?? "", mode: "insensitive" } }] },
        include: {
          project: { select: { name: true } },
          items: { orderBy: [{ sortOrder: "asc" }] },
          suppliers: { include: { supplier: { select: { name: true } } } },
        },
      });
      if (!rfq) return { error: "RFQ not found" };
      if (rfq.items.length === 0) return { error: "This RFQ has no line items yet — add some before sending" };

      let targets = rfq.suppliers;
      const refs = Array.isArray(input.suppliers) ? input.suppliers.filter((s: unknown) => typeof s === "string") : [];
      if (refs.length) {
        const lower = refs.map((r: string) => r.toLowerCase());
        targets = targets.filter((s) => lower.includes(s.supplierId.toLowerCase()) || lower.includes(s.supplier.name.toLowerCase()));
      } else {
        targets = targets.filter((s) => !s.sentAt);
      }
      if (!targets.length) {
        return { error: "No suppliers to send to — invite some first with invite_rfq_suppliers, or they've all already been sent" };
      }

      const names = targets.map((s) => s.supplier.name);
      const via = mailEnabled ? "real email" : "a LOGGED email — no SMTP is configured on this server, so nothing actually leaves it";
      const summary = `Send RFQ ${rfq.number} — "${rfq.title}" — to ${names.join(", ")} (${targets.length} supplier(s)) via ${via}. This cannot be unsent.`;
      if (!bool(input.confirm)) return pending("send_rfq_emails", summary, { key: input.__confirmKey, destructive: true });

      const due = rfq.dueDate ? new Date(rfq.dueDate).toDateString() : "not specified";
      const lineList = rfq.items.map((it, i) => `  ${i + 1}. ${it.description} — ${it.quantity} ${it.uom}`).join("\n");
      const note = str(input.message);
      const results: { supplier: string; email: string; delivered: boolean }[] = [];
      for (const s of targets) {
        const link = portalUrl(s.token);
        const text =
          `Dear ${s.supplier.name},\n\n` +
          `You are invited to quote for ${rfq.project.name} — ${rfq.number}: ${rfq.title}.\n\n` +
          (rfq.scope ? `Scope:\n${rfq.scope}\n\n` : "") +
          `Items:\n${lineList}\n\n` +
          `Response due: ${due}\n\n` +
          (note ? `${note}\n\n` : "") +
          `Submit your quotation and upload supporting documents here:\n${link}\n\n` +
          `Regards,\nProcurement, ${rfq.project.name}`;
        const html =
          `<p>Dear ${s.supplier.name},</p>` +
          `<p>You are invited to quote for <strong>${rfq.project.name}</strong> — ${rfq.number}: ${rfq.title}.</p>` +
          (rfq.scope ? `<p><strong>Scope:</strong><br>${rfq.scope.replace(/\n/g, "<br>")}</p>` : "") +
          `<ol>${rfq.items.map((it) => `<li>${it.description} — ${it.quantity} ${it.uom}</li>`).join("")}</ol>` +
          `<p><strong>Response due:</strong> ${due}</p>` +
          (note ? `<p>${note.replace(/\n/g, "<br>")}</p>` : "") +
          `<p><a href="${link}">Submit your quotation &amp; upload documents</a></p>`;
        const sent = await sendMail({ to: s.email, subject: `${rfq.number} · ${rfq.title} — invitation to quote`, text, html });
        await prisma.rfqSupplier.update({ where: { id: s.id }, data: { sentAt: new Date() } });
        results.push({ supplier: s.supplier.name, email: s.email, delivered: sent.delivered });
      }
      if (rfq.status === "DRAFT") await prisma.rfq.update({ where: { id: rfq.id }, data: { status: "SENT" } });
      return done("send_rfq_emails", summary, { key: input.__confirmKey, mailEnabled, results });
    },
  },
];
