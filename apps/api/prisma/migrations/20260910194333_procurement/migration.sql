-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'SENT', 'RESPONSES', 'AWARDED', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "gstin" TEXT,
    "trades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialSupplier" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "preferred" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MaterialSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqItem" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "bomLineId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "uom" TEXT NOT NULL DEFAULT 'ea',
    "targetCost" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RfqItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqSupplier" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "leadTimeDays" INTEGER,
    "notes" TEXT,
    "totalQuoted" DOUBLE PRECISION,
    "awarded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RfqSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqQuote" (
    "id" TEXT NOT NULL,
    "rfqSupplierId" TEXT NOT NULL,
    "rfqItemId" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "RfqQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqAttachment" (
    "id" TEXT NOT NULL,
    "rfqSupplierId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SUPPLIER',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RfqAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierContact_supplierId_idx" ON "SupplierContact"("supplierId");

-- CreateIndex
CREATE INDEX "MaterialSupplier_supplierId_idx" ON "MaterialSupplier"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialSupplier_materialId_supplierId_key" ON "MaterialSupplier"("materialId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_number_key" ON "Rfq"("number");

-- CreateIndex
CREATE INDEX "Rfq_projectId_idx" ON "Rfq"("projectId");

-- CreateIndex
CREATE INDEX "Rfq_nodeId_idx" ON "Rfq"("nodeId");

-- CreateIndex
CREATE INDEX "RfqItem_rfqId_idx" ON "RfqItem"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "RfqSupplier_token_key" ON "RfqSupplier"("token");

-- CreateIndex
CREATE INDEX "RfqSupplier_supplierId_idx" ON "RfqSupplier"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "RfqSupplier_rfqId_supplierId_key" ON "RfqSupplier"("rfqId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "RfqQuote_rfqSupplierId_rfqItemId_key" ON "RfqQuote"("rfqSupplierId", "rfqItemId");

-- CreateIndex
CREATE INDEX "RfqAttachment_rfqSupplierId_idx" ON "RfqAttachment"("rfqSupplierId");

-- AddForeignKey
ALTER TABLE "SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialSupplier" ADD CONSTRAINT "MaterialSupplier_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialSupplier" ADD CONSTRAINT "MaterialSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqItem" ADD CONSTRAINT "RfqItem_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqItem" ADD CONSTRAINT "RfqItem_bomLineId_fkey" FOREIGN KEY ("bomLineId") REFERENCES "BomLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqSupplier" ADD CONSTRAINT "RfqSupplier_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqSupplier" ADD CONSTRAINT "RfqSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqQuote" ADD CONSTRAINT "RfqQuote_rfqSupplierId_fkey" FOREIGN KEY ("rfqSupplierId") REFERENCES "RfqSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqQuote" ADD CONSTRAINT "RfqQuote_rfqItemId_fkey" FOREIGN KEY ("rfqItemId") REFERENCES "RfqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqAttachment" ADD CONSTRAINT "RfqAttachment_rfqSupplierId_fkey" FOREIGN KEY ("rfqSupplierId") REFERENCES "RfqSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
