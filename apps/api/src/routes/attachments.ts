import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../http.js";
import { deleteNodeUpload, nodeFilePath, saveNodeUpload } from "../storage.js";

/**
 * PDM-style documents attached to a DMU node — drawings, photos, PDFs,
 * anything. No file-type restriction: whatever is uploaded is stored as-is
 * and served back with its original name and MIME type.
 */
export async function attachmentRoutes(app: FastifyInstance) {
  app.get("/nodes/:nodeId/attachments", async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    return prisma.nodeAttachment.findMany({ where: { nodeId }, orderBy: { uploadedAt: "desc" } });
  });

  app.post("/nodes/:nodeId/attachments", async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) throw notFound("Node");

    const file = await (req as unknown as { file: () => Promise<undefined | {
      filename: string;
      mimetype: string;
      file: NodeJS.ReadableStream;
    }> }).file();
    if (!file) throw badRequest("No file in request");

    const storedName = await saveNodeUpload(file.filename, file.file as never);
    const { size } = await stat(nodeFilePath(storedName));
    const attachment = await prisma.nodeAttachment.create({
      data: {
        nodeId,
        filename: file.filename,
        storedName,
        mimeType: file.mimetype || "application/octet-stream",
        size,
      },
    });
    return reply.status(201).send(attachment);
  });

  app.get("/nodes/:nodeId/attachments/:attachmentId", async (req, reply) => {
    const { nodeId, attachmentId } = req.params as { nodeId: string; attachmentId: string };
    const att = await prisma.nodeAttachment.findFirst({ where: { id: attachmentId, nodeId } });
    if (!att) throw notFound("Attachment");
    const path = nodeFilePath(att.storedName);
    await stat(path); // 404s cleanly if the file went missing on disk
    reply.header("Content-Type", att.mimeType || "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${att.filename.replace(/"/g, "")}"`);
    return reply.send(createReadStream(path));
  });

  app.delete("/nodes/:nodeId/attachments/:attachmentId", async (req, reply) => {
    const { nodeId, attachmentId } = req.params as { nodeId: string; attachmentId: string };
    const att = await prisma.nodeAttachment.findFirst({ where: { id: attachmentId, nodeId } });
    if (!att) throw notFound("Attachment");
    await prisma.nodeAttachment.delete({ where: { id: att.id } });
    await deleteNodeUpload(att.storedName);
    return reply.status(204).send();
  });
}
