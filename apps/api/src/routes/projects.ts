import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { notFound } from "../http.js";
import { projectCreate, projectUpdate } from "../schemas.js";
import { buildTree, loadProjectNodes } from "./tree-util.js";
import { categoryBreakdown, computeCosts, COST_KINDS, KIND_LABEL } from "../cost.js";

const DEFAULT_CATEGORIES = [
  { key: "structure", label: "Structure", color: "#64748b" },
  { key: "exteriors", label: "Exteriors", color: "#0ea5e9" },
  { key: "interiors", label: "Interiors", color: "#f59e0b" },
  { key: "mep", label: "MEP", color: "#10b981" },
  { key: "sitework", label: "Sitework", color: "#a855f7" },
];

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", async () => {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { nodes: true } } },
    });
    return projects;
  });

  app.post("/projects", async (req, reply) => {
    const data = projectCreate.parse(req.body);
    const project = await prisma.project.create({
      data: {
        ...data,
        categories: {
          create: DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })),
        },
      },
      include: { categories: true },
    });
    return reply.status(201).send(project);
  });

  app.get("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id },
      include: { categories: { orderBy: { sortOrder: "asc" } } },
    });
    if (!project) throw notFound("Project");
    return project;
  });

  app.patch("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = projectUpdate.parse(req.body);
    return prisma.project.update({ where: { id }, data });
  });

  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.project.delete({ where: { id } });
    return reply.status(204).send();
  });

  // Full DMU tree with cost roll-up.
  app.get("/projects/:id/tree", async (req) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id },
      include: { categories: { orderBy: { sortOrder: "asc" } } },
    });
    if (!project) throw notFound("Project");

    const nodes = await loadProjectNodes(id);
    const costs = computeCosts(nodes);
    const tree = buildTree(nodes, costs);

    return { project, tree };
  });

  // Cost summary: totals + breakdown by category.
  app.get("/projects/:id/summary", async (req) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id },
      include: { categories: true },
    });
    if (!project) throw notFound("Project");

    const nodes = await loadProjectNodes(id);
    const costs = computeCosts(nodes);

    let total = 0;
    const kindTotals: Record<string, number> = { MATERIAL: 0, LABOR: 0, EQUIPMENT: 0, TRANSPORT: 0, OVERHEAD: 0 };
    for (const n of nodes.filter((x) => !x.parentId)) {
      const c = costs.get(n.id);
      if (!c) continue;
      total += c.rolledCost;
      for (const k of COST_KINDS) kindTotals[k] += c.byKind[k] * n.quantity;
    }

    const catLabel = new Map(project.categories.map((c) => [c.id, c.label]));
    const byCategory = categoryBreakdown(nodes)
      .map((r) => ({
        categoryId: r.categoryId,
        label: r.categoryId ? catLabel.get(r.categoryId) ?? "Unknown" : "Uncategorized",
        amount: r.amount,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      currency: project.currency,
      total,
      // material vs. labour vs. plant vs. logistics vs. documentation / preliminaries
      byKind: COST_KINDS.map((k) => ({ kind: k, label: KIND_LABEL[k], amount: kindTotals[k] })),
      // kept for any older client
      material: kindTotals.MATERIAL,
      labor: kindTotals.LABOR,
      nodeCount: nodes.length,
      byCategory,
    };
  });
}
