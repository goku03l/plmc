import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Prisma, type RfqStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../http.js";
import { env } from "../env.js";
import { sendMail, mailEnabled } from "../mail.js";
import { rfqFilePath } from "../storage.js";
import {
  rfqAddSuppliers,
  rfqAward,
  rfqCreate,
  rfqItemInput,
  rfqItemUpdate,
  rfqSend,
  rfqUpdate,
} from "../schemas.js";

const token = () => randomBytes(24).toString("base64url");

const rfqInclude = Prisma.validator<Prisma.RfqInclude>()({
  project: { select: { id: true, code: true, name: true, currency: true } },
  node: { select: { id: true, name: true, refCode: true } },
  items: { orderBy: [{ sortOrder: "asc" }, { description: "asc" }] },
  suppliers: {
    orderBy: { createdAt: "asc" },
    include: {
      supplier: { include: { contacts: { orderBy: { isPrimary: "desc" } } } },
      quotes: true,
      attachments: { orderBy: { uploadedAt: "asc" } },
    },
  },
});

type FullRfq = Prisma.RfqGetPayload<{ include: typeof rfqInclude }>;

async function nextRfqNumber() {
  const count = await prisma.rfq.count();
  return `RFQ-${String(count + 1).padStart(4, "0")}`;
}

function portalUrl(t: string) {
  return `${env.appBaseUrl}/portal/${t}`;
}

/** Shape a full RFQ with a per-line comparison matrix. */
function decorate(rfq: FullRfq) {
  const byLine = rfq.items.map((it) => {
    const cells = rfq.suppliers.map((s) => {
      const q = s.quotes.find((x) => x.rfqItemId === it.id);
      const unitPrice = q?.unitPrice ?? null;
      return {
        rfqSupplierId: s.id,
        supplierId: s.supplierId,
        unitPrice,
        extended: unitPrice == null ? null : unitPrice * it.quantity,
        notes: q?.notes ?? null,
      };
    });
    const priced = cells.filter((c) => c.extended != null).map((c) => c.extended as number);
    return { itemId: it.id, cells, lowest: priced.length ? Math.min(...priced) : null };
  });

  const supplierTotals = rfq.suppliers.map((s) => {
    const total = rfq.items.reduce((sum, it) => {
      const q = s.quotes.find((x) => x.rfqItemId === it.id);
      return sum + (q ? q.unitPrice * it.quantity : 0);
    }, 0);
    const quotedLines = s.quotes.length;
    return { rfqSupplierId: s.id, total, quotedLines, complete: quotedLines >= rfq.items.length };
  });

  return { ...rfq, comparison: { byLine, supplierTotals } };
}

function loadRfq(id: string) {
  return prisma.rfq.findUnique({ where: { id }, include: rfqInclude });
}

