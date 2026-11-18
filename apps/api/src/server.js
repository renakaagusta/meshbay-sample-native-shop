import http from "node:http";
import { pathToFileURL } from "node:url";

import { createDatabase } from "./database.js";
import {
  HttpError,
  normalizePath,
  parsePositiveInteger,
  parseRequestURL,
  readJSONBody,
  sendJSON,
  sendNoContent,
} from "./http.js";
import { logEvent } from "./log.js";
import {
  orderReference,
  orderResponse,
  orderStatuses,
  requireOrderStatus,
  requireQuantity,
} from "./orders.js";
import { productPriceColumns } from "./pricing.js";
import {
  productResponse,
  requireProductName,
  requirePriceCents,
  requireSku,
  unitPriceCents,
} from "./products.js";
import { createOrderQueue, orderJobName, orderJobOptions } from "./queue.js";

const defaultPort = 8080;

function prismaErrorCode(thrownError) {
  return thrownError && typeof thrownError.code === "string" ? thrownError.code : null;
}

function mapError(requestError) {
  if (requestError instanceof HttpError) {
    return requestError;
  }
  const errorCode = prismaErrorCode(requestError);
  if (errorCode === "P2002") {
    return new HttpError(409, "a record with that unique key already exists");
  }
  if (errorCode === "P2025") {
    return new HttpError(404, "record not found");
  }
  if (errorCode === "P2003") {
    return new HttpError(409, "the record is still referenced by other rows");
  }
  return new HttpError(500, "internal server error");
}

async function healthHandler(request, response, match, dependencies) {
  const checks = { database: "ok", redis: "ok" };
  try {
    await dependencies.database.$queryRaw`SELECT 1`;
  } catch (databaseError) {
    checks.database = "error";
    logEvent("error", "health: database unreachable", { error: databaseError.message });
  }
  try {
    await dependencies.redisConnection.ping();
  } catch (redisError) {
    checks.redis = "error";
    logEvent("error", "health: redis unreachable", { error: redisError.message });
  }
  const healthy = checks.database === "ok" && checks.redis === "ok";
  return sendJSON(response, healthy ? 200 : 503, { status: healthy ? "ok" : "error", ...checks });
}

async function listProductsHandler(request, response, match, dependencies) {
  const products = await dependencies.database.product.findMany({ orderBy: { id: "asc" } });
  return sendJSON(response, 200, products.map(productResponse));
}

async function createProductHandler(request, response, match, dependencies) {
  const payload = await readJSONBody(request);
  const priceCents = requirePriceCents(payload);
  const product = await dependencies.database.product.create({
    data: {
      sku: requireSku(payload),
      name: requireProductName(payload),
      ...productPriceColumns(priceCents),
    },
  });
  logEvent("info", "product created", { productId: product.id, sku: product.sku, priceCents });
  return sendJSON(response, 201, productResponse(product));
}

async function readProductHandler(request, response, match, dependencies) {
  const productIdentifier = parsePositiveInteger(match[1], "product id");
  const product = await dependencies.database.product.findUnique({
    where: { id: productIdentifier },
  });
  if (!product) {
    return sendJSON(response, 404, { error: "product not found" });
  }
  return sendJSON(response, 200, productResponse(product));
}

async function updateProductHandler(request, response, match, dependencies) {
  const productIdentifier = parsePositiveInteger(match[1], "product id");
  const payload = await readJSONBody(request);
  const data = {};
  if (payload.name !== undefined) {
    data.name = requireProductName(payload);
  }
  if (payload.priceCents !== undefined || payload.price !== undefined) {
    Object.assign(data, productPriceColumns(requirePriceCents(payload)));
  }
  if (Object.keys(data).length === 0) {
    throw new HttpError(400, "at least one of name, priceCents or price is required");
  }
  const updated = await dependencies.database.product.updateMany({
    where: { id: productIdentifier },
    data,
  });
  if (updated.count === 0) {
    return sendJSON(response, 404, { error: "product not found" });
  }
  const product = await dependencies.database.product.findUnique({
    where: { id: productIdentifier },
  });
  return sendJSON(response, 200, productResponse(product));
}

async function deleteProductHandler(request, response, match, dependencies) {
  const productIdentifier = parsePositiveInteger(match[1], "product id");
  const deleted = await dependencies.database.product.deleteMany({
    where: { id: productIdentifier },
  });
  if (deleted.count === 0) {
    return sendJSON(response, 404, { error: "product not found" });
  }
  return sendNoContent(response);
}

async function listOrdersHandler(request, response, match, dependencies) {
  const orders = await dependencies.database.order.findMany({ orderBy: { id: "asc" } });
  return sendJSON(response, 200, orders.map(orderResponse));
}

async function findOrderedProduct(database, payload) {
  if (payload.productId !== undefined) {
    const productIdentifier = parsePositiveInteger(payload.productId, "productId");
    const product = await database.product.findUnique({ where: { id: productIdentifier } });
    if (!product) {
      throw new HttpError(400, "unknown product");
    }
    return product;
  }
  if (typeof payload.productSku === "string" && payload.productSku.trim() !== "") {
    const product = await database.product.findUnique({ where: { sku: payload.productSku.trim() } });
    if (!product) {
      throw new HttpError(400, "unknown product");
    }
    return product;
  }
  throw new HttpError(400, "productId or productSku is required");
}

