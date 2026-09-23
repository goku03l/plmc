import { prisma } from "../db.js";
import { categoryBreakdown, computeCosts, COST_KINDS, KIND_LABEL } from "../cost.js";
import { buildTree, loadProjectNodes } from "../routes/tree-util.js";
import { str, projectByRef, nodePath, subtreeIds, inr, type AgentTool, type FlatNode } from "./helpers.js";
import { MUTATING_TOOLS } from "./mutations.js";
import { INVENTORY_READ_TOOLS, INVENTORY_MUTATING_TOOLS } from "./inventory-tools.js";

/**
 * Read-only tool surface for the assistant. Every tool here only reads data.
 * Mutating tools (create/update/delete) live in mutations.ts, are registered
 * with `mutating: true`, and are only exposed to the model when the user has
 * turned on "allow changes" for the session — see chat.ts.
 */
export type { AgentTool };

// ---- tools -------------------------------------------------------------

const READ_TOOLS: AgentTool[] = [
  {
    mutating: false,
    def: {
      name: "list_projects",
      description: "List all construction projects with their code, name, client, location, status, currency and node count.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    run: async () => {
      const rows = await prisma.project.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { nodes: true } } },
      });
      return rows.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        client: p.client,
        location: p.location,
        status: p.status,
        currency: p.currency,
        nodes: p._count.nodes,
      }));
    },
  },
  {
    mutating: false,
    def: {
      name: "get_cost_summary",
      description:
        "Total estimated cost of a project with the breakdown by cost kind (Material / Labour / Equipment / Transport / Overheads) and by sub-group (Structure, Finishes, MEP, …). Use this for 'what does X cost' and 'where is the money going' questions.",
      input_schema: {
        type: "object",
        properties: { project: { type: "string", description: "project id, code (e.g. THU-001) or name" } },
        required: ["project"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const nodes = await loadProjectNodes(project.id);
      const costs = computeCosts(nodes);
      let total = 0;
      const kinds: Record<string, number> = Object.fromEntries(COST_KINDS.map((k) => [k, 0]));
      for (const n of nodes.filter((x) => !x.parentId)) {
        const c = costs.get(n.id);
        if (!c) continue;
        total += c.rolledCost;
        for (const k of COST_KINDS) kinds[k] += c.byKind[k] * n.quantity;
      }
      const catLabel = new Map(project.categories.map((c) => [c.id, c.label]));
      const byCategory = categoryBreakdown(nodes)
        .map((r) => ({ label: r.categoryId ? catLabel.get(r.categoryId) ?? "Unknown" : "Uncategorized", amount: r.amount }))
        .sort((a, b) => b.amount - a.amount);
      return {
        project: `${project.code} — ${project.name}`,
        currency: project.currency,
        total,
        total_display: inr(total, project.currency),
        byKind: COST_KINDS.map((k) => ({ label: KIND_LABEL[k], amount: kinds[k], display: inr(kinds[k], project.currency) })),
        byCategory: byCategory.map((r) => ({ ...r, display: inr(r.amount, project.currency) })),
      };
    },
  },
  {
    mutating: false,
    def: {
      name: "get_project_tree",
      description:
        "The DMU / product-structure tree of a project with rolled-up cost at every node. Returns a nested outline. Use `maxDepth` to keep it small (default 3); use `rootRef` to get the sub-tree under one node (e.g. a tower).",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string" },
          maxDepth: { type: "integer", description: "how many levels below the root to include (default 3)" },
          rootRef: { type: "string", description: "optional node id to use as the tree root" },
        },
        required: ["project"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const maxDepth = typeof input.maxDepth === "number" ? input.maxDepth : 3;
      const nodes = await loadProjectNodes(project.id);
      const costs = computeCosts(nodes);
      const tree = buildTree(nodes, costs);

      type T = (typeof tree)[number];
      const rootId = str(input.rootRef);
      const findRoot = (arr: T[]): T | null => {
        for (const n of arr) {
          if (n.id === rootId) return n;
          const r = findRoot(n.children);
          if (r) return r;
        }
        return null;
      };
      const roots = rootId ? (findRoot(tree) ? [findRoot(tree)!] : []) : tree;

      const shape = (n: T, depth: number): unknown => ({
        id: n.id,
        name: n.name,
        type: n.type,
        ...(n.quantity !== 1 ? { quantity: n.quantity, uom: n.uom } : {}),
        rolledCost: n.cost?.rolledCost ?? 0,
        rolledCost_display: inr(n.cost?.rolledCost ?? 0, project.currency),
        ...(depth < maxDepth && n.children.length
          ? { children: n.children.map((c) => shape(c, depth + 1)) }
          : n.children.length
            ? { children_omitted: n.children.length }
            : {}),
      });
      return { project: `${project.code} — ${project.name}`, currency: project.currency, tree: roots.map((n) => shape(n, 0)) };
    },
  },
  {
    mutating: false,
    def: {
      name: "search_nodes",
      description: "Find nodes in a project whose name matches a query. Returns id, full path, type and rolled cost. Use before get_node.",
      input_schema: {
        type: "object",
        properties: { project: { type: "string" }, query: { type: "string" }, limit: { type: "integer" } },
        required: ["project", "query"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const q = str(input.query) ?? "";
      const limit = typeof input.limit === "number" ? Math.min(input.limit, 50) : 20;
      const nodes = await loadProjectNodes(project.id);
      const costs = computeCosts(nodes);
      const path = nodePath(nodes as FlatNode[]);
      const hits = nodes
        .filter((n) => n.name.toLowerCase().includes(q.toLowerCase()))
        .slice(0, limit)
        .map((n) => {
          const c = costs.get(n.id);
          return {
            id: n.id,
            path: path(n.id),
            type: n.type,
            quantity: n.quantity,
            rolledCost: c?.rolledCost ?? 0,
            rolledCost_display: inr(c?.rolledCost ?? 0, project.currency),
          };
        });
      return { count: hits.length, nodes: hits };
    },
  },
  {
    mutating: false,
    def: {
      name: "search_bom_lines",
      description:
        "Find BOM lines across a whole project (or one node's subtree) whose description matches a query — e.g. every 'window' line across 24 different apartment units. Use this to gather scattered line items BEFORE bundling them into a single RFQ with create_rfq/add_rfq_items, instead of raising one RFQ per node.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string" },
          query: { type: "string", description: "text to match against the line description" },
          nodeRef: { type: "string", description: "optional node id — limit the search to that node's subtree" },
          limit: { type: "integer" },
        },
        required: ["project", "query"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const q = str(input.query) ?? "";
      const limit = typeof input.limit === "number" ? Math.min(input.limit, 100) : 50;
      const nodes = (await prisma.node.findMany({
        where: { projectId: project.id },
        select: { id: true, name: true, parentId: true, type: true, quantity: true },
      })) as FlatNode[];
      let scope: Set<string> | null = null;
      if (input.nodeRef) {
        const target = nodes.find((n) => n.id === input.nodeRef);
        if (!target) return { error: "nodeRef not found in this project" };
        scope = subtreeIds(nodes, target.id);
      }
      const path = nodePath(nodes);
      const lines = await prisma.bomLine.findMany({
        where: {
          node: { projectId: project.id },
          description: { contains: q, mode: "insensitive" },
          ...(scope ? { nodeId: { in: [...scope] } } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      return {
        count: lines.length,
        totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
        lines: lines.map((l) => ({
          bomLineId: l.id,
          nodePath: path(l.nodeId),
          description: l.description,
          kind: l.kind,
          quantity: l.quantity,
          uom: l.uom,
          unitCost: l.unitCost,
        })),
      };
    },
  },
  {
    mutating: false,
    def: {
      name: "get_node",
      description: "Full detail of one node: attributes, notes, its Bill of Materials (each line's kind, quantity, unit cost, wastage, labour, linked material and assigned supplier), and its attached documents (drawings, photos, PDFs).",
      input_schema: {
        type: "object",
        properties: { nodeId: { type: "string" } },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const node = await prisma.node.findUnique({
        where: { id: str(input.nodeId) ?? "" },
        include: {
          project: { select: { code: true, name: true, currency: true } },
          category: { select: { label: true } },
          bomLines: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            include: { material: { select: { code: true, name: true } }, supplier: { select: { name: true } } },
          },
          attachments: { orderBy: { uploadedAt: "desc" }, select: { id: true, filename: true, mimeType: true, size: true, uploadedAt: true } },
        },
      });
      if (!node) return { error: "node not found" };
      const cur = node.project.currency;
      return {
        id: node.id,
        name: node.name,
        type: node.type,
        project: `${node.project.code} — ${node.project.name}`,
        category: node.category?.label ?? null,
        quantity: node.quantity,
        uom: node.uom,
        refCode: node.refCode,
        notes: node.notes,
        attributes: node.attributes,
        bomLines: node.bomLines.map((l) => ({
          id: l.id,
          description: l.description,
          kind: l.kind,
          quantity: l.quantity,
          uom: l.uom,
          unitCost: l.unitCost,
          unitCost_display: inr(l.unitCost, cur),
          wastagePct: l.wastagePct,
          laborCost: l.laborCost,
          material: l.material ? `${l.material.code} — ${l.material.name}` : null,
          supplier: l.supplier?.name ?? null,
        })),
        documents: node.attachments.map((a) => ({
          filename: a.filename,
          type: a.mimeType,
          sizeKB: Math.round(a.size / 1024),
          uploadedAt: a.uploadedAt,
        })),
      };
    },
  },
  {
    mutating: false,
    def: {
      name: "list_materials",
      description: "The material catalog (code, name, category, unit of measure, unit cost, wastage). Optional `query` filters by code/name/category.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" } },
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const q = str(input.query);
      const rows = await prisma.material.findMany({
        where: q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
                { category: { contains: q, mode: "insensitive" } },
              ],
            }
          : undefined,
        orderBy: { name: "asc" },
        take: 200,
      });
      return rows.map((m) => ({ id: m.id, code: m.code, name: m.name, category: m.category, uom: m.uom, unitCost: m.unitCost, wastagePct: m.wastagePct }));
    },
  },
  {
    mutating: false,
    def: {
      name: "list_suppliers",
      description: "The supplier directory: name, trades, city, contacts, and how many RFQs / materials each is linked to. Optional `query` and `trade` filters.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" }, trade: { type: "string" } },
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const q = str(input.query);
      const trade = str(input.trade);
      const rows = await prisma.supplier.findMany({
        where: {
          AND: [
            q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } : {},
            trade ? { trades: { has: trade } } : {},
          ],
        },
        orderBy: { name: "asc" },
        include: {
          contacts: { orderBy: { isPrimary: "desc" } },
          _count: { select: { rfqInvites: true, materialLinks: true, bomLines: true } },
        },
      });
      return rows.map((s) => ({
        id: s.id,
        name: s.name,
        trades: s.trades,
        city: s.city,
        gstin: s.gstin,
        contacts: s.contacts.map((c) => ({ name: c.name, email: c.email, phone: c.phone, role: c.role, primary: c.isPrimary })),
        rfqs: s._count.rfqInvites,
        materials: s._count.materialLinks,
        assignedBomLines: s._count.bomLines,
      }));
    },
  },
  {
    mutating: false,
    def: {
      name: "get_supplier_assignments",
      description:
        "Answers 'which supplier furnishes which material, and where'. For a project (optionally scoped to one node such as a tower) it returns, per material, the assigned suppliers with the node paths and extended quantities, plus the pivot by supplier.",
      input_schema: {
        type: "object",
        properties: { project: { type: "string" }, nodeRef: { type: "string", description: "optional node id to scope to a subtree" } },
        required: ["project"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const nodes = (await prisma.node.findMany({
        where: { projectId: project.id },
        select: { id: true, name: true, parentId: true, type: true, quantity: true },
      })) as FlatNode[];
      const path = nodePath(nodes);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const qtyChain = (id: string) => {
        let qy = 1;
        let cur = byId.get(id);
        let g = 0;
        while (cur && g++ < 100) {
          qy *= cur.quantity;
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return qy;
      };
      const rootRef = str(input.nodeRef);
      let scope: Set<string> | null = null;
      if (rootRef) {
        const children = new Map<string, string[]>();
        for (const n of nodes) if (n.parentId) (children.get(n.parentId) ?? children.set(n.parentId, []).get(n.parentId)!).push(n.id);
        scope = new Set([rootRef]);
        const stack = [rootRef];
        while (stack.length) for (const c of children.get(stack.pop()!) ?? []) (scope.add(c), stack.push(c));
      }

      const lines = await prisma.bomLine.findMany({
        where: { node: { projectId: project.id }, materialId: { not: null } },
        include: { material: { select: { code: true, name: true, uom: true } }, supplier: { select: { name: true } } },
      });
      const mats = new Map<string, { code: string; name: string; uom: string; suppliers: Map<string, { name: string; lines: number; qty: number; where: string[] }> }>();
      for (const l of lines) {
        if (!l.material || (scope && !scope.has(l.nodeId))) continue;
        let m = mats.get(l.material.code);
        if (!m) mats.set(l.material.code, (m = { code: l.material.code, name: l.material.name, uom: l.material.uom, suppliers: new Map() }));
        const key = l.supplier?.name ?? "(unassigned)";
        let s = m.suppliers.get(key);
        if (!s) m.suppliers.set(key, (s = { name: key, lines: 0, qty: 0, where: [] }));
        s.lines += 1;
        s.qty += l.quantity * qtyChain(l.nodeId);
        if (s.where.length < 8) s.where.push(path(l.nodeId));
      }
      return {
        project: `${project.code} — ${project.name}`,
        scopedTo: rootRef ? path(rootRef) : null,
        byMaterial: [...mats.values()].map((m) => ({
          material: `${m.code} — ${m.name}`,
          uom: m.uom,
          suppliers: [...m.suppliers.values()],
        })),
      };
    },
  },
  {
    mutating: false,
    def: {
      name: "list_rfqs",
      description: "Requests for quotation: number, title, status, due date, item & supplier counts, how many suppliers responded. Optional `project` filter.",
      input_schema: {
        type: "object",
        properties: { project: { type: "string" } },
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      const rows = await prisma.rfq.findMany({
        where: project ? { projectId: project.id } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          node: { select: { name: true } },
          _count: { select: { items: true, suppliers: true } },
          suppliers: { select: { respondedAt: true, awarded: true, supplier: { select: { name: true } } } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        title: r.title,
        status: r.status,
        node: r.node?.name ?? null,
        dueDate: r.dueDate,
        items: r._count.items,
        suppliers: r._count.suppliers,
        responded: r.suppliers.filter((s) => s.respondedAt).length,
        awardedTo: r.suppliers.find((s) => s.awarded)?.supplier.name ?? null,
      }));
    },
  },
  {
    mutating: false,
    def: {
      name: "get_rfq",
      description: "Full detail of one RFQ: line items, invited suppliers with their sent/responded status, per-line quote comparison (lowest highlighted) and each supplier's quoted total and lead time.",
      input_schema: {
        type: "object",
        properties: { rfqRef: { type: "string", description: "RFQ id or number, e.g. RFQ-0001" } },
        required: ["rfqRef"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const ref = str(input.rfqRef) ?? "";
      const rfq = await prisma.rfq.findFirst({
        where: { OR: [{ id: ref }, { number: { equals: ref, mode: "insensitive" } }] },
        include: {
          project: { select: { name: true, currency: true } },
          items: { orderBy: [{ sortOrder: "asc" }] },
          suppliers: { include: { supplier: { select: { name: true } }, quotes: true } },
        },
      });
      if (!rfq) return { error: "RFQ not found" };
      const cur = rfq.project.currency;
      return {
        number: rfq.number,
        title: rfq.title,
        status: rfq.status,
        project: rfq.project.name,
        scope: rfq.scope,
        dueDate: rfq.dueDate,
        items: rfq.items.map((it) => ({ id: it.id, description: it.description, quantity: it.quantity, uom: it.uom })),
        suppliers: rfq.suppliers.map((s) => {
          const total = rfq.items.reduce((sum, it) => {
            const q = s.quotes.find((x) => x.rfqItemId === it.id);
            return sum + (q ? q.unitPrice * it.quantity : 0);
          }, 0);
          return {
            name: s.supplier.name,
            sent: s.sentAt,
            responded: s.respondedAt,
            awarded: s.awarded,
            leadTimeDays: s.leadTimeDays,
            quotedLines: s.quotes.length,
            total: s.quotes.length ? total : null,
            total_display: s.quotes.length ? inr(total, cur) : null,
            lines: rfq.items.map((it) => {
              const q = s.quotes.find((x) => x.rfqItemId === it.id);
              return { description: it.description, unitPrice: q?.unitPrice ?? null };
            }),
          };
        }),
      };
    },
  },
];

const ALL_READ_TOOLS: AgentTool[] = [...READ_TOOLS, ...INVENTORY_READ_TOOLS];

export const AGENT_TOOLS: AgentTool[] = [...ALL_READ_TOOLS, ...MUTATING_TOOLS, ...INVENTORY_MUTATING_TOOLS];
export const READONLY_TOOLS = ALL_READ_TOOLS;
export const ALL_TOOLS = AGENT_TOOLS;
