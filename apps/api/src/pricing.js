const centsPerUnit = 100;

export function priceToCents(price) {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) {
    throw new RangeError("price must be a non-negative number");
  }
  return Math.round(numericPrice * centsPerUnit);
}

export function centsToPrice(priceCents) {
  return (priceCents / centsPerUnit).toFixed(2);
}

export function productPriceColumns(priceCents) {
  return { priceCents };
}
