import { test as baseTest, expect } from '@playwright/test';
import { createApiTest } from '@rafael_dev/playwright-api-framework';
import { PixProApi } from '../api/pixpro-api';

const test = createApiTest(baseTest);

test.describe('Projects CQRS API Tests', () => {
  test('should create a project (Command - Write DB) and fetch it by ID (Query - Redis Cache)', async ({ http }) => {
    const api = http.api(PixProApi);

    const projectName = `CQRS Project ${Date.now()}`;
    const createRes = await api.createProject(projectName, 'Testing CQRS Command/Query');
    expect([200, 201]).toContain(createRes.status());

    const createdData = await createRes.json();
    expect(createdData.id).toBeDefined();

    const fetchRes = await api.getProjectById(createdData.id);
    expect(fetchRes.status()).toBe(200);

    const fetchedData = await fetchRes.json();
    expect(fetchedData.name).toBe(projectName);
  });

  test('should list all projects from the Redis query read model', async ({ http }) => {
    const api = http.api(PixProApi);
    const response = await api.getProjects();
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.projects).toBeDefined();
    expect(Array.isArray(data.projects)).toBe(true);
  });
});
