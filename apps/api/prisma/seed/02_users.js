import { isStagingProfile } from "./profiles.js";
import { synchroniseRows } from "./upsert.js";

const demoUserRows = [
  { email: "admin@shop.test", name: "Demo Admin", role: "admin" },
  { email: "customer@shop.test", name: "Demo Customer", role: "customer" },
];

export async function seedUsers({ database, profile }) {
  if (!isStagingProfile(profile)) {
    console.log("seed: users upserted=0 unchanged=0 (production profile: demo users are staging only)");
    return { upserted: 0, unchanged: 0 };
  }
  return synchroniseRows({
    label: "users",
    keyField: "email",
    rows: demoUserRows,
    listExisting: () => database.user.findMany(),
    upsertRow: (userRow) =>
      database.user.upsert({
        where: { email: userRow.email },
        create: userRow,
        update: { name: userRow.name, role: userRow.role },
      }),
  });
}
