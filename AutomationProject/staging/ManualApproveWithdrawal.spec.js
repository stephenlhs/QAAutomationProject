import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CaptchaHelper } from '../helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { StatementPage } from './pages/StatementPage.js';
import { PLAYER, BACKOFFICE, WITHDRAWAL } from './config.js';

const screenshots = [];
const MANIFEST_NAME = 'manifest-approve-withdrawal.json';
async function snap(page, label, el = null) {
  const dir = join(process.cwd(), '.screenshots-tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${label.replace(/\s+/g, '-')}.png`);
  if (el) {
    await el.screenshot({ path: file }).catch(() => page.screenshot({ path: file, fullPage: false }));
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
  screenshots.push({ label, path: file });
  writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(screenshots.map(s => ({ label: s.label, path: s.path }))), 'utf-8');
  console.log(`>> Screenshot: ${label}`);
}

test('withdrawal approve — verify balance decreases and rollover resets', async ({ browser }) => {
  test.setTimeout(0);

  // ── PART 1: Player login + stats before ──
  const playerContext = await browser.newContext();
  const playerPage    = await playerContext.newPage();
  const loginPage     = new LoginPage(playerPage, 'player');
  const withdrawalPage= new WithdrawalPage(playerPage);
  const statementPage = new StatementPage(playerPage);
  const captcha       = new CaptchaHelper(playerPage, 'player');

  await loginPage.loginAndSaveSession(PLAYER.username, PLAYER.password, captcha, PLAYER.sessionPath);
  const actualUsername = PLAYER.username;
  console.log(`>> Logged in as: ${actualUsername}`);

  await withdrawalPage.navigate();
  const before = await withdrawalPage.getStats('before');
  await snap(playerPage, '01 - Stats Before');
  console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

  if (before.rollover < before.target) {
    console.log(`>> Rollover not met: ${before.rollover} < ${before.target}`);
    await withdrawalPage.verifyRolloverError(WITHDRAWAL.amount);
    await snap(playerPage, '02 - Rollover Error');
    console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);
    console.log('>> RESULT: PASS');
    await playerPage.close({ runBeforeUnload: false }).catch(() => {});
    await playerContext.close();
    return;
  }

  await withdrawalPage.verifyInsufficientBalance(before.balance + 1000);
  await snap(playerPage, '02 - Insufficient Balance Error');

  // ── PART 2: Submit withdrawal ──
  await withdrawalPage.navigate();
  await snap(playerPage, '03 - Withdrawal Form');
  await withdrawalPage.submitWithdrawal(WITHDRAWAL.amount);

  // ── PART 3: Cash History — Pending ──
  await statementPage.navigateToCashHistory();
  const tx = await statementPage.getLatestTransaction();
  await statementPage.verifyLatestStatus('Pending');
  await snap(playerPage, '04 - Cash History Pending');
  console.log(`>> Transaction: ${tx.txNo} | ${tx.dateTime}`);

  await playerPage.close({ runBeforeUnload: false }).catch(() => {});
  await playerContext.close();

  // ── PART 4: Backoffice — approve ──
  const boContext  = await browser.newContext();
  const boPage     = await boContext.newPage();
  const backoffice = new BackofficePage(boPage, 'backoffice');
  const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');

  await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
  await backoffice.closeExtraTabs();
  await backoffice.closeAnnouncements();

  await backoffice.approveWithdrawal(actualUsername, 'test manual approve withdrawal');

  // Close success modal if still open
  await boPage.getByRole('button', { name: 'OK' }).click({ force: true }).catch(() => {});
  await boPage.waitForTimeout(1000);

  // Navigate to withdrawal list filtered by Approved and screenshot
  await boPage.goto(`${backoffice.boBase}/dashboard/cash/withdraw-list`, { waitUntil: 'domcontentloaded' });
  await boPage.waitForTimeout(1500);
  await boPage.locator('#txtUserName').fill(`${backoffice.memberPrefix}${actualUsername}`);
  await boPage.locator('select[name="ddlFilterStatus"]').selectOption('Approved').catch(() => {});
  await boPage.locator('button[type="submit"]:has-text("Search")').click({ force: true });
  await boPage.waitForTimeout(2000);
  await snap(boPage, '05 - BO Withdrawal List Approved', boPage.locator('.ibox-content').first());

  // Open detail modal
  const txRow   = boPage.locator('.table-responsive tbody tr').filter({ hasText: tx.txNo }).first();
  const editBtn = txRow.locator('[title="Edit"]').first();
  if (await editBtn.count()) {
    await editBtn.click({ force: true });
  } else {
    await boPage.getByTitle('Edit').first().click();
  }
  await boPage.waitForTimeout(2000);
  const modal = boPage.locator('#ticket-detail');
  if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
    await snap(boPage, '06 - BO Withdrawal Detail Modal', modal);
    await modal.getByText('× Close').click({ force: true }).catch(() => {});
    await boPage.waitForTimeout(500);
  }

  await boPage.close({ runBeforeUnload: false }).catch(() => {});
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
  await snap(playerPage2, '07 - Cash History Approved');

  await withdrawalPage2.navigate();
  const after = await withdrawalPage2.getStats('after');
  await snap(playerPage2, '08 - Stats After');
  console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

  // ── Assertions ──
  const expectedBalance = before.balance - WITHDRAWAL.amount;
  expect(after.balance).toBeCloseTo(expectedBalance, 1);
  expect(after.rollover).toBeCloseTo(0, 1);
  expect(after.target).toBeCloseTo(0, 1);
  console.log('>> All assertions passed ✅');

  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);
  console.log('>> RESULT: PASS');
  await playerPage2.close({ runBeforeUnload: false }).catch(() => {});
  await playerContext2.close();
});
