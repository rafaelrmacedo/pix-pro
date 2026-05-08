import BaseCommand from "../../shared/src/cqrs/base-command.js";
import BaseQuery from "../../shared/src/cqrs/base-query.js";
import { COMMAND_TYPES } from "../../shared/src/cqrs/command-types.js";
import { QUERY_TYPES } from "../../shared/src/cqrs/query-types.js";
import { EVENT_TYPES } from "../../shared/src/events/event-types.js";
import {
  createProjectHandlers,
  createProjectProjection,
  normalizeProjectName
} from "../src/project-handlers.js";

describe("Project Handlers", () => {
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

    expect(result.status).toBe("completed");
    expect(result.consistency).toBe("eventual");
    expect(savedProjects[0]).toEqual({
      id: "project-1",
      name: "Portfolio",
      createdAt: savedProjects[0].createdAt
    });
    expect(publishedEvents[0].type).toBe(EVENT_TYPES.PROJECT_CREATED);
    expect(publishedEvents[0].payload.id).toBe("project-1");
    expect(publishedEvents[0].metadata.aggregateType).toBe("project");
  });

  test("project queries read from the Redis read model abstraction", async () => {
    const projects = [{ id: "project-1", name: "Portfolio" }];
    const handlers = createProjectHandlers({
      writeRepository: {},
      eventBus: {},
      readModel: {
        async listProjects(filters) {
          expect(filters).toEqual({ name: "Port" });
          return projects;
        },
        async getProjectById(id) {
          expect(id).toBe("project-1");
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

    expect(listResult.source).toBe("redis-read-model");
    expect(listResult.projects).toEqual(projects);
    expect(getResult.project).toEqual(projects[0]);
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

    expect(upserts).toEqual([{ id: "project-1", name: "Portfolio" }]);
  });

  test("project name validation rejects empty names", () => {
    expect(() => normalizeProjectName(" ")).toThrow(/Project name is required/);
  });
});
