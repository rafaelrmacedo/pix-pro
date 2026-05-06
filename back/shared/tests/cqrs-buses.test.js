const test = require("node:test");
const assert = require("node:assert/strict");
const { BaseCommand } = require("../src/cqrs/base-command");
const { BaseQuery } = require("../src/cqrs/base-query");
const { CommandBus } = require("../src/cqrs/command-bus");
const { QueryBus } = require("../src/cqrs/query-bus");

test("CommandBus dispatches commands to the registered handler", async () => {
  const bus = new CommandBus();
  bus.register("project.create", async (command) => ({
    handled: true,
    name: command.payload.name
  }));

  const result = await bus.execute(new BaseCommand("project.create", { name: "Demo" }));

  assert.deepEqual(result, {
    handled: true,
    name: "Demo"
  });
});

test("CommandBus rejects unknown command types", async () => {
  const bus = new CommandBus();

  await assert.rejects(
    () => bus.execute(new BaseCommand("project.unknown", {})),
    /No command handler registered/
  );
});

test("QueryBus dispatches queries to the registered handler", async () => {
  const bus = new QueryBus();
  bus.register("project.list", async (query) => ({
    filters: query.filters,
    projects: []
  }));

  const result = await bus.execute(new BaseQuery("project.list", { name: "demo" }));

  assert.deepEqual(result, {
    filters: { name: "demo" },
    projects: []
  });
});
