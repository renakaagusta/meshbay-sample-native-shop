import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpError,
  normalizePath,
  parsePositiveInteger,
  parseRequestURL,
} from "../src/http.js";

test("normalizePath drops trailing slashes and the /api prefix", () => {
  assert.equal(normalizePath("/products/"), "/products");
  assert.equal(normalizePath("/api/orders"), "/orders");
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath(""), "/");
});

test("parsePositiveInteger rejects zero, negatives and fractions", () => {
  assert.equal(parsePositiveInteger("7", "item id"), 7);
  assert.throws(() => parsePositiveInteger("0", "item id"), HttpError);
  assert.throws(() => parsePositiveInteger("-3", "item id"), HttpError);
  assert.throws(() => parsePositiveInteger("2.5", "item id"), HttpError);
});

test("parseRequestURL reads the request path", () => {
  assert.equal(parseRequestURL({ url: "/orders?limit=2" }).pathname, "/orders");
});
