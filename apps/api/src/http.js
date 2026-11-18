const maximumBodyBytes = 64 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function sendJSON(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

export function sendNoContent(response) {
  response.writeHead(204);
  response.end();
}

export async function readJSONBody(request) {
  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    receivedBytes += chunk.length;
    if (receivedBytes > maximumBodyBytes) {
      throw new HttpError(413, "request body is too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

export function parseRequestURL(request) {
  try {
    return new URL(request.url, "http://placeholder.invalid");
  } catch {
    throw new HttpError(400, "invalid request url");
  }
}

export function normalizePath(pathname) {
  let normalized = pathname.replace(/\/+$/, "");
  if (normalized.startsWith("/api/")) {
    normalized = normalized.slice("/api".length);
  }
  return normalized === "" ? "/" : normalized;
}

export function parsePositiveInteger(value, label) {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
    throw new HttpError(400, `${label} must be a positive integer`);
  }
  return numberValue;
}
