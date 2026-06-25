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

const screenshots = [];
const MANIFEST_NAME     = 'manifest-reject-deposit.json';
const TXN_MANIFEST_NAME = 'manifest-reject-deposit-txn.json';
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

test('deposit reject — verify balance and rollover unchanged', async ({ browser }) => {
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

  await playerPage.goto('about:blank', { waitUntil: 'commit', timeout: 3000 }).catch(() => {});
  await playerPage.close({ runBeforeUnload: false }).catch(() => {});
  await playerContext.close().catch(() => {});

  // ── PART 4: Backoffice — reject ──
  const boContext  = await browser.newContext();
  const boPage     = await boContext.newPage();
  const backoffice = new BackofficePage(boPage, 'backoffice');
  const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');

  await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
  await backoffice.closeExtraTabs();
  await backoffice.closeAnnouncements();

  await backoffice.rejectDeposit(actualUsername, 'test manual reject');

  // Close success modal and let page settle — already on deposit-list after rejectDeposit
  await boPage.getByRole('button', { name: 'OK' }).click({ force: true, timeout: 3000 }).catch(() => {});
  await boPage.waitForTimeout(2000);

  const expandAdvancedSearch = async () => {
    const txInput = boPage.locator('#txtTransactionId');
    const isVisible = await txInput.isVisible({ timeout: 500 }).catch(() => false);
    if (!isVisible) {
      await boPage.getByText('Advanced Search').first().click({ force: true }).catch(() => {});
      await boPage.waitForTimeout(600);
    }
  };

  const searchDeposit = async () => {
    await boPage.evaluate(() => {
      const el = document.querySelector('#ddlFilterStatus');
      if (!el) return;
      const opt = Array.from(el.options).find(o => o.text.trim().includes('Rejected'));
      if (opt) { el.value = opt.value; if (window.$) window.$(el).trigger('change'); el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    const label = await boPage.locator('#ddlFilterStatus').evaluate(el => el.options[el.selectedIndex]?.text || 'none');
    console.log(`>> Status filter set to: ${label}`);
    await boPage.locator('#txtUserName').fill(`${backoffice.memberPrefix}${actualUsername}`);
    await expandAdvancedSearch();
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
    await expandAdvancedSearch();
    const dateInputs = boPage.locator('.input-group:has(.fa-calendar) input');
    if (await dateInputs.count() >= 2) {
      await dateInputs.first().fill(`${fmtD(s2)} 00:00:00`);
      await dateInputs.first().press('Tab');
      await dateInputs.nth(1).fill(`${fmtD(now2)} 23:59:59`);
      await dateInputs.nth(1).press('Tab');
      await boPage.waitForTimeout(500);
    }
    txFound = await searchDeposit();
  }
  console.log(`>> BO deposit list (Rejected) — txNo "${tx.txNo}" found: ${txFound}`);
  await boPage.evaluate(() => window.scrollBy(0, 300));
  await boPage.waitForTimeout(300);
  await snap(boPage, '04 - BO Deposit List Rejected');

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

  await boPage.goto('about:blank', { waitUntil: 'commit', timeout: 3000 }).catch(() => {});
  await boPage.close({ runBeforeUnload: false }).catch(() => {});
  await boContext.close().catch(() => {});

  // ── PART 5: Player verify after rejection ──
  const playerContext2  = await browser.newContext({ storageState: PLAYER.sessionPath });
  const playerPage2     = await playerContext2.newPage();
  const loginPage2      = new LoginPage(playerPage2, 'player');
  const withdrawalPage2 = new WithdrawalPage(playerPage2);
  const statementPage2  = new StatementPage(playerPage2);

  await loginPage2.loginWithSession();
  await statementPage2.navigateToCashHistory();
  await statementPage2.verifyLatestStatus('Rejected');
  await snap(playerPage2, '06 - Cash History Rejected');

  await withdrawalPage2.navigate();
  const after = await withdrawalPage2.getStats('after');
  await snap(playerPage2, '07 - Stats After');
  console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

  // ── Write transaction summary for Excel report ──
  const txnSummary = {
    player:           actualUsername,
    gateway:          'Manual',
    method:           'Bank Transfer',
    packageName:      DEPOSIT.packageName,
    txNo:             tx.txNo,
    txDateTime:       tx.dateTime,
    txAmount:         tx.amount,
    bonus:            tx.bonus || '0',
    txStatus:         'Rejected',
    outstandingTotal: '—',
    balanceBefore:    String(before.balance),
    balanceAfter:     String(after.balance),
    rolloverBefore:   String(before.rollover),
    rolloverAfter:    String(after.rollover),
    targetBefore:     String(before.target),
    targetAfter:      String(after.target),
  };
  mkdirSync(join(process.cwd(), '.screenshots-tmp'), { recursive: true });
  writeFileSync(join(process.cwd(), '.screenshots-tmp', TXN_MANIFEST_NAME), JSON.stringify(txnSummary), 'utf-8');
  console.log('>> Txn summary written');

  // ── Assertions ──
  expect(after.balance).toBeCloseTo(before.balance, 1);
  expect(after.rollover).toBeCloseTo(before.rollover, 1);
  expect(after.target).toBeCloseTo(before.target, 1);
  console.log('>> Balance and rollover unchanged ✅');

  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);
  console.log('>> RESULT: PASS');
  await playerPage2.goto('about:blank', { waitUntil: 'commit', timeout: 3000 }).catch(() => {});
  await playerPage2.close({ runBeforeUnload: false }).catch(() => {});
  await playerContext2.close().catch(() => {});
});
