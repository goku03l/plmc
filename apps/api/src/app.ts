import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { env } from "./env.js";
import { HttpError } from "./http.js";
import { projectRoutes } from "./routes/projects.js";
import { categoryRoutes } from "./routes/categories.js";
import { nodeRoutes } from "./routes/nodes.js";
import { materialRoutes } from "./routes/materials.js";
import { bomRoutes } from "./routes/bom.js";
import { supplierRoutes } from "./routes/suppliers.js";
import { rfqRoutes } from "./routes/rfqs.js";
import { portalRoutes } from "./routes/portal.js";
import { procurementRoutes } from "./routes/procurement.js";
import { agentRoutes } from "./routes/agent.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { inventoryRoutes } from "./routes/inventory.js";

export function buildApp() {
  const app = Fastify({
    logger: { transport: { target: "pino-pretty" } },
    bodyLimit: 12 * 1024 * 1024, // room for base64 audio clips on /agent/stt
  });

  app.register(cors, { origin: env.corsOrigin });
  // No file-type restriction — any MIME type/extension is accepted everywhere
  // multipart is used (RFQ attachments, node documents). Size is capped by
  // UPLOAD_MAX_MB (default 500MB) just to bound disk use on this unauthenticated app.
  app.register(multipart, { limits: { fileSize: env.uploadMaxBytes, files: 1 } });

  app.get("/api/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  app.register(projectRoutes, { prefix: "/api" });
  app.register(categoryRoutes, { prefix: "/api" });
  app.register(nodeRoutes, { prefix: "/api" });
  app.register(materialRoutes, { prefix: "/api" });
  app.register(bomRoutes, { prefix: "/api" });
  app.register(supplierRoutes, { prefix: "/api" });
  app.register(rfqRoutes, { prefix: "/api" });
  app.register(portalRoutes, { prefix: "/api" });
  app.register(procurementRoutes, { prefix: "/api" });
  app.register(agentRoutes, { prefix: "/api" });
  app.register(attachmentRoutes, { prefix: "/api" });
  app.register(inventoryRoutes, { prefix: "/api" });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: "ValidationError", issues: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.message, details: err.details });
    }
    // Prisma unique-constraint violation
    if ((err as { code?: string }).code === "P2002") {
      return reply.status(409).send({ error: "A record with that unique value already exists" });
    }
    if ((err as { code?: string }).code === "P2025") {
      return reply.status(404).send({ error: "Resource not found" });
    }
    app.log.error(err);
    return reply.status(500).send({ error: "InternalServerError" });
  });

  return app;
}
