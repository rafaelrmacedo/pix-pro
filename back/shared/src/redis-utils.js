import { createClient } from "redis";
import loggerShared from "./logger.js";

const logger = loggerShared.createLogger("redis-utils");

/**
 * Connects to Redis and returns the client.
 * @param {string} url - Redis connection URL.
 * @param {string} serviceName - Name of the service using Redis.
 * @returns {Promise<import("redis").RedisClientType>}
 */
export async function connectRedis(url, serviceName) {
  const client = createClient({ url });

  client.on("error", (err) => logger.error(`Redis Client Error (${serviceName})`, err));

  await client.connect();
  logger.info(`Connected to Redis for ${serviceName}`);

  return client;
}

/**
 * Helper to get/set cache (Cache-Aside pattern).
 * @param {import("redis").RedisClientType} redis - Redis client.
 * @param {string} key - Cache key.
 * @param {Function} fetchFn - Async function to fetch data if not in cache.
 * @param {number} ttl - Time to live in seconds.
 */
export async function getOrSetCache(redis, key, fetchFn, ttl = 3600) {
  if (!redis || !redis.isOpen) {
    return await fetchFn();
  }

  const cachedValue = await redis.get(key);
  if (cachedValue) {
    return JSON.parse(cachedValue);
  }

  const freshData = await fetchFn();
  await redis.set(key, JSON.stringify(freshData), {
    EX: ttl
  });

  return freshData;
}

export default {
  connectRedis,
  getOrSetCache
};
