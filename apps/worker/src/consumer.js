import { auditDetail, parseOrderJob, paymentDelayMs, wait } from "./payment.js";

export const orderQueueName = "orders";
export const paidAction = "order.paid";

const markPaidStatement = `
UPDATE orders
SET status = 'paid', paid_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING id, reference, total_cents
`;

const readStatusStatement = "SELECT id, status FROM orders WHERE id = $1";

const insertAuditStatement = `
INSERT INTO order_audit (order_id, action, detail)
VALUES ($1, $2, $3::jsonb)
RETURNING id
`;

export async function processOrderJob(queueJob, dependencies) {
  const { orderId, reference } = parseOrderJob(queueJob.data);
  if (dependencies.paymentDelayMs !== undefined) {
    await wait(dependencies.paymentDelayMs);
  } else {
    await wait(paymentDelayMs);
  }

  const payment = await dependencies.database.query(markPaidStatement, [orderId]);
  const paidOrder = payment.rows[0];
  if (!paidOrder) {
    const existing = await dependencies.database.query(readStatusStatement, [orderId]);
    if (!existing.rows[0]) {
      throw new Error(`order ${orderId} does not exist`);
    }
    return { orderId, reference, status: existing.rows[0].status, paid: false };
  }

  await dependencies.database.query(insertAuditStatement, [
    orderId,
    paidAction,
    JSON.stringify(auditDetail(paidOrder)),
  ]);
  return { orderId, reference: paidOrder.reference ?? reference, status: "paid", paid: true };
}
