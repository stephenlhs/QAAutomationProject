import { test as setup } from '@playwright/test';
import { mkdirSync } from 'fs';
import { CaptchaHelper } from './helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';

// Create .auth folder if not exists
mkdirSync('.auth', { recursive: true });

setup('save player session', async ({ page }) => {
  const captcha = new CaptchaHelper(page, 'setup-player');
  const loginPage = new LoginPage(page, 'setup-player');

  await loginPage.goto();
  await loginPage.login('automatemyr', 'ssss1234', captcha);

  await page.context().storageState({ path: '.auth/player.json' });
  console.log('>> Player session saved to .auth/player.json ✅');
});

setup('save backoffice session', async ({ page }) => {
  const captcha = new CaptchaHelper(page, 'setup-bo');
  const boPage = new BackofficePage(page, 'setup-bo');

  await boPage.login('stephen@mv1', 'qwert123', captcha);

  await page.context().storageState({ path: '.auth/backoffice.json' });
  console.log('>> Backoffice session saved to .auth/backoffice.json ✅');
});