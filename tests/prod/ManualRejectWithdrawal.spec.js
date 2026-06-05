import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CaptchaHelper } from '../helpers/CaptchaHelper.js';
import { LoginPage } from '../pages/LoginPage.js';
import { BackofficePage } from '../pages/BackofficePage.js';
import { WithdrawalPage } from '../pages/WithdrawalPage.js';
import { StatementPage } from '../pages/StatementPage.js';
import { PLAYER, BACKOFFICE, WITHDRAWAL } from '../config.js';

const screenshots = [];
async function snap(page, label) {
  const dir = join(process.cwd(), '.screenshots-tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${label.replace(/\s+/g, '-')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push({ label, path: file });
  console.log(`>> Screenshot: ${label}`);
}

test('withdrawal reject — verify balance and rollover unchanged', async ({ browser }) => {

  const playerContext = await browser.newContext();
  const playerPage    = await playerContext.newPage();
  const loginPage     = new LoginPage(playerPage, 'player');
  const withdrawalPage= new WithdrawalPage(playerPage);
  const statementPage = new StatementPage(playerPage);
  const captcha       = new CaptchaHelper(playerPage, 'player');

  await loginPage.loginAndSaveSession(PLAYER.username, PLAYER.password, captcha, PLAYER.sessionPath);
  const actualUsername = await loginPage.getLoggedInUsername();
  await snap(playerPage, '01 - Player Login');

  await withdrawalPage.navigate();
  const before = await withdrawalPage.getStats('before');
  await snap(playerPage, '02 - Stats Before');
  console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

  if (before.rollover < before.target) {
    console.log(`>> Rollover not met: ${before.rollover} < ${before.target}`);
    await withdrawalPage.verifyRolloverError(WITHDRAWAL.amount);
    await snap(playerPage, '03 - Rollover Error');
    // Write manifest for report-writer.js
  const manifestDir = join(process.cwd(), ".screenshots-tmp");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, "manifest-reject-withdrawal.json"), JSON.stringify(screenshots.map(s => ({ label: s.label, path: s.path }))), "utf-8");
  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);
    await playerContext.close();
    return;
  }

  await withdrawalPage.verifyInsufficientBalance(before.balance + 1000);
  await snap(playerPage, '03 - Insufficient Balance Error');

  await withdrawalPage.navigate();
  await snap(playerPage, '04 - Withdrawal Form');
  await withdrawalPage.submitWithdrawal(WITHDRAWAL.amount);
  await snap(playerPage, '05 - Withdrawal Submitted');

  await statementPage.navigateToCashHistory();
  const tx = await statementPage.getLatestTransaction();
  await statementPage.verifyLatestStatus('Pending');
  await snap(playerPage, '06 - Cash History Pending');
  console.log(`>> Transaction: ${tx.txNo} | ${tx.dateTime}`);

  await playerContext.close();

  const boContext  = await browser.newContext();
  const boPage     = await boContext.newPage();
  const backoffice = new BackofficePage(boPage, 'backoffice');
  const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');

  await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
  await snap(boPage, '07 - Backoffice Login');

  await backoffice.rejectWithdrawal(actualUsername, 'test manual reject withdrawal');
  await snap(boPage, '08 - Withdrawal Rejected in BO');

  await boContext.close();

  const playerContext2  = await browser.newContext({ storageState: PLAYER.sessionPath });
  const playerPage2     = await playerContext2.newPage();
  const loginPage2      = new LoginPage(playerPage2, 'player');
  const withdrawalPage2 = new WithdrawalPage(playerPage2);
  const statementPage2  = new StatementPage(playerPage2);

  await loginPage2.loginWithSession();
  await statementPage2.navigateToCashHistory();
  await statementPage2.verifyLatestStatus('Rejected');
  await snap(playerPage2, '09 - Cash History Rejected');

  await withdrawalPage2.navigate();
  const after = await withdrawalPage2.getStats('after');
  await snap(playerPage2, '10 - Stats After');
  console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

  expect(after.balance).toBeCloseTo(before.balance, 1);
  expect(after.rollover).toBeCloseTo(before.rollover, 1);
  expect(after.target).toBeCloseTo(before.target, 1);
  console.log('>> Balance and rollover unchanged ✅');

  // Write manifest for report-writer.js
  const manifestDir = join(process.cwd(), ".screenshots-tmp");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, "manifest-reject-withdrawal.json"), JSON.stringify(screenshots.map(s => ({ label: s.label, path: s.path }))), "utf-8");
  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);

  await playerContext2.close();
});