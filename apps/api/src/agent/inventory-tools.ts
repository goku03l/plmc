import { prisma } from "../db.js";
import { loadProjectNodes } from "../routes/tree-util.js";
import { materialDemand, availability, movementSign, type StockRow } from "../inventory.js";
import { str, projectByRef, inr, type AgentTool } from "./helpers.js";

/**
 * Inventory tools for the assistant.
 *
 * Read tools answer "do we already have it / where is it / what must we still
 * buy". The mutating ones follow the same conventions as mutations.ts: stock
 * movements are reversible bookkeeping (a wrong ISSUE is fixed with an
 * ADJUSTMENT), so they are `mutating: true` but NOT `destructive` — they run
 * straight away like an edit. Only deleting a warehouse, which takes its whole
 * ledger with it, goes through the propose-then-confirm gate.
 */

const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const qty = (n: number) => Math.round(n * 100) / 100;

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

async function warehouseByRef(ref?: string) {
  if (!ref) return null;
  return prisma.warehouse.findFirst({
    where: {
      OR: [
        { id: ref },
        { code: { equals: ref, mode: "insensitive" } },
        { name: { contains: ref, mode: "insensitive" } },
      ],
    },
  });
}

async function materialByRef(ref?: string) {
  if (!ref) return null;
  return prisma.material.findFirst({
    where: {
      OR: [
        { id: ref },
        { code: { equals: ref, mode: "insensitive" } },
        { name: { contains: ref, mode: "insensitive" } },
      ],
    },
  });
}

