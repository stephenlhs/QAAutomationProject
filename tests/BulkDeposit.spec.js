import { test } from '@playwright/test';
import { CaptchaHelper } from './helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { DepositPage } from './pages/DepositPage.js';

const MEMBERS = ['myrauto4', 'myrauto5', 'myrauto6'];
const PLAYER_PASSWORD = 'ssss1234';
const DEPOSIT_AMOUNT = 50;
const BANK_NAME = 'C zh test - zh test all';
const BO_USERNAME = 'stephen@mv1';
const BO_PASSWORD = 'qwert123';

test('bulk deposit 50 — myrauto4, myrauto5, myrauto6', async ({ browser }) => {
  // Login to backoffice once, reuse for all approvals
  const boContext = await browser.newContext();
  const boPage = await boContext.newPage();
  const boCaptcha = new CaptchaHelper(boPage, 'bo');
  const backoffice = new BackofficePage(boPage, 'bo');
  await backoffice.login(BO_USERNAME, BO_PASSWORD, boCaptcha);
  console.log('>> Backoffice ready ✅');

  for (const username of MEMBERS) {
    console.log(`\n>> ===== [${username}] Starting deposit =====`);

    // ── Player: login + submit deposit ──
    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    const captcha = new CaptchaHelper(playerPage, username);
    const loginPage = new LoginPage(playerPage, username);
    const depositPage = new DepositPage(playerPage);

    await loginPage.goto();
    await loginPage.login(username, PLAYER_PASSWORD, captcha);
    await depositPage.navigate();
    await depositPage.selectBankTransfer(BANK_NAME);
    await depositPage.submit(DEPOSIT_AMOUNT);
    console.log(`>> [${username}] Deposit MYR ${DEPOSIT_AMOUNT} submitted ✅`);
    await playerContext.close();

    // ── Backoffice: approve deposit ──
    await backoffice.approveDeposit(`auto approve for ${username}`);
    console.log(`>> [${username}] Deposit approved ✅`);
  }

  await boContext.close();

  console.log('\n>> =============================');
  console.log('>> BULK DEPOSIT COMPLETE');
  MEMBERS.forEach(m => console.log(`>>   ✅ ${m} — MYR ${DEPOSIT_AMOUNT} deposited & approved`));
  console.log('>> =============================\n');
});
