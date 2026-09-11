import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../http.js";
import { nodeCreate, nodeMove, nodeUpdate } from "../schemas.js";

export async function nodeRoutes(app: FastifyInstance) {
  app.post("/projects/:id/nodes", async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const data = nodeCreate.parse(req.body);

    if (data.parentId) {
      const parent = await prisma.node.findUnique({ where: { id: data.parentId } });
      if (!parent || parent.projectId !== projectId) throw badRequest("parentId is not a node of this project");
    }

    const last = await prisma.node.findFirst({
      where: { projectId, parentId: data.parentId ?? null },
      orderBy: { sortOrder: "desc" },
    });

    const node = await prisma.node.create({
      data: {
        projectId,
        name: data.name,
        type: data.type,
        parentId: data.parentId ?? null,
        categoryId: data.categoryId ?? null,
        refCode: data.refCode ?? null,
        quantity: data.quantity,
        uom: data.uom,
        notes: data.notes ?? null,
        attributes: data.attributes,
        sortOrder: data.sortOrder || (last ? last.sortOrder + 10 : 0),
      },
    });
    return reply.status(201).send(node);
  });

  app.get("/nodes/:nodeId", async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    const node = await prisma.node.findUnique({
      where: { id: nodeId },
      include: {
        category: true,
        bomLines: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: { material: true, supplier: { select: { id: true, name: true } } },
        },
        attachments: { orderBy: { uploadedAt: "desc" } },
      },
    });
    if (!node) throw notFound("Node");
    return node;
  });

  app.patch("/nodes/:nodeId", async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    const data = nodeUpdate.parse(req.body);
    return prisma.node.update({
      where: { id: nodeId },
      data: {
        ...data,
        parentId: data.parentId === undefined ? undefined : data.parentId ?? null,
        categoryId: data.categoryId === undefined ? undefined : data.categoryId ?? null,
      },
    });
  });

  app.post("/nodes/:nodeId/move", async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    const { parentId, sortOrder } = nodeMove.parse(req.body);

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) throw notFound("Node");

    if (parentId) {
      if (parentId === nodeId) throw badRequest("A node cannot be its own parent");
      // walk up from the target parent; reject if we hit nodeId (would create a cycle)
      let cur = await prisma.node.findUnique({ where: { id: parentId } });
      if (!cur || cur.projectId !== node.projectId) throw badRequest("parentId is not a node of this project");
      while (cur?.parentId) {
        if (cur.parentId === nodeId) throw badRequest("Move would create a cycle");
        cur = await prisma.node.findUnique({ where: { id: cur.parentId } });
      }
    }

    return prisma.node.update({
      where: { id: nodeId },
      data: { parentId: parentId ?? null, sortOrder: sortOrder ?? node.sortOrder },
    });
  });

  app.delete("/nodes/:nodeId", async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    await prisma.node.delete({ where: { id: nodeId } });
    return reply.status(204).send();
  });
}
