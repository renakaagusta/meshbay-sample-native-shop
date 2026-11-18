export function logEvent(level, message, fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
