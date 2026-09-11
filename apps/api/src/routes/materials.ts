import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { materialCreate, materialUpdate } from "../schemas.js";

export async function materialRoutes(app: FastifyInstance) {
  app.get("/materials", async (req) => {
    const { q } = req.query as { q?: string };
    return prisma.material.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { name: "asc" },
    });
  });

  app.post("/materials", async (req, reply) => {
    const data = materialCreate.parse(req.body);
    const created = await prisma.material.create({ data });
    return reply.status(201).send(created);
  });

  app.patch("/materials/:materialId", async (req) => {
    const { materialId } = req.params as { materialId: string };
    const data = materialUpdate.parse(req.body);
    return prisma.material.update({ where: { id: materialId }, data });
  });

  app.delete("/materials/:materialId", async (req, reply) => {
    const { materialId } = req.params as { materialId: string };
    await prisma.material.delete({ where: { id: materialId } });
    return reply.status(204).send();
  });
}
