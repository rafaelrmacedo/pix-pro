const amqp = require("amqplib");
const { createEventEnvelope } = require("./events/event-envelope");
const { assertPixProTopology, MQ_EXCHANGES } = require("./mq-topology");

async function connectMQ(url, retries = 5, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(url);
      const channel = await connection.createChannel();

      await assertPixProTopology(channel);

      connection.on("error", (err) => {
        console.error("[MQ] Connection error:", err.message);
      });

      connection.on("close", () => {
        console.error("[MQ] Connection closed. Exiting for restart...");
        process.exit(1);
      });

      console.log(`Connected to RabbitMQ at ${url}`);
      return {
        connection,
        channel,
        exchange: MQ_EXCHANGES.EVENTS,
        eventExchange: MQ_EXCHANGES.EVENTS,
        commandExchange: MQ_EXCHANGES.COMMANDS
      };
    } catch (error) {
      const isLastRetry = i === retries - 1;
      console.error(`Error connecting to RabbitMQ (attempt ${i + 1}/${retries}):`, error.message);
      
      if (isLastRetry) {
        throw error;
      }

      console.log(`Retrying in ${delay / 1000}s...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

async function publishEvent(channel, exchange, routingKey, data, metadata = {}) {
  if (!channel) {
    console.error(`[MQ] Cannot publish to ${routingKey}: Channel not initialized`);
    return;
  }

  const payload = Buffer.from(JSON.stringify(createEventEnvelope(routingKey, data, metadata)));

  try {
    channel.publish(exchange, routingKey, payload, {
      contentType: "application/json",
      persistent: true
    });
    console.log(`[MQ] Event published: ${routingKey}`);
  } catch (error) {
    console.error(`[MQ] Error publishing to ${routingKey}:`, error.message);
  }
}

async function publishCommand(channel, exchange, routingKey, command) {
  if (!channel) {
    console.error(`[MQ] Cannot publish command ${routingKey}: Channel not initialized`);
    return;
  }

  const payload = Buffer.from(JSON.stringify({
    ...command,
    type: command.type || routingKey,
    queuedAt: new Date().toISOString()
  }));

  try {
    channel.publish(exchange, routingKey, payload, {
      contentType: "application/json",
      persistent: true
    });
    console.log(`[MQ] Command published: ${routingKey}`);
  } catch (error) {
    console.error(`[MQ] Error publishing command ${routingKey}:`, error.message);
  }
}

module.exports = { connectMQ, publishEvent, publishCommand };
