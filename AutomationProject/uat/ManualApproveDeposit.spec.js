import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CaptchaHelper } from '../helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { DepositPage } from './pages/DepositPage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { StatementPage } from './pages/StatementPage.js';
import { PLAYER, BACKOFFICE, DEPOSIT } from './config.js';

// ── Screenshot helper ──────────────────────────────────────────
const screenshots = [];
async function snap(page, label) {
  const dir = join(process.cwd(), '.screenshots-tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${label.replace(/\s+/g, '-')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push({ label, path: file });
  console.log(`>> Screenshot: ${label}`);
}

test('deposit approve — verify balance and rollover', async ({ browser }) => {

  // ── PART 1: Player login + stats before ──
  const playerContext = await browser.newContext();
  const playerPage    = await playerContext.newPage();
  const loginPage     = new LoginPage(playerPage, 'player');
  const depositPage   = new DepositPage(playerPage);
  const withdrawalPage= new WithdrawalPage(playerPage);
  const statementPage = new StatementPage(playerPage);
  const captcha       = new CaptchaHelper(playerPage, 'player');

  await loginPage.loginAndSaveSession(PLAYER.username, PLAYER.password, captcha, PLAYER.sessionPath);
  const actualUsername = await loginPage.getLoggedInUsername();
  console.log(`>> Logged in as: ${actualUsername}`);
  await snap(playerPage, '01 - Player Login');

  await withdrawalPage.navigate();
  const before = await withdrawalPage.getStats('before');
  await snap(playerPage, '02 - Stats Before');
  console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

  // ── PART 2: Submit deposit ──
  await depositPage.navigate();
  await depositPage.selectBankTransfer(DEPOSIT.bankName);
  await snap(playerPage, '03 - Deposit Form');
  await depositPage.submit(DEPOSIT.amount);
  await snap(playerPage, '04 - Deposit Submitted');

  // ── PART 3: Verify pending ──
  await statementPage.navigateToCashHistory();
  const tx = await statementPage.getLatestTransaction();
  await statementPage.verifyLatestStatus('Pending');
  await snap(playerPage, '05 - Cash History Pending');
  console.log(`>> Transaction: ${tx.txNo} | ${tx.dateTime}`);

  await playerContext.close();

  // ── PART 4: Backoffice approve ──
  const boContext  = await browser.newContext();
  const boPage     = await boContext.newPage();
  const backoffice = new BackofficePage(boPage, 'backoffice');
  const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');

  await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
  await snap(boPage, '06 - Backoffice Login');

  const outstanding = await backoffice.getMemberOutstandingBalance(actualUsername);
  await backoffice.approveDeposit(actualUsername, 'test manual approve');
  await snap(boPage, '07 - Deposit Approved in BO');

  await boContext.close();

  // ── PART 5: Player verify after approval ──
  const playerContext2  = await browser.newContext({ storageState: PLAYER.sessionPath });
  const playerPage2     = await playerContext2.newPage();
  const loginPage2      = new LoginPage(playerPage2, 'player');
  const withdrawalPage2 = new WithdrawalPage(playerPage2);
  const statementPage2  = new StatementPage(playerPage2);

  await loginPage2.loginWithSession();
  await statementPage2.navigateToCashHistory();
  await statementPage2.verifyLatestStatus('Approved');
  await snap(playerPage2, '08 - Cash History Approved');

  await withdrawalPage2.navigate();
  const after = await withdrawalPage2.getStats('after');
  await snap(playerPage2, '09 - Stats After');
  console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

  // ── Calculations ──
  const txBonusAmount  = parseFloat(tx.bonus) || 0;
  const totalCredit    = DEPOSIT.amount + txBonusAmount;
  const effectiveBal   = before.balance + outstanding.total;
  const rolloverInc    = totalCredit * DEPOSIT.rolloverMultiplier;

  let expectedRollover, expectedTarget;
  if (effectiveBal <= 20) {
    expectedRollover = 0; expectedTarget = rolloverInc;
    console.log(`>> Effective balance <= 20 — rollover RESETS`);
  } else {
    expectedRollover = before.rollover; expectedTarget = before.target + rolloverInc;
    console.log(`>> Effective balance > 20 — rollover STACKS`);
  }
  const expectedBalance = before.balance + totalCredit;

  // ── Assertions ──
  expect(after.balance).toBeCloseTo(expectedBalance, 1);
  expect(after.rollover).toBeCloseTo(expectedRollover, 1);
  expect(after.target).toBeCloseTo(expectedTarget, 1);
  console.log('>> All assertions passed ✅');

  // ── Pass screenshots to report writer ──
  // Write manifest for report-writer.js
  const manifestDir = join(process.cwd(), ".screenshots-tmp");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, "manifest-approve-deposit.json"), JSON.stringify(screenshots.map(s => ({ label: s.label, path: s.path }))), "utf-8");
  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);

  await playerContext2.close();
});