export const paymentDelayMs = 2000;

export function parseOrderJob(jobData) {
  const orderId = Number(jobData?.orderId);
  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    throw new Error("job data needs a positive orderId");
  }
  return {
    orderId,
    reference: typeof jobData.reference === "string" ? jobData.reference : null,
  };
}

export function auditDetail(paidOrder) {
  return {
    reference: paidOrder.reference,
    totalCents: paidOrder.total_cents,
    status: "paid",
  };
}

export function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
