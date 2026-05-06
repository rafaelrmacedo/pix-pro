const { createEventEnvelope } = require("./event-envelope");

class RabbitMQEventBus {
  constructor({ channel, exchange }) {
    this.channel = channel;
    this.exchange = exchange;
  }

  async publish(type, payload, metadata = {}) {
    const event = createEventEnvelope(type, payload, metadata);
    const body = Buffer.from(JSON.stringify(event));

    this.channel.publish(this.exchange, type, body, {
      contentType: "application/json",
      persistent: true
    });

    console.log(`[EventBus] Published ${type}`);
    return event;
  }

  async subscribe({ queue, routingKeys, handler }) {
    await this.channel.assertQueue(queue, { durable: true });

    for (const routingKey of routingKeys) {
      await this.channel.bindQueue(queue, this.exchange, routingKey);
    }

    return this.channel.consume(queue, async (msg) => {
      if (!msg) {
        return;
      }

      const routingKey = msg.fields.routingKey;

      try {
        const event = JSON.parse(msg.content.toString());
        await handler(event, routingKey);
        this.channel.ack(msg);
      } catch (error) {
        console.error(`[EventBus] Error handling ${routingKey}:`, error.message);
        this.channel.nack(msg, false, false);
      }
    });
  }
}

module.exports = { RabbitMQEventBus };
