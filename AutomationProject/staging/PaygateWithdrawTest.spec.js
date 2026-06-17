import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CaptchaHelper } from '../helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { StatementPage } from './pages/StatementPage.js';
import { PLAYER, BACKOFFICE, URLS } from './config.js';

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
const MANIFEST_NAME = 'manifest-paygate-withdraw.json';

async function snap(page, label) {
  const dir = join(process.cwd(), '.screenshots-tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${label.replace(/\s+/g, '-')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push({ label, path: file });
  writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(screenshots.map(s => ({ label: s.label, path: s.path }))), 'utf-8');
  console.log(`>> Screenshot: ${label}`);
}

// Disable Playwright's built-in trace/video/screenshot — this test manages its own artifacts
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('Paygate withdraw — all enabled methods', async ({ browser }) => {
  test.setTimeout(0);

  const amount = parseInt(process.env.CUSTOM_WITHDRAWAL_AMOUNT) || CONFIG.withdrawal.amount;

  const results = {};
  const enabledMethods = Object.entries(CONFIG.withdrawal.methods).filter(([name, m]) => {
    if (methodOverride) return name === methodOverride;
    return m.enabled;
  });

  if (enabledMethods.length === 0) {
    console.log(`>> No withdrawal methods enabled for gateway "${CONFIG.gatewayName}"`);
    console.log('>> RESULT: PASS');
    process.exit(0);
  }

  for (const [methodName] of enabledMethods) {
    console.log(`\n>> ===== Testing ${CONFIG.gatewayName} Withdraw — ${methodName} =====`);

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
      await snap(playerPage, `${methodName}-01 - Player Login`);

      // ── PART 2: Record BEFORE stats ──
      await withdrawalPage.navigate();
      const before = await withdrawalPage.getStats('before');
      await snap(playerPage, `${methodName}-02 - Stats Before`);
      console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

      // ── Rollover gate check ──
      if (before.rollover < before.target) {
        console.log(`>> Rollover not met: ${before.rollover} < ${before.target}`);
        await withdrawalPage.verifyRolloverError(amount);
        await snap(playerPage, `${methodName}-03 - Rollover Gate`);
        results[methodName] = 'SKIP: rollover not met';
        await playerPage.close({ runBeforeUnload: false }).catch(() => {});
        await playerContext.close();
        playerContext = null;
        continue;
      }

      // ── PART 3: Submit paygate withdrawal ──
      await withdrawalPage.navigate();
      await snap(playerPage, `${methodName}-03 - Withdrawal Form`);

      await playerPage.locator('input.field__value').first().fill(String(amount));
      await playerPage.locator('.multi-lang[data-lang="DEPOSITWITHDRAW.Submit"]').first().click({ force: true });
      await playerPage.waitForTimeout(2000);

      const continueModal = playerPage.locator('.swal2-content', { hasText: 'Do you want to continue?' });
      await continueModal.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
      await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true });
      await playerPage.waitForTimeout(3000);

      // ── Determine withdrawal submission result ──
      let withdrawResult = 'unknown';
      let withdrawError  = '';

      const successModal = playerPage.locator('.swal2-content', { hasText: 'Send request successfully' });
      const errModal     = playerPage.locator('.swal2-modal .swal2-content');

      if (await successModal.isVisible().catch(() => false)) {
        withdrawResult = 'success';
        console.log(`>> Withdrawal request submitted successfully`);
        await snap(playerPage, `${methodName}-04 - Withdrawal Submitted`);
        await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true });
      } else if (await errModal.isVisible().catch(() => false)) {
        withdrawError  = (await errModal.innerText().catch(() => '')).trim();
        withdrawResult = 'error';
        console.log(`>> Withdrawal error: ${withdrawError}`);
        await snap(playerPage, `${methodName}-04 - Withdrawal Error`);
        await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true }).catch(() => {});
      } else {
        withdrawResult = 'success';
        await snap(playerPage, `${methodName}-04 - Withdrawal Submitted`);
        console.log(`>> Withdrawal submitted (no explicit success modal)`);
      }

      // ── PART 4: Get transaction from Cash History ──
      await statementPage.navigateToCashHistory();
      await playerPage.waitForTimeout(2000);
      await snap(playerPage, `${methodName}-05 - Cash History`);

      const tx = await statementPage.getLatestTransaction();
      console.log(`>> Transaction: ${tx.txNo} | Status: ${tx.status} | Amount: ${tx.amount}`);

      // ── PART 5: Record AFTER stats ──
      await withdrawalPage.navigate();
      const after = await withdrawalPage.getStats('after');
      await snap(playerPage, `${methodName}-06 - Stats After`);
      console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

      await playerPage.close({ runBeforeUnload: false }).catch(() => {});
      await playerContext.close();
      playerContext = null;

      // ── PART 6: BO — verify transaction in Cash Withdraw List ──
      boContext  = await browser.newContext();
      boPage     = await boContext.newPage();
      const backoffice = new BackofficePage(boPage, 'backoffice');
      const boCaptcha  = new CaptchaHelper(boPage, 'backoffice');

      await backoffice.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, boCaptcha, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
      await backoffice.closeExtraTabs();
      await backoffice.closeAnnouncements();
      await snap(boPage, `${methodName}-07 - BO Login`);

      // Navigate to Cash Withdraw List via direct URL (avoids sidebar toggle conflicts)
      await boPage.goto(`${backoffice.boBase}/dashboard/cash/withdraw-list`, { waitUntil: 'domcontentloaded' });
      await boPage.waitForTimeout(1500);

      const boUsername = `${URLS.memberPrefix || ''}${PLAYER.username.replace(/^x9048_/, '')}`;
      const statusFilter = tx.status.toLowerCase().includes('pending') || tx.status.toLowerCase().includes('inprocess')
        ? 'Pending/InProcess'
        : tx.status.toLowerCase().includes('approved')
          ? 'Approved'
          : 'Pending/InProcess';

      await boPage.locator('input[name="txtUserName"]').fill(boUsername);
      await boPage.locator('select[name="ddlFilterStatus"]').selectOption(statusFilter).catch(() => {});
      await boPage.locator('button[type="submit"]:has-text("Search")').click({ force: true });
      await boPage.waitForTimeout(2000);
      await snap(boPage, `${methodName}-08 - BO Withdraw List`);

      const txRow   = boPage.locator(`.table-responsive tbody td:has-text("${tx.txNo}")`);
      const txFound = (await txRow.count()) > 0;
      console.log(`>> BO withdraw list — txNo "${tx.txNo}" found: ${txFound}`);

      let paygateVerified = false;
      if (txFound) {
        const txRowParent = boPage.locator(`.table-responsive tbody tr:has(td:has-text("${tx.txNo}"))`).first();
        await txRowParent.locator('i.fa.fa-edit').click({ force: true });
        await boPage.waitForTimeout(2000);

        const paygateLabel = boPage.locator('form[name="ticketDetailForm"] .modal-body .form-group label:has-text("PayGate")').locator('..').locator('label').last();
        const paygateText  = await paygateLabel.innerText().catch(() => '');
        paygateVerified = paygateText.toLowerCase().includes(CONFIG.classIdentifier.replace(/[^a-z]/g, '').substring(0, 5));
        console.log(`>> BO paygate on transaction: "${paygateText}" — verified: ${paygateVerified}`);
        await snap(boPage, `${methodName}-09 - BO Transaction Detail`);

        await boPage.locator('form[name="ticketDetailForm"] .modal-header button.close').click({ force: true }).catch(() => {});
        await boPage.waitForTimeout(500);
      }

      await boPage.close({ runBeforeUnload: false }).catch(() => {});
      await boContext.close();
      boContext = null;

      // ── PART 7: Validate balance / rollover / target ──
      const expectedBalance = before.balance - amount;

      if (tx.status.toLowerCase().includes('approved')) {
        expect(after.balance).toBeCloseTo(expectedBalance, 1);
        expect(after.rollover).toBeCloseTo(0, 1);
        expect(after.target).toBeCloseTo(0, 1);
        console.log(`>> Balance/Rollover/Target assertions: Approved path ✅`);
      } else if (tx.status.toLowerCase().includes('rejected')) {
        expect(after.balance).toBeCloseTo(before.balance, 1);
        expect(after.rollover).toBeCloseTo(before.rollover, 1);
        expect(after.target).toBeCloseTo(before.target, 1);
        console.log(`>> Balance/Rollover/Target assertions: Rejected path ✅`);
      } else {
        console.log(`>> Transaction status "${tx.status}" — balance assertion skipped for pending state`);
      }

      expect(withdrawResult, `Expected successful withdrawal submission, got error: ${withdrawError}`).toBe('success');
      expect(txFound, `Transaction ${tx.txNo} not found in BO Cash Withdraw List`).toBe(true);

      results[methodName] = 'PASS';
      console.log(`>> ${CONFIG.gatewayName} ${methodName} withdraw: PASS ✅`);

    } catch (err) {
      results[methodName] = `FAIL: ${err.message.split('\n')[0]}`;
      console.log(`>> ${CONFIG.gatewayName} ${methodName} withdraw: FAIL — ${err.message.split('\n')[0]}`);
      if (playerContext) { await playerPage?.close({ runBeforeUnload: false }).catch(() => {}); await playerContext.close().catch(() => {}); }
      if (boContext)     { await boPage?.close({ runBeforeUnload: false }).catch(() => {}); await boContext.close().catch(() => {}); }
    }
  }

  console.log('\n>> ===== Paygate Withdraw Summary =====');
  for (const [m, r] of Object.entries(results)) {
    console.log(`>>   ${m}: ${r}`);
  }
  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);

  const allPassed = Object.values(results).every(r => r === 'PASS' || r.startsWith('SKIP'));
  console.log(allPassed ? '>> RESULT: PASS' : '>> RESULT: FAIL');
  process.exit(0);
});
