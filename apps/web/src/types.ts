export type ProjectStatus = "DRAFT" | "ACTIVE" | "ON_HOLD" | "CLOSED";
export type NodeType = "GROUP" | "SUBGROUP" | "ASSEMBLY" | "COMPONENT";
export type BomLineKind = "MATERIAL" | "LABOR" | "EQUIPMENT" | "TRANSPORT" | "OVERHEAD";

export const BOM_LINE_KINDS: BomLineKind[] = ["MATERIAL", "LABOR", "EQUIPMENT", "TRANSPORT", "OVERHEAD"];
export const BOM_LINE_KIND_LABEL: Record<BomLineKind, string> = {
  MATERIAL: "Material",
  LABOR: "Labour",
  EQUIPMENT: "Equipment & Plant",
  TRANSPORT: "Transport & Logistics",
  OVERHEAD: "Overheads & Fees",
};

export interface Project {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  client?: string | null;
  location?: string | null;
  currency: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  _count?: { nodes: number };
  categories?: Category[];
}

export interface Category {
  id: string;
  projectId: string;
  key: string;
  label: string;
  color: string;
  sortOrder: number;
  _count?: { nodes: number };
}

export interface Material {
  id: string;
  code: string;
  name: string;
  category?: string | null;
  uom: string;
  unitCost: number;
  wastagePct: number;
  spec: Record<string, unknown>;
}

export interface BomLine {
  id: string;
  nodeId: string;
  materialId?: string | null;
  material?: Material | null;
  supplierId?: string | null;
  supplier?: { id: string; name: string } | null;
  kind: BomLineKind;
  description: string;
  quantity: number;
  uom: string;
  unitCost: number;
  wastagePct: number;
  laborCost: number;
  constructionDetail: Record<string, unknown>;
  sortOrder: number;
}

export interface NodeCost {
  directCost: number;
  materialCost: number;
  laborCost: number;
  rolledCost: number;
  lineCount: number;
  descendantCount: number;
}

export interface TreeNode {
  id: string;
  projectId: string;
  parentId: string | null;
  categoryId: string | null;
  name: string;
  type: NodeType;
  refCode?: string | null;
  quantity: number;
  uom: string;
  notes?: string | null;
  attributes: Record<string, unknown>;
  sortOrder: number;
  cost: NodeCost | null;
  children: TreeNode[];
}

export interface NodeAttachment {
  id: string;
  nodeId: string;
  filename: string;
  storedName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface NodeDetail extends Omit<TreeNode, "children" | "cost"> {
  category?: Category | null;
  bomLines: BomLine[];
  attachments: NodeAttachment[];
}

export interface ProjectTree {
  project: Project;
  tree: TreeNode[];
}

export interface CostSummary {
  currency: string;
  total: number;
  material: number;
  labor: number;
  nodeCount: number;
  byKind: { kind: BomLineKind; label: string; amount: number }[];
  byCategory: { categoryId: string | null; label: string; amount: number }[];
}

// ---------------------------------------------------------------------------
// Procurement
// ---------------------------------------------------------------------------
export type RfqStatus = "DRAFT" | "SENT" | "RESPONSES" | "AWARDED" | "CLOSED" | "CANCELLED";

export interface SupplierContact {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role?: string | null;
  isPrimary: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  legalName?: string | null;
  gstin?: string | null;
  trades: string[];
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  contacts: SupplierContact[];
  materialLinks?: { id: string; materialId: string; preferred: boolean; material?: Material }[];
  _count?: { rfqInvites: number; materialLinks: number };
}

export interface RfqItem {
  id: string;
  description: string;
  quantity: number;
  uom: string;
  targetCost?: number | null;
  bomLineId?: string | null;
  sortOrder: number;
}

export interface RfqQuote {
  id: string;
  rfqItemId: string;
  unitPrice: number;
  notes?: string | null;
}

export interface RfqAttachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  source: string;
  uploadedAt: string;
}

export interface RfqSupplierRow {
  id: string;
  supplierId: string;
  supplier: Supplier;
  token: string;
  email: string;
  createdAt: string;
  sentAt?: string | null;
  viewedAt?: string | null;
  respondedAt?: string | null;
  currency: string;
  leadTimeDays?: number | null;
  notes?: string | null;
  totalQuoted?: number | null;
  awarded: boolean;
  quotes: RfqQuote[];
  attachments: RfqAttachment[];
}

export interface RfqComparison {
  byLine: {
    itemId: string;
    lowest: number | null;
    cells: { rfqSupplierId: string; supplierId: string; unitPrice: number | null; extended: number | null; notes: string | null }[];
  }[];
  supplierTotals: { rfqSupplierId: string; total: number; quotedLines: number; complete: boolean }[];
}

