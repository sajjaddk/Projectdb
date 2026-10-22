// @ts-check
const { defineConfig, devices } = require('@playwright/test');

process.loadEnvFile('.env.test'); // fake demo credentials; does not override variables already set
const port = process.env.PORT || '4000';

// The app is started by `node scripts/with-server.js` (npm run test:pw), not by this config.
module.exports = defineConfig({
  testDir: './playwright',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4, // too many parallel Chromium launches can fail on small machines
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'reports/playwright/junit.xml' }],
    ['html', { outputFolder: 'reports/playwright/html', open: 'never' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testDir: './playwright/api' },
    { name: 'ui-chromium', testDir: './playwright/e2e', use: { ...devices['Desktop Chrome'] } },
  ],
});
