import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "../src/server.js";

function createFakeDependencies(overrides = {}) {
  const productRows = [];
  const dependencies = {
    database: {
      $queryRaw: async () => [{ "?column?": 1 }],
      product: {
        findMany: async () => productRows,
        findUnique: async ({ where }) =>
          productRows.find((productRow) => productRow.id === where.id) ?? null,
        create: async ({ data }) => {
          const product = {
            id: productRows.length + 1,
            createdAt: new Date("2026-11-18T00:00:00.000Z"),
            updatedAt: new Date("2026-11-18T00:00:00.000Z"),
            ...data,
          };
          productRows.push(product);
          return product;
        },
      },
      order: {
        findMany: async () => [],
        findUnique: async ({ where }) => productRows.find((orderRow) => orderRow.id === where.id) ?? null,
        create: async ({ data }) => ({
          id: 11,
          createdAt: new Date("2026-11-18T00:00:00.000Z"),
          paidAt: null,
          ...data,
        }),
        update: async ({ where, data }) => ({ id: where.id, ...data }),
      },
      orderAudit: {
        findMany: async () => [],
      },
    },
    redisConnection: { ping: async () => "PONG" },
    orderQueue: { add: async () => ({ id: "1" }) },
  };
  return { ...dependencies, ...overrides };
}

async function withServer(dependencies, check) {
  const server = createServer(dependencies);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    return await check(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

test("GET /health is 200 when postgres and redis answer", async () => {
  await withServer(createFakeDependencies(), async (baseURL) => {
    const response = await fetch(`${baseURL}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", database: "ok", redis: "ok" });
  });
});

test("GET /health is 503 when postgres is unreachable", async () => {
  const dependencies = createFakeDependencies({
    database: {
      $queryRaw: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    },
  });
  await withServer(dependencies, async (baseURL) => {
    const response = await fetch(`${baseURL}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "error", database: "error", redis: "ok" });
  });
});

test("POST /products stores cents and answers the price contract", async () => {
  const dependencies = createFakeDependencies();
  await withServer(dependencies, async (baseURL) => {
    const response = await fetch(`${baseURL}/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "kopi-gayo-1kg", name: "Kopi Gayo 1kg", priceCents: 12500 }),
    });
    assert.equal(response.status, 201);
    const product = await response.json();
    assert.equal(product.sku, "kopi-gayo-1kg");
    assert.equal(product.priceCents, 12500);
    assert.equal(product.price, "125.00");

    const list = await fetch(`${baseURL}/products`);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).length, 1);
  });
});

test("POST /products without a price is a 400", async () => {
  await withServer(createFakeDependencies(), async (baseURL) => {
    const response = await fetch(`${baseURL}/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "teh-melati-500g", name: "Teh Melati 500g" }),
    });
    assert.equal(response.status, 400);
  });
});

test("POST /orders enqueues the order job and answers 201", async () => {
  const dependencies = createFakeDependencies();
  const queuedJobs = [];
  dependencies.orderQueue = {
    add: async (name, data) => {
      queuedJobs.push({ name, data });
      return { id: "1" };
    },
  };
  await withServer(dependencies, async (baseURL) => {
    const created = await fetch(`${baseURL}/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "kopi-gayo-1kg", name: "Kopi Gayo 1kg", priceCents: 12500 }),
    });
    assert.equal(created.status, 201);

    const response = await fetch(`${baseURL}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId: 1, quantity: 2 }),
    });
    assert.equal(response.status, 201);
    const order = await response.json();
    assert.equal(order.status, "pending");
    assert.equal(order.totalCents, 25000);
    assert.deepEqual(queuedJobs, [
      { name: "order.placed", data: { orderId: 11, reference: order.reference } },
    ]);
  });
});

test("an unknown route is a 404 and the /api prefix is accepted", async () => {
  await withServer(createFakeDependencies(), async (baseURL) => {
    const missing = await fetch(`${baseURL}/nope`);
    assert.equal(missing.status, 404);

    const prefixed = await fetch(`${baseURL}/api/products`);
    assert.equal(prefixed.status, 200);
  });
});
