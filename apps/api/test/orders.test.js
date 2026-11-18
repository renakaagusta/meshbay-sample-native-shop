import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/http.js";
import {
  orderReference,
  orderResponse,
  requireOrderStatus,
  requireQuantity,
} from "../src/orders.js";

test("requireQuantity defaults to one and rejects bad quantities", () => {
  assert.equal(requireQuantity({}), 1);
  assert.equal(requireQuantity({ quantity: 3 }), 3);
  assert.throws(() => requireQuantity({ quantity: 0 }), HttpError);
  assert.throws(() => requireQuantity({ quantity: 1.5 }), HttpError);
});

test("requireOrderStatus only accepts the known statuses", () => {
  assert.equal(requireOrderStatus({ status: "cancelled" }), "cancelled");
  assert.throws(() => requireOrderStatus({ status: "refunded" }), HttpError);
});

test("orderReference carries a UTC timestamp and a random suffix", () => {
  const reference = orderReference(new Date("2026-11-18T10:20:30.000Z"));
  assert.match(reference, /^ord-20261118102030-[0-9a-f]{8}$/);
  assert.notEqual(reference, orderReference(new Date("2026-11-18T10:20:30.000Z")));
});

test("orderResponse keeps the JSON contract", () => {
  assert.deepEqual(
    orderResponse({
      id: 4,
      reference: "ord-1",
      productId: 2,
      quantity: 3,
      status: "pending",
      totalCents: 3750,
      createdAt: "2026-11-18T00:00:00.000Z",
      paidAt: null,
    }),
    {
      id: 4,
      reference: "ord-1",
      productId: 2,
      quantity: 3,
      status: "pending",
      totalCents: 3750,
      createdAt: "2026-11-18T00:00:00.000Z",
      paidAt: null,
    },
  );
});
