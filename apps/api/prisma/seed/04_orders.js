import { unitPriceCents } from "../../src/products.js";

import { isStagingProfile } from "./profiles.js";
import { synchroniseRows } from "./upsert.js";

const demoOrderCount = 50;
const demoPaidOrderCount = 10;
const demoPaidAt = new Date("2026-01-01T09:00:00.000Z");

function demoOrderRows(products) {
  const rows = [];
  for (let orderIndex = 0; orderIndex < demoOrderCount; orderIndex += 1) {
    const product = products[orderIndex % products.length];
    const quantity = (orderIndex % 3) + 1;
    const paid = orderIndex < demoPaidOrderCount;
    rows.push({
      reference: `demo-order-${String(orderIndex + 1).padStart(3, "0")}`,
      productId: product.id,
      quantity,
      status: paid ? "paid" : "pending",
      totalCents: unitPriceCents(product) * quantity,
      paidAt: paid ? demoPaidAt : null,
    });
  }
  return rows;
}

export async function seedOrders({ database, profile }) {
  if (!isStagingProfile(profile)) {
    console.log("seed: orders upserted=0 unchanged=0 (production profile: demo orders are staging only)");
    return { upserted: 0, unchanged: 0 };
  }
  const products = await database.product.findMany({ orderBy: { sku: "asc" } });
  if (products.length === 0) {
    throw new Error("seed: orders need seeded products");
  }
  const rows = demoOrderRows(products);
  return synchroniseRows({
    label: "orders",
    keyField: "reference",
    rows,
    listExisting: () => database.order.findMany(),
    upsertRow: (orderRow) =>
      database.order.upsert({
        where: { reference: orderRow.reference },
        create: orderRow,
        update: {
          productId: orderRow.productId,
          quantity: orderRow.quantity,
          status: orderRow.status,
          totalCents: orderRow.totalCents,
          paidAt: orderRow.paidAt,
        },
      }),
  });
}
