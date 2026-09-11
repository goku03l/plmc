/**
 * Second sample project — "Silver Sands Residency", ECR, Chennai.
 *
 * Deliberately more detailed than Thuniv Paradise (seed-thuniv.ts):
 *   - more BOM lines per apartment (extra finish items: skirting, wardrobes,
 *     exhaust fans, curtain rods, balcony grills — not folded into a bigger
 *     line, each is its own row)
 *   - a real supplier directory (16 suppliers across every trade) instead of
 *     an empty one
 *   - suppliers actually ATTACHED: linked to materials (MaterialSupplier) and
 *     assigned directly on most BOM lines (BomLine.supplierId), not just
 *     sitting in the directory unused
 *
 *   3 towers · 8 floors each
 *   Tower A (Azure)      – 2 BHK · 6 per floor · 48 apartments
 *   Tower B (Bay View)   – 3 BHK · 6 per floor · 48 apartments
 *   Tower C (Coral)      – 2 BHK · 8 per floor · 64 apartments
 *   = 160 apartments, + basement parking, clubhouse, pool, gym, site infra.
 *
 * Run:  cd apps/api && npx tsx prisma/seed-silversands.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PROJECT_CODE = "SSR-001";

type Mat = { code: string; name: string; category: string; uom: string; unitCost: number; wastagePct: number };

// ---------------------------------------------------------------------------
// Material catalog — the same shared Indian-residential set as Thuniv Paradise
// (materials are a global catalog; upserting is safe/idempotent) plus a
// handful of new codes for the extra finish items this project adds.
// ---------------------------------------------------------------------------
const MATERIALS: Mat[] = [
  { code: "IN-EXC-EARTH", name: "Earthwork excavation in soil / soft rock", category: "Earthwork", uom: "m3", unitCost: 180, wastagePct: 0 },
  { code: "IN-PCC-148", name: "PCC 1:4:8 levelling course", category: "Concrete", uom: "m3", unitCost: 5200, wastagePct: 2 },
  { code: "IN-PILE-600", name: "Bored cast-in-situ pile Ø600 (incl. reinforcement)", category: "Concrete", uom: "rmt", unitCost: 3400, wastagePct: 2 },
  { code: "IN-RMC-M30", name: "Ready-mix concrete M30, pumped & placed", category: "Concrete", uom: "m3", unitCost: 6600, wastagePct: 2 },
  { code: "IN-RMC-M25", name: "Ready-mix concrete M25, pumped & placed", category: "Concrete", uom: "m3", unitCost: 6100, wastagePct: 2 },
  { code: "IN-TMT-FE500", name: "TMT reinforcement steel Fe500D", category: "Steel", uom: "kg", unitCost: 68, wastagePct: 3 },
  { code: "IN-FORMWORK", name: "Formwork / shuttering (ply + props), per contact area", category: "Formwork", uom: "m2", unitCost: 260, wastagePct: 0 },
  { code: "IN-AAC-200", name: "AAC block masonry 200 mm (external walls)", category: "Masonry", uom: "m2", unitCost: 980, wastagePct: 4 },
  { code: "IN-AAC-100", name: "AAC block masonry 100 mm (internal partitions)", category: "Masonry", uom: "m2", unitCost: 640, wastagePct: 4 },
  { code: "IN-PLASTER-INT", name: "Cement plaster 12 mm, internal", category: "Plaster", uom: "m2", unitCost: 255, wastagePct: 8 },
  { code: "IN-PLASTER-EXT", name: "Cement plaster 18 mm, external (two-coat)", category: "Plaster", uom: "m2", unitCost: 340, wastagePct: 8 },
  { code: "IN-PUTTY", name: "Wall putty, two coats", category: "Finishes", uom: "m2", unitCost: 62, wastagePct: 10 },
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
  { code: "IN-DOOR-MAIN", name: "Main door — teak frame + veneer shutter + hardware", category: "Joinery", uom: "nos", unitCost: 24000, wastagePct: 0 },
  { code: "IN-DOOR-INT", name: "Internal door — WPC frame + flush shutter + hardware", category: "Joinery", uom: "nos", unitCost: 7800, wastagePct: 0 },
  { code: "IN-DOOR-TOILET", name: "Toilet door — WPC frame + PVC-laminate shutter", category: "Joinery", uom: "nos", unitCost: 6200, wastagePct: 0 },
  { code: "IN-WINDOW-UPVC", name: "uPVC 2-track sliding window + 5 mm float glass + mesh", category: "Joinery", uom: "m2", unitCost: 6800, wastagePct: 3 },
  { code: "IN-RAILING-SS", name: "SS 304 railing + toughened glass (balcony / stair)", category: "Joinery", uom: "rmt", unitCost: 5200, wastagePct: 2 },
  { code: "IN-WP-WET", name: "Wet-area waterproofing — crystalline + APP membrane", category: "Waterproofing", uom: "m2", unitCost: 560, wastagePct: 5 },
  { code: "IN-WP-TERRACE", name: "Terrace / tanking waterproofing — brickbat coba + membrane", category: "Waterproofing", uom: "m2", unitCost: 720, wastagePct: 5 },
  { code: "IN-CPVC-SET", name: "CPVC/UPVC supply + PVC drainage, per fixture point", category: "Plumbing", uom: "point", unitCost: 1650, wastagePct: 3 },
  { code: "IN-SANWARE", name: "Sanitaryware set — WC, wash basin, health faucet (mid-range)", category: "Plumbing", uom: "set", unitCost: 16500, wastagePct: 0 },
  { code: "IN-CP-FITTING", name: "CP fittings per toilet — diverter, shower, taps, accessories", category: "Plumbing", uom: "set", unitCost: 9500, wastagePct: 0 },
  { code: "IN-SINK-KIT", name: "SS kitchen sink (double bowl) + drainboard + faucet", category: "Plumbing", uom: "set", unitCost: 8500, wastagePct: 0 },
  { code: "IN-WH-GEYSER", name: "Storage water heater 15 L + plumbing", category: "Plumbing", uom: "nos", unitCost: 7200, wastagePct: 0 },
  { code: "IN-ELEC-POINT", name: "Wiring point — FRLS cable in conduit + modular accessory", category: "Electrical", uom: "point", unitCost: 880, wastagePct: 3 },
  { code: "IN-ELEC-DB", name: "Flat distribution board + MCB/RCCB + earthing", category: "Electrical", uom: "nos", unitCost: 6800, wastagePct: 0 },
  { code: "IN-AC-PROV", name: "Split-AC provision — copper piping, drain, power point", category: "Electrical", uom: "nos", unitCost: 3600, wastagePct: 0 },
  { code: "IN-ELV-POINT", name: "ELV point — TV / data / video door phone", category: "Electrical", uom: "point", unitCost: 1400, wastagePct: 3 },
  { code: "IN-FIRE-FLAT", name: "Flat fire protection — sprinklers + smoke detector + wiring", category: "Fire Fighting", uom: "nos", unitCost: 9500, wastagePct: 0 },
  { code: "IN-FIRE-SYS", name: "Fire pump room, hydrants, wet riser, panel (project-wide)", category: "Fire Fighting", uom: "LS", unitCost: 6500000, wastagePct: 0 },
  { code: "IN-ACP", name: "ACP cladding on GI framing (facade feature bands / fins)", category: "Facade", uom: "m2", unitCost: 1450, wastagePct: 5 },
  { code: "IN-STONE-CLAD", name: "Natural stone cladding — entrance / lift lobby", category: "Facade", uom: "m2", unitCost: 1600, wastagePct: 5 },
  { code: "IN-STRUCT-GLAZ", name: "Structural / spider glazing — double-height lobby", category: "Facade", uom: "m2", unitCost: 4200, wastagePct: 3 },
  { code: "IN-LIFT-8P", name: "Passenger lift 8-pax, 8 stops, MRL + auto-rescue device", category: "Vertical Transportation", uom: "nos", unitCost: 2200000, wastagePct: 0 },
  { code: "IN-LIFT-13P", name: "Passenger lift 13-pax, 8 stops, MRL + ARD", category: "Vertical Transportation", uom: "nos", unitCost: 2900000, wastagePct: 0 },
  { code: "IN-STP", name: "Sewage Treatment Plant 150 KLD (MBBR), incl. civil", category: "Infrastructure", uom: "LS", unitCost: 4200000, wastagePct: 0 },
  { code: "IN-WTP", name: "Water Treatment Plant + softener + hydro-pneumatic system", category: "Infrastructure", uom: "LS", unitCost: 1800000, wastagePct: 0 },
  { code: "IN-RWH-PIT", name: "Rainwater harvesting recharge pit + piping", category: "Infrastructure", uom: "nos", unitCost: 48000, wastagePct: 0 },
  { code: "IN-TRAFO", name: "Package sub-station — transformer 1000 kVA + HT/LT panel", category: "Infrastructure", uom: "nos", unitCost: 3800000, wastagePct: 0 },
  { code: "IN-DG", name: "DG set 750 kVA, acoustic enclosure + AMF panel", category: "Infrastructure", uom: "nos", unitCost: 4500000, wastagePct: 0 },
  { code: "IN-WMM-ROAD", name: "Internal road — GSB + WMM + bituminous surfacing", category: "Infrastructure", uom: "m2", unitCost: 1350, wastagePct: 3 },
  { code: "IN-PAVER", name: "Paver block 80 mm on sand bed (driveways / walkways)", category: "Infrastructure", uom: "m2", unitCost: 680, wastagePct: 5 },
  { code: "IN-COMPOUND", name: "Compound wall — RR masonry + RCC coping + plaster", category: "Infrastructure", uom: "rmt", unitCost: 3900, wastagePct: 3 },
  { code: "IN-STORMDRAIN", name: "Storm-water drain — RCC U-drain + gratings", category: "Infrastructure", uom: "rmt", unitCost: 2400, wastagePct: 3 },
  { code: "IN-CLUB-FITOUT", name: "Clubhouse interior fit-out (finishes, FF&E, MEP)", category: "Amenities", uom: "m2", unitCost: 9500, wastagePct: 5 },
  { code: "IN-POOL", name: "Swimming pool — shell, tiling, filtration, deck", category: "Amenities", uom: "m2", unitCost: 13500, wastagePct: 3 },
  { code: "IN-GYM", name: "Gymnasium equipment package + sports flooring", category: "Amenities", uom: "LS", unitCost: 3200000, wastagePct: 0 },
  { code: "IN-PLAY", name: "Children play area — EPDM surfacing + equipment", category: "Amenities", uom: "LS", unitCost: 1500000, wastagePct: 0 },
  { code: "IN-LANDSCAPE", name: "Soft + hard landscape (planting, irrigation, seating)", category: "Landscape", uom: "m2", unitCost: 900, wastagePct: 5 },
  // --- new for Silver Sands: extra finish items, each its own BOM line ---
  { code: "IN-SKIRTING", name: "Vitrified tile skirting, 100 mm", category: "Finishes", uom: "rmt", unitCost: 180, wastagePct: 8 },
  { code: "IN-WARDROBE", name: "Modular wardrobe — laminate finish, sliding shutters", category: "Joinery", uom: "rft", unitCost: 1800, wastagePct: 0 },
  { code: "IN-EXHAUST-FAN", name: "Exhaust fan 150 mm incl. wiring point", category: "Electrical", uom: "nos", unitCost: 1450, wastagePct: 0 },
  { code: "IN-CURTAIN-ROD", name: "Curtain rod / track provision", category: "Finishes", uom: "rmt", unitCost: 320, wastagePct: 0 },
  { code: "IN-NAMEPLATE-BELL", name: "Video door phone + nameplate + wireless doorbell", category: "Electrical", uom: "nos", unitCost: 4200, wastagePct: 0 },
  { code: "IN-BALCONY-GRILL", name: "MS safety grill — balcony / window, powder-coated", category: "Joinery", uom: "rmt", unitCost: 950, wastagePct: 3 },
];

// ---------------------------------------------------------------------------
// Supplier directory — 16 suppliers across every trade, each with a contact.
// Materials get linked to their supplier(s) (MaterialSupplier) and BOM lines
// get the supplier assigned directly (BomLine.supplierId) via MATERIAL_SUPPLIER
// below — this is the "attached suppliers" part, not just an unused directory.
// ---------------------------------------------------------------------------
type SupplierDef = {
  name: string;
  trades: string[];
  city: string;
  gstin: string;
  contact: { name: string; email: string; phone: string; role: string };
};
const SUPPLIERS: SupplierDef[] = [
  { name: "Sri Ganesh Ready Mix Concrete", trades: ["Concrete", "RMC"], city: "Chennai", gstin: "33AACFS1234A1Z1", contact: { name: "R. Ganesan", email: "ganesan@sriganeshrmc.example", phone: "+91 98400 11221", role: "Sales Manager" } },
  { name: "Anand Steel Traders", trades: ["Steel", "TMT Reinforcement"], city: "Chennai", gstin: "33AABCA5678B1Z2", contact: { name: "Anand Kumar", email: "anand@anandsteel.example", phone: "+91 98410 22332", role: "Proprietor" } },
  { name: "Bharat AAC Blocks Pvt Ltd", trades: ["Masonry", "AAC Blocks"], city: "Sriperumbudur", gstin: "33AADCB4321C1Z3", contact: { name: "Vijay Bharath", email: "vijay@bharataac.example", phone: "+91 98420 33443", role: "Regional Sales Head" } },
  { name: "Nithya Tiles & Ceramics", trades: ["Finishes", "Tiles", "Skirting"], city: "Chennai", gstin: "33AAECN2345D1Z4", contact: { name: "Nithya Raman", email: "nithya@nithyatiles.example", phone: "+91 98430 44554", role: "Director" } },
  { name: "Coastal Paints & Coatings", trades: ["Finishes", "Painting"], city: "Chennai", gstin: "33AAFCC3456E1Z5", contact: { name: "S. Meenakshi", email: "meenakshi@coastalpaints.example", phone: "+91 98440 55665", role: "Key Accounts" } },
  { name: "Fenesta uPVC Windows — South Zone", trades: ["Joinery", "uPVC Windows"], city: "Coimbatore", gstin: "33AAGCF4567F1Z6", contact: { name: "Arjun Fernandez", email: "arjun@fenestasouth.example", phone: "+91 98450 66776", role: "Zonal Manager" } },
  { name: "Classic Modular Kitchens & Wardrobes", trades: ["Joinery", "Modular Kitchen", "Wardrobes"], city: "Chennai", gstin: "33AAHCC5678G1Z7", contact: { name: "Deepa Krishnan", email: "deepa@classicmodular.example", phone: "+91 98460 77887", role: "Design Head" } },
  { name: "Hindware Sanitaryware Distributors", trades: ["Plumbing", "Sanitaryware"], city: "Chennai", gstin: "33AAICH6789H1Z8", contact: { name: "Mohammed Rafiq", email: "rafiq@hindwarechennai.example", phone: "+91 98470 88998", role: "Distributor" } },
  { name: "Jaquar CP Fittings — Regional Distribution", trades: ["Plumbing", "CP Fittings"], city: "Chennai", gstin: "33AAJCJ7890I1Z9", contact: { name: "Karthik Subramaniam", email: "karthik@jaquarregional.example", phone: "+91 98480 99009", role: "Area Sales Manager" } },
  { name: "Havells Electrical Wholesale", trades: ["Electrical", "ELV"], city: "Chennai", gstin: "33AAKCH8901J1ZA", contact: { name: "Priyanka Iyer", email: "priyanka@havellswholesale.example", phone: "+91 98490 00110", role: "Wholesale Manager" } },
  { name: "OTIS Elevator Company (India)", trades: ["Vertical Transportation", "Elevators"], city: "Chennai", gstin: "33AALCO9012K1ZB", contact: { name: "Suresh Pillai", email: "suresh.pillai@otisindia.example", phone: "+91 98500 11223", role: "Sales Engineer" } },
  { name: "Dr. Fixit Waterproofing Applicators", trades: ["Waterproofing"], city: "Chennai", gstin: "33AAMCD0123L1ZC", contact: { name: "Ilamathi Selvam", email: "ilamathi@drfixitapplicators.example", phone: "+91 98510 22334", role: "Site Applicator Lead" } },
  { name: "Alucobond Facade Systems", trades: ["Facade", "ACP Cladding"], city: "Chennai", gstin: "33AANCA1234M1ZD", contact: { name: "Farhan Ahmed", email: "farhan@alucobondfacade.example", phone: "+91 98520 33445", role: "Facade Engineer" } },
  { name: "Saint-Gobain Gypsum Solutions", trades: ["Finishes", "False Ceiling"], city: "Chennai", gstin: "33AAOCS2345N1ZE", contact: { name: "Lakshmi Narayanan", email: "lakshmi@saintgobaingypsum.example", phone: "+91 98530 44556", role: "Applicator Partner" } },
  { name: "GreenScape Landscape Contractors", trades: ["Landscape"], city: "Chennai", gstin: "33AAPCG3456O1ZF", contact: { name: "Divya Prakash", email: "divya@greenscapelandscape.example", phone: "+91 98540 55667", role: "Project Lead" } },
  { name: "SecureGuard MS Grills & Railings", trades: ["Joinery", "Railings", "Grills"], city: "Chennai", gstin: "33AAQCS4567P1ZG", contact: { name: "Muthu Vel", email: "muthu@secureguardgrills.example", phone: "+91 98550 66778", role: "Fabrication Head" } },
];

/** Primary supplier for each material code (by name — resolved to id after
 *  suppliers are created). Materials not listed here stay unassigned, same as
 *  real procurement — not everything is sourced from day one. */
