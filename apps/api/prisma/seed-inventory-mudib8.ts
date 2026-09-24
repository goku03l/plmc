/**
 * Inventory for the Mudi B8 vehicle project (MB8-001) — randomised but deterministic
 * (fixed RNG seed): 4 stores, stock on hand for ~2/3 of the parts, a back-dated GRN /
 * line-issue ledger whose balance lands exactly on on-hand, and a few pre-series
 * reservations. Stock is held as multiples of a single vehicle's demand (i.e. "N cars
 * worth"), so the coverage tab shows a mix of covered / partial / not-stocked parts.
 *
 * Run (after seed-mudib8.ts):  cd apps/api && npx tsx prisma/seed-inventory-mudib8.ts
 */
import { PrismaClient } from "@prisma/client";
import { materialDemand } from "../src/inventory.js";

const prisma = new PrismaClient();
const PROJECT_CODE = "MB8-001";
const NOW = new Date();
/** planned production run this stock has to cover */
const RUN_CARS = 97;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(88888);
const rand = (lo: number, hi: number) => lo + rng() * (hi - lo);
const daysAgo = (d: number) => {
  const t = new Date(NOW.getTime() - d * 86400000);
  t.setHours(7 + Math.floor(rng() * 10), Math.floor(rng() * 60), 0, 0);
  return t;
};

const WAREHOUSES = [
  { code: "WH-MB8-LINE", name: "Line-side Store — Neckarsulm", location: "Neckarsulm, DE", address: "Assembly Hall 2, Bay 6 — line-side supermarket", notes: "Small-lot kitted parts feeding final assembly; replenished daily." },
  { code: "WH-MB8-PT", name: "Powertrain Kitting Store", location: "Neckarsulm, DE", address: "Powertrain Building, Cage P — engine & gearbox sub-assembly stock", notes: "Engine internals, DCT and driveline parts. High-value, cage-controlled." },
  { code: "WH-MB8-HUB", name: "Inbound Logistics Hub — Ingolstadt", location: "Ingolstadt, DE", address: "Logistics Park Sued, Gate 4 — bonded bulk racking", notes: "Body panels, composites, glass, wheels — bulky items on 2-day call-off." },
  { code: "WH-MB8-CHEM", name: "Fluids & Consumables Store", location: "Neckarsulm, DE", address: "Hazmat store H1 — bunded", notes: "Oils, coolant, adhesives, sealers, paint and fasteners." },
] as const;
type Wh = (typeof WAREHOUSES)[number]["code"];

/** which store holds a part, by its BOM system category */
function homeStore(category: string, code: string): Wh {
  if (/^MB8-(FL|FS-2)/.test(code)) return "WH-MB8-CHEM";
  switch (category) {
    case "Powertrain":
      return "WH-MB8-PT";
    case "Body & Structure":
    case "Exterior & Aero":
      return "WH-MB8-HUB";
    case "Thermal & Fluids":
    case "Fasteners & Consumables":
      return "WH-MB8-CHEM";
    default:
      return "WH-MB8-LINE";
  }
}

const qtyFor = (uom: string, q: number) =>
  ["L", "kg"].includes(uom) ? Math.max(1, Math.round(q * 2) / 2) : Math.max(1, Math.round(q));

