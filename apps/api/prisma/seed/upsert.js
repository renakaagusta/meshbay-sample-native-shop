function sameValue(existingValue, desiredValue) {
  if (existingValue === desiredValue) {
    return true;
  }
  if (existingValue === null || existingValue === undefined) {
    return false;
  }
  if (desiredValue === null || desiredValue === undefined) {
    return false;
  }
  if (existingValue instanceof Date || desiredValue instanceof Date) {
    return new Date(existingValue).getTime() === new Date(desiredValue).getTime();
  }
  const existingNumber = Number(existingValue);
  const desiredNumber = Number(desiredValue);
  if (Number.isFinite(existingNumber) && Number.isFinite(desiredNumber)) {
    return existingNumber === desiredNumber;
  }
  return String(existingValue) === String(desiredValue);
}

export function sameValues(existingRow, desiredRow, keyField) {
  return Object.keys(desiredRow).every(
    (field) => field === keyField || sameValue(existingRow[field], desiredRow[field]),
  );
}

export async function synchroniseRows({ label, keyField, rows, listExisting, upsertRow }) {
  const existingRows = await listExisting();
  const existingByKey = new Map(
    existingRows.map((existingRow) => [existingRow[keyField], existingRow]),
  );
  let upserted = 0;
  let unchanged = 0;
  for (const desiredRow of rows) {
    const existingRow = existingByKey.get(desiredRow[keyField]);
    if (existingRow && sameValues(existingRow, desiredRow, keyField)) {
      unchanged += 1;
      continue;
    }
    await upsertRow(desiredRow);
    upserted += 1;
  }
  console.log(`seed: ${label} upserted=${upserted} unchanged=${unchanged}`);
  return { upserted, unchanged };
}
