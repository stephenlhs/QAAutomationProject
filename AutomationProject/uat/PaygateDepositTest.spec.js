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
      for (let _pi = 0; _pi < 10; _pi++) {
        const _pb = playerPage.locator('.js-popup-close-btn').first();
        if (await _pb.isVisible({ timeout: 500 }).catch(() => false)) {
          await _pb.click({ force: true }).catch(() => {});
          await playerPage.waitForTimeout(400);
        } else { break; }
      }
      await playerPage.locator('.fa.fa-times').first().click({ force: true }).catch(() => {});

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

      // Confirmation modal
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
          txFoundAfter = await searchBO(expectedStatus);
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
      }

      await boPage.close({ runBeforeUnload: false }).catch(() => {});
      await boContext.close();
      boContext = null;

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
          const totalCredit   = amount + txBonusAmount;
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
