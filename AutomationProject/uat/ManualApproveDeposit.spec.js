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
const MANIFEST_NAME = 'manifest-approve-deposit.json';
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

test('deposit approve — verify balance and rollover', async ({ browser }) => {
  test.setTimeout(0);

  // ── PART 1: Player login + stats before ──
  const playerContext = await browser.newContext();
  const playerPage    = await playerContext.newPage();
  const loginPage     = new LoginPage(playerPage, 'player');
  const depositPage   = new DepositPage(playerPage);
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

  // ── PART 2: Submit deposit ──
  await depositPage.navigate();
  await depositPage.selectBankTransfer(DEPOSIT.bankName);
  await depositPage.amountInput.fill(String(DEPOSIT.amount));
  await snap(playerPage, '02 - Deposit Form');
  await depositPage.submit(DEPOSIT.amount);

  // ── PART 3: Cash History — Pending ──
  await statementPage.navigateToCashHistory();
  const tx = await statementPage.getLatestTransaction();
  await statementPage.verifyLatestStatus('Pending');
  await snap(playerPage, '03 - Cash History Pending');
  console.log(`>> Transaction: ${tx.txNo} | ${tx.dateTime}`);

  await playerPage.close({ runBeforeUnload: false }).catch(() => {});
  await playerContext.close();

  // ── PART 4: Backoffice — outstanding balance + approve ──
  const boContext  = await browser.newContext();
  const boPage     = await boContext.newPage();
  const backoffice = new BackofficePage(boPage, 'backoffice');
  const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');

  await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
  await backoffice.closeExtraTabs();
  await backoffice.closeAnnouncements();

  const outstanding = await backoffice.getMemberOutstandingBalance(actualUsername);
  await backoffice.approveDeposit(actualUsername, 'test manual approve');

  // Close success modal and let page settle — already on deposit-list after approveDeposit
  await boPage.getByRole('button', { name: 'OK' }).click({ force: true, timeout: 3000 }).catch(() => {});
  await boPage.waitForTimeout(2000);

  const searchDeposit = async () => {
    await boPage.evaluate(() => {
      const el = document.querySelector('#ddlFilterStatus');
      if (!el) return;
      const opt = Array.from(el.options).find(o => o.text.trim().includes('Approved'));
      if (opt) { el.value = opt.value; if (window.$) window.$(el).trigger('change'); el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    const label = await boPage.locator('#ddlFilterStatus').evaluate(el => el.options[el.selectedIndex]?.text || 'none');
    console.log(`>> Status filter set to: ${label}`);
    await boPage.locator('#txtUserName').fill(`${backoffice.memberPrefix}${actualUsername}`);
    await boPage.getByText('Advanced Search').click().catch(() => {});
    await boPage.waitForTimeout(400);
    await boPage.locator('#txtTransactionId').fill(tx.txNo).catch(() => {});
    await boPage.getByRole('button', { name: 'Search' }).click();
    await boPage.waitForTimeout(2000);
    return (await boPage.locator(`.table-responsive tbody td:has-text("${tx.txNo}")`).count()) > 0;
  };

  let txFound = await searchDeposit();
  if (!txFound) {
    const now2 = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const fmtD = (d) => `${pad2(d.getMonth()+1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
    const s2   = new Date(now2); s2.setDate(s2.getDate() - 1);
    const dateInputs = boPage.locator('.input-group:has(.fa-calendar) input');
    if (await dateInputs.count() >= 2) {
      await dateInputs.first().fill(`${fmtD(s2)} 00:00:00`);
      await dateInputs.nth(1).fill(`${fmtD(now2)} 23:59:59`);
      await boPage.locator('.ibox-title, h2, h3').first().click({ force: true }).catch(() => {});
      await boPage.waitForTimeout(500);
    }
    txFound = await searchDeposit();
  }
  console.log(`>> BO deposit list (Approved) — txNo "${tx.txNo}" found: ${txFound}`);
  await boPage.evaluate(() => window.scrollBy(0, 300));
  await boPage.waitForTimeout(300);
  await snap(boPage, '04 - BO Deposit List Approved');  // full-page — element snap would hang on "No result"

  // Open detail modal
  if (txFound) {
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
      await snap(boPage, '05 - BO Deposit Detail Modal', modal);
      await modal.getByText('× Close').click({ force: true }).catch(() => {});
      await boPage.waitForTimeout(500);
    }
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
  await snap(playerPage2, '06 - Cash History Approved');

  await withdrawalPage2.navigate();
  const after = await withdrawalPage2.getStats('after');
  await snap(playerPage2, '07 - Stats After');
  console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

  // ── Assertions ──
  const txBonusAmount  = parseFloat(tx.bonus) || 0;
  const totalCredit    = DEPOSIT.amount + txBonusAmount;
  const effectiveBal   = before.balance + outstanding.total;
  const rolloverInc    = totalCredit * DEPOSIT.rolloverMultiplier;

  const rolloverAlreadyMet = before.target > 0 && before.rollover >= before.target;
  let expectedRollover, expectedTarget;
  if (rolloverAlreadyMet) {
    expectedRollover = 0; expectedTarget = rolloverInc;
    console.log(`>> Rollover already met (${before.rollover} >= ${before.target}) — RESET`);
  } else if (effectiveBal <= 20) {
    expectedRollover = 0; expectedTarget = rolloverInc;
    console.log(`>> Effective balance <= 20 — rollover RESETS`);
  } else {
    expectedRollover = before.rollover; expectedTarget = before.target + rolloverInc;
    console.log(`>> Effective balance > 20 — rollover STACKS`);
  }
  const expectedBalance = before.balance + totalCredit;

  expect(after.balance).toBeCloseTo(expectedBalance, 1);
  expect(after.rollover).toBeCloseTo(expectedRollover, 1);
  expect(after.target).toBeCloseTo(expectedTarget, 1);
  console.log('>> All assertions passed ✅');

  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);
  console.log('>> RESULT: PASS');
  await playerPage2.close({ runBeforeUnload: false }).catch(() => {});
  await playerContext2.close();
});
