import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    { command: 'npx tsx scripts/e2e-server.ts', port: 8788, reuseExistingServer: false, timeout: 60_000 },
    { command: 'npx vite --port 5174 --strictPort', port: 5174, reuseExistingServer: false, env: { E2E_API: 'http://localhost:8788' } },
  ],
});
