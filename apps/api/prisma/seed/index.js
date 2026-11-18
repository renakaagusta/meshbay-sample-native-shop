import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { seedPlans } from "./01_plans.js";
import { seedUsers } from "./02_users.js";
import { seedProducts } from "./03_products.js";
import { seedOrders } from "./04_orders.js";
import { resolveSeedProfile } from "./profiles.js";

export const seedSteps = [seedPlans, seedUsers, seedProducts, seedOrders];

export async function runSeed({ database, profile }) {
  const summary = {};
  for (const seedStep of seedSteps) {
    summary[seedStep.name] = await seedStep({ database, profile });
  }
  return summary;
}

async function main() {
  const profile = resolveSeedProfile(process.env.SEED_PROFILE);
  const database = new PrismaClient();
  try {
    await runSeed({ database, profile });
    console.log(`seed: profile=${profile}`);
  } finally {
    await database.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((seedError) => {
    console.error(`seed failed: ${seedError.message}`);
    process.exitCode = 1;
  });
}