const MATERIAL_SUPPLIER: Record<string, string> = {
  "IN-PCC-148": "Sri Ganesh Ready Mix Concrete",
  "IN-RMC-M30": "Sri Ganesh Ready Mix Concrete",
  "IN-RMC-M25": "Sri Ganesh Ready Mix Concrete",
  "IN-PILE-600": "Sri Ganesh Ready Mix Concrete",
  "IN-TMT-FE500": "Anand Steel Traders",
  "IN-AAC-200": "Bharat AAC Blocks Pvt Ltd",
  "IN-AAC-100": "Bharat AAC Blocks Pvt Ltd",
  "IN-VITRIFIED": "Nithya Tiles & Ceramics",
  "IN-CERAMIC-WALL": "Nithya Tiles & Ceramics",
  "IN-ANTISKID": "Nithya Tiles & Ceramics",
  "IN-SKIRTING": "Nithya Tiles & Ceramics",
  "IN-EMULSION-INT": "Coastal Paints & Coatings",
  "IN-EMULSION-EXT": "Coastal Paints & Coatings",
  "IN-PUTTY": "Coastal Paints & Coatings",
  "IN-PLASTER-EXT": "Coastal Paints & Coatings",
  "IN-WINDOW-UPVC": "Fenesta uPVC Windows — South Zone",
  "IN-MOD-KITCHEN": "Classic Modular Kitchens & Wardrobes",
  "IN-WARDROBE": "Classic Modular Kitchens & Wardrobes",
  "IN-SANWARE": "Hindware Sanitaryware Distributors",
  "IN-SINK-KIT": "Hindware Sanitaryware Distributors",
  "IN-CP-FITTING": "Jaquar CP Fittings — Regional Distribution",
  "IN-ELEC-POINT": "Havells Electrical Wholesale",
  "IN-ELEC-DB": "Havells Electrical Wholesale",
  "IN-AC-PROV": "Havells Electrical Wholesale",
  "IN-ELV-POINT": "Havells Electrical Wholesale",
  "IN-EXHAUST-FAN": "Havells Electrical Wholesale",
  "IN-NAMEPLATE-BELL": "Havells Electrical Wholesale",
  "IN-LIFT-8P": "OTIS Elevator Company (India)",
  "IN-LIFT-13P": "OTIS Elevator Company (India)",
  "IN-WP-WET": "Dr. Fixit Waterproofing Applicators",
  "IN-WP-TERRACE": "Dr. Fixit Waterproofing Applicators",
  "IN-ACP": "Alucobond Facade Systems",
  "IN-GYPSUM-CEIL": "Saint-Gobain Gypsum Solutions",
  "IN-LANDSCAPE": "GreenScape Landscape Contractors",
  "IN-RAILING-SS": "SecureGuard MS Grills & Railings",
  "IN-BALCONY-GRILL": "SecureGuard MS Grills & Railings",
};
// materials worth a SECOND (non-preferred) supplier link, for realistic choice
const MATERIAL_SUPPLIER_ALT: Record<string, string> = {
  "IN-VITRIFIED": "Coastal Paints & Coatings", // stand-in second vendor relationship, not a real trade fit — fine for demo depth
  "IN-TMT-FE500": "Sri Ganesh Ready Mix Concrete",
};

