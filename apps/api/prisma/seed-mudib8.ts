/**
 * Vehicle DMU sample project — "Mudi B8" (fictional mid-engine V10 supercar, an Audi-R8-alike).
 *
 * One vehicle = one product structure. Top level is the vehicle system (Body, Powertrain,
 * Chassis, …), then subsystems, then components; every component carries its BOM lines
 * (parts with supplier + unit cost). Repeated things (10 pistons, 4 brake corners, 4 wheels…)
 * are modelled as a node quantity, so the roll-up multiplies through the tree. A final
 * "Manufacturing & Programme" group carries assembly labour, tooling, validation, homologation.
 *
 * Run:  cd apps/api && npx tsx prisma/seed-mudib8.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PROJECT_CODE = "MB8-001";
/** Every supplier's contact resolves to this inbox, so RFQs / mails from the demo all land in one place. */
const NOTIFY_EMAIL = "gokul6p@gmail.com";

// ---------------------------------------------------------------------------
// Suppliers (fictional Tier-1/Tier-2 names)
// ---------------------------------------------------------------------------
type SupplierDef = { key: string; name: string; trades: string[]; city: string; contact: { name: string; email: string; phone: string; role: string } };
const SUPPLIERS: SupplierDef[] = [
  { key: "ALU", name: "Rheinwerk Aluminium Extrusions", trades: ["Body", "Aluminium extrusion / casting"], city: "Neckarsulm, DE", contact: { name: "Jonas Keller", email: "j.keller@rheinwerk-alu.example", phone: "+49 7132 555 0101", role: "Key Account Manager" } },
  { key: "FRM", name: "Kaiserform Stamping & Body Panels", trades: ["Body", "Panels"], city: "Ingolstadt, DE", contact: { name: "Petra Vogel", email: "p.vogel@kaiserform.example", phone: "+49 841 555 0102", role: "Programme Manager" } },
  { key: "CFK", name: "Aerofoil Composites", trades: ["Carbon fibre", "Aero"], city: "Modena, IT", contact: { name: "Marco Bellini", email: "m.bellini@aerofoil-composites.example", phone: "+39 059 555 0103", role: "Engineering Sales" } },
  { key: "GLS", name: "Alpenglas Automotive Glass", trades: ["Glazing"], city: "Salzburg, AT", contact: { name: "Katrin Huber", email: "k.huber@alpenglas.example", phone: "+43 662 555 0104", role: "Account Director" } },
  { key: "CST", name: "Falkenberg Powertrain Castings", trades: ["Engine castings", "Machining"], city: "Gyor, HU", contact: { name: "Laszlo Nagy", email: "l.nagy@falkenberg-pt.example", phone: "+36 96 555 0105", role: "Sales Engineer" } },
  { key: "MCH", name: "Bergmann Precision Drivetrain", trades: ["Crank / rods / pistons", "Gears"], city: "Stuttgart, DE", contact: { name: "Stefan Bergmann", email: "s.bergmann@bergmann-precision.example", phone: "+49 711 555 0106", role: "Director Sales" } },
  { key: "TRN", name: "Tessler Transmission Systems", trades: ["DCT", "AWD", "Driveline"], city: "Friedrichshafen, DE", contact: { name: "Anja Tessler", email: "a.tessler@tessler-trans.example", phone: "+49 7541 555 0107", role: "Programme Lead" } },
  { key: "EXH", name: "Ostermann Exhaust & Emissions", trades: ["Exhaust", "Aftertreatment"], city: "Graz, AT", contact: { name: "Felix Ostermann", email: "f.ostermann@ostermann-exhaust.example", phone: "+43 316 555 0108", role: "Sales Manager" } },
  { key: "THM", name: "Thermovent Cooling Systems", trades: ["Cooling", "HVAC"], city: "Heilbronn, DE", contact: { name: "Ingrid Braun", email: "i.braun@thermovent.example", phone: "+49 7131 555 0109", role: "Account Manager" } },
  { key: "SUS", name: "Kestrel Suspension Dynamics", trades: ["Suspension", "Dampers", "Steering"], city: "Coventry, UK", contact: { name: "Oliver Marsh", email: "o.marsh@kestrel-dynamics.example", phone: "+44 24 5550 0110", role: "OEM Sales" } },
  { key: "BRK", name: "Halden Brake Systems", trades: ["Brakes", "Carbon-ceramic"], city: "Gothenburg, SE", contact: { name: "Erik Halden", email: "e.halden@halden-brakes.example", phone: "+46 31 555 0111", role: "Technical Sales" } },
  { key: "WHL", name: "Ravello Wheels & Tyres", trades: ["Wheels", "Tyres"], city: "Milan, IT", contact: { name: "Giulia Ravello", email: "g.ravello@ravello-wheels.example", phone: "+39 02 555 0112", role: "OEM Account Manager" } },
  { key: "ELX", name: "Nordlicht Electronics", trades: ["ECUs", "Infotainment", "Sensors"], city: "Hamburg, DE", contact: { name: "Lars Nordlicht", email: "l.nordlicht@nordlicht-elec.example", phone: "+49 40 555 0113", role: "Key Account Manager" } },
  { key: "WIR", name: "Kobold Wiring Systems", trades: ["Harness", "Connectors", "Battery"], city: "Timisoara, RO", contact: { name: "Radu Ionescu", email: "r.ionescu@kobold-wiring.example", phone: "+40 256 555 0114", role: "Sales Manager" } },
  { key: "LGT", name: "Lumen Optik Lighting", trades: ["Lighting"], city: "Reutlingen, DE", contact: { name: "Sabine Wolf", email: "s.wolf@lumen-optik.example", phone: "+49 7121 555 0115", role: "Programme Manager" } },
  { key: "INT", name: "Sattler Interiors", trades: ["Seats", "Leather", "Trim"], city: "Munich, DE", contact: { name: "Thomas Sattler", email: "t.sattler@sattler-interiors.example", phone: "+49 89 555 0116", role: "Managing Director" } },
  { key: "SAF", name: "Vigil Safety Systems", trades: ["Airbags", "Restraints"], city: "Lyon, FR", contact: { name: "Claire Dubois", email: "c.dubois@vigil-safety.example", phone: "+33 4 5550 0117", role: "Sales Engineer" } },
  { key: "FST", name: "Bolt & Bracket Fastening GmbH", trades: ["Fasteners", "Clips", "Seals"], city: "Wolfsburg, DE", contact: { name: "Uwe Schmitt", email: "u.schmitt@boltbracket.example", phone: "+49 5361 555 0118", role: "Distribution Manager" } },
  { key: "CHM", name: "Chemtrix Fluids & Coatings", trades: ["Paint", "Fluids", "Adhesives"], city: "Antwerp, BE", contact: { name: "Sofie Peeters", email: "s.peeters@chemtrix.example", phone: "+32 3 555 0119", role: "Technical Sales" } },
];

