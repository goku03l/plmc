-- AlterTable
ALTER TABLE "BomLine" ADD COLUMN     "supplierId" TEXT;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
