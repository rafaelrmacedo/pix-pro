const { randomUUID } = require("crypto");
const { COMMAND_TYPES } = require("../../shared/src/cqrs/command-types");
const { QUERY_TYPES } = require("../../shared/src/cqrs/query-types");
const { EVENT_TYPES } = require("../../shared/src/events/event-types");

function normalizeProjectName(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Project name is required");
  }

  return name.trim();
}

function createProjectHandlers({ writeRepository, readModel, eventBus }) {
  return {
    commandHandlers: {
      [COMMAND_TYPES.CREATE_PROJECT]: async (command) => {
        const now = new Date().toISOString();
        const project = {
          id: command.payload.id || `project-${randomUUID()}`,
          name: normalizeProjectName(command.payload.name),
          createdAt: command.payload.createdAt || now
        };

        const savedProject = await writeRepository.createProject(project);

        await eventBus.publish(EVENT_TYPES.PROJECT_CREATED, savedProject, {
          aggregateId: savedProject.id,
          aggregateType: "project",
          source: "project-service"
        });

        return {
          status: "completed",
          consistency: "eventual",
          project: savedProject
        };
      }
    },

    queryHandlers: {
      [QUERY_TYPES.LIST_PROJECTS]: async (query) => ({
        source: "redis-read-model",
        projects: await readModel.listProjects(query.filters)
      }),

      [QUERY_TYPES.GET_PROJECT_BY_ID]: async (query) => ({
        source: "redis-read-model",
        project: await readModel.getProjectById(query.filters.id)
      })
    }
  };
}

function createProjectProjection({ readModel }) {
  return async (event) => {
    if (event.type !== EVENT_TYPES.PROJECT_CREATED) {
      return;
    }

    await readModel.upsertProject(event.payload);
  };
}

module.exports = {
  createProjectHandlers,
  createProjectProjection,
  normalizeProjectName
};
