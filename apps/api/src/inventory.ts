// Inventory maths: what a project needs, what the warehouses already hold, and
// therefore what actually has to be bought.
//
//   required  = BOM demand rolled up through the tree, incl. wastage
//   onHand    = physical stock across warehouses
//   reserved  = part of onHand already earmarked (by any project)
//   available = onHand - reserved, plus anything reserved for THIS project
//   shortfall = max(0, required - available)
//
// Stock is keyed by Material, so only BOM lines that link to a catalog material
// can be netted. Lines with a free-text description and no materialId are
// counted separately and reported as `unlinked` rather than silently ignored —
// otherwise the shortfall would look better than it is.

export type DemandNode = {
  id: string;
  parentId: string | null;
  quantity: number;
  bomLines: Array<{
    materialId: string | null;
    kind: string;
    description: string;
    quantity: number;
    uom: string;
    wastagePct: number;
  }>;
};

export type MaterialDemand = {
  materialId: string;
  /** net quantity the BOM calls for, rolled through node multipliers */
  net: number;
  /** extra implied by each line's wastage % */
  wastage: number;
  /** net + wastage — the number you actually procure */
  required: number;
  uom: string;
  lineCount: number;
};

/** Product of this node's quantity and all its ancestors'. */
function qtyChain(byId: Map<string, DemandNode>, n: DemandNode): number {
  let q = 1;
  let cur: DemandNode | undefined = n;
  let guard = 0;
  while (cur && guard++ < 200) {
    q *= cur.quantity;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return q;
}

export type DemandResult = {
  byMaterial: Map<string, MaterialDemand>;
  /** MATERIAL lines with no catalog link — can't be netted against stock */
  unlinked: Array<{ description: string; quantity: number; uom: string }>;
};

/** Aggregate a project's MATERIAL BOM lines into per-material demand. */
export function materialDemand(nodes: DemandNode[]): DemandResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byMaterial = new Map<string, MaterialDemand>();
  const unlinkedAcc = new Map<string, { description: string; quantity: number; uom: string }>();

  for (const n of nodes) {
    const factor = qtyChain(byId, n);
    if (factor === 0) continue;
    for (const l of n.bomLines) {
      if (l.kind !== "MATERIAL") continue; // labour/plant/transport aren't stocked
      const net = l.quantity * factor;
      if (net === 0) continue;
      const wastage = net * (l.wastagePct / 100);

      if (!l.materialId) {
        const key = `${l.description}|${l.uom}`;
        const prev = unlinkedAcc.get(key);
        if (prev) prev.quantity += net + wastage;
        else unlinkedAcc.set(key, { description: l.description, quantity: net + wastage, uom: l.uom });
        continue;
      }

      const cur = byMaterial.get(l.materialId);
      if (cur) {
        cur.net += net;
        cur.wastage += wastage;
        cur.required += net + wastage;
        cur.lineCount += 1;
      } else {
        byMaterial.set(l.materialId, {
          materialId: l.materialId,
          net,
          wastage,
          required: net + wastage,
          uom: l.uom,
          lineCount: 1,
        });
      }
    }
  }

  return { byMaterial, unlinked: [...unlinkedAcc.values()] };
}

export type StockRow = {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  materialId: string;
  onHand: number;
  reserved: number;
  /** of `reserved`, the part held for the project being asked about */
  reservedForProject: number;
  minLevel: number;
  binLocation: string | null;
  unitCost: number;
};

export type AvailabilityRow = {
  materialId: string;
  materialCode: string;
  materialName: string;
  uom: string;
  required: number;
  net: number;
  wastage: number;
  onHand: number;
  /** free to take: onHand - reserved, plus what's already reserved for us */
  available: number;
  reservedForProject: number;
  reservedElsewhere: number;
  shortfall: number;
  /** what the shortfall costs at catalog rate — the real "still to buy" figure */
  shortfallValue: number;
  unitCost: number;
  status: "covered" | "partial" | "none";
  locations: Array<{
    warehouseId: string;
    code: string;
    name: string;
    onHand: number;
    available: number;
    binLocation: string | null;
  }>;
};

/**
 * Net demand against stock. `stock` may contain several rows per material (one
 * per warehouse); they are summed, and the per-location split is kept so the
 * UI can say *where* the covered quantity is sitting.
 */
export function availability(
  demand: DemandResult,
  stock: StockRow[],
  materials: Map<string, { code: string; name: string; uom: string; unitCost: number }>,
): AvailabilityRow[] {
  const stockByMaterial = new Map<string, StockRow[]>();
  for (const s of stock) {
    const arr = stockByMaterial.get(s.materialId);
    if (arr) arr.push(s);
    else stockByMaterial.set(s.materialId, [s]);
  }

  const rows: AvailabilityRow[] = [];
  for (const d of demand.byMaterial.values()) {
    const mat = materials.get(d.materialId);
    const rowsForMat = stockByMaterial.get(d.materialId) ?? [];

    let onHand = 0;
    let reservedForProject = 0;
    let reservedElsewhere = 0;
    const locations: AvailabilityRow["locations"] = [];

    for (const s of rowsForMat) {
      const mine = s.reservedForProject;
      const others = Math.max(0, s.reserved - mine);
      const free = Math.max(0, s.onHand - others);
      onHand += s.onHand;
      reservedForProject += mine;
      reservedElsewhere += others;
      if (s.onHand !== 0 || free !== 0) {
        locations.push({
          warehouseId: s.warehouseId,
          code: s.warehouseCode,
          name: s.warehouseName,
          onHand: s.onHand,
          available: free,
          binLocation: s.binLocation,
        });
      }
    }

    const available = Math.max(0, onHand - reservedElsewhere);
    const shortfall = Math.max(0, d.required - available);
    const unitCost = mat?.unitCost ?? 0;

    rows.push({
      materialId: d.materialId,
      materialCode: mat?.code ?? "?",
      materialName: mat?.name ?? "(unknown material)",
      uom: d.uom || mat?.uom || "ea",
      required: d.required,
      net: d.net,
      wastage: d.wastage,
      onHand,
      available,
      reservedForProject,
      reservedElsewhere,
      shortfall,
      shortfallValue: shortfall * unitCost,
      unitCost,
      status: shortfall === 0 ? "covered" : available > 0 ? "partial" : "none",
      locations: locations.sort((a, b) => b.available - a.available),
    });
  }

  // worst coverage first — that's the buying list
  return rows.sort((a, b) => b.shortfallValue - a.shortfallValue || b.shortfall - a.shortfall);
}

/** Direction a movement type moves the balance. */
export function movementSign(type: string): number {
  switch (type) {
    case "RECEIPT":
    case "TRANSFER_IN":
      return 1;
    case "ISSUE":
    case "TRANSFER_OUT":
      return -1;
    default:
      return 1; // ADJUSTMENT carries its own sign in `quantity`
  }
}
