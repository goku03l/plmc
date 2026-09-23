import "dotenv/config";

// Prisma bundles dotenv, but load it explicitly so the API picks up apps/api/.env
// even when started from the repo root.
export const env = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Public base URL of the web app, used to build supplier portal links.
  appBaseUrl: (process.env.APP_BASE_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  // No file-type restriction anywhere (DWG, images, PDFs, anything) — this is
  // just a sane upper bound so an unauthenticated caller can't fill the disk.
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_MB ?? 500) * 1024 * 1024,
  mail: {
    from: process.env.MAIL_FROM ?? "Summer Procurement <procurement@summer.local>",
    // when SMTP_HOST is unset the mailer uses a no-send JSON transport and logs
    // the message (fine for local dev); set these for real delivery.
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
  },
};

if (!env.databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to apps/api/.env");
  process.exit(1);
}
