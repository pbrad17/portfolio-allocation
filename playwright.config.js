import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real app through the vite dev server with /api
// mocked per-test (bare `npm run dev` has no serverless functions).
//
// channel: 'msedge' deliberately uses the Edge already installed on Windows
// rather than downloading Playwright's bundled Chromium — keeps `npm i` from
// pulling ~130MB and means the suite runs on a fresh clone without an extra
// `playwright install` step.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'msedge',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
