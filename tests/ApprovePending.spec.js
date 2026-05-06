import { test } from '@playwright/test';
import { CaptchaHelper } from './helpers/CaptchaHelper.js';
import { BackofficePage } from './pages/BackofficePage.js';

const BO_USERNAME = 'stephen@mv1';
const BO_PASSWORD = 'qwert123';

test('approve pending deposit — myrauto5', async ({ browser }) => {
  const boContext = await browser.newContext();
  const boPage = await boContext.newPage();
  const boCaptcha = new CaptchaHelper(boPage, 'bo');
  const backoffice = new BackofficePage(boPage, 'bo');

  await backoffice.login(BO_USERNAME, BO_PASSWORD, boCaptcha);
  console.log('>> Backoffice login done ✅');

  await backoffice.approveDeposit('manual approve myrauto5');
  console.log('>> myrauto5 deposit approved ✅');

  await boContext.close();
});
