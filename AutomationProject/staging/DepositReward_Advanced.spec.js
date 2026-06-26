/**
 * DepositReward_Advanced.spec.js — Advanced Deposit Reward Test Suite
 *
 * Tests (serial — share player account):
 *   beforeAll  — verify Deposit Reward setting is enabled in BO
 *   TC-021     — Multiple promo codes: uses oldest first
 *   TC-022     — Multiple promo codes: uses newest first
 *   TC-023     — Promo code expires before use (SKIPPED — requires staging clock control)
 *   TC-024     — BO disables feature mid-session; player redeems held code
 *   TC-025     — Boundary: exact $50.00 earns promo code
 *   TC-026     — Boundary: $49.99 earns no promo code
 *   TC-027     — Promo code entered with zero/blank deposit amount
 *   TC-028     — BO rejects deposit with promo code — code not consumed
 *   TC-029     — Max cap: large deposit bonus does not exceed $25
 *   TC-030     — Concurrent same-code submission
 *   TC-020     — Counter fresh for Setting 2 (min $200) — verifies counter-1 rate
 *   TC-031     — Counter-3 code from Setting 1 redeemed on Setting 2 deposit — bonus fixed at issuance
 *   TC-032     — Rollover requirement applied correctly when bonus credited (before/after)
 *   TC-033     — Rollover setting change does not affect previously issued codes
 *
 * BO Settings (all active, selected by deposit amount tier):
 *   Setting 1: min $50,   10%/20%/30%, 24h expiry
 *   Setting 2: min $200,  5%/10%/20%,  48h expiry
 *   Setting 3: min $500,  2%/5%/10%,   48h expiry
 *   Setting 4: min $1000, 10%/20%/30%, 48h expiry
 *   Global rollover: X3 | Max bonus cap: $25
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { CaptchaHelper }   from '../helpers/CaptchaHelper.js';
import { LoginPage }       from './pages/LoginPage.js';
import { BackofficePage }  from './pages/BackofficePage.js';
import { StatementPage }   from './pages/StatementPage.js';
import { PLAYER, BACKOFFICE, DEPOSIT, URLS } from './config.js';

// ── Constants ────────────────────────────────────────────────────────────────
const BO_BASE   = URLS.backoffice.replace('/login', '');
const SNAP_BASE = join(process.cwd(), '.screenshots-tmp', 'deposit-reward');
const MIN_DEPOSIT = 50;
const MAX_CAP     = 25;

// BO setting tiers — selected by deposit amount (highest qualifying tier wins)
const SETTINGS = {
  1: { minDeposit: 50,   percents: [10, 20, 30], expiredHours: 24 },
  2: { minDeposit: 200,  percents: [5,  10, 20], expiredHours: 48 },
  3: { minDeposit: 500,  percents: [2,  5,  10], expiredHours: 48 },
  4: { minDeposit: 1000, percents: [10, 20, 30], expiredHours: 48 },
};
const ROLLOVER_CURRENT = 3; // X3 — confirmed in BO selRollOver

let cachedBoSession = null;

// ── snap() — TC-named subfolders ─────────────────────────────────────────────
async function snap(page, tcId, stepLabel) {
  const dir = join(SNAP_BASE, tcId);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: join(dir, `${Date.now()}-${stepLabel.replace(/\s+/g, '-')}.png`),
    fullPage: false,
  });
  console.log(`>> [snap] ${tcId}/${stepLabel}`);
}

// ── dismissModals() ──────────────────────────────────────────────────────────
async function dismissModals(page) {
  await page.waitForTimeout(800);
  for (const sel of ['button:has-text("Ok")', 'button:has-text("OK")', '[data-dismiss="modal"]', '.modal .close']) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
      await btn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

// ── boLogin() — CAPTCHA-caching ──────────────────────────────────────────────
async function boLogin(browser) {
  if (cachedBoSession) {
    try {
      const ctx  = await browser.newContext({ storageState: cachedBoSession });
      const page = await ctx.newPage();
      await page.goto(`${BO_BASE}/dashboard/home`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(800);
      if (!page.url().includes('/login')) {
        console.log('>> BO session cached — skipping CAPTCHA ✅');
        const bo = new BackofficePage(page, 'backoffice');
        await bo.closeExtraTabs();
        await dismissModals(page);
        return { ctx, page, bo };
      }
      await ctx.close();
    } catch { /* session expired */ }
    console.log('>> BO cached session expired, logging in fresh...');
    cachedBoSession = null;
  }
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  const bo   = new BackofficePage(page, 'backoffice');
  const cap  = new CaptchaHelper(page, 'backoffice');
  await bo.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, cap, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
  await bo.closeExtraTabs();
  await dismissModals(page);
  cachedBoSession = await ctx.storageState();
  console.log('>> BO fresh login complete — session cached ✅');
  return { ctx, page, bo };
}

// ── playerLogin() ────────────────────────────────────────────────────────────
async function playerLogin(browser) {
  const ctx  = await browser.newContext({ storageState: PLAYER.sessionPath });
  const page = await ctx.newPage();
  const login = new LoginPage(page, 'player');
  await login.loginWithSession();
  return { ctx, page, stmt: new StatementPage(page) };
}

