import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: path.resolve(__dirname, 'specs'),
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: process.env.API_GATEWAY_URL || 'http://localhost:4000',
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },
  },
  reporter: [['html', { open: 'never' }], ['list']],
});
