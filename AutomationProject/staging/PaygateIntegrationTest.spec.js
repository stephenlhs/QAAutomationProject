import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CaptchaHelper } from '../helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { StatementPage } from './pages/StatementPage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { PLAYER, BACKOFFICE, DEPOSIT, URLS } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WEBTOOLS_BASE = process.env.WEBTOOLS_BASE || 'http://54.179.20.185';
const WEBTOOLS_USER = process.env.WEBTOOLS_USER || 'com';
const WEBTOOLS_PASS = process.env.WEBTOOLS_PASS || 'com@com';

// Case: 'approve' | 'reject' | 'pending-approve' | 'pending-reject'
const integrationCase = process.env.PAYGATE_INTEGRATION_CASE || 'approve';
const isPending       = integrationCase.startsWith('pending-');
const expectedOutcome = integrationCase.endsWith('approve') ? 'approved' : 'rejected';

const gatewayId      = process.env.PAYGATE_GATEWAY || 'vaderpayc2';
const methodOverride = process.env.PAYGATE_METHOD  || null;

const fixturesDir = join(__dirname, 'fixtures');
let CONFIG = null;
for (const f of readdirSync(fixturesDir).filter(f => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(fixturesDir, f), 'utf-8'));
  if (c.classIdentifier === gatewayId) { CONFIG = c; break; }
}
if (!CONFIG) { console.error(`No gateway config for "${gatewayId}"`); process.exit(1); }

const screenshots = [];
const MANIFEST_NAME = 'manifest-paygate-integration.json';
const RESUME_SIGNAL = join(process.cwd(), '.screenshots-tmp', 'paygate-resume-signal.json');

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

