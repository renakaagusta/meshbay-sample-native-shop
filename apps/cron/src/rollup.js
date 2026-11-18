export const rollupStatement = `
INSERT INTO daily_sales (day, orders, revenue_cents, updated_at)
SELECT COALESCE($1::date, CURRENT_DATE),
       COUNT(*)::integer,
       COALESCE(SUM(total_cents), 0)::integer,
       now()
FROM orders
WHERE status = 'paid'
  AND paid_at >= COALESCE($1::date, CURRENT_DATE)
  AND paid_at < (COALESCE($1::date, CURRENT_DATE) + INTERVAL '1 day')
ON CONFLICT (day) DO UPDATE
SET orders = EXCLUDED.orders,
    revenue_cents = EXCLUDED.revenue_cents,
    updated_at = now()
RETURNING to_char(day, 'YYYY-MM-DD') AS day, orders, revenue_cents
`;

function normaliseDay(calendarDay) {
  if (typeof calendarDay === "string") {
    return calendarDay.slice(0, 10);
  }
  const year = calendarDay.getFullYear();
  const month = String(calendarDay.getMonth() + 1).padStart(2, "0");
  const date = String(calendarDay.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

export async function rollupDay(database, calendarDay = null) {
  const result = await database.query(rollupStatement, [calendarDay]);
  const rollupRow = result.rows[0];
  return {
    day: normaliseDay(rollupRow.day),
    orders: rollupRow.orders,
    revenueCents: rollupRow.revenue_cents,
  };
}
