import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/http.js";
import {
  productResponse,
  requirePriceCents,
  requireProductName,
  requireSku,
  unitPriceCents,
} from "../src/products.js";

test("requireSku trims and rejects an empty sku", () => {
  assert.equal(requireSku({ sku: "  kopi-gayo-1kg " }), "kopi-gayo-1kg");
  assert.throws(() => requireSku({ sku: "   " }), HttpError);
  assert.throws(() => requireSku({}), HttpError);
});

test("requireProductName trims and rejects an empty name", () => {
  assert.equal(requireProductName({ name: " Kopi Gayo " }), "Kopi Gayo");
  assert.throws(() => requireProductName({ name: "" }), HttpError);
});

test("requirePriceCents accepts priceCents and a decimal price", () => {
  assert.equal(requirePriceCents({ priceCents: 1250 }), 1250);
  assert.equal(requirePriceCents({ price: "12.5" }), 1250);
  assert.throws(() => requirePriceCents({ priceCents: -1 }), HttpError);
  assert.throws(() => requirePriceCents({ price: "free" }), HttpError);
  assert.throws(() => requirePriceCents({}), HttpError);
});

test("unitPriceCents reads the cents column", () => {
  assert.equal(unitPriceCents({ priceCents: 1250 }), 1250);
});

test("productResponse exposes cents and the decimal price together", () => {
  const product = productResponse({
    id: 3,
    sku: "kopi-gayo-1kg",
    name: "Kopi Gayo 1kg",
    priceCents: 12500,
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
  });
  assert.equal(product.priceCents, 12500);
  assert.equal(product.price, "125.00");
  assert.equal(product.sku, "kopi-gayo-1kg");
});
