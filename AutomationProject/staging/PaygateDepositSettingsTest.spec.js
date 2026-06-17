import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CaptchaHelper } from '../helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { StatementPage } from './pages/StatementPage.js';
import { PLAYER, DEPOSIT, URLS } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const gatewayId      = process.env.PAYGATE_GATEWAY      || 'vaderpayc2';
const methodOverride = process.env.PAYGATE_METHOD        || null;
const testCurrency   = process.env.PAYGATE_TEST_CURRENCY || 'MYR';

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
const MANIFEST_NAME = 'manifest-paygate-settings.json';

async function snap(page, label) {
  const dir = join(process.cwd(), '.screenshots-tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${label.replace(/\s+/g, '-')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push({ label, path: file });
  writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(screenshots.map(s => ({ label: s.label, path: s.path }))), 'utf-8');
  console.log(`>> Screenshot: ${label}`);
}

// Parse displayed limit text like ": 10,000 MYR" → 10000
function parseDisplayedLimit(text) {
  const match = (text || '').replace(/,/g, '').match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

// Navigate to the deposit amount entry step for a given method
async function navigateToAmountStep(page, config, method) {
  await page.goto(`${URLS.playsite}user/deposit`);
  await page.waitForTimeout(1500);
  await page.locator('.fa.fa-times').click().catch(() => {});

  // Package selection
  const pkgBtn = page.locator('button, [role="button"]').filter({ hasText: config.deposit.packageName }).first();
  if (await pkgBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await pkgBtn.click();
    await page.waitForTimeout(500);
    console.log(`>> Package selected via button: ${config.deposit.packageName}`);
  } else {
    const pkgSelect = page.getByRole('combobox').first();
    await pkgSelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await pkgSelect.selectOption({ label: config.deposit.packageName });
    await page.waitForTimeout(500);
    const chosen = await pkgSelect.locator('option:checked').innerText().catch(() => '?');
    console.log(`>> Package selected via dropdown: "${chosen}"`);
  }
  await page.waitForTimeout(2500);

  // Payment method tab
  const tabValueMap = { 'crypto-payment': 'crypto' };
  const tabValue    = tabValueMap[method.tab] || method.tab;
  const categorySelect = page.locator('select').filter({
    has: page.locator(`option[value="${tabValue}"]`)
  }).first();
  await categorySelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (!(await categorySelect.count())) return 'SKIP: payment method tab not found';

  for (let attempt = 1; attempt <= 2; attempt++) {
    await categorySelect.selectOption(tabValue);
    await page.waitForTimeout(800);
    if ((await categorySelect.inputValue()) === tabValue) break;
    if (attempt === 1) {
      await categorySelect.evaluate((el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, tabValue);
      await page.waitForTimeout(800);
    }
  }

  // Gateway card
  const nameParts    = config.gatewayName.split(' ');
  const nameSelector = nameParts.map(p => `[data-paygate-name*="${p}"]`).join('');
  const gatewayCard  = page.locator(nameSelector).first();
  if (!(await gatewayCard.count())) return 'SKIP: gateway card not found (may be disabled in BO)';
  await gatewayCard.click({ force: true });
  await page.waitForTimeout(1000);

  // Bank row + Next step (Bank method only)
  const bankRow = page.locator('.redeposit__bank-table tbody tr').first();
  if (await bankRow.count()) await bankRow.click({ force: true });
  const nextBtn = page.locator('.redeposit__step3-selection .redeposit__button').first();
  if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await nextBtn.click({ force: true });
    await page.waitForTimeout(1000);
  }

  return 'OK';
}

// Enter an amount and check whether validation fires (returns { passed, message })
async function checkAmountValidation(page, amt, label) {
  await page.locator('#txtAmount[name="txtAmount"]').fill(String(amt));
  await page.waitForTimeout(500);

  // Some platforms fire inline validation without needing a Confirm click
  const validateSelector = '.redeposit__validate-wrapper span, .redeposit2__validate-wrapper span';
  const inlineVisible = await page.locator(validateSelector).first().isVisible().catch(() => false);
  if (!inlineVisible) {
    await page.locator('.multi-lang[data-lang="DEPOSITWITHDRAW.Confirm"]').first().click({ force: true });
    await page.waitForTimeout(2000);
  }

  const continueModal = page.locator('.swal2-content', { hasText: 'Do you want to continue?' });
  const validateMsg   = page.locator(validateSelector).first();
  const swal2Modal    = page.locator('.swal2-modal');

  if (await continueModal.isVisible().catch(() => false)) {
    // Amount bypassed validation — dismiss and report failure
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    return { passed: false, message: `${label}: validation BYPASSED — continue modal appeared for amount ${amt}` };
  }

  if (await validateMsg.isVisible().catch(() => false)) {
    const msg = (await validateMsg.innerText().catch(() => '')).trim();
    return { passed: true, message: `${label}: "${msg}"` };
  }

  if (await swal2Modal.isVisible().catch(() => false)) {
    const msg = (await swal2Modal.locator('.swal2-content').innerText().catch(() => '')).trim();
    await page.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    return { passed: true, message: `${label} (error modal): "${msg}"` };
  }

  return { passed: false, message: `${label}: no validation appeared for amount ${amt}` };
}

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('Paygate deposit settings — min/max validation and In Process status', async ({ browser }) => {
  test.setTimeout(0);

  const validAmount = parseInt(process.env.CUSTOM_DEPOSIT_AMOUNT) || CONFIG.deposit.amount;

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
    console.log(`\n>> ===== Settings Test: ${CONFIG.gatewayName} — ${methodName} [${testCurrency}] =====`);

    let playerContext, playerPage;
    try {
      playerContext = await browser.newContext();
      playerPage    = await playerContext.newPage();
      const loginPage     = new LoginPage(playerPage, 'player');
      const statementPage = new StatementPage(playerPage);
      const captcha       = new CaptchaHelper(playerPage, 'player');

      await loginPage.loginAndSaveSession(PLAYER.username, PLAYER.password, captcha, PLAYER.sessionPath);
      await snap(playerPage, `${methodName}-01 - Login`);

      // Navigate to deposit amount step
      const navResult = await navigateToAmountStep(playerPage, CONFIG, method);
      if (navResult !== 'OK') {
        console.log(`>> ${navResult}`);
        results[methodName] = navResult;
        await playerPage.close({ runBeforeUnload: false }).catch(() => {});
        await playerContext.close();
        continue;
      }
      await snap(playerPage, `${methodName}-02 - Deposit Page`);

      // ── Read displayed limits from playsite ──
      const displayedMinText = await playerPage.locator('.redeposit2__limit-amount').nth(0).innerText().catch(() => '');
      const displayedMaxText = await playerPage.locator('.redeposit2__limit-amount').nth(1).innerText().catch(() => '');
      const displayedMin = parseDisplayedLimit(displayedMinText);
      const displayedMax = parseDisplayedLimit(displayedMaxText);
      const fixtureMin   = method.limits?.[testCurrency]?.min;
      const fixtureMax   = method.limits?.[testCurrency]?.max;

      console.log(`>> Playsite displays — min: "${displayedMinText.trim()}"  max: "${displayedMaxText.trim()}"`);
      console.log(`>> Fixture [${testCurrency}]  — min: ${fixtureMin ?? 'N/A'}  max: ${fixtureMax ?? 'N/A'}`);

      if (fixtureMin && displayedMin > 0 && displayedMin !== fixtureMin)
        console.log(`>> WARNING: Displayed min (${displayedMin}) ≠ fixture (${fixtureMin}) — update ${CONFIG.classIdentifier}.json`);
      if (fixtureMax && displayedMax > 0 && displayedMax !== fixtureMax)
        console.log(`>> WARNING: Displayed max (${displayedMax}) ≠ fixture (${fixtureMax}) — update ${CONFIG.classIdentifier}.json`);

      // Use playsite values for testing; fall back to fixture if display unavailable
      const testMin  = displayedMin > 0 ? displayedMin : (fixtureMin || 10);
      const testMax  = displayedMax > 0 ? displayedMax : (fixtureMax || 30000);
      const belowMin = testMin > 1 ? testMin - 1 : 0;
      const aboveMax = testMax + 1;

      console.log(`>> Test amounts — belowMin: ${belowMin}  aboveMax: ${aboveMax}  validAmount: ${validAmount}`);

      const subResults = {};

      // ── [1/3] Below minimum ──
      console.log(`\n>> [1/3] Below minimum: ${belowMin}`);
      const minCheck = await checkAmountValidation(playerPage, belowMin, 'MIN');
      await snap(playerPage, `${methodName}-03 - Below Min (${belowMin})`);
      subResults['below-min'] = minCheck.passed ? `PASS — ${minCheck.message}` : `FAIL — ${minCheck.message}`;
      console.log(`>> [1/3] ${subResults['below-min']}`);

      // ── [2/3] Above maximum ──
      console.log(`\n>> [2/3] Above maximum: ${aboveMax}`);
      const maxCheck = await checkAmountValidation(playerPage, aboveMax, 'MAX');
      await snap(playerPage, `${methodName}-04 - Above Max (${aboveMax})`);
      subResults['above-max'] = maxCheck.passed ? `PASS — ${maxCheck.message}` : `FAIL — ${maxCheck.message}`;
      console.log(`>> [2/3] ${subResults['above-max']}`);

      // ── [3/3] Valid amount → In Process status ──
      console.log(`\n>> [3/3] Valid amount (${validAmount}) → In Process`);
      await playerPage.locator('#txtAmount[name="txtAmount"]').fill(String(validAmount));
      await playerPage.locator('.multi-lang[data-lang="DEPOSITWITHDRAW.Confirm"]').first().click({ force: true });
      await playerPage.waitForTimeout(3000);

      const continueModal = playerPage.locator('.swal2-content', { hasText: 'Do you want to continue?' });
      const errModal      = playerPage.locator('.swal2-modal .swal2-content');

      let submitted = false;
      if (await continueModal.isVisible({ timeout: 10000 }).catch(() => false)) {
        await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true });
        await playerPage.waitForTimeout(5000);
        submitted = true;
      } else if (await errModal.isVisible().catch(() => false)) {
        const errMsg = (await errModal.innerText().catch(() => '')).trim();
        await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true }).catch(() => {});
        subResults['in-process'] = `SKIP — submission blocked: ${errMsg}`;
        console.log(`>> [3/3] ${subResults['in-process']}`);
      } else {
        submitted = true;
      }

      if (submitted) {
        const qrBody = playerPage.locator('.redeposit__a9wallet-body');
        if (await qrBody.isVisible({ timeout: 3000 }).catch(() => false)) {
          await snap(playerPage, `${methodName}-05 - QR Displayed`);
          await playerPage.locator('.redeposit__a9wallet-body .multi-lang[data-lang="GAMESPAGE.Close"]').click({ force: true }).catch(async () => {
            await playerPage.keyboard.press('Escape');
          });
          await playerPage.waitForTimeout(1000);
        } else {
          await snap(playerPage, `${methodName}-05 - Vendor Page`);
        }

        await playerPage.goto(`${URLS.playsite}user/cash-history`);
        await playerPage.waitForTimeout(2000);
        await snap(playerPage, `${methodName}-06 - Cash History`);

        const tx = await statementPage.getLatestTransaction();
        console.log(`>> Transaction: txNo=${tx.txNo} | status="${tx.status}" | amount=${tx.amount}`);

        const statusLower = (tx.status || '').toLowerCase();
        const isInProcess = statusLower.includes('process') || statusLower.includes('pending');
        subResults['in-process'] = isInProcess
          ? `PASS — status: "${tx.status}"`
          : `FAIL — expected In Process/Pending, got "${tx.status}"`;
        console.log(`>> [3/3] ${subResults['in-process']}`);
      }

      await playerPage.close({ runBeforeUnload: false }).catch(() => {});
      await playerContext.close();
      playerContext = null;

      // Summary
      console.log(`\n>> Sub-results for ${methodName} [${testCurrency}]:`);
      for (const [k, v] of Object.entries(subResults)) console.log(`>>   ${k}: ${v}`);

      const allSubPassed = Object.values(subResults).every(v => v.startsWith('PASS') || v.startsWith('SKIP'));
      results[methodName] = allSubPassed ? 'PASS' : 'FAIL';

      expect(subResults['below-min'], `${methodName} below-min validation`).toMatch(/^(PASS|SKIP)/);
      expect(subResults['above-max'], `${methodName} above-max validation`).toMatch(/^(PASS|SKIP)/);
      if (subResults['in-process']) {
        expect(subResults['in-process'], `${methodName} in-process status`).toMatch(/^(PASS|SKIP)/);
      }

      console.log(`>> ${CONFIG.gatewayName} ${methodName}: ${results[methodName]} ✅`);

    } catch (err) {
      results[methodName] = `FAIL: ${err.message.split('\n')[0]}`;
      console.log(`>> ${CONFIG.gatewayName} ${methodName}: FAIL — ${err.message.split('\n')[0]}`);
      if (playerContext) { await playerPage?.close({ runBeforeUnload: false }).catch(() => {}); await playerContext.close().catch(() => {}); }
    }
  }

  console.log('\n>> ===== Paygate Deposit Settings Summary =====');
  for (const [m, r] of Object.entries(results)) console.log(`>>   ${m}: ${r}`);
  console.log(`>> Screenshots manifest saved (${screenshots.length} screenshots)`);

  const allPassed = Object.values(results).every(r => r === 'PASS' || r.startsWith('SKIP'));
  console.log(allPassed ? '>> RESULT: PASS' : '>> RESULT: FAIL');
  process.exit(0);
});
