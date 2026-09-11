import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { categoryCreate, categoryUpdate } from "../schemas.js";

export async function categoryRoutes(app: FastifyInstance) {
  app.get("/projects/:id/categories", async (req) => {
    const { id } = req.params as { id: string };
    return prisma.category.findMany({
      where: { projectId: id },
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { nodes: true } } },
    });
  });

  app.post("/projects/:id/categories", async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = categoryCreate.parse(req.body);
    const created = await prisma.category.create({ data: { ...data, projectId: id } });
    return reply.status(201).send(created);
  });

  app.patch("/categories/:categoryId", async (req) => {
    const { categoryId } = req.params as { categoryId: string };
    const data = categoryUpdate.parse(req.body);
    return prisma.category.update({ where: { id: categoryId }, data });
  });

  app.delete("/categories/:categoryId", async (req, reply) => {
    const { categoryId } = req.params as { categoryId: string };
    await prisma.category.delete({ where: { id: categoryId } });
    return reply.status(204).send();
  });
}
