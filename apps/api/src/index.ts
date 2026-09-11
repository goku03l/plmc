import { buildApp } from "./app.js";
import { env } from "./env.js";
import { prisma } from "./db.js";

const app = buildApp();

app.listen({ port: env.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
