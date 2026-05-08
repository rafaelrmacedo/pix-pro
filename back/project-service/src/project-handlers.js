import { randomUUID } from "crypto";
import { COMMAND_TYPES } from "../../shared/src/cqrs/command-types.js";
import { QUERY_TYPES } from "../../shared/src/cqrs/query-types.js";
import { EVENT_TYPES } from "../../shared/src/events/event-types.js";

export function normalizeProjectName(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Project name is required");
  }

  return name.trim();
}

export function createProjectHandlers({ writeRepository, readModel, eventBus }) {
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

export function createProjectProjection({ readModel }) {
  return async (event) => {
    if (event.type !== EVENT_TYPES.PROJECT_CREATED) {
      return;
    }

    await readModel.upsertProject(event.payload);
  };
}

export default {
  createProjectHandlers,
  createProjectProjection,
  normalizeProjectName
};
