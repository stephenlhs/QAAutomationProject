import { defineConfig, devices } from '@playwright/test';

const sharedUse = {
  ...devices['Desktop Chromium'],
  channel: 'chrome',
  headless: false,
  screenshot: 'on',
  video: 'on',
  trace: 'on',
  viewport: null,
  launchOptions: {
    args: ['--start-maximized'],
  },
};

export default defineConfig({
  testDir: './AutomationProject',
  workers: 1,
  timeout: 180000,
  reporter: 'html',

  projects: [

    // ── STAGING ──
    {
      name: 'staging',
      testMatch: '**/staging/!(CreateMemberAndSaveSession).spec.js',
      use: { ...sharedUse },
    },
    {
      name: 'staging-member-setup',
      testMatch: '**/staging/CreateMemberAndSaveSession.spec.js',
      timeout: 0,
      use: { ...sharedUse },
    },

    // ── UAT ──
    {
      name: 'uat',
      testMatch: '**/uat/!(CreateMemberAndSaveSession).spec.js',
      use: { ...sharedUse },
    },
    {
      name: 'uat-member-setup',
      testMatch: '**/uat/CreateMemberAndSaveSession.spec.js',
      timeout: 0,
      use: { ...sharedUse },
    },

    // ── PROD ──
    {
      name: 'prod',
      testMatch: '**/prod/!(CreateMemberAndSaveSession).spec.js',
      use: { ...sharedUse },
    },
    {
      name: 'prod-member-setup',
      testMatch: '**/prod/CreateMemberAndSaveSession.spec.js',
      timeout: 0,
      use: { ...sharedUse },
    },

  ],
});