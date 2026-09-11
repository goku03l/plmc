import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MATERIALS = [
  { code: "CONC-C30", name: "Ready-mix concrete C30/37", category: "Concrete", uom: "m3", unitCost: 145, wastagePct: 3 },
  { code: "REBAR-B500", name: "Reinforcement bar B500B", category: "Concrete", uom: "t", unitCost: 920, wastagePct: 5 },
  { code: "STEEL-S355", name: "Structural steel S355 sections", category: "Steel", uom: "t", unitCost: 2100, wastagePct: 2 },
  { code: "GYP-13", name: "Gypsum board 12.5mm", category: "Interiors", uom: "m2", unitCost: 6.4, wastagePct: 8 },
  { code: "STUD-70", name: "Steel stud partition frame 70mm", category: "Interiors", uom: "m2", unitCost: 9.1, wastagePct: 6 },
  { code: "PAINT-EM", name: "Emulsion paint, 2 coats", category: "Finishes", uom: "m2", unitCost: 4.2, wastagePct: 10 },
  { code: "TILE-POR", name: "Porcelain floor tile 600x600", category: "Finishes", uom: "m2", unitCost: 28, wastagePct: 10 },
  { code: "DOOR-FD30", name: "FD30 timber door assembly", category: "Doors", uom: "ea", unitCost: 420, wastagePct: 0 },
  { code: "CW-UNIT", name: "Unitised curtain wall panel", category: "Envelope", uom: "m2", unitCost: 680, wastagePct: 2 },
  { code: "INS-MW", name: "Mineral wool insulation 100mm", category: "Envelope", uom: "m2", unitCost: 12.5, wastagePct: 7 },
  { code: "HVAC-VAV", name: "VAV terminal box + diffuser", category: "MEP", uom: "ea", unitCost: 540, wastagePct: 0 },
  { code: "ELEC-RI", name: "Electrical rough-in per point", category: "MEP", uom: "pt", unitCost: 65, wastagePct: 4 },
  { code: "EXC-BULK", name: "Bulk excavation", category: "Sitework", uom: "m3", unitCost: 14, wastagePct: 0 },
];