async function waitForResumeSignal() {
  try { unlinkSync(RESUME_SIGNAL); } catch {}
  const maxWaitMs = 30 * 60 * 1000;
  const pollMs    = 3000;
  const start     = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const sig = JSON.parse(readFileSync(RESUME_SIGNAL, 'utf-8'));
      if (sig.action === 'approved' || sig.action === 'rejected') {
        try { unlinkSync(RESUME_SIGNAL); } catch {}
        return sig.action;
      }
    } catch {}
    await new Promise(r => setTimeout(r, pollMs));
  }
  return null;
}

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test(`Paygate integration deposit [${integrationCase}] — ${CONFIG.gatewayName}`, async ({ browser }) => {
  test.setTimeout(0);

  // Pick the method to test (override or first enabled)
  const allMethods = Object.entries(CONFIG.deposit.methods).filter(([name, m]) => {
    if (methodOverride) return name === methodOverride;
    return m.enabled;
  });
  if (allMethods.length === 0) {
    console.log(`>> No enabled methods for "${CONFIG.gatewayName}" — PASS (nothing to test)`);
    console.log('>> RESULT: PASS');
    return;
  }
  const [methodName, method] = allMethods[0];
  const testCurrency = process.env.PAYGATE_TEST_CURRENCY || 'MYR';
  const depositAmount = parseInt(process.env.CUSTOM_DEPOSIT_AMOUNT) || method.limits?.[testCurrency]?.min || 50;

  console.log(`\n>> ===== Paygate Integration [${integrationCase.toUpperCase()}] =====`);
  console.log(`>> Gateway: ${CONFIG.gatewayName} | Method: ${methodName} | Currency: ${testCurrency} | Amount: ${depositAmount}`);

  let playerContext, playerPage, boContext, boPage;
  let tx = null;
  let resumeAction = null;
  let before = null;
  let after  = null;

  try {
    // ── PART 1: Player login ──
    playerContext = await browser.newContext();
    playerPage    = await playerContext.newPage();
    const loginPage      = new LoginPage(playerPage, 'player');
    const withdrawalPage = new WithdrawalPage(playerPage);
    const statementPage  = new StatementPage(playerPage);
    const captcha        = new CaptchaHelper(playerPage, 'player');

    await loginPage.loginAndSaveSession(PLAYER.username, PLAYER.password, captcha, PLAYER.sessionPath);

    // ── PART 2: Stats before ──
    await withdrawalPage.navigate();
    before = await withdrawalPage.getStats('before');
    await snap(playerPage, '01 - Stats Before');
    console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

    // ── PART 3: Navigate to deposit page ──
    await playerPage.goto(`${URLS.playsite}user/deposit`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await playerPage.waitForTimeout(1500);
    await playerPage.locator('.fa.fa-times').click().catch(() => {});

    // Select package
    const pkgBtn = playerPage.locator('button, [role="button"]').filter({ hasText: CONFIG.deposit.packageName }).first();
    if (await pkgBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pkgBtn.click();
    } else {
      const pkgSelect = playerPage.getByRole('combobox').first();
      await pkgSelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await pkgSelect.selectOption({ label: CONFIG.deposit.packageName });
    }
    await playerPage.waitForTimeout(2500);

    // Select payment method tab
    const tabValueMap = { 'crypto-payment': 'crypto' };
    const tabValue = tabValueMap[method.tab] || method.tab;
    const categorySelect = playerPage.locator('select').filter({
      has: playerPage.locator(`option[value="${tabValue}"]`)
    }).first();
    await categorySelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (!(await categorySelect.count())) {
      throw new Error(`Payment method tab "${tabValue}" not found on deposit page — check fixture tab value`);
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      await categorySelect.selectOption(tabValue);
      await playerPage.waitForTimeout(800);
      if (await categorySelect.inputValue() === tabValue) break;
      if (attempt === 1) {
        await categorySelect.evaluate((el, v) => {
          el.value = v;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, tabValue);
        await playerPage.waitForTimeout(800);
      }
    }

    // Find and click gateway card
    const nameParts    = CONFIG.gatewayName.split(' ');
    const nameSelector = nameParts.map(p => `[data-paygate-name*="${p}"]`).join('');
    const gatewayCard  = playerPage.locator(nameSelector).first();
    if (!await gatewayCard.count()) {
      throw new Error(`Gateway card "${CONFIG.gatewayName}" not found — may be disabled in BO`);
    }
    await gatewayCard.click({ force: true });
    await playerPage.waitForTimeout(1500);

    // Bank / wallet selection
    const banksByCur   = method.banks ? (Array.isArray(method.banks) ? method.banks : (method.banks[testCurrency] || [])) : [];
    const banksFromEnv = (process.env.PAYGATE_BANKS || '').split(',').map(s => s.trim()).filter(Boolean);
    const targetBank   = banksFromEnv[0] || banksByCur.find(b => b.enabled)?.name || null;

    const dropdownToggle = playerPage.locator('.dropdown-toggle').first();
    const bankTableRow   = playerPage.locator('.redeposit__bank-table tbody tr:not(:first-child)').first();
    if (await dropdownToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dropdownToggle.click({ force: true });
      await playerPage.waitForTimeout(500);
      let bankOption = targetBank
        ? playerPage.locator('.dropdown-option', { hasText: targetBank }).first()
        : playerPage.locator('.dropdown-option').first();
      if (targetBank && !await bankOption.count()) bankOption = playerPage.locator('.dropdown-option').first();
      if (await bankOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await bankOption.click({ force: true });
        console.log(`>> Bank: ${(await bankOption.innerText().catch(() => '')).trim()}`);
        await playerPage.waitForTimeout(800);
      }
    } else if (await bankTableRow.count()) {
      await bankTableRow.click({ force: true });
      await playerPage.waitForTimeout(800);
    }

    // Next step button
    const nextBtn = playerPage.locator('.redeposit__step3-selection .redeposit__button').first();
    if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await nextBtn.click({ force: true });
      await playerPage.waitForTimeout(1000);
    }

    // Fill amount
    const amountInput = playerPage.locator('#txtAmount[name="txtAmount"]');
    if (await amountInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await amountInput.fill(String(depositAmount), { timeout: 10000 });
      console.log(`>> Amount filled: ${depositAmount}`);
    }
    await snap(playerPage, '02 - Deposit Amount');

    // Confirm
    await playerPage.locator('.multi-lang[data-lang="DEPOSITWITHDRAW.Confirm"]').first().click({ force: true, timeout: 10000 }).catch(() => {});
    await playerPage.waitForTimeout(3000);

    // Confirmation modal (may not appear for QR — short timeout so QR code doesn't expire)
    const continueModal = playerPage.locator('.swal2-content', { hasText: 'Do you want to continue?' });
    if (await continueModal.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) {
      await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true });
      await playerPage.waitForTimeout(5000);
    }

    // Determine submission result
    const qrBody   = playerPage.locator('.redeposit__a9wallet-body');
    const errModal = playerPage.locator('.swal2-modal .swal2-content');
    let depositResult = 'success-redirect';
    if (await qrBody.isVisible().catch(() => false)) {
      depositResult = 'success-qr';
      await playerPage.locator('.redeposit__a9wallet-body .multi-lang[data-lang="GAMESPAGE.Close"]').click({ force: true }).catch(() => {});
    } else if (await errModal.isVisible().catch(() => false)) {
      throw new Error(`Deposit blocked: ${(await errModal.innerText()).trim()}`);
    }
    console.log(`>> Deposit submission: ${depositResult}`);

    // ── PART 4: Cash History — In Process ──
    await playerPage.goto(`${URLS.playsite}user/cash-history`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await playerPage.waitForTimeout(2000);
    await snap(playerPage, '03 - Cash History (In Process)');
    tx = await statementPage.getLatestTransaction();
    console.log(`>> Transaction: ${tx.txNo} | Status: ${tx.status} | Amount: ${tx.amount}`);

    await playerPage.close({ runBeforeUnload: false }).catch(() => {});
    await playerContext.close();
    playerContext = null;

    // ── PART 5: BO setup ──
    boContext  = await browser.newContext();
    boPage     = await boContext.newPage();
    const backoffice = new BackofficePage(boPage, 'backoffice');
    const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');
    await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
    await backoffice.closeExtraTabs();
    await backoffice.closeAnnouncements();

    const boUsername = `${URLS.memberPrefix || ''}${PLAYER.username.replace(/^x9048_/, '')}`;

    const outstanding = await backoffice.getMemberOutstandingBalance(PLAYER.username);
    console.log(`>> Outstanding (before decision) — Total: ${outstanding.total}`);

    const pad2 = (n) => String(n).padStart(2, '0');
    const fmtD = (d) => `${pad2(d.getMonth()+1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
    const extendDateRange = async () => {
      const now2 = new Date();
      const s2 = new Date(now2); s2.setDate(s2.getDate() - 1);
      const dateInputs = boPage.locator('.input-group:has(.fa-calendar) input');
      if (await dateInputs.count() >= 2) {
        await dateInputs.first().fill(`${fmtD(s2)} 00:00:00`);
        await dateInputs.nth(1).fill(`${fmtD(now2)} 23:59:59`);
        await boPage.locator('.ibox-title, h2, h3').first().click({ force: true }).catch(() => {});
        await boPage.waitForTimeout(500);
      }
    };

    const searchDepositListBO = async (status) => {
      await boPage.evaluate((targetText) => {
        const el = document.querySelector('#ddlFilterStatus');
        if (!el) return;
        const opt = Array.from(el.options).find(o => o.text.trim().includes(targetText));
        if (opt) { el.value = opt.value; if (window.$) window.$(el).trigger('change'); el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, status);
      await boPage.locator('#txtUserName').fill(boUsername);
      await boPage.getByText('Advanced Search').click().catch(() => {});
      await boPage.waitForTimeout(400);
      await boPage.locator('#txtTransactionId').fill(tx.txNo).catch(() => {});
      await boPage.getByRole('button', { name: 'Search' }).click();
      await boPage.waitForTimeout(2000);
      return (await boPage.locator(`.table-responsive tbody td:has-text("${tx.txNo}")`).count()) > 0;
    };

    // ── PART 6: Check BO deposit list for In Process status ──
    await boPage.goto(`${backoffice.boBase}/dashboard/cash/deposit-list`, { waitUntil: 'domcontentloaded' });
    await boPage.waitForTimeout(1500);
    const txFoundInProcess = await searchDepositListBO('In Progress');
    console.log(`>> BO deposit list (In Progress) — found: ${txFoundInProcess}`);
    await snap(boPage, '04 - BO Deposit List (In Process)');

    // ── PART 7: Wait for vendor callback OR poll for Pending status ──
    if (isPending) {
      // PENDING CASE: poll BO until status changes to "Pending" (up to 9 min)
      console.log(`>> [PENDING CASE] Waiting for transaction to reach Pending status (up to 9 min)...`);
      const maxPollMs  = 9 * 60 * 1000;
      const pollInterv = 30000;
      const pollStart  = Date.now();
      let isPendingStatus = false;

      while (Date.now() - pollStart < maxPollMs) {
        await boPage.goto(`${backoffice.boBase}/dashboard/cash/deposit-list`, { waitUntil: 'domcontentloaded' });
        await boPage.waitForTimeout(1500);
        const found = await searchDepositListBO('Pending');
        if (found) { isPendingStatus = true; break; }
        const elapsed = Math.round((Date.now() - pollStart) / 1000);
        console.log(`>> Polling for Pending... (${elapsed}s elapsed, checking every 30s)`);
        await boPage.waitForTimeout(pollInterv);
      }

      if (isPendingStatus) {
        console.log(`>> Transaction reached Pending status ✅`);
        await snap(boPage, '05 - BO Deposit List (Pending)');
      } else {
        console.log(`>> WARNING: Transaction did not reach Pending status within 9 minutes`);
      }

      // Signal to tester: transaction is now pending, please manually approve/reject
      const pendingOutcome = integrationCase.endsWith('approve') ? 'approve' : 'reject';
      console.log(`>> PAUSE:${JSON.stringify({ txNo: tx.txNo, amount: tx.amount, method: methodName, pendingAction: pendingOutcome })}`);
      console.log(`>> Transaction is now PENDING — Please manually ${pendingOutcome.toUpperCase()} in BO, then signal the dashboard`);
      resumeAction = await waitForResumeSignal();
    } else {
      // APPROVE / REJECT CASE: wait for vendor callback signal
      console.log(`>> PAUSE:${JSON.stringify({ txNo: tx.txNo, amount: tx.amount, method: methodName })}`);
      resumeAction = await waitForResumeSignal();
    }

    if (resumeAction) {
      console.log(`>> Resume signal: ${resumeAction}`);
    } else {
      console.log(`>> Resume timeout — skipping post-action checks`);
    }

    // ── PART 8: BO — Deposit list after callback/action ──
    let txFoundAfter = false;
    if (resumeAction) {
      await boPage.goto(`${backoffice.boBase}/dashboard/cash/deposit-list`, { waitUntil: 'domcontentloaded' });
      await boPage.waitForTimeout(1500);
      const expectedStatus = resumeAction === 'approved' ? 'Approved' : 'Rejected';
      txFoundAfter = await searchDepositListBO(expectedStatus);
      if (!txFoundAfter) {
        await extendDateRange();
        await boPage.waitForTimeout(1000);
        await boPage.getByRole('button', { name: 'Search' }).click();
        await boPage.waitForTimeout(2000);
        txFoundAfter = (await boPage.locator(`.table-responsive tbody td:has-text("${tx.txNo}")`).count()) > 0;
      }
      console.log(`>> BO deposit list (${expectedStatus}) — found: ${txFoundAfter}`);
      await boPage.evaluate(() => window.scrollBy(0, 300));
      await snap(boPage, `06 - BO Deposit List (${expectedStatus})`);

      // Open deposit detail modal
      if (txFoundAfter) {
        const txRow   = boPage.locator('.table-responsive tbody tr').filter({ hasText: tx.txNo }).first();
        const rowText = (await txRow.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        console.log(`>> BO deposit row: ${rowText.substring(0, 200)}`);
        const editBtn = txRow.locator('[title="Edit"]').first();
        if (await editBtn.count()) { await editBtn.click({ force: true }); }
        else { await boPage.getByTitle('Edit').first().click(); }
        await boPage.waitForTimeout(2000);
        const modal = boPage.locator('#ticket-detail');
        if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
          console.log(`>> Deposit detail modal: ${(await modal.innerText().catch(() => '')).replace(/\s+/g, ' ').substring(0, 200)}`);
          await snap(boPage, '07 - Deposit Detail Modal', modal);
          await modal.getByText('× Close').click({ force: true }).catch(() => {});
          await boPage.waitForTimeout(500);
        }
      }

      // ── PART 8b: BO PG Transactions + detail modal ──
      try {
        const pgStatusVal = resumeAction === 'approved' ? '2' : '3';
        await boPage.goto(`${backoffice.boBase}/dashboard/payment-gateway/transactions`, { waitUntil: 'domcontentloaded' });
        await boPage.waitForTimeout(1500);
        await boPage.getByText('Advanced Search').click().catch(() => {});
        await boPage.waitForTimeout(400);
        await boPage.locator('[name="filterTransNo"]').fill(tx.txNo).catch(() => {});
        await boPage.locator('#ddlTicketStatus').selectOption(pgStatusVal).catch(() => {});
        await boPage.getByRole('button', { name: 'Search' }).click();
        await boPage.waitForTimeout(2000);
        const pgRow = boPage.locator('.table-responsive tbody tr').filter({ hasText: tx.txNo }).first();
        console.log(`>> PG Transactions row: ${(await pgRow.innerText().catch(() => '')).replace(/\s+/g, ' ').substring(0, 200)}`);
        await snap(boPage, '08 - PG Transactions');
        const pgDetailBtn = pgRow.locator('[title="View Details"], [title="Details"], [title="View"], .fa-eye, .fa-search').first();
        if (await pgDetailBtn.count()) {
          await pgDetailBtn.click({ force: true });
          await boPage.waitForTimeout(1500);
          const pgModal = boPage.locator('.modal.in, .modal.show').first();
          if (await pgModal.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log(`>> PG detail: ${(await pgModal.innerText().catch(() => '')).replace(/\s+/g, ' ').substring(0, 200)}`);
            await snap(boPage, '09 - PG Transactions Modal', pgModal);
            await pgModal.locator('[data-dismiss="modal"], button:has-text("Close"), .close').first().click({ force: true }).catch(() => {});
            await boPage.waitForTimeout(500);
          }
        }
      } catch (err) {
        console.log(`>> PG Transactions error: ${err.message.split('\n')[0]}`);
      }

      // ── PART 8c: Cash Flow Report (approve only) ──
      if (resumeAction === 'approved') {
        try {
          await boPage.goto(`${backoffice.boBase}/dashboard/cash-flow/report`, { waitUntil: 'domcontentloaded' });
          await boPage.waitForTimeout(1500);
          await boPage.getByRole('button', { name: 'Search' }).click();
          await boPage.waitForTimeout(2000);
          const cfText = await boPage.evaluate(() => document.body.innerText);
          const cfRow  = cfText.split('\n').find(l => l.includes(boUsername));
          console.log(`>> Cash Flow: ${cfRow?.replace(/\t/g, ' | ') || `${boUsername} not found`}`);
          await snap(boPage, '10 - Cash Flow Report');
        } catch (err) {
          console.log(`>> Cash Flow error: ${err.message.split('\n')[0]}`);
        }
      }

      // ── PART 8d: Member Cash History (approve only) ──
      if (resumeAction === 'approved') {
        try {
          await boPage.goto(`${backoffice.boBase}/dashboard/member/member-cash-history`, { waitUntil: 'domcontentloaded' });
          await boPage.waitForTimeout(1500);
          await boPage.locator('#txtUserName').fill(boUsername);
          await boPage.getByRole('button', { name: 'Search' }).click();
          await boPage.waitForTimeout(2000);
          const chRow = boPage.locator('.table-responsive tbody tr').filter({ hasText: tx.txNo }).first();
          console.log(`>> Member Cash History: ${(await chRow.innerText().catch(() => '')).replace(/\s+/g, ' ').substring(0, 200)}`);
          await snap(boPage, '11 - Member Cash History');
        } catch (err) {
          console.log(`>> Member Cash History error: ${err.message.split('\n')[0]}`);
        }
      }

      // ── PART 8e: Member Account (approve only) ──
      if (resumeAction === 'approved') {
        try {
          await boPage.goto(
            `${backoffice.boBase}/dashboard/cash/cash-member/member-account?username=${boUsername}&expandacc=false`,
            { waitUntil: 'domcontentloaded' }
          );
          await boPage.waitForTimeout(2000);
          await snap(boPage, '12 - Member Account');
          const bodyText = await boPage.locator('body').innerText().catch(() => '');
          const lines = bodyText.split('\n').filter(l => l.trim());
          console.log(`>> Member Account Total Deposit: ${lines.find(l => l.includes('Total Deposit'))?.trim()}`);
          console.log(`>> Member Account Last Deposit:  ${lines.find(l => l.includes('Last Deposit Date'))?.trim()}`);
        } catch (err) {
          console.log(`>> Member Account error: ${err.message.split('\n')[0]}`);
        }
      }

      // ── PART 8f: Member Statement + click transaction detail (approve only) ──
      if (resumeAction === 'approved') {
        try {
          await boPage.goto(`${backoffice.boBase}/dashboard/reports/statement`, { waitUntil: 'domcontentloaded' });
          await boPage.waitForTimeout(1500);
          await boPage.locator('[name="memberName"]').fill(boUsername);
          await boPage.getByRole('button', { name: 'Search' }).click();
          await boPage.waitForTimeout(2000);
          console.log(`>> Member Statement: ${(await boPage.locator('table').innerText().catch(() => '')).replace(/\n/g, ' | ').substring(0, 300)}`);
          await snap(boPage, '13 - Member Statement');
          const stmtRow = (await boPage.locator('table tbody tr').filter({ hasText: tx.txNo }).count())
            ? boPage.locator('table tbody tr').filter({ hasText: tx.txNo }).first()
            : boPage.locator('table tbody tr').filter({ hasText: tx.amount }).first();
          if (await stmtRow.count()) {
            const detailIcon = stmtRow.locator('[title="Detail"], [title="View"], .fa-search, .fa-eye').first();
            if (await detailIcon.count()) { await detailIcon.click({ force: true }); }
            else { await stmtRow.click({ force: true }).catch(() => {}); }
            await boPage.waitForTimeout(1500);
            const stmtModal = boPage.locator('.modal.in, .modal.show').first();
            if (await stmtModal.isVisible({ timeout: 3000 }).catch(() => false)) {
              console.log(`>> Statement detail: ${(await stmtModal.innerText().catch(() => '')).replace(/\s+/g, ' ').substring(0, 200)}`);
              await snap(boPage, '14 - Statement Detail', stmtModal);
              await stmtModal.locator('[data-dismiss="modal"], button:has-text("Close"), .close').first().click({ force: true }).catch(() => {});
              await boPage.waitForTimeout(500);
            }
          }
        } catch (err) {
          console.log(`>> Member Statement error: ${err.message.split('\n')[0]}`);
        }
      }
    }

    await boPage.close({ runBeforeUnload: false }).catch(() => {});
    await boContext.close();
    boContext = null;

    // ── PART 9: Webtools — Wallet Log + Tally ──
    if (resumeAction) {
      const wtContext = await browser.newContext();
      const wtPage    = await wtContext.newPage();
      try {
        await wtPage.goto(`${WEBTOOLS_BASE}/account/login`, { waitUntil: 'domcontentloaded' });
        await wtPage.waitForTimeout(1000);
        const wtInputs = wtPage.locator('input:not([type=hidden])');
        await wtInputs.first().fill(WEBTOOLS_USER);
        await wtInputs.nth(1).fill(WEBTOOLS_PASS);
        await wtPage.waitForTimeout(300);
        await wtPage.getByRole('button', { name: /sign in/i }).click();
        await wtPage.waitForLoadState('domcontentloaded');
        await wtPage.waitForTimeout(1500);

        if (wtPage.url().includes('/login')) {
          console.log('>> Webtools login failed — skipping webtools checks');
        } else {
          console.log('>> Webtools login ✅');
          const boUsername2  = `${URLS.memberPrefix || ''}${PLAYER.username.replace(/^x9048_/, '')}`;
          const txDate   = (tx.dateTime || '').split(' ')[0] || new Date().toISOString().split('T')[0];
          const dateFrom = `${txDate} 00:00:00`;
          const dateTo   = `${txDate} 23:59:59`;

          // Wallet Log
          try {
            await wtPage.goto(`${WEBTOOLS_BASE}/WalletLog`, { waitUntil: 'domcontentloaded' });
            await wtPage.waitForTimeout(1500);
            await wtPage.locator('#input-memberName').fill(boUsername2);
            await wtPage.locator('#fromDate').fill(dateFrom);
            await wtPage.locator('#toDate').fill(dateTo);
            await wtPage.locator('#btnSearch').click();
            await wtPage.waitForTimeout(2000);
            await snap(wtPage, '15 - Webtools Wallet Log');
            const wtRows = await wtPage.locator('table tbody tr').all();
            const wtEntries = [];
            for (const row of wtRows) {
              const rt = await row.innerText();
              if (rt.includes(tx.txNo)) wtEntries.push(rt.replace(/\n/g, ' | ').substring(0, 200));
            }
            console.log(`>> Webtools Wallet Log (${wtEntries.length} entries for txNo):`);
            wtEntries.forEach((e, i) => console.log(`>>   [${i+1}] ${e}`));
            if (resumeAction === 'approved') {
              console.log(`>> Has Deposit: ${wtEntries.some(e => e.includes('Deposit'))}, Has Bonus: ${wtEntries.some(e => e.includes('Bonus'))}`);
            }
          } catch (err) {
            console.log(`>> Webtools Wallet Log error: ${err.message.split('\n')[0]}`);
          }

          // Tally — Find Paygate Transactions
          try {
            await wtPage.goto(`${WEBTOOLS_BASE}/CashTransferTicket/FindByPaygate`, { waitUntil: 'domcontentloaded' });
            await wtPage.waitForTimeout(1500);
            await wtPage.getByRole('textbox').nth(1).fill(boUsername2);
            await wtPage.locator('select[name="paygateSelector"]').selectOption(CONFIG.classIdentifier).catch(() => {});
            await wtPage.locator('#fromDate').fill(dateFrom);
            await wtPage.locator('#toDate').fill(dateTo);
            await wtPage.locator('#btnSearch').click();
            await wtPage.waitForTimeout(2000);
            const swalText = await wtPage.locator('.swal2-container').innerText().catch(() => '');
            if (swalText) { await wtPage.locator('.swal2-confirm').click().catch(() => {}); await wtPage.waitForTimeout(500); }
            await snap(wtPage, '16 - Webtools Tally');
            const tallyRows = await wtPage.locator('table tbody tr').all();
            for (const row of tallyRows) {
              const rt = await row.innerText();
              if (rt.includes(tx.txNo)) { console.log(`>> Tally row: ${rt.replace(/\n/g, ' | ').substring(0, 300)}`); break; }
            }
            console.log(`>> Tally has txNo: ${(await wtPage.locator('table').innerText().catch(() => '')).includes(tx.txNo)}`);
          } catch (err) {
            console.log(`>> Webtools Tally error: ${err.message.split('\n')[0]}`);
          }
        }
      } finally {
        await wtPage.close({ runBeforeUnload: false }).catch(() => {});
        await wtContext.close();
      }
    }

    // ── PART 10: Playsite stats after ──
    if (resumeAction) {
      playerContext = await browser.newContext({ storageState: PLAYER.sessionPath });
      playerPage    = await playerContext.newPage();
      const statementPageAfter  = new StatementPage(playerPage);
      const withdrawalPageAfter = new WithdrawalPage(playerPage);

      await playerPage.goto(`${URLS.playsite}user/cash-history`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await playerPage.waitForTimeout(2000);
      const txAfter = await statementPageAfter.getLatestTransaction();
      await snap(playerPage, '17 - Cash History After');
      console.log(`>> Cash History after — status: ${txAfter.status}`);

      await withdrawalPageAfter.navigate();
      after = await withdrawalPageAfter.getStats('after');
      await snap(playerPage, '18 - Stats After');
      console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

      await playerPage.close({ runBeforeUnload: false }).catch(() => {});
      await playerContext.close();
      playerContext = null;
    }

    // ── PART 11: Balance / Rollover assertions ──
    if (resumeAction && after) {
      if (resumeAction === 'approved') {
        const txBonusAmount = parseFloat(tx.bonus) || 0;
        const totalCredit   = parseFloat(tx.amount) + txBonusAmount;
        const effectiveBal  = before.balance + outstanding.total;
        const rolloverInc   = totalCredit * DEPOSIT.rolloverMultiplier;

        const rolloverAlreadyMet = before.target > 0 && before.rollover >= before.target;
        let expectedRollover, expectedTarget;
        if (rolloverAlreadyMet) {
          expectedRollover = 0; expectedTarget = rolloverInc;
          console.log(`>> Rollover already met — RESET`);
        } else if (effectiveBal <= 20) {
          expectedRollover = 0; expectedTarget = rolloverInc;
          console.log(`>> Effective balance <= 20 — rollover RESETS`);
        } else {
          expectedRollover = before.rollover; expectedTarget = before.target + rolloverInc;
          console.log(`>> Effective balance > 20 — rollover STACKS`);
        }
        expect(after.balance).toBeCloseTo(before.balance + totalCredit, 1);
        expect(after.rollover).toBeCloseTo(expectedRollover, 1);
        expect(after.target).toBeCloseTo(expectedTarget, 1);
        console.log(`>> Balance: ${before.balance} + ${totalCredit} ≈ ${after.balance} ✅`);
        console.log(`>> Rollover: ${before.rollover} → ${after.rollover} ✅`);
        console.log(`>> Target:   ${before.target} → ${after.target} ✅`);
      } else {
        expect(after.balance).toBeCloseTo(before.balance, 1);
        console.log(`>> Balance unchanged (${resumeAction}) ✅`);
      }
    }

    if (txFoundAfter !== undefined) {
      expect(txFoundAfter, `txNo ${tx?.txNo} not found in BO deposit list after ${resumeAction}`).toBe(true);
    }

    console.log(`\n>> ===== Integration [${integrationCase.toUpperCase()}] RESULT: PASS ✅ =====`);
    console.log('>> RESULT: PASS');

  } catch (err) {
    console.log(`\n>> ===== Integration [${integrationCase.toUpperCase()}] RESULT: FAIL ❌ =====`);
    console.log(`>> Error: ${err.message.split('\n')[0]}`);
    if (playerContext) { await playerPage?.close({ runBeforeUnload: false }).catch(() => {}); await playerContext.close().catch(() => {}); }
    if (boContext)     { await boPage?.close({ runBeforeUnload: false }).catch(() => {}); await boContext.close().catch(() => {}); }
    console.log('>> RESULT: FAIL');
    throw err;
  }
});
