// Cost roll-up for a DMU tree.
//
// A BOM line has a `kind`. MATERIAL lines carry a catalog rate, a wastage % and
// an optional installation-labour rate. The non-material kinds (LABOR, EQUIPMENT,
// TRANSPORT, OVERHEAD) are flat `quantity * unitCost` and land in their own
// bucket so the roll-up can report material vs. labour vs. plant vs. logistics
// vs. documentation / preliminaries separately.
//
// Per BOM line (by kind):
//   MATERIAL   material  = quantity * unitCost * (1 + wastagePct/100)
//              labor     = quantity * laborCost
//   LABOR      labor     = quantity * unitCost
//   EQUIPMENT  equipment = quantity * unitCost
//   TRANSPORT  transport = quantity * unitCost
//   OVERHEAD   overhead  = quantity * unitCost
//   lineTotal = material + labor + equipment + transport + overhead
//
// Per node:
//   directCost   = sum of its own line totals            (one instance)
//   subtotalCost = directCost + sum(child.rolledCost)     (one instance, incl. children)
//   rolledCost   = quantity * subtotalCost                (as the parent sees it)

export type BomLineKind = "MATERIAL" | "LABOR" | "EQUIPMENT" | "TRANSPORT" | "OVERHEAD";

export const COST_KINDS: BomLineKind[] = ["MATERIAL", "LABOR", "EQUIPMENT", "TRANSPORT", "OVERHEAD"];

export const KIND_LABEL: Record<BomLineKind, string> = {
  MATERIAL: "Material",
  LABOR: "Labour",
  EQUIPMENT: "Equipment & Plant",
  TRANSPORT: "Transport & Logistics",
  OVERHEAD: "Overheads & Fees",
};

export type RawBomLine = {
  kind: BomLineKind;
  quantity: number;
  unitCost: number;
  wastagePct: number;
  laborCost: number;
};

export type RawNode = {
  id: string;
  parentId: string | null;
  categoryId: string | null;
  quantity: number;
  sortOrder: number;
  bomLines: RawBomLine[];
};

export type KindBuckets = Record<BomLineKind, number>;

const zeroBuckets = (): KindBuckets => ({ MATERIAL: 0, LABOR: 0, EQUIPMENT: 0, TRANSPORT: 0, OVERHEAD: 0 });

export type NodeCost = {
  directCost: number;
  rolledCost: number;
  // one-instance cost buckets (own BOM + children scaled by their quantity);
  // a parent multiplies these by this node's quantity, the summary does the same
  // for the roots. Matches the semantics of `materialCost` / `laborCost`.
  byKind: KindBuckets;
  materialCost: number;
  laborCost: number;
  lineCount: number;
  descendantCount: number;
};

export function lineBuckets(l: RawBomLine): KindBuckets {
  const b = zeroBuckets();
  if (l.kind === "MATERIAL") {
    b.MATERIAL = l.quantity * l.unitCost * (1 + l.wastagePct / 100);
    b.LABOR = l.quantity * l.laborCost;
  } else {
    b[l.kind] = l.quantity * l.unitCost;
  }
  return b;
}

export function lineTotals(l: RawBomLine) {
  const b = lineBuckets(l);
  const total = b.MATERIAL + b.LABOR + b.EQUIPMENT + b.TRANSPORT + b.OVERHEAD;
  return { materialCost: b.MATERIAL, laborCost: b.LABOR, byKind: b, total };
}

const addInto = (target: KindBuckets, src: KindBuckets, factor = 1) => {
  for (const k of COST_KINDS) target[k] += src[k] * factor;
};

export function computeCosts(nodes: RawNode[]): Map<string, NodeCost> {
  const childrenOf = new Map<string, RawNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? "__root__";
    (childrenOf.get(key) ?? childrenOf.set(key, []).get(key)!).push(n);
  }

  const out = new Map<string, NodeCost>();

  const visit = (node: RawNode): NodeCost => {
    const own = zeroBuckets();
    for (const l of node.bomLines) addInto(own, lineBuckets(l));
    const directCost = own.MATERIAL + own.LABOR + own.EQUIPMENT + own.TRANSPORT + own.OVERHEAD;

    const kids = (childrenOf.get(node.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    const combined = { ...own };
    let childRolled = 0;
    let descendantCount = 0;
    for (const k of kids) {
      const kc = visit(k);
      childRolled += kc.rolledCost;
      addInto(combined, kc.byKind, k.quantity);
      descendantCount += 1 + kc.descendantCount;
    }

    const subtotal = directCost + childRolled;

    const cost: NodeCost = {
      directCost,
      rolledCost: node.quantity * subtotal,
      byKind: combined,
      materialCost: combined.MATERIAL,
      laborCost: combined.LABOR,
      lineCount: node.bomLines.length,
      descendantCount,
    };
    out.set(node.id, cost);
    return cost;
  };

  for (const root of childrenOf.get("__root__") ?? []) visit(root);
  return out;
}

export type CategoryBreakdownRow = {
  categoryId: string | null;
  amount: number;
};

// Extended direct cost of each node (own BOM only) multiplied by the product of
// quantities of the node and all its ancestors, attributed to the nearest
// category (self or nearest ancestor). Rows sum to the project total.
export function categoryBreakdown(nodes: RawNode[]): CategoryBreakdownRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const totals = new Map<string | null, number>();

  const nearestCategory = (n: RawNode): string | null => {
    let cur: RawNode | undefined = n;
    while (cur) {
      if (cur.categoryId) return cur.categoryId;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return null;
  };

  const qtyChain = (n: RawNode): number => {
    let q = 1;
    let cur: RawNode | undefined = n;
    while (cur) {
      q *= cur.quantity;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return q;
  };

  for (const n of nodes) {
    const direct = n.bomLines.reduce((s, l) => s + lineTotals(l).total, 0);
    if (direct === 0) continue;
    const extended = direct * qtyChain(n);
    const cat = nearestCategory(n);
    totals.set(cat, (totals.get(cat) ?? 0) + extended);
  }

  return [...totals.entries()].map(([categoryId, amount]) => ({ categoryId, amount }));
}
