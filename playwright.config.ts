import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30000,
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 }, isMobile: false } },
  ],
  webServer: [
    {
      command: 'pnpm dev:website',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: { HMS_DEMO_MODE: 'true', NEXT_PUBLIC_PORTAL_URL: 'http://localhost:3001' },
    },
    {
      command: 'pnpm dev:portal',
      url: 'http://localhost:3001/login',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: { HMS_DEMO_MODE: 'true', NEXT_PUBLIC_WEBSITE_URL: 'http://localhost:3000' },
    },
  ],
});