// ---------------------------------------------------------------------------
// Sub-groups
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
  { name: "Living & Dining", area: 21, kind: "living" },
  { name: "Kitchen", area: 8.5, kind: "kitchen" },
  { name: "Master Bedroom", area: 13.5, kind: "mbedroom" },
  { name: "Bedroom 2", area: 10.5, kind: "bedroom" },
  { name: "Master Toilet", area: 3.6, kind: "toilet" },
  { name: "Common Bathroom", area: 4, kind: "toilet" },
  { name: "Balcony", area: 4.5, kind: "balcony" },
  { name: "Utility", area: 2.6, kind: "utility" },
];
const ROOMS_3BHK: Room[] = [
  { name: "Foyer", area: 3, kind: "dry" },
  { name: "Living & Dining", area: 26, kind: "living" },
  { name: "Kitchen", area: 10, kind: "kitchen" },
  { name: "Master Bedroom", area: 16, kind: "mbedroom" },
  { name: "Bedroom 2", area: 12.5, kind: "bedroom" },
  { name: "Bedroom 3", area: 11, kind: "bedroom" },
  { name: "Master Toilet", area: 4.4, kind: "toilet" },
  { name: "Toilet 2", area: 3.8, kind: "toilet" },
  { name: "Common Toilet", area: 3.4, kind: "toilet" },
  { name: "Balcony 1", area: 6, kind: "balcony" },
  { name: "Balcony 2", area: 4, kind: "balcony" },
  { name: "Utility", area: 2.8, kind: "utility" },
];

