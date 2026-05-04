import { connect } from "amqplib";
import { withRetry } from "./retry";

const EXCHANGE_NAME = "pixpro.events";
const DLX_NAME = "pixpro.dlx";

async function connectMQ(url, serviceName = "unknown") {
  return withRetry(async () => {
    const connection = await connect(url);
    const channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
    await channel.assertExchange(DLX_NAME, "fanout", { durable: true });

    connection.on("error", (err) => {
      console.error(`[MQ] ${serviceName} connection error:`, err.message);
    });

    connection.on("close", () => {
      console.error(`[MQ] ${serviceName} connection closed. Exiting for restart...`);
      process.exit(1);
    });

    console.log(`[MQ] ${serviceName} connected to RabbitMQ at ${url}`);
    return { connection, channel, exchange: EXCHANGE_NAME };
  }, {
    maxRetries: 10,
    onRetry: (err, attempt) => {
      console.log(`[MQ] ${serviceName} connection attempt ${attempt} failed. Retrying...`);
    }
  });
}

async function publishEvent(channel, routingKey, data, correlationId = null) {
  if (!channel) {
    console.error(`[MQ] Cannot publish to ${routingKey}: Channel not initialized`);
    return;
  }

  const payload = Buffer.from(JSON.stringify({
    ...data,
    correlationId,
    emittedAt: new Date().toISOString()
  }));

  try {
    channel.publish(EXCHANGE_NAME, routingKey, payload, { persistent: true });
    console.log(`[MQ] Event published: ${routingKey}${correlationId ? ` (CID:${correlationId})` : ""}`);
  } catch (error) {
    console.error(`[MQ] Error publishing to ${routingKey}:`, error.message);
  }
}

async function assertQueueWithDLQ(channel, queueName, routingKey) {
  const dlqName = `${queueName}.dlq`;

  // Assert DLQ
  await channel.assertQueue(dlqName, { durable: true });
  await channel.bindQueue(dlqName, DLX_NAME, "");

  // Assert main queue with DLX configuration
  await channel.assertQueue(queueName, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": DLX_NAME,
      "x-dead-letter-routing-key": ""
    }
  });

  if (routingKey) {
    await channel.bindQueue(queueName, EXCHANGE_NAME, routingKey);
  }

  return { queue: queueName, dlq: dlqName };
}

export default { connectMQ, publishEvent, assertQueueWithDLQ };