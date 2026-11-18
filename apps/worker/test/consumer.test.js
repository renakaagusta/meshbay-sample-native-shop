import assert from "node:assert/strict";
import test from "node:test";

import { processOrderJob } from "../src/consumer.js";
import { auditDetail, parseOrderJob } from "../src/payment.js";

function fakeDatabase(responses) {
  const statements = [];
  return {
    statements,
    query: async (statement, values) => {
      statements.push({ statement, values });
      return responses.shift() ?? { rows: [] };
    },
  };
}

test("parseOrderJob keeps the order identifier and reference", () => {
  assert.deepEqual(parseOrderJob({ orderId: 7, reference: "ord-1" }), {
    orderId: 7,
    reference: "ord-1",
  });
  assert.throws(() => parseOrderJob({}), /positive orderId/);
  assert.throws(() => parseOrderJob({ orderId: -2 }), /positive orderId/);
});

test("auditDetail records the paid order", () => {
  assert.deepEqual(auditDetail({ reference: "ord-1", total_cents: 25000 }), {
    reference: "ord-1",
    totalCents: 25000,
    status: "paid",
  });
});

test("a pending order becomes paid and gets one audit row", async () => {
  const database = fakeDatabase([
    { rows: [{ id: 7, reference: "ord-1", total_cents: 25000 }] },
    { rows: [{ id: 1 }] },
  ]);
  const result = await processOrderJob(
    { data: { orderId: 7, reference: "ord-1" } },
    { database, paymentDelayMs: 0 },
  );
  assert.deepEqual(result, { orderId: 7, reference: "ord-1", status: "paid", paid: true });
  assert.equal(database.statements.length, 2);
  assert.deepEqual(database.statements[0].values, [7]);
  assert.match(database.statements[0].statement, /status = 'pending'/);
  assert.deepEqual(database.statements[1].values, [
    7,
    "order.paid",
    JSON.stringify({ reference: "ord-1", totalCents: 25000, status: "paid" }),
  ]);
});

test("an order that is no longer pending is reported without an audit row", async () => {
  const database = fakeDatabase([{ rows: [] }, { rows: [{ id: 7, status: "cancelled" }] }]);
  const result = await processOrderJob(
    { data: { orderId: 7, reference: "ord-7" } },
    { database, paymentDelayMs: 0 },
  );
  assert.deepEqual(result, { orderId: 7, reference: "ord-7", status: "cancelled", paid: false });
  assert.equal(database.statements.length, 2);
});

test("a job for a missing order fails so BullMQ can retry it", async () => {
  const database = fakeDatabase([{ rows: [] }, { rows: [] }]);
  await assert.rejects(
    processOrderJob({ data: { orderId: 99, reference: null } }, { database, paymentDelayMs: 0 }),
    /order 99 does not exist/,
  );
});