async function insertMany(model: { createMany: (a: { data: any[] }) => Promise<unknown> }, rows: any[], size = 500) {
  for (let i = 0; i < rows.length; i += size) await model.createMany({ data: rows.slice(i, i + size) });
}

async function main() {
  console.log("upserting shared material catalog…");
  const matId = new Map<string, string>();
  for (const m of MATERIALS) {
    const rec = await prisma.material.upsert({ where: { code: m.code }, create: m, update: m });
    matId.set(m.code, rec.id);
  }

  console.log("creating supplier directory (skipping any that already exist by name)…");
  const supplierId = new Map<string, string>();
  for (const s of SUPPLIERS) {
    let rec = await prisma.supplier.findFirst({ where: { name: s.name } });
    if (!rec) {
      rec = await prisma.supplier.create({
        data: {
          name: s.name,
          trades: s.trades,
          city: s.city,
          gstin: s.gstin,
          email: s.contact.email,
          phone: s.contact.phone,
          contacts: { create: [{ ...s.contact, isPrimary: true }] },
        },
      });
    }
    supplierId.set(s.name, rec.id);
  }

  console.log("linking suppliers to materials…");
  const materialSupplierLinks: any[] = [];
  for (const [code, supplierName] of Object.entries(MATERIAL_SUPPLIER)) {
    const materialId = matId.get(code);
    const sid = supplierId.get(supplierName);
    if (materialId && sid) materialSupplierLinks.push({ materialId, supplierId: sid, preferred: true });
  }
  for (const [code, supplierName] of Object.entries(MATERIAL_SUPPLIER_ALT)) {
    const materialId = matId.get(code);
    const sid = supplierId.get(supplierName);
    if (materialId && sid) materialSupplierLinks.push({ materialId, supplierId: sid, preferred: false });
  }
  for (const link of materialSupplierLinks) {
    await prisma.materialSupplier.upsert({
      where: { materialId_supplierId: { materialId: link.materialId, supplierId: link.supplierId } },
      create: link,
      update: { preferred: link.preferred },
    });
  }

  const existing = await prisma.project.findUnique({ where: { code: PROJECT_CODE } });
  if (existing) {
    console.log(`project ${PROJECT_CODE} exists — deleting and recreating`);
    await prisma.project.delete({ where: { id: existing.id } });
  }

  console.log("creating project 'Silver Sands Residency'…");
  const project = await prisma.project.create({
    data: {
      code: PROJECT_CODE,
      name: "Silver Sands Residency",
      description:
        "Gated residential development on ECR (East Coast Road), Chennai. Three towers of 8 floors — 160 apartments (2 & 3 BHK) — with basement parking, clubhouse, swimming pool, gymnasium and full site infrastructure. A fully sourced project: every major material line has a nominated supplier.",
      client: "Silver Sands Developers LLP",
      location: "ECR, Chennai, Tamil Nadu, IN",
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
    const id = `SSR-N-${String(++ns).padStart(5, "0")}`;
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
    const supplierName = o.noSupplier ? undefined : MATERIAL_SUPPLIER[code];
    lines.push({
      id: `SSR-L-${String(++ls).padStart(5, "0")}`,
      nodeId,
      materialId: matId.get(code)!,
      supplierId: supplierName ? supplierId.get(supplierName) ?? null : null,
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
  const E = (nodeId: string, kind: "LABOR" | "EQUIPMENT" | "TRANSPORT" | "OVERHEAD", desc: string, qty: number, rate: number, o: any = {}) => {
    const q = Math.round((qty + Number.EPSILON) * 100) / 100;
    lines.push({
      id: `SSR-L-${String(++ls).padStart(5, "0")}`,
      nodeId,
      materialId: null,
      supplierId: null,
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
  const perim = (area: number) => 4 * Math.sqrt(area);

  // ---- one apartment type, instanced `count` times per floor ----
  function buildApartmentType(parent: string, bhk: 2 | 3, count: number, sort: number) {
    const rooms = bhk === 2 ? ROOMS_2BHK : ROOMS_3BHK;
    const carpetM2 = rooms.reduce((a, r) => a + r.area, 0);
    const carpetSqft = Math.round(carpetM2 * 10.764);
    const bedrooms = rooms.filter((r) => /Bedroom/.test(r.name)).length;
    const toilets = rooms.filter((r) => r.kind === "toilet").length;
    const balconies = rooms.filter((r) => r.kind === "balcony");

    const u = N(bhk === 2 ? "2 BHK Apartment — Type S" : "3 BHK Apartment — Type L", "SUBGROUP", {
      parent,
      qty: count,
      uom: "apt",
      sort,
      ref: bhk === 2 ? "2BHK-S" : "3BHK-L",
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
        L(n, "IN-SKIRTING", perim(r.area), { labor: 25 });
        L(n, "IN-CERAMIC-WALL", wall, { labor: 170, detail: { height: "full-height to false ceiling" } });
        L(n, "IN-CPVC-SET", r.name === "Common Toilet" ? 3 : 5, { labor: 350 });
        L(n, "IN-SANWARE", 1, { labor: 900 });
        L(n, "IN-CP-FITTING", 1, { labor: 600 });
        L(n, "IN-DOOR-TOILET", 1, { labor: 500 });
        L(n, "IN-GYPSUM-CEIL", r.area, { labor: 250 });
        L(n, "IN-ELEC-POINT", 3, { labor: 120, desc: "Light, exhaust, shaver/mirror point" });
        L(n, "IN-EXHAUST-FAN", 1, { labor: 80 });
        if (r.name !== "Common Toilet") L(n, "IN-WH-GEYSER", 1, { labor: 400 });
      } else if (r.kind === "kitchen") {
        const n = N(r.name, "ASSEMBLY", { parent: u, cat: C.finishes, sort: s, uom: "room", attr });
        L(n, "IN-VITRIFIED", r.area, { labor: 190 });
        L(n, "IN-SKIRTING", perim(r.area), { labor: 25 });
        L(n, "IN-CERAMIC-WALL", 6.5, { labor: 170, desc: "Dado above counter" });
        L(n, "IN-EXHAUST-FAN", 1, { labor: 80 });
      } else if (r.kind === "balcony") {
        const n = N(r.name, "ASSEMBLY", { parent: u, cat: C.finishes, sort: s, uom: "room", attr });
        L(n, "IN-ANTISKID", r.area, { labor: 160 });
        L(n, "IN-WP-WET", r.area, { labor: 120, desc: "Balcony deck waterproofing" });
        L(n, "IN-EMULSION-EXT", r.area * 1.6, { labor: 60, desc: "Balcony walls & soffit" });
        L(n, "IN-BALCONY-GRILL", perim(r.area) / 2, { labor: 90 });
      } else if (r.kind === "utility") {
        const n = N(r.name, "ASSEMBLY", { parent: u, cat: C.plumbing, sort: s, uom: "room", attr });
        L(n, "IN-ANTISKID", r.area, { labor: 150 });
        L(n, "IN-SKIRTING", perim(r.area), { labor: 25 });
        L(n, "IN-CERAMIC-WALL", perim(r.area) * 2, { labor: 150 });
        L(n, "IN-CPVC-SET", 2, { labor: 300, desc: "Washing machine + service tap" });
        L(n, "IN-EXHAUST-FAN", 1, { labor: 80 });
      } else {
        // living / dining / bedroom / master bedroom / foyer
        const n = N(r.name, "ASSEMBLY", { parent: u, cat: C.finishes, sort: s, uom: "room", attr });
        if (r.kind === "mbedroom") L(n, "IN-WOOD-LAM", r.area, { labor: 300 });
        else L(n, "IN-VITRIFIED", r.area, { labor: 190 });
        if (r.kind !== "dry") L(n, "IN-SKIRTING", perim(r.area), { labor: 25 });
        if (r.kind === "living" || r.kind === "mbedroom")
          L(n, "IN-GYPSUM-CEIL", r.area * (r.kind === "living" ? 0.55 : 0.4), { labor: 250, desc: "Peripheral / cove false ceiling" });
        if (r.kind === "bedroom" || r.kind === "mbedroom") {
          L(n, "IN-WARDROBE", Math.round(perim(r.area) * 0.6), { labor: 150 });
          L(n, "IN-CURTAIN-ROD", Math.sqrt(r.area) * 1.4, { labor: 40 });
        }
        if (r.kind === "living") L(n, "IN-CURTAIN-ROD", Math.sqrt(r.area) * 1.8, { labor: 40 });
      }
    }

    const plaster = carpetM2 * 3.6;

    const w = N("Internal Walls — Blockwork & Plaster", "ASSEMBLY", { parent: u, cat: C.masonry, sort: (s += 10) });
    L(w, "IN-AAC-200", carpetM2 * 0.85, { labor: 320, desc: "External-wall inner face (200 mm AAC)" });
    L(w, "IN-AAC-100", carpetM2 * 1.15, { labor: 300, desc: "Internal partitions (100 mm AAC)" });
    L(w, "IN-PLASTER-INT", plaster, { labor: 140 });
    L(w, "IN-PUTTY", plaster, { labor: 35 });

    const p = N("Internal Painting", "ASSEMBLY", { parent: u, cat: C.finishes, sort: (s += 10) });
    L(p, "IN-EMULSION-INT", plaster + carpetM2, { labor: 45, desc: "Walls + ceilings, primer + 2 coats" });

    const j = N("Doors & Windows", "ASSEMBLY", { parent: u, cat: C.joinery, sort: (s += 10) });
    L(j, "IN-DOOR-MAIN", 1, { labor: 2000, noSupplier: true });
    L(j, "IN-DOOR-INT", bedrooms + 1, { labor: 600, desc: "Bedrooms + kitchen", noSupplier: true });
    L(j, "IN-WINDOW-UPVC", bhk === 2 ? 8 : 12, { labor: 400 });
    L(j, "IN-RAILING-SS", balconies.reduce((a, r) => a + perim(r.area) / 2, 0), { labor: 250, desc: "Balcony railings" });

    const e = N("Electrical & ELV", "ASSEMBLY", { parent: u, cat: C.electrical, sort: (s += 10) });
    L(e, "IN-ELEC-DB", 1, { labor: 1500 });
    L(e, "IN-ELEC-POINT", bhk === 2 ? 32 : 48, { labor: 120, desc: "Lighting, power, exhaust, bell" });
    L(e, "IN-AC-PROV", bedrooms + 1, { labor: 800, desc: "All bedrooms + living" });
    L(e, "IN-ELV-POINT", bhk === 2 ? 3 : 5, { labor: 150, desc: "TV, data points" });
    L(e, "IN-NAMEPLATE-BELL", 1, { labor: 150 });

    const k = N("Kitchen Fit-out", "ASSEMBLY", { parent: u, cat: C.finishes, sort: (s += 10) });
    L(k, "IN-GRANITE", bhk === 2 ? 8 : 11, { labor: 150 });
    L(k, "IN-MOD-KITCHEN", bhk === 2 ? 10 : 14, { labor: 0 });
    L(k, "IN-SINK-KIT", 1, { labor: 400 });
    L(k, "IN-CPVC-SET", 3, { labor: 350, desc: "Sink, RO, disposal" });
    L(k, "IN-ELEC-POINT", 6, { labor: 120, desc: "Hob, chimney, appliance points" });

    const fr = N("Fire & Safety", "ASSEMBLY", { parent: u, cat: C.firefighting, sort: (s += 10) });
    L(fr, "IN-FIRE-FLAT", 1, { labor: 1200, noSupplier: true });

    E(u, "OVERHEAD", "Quality inspection, snagging & handover documentation", 1, 8500, { uom: "apt", sort: (s += 10) });
    E(u, "OVERHEAD", "Sample-flat-standard finishing check & photography for handover kit", 1, 3200, { uom: "apt", sort: (s += 10) });

    return u;
  }

  // ---- one tower ----
  function buildTower(idx: number, tname: string, bhk: 2 | 3, unitsPerFloor: number, sort: number) {
    const total = unitsPerFloor * 8;
    const f = bhk === 3 ? 1.18 : 1;

    const t = N(`Tower ${String.fromCharCode(64 + idx)} — ${tname}`, "GROUP", {
      sort,
      ref: `T${idx}`,
      notes: `8 residential floors · ${unitsPerFloor} × ${bhk} BHK per floor · ${total} apartments.`,
      attr: { floors: 8, units_per_floor: unitsPerFloor, bhk, total_apartments: total },
    });

    const sub = N("Substructure & Foundations", "SUBGROUP", { parent: t, cat: C.structure, sort: 0 });
    const pil = N("Piling & Pile Caps", "ASSEMBLY", { parent: sub, cat: C.structure, sort: 0 });
    L(pil, "IN-EXC-EARTH", 3100 * f, { labor: 60 });
    L(pil, "IN-PILE-600", 1050 * f, { labor: 400 });
    L(pil, "IN-PCC-148", 105 * f, { labor: 900 });
    L(pil, "IN-RMC-M30", 160 * f, { labor: 800, desc: "Pile caps & tie beams" });
    L(pil, "IN-TMT-FE500", 19500 * f, { labor: 12 });
    const raft = N("Raft Foundation & Basement Retaining Wall", "ASSEMBLY", { parent: sub, cat: C.structure, sort: 10 });
    L(raft, "IN-RMC-M30", 540 * f, { labor: 800 });
    L(raft, "IN-TMT-FE500", 64000 * f, { labor: 12 });
    L(raft, "IN-FORMWORK", 280 * f, { labor: 180, noSupplier: true });
    L(raft, "IN-WP-TERRACE", 460 * f, { labor: 120, desc: "Below-raft & retaining-wall tanking" });

    const sup = N("Superstructure — RCC Frame", "SUBGROUP", { parent: t, cat: C.structure, sort: 10 });
    const slabArea = unitsPerFloor * (bhk === 3 ? 158 : 102) * 1.32;
    const rcc = N("Typical Floor — Columns, Beams & Slab", "ASSEMBLY", {
      parent: sup,
      cat: C.structure,
      qty: 8,
      uom: "floor",
      sort: 0,
      notes: "Identical RCC cycle repeated for all 8 floors.",
    });
    L(rcc, "IN-RMC-M30", slabArea * 0.27, { labor: 850, detail: { mix: "M30", elements: "columns + beams + slab" } });
    L(rcc, "IN-TMT-FE500", slabArea * 0.27 * 108, { labor: 12, detail: { ratio_kg_per_m3: 108 } });
    L(rcc, "IN-FORMWORK", slabArea * 2.2, { labor: 220, noSupplier: true });
    const roof = N("Roof, Terrace, Parapets & OHT", "ASSEMBLY", { parent: sup, cat: C.structure, sort: 10 });
    L(roof, "IN-RMC-M30", 85 * f, { labor: 800 });
    L(roof, "IN-TMT-FE500", 8600 * f, { labor: 12 });
    L(roof, "IN-WP-TERRACE", slabArea / 1.32, { labor: 120 });

    const fac = N("Facade & External Finishes", "SUBGROUP", { parent: t, cat: C.facade, sort: 20 });
    const facArea = bhk === 3 ? 1550 : 1350;
    const ef = N("External Plaster & Texture Paint", "ASSEMBLY", { parent: fac, cat: C.facade, sort: 0 });
    L(ef, "IN-PLASTER-EXT", facArea, { labor: 150 });
    L(ef, "IN-EMULSION-EXT", facArea, { labor: 60 });
    const acp = N("ACP Feature Cladding & Fins", "ASSEMBLY", { parent: fac, cat: C.facade, sort: 10 });
    L(acp, "IN-ACP", bhk === 3 ? 360 : 290, { labor: 350 });
    const lob = N("Double-height Entrance Lobby", "ASSEMBLY", { parent: fac, cat: C.facade, sort: 20 });
    L(lob, "IN-STRUCT-GLAZ", 75, { labor: 600, noSupplier: true });
    L(lob, "IN-STONE-CLAD", 130, { labor: 250, noSupplier: true });

    const vt = N("Lifts, Lobbies & Staircases", "SUBGROUP", { parent: t, cat: C.lifts, sort: 30 });
    const lf = N("Passenger Lifts", "ASSEMBLY", { parent: vt, cat: C.lifts, sort: 0 });
    L(lf, bhk === 3 ? "IN-LIFT-13P" : "IN-LIFT-8P", 2, { labor: 80000, detail: { stops: 9, count: 2 } });
    const cf = N("Lift Lobby & Staircase Finishes (all floors)", "ASSEMBLY", { parent: vt, cat: C.lifts, sort: 10 });
    L(cf, "IN-VITRIFIED", unitsPerFloor * 8 * 2.2, { labor: 190, desc: "Lift-lobby flooring" });
    L(cf, "IN-EMULSION-INT", 8 * 210, { labor: 45 });
    L(cf, "IN-RAILING-SS", 8 * 12, { labor: 250, desc: "Staircase railing" });

    const tm = N("Tower MEP Risers & Common Services", "SUBGROUP", { parent: t, sort: 40 });
    const me = N("Common Electrical — Risers, DBs & Lighting", "ASSEMBLY", { parent: tm, cat: C.electrical, sort: 0 });
    L(me, "IN-ELEC-POINT", unitsPerFloor * 8 * 2 + 120, { labor: 120 });
    L(me, "IN-ELEC-DB", 12, { labor: 1500, desc: "Riser + common-area DBs" });
    const mp = N("Plumbing Risers & Hydro-pneumatic Connections", "ASSEMBLY", { parent: tm, cat: C.plumbing, sort: 10 });
    L(mp, "IN-CPVC-SET", unitsPerFloor * 8 * 3, { labor: 350, desc: "Vertical stack tie-ins per apartment" });
    const mf = N("Tower Fire-fighting Distribution", "ASSEMBLY", { parent: tm, cat: C.firefighting, sort: 20 });
    L(mf, "IN-FIRE-FLAT", unitsPerFloor * 5, { labor: 1200, desc: "Wet-riser branches, landing valves, common detectors", noSupplier: true });

    const cl = N("Construction Logistics & Plant", "SUBGROUP", { parent: t, cat: C.prelims, sort: 45 });
    const plant = N("Plant & Equipment Hire", "ASSEMBLY", { parent: cl, cat: C.prelims, sort: 0 });
    E(plant, "EQUIPMENT", "Tower crane hire incl. erection & dismantling", Math.round(13 * f), 380000, { uom: "month" });
    E(plant, "EQUIPMENT", "Passenger / material hoist hire", Math.round(11 * f), 140000, { uom: "month", sort: 10 });
    E(plant, "EQUIPMENT", "Concrete boom placer & pump hire", Math.round(7 * f), 220000, { uom: "month", sort: 20 });
    E(plant, "EQUIPMENT", "Scaffolding, formwork props & access hire", 1, 1900000 * f, { sort: 30 });
    const haul = N("Site Logistics & Supervision", "ASSEMBLY", { parent: cl, cat: C.prelims, sort: 10 });
    E(haul, "TRANSPORT", "Ready-mix concrete & bulk material haulage to tower", 1, 3600000 * f);
    E(haul, "LABOR", "Tower site-engineering & supervision team", Math.round(15 * f), 280000, { uom: "month", sort: 10 });
    E(haul, "OVERHEAD", "Tower survey, checklists & stage QA documentation", 1, 580000, { sort: 20 });

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

  const infra = N("Site Infrastructure & External Development", "GROUP", { cat: C.infra, sort: 100, notes: "Shared services and external works serving the whole development." });
  const ew = N("Earthwork & Site Grading", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 0 });
  L(ew, "IN-EXC-EARTH", 24000, { labor: 55, noSupplier: true });
  const rd = N("Internal Roads, Driveways & Pavements", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 10 });
  L(rd, "IN-WMM-ROAD", 3900, { labor: 120, noSupplier: true });
  L(rd, "IN-PAVER", 2600, { labor: 180, noSupplier: true });
  const cw = N("Compound Wall, Gates & Guard Houses", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 20 });
  L(cw, "IN-COMPOUND", 560, { labor: 350, noSupplier: true });
  const sdr = N("Storm-water Drainage & Culverts", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 30 });
  L(sdr, "IN-STORMDRAIN", 980, { labor: 250, noSupplier: true });
  const stp = N("Sewage Treatment Plant (150 KLD)", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 40 });
  L(stp, "IN-STP", 1, { labor: 250000, noSupplier: true });
  const wtp = N("Water Treatment Plant & Pump Rooms", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 50 });
  L(wtp, "IN-WTP", 1, { labor: 150000, noSupplier: true });
  const rwh = N("Rainwater Harvesting", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 60 });
  L(rwh, "IN-RWH-PIT", 13, { labor: 4000, noSupplier: true });
  const pss = N("Electrical Sub-station & DG Backup", "ASSEMBLY", { parent: infra, cat: C.infra, sort: 70 });
  L(pss, "IN-TRAFO", 2, { labor: 120000, noSupplier: true });
  L(pss, "IN-DG", 2, { labor: 150000, noSupplier: true });
  const fsy = N("Fire-fighting Infrastructure — pump room & hydrant ring main", "ASSEMBLY", { parent: infra, cat: C.firefighting, sort: 80 });
  L(fsy, "IN-FIRE-SYS", 1, { labor: 0, noSupplier: true });

  const am = N("Common Amenities", "GROUP", { cat: C.amenities, sort: 110 });
  const podium = N("Basement / Podium Parking", "SUBGROUP", { parent: am, cat: C.structure, sort: 0 });
  const pst = N("Podium RCC Structure", "ASSEMBLY", { parent: podium, cat: C.structure, sort: 0 });
  L(pst, "IN-RMC-M30", 1750, { labor: 800 });
  L(pst, "IN-TMT-FE500", 192000, { labor: 12 });
  L(pst, "IN-FORMWORK", 6100, { labor: 200, noSupplier: true });
  const pfin = N("Parking Deck Finishes, Ventilation & Marking", "ASSEMBLY", { parent: podium, cat: C.finishes, sort: 10 });
  L(pfin, "IN-DECK-COAT", 6900, { labor: 120, noSupplier: true });
  L(pfin, "IN-ELEC-POINT", 320, { labor: 120, desc: "Lighting & exhaust points" });
  const club = N("Clubhouse", "SUBGROUP", { parent: am, cat: C.amenities, sort: 10 });
  const cst = N("Clubhouse RCC Structure & Envelope", "ASSEMBLY", { parent: club, cat: C.structure, sort: 0 });
  L(cst, "IN-RMC-M30", 400, { labor: 800 });
  L(cst, "IN-TMT-FE500", 43000, { labor: 12 });
  L(cst, "IN-PLASTER-EXT", 760, { labor: 150 });
  const cfit = N("Clubhouse Interior Fit-out & FF&E", "ASSEMBLY", { parent: club, cat: C.amenities, sort: 10 });
  L(cfit, "IN-CLUB-FITOUT", 980, { labor: 0, noSupplier: true });
  const gym = N("Gymnasium", "ASSEMBLY", { parent: am, cat: C.amenities, sort: 20 });
  L(gym, "IN-GYM", 1, { labor: 0, noSupplier: true });
  const pool = N("Swimming Pool & Deck", "ASSEMBLY", { parent: am, cat: C.amenities, sort: 30 });
  L(pool, "IN-POOL", 190, { labor: 0, noSupplier: true });
  const play = N("Children's Play Area & Landscaped Courts", "ASSEMBLY", { parent: am, cat: C.amenities, sort: 40 });
  L(play, "IN-PLAY", 1, { labor: 0, noSupplier: true });
  const land = N("Landscape, Hardscape & Irrigation", "ASSEMBLY", { parent: am, cat: C.landscape, sort: 50 });
  L(land, "IN-LANDSCAPE", 4400, { labor: 120 });

  const pre = N("Preliminaries, Overheads & Site Establishment", "GROUP", { cat: C.prelims, sort: 90, notes: "Statutory, professional, site-establishment, insurance and logistics costs — no permanent material content." });
  const appr = N("Statutory Approvals & Documentation", "SUBGROUP", { parent: pre, cat: C.prelims, sort: 0 });
  E(appr, "OVERHEAD", "CMDA / DTCP planning permission & scrutiny fees", 1, 5200000);
  E(appr, "OVERHEAD", "Premium FSI, OSR & shelter charges", 1, 11200000, { sort: 10 });
  E(appr, "OVERHEAD", "RERA registration & quarterly compliance", 1, 720000, { sort: 20 });
  E(appr, "OVERHEAD", "Statutory NOCs — fire, CMWSSB, TNEB, AAI height", 1, 2300000, { sort: 30 });
  E(appr, "OVERHEAD", "Legal, title due-diligence & registration support", 160, 6500, { uom: "unit", sort: 40 });
  E(appr, "OVERHEAD", "Building completion & occupancy certificate", 1, 980000, { sort: 50 });
  const cons = N("Design & Professional Consultancy", "SUBGROUP", { parent: pre, cat: C.prelims, sort: 10 });
  E(cons, "OVERHEAD", "Architectural, structural & MEP design consultancy", 1, 16800000);
  E(cons, "OVERHEAD", "Project management consultancy (PMC)", 26, 420000, { uom: "month", sort: 10 });
  E(cons, "OVERHEAD", "Soil investigation & topographic survey", 1, 950000, { sort: 20 });
  E(cons, "OVERHEAD", "IGBC green-building certification & commissioning", 1, 1500000, { sort: 30 });
  const estab = N("Site Establishment & General", "SUBGROUP", { parent: pre, cat: C.prelims, sort: 20 });
  E(estab, "OVERHEAD", "Site office, stores, sample flat & labour colony", 26, 220000, { uom: "month" });
  E(estab, "OVERHEAD", "Temporary power, water, DG & site utilities", 26, 145000, { uom: "month", sort: 10 });
  E(estab, "LABOR", "Site security, hoarding & housekeeping", 26, 130000, { uom: "month", sort: 20 });
  E(estab, "LABOR", "Central project management & planning staff", 26, 480000, { uom: "month", sort: 30 });
  const ins = N("Insurance, Cess & Guarantees", "SUBGROUP", { parent: pre, cat: C.prelims, sort: 30 });
  E(ins, "OVERHEAD", "Contractor's All-Risk (CAR) & third-party insurance", 1, 3200000);
  E(ins, "OVERHEAD", "Building & other construction workers' welfare cess", 1, 4600000, { sort: 10 });
  const log = N("Logistics & Debris Management", "SUBGROUP", { parent: pre, cat: C.prelims, sort: 40 });
  E(log, "TRANSPORT", "Bulk material haulage — steel, cement, blocks, aggregates", 1, 7200000);
  E(log, "TRANSPORT", "Plant & equipment mobilisation / demobilisation", 1, 1900000, { sort: 10 });
  E(log, "TRANSPORT", "Construction debris removal & disposal to approved yard", 1, 2500000, { sort: 20 });

  // Towers — A (2BHK), B (3BHK), C (2BHK, more units/floor)
  buildTower(1, "Azure", 2, 6, 10);
  buildTower(2, "Bay View", 3, 6, 20);
  buildTower(3, "Coral", 2, 8, 30);

  console.log(`inserting ${nodes.length} nodes and ${lines.length} BOM lines…`);
  await insertMany(prisma.node, nodes);
  await insertMany(prisma.bomLine, lines);

  const withSupplier = lines.filter((l) => l.supplierId).length;
  const materialLines = lines.filter((l) => l.kind === "MATERIAL").length;

  let summary: any = null;
  try {
    summary = await fetch(`http://localhost:4000/api/projects/${project.id}/summary`).then((r) => r.json());
  } catch {
    /* API not running — skip the cost read-back */
  }
  const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n)}`);

  console.log(`\ndone: project ${project.code} "${project.name}"`);
  console.log(`  ${nodes.length} nodes · ${lines.length} BOM lines (${materialLines} material lines, ${withSupplier} with a supplier attached)`);
  console.log(`  ${MATERIALS.length} materials in catalog · ${SUPPLIERS.length} suppliers · ${materialSupplierLinks.length} material↔supplier links · ${CATEGORIES.length} sub-groups`);
  if (summary?.total) {
    console.log(`  project cost roll-up: ${inr(summary.total)}`);
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
