import { COMMAND_TYPES } from "./cqrs/command-types.js";
import { EVENT_TYPES } from "./events/event-types.js";

export const MQ_EXCHANGES = {
  COMMANDS: "pixpro.commands",
  EVENTS: "pixpro.events"
};

export const MQ_QUEUES = {
  PROJECT_COMMANDS: "project_command_queue",
  PROJECT_PROJECTIONS: "project_projection_queue",
  IMAGE_COMMANDS: "image_command_queue",
  NOTIFICATIONS: "notification_queue"
};

export const MQ_BINDINGS = [
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

export async function assertPixProTopology(channel) {
  // We only assert exchanges here. 
  // Queues are asserted by individual services to allow custom arguments (like DLX).
  await channel.assertExchange(MQ_EXCHANGES.COMMANDS, "topic", { durable: true });
  await channel.assertExchange(MQ_EXCHANGES.EVENTS, "topic", { durable: true });
}

export default {
  MQ_EXCHANGES,
  MQ_QUEUES,
  MQ_BINDINGS,
  assertPixProTopology
};
