import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

import { logEvent } from "../src/log.js";

const failingMigrationStep = "4";

async function runFailingProbe() {
  if (process.env.FAIL_MIGRATION !== failingMigrationStep) {
    return;
  }
  logEvent("warn", "FAIL_MIGRATION=4: running the probe query that always raises");
  const database = new PrismaClient();
  try {
    await database.$queryRawUnsafe("SELECT 1 / 0 AS failing_migration_probe");
  } finally {
    await database.$disconnect();
  }
}

async function main() {
  try {
    await runFailingProbe();
  } catch (probeError) {
    logEvent("error", "pre-deploy stopped before prisma migrate deploy", {
      failMigration: process.env.FAIL_MIGRATION,
      error: probeError.message,
    });
    process.exitCode = 1;
    return;
  }

  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
  if (migrate.error) {
    logEvent("error", "prisma migrate deploy could not start", { error: migrate.error.message });
    process.exitCode = 1;
    return;
  }
  process.exitCode = migrate.status ?? 1;
}

main();
