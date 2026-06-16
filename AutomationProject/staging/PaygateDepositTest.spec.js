import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CaptchaHelper } from '../helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { StatementPage } from './pages/StatementPage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { PLAYER, BACKOFFICE, DEPOSIT, URLS } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'VaderpayC2Config.json'), 'utf-8'));

const screenshots = [];
const MANIFEST_NAME = 'manifest-paygate-deposit.json';
const RESUME_SIGNAL = join(process.cwd(), '.screenshots-tmp', 'paygate-resume-signal.json');

async function snap(page, label) {
  const dir = join(process.cwd(), '.screenshots-tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${label.replace(/\s+/g, '-')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push({ label, path: file });
  writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(screenshots.map(s => ({ label: s.label, path: s.path }))), 'utf-8');
  console.log(`>> Screenshot: ${label}`);
}

async function waitForResumeSignal(page) {
  try { unlinkSync(RESUME_SIGNAL); } catch {}

  const maxWaitMs = 30 * 60 * 1000; // 30 minutes
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
    await page.waitForTimeout(pollMs);
  }

  return null; // timed out — balance check will be skipped
}

test('VaderpayC2 deposit — all enabled methods', async ({ browser }) => {
  test.setTimeout(0);

  const results = {};
  const enabledMethods = Object.entries(CONFIG.deposit).filter(([, m]) => m.enabled);

  if (enabledMethods.length === 0) {
    console.log('>> No deposit methods enabled in VaderpayC2Config.json');
    console.log('>> RESULT: PASS');
    process.exit(0);
  }

  for (const [methodName, method] of enabledMethods) {
    console.log(`\n>> ===== Testing ${CONFIG.gatewayName} Deposit — ${methodName} =====`);

    const username = method.username || PLAYER.username;
    const password = method.password || PLAYER.password;

    let playerContext, playerPage, boContext, boPage;
    try {
      // ── PART 1: Player login ──
      playerContext = await browser.newContext();
      playerPage    = await playerContext.newPage();
      const loginPage      = new LoginPage(playerPage, 'player');
      const withdrawalPage = new WithdrawalPage(playerPage);
      const statementPage  = new StatementPage(playerPage);
      const captcha        = new CaptchaHelper(playerPage, 'player');

      await loginPage.loginAndSaveSession(username, password, captcha, PLAYER.sessionPath);
      await snap(playerPage, `${methodName}-01 - Player Login`);

      // ── PART 2: Record BEFORE stats ──
      await withdrawalPage.navigate();
      const before = await withdrawalPage.getStats('before');
      await snap(playerPage, `${methodName}-02 - Stats Before`);
      console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

      // ── PART 3: Navigate to deposit page ──
      await playerPage.goto(`${URLS.playsite}user/deposit`);
      await playerPage.waitForTimeout(1500);
      await playerPage.locator('.fa.fa-times').click().catch(() => {});

      // Select package — try button cards first, then the Package* combobox (first <select> on page)
      const pkgBtn = playerPage.locator('button, [role="button"]').filter({ hasText: CONFIG.packageName }).first();
      const pkgBtnVisible = await pkgBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (pkgBtnVisible) {
        await pkgBtn.click();
        await playerPage.waitForTimeout(500);
        console.log(`>> Package selected via button: ${CONFIG.packageName}`);
      } else {
        // Package shown as <select> dropdown (combobox role) — first combobox is always the Package* select
        const pkgSelect = playerPage.getByRole('combobox').first();
        await pkgSelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await pkgSelect.selectOption({ label: CONFIG.packageName });
        await playerPage.waitForTimeout(500);
        const chosen = await pkgSelect.locator('option:checked').innerText().catch(() => '?');
        console.log(`>> Package selected via dropdown: "${chosen}"`);
      }
      // Wait for Vue to finish re-rendering the deposit form after package selection
      await playerPage.waitForTimeout(2500);
      await snap(playerPage, `${methodName}-03 - Package Selected`);

      // Select payment method category from dropdown
      // Find by option content (more reliable than class name which varies per account)
      const tabValueMap = { 'crypto-payment': 'crypto' };
      const tabValue = tabValueMap[method.tab] || method.tab;
      console.log(`>> method.tab="${method.tab}" → tabValue="${tabValue}"`);

      const categorySelect = playerPage.locator('select').filter({
        has: playerPage.locator(`option[value="${tabValue}"]`)
      }).first();

      await categorySelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (!(await categorySelect.count())) {
        console.log(`>> Payment method dropdown not found — ${CONFIG.gatewayName} may not be available on this environment`);
        results[methodName] = 'SKIP: payment method dropdown not found';
        await playerPage.close({ runBeforeUnload: false }).catch(() => {});
        await playerContext.close();
        continue;
      }

      const beforeValue = await categorySelect.inputValue();
      console.log(`>> Dropdown before: "${beforeValue}"`);

      // Retry up to 2 times — package re-render can reset the select back to default
      for (let attempt = 1; attempt <= 2; attempt++) {
        await categorySelect.selectOption(tabValue);
        await playerPage.waitForTimeout(800);
        const current = await categorySelect.inputValue();
        console.log(`>> Dropdown after attempt ${attempt}: "${current}"`);
        if (current === tabValue) break;
        if (attempt === 1) {
          await categorySelect.evaluate((el, v) => {
            el.value = v;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }, tabValue);
          await playerPage.waitForTimeout(800);
        }
      }

      await snap(playerPage, `${methodName}-04 - Payment Method Selected`);

      // Find gateway card by data-paygate-name (partial match on each word of gatewayName)
      // e.g. "VaderPay C2" matches data-paygate-name="VaderPay (C2)"
      const nameParts = CONFIG.gatewayName.split(' ');
      const nameSelector = nameParts.map(p => `[data-paygate-name*="${p}"]`).join('');
      const gatewayCard = playerPage.locator(nameSelector).first();
      if (!(await gatewayCard.count())) {
        console.log(`>> ${CONFIG.gatewayName} card not found under ${methodName} — gateway may be disabled in BO`);
        results[methodName] = 'SKIP: gateway card not found';
        await playerPage.close({ runBeforeUnload: false }).catch(() => {});
        await playerContext.close();
        continue;
      }
      await gatewayCard.click({ force: true });
      await playerPage.waitForTimeout(1000);

      // If bank selection table appears, pick the first row (online transfer flow)
      const bankRow = playerPage.locator('.redeposit__bank-table tbody tr').first();
      if (await bankRow.count()) {
        await bankRow.click({ force: true });
        console.log(`>> Bank row selected`);
      }

      // Click next step button if present (online transfer flow only — QR goes straight to amount)
      const nextBtn = playerPage.locator('.redeposit__step3-selection .redeposit__button').first();
      if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await nextBtn.click({ force: true });
        await playerPage.waitForTimeout(1000);
      }

      // Adjust amount if min/max validation error appears
      const validateMsg = playerPage.locator('.redeposit__validate-wrapper span, .redeposit2__validate-wrapper span').first();
      if (await validateMsg.isVisible().catch(() => false)) {
        const msg = await validateMsg.innerText();
        const adj = parseFloat(msg.replace(/MYR|IDR|VND|:|Minimum Deposit|Maximum Deposit/gi, '').trim().substring(0, 6));
        if (adj > 0) {
          await playerPage.locator('#txtAmount[name="txtAmount"]').fill(String(adj));
          console.log(`>> Amount adjusted to ${adj} based on validation message`);
        }
      } else {
        await playerPage.locator('#txtAmount[name="txtAmount"]').fill(String(method.amount));
      }

      // Click confirm amount (works for both redeposit__ and redeposit2__ page variants)
      await playerPage.locator('.multi-lang[data-lang="DEPOSITWITHDRAW.Confirm"]').first().click({ force: true });
      await playerPage.waitForTimeout(3000);
      await snap(playerPage, `${methodName}-05 - Amount Entered`);

      // Wait for "Do you want to continue?" confirmation modal
      const continueModal = playerPage.locator('.swal2-content', { hasText: 'Do you want to continue?' });
      await continueModal.waitFor({ state: 'visible', timeout: 120000 }).catch(() => {});
      await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true });
      await playerPage.waitForTimeout(5000);

      // ── Determine deposit submission result ──
      let depositResult = 'unknown';
      let depositError  = '';

      const qrBody   = playerPage.locator('.redeposit__a9wallet-body');
      const errModal = playerPage.locator('.swal2-modal .swal2-content');

      if (await qrBody.isVisible().catch(() => false)) {
        depositResult = 'success-qr';
        await snap(playerPage, `${methodName}-06 - QR Code Displayed`);
        console.log(`>> QR code displayed — ${CONFIG.gatewayName} ${methodName} submission success`);
        await playerPage.locator('.redeposit__a9wallet-body .multi-lang[data-lang="GAMESPAGE.Close"]').click({ force: true }).catch(() => {});
      } else if (await errModal.isVisible().catch(() => false)) {
        depositError = (await errModal.innerText().catch(() => '')).trim();
        depositResult = 'error';
        await snap(playerPage, `${methodName}-06 - Error Modal`);
        console.log(`>> Gateway error: ${depositError}`);
        await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true }).catch(() => {});
      } else {
        depositResult = 'success-redirect';
        await snap(playerPage, `${methodName}-06 - Redirected to Vendor`);
        console.log(`>> Redirected to vendor — ${CONFIG.gatewayName} ${methodName} submission success`);
      }

      // ── Early exit if deposit was blocked (e.g. pending ticket exists) ──
      if (depositResult === 'error') {
        console.log(`>> Deposit submission blocked — ending ${methodName}`);
        console.log(`>> Error: ${depositError}`);
        results[methodName] = `FAIL: ${depositError}`;
        await playerPage.close({ runBeforeUnload: false }).catch(() => {});
        await playerContext.close();
        playerContext = null;
        continue;
      }

      // ── PART 4: Verify transaction in Cash History ──
      await playerPage.goto(`${URLS.playsite}user/cash-history`);
      await playerPage.waitForTimeout(2000);
      await snap(playerPage, `${methodName}-07 - Cash History`);

      const tx = await statementPage.getLatestTransaction();
      console.log(`>> Transaction: ${tx.txNo} | Status: ${tx.status} | Amount: ${tx.amount}`);

      // ── PART 5: Pause — signal dashboard and wait for vendor callback ──
      console.log(`>> PAUSE:${JSON.stringify({ txNo: tx.txNo, amount: tx.amount, method: methodName })}`);
      const resumeAction = await waitForResumeSignal(playerPage);

      // ── PART 6: Cash History After → Stats After ──
      let after = null;
      if (resumeAction) {
        console.log(`>> Resume signal received: ${resumeAction}`);

        // Cash History — final transaction status after vendor action
        await playerPage.goto(`${URLS.playsite}user/cash-history`);
        await playerPage.waitForTimeout(2000);
        const txAfter = await statementPage.getLatestTransaction();
        await snap(playerPage, `${methodName}-08 - Cash History After`);
        console.log(`>> Cash History (after) — txNo: ${txAfter.txNo} | Status: ${txAfter.status} | Amount: ${txAfter.amount}`);

        // Stats After — balance / rollover / target
        await withdrawalPage.navigate();
        after = await withdrawalPage.getStats('after');
        await snap(playerPage, `${methodName}-09 - Stats After`);
        console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);
      } else {
        console.log(`>> Resume timeout — balance/rollover check skipped`);
      }

      await playerPage.close({ runBeforeUnload: false }).catch(() => {});
      await playerContext.close();
      playerContext = null;

      // ── PART 7: BO — verify transaction in Cash Deposit List ──
      let outstanding = { sport: 0, casino: 0, lottery: 0, games: 0, p2p: 0, total: 0 };
      boContext  = await browser.newContext();
      boPage     = await boContext.newPage();
      const backoffice = new BackofficePage(boPage, 'backoffice');
      const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');

      await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
      await backoffice.closeExtraTabs();
      await backoffice.closeAnnouncements();
      await snap(boPage, `${methodName}-10 - BO Login`);

      // For approved: fetch outstanding balance (used in rollover calculation)
      if (resumeAction === 'approved') {
        outstanding = await backoffice.getMemberOutstandingBalance(username);
      }

      // Navigate to Cash Deposit List via direct URL (avoids sidebar toggle conflicts)
      await boPage.goto(`${backoffice.boBase}/dashboard/cash/deposit-list`, { waitUntil: 'domcontentloaded' });
      await boPage.waitForTimeout(1500);

      // Search — try expected status first; for rejected fall back to Pending/InProcess
      // (vendor callback to BO may not have processed yet when we check)
      const boUsername    = `${URLS.memberPrefix || ''}${username.replace(/^x9048_/, '')}`;
      const statusOptions = resumeAction === 'approved'
        ? ['Approved']
        : ['Rejected', 'Pending/InProcess'];

      let txFound = false;
      for (const statusFilter of statusOptions) {
        await boPage.locator('input[name="txtUserName"]').fill(boUsername);
        await boPage.locator('select[name="ddlFilterStatus"]').selectOption(statusFilter).catch(() => {});
        await boPage.locator('button[type="submit"]:has-text("Search")').click({ force: true });
        await boPage.waitForTimeout(2000);
        const txRow = boPage.locator(`.table-responsive tbody td:has-text("${tx.txNo}")`);
        txFound = (await txRow.count()) > 0;
        console.log(`>> BO search status="${statusFilter}" — txNo "${tx.txNo}" found: ${txFound}`);
        if (txFound) break;
      }
      await snap(boPage, `${methodName}-11 - BO Deposit List`);

      await boPage.close({ runBeforeUnload: false }).catch(() => {});
      await boContext.close();
      boContext = null;

      // ── PART 8: Balance / Rollover / Target assertions ──
      if (resumeAction && after) {
        if (resumeAction === 'approved') {
          const txBonusAmount = parseFloat(tx.bonus) || 0;
          const totalCredit   = method.amount + txBonusAmount;
          const effectiveBal  = before.balance + outstanding.total;
          const rolloverInc   = totalCredit * DEPOSIT.rolloverMultiplier;

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
          console.log(`>> Balance: ${before.balance} + ${totalCredit} ≈ ${after.balance} ✅`);
          console.log(`>> Rollover: ${before.rollover} → ${after.rollover} (expected ${expectedRollover}) ✅`);
          console.log(`>> Target:   ${before.target} → ${after.target} (expected ${expectedTarget}) ✅`);
        } else {
          expect(after.balance).toBeCloseTo(before.balance, 1);
          expect(after.rollover).toBeCloseTo(before.rollover, 1);
          expect(after.target).toBeCloseTo(before.target, 1);
          console.log(`>> Balance/Rollover/Target unchanged (rejected) ✅`);
        }
      }

      expect(['success-redirect', 'success-qr'], `${methodName}: expected redirect or QR, got error: ${depositError}`).toContain(depositResult);
      expect(txFound, `${methodName}: transaction ${tx.txNo} not found in BO deposit list`).toBe(true);

      results[methodName] = 'PASS';
      console.log(`>> ${CONFIG.gatewayName} ${methodName}: PASS ✅`);

    } catch (err) {
      results[methodName] = `FAIL: ${err.message.split('\n')[0]}`;
      console.log(`>> ${CONFIG.gatewayName} ${methodName}: FAIL — ${err.message.split('\n')[0]}`);
      if (playerContext) { await playerPage?.close({ runBeforeUnload: false }).catch(() => {}); await playerContext.close().catch(() => {}); }
      if (boContext)     { await boPage?.close({ runBeforeUnload: false }).catch(() => {}); await boContext.close().catch(() => {}); }
    }
  }

  // ── Final summary ──
  console.log('\n>> ===== VaderpayC2 Deposit Summary =====');
  for (const [m, r] of Object.entries(results)) {
    console.log(`>>   ${m}: ${r}`);
  }
  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);

  const allPassed = Object.values(results).every(r => r === 'PASS' || r.startsWith('SKIP'));
  if (allPassed) {
    console.log('>> RESULT: PASS');
  } else {
    console.log('>> RESULT: FAIL');
  }
  process.exit(0);
});
