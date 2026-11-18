import assert from "node:assert/strict";
import test from "node:test";

import { centsToPrice, priceToCents, productPriceColumns } from "../src/pricing.js";

test("priceToCents converts a decimal price into whole cents", () => {
  assert.equal(priceToCents("12.5"), 1250);
  assert.equal(priceToCents(0.1 + 0.2), 30);
  assert.equal(priceToCents("149.995"), 15000);
  assert.equal(priceToCents(0), 0);
});

test("priceToCents rejects negative and non numeric prices", () => {
  assert.throws(() => priceToCents(-1), RangeError);
  assert.throws(() => priceToCents("free"), RangeError);
  assert.throws(() => priceToCents(undefined), RangeError);
});

test("centsToPrice renders two decimals", () => {
  assert.equal(centsToPrice(1250), "12.50");
  assert.equal(centsToPrice(0), "0.00");
});

test("productPriceColumns answers the price contract of the current migration step", () => {
  assert.deepEqual(productPriceColumns(1250), { priceCents: 1250, price: "12.50" });
});
