import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../http.js";
import {
  warehouseCreate,
  warehouseUpdate,
  stockItemUpsert,
  stockItemUpdate,
  stockMovementCreate,
  stockTransfer,
  reservationCreate,
  reservationUpdate,
} from "../schemas.js";
import { loadProjectNodes } from "./tree-util.js";
import { materialDemand, availability, buildable, scaleDemand, movementSign, type StockRow } from "../inventory.js";

type Tx = Prisma.TransactionClient;

/**
 * Apply a movement and move the balance in the same transaction, so the ledger
 * and the on-hand figure can never disagree. Creates the stock line on first
 * receipt. Returns the movement and the updated item.
 */
async function applyMovement(
  tx: Tx,
  input: {
    warehouseId: string;
    materialId: string;
    type: "RECEIPT" | "ISSUE" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT";
    quantity: number;
    unitCost?: number;
    projectId?: string | null;
    nodeId?: string | null;
    reference?: string | null;
    note?: string | null;
  },
) {
  const material = await tx.material.findUnique({ where: { id: input.materialId } });
  if (!material) throw notFound("Material");
  const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
  if (!warehouse) throw notFound("Warehouse");

  const item =
    (await tx.stockItem.findUnique({
      where: { warehouseId_materialId: { warehouseId: input.warehouseId, materialId: input.materialId } },
    })) ??
    (await tx.stockItem.create({
      data: {
        warehouseId: input.warehouseId,
        materialId: input.materialId,
        uom: material.uom,
        unitCost: material.unitCost,
      },
    }));

  const signed = movementSign(input.type) * input.quantity;
  const next = item.onHand + signed;
  if (next < 0) {
    throw badRequest(
      `Not enough stock: ${material.name} at ${warehouse.name} holds ${item.onHand} ${item.uom}, this movement needs ${Math.abs(signed)}.`,
    );
  }
  // A withdrawal must not eat into what another project has reserved.
  if (signed < 0 && next < item.reserved) {
    throw badRequest(
      `That would leave ${next} ${item.uom} but ${item.reserved} is reserved. Release a reservation first.`,
    );
  }

  const movement = await tx.stockMovement.create({
    data: {
      warehouseId: input.warehouseId,
      materialId: input.materialId,
      stockItemId: item.id,
      type: input.type,
      quantity: input.quantity,
      uom: item.uom,
      unitCost: input.unitCost ?? material.unitCost,
      projectId: input.projectId ?? null,
      nodeId: input.nodeId ?? null,
      reference: input.reference ?? null,
      note: input.note ?? null,
    },
  });

  const stockItem = await tx.stockItem.update({
    where: { id: item.id },
    data: {
      onHand: next,
      // a receipt refreshes the landed cost the stock is valued at
      ...(input.type === "RECEIPT" && input.unitCost != null ? { unitCost: input.unitCost } : {}),
    },
    include: { material: true, warehouse: true },
  });

  return { movement, stockItem };
}

/** Recompute an item's `reserved` from its reservation rows. */
async function syncReserved(tx: Tx, stockItemId: string) {
  const agg = await tx.stockReservation.aggregate({
    where: { stockItemId },
    _sum: { quantity: true },
  });
  return tx.stockItem.update({
    where: { id: stockItemId },
    data: { reserved: agg._sum.quantity ?? 0 },
  });
}

