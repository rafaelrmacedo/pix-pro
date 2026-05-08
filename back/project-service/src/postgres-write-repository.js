const { Pool } = require("pg");

function createProjectWriteRepository({ connectionString }) {
  const pool = new Pool({ connectionString });

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects_write (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `);
  }

  async function createProject(project) {
    const result = await pool.query(
      `
        INSERT INTO projects_write (id, name, created_at)
        VALUES ($1, $2, $3)
        RETURNING id, name, created_at
      `,
      [project.id, project.name, project.createdAt]
    );

    return mapProjectRow(result.rows[0]);
  }

  async function listProjects() {
    const result = await pool.query(`
      SELECT id, name, created_at
      FROM projects_write
      ORDER BY created_at DESC
    `);

    return result.rows.map(mapProjectRow);
  }

  async function close() {
    await pool.end();
  }

  return {
    init,
    createProject,
    listProjects,
    close
  };
}

function mapProjectRow(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString()
  };
}

module.exports = { createProjectWriteRepository };
