export default class CommandBus {
  constructor() {
    this.handlers = new Map();
  }

  register(type, handler) {
    if (!type || typeof handler !== "function") {
      throw new Error("Command handlers require a type and function");
    }

    this.handlers.set(type, handler);
  }

  async execute(command) {
    const handler = this.handlers.get(command.type);

    if (!handler) {
      throw new Error(`No command handler registered for ${command.type}`);
    }

    return handler(command);
  }
}