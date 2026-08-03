import { test as baseTest, expect } from '@playwright/test';
import { createApiTest } from '@rafael_dev/playwright-api-framework';
import { PixProApi } from '../api/pixpro-api';

const test = createApiTest(baseTest);

test.describe('Authentication API Tests', () => {
  test('should register a new user and login successfully via NestJS Auth Service', async ({ http }) => {
    const api = http.api(PixProApi);
    const uniqueUsername = `qa_user_${Date.now()}`;
    const password = 'Password123!';

    const regRes = await api.register(uniqueUsername, password);
    expect([200, 201]).toContain(regRes.status());
    const regBody = await regRes.json();
    expect(regBody.success).toBe(true);

    const loginRes = await api.login(uniqueUsername, password);
    expect([200, 201]).toContain(loginRes.status());
    const loginBody = await loginRes.json();
    expect(loginBody.access_token).toBeDefined();
  });

  test('should reject protected routes when authorization header is missing', async ({ request }) => {
    const response = await request.get('http://localhost:4000/projects');
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toContain('authorization');
  });
});
