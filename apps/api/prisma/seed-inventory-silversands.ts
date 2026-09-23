/**
 * Inventory for "Silver Sands Residency" (SSR-001) — warehouses, stock on hand,
 * the movement ledger behind it, and reservations.
 *
 * The point of the demo is the *coverage* tab: the project's BOM demand netted
 * against what the stores already hold, so the client sees "still to buy"
 * rather than the gross BOM. To make that read like a real job in progress the
 * data is built from the actual demand of the project:
 *
 *   1. roll up the BOM (the same maths the API uses) to get demand per material
 *   2. hold a curated fraction of that demand across 5 stores — some items
 *      fully covered, most partly, bulk/subcontracted items not stocked at all
 *      (ready-mix, piling, formwork hire, STP/WTP/DG, clubhouse fit-out —
 *      nobody warehouses those)
 *   3. generate a back-dated ledger — GRNs against POs, issues booked to the
 *      tower/floor that consumed them, yard→site transfers, cycle-count
 *      corrections — whose running balance lands exactly on the on-hand figure
 *   4. reserve part of it for Silver Sands and part for Thuniv Paradise, so the
 *      coverage view also shows stock that exists but isn't ours to take
 *
 * Everything is deterministic (fixed RNG seed): re-running gives the same
 * numbers, so a demo can be reset mid-meeting.
 *
 * Run:  cd apps/api && npx tsx prisma/seed-inventory-silversands.ts
 */
import { PrismaClient } from "@prisma/client";
import { materialDemand, availability, type StockRow } from "../src/inventory.js";

const prisma = new PrismaClient();

const PROJECT_CODE = "SSR-001";
/** a second live project competing for the same yard stock — optional */
const OTHER_PROJECT_CODE = "THU-001";
const NOW = new Date();

// ---------------------------------------------------------------------------
// deterministic RNG — same seed, same demo, every time
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260919);
const rand = (lo: number, hi: number) => lo + rng() * (hi - lo);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;

/** a timestamp `d` days before now, at a plausible working hour */
function daysAgo(d: number): Date {
  const t = new Date(NOW.getTime() - d * 86400000);
  t.setHours(8 + Math.floor(rng() * 10), Math.floor(rng() * 60), 0, 0);
  return t;
}

