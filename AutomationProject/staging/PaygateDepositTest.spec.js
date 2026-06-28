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

// Load gateway config by classIdentifier (PAYGATE_GATEWAY env var, default: 'vaderpayc2')
const gatewayId      = process.env.PAYGATE_GATEWAY || 'vaderpayc2';
const methodOverride = process.env.PAYGATE_METHOD  || null;

const fixturesDir = join(__dirname, 'fixtures');
let CONFIG = null;
for (const f of readdirSync(fixturesDir).filter(f => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(fixturesDir, f), 'utf-8'));
  if (c.classIdentifier === gatewayId) { CONFIG = c; break; }
}
if (!CONFIG) {
  console.error(`No gateway config found for classIdentifier: "${gatewayId}"`);
  process.exit(1);
}

const screenshots = [];
const MANIFEST_NAME     = 'manifest-paygate-deposit.json';
const TXN_MANIFEST_NAME = 'manifest-paygate-deposit-txn.json';
const RESUME_SIGNAL     = join(process.cwd(), '.screenshots-tmp', 'paygate-resume-signal.json');

// Optional el: if provided, takes an element-level screenshot (independent of screen size)
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

// Page-independent signal polling — works while BO or player page is active
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

// Disable Playwright's built-in trace/video/screenshot — this test manages its own artifacts
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('Paygate deposit — all enabled methods', async ({ browser }) => {
  test.setTimeout(0);



  const results = {};
  const enabledMethods = Object.entries(CONFIG.deposit.methods).filter(([name, m]) => {
    if (methodOverride) return name === methodOverride;
    return m.enabled;
  });

  if (enabledMethods.length === 0) {
    console.log(`>> No deposit methods enabled for gateway "${CONFIG.gatewayName}"`);
    console.log('>> RESULT: PASS');
    process.exit(0);
  }

  for (const [methodName, method] of enabledMethods) {
    console.log(`\n>> ===== Testing ${CONFIG.gatewayName} Deposit — ${methodName} =====`);

    let playerContext, playerPage, boContext, boPage;
    try {
      // ── PART 1: Player login ──
      playerContext = await browser.newContext();
      playerPage    = await playerContext.newPage();
      const loginPage      = new LoginPage(playerPage, 'player');
      const withdrawalPage = new WithdrawalPage(playerPage);
      const statementPage  = new StatementPage(playerPage);
      const captcha        = new CaptchaHelper(playerPage, 'player');

      await loginPage.loginAndSaveSession(PLAYER.username, PLAYER.password, captcha, PLAYER.sessionPath);

      // ── PART 2: Record BEFORE stats ──
      await withdrawalPage.navigate();
      const before = await withdrawalPage.getStats('before');
      await snap(playerPage, `${methodName}-01 - Stats Before`);
      console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

      // ── PART 3: Navigate to deposit page ──
      await playerPage.goto(`${URLS.playsite}user/deposit`);
      await playerPage.waitForTimeout(1500);
      await playerPage.locator('.fa.fa-times').click().catch(() => {});

      // Select package — try button cards first, then the Package* combobox (first <select> on page)
      const pkgBtn = playerPage.locator('button, [role="button"]').filter({ hasText: CONFIG.deposit.packageName }).first();
      const pkgBtnVisible = await pkgBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (pkgBtnVisible) {
        await pkgBtn.click();
        await playerPage.waitForTimeout(500);
        console.log(`>> Package selected via button: ${CONFIG.deposit.packageName}`);
      } else {
        const pkgSelect = playerPage.getByRole('combobox').first();
        await pkgSelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await pkgSelect.selectOption({ label: CONFIG.deposit.packageName });
        await playerPage.waitForTimeout(500);
        const chosen = await pkgSelect.locator('option:checked').innerText().catch(() => '?');
        console.log(`>> Package selected via dropdown: "${chosen}"`);
      }
      await playerPage.waitForTimeout(2500);

      // Select payment method category
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

      // Find gateway card
      const nameParts = CONFIG.gatewayName.split(' ');
      const nameSelector = nameParts.map(p => `[data-paygate-name*="${p}"]`).join('');
      const gatewayCard = playerPage.locator(nameSelector).first();
      const gatewayCardCount = await gatewayCard.count();
      console.log(`>> Gateway card "${CONFIG.gatewayName}" count: ${gatewayCardCount} (selector: ${nameSelector})`);
      if (!gatewayCardCount) {
        console.log(`>> ${CONFIG.gatewayName} card not found under ${methodName} — gateway may be disabled in BO`);
        results[methodName] = 'SKIP: gateway card not found';
        await playerPage.close({ runBeforeUnload: false }).catch(() => {});
        await playerContext.close();
        continue;
      }
      console.log(`>> Clicking gateway card...`);
      await gatewayCard.click({ force: true });
      await playerPage.waitForTimeout(1500);
      console.log(`>> Gateway card clicked, current URL: ${playerPage.url()}`);

      // Bank / wallet selection — custom dropdown or table row
      // Priority: PAYGATE_BANKS env → method.banks[currency][first enabled] → first dropdown option
      const testCurrency  = process.env.PAYGATE_TEST_CURRENCY || 'MYR';
      const banksByCur    = method.banks
        ? (Array.isArray(method.banks) ? method.banks : (method.banks[testCurrency] || []))
        : [];
      const banksFromEnv  = (process.env.PAYGATE_BANKS || '').split(',').map(s => s.trim()).filter(Boolean);
      const targetBank    = banksFromEnv[0]
        || banksByCur.find(b => b.enabled)?.name
        || null;

      const dropdownToggle = playerPage.locator('.dropdown-toggle').first();
      const bankTableRow   = playerPage.locator('.redeposit__bank-table tbody tr:not(:first-child)').first();

      if (await dropdownToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
        await dropdownToggle.click({ force: true });
        await playerPage.waitForTimeout(500);
        let bankOption = targetBank
          ? playerPage.locator('.dropdown-option', { hasText: targetBank }).first()
          : playerPage.locator('.dropdown-option').first();
        if (targetBank && !await bankOption.count()) {
          console.log(`>> Target bank "${targetBank}" not in dropdown — using first available`);
          bankOption = playerPage.locator('.dropdown-option').first();
        }
        if (await bankOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          const bankName = (await bankOption.innerText().catch(() => '')).trim();
          await bankOption.click({ force: true });
          console.log(`>> Bank selected: ${bankName}`);
          await playerPage.waitForTimeout(800);
        }
      } else if (await bankTableRow.count()) {
        await bankTableRow.click({ force: true });
        console.log(`>> Bank row selected`);
        await playerPage.waitForTimeout(800);
      } else {
        console.log(`>> No bank selector found`);
      }

      // Next step button (some gateways have multi-step)
      const nextBtn = playerPage.locator('.redeposit__step3-selection .redeposit__button').first();
      const nextBtnVisible = await nextBtn.isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`>> Next button visible: ${nextBtnVisible}`);
      if (nextBtnVisible) {
        await nextBtn.click({ force: true });
        await playerPage.waitForTimeout(1000);
        console.log(`>> Next button clicked`);
      }

      // Fill amount — priority: CUSTOM_DEPOSIT_AMOUNT env → fixture limits[currency].min
      const depositAmount = parseInt(process.env.CUSTOM_DEPOSIT_AMOUNT) || method.limits?.[testCurrency]?.min || 50;
      console.log(`>> Looking for amount input... (depositAmount: ${depositAmount})`);
      const amountInput = playerPage.locator('#txtAmount[name="txtAmount"]');
      const amountInputVisible = await amountInput.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`>> Amount input visible: ${amountInputVisible}`);
      const validateMsg = playerPage.locator('.redeposit__validate-wrapper span, .redeposit2__validate-wrapper span').first();
      if (await validateMsg.isVisible().catch(() => false)) {
        const msg = await validateMsg.innerText();
        const adj = parseFloat(msg.replace(/MYR|IDR|VND|:|Minimum Deposit|Maximum Deposit/gi, '').trim().substring(0, 6));
        if (adj > 0) {
          await amountInput.fill(String(adj), { timeout: 10000 });
          console.log(`>> Amount adjusted to ${adj} based on validation message`);
        }
      } else if (amountInputVisible) {
        await amountInput.fill(String(depositAmount), { timeout: 10000 });
        console.log(`>> Amount filled: ${depositAmount}`);
      } else {
        console.log(`>> Amount input not found — taking screenshot for diagnosis`);
        await snap(playerPage, `${methodName}-DEBUG - No Amount Input`);
      }

      await snap(playerPage, `${methodName}-02 - Deposit Amount`);
      console.log(`>> Clicking Confirm...`);
      await playerPage.locator('.multi-lang[data-lang="DEPOSITWITHDRAW.Confirm"]').first().click({ force: true, timeout: 10000 }).catch(() => {
        console.log(`>> Confirm button not found, trying submit button...`);
      });
      await playerPage.waitForTimeout(3000);

      // Confirmation modal (may or may not appear depending on gateway/method)
      const continueModal = playerPage.locator('.swal2-content', { hasText: 'Do you want to continue?' });
      const modalVisible = await continueModal.waitFor({ state: 'visible', timeout: 120000 }).then(() => true).catch(() => false);
      if (modalVisible) {
        await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true });
        await playerPage.waitForTimeout(5000);
      }

      // ── Determine deposit submission result ──
      let depositResult = 'unknown';
      let depositError  = '';

      const qrBody   = playerPage.locator('.redeposit__a9wallet-body');
      const errModal = playerPage.locator('.swal2-modal .swal2-content');

      if (await qrBody.isVisible().catch(() => false)) {
        depositResult = 'success-qr';
        console.log(`>> QR code displayed — submission success`);
        await playerPage.locator('.redeposit__a9wallet-body .multi-lang[data-lang="GAMESPAGE.Close"]').click({ force: true }).catch(() => {});
      } else if (await errModal.isVisible().catch(() => false)) {
        depositError = (await errModal.innerText().catch(() => '')).trim();
        depositResult = 'error';
        console.log(`>> Gateway error: ${depositError}`);
        await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true }).catch(() => {});
      } else {
        depositResult = 'success-redirect';
        console.log(`>> Redirected to vendor — submission success`);
      }

      // Early exit if deposit blocked (e.g. pending ticket exists)
      if (depositResult === 'error') {
        console.log(`>> Deposit submission blocked — ending ${methodName}`);
        console.log(`>> Error: ${depositError}`);
        results[methodName] = `FAIL: ${depositError}`;
        await playerPage.close({ runBeforeUnload: false }).catch(() => {});
        await playerContext.close();
        playerContext = null;
        continue;
      }

      // ── PART 4: Cash History — In Process ──
      await playerPage.goto(`${URLS.playsite}user/cash-history`);
      await playerPage.waitForTimeout(2000);
      await snap(playerPage, `${methodName}-03 - Cash History`);

      const tx = await statementPage.getLatestTransaction();
      console.log(`>> Transaction: ${tx.txNo} | Status: ${tx.status} | Amount: ${tx.amount}`);

      // Close player — BO will run before the pause
      await playerPage.close({ runBeforeUnload: false }).catch(() => {});
      await playerContext.close();
      playerContext = null;

      // ── PART 5: BO — Login, check Member Account outstanding balance, view Deposit List ──
      let outstanding = { sport: 0, casino: 0, lottery: 0, games: 0, p2p: 0, total: 0 };
      boContext  = await browser.newContext();
      boPage     = await boContext.newPage();
      const backoffice = new BackofficePage(boPage, 'backoffice');
      const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');

      await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
      await backoffice.closeExtraTabs();
      await backoffice.closeAnnouncements();

      // Always check outstanding balance before approve/reject to capture current rollover state
      outstanding = await backoffice.getMemberOutstandingBalance(PLAYER.username);
      console.log(`>> Outstanding balance (before decision) — Total: ${outstanding.total}`);

      const boUsername = `${URLS.memberPrefix || ''}${PLAYER.username.replace(/^x9048_/, '')}`;

      const extendDateRange = async () => {
        const now2 = new Date();
        const pad2 = (n) => String(n).padStart(2, '0');
        const fmtD = (d) => `${pad2(d.getMonth()+1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
        const s2 = new Date(now2); s2.setDate(s2.getDate() - 1);
        const dateInputs = boPage.locator('.input-group:has(.fa-calendar) input');
        if (await dateInputs.count() >= 2) {
          await dateInputs.first().fill(`${fmtD(s2)} 00:00:00`);
          await dateInputs.nth(1).fill(`${fmtD(now2)} 23:59:59`);
          await boPage.locator('.ibox-title, h2, h3').first().click({ force: true }).catch(() => {});
          await boPage.waitForTimeout(500);
        }
      };

      const searchBO = async (status) => {
        await boPage.evaluate((targetText) => {
          const el = document.querySelector('#ddlFilterStatus');
          if (!el) return;
          const opt = Array.from(el.options).find(o => o.text.trim().includes(targetText));
          if (opt) { el.value = opt.value; if (window.$) window.$(el).trigger('change'); el.dispatchEvent(new Event('change', { bubbles: true })); }
        }, status);
        const label = await boPage.locator('#ddlFilterStatus').evaluate(el => el.options[el.selectedIndex]?.text || 'none');
        console.log(`>> Status filter set to: ${label}`);
        await boPage.locator('#txtUserName').fill(boUsername);
        await boPage.getByText('Advanced Search').click().catch(() => {});
        await boPage.waitForTimeout(400);
        await boPage.locator('#txtTransactionId').fill(tx.txNo).catch(() => {});
        await boPage.getByRole('button', { name: 'Search' }).click();
        await boPage.waitForTimeout(2000);
        return (await boPage.locator(`.table-responsive tbody td:has-text("${tx.txNo}")`).count()) > 0;
      };

      // ── PART 6: PAUSE — wait for tester to approve or reject via dashboard ──
      console.log(`>> PAUSE:${JSON.stringify({ txNo: tx.txNo, amount: tx.amount, method: methodName })}`);
      const resumeAction = await waitForResumeSignal();

      if (resumeAction) {
        console.log(`>> Resume signal received: ${resumeAction}`);
      } else {
        console.log(`>> Resume timeout — skipping post-action checks`);
      }

      // ── PART 7: BO — Search deposit list and open detail modal after approve/reject ──
      let txFoundAfter = false;
      if (resumeAction) {
        await boPage.goto(`${backoffice.boBase}/dashboard/cash/deposit-list`, { waitUntil: 'domcontentloaded' });
        await boPage.waitForTimeout(1500);

        const expectedStatus = resumeAction === 'approved' ? 'Approved' : 'Rejected';
        txFoundAfter = await searchBO(expectedStatus);
        if (!txFoundAfter) {
          await extendDateRange();
          await boPage.waitForLoadState('domcontentloaded').catch(() => {});
          await boPage.waitForTimeout(1000);
          await boPage.getByRole('button', { name: 'Search' }).click();
          await boPage.waitForTimeout(2000);
          txFoundAfter = (await boPage.locator(`.table-responsive tbody td:has-text("${tx.txNo}")`).count()) > 0;
        }
        console.log(`>> BO deposit list (${expectedStatus}) — txNo "${tx.txNo}" found: ${txFoundAfter}`);
        await boPage.evaluate(() => window.scrollBy(0, 300));
        await boPage.waitForTimeout(300);
        await snap(boPage, `${methodName}-04 - BO Deposit List`);

        if (txFoundAfter) {
          const txRow   = boPage.locator('.table-responsive tbody tr').filter({ hasText: tx.txNo }).first();
          const rowText = (await txRow.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
          console.log(`>> BO row data: ${rowText}`);

          const editBtn = txRow.locator('[title="Edit"]').first();
          if (await editBtn.count()) {
            await editBtn.click({ force: true });
          } else {
            await boPage.getByTitle('Edit').first().click();
          }
          await boPage.waitForTimeout(2000);

          const modal = boPage.locator('#ticket-detail');
          if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
            const modalText = (await modal.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
            console.log(`>> BO deposit detail: ${modalText}`);
            // Element-level screenshot of just the modal — screen-size independent
            await snap(boPage, `${methodName}-05 - BO Deposit Detail Modal`, modal);
            await modal.getByText('× Close').click({ force: true }).catch(() => {});
            await boPage.waitForTimeout(500);
          } else {
            console.log('>> WARNING: BO detail modal did not appear');
          }
        }

        // ── PART 7b: BO PG Transactions + detail modal ──
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
          const pgRowText = (await pgRow.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
          console.log(`>> PG Transactions row: ${pgRowText.substring(0, 200)}`);
          await snap(boPage, `${methodName}-08 - PG Transactions`);
          const pgDetailBtn = pgRow.locator('[title="View Details"], [title="Details"], [title="View"], .fa-eye, .fa-search').first();
          if (await pgDetailBtn.count()) {
            await pgDetailBtn.click({ force: true });
            await boPage.waitForTimeout(1500);
            const pgModal = boPage.locator('.modal.in, .modal.show').first();
            if (await pgModal.isVisible({ timeout: 3000 }).catch(() => false)) {
              console.log(`>> PG detail modal: ${(await pgModal.innerText().catch(() => '')).replace(/\s+/g, ' ').substring(0, 200)}`);
              await snap(boPage, `${methodName}-09 - PG Transactions Modal`, pgModal);
              await pgModal.locator('[data-dismiss="modal"], button:has-text("Close"), .close').first().click({ force: true }).catch(() => {});
              await boPage.waitForTimeout(500);
            }
          } else {
            console.log('>> PG detail button not found');
          }
        } catch (err) {
          console.log(`>> PG Transactions error: ${err.message.split('\n')[0]}`);
        }

        // ── PART 7c: BO Cash Flow Report (approve only) ──
        if (resumeAction === 'approved') {
          try {
            await boPage.goto(`${backoffice.boBase}/dashboard/cash-flow/report`, { waitUntil: 'domcontentloaded' });
            await boPage.waitForTimeout(1500);
            await boPage.getByRole('button', { name: 'Search' }).click();
            await boPage.waitForTimeout(2000);
            const cfText = await boPage.evaluate(() => document.body.innerText);
            const cfRow = cfText.split('\n').find(l => l.includes(boUsername));
            console.log(`>> Cash Flow: ${cfRow?.replace(/\t/g, ' | ') || `${boUsername} not found`}`);
            await snap(boPage, `${methodName}-10 - Cash Flow Report`);
          } catch (err) {
            console.log(`>> Cash Flow error: ${err.message.split('\n')[0]}`);
          }
        }

        // ── PART 7d: BO Member Cash History (approve only) ──
        if (resumeAction === 'approved') {
          try {
            await boPage.goto(`${backoffice.boBase}/dashboard/member/member-cash-history`, { waitUntil: 'domcontentloaded' });
            await boPage.waitForTimeout(1500);
            await boPage.locator('#txtUserName').fill(boUsername);
            await boPage.getByRole('button', { name: 'Search' }).click();
            await boPage.waitForTimeout(2000);
            const chRow = boPage.locator('.table-responsive tbody tr').filter({ hasText: tx.txNo }).first();
            console.log(`>> Member Cash History: ${(await chRow.innerText().catch(() => '')).replace(/\s+/g, ' ').substring(0, 200)}`);
            await snap(boPage, `${methodName}-11 - Member Cash History`);
          } catch (err) {
            console.log(`>> Member Cash History error: ${err.message.split('\n')[0]}`);
          }
        }

        // ── PART 7e: BO Member Account (approve only) ──
        if (resumeAction === 'approved') {
          try {
            await boPage.goto(
              `${backoffice.boBase}/dashboard/cash/cash-member/member-account?username=${boUsername}&expandacc=false`,
              { waitUntil: 'domcontentloaded' }
            );
            await boPage.waitForTimeout(2000);
            await snap(boPage, `${methodName}-12 - Member Account`);
            const bodyText = await boPage.locator('body').innerText().catch(() => '');
            const lines = bodyText.split('\n').filter(l => l.trim());
            console.log(`>> Member Account Total Deposit: ${lines.find(l => l.includes('Total Deposit'))?.trim()}`);
            console.log(`>> Member Account Last Deposit:  ${lines.find(l => l.includes('Last Deposit Date'))?.trim()}`);
          } catch (err) {
            console.log(`>> Member Account error: ${err.message.split('\n')[0]}`);
          }
        }

        // ── PART 7f: BO Member Statement + click transaction detail (approve only) ──
        if (resumeAction === 'approved') {
          try {
            await boPage.goto(`${backoffice.boBase}/dashboard/reports/statement`, { waitUntil: 'domcontentloaded' });
            await boPage.waitForTimeout(1500);
            await boPage.locator('[name="memberName"]').fill(boUsername);
            await boPage.getByRole('button', { name: 'Search' }).click();
            await boPage.waitForTimeout(2000);
            console.log(`>> Member Statement: ${(await boPage.locator('table').innerText().catch(() => '')).replace(/\n/g, ' | ').substring(0, 300)}`);
            await snap(boPage, `${methodName}-13 - Member Statement`);
            // Click transaction row for detail
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
                await snap(boPage, `${methodName}-14 - Statement Detail`, stmtModal);
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

      // ── PART 7g: Webtools — Wallet Log + Tally Checking ──
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
            const txDate   = (tx.dateTime || '').split(' ')[0] || new Date().toISOString().split('T')[0];
            const dateFrom = `${txDate} 00:00:00`;
            const dateTo   = `${txDate} 23:59:59`;
            // Wallet Log
            try {
              await wtPage.goto(`${WEBTOOLS_BASE}/WalletLog`, { waitUntil: 'domcontentloaded' });
              await wtPage.waitForTimeout(1500);
              await wtPage.locator('#input-memberName').fill(boUsername);
              await wtPage.locator('#fromDate').fill(dateFrom);
              await wtPage.locator('#toDate').fill(dateTo);
              await wtPage.locator('#btnSearch').click();
              await wtPage.waitForTimeout(2000);
              await snap(wtPage, `${methodName}-15 - Webtools Wallet Log`);
              const wtRows = await wtPage.locator('table tbody tr').all();
              const wtEntries = [];
              for (const row of wtRows) {
                const rt = await row.innerText();
                if (rt.includes(tx.txNo)) wtEntries.push(rt.replace(/\n/g, ' | ').substring(0, 200));
              }
              console.log(`>> Webtools Wallet Log (${wtEntries.length} entries for txNo):`);
              wtEntries.forEach((e, i) => console.log(`>>   [${i+1}] ${e}`));
              if (resumeAction === 'approved') {
                console.log(`>> Has Deposit entry: ${wtEntries.some(e => e.includes('Deposit'))}, Has Bonus: ${wtEntries.some(e => e.includes('Bonus'))}`);
              }
            } catch (err) {
              console.log(`>> Webtools Wallet Log error: ${err.message.split('\n')[0]}`);
            }
            // Tally — Find Paygate Transactions
            try {
              await wtPage.goto(`${WEBTOOLS_BASE}/CashTransferTicket/FindByPaygate`, { waitUntil: 'domcontentloaded' });
              await wtPage.waitForTimeout(1500);
              await wtPage.getByRole('textbox').nth(1).fill(boUsername);
              await wtPage.locator('select[name="paygateSelector"]').selectOption(CONFIG.classIdentifier).catch(() => {});
              await wtPage.locator('#fromDate').fill(dateFrom);
              await wtPage.locator('#toDate').fill(dateTo);
              await wtPage.locator('#btnSearch').click();
              await wtPage.waitForTimeout(2000);
              const swalText = await wtPage.locator('.swal2-container').innerText().catch(() => '');
              if (swalText) { await wtPage.locator('.swal2-confirm').click().catch(() => {}); await wtPage.waitForTimeout(500); }
              await snap(wtPage, `${methodName}-16 - Webtools Tally`);
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

      // ── PART 8: Playsite after screenshots (cash history + stats) ──
      let after = null;
      if (resumeAction) {
        playerContext = await browser.newContext({ storageState: PLAYER.sessionPath });
        playerPage    = await playerContext.newPage();
        const statementPageAfter  = new StatementPage(playerPage);
        const withdrawalPageAfter = new WithdrawalPage(playerPage);

        await playerPage.goto(`${URLS.playsite}user/cash-history`);
        await playerPage.waitForTimeout(2000);
        const txAfter = await statementPageAfter.getLatestTransaction();
        await snap(playerPage, `${methodName}-06 - Cash History After`);
        console.log(`>> Cash History (after) — txNo: ${txAfter.txNo} | Status: ${txAfter.status} | Amount: ${txAfter.amount}`);

        await withdrawalPageAfter.navigate();
        after = await withdrawalPageAfter.getStats('after');
        await snap(playerPage, `${methodName}-07 - Stats After`);
        console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

        await playerPage.close({ runBeforeUnload: false }).catch(() => {});
        await playerContext.close();
        playerContext = null;
      }

      // ── PART 9: Write transaction summary for Excel report ──
      const txnSummary = {
        gateway:        CONFIG.gatewayName,
        method:         methodName,
        packageName:    CONFIG.deposit.packageName,
        player:         PLAYER.username,
        txNo:           tx.txNo,
        txDateTime:     tx.dateTime,
        txAmount:       tx.amount,
        bonus:          tx.bonus || '0',
        txStatus:       resumeAction || 'timeout',
        balanceBefore:  before.balance,
        balanceAfter:   after?.balance  ?? '—',
        rolloverBefore: before.rollover,
        rolloverAfter:  after?.rollover ?? '—',
        targetBefore:   before.target,
        targetAfter:    after?.target   ?? '—',
        outstandingTotal: outstanding.total,
      };
      writeFileSync(
        join(process.cwd(), '.screenshots-tmp', TXN_MANIFEST_NAME),
        JSON.stringify(txnSummary), 'utf-8'
      );
      console.log(`>> Txn summary written`);

      // ── PART 10: Balance / Rollover / Target assertions ──
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
      expect(txFoundAfter, `${methodName}: transaction ${tx.txNo} not found in BO deposit list after ${resumeAction}`).toBe(true);

      results[methodName] = 'PASS';
      console.log(`>> ${CONFIG.gatewayName} ${methodName}: PASS ✅`);

    } catch (err) {
      results[methodName] = `FAIL: ${err.message.split('\n')[0]}`;
      console.log(`>> ${CONFIG.gatewayName} ${methodName}: FAIL — ${err.message.split('\n')[0]}`);
      if (playerContext) { await playerPage?.close({ runBeforeUnload: false }).catch(() => {}); await playerContext.close().catch(() => {}); }
      if (boContext)     { await boPage?.close({ runBeforeUnload: false }).catch(() => {}); await boContext.close().catch(() => {}); }
    }
  }

  console.log('\n>> ===== Paygate Deposit Summary =====');
  for (const [m, r] of Object.entries(results)) {
    console.log(`>>   ${m}: ${r}`);
  }
  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);

  const allPassed = Object.values(results).every(r => r === 'PASS' || r.startsWith('SKIP'));
  console.log(allPassed ? '>> RESULT: PASS' : '>> RESULT: FAIL');
  if (!allPassed) {
    throw new Error(`One or more methods failed: ${Object.entries(results).filter(([,v]) => !v.startsWith('PASS') && !v.startsWith('SKIP')).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
  }
});
