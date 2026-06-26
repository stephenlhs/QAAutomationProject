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
const MANIFEST_NAME     = 'manifest-approve-withdrawal.json';
const TXN_MANIFEST_NAME = 'manifest-approve-withdrawal-txn.json';
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
    await playerPage.goto('about:blank', { waitUntil: 'commit', timeout: 3000 }).catch(() => {});
    await playerPage.close({ runBeforeUnload: false }).catch(() => {});
    await playerContext.close().catch(() => {});
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

  await playerPage.goto('about:blank', { waitUntil: 'commit', timeout: 3000 }).catch(() => {});
  await playerPage.close({ runBeforeUnload: false }).catch(() => {});
  await playerContext.close().catch(() => {});

  // ── PART 4: Backoffice — approve ──
  const boContext  = await browser.newContext();
  const boPage     = await boContext.newPage();
  const backoffice = new BackofficePage(boPage, 'backoffice');
  const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');

  await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
  await backoffice.closeExtraTabs();
  await backoffice.closeAnnouncements();

  await backoffice.approveWithdrawal(actualUsername, 'test manual approve withdrawal');

  // Close success modal and let page settle — already on withdraw-list after approveWithdrawal
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

  const searchWithdrawal = async () => {
    await boPage.evaluate(() => {
      const el = document.querySelector('#ddlFilterStatus');
      if (!el) return;
      const opt = Array.from(el.options).find(o => o.text.trim().includes('Approved'));
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

  let txFound = await searchWithdrawal();
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
    txFound = await searchWithdrawal();
  }
  console.log(`>> BO withdrawal list (Approved) — txNo "${tx.txNo}" found: ${txFound}`);
  await boPage.evaluate(() => window.scrollBy(0, 300));
  await boPage.waitForTimeout(300);
  await snap(boPage, '05 - BO Withdrawal List Approved');

  // Open detail modal
  if (txFound) {
    const txRow = boPage.locator('.table-responsive tbody tr').filter({ hasText: tx.txNo }).first();
    await txRow.locator('i.fa.fa-edit').click({ force: true });
    await boPage.waitForTimeout(1000);
    const modal = boPage.locator('#ticket-detail');
    if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
      await snap(boPage, '06 - BO Withdrawal Detail Modal', modal);
      await modal.getByText('× Close').click({ force: true }).catch(() => {});
      await boPage.waitForTimeout(500);
    }
  }

  await boPage.goto('about:blank', { waitUntil: 'commit', timeout: 3000 }).catch(() => {});
  await boPage.close({ runBeforeUnload: false }).catch(() => {});
  await boContext.close().catch(() => {});

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
  await playerPage2.reload({ waitUntil: 'domcontentloaded' });
  await playerPage2.waitForTimeout(2000);
  let after = await withdrawalPage2.getStats('after');
  for (let i = 0; i < 5 && after.balance >= before.balance; i++) {
    console.log(`>> Balance not updated yet (${after.balance}), retry ${i + 1}...`);
    await playerPage2.waitForTimeout(3000);
    await playerPage2.reload({ waitUntil: 'domcontentloaded' });
    await playerPage2.waitForTimeout(1500);
    after = await withdrawalPage2.getStats('after');
  }
  await snap(playerPage2, '08 - Stats After');
  console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

  // ── Write transaction summary for Excel report ──
  const txnSummary = {
    player:           actualUsername,
    gateway:          'Manual',
    method:           'Bank Withdrawal',
    packageName:      '—',
    txNo:             tx.txNo,
    txDateTime:       tx.dateTime,
    txAmount:         tx.amount,
    bonus:            '—',
    txStatus:         'Approved',
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
  const expectedBalance = before.balance - WITHDRAWAL.amount;
  expect(after.balance).toBeCloseTo(expectedBalance, 1);
  expect(after.rollover).toBeCloseTo(0, 1);
  expect(after.target).toBeCloseTo(0, 1);
  console.log('>> All assertions passed ✅');

  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);
  console.log('>> RESULT: PASS');
  await playerPage2.goto('about:blank', { waitUntil: 'commit', timeout: 3000 }).catch(() => {});
  await playerPage2.close({ runBeforeUnload: false }).catch(() => {});
  await playerContext2.close().catch(() => {});
});
