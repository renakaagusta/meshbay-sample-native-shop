import { createDatabase } from "./src/database.js";
import { logEvent } from "./src/log.js";
import { rollupDay } from "./src/rollup.js";

async function runRollup() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  const database = createDatabase(process.env.DATABASE_URL);
  try {
    const summary = await rollupDay(database);
    logEvent("info", "daily_sales rollup written", {
      day: summary.day,
      orders: summary.orders,
      revenueCents: summary.revenueCents,
    });
  } finally {
    await database.end();
  }
}

runRollup().catch((runError) => {
  logEvent("error", "daily_sales rollup failed", { error: runError.message });
  process.exitCode = 1;
});
