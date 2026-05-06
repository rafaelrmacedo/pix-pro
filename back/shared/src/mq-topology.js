const { COMMAND_TYPES } = require("./cqrs/command-types");
const { EVENT_TYPES } = require("./events/event-types");

const MQ_EXCHANGES = {
  COMMANDS: "pixpro.commands",
  EVENTS: "pixpro.events"
};

const MQ_QUEUES = {
  PROJECT_COMMANDS: "project_command_queue",
  PROJECT_PROJECTIONS: "project_projection_queue",
  IMAGE_COMMANDS: "image_command_queue",
  NOTIFICATIONS: "notification_queue"
};

const MQ_BINDINGS = [
  {
    queue: MQ_QUEUES.PROJECT_COMMANDS,
    exchange: MQ_EXCHANGES.COMMANDS,
    routingKey: COMMAND_TYPES.CREATE_PROJECT
  },
  {
    queue: MQ_QUEUES.PROJECT_PROJECTIONS,
    exchange: MQ_EXCHANGES.EVENTS,
    routingKey: EVENT_TYPES.PROJECT_CREATED
  },
  {
    queue: MQ_QUEUES.IMAGE_COMMANDS,
    exchange: MQ_EXCHANGES.COMMANDS,
    routingKey: COMMAND_TYPES.REQUEST_IMAGE_PROCESSING
  },
  {
    queue: MQ_QUEUES.NOTIFICATIONS,
    exchange: MQ_EXCHANGES.EVENTS,
    routingKey: "image.*"
  },
  {
    queue: MQ_QUEUES.NOTIFICATIONS,
    exchange: MQ_EXCHANGES.EVENTS,
    routingKey: "project.*"
  }
];

async function assertPixProTopology(channel) {
  await channel.assertExchange(MQ_EXCHANGES.COMMANDS, "topic", { durable: true });
  await channel.assertExchange(MQ_EXCHANGES.EVENTS, "topic", { durable: true });

  for (const binding of MQ_BINDINGS) {
    await channel.assertQueue(binding.queue, { durable: true });
    await channel.bindQueue(binding.queue, binding.exchange, binding.routingKey);
  }
}

module.exports = {
  MQ_EXCHANGES,
  MQ_QUEUES,
  MQ_BINDINGS,
  assertPixProTopology
};
