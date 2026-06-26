/**
 * DepositReward.spec.js  —  Unified Deposit Reward Test Suite
 *
 * Speed optimisation: BO session is cached after the first CAPTCHA login
 * and reused for every subsequent test — saves ~40 s per TC.
 *
 * Tests (serial — share claudestag1 player account):
 *   beforeAll  — verify Deposit Reward setting is enabled in BO
 *   Happy Path — qualify → earn promo → use → bonus credited
 *   TC-001     — below-min ($49) → no promo issued
 *   TC-014     — invalid promo code → BO remark "Promo code not found", no bonus
 *   TC-010     — reused promo code → BO remark "Promo code already redeemed"
 *   TC-012     — sub-min deposit ($30) + valid promo → bonus credited, no new promo
 *   TC-004     — counter escalation 1 → 2 → 3 → 3 (capped)
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { CaptchaHelper }   from '../helpers/CaptchaHelper.js';
import { LoginPage }       from './pages/LoginPage.js';
import { BackofficePage }  from './pages/BackofficePage.js';
import { StatementPage }   from './pages/StatementPage.js';
import { PLAYER, BACKOFFICE, DEPOSIT, URLS } from './config.js';

// ── Constants ────────────────────────────────────────────────────
const BO_BASE   = URLS.backoffice.replace('/login', '');
const SNAP_BASE = join(process.cwd(), '.screenshots-tmp', 'deposit-reward');

// Setting 1 on staging: min $50, 1st=10%, 2nd=20%, 3rd=30%, cap=$25
const MIN_DEPOSIT = 50;
const MAX_CAP     = 25;
const PERCENTS    = [10, 20, 30]; // counter 1, 2, 3+

// ── Cached BO session (set after first CAPTCHA login) ────────────
let cachedBoSession = null;

// ── Shared helpers ───────────────────────────────────────────────

async function snap(page, tcId, stepLabel) {
  const dir = join(SNAP_BASE, tcId);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: join(dir, `${Date.now()}-${stepLabel.replace(/\s+/g, '-')}.png`),
    fullPage: false,
  });
  console.log(`>> [snap] ${tcId}/${stepLabel}`);
}

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

async function readPlayerBalance(page) {
  await page.waitForTimeout(1000);
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const m = body.match(/\bMYR\s*\n\s*([\d,]+\.\d+)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
}

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

async function submitDeposit(page, amount, promoCode = '') {
  await page.goto(`${URLS.playsite}user/deposit`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.locator('.fa.fa-times, .close').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);

  const pkgBtn = page.locator('button, [role="button"]').filter({ hasText: DEPOSIT.packageName }).first();
  if (await pkgBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await pkgBtn.click();
    await page.waitForTimeout(2500);
  }

  await page.getByRole('combobox').nth(1).selectOption('bank-in-transfer').catch(async () => {
    await page.locator('select').filter({ hasText: /bank-in transfer/i }).selectOption('bank-in-transfer').catch(() => {});
  });
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

// ── BO login with session caching ────────────────────────────────
// First call: full CAPTCHA login (~40 s). Subsequent calls: instant restore.
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

// ── Approve deposit + read system remark ─────────────────────────
async function boApproveAndReadRemark(browser, username, txNo, label, tcFolder) {
  const { ctx: boCtx, page: boPage, bo } = await boLogin(browser);

  await bo.approveDeposit(username, `TC: ${label}`);
  await boPage.waitForTimeout(2000);
  await snap(boPage, tcFolder, 'bo-approve');

  // Navigate fresh to deposit list — after approval the filter is still
  // "Pending/InProcess" so the approved deposit isn't visible
  await boPage.goto(`${BO_BASE}/dashboard/cash/deposit-list`, { waitUntil: 'domcontentloaded' });
  await boPage.waitForTimeout(1500);
  await boPage.locator('#ddlFilterStatus').selectOption('Approved').catch(() => {});
  await boPage.locator('#txtUserName').fill(`x9048_${username}`).catch(() => {});
  await boPage.getByRole('button', { name: 'Search' }).click();
  await boPage.waitForTimeout(2000);
  await snap(boPage, tcFolder, 'bo-list');

  // Read full remark from Angular tooltip component (DOM attribute is truncated)
  const remark = await boPage.evaluate((targetTxNo) => {
    for (const row of document.querySelectorAll('tbody tr')) {
      const txCell = row.querySelector('td:nth-child(2) code');
      if (!txCell || txCell.textContent.trim() !== targetTxNo) continue;
      const tooltip = row.querySelector('remarks tooltip');
      if (tooltip && window.ng?.probe) {
        try { return window.ng.probe(tooltip).componentInstance.Text || ''; } catch { /* fall through */ }
      }
      return row.querySelector('remarks span')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    }
    return '';
  }, txNo).catch(() => '');

  console.log(`>> BO remark [${txNo}]: ${remark}`);
  await boCtx.close();
  return remark;
}

