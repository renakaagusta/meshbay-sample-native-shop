import { Worker } from "bullmq";
import IORedis from "ioredis";

import { orderQueueName, processOrderJob } from "./src/consumer.js";
import { createDatabase } from "./src/database.js";
import { logEvent } from "./src/log.js";
import { paymentDelayMs } from "./src/payment.js";

async function start() {
  for (const requiredVariable of ["DATABASE_URL", "REDIS_URL"]) {
    if (!process.env[requiredVariable]) {
      throw new Error(`${requiredVariable} is required`);
    }
  }

  const database = createDatabase(process.env.DATABASE_URL);
  const redisConnection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = new Worker(orderQueueName, (queueJob) => processOrderJob(queueJob, { database }), {
    connection: redisConnection,
    concurrency: 1,
  });

  worker.on("completed", (completedJob, result) => {
    logEvent("info", "order job completed", {
      jobId: completedJob.id,
      orderId: result?.orderId ?? completedJob.data?.orderId ?? null,
      paid: result?.paid ?? null,
    });
  });

  worker.on("failed", (failedJob, jobError) => {
    logEvent("error", "order job failed", {
      jobId: failedJob?.id ?? null,
      orderId: failedJob?.data?.orderId ?? null,
      error: jobError.message,
    });
  });

  logEvent("info", "worker started", { queue: orderQueueName, paymentDelayMs });

  const shutdown = (signal) => {
    logEvent("info", "shutting down", { signal });
    Promise.allSettled([worker.close(), redisConnection.quit()])
      .then(() => database.end())
      .finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((startError) => {
  logEvent("error", "startup failed", { error: startError.message });
  process.exitCode = 1;
});