async function createOrderHandler(request, response, match, dependencies) {
  const payload = await readJSONBody(request);
  const quantity = requireQuantity(payload);
  const product = await findOrderedProduct(dependencies.database, payload);
  const order = await dependencies.database.order.create({
    data: {
      reference: orderReference(),
      productId: product.id,
      quantity,
      totalCents: unitPriceCents(product) * quantity,
      status: "pending",
    },
  });
  try {
    await dependencies.orderQueue.add(
      orderJobName,
      { orderId: order.id, reference: order.reference },
      orderJobOptions(),
    );
  } catch (queueError) {
    logEvent("error", "order stored but the queue rejected the job", {
      orderId: order.id,
      error: queueError.message,
    });
    throw new HttpError(503, "order stored but the queue is unreachable");
  }
  logEvent("info", "order placed", {
    orderId: order.id,
    reference: order.reference,
    totalCents: order.totalCents,
  });
  return sendJSON(response, 201, orderResponse(order));
}

async function readOrderHandler(request, response, match, dependencies) {
  const orderIdentifier = parsePositiveInteger(match[1], "order id");
  const order = await dependencies.database.order.findUnique({ where: { id: orderIdentifier } });
  if (!order) {
    return sendJSON(response, 404, { error: "order not found" });
  }
  const audits = await dependencies.database.orderAudit.findMany({
    where: { orderId: orderIdentifier },
    orderBy: { id: "asc" },
  });
  return sendJSON(response, 200, {
    ...orderResponse(order),
    audit: audits.map((audit) => ({
      id: audit.id,
      action: audit.action,
      detail: audit.detail,
      createdAt: audit.createdAt,
    })),
  });
}

async function updateOrderHandler(request, response, match, dependencies) {
  const orderIdentifier = parsePositiveInteger(match[1], "order id");
  const payload = await readJSONBody(request);
  const status = requireOrderStatus(payload);
  const order = await dependencies.database.order.findUnique({ where: { id: orderIdentifier } });
  if (!order) {
    return sendJSON(response, 404, { error: "order not found" });
  }
  if (order.status === "paid" && status !== "paid") {
    throw new HttpError(409, "a paid order cannot move to another status");
  }
  const updated = await dependencies.database.order.update({
    where: { id: orderIdentifier },
    data: {
      status,
      paidAt: status === "paid" ? order.paidAt ?? new Date() : order.paidAt,
    },
  });
  return sendJSON(response, 200, orderResponse(updated));
}

const routes = [
  { method: "GET", pattern: /^\/health$/, handler: healthHandler },
  { method: "GET", pattern: /^\/products$/, handler: listProductsHandler },
  { method: "POST", pattern: /^\/products$/, handler: createProductHandler },
  { method: "GET", pattern: /^\/products\/([0-9]+)$/, handler: readProductHandler },
  { method: "PUT", pattern: /^\/products\/([0-9]+)$/, handler: updateProductHandler },
  { method: "DELETE", pattern: /^\/products\/([0-9]+)$/, handler: deleteProductHandler },
  { method: "GET", pattern: /^\/orders$/, handler: listOrdersHandler },
  { method: "POST", pattern: /^\/orders$/, handler: createOrderHandler },
  { method: "GET", pattern: /^\/orders\/([0-9]+)$/, handler: readOrderHandler },
  { method: "PATCH", pattern: /^\/orders\/([0-9]+)$/, handler: updateOrderHandler },
];

async function handleRequest(request, response, dependencies) {
  const requestURL = parseRequestURL(request);
  const requestPath = normalizePath(requestURL.pathname);
  for (const route of routes) {
    if (route.method !== request.method) {
      continue;
    }
    const routeMatch = route.pattern.exec(requestPath);
    if (routeMatch) {
      return route.handler(request, response, routeMatch, dependencies);
    }
  }
  return sendJSON(response, 404, {
    error: "not found",
    routes: routes.map((route) => `${route.method} ${route.pattern.source}`),
  });
}

export function createServer(dependencies) {
  return http.createServer((request, response) => {
    handleRequest(request, response, dependencies).catch((requestError) => {
      const responseError = mapError(requestError);
      if (responseError.status >= 500) {
        logEvent("error", "request failed", {
          method: request.method,
          url: request.url,
          error: requestError.message,
        });
      }
      sendJSON(response, responseError.status, { error: responseError.message });
    });
  });
}

async function start() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL is required");
  }
  const port = Number(process.env.PORT || defaultPort);
  const database = createDatabase();
  const { orderQueue, redisConnection } = createOrderQueue(process.env.REDIS_URL);
  const server = createServer({ database, orderQueue, redisConnection });

  server.listen(port, () => {
    logEvent("info", "listening", { port, orderStatuses });
  });

  const shutdown = (signal) => {
    logEvent("info", "shutting down", { signal });
    server.close(() => {
      Promise.allSettled([orderQueue.close(), redisConnection.quit()])
        .then(() => database.$disconnect())
        .finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((startError) => {
    logEvent("error", "startup failed", { error: startError.message });
    process.exitCode = 1;
  });
}
