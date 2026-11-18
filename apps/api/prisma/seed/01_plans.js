import { synchroniseRows } from "./upsert.js";

const planRows = [
  { code: "starter", name: "Starter", priceCents: 0 },
  { code: "growth", name: "Growth", priceCents: 2900 },
  { code: "scale", name: "Scale", priceCents: 9900 },
];

export async function seedPlans({ database }) {
  return synchroniseRows({
    label: "plans",
    keyField: "code",
    rows: planRows,
    listExisting: () => database.plan.findMany(),
    upsertRow: (planRow) =>
      database.plan.upsert({
        where: { code: planRow.code },
        create: planRow,
        update: { name: planRow.name, priceCents: planRow.priceCents },
      }),
  });
}
