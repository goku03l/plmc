import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../http.js";
import { bulkAssignSupplier } from "../schemas.js";

type MiniNode = { id: string; name: string; parentId: string | null; quantity: number };

function pathAndQty(nodes: MiniNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path = (id: string) => {
    const parts: string[] = [];
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 100) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" › ");
  };
  const qtyChain = (id: string) => {
    let q = 1;
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 100) {
      q *= cur.quantity;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return q;
  };
  return { path, qtyChain };
}

/** All descendant node ids of `rootId`, inclusive. */
function subtreeIds(nodes: MiniNode[], rootId: string) {
  const children = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId) (children.get(n.parentId) ?? children.set(n.parentId, []).get(n.parentId)!).push(n.id);
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of children.get(id) ?? []) {
      out.add(c);
      stack.push(c);
    }
  }
  return out;
}

export async function procurementRoutes(app: FastifyInstance) {
  // "Which supplier furnishes which material, and where" — grouped material → supplier.
  app.get("/projects/:id/supplier-assignments", async (req) => {
    const { id } = req.params as { id: string };
    const { nodeId } = req.query as { nodeId?: string };

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) throw notFound("Project");

    const nodes = (await prisma.node.findMany({
      where: { projectId: id },
      select: { id: true, name: true, parentId: true, quantity: true },
    })) as MiniNode[];
    const { path, qtyChain } = pathAndQty(nodes);
    const scope = nodeId ? subtreeIds(nodes, nodeId) : null;

    const lines = await prisma.bomLine.findMany({
      where: { node: { projectId: id }, materialId: { not: null } },
      include: {
        material: { select: { id: true, code: true, name: true, uom: true } },
        supplier: { select: { id: true, name: true } },
      },
    });

    type Assign = {
      supplierId: string | null;
      supplierName: string | null;
      lineCount: number;
      extendedQty: number;
      locations: { nodeId: string; nodePath: string; quantity: number; extendedQty: number }[];
    };
    const materials = new Map<
      string,
      { materialId: string; code: string; name: string; uom: string; assignments: Map<string | null, Assign> }
    >();

    for (const l of lines) {
      if (!l.material) continue;
      if (scope && !scope.has(l.nodeId)) continue;
      const mkey = l.material.id;
      let m = materials.get(mkey);
      if (!m) {
        m = {
          materialId: l.material.id,
          code: l.material.code,
          name: l.material.name,
          uom: l.material.uom,
          assignments: new Map(),
        };
        materials.set(mkey, m);
      }
      const skey = l.supplierId ?? null;
      let a = m.assignments.get(skey);
      if (!a) {
        a = { supplierId: skey, supplierName: l.supplier?.name ?? null, lineCount: 0, extendedQty: 0, locations: [] };
        m.assignments.set(skey, a);
      }
      const ext = l.quantity * qtyChain(l.nodeId);
      a.lineCount += 1;
      a.extendedQty += ext;
      a.locations.push({ nodeId: l.nodeId, nodePath: path(l.nodeId), quantity: l.quantity, extendedQty: ext });
    }

    const rows = [...materials.values()]
      .map((m) => ({
        materialId: m.materialId,
        code: m.code,
        name: m.name,
        uom: m.uom,
        assignments: [...m.assignments.values()].sort((x, y) => (x.supplierName ?? "").localeCompare(y.supplierName ?? "")),
        assigned: [...m.assignments.values()].some((a) => a.supplierId),
        unassignedLines: m.assignments.get(null)?.lineCount ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // pivot: supplier → materials (for the "what is each supplier furnishing" view)
    const bySupplier = new Map<string, { supplierId: string; supplierName: string; materials: { code: string; name: string; extendedQty: number; uom: string; lineCount: number }[] }>();
    for (const m of rows) {
      for (const a of m.assignments) {
        if (!a.supplierId) continue;
        let s = bySupplier.get(a.supplierId);
        if (!s) {
          s = { supplierId: a.supplierId, supplierName: a.supplierName ?? "?", materials: [] };
          bySupplier.set(a.supplierId, s);
        }
        s.materials.push({ code: m.code, name: m.name, uom: m.uom, extendedQty: a.extendedQty, lineCount: a.lineCount });
      }
    }

    return {
      project: { id: project.id, code: project.code, name: project.name, currency: project.currency },
      scopedTo: nodeId ? path(nodeId) : null,
      byMaterial: rows,
      bySupplier: [...bySupplier.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
    };
  });

  // Bulk-assign (or clear) the supplier on every line of a material, optionally
  // limited to a subtree (e.g. one tower).
  app.post("/projects/:id/assign-supplier", async (req) => {
    const { id } = req.params as { id: string };
    const data = bulkAssignSupplier.parse(req.body);

    if (data.supplierId) {
      const s = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
      if (!s) throw badRequest("supplierId does not exist");
    }

    let nodeFilter: { in: string[] } | undefined;
    if (data.nodeId) {
      const nodes = (await prisma.node.findMany({
        where: { projectId: id },
        select: { id: true, name: true, parentId: true, quantity: true },
      })) as MiniNode[];
      if (!nodes.some((n) => n.id === data.nodeId)) throw badRequest("nodeId is not in this project");
      nodeFilter = { in: [...subtreeIds(nodes, data.nodeId)] };
    }

    const res = await prisma.bomLine.updateMany({
      where: {
        materialId: data.materialId,
        node: { projectId: id },
        ...(nodeFilter ? { nodeId: nodeFilter } : {}),
      },
      data: { supplierId: data.supplierId },
    });
    return { updated: res.count };
  });
}
