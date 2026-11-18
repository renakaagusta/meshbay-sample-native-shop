import { productPriceColumns } from "../../src/pricing.js";

import { synchroniseRows } from "./upsert.js";

const productSeeds = [
  { sku: "kopi-gayo-1kg", name: "Kopi Gayo 1kg", priceCents: 12500 },
  { sku: "kopi-toraja-1kg", name: "Kopi Toraja 1kg", priceCents: 14900 },
  { sku: "teh-melati-500g", name: "Teh Melati 500g", priceCents: 4500 },
];

export function productRows() {
  return productSeeds.map((productSeed) => ({
    sku: productSeed.sku,
    name: productSeed.name,
    ...productPriceColumns(productSeed.priceCents),
  }));
}

export async function seedProducts({ database }) {
  return synchroniseRows({
    label: "products",
    keyField: "sku",
    rows: productRows(),
    listExisting: () => database.product.findMany(),
    upsertRow: (productRow) =>
      database.product.upsert({
        where: { sku: productRow.sku },
        create: productRow,
        update: productRow,
      }),
  });
}
