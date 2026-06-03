import BaseCommand from "../src/cqrs/base-command.js";
import BaseQuery from "../src/cqrs/base-query.js";
import CommandBus from "../src/cqrs/command-bus.js";
import QueryBus from "../src/cqrs/query-bus.js";

describe("CQRS Buses", () => {
  test("CommandBus dispatches commands to the registered handler", async () => {
    const bus = new CommandBus();
    bus.register("project.create", async (command) => ({
      handled: true,
      name: command.payload.name
    }));

    const result = await bus.execute(new BaseCommand("project.create", { name: "Demo" }));

    expect(result).toEqual({
      handled: true,
      name: "Demo"
    });
  });

  test("CommandBus rejects unknown command types", async () => {
    const bus = new CommandBus();

    await expect(bus.execute(new BaseCommand("project.unknown", {})))
      .rejects.toThrow(/No command handler registered/);
  });

  test("QueryBus dispatches queries to the registered handler", async () => {
    const bus = new QueryBus();
    bus.register("project.list", async (query) => ({
      filters: query.filters,
      projects: []
    }));

    const result = await bus.execute(new BaseQuery("project.list", { name: "demo" }));

    expect(result).toEqual({
      filters: { name: "demo" },
      projects: []
    });
  });
});
