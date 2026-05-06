import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 180000,
  reporter: 'html',

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chromium'],
        headless: false,
        screenshot: 'on',
        video: 'on',
        trace: 'on',
      },
      testIgnore: '**/CreateMemberAndSaveSession.spec.js',
    },
    {
      name: 'member-setup',
      testMatch: '**/CreateMemberAndSaveSession.spec.js',
      use: {
        ...devices['Desktop Chromium'],
        headless: false,
        screenshot: 'on',
        video: 'on',
        trace: 'on',
      },
    },
  ],
});