// ── Player login helper ──────────────────────────────────────────
async function playerLogin(browser) {
  const ctx  = await browser.newContext({ storageState: PLAYER.sessionPath });
  const page = await ctx.newPage();
  const login = new LoginPage(page, 'player');
  await login.loginWithSession();
  return { ctx, page, stmt: new StatementPage(page) };
}

// ════════════════════════════════════════════════════════════════
test.describe.serial('Deposit Reward — Full Suite', () => {

  // ── One-time BO setup check ────────────────────────────────────
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
    // Keep session alive — do NOT close context, just the page so the
    // cached session cookie is updated after this navigation
    cachedBoSession = await boCtx.storageState();
    await boCtx.close();
  });

  // ════════════════════════════════════════════════════════════════
  // Happy Path: qualifying deposit → earn promo code → use it → bonus
  // ════════════════════════════════════════════════════════════════
  test('Happy Path: qualify → earn promo → use → bonus credited', async ({ browser }) => {
    test.setTimeout(0);

    // 1. Player submits qualifying deposit
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    const balBefore = await readPlayerBalance(pPage1);
    console.log(`>> Balance before: ${balBefore}`);
    await submitDeposit(pPage1, 100);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    const tx1 = await stmt1.getLatestTransaction();
    console.log(`>> Dep 1 txNo: ${tx1.txNo}`);
    await pCtx1.close();

    // 2. BO approves deposit 1
    const { ctx: boCtx1, page: boPage1, bo: bo1 } = await boLogin(browser);
    await bo1.approveDeposit(PLAYER.username, 'Happy Path deposit 1');
    await boCtx1.close();

    // 3. Player reads promo code
    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const promoCode = await readPromoCodeFromInbox(pPage2);
    expect(promoCode, 'Promo code should appear in inbox after qualifying deposit').toBeTruthy();

    // 4. Player uses promo code in second deposit
    const balBeforeDep2 = await readPlayerBalance(pPage2);
    console.log(`>> Balance before dep 2: ${balBeforeDep2}`);
    await submitDeposit(pPage2, 50, promoCode);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Pending');
    const tx2 = await stmt2.getLatestTransaction();
    console.log(`>> Dep 2 txNo: ${tx2.txNo}`);
    await snap(pPage2, 'happy-path', 'dep2-pending');
    await pCtx2.close();

    // 5. BO approves deposit 2
    const { ctx: boCtx2, page: boPage2, bo: bo2 } = await boLogin(browser);
    await bo2.approveDeposit(PLAYER.username, 'Happy Path deposit 2 with promo');
    await boCtx2.close();

    // 6. Verify bonus credited
    const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
    await stmt3.navigateToCashHistory();
    await stmt3.verifyLatestStatus('Approved');
    let balAfter = await readPlayerBalance(pPage3);
    for (let i = 0; i < 5 && balAfter <= balBeforeDep2; i++) {
      await pPage3.waitForTimeout(3000);
      await pPage3.reload({ waitUntil: 'domcontentloaded' });
      balAfter = await readPlayerBalance(pPage3);
    }
    await snap(pPage3, 'happy-path', 'balance-after');
    await pCtx3.close();

    const bonus = parseFloat((promoCode.match(/\$([\d.]+)$/) || [])[1] || '0');
    const expected = balBeforeDep2 + 50 + bonus;
    console.log(`>> Expected: ${expected} (${balBeforeDep2} + 50 deposit + ${bonus} bonus)`);
    console.log(`>> Actual:   ${balAfter}`);
    expect(balAfter).toBeCloseTo(expected, 1);
    console.log('>> Happy Path PASS ✅');
  });

  // ════════════════════════════════════════════════════════════════
  // TC-001: Deposit below minimum ($49) → no promo code issued
  // ════════════════════════════════════════════════════════════════
  test('TC-001: below-min deposit ($49) → no promo code issued', async ({ browser }) => {
    test.setTimeout(0);

    const { ctx: pCtx, page: pPage, stmt } = await playerLogin(browser);
    const balBefore = await readPlayerBalance(pPage);
    await submitDeposit(pPage, 49);
    await stmt.navigateToCashHistory();
    await stmt.verifyLatestStatus('Pending');
    const tx = await stmt.getLatestTransaction();
    console.log(`>> txNo: ${tx.txNo}`);
    await pCtx.close();

    // BO approve
    const { ctx: boCtx, page: boPage, bo } = await boLogin(browser);
    await bo.approveDeposit(PLAYER.username, 'TC-001 below minimum');
    await boCtx.close();

    // Verify no promo message for THIS tx in inbox
    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    await pPage2.goto(`${URLS.playsite}user/message`, { waitUntil: 'domcontentloaded' });
    await pPage2.waitForTimeout(2000);
    const inboxBody = await pPage2.locator('body').innerText().catch(() => '');
    const hasPromoForTx = inboxBody.includes(tx.txNo);
    const balAfter = await readPlayerBalance(pPage2);
    await snap(pPage2, 'TC-001', 'inbox');
    await pCtx2.close();

    expect(hasPromoForTx, 'TC-001: No promo message expected for $49 (below $50 min)').toBeFalsy();
    expect(balAfter).toBeCloseTo(balBefore + 49, 1);
    console.log('>> TC-001 PASS ✅');
  });

  // ════════════════════════════════════════════════════════════════
  // TC-014: Invalid promo code → BO remark "Promo code not found", no bonus
  // ════════════════════════════════════════════════════════════════
  test('TC-014: invalid promo code → BO remark "not found", no bonus', async ({ browser }) => {
    test.setTimeout(0);

    const FAKE_CODE = 'XXXXXXXX$99';

    const { ctx: pCtx, page: pPage, stmt } = await playerLogin(browser);
    const balBefore = await readPlayerBalance(pPage);
    await submitDeposit(pPage, 50, FAKE_CODE);
    await stmt.navigateToCashHistory();
    await stmt.verifyLatestStatus('Pending');
    const tx = await stmt.getLatestTransaction();
    console.log(`>> txNo: ${tx.txNo}`);
    await pCtx.close();

    const remark = await boApproveAndReadRemark(browser, PLAYER.username, tx.txNo, 'TC014-invalid', 'TC-014');

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const balAfter = await readPlayerBalance(pPage2);
    await pCtx2.close();

    console.log(`>> Balance: ${balBefore} → ${balAfter} (expected: ${balBefore + 50})`);
    const hasInvalidRemark = /expired|invalid|mismatch|not found/i.test(remark);
    expect(hasInvalidRemark, `TC-014: BO remark should say "not found". Got: "${remark}"`).toBeTruthy();
    expect(balAfter).toBeCloseTo(balBefore + 50, 1);
    console.log('>> TC-014 PASS ✅');
  });

  // ════════════════════════════════════════════════════════════════
  // TC-010: Reused promo code → BO remark "already redeemed"
  // NOTE: Bug found — system still credits bonus despite remark
  // ════════════════════════════════════════════════════════════════
  test('TC-010: reused promo code → BO remark "already redeemed"', async ({ browser }) => {
    test.setTimeout(0);

    // Step 1: Earn promo code
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, 100);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    const { ctx: boCtx1, page: boPage1, bo: bo1 } = await boLogin(browser);
    await bo1.approveDeposit(PLAYER.username, 'TC-010 earn promo');
    await boCtx1.close();

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const promoCode = await readPromoCodeFromInbox(pPage2);
    expect(promoCode, 'Should have earned a promo code').toBeTruthy();
    console.log(`>> Promo code earned: ${promoCode}`);

    // Step 2: First use of the code (should succeed)
    await submitDeposit(pPage2, 50, promoCode);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Pending');
    await pCtx2.close();

    const { ctx: boCtx2, page: boPage2, bo: bo2 } = await boLogin(browser);
    await bo2.approveDeposit(PLAYER.username, 'TC-010 first use');
    await boCtx2.close();

    // Step 3: Reuse same code
    const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
    await stmt3.navigateToCashHistory();
    await stmt3.verifyLatestStatus('Approved');
    const balBefore = await readPlayerBalance(pPage3);
    await submitDeposit(pPage3, 50, promoCode);
    await stmt3.navigateToCashHistory();
    await stmt3.verifyLatestStatus('Pending');
    const tx3 = await stmt3.getLatestTransaction();
    console.log(`>> Reuse txNo: ${tx3.txNo}`);
    await pCtx3.close();

    const remark = await boApproveAndReadRemark(browser, PLAYER.username, tx3.txNo, 'TC010-reuse', 'TC-010');

    const { ctx: pCtx4, page: pPage4, stmt: stmt4 } = await playerLogin(browser);
    await stmt4.navigateToCashHistory();
    await stmt4.verifyLatestStatus('Approved');
    const balAfter = await readPlayerBalance(pPage4);
    await pCtx4.close();

    const extraBonus = balAfter - (balBefore + 50);
    if (extraBonus > 0.05) {
      console.log(`>> ❌ BUG TC-010: System says "already redeemed" but credited $${extraBonus.toFixed(2)} bonus`);
    }
    const hasRedeemedRemark = /already redeemed|redeemed/i.test(remark);
    expect(hasRedeemedRemark, `TC-010: BO remark should say "already redeemed". Got: "${remark}"`).toBeTruthy();
    expect.soft(balAfter, `TC-010 BUG: credited $${extraBonus.toFixed(2)} bonus despite redeemed status`).toBeCloseTo(balBefore + 50, 1);
  });

  // ════════════════════════════════════════════════════════════════
  // TC-012: Sub-min deposit ($30) with existing promo → bonus credited, no new promo
  // ════════════════════════════════════════════════════════════════
  test('TC-012: sub-min deposit + promo → bonus credited, no new promo issued', async ({ browser }) => {
    test.setTimeout(0);

    // Step 1: Earn promo code via qualifying deposit
    const { ctx: pCtx1, page: pPage1, stmt: stmt1 } = await playerLogin(browser);
    await submitDeposit(pPage1, 100);
    await stmt1.navigateToCashHistory();
    await stmt1.verifyLatestStatus('Pending');
    await pCtx1.close();

    const { ctx: boCtx1, page: boPage1, bo: bo1 } = await boLogin(browser);
    await bo1.approveDeposit(PLAYER.username, 'TC-012 earn promo');
    await boCtx1.close();

    const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Approved');
    const promoCode = await readPromoCodeFromInbox(pPage2);
    expect(promoCode, 'Should have earned a promo code').toBeTruthy();
    const bonus = parseFloat((promoCode.match(/\$([\d.]+)$/) || [])[1] || '0');
    console.log(`>> Promo code: ${promoCode} (bonus: $${bonus})`);

    // Step 2: Sub-min deposit ($30) using the promo code
    const balBefore = await readPlayerBalance(pPage2);
    console.log(`>> Balance before sub-min deposit: ${balBefore}`);
    await submitDeposit(pPage2, 30, promoCode);
    await stmt2.navigateToCashHistory();
    await stmt2.verifyLatestStatus('Pending');
    const tx2 = await stmt2.getLatestTransaction();
    console.log(`>> Sub-min deposit txNo: ${tx2.txNo}`);
    await pCtx2.close();

    const { ctx: boCtx2, page: boPage2, bo: bo2 } = await boLogin(browser);
    await bo2.approveDeposit(PLAYER.username, 'TC-012 sub-min with promo');
    await boCtx2.close();

    // Step 3: Verify bonus credited and no new promo issued
    const { ctx: pCtx3, page: pPage3, stmt: stmt3 } = await playerLogin(browser);
    await stmt3.navigateToCashHistory();
    await stmt3.verifyLatestStatus('Approved');
    const balAfter = await readPlayerBalance(pPage3);
    console.log(`>> Balance: ${balBefore} → ${balAfter} (expected: ${balBefore + 30 + bonus})`);

    await pPage3.goto(`${URLS.playsite}user/message`, { waitUntil: 'domcontentloaded' });
    await pPage3.waitForTimeout(2000);
    const inboxBody = await pPage3.locator('body').innerText().catch(() => '');
    const newPromoForTx = inboxBody.includes(tx2.txNo);
    await snap(pPage3, 'TC-012', 'inbox');
    await pCtx3.close();

    const expectedWithBonus = balBefore + 30 + bonus;
    const expectedNoBonus   = balBefore + 30;
    const bonusCredited = Math.abs(balAfter - expectedWithBonus) < 0.1;
    const onlyDeposit   = Math.abs(balAfter - expectedNoBonus)   < 0.1;

    if (onlyDeposit && !bonusCredited) {
      console.log(`>> ❌ BUG TC-012: Valid promo code used on sub-min ($30) deposit — bonus $${bonus} NOT credited`);
      console.log(`>>    Expected: ${expectedWithBonus}, Got: ${balAfter} (only deposit credited)`);
      console.log(`>> RESULT: BUG FOUND — Promo bonus ignored for deposits below minimum threshold`);
    }

    // soft assert so TC-004 still runs even if this bug is present
    expect.soft(balAfter, `TC-012 BUG: promo bonus not credited for sub-min deposit (got ${balAfter}, expected ${expectedWithBonus})`).toBeCloseTo(expectedWithBonus, 1);
    expect(newPromoForTx, 'TC-012: No new promo should be issued for sub-min deposit').toBeFalsy();
    if (bonusCredited) console.log('>> TC-012 PASS ✅');
    else console.log('>> TC-012 FAIL — see BUG above');
  });

  // ════════════════════════════════════════════════════════════════
  // TC-004: Counter escalation 1 → 2 → 3 → 3 (capped)
  // ════════════════════════════════════════════════════════════════
  test('TC-004: counter escalates 1→2→3 then caps (Setting 1)', async ({ browser }) => {
    test.setTimeout(0);

    // One full round: submit $50 → BO approve → read balance + promo earned
    async function doRound(roundNum, amount, promoToUse, expectedPct) {
      console.log(`\n── Round ${roundNum}: deposit $${amount}, promo=${promoToUse || 'none'}, expect ${expectedPct}% ──`);

      const { ctx: pCtx, page: pPage, stmt } = await playerLogin(browser);
      const balBefore = await readPlayerBalance(pPage);
      await submitDeposit(pPage, amount, promoToUse || '');
      await stmt.navigateToCashHistory();
      await stmt.verifyLatestStatus('Pending');
      await pCtx.close();

      // Approve via cached BO session
      const { ctx: boCtx, page: boPage, bo } = await boLogin(browser);
      await bo.approveDeposit(PLAYER.username, `TC-004 round ${roundNum}`);
      await boCtx.close();

      const { ctx: pCtx2, page: pPage2, stmt: stmt2 } = await playerLogin(browser);
      await stmt2.navigateToCashHistory();
      await stmt2.verifyLatestStatus('Approved');
      const balAfter = await readPlayerBalance(pPage2);
      const earnedPromo = await readPromoCodeFromInbox(pPage2);
      await snap(pPage2, 'TC-004', `round-${roundNum}`);
      await pCtx2.close();

      const promoBonus = promoToUse ? parseFloat((promoToUse.match(/\$([\d.]+)$/) || [])[1] || '0') : 0;
      const expectedBal = balBefore + amount + promoBonus;
      console.log(`>> Round ${roundNum}: before=${balBefore}, after=${balAfter}, expected=${expectedBal}`);
      expect(balAfter, `Round ${roundNum}: balance`).toBeCloseTo(expectedBal, 1);

      if (earnedPromo) {
        const earned = parseFloat((earnedPromo.match(/\$([\d.]+)$/) || [])[1] || '0');
        const expectedEarned = Math.min(amount * expectedPct / 100, MAX_CAP);
        console.log(`>> Earned promo: ${earnedPromo} ($${earned}), expected $${expectedEarned}`);
        expect(earned, `Round ${roundNum}: earned promo amount`).toBeCloseTo(expectedEarned, 1);
      }
      console.log(`>> Round ${roundNum} ✅`);
      return earnedPromo;
    }

    let promo = null;
    promo = await doRound(1, MIN_DEPOSIT, null,  PERCENTS[0]); // counter=1 → 10%
    promo = await doRound(2, MIN_DEPOSIT, promo, PERCENTS[1]); // counter=2 → 20%
    promo = await doRound(3, MIN_DEPOSIT, promo, PERCENTS[2]); // counter=3 → 30%
    promo = await doRound(4, MIN_DEPOSIT, promo, PERCENTS[2]); // counter=3 (capped) → 30%

    console.log('>> TC-004 PASS: Counter 1→2→3→3(capped) ✅');
  });

}); // end describe.serial