// ---------------------------------------------------------------------------
// Product structure data
//   Part = [code, name, unitCost USD, qty per component, supplier key, uom?]
// ---------------------------------------------------------------------------
type Part = [string, string, number, number, string, string?];
type Comp = { n: string; q?: number; ref?: string; note?: string; attr?: Record<string, unknown>; parts: Part[] };
type Sub = { n: string; note?: string; comps: Comp[] };
type Sys = { key: string; label: string; color: string; ref: string; note: string; subs: Sub[] };

const SYSTEMS: Sys[] = [
  // ------------------------------------------------------------------ BODY
  {
    key: "body", label: "Body & Structure", color: "#64748b", ref: "100",
    note: "Aluminium space-frame body-in-white with carbon-fibre reinforced tunnel and rear bulkhead.",
    subs: [
      { n: "Space-frame BIW", comps: [
        { n: "Front Structure & Crash Rails", parts: [
          ["MB8-BIW-001", "Front longitudinal crash rail, extruded 6082 Al (L/R pair)", 410, 1, "ALU"],
          ["MB8-BIW-002", "Front crash box + bumper beam assy", 380, 1, "ALU"],
          ["MB8-BIW-003", "Front shock-tower casting, HPDC Al (L/R pair)", 620, 1, "ALU"],
          ["MB8-BIW-004", "Front subframe mounting node", 145, 2, "ALU"],
        ]},
        { n: "Centre Tunnel & Sills", parts: [
          ["MB8-BIW-010", "CFRP centre tunnel monocoque", 3200, 1, "CFK"],
          ["MB8-BIW-011", "Side sill extrusion, multi-chamber (L/R pair)", 540, 1, "ALU"],
          ["MB8-BIW-012", "B-pillar reinforcement, hot-formed (L/R pair)", 390, 1, "FRM"],
          ["MB8-BIW-013", "Floor pan panel, Al sheet", 460, 1, "FRM"],
        ]},
        { n: "Rear Structure & Engine Bay", parts: [
          ["MB8-BIW-020", "Rear crash rail, extruded (L/R pair)", 395, 1, "ALU"],
          ["MB8-BIW-021", "Rear shock-tower casting (L/R pair)", 640, 1, "ALU"],
          ["MB8-BIW-022", "CFRP rear bulkhead / firewall", 1850, 1, "CFK"],
          ["MB8-BIW-023", "Engine cradle subframe, cast Al", 980, 1, "ALU"],
          ["MB8-BIW-024", "Sideblade air-intake bracket + mesh", 210, 2, "FRM"],
        ]},
        { n: "Roof & Pillars", parts: [
          ["MB8-BIW-030", "Roof panel, Al sheet", 520, 1, "FRM"],
          ["MB8-BIW-031", "A-pillar tube, hydro-formed (L/R pair)", 440, 1, "ALU"],
          ["MB8-BIW-032", "Roof rail extrusion (L/R pair)", 280, 1, "ALU"],
          ["MB8-BIW-033", "Windscreen header beam", 130, 1, "ALU"],
        ]},
      ]},
      { n: "Closures & Outer Panels", comps: [
        { n: "Door Assembly", q: 2, ref: "DOOR", note: "Left and right door, identical BOM (mirrored parts share part number).", parts: [
          ["MB8-DR-001", "Door outer skin, Al sheet", 340, 1, "FRM"],
          ["MB8-DR-002", "Door inner structure, cast Al", 420, 1, "ALU"],
          ["MB8-DR-003", "Side-impact beam, ultra-high-strength steel", 95, 1, "FRM"],
          ["MB8-DR-004", "Window regulator + motor", 185, 1, "ELX"],
          ["MB8-DR-005", "Frameless window glass, tempered", 165, 1, "GLS"],
          ["MB8-DR-006", "Door latch + soft-close actuator", 210, 1, "FST"],
          ["MB8-DR-007", "Door hinge set (upper + lower)", 155, 1, "FST"],
          ["MB8-DR-008", "Exterior door handle, flush pop-out", 175, 1, "ELX"],
          ["MB8-DR-009", "Door seals (primary + secondary)", 58, 1, "FST"],
        ]},
        { n: "Front Lid (Frunk)", parts: [
          ["MB8-FL-001", "Front lid outer panel, Al", 360, 1, "FRM"],
          ["MB8-FL-002", "Front lid inner structure", 210, 1, "FRM"],
          ["MB8-FL-003", "Gas struts (pair)", 48, 1, "FST"],
          ["MB8-FL-004", "Latch + release cable", 72, 1, "FST"],
        ]},
        { n: "Engine Cover & Rear Lid", parts: [
          ["MB8-RL-001", "Engine cover, CFRP visible weave", 1450, 1, "CFK"],
          ["MB8-RL-002", "Glass engine-bay window", 310, 1, "GLS"],
          ["MB8-RL-003", "Rear lid hinge + strut set", 190, 1, "FST"],
        ]},
        { n: "Fenders & Side Blades", parts: [
          ["MB8-FD-001", "Front fender panel, Al (L/R pair)", 520, 1, "FRM"],
          ["MB8-FD-002", "Side blade, CFRP (L/R pair)", 1180, 1, "CFK"],
          ["MB8-FD-003", "Rear quarter panel, Al (L/R pair)", 640, 1, "FRM"],
        ]},
      ]},
      { n: "Glazing", comps: [
        { n: "Windscreen & Rear Glass", parts: [
          ["MB8-GL-001", "Laminated windscreen, acoustic + IR-reflective + HUD zone", 620, 1, "GLS"],
          ["MB8-GL-002", "Rear backlight, tempered, heated", 240, 1, "GLS"],
          ["MB8-GL-003", "Rain / light sensor module", 65, 1, "ELX"],
        ]},
        { n: "Mirrors", parts: [
          ["MB8-MR-001", "Exterior mirror assy, heated, folding (L/R pair)", 720, 1, "ELX"],
          ["MB8-MR-002", "Interior auto-dimming mirror", 140, 1, "ELX"],
        ]},
      ]},
    ],
  },
  // ------------------------------------------------------------ POWERTRAIN
  {
    key: "pt", label: "Powertrain", color: "#dc2626", ref: "200",
    note: "5.2 L naturally-aspirated V10, 7-speed dual-clutch, permanent all-wheel drive.",
    subs: [
      { n: "5.2 L V10 Engine", note: "90° V10, dry sump, direct + port injection, ~610 PS.", comps: [
        { n: "Engine Block & Crankcase", parts: [
          ["MB8-EN-001", "Cylinder block, LPDC Al + Alusil bores", 2900, 1, "CST"],
          ["MB8-EN-002", "Lower crankcase / bedplate", 950, 1, "CST"],
          ["MB8-EN-003", "Main bearing shells (set of 6)", 160, 1, "MCH"],
        ]},
        { n: "Rotating Assembly", parts: [
          ["MB8-EN-010", "Crankshaft, forged steel, 72° pin offset", 1750, 1, "MCH"],
          ["MB8-EN-011", "Connecting rod, forged Ti", 165, 10, "MCH"],
          ["MB8-EN-012", "Piston, forged Al + rings + pin", 92, 10, "MCH"],
          ["MB8-EN-013", "Flywheel / dual-mass damper", 430, 1, "MCH"],
        ]},
        { n: "Cylinder Heads & Valvetrain", q: 2, ref: "HEAD", note: "One head per bank.", parts: [
          ["MB8-EN-020", "Cylinder head casting, machined", 1320, 1, "CST"],
          ["MB8-EN-021", "Camshaft, intake + exhaust", 340, 2, "MCH"],
          ["MB8-EN-022", "Intake valve, Ti", 34, 5, "MCH"],
          ["MB8-EN-023", "Exhaust valve, Na-filled", 41, 5, "MCH"],
          ["MB8-EN-024", "Valve spring + retainer set", 12, 10, "MCH"],
          ["MB8-EN-025", "Hydraulic tappet / finger follower", 9, 10, "MCH"],
          ["MB8-EN-026", "Cam-phasing actuator", 145, 2, "MCH"],
        ]},
        { n: "Fuel & Ignition", parts: [
          ["MB8-EN-030", "High-pressure fuel pump", 380, 1, "ELX"],
          ["MB8-EN-031", "Direct injector", 88, 10, "ELX"],
          ["MB8-EN-032", "Port injector", 31, 10, "ELX"],
          ["MB8-EN-033", "Coil-on-plug ignition coil", 42, 10, "ELX"],
          ["MB8-EN-034", "Spark plug, iridium", 14, 10, "ELX"],
          ["MB8-EN-035", "Fuel rail set (HP + LP)", 260, 1, "CST"],
        ]},
        { n: "Intake System", parts: [
          ["MB8-EN-040", "Intake plenum, composite, variable-length", 720, 1, "CST"],
          ["MB8-EN-041", "Throttle body, electronic", 260, 1, "ELX"],
          ["MB8-EN-042", "Air filter housing + element", 180, 1, "THM"],
          ["MB8-EN-043", "MAF sensor", 68, 1, "ELX"],
        ]},
        { n: "Lubrication (Dry Sump)", parts: [
          ["MB8-EN-050", "Dry-sump scavenge + pressure pump assy", 1100, 1, "CST"],
          ["MB8-EN-051", "Oil tank, cast Al", 340, 1, "CST"],
          ["MB8-EN-052", "Oil cooler", 260, 1, "THM"],
          ["MB8-EN-053", "Oil filter cartridge", 18, 1, "THM"],
        ]},
        { n: "Timing Drive & Front End", parts: [
          ["MB8-EN-060", "Timing chain set + tensioners + guides", 520, 1, "MCH"],
          ["MB8-EN-061", "Front cover / accessory drive housing", 310, 1, "CST"],
          ["MB8-EN-062", "Serpentine belt + tensioner", 85, 1, "MCH"],
          ["MB8-EN-063", "Alternator, 180 A", 290, 1, "ELX"],
          ["MB8-EN-064", "Starter motor", 210, 1, "ELX"],
          ["MB8-EN-065", "A/C compressor", 340, 1, "THM"],
        ]},
      ]},
      { n: "Exhaust & Aftertreatment", comps: [
        { n: "Exhaust Line", q: 2, ref: "EXH-BANK", note: "One line per bank, joined at the valved rear silencer.", parts: [
          ["MB8-EX-001", "Exhaust manifold, stainless", 420, 1, "EXH"],
          ["MB8-EX-002", "Catalytic converter, close-coupled + underfloor", 780, 1, "EXH"],
          ["MB8-EX-003", "Gasoline particulate filter", 460, 1, "EXH"],
          ["MB8-EX-004", "Mid pipe + flex joint", 190, 1, "EXH"],
          ["MB8-EX-005", "Lambda sensor", 62, 2, "ELX"],
        ]},
        { n: "Rear Silencer & Tips", parts: [
          ["MB8-EX-010", "Active-flap rear silencer", 640, 1, "EXH"],
          ["MB8-EX-011", "Exhaust flap actuator", 95, 2, "EXH"],
          ["MB8-EX-012", "Tailpipe trim, polished stainless", 165, 2, "EXH"],
        ]},
      ]},
      { n: "Transmission & Driveline", comps: [
        { n: "7-speed Dual-Clutch Transmission", parts: [
          ["MB8-TR-001", "DCT housing set (bell + main + rear), cast Mg", 1400, 1, "TRN"],
          ["MB8-TR-002", "Dual wet-clutch pack", 1650, 1, "TRN"],
          ["MB8-TR-003", "Gear cluster (7 fwd + reverse), shafts + synchros", 2900, 1, "TRN"],
          ["MB8-TR-004", "Mechatronic shift + clutch actuator unit", 1250, 1, "TRN"],
          ["MB8-TR-005", "Transmission oil pump + cooler", 310, 1, "TRN"],
          ["MB8-TR-006", "TCU (transmission control unit)", 520, 1, "ELX"],
        ]},
        { n: "All-Wheel Drive", parts: [
          ["MB8-AW-001", "Front differential, open + viscous coupling", 980, 1, "TRN"],
          ["MB8-AW-002", "Rear limited-slip differential", 1150, 1, "TRN"],
          ["MB8-AW-003", "Propeller shaft, CFRP tube + CV joints", 890, 1, "TRN"],
          ["MB8-AW-004", "Haldex-type multi-plate coupling + control", 760, 1, "TRN"],
        ]},
        { n: "Driveshafts", q: 4, ref: "CV", note: "Front L/R + rear L/R half-shafts.", parts: [
          ["MB8-DS-001", "Half-shaft, forged with inboard + outboard CV joint", 210, 1, "TRN"],
        ]},
        { n: "Engine & Gearbox Mounts", parts: [
          ["MB8-MT-001", "Active hydraulic engine mount", 240, 2, "SUS"],
          ["MB8-MT-002", "Transmission mount, rubber-metal", 90, 2, "SUS"],
        ]},
      ]},
    ],
  },
  // --------------------------------------------------------------- CHASSIS
  {
    key: "chassis", label: "Chassis", color: "#0ea5e9", ref: "300",
    note: "Double-wishbone front and rear, magnetic dampers, carbon-ceramic brakes, electro-mechanical steering.",
    subs: [
      { n: "Front Suspension", comps: [
        { n: "Front Double-Wishbone Corner", q: 2, ref: "FR-CORNER", parts: [
          ["MB8-SF-001", "Upper wishbone, forged Al", 210, 1, "SUS"],
          ["MB8-SF-002", "Lower wishbone, forged Al", 245, 1, "SUS"],
          ["MB8-SF-003", "Steering knuckle / wheel carrier, forged Al", 320, 1, "SUS"],
          ["MB8-SF-004", "Magnetic-ride damper + coil spring", 690, 1, "SUS"],
          ["MB8-SF-005", "Wheel bearing hub unit", 155, 1, "SUS"],
          ["MB8-SF-006", "Bushing & ball-joint set", 96, 1, "SUS"],
        ]},
        { n: "Front Anti-Roll Bar & Subframe", parts: [
          ["MB8-SF-010", "Front subframe, cast Al", 780, 1, "ALU"],
          ["MB8-SF-011", "Anti-roll bar, hollow steel + drop links", 240, 1, "SUS"],
        ]},
      ]},
      { n: "Rear Suspension", comps: [
        { n: "Rear Double-Wishbone Corner", q: 2, ref: "RR-CORNER", parts: [
          ["MB8-SR-001", "Upper wishbone, forged Al", 230, 1, "SUS"],
          ["MB8-SR-002", "Lower wishbone, forged Al", 270, 1, "SUS"],
          ["MB8-SR-003", "Toe link", 120, 1, "SUS"],
          ["MB8-SR-004", "Rear knuckle, forged Al", 340, 1, "SUS"],
          ["MB8-SR-005", "Magnetic-ride damper + coil spring", 720, 1, "SUS"],
          ["MB8-SR-006", "Wheel bearing hub unit", 165, 1, "SUS"],
        ]},
        { n: "Rear Anti-Roll Bar", parts: [
          ["MB8-SR-010", "Rear anti-roll bar + drop links", 210, 1, "SUS"],
        ]},
      ]},
      { n: "Braking System", comps: [
        { n: "Front Brake Corner (Carbon-Ceramic)", q: 2, ref: "BRK-F", parts: [
          ["MB8-BR-001", "Carbon-ceramic disc 380 mm, vented", 3400, 1, "BRK"],
          ["MB8-BR-002", "8-piston fixed caliper", 880, 1, "BRK"],
          ["MB8-BR-003", "Brake pad set, ceramic", 220, 1, "BRK"],
          ["MB8-BR-004", "Brake hose, braided", 38, 1, "BRK"],
        ]},
        { n: "Rear Brake Corner (Carbon-Ceramic)", q: 2, ref: "BRK-R", parts: [
          ["MB8-BR-010", "Carbon-ceramic disc 356 mm, vented", 2900, 1, "BRK"],
          ["MB8-BR-011", "6-piston fixed caliper", 720, 1, "BRK"],
          ["MB8-BR-012", "Brake pad set, ceramic", 190, 1, "BRK"],
          ["MB8-BR-013", "Electric parking-brake actuator", 210, 1, "BRK"],
        ]},
        { n: "Hydraulics & Control", parts: [
          ["MB8-BR-020", "Master cylinder + electro-mechanical booster", 690, 1, "BRK"],
          ["MB8-BR-021", "ESC hydraulic unit + ECU", 980, 1, "BRK"],
          ["MB8-BR-022", "Wheel-speed sensor", 32, 4, "ELX"],
          ["MB8-BR-023", "Brake fluid reservoir + lines set", 140, 1, "BRK"],
        ]},
      ]},
      { n: "Steering", comps: [
        { n: "Steering Gear & Column", parts: [
          ["MB8-ST-001", "Electro-mechanical rack, variable ratio", 920, 1, "SUS"],
          ["MB8-ST-002", "Tie-rod + ball joint (pair)", 110, 1, "SUS"],
          ["MB8-ST-003", "Steering column, electric rake/reach, collapsible", 540, 1, "SUS"],
          ["MB8-ST-004", "Steering wheel, flat-bottom, Alcantara + multifunction", 640, 1, "INT"],
        ]},
      ]},
      { n: "Wheels & Tyres", comps: [
        { n: "Wheel & Tyre Assy — Front", q: 2, ref: "WT-F", parts: [
          ["MB8-WH-001", "Forged alloy wheel 19×8.5", 690, 1, "WHL"],
          ["MB8-WH-002", "Tyre 245/35 R19 UHP", 310, 1, "WHL"],
          ["MB8-WH-003", "TPMS sensor", 46, 1, "ELX"],
        ]},
        { n: "Wheel & Tyre Assy — Rear", q: 2, ref: "WT-R", parts: [
          ["MB8-WH-010", "Forged alloy wheel 20×11", 780, 1, "WHL"],
          ["MB8-WH-011", "Tyre 295/30 R20 UHP", 385, 1, "WHL"],
          ["MB8-WH-012", "TPMS sensor", 46, 1, "ELX"],
        ]},
        { n: "Wheel Fixings", parts: [
          ["MB8-WH-020", "Wheel bolt (centre-lock nut on option)", 4.5, 20, "FST"],
          ["MB8-WH-021", "Centre cap + valve", 22, 4, "WHL"],
        ]},
      ]},
    ],
  },
  // ------------------------------------------------------ ELECTRICAL / ELEC
  {
    key: "elec", label: "Electrical & Electronics", color: "#eab308", ref: "400",
    note: "12 V architecture with central gateway, ~55 ECUs, matrix LED lighting.",
    subs: [
      { n: "Power Supply & Harness", comps: [
        { n: "Battery & Power Distribution", parts: [
          ["MB8-PW-001", "12 V 80 Ah AGM battery", 240, 1, "WIR"],
          ["MB8-PW-002", "Battery management sensor + cutoff", 88, 1, "WIR"],
          ["MB8-PW-003", "Fuse & relay box, front + rear", 165, 2, "WIR"],
          ["MB8-PW-004", "Heavy-gauge power cable set", 210, 1, "WIR"],
        ]},
        { n: "Main Wiring Harness", parts: [
          ["MB8-HR-001", "Engine bay harness", 460, 1, "WIR"],
          ["MB8-HR-002", "Cockpit / dash harness", 620, 1, "WIR"],
          ["MB8-HR-003", "Floor / tunnel harness", 380, 1, "WIR"],
          ["MB8-HR-004", "Door harness", 130, 2, "WIR"],
          ["MB8-HR-005", "Rear harness (lighting, sensors)", 260, 1, "WIR"],
          ["MB8-HR-006", "Connector + terminal kit", 140, 1, "WIR"],
        ]},
      ]},
      { n: "Control Units", comps: [
        { n: "Engine, Chassis & Body Controllers", parts: [
          ["MB8-EC-001", "Engine control unit (ECU)", 780, 1, "ELX"],
          ["MB8-EC-002", "Central gateway + domain controller", 950, 1, "ELX"],
          ["MB8-EC-003", "Body control module", 410, 1, "ELX"],
          ["MB8-EC-004", "Airbag control unit", 260, 1, "SAF"],
          ["MB8-EC-005", "Door control module", 92, 2, "ELX"],
        ]},
        { n: "Driver Assistance Sensors", parts: [
          ["MB8-AD-001", "Front camera module", 260, 1, "ELX"],
          ["MB8-AD-002", "Front long-range radar", 340, 1, "ELX"],
          ["MB8-AD-003", "Corner radar (rear L/R)", 210, 2, "ELX"],
          ["MB8-AD-004", "Ultrasonic parking sensor", 28, 12, "ELX"],
          ["MB8-AD-005", "Surround-view camera", 85, 4, "ELX"],
        ]},
      ]},
      { n: "Lighting", comps: [
        { n: "Headlamp Assembly", q: 2, ref: "HL", parts: [
          ["MB8-LT-001", "Matrix LED headlamp module", 780, 1, "LGT"],
          ["MB8-LT-002", "Headlamp control / driver electronics", 120, 1, "LGT"],
        ]},
        { n: "Tail Lamp Assembly", q: 2, ref: "TL", parts: [
          ["MB8-LT-010", "Sequential LED tail-lamp", 340, 1, "LGT"],
        ]},
        { n: "Exterior Auxiliary & Interior Lighting", parts: [
          ["MB8-LT-020", "High-mount stop lamp", 42, 1, "LGT"],
          ["MB8-LT-021", "Number-plate lamp set", 24, 1, "LGT"],
          ["MB8-LT-022", "Ambient LED strip set", 155, 1, "LGT"],
          ["MB8-LT-023", "Puddle lamp (in door mirror)", 18, 2, "LGT"],
        ]},
      ]},
      { n: "Infotainment & Instrumentation", comps: [
        { n: "Virtual Cockpit & Infotainment", parts: [
          ["MB8-IN-001", "12.3-inch digital instrument cluster", 690, 1, "ELX"],
          ["MB8-IN-002", "Head-unit + 10.1-inch touch display", 780, 1, "ELX"],
          ["MB8-IN-003", "Head-up display module", 520, 1, "ELX"],
          ["MB8-IN-004", "Amplifier + 13-speaker sound system", 860, 1, "ELX"],
          ["MB8-IN-005", "Telematics / 5G modem + antenna set", 310, 1, "ELX"],
        ]},
      ]},
    ],
  },
  // -------------------------------------------------------------- INTERIOR
  {
    key: "int", label: "Interior & Safety", color: "#8b5cf6", ref: "500",
    note: "Two-seat cockpit with fixed-shell sport seats, full leather and carbon trim.",
    subs: [
      { n: "Seats", comps: [
        { n: "Sport Seat", q: 2, ref: "SEAT", parts: [
          ["MB8-SE-001", "Seat frame, Mg + steel", 480, 1, "INT"],
          ["MB8-SE-002", "Seat adjuster motors + rails (8-way)", 360, 1, "INT"],
          ["MB8-SE-003", "Nappa leather cover + foam set", 620, 1, "INT"],
          ["MB8-SE-004", "Seat heating + ventilation module", 190, 1, "INT"],
          ["MB8-SE-005", "Seat-belt assy (3-point, pretensioner)", 210, 1, "SAF"],
        ]},
      ]},
      { n: "Cockpit & Trim", comps: [
        { n: "Instrument Panel", parts: [
          ["MB8-IP-001", "Instrument panel carrier, Mg", 280, 1, "INT"],
          ["MB8-IP-002", "IP skin, leather-wrapped", 520, 1, "INT"],
          ["MB8-IP-003", "Air-vent set, aluminium", 180, 1, "INT"],
          ["MB8-IP-004", "Glove-box assy", 65, 1, "INT"],
        ]},
        { n: "Centre Console & Controls", parts: [
          ["MB8-CN-001", "Centre console structure + trim, CFRP", 640, 1, "CFK"],
          ["MB8-CN-002", "Drive-mode selector + shift paddles set", 240, 1, "INT"],
          ["MB8-CN-003", "HVAC control panel", 190, 1, "THM"],
          ["MB8-CN-004", "Cup-holder + storage bin", 38, 1, "INT"],
        ]},
        { n: "Door Trim", q: 2, ref: "DTRIM", parts: [
          ["MB8-DT-001", "Door trim panel, leather + Alcantara", 310, 1, "INT"],
          ["MB8-DT-002", "Door speaker + tweeter", 78, 1, "ELX"],
          ["MB8-DT-003", "Switch pack (window / mirror)", 74, 1, "ELX"],
        ]},
        { n: "Floor, Headliner & Pillar Trim", parts: [
          ["MB8-FT-001", "Carpet set, tufted", 260, 1, "INT"],
          ["MB8-FT-002", "Headliner, Alcantara", 480, 1, "INT"],
          ["MB8-FT-003", "A / B / C-pillar trim set", 190, 1, "INT"],
          ["MB8-FT-004", "Sound-deadening + insulation set", 210, 1, "INT"],
        ]},
      ]},
      { n: "Passive Safety", comps: [
        { n: "Airbag System", parts: [
          ["MB8-AB-001", "Driver airbag module", 180, 1, "SAF"],
          ["MB8-AB-002", "Passenger airbag module", 210, 1, "SAF"],
          ["MB8-AB-003", "Side thorax airbag", 95, 2, "SAF"],
          ["MB8-AB-004", "Knee airbag", 82, 2, "SAF"],
          ["MB8-AB-005", "Crash sensor (front / side)", 36, 4, "SAF"],
        ]},
      ]},
      { n: "Climate Control (HVAC)", comps: [
        { n: "HVAC Module & Ducting", parts: [
          ["MB8-HV-001", "HVAC module (evaporator + heater core + blower)", 620, 1, "THM"],
          ["MB8-HV-002", "Cabin air duct set", 110, 1, "THM"],
          ["MB8-HV-003", "Cabin filter + housing", 42, 1, "THM"],
          ["MB8-HV-004", "A/C condenser", 210, 1, "THM"],
          ["MB8-HV-005", "A/C lines + expansion valve", 165, 1, "THM"],
        ]},
      ]},
    ],
  },
  // -------------------------------------------------------- THERMAL / FLUIDS
  {
    key: "therm", label: "Thermal & Fluids", color: "#10b981", ref: "600",
    note: "Three-circuit engine cooling, dry-sump oil, front + side radiators.",
    subs: [
      { n: "Engine Cooling", comps: [
        { n: "Radiators & Fans", parts: [
          ["MB8-CL-001", "Front radiator, aluminium", 410, 1, "THM"],
          ["MB8-CL-002", "Side radiator (L/R) for engine cooling", 280, 2, "THM"],
          ["MB8-CL-003", "Electric cooling fan + shroud", 220, 2, "THM"],
          ["MB8-CL-004", "Expansion tank + cap", 58, 1, "THM"],
        ]},
        { n: "Coolant Circuit", parts: [
          ["MB8-CL-010", "Electric water pump (main)", 260, 1, "THM"],
          ["MB8-CL-011", "Thermostat + valve module", 145, 1, "THM"],
          ["MB8-CL-012", "Coolant hose + pipe set", 190, 1, "THM"],
        ]},
      ]},
      { n: "Fluids (initial fill)", comps: [
        { n: "Initial Fill Fluids", parts: [
          ["MB8-FL-101", "Engine oil 0W-40, 10 L", 12, 10, "CHM", "L"],
          ["MB8-FL-102", "Coolant 50/50, 14 L", 5, 14, "CHM", "L"],
          ["MB8-FL-103", "Brake fluid DOT 5.1, 1.2 L", 14, 1.2, "CHM", "L"],
          ["MB8-FL-104", "DCT transmission oil, 6 L", 28, 6, "CHM", "L"],
          ["MB8-FL-105", "Diff & AWD oil, 3 L", 24, 3, "CHM", "L"],
          ["MB8-FL-106", "Refrigerant R1234yf, 0.6 kg", 65, 0.6, "CHM", "kg"],
          ["MB8-FL-107", "Screen-wash concentrate, 3 L", 3, 3, "CHM", "L"],
        ]},
      ]},
      { n: "Fuel System", comps: [
        { n: "Fuel Tank & Lines", parts: [
          ["MB8-FS-001", "Fuel tank, HDPE, 83 L", 320, 1, "EXH"],
          ["MB8-FS-002", "In-tank pump + sender module", 180, 1, "ELX"],
          ["MB8-FS-003", "Fuel line set + quick-connectors", 96, 1, "EXH"],
          ["MB8-FS-004", "Evap canister + purge valve", 120, 1, "EXH"],
          ["MB8-FS-005", "Fuel filler neck + cap", 60, 1, "EXH"],
        ]},
      ]},
    ],
  },
  // ------------------------------------------------------ EXTERIOR / AERO
  {
    key: "ext", label: "Exterior & Aero", color: "#f59e0b", ref: "700",
    note: "Sculpted bumpers, active rear spoiler and flat underbody with rear diffuser.",
    subs: [
      { n: "Bumpers & Fascias", comps: [
        { n: "Front Bumper Assy", parts: [
          ["MB8-BP-001", "Front bumper cover, painted PP/PC", 420, 1, "FRM"],
          ["MB8-BP-002", "Front splitter, CFRP", 640, 1, "CFK"],
          ["MB8-BP-003", "Front grille + inlet mesh set", 180, 1, "FRM"],
          ["MB8-BP-004", "Headlamp washer nozzle set", 48, 1, "FST"],
        ]},
        { n: "Rear Bumper Assy", parts: [
          ["MB8-BP-010", "Rear bumper cover, painted", 390, 1, "FRM"],
          ["MB8-BP-011", "Rear diffuser, CFRP", 720, 1, "CFK"],
          ["MB8-BP-012", "Reflector + trim set", 36, 1, "FST"],
        ]},
      ]},
      { n: "Aerodynamics", comps: [
        { n: "Active Rear Wing", parts: [
          ["MB8-AE-001", "Rear wing, CFRP blade", 860, 1, "CFK"],
          ["MB8-AE-002", "Deployment actuator + linkage", 340, 1, "ELX"],
          ["MB8-AE-003", "Wing control module", 110, 1, "ELX"],
        ]},
        { n: "Underbody", parts: [
          ["MB8-AE-010", "Flat underbody panel set, composite", 520, 1, "CFK"],
          ["MB8-AE-011", "Front / rear wheel-arch liners", 130, 1, "FRM"],
        ]},
      ]},
      { n: "Paint, Badges & Finish", comps: [
        { n: "Paint & Trim", parts: [
          ["MB8-PN-001", "Body paint system (e-coat, primer, base, clear)", 1450, 1, "CHM"],
          ["MB8-PN-002", "Badge set (front, rear, side) + rings emblem", 95, 1, "FST"],
          ["MB8-PN-003", "Window trim + chrome / black surround set", 240, 1, "FST"],
        ]},
      ]},
    ],
  },
  // ------------------------------------------------------ FASTENERS
  {
    key: "fast", label: "Fasteners & Consumables", color: "#78716c", ref: "800",
    note: "Standard hardware and sealing across the vehicle — aggregated by class, not by location.",
    subs: [
      { n: "Standard Hardware", comps: [
        { n: "Bolts, Nuts & Studs", parts: [
          ["MB8-FS-201", "Structural bolts M8–M12, class 10.9 (assorted)", 0.42, 320, "FST"],
          ["MB8-FS-202", "Flange nuts + locking nuts", 0.18, 250, "FST"],
          ["MB8-FS-203", "Self-tapping + trim screws", 0.05, 400, "FST"],
        ]},
        { n: "Clips, Grommets & Seals", parts: [
          ["MB8-FS-210", "Plastic trim clips", 0.09, 350, "FST"],
          ["MB8-FS-211", "Rubber grommets + plugs", 0.12, 120, "FST"],
          ["MB8-FS-212", "Cavity wax + underbody sealer, kg", 14, 2.5, "CHM", "kg"],
          ["MB8-FS-213", "Structural adhesive, kg", 48, 4, "CHM", "kg"],
        ]},
      ]},
    ],
  },
];

