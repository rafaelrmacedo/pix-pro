import RabbitMQEventBus from "../src/events/event-bus.js";

describe("RabbitMQEventBus", () => {
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

    expect(published.length).toBe(1);
    expect(published[0].exchange).toBe("pixpro.events");
    expect(published[0].routingKey).toBe("project.created");
    expect(published[0].options.persistent).toBe(true);
    expect(published[0].body.type).toBe("project.created");
    expect(published[0].body.payload).toEqual({ id: "project-1" });
    expect(event.metadata.source).toBe("test");
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

    expect(calls.queues).toEqual(["project_projection_queue"]);
    expect(calls.bindings).toEqual([
      { queue: "project_projection_queue", exchange: "pixpro.events", routingKey: "project.created" }
    ]);
    expect(calls.acked).toBe(true);
    expect(handled[0].routingKey).toBe("project.created");
    expect(handled[0].event.payload).toEqual({ id: "p1" });
  });
});
