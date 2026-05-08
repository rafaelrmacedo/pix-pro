const { createClient } = require("redis");

const PROJECT_LIST_KEY = "pixpro:read-model:projects";
const projectKey = (id) => `pixpro:read-model:projects:${id}`;

function createProjectReadModel({ url }) {
  const client = createClient({ url });

  client.on("error", (error) => {
    console.error("[Redis] Read model error:", error.message);
  });

  async function init() {
    if (!client.isOpen) {
      await client.connect();
    }
  }

  async function upsertProject(project) {
    const projects = await listProjects();
    const nextProjects = [
      project,
      ...projects.filter((item) => item.id !== project.id)
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    await client.set(projectKey(project.id), JSON.stringify(project));
    await client.set(PROJECT_LIST_KEY, JSON.stringify(nextProjects));
  }

  async function listProjects(filters = {}) {
    const payload = await client.get(PROJECT_LIST_KEY);
    const projects = payload ? JSON.parse(payload) : [];

    if (!filters.name) {
      return projects;
    }

    const name = String(filters.name).toLowerCase();
    return projects.filter((project) => project.name.toLowerCase().includes(name));
  }

  async function getProjectById(id) {
    if (!id) {
      return null;
    }

    const payload = await client.get(projectKey(id));
    return payload ? JSON.parse(payload) : null;
  }

  async function rebuildProjects(projects) {
    await client.del(PROJECT_LIST_KEY);

    for (const project of projects) {
      await client.set(projectKey(project.id), JSON.stringify(project));
    }

    await client.set(PROJECT_LIST_KEY, JSON.stringify(projects));
  }

  async function close() {
    if (client.isOpen) {
      await client.quit();
    }
  }

  return {
    init,
    upsertProject,
    listProjects,
    getProjectById,
    rebuildProjects,
    close
  };
}

module.exports = { createProjectReadModel };
