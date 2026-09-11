import { z } from "zod";

export const projectCreate = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  client: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  currency: z.string().length(3).default("USD"),
  status: z.enum(["DRAFT", "ACTIVE", "ON_HOLD", "CLOSED"]).default("DRAFT"),
});
export const projectUpdate = projectCreate.partial();

export const categoryCreate = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/i, "letters, digits, - and _ only"),
  label: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#64748b"),
  sortOrder: z.number().int().default(0),
});
export const categoryUpdate = categoryCreate.partial();

export const nodeCreate = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["GROUP", "SUBGROUP", "ASSEMBLY", "COMPONENT"]).default("GROUP"),
  parentId: z.string().nullish(),
  categoryId: z.string().nullish(),
  refCode: z.string().max(80).nullish(),
  quantity: z.number().positive().default(1),
  uom: z.string().max(20).default("ea"),
  notes: z.string().max(4000).nullish(),
  attributes: z.record(z.any()).default({}),
  sortOrder: z.number().int().default(0),
});
export const nodeUpdate = nodeCreate.partial();

export const nodeMove = z.object({
  parentId: z.string().nullable(),
  sortOrder: z.number().int().optional(),
});

export const materialCreate = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  category: z.string().max(80).nullish(),
  uom: z.string().max(20).default("ea"),
  unitCost: z.number().nonnegative().default(0),
  wastagePct: z.number().min(0).max(100).default(0),
  spec: z.record(z.any()).default({}),
});
export const materialUpdate = materialCreate.partial();

export const bomLineKind = z.enum(["MATERIAL", "LABOR", "EQUIPMENT", "TRANSPORT", "OVERHEAD"]);

export const bomLineCreate = z.object({
  materialId: z.string().nullish(),
  supplierId: z.string().nullish(),
  kind: bomLineKind.default("MATERIAL"),
  description: z.string().max(300).optional(),
  quantity: z.number().positive().default(1),
  uom: z.string().max(20).optional(),
  unitCost: z.number().nonnegative().optional(),
  wastagePct: z.number().min(0).max(100).optional(),
  laborCost: z.number().nonnegative().default(0),
  constructionDetail: z.record(z.any()).default({}),
  sortOrder: z.number().int().default(0),
});
export const bomLineUpdate = z.object({
  materialId: z.string().nullish(),
  supplierId: z.string().nullish(),
  kind: bomLineKind.optional(),
  description: z.string().max(300).optional(),
  quantity: z.number().positive().optional(),
  uom: z.string().max(20).optional(),
  unitCost: z.number().nonnegative().optional(),
  wastagePct: z.number().min(0).max(100).optional(),
  laborCost: z.number().nonnegative().optional(),
  constructionDetail: z.record(z.any()).optional(),
  sortOrder: z.number().int().optional(),
});

// ---------------------------------------------------------------------------
// Procurement
// ---------------------------------------------------------------------------

const email = z.string().email().max(200);

export const supplierContactInput = z.object({
  name: z.string().min(1).max(160),
  email,
  phone: z.string().max(40).nullish(),
  role: z.string().max(80).nullish(),
  isPrimary: z.boolean().default(false),
});

export const supplierCreate = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().max(200).nullish(),
  gstin: z.string().max(20).nullish(),
  trades: z.array(z.string().max(60)).max(40).default([]),
  email: email.nullish(),
  phone: z.string().max(40).nullish(),
  website: z.string().max(200).nullish(),
  address: z.string().max(400).nullish(),
  city: z.string().max(120).nullish(),
  notes: z.string().max(4000).nullish(),
  contacts: z.array(supplierContactInput).max(25).default([]),
});
export const supplierUpdate = supplierCreate.partial();

export const materialSupplierInput = z.object({
  supplierId: z.string().min(1),
  preferred: z.boolean().default(false),
});

export const rfqCreate = z.object({
  projectId: z.string().min(1),
  nodeId: z.string().nullish(),
  title: z.string().min(1).max(200),
  scope: z.string().max(8000).nullish(),
  dueDate: z.string().datetime().nullish(),
  // when true and a nodeId is given, seed items from that node's BOM
  fromNodeBom: z.boolean().default(true),
  items: z
    .array(
      z.object({
        description: z.string().min(1).max(300),
        quantity: z.number().positive().default(1),
        uom: z.string().max(20).default("ea"),
        targetCost: z.number().nonnegative().nullish(),
        bomLineId: z.string().nullish(),
      }),
    )
    .default([]),
});

export const rfqUpdate = z.object({
  title: z.string().min(1).max(200).optional(),
  scope: z.string().max(8000).nullish(),
  dueDate: z.string().datetime().nullish(),
  status: z.enum(["DRAFT", "SENT", "RESPONSES", "AWARDED", "CLOSED", "CANCELLED"]).optional(),
});

export const rfqItemInput = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().positive().default(1),
  uom: z.string().max(20).default("ea"),
  targetCost: z.number().nonnegative().nullish(),
  sortOrder: z.number().int().optional(),
});
export const rfqItemUpdate = rfqItemInput.partial();

export const rfqAddSuppliers = z.object({
  supplierIds: z.array(z.string().min(1)).min(1).max(50),
});

export const rfqSend = z.object({
  supplierIds: z.array(z.string().min(1)).optional(), // default: everyone not yet sent
  message: z.string().max(4000).optional(),
});

export const rfqAward = z.object({
  rfqSupplierId: z.string().min(1),
});

// ---- public portal (supplier-facing, token-authenticated) ----
export const portalSubmit = z.object({
  leadTimeDays: z.number().int().min(0).max(3650).nullish(),
  notes: z.string().max(4000).nullish(),
  currency: z.string().length(3).optional(),
  lines: z
    .array(
      z.object({
        rfqItemId: z.string().min(1),
        unitPrice: z.number().nonnegative().default(0),
        notes: z.string().max(500).nullish(),
      }),
    )
    .default([]),
  submit: z.boolean().default(false), // false = save draft, true = mark responded
});

export const bulkAssignSupplier = z.object({
  materialId: z.string().min(1),
  supplierId: z.string().min(1).nullable(), // null = clear the assignment
  nodeId: z.string().nullish(), // limit to this node's subtree; omit for the whole project
});