export interface Rfq {
  id: string;
  number: string;
  title: string;
  status: RfqStatus;
  scope?: string | null;
  dueDate?: string | null;
  createdAt: string;
  projectId: string;
  nodeId?: string | null;
  project: { id: string; code: string; name: string; currency: string };
  node?: { id: string; name: string; refCode?: string | null } | null;
  items: RfqItem[];
  suppliers: RfqSupplierRow[];
  comparison: RfqComparison;
}

export interface RfqListRow {
  id: string;
  number: string;
  title: string;
  status: RfqStatus;
  dueDate?: string | null;
  createdAt: string;
  projectId: string;
  node?: { id: string; name: string } | null;
  _count: { items: number; suppliers: number };
  suppliers: { respondedAt?: string | null; awarded: boolean }[];
}

// supplier-facing portal payload
export interface PortalView {
  supplier: string;
  status: "OPEN" | "SUBMITTED";
  closed: boolean;
  submittedAt?: string | null;
  currency: string;
  leadTimeDays?: number | null;
  notes?: string | null;
  rfq: { number: string; title: string; scope?: string | null; dueDate?: string | null; project: string };
  items: { id: string; description: string; quantity: number; uom: string; unitPrice: number | null; lineNotes: string | null }[];
  attachments: { id: string; filename: string; size: number; uploadedAt: string }[];
}

export interface MaterialSupplierLink {
  id: string;
  materialId: string;
  supplierId: string;
  preferred: boolean;
  supplier: Supplier;
}

export interface SupplierAssignments {
  project: { id: string; code: string; name: string; currency: string };
  scopedTo: string | null;
  byMaterial: {
    materialId: string;
    code: string;
    name: string;
    uom: string;
    assigned: boolean;
    unassignedLines: number;
    assignments: {
      supplierId: string | null;
      supplierName: string | null;
      lineCount: number;
      extendedQty: number;
      locations: { nodeId: string; nodePath: string; quantity: number; extendedQty: number }[];
    }[];
  }[];
  bySupplier: {
    supplierId: string;
    supplierName: string;
    materials: { code: string; name: string; uom: string; extendedQty: number; lineCount: number }[];
  }[];
}

/* ---------- inventory ---------- */
export interface Warehouse {
  id: string;
  code: string;
  name: string;
  location?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive: boolean;
  stockValue?: number;
  _count?: { stockItems: number; movements: number };
}

export interface StockItem {
  id: string;
  warehouseId: string;
  materialId: string;
  onHand: number;
  reserved: number;
  available: number;
  minLevel: number;
  binLocation: string | null;
  uom: string;
  unitCost: number;
  value: number;
  low: boolean;
  material: { id: string; code: string; name: string; uom: string; unitCost: number };
  warehouse: { id: string; code: string; name: string };
}

export type StockMovementType = "RECEIPT" | "ISSUE" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT";

export interface StockMovement {
  id: string;
  type: StockMovementType;
  quantity: number;
  uom: string;
  unitCost: number;
  reference: string | null;
  note: string | null;
  createdAt: string;
  material: { code: string; name: string; uom: string };
  warehouse: { code: string; name: string };
  project: { code: string; name: string } | null;
  node: { name: string } | null;
}

export interface StockReservation {
  id: string;
  quantity: number;
  note: string | null;
  createdAt: string;
  stockItem: { id: string; material: { code: string; name: string; uom: string } };
  warehouse: { code: string; name: string };
  project: { code: string; name: string };
  node: { name: string } | null;
}

export interface AvailabilityRow {
  materialId: string;
  materialCode: string;
  materialName: string;
  uom: string;
  required: number;
  net: number;
  wastage: number;
  onHand: number;
  available: number;
  reservedForProject: number;
  reservedElsewhere: number;
  shortfall: number;
  shortfallValue: number;
  unitCost: number;
  status: "covered" | "partial" | "none";
  locations: {
    warehouseId: string;
    code: string;
    name: string;
    onHand: number;
    available: number;
    binLocation: string | null;
  }[];
}

export interface BuildableLimit {
  materialId: string;
  materialCode: string;
  materialName: string;
  uom: string;
  perUnit: number;
  available: number;
  /** whole units this one part can supply */
  units: number;
}

export interface Buildable {
  /** complete units the stock can build right now */
  units: number;
  /** bottleneck parts, fewest units first */
  limiting: BuildableLimit[];
  /** parts with nothing usable in stock */
  missing: number;
}

export interface ProjectAvailability {
  project: { id: string; code: string; name: string; currency: string };
  /** build target the rows are netted for (1 = a single unit) */
  units: number;
  buildable: Buildable;
  rows: AvailabilityRow[];
  unlinked: { description: string; quantity: number; uom: string }[];
  totals: {
    materials: number;
    covered: number;
    partial: number;
    none: number;
    requiredValue: number;
    shortfallValue: number;
    coveredValue: number;
    unlinkedLines: number;
  };
}
