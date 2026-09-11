// Poll the Docker Postgres until it accepts connections (used by `npm run setup`).
import { execSync } from "node:child_process";

const RETRIES = 30;
for (let i = 1; i <= RETRIES; i++) {
  try {
    execSync("docker exec plmc-db pg_isready -U plmc -d plmc", { stdio: "ignore" });
    console.log("database is ready");
    process.exit(0);
  } catch {
    process.stdout.write(`waiting for database (${i}/${RETRIES})\r`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
console.error("\ndatabase did not become ready in time");
process.exit(1);
