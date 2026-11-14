import { defineConfig, devices } from '@playwright/test';

// E2E acceptance (RTHA PR 0010) runs once per UI locale: Arabic (RTL, default) and English (LTR).
// Requires the API (:4000) and local Supabase to be running; the web server is started here.
// Tests read the locale from `testInfo.project.metadata.locale` and navigate to `/${locale}/...`.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Africa/Khartoum',
  },
  projects: [
    {
      name: 'ar',
      metadata: { locale: 'ar', dir: 'rtl' },
      use: { ...devices['Desktop Chrome'], locale: 'ar' },
    },
    {
      name: 'en',
      metadata: { locale: 'en', dir: 'ltr' },
      use: { ...devices['Desktop Chrome'], locale: 'en' },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