export async function rfqRoutes(app: FastifyInstance) {
  app.get("/rfqs", async (req) => {
    const { projectId, nodeId, status } = req.query as { projectId?: string; nodeId?: string; status?: string };
    return prisma.rfq.findMany({
      where: {
        projectId: projectId || undefined,
        nodeId: nodeId || undefined,
        status: (status as RfqStatus) || undefined,
      },
      orderBy: { createdAt: "desc" },
      include: {
        node: { select: { id: true, name: true } },
        _count: { select: { items: true, suppliers: true } },
        suppliers: { select: { respondedAt: true, awarded: true } },
      },
    });
  });

  app.get("/rfqs/:id", async (req) => {
    const { id } = req.params as { id: string };
    const rfq = await loadRfq(id);
    if (!rfq) throw notFound("RFQ");
    return decorate(rfq);
  });

  app.post("/rfqs", async (req, reply) => {
    const data = rfqCreate.parse(req.body);

    const project = await prisma.project.findUnique({ where: { id: data.projectId } });
    if (!project) throw badRequest("projectId does not exist");

    let items = data.items.map((it, i) => ({ ...it, sortOrder: i * 10 }));

    if (data.nodeId) {
      const node = await prisma.node.findUnique({
        where: { id: data.nodeId },
        include: { bomLines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
      });
      if (!node || node.projectId !== data.projectId) throw badRequest("nodeId is not a node of this project");
      if (data.fromNodeBom && items.length === 0) {
        items = node.bomLines.map((l, i) => ({
          description: l.description,
          quantity: l.quantity,
          uom: l.uom,
          targetCost: l.unitCost || null,
          bomLineId: l.id,
          sortOrder: i * 10,
        }));
      }
    }

    const rfq = await prisma.rfq.create({
      data: {
        projectId: data.projectId,
        nodeId: data.nodeId ?? null,
        number: await nextRfqNumber(),
        title: data.title,
        scope: data.scope ?? null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        items: { create: items },
      },
      include: rfqInclude,
    });
    return reply.status(201).send(decorate(rfq));
  });

  app.patch("/rfqs/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = rfqUpdate.parse(req.body);
    await prisma.rfq.update({
      where: { id },
      data: {
        title: data.title,
        scope: data.scope === undefined ? undefined : data.scope,
        dueDate: data.dueDate === undefined ? undefined : data.dueDate ? new Date(data.dueDate) : null,
        status: data.status,
      },
    });
    return decorate((await loadRfq(id))!);
  });

  app.delete("/rfqs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.rfq.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ---- items ----
  app.post("/rfqs/:id/items", async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = rfqItemInput.parse(req.body);
    const last = await prisma.rfqItem.findFirst({ where: { rfqId: id }, orderBy: { sortOrder: "desc" } });
    await prisma.rfqItem.create({
      data: { rfqId: id, ...data, sortOrder: data.sortOrder ?? (last ? last.sortOrder + 10 : 0) },
    });
    return reply.status(201).send(decorate((await loadRfq(id))!));
  });

  app.patch("/rfqs/:id/items/:itemId", async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const data = rfqItemUpdate.parse(req.body);
    await prisma.rfqItem.update({ where: { id: itemId }, data });
    return decorate((await loadRfq(id))!);
  });

  app.delete("/rfqs/:id/items/:itemId", async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    await prisma.rfqItem.delete({ where: { id: itemId } });
    return decorate((await loadRfq(id))!);
  });

  // ---- suppliers on the RFQ ----
  app.post("/rfqs/:id/suppliers", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { supplierIds } = rfqAddSuppliers.parse(req.body);

    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      include: { contacts: { orderBy: { isPrimary: "desc" } } },
    });

    for (const s of suppliers) {
      const to = s.contacts.find((c) => c.isPrimary)?.email ?? s.contacts[0]?.email ?? s.email;
      if (!to) throw badRequest(`Supplier "${s.name}" has no email address`);
      await prisma.rfqSupplier.upsert({
        where: { rfqId_supplierId: { rfqId: id, supplierId: s.id } },
        create: { rfqId: id, supplierId: s.id, token: token(), email: to },
        update: {},
      });
    }
    return reply.status(201).send(decorate((await loadRfq(id))!));
  });

  app.delete("/rfqs/:id/suppliers/:rfqSupplierId", async (req) => {
    const { id, rfqSupplierId } = req.params as { id: string; rfqSupplierId: string };
    await prisma.rfqSupplier.delete({ where: { id: rfqSupplierId } });
    return decorate((await loadRfq(id))!);
  });

  // ---- send RFQ emails ----
  app.post("/rfqs/:id/send", async (req) => {
    const { id } = req.params as { id: string };
    const body = rfqSend.parse(req.body ?? {});
    const rfq = await loadRfq(id);
    if (!rfq) throw notFound("RFQ");
    if (rfq.items.length === 0) throw badRequest("Add at least one line item before sending");

    const targets = rfq.suppliers.filter((s) =>
      body.supplierIds ? body.supplierIds.includes(s.id) : !s.sentAt,
    );
    if (targets.length === 0) throw badRequest("No suppliers to send to");

    const due = rfq.dueDate ? new Date(rfq.dueDate).toDateString() : "not specified";
    const lineList = rfq.items
      .map((it, i) => `  ${i + 1}. ${it.description} — ${it.quantity} ${it.uom}`)
      .join("\n");

    const results: { rfqSupplierId: string; email: string; delivered: boolean }[] = [];
    for (const s of targets) {
      const link = portalUrl(s.token);
      const text =
        `Dear ${s.supplier.name},\n\n` +
        `You are invited to quote for ${rfq.project.name} — ${rfq.number}: ${rfq.title}.\n\n` +
        (rfq.scope ? `Scope:\n${rfq.scope}\n\n` : "") +
        `Items:\n${lineList}\n\n` +
        `Response due: ${due}\n\n` +
        (body.message ? `${body.message}\n\n` : "") +
        `Submit your quotation and upload supporting documents here:\n${link}\n\n` +
        `Regards,\nProcurement, ${rfq.project.name}`;
      const html =
        `<p>Dear ${s.supplier.name},</p>` +
        `<p>You are invited to quote for <strong>${rfq.project.name}</strong> — ${rfq.number}: ${rfq.title}.</p>` +
        (rfq.scope ? `<p><strong>Scope:</strong><br>${rfq.scope.replace(/\n/g, "<br>")}</p>` : "") +
        `<ol>${rfq.items.map((it) => `<li>${it.description} — ${it.quantity} ${it.uom}</li>`).join("")}</ol>` +
        `<p><strong>Response due:</strong> ${due}</p>` +
        (body.message ? `<p>${body.message.replace(/\n/g, "<br>")}</p>` : "") +
        `<p><a href="${link}">Submit your quotation &amp; upload documents</a></p>`;

      const sent = await sendMail({ to: s.email, subject: `${rfq.number} · ${rfq.title} — invitation to quote`, text, html });
      await prisma.rfqSupplier.update({ where: { id: s.id }, data: { sentAt: new Date() } });
      results.push({ rfqSupplierId: s.id, email: s.email, delivered: sent.delivered });
    }

    if (rfq.status === "DRAFT") await prisma.rfq.update({ where: { id }, data: { status: "SENT" } });
    return { mailEnabled, sent: results, rfq: decorate((await loadRfq(id))!) };
  });

  // ---- award ----
  app.post("/rfqs/:id/award", async (req) => {
    const { id } = req.params as { id: string };
    const { rfqSupplierId } = rfqAward.parse(req.body);
    const rs = await prisma.rfqSupplier.findUnique({ where: { id: rfqSupplierId } });
    if (!rs || rs.rfqId !== id) throw badRequest("rfqSupplierId is not on this RFQ");
    await prisma.$transaction([
      prisma.rfqSupplier.updateMany({ where: { rfqId: id }, data: { awarded: false } }),
      prisma.rfqSupplier.update({ where: { id: rfqSupplierId }, data: { awarded: true } }),
      prisma.rfq.update({ where: { id }, data: { status: "AWARDED" } }),
    ]);
    return decorate((await loadRfq(id))!);
  });

  // ---- internal attachment download ----
  app.get("/rfqs/:id/attachments/:attachmentId", async (req, reply) => {
    const { attachmentId } = req.params as { attachmentId: string };
    const att = await prisma.rfqAttachment.findUnique({ where: { id: attachmentId } });
    if (!att) throw notFound("Attachment");
    const path = rfqFilePath(att.storedName);
    await stat(path);
    reply.header("Content-Type", att.mimeType || "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${att.filename.replace(/"/g, "")}"`);
    return reply.send(createReadStream(path));
  });
}
