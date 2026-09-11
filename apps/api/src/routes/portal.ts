import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../http.js";
import { portalSubmit } from "../schemas.js";
import { deleteRfqUpload, rfqFilePath, saveRfqUpload } from "../storage.js";

/** Load an RfqSupplier by its portal token, with everything the portal needs. */
async function bySupplierToken(token: string) {
  return prisma.rfqSupplier.findUnique({
    where: { token },
    include: {
      supplier: { select: { name: true } },
      quotes: true,
      attachments: { orderBy: { uploadedAt: "asc" } },
      rfq: {
        include: {
          project: { select: { name: true, currency: true } },
          items: { orderBy: [{ sortOrder: "asc" }, { description: "asc" }] },
        },
      },
    },
  });
}

/** Public view — never expose internal budget (targetCost) or sibling suppliers. */
function publicView(rs: NonNullable<Awaited<ReturnType<typeof bySupplierToken>>>) {
  const closed = ["AWARDED", "CLOSED", "CANCELLED"].includes(rs.rfq.status);
  return {
    supplier: rs.supplier.name,
    status: rs.respondedAt ? "SUBMITTED" : "OPEN",
    closed,
    submittedAt: rs.respondedAt,
    currency: rs.currency,
    leadTimeDays: rs.leadTimeDays,
    notes: rs.notes,
    rfq: {
      number: rs.rfq.number,
      title: rs.rfq.title,
      scope: rs.rfq.scope,
      dueDate: rs.rfq.dueDate,
      project: rs.rfq.project.name,
    },
    items: rs.rfq.items.map((it) => {
      const q = rs.quotes.find((x) => x.rfqItemId === it.id);
      return {
        id: it.id,
        description: it.description,
        quantity: it.quantity,
        uom: it.uom,
        unitPrice: q?.unitPrice ?? null,
        lineNotes: q?.notes ?? null,
      };
    }),
    attachments: rs.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      uploadedAt: a.uploadedAt,
    })),
  };
}

export async function portalRoutes(app: FastifyInstance) {
  app.get("/portal/:token", async (req) => {
    const { token } = req.params as { token: string };
    const rs = await bySupplierToken(token);
    if (!rs) throw notFound("Invitation");
    if (!rs.viewedAt) await prisma.rfqSupplier.update({ where: { id: rs.id }, data: { viewedAt: new Date() } });
    return publicView(rs);
  });

  app.post("/portal/:token", async (req) => {
    const { token } = req.params as { token: string };
    const data = portalSubmit.parse(req.body);
    const rs = await bySupplierToken(token);
    if (!rs) throw notFound("Invitation");
    if (["AWARDED", "CLOSED", "CANCELLED"].includes(rs.rfq.status)) throw badRequest("This RFQ is closed");

    const validItemIds = new Set(rs.rfq.items.map((it) => it.id));
    for (const line of data.lines) {
      if (!validItemIds.has(line.rfqItemId)) throw badRequest("Unknown line item");
      await prisma.rfqQuote.upsert({
        where: { rfqSupplierId_rfqItemId: { rfqSupplierId: rs.id, rfqItemId: line.rfqItemId } },
        create: { rfqSupplierId: rs.id, rfqItemId: line.rfqItemId, unitPrice: line.unitPrice, notes: line.notes ?? null },
        update: { unitPrice: line.unitPrice, notes: line.notes ?? null },
      });
    }

    const quotes = await prisma.rfqQuote.findMany({ where: { rfqSupplierId: rs.id } });
    const total = rs.rfq.items.reduce((sum, it) => {
      const q = quotes.find((x) => x.rfqItemId === it.id);
      return sum + (q ? q.unitPrice * it.quantity : 0);
    }, 0);

    await prisma.rfqSupplier.update({
      where: { id: rs.id },
      data: {
        leadTimeDays: data.leadTimeDays ?? null,
        notes: data.notes ?? null,
        currency: data.currency ?? rs.currency,
        totalQuoted: total,
        respondedAt: data.submit ? new Date() : rs.respondedAt,
      },
    });

    if (data.submit && rs.rfq.status === "SENT") {
      await prisma.rfq.update({ where: { id: rs.rfqId }, data: { status: "RESPONSES" } });
    }
    return publicView((await bySupplierToken(token))!);
  });

  app.post("/portal/:token/files", async (req) => {
    const { token } = req.params as { token: string };
    const rs = await prisma.rfqSupplier.findUnique({ where: { token }, include: { rfq: true } });
    if (!rs) throw notFound("Invitation");
    if (["AWARDED", "CLOSED", "CANCELLED"].includes(rs.rfq.status)) throw badRequest("This RFQ is closed");

    const file = await (req as unknown as { file: () => Promise<undefined | {
      filename: string;
      mimetype: string;
      file: NodeJS.ReadableStream;
    }> }).file();
    if (!file) throw badRequest("No file in request");

    const storedName = await saveRfqUpload(file.filename, file.file as never);
    const { size } = await stat(rfqFilePath(storedName));
    await prisma.rfqAttachment.create({
      data: {
        rfqSupplierId: rs.id,
        filename: file.filename,
        storedName,
        mimeType: file.mimetype,
        size,
        source: "SUPPLIER",
      },
    });
    return publicView((await bySupplierToken(token))!);
  });

  app.get("/portal/:token/files/:attachmentId", async (req, reply) => {
    const { token, attachmentId } = req.params as { token: string; attachmentId: string };
    const rs = await prisma.rfqSupplier.findUnique({ where: { token } });
    if (!rs) throw notFound("Invitation");
    const att = await prisma.rfqAttachment.findFirst({ where: { id: attachmentId, rfqSupplierId: rs.id } });
    if (!att) throw notFound("Attachment");
    const path = rfqFilePath(att.storedName);
    await stat(path);
    reply.header("Content-Type", att.mimeType || "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${att.filename.replace(/"/g, "")}"`);
    return reply.send(createReadStream(path));
  });

  app.delete("/portal/:token/files/:attachmentId", async (req, reply) => {
    const { token, attachmentId } = req.params as { token: string; attachmentId: string };
    const rs = await prisma.rfqSupplier.findUnique({ where: { token } });
    if (!rs) throw notFound("Invitation");
    const att = await prisma.rfqAttachment.findFirst({ where: { id: attachmentId, rfqSupplierId: rs.id } });
    if (!att) throw notFound("Attachment");
    await prisma.rfqAttachment.delete({ where: { id: att.id } });
    await deleteRfqUpload(att.storedName);
    return reply.status(204).send();
  });
}
