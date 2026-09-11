-- CreateTable
CREATE TABLE "NodeAttachment" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NodeAttachment_nodeId_idx" ON "NodeAttachment"("nodeId");

-- AddForeignKey
ALTER TABLE "NodeAttachment" ADD CONSTRAINT "NodeAttachment_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
