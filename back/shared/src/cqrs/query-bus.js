class QueryBus {
  constructor() {
    this.handlers = new Map();
  }

  register(type, handler) {
    if (!type || typeof handler !== "function") {
      throw new Error("Query handlers require a type and function");
    }

    this.handlers.set(type, handler);
  }

  async execute(query) {
    const handler = this.handlers.get(query.type);

    if (!handler) {
      throw new Error(`No query handler registered for ${query.type}`);
    }

    return handler(query);
  }
}

module.exports = { QueryBus };
