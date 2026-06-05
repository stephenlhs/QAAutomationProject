import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CaptchaHelper } from '../helpers/CaptchaHelper.js';
import { LoginPage } from '../pages/LoginPage.js';
import { BackofficePage } from '../pages/BackofficePage.js';
import { DepositPage } from '../pages/DepositPage.js';
import { WithdrawalPage } from '../pages/WithdrawalPage.js';
import { StatementPage } from '../pages/StatementPage.js';
import { PLAYER, BACKOFFICE, DEPOSIT } from '../config.js';

const screenshots = [];
async function snap(page, label) {
  const dir = join(process.cwd(), '.screenshots-tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${label.replace(/\s+/g, '-')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push({ label, path: file });
  console.log(`>> Screenshot: ${label}`);
}

test('deposit reject — verify balance and rollover unchanged', async ({ browser }) => {

  const playerContext = await browser.newContext();
  const playerPage    = await playerContext.newPage();
  const loginPage     = new LoginPage(playerPage, 'player');
  const depositPage   = new DepositPage(playerPage);
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

  await depositPage.navigate();
  await depositPage.selectBankTransfer(DEPOSIT.bankName);
  await snap(playerPage, '03 - Deposit Form');
  await depositPage.submit(DEPOSIT.amount);
  await snap(playerPage, '04 - Deposit Submitted');

  await statementPage.navigateToCashHistory();
  const tx = await statementPage.getLatestTransaction();
  await statementPage.verifyLatestStatus('Pending');
  await snap(playerPage, '05 - Cash History Pending');
  console.log(`>> Transaction: ${tx.txNo} | ${tx.dateTime}`);

  await playerContext.close();

  const boContext  = await browser.newContext();
  const boPage     = await boContext.newPage();
  const backoffice = new BackofficePage(boPage, 'backoffice');
  const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');

  await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
  await snap(boPage, '06 - Backoffice Login');

  await backoffice.rejectDeposit(actualUsername, 'test manual reject');
  await snap(boPage, '07 - Deposit Rejected in BO');

  await boContext.close();

  const playerContext2  = await browser.newContext({ storageState: PLAYER.sessionPath });
  const playerPage2     = await playerContext2.newPage();
  const loginPage2      = new LoginPage(playerPage2, 'player');
  const withdrawalPage2 = new WithdrawalPage(playerPage2);
  const statementPage2  = new StatementPage(playerPage2);

  await loginPage2.loginWithSession();
  await statementPage2.navigateToCashHistory();
  await statementPage2.verifyLatestStatus('Rejected');
  await snap(playerPage2, '08 - Cash History Rejected');

  await withdrawalPage2.navigate();
  const after = await withdrawalPage2.getStats('after');
  await snap(playerPage2, '09 - Stats After');
  console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

  expect(after.balance).toBeCloseTo(before.balance, 1);
  expect(after.rollover).toBeCloseTo(before.rollover, 1);
  expect(after.target).toBeCloseTo(before.target, 1);
  console.log('>> Balance and rollover unchanged ✅');

  // Write manifest for report-writer.js
  const manifestDir = join(process.cwd(), ".screenshots-tmp");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, "manifest-reject-deposit.json"), JSON.stringify(screenshots.map(s => ({ label: s.label, path: s.path }))), "utf-8");
  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);

  await playerContext2.close();
});