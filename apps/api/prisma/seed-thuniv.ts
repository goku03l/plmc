/**
 * Sample project seed — "Thuniv Paradise", a residential development in Chennai.
 *
 *   3 towers · 8 floors each · 10 apartments / floor
 *   Tower 1 (Marina)     – 2 BHK · 10 per floor · 80 apartments
 *   Tower 2 (Coromandel) – 4 BHK ·  6 per floor · 48 apartments
 *   Tower 3 (Adyar)      – 2 BHK · 10 per floor · 80 apartments
 *   + basement/podium parking, clubhouse, pool, gym, and full site infrastructure.
 *
 * Run:  npm run -w @plmc/api exec -- tsx prisma/seed-thuniv.ts
 *   or: cd apps/api && npx tsx prisma/seed-thuniv.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PROJECT_CODE = "THU-001";

type Mat = { code: string; name: string; category: string; uom: string; unitCost: number; wastagePct: number };

// ---------------------------------------------------------------------------
// Material catalog (₹, Indian residential construction, indicative 2026 rates)
// ---------------------------------------------------------------------------
const MATERIALS: Mat[] = [
  // --- structure / concrete ---
  { code: "IN-EXC-EARTH", name: "Earthwork excavation in soil / soft rock", category: "Earthwork", uom: "m3", unitCost: 180, wastagePct: 0 },
  { code: "IN-PCC-148", name: "PCC 1:4:8 levelling course", category: "Concrete", uom: "m3", unitCost: 5200, wastagePct: 2 },
  { code: "IN-PILE-600", name: "Bored cast-in-situ pile Ø600 (incl. reinforcement)", category: "Concrete", uom: "rmt", unitCost: 3400, wastagePct: 2 },
  { code: "IN-RMC-M30", name: "Ready-mix concrete M30, pumped & placed", category: "Concrete", uom: "m3", unitCost: 6600, wastagePct: 2 },
  { code: "IN-RMC-M25", name: "Ready-mix concrete M25, pumped & placed", category: "Concrete", uom: "m3", unitCost: 6100, wastagePct: 2 },
  { code: "IN-TMT-FE500", name: "TMT reinforcement steel Fe500D", category: "Steel", uom: "kg", unitCost: 68, wastagePct: 3 },
  { code: "IN-FORMWORK", name: "Formwork / shuttering (ply + props), per contact area", category: "Formwork", uom: "m2", unitCost: 260, wastagePct: 0 },
  // --- masonry & plaster ---
  { code: "IN-AAC-200", name: "AAC block masonry 200 mm (external walls)", category: "Masonry", uom: "m2", unitCost: 980, wastagePct: 4 },
  { code: "IN-AAC-100", name: "AAC block masonry 100 mm (internal partitions)", category: "Masonry", uom: "m2", unitCost: 640, wastagePct: 4 },
  { code: "IN-PLASTER-INT", name: "Cement plaster 12 mm, internal", category: "Plaster", uom: "m2", unitCost: 255, wastagePct: 8 },
  { code: "IN-PLASTER-EXT", name: "Cement plaster 18 mm, external (two-coat)", category: "Plaster", uom: "m2", unitCost: 340, wastagePct: 8 },
  { code: "IN-PUTTY", name: "Wall putty, two coats", category: "Finishes", uom: "m2", unitCost: 62, wastagePct: 10 },
  // --- finishes ---
  { code: "IN-VITRIFIED", name: "Vitrified floor tile 800×800 (double-charge)", category: "Finishes", uom: "m2", unitCost: 1150, wastagePct: 8 },
  { code: "IN-CERAMIC-WALL", name: "Glazed ceramic wall tile", category: "Finishes", uom: "m2", unitCost: 820, wastagePct: 8 },
  { code: "IN-ANTISKID", name: "Anti-skid ceramic floor tile (wet areas)", category: "Finishes", uom: "m2", unitCost: 760, wastagePct: 8 },
  { code: "IN-WOOD-LAM", name: "Laminated wooden flooring (master bedroom)", category: "Finishes", uom: "m2", unitCost: 2200, wastagePct: 6 },
  { code: "IN-EMULSION-INT", name: "Acrylic emulsion paint, interior (primer + 2 coats)", category: "Finishes", uom: "m2", unitCost: 92, wastagePct: 10 },
  { code: "IN-EMULSION-EXT", name: "Exterior emulsion, textured (primer + 2 coats)", category: "Finishes", uom: "m2", unitCost: 155, wastagePct: 10 },
  { code: "IN-GYPSUM-CEIL", name: "Gypsum board false ceiling on GI frame", category: "Finishes", uom: "m2", unitCost: 880, wastagePct: 8 },
  { code: "IN-GRANITE", name: "Granite counter (kitchen / vanity), 18 mm", category: "Finishes", uom: "rft", unitCost: 850, wastagePct: 5 },
  { code: "IN-MOD-KITCHEN", name: "Modular kitchen — base & wall units, hardware", category: "Finishes", uom: "rft", unitCost: 2400, wastagePct: 0 },
  { code: "IN-DECK-COAT", name: "Parking-deck epoxy / PU coating + line marking", category: "Finishes", uom: "m2", unitCost: 520, wastagePct: 5 },
  // --- joinery ---
  { code: "IN-DOOR-MAIN", name: "Main door — teak frame + veneer shutter + hardware", category: "Joinery", uom: "nos", unitCost: 24000, wastagePct: 0 },
  { code: "IN-DOOR-INT", name: "Internal door — WPC frame + flush shutter + hardware", category: "Joinery", uom: "nos", unitCost: 7800, wastagePct: 0 },
  { code: "IN-DOOR-TOILET", name: "Toilet door — WPC frame + PVC-laminate shutter", category: "Joinery", uom: "nos", unitCost: 6200, wastagePct: 0 },
  { code: "IN-WINDOW-UPVC", name: "uPVC 2-track sliding window + 5 mm float glass + mesh", category: "Joinery", uom: "m2", unitCost: 6800, wastagePct: 3 },
  { code: "IN-RAILING-SS", name: "SS 304 railing + toughened glass (balcony / stair)", category: "Joinery", uom: "rmt", unitCost: 5200, wastagePct: 2 },
  // --- waterproofing ---
  { code: "IN-WP-WET", name: "Wet-area waterproofing — crystalline + APP membrane", category: "Waterproofing", uom: "m2", unitCost: 560, wastagePct: 5 },
  { code: "IN-WP-TERRACE", name: "Terrace / tanking waterproofing — brickbat coba + membrane", category: "Waterproofing", uom: "m2", unitCost: 720, wastagePct: 5 },
  // --- plumbing & sanitary ---
  { code: "IN-CPVC-SET", name: "CPVC/UPVC supply + PVC drainage, per fixture point", category: "Plumbing", uom: "point", unitCost: 1650, wastagePct: 3 },
  { code: "IN-SANWARE", name: "Sanitaryware set — WC, wash basin, health faucet (mid-range)", category: "Plumbing", uom: "set", unitCost: 16500, wastagePct: 0 },
  { code: "IN-CP-FITTING", name: "CP fittings per toilet — diverter, shower, taps, accessories", category: "Plumbing", uom: "set", unitCost: 9500, wastagePct: 0 },
  { code: "IN-SINK-KIT", name: "SS kitchen sink (double bowl) + drainboard + faucet", category: "Plumbing", uom: "set", unitCost: 8500, wastagePct: 0 },
  { code: "IN-WH-GEYSER", name: "Storage water heater 15 L + plumbing", category: "Plumbing", uom: "nos", unitCost: 7200, wastagePct: 0 },
  // --- electrical & ELV ---
  { code: "IN-ELEC-POINT", name: "Wiring point — FRLS cable in conduit + modular accessory", category: "Electrical", uom: "point", unitCost: 880, wastagePct: 3 },
  { code: "IN-ELEC-DB", name: "Flat distribution board + MCB/RCCB + earthing", category: "Electrical", uom: "nos", unitCost: 6800, wastagePct: 0 },
  { code: "IN-AC-PROV", name: "Split-AC provision — copper piping, drain, power point", category: "Electrical", uom: "nos", unitCost: 3600, wastagePct: 0 },
  { code: "IN-ELV-POINT", name: "ELV point — TV / data / video door phone", category: "Electrical", uom: "point", unitCost: 1400, wastagePct: 3 },
  // --- fire fighting ---
  { code: "IN-FIRE-FLAT", name: "Flat fire protection — sprinklers + smoke detector + wiring", category: "Fire Fighting", uom: "nos", unitCost: 9500, wastagePct: 0 },
  { code: "IN-FIRE-SYS", name: "Fire pump room, hydrants, wet riser, panel (project-wide)", category: "Fire Fighting", uom: "LS", unitCost: 6500000, wastagePct: 0 },
  // --- facade / vertical transportation ---
  { code: "IN-ACP", name: "ACP cladding on GI framing (facade feature bands / fins)", category: "Facade", uom: "m2", unitCost: 1450, wastagePct: 5 },
  { code: "IN-STONE-CLAD", name: "Natural stone cladding — entrance / lift lobby", category: "Facade", uom: "m2", unitCost: 1600, wastagePct: 5 },
  { code: "IN-STRUCT-GLAZ", name: "Structural / spider glazing — double-height lobby", category: "Facade", uom: "m2", unitCost: 4200, wastagePct: 3 },
  { code: "IN-LIFT-8P", name: "Passenger lift 8-pax, 8 stops, MRL + auto-rescue device", category: "Vertical Transportation", uom: "nos", unitCost: 2200000, wastagePct: 0 },
  { code: "IN-LIFT-13P", name: "Passenger lift 13-pax, 8 stops, MRL + ARD", category: "Vertical Transportation", uom: "nos", unitCost: 2900000, wastagePct: 0 },
  // --- site infrastructure ---
  { code: "IN-STP", name: "Sewage Treatment Plant 150 KLD (MBBR), incl. civil", category: "Infrastructure", uom: "LS", unitCost: 4200000, wastagePct: 0 },
  { code: "IN-WTP", name: "Water Treatment Plant + softener + hydro-pneumatic system", category: "Infrastructure", uom: "LS", unitCost: 1800000, wastagePct: 0 },
  { code: "IN-RWH-PIT", name: "Rainwater harvesting recharge pit + piping", category: "Infrastructure", uom: "nos", unitCost: 48000, wastagePct: 0 },
  { code: "IN-TRAFO", name: "Package sub-station — transformer 1000 kVA + HT/LT panel", category: "Infrastructure", uom: "nos", unitCost: 3800000, wastagePct: 0 },
  { code: "IN-DG", name: "DG set 750 kVA, acoustic enclosure + AMF panel", category: "Infrastructure", uom: "nos", unitCost: 4500000, wastagePct: 0 },
  { code: "IN-WMM-ROAD", name: "Internal road — GSB + WMM + bituminous surfacing", category: "Infrastructure", uom: "m2", unitCost: 1350, wastagePct: 3 },
  { code: "IN-PAVER", name: "Paver block 80 mm on sand bed (driveways / walkways)", category: "Infrastructure", uom: "m2", unitCost: 680, wastagePct: 5 },
  { code: "IN-COMPOUND", name: "Compound wall — RR masonry + RCC coping + plaster", category: "Infrastructure", uom: "rmt", unitCost: 3900, wastagePct: 3 },
  { code: "IN-STORMDRAIN", name: "Storm-water drain — RCC U-drain + gratings", category: "Infrastructure", uom: "rmt", unitCost: 2400, wastagePct: 3 },
  // --- amenities / landscape ---
  { code: "IN-CLUB-FITOUT", name: "Clubhouse interior fit-out (finishes, FF&E, MEP)", category: "Amenities", uom: "m2", unitCost: 9500, wastagePct: 5 },
  { code: "IN-POOL", name: "Swimming pool — shell, tiling, filtration, deck", category: "Amenities", uom: "m2", unitCost: 13500, wastagePct: 3 },
  { code: "IN-GYM", name: "Gymnasium equipment package + sports flooring", category: "Amenities", uom: "LS", unitCost: 3200000, wastagePct: 0 },
  { code: "IN-PLAY", name: "Children play area — EPDM surfacing + equipment", category: "Amenities", uom: "LS", unitCost: 1500000, wastagePct: 0 },
  { code: "IN-LANDSCAPE", name: "Soft + hard landscape (planting, irrigation, seating)", category: "Landscape", uom: "m2", unitCost: 900, wastagePct: 5 },
];

// ---------------------------------------------------------------------------
// Sub-group (category) definitions
// ---------------------------------------------------------------------------
const CATEGORIES: [string, string, string][] = [
  ["structure", "Structure & RCC", "#64748b"],
  ["masonry", "Masonry & Plaster", "#b45309"],
  ["finishes", "Finishes", "#f59e0b"],
  ["joinery", "Doors, Windows & Joinery", "#8b5cf6"],
  ["waterproofing", "Waterproofing", "#0891b2"],
  ["plumbing", "Plumbing & Sanitary", "#0ea5e9"],
  ["electrical", "Electrical & ELV", "#eab308"],
  ["firefighting", "Fire Fighting", "#dc2626"],
  ["facade", "Facade & Cladding", "#10b981"],
  ["lifts", "Vertical Transportation", "#6366f1"],
  ["infra", "Site Infrastructure", "#a855f7"],
  ["amenities", "Amenities & Clubhouse", "#ec4899"],
  ["landscape", "Landscape & Hardscape", "#65a30d"],
  ["prelims", "Preliminaries & Overheads", "#78716c"],
];

// ---------------------------------------------------------------------------
// Apartment room programmes
// ---------------------------------------------------------------------------
type Room = { name: string; area: number; kind: string };
const ROOMS_2BHK: Room[] = [
  { name: "Living & Dining", area: 22, kind: "living" },
  { name: "Kitchen", area: 8, kind: "kitchen" },
  { name: "Master Bedroom", area: 14, kind: "mbedroom" },
  { name: "Bedroom 2", area: 11, kind: "bedroom" },
  { name: "Master Toilet", area: 3.6, kind: "toilet" },
  { name: "Common Bathroom", area: 4.2, kind: "toilet" },
  { name: "Balcony", area: 5, kind: "balcony" },
  { name: "Utility", area: 2.4, kind: "utility" },
];
const ROOMS_4BHK: Room[] = [
  { name: "Foyer", area: 4, kind: "dry" },
  { name: "Living Room", area: 24, kind: "living" },
  { name: "Dining Room", area: 14, kind: "living" },
  { name: "Kitchen", area: 12, kind: "kitchen" },
  { name: "Master Bedroom", area: 18, kind: "mbedroom" },
  { name: "Bedroom 2", area: 14, kind: "bedroom" },
  { name: "Bedroom 3", area: 13, kind: "bedroom" },
  { name: "Bedroom 4 / Study", area: 11, kind: "bedroom" },
  { name: "Master Toilet", area: 5, kind: "toilet" },
  { name: "Toilet 2", area: 4, kind: "toilet" },
  { name: "Toilet 3", area: 3.6, kind: "toilet" },
  { name: "Powder Room", area: 2, kind: "toilet" },
  { name: "Balcony 1", area: 8, kind: "balcony" },
  { name: "Balcony 2", area: 5, kind: "balcony" },
  { name: "Utility", area: 3, kind: "utility" },
  { name: "Servant Room", area: 7, kind: "dry" },
  { name: "Servant Toilet", area: 2, kind: "toilet" },
];

async function insertMany(model: { createMany: (a: { data: any[] }) => Promise<unknown> }, rows: any[], size = 500) {
  for (let i = 0; i < rows.length; i += size) await model.createMany({ data: rows.slice(i, i + size) });
}

async function main() {
  console.log("seeding Indian material catalog…");
  const matId = new Map<string, string>();
  for (const m of MATERIALS) {
    const rec = await prisma.material.upsert({ where: { code: m.code }, create: m, update: m });
    matId.set(m.code, rec.id);
  }

  const existing = await prisma.project.findUnique({ where: { code: PROJECT_CODE } });
  if (existing) {
    console.log(`project ${PROJECT_CODE} exists — deleting and recreating`);
    await prisma.project.delete({ where: { id: existing.id } });
  }

  console.log("creating project 'Thuniv Paradise'…");
  const project = await prisma.project.create({
    data: {
      code: PROJECT_CODE,
      name: "Thuniv Paradise",
      description:
        "Premium gated residential development on OMR (Rajiv Gandhi Salai), Chennai. Three towers of 8 floors — 208 apartments (2 & 4 BHK) — with basement/podium parking, clubhouse, swimming pool, gymnasium and full site infrastructure (STP, WTP, DG backup, rainwater harvesting).",
      client: "Thuniv Realty Pvt. Ltd.",
      location: "OMR, Chennai, Tamil Nadu, IN",
      currency: "INR",
      status: "ACTIVE",
      categories: { create: CATEGORIES.map(([key, label, color], i) => ({ key, label, color, sortOrder: i })) },
    },
    include: { categories: true },
  });
  const C = Object.fromEntries(project.categories.map((c) => [c.key, c.id])) as Record<string, string>;

  const nodes: any[] = [];
  const lines: any[] = [];
  let ns = 0;
  let ls = 0;

  const N = (name: string, type: string, o: any = {}): string => {
    const id = `THU-N-${String(++ns).padStart(5, "0")}`;
    nodes.push({
      id,
      projectId: project.id,
      name,
      type,
      parentId: o.parent ?? null,
      categoryId: o.cat ?? null,
      quantity: o.qty ?? 1,
      uom: o.uom ?? "ea",
      refCode: o.ref ?? null,
      notes: o.notes ?? null,
      attributes: o.attr ?? {},
      sortOrder: o.sort ?? 0,
    });
    return id;
  };
  const L = (nodeId: string, code: string, qty: number, o: any = {}) => {
    const m = MATERIALS.find((x) => x.code === code);
    if (!m) throw new Error(`unknown material ${code}`);
    const q = Math.round((qty + Number.EPSILON) * 100) / 100;
    lines.push({
      id: `THU-L-${String(++ls).padStart(5, "0")}`,
      nodeId,
      materialId: matId.get(code)!,
      kind: "MATERIAL",
      description: o.desc ?? m.name,
      quantity: q > 0 ? q : 0.01,
      uom: m.uom,
      unitCost: m.unitCost,
      wastagePct: m.wastagePct,
      laborCost: o.labor ?? 0,
      constructionDetail: o.detail ?? {},
      sortOrder: o.sort ?? 0,
    });
  };
  // non-material BOM line: labour / equipment / transport / overhead (no catalog material)
  const E = (
    nodeId: string,
    kind: "LABOR" | "EQUIPMENT" | "TRANSPORT" | "OVERHEAD",
    desc: string,
    qty: number,
    rate: number,
    o: any = {},
  ) => {
    const q = Math.round((qty + Number.EPSILON) * 100) / 100;
    lines.push({
      id: `THU-L-${String(++ls).padStart(5, "0")}`,
      nodeId,
      materialId: null,
      kind,
      description: desc,
      quantity: q > 0 ? q : 0.01,
      uom: o.uom ?? "LS",
      unitCost: rate,
      wastagePct: 0,
      laborCost: 0,
      constructionDetail: o.detail ?? {},
      sortOrder: o.sort ?? 0,
    });
  };
  const perim = (area: number) => 4 * Math.sqrt(area); // approx room perimeter, m

  // ---- one apartment type (rooms + trade packages), instanced `count` times ----
  function buildApartmentType(parent: string, bhk: 2 | 4, count: number, sort: number) {
    const rooms = bhk === 2 ? ROOMS_2BHK : ROOMS_4BHK;
    const carpetM2 = rooms.reduce((a, r) => a + r.area, 0);
    const carpetSqft = Math.round(carpetM2 * 10.764);
    const bedrooms = rooms.filter((r) => /Bedroom|Study/.test(r.name)).length;
    const toilets = rooms.filter((r) => r.kind === "toilet").length;
    const balconies = rooms.filter((r) => r.kind === "balcony");

    const u = N(bhk === 2 ? "2 BHK Apartment — Type A" : "4 BHK Apartment — Type B", "SUBGROUP", {
      parent,
      qty: count,
      uom: "apt",
      sort,
      ref: bhk === 2 ? "2BHK-A" : "4BHK-B",
      notes: `${bhk} BHK · ~${carpetSqft} sq.ft carpet · ${count} identical apartments on this floor.`,
      attr: { bhk, carpet_sqft: carpetSqft, apartments_on_floor: count, bedrooms, toilets },
    });

    let s = 0;
    for (const r of rooms) {
      s += 10;
      const attr = { area_m2: r.area };
      if (r.kind === "toilet") {
        const wall = perim(r.area) * 3.0;
        const n = N(r.name, "ASSEMBLY", { parent: u, cat: C.plumbing, sort: s, uom: "room", attr });
        L(n, "IN-WP-WET", r.area + wall * 0.35, { labor: 130, desc: "Waterproofing — floor + skirting" });
        L(n, "IN-ANTISKID", r.area, { labor: 170 });
        L(n, "IN-CERAMIC-WALL", wall, { labor: 170, detail: { height: "full-height to false ceiling" } });
        L(n, "IN-CPVC-SET", r.name === "Powder Room" ? 3 : 5, { labor: 350 });
        L(n, "IN-SANWARE", 1, { labor: 900 });
        L(n, "IN-CP-FITTING", 1, { labor: 600 });
        L(n, "IN-DOOR-TOILET", 1, { labor: 500 });
        L(n, "IN-GYPSUM-CEIL", r.area, { labor: 250 });
        L(n, "IN-ELEC-POINT", 3, { labor: 120, desc: "Light, exhaust, shaver/mirror point" });
        if (r.name !== "Powder Room" && r.name !== "Servant Toilet") L(n, "IN-WH-GEYSER", 1, { labor: 400 });
      } else if (r.kind === "kitchen") {
        const n = N(r.name, "ASSEMBLY", { parent: u, cat: C.finishes, sort: s, uom: "room", attr });
        L(n, "IN-VITRIFIED", r.area, { labor: 190 });
        L(n, "IN-CERAMIC-WALL", 6, { labor: 170, desc: "Dado above counter" });
      } else if (r.kind === "balcony") {
        const n = N(r.name, "ASSEMBLY", { parent: u, cat: C.finishes, sort: s, uom: "room", attr });
        L(n, "IN-ANTISKID", r.area, { labor: 160 });
        L(n, "IN-WP-WET", r.area, { labor: 120, desc: "Balcony deck waterproofing" });
        L(n, "IN-EMULSION-EXT", r.area * 1.6, { labor: 60, desc: "Balcony walls & soffit" });
      } else if (r.kind === "utility") {
        const n = N(r.name, "ASSEMBLY", { parent: u, cat: C.plumbing, sort: s, uom: "room", attr });
        L(n, "IN-ANTISKID", r.area, { labor: 150 });
        L(n, "IN-CERAMIC-WALL", perim(r.area) * 2, { labor: 150 });
        L(n, "IN-CPVC-SET", 2, { labor: 300, desc: "Washing machine + service tap" });
      } else {
        // living / dining / bedroom / master bedroom / foyer / servant room
        const n = N(r.name, "ASSEMBLY", { parent: u, cat: C.finishes, sort: s, uom: "room", attr });
        if (r.kind === "mbedroom") L(n, "IN-WOOD-LAM", r.area, { labor: 300 });
        else L(n, "IN-VITRIFIED", r.area, { labor: 190 });
        if (r.kind === "living" || r.kind === "mbedroom")
          L(n, "IN-GYPSUM-CEIL", r.area * (r.kind === "living" ? 0.55 : 0.4), {
            labor: 250,
            desc: "Peripheral / cove false ceiling",
          });
      }
    }

    // --- apartment-wide trade packages ---
    const plaster = carpetM2 * 3.6; // both faces of all walls, indicative

    const w = N("Internal Walls — Blockwork & Plaster", "ASSEMBLY", { parent: u, cat: C.masonry, sort: (s += 10) });
    L(w, "IN-AAC-200", carpetM2 * 0.85, { labor: 320, desc: "External-wall inner face (200 mm AAC)" });
    L(w, "IN-AAC-100", carpetM2 * 1.15, { labor: 300, desc: "Internal partitions (100 mm AAC)" });
    L(w, "IN-PLASTER-INT", plaster, { labor: 140 });
    L(w, "IN-PUTTY", plaster, { labor: 35 });

    const p = N("Internal Painting", "ASSEMBLY", { parent: u, cat: C.finishes, sort: (s += 10) });
    L(p, "IN-EMULSION-INT", plaster + carpetM2, { labor: 45, desc: "Walls + ceilings, primer + 2 coats" });

    const j = N("Doors & Windows", "ASSEMBLY", { parent: u, cat: C.joinery, sort: (s += 10) });
    L(j, "IN-DOOR-MAIN", 1, { labor: 2000 });
    L(j, "IN-DOOR-INT", bedrooms + 1, { labor: 600, desc: "Bedrooms + kitchen" });
    L(j, "IN-WINDOW-UPVC", bhk === 2 ? 9 : 16, { labor: 400 });
    L(j, "IN-RAILING-SS", balconies.reduce((a, r) => a + perim(r.area) / 2, 0), { labor: 250, desc: "Balcony railings" });

    const e = N("Electrical & ELV", "ASSEMBLY", { parent: u, cat: C.electrical, sort: (s += 10) });
    L(e, "IN-ELEC-DB", 1, { labor: 1500 });
    L(e, "IN-ELEC-POINT", bhk === 2 ? 34 : 64, { labor: 120, desc: "Lighting, power, exhaust, bell" });
    L(e, "IN-AC-PROV", bedrooms + 1, { labor: 800, desc: "All bedrooms + living" });
    L(e, "IN-ELV-POINT", bhk === 2 ? 4 : 7, { labor: 150, desc: "TV, data, video door phone" });

    const k = N("Kitchen Fit-out", "ASSEMBLY", { parent: u, cat: C.finishes, sort: (s += 10) });
    L(k, "IN-GRANITE", bhk === 2 ? 9 : 13, { labor: 150 });
    L(k, "IN-MOD-KITCHEN", bhk === 2 ? 11 : 16, { labor: 0 });
    L(k, "IN-SINK-KIT", 1, { labor: 400 });
    L(k, "IN-CPVC-SET", 3, { labor: 350, desc: "Sink, RO, disposal" });
    L(k, "IN-ELEC-POINT", 6, { labor: 120, desc: "Hob, chimney, appliance points" });

    const fr = N("Fire & Safety", "ASSEMBLY", { parent: u, cat: C.firefighting, sort: (s += 10) });
    L(fr, "IN-FIRE-FLAT", 1, { labor: 1200 });

    // non-material expense carried by every apartment (instanced × count)
    E(u, "OVERHEAD", "Quality inspection, snagging & handover documentation", 1, 8500, {
      uom: "apt",
      sort: (s += 10),
    });

    return u;
  }

  // ---- one tower ----
  function buildTower(idx: number, tname: string, bhk: 2 | 4, unitsPerFloor: number, sort: number) {
    const total = unitsPerFloor * 8;
    const f = bhk === 4 ? 1.25 : 1; // size factor for the larger tower

    const t = N(`Tower ${idx} — ${tname}`, "GROUP", {
      sort,
      ref: `T${idx}`,
      notes: `8 residential floors · ${unitsPerFloor} × ${bhk} BHK per floor · ${total} apartments.`,
      attr: { floors: 8, units_per_floor: unitsPerFloor, bhk, total_apartments: total },
    });

    // Substructure
    const sub = N("Substructure & Foundations", "SUBGROUP", { parent: t, cat: C.structure, sort: 0 });
    const pil = N("Piling & Pile Caps", "ASSEMBLY", { parent: sub, cat: C.structure, sort: 0 });
    L(pil, "IN-EXC-EARTH", 3600 * f, { labor: 60 });
    L(pil, "IN-PILE-600", 1200 * f, { labor: 400 });
    L(pil, "IN-PCC-148", 120 * f, { labor: 900 });
    L(pil, "IN-RMC-M30", 180 * f, { labor: 800, desc: "Pile caps & tie beams" });
    L(pil, "IN-TMT-FE500", 22000 * f, { labor: 12 });
    const raft = N("Raft Foundation & Basement Retaining Wall", "ASSEMBLY", { parent: sub, cat: C.structure, sort: 10 });
    L(raft, "IN-RMC-M30", 620 * f, { labor: 800 });
    L(raft, "IN-TMT-FE500", 74000 * f, { labor: 12 });
    L(raft, "IN-FORMWORK", 320 * f, { labor: 180 });
    L(raft, "IN-WP-TERRACE", 520 * f, { labor: 120, desc: "Below-raft & retaining-wall tanking" });

    // Superstructure (typical floor cycle × 8)
    const sup = N("Superstructure — RCC Frame", "SUBGROUP", { parent: t, cat: C.structure, sort: 10 });
    const slabArea = unitsPerFloor * (bhk === 4 ? 205 : 112) * 1.35; // incl. cores & circulation
    const rcc = N("Typical Floor — Columns, Beams & Slab", "ASSEMBLY", {
      parent: sup,
      cat: C.structure,
      qty: 8,
      uom: "floor",
      sort: 0,
      notes: "Identical RCC cycle repeated for all 8 floors.",
    });
    L(rcc, "IN-RMC-M30", slabArea * 0.28, { labor: 850, detail: { mix: "M30", elements: "columns + beams + slab" } });
    L(rcc, "IN-TMT-FE500", slabArea * 0.28 * 110, { labor: 12, detail: { ratio_kg_per_m3: 110 } });
    L(rcc, "IN-FORMWORK", slabArea * 2.3, { labor: 220 });
    const roof = N("Roof, Terrace, Parapets & OHT", "ASSEMBLY", { parent: sup, cat: C.structure, sort: 10 });
    L(roof, "IN-RMC-M30", 95 * f, { labor: 800 });
    L(roof, "IN-TMT-FE500", 9500 * f, { labor: 12 });
    L(roof, "IN-WP-TERRACE", slabArea / 1.35, { labor: 120 });

    // Facade
    const fac = N("Facade & External Finishes", "SUBGROUP", { parent: t, cat: C.facade, sort: 20 });
    const facArea = bhk === 4 ? 1850 : 1550;
    const ef = N("External Plaster & Texture Paint", "ASSEMBLY", { parent: fac, cat: C.facade, sort: 0 });
    L(ef, "IN-PLASTER-EXT", facArea, { labor: 150 });
    L(ef, "IN-EMULSION-EXT", facArea, { labor: 60 });
    const acp = N("ACP Feature Cladding & Fins", "ASSEMBLY", { parent: fac, cat: C.facade, sort: 10 });
    L(acp, "IN-ACP", bhk === 4 ? 420 : 340, { labor: 350 });
    const lob = N("Double-height Entrance Lobby", "ASSEMBLY", { parent: fac, cat: C.facade, sort: 20 });
    L(lob, "IN-STRUCT-GLAZ", 90, { labor: 600 });
    L(lob, "IN-STONE-CLAD", 160, { labor: 250 });

    // Vertical transportation & cores
    const vt = N("Lifts, Lobbies & Staircases", "SUBGROUP", { parent: t, cat: C.lifts, sort: 30 });
    const lf = N("Passenger Lifts", "ASSEMBLY", { parent: vt, cat: C.lifts, sort: 0 });
    L(lf, bhk === 4 ? "IN-LIFT-13P" : "IN-LIFT-8P", 2, { labor: 80000, detail: { stops: 9, count: 2 } });
    const cf = N("Lift Lobby & Staircase Finishes (all floors)", "ASSEMBLY", { parent: vt, cat: C.lifts, sort: 10 });
    L(cf, "IN-VITRIFIED", unitsPerFloor * 8 * 2.4, { labor: 190, desc: "Lift-lobby flooring" });
    L(cf, "IN-EMULSION-INT", 8 * 240, { labor: 45 });
    L(cf, "IN-RAILING-SS", 8 * 13, { labor: 250, desc: "Staircase railing" });

    // Tower MEP risers
    const tm = N("Tower MEP Risers & Common Services", "SUBGROUP", { parent: t, sort: 40 });
    const me = N("Common Electrical — Risers, DBs & Lighting", "ASSEMBLY", { parent: tm, cat: C.electrical, sort: 0 });
    L(me, "IN-ELEC-POINT", unitsPerFloor * 8 * 2 + 140, { labor: 120 });
    L(me, "IN-ELEC-DB", 12, { labor: 1500, desc: "Riser + common-area DBs" });
    const mp = N("Plumbing Risers & Hydro-pneumatic Connections", "ASSEMBLY", { parent: tm, cat: C.plumbing, sort: 10 });
    L(mp, "IN-CPVC-SET", unitsPerFloor * 8 * 3, { labor: 350, desc: "Vertical stack tie-ins per apartment" });
    const mf = N("Tower Fire-fighting Distribution", "ASSEMBLY", { parent: tm, cat: C.firefighting, sort: 20 });
    L(mf, "IN-FIRE-FLAT", unitsPerFloor * 6, { labor: 1200, desc: "Wet-riser branches, landing valves, common detectors" });

    // Construction logistics & plant (non-material) — dedicated to this tower
    const cl = N("Construction Logistics & Plant", "SUBGROUP", { parent: t, cat: C.prelims, sort: 45 });
    const plant = N("Plant & Equipment Hire", "ASSEMBLY", { parent: cl, cat: C.prelims, sort: 0 });
    E(plant, "EQUIPMENT", "Tower crane hire incl. erection & dismantling", Math.round(14 * f), 380000, { uom: "month" });
    E(plant, "EQUIPMENT", "Passenger / material hoist hire", Math.round(12 * f), 140000, { uom: "month", sort: 10 });
    E(plant, "EQUIPMENT", "Concrete boom placer & pump hire", Math.round(8 * f), 220000, { uom: "month", sort: 20 });
    E(plant, "EQUIPMENT", "Scaffolding, formwork props & access hire", 1, 2200000 * f, { sort: 30 });
    const haul = N("Site Logistics & Supervision", "ASSEMBLY", { parent: cl, cat: C.prelims, sort: 10 });
    E(haul, "TRANSPORT", "Ready-mix concrete & bulk material haulage to tower", 1, 4200000 * f);
    E(haul, "LABOR", "Tower site-engineering & supervision team", Math.round(16 * f), 280000, { uom: "month", sort: 10 });
    E(haul, "OVERHEAD", "Tower survey, checklists & stage QA documentation", 1, 650000, { sort: 20 });

    // Residential floors
    const fg = N("Residential Floors", "SUBGROUP", { parent: t, sort: 50 });
    for (let fl = 1; fl <= 8; fl++) {
      const fn = N(`Floor ${String(fl).padStart(2, "0")}`, "SUBGROUP", {
        parent: fg,
        sort: fl,
        ref: `T${idx}-F${String(fl).padStart(2, "0")}`,
        attr: { level: fl, apartments: unitsPerFloor },
      });
      buildApartmentType(fn, bhk, unitsPerFloor, 0);
    }
    return t;
  }

  // ======================= build the project tree =======================

  // Site Infrastructure & External Development
  const infra = N("Site Infrastructure & External Development", "GROUP", {
    cat: C.infra,
    sort: 100,
    notes: "Shared services and external works serving the whole development.",
  });
  const ew = N("Earthwork & Site Grading", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 0 });
  L(ew, "IN-EXC-EARTH", 28000, { labor: 55 });
  const rd = N("Internal Roads, Driveways & Pavements", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 10 });
  L(rd, "IN-WMM-ROAD", 4600, { labor: 120 });
  L(rd, "IN-PAVER", 3100, { labor: 180 });
  const cw = N("Compound Wall, Gates & Guard Houses", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 20 });
  L(cw, "IN-COMPOUND", 640, { labor: 350 });
  const sdr = N("Storm-water Drainage & Culverts", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 30 });
  L(sdr, "IN-STORMDRAIN", 1150, { labor: 250 });
  const stp = N("Sewage Treatment Plant (150 KLD)", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 40 });
  L(stp, "IN-STP", 1, { labor: 250000 });
  const wtp = N("Water Treatment Plant & Pump Rooms", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 50 });
  L(wtp, "IN-WTP", 1, { labor: 150000 });
  const rwh = N("Rainwater Harvesting", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 60 });
  L(rwh, "IN-RWH-PIT", 16, { labor: 4000 });
  const pss = N("Electrical Sub-station & DG Backup", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 70 });
  L(pss, "IN-TRAFO", 2, { labor: 120000 });
  L(pss, "IN-DG", 2, { labor: 150000 });
  const fsy = N("Fire-fighting Infrastructure — pump room & hydrant ring main", "ASSEMBLY", {
    parent: infra,
    cat: C.firefighting,
    sort: 80,
  });
  L(fsy, "IN-FIRE-SYS", 1, { labor: 0 });

  // Common Amenities
  const am = N("Common Amenities", "GROUP", { cat: C.amenities, sort: 110 });
  const podium = N("Basement / Podium Parking", "SUBGROUP", { parent: am, cat: C.structure, sort: 0 });
  const pst = N("Podium RCC Structure", "ASSEMBLY", { parent: podium, cat: C.structure, sort: 0 });
  L(pst, "IN-RMC-M30", 2100, { labor: 800 });
  L(pst, "IN-TMT-FE500", 231000, { labor: 12 });
  L(pst, "IN-FORMWORK", 7200, { labor: 200 });
  const pfin = N("Parking Deck Finishes, Ventilation & Marking", "ASSEMBLY", { parent: podium, cat: C.finishes, sort: 10 });
  L(pfin, "IN-DECK-COAT", 8200, { labor: 120 });
  L(pfin, "IN-ELEC-POINT", 380, { labor: 120, desc: "Lighting & exhaust points" });
  const club = N("Clubhouse", "SUBGROUP", { parent: am, cat: C.amenities, sort: 10 });
  const cst = N("Clubhouse RCC Structure & Envelope", "ASSEMBLY", { parent: club, cat: C.structure, sort: 0 });
  L(cst, "IN-RMC-M30", 480, { labor: 800 });
  L(cst, "IN-TMT-FE500", 52000, { labor: 12 });
  L(cst, "IN-PLASTER-EXT", 900, { labor: 150 });
  const cfit = N("Clubhouse Interior Fit-out & FF&E", "ASSEMBLY", { parent: club, cat: C.amenities, sort: 10 });
  L(cfit, "IN-CLUB-FITOUT", 1150, { labor: 0 });
  const gym = N("Gymnasium", "ASSEMBLY", { parent: am, cat: C.amenities, sort: 20 });
  L(gym, "IN-GYM", 1, { labor: 0 });
  const pool = N("Swimming Pool & Deck", "ASSEMBLY", { parent: am, cat: C.amenities, sort: 30 });
  L(pool, "IN-POOL", 220, { labor: 0 });
  const play = N("Children's Play Area & Landscaped Courts", "ASSEMBLY", { parent: am, cat: C.amenities, sort: 40 });
  L(play, "IN-PLAY", 1, { labor: 0 });
  const land = N("Landscape, Hardscape & Irrigation", "ASSEMBLY", { parent: am, cat: C.landscape, sort: 50 });
  L(land, "IN-LANDSCAPE", 5200, { labor: 120 });

  // Preliminaries, Overheads & Site Establishment — non-material project costs
  const pre = N("Preliminaries, Overheads & Site Establishment", "GROUP", {
    cat: C.prelims,
    sort: 90,
    notes: "Statutory, professional, site-establishment, insurance and logistics costs — no permanent material content.",
  });

  const appr = N("Statutory Approvals & Documentation", "SUBGROUP", { parent: pre, cat: C.prelims, sort: 0 });
  E(appr, "OVERHEAD", "CMDA / DTCP planning permission & scrutiny fees", 1, 6500000);
  E(appr, "OVERHEAD", "Premium FSI, OSR & shelter charges", 1, 14000000, { sort: 10 });
  E(appr, "OVERHEAD", "RERA registration & quarterly compliance", 1, 900000, { sort: 20 });
  E(appr, "OVERHEAD", "Statutory NOCs — fire, CMWSSB, TNEB, AAI height", 1, 2800000, { sort: 30 });
  E(appr, "OVERHEAD", "Legal, title due-diligence & registration support", 208, 6500, { uom: "unit", sort: 40 });
  E(appr, "OVERHEAD", "Building completion & occupancy certificate", 1, 1200000, { sort: 50 });

  const cons = N("Design & Professional Consultancy", "SUBGROUP", { parent: pre, cat: C.prelims, sort: 10 });
  E(cons, "OVERHEAD", "Architectural, structural & MEP design consultancy", 1, 21000000);
  E(cons, "OVERHEAD", "Project management consultancy (PMC)", 28, 450000, { uom: "month", sort: 10 });
  E(cons, "OVERHEAD", "Soil investigation & topographic survey", 1, 1100000, { sort: 20 });
  E(cons, "OVERHEAD", "IGBC green-building certification & commissioning", 1, 1800000, { sort: 30 });

  const estab = N("Site Establishment & General", "SUBGROUP", { parent: pre, cat: C.prelims, sort: 20 });
  E(estab, "OVERHEAD", "Site office, stores, sample flat & labour colony", 28, 240000, { uom: "month" });
  E(estab, "OVERHEAD", "Temporary power, water, DG & site utilities", 28, 160000, { uom: "month", sort: 10 });
  E(estab, "LABOR", "Site security, hoarding & housekeeping", 28, 140000, { uom: "month", sort: 20 });
  E(estab, "LABOR", "Central project management & planning staff", 28, 520000, { uom: "month", sort: 30 });

  const ins = N("Insurance, Cess & Guarantees", "SUBGROUP", { parent: pre, cat: C.prelims, sort: 30 });
  E(ins, "OVERHEAD", "Contractor's All-Risk (CAR) & third-party insurance", 1, 3800000);
  E(ins, "OVERHEAD", "Building & other construction workers' welfare cess", 1, 5500000, { sort: 10 });

  const log = N("Logistics & Debris Management", "SUBGROUP", { parent: pre, cat: C.prelims, sort: 40 });
  E(log, "TRANSPORT", "Bulk material haulage — steel, cement, blocks, aggregates", 1, 8500000);
  E(log, "TRANSPORT", "Plant & equipment mobilisation / demobilisation", 1, 2200000, { sort: 10 });
  E(log, "TRANSPORT", "Construction debris removal & disposal to approved yard", 1, 3000000, { sort: 20 });

  // Towers
  buildTower(1, "Marina", 2, 10, 10);
  buildTower(2, "Coromandel", 4, 6, 20);
  buildTower(3, "Adyar", 2, 10, 30);

  console.log(`inserting ${nodes.length} nodes and ${lines.length} BOM lines…`);
  await insertMany(prisma.node, nodes);
  await insertMany(prisma.bomLine, lines);

  // report
  let summary: any = null;
  try {
    summary = await fetch(`http://localhost:4000/api/projects/${project.id}/summary`).then((r) => r.json());
  } catch {
    /* API not running — skip the cost read-back */
  }
  const inr = (n: number) =>
    n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n)}`;

  console.log(`\ndone: project ${project.code} "${project.name}"`);
  console.log(`  ${nodes.length} nodes · ${lines.length} BOM lines · ${MATERIALS.length} materials · ${CATEGORIES.length} sub-groups`);
  if (summary?.total) {
    console.log(`  project cost roll-up: ${inr(summary.total)}`);
    console.log("  by cost kind:");
    for (const row of summary.byKind ?? []) console.log(`    ${row.label.padEnd(28)} ${inr(row.amount)}`);
    console.log("  by sub-group:");
    for (const row of summary.byCategory ?? []) console.log(`    ${row.label.padEnd(28)} ${inr(row.amount)}`);
  } else {
    console.log("  (start the API — npm run dev — and open http://localhost:5173 to see the cost roll-up)");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