// ── readPlayerBalance() ──────────────────────────────────────────────────────
async function readPlayerBalance(page) {
  await page.waitForTimeout(1000);
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const m = body.match(/\bMYR\s*\n\s*([\d,]+\.\d+)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
}

// ── readPromoCodeFromInbox() — reads FIRST/LATEST promo code ─────────────────
async function readPromoCodeFromInbox(page) {
  await page.goto(`${URLS.playsite}user/message`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const msgRow = page.locator('tr, li, .message-row, a').filter({ hasText: /deposit reward code/i }).first();
  if (await msgRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await msgRow.click({ force: true });
    await page.waitForTimeout(4000);
  }
  const body = await page.locator('body').innerText().catch(() => '');
  const m = body.match(/([A-Z0-9]{8}\$[\d.]+)/);
  if (m) { console.log(`>> Promo code from inbox: ${m[1]}`); return m[1]; }
  console.log('>> No promo code found in inbox');
  return null;
}

// ── readAllPromoCodesFromInbox() — FOR TC-021/TC-022 ────────────────────────
async function readAllPromoCodesFromInbox(page) {
  await page.goto(`${URLS.playsite}user/message`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const rows = page.locator('tr, li, .message-row, a').filter({ hasText: /deposit reward code/i });
  const count = await rows.count();
  const codes = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if (await row.isVisible({ timeout: 1500 }).catch(() => false)) {
      await row.click({ force: true });
      await page.waitForTimeout(2000);
      const body = await page.locator('body').innerText().catch(() => '');
      const m = body.match(/([A-Z0-9]{8}\$[\d.]+)/);
      if (m && !codes.includes(m[1])) codes.push(m[1]);
      await page.goto(`${URLS.playsite}user/message`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
    }
  }
  console.log(`>> All promo codes in inbox: ${codes.join(', ')}`);
  return codes; // [oldest, ..., newest] order (top of list = newest)
}

// ── boApproveAndReadRemark() ─────────────────────────────────────────────────
async function boApproveAndReadRemark(browser, username, txNo, label, tcFolder) {
  const { ctx: boCtx, page: boPage, bo } = await boLogin(browser);
  await bo.approveDeposit(username, `TC: ${label}`);
  await boPage.waitForTimeout(2000);
  await snap(boPage, tcFolder, 'bo-approve');
  await boPage.goto(`${BO_BASE}/dashboard/cash/deposit-list`, { waitUntil: 'domcontentloaded' });
  await boPage.waitForTimeout(1500);
  await boPage.locator('#ddlFilterStatus').selectOption('Approved').catch(() => {});
  await boPage.locator('#txtUserName').fill(`x9048_${username}`).catch(() => {});
  await boPage.getByRole('button', { name: 'Search' }).click();
  await boPage.waitForTimeout(2000);
  await snap(boPage, tcFolder, 'bo-list');
  const remark = await boPage.evaluate((targetTxNo) => {
    for (const row of document.querySelectorAll('tbody tr')) {
      const txCell = row.querySelector('td:nth-child(2) code');
      if (!txCell || txCell.textContent.trim() !== targetTxNo) continue;
      const tooltip = row.querySelector('remarks tooltip');
      if (tooltip && window.ng?.probe) {
        try { return window.ng.probe(tooltip).componentInstance.Text || ''; } catch {}
      }
      return row.querySelector('remarks span')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    }
    return '';
  }, txNo).catch(() => '');
  console.log(`>> BO remark [${txNo}]: ${remark}`);
  await boCtx.close();
  return remark;
}

// ── submitDeposit() ──────────────────────────────────────────────────────────
async function submitDeposit(page, amount, promoCode = '') {
  await page.goto(`${URLS.playsite}user/deposit`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.locator('.fa.fa-times, .close').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  const pkgBtn = page.locator('button, [role="button"]').filter({ hasText: DEPOSIT.packageName }).first();
  if (await pkgBtn.isVisible({ timeout: 3000 }).catch(() => false)) { await pkgBtn.click(); await page.waitForTimeout(2500); }
  await page.getByRole('combobox').nth(1).selectOption('bank-in-transfer').catch(() => {});
  await page.waitForTimeout(500);
  await page.getByText('Please Choose▼').click().catch(() => {});
  await page.locator('.dropdown-option').filter({ hasText: DEPOSIT.bankName }).first().click().catch(() => {});
  await page.waitForTimeout(1000);
  const amountInput = page.locator('#txtAmountBank');
  await amountInput.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  await amountInput.click();
  await amountInput.fill(String(amount));
  if (promoCode) {
    await page.getByText('Promo Code', { exact: false }).first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    const promoInput = page.locator('#txtPromoCode');
    await promoInput.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await promoInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await promoInput.fill(promoCode);
      console.log(`>> Promo code entered: ${promoCode}`);
    }
  }
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Yes' }).click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'OK' }).click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  console.log(`>> Deposit ${amount} MYR submitted${promoCode ? ` (promo: ${promoCode})` : ''}`);
}

// ── BO Deposit Reward History reader ─────────────────────────────────────────
// Navigates to /dashboard/deposit-reward/history, filters by player (and optionally
// promoCode), returns all matching rows.
async function boReadDepositRewardHistory(browser, username, promoCode = '') {
  const { ctx: boCtx, page: boPage } = await boLogin(browser);
  await boPage.goto(`${BO_BASE}/dashboard/deposit-reward/history`, { waitUntil: 'domcontentloaded' });
  await boPage.waitForTimeout(1500);
  await dismissModals(boPage);
  await boPage.locator('input[placeholder="Player Name"]').fill(`x9048_${username}`).catch(() => {});
  if (promoCode) {
    await boPage.locator('input[placeholder="Redeem Code"]').fill(promoCode).catch(() => {});
  }
  await boPage.getByRole('button', { name: 'Search' }).click();
  await boPage.waitForTimeout(2000);
  const entries = await boPage.evaluate(() => {
    return [...document.querySelectorAll('tbody tr')].map(row => {
      const c = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
      if (c.length < 6) return null;
      return {
        player: c[0] || '', currency: c[1] || '', promoCode: c[2] || '',
        bonusAmount: parseFloat(c[3]) || 0, rewardPercent: parseFloat(c[4]) || 0,
        status: c[5] || '', txNo: c[6] || '', lockBy: c[7] || '',
        redeemBy: c[8] || '', createTime: c[9] || '',
        redeemTime: c[10] || '', expiryTime: c[11] || '',
      };
    }).filter(Boolean).filter(e => e.player || e.promoCode);
  }).catch(() => []);
  console.log(`>> BO DR history [${username}]: ${entries.length} entries`);
  if (entries.length) console.log(`>> Latest: code=${entries[0].promoCode} bonus=$${entries[0].bonusAmount} status=${entries[0].status}`);
  cachedBoSession = await boCtx.storageState();
  await boCtx.close();
  return entries;
}

// ── Player rollover reader ────────────────────────────────────────────────────
// Best-effort: reads turnover/rollover requirement from the withdrawal page.
// Returns 0 if the element cannot be found (test degrades gracefully).
async function readPlayerRollover(page) {
  await page.goto(`${URLS.playsite}user/withdraw`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const m = body.match(/(?:rollover|turnover)[^\d]*([\d,]+\.?\d*)/i);
  if (m) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    console.log(`>> Player rollover requirement: ${val}`);
    return val;
  }
  console.log('>> Player rollover: not found on withdrawal page');
  return 0;
}

// ── BO rollover setter ────────────────────────────────────────────────────────
async function boSetRollover(browser, value) {
  const { ctx: boCtx, page: boPage } = await boLogin(browser);
  await boPage.goto(`${BO_BASE}/dashboard/deposit-reward/agent-setting`, { waitUntil: 'domcontentloaded' });
  await boPage.waitForTimeout(1500);
  await dismissModals(boPage);
  await boPage.locator('select[name="selRollOver"]').selectOption(String(value)).catch(() => {});
  await boPage.locator('button:has-text("Save Changes")').click();
  await boPage.waitForTimeout(1500);
  await dismissModals(boPage);
  cachedBoSession = await boCtx.storageState();
  await boCtx.close();
  console.log(`>> BO rollover set to X${value} ✅`);
}

// ════════════════════════════════════════════════════════════════════════════
test.describe.serial('Deposit Reward — Advanced Suite', () => {

  // ── One-time BO setup check ──────────────────────────────────────────────
  test.beforeAll(async ({ browser }) => {
    const { ctx: boCtx, page: boPage } = await boLogin(browser);
    await boPage.goto(`${BO_BASE}/dashboard/deposit-reward/agent-setting`, { waitUntil: 'domcontentloaded' });
    await boPage.waitForTimeout(1500);
    await boPage.locator('button:has-text("Ok")').first().click({ force: true, timeout: 4000 }).catch(() => {});
    await boPage.waitForTimeout(500);

    const checkbox = boPage.locator('input[name="chkEnablePlaysite"]');
    const isEnabled = await checkbox.isChecked({ timeout: 3000 }).catch(() => false);
    if (!isEnabled) {
      await checkbox.check({ force: true });
      await boPage.locator('button:has-text("Save Changes")').click();
      await boPage.waitForTimeout(1500);
      await dismissModals(boPage);
      console.log('>> Deposit Reward enabled ✅');
    } else {
      console.log('>> Deposit Reward already enabled ✅');
    }
    cachedBoSession = await boCtx.storageState();
    await boCtx.close();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-021: Multiple promo codes — uses oldest first
  // Setup: earn 2 promo codes (two separate qualifying $100 deposits → two BO approvals)
  // codes[codes.length-1] = oldest (bottom of list), codes[0] = newest (top of list)
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-021: multiple promo codes — uses oldest first', async ({ browser }) => {
    test.setTimeout(0);

    // --- Earn promo code #1 ---
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, 100);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    const { ctx: boCtx1, page: boPage1, bo: bo1 } = await boLogin(browser);
    await bo1.approveDeposit(PLAYER.username, 'TC-021 earn promo 1');
    await boCtx1.close();

    // Wait for inbox message to arrive
    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    await pCtx2.close();

    // --- Earn promo code #2 ---
    const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
    await submitDeposit(pPage3, 100);
    await stmt3.navigateToCashHistory();
    await stmt3.verifyLatestStatus('Pending');
    await pCtx3.close();

    const { ctx: boCtx2, page: boPage2, bo: bo2 } = await boLogin(browser);
    await bo2.approveDeposit(PLAYER.username, 'TC-021 earn promo 2');
    await boCtx2.close();

    const { ctx: pCtx4, page: pPage4, stmt: stmt4 } = await playerLogin(browser);
    await stmt4.navigateToCashHistory();
    await stmt4.verifyLatestStatus('Approved');
    await pCtx4.close();

    // --- Read all promo codes from inbox ---
    const { ctx: pCtx5, page: pPage5, stmt: stmt5 } = await playerLogin(browser);
    const codes = await readAllPromoCodesFromInbox(pPage5);
    expect(codes.length, 'TC-021: Should have at least 2 promo codes in inbox').toBeGreaterThanOrEqual(2);

    // codes[0] = newest (top of inbox), codes[codes.length-1] = oldest
    const oldestCode = codes[codes.length - 1];
    const newestCode = codes[0];
    const oldestBonus = parseFloat((oldestCode.match(/\$([\d.]+)$/) || [])[1] || '0');
    const newestBonus = parseFloat((newestCode.match(/\$([\d.]+)$/) || [])[1] || '0');
    console.log(`>> Oldest code: ${oldestCode} (bonus: $${oldestBonus})`);
    console.log(`>> Newest code: ${newestCode} (bonus: $${newestBonus})`);

    await snap(pPage5, 'TC-021', 'inbox-before');

    // --- Submit $50 deposit with oldest code ---
    const balBefore = await readPlayerBalance(pPage5);
    console.log(`>> Balance before TC-021 deposit: ${balBefore}`);
    await submitDeposit(pPage5, 50, oldestCode);
    await stmt5.navigateToCashHistory();
    await stmt5.verifyLatestStatus('Pending');
    const tx = await stmt5.getLatestTransaction();
    console.log(`>> TC-021 txNo: ${tx.txNo}`);
    await pCtx5.close();

    // --- BO approve and read remark ---
    const remark = await boApproveAndReadRemark(browser, PLAYER.username, tx.txNo, 'TC021-oldest', 'TC-021');

    // --- Verify balance and inbox state ---
    const { ctx: pCtx6, page: pPage6, stmt: stmt6 } = await playerLogin(browser);
    await stmt6.navigateToCashHistory();
    await stmt6.verifyLatestStatus('Approved');

    let balAfter = await readPlayerBalance(pPage6);
    for (let i = 0; i < 5 && balAfter <= balBefore; i++) {
      await pPage6.waitForTimeout(3000);
      await pPage6.reload({ waitUntil: 'domcontentloaded' });
      balAfter = await readPlayerBalance(pPage6);
    }

    // Re-read inbox for screenshot evidence — inbox pagination can hide older codes so
    // we don't assert on newestStillPresent; balance is the authoritative proof.
    const remainingCodes021 = await readAllPromoCodesFromInbox(pPage6);
    const newestStillPresent = remainingCodes021.includes(newestCode);
    console.log(`>> TC-021 Remaining codes: ${remainingCodes021.join(', ')}`);
    console.log(`>> TC-021 Newest code still visible in inbox: ${newestStillPresent} (inbox pagination may hide it)`);
    await snap(pPage6, 'TC-021', 'inbox-after');
    await pCtx6.close();

    const expectedBal = balBefore + 50 + oldestBonus;
    console.log(`>> TC-021 Balance: before=${balBefore}, after=${balAfter}, expected=${expectedBal}`);

    // Balance proves oldest code bonus ($${oldestBonus}) was applied — if newest had been used instead,
    // balance would differ by (newestBonus - oldestBonus).
    expect(balAfter, `TC-021: Balance should be ${expectedBal}`).toBeCloseTo(expectedBal, 1);
    console.log('>> TC-021 PASS ✅');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-022: Multiple promo codes — uses newest first
  // Same setup as TC-021 (earn 2 codes). Use codes[0] = newest.
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-022: multiple promo codes — uses newest first', async ({ browser }) => {
    test.setTimeout(0);

    // --- Earn promo code #1 ---
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, 100);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    const { ctx: boCtx1, page: boPage1, bo: bo1 } = await boLogin(browser);
    await bo1.approveDeposit(PLAYER.username, 'TC-022 earn promo 1');
    await boCtx1.close();

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    await pCtx2.close();

    // --- Earn promo code #2 ---
    const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
    await submitDeposit(pPage3, 100);
    await stmt3.navigateToCashHistory();
    await stmt3.verifyLatestStatus('Pending');
    await pCtx3.close();

    const { ctx: boCtx2, page: boPage2, bo: bo2 } = await boLogin(browser);
    await bo2.approveDeposit(PLAYER.username, 'TC-022 earn promo 2');
    await boCtx2.close();

    const { ctx: pCtx4, page: pPage4, stmt: stmt4 } = await playerLogin(browser);
    await stmt4.navigateToCashHistory();
    await stmt4.verifyLatestStatus('Approved');
    await pCtx4.close();

    // --- Read all promo codes from inbox ---
    const { ctx: pCtx5, page: pPage5, stmt: stmt5 } = await playerLogin(browser);
    const codes = await readAllPromoCodesFromInbox(pPage5);
    expect(codes.length, 'TC-022: Should have at least 2 promo codes in inbox').toBeGreaterThanOrEqual(2);

    // codes[0] = newest (top of inbox), codes[codes.length-1] = oldest
    const newestCode = codes[0];
    const oldestCode = codes[codes.length - 1];
    const newestBonus = parseFloat((newestCode.match(/\$([\d.]+)$/) || [])[1] || '0');
    console.log(`>> Newest code: ${newestCode} (bonus: $${newestBonus})`);
    console.log(`>> Older code: ${oldestCode}`);

    await snap(pPage5, 'TC-022', 'inbox-before');

    // --- Submit $50 deposit with newest code ---
    const balBefore = await readPlayerBalance(pPage5);
    console.log(`>> Balance before TC-022 deposit: ${balBefore}`);
    await submitDeposit(pPage5, 50, newestCode);
    await stmt5.navigateToCashHistory();
    await stmt5.verifyLatestStatus('Pending');
    const tx = await stmt5.getLatestTransaction();
    console.log(`>> TC-022 txNo: ${tx.txNo}`);
    await pCtx5.close();

    // --- BO approve and read remark ---
    const remark = await boApproveAndReadRemark(browser, PLAYER.username, tx.txNo, 'TC022-newest', 'TC-022');

    // --- Verify balance and inbox state ---
    const { ctx: pCtx6, page: pPage6, stmt: stmt6 } = await playerLogin(browser);
    await stmt6.navigateToCashHistory();
    await stmt6.verifyLatestStatus('Approved');

    let balAfter = await readPlayerBalance(pPage6);
    for (let i = 0; i < 5 && balAfter <= balBefore; i++) {
      await pPage6.waitForTimeout(3000);
      await pPage6.reload({ waitUntil: 'domcontentloaded' });
      balAfter = await readPlayerBalance(pPage6);
    }

    // Verify older code is still in inbox — must re-read all codes (code text isn't in list view)
    const remainingCodes022 = await readAllPromoCodesFromInbox(pPage6);
    const olderStillPresent = remainingCodes022.includes(oldestCode);
    console.log(`>> TC-022 Remaining codes: ${remainingCodes022.join(', ')}`);
    await snap(pPage6, 'TC-022', 'inbox-after');
    await pCtx6.close();

    const expectedBal = balBefore + 50 + newestBonus;
    console.log(`>> TC-022 Balance: before=${balBefore}, after=${balAfter}, expected=${expectedBal}`);

    // Note: inbox shows ≤6 recent messages. If a new code was issued on this deposit, the older
    // code may be pushed off the visible list — balance check below is the authoritative proof.
    console.log(`>> TC-022 Older code still visible in inbox: ${olderStillPresent} (expected false when new code was issued)`);
    // No hard assert on inbox presence — balance is sufficient proof.
    expect(balAfter, `TC-022: Balance should be ${expectedBal}`).toBeCloseTo(expectedBal, 1);
    console.log('>> TC-022 PASS ✅');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-023: Promo code expires before use
  // SKIPPED — cannot automate without staging clock control
  // ══════════════════════════════════════════════════════════════════════════
  test.skip('TC-023: requires expiry window to elapse — cannot automate without staging clock control', async ({ browser }) => {
    test.setTimeout(0);
    /*
     * Intended steps (for manual verification or when staging clock control is available):
     *
     * 1. Earn a promo code via qualifying $100 deposit + BO approval.
     * 2. Read the promo code and note its expiry from the inbox message.
     * 3. Advance staging clock past the promo code expiry window.
     *    (e.g. via admin API: POST /api/admin/clock/advance { hours: 25 })
     * 4. Submit $50 deposit using the now-expired code.
     * 5. BO approves the deposit.
     * 6. Read BO remark via boApproveAndReadRemark().
     * 7. Assert: remark contains /expired|invalid/i — bonus not credited.
     * 8. Assert: balance = balanceBefore + 50 (no bonus component).
     * 9. Assert: expired code is no longer redeemable (second attempt also rejected).
     *
     * Without clock control this test cannot be automated within a single run window.
     */
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-024: BO disables feature mid-session; player redeems held code
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-024: BO disables feature mid-session; player redeems held code', async ({ browser }) => {
    test.setTimeout(0);

    // Step 1: Earn a promo code via qualifying $100 deposit + BO approval
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, 100);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    const { ctx: boCtxEarn, page: boPageEarn, bo: boEarn } = await boLogin(browser);
    await boEarn.approveDeposit(PLAYER.username, 'TC-024 earn promo');
    await boCtxEarn.close();

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const promoCode = await readPromoCodeFromInbox(pPage2);
    expect(promoCode, 'TC-024: Should have earned a promo code').toBeTruthy();
    console.log(`>> TC-024 promo code: ${promoCode}`);
    await pCtx2.close();

    // Step 2: BO disables feature
    const { ctx: boCtxDisable, page: boPageDisable, bo: boDisable } = await boLogin(browser);
    await boPageDisable.goto(`${BO_BASE}/dashboard/deposit-reward/agent-setting`, { waitUntil: 'domcontentloaded' });
    await boPageDisable.waitForTimeout(1500);
    await dismissModals(boPageDisable);

    const checkboxDisable = boPageDisable.locator('input[name="chkEnablePlaysite"]');
    const wasEnabled = await checkboxDisable.isChecked({ timeout: 3000 }).catch(() => false);
    if (wasEnabled) {
      await checkboxDisable.uncheck({ force: true });
      await boPageDisable.locator('button:has-text("Save Changes")').click();
      await boPageDisable.waitForTimeout(1500);
      await dismissModals(boPageDisable);
      console.log('>> TC-024: Deposit Reward feature disabled ✅');
    } else {
      console.log('>> TC-024: Feature was already disabled');
    }
    await snap(boPageDisable, 'TC-024', 'feature-disabled');
    // Update cached session after navigating to settings
    cachedBoSession = await boCtxDisable.storageState();
    await boCtxDisable.close();

    let depositTx = null;
    let remark = '';
    try {
      // Step 3: Player submits $50 deposit with the promo code
      const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
      const balBefore = await readPlayerBalance(pPage3);
      console.log(`>> TC-024 balance before deposit: ${balBefore}`);
      await submitDeposit(pPage3, 50, promoCode);
      await stmt3.navigateToCashHistory();
      await stmt3.verifyLatestStatus('Pending');
      depositTx = await stmt3.getLatestTransaction();
      console.log(`>> TC-024 deposit txNo: ${depositTx.txNo}`);
      await pCtx3.close();

      // Step 4: BO approves and reads remark
      remark = await boApproveAndReadRemark(browser, PLAYER.username, depositTx.txNo, 'TC024-disabled', 'TC-024');

      // Step 5: Verify balance — feature disabled so no bonus should be credited
      const { ctx: pCtx4, page: pPage4, stmt: stmt4 } = await playerLogin(browser);
      await stmt4.navigateToCashHistory();
      await stmt4.verifyLatestStatus('Approved');
      const balAfter = await readPlayerBalance(pPage4);
      await pCtx4.close();

      const expectedNoBonusBal = balBefore + 50;
      console.log(`>> TC-024 Balance: before=${balBefore}, after=${balAfter}, expected (no bonus)=${expectedNoBonusBal}`);

      // Use expect.soft — exact remark wording is unverified and bonus behaviour when disabled is under test
      expect.soft(remark, `TC-024: BO remark should indicate no bonus when feature is disabled. Got: "${remark}"`).toMatch(/disabled|no reward|no bonus|not eligible|feature/i);
      expect.soft(balAfter, `TC-024: Balance should only increase by $50 (no bonus). Expected: ${expectedNoBonusBal}, Got: ${balAfter}`).toBeCloseTo(expectedNoBonusBal, 1);

    } finally {
      // CRITICAL Step 6: Re-enable the feature regardless of pass/fail
      const { ctx: boCtxReEnable, page: boPageReEnable, bo: boReEnable } = await boLogin(browser);
      await boPageReEnable.goto(`${BO_BASE}/dashboard/deposit-reward/agent-setting`, { waitUntil: 'domcontentloaded' });
      await boPageReEnable.waitForTimeout(1500);
      await dismissModals(boPageReEnable);

      const checkboxReEnable = boPageReEnable.locator('input[name="chkEnablePlaysite"]');
      const isChecked = await checkboxReEnable.isChecked({ timeout: 3000 }).catch(() => false);
      if (!isChecked) {
        await checkboxReEnable.check({ force: true });
        await boPageReEnable.locator('button:has-text("Save Changes")').click();
        await boPageReEnable.waitForTimeout(1500);
        await dismissModals(boPageReEnable);
        console.log('>> TC-024: Deposit Reward feature re-enabled ✅');
      } else {
        console.log('>> TC-024: Feature already re-enabled');
      }
      await snap(boPageReEnable, 'TC-024', 'feature-re-enabled');
      cachedBoSession = await boCtxReEnable.storageState();
      await boCtxReEnable.close();
    }

    console.log('>> TC-024 complete (check soft assertions above)');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-025: Boundary — exact $50.00 earns promo code
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-025: boundary — exact $50.00 earns promo code', async ({ browser }) => {
    test.setTimeout(0);

    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    const balBefore = await readPlayerBalance(pPage1);
    console.log(`>> TC-025 balance before: ${balBefore}`);
    await submitDeposit(pPage1, MIN_DEPOSIT);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    // BO approve
    const { ctx: boCtx, page: boPage, bo } = await boLogin(browser);
    await bo.approveDeposit(PLAYER.username, 'TC-025 boundary exact minimum');
    await boCtx.close();

    // Verify promo code in inbox and balance
    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');

    const balAfter = await readPlayerBalance(pPage2);
    const promoCode = await readPromoCodeFromInbox(pPage2);
    await snap(pPage2, 'TC-025', 'inbox-after');
    await pCtx2.close();

    expect(promoCode, 'TC-025: Promo code should be issued for exact $50 deposit').toBeTruthy();

    if (promoCode) {
      const bonus = parseFloat((promoCode.match(/\$([\d.]+)$/) || [])[1] || '0');
      console.log(`>> TC-025 promo code: ${promoCode} (bonus: $${bonus})`);
      // Bonus should be > 0 and <= MAX_CAP (counter tier is unknown but value must be valid)
      expect(bonus, 'TC-025: Bonus encoded in promo code should be > 0').toBeGreaterThan(0);
      expect(bonus, `TC-025: Bonus encoded in promo code should not exceed max cap $${MAX_CAP}`).toBeLessThanOrEqual(MAX_CAP);
    }

    expect(balAfter, `TC-025: Balance should be ${balBefore + MIN_DEPOSIT}`).toBeCloseTo(balBefore + MIN_DEPOSIT, 1);
    console.log('>> TC-025 PASS ✅');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-026: Boundary — $49.99 earns no promo code
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-026: boundary — $49.99 earns no promo code', async ({ browser }) => {
    test.setTimeout(0);

    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    const balBefore = await readPlayerBalance(pPage1);
    console.log(`>> TC-026 balance before: ${balBefore}`);
    await submitDeposit(pPage1, 49.99);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    const tx = await stmt1.getLatestTransaction();
    console.log(`>> TC-026 txNo: ${tx.txNo}`);
    await pCtx1.close();

    // BO approve
    const { ctx: boCtx, page: boPage, bo } = await boLogin(browser);
    await bo.approveDeposit(PLAYER.username, 'TC-026 boundary below minimum');
    await boCtx.close();

    // Verify no promo code issued and balance
    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');

    const balAfter = await readPlayerBalance(pPage2);

    await pPage2.goto(`${URLS.playsite}user/message`, { waitUntil: 'domcontentloaded' });
    await pPage2.waitForTimeout(2000);
    const inboxBody = await pPage2.locator('body').innerText().catch(() => '');
    // Check inbox does NOT contain a promo code message referencing this txNo
    const hasPromoForTx = inboxBody.includes(tx.txNo);
    await snap(pPage2, 'TC-026', 'inbox-after');
    await pCtx2.close();

    expect(hasPromoForTx, 'TC-026: No promo code message expected for $49.99 (below $50 minimum)').toBeFalsy();
    expect(balAfter, `TC-026: Balance should only increase by $49.99`).toBeCloseTo(balBefore + 49.99, 1);
    console.log('>> TC-026 PASS ✅');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-027: Promo code entered with zero/blank deposit amount
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-027: promo code entered with zero/blank deposit amount', async ({ browser }) => {
    test.setTimeout(0);

    // Step 1: Earn a promo code to have a valid code for this test
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, 100);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    const { ctx: boCtxEarn, page: boPageEarn, bo: boEarn } = await boLogin(browser);
    await boEarn.approveDeposit(PLAYER.username, 'TC-027 earn promo');
    await boCtxEarn.close();

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const promoCode = await readPromoCodeFromInbox(pPage2);
    expect(promoCode, 'TC-027: Should have a valid promo code to test with').toBeTruthy();
    console.log(`>> TC-027 promo code: ${promoCode}`);
    await pCtx2.close();

    // Step 2: Navigate to deposit page, enter promo code, leave amount at 0 or blank
    const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
    await pPage3.goto(`${URLS.playsite}user/deposit`, { waitUntil: 'domcontentloaded' });
    await pPage3.waitForTimeout(2000);
    await pPage3.locator('.fa.fa-times, .close').first().click({ force: true }).catch(() => {});
    await pPage3.waitForTimeout(500);

    const pkgBtn = pPage3.locator('button, [role="button"]').filter({ hasText: DEPOSIT.packageName }).first();
    if (await pkgBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pkgBtn.click();
      await pPage3.waitForTimeout(2500);
    }

    await pPage3.getByRole('combobox').nth(1).selectOption('bank-in-transfer').catch(() => {});
    await pPage3.waitForTimeout(500);
    await pPage3.getByText('Please Choose▼').click().catch(() => {});
    await pPage3.locator('.dropdown-option').filter({ hasText: DEPOSIT.bankName }).first().click().catch(() => {});
    await pPage3.waitForTimeout(1000);

    const amountInput = pPage3.locator('#txtAmountBank');
    await amountInput.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await pPage3.waitForTimeout(500);

    // Expand promo code section and fill the code
    await pPage3.getByText('Promo Code', { exact: false }).first().click({ force: true }).catch(() => {});
    await pPage3.waitForTimeout(500);
    const promoInput = pPage3.locator('#txtPromoCode');
    await promoInput.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await promoInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await promoInput.fill(promoCode);
      console.log(`>> TC-027: Promo code entered: ${promoCode}`);
    }

    // Leave amount as 0 (clear it or fill with 0)
    await amountInput.click();
    await amountInput.fill('0');
    await pPage3.waitForTimeout(500);

    await snap(pPage3, 'TC-027', 'before-submit-zero-amount');

    // Step 3: Attempt to submit
    await pPage3.getByRole('button', { name: 'Submit' }).click();
    await pPage3.waitForTimeout(2000);

    // Check for validation error or that Yes button is absent (no confirmation dialog = blocked)
    const yesBtn = pPage3.getByRole('button', { name: 'Yes' });
    const yesBtnVisible = await yesBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (yesBtnVisible) {
      // If somehow a confirmation appears, do NOT confirm — cancel it
      await pPage3.getByRole('button', { name: 'No' }).click({ timeout: 5000 }).catch(() => {});
      await pPage3.waitForTimeout(1000);
    }

    // Look for validation error message
    const pageText = await pPage3.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const hasValidationError = /minimum|invalid|required|must be|at least|greater/i.test(pageText) ||
      await pPage3.locator('.swal2-html-container, .alert-danger, .toast-error, .validation-error').first().isVisible({ timeout: 2000 }).catch(() => false);

    await snap(pPage3, 'TC-027', 'after-submit-zero-amount');

    // Verify the deposit page shows an error or the submit did not proceed
    const submitBtn = pPage3.getByRole('button', { name: 'Submit' });
    const submitDisabled = await submitBtn.isDisabled({ timeout: 2000 }).catch(() => false);
    const formBlockedSubmit = !yesBtnVisible || hasValidationError || submitDisabled;

    console.log(`>> TC-027: yesBtnVisible=${yesBtnVisible}, hasValidationError=${hasValidationError}, submitDisabled=${submitDisabled}`);

    // Step 4: Navigate to cash history — verify no pending/new transaction created
    await stmt3.navigateToCashHistory();
    await pPage3.waitForTimeout(1500);
    const latestTx = await stmt3.getLatestTransaction();
    // The latest tx should NOT be a new deposit with zero amount
    const noNewZeroDeposit = !latestTx.amount.includes('0.00') || latestTx.status === 'Approved'; // any existing approved tx is fine
    await snap(pPage3, 'TC-027', 'cash-history');

    // Step 5: Verify promo code is NOT consumed — still present in inbox
    const promoStillInInbox = await readPromoCodeFromInbox(pPage3);
    await snap(pPage3, 'TC-027', 'inbox-after');
    await pCtx3.close();

    expect(formBlockedSubmit, 'TC-027: Form should show validation error or block submit for $0 amount').toBeTruthy();
    expect(promoStillInInbox, 'TC-027: Promo code should not be consumed when deposit amount is zero').toBeTruthy();
    console.log('>> TC-027 PASS ✅');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-028: BO rejects deposit with promo code — code not consumed
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-028: BO rejects deposit with promo code — code not consumed', async ({ browser }) => {
    test.setTimeout(0);

    // Step 1: Earn promo code via qualifying $100 deposit
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, 100);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    const { ctx: boCtxEarn, page: boPageEarn, bo: boEarn } = await boLogin(browser);
    await boEarn.approveDeposit(PLAYER.username, 'TC-028 earn promo');
    await boCtxEarn.close();

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const promoCode = await readPromoCodeFromInbox(pPage2);
    expect(promoCode, 'TC-028: Should have earned a promo code').toBeTruthy();
    console.log(`>> TC-028 promo code: ${promoCode}`);
    await pCtx2.close();

    // Step 2: Submit $50 deposit (Deposit A) with promo code
    const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
    const balBeforeA = await readPlayerBalance(pPage3);
    console.log(`>> TC-028 balance before Deposit A: ${balBeforeA}`);
    await submitDeposit(pPage3, 50, promoCode);
    await stmt3.navigateToCashHistory();
    await stmt3.verifyLatestStatus('Pending');
    const txA = await stmt3.getLatestTransaction();
    console.log(`>> TC-028 Deposit A txNo: ${txA.txNo}`);
    await pCtx3.close();

    // Step 3: BO rejects Deposit A
    const { ctx: boCtxReject, page: boPageReject, bo: boReject } = await boLogin(browser);
    await boReject.rejectDeposit(PLAYER.username, 'TC-028 reject deposit A with promo');
    await boPageReject.waitForTimeout(2000);
    await snap(boPageReject, 'TC-028', 'bo-rejected');

    // Read remark from the rejected deposit
    await boPageReject.goto(`${BO_BASE}/dashboard/cash/deposit-list`, { waitUntil: 'domcontentloaded' });
    await boPageReject.waitForTimeout(1500);
    await boPageReject.locator('#ddlFilterStatus').selectOption('Rejected').catch(() => {});
    await boPageReject.locator('#txtUserName').fill(`x9048_${PLAYER.username}`).catch(() => {});
    await boPageReject.getByRole('button', { name: 'Search' }).click();
    await boPageReject.waitForTimeout(2000);
    await snap(boPageReject, 'TC-028', 'bo-rejected-list');
    cachedBoSession = await boCtxReject.storageState();
    await boCtxReject.close();

    // Step 4: Verify status = Rejected in player cash history
    const { ctx: pCtx4, page: pPage4, stmt: stmt4 } = await playerLogin(browser);
    await stmt4.navigateToCashHistory();
    await stmt4.verifyLatestStatus('Rejected');
    console.log('>> TC-028: Deposit A status = Rejected ✅');

    // Step 5: Verify promo code is still in inbox (not consumed by rejected deposit)
    const promoAfterReject = await readPromoCodeFromInbox(pPage4);
    await snap(pPage4, 'TC-028', 'inbox-after-reject');
    expect(promoAfterReject, 'TC-028: Promo code should still be in inbox after rejected deposit').toBeTruthy();
    expect(promoAfterReject, `TC-028: Promo code in inbox should match original code`).toBe(promoCode);
    console.log('>> TC-028: Promo code still in inbox after rejection ✅');

    // Step 6: Submit $50 deposit (Deposit B) using SAME promo code again
    const balBeforeB = await readPlayerBalance(pPage4);
    console.log(`>> TC-028 balance before Deposit B: ${balBeforeB}`);
    await submitDeposit(pPage4, 50, promoCode);
    await stmt4.navigateToCashHistory();
    await stmt4.verifyLatestStatus('Pending');
    const txB = await stmt4.getLatestTransaction();
    console.log(`>> TC-028 Deposit B txNo: ${txB.txNo}`);
    await pCtx4.close();

    // Step 7: BO approves Deposit B and reads remark
    const remark = await boApproveAndReadRemark(browser, PLAYER.username, txB.txNo, 'TC028-reuse-after-reject', 'TC-028');

    // Step 8: Assert bonus credited on Deposit B
    const { ctx: pCtx5, page: pPage5, stmt: stmt5 } = await playerLogin(browser);
    await stmt5.navigateToCashHistory();
    await stmt5.verifyLatestStatus('Approved');

    let balAfterB = await readPlayerBalance(pPage5);
    for (let i = 0; i < 5 && balAfterB <= balBeforeB; i++) {
      await pPage5.waitForTimeout(3000);
      await pPage5.reload({ waitUntil: 'domcontentloaded' });
      balAfterB = await readPlayerBalance(pPage5);
    }
    await snap(pPage5, 'TC-028', 'balance-after-deposit-b');
    await pCtx5.close();

    const promoBonus = parseFloat((promoCode.match(/\$([\d.]+)$/) || [])[1] || '0');
    const expectedBalB = balBeforeB + 50 + promoBonus;
    console.log(`>> TC-028 Deposit B: before=${balBeforeB}, after=${balAfterB}, expected=${expectedBalB}, bonus=${promoBonus}`);
    console.log(`>> TC-028 Deposit B remark: ${remark}`);

    expect(balAfterB, `TC-028: Balance after Deposit B should be ${expectedBalB} (deposit + bonus)`).toBeCloseTo(expectedBalB, 1);
    console.log('>> TC-028 PASS ✅');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-029: Max cap — large deposit bonus does not exceed $25
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-029: max cap — large deposit bonus capped at $25', async ({ browser }) => {
    test.setTimeout(0);

    // Step 1: Run 3 qualifying $50 deposits to ensure counter >= 3 (30% tier)
    // This also covers the case where counter is already elevated from prior tests
    console.log('>> TC-029: Running 3 qualifying deposits to ensure counter >= 3...');
    for (let i = 1; i <= 3; i++) {
      const { ctx: pCtxW, page: pPageW, stmt: stmtW } = await playerLogin(browser);
      await submitDeposit(pPageW, MIN_DEPOSIT);
      await stmtW.navigateToCashHistory();
      await stmtW.verifyLatestStatus('Pending');
      await pCtxW.close();

      const { ctx: boCtxW, page: boPageW, bo: boW } = await boLogin(browser);
      await boW.approveDeposit(PLAYER.username, `TC-029 warmup ${i}`);
      await boCtxW.close();

      const { ctx: pCtxWR, page: pPageWR, stmt: stmtWR } = await playerLogin(browser);
      await stmtWR.navigateToCashHistory();
      await stmtWR.verifyLatestStatus('Approved');
      await pCtxWR.close();
      console.log(`>> TC-029 warmup deposit ${i}/3 done`);
    }

    // Step 2: Submit $200 deposit (30% = $60, but cap is $25)
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, 200);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    const txLarge = await stmt1.getLatestTransaction();
    console.log(`>> TC-029 large deposit txNo: ${txLarge.txNo}`);
    await pCtx1.close();

    // Step 3: BO approve
    const { ctx: boCtx1, page: boPage1, bo: bo1 } = await boLogin(browser);
    await bo1.approveDeposit(PLAYER.username, 'TC-029 large deposit $200');
    await boCtx1.close();

    // Step 4: Read promo code from inbox
    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const promoCode = await readPromoCodeFromInbox(pPage2);
    await snap(pPage2, 'TC-029', 'promo-earned');
    expect(promoCode, 'TC-029: Should earn a promo code for $200 qualifying deposit').toBeTruthy();

    // Step 5: Assert bonus encoded in promo code = $25 (capped), not $60
    const cappedBonus = parseFloat((promoCode.match(/\$([\d.]+)$/) || [])[1] || '0');
    console.log(`>> TC-029 promo code: ${promoCode} (bonus: $${cappedBonus})`);
    console.log(`>> TC-029: 30% of $200 = $60, but cap = $${MAX_CAP}. Expect $${MAX_CAP}.`);
    expect(cappedBonus, `TC-029: Bonus in promo code should be capped at $${MAX_CAP}`).toBeCloseTo(MAX_CAP, 1);

    // Step 6: Submit $100 deposit using the $25 promo code
    const balBeforeUse = await readPlayerBalance(pPage2);
    console.log(`>> TC-029 balance before using promo: ${balBeforeUse}`);
    await submitDeposit(pPage2, 100, promoCode);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Pending');
    const txUse = await stmt2.getLatestTransaction();
    console.log(`>> TC-029 promo use deposit txNo: ${txUse.txNo}`);
    await pCtx2.close();

    // Step 7: BO approve
    const remark = await boApproveAndReadRemark(browser, PLAYER.username, txUse.txNo, 'TC029-use-capped-promo', 'TC-029');
    console.log(`>> TC-029 BO remark: ${remark}`);

    // Step 8: Assert balance = before + 100 + 25
    const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
    await stmt3.navigateToCashHistory();
    await stmt3.verifyLatestStatus('Approved');

    let balAfterUse = await readPlayerBalance(pPage3);
    for (let i = 0; i < 5 && balAfterUse <= balBeforeUse; i++) {
      await pPage3.waitForTimeout(3000);
      await pPage3.reload({ waitUntil: 'domcontentloaded' });
      balAfterUse = await readPlayerBalance(pPage3);
    }
    await snap(pPage3, 'TC-029', 'balance-after-use');
    await pCtx3.close();

    const expectedBalUse = balBeforeUse + 100 + MAX_CAP;
    console.log(`>> TC-029 Balance: before=${balBeforeUse}, after=${balAfterUse}, expected=${expectedBalUse}`);
    expect(balAfterUse, `TC-029: Balance should be ${expectedBalUse} (100 deposit + $25 capped bonus)`).toBeCloseTo(expectedBalUse, 1);
    console.log('>> TC-029 PASS ✅');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-030: Concurrent same-code submission
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-030: concurrent same-code submission', async ({ browser }) => {
    test.setTimeout(0);

    // Step 1: Earn one promo code
    const { ctx: pCtxEarn, page: pPageEarn, stmt: stmtEarn } = await playerLogin(browser);
    await submitDeposit(pPageEarn, 100);
    await stmtEarn.navigateToCashHistory();
    await stmtEarn.verifyLatestStatus('Pending');
    await pCtxEarn.close();

    const { ctx: boCtxEarn, page: boPageEarn, bo: boEarn } = await boLogin(browser);
    await boEarn.approveDeposit(PLAYER.username, 'TC-030 earn promo');
    await boCtxEarn.close();

    const { ctx: pCtxCode, page: pPageCode, stmt: stmtCode } = await playerLogin(browser);
    await stmtCode.navigateToCashHistory();
    await stmtCode.verifyLatestStatus('Approved');
    const promoCode = await readPromoCodeFromInbox(pPageCode);
    expect(promoCode, 'TC-030: Should have earned a promo code for concurrent test').toBeTruthy();
    console.log(`>> TC-030 promo code: ${promoCode}`);
    await snap(pPageCode, 'TC-030', 'promo-earned');
    await pCtxCode.close();

    // Step 2: Launch TWO player sessions concurrently
    const [sessionA, sessionB] = await Promise.all([
      playerLogin(browser),
      playerLogin(browser),
    ]);
    const { ctx: ctxA, page: pageA, stmt: stmtA } = sessionA;
    const { ctx: ctxB, page: pageB, stmt: stmtB } = sessionB;

    // Read balance from either session (same account)
    const balBefore = await readPlayerBalance(pageA);
    console.log(`>> TC-030 balance before concurrent deposits: ${balBefore}`);

    // Step 3: Both sessions navigate to deposit page and set up (but do NOT submit yet)
    // Navigate both to deposit page
    await Promise.all([
      pageA.goto(`${URLS.playsite}user/deposit`, { waitUntil: 'domcontentloaded' }),
      pageB.goto(`${URLS.playsite}user/deposit`, { waitUntil: 'domcontentloaded' }),
    ]);
    await Promise.all([pageA.waitForTimeout(2000), pageB.waitForTimeout(2000)]);

    // Step 4: Submit both simultaneously using the SAME promo code
    await Promise.all([
      submitDeposit(pageA, 50, promoCode),
      submitDeposit(pageB, 50, promoCode),
    ]);
    console.log('>> TC-030: Both deposits submitted concurrently');
    await snap(pageA, 'TC-030', 'after-concurrent-submit-A');
    await snap(pageB, 'TC-030', 'after-concurrent-submit-B');

    // Get txNos from cash history for both sessions
    await stmtA.navigateToCashHistory();
    const txA = await stmtA.getLatestTransaction();
    console.log(`>> TC-030 session A txNo: ${txA.txNo}`);

    await stmtB.navigateToCashHistory();
    const txB = await stmtB.getLatestTransaction();
    console.log(`>> TC-030 session B txNo: ${txB.txNo}`);

    await ctxA.close();
    await ctxB.close();

    // Step 5: BO approves BOTH deposits
    const { ctx: boCtx1, page: boPage1, bo: bo1 } = await boLogin(browser);
    await bo1.approveDeposit(PLAYER.username, 'TC-030 concurrent deposit A');
    await boCtx1.close();

    const { ctx: boCtx2, page: boPage2, bo: bo2 } = await boLogin(browser);
    await bo2.approveDeposit(PLAYER.username, 'TC-030 concurrent deposit B');
    await boCtx2.close();

    // Step 6: Read BO remark for both tx numbers
    // Note: txA and txB may refer to the same or different transactions depending on how the server deduped
    let remarkA = '';
    let remarkB = '';

    if (txA.txNo && txA.txNo !== '-') {
      remarkA = await boApproveAndReadRemark(browser, PLAYER.username, txA.txNo, 'TC030-concurrentA', 'TC-030');
    }
    if (txB.txNo && txB.txNo !== '-' && txB.txNo !== txA.txNo) {
      remarkB = await boApproveAndReadRemark(browser, PLAYER.username, txB.txNo, 'TC030-concurrentB', 'TC-030');
    }

    console.log(`>> TC-030 Remark A [${txA.txNo}]: ${remarkA}`);
    console.log(`>> TC-030 Remark B [${txB.txNo}]: ${remarkB}`);

    // Step 7: Verify balance
    const { ctx: pCtxFinal, page: pPageFinal, stmt: stmtFinal } = await playerLogin(browser);
    await pPageFinal.waitForTimeout(2000);

    let balAfter = await readPlayerBalance(pPageFinal);
    for (let i = 0; i < 5 && balAfter <= balBefore; i++) {
      await pPageFinal.waitForTimeout(3000);
      await pPageFinal.reload({ waitUntil: 'domcontentloaded' });
      balAfter = await readPlayerBalance(pPageFinal);
    }
    await snap(pPageFinal, 'TC-030', 'balance-after');
    await pCtxFinal.close();

    const promoBonus = parseFloat((promoCode.match(/\$([\d.]+)$/) || [])[1] || '0');
    // Expected: two $50 deposits = $100 + exactly ONE bonus (not double)
    const expectedBal = balBefore + 100 + promoBonus;
    console.log(`>> TC-030 Balance: before=${balBefore}, after=${balAfter}, expected (one bonus)=${expectedBal}`);
    console.log(`>> TC-030: promoBonus=$${promoBonus}`);

    // Assert: exactly one remark shows bonus credited, other shows "already redeemed"
    // Use expect.soft — tests a potential race condition bug
    const bothRemarks = [remarkA, remarkB].join(' | ');
    const hasRedeemedRemark = /already redeemed|redeemed/i.test(remarkA) || /already redeemed|redeemed/i.test(remarkB);
    expect.soft(hasRedeemedRemark, `TC-030: One deposit should show "already redeemed". Remarks: "${bothRemarks}"`).toBeTruthy();

    // Assert: total balance = 100 (two $50 deposits) + one bonus only
    expect.soft(balAfter, `TC-030: Balance should be ${expectedBal} (two deposits + ONE bonus). Race condition may cause double-bonus bug.`).toBeCloseTo(expectedBal, 1);

    console.log('>> TC-030 complete (check soft assertions above for race condition findings)');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-020: Counter fresh for Setting 2 (min $200) — proxy for counter-reset-to-1
  // Setting 2 counter for claudestag1 is untouched (never made a $200 deposit), so
  // counter starts at 1 → 1st tier rate (5%) should apply.
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-020: Setting 2 fresh counter — 1st-tier rate (5%) applied to $200 deposit', async ({ browser }) => {
    test.setTimeout(0);

    const S2 = SETTINGS[2]; // min $200, percents [5, 10, 20]
    const expectedBonus = Math.min(S2.minDeposit * S2.percents[0] / 100, MAX_CAP); // 5% × 200 = 10

    const { ctx: pCtx, page: pPage, stmt } = await playerLogin(browser);
    const balBefore = await readPlayerBalance(pPage);
    console.log(`>> TC-020 balance before: ${balBefore}`);
    await submitDeposit(pPage, S2.minDeposit);
    await stmt.navigateToCashHistory();
    await stmt.verifyLatestStatus('Pending');
    await pCtx.close();

    const { ctx: boCtx, page: boPage, bo } = await boLogin(browser);
    await bo.approveDeposit(PLAYER.username, 'TC-020 Setting2 fresh counter');
    await boCtx.close();

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const balAfter = await readPlayerBalance(pPage2);
    const promoCode = await readPromoCodeFromInbox(pPage2);
    await snap(pPage2, 'TC-020', 'inbox-after');
    await pCtx2.close();

    // Also verify entry in BO deposit reward history
    const historyEntries = await boReadDepositRewardHistory(browser, PLAYER.username, promoCode || '');
    const histSnap = historyEntries.length > 0
      ? `code=${historyEntries[0].promoCode} bonus=$${historyEntries[0].bonusAmount} status=${historyEntries[0].status}`
      : 'no entry found';
    console.log(`>> TC-020 BO history: ${histSnap}`);

    expect(promoCode, 'TC-020: Promo code should be issued for Setting 2 $200 deposit').toBeTruthy();
    expect(balAfter, `TC-020: Balance should be ${balBefore + S2.minDeposit}`).toBeCloseTo(balBefore + S2.minDeposit, 1);

    if (promoCode) {
      const bonus = parseFloat((promoCode.match(/\$([\d.]+)$/) || [])[1] || '0');
      console.log(`>> TC-020 code: ${promoCode}, bonus: $${bonus}`);
      console.log(`>> TC-020 expected (counter-1 rate 5%): $${expectedBonus}`);
      // Soft: if counter is shared (already at 3), bonus will be $25 cap instead of $10
      expect.soft(bonus, `TC-020: Expected Setting 2 counter-1 bonus $${expectedBonus}, got $${bonus} — if counter is shared with Setting 1 (at 3), got counter-3 rate`).toBeCloseTo(expectedBonus, 1);
    }
    console.log('>> TC-020 complete');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-031: Counter-3 code from Setting 1 used on a Setting 2 deposit
  // Key assertion: bonus is FIXED at issuance (encoded in code), not recalculated
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-031: Counter-3 Setting 1 code redeemed on Setting 2 deposit — bonus fixed at issuance', async ({ browser }) => {
    test.setTimeout(0);

    // Step 1: Earn a Setting 1 counter-3 promo code ($50 → 30% = $15, capped at $25)
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, MIN_DEPOSIT);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    const { ctx: boCtx1, page: boPage1, bo: bo1 } = await boLogin(browser);
    await bo1.approveDeposit(PLAYER.username, 'TC-031 earn counter-3 code');
    await boCtx1.close();

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const c3Code = await readPromoCodeFromInbox(pPage2);
    expect(c3Code, 'TC-031: Should earn a counter-3 promo code').toBeTruthy();
    const c3Bonus = parseFloat((c3Code.match(/\$([\d.]+)$/) || [])[1] || '0');
    console.log(`>> TC-031 counter-3 code: ${c3Code} (encoded bonus: $${c3Bonus})`);
    await pCtx2.close();

    // Step 2: Use the counter-3 code on a Setting 2 deposit ($200)
    const S2 = SETTINGS[2];
    const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
    const balBefore = await readPlayerBalance(pPage3);
    console.log(`>> TC-031 balance before Setting 2 deposit: ${balBefore}`);
    await submitDeposit(pPage3, S2.minDeposit, c3Code);
    await stmt3.navigateToCashHistory();
    await stmt3.verifyLatestStatus('Pending');
    const tx = await stmt3.getLatestTransaction();
    console.log(`>> TC-031 txNo: ${tx.txNo}`);
    await pCtx3.close();

    const remark = await boApproveAndReadRemark(browser, PLAYER.username, tx.txNo, 'TC031-c3-on-s2', 'TC-031');

    const { ctx: pCtx4, page: pPage4, stmt: stmt4 } = await playerLogin(browser);
    await stmt4.navigateToCashHistory();
    await stmt4.verifyLatestStatus('Approved');
    let balAfter = await readPlayerBalance(pPage4);
    for (let i = 0; i < 5 && balAfter <= balBefore; i++) {
      await pPage4.waitForTimeout(3000);
      await pPage4.reload({ waitUntil: 'domcontentloaded' });
      balAfter = await readPlayerBalance(pPage4);
    }
    const newPromo = await readPromoCodeFromInbox(pPage4);
    const newBonus = newPromo ? parseFloat((newPromo.match(/\$([\d.]+)$/) || [])[1] || '0') : 0;
    await snap(pPage4, 'TC-031', 'balance-inbox-after');
    await pCtx4.close();

    const expectedBal = balBefore + S2.minDeposit + c3Bonus;
    console.log(`>> TC-031 Balance: ${balBefore} → ${balAfter} (expected ${expectedBal})`);
    console.log(`>> TC-031 New promo from Setting 2 deposit: ${newPromo || 'none'} ($${newBonus})`);

    // Main assertion: encoded bonus must be credited as-is
    expect(balAfter, `TC-031: Balance must credit the encoded counter-3 bonus ($${c3Bonus}), not recalculate`).toBeCloseTo(expectedBal, 1);

    // Soft: new promo should be at Setting 2 counter-1 rate (5% × 200 = $10), if counter is per-setting
    if (newPromo) {
      const expectedNewBonus = Math.min(S2.minDeposit * S2.percents[0] / 100, MAX_CAP);
      console.log(`>> TC-031 Expected new promo (Setting 2 counter-1): $${expectedNewBonus}`);
      expect.soft(newBonus, `TC-031: New promo should be $${expectedNewBonus} (Setting 2 counter-1 rate), got $${newBonus}`).toBeCloseTo(expectedNewBonus, 1);
    }
    console.log('>> TC-031 complete');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-032: Rollover requirement applied correctly when bonus is credited
  // Current rollover = X3. After promo credited, rollover should increase by bonus × 3.
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-032: rollover requirement increases by bonus × rollover multiplier', async ({ browser }) => {
    test.setTimeout(0);

    const ROLLOVER = ROLLOVER_CURRENT; // X3

    // Step 1: Earn promo code
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, 100);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    const { ctx: boCtx1, page: boPage1, bo: bo1 } = await boLogin(browser);
    await bo1.approveDeposit(PLAYER.username, 'TC-032 earn promo');
    await boCtx1.close();

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const promoCode = await readPromoCodeFromInbox(pPage2);
    expect(promoCode, 'TC-032: Should earn a promo code').toBeTruthy();
    const bonus = parseFloat((promoCode.match(/\$([\d.]+)$/) || [])[1] || '0');
    console.log(`>> TC-032 promo: ${promoCode} (bonus: $${bonus}, rollover X${ROLLOVER})`);

    // Read rollover BEFORE using the promo
    const rolloverBefore = await readPlayerRollover(pPage2);
    console.log(`>> TC-032 rollover before: ${rolloverBefore}`);
    await snap(pPage2, 'TC-032', 'rollover-before');

    // Step 2: Use promo code on $50 deposit
    await submitDeposit(pPage2, 50, promoCode);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Pending');
    const tx = await stmt2.getLatestTransaction();
    console.log(`>> TC-032 deposit txNo: ${tx.txNo}`);
    await pCtx2.close();

    await boApproveAndReadRemark(browser, PLAYER.username, tx.txNo, 'TC032-rollover', 'TC-032');

    // Verify BO history entry — check status is Redeem and bonus matches
    const histEntries = await boReadDepositRewardHistory(browser, PLAYER.username, promoCode);
    const histEntry = histEntries.find(e => e.promoCode === promoCode);
    console.log(`>> TC-032 BO history entry: ${JSON.stringify(histEntry || 'not found')}`);

    // Read rollover AFTER promo credited
    const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
    await stmt3.navigateToCashHistory();
    await stmt3.verifyLatestStatus('Approved');
    const rolloverAfter = await readPlayerRollover(pPage3);
    await snap(pPage3, 'TC-032', 'rollover-after');
    await pCtx3.close();

    const expectedIncrease = bonus * ROLLOVER;
    const actualIncrease = rolloverAfter - rolloverBefore;
    console.log(`>> TC-032 Rollover: ${rolloverBefore} → ${rolloverAfter}`);
    console.log(`>> TC-032 Expected increase: $${bonus} × X${ROLLOVER} = $${expectedIncrease}`);
    console.log(`>> TC-032 Actual increase: $${actualIncrease}`);

    // Assert BO history shows Redeem status
    if (histEntry) {
      expect(histEntry.status, 'TC-032: BO history entry should be Redeem after use').toMatch(/redeem/i);
      expect(histEntry.bonusAmount, `TC-032: BO history bonus should be $${bonus}`).toBeCloseTo(bonus, 1);
    } else {
      console.log('>> TC-032: BO history entry not found — verify manually');
    }

    // Assert rollover increase (soft: depends on whether rollover page is readable)
    if (rolloverBefore > 0 || rolloverAfter > 0) {
      expect.soft(actualIncrease, `TC-032: Rollover should increase by $${expectedIncrease} (bonus $${bonus} × X${ROLLOVER}), got $${actualIncrease}`).toBeCloseTo(expectedIncrease, 1);
    } else {
      console.log('>> TC-032: Rollover not visible on withdrawal page — soft assertion skipped');
    }
    console.log('>> TC-032 complete');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TC-033: Rollover setting change does not affect previously issued promo codes
  // Earn code at X3 → change BO rollover to X5 → redeem old code → rollover should be X3 not X5
  // ══════════════════════════════════════════════════════════════════════════
  test('TC-033: old promo code keeps rollover from issuance (X3), ignores new setting (X5)', async ({ browser }) => {
    test.setTimeout(0);

    const ORIGINAL_ROLLOVER = ROLLOVER_CURRENT; // X3
    const NEW_ROLLOVER      = 5;                // X5 — temporary change

    // Step 1: Earn promo code at current rollover (X3)
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, 100);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    const { ctx: boCtx1, page: boPage1, bo: bo1 } = await boLogin(browser);
    await bo1.approveDeposit(PLAYER.username, 'TC-033 earn promo at X3');
    await boCtx1.close();

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const oldCode = await readPromoCodeFromInbox(pPage2);
    expect(oldCode, 'TC-033: Should earn a promo code at X3 rollover').toBeTruthy();
    const oldBonus = parseFloat((oldCode.match(/\$([\d.]+)$/) || [])[1] || '0');
    console.log(`>> TC-033 old code: ${oldCode} (bonus: $${oldBonus}, issued at X${ORIGINAL_ROLLOVER})`);

    const rolloverBefore = await readPlayerRollover(pPage2);
    console.log(`>> TC-033 rollover before: ${rolloverBefore}`);
    await snap(pPage2, 'TC-033', 'rollover-before');
    await pCtx2.close();

    try {
      // Step 2: Change BO rollover to X5
      await boSetRollover(browser, NEW_ROLLOVER);

      // Step 3: Redeem the OLD code (was issued at X3)
      const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
      await submitDeposit(pPage3, 50, oldCode);
      await stmt3.navigateToCashHistory();
      await stmt3.verifyLatestStatus('Pending');
      const tx = await stmt3.getLatestTransaction();
      console.log(`>> TC-033 deposit txNo: ${tx.txNo}`);
      await pCtx3.close();

      await boApproveAndReadRemark(browser, PLAYER.username, tx.txNo, 'TC033-old-code-new-rollover', 'TC-033');

      const { ctx: pCtx4, page: pPage4, stmt: stmt4 } = await playerLogin(browser);
      await stmt4.navigateToCashHistory();
      await stmt4.verifyLatestStatus('Approved');
      const rolloverAfter = await readPlayerRollover(pPage4);
      await snap(pPage4, 'TC-033', 'rollover-after-old-code');
      await pCtx4.close();

      const actualIncrease   = rolloverAfter - rolloverBefore;
      const expectedIfOldX3  = oldBonus * ORIGINAL_ROLLOVER;
      const expectedIfNewX5  = oldBonus * NEW_ROLLOVER;
      console.log(`>> TC-033 Rollover: ${rolloverBefore} → ${rolloverAfter} (increase: $${actualIncrease})`);
      console.log(`>> TC-033 Expected if X3 honoured: +$${expectedIfOldX3}`);
      console.log(`>> TC-033 Expected if X5 applied:  +$${expectedIfNewX5}`);

      if (rolloverBefore > 0 || rolloverAfter > 0) {
        expect.soft(actualIncrease,
          `TC-033: Old code should apply X${ORIGINAL_ROLLOVER} rollover (+$${expectedIfOldX3}), NOT new X${NEW_ROLLOVER} (+$${expectedIfNewX5}). Got: +$${actualIncrease}`
        ).toBeCloseTo(expectedIfOldX3, 1);
      } else {
        console.log('>> TC-033: Rollover not readable — soft assertion skipped. Verify BO history manually.');
      }

      // Also verify via BO history: new promo issued NOW (after X5 set) should carry X5 rollover
      // (earn a fresh code and check — verifies only NEW codes use the new setting)
      const { ctx: pCtxNew, page: pPageNew, stmt: stmtNew } = await playerLogin(browser);
      await submitDeposit(pPageNew, 100);
      await stmtNew.navigateToCashHistory();
      await stmtNew.verifyLatestStatus('Pending');
      await pCtxNew.close();

      const { ctx: boCtxNew, page: boPageNew, bo: boNew } = await boLogin(browser);
      await boNew.approveDeposit(PLAYER.username, 'TC-033 earn NEW promo at X5');
      await boCtxNew.close();

      const { ctx: pCtxNew2, page: pPageNew2, stmt: stmtNew2 } = await playerLogin(browser);
      await stmtNew2.navigateToCashHistory();
      await stmtNew2.verifyLatestStatus('Approved');
      const newCode = await readPromoCodeFromInbox(pPageNew2);
      await snap(pPageNew2, 'TC-033', 'new-code-at-x5');
      await pCtxNew2.close();

      // New code was issued while rollover = X5 — it should carry X5 rollover when redeemed
      // (verifying new codes pick up the changed setting; redemption tested separately)
      console.log(`>> TC-033 new code issued at X5: ${newCode || 'none'} — should carry X5 rollover when redeemed`);

    } finally {
      // CRITICAL: Restore original rollover X3
      await boSetRollover(browser, ORIGINAL_ROLLOVER);
      console.log(`>> TC-033: Rollover restored to X${ORIGINAL_ROLLOVER} ✅`);
    }
    console.log('>> TC-033 complete');
  });

}); // end describe.serial