const READ_INVENTORY_TOOLS: AgentTool[] = [
  {
    mutating: false,
    def: {
      name: "list_warehouses",
      description:
        "List every warehouse / stock location with how many distinct materials it holds and the value of the stock sitting there.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    run: async () => {
      const rows = await prisma.warehouse.findMany({
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        include: { _count: { select: { stockItems: true, movements: true } } },
      });
      const items = await prisma.stockItem.findMany({ select: { warehouseId: true, onHand: true, unitCost: true } });
      const value = new Map<string, number>();
      for (const i of items) value.set(i.warehouseId, (value.get(i.warehouseId) ?? 0) + i.onHand * i.unitCost);
      return rows.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        location: w.location,
        active: w.isActive,
        materials: w._count.stockItems,
        movements: w._count.movements,
        stockValue_display: inr(value.get(w.id) ?? 0, "INR"),
      }));
    },
  },
  {
    mutating: false,
    def: {
      name: "check_stock",
      description:
        "How much of a material is in stock, and where. Use this for 'do we have any X', 'how much cement is left', 'where is the steel'. Returns one row per warehouse plus a total, including how much is reserved for other projects and therefore not actually free to use.",
      input_schema: {
        type: "object",
        properties: {
          material: { type: "string", description: "material id, code (e.g. IN-TMT-FE500) or name" },
          warehouse: { type: "string", description: "optional: limit to one warehouse (id, code or name)" },
        },
        required: ["material"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const material = await materialByRef(str(input.material));
      if (!material) return { error: "material not found" };
      const warehouse = input.warehouse ? await warehouseByRef(str(input.warehouse)) : null;
      if (input.warehouse && !warehouse) return { error: "warehouse not found" };

      const items = await prisma.stockItem.findMany({
        where: { materialId: material.id, ...(warehouse ? { warehouseId: warehouse.id } : {}) },
        include: { warehouse: true },
        orderBy: { onHand: "desc" },
      });

      const totalOnHand = items.reduce((s, i) => s + i.onHand, 0);
      const totalReserved = items.reduce((s, i) => s + i.reserved, 0);
      return {
        material: { id: material.id, code: material.code, name: material.name, uom: material.uom },
        totalOnHand: qty(totalOnHand),
        totalReserved: qty(totalReserved),
        totalAvailable: qty(totalOnHand - totalReserved),
        uom: material.uom,
        locations: items.map((i) => ({
          warehouseId: i.warehouseId,
          warehouse: `${i.warehouse.code} — ${i.warehouse.name}`,
          onHand: qty(i.onHand),
          reserved: qty(i.reserved),
          available: qty(i.onHand - i.reserved),
          bin: i.binLocation,
          belowMinLevel: i.minLevel > 0 && i.onHand <= i.minLevel,
        })),
        note: items.length === 0 ? "This material is not stocked in any warehouse." : undefined,
      };
    },
  },
  {
    mutating: false,
    def: {
      name: "get_project_coverage",
      description:
        "For a project: what its BOM requires, how much is already available in the warehouses, and what still has to be bought. Use this for 'what do we still need to buy', 'how much of the project is covered by stock', 'can we build X with what we have'. Quantities include wastage; availability excludes stock reserved for other projects.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string", description: "project id, code (e.g. SSR-001) or name" },
          warehouse: { type: "string", description: "optional: only count stock in this warehouse" },
          onlyShort: { type: "boolean", description: "only return materials that are short (default true)" },
          limit: { type: "number", description: "max rows to return, default 25" },
        },
        required: ["project"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const warehouse = input.warehouse ? await warehouseByRef(str(input.warehouse)) : null;
      if (input.warehouse && !warehouse) return { error: "warehouse not found" };

      const nodes = await loadProjectNodes(project.id);
      const demand = materialDemand(nodes as never);
      const materialIds = [...demand.byMaterial.keys()];

      const [stockItems, materials] = await Promise.all([
        prisma.stockItem.findMany({
          where: { materialId: { in: materialIds }, ...(warehouse ? { warehouseId: warehouse.id } : {}) },
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
      const all = availability(demand, stock, matMap);
      const onlyShort = input.onlyShort !== false;
      const rows = (onlyShort ? all.filter((r) => r.shortfall > 0) : all).slice(0, num(input.limit) ?? 25);

      const shortfallValue = all.reduce((s, r) => s + r.shortfallValue, 0);
      const requiredValue = all.reduce((s, r) => s + r.required * r.unitCost, 0);

      return {
        project: { code: project.code, name: project.name },
        warehouse: warehouse ? `${warehouse.code} — ${warehouse.name}` : "all warehouses",
        materialsRequired: all.length,
        fullyCovered: all.filter((r) => r.status === "covered").length,
        partlyCovered: all.filter((r) => r.status === "partial").length,
        notStocked: all.filter((r) => r.status === "none").length,
        stillToBuy_display: inr(shortfallValue, project.currency),
        coveredByStock_display: inr(requiredValue - shortfallValue, project.currency),
        rows: rows.map((r) => ({
          code: r.materialCode,
          name: r.materialName,
          uom: r.uom,
          required: qty(r.required),
          onHand: qty(r.onHand),
          available: qty(r.available),
          shortfall: qty(r.shortfall),
          shortfall_display: inr(r.shortfallValue, project.currency),
          status: r.status,
          at: r.locations.map((l) => `${l.code}: ${qty(l.available)} free`),
        })),
        unlinkedLines:
          demand.unlinked.length > 0
            ? `${demand.unlinked.length} material line(s) have no catalog material, so they can't be checked against stock and are excluded from these figures.`
            : undefined,
      };
    },
  },
  {
    mutating: false,
    def: {
      name: "list_stock_movements",
      description:
        "Recent stock ledger entries — what was received, issued, corrected or transferred, when, and against which project. Use for 'what happened to the cement', 'what did we receive this week', 'who took the steel'.",
      input_schema: {
        type: "object",
        properties: {
          material: { type: "string", description: "optional: filter to one material" },
          warehouse: { type: "string", description: "optional: filter to one warehouse" },
          project: { type: "string", description: "optional: filter to movements booked against one project" },
          limit: { type: "number", description: "max rows, default 20" },
        },
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const material = input.material ? await materialByRef(str(input.material)) : null;
      if (input.material && !material) return { error: "material not found" };
      const warehouse = input.warehouse ? await warehouseByRef(str(input.warehouse)) : null;
      if (input.warehouse && !warehouse) return { error: "warehouse not found" };
      const project = input.project ? await projectByRef(str(input.project)) : null;
      if (input.project && !project) return { error: "project not found" };

      const rows = await prisma.stockMovement.findMany({
        where: {
          ...(material ? { materialId: material.id } : {}),
          ...(warehouse ? { warehouseId: warehouse.id } : {}),
          ...(project ? { projectId: project.id } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: Math.min(num(input.limit) ?? 20, 100),
        include: {
          material: { select: { code: true, name: true } },
          warehouse: { select: { code: true } },
          project: { select: { code: true } },
        },
      });

      return rows.map((m) => ({
        when: m.createdAt,
        type: m.type,
        material: `${m.material.code} — ${m.material.name}`,
        warehouse: m.warehouse.code,
        quantity: qty(m.quantity),
        uom: m.uom,
        project: m.project?.code ?? null,
        reference: m.reference,
        note: m.note,
      }));
    },
  },
  {
    mutating: false,
    def: {
      name: "list_low_stock",
      description:
        "Materials at or below their reorder (minimum) level. Use for 'what's running low', 'what needs reordering'.",
      input_schema: {
        type: "object",
        properties: { warehouse: { type: "string", description: "optional: limit to one warehouse" } },
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const warehouse = input.warehouse ? await warehouseByRef(str(input.warehouse)) : null;
      if (input.warehouse && !warehouse) return { error: "warehouse not found" };
      const rows = await prisma.stockItem.findMany({
        where: { minLevel: { gt: 0 }, ...(warehouse ? { warehouseId: warehouse.id } : {}) },
        include: { material: true, warehouse: true },
      });
      const low = rows.filter((r) => r.onHand <= r.minLevel);
      return {
        count: low.length,
        rows: low.map((r) => ({
          material: `${r.material.code} — ${r.material.name}`,
          warehouse: r.warehouse.code,
          onHand: qty(r.onHand),
          minLevel: qty(r.minLevel),
          uom: r.uom,
        })),
      };
    },
  },
];

const MUTATING_INVENTORY_TOOLS: AgentTool[] = [
  {
    mutating: true,
    def: {
      name: "create_warehouse",
      description: "Create a new warehouse / stock location.",
      input_schema: {
        type: "object",
        properties: {
          code: { type: "string", description: "short unique code, e.g. WH-CEN" },
          name: { type: "string" },
          location: { type: "string" },
          notes: { type: "string" },
        },
        required: ["code", "name"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const code = str(input.code);
      const name = str(input.name);
      if (!code || !name) return { error: "code and name are required" };
      const existing = await prisma.warehouse.findUnique({ where: { code } });
      if (existing) return { error: `A warehouse with code ${code} already exists.` };
      const w = await prisma.warehouse.create({
        data: { code, name, location: str(input.location) ?? null, notes: str(input.notes) ?? null },
      });
      return done("create_warehouse", `Created warehouse ${w.code} — ${w.name}.`, { id: w.id });
    },
  },
  {
    mutating: true,
    def: {
      name: "record_stock_movement",
      description:
        "Record stock going in or out of a warehouse: RECEIPT (delivery arrived), ISSUE (taken out to site), ADJUSTMENT (correct a counted figure — quantity may be negative). Creates the stock line automatically on the first receipt. This is ordinary bookkeeping, so it runs immediately; a mistake is fixed with another ADJUSTMENT, not by deleting.",
      input_schema: {
        type: "object",
        properties: {
          warehouse: { type: "string", description: "warehouse id, code or name" },
          material: { type: "string", description: "material id, code or name" },
          type: { type: "string", enum: ["RECEIPT", "ISSUE", "ADJUSTMENT"] },
          quantity: { type: "number", description: "positive for RECEIPT/ISSUE; may be negative for ADJUSTMENT" },
          project: { type: "string", description: "optional: the project this is issued to / received for" },
          unitCost: { type: "number", description: "optional: landed rate, refreshes the stock valuation on a RECEIPT" },
          reference: { type: "string", description: "optional: delivery note, PO or gate pass number" },
          note: { type: "string" },
        },
        required: ["warehouse", "material", "type", "quantity"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const warehouse = await warehouseByRef(str(input.warehouse));
      if (!warehouse) return { error: "warehouse not found" };
      const material = await materialByRef(str(input.material));
      if (!material) return { error: "material not found" };
      const type = str(input.type) as "RECEIPT" | "ISSUE" | "ADJUSTMENT";
      if (!["RECEIPT", "ISSUE", "ADJUSTMENT"].includes(type)) return { error: "type must be RECEIPT, ISSUE or ADJUSTMENT" };
      const quantity = num(input.quantity);
      if (quantity == null || quantity === 0) return { error: "quantity is required and cannot be zero" };
      if (type !== "ADJUSTMENT" && quantity < 0) {
        return { error: `${type} quantity must be positive — the type already sets the direction.` };
      }
      const project = input.project ? await projectByRef(str(input.project)) : null;
      if (input.project && !project) return { error: "project not found" };

      try {
        const out = await prisma.$transaction(async (tx) => {
          const item =
            (await tx.stockItem.findUnique({
              where: { warehouseId_materialId: { warehouseId: warehouse.id, materialId: material.id } },
            })) ??
            (await tx.stockItem.create({
              data: {
                warehouseId: warehouse.id,
                materialId: material.id,
                uom: material.uom,
                unitCost: material.unitCost,
              },
            }));

          const signed = movementSign(type) * quantity;
          const next = item.onHand + signed;
          if (next < 0) {
            throw new Error(
              `Not enough stock: ${material.name} at ${warehouse.name} holds ${item.onHand} ${item.uom}, this needs ${Math.abs(signed)}.`,
            );
          }
          if (signed < 0 && next < item.reserved) {
            throw new Error(
              `That would leave ${next} ${item.uom} but ${item.reserved} is reserved for a project. Release a reservation first.`,
            );
          }

          await tx.stockMovement.create({
            data: {
              warehouseId: warehouse.id,
              materialId: material.id,
              stockItemId: item.id,
              type,
              quantity,
              uom: item.uom,
              unitCost: num(input.unitCost) ?? material.unitCost,
              projectId: project?.id ?? null,
              reference: str(input.reference) ?? null,
              note: str(input.note) ?? null,
            },
          });

          return tx.stockItem.update({
            where: { id: item.id },
            data: {
              onHand: next,
              ...(type === "RECEIPT" && num(input.unitCost) != null ? { unitCost: num(input.unitCost)! } : {}),
            },
          });
        });

        const verb = type === "RECEIPT" ? "Received" : type === "ISSUE" ? "Issued" : "Corrected";
        return done(
          "record_stock_movement",
          `${verb} ${Math.abs(quantity)} ${material.uom} of ${material.name} at ${warehouse.name}. Now ${qty(out.onHand)} ${material.uom} on hand.`,
          { onHand: qty(out.onHand), available: qty(out.onHand - out.reserved) },
        );
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  },
  {
    mutating: true,
    def: {
      name: "transfer_stock",
      description: "Move stock from one warehouse to another. Writes both ledger entries in one atomic operation.",
      input_schema: {
        type: "object",
        properties: {
          fromWarehouse: { type: "string" },
          toWarehouse: { type: "string" },
          material: { type: "string" },
          quantity: { type: "number" },
          reference: { type: "string" },
          note: { type: "string" },
        },
        required: ["fromWarehouse", "toWarehouse", "material", "quantity"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const from = await warehouseByRef(str(input.fromWarehouse));
      if (!from) return { error: "source warehouse not found" };
      const to = await warehouseByRef(str(input.toWarehouse));
      if (!to) return { error: "destination warehouse not found" };
      if (from.id === to.id) return { error: "source and destination are the same warehouse" };
      const material = await materialByRef(str(input.material));
      if (!material) return { error: "material not found" };
      const quantity = num(input.quantity);
      if (!quantity || quantity <= 0) return { error: "quantity must be positive" };

      try {
        await prisma.$transaction(async (tx) => {
          const src = await tx.stockItem.findUnique({
            where: { warehouseId_materialId: { warehouseId: from.id, materialId: material.id } },
          });
          if (!src) throw new Error(`${material.name} is not stocked at ${from.name}.`);
          const next = src.onHand - quantity;
          if (next < 0) throw new Error(`${from.name} only holds ${src.onHand} ${src.uom} of ${material.name}.`);
          if (next < src.reserved) {
            throw new Error(`That would leave ${next} ${src.uom} but ${src.reserved} is reserved. Release a reservation first.`);
          }

          const dst =
            (await tx.stockItem.findUnique({
              where: { warehouseId_materialId: { warehouseId: to.id, materialId: material.id } },
            })) ??
            (await tx.stockItem.create({
              data: { warehouseId: to.id, materialId: material.id, uom: material.uom, unitCost: src.unitCost },
            }));

          await tx.stockMovement.createMany({
            data: [
              {
                warehouseId: from.id,
                materialId: material.id,
                stockItemId: src.id,
                type: "TRANSFER_OUT",
                quantity,
                uom: src.uom,
                unitCost: src.unitCost,
                reference: str(input.reference) ?? null,
                note: str(input.note) ?? null,
              },
              {
                warehouseId: to.id,
                materialId: material.id,
                stockItemId: dst.id,
                type: "TRANSFER_IN",
                quantity,
                uom: dst.uom,
                unitCost: src.unitCost,
                reference: str(input.reference) ?? null,
                note: str(input.note) ?? null,
              },
            ],
          });

          await tx.stockItem.update({ where: { id: src.id }, data: { onHand: next } });
          await tx.stockItem.update({ where: { id: dst.id }, data: { onHand: dst.onHand + quantity } });
        });

        return done(
          "transfer_stock",
          `Moved ${quantity} ${material.uom} of ${material.name} from ${from.name} to ${to.name}.`,
        );
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  },
  {
    mutating: true,
    def: {
      name: "reserve_stock",
      description:
        "Earmark stock in a warehouse for a project, so another project's coverage no longer counts it as available. Does not move anything physically.",
      input_schema: {
        type: "object",
        properties: {
          warehouse: { type: "string" },
          material: { type: "string" },
          project: { type: "string" },
          quantity: { type: "number" },
          note: { type: "string" },
        },
        required: ["warehouse", "material", "project", "quantity"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const warehouse = await warehouseByRef(str(input.warehouse));
      if (!warehouse) return { error: "warehouse not found" };
      const material = await materialByRef(str(input.material));
      if (!material) return { error: "material not found" };
      const project = await projectByRef(str(input.project));
      if (!project) return { error: "project not found" };
      const quantity = num(input.quantity);
      if (!quantity || quantity <= 0) return { error: "quantity must be positive" };

      try {
        await prisma.$transaction(async (tx) => {
          const item = await tx.stockItem.findUnique({
            where: { warehouseId_materialId: { warehouseId: warehouse.id, materialId: material.id } },
          });
          if (!item) throw new Error(`${material.name} is not stocked at ${warehouse.name}.`);
          const free = item.onHand - item.reserved;
          if (quantity > free) {
            throw new Error(`Only ${free} ${item.uom} free to reserve (${item.onHand} on hand, ${item.reserved} already reserved).`);
          }
          await tx.stockReservation.create({
            data: {
              stockItemId: item.id,
              warehouseId: warehouse.id,
              projectId: project.id,
              quantity,
              note: str(input.note) ?? null,
            },
          });
          const agg = await tx.stockReservation.aggregate({ where: { stockItemId: item.id }, _sum: { quantity: true } });
          await tx.stockItem.update({ where: { id: item.id }, data: { reserved: agg._sum.quantity ?? 0 } });
        });

        return done(
          "reserve_stock",
          `Reserved ${quantity} ${material.uom} of ${material.name} at ${warehouse.name} for ${project.code}.`,
        );
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  },
  {
    mutating: true,
    destructive: true,
    def: {
      name: "delete_warehouse",
      description:
        "Delete a warehouse. This also deletes every stock line, reservation and ledger entry belonging to it, and cannot be undone.",
      input_schema: {
        type: "object",
        properties: {
          warehouse: { type: "string", description: "warehouse id, code or name" },
          confirm: { type: "boolean", description: "omit on the first call to preview; true only after the user agrees" },
        },
        required: ["warehouse"],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const warehouse = await warehouseByRef(str(input.warehouse));
      if (!warehouse) return { error: "warehouse not found" };
      const [stockItems, movements, reservations] = await Promise.all([
        prisma.stockItem.count({ where: { warehouseId: warehouse.id } }),
        prisma.stockMovement.count({ where: { warehouseId: warehouse.id } }),
        prisma.stockReservation.count({ where: { warehouseId: warehouse.id } }),
      ]);
      const items = await prisma.stockItem.findMany({
        where: { warehouseId: warehouse.id },
        select: { onHand: true, unitCost: true },
      });
      const value = items.reduce((s, i) => s + i.onHand * i.unitCost, 0);

      const summary = `Delete warehouse ${warehouse.code} — ${warehouse.name}: ${stockItems} stock line(s) worth ${inr(value, "INR")}, ${movements} ledger entr(ies) and ${reservations} reservation(s) go with it. This cannot be undone.`;

      if (input.confirm !== true) {
        return pending("delete_warehouse", summary, {
          key: input.__confirmKey,
          warehouse: warehouse.code,
          stockItems,
          movements,
          reservations,
        });
      }

      await prisma.warehouse.delete({ where: { id: warehouse.id } });
      return done("delete_warehouse", `Deleted warehouse ${warehouse.code} and its ${movements} ledger entr(ies).`);
    },
  },
];

export const INVENTORY_READ_TOOLS = READ_INVENTORY_TOOLS;
export const INVENTORY_MUTATING_TOOLS = MUTATING_INVENTORY_TOOLS;
