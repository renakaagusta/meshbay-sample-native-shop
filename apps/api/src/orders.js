import { randomBytes } from "node:crypto";

import { HttpError } from "./http.js";

export const orderStatuses = ["pending", "paid", "cancelled"];

export function requireQuantity(payload) {
  if (payload.quantity === undefined) {
    return 1;
  }
  if (!Number.isSafeInteger(payload.quantity) || payload.quantity < 1) {
    throw new HttpError(400, "quantity must be a positive integer");
  }
  return payload.quantity;
}

export function requireOrderStatus(payload) {
  if (!orderStatuses.includes(payload.status)) {
    throw new HttpError(400, `status must be one of ${orderStatuses.join(", ")}`);
  }
  return payload.status;
}

export function orderReference(now = new Date()) {
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `ord-${stamp}-${randomBytes(4).toString("hex")}`;
}

export function orderResponse(order) {
  return {
    id: order.id,
    reference: order.reference,
    productId: order.productId,
    quantity: order.quantity,
    status: order.status,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
}
