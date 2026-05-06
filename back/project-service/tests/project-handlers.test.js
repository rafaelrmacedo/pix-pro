const test = require("node:test");
const assert = require("node:assert/strict");
const { BaseCommand } = require("../../shared/src/cqrs/base-command");
const { BaseQuery } = require("../../shared/src/cqrs/base-query");
const { COMMAND_TYPES } = require("../../shared/src/cqrs/command-types");
const { QUERY_TYPES } = require("../../shared/src/cqrs/query-types");
const { EVENT_TYPES } = require("../../shared/src/events/event-types");
const {
  createProjectHandlers,
  createProjectProjection,
  normalizeProjectName
} = require("../src/project-handlers");

test("create project command writes to the command model and publishes ProjectCreated", async () => {
  const savedProjects = [];
  const publishedEvents = [];
  const writeRepository = {
    async createProject(project) {
      savedProjects.push(project);
      return project;
    }
  };
  const readModel = {
    async listProjects() {
      return [];
    }
  };
  const eventBus = {
    async publish(type, payload, metadata) {
      publishedEvents.push({ type, payload, metadata });
    }
  };
  const { commandHandlers } = createProjectHandlers({ writeRepository, readModel, eventBus });

  const result = await commandHandlers[COMMAND_TYPES.CREATE_PROJECT](
    new BaseCommand(COMMAND_TYPES.CREATE_PROJECT, { id: "project-1", name: "  Portfolio  " })
  );

  assert.equal(result.status, "completed");
  assert.equal(result.consistency, "eventual");
  assert.deepEqual(savedProjects[0], {
    id: "project-1",
    name: "Portfolio",
    createdAt: savedProjects[0].createdAt
  });
  assert.equal(publishedEvents[0].type, EVENT_TYPES.PROJECT_CREATED);
  assert.equal(publishedEvents[0].payload.id, "project-1");
  assert.equal(publishedEvents[0].metadata.aggregateType, "project");
});

test("project queries read from the Redis read model abstraction", async () => {
  const projects = [{ id: "project-1", name: "Portfolio" }];
  const handlers = createProjectHandlers({
    writeRepository: {},
    eventBus: {},
    readModel: {
      async listProjects(filters) {
        assert.deepEqual(filters, { name: "Port" });
        return projects;
      },
      async getProjectById(id) {
        assert.equal(id, "project-1");
        return projects[0];
      }
    }
  });

  const listResult = await handlers.queryHandlers[QUERY_TYPES.LIST_PROJECTS](
    new BaseQuery(QUERY_TYPES.LIST_PROJECTS, { name: "Port" })
  );
  const getResult = await handlers.queryHandlers[QUERY_TYPES.GET_PROJECT_BY_ID](
    new BaseQuery(QUERY_TYPES.GET_PROJECT_BY_ID, { id: "project-1" })
  );

  assert.equal(listResult.source, "redis-read-model");
  assert.deepEqual(listResult.projects, projects);
  assert.deepEqual(getResult.project, projects[0]);
});

test("ProjectCreated projection updates the read model", async () => {
  const upserts = [];
  const projection = createProjectProjection({
    readModel: {
      async upsertProject(project) {
        upserts.push(project);
      }
    }
  });

  await projection({
    type: EVENT_TYPES.PROJECT_CREATED,
    payload: { id: "project-1", name: "Portfolio" }
  });

  assert.deepEqual(upserts, [{ id: "project-1", name: "Portfolio" }]);
});

test("project name validation rejects empty names", () => {
  assert.throws(() => normalizeProjectName(" "), /Project name is required/);
});