// ---------------------------------------------------------------------------
async function insertMany(model: { createMany: (a: { data: any[] }) => Promise<unknown> }, rows: any[], size = 500) {
  for (let i = 0; i < rows.length; i += size) await model.createMany({ data: rows.slice(i, i + size) });
}

async function main() {
  console.log("creating supplier directory (skipping any that already exist by name)…");
  const supplierId = new Map<string, string>();
  for (const s of SUPPLIERS) {
    let rec = await prisma.supplier.findFirst({ where: { name: s.name } });
    if (!rec) {
      rec = await prisma.supplier.create({
        data: {
          name: s.name, trades: s.trades, city: s.city,
          email: NOTIFY_EMAIL, phone: s.contact.phone,
          contacts: { create: [{ ...s.contact, email: NOTIFY_EMAIL, isPrimary: true }] },
        },
      });
    } else {
      // already registered (earlier run) — re-point its mail at the notify inbox
      await prisma.supplier.update({ where: { id: rec.id }, data: { email: NOTIFY_EMAIL } });
      await prisma.supplierContact.updateMany({ where: { supplierId: rec.id }, data: { email: NOTIFY_EMAIL } });
    }
    supplierId.set(s.key, rec.id);
  }

  console.log("upserting parts catalog…");
  const matId = new Map<string, string>();
  const sysOfPart = new Map<string, string>();
  const links = new Set<string>();
  for (const sys of SYSTEMS)
    for (const sub of sys.subs)
      for (const c of sub.comps)
        for (const [code, name, unitCost, , sup, uom] of c.parts) {
          const m = { code, name, category: sys.label, uom: uom ?? "ea", unitCost, wastagePct: 0 };
          const rec = await prisma.material.upsert({ where: { code }, create: m, update: m });
          matId.set(code, rec.id);
          sysOfPart.set(code, sys.label);
          const key = `${rec.id}|${supplierId.get(sup)}`;
          if (!links.has(key)) {
            links.add(key);
            await prisma.materialSupplier.upsert({
              where: { materialId_supplierId: { materialId: rec.id, supplierId: supplierId.get(sup)! } },
              create: { materialId: rec.id, supplierId: supplierId.get(sup)!, preferred: true },
              update: { preferred: true },
            });
          }
        }

  const existing = await prisma.project.findUnique({ where: { code: PROJECT_CODE } });
  if (existing) {
    console.log(`project ${PROJECT_CODE} exists — deleting and recreating`);
    await prisma.project.delete({ where: { id: existing.id } });
  }

  console.log("creating project 'Mudi B8'…");
  const cats = [...SYSTEMS.map((s) => [s.key, s.label, s.color]), ["mfg", "Manufacturing & Programme", "#ec4899"]];
  const project = await prisma.project.create({
    data: {
      code: PROJECT_CODE,
      name: "Mudi B8",
      description:
        "Vehicle DMU / product structure for the Mudi B8 — a fictional two-seat, mid-engine V10 all-wheel-drive supercar (an Audi R8 stand-in). Aluminium space-frame with CFRP tunnel, 5.2 L NA V10, 7-speed DCT, carbon-ceramic brakes. Full vehicle BOM by system → subsystem → component with sourced Tier-1 suppliers, plus assembly, tooling and homologation programme costs.",
      client: "Mudi Automobile AG",
      location: "Neckarsulm assembly plant, DE",
      currency: "USD",
      status: "ACTIVE",
      categories: { create: cats.map(([key, label, color], i) => ({ key, label, color, sortOrder: i })) },
    },
    include: { categories: true },
  });
  const C = Object.fromEntries(project.categories.map((c) => [c.key, c.id])) as Record<string, string>;

  const nodes: any[] = [];
  const lines: any[] = [];
  let ns = 0, ls = 0;
  const N = (name: string, type: "GROUP" | "SUBGROUP" | "ASSEMBLY" | "COMPONENT", o: any = {}): string => {
    const id = `MB8-N-${String(++ns).padStart(5, "0")}`;
    nodes.push({
      id, projectId: project.id, name, type,
      parentId: o.parent ?? null, categoryId: o.cat ?? null,
      quantity: o.qty ?? 1, uom: o.uom ?? "ea",
      refCode: o.ref ?? null, notes: o.notes ?? null,
      attributes: o.attr ?? {}, sortOrder: o.sort ?? 0,
    });
    return id;
  };
  const E = (nodeId: string, kind: "LABOR" | "EQUIPMENT" | "TRANSPORT" | "OVERHEAD", desc: string, qty: number, rate: number, uom = "LS", sort = 0) => {
    lines.push({
      id: `MB8-L-${String(++ls).padStart(5, "0")}`, nodeId, materialId: null, supplierId: null,
      kind, description: desc, quantity: qty, uom, unitCost: rate, wastagePct: 0, laborCost: 0,
      constructionDetail: {}, sortOrder: sort,
    });
  };

  // Root: the vehicle itself
  const vehicle = N("Mudi B8 — Complete Vehicle", "GROUP", {
    ref: "MB8", uom: "veh",
    notes: "Top-level product. One node quantity = one vehicle; everything below rolls up into per-vehicle BOM cost.",
    attr: { layout: "mid-engine, AWD", seats: 2, engine: "5.2 L V10 NA", power_ps: 610, torque_nm: 560, gearbox: "7-speed DCT", kerb_weight_kg: 1670, length_mm: 4426, wheelbase_mm: 2650 },
  });

  let sysSort = 0;
  for (const sys of SYSTEMS) {
    const g = N(`${sys.ref} ${sys.label}`, "SUBGROUP", { parent: vehicle, cat: C[sys.key], ref: sys.ref, notes: sys.note, sort: (sysSort += 10) });
    let subSort = 0;
    for (const sub of sys.subs) {
      const sn = N(sub.n, "ASSEMBLY", { parent: g, cat: C[sys.key], notes: sub.note, sort: (subSort += 10) });
      let cSort = 0;
      for (const c of sub.comps) {
        const cn = N(c.n, "COMPONENT", { parent: sn, cat: C[sys.key], qty: c.q ?? 1, ref: c.ref, notes: c.note, attr: c.attr, sort: (cSort += 10) });
        let pSort = 0;
        for (const [code, name, unitCost, qty, sup, uom] of c.parts) {
          lines.push({
            id: `MB8-L-${String(++ls).padStart(5, "0")}`, nodeId: cn, materialId: matId.get(code)!,
            supplierId: supplierId.get(sup)!, kind: "MATERIAL", description: name,
            quantity: qty, uom: uom ?? "ea", unitCost, wastagePct: 0, laborCost: 0,
            constructionDetail: { part_no: code }, sortOrder: (pSort += 10),
          });
        }
      }
    }
  }

  // Manufacturing & programme costs
  const mf = N("900 Manufacturing & Programme", "SUBGROUP", { parent: vehicle, cat: C.mfg, ref: "900", notes: "Assembly labour, paint & body shop, tooling amortisation, validation and homologation — per-vehicle allocations.", sort: 100 });
  const asm = N("Final Assembly Line", "ASSEMBLY", { parent: mf, cat: C.mfg, sort: 0 });
  const a1 = N("Marriage & Powertrain Installation", "COMPONENT", { parent: asm, cat: C.mfg, sort: 0 });
  E(a1, "LABOR", "Powertrain installation + marriage station", 14, 68, "h", 0);
  E(a1, "EQUIPMENT", "Marriage fixture & AGV time", 2, 140, "h", 10);
  const a2 = N("Interior, Electrics & Closures Fit", "COMPONENT", { parent: asm, cat: C.mfg, sort: 10 });
  E(a2, "LABOR", "Cockpit, harness, seat & trim fit", 38, 68, "h");
  E(a2, "LABOR", "Doors, glass & closures fit / adjust", 16, 68, "h", 10);
  const a3 = N("End-of-Line Test & Quality", "COMPONENT", { parent: asm, cat: C.mfg, sort: 20 });
  E(a3, "LABOR", "Roller-test, water-test, final inspection", 12, 72, "h");
  E(a3, "OVERHEAD", "Quality documentation & vehicle records", 1, 420, "veh", 10);
  const shop = N("Body Shop & Paint Shop", "ASSEMBLY", { parent: mf, cat: C.mfg, sort: 10 });
  const s1 = N("Space-frame Joining (weld, rivet, bond)", "COMPONENT", { parent: shop, cat: C.mfg, sort: 0 });
  E(s1, "LABOR", "Body-shop labour", 46, 64, "h");
  E(s1, "EQUIPMENT", "Robotic SPR / laser-weld cell time", 18, 210, "h", 10);
  const s2 = N("Paint Shop", "COMPONENT", { parent: shop, cat: C.mfg, sort: 10 });
  E(s2, "LABOR", "Paint shop labour (prep, spray, polish)", 24, 66, "h");
  E(s2, "EQUIPMENT", "Booth + oven energy", 1, 520, "veh", 10);
  const prog = N("Programme Allocations", "ASSEMBLY", { parent: mf, cat: C.mfg, sort: 20 });
  const p1 = N("Tooling, Validation & Homologation", "COMPONENT", { parent: prog, cat: C.mfg, sort: 0 });
  E(p1, "OVERHEAD", "Tooling & die amortisation (12,000-unit run)", 1, 6800, "veh");
  E(p1, "OVERHEAD", "Validation, crash & durability testing allocation", 1, 3500, "veh", 10);
  E(p1, "OVERHEAD", "Homologation & type-approval allocation (EU/US/CN)", 1, 1900, "veh", 20);
  E(p1, "TRANSPORT", "Inbound logistics + finished-vehicle shipping", 1, 1100, "veh", 30);

  console.log(`inserting ${nodes.length} nodes and ${lines.length} BOM lines…`);
  await insertMany(prisma.node, nodes);
  await insertMany(prisma.bomLine, lines);

  // per-vehicle roll-up (multiply line cost by product of ancestor quantities)
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const mult = (id: string): number => { let m = 1; let cur = byId.get(id); while (cur) { m *= cur.quantity; cur = cur.parentId ? byId.get(cur.parentId) : undefined; } return m; };
  const catLabel = new Map(project.categories.map((c) => [c.id, c.label]));
  const totals = new Map<string, number>();
  let grand = 0, partCount = 0;
  for (const l of lines) {
    const amt = l.quantity * l.unitCost * mult(l.nodeId);
    const lab = catLabel.get(byId.get(l.nodeId).categoryId) ?? "—";
    totals.set(lab, (totals.get(lab) ?? 0) + amt);
    grand += amt;
    if (l.kind === "MATERIAL") partCount += l.quantity * mult(l.nodeId);
  }
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  console.log(`\ndone: project ${project.code} "${project.name}"`);
  console.log(`  ${nodes.length} nodes · ${lines.length} BOM lines · ${SUPPLIERS.length} suppliers · ${matId.size} distinct parts`);
  console.log(`  per-vehicle cost (from seed data): ${usd(grand)}`);
  for (const [k, v] of totals) console.log(`    ${k.padEnd(28)} ${usd(v)}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