async function main() {
  const project = await prisma.project.findUnique({ where: { code: PROJECT_CODE } });
  if (!project) throw new Error(`Project ${PROJECT_CODE} not found — run "npx tsx prisma/seed-mudib8.ts" first.`);

  const nodes = await prisma.node.findMany({ where: { projectId: project.id }, include: { bomLines: true } });
  const demand = materialDemand(nodes as never);
  const materials = await prisma.material.findMany({ where: { code: { startsWith: "MB8-" } } });
  const supplierLinks = await prisma.materialSupplier.findMany({
    where: { preferred: true },
    include: { supplier: { select: { name: true } } },
  });
  const supplierOf = new Map(supplierLinks.map((l) => [l.materialId, l.supplier.name]));

  await prisma.warehouse.deleteMany({ where: { code: { in: WAREHOUSES.map((w) => w.code) } } });
  const whId = new Map<string, string>();
  for (const w of WAREHOUSES) whId.set(w.code, (await prisma.warehouse.create({ data: w })).id);

  type Line = { id: string; wh: Wh; mat: (typeof materials)[number]; onHand: number; unitCost: number; perCar: number };
  const lines: Line[] = [];
  const movements: any[] = [];
  let grn = 5000;
  let mir = 9000;
  let po = 700;

  for (const mat of materials) {
    const d = demand.byMaterial.get(mat.id);
    if (!d) continue;
    const wh = homeStore(mat.category ?? "", mat.code);
    // every part covers the 97-car build run (with a margin); some run well past it
    // (common / cheap / long-lead items), fasteners in bulk
    const bulk = mat.code.startsWith("MB8-FS-2");
    const cars = bulk ? rand(300, 900) : rng() < 0.25 ? rand(150, 320) : rand(RUN_CARS + 6, 150);
    const onHand = qtyFor(mat.uom, d.required * cars);
    const unitCost = Math.round(mat.unitCost * rand(0.95, 1.06) * 100) / 100;
    const minLevel = qtyFor(mat.uom, onHand * rand(0.15, 0.6));
    const rec = await prisma.stockItem.create({
      data: {
        warehouseId: whId.get(wh)!,
        materialId: mat.id,
        onHand,
        reserved: 0,
        minLevel,
        uom: mat.uom,
        unitCost,
        binLocation: `${wh.slice(7, 8)}${1 + Math.floor(rng() * 9)}-${String.fromCharCode(65 + Math.floor(rng() * 8))}${1 + Math.floor(rng() * 12)}`,
      },
    });
    lines.push({ id: rec.id, wh, mat, onHand, unitCost, perCar: d.required });

    // ledger: what was consumed on the pre-series line + what is on hand = what was received
    const issued = onHand > 3 && rng() < 0.7 ? qtyFor(mat.uom, onHand * rand(0.2, 1.0)) : 0;
    const received = onHand + issued;
    const nRec = received > 6 && rng() < 0.6 ? 2 : 1;
    const poNo = `PO-MB8-${String(++po).padStart(4, "0")}`;
    let assigned = 0;
    const recDays: number[] = [];
    for (let i = 0; i < nRec; i++) {
      const q = i === nRec - 1 ? received - assigned : Math.max(1, Math.round(received * rand(0.4, 0.6)));
      if (q <= 0) continue;
      assigned += q;
      const day = nRec === 1 ? rand(20, 80) : i === 0 ? rand(50, 90) : rand(8, 35);
      recDays.push(day);
      movements.push({
        warehouseId: whId.get(wh)!,
        materialId: mat.id,
        stockItemId: rec.id,
        type: "RECEIPT",
        quantity: q,
        uom: mat.uom,
        unitCost: Math.round(unitCost * rand(0.97, 1.02) * 100) / 100,
        projectId: project.id,
        nodeId: null,
        reference: `GRN-MB8-${String(++grn).padStart(5, "0")}`,
        note: `${supplierOf.get(mat.id) ?? "Supplier"} · against ${poNo} · goods-in inspected`,
        createdAt: daysAgo(day),
      });
    }
    if (issued > 0) {
      const lastRecDay = Math.min(...recDays); // issue happens after the most recent receipt
      const consumers = nodes.filter((n) => n.bomLines.some((b) => b.materialId === mat.id));
      const node = consumers.length ? consumers[Math.floor(rng() * consumers.length)]! : null;
      movements.push({
        warehouseId: whId.get(wh)!,
        materialId: mat.id,
        stockItemId: rec.id,
        type: "ISSUE",
        quantity: issued,
        uom: mat.uom,
        unitCost,
        projectId: project.id,
        nodeId: node?.id ?? null,
        reference: `MIR-MB8-${String(++mir).padStart(5, "0")}`,
        note: `Issued to pre-series build ${["PS-01", "PS-02", "PS-03"][Math.floor(rng() * 3)]}${node ? ` · ${node.name}` : ""}`,
        createdAt: daysAgo(Math.max(0.5, lastRecDay - rand(0.3, Math.max(0.6, lastRecDay * 0.6)))),
      });
    }
  }

  movements.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (let i = 0; i < movements.length; i += 500) await prisma.stockMovement.createMany({ data: movements.slice(i, i + 500) });

  // a handful of reservations for upcoming pre-series / test builds
  let reservations = 0;
  const candidates = lines.filter((l) => !l.mat.code.startsWith("MB8-FS-2"));
  const notes = ["Held for pre-series PS-04", "Held for crash-test cars (2 units)", "Reserved — homologation sample vehicles"];
  for (let i = 0; i < 14 && candidates.length; i++) {
    const l = candidates.splice(Math.floor(rng() * candidates.length), 1)[0]!;
    // reserve at most ~6 cars' worth, so what's still available stays above the 97-car run
    const qty = qtyFor(l.mat.uom, l.perCar * rand(2, 6));
    await prisma.stockReservation.create({
      data: {
        stockItemId: l.id,
        warehouseId: whId.get(l.wh)!,
        projectId: project.id,
        quantity: qty,
        note: notes[Math.floor(rng() * notes.length)],
      },
    });
    await prisma.stockItem.update({ where: { id: l.id }, data: { reserved: qty } });
    reservations++;
  }

  const value = lines.reduce((t, l) => t + l.onHand * l.unitCost, 0);
  console.log(`done: inventory for ${project.code} "${project.name}"`);
  console.log(
    `  ${WAREHOUSES.length} warehouses · ${lines.length} stock lines (of ${demand.byMaterial.size} demanded parts) · ${movements.length} movements · ${reservations} reservations`,
  );
  console.log(`  stock on hand (covers a ${RUN_CARS}-car run) valued at $${Math.round(value).toLocaleString("en-US")}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
