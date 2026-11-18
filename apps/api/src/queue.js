import { Queue } from "bullmq";
import IORedis from "ioredis";

export const orderQueueName = "orders";
export const orderJobName = "order.placed";

export function createOrderQueue(redisUrl) {
  const redisConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const orderQueue = new Queue(orderQueueName, { connection: redisConnection });
  return { orderQueue, redisConnection };
}

export function orderJobOptions() {
  return {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}
