import { HttpError } from "./http.js";
import { centsToPrice, priceToCents } from "./pricing.js";

export function requireSku(payload) {
  if (typeof payload.sku !== "string" || payload.sku.trim() === "") {
    throw new HttpError(400, "sku is required and must be a non-empty string");
  }
  return payload.sku.trim();
}

export function requireProductName(payload) {
  if (typeof payload.name !== "string" || payload.name.trim() === "") {
    throw new HttpError(400, "name is required and must be a non-empty string");
  }
  return payload.name.trim();
}

export function requirePriceCents(payload) {
  if (Number.isSafeInteger(payload.priceCents) && payload.priceCents >= 0) {
    return payload.priceCents;
  }
  if (payload.price !== undefined) {
    try {
      return priceToCents(payload.price);
    } catch {
      throw new HttpError(400, "price must be a non-negative number");
    }
  }
  throw new HttpError(400, "priceCents is required and must be a non-negative integer");
}

export function unitPriceCents(product) {
  return product.priceCents;
}

export function productResponse(product) {
  const priceCents = unitPriceCents(product);
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    priceCents,
    price: centsToPrice(priceCents),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}