async function main() {
  console.log("seeding materials...");
  const materials: Record<string, string> = {};
  for (const m of MATERIALS) {
    const rec = await prisma.material.upsert({ where: { code: m.code }, create: m, update: m });
    materials[m.code] = rec.id;
  }

  const existing = await prisma.project.findUnique({ where: { code: "RIV-001" } });
  if (existing) {
    console.log("demo project RIV-001 already exists, deleting and recreating");
    await prisma.project.delete({ where: { id: existing.id } });
  }

  console.log("creating demo project...");
  const project = await prisma.project.create({
    data: {
      code: "RIV-001",
      name: "Riverside Office Tower",
      description: "12-storey commercial office building, CBD riverfront site.",
      client: "Meridian Developments",
      location: "Brisbane, AU",
      currency: "AUD",
      status: "ACTIVE",
      categories: {
        create: [
          { key: "structure", label: "Structure", color: "#64748b", sortOrder: 0 },
          { key: "exteriors", label: "Exteriors", color: "#0ea5e9", sortOrder: 1 },
          { key: "interiors", label: "Interiors", color: "#f59e0b", sortOrder: 2 },
          { key: "mep", label: "MEP", color: "#10b981", sortOrder: 3 },
          { key: "sitework", label: "Sitework", color: "#a855f7", sortOrder: 4 },
        ],
      },
    },
    include: { categories: true },
  });
  const cat = Object.fromEntries(project.categories.map((c) => [c.key, c.id]));

  // helper
  const node = (
    name: string,
    type: "GROUP" | "SUBGROUP" | "ASSEMBLY" | "COMPONENT",
    opts: { parentId?: string; categoryId?: string; quantity?: number; uom?: string; sortOrder?: number } = {}
  ) =>
    prisma.node.create({
      data: {
        projectId: project.id,
        name,
        type,
        parentId: opts.parentId ?? null,
        categoryId: opts.categoryId ?? null,
        quantity: opts.quantity ?? 1,
        uom: opts.uom ?? "ea",
        sortOrder: opts.sortOrder ?? 0,
      },
    });

  const bom = (
    nodeId: string,
    code: string,
    quantity: number,
    extra: { laborCost?: number; detail?: Record<string, string | number>; sortOrder?: number } = {}
  ) => {
    const m = MATERIALS.find((x) => x.code === code)!;
    return prisma.bomLine.create({
      data: {
        nodeId,
        materialId: materials[code],
        description: m.name,
        quantity,
        uom: m.uom,
        unitCost: m.unitCost,
        wastagePct: m.wastagePct,
        laborCost: extra.laborCost ?? 0,
        constructionDetail: extra.detail ?? {},
        sortOrder: extra.sortOrder ?? 0,
      },
    });
  };

  // --- Structure ---------------------------------------------------------------
  const sub = await node("Substructure", "GROUP", { categoryId: cat.structure, sortOrder: 0 });
  const found = await node("Pad & raft foundations", "ASSEMBLY", { parentId: sub.id, categoryId: cat.structure });
  await bom(found.id, "CONC-C30", 850, { laborCost: 55, detail: { phase: "Substructure", trade: "Concretor" } });
  await bom(found.id, "REBAR-B500", 68, { laborCost: 480, detail: { phase: "Substructure", trade: "Steel fixer" }, sortOrder: 10 });

  const superstr = await node("Superstructure", "GROUP", { categoryId: cat.structure, sortOrder: 10 });
  const slab = await node("Typical floor slab", "ASSEMBLY", { parentId: superstr.id, categoryId: cat.structure, quantity: 11, uom: "floor" });
  await bom(slab.id, "CONC-C30", 210, { laborCost: 48, detail: { phase: "Superstructure" } });
  await bom(slab.id, "REBAR-B500", 17, { laborCost: 480, sortOrder: 10 });
  const frame = await node("Steel frame", "ASSEMBLY", { parentId: superstr.id, categoryId: cat.structure, quantity: 11, uom: "floor", sortOrder: 10 });
  await bom(frame.id, "STEEL-S355", 42, { laborCost: 900, detail: { trade: "Steel erector" } });

  // --- Exteriors --------------------------------------------------------------
  const env = await node("Building Envelope", "GROUP", { categoryId: cat.exteriors, sortOrder: 20 });
  const cw = await node("Curtain wall system", "ASSEMBLY", { parentId: env.id, categoryId: cat.exteriors });
  await bom(cw.id, "CW-UNIT", 6400, { laborCost: 120, detail: { system: "Unitised", phase: "Facade" } });
  await bom(cw.id, "INS-MW", 1200, { laborCost: 8, sortOrder: 10 });

  // --- Interiors ------------------------------------------------------------
  const interiors = await node("Interiors", "GROUP", { categoryId: cat.interiors, sortOrder: 30 });
  const fitout = await node("Typical floor fit-out", "SUBGROUP", { parentId: interiors.id, categoryId: cat.interiors, quantity: 11, uom: "floor" });
  const part = await node("Partitions", "ASSEMBLY", { parentId: fitout.id, categoryId: cat.interiors });
  await bom(part.id, "STUD-70", 620, { laborCost: 11, detail: { trade: "Partition installer" } });
  await bom(part.id, "GYP-13", 1240, { laborCost: 7, sortOrder: 10 });
  await bom(part.id, "PAINT-EM", 1240, { laborCost: 5, sortOrder: 20 });
  const floor = await node("Flooring", "ASSEMBLY", { parentId: fitout.id, categoryId: cat.interiors, sortOrder: 10 });
  await bom(floor.id, "TILE-POR", 780, { laborCost: 22, detail: { trade: "Tiler" } });
  const doors = await node("Doors", "ASSEMBLY", { parentId: fitout.id, categoryId: cat.interiors, sortOrder: 20 });
  await bom(doors.id, "DOOR-FD30", 18, { laborCost: 85, detail: { rating: "FD30" } });

  // --- MEP ------------------------------------------------------------------
  const mep = await node("MEP Services", "GROUP", { categoryId: cat.mep, sortOrder: 40 });
  const hvac = await node("HVAC - air side", "ASSEMBLY", { parentId: mep.id, categoryId: cat.mep, quantity: 11, uom: "floor" });
  await bom(hvac.id, "HVAC-VAV", 14, { laborCost: 160, detail: { trade: "Mechanical" } });
  const elec = await node("Electrical", "ASSEMBLY", { parentId: mep.id, categoryId: cat.mep, quantity: 11, uom: "floor", sortOrder: 10 });
  await bom(elec.id, "ELEC-RI", 240, { laborCost: 35, detail: { trade: "Electrical" } });

  // --- Sitework -----------------------------------------------------------
  const site = await node("Sitework", "GROUP", { categoryId: cat.sitework, sortOrder: 50 });
  const exc = await node("Bulk earthworks", "ASSEMBLY", { parentId: site.id, categoryId: cat.sitework });
  await bom(exc.id, "EXC-BULK", 12000, { laborCost: 6, detail: { trade: "Earthworks" } });

  const count = await prisma.node.count({ where: { projectId: project.id } });
  console.log(`done: project ${project.code} with ${count} nodes and ${MATERIALS.length} materials`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
