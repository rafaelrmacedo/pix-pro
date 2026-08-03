import { test as baseTest, expect } from '@playwright/test';
import { createApiTest } from '@rafael_dev/playwright-api-framework';
import { PixProApi } from '../api/pixpro-api';
import fs from 'fs';
import path from 'path';

const test = createApiTest(baseTest);

test.describe('Image Processing Queue API Tests', () => {
  test('should validate missing required fields on image job creation', async ({ request }) => {
    const api = new PixProApi(request, {} as any);
    const token = api.generateDevToken();

    const response = await request.post('http://localhost:4002/images/jobs', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { prompt: 'Sample prompt' },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  test('should accept image upload and queue processing command via RabbitMQ', async ({ request }) => {
    const api = new PixProApi(request, {} as any);
    const token = api.generateDevToken();

    const projectRes = await api.createProject(`Image Test ${Date.now()}`, 'Project for E2E image job', token);
    expect([200, 201]).toContain(projectRes.status());
    const projectData = await projectRes.json();

    const imagePath = path.resolve(__dirname, '../assets/sample.png');
    const imageBuffer = fs.readFileSync(imagePath);

    const jobRes = await request.post('http://localhost:4002/images/jobs', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-user-id': 'user-123',
      },
      multipart: {
        projectId: projectData.id,
        prompt: 'A sleek futuristic vehicle in a dark neon garage',
        image: {
          name: 'sample.png',
          mimeType: 'image/png',
          buffer: imageBuffer,
        },
      },
    });

    expect([200, 201, 202]).toContain(jobRes.status());
    const jobData = await jobRes.json();
    expect(jobData.imageId).toBeDefined();
    expect(jobData.message).toContain('queued');
  });
});
