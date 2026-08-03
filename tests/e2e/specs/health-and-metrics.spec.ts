import { test as baseTest, expect } from '@playwright/test';
import { createApiTest } from '@rafael_dev/playwright-api-framework';
import { PixProApi } from '../api/pixpro-api';

const test = createApiTest(baseTest);

test.describe('Health & Observability API Tests', () => {
  test('should return 200 OK and closed circuit breakers on API Gateway healthcheck', async ({ http }) => {
    const api = http.api(PixProApi);
    const response = await api.getHealth(4000);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('api-gateway');
    expect(body.breakers).toBeDefined();
  });

  test('should return Prometheus metrics text output', async ({ http }) => {
    const api = http.api(PixProApi);
    const response = await api.getMetrics();
    expect(response.status()).toBe(200);

    const text = await response.text();
    expect(text).toContain('http_requests_total');
  });
});
