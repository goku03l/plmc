import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { notFound } from "../http.js";
import { materialSupplierInput, supplierCreate, supplierUpdate } from "../schemas.js";

const withCounts = {
  contacts: { orderBy: { isPrimary: "desc" } as const },
  _count: { select: { rfqInvites: true, materialLinks: true } },
};

export async function supplierRoutes(app: FastifyInstance) {
  app.get("/suppliers", async (req) => {
    const { q, trade } = req.query as { q?: string; trade?: string };
    return prisma.supplier.findMany({
      where: {
        AND: [
          q
            ? {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { legalName: { contains: q, mode: "insensitive" } },
                  { city: { contains: q, mode: "insensitive" } },
                ],
              }
            : {},
          trade ? { trades: { has: trade } } : {},
        ],
      },
      orderBy: { name: "asc" },
      include: withCounts,
    });
  });

  app.get("/suppliers/:id", async (req) => {
    const { id } = req.params as { id: string };
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: { isPrimary: "desc" } },
        materialLinks: { include: { material: true } },
      },
    });
    if (!supplier) throw notFound("Supplier");
    return supplier;
  });

  app.post("/suppliers", async (req, reply) => {
    const data = supplierCreate.parse(req.body);
    const { contacts, ...rest } = data;
    const created = await prisma.supplier.create({
      data: { ...rest, contacts: { create: contacts } },
      include: withCounts,
    });
    return reply.status(201).send(created);
  });

  app.patch("/suppliers/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = supplierUpdate.parse(req.body);
    const { contacts, ...rest } = data;
    // contacts, when provided, replace the set
    return prisma.supplier.update({
      where: { id },
      data: {
        ...rest,
        ...(contacts
          ? { contacts: { deleteMany: {}, create: contacts } }
          : {}),
      },
      include: {
        contacts: { orderBy: { isPrimary: "desc" } },
        materialLinks: { include: { material: true } },
      },
    });
  });

  app.delete("/suppliers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.supplier.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ---- material <-> supplier links ----
  app.get("/materials/:materialId/suppliers", async (req) => {
    const { materialId } = req.params as { materialId: string };
    return prisma.materialSupplier.findMany({
      where: { materialId },
      include: { supplier: { include: { contacts: { orderBy: { isPrimary: "desc" } } } } },
      orderBy: { preferred: "desc" },
    });
  });

  app.post("/materials/:materialId/suppliers", async (req, reply) => {
    const { materialId } = req.params as { materialId: string };
    const data = materialSupplierInput.parse(req.body);
    const link = await prisma.materialSupplier.upsert({
      where: { materialId_supplierId: { materialId, supplierId: data.supplierId } },
      create: { materialId, supplierId: data.supplierId, preferred: data.preferred },
      update: { preferred: data.preferred },
      include: { supplier: true },
    });
    return reply.status(201).send(link);
  });

  app.delete("/materials/:materialId/suppliers/:supplierId", async (req, reply) => {
    const { materialId, supplierId } = req.params as { materialId: string; supplierId: string };
    await prisma.materialSupplier.delete({
      where: { materialId_supplierId: { materialId, supplierId } },
    });
    return reply.status(204).send();
  });
}
