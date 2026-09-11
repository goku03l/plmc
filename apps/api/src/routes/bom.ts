import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../http.js";
import { bomLineCreate, bomLineUpdate } from "../schemas.js";

export async function bomRoutes(app: FastifyInstance) {
  app.get("/nodes/:nodeId/bom", async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    return prisma.bomLine.findMany({
      where: { nodeId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { material: true, supplier: { select: { id: true, name: true } } },
    });
  });

  app.post("/nodes/:nodeId/bom", async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const data = bomLineCreate.parse(req.body);

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) throw notFound("Node");

    const isMaterial = data.kind === "MATERIAL";

    let material = null;
    if (data.materialId) {
      if (!isMaterial) throw badRequest("Only MATERIAL lines can link to a catalog material");
      material = await prisma.material.findUnique({ where: { id: data.materialId } });
      if (!material) throw badRequest("materialId does not exist");
    }

    if (isMaterial && !data.materialId && !data.description) {
      throw badRequest("Provide a materialId or a description");
    }
    if (!isMaterial && !data.description) {
      throw badRequest("A description is required for non-material lines");
    }

    const last = await prisma.bomLine.findFirst({
      where: { nodeId },
      orderBy: { sortOrder: "desc" },
    });

    if (data.supplierId) {
      const s = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
      if (!s) throw badRequest("supplierId does not exist");
    }

    const created = await prisma.bomLine.create({
      data: {
        nodeId,
        kind: data.kind,
        materialId: isMaterial ? data.materialId ?? null : null,
        supplierId: data.supplierId ?? null,
        description: data.description ?? material?.name ?? "Item",
        quantity: data.quantity,
        uom: data.uom ?? material?.uom ?? "ea",
        unitCost: data.unitCost ?? material?.unitCost ?? 0,
        wastagePct: isMaterial ? data.wastagePct ?? material?.wastagePct ?? 0 : 0,
        laborCost: isMaterial ? data.laborCost : 0,
        constructionDetail: data.constructionDetail,
        sortOrder: data.sortOrder || (last ? last.sortOrder + 10 : 0),
      },
      include: { material: true, supplier: { select: { id: true, name: true } } },
    });
    return reply.status(201).send(created);
  });

  app.patch("/bom/:lineId", async (req) => {
    const { lineId } = req.params as { lineId: string };
    const data = bomLineUpdate.parse(req.body);

    const existing = await prisma.bomLine.findUnique({ where: { id: lineId } });
    if (!existing) throw notFound("BOM line");
    const kind = data.kind ?? existing.kind;
    const isMaterial = kind === "MATERIAL";

    return prisma.bomLine.update({
      where: { id: lineId },
      data: {
        ...data,
        materialId: isMaterial
          ? data.materialId === undefined
            ? undefined
            : data.materialId ?? null
          : null,
        supplierId: data.supplierId === undefined ? undefined : data.supplierId ?? null,
        wastagePct: isMaterial ? data.wastagePct : 0,
        laborCost: isMaterial ? data.laborCost : 0,
      },
      include: { material: true, supplier: { select: { id: true, name: true } } },
    });
  });

  app.delete("/bom/:lineId", async (req, reply) => {
    const { lineId } = req.params as { lineId: string };
    await prisma.bomLine.delete({ where: { id: lineId } });
    return reply.status(204).send();
  });
}