export async function inventoryRoutes(app: FastifyInstance) {
  // ---- warehouses ----------------------------------------------------------
  app.get("/warehouses", async (req) => {
    const { q } = req.query as { q?: string };
    const rows = await prisma.warehouse.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              { location: { contains: q, mode: "insensitive" } },
            ],
          }
        : {},
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { stockItems: true, movements: true } } },
    });

    const items = await prisma.stockItem.findMany({ select: { warehouseId: true, onHand: true, unitCost: true } });
    const value = new Map<string, number>();
    for (const i of items) value.set(i.warehouseId, (value.get(i.warehouseId) ?? 0) + i.onHand * i.unitCost);

    return rows.map((w) => ({ ...w, stockValue: value.get(w.id) ?? 0 }));
  });

  app.get("/warehouses/:id", async (req) => {
    const { id } = req.params as { id: string };
    const wh = await prisma.warehouse.findUnique({
      where: { id },
      include: {
        stockItems: { include: { material: true }, orderBy: { material: { name: "asc" } } },
      },
    });
    if (!wh) throw notFound("Warehouse");
    const stockValue = wh.stockItems.reduce((s, i) => s + i.onHand * i.unitCost, 0);
    return { ...wh, stockValue };
  });

  app.post("/warehouses", async (req, reply) => {
    const data = warehouseCreate.parse(req.body);
    const created = await prisma.warehouse.create({ data });
    return reply.status(201).send(created);
  });

  app.patch("/warehouses/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = warehouseUpdate.parse(req.body);
    return prisma.warehouse.update({ where: { id }, data });
  });

  app.delete("/warehouses/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.warehouse.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ---- stock ---------------------------------------------------------------
  app.get("/stock", async (req) => {
    const { warehouseId, materialId, q, lowOnly } = req.query as {
      warehouseId?: string;
      materialId?: string;
      q?: string;
      lowOnly?: string;
    };
    const rows = await prisma.stockItem.findMany({
      where: {
        AND: [
          warehouseId ? { warehouseId } : {},
          materialId ? { materialId } : {},
          q
            ? {
                material: {
                  OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { code: { contains: q, mode: "insensitive" } },
                  ],
                },
              }
            : {},
        ],
      },
      include: { material: true, warehouse: true },
      orderBy: [{ warehouse: { name: "asc" } }, { material: { name: "asc" } }],
    });

    const mapped = rows.map((r) => ({
      ...r,
      available: Math.max(0, r.onHand - r.reserved),
      value: r.onHand * r.unitCost,
      low: r.minLevel > 0 && r.onHand <= r.minLevel,
    }));
    return lowOnly === "true" ? mapped.filter((r) => r.low) : mapped;
  });

  /** Create or correct a stock line. Any quantity change is written to the ledger. */
  app.post("/stock", async (req, reply) => {
    const data = stockItemUpsert.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.stockItem.findUnique({
        where: { warehouseId_materialId: { warehouseId: data.warehouseId, materialId: data.materialId } },
      });

      const delta = data.onHand - (existing?.onHand ?? 0);
      if (delta !== 0) {
        await applyMovement(tx, {
          warehouseId: data.warehouseId,
          materialId: data.materialId,
          type: existing ? "ADJUSTMENT" : "RECEIPT",
          quantity: delta,
          unitCost: data.unitCost,
          note: existing ? "Opening balance corrected" : "Opening balance",
        });
      }

      // applyMovement creates the row; if the opening balance was zero it may not exist yet
      const ensured =
        (await tx.stockItem.findUnique({
          where: { warehouseId_materialId: { warehouseId: data.warehouseId, materialId: data.materialId } },
        })) ??
        (await tx.stockItem.create({
          data: { warehouseId: data.warehouseId, materialId: data.materialId },
        }));

      return tx.stockItem.update({
        where: { id: ensured.id },
        data: {
          minLevel: data.minLevel,
          binLocation: data.binLocation ?? null,
          ...(data.unitCost != null ? { unitCost: data.unitCost } : {}),
        },
        include: { material: true, warehouse: true },
      });
    });
    return reply.status(201).send(result);
  });

  app.patch("/stock/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = stockItemUpdate.parse(req.body);
    return prisma.stockItem.update({
      where: { id },
      data: {
        ...(data.minLevel != null ? { minLevel: data.minLevel } : {}),
        ...(data.unitCost != null ? { unitCost: data.unitCost } : {}),
        ...(data.binLocation !== undefined ? { binLocation: data.binLocation ?? null } : {}),
      },
      include: { material: true, warehouse: true },
    });
  });

  app.delete("/stock/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.stockItem.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ---- movements -----------------------------------------------------------
  app.get("/stock/movements", async (req) => {
    const { warehouseId, materialId, projectId, limit } = req.query as {
      warehouseId?: string;
      materialId?: string;
      projectId?: string;
      limit?: string;
    };
    return prisma.stockMovement.findMany({
      where: {
        AND: [
          warehouseId ? { warehouseId } : {},
          materialId ? { materialId } : {},
          projectId ? { projectId } : {},
        ],
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(limit ?? 100) || 100, 500),
      include: {
        material: { select: { code: true, name: true, uom: true } },
        warehouse: { select: { code: true, name: true } },
        project: { select: { code: true, name: true } },
        node: { select: { name: true } },
      },
    });
  });

  app.post("/stock/movements", async (req, reply) => {
    const data = stockMovementCreate.parse(req.body);
    if (data.type !== "ADJUSTMENT" && data.quantity < 0) {
      throw badRequest(`${data.type} quantity must be positive — the type already sets the direction.`);
    }
    const out = await prisma.$transaction((tx) => applyMovement(tx, data));
    return reply.status(201).send(out);
  });

  /** Move stock between warehouses — two ledger entries, one atomic operation. */
  app.post("/stock/transfer", async (req, reply) => {
    const data = stockTransfer.parse(req.body);
    if (data.fromWarehouseId === data.toWarehouseId) {
      throw badRequest("Source and destination warehouse are the same.");
    }
    const out = await prisma.$transaction(async (tx) => {
      const sent = await applyMovement(tx, {
        warehouseId: data.fromWarehouseId,
        materialId: data.materialId,
        type: "TRANSFER_OUT",
        quantity: data.quantity,
        reference: data.reference,
        note: data.note,
      });
      const received = await applyMovement(tx, {
        warehouseId: data.toWarehouseId,
        materialId: data.materialId,
        type: "TRANSFER_IN",
        quantity: data.quantity,
        unitCost: sent.stockItem.unitCost,
        reference: data.reference,
        note: data.note,
      });
      return { from: sent.stockItem, to: received.stockItem };
    });
    return reply.status(201).send(out);
  });

  // ---- reservations --------------------------------------------------------
  app.get("/stock/reservations", async (req) => {
    const { projectId, warehouseId } = req.query as { projectId?: string; warehouseId?: string };
    return prisma.stockReservation.findMany({
      where: { AND: [projectId ? { projectId } : {}, warehouseId ? { warehouseId } : {}] },
      orderBy: { createdAt: "desc" },
      include: {
        stockItem: { include: { material: true } },
        warehouse: { select: { code: true, name: true } },
        project: { select: { code: true, name: true } },
        node: { select: { name: true } },
      },
    });
  });

  app.post("/stock/reservations", async (req, reply) => {
    const data = reservationCreate.parse(req.body);
    const out = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id: data.stockItemId } });
      if (!item) throw notFound("Stock item");
      const free = item.onHand - item.reserved;
      if (data.quantity > free) {
        throw badRequest(
          `Only ${free} available to reserve (${item.onHand} on hand, ${item.reserved} already reserved).`,
        );
      }
      const created = await tx.stockReservation.create({
        data: {
          stockItemId: item.id,
          warehouseId: item.warehouseId,
          projectId: data.projectId,
          nodeId: data.nodeId ?? null,
          quantity: data.quantity,
          note: data.note ?? null,
        },
      });
      await syncReserved(tx, item.id);
      return created;
    });
    return reply.status(201).send(out);
  });

  app.patch("/stock/reservations/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = reservationUpdate.parse(req.body);
    return prisma.$transaction(async (tx) => {
      const existing = await tx.stockReservation.findUnique({ where: { id }, include: { stockItem: true } });
      if (!existing) throw notFound("Reservation");
      if (data.quantity != null) {
        const otherReserved = existing.stockItem.reserved - existing.quantity;
        if (data.quantity + otherReserved > existing.stockItem.onHand) {
          throw badRequest(`Only ${existing.stockItem.onHand - otherReserved} available to reserve.`);
        }
      }
      const updated = await tx.stockReservation.update({
        where: { id },
        data: {
          ...(data.quantity != null ? { quantity: data.quantity } : {}),
          ...(data.note !== undefined ? { note: data.note ?? null } : {}),
        },
      });
      await syncReserved(tx, existing.stockItemId);
      return updated;
    });
  });

  app.delete("/stock/reservations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.$transaction(async (tx) => {
      const existing = await tx.stockReservation.findUnique({ where: { id } });
      if (!existing) throw notFound("Reservation");
      await tx.stockReservation.delete({ where: { id } });
      await syncReserved(tx, existing.stockItemId);
    });
    return reply.status(204).send();
  });

  // ---- the point of all this: what does this project still have to buy? -----
  app.get("/projects/:id/availability", async (req) => {
    const { id } = req.params as { id: string };
    const { warehouseId, units: unitsRaw } = req.query as { warehouseId?: string; units?: string };
    // build target: scale the BOM to N complete units (default 1 = a single unit)
    const units = Math.min(1_000_000, Math.max(1, Math.floor(Number(unitsRaw) || 1)));

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) throw notFound("Project");

    const nodes = await loadProjectNodes(project.id);
    const demand = materialDemand(nodes as never);
    const materialIds = [...demand.byMaterial.keys()];

    const [stockItems, materials] = await Promise.all([
      prisma.stockItem.findMany({
        where: { materialId: { in: materialIds }, ...(warehouseId ? { warehouseId } : {}) },
        include: { warehouse: true, reservations: { where: { projectId: project.id } } },
      }),
      prisma.material.findMany({ where: { id: { in: materialIds } } }),
    ]);

    const stock: StockRow[] = stockItems.map((s) => ({
      warehouseId: s.warehouseId,
      warehouseCode: s.warehouse.code,
      warehouseName: s.warehouse.name,
      materialId: s.materialId,
      onHand: s.onHand,
      reserved: s.reserved,
      reservedForProject: s.reservations.reduce((t, r) => t + r.quantity, 0),
      minLevel: s.minLevel,
      binLocation: s.binLocation,
      unitCost: s.unitCost,
    }));

    const matMap = new Map(
      materials.map((m) => [m.id, { code: m.code, name: m.name, uom: m.uom, unitCost: m.unitCost }]),
    );
    const perUnitRows = availability(demand, stock, matMap);
    // "how many can we build from what's in stock" always uses the per-unit BOM
    const canBuild = buildable(perUnitRows);
    const rows = units === 1 ? perUnitRows : availability(scaleDemand(demand, units), stock, matMap);

    const totals = rows.reduce(
      (t, r) => {
        t.requiredValue += r.required * r.unitCost;
        t.shortfallValue += r.shortfallValue;
        if (r.status === "covered") t.covered += 1;
        else if (r.status === "partial") t.partial += 1;
        else t.none += 1;
        return t;
      },
      { requiredValue: 0, shortfallValue: 0, covered: 0, partial: 0, none: 0 },
    );

    return {
      project: { id: project.id, code: project.code, name: project.name, currency: project.currency },
      units,
      buildable: canBuild,
      rows,
      // MATERIAL lines with no catalog link can't be netted against stock — report
      // them rather than letting the coverage figure look better than it is.
      unlinked: demand.unlinked,
      totals: {
        ...totals,
        materials: rows.length,
        unlinkedLines: demand.unlinked.length,
        coveredValue: totals.requiredValue - totals.shortfallValue,
      },
    };
  });
}