/** quantities that look like a delivery note, not a float */
function roundQty(uom: string, q: number): number {
  if (["nos", "set", "point", "ea", "LS", "apt"].includes(uom)) return Math.max(1, Math.round(q));
  if (uom === "kg") return Math.max(500, Math.round(q / 500) * 500);
  if (q >= 500) return Math.round(q / 10) * 10;
  return Math.max(1, Math.round(q / 5) * 5);
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------
type WhCode = "WH-CEN" | "WH-SITE" | "WH-TWRB" | "WH-GODOWN" | "WH-FAB";

const WAREHOUSES: Array<{ code: WhCode; name: string; location: string; address: string; notes: string }> = [
  {
    code: "WH-CEN",
    name: "Central Yard — Padappai",
    location: "Padappai, Chennai",
    address: "Survey No. 114/2B, Padappai–Mannivakkam Road, Kancheepuram Dist. 601301",
    notes:
      "Company-wide yard feeding every live site. Bulk steel, blocks and reserve finishes; material moves to the site stores on a weekly transfer run.",
  },
  {
    code: "WH-SITE",
    name: "Silver Sands Site Store — ECR",
    location: "ECR, Chennai (on site)",
    address: "Silver Sands Residency, ECR, Uthandi, Chennai 600119 — store shed behind Gate 2",
    notes: "Main on-plot store. Issues to all three towers against MIRs signed by the site engineer.",
  },
  {
    code: "WH-TWRB",
    name: "Tower B — Level 04 Staging Store",
    location: "Tower B, Level 04",
    address: "Silver Sands Residency, Tower B (Bay View), Level 04 — flat B-404 shell",
    notes: "Finishing materials staged at height so the hoist isn't on the critical path. Small quantities, fast turnover.",
  },
  {
    code: "WH-GODOWN",
    name: "Perungudi Godown (rented)",
    location: "Perungudi, Chennai",
    address: "Plot 27, Thoraipakkam–Pallavaram Radial Road, Perungudi, Chennai 600096",
    notes:
      "Rented covered godown for weather-sensitive and high-value finishes — tiles, joinery, sanitaryware. Rent ₹1.85 L/month, lease to Mar-2027.",
  },
  {
    code: "WH-FAB",
    name: "Ambattur Fabrication Yard",
    location: "Ambattur Industrial Estate, Chennai",
    address: "Shed 14, 3rd Cross Street, Ambattur Industrial Estate, Chennai 600058",
    notes: "MS/SS fabrication — balcony grills, staircase railings, ACP frames. Holds raw and finished fabricated lots.",
  },
];

// ---------------------------------------------------------------------------
// Stock plan — what each store holds, as a fraction of this project's demand
// for that material. A value above 1 means the whole requirement is already
// bought and sitting there. Materials absent from this list are deliberately
// not stocked: ready-mix, piling, formwork hire, roads, STP/WTP/DG/transformer,
// clubhouse fit-out and the other subcontracted packages arrive as works, not
// as stores — which is exactly why they dominate the "still to buy" list.
// ---------------------------------------------------------------------------
type PlanRow = {
  code: string;
  /** fraction of project demand held, per warehouse */
  at: Partial<Record<WhCode, number>>;
  /** reorder level as a fraction of the held quantity (>= 1 reads as "low") */
  min?: number;
  bin?: Partial<Record<WhCode, string>>;
  /** how much has already been issued out, as a multiple of what is left */
  burn?: number;
};

const PLAN: PlanRow[] = [
  // ---- structure & shell ---------------------------------------------------
  { code: "IN-TMT-FE500", at: { "WH-CEN": 0.07, "WH-SITE": 0.04 }, min: 1.05, burn: 1.6, bin: { "WH-CEN": "Rack A1–A6 (bundled by dia)", "WH-SITE": "Cutting yard, Gate 2" } },
  { code: "IN-AAC-200", at: { "WH-SITE": 0.18, "WH-CEN": 0.06 }, min: 1.1, burn: 1.4, bin: { "WH-SITE": "Open stack B, Tower A side", "WH-CEN": "Bay 3" } },
  { code: "IN-AAC-100", at: { "WH-SITE": 0.16, "WH-CEN": 0.05 }, min: 0.6, burn: 1.3, bin: { "WH-SITE": "Open stack C", "WH-CEN": "Bay 3" } },
  { code: "IN-PLASTER-INT", at: { "WH-SITE": 0.08 }, min: 0.5, burn: 1.1, bin: { "WH-SITE": "Cement shed (covered)" } },
  { code: "IN-PLASTER-EXT", at: { "WH-SITE": 0.1 }, min: 0.4, burn: 0.8, bin: { "WH-SITE": "Cement shed (covered)" } },

  // ---- tiling & wet-area finishes -----------------------------------------
  { code: "IN-VITRIFIED", at: { "WH-GODOWN": 0.22, "WH-SITE": 0.08, "WH-CEN": 0.04 }, min: 0.35, burn: 0.7, bin: { "WH-GODOWN": "Row 4, pallets 18–41", "WH-SITE": "Store shed, rack 2", "WH-CEN": "Covered bay 7" } },
  { code: "IN-CERAMIC-WALL", at: { "WH-GODOWN": 0.18, "WH-SITE": 0.07, "WH-CEN": 0.03 }, min: 0.35, burn: 0.8, bin: { "WH-GODOWN": "Row 5", "WH-SITE": "Store shed, rack 3", "WH-CEN": "Covered bay 7" } },
  { code: "IN-ANTISKID", at: { "WH-GODOWN": 0.25, "WH-SITE": 0.1 }, min: 0.3, burn: 0.7, bin: { "WH-GODOWN": "Row 5, pallets 9–16" } },
  { code: "IN-SKIRTING", at: { "WH-GODOWN": 0.3, "WH-SITE": 0.1 }, min: 0.3, burn: 0.6, bin: { "WH-GODOWN": "Row 6 (boxed)" } },
  { code: "IN-WOOD-LAM", at: { "WH-GODOWN": 0.2 }, min: 0.3, burn: 0.4, bin: { "WH-GODOWN": "Row 7 — dry corner, off the floor" } },
  { code: "IN-GRANITE", at: { "WH-GODOWN": 1.04 }, min: 0.2, burn: 0.3, bin: { "WH-GODOWN": "Slab rack, east wall" } },

  // ---- paint & ceiling -----------------------------------------------------
  { code: "IN-PUTTY", at: { "WH-SITE": 0.12, "WH-TWRB": 0.02 }, min: 1.15, burn: 1.5, bin: { "WH-SITE": "Paint store (locked)" } },
  { code: "IN-EMULSION-INT", at: { "WH-SITE": 0.1, "WH-TWRB": 0.03 }, min: 0.45, burn: 1.2, bin: { "WH-SITE": "Paint store (locked)", "WH-TWRB": "B-404, room 1" } },
  { code: "IN-EMULSION-EXT", at: { "WH-SITE": 0.15 }, min: 0.4, burn: 0.9, bin: { "WH-SITE": "Paint store (locked)" } },
  { code: "IN-GYPSUM-CEIL", at: { "WH-SITE": 0.15, "WH-TWRB": 0.06 }, min: 0.4, burn: 0.7, bin: { "WH-SITE": "Store shed, rack 6 (flat, on dunnage)" } },

  // ---- joinery -------------------------------------------------------------
  { code: "IN-WINDOW-UPVC", at: { "WH-GODOWN": 0.22, "WH-SITE": 0.06 }, min: 0.3, burn: 0.6, bin: { "WH-GODOWN": "Joinery bay, A-frames 1–6" } },
  { code: "IN-DOOR-MAIN", at: { "WH-GODOWN": 0.45 }, min: 0.25, burn: 0.35, bin: { "WH-GODOWN": "Joinery bay, racked flat" } },
  { code: "IN-DOOR-INT", at: { "WH-GODOWN": 0.4, "WH-SITE": 0.05 }, min: 0.3, burn: 0.5, bin: { "WH-GODOWN": "Joinery bay, racks 3–8" } },
  { code: "IN-DOOR-TOILET", at: { "WH-GODOWN": 0.9, "WH-SITE": 0.14 }, min: 0.25, burn: 0.4, bin: { "WH-GODOWN": "Joinery bay, racks 9–12" } },
  { code: "IN-WARDROBE", at: { "WH-GODOWN": 0.25 }, min: 0.3, burn: 0.3, bin: { "WH-GODOWN": "Row 9 — flat-pack cartons" } },
  { code: "IN-MOD-KITCHEN", at: { "WH-GODOWN": 0.22 }, min: 0.3, burn: 0.3, bin: { "WH-GODOWN": "Row 9" } },
  { code: "IN-RAILING-SS", at: { "WH-FAB": 0.25, "WH-SITE": 0.05 }, min: 0.4, burn: 0.5, bin: { "WH-FAB": "Finished-goods bay" } },
  { code: "IN-BALCONY-GRILL", at: { "WH-FAB": 0.82, "WH-SITE": 0.24 }, min: 0.35, burn: 0.45, bin: { "WH-FAB": "Finished-goods bay", "WH-SITE": "Open stack D" } },

  // ---- plumbing & sanitary -------------------------------------------------
  { code: "IN-SANWARE", at: { "WH-GODOWN": 0.28, "WH-SITE": 0.1 }, min: 1.08, burn: 0.5, bin: { "WH-GODOWN": "Row 2 — cartons, do not double-stack" } },
  { code: "IN-CP-FITTING", at: { "WH-GODOWN": 0.35 }, min: 0.3, burn: 0.5, bin: { "WH-GODOWN": "Strongroom (high value)" } },
  { code: "IN-SINK-KIT", at: { "WH-GODOWN": 1.05 }, min: 0.25, burn: 0.3, bin: { "WH-GODOWN": "Row 2" } },
  { code: "IN-WH-GEYSER", at: { "WH-GODOWN": 1.03 }, min: 0.25, burn: 0.25, bin: { "WH-GODOWN": "Row 3 — cartons" } },
  { code: "IN-CPVC-SET", at: { "WH-SITE": 0.22, "WH-TWRB": 0.08 }, min: 0.35, burn: 1.1, bin: { "WH-SITE": "Pipe rack, north wall" } },
  { code: "IN-WP-WET", at: { "WH-SITE": 0.3 }, min: 0.4, burn: 0.9, bin: { "WH-SITE": "Chemical store (bunded)" } },
  { code: "IN-WP-TERRACE", at: { "WH-SITE": 0.2, "WH-CEN": 0.05 }, min: 0.4, burn: 1.0, bin: { "WH-SITE": "Chemical store (bunded)", "WH-CEN": "Chemical store" } },

  // ---- electrical & ELV ----------------------------------------------------
  { code: "IN-ELEC-POINT", at: { "WH-SITE": 0.25, "WH-TWRB": 0.05, "WH-CEN": 0.04 }, min: 0.4, burn: 1.2, bin: { "WH-SITE": "Store shed, bins E1–E9", "WH-CEN": "Bin store, shelf 4" } },
  { code: "IN-ELEC-DB", at: { "WH-SITE": 1.07 }, min: 0.2, burn: 0.3, bin: { "WH-SITE": "Store shed, locked cage" } },
  { code: "IN-AC-PROV", at: { "WH-SITE": 1.05 }, min: 0.25, burn: 0.35, bin: { "WH-SITE": "Store shed, bins E10–E14" } },
  { code: "IN-ELV-POINT", at: { "WH-SITE": 0.3 }, min: 0.3, burn: 0.6, bin: { "WH-SITE": "Store shed, locked cage" } },
  { code: "IN-EXHAUST-FAN", at: { "WH-GODOWN": 1.05 }, min: 0.25, burn: 0.3, bin: { "WH-GODOWN": "Row 3" } },
  { code: "IN-NAMEPLATE-BELL", at: { "WH-GODOWN": 1.06 }, min: 0.2, burn: 0.1, bin: { "WH-GODOWN": "Strongroom (high value)" } },
  { code: "IN-CURTAIN-ROD", at: { "WH-GODOWN": 1.04 }, min: 0.2, burn: 0.2, bin: { "WH-GODOWN": "Row 8" } },

  // ---- facade, lifts, misc -------------------------------------------------
  { code: "IN-ACP", at: { "WH-FAB": 0.3, "WH-SITE": 0.08 }, min: 0.35, burn: 0.5, bin: { "WH-FAB": "Sheet rack (interleaved)" } },
  { code: "IN-STONE-CLAD", at: { "WH-GODOWN": 0.35 }, min: 0.3, burn: 0.4, bin: { "WH-GODOWN": "Slab rack, west wall" } },
  { code: "IN-LIFT-8P", at: { "WH-SITE": 1.0 }, min: 0.25, burn: 0, bin: { "WH-SITE": "Lift lobby, Towers A & C — crated" } },
  { code: "IN-LIFT-13P", at: { "WH-SITE": 1.0 }, min: 0.25, burn: 0, bin: { "WH-SITE": "Lift lobby, Tower B — crated" } },
  { code: "IN-FIRE-FLAT", at: { "WH-SITE": 0.3 }, min: 0.35, burn: 0.6, bin: { "WH-SITE": "Store shed, rack 8" } },
  { code: "IN-DECK-COAT", at: { "WH-SITE": 0.15 }, min: 0.35, burn: 0.4, bin: { "WH-SITE": "Chemical store (bunded)" } },
  { code: "IN-PAVER", at: { "WH-SITE": 0.2, "WH-CEN": 0.08 }, min: 0.3, burn: 0.5, bin: { "WH-SITE": "Open stack E, near Gate 1", "WH-CEN": "Open yard, north fence" } },
];

// ---------------------------------------------------------------------------
// Reservations — stock that physically exists but is already spoken for.
// `share` is a fraction of that stock line's on-hand quantity; `own: false`
// belongs to the other project, so this project can't count it as available.
// ---------------------------------------------------------------------------
const RESERVATIONS: Array<{ code: string; wh: WhCode; share: number; own?: boolean; note: string }> = [
  { code: "IN-TMT-FE500", wh: "WH-SITE", share: 0.45, note: "Blocked for Tower C raft & pile-cap pour — week 40 schedule" },
  { code: "IN-LIFT-8P", wh: "WH-SITE", share: 0.5, note: "Tower A shafts 1 & 2 — OTIS erection crew mobilises 05-Oct" },
  { code: "IN-SANWARE", wh: "WH-GODOWN", share: 0.4, note: "Tower A handover flats (A-101 … A-308) — do not divert" },
  { code: "IN-VITRIFIED", wh: "WH-GODOWN", share: 0.3, note: "Tower A floors 1–3 — dye lot matched, keep the batch together" },
  { code: "IN-WINDOW-UPVC", wh: "WH-GODOWN", share: 0.28, note: "Tower B levels 5–6 — glazing gang already mobilised" },
  { code: "IN-WARDROBE", wh: "WH-GODOWN", share: 0.3, note: "Sample flat + first 12 Tower A handover units" },
  { code: "IN-DOOR-TOILET", wh: "WH-GODOWN", share: 0.25, note: "Tower A & B toilet-door fixing, October cycle" },
  { code: "IN-CP-FITTING", wh: "WH-GODOWN", share: 0.3, note: "Held against Tower A snagging & handover" },
  // --- another live project competing for the same yard stock ---
  { code: "IN-TMT-FE500", wh: "WH-CEN", share: 0.3, own: false, note: "Thuniv Paradise — Block B slab cycle, lifted weekly" },
  { code: "IN-VITRIFIED", wh: "WH-GODOWN", share: 0.16, own: false, note: "Thuniv Paradise — clubhouse & lobby flooring" },
  { code: "IN-CERAMIC-WALL", wh: "WH-GODOWN", share: 0.2, own: false, note: "Thuniv Paradise — toilet dado, Block A" },
  { code: "IN-AAC-200", wh: "WH-CEN", share: 0.35, own: false, note: "Thuniv Paradise — external walls, Block C" },
];

// ---------------------------------------------------------------------------
type Movement = {
  warehouseId: string;
  materialId: string;
  stockItemId: string;
  type: "RECEIPT" | "ISSUE" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT";
  quantity: number;
  uom: string;
  unitCost: number;
  projectId: string | null;
  nodeId: string | null;
  reference: string | null;
  note: string | null;
  createdAt: Date;
};

let grnSeq = 1180;
let mirSeq = 2400;
let poSeq = 40;
let trfSeq = 0;

/**
 * Physical verification happens on fixed count days, not whenever — so every
 * correction carries the same sheet number as the rest of that day's count.
 */
const COUNT_DAYS = [118, 87, 56, 25].map((d, i) => ({
  daysAgo: d,
  sheet: `STK-CC-${String(2604 + i * 3).padStart(4, "0")}`,
}));

async function main() {
  const project = await prisma.project.findUnique({ where: { code: PROJECT_CODE } });
  if (!project) {
    throw new Error(
      `Project ${PROJECT_CODE} not found — run "npx tsx prisma/seed-silversands.ts" first, then this script.`,
    );
  }
  const otherProject = await prisma.project.findUnique({ where: { code: OTHER_PROJECT_CODE } });

  // ---- 1. demand: roll up the BOM exactly as the API does -------------------
  const nodes = await prisma.node.findMany({
    where: { projectId: project.id },
    include: { bomLines: true },
  });
  const demand = materialDemand(nodes as never);
  console.log(`rolled up ${nodes.length} nodes → demand for ${demand.byMaterial.size} materials`);

  const materials = await prisma.material.findMany();
  const matByCode = new Map(materials.map((m) => [m.code, m]));
  const matById = new Map(materials.map((m) => [m.id, m]));

  // which nodes actually consume a given material — so issues are booked to a
  // real part of the tree instead of an invented one
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodePath = new Map<string, string>();
  const pathOf = (id: string): string => {
    const cached = nodePath.get(id);
    if (cached) return cached;
    const parts: string[] = [];
    let cur = nodeById.get(id);
    let guard = 0;
    while (cur && guard++ < 50) {
      parts.unshift(cur.name);
      cur = cur.parentId ? nodeById.get(cur.parentId) : undefined;
    }
    const p = parts.join(" / ");
    nodePath.set(id, p);
    return p;
  };
  const consumersOf = new Map<string, string[]>();
  for (const n of nodes) {
    for (const l of n.bomLines) {
      if (!l.materialId || l.kind !== "MATERIAL") continue;
      const arr = consumersOf.get(l.materialId);
      if (arr) arr.push(n.id);
      else consumersOf.set(l.materialId, [n.id]);
    }
  }

  // preferred supplier per material, for readable GRN notes
  const links = await prisma.materialSupplier.findMany({
    where: { preferred: true },
    include: { supplier: { select: { name: true } } },
  });
  const supplierOf = new Map(links.map((l) => [l.materialId, l.supplier.name]));

  // ---- 2. warehouses: replace the ones this seed owns -----------------------
  const codes = WAREHOUSES.map((w) => w.code);
  const existing = await prisma.warehouse.findMany({ where: { code: { in: codes } } });
  if (existing.length) {
    console.log(`replacing ${existing.length} existing warehouse(s): ${existing.map((w) => w.code).join(", ")}`);
    await prisma.warehouse.deleteMany({ where: { code: { in: codes } } });
  }
  const whId = new Map<WhCode, string>();
  for (const w of WAREHOUSES) {
    const rec = await prisma.warehouse.create({ data: w });
    whId.set(w.code, rec.id);
  }
  console.log(`created ${WAREHOUSES.length} warehouses`);

  // ---- 3. stock lines -------------------------------------------------------
  type Line = {
    id: string;
    code: string;
    wh: WhCode;
    materialId: string;
    uom: string;
    onHand: number;
    minLevel: number;
    unitCost: number;
    binLocation: string | null;
    burn: number;
  };
  const lines: Line[] = [];

  for (const row of PLAN) {
    const mat = matByCode.get(row.code);
    if (!mat) {
      console.warn(`  ! unknown material ${row.code} — skipped`);
      continue;
    }
    const d = demand.byMaterial.get(mat.id);
    if (!d) {
      console.warn(`  ! ${row.code} is not in this project's BOM — skipped`);
      continue;
    }
    for (const [wh, frac] of Object.entries(row.at) as Array<[WhCode, number]>) {
      const onHand = roundQty(mat.uom, d.required * frac);
      if (onHand <= 0) continue;
      lines.push({
        id: "",
        code: row.code,
        wh,
        materialId: mat.id,
        uom: mat.uom,
        onHand,
        minLevel: roundQty(mat.uom, onHand * (row.min ?? 0.3)),
        // last landed cost drifts a little from the catalog rate
        unitCost: Math.round(mat.unitCost * rand(0.94, 1.05)),
        binLocation: row.bin?.[wh] ?? null,
        burn: row.burn ?? 0.6,
      });
    }
  }

  for (const l of lines) {
    const rec = await prisma.stockItem.create({
      data: {
        warehouseId: whId.get(l.wh)!,
        materialId: l.materialId,
        onHand: l.onHand,
        reserved: 0,
        minLevel: l.minLevel,
        binLocation: l.binLocation,
        uom: l.uom,
        unitCost: l.unitCost,
      },
    });
    l.id = rec.id;
  }
  console.log(`created ${lines.length} stock lines across ${whId.size} warehouses`);

  // ---- 4. the ledger behind those balances ---------------------------------
  const movements: Movement[] = [];

  // yard → site transfers, only where both ends hold the material
  const transferIn = new Map<string, number>();
  const transferOut = new Map<string, number>();
  const pairs: Array<{ from: Line; to: Line; qty: number }> = [];
  for (const from of lines) {
    if (from.wh !== "WH-CEN") continue;
    const to = lines.find((l) => l.code === from.code && (l.wh === "WH-SITE" || l.wh === "WH-TWRB"));
    if (!to) continue;
    const qty = roundQty(from.uom, from.onHand * rand(0.25, 0.55));
    if (qty <= 0) continue;
    pairs.push({ from, to, qty });
    transferOut.set(from.id, qty);
    transferIn.set(to.id, qty);
  }

  for (const line of lines) {
    const mat = matById.get(line.materialId)!;
    const supplier = supplierOf.get(line.materialId);
    const consumers = consumersOf.get(line.materialId) ?? [];
    const tOut = transferOut.get(line.id) ?? 0;
    const tIn = transferIn.get(line.id) ?? 0;

    // how much has already been consumed out of this store
    let issuedTotal = line.onHand <= 6 ? 0 : roundQty(mat.uom, line.onHand * line.burn * rand(0.8, 1.2));
    // a stock-take correction on roughly a third of the lines
    const adjust =
      line.onHand > 40 && rng() < 0.33
        ? roundQty(mat.uom, line.onHand * rand(0.004, 0.02)) * (rng() < 0.7 ? -1 : 1)
        : 0;

    // receipts have to cover everything that left, plus what is still there
    let receiptTotal = line.onHand + issuedTotal + tOut - tIn - adjust;
    while (receiptTotal <= 0 && issuedTotal > 0) {
      issuedTotal = issuedTotal > 1 ? roundQty(mat.uom, issuedTotal / 2) : 0;
      receiptTotal = line.onHand + issuedTotal + tOut - tIn - adjust;
    }
    if (receiptTotal <= 0) continue;

    // --- receipts: 1–4 deliveries against a PO, oldest first ---
    const nReceipts = line.onHand <= 6 ? 1 : receiptTotal > 40 ? 2 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 2);
    const weights = Array.from({ length: nReceipts }, () => rand(0.6, 1.4));
    const wSum = weights.reduce((a, b) => a + b, 0);
    const po = `PO-SSR-${String(++poSeq).padStart(4, "0")}`;
    const firstDay = rand(150, 205);

    const receipts: Array<{ qty: number; at: Date; unitCost: number }> = [];
    let assigned = 0;
    for (let i = 0; i < nReceipts; i++) {
      const isLast = i === nReceipts - 1;
      const qty = isLast ? receiptTotal - assigned : roundQty(mat.uom, (receiptTotal * weights[i]!) / wSum);
      if (qty <= 0) continue;
      assigned += qty;
      const spread = nReceipts === 1 ? 0 : i / (nReceipts - 1);
      const day = firstDay - (firstDay - 4) * spread * rand(0.85, 1);
      receipts.push({
        qty,
        at: daysAgo(day),
        // prices crept up over the year — the earlier lots are cheaper
        unitCost: Math.round(line.unitCost * (0.9 + 0.1 * spread) * rand(0.99, 1.02)),
      });
    }
    if (!receipts.length) continue;
    receipts.sort((a, b) => a.at.getTime() - b.at.getTime());

    for (const r of receipts) {
      movements.push({
        warehouseId: whId.get(line.wh)!,
        materialId: line.materialId,
        stockItemId: line.id,
        type: "RECEIPT",
        quantity: r.qty,
        uom: line.uom,
        unitCost: r.unitCost,
        projectId: project.id,
        nodeId: null,
        reference: `GRN-SSR-${String(++grnSeq).padStart(4, "0")}`,
        note: `${supplier ? supplier + " · " : ""}against ${po} · DC ${100000 + Math.floor(rng() * 899999)} · tallied at gate`,
        createdAt: r.at,
      });
    }

    // --- withdrawals: issues to the tree, plus the transfer out --------------
    const withdrawals: Array<{ qty: number; kind: "ISSUE" | "TRANSFER_OUT" }> = [];
    if (issuedTotal > 0) {
      const nIssues = Math.min(5, Math.max(1, Math.round(issuedTotal / Math.max(1, line.onHand * 0.4))));
      let left = issuedTotal;
      for (let i = 0; i < nIssues - 1; i++) {
        const qty = roundQty(mat.uom, (issuedTotal / nIssues) * rand(0.7, 1.3));
        if (qty <= 0 || qty >= left) continue;
        left -= qty;
        withdrawals.push({ qty, kind: "ISSUE" });
      }
      if (left > 0) withdrawals.push({ qty: left, kind: "ISSUE" });
    }
    if (tOut > 0) withdrawals.push({ qty: tOut, kind: "TRANSFER_OUT" });

    // place each withdrawal in the earliest interval where the balance covers
    // it, so the running balance is never negative
    let balance = 0;
    let ri = 0;
    for (const w of withdrawals) {
      while (ri < receipts.length && balance < w.qty) balance += receipts[ri++]!.qty;
      const after = receipts[Math.max(0, ri - 1)]!.at;
      const before = receipts[ri]?.at ?? NOW;
      const span = Math.max(3600000, before.getTime() - after.getTime());
      const at = new Date(after.getTime() + span * rand(0.15, 0.9));
      balance -= w.qty;

      if (w.kind === "TRANSFER_OUT") {
        const pair = pairs.find((p) => p.from.id === line.id)!;
        const ref = `TRF-SSR-${String(++trfSeq).padStart(4, "0")}`;
        const lorry = `TN 07 ${String.fromCharCode(65 + Math.floor(rng() * 26))}${String.fromCharCode(65 + Math.floor(rng() * 26))} ${1000 + Math.floor(rng() * 8999)}`;
        movements.push({
          warehouseId: whId.get(line.wh)!,
          materialId: line.materialId,
          stockItemId: line.id,
          type: "TRANSFER_OUT",
          quantity: w.qty,
          uom: line.uom,
          unitCost: line.unitCost,
          projectId: project.id,
          nodeId: null,
          reference: ref,
          note: `Yard → ${WAREHOUSES.find((x) => x.code === pair.to.wh)!.name} · lorry ${lorry}`,
          createdAt: at,
        });
        movements.push({
          warehouseId: whId.get(pair.to.wh)!,
          materialId: line.materialId,
          stockItemId: pair.to.id,
          type: "TRANSFER_IN",
          quantity: w.qty,
          uom: line.uom,
          unitCost: line.unitCost,
          projectId: project.id,
          nodeId: null,
          reference: ref,
          note: `Received from ${WAREHOUSES.find((x) => x.code === line.wh)!.name} · lorry ${lorry}`,
          createdAt: new Date(at.getTime() + 3 * 3600000),
        });
      } else {
        const nodeId = consumers.length ? pick(consumers) : null;
        const seg = nodeId ? pathOf(nodeId).split(" / ") : [];
        const context = [seg[0], seg.find((s) => /^Floor/.test(s))].filter(Boolean).join(" · ");
        movements.push({
          warehouseId: whId.get(line.wh)!,
          materialId: line.materialId,
          stockItemId: line.id,
          type: "ISSUE",
          quantity: w.qty,
          uom: line.uom,
          unitCost: line.unitCost,
          projectId: project.id,
          nodeId,
          reference: `MIR-${String(++mirSeq).padStart(4, "0")}`,
          note: context ? `Issued to ${context} · signed by site engineer` : "Issued to site",
          createdAt: at,
        });
      }
    }

    // --- the stock-take correction, booked on a count day --------------------
    if (adjust !== 0) {
      const firstReceiptDay = (NOW.getTime() - receipts[0]!.at.getTime()) / 86400000;
      const usable = COUNT_DAYS.filter((c) => c.daysAgo < firstReceiptDay - 2);
      const count = usable.length ? pick(usable) : null;
      if (count) {
        const at = daysAgo(count.daysAgo);
        // a short count pulls every later balance down with it, so it can only
        // be booked if the line had that much headroom from the count day on
        const mine = movements
          .filter((m) => m.stockItemId === line.id)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        let running = 0;
        let headroom = Infinity;
        for (const m of mine) {
          running += m.type === "ISSUE" || m.type === "TRANSFER_OUT" ? -m.quantity : m.quantity;
          if (m.createdAt >= at) headroom = Math.min(headroom, running);
        }
        headroom = Math.min(headroom, running); // and the closing balance
        if (headroom + adjust >= 0) {
          movements.push({
            warehouseId: whId.get(line.wh)!,
            materialId: line.materialId,
            stockItemId: line.id,
            type: "ADJUSTMENT",
            quantity: adjust,
            uom: line.uom,
            unitCost: line.unitCost,
            projectId: project.id,
            nodeId: null,
            reference: count.sheet,
            note:
              adjust < 0
                ? `Cycle count ${at.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} — short on physical verification (breakage / issue not booked)`
                : `Cycle count ${at.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} — surplus found on physical verification`,
            createdAt: at,
          });
          continue;
        }
      }
      // no usable count day, or the line was too tight to absorb it — fold the
      // variance into the last delivery rather than invent a movement that
      // couldn't have happened. Everything after that delivery only runs down
      // to the closing balance, so this can't drive the line negative.
      const receiptsOfLine = movements.filter((m) => m.stockItemId === line.id && m.type === "RECEIPT");
      receiptsOfLine[receiptsOfLine.length - 1]!.quantity += adjust;
    }
  }

  // --- sanity: the ledger has to land exactly on the on-hand figure ----------
  const ledgerBalance = new Map<string, number>();
  for (const m of movements) {
    const sign = m.type === "RECEIPT" || m.type === "TRANSFER_IN" || m.type === "ADJUSTMENT" ? 1 : -1;
    ledgerBalance.set(m.stockItemId, (ledgerBalance.get(m.stockItemId) ?? 0) + sign * m.quantity);
  }
  for (const l of lines) {
    const got = Math.round((ledgerBalance.get(l.id) ?? 0) * 100) / 100;
    if (Math.abs(got - l.onHand) > 0.01) {
      throw new Error(`ledger/balance mismatch for ${l.code} @ ${l.wh}: ledger ${got} vs on hand ${l.onHand}`);
    }
    // and the running balance must never have gone negative on the way there
    let running = 0;
    const mine = movements
      .filter((m) => m.stockItemId === l.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const m of mine) {
      running += m.type === "ISSUE" || m.type === "TRANSFER_OUT" ? -m.quantity : m.quantity;
      if (running < -0.01) {
        throw new Error(
          `${l.code} @ ${l.wh} goes negative on ${m.createdAt.toISOString().slice(0, 10)} (${m.type} ${m.quantity})`,
        );
      }
    }
  }

  movements.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (let i = 0; i < movements.length; i += 500) {
    await prisma.stockMovement.createMany({ data: movements.slice(i, i + 500) });
  }
  console.log(`wrote ${movements.length} ledger entries (balances verified against on-hand)`);

  // ---- 5. reservations ------------------------------------------------------
  const reservedByLine = new Map<string, number>();
  let reservationCount = 0;
  for (const r of RESERVATIONS) {
    const mat = matByCode.get(r.code);
    const line = lines.find((l) => l.code === r.code && l.wh === r.wh);
    if (!mat || !line) continue;
    const owner = r.own === false ? otherProject : project;
    if (!owner) continue; // the other project isn't seeded — skip quietly

    const free = line.onHand - (reservedByLine.get(line.id) ?? 0);
    const qty = Math.min(roundQty(mat.uom, line.onHand * r.share), free);
    if (qty <= 0) continue;

    // a reservation covers a whole tower's worth of work, so hang it off the
    // tower the note names rather than one arbitrary room
    const tower = r.note.match(/Tower ([ABC])/)?.[1];
    const towerNode = tower ? nodes.find((n) => n.name.startsWith(`Tower ${tower} —`)) : undefined;
    await prisma.stockReservation.create({
      data: {
        stockItemId: line.id,
        warehouseId: whId.get(r.wh)!,
        projectId: owner.id,
        nodeId: owner.id === project.id ? towerNode?.id ?? null : null,
        quantity: qty,
        note: r.note,
      },
    });
    reservedByLine.set(line.id, (reservedByLine.get(line.id) ?? 0) + qty);
    reservationCount++;
  }
  for (const [stockItemId, reserved] of reservedByLine) {
    await prisma.stockItem.update({ where: { id: stockItemId }, data: { reserved } });
  }
  console.log(`created ${reservationCount} reservations`);

  // ---- 6. read it back the way the app will ---------------------------------
  const stockItems = await prisma.stockItem.findMany({ include: { warehouse: true, reservations: true } });
  const stock: StockRow[] = stockItems.map((s) => ({
    warehouseId: s.warehouseId,
    warehouseCode: s.warehouse.code,
    warehouseName: s.warehouse.name,
    materialId: s.materialId,
    onHand: s.onHand,
    reserved: s.reserved,
    reservedForProject: s.reservations.filter((r) => r.projectId === project.id).reduce((t, r) => t + r.quantity, 0),
    minLevel: s.minLevel,
    binLocation: s.binLocation,
    unitCost: s.unitCost,
  }));
  const matMap = new Map(materials.map((m) => [m.id, { code: m.code, name: m.name, uom: m.uom, unitCost: m.unitCost }]));
  const rows = availability(demand, stock, matMap);

  const inr = (n: number) =>
    n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n)}`;
  const requiredValue = rows.reduce((t, r) => t + r.required * r.unitCost, 0);
  const shortfallValue = rows.reduce((t, r) => t + r.shortfallValue, 0);
  const stockValue = stockItems.reduce((t, s) => t + s.onHand * s.unitCost, 0);
  const low = stockItems.filter((s) => s.minLevel > 0 && s.onHand <= s.minLevel).length;

  console.log(`\ndone: inventory for ${project.code} "${project.name}"`);
  console.log(
    `  ${WAREHOUSES.length} warehouses · ${lines.length} stock lines · ${movements.length} movements · ${reservationCount} reservations`,
  );
  console.log(`  stock on hand valued at ${inr(stockValue)} · ${low} line(s) at or below reorder level`);
  console.log(
    `  BOM demand ${inr(requiredValue)} · already covered by stock ${inr(requiredValue - shortfallValue)} · still to buy ${inr(shortfallValue)}`,
  );
  console.log(
    `  coverage: ${rows.filter((r) => r.status === "covered").length} covered · ${rows.filter((r) => r.status === "partial").length} partial · ${rows.filter((r) => r.status === "none").length} nothing in stock`,
  );
  console.log("\n  top of the buying list:");
  for (const r of rows.slice(0, 8)) {
    console.log(
      `    ${r.materialCode.padEnd(18)} short ${String(Math.round(r.shortfall)).padStart(9)} ${r.uom.padEnd(5)} = ${inr(r.shortfallValue)}`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
