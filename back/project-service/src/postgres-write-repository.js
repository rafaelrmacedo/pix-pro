import pg from "pg";
const { Pool } = pg;

export function createProjectWriteRepository({ connectionString }) {
  const pool = new Pool({ connectionString });

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects_write (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `);
  }

  async function createProject(project) {
    const result = await pool.query(
      `
        INSERT INTO projects_write (id, name, user_id, created_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, user_id, created_at
      `,
      [project.id, project.name, project.userId, project.createdAt]
    );

    return mapProjectRow(result.rows[0]);
  }

  async function listProjects(userId) {
    const result = await pool.query(
      `
        SELECT id, name, user_id, created_at
        FROM projects_write
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [userId]
    );

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
    userId: row.user_id,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString()
  };
}

export default { createProjectWriteRepository };
