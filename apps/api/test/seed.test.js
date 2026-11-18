import assert from "node:assert/strict";
import test from "node:test";

import { runSeed, seedSteps } from "../prisma/seed/index.js";
import { resolveSeedProfile } from "../prisma/seed/profiles.js";
import { sameValues, synchroniseRows } from "../prisma/seed/upsert.js";

function createModelStore(tables, tableName, keyField) {
  return {
    findMany: async () => tables[tableName].map((existingRow) => ({ ...existingRow })),
    upsert: async ({ where, create, update }) => {
      const rowKey = where[keyField];
      const existingIndex = tables[tableName].findIndex(
        (existingRow) => existingRow[keyField] === rowKey,
      );
      if (existingIndex === -1) {
        const createdRow = { id: tables[tableName].length + 1, ...create };
        tables[tableName].push(createdRow);
        return createdRow;
      }
      const updatedRow = { ...tables[tableName][existingIndex], ...update };
      tables[tableName][existingIndex] = updatedRow;
      return updatedRow;
    },
  };
}

function createFakeDatabase() {
  const tables = { plan: [], user: [], product: [], order: [] };
  return {
    tables,
    plan: createModelStore(tables, "plan", "code"),
    user: createModelStore(tables, "user", "email"),
    product: createModelStore(tables, "product", "sku"),
    order: createModelStore(tables, "order", "reference"),
  };
}

test("resolveSeedProfile defaults to production and rejects unknown profiles", () => {
  assert.equal(resolveSeedProfile(undefined), "production");
  assert.equal(resolveSeedProfile(""), "production");
  assert.equal(resolveSeedProfile("staging"), "staging");
  assert.throws(() => resolveSeedProfile("preview"), /SEED_PROFILE/);
});

test("seed steps run plans, users, products and orders in order", () => {
  assert.deepEqual(
    seedSteps.map((seedStep) => seedStep.name),
    ["seedPlans", "seedUsers", "seedProducts", "seedOrders"],
  );
});

test("sameValues compares numbers, dates and nulls", () => {
  assert.equal(
    sameValues({ sku: "a", price: 12.5 }, { sku: "a", price: "12.50" }, "sku"),
    true,
  );
  assert.equal(
    sameValues({ paidAt: new Date("2026-01-01T09:00:00.000Z") }, { paidAt: new Date("2026-01-01T09:00:00.000Z") }, "reference"),
    true,
  );
  assert.equal(sameValues({ paidAt: null }, { paidAt: null }, "reference"), true);
  assert.equal(sameValues({ paidAt: null }, { paidAt: new Date() }, "reference"), false);
  assert.equal(sameValues({ quantity: 1 }, { quantity: 2 }, "reference"), false);
});

test("synchroniseRows reports what it wrote", async () => {
  const existingRows = [{ code: "starter", name: "Starter", priceCents: 0 }];
  const writtenRows = [];
  const summary = await synchroniseRows({
    label: "plans",
    keyField: "code",
    rows: [
      { code: "starter", name: "Starter", priceCents: 0 },
      { code: "growth", name: "Growth", priceCents: 2900 },
    ],
    listExisting: async () => existingRows,
    upsertRow: async (desiredRow) => {
      writtenRows.push(desiredRow);
    },
  });
  assert.deepEqual(summary, { upserted: 1, unchanged: 1 });
  assert.deepEqual(writtenRows, [{ code: "growth", name: "Growth", priceCents: 2900 }]);
});

test("a second staging seed run only reports unchanged rows", async () => {
  const database = createFakeDatabase();
  const firstRun = await runSeed({ database, profile: "staging" });
  assert.deepEqual(firstRun.seedPlans, { upserted: 3, unchanged: 0 });
  assert.deepEqual(firstRun.seedUsers, { upserted: 2, unchanged: 0 });
  assert.deepEqual(firstRun.seedProducts, { upserted: 3, unchanged: 0 });
  assert.deepEqual(firstRun.seedOrders, { upserted: 50, unchanged: 0 });

  const secondRun = await runSeed({ database, profile: "staging" });
  assert.deepEqual(secondRun.seedPlans, { upserted: 0, unchanged: 3 });
  assert.deepEqual(secondRun.seedUsers, { upserted: 0, unchanged: 2 });
  assert.deepEqual(secondRun.seedProducts, { upserted: 0, unchanged: 3 });
  assert.deepEqual(secondRun.seedOrders, { upserted: 0, unchanged: 50 });
  assert.equal(database.tables.order.length, 50);
  assert.equal(database.tables.user.length, 2);
});

test("the production profile seeds reference data only", async () => {
  const database = createFakeDatabase();
  const summary = await runSeed({ database, profile: "production" });
  assert.deepEqual(summary.seedPlans, { upserted: 3, unchanged: 0 });
  assert.deepEqual(summary.seedUsers, { upserted: 0, unchanged: 0 });
  assert.deepEqual(summary.seedProducts, { upserted: 3, unchanged: 0 });
  assert.deepEqual(summary.seedOrders, { upserted: 0, unchanged: 0 });
  assert.equal(database.tables.order.length, 0);
  assert.equal(database.tables.user.length, 0);
});
