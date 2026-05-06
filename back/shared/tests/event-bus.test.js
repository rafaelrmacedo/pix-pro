const test = require("node:test");
const assert = require("node:assert/strict");
const { RabbitMQEventBus } = require("../src/events/event-bus");

test("RabbitMQEventBus publishes durable JSON event envelopes", async () => {
  const published = [];
  const channel = {
    publish(exchange, routingKey, body, options) {
      published.push({
        exchange,
        routingKey,
        body: JSON.parse(body.toString()),
        options
      });
    }
  };
  const bus = new RabbitMQEventBus({ channel, exchange: "pixpro.events" });

  const event = await bus.publish("project.created", { id: "project-1" }, { source: "test" });

  assert.equal(published.length, 1);
  assert.equal(published[0].exchange, "pixpro.events");
  assert.equal(published[0].routingKey, "project.created");
  assert.equal(published[0].options.persistent, true);
  assert.equal(published[0].body.type, "project.created");
  assert.deepEqual(published[0].body.payload, { id: "project-1" });
  assert.equal(event.metadata.source, "test");
});

test("RabbitMQEventBus subscribes, handles messages and acknowledges success", async () => {
  let consumer = null;
  const calls = {
    queues: [],
    bindings: [],
    acked: false
  };
  const channel = {
    async assertQueue(queue) {
      calls.queues.push(queue);
    },
    async bindQueue(queue, exchange, routingKey) {
      calls.bindings.push({ queue, exchange, routingKey });
    },
    consume(_queue, handler) {
      consumer = handler;
      return { consumerTag: "test-consumer" };
    },
    ack() {
      calls.acked = true;
    },
    nack() {
      throw new Error("nack should not be called");
    }
  };
  const bus = new RabbitMQEventBus({ channel, exchange: "pixpro.events" });
  const handled = [];

  await bus.subscribe({
    queue: "project_projection_queue",
    routingKeys: ["project.created"],
    handler: async (event, routingKey) => handled.push({ event, routingKey })
  });

  await consumer({
    fields: { routingKey: "project.created" },
    content: Buffer.from(JSON.stringify({ type: "project.created", payload: { id: "p1" } }))
  });

  assert.deepEqual(calls.queues, ["project_projection_queue"]);
  assert.deepEqual(calls.bindings, [
    { queue: "project_projection_queue", exchange: "pixpro.events", routingKey: "project.created" }
  ]);
  assert.equal(calls.acked, true);
  assert.equal(handled[0].routingKey, "project.created");
  assert.deepEqual(handled[0].event.payload, { id: "p1" });
});
