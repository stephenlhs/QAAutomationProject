import { test } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CaptchaHelper } from '../helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { PLAYER, BACKOFFICE, URLS } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const gatewayId      = process.env.PAYGATE_GATEWAY      || 'vaderpayc2';
const methodOverride = process.env.PAYGATE_METHOD        || null;
const testCurrency   = process.env.PAYGATE_TEST_CURRENCY || 'MYR';

// Load fixture
const fixturesDir = join(__dirname, 'fixtures');
let CONFIG = null;
for (const f of readdirSync(fixturesDir).filter(f => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(fixturesDir, f), 'utf-8'));
  if (c.classIdentifier === gatewayId) { CONFIG = c; break; }
}
if (!CONFIG) { console.error(`No fixture for classIdentifier: "${gatewayId}"`); process.exit(1); }

const boBase                   = URLS.backoffice.replace('/login', '');
const SSR_DEPOSIT_SETTINGS_URL = `${boBase}/dashboard/payment-gateway/deposit-individual-settings`;
const DEPOSIT_URL              = `${URLS.playsite}user/deposit`;
const MANIFEST_NAME            = 'manifest-paygate-ssr-settings.json';

const screenshots = [];

// ─── Utilities ───────────────────────────────────
async function snap(page, label) {
  const dir = join(process.cwd(), '.screenshots-tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${label.replace(/[\s/\\:*?"<>|]/g, '-')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push({ label, path: file });
  writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(screenshots.map(s => ({ label: s.label, path: s.path }))), 'utf-8');
  console.log(`>> Screenshot: ${label}`);
}

function parseDisplayedLimit(text) {
  const m = (text || '').replace(/,/g, '').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

async function dismissModals(page) {
  for (let i = 0; i < 3; i++) {
    const modal = page.locator('#announcement-modal.in, .modal.in, .modal.show').first();
    const visible = await modal.isVisible({ timeout: 1500 }).catch(() => false);
    if (!visible) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await modal.locator('button.close, [data-dismiss="modal"]').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    const okBtn = page.locator('button').filter({ hasText: /^(ok|close|dismiss)$/i }).first();
    if (await okBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await okBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}

// ─── Login helpers ────────────────────────────────
async function loginSSRBO(page) {
  const bo  = new BackofficePage(page, 'backoffice');
  const cap = new CaptchaHelper(page, 'backoffice');
  await bo.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, cap, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
  await bo.closeExtraTabs();
  await dismissModals(page);
  console.log('>> [SSR BO] Login successful');
}

async function loginPlaysite(page) {
  const lp  = new LoginPage(page, 'player');
  const cap = new CaptchaHelper(page, 'player');
  await lp.loginAndSaveSession(PLAYER.username, PLAYER.password, cap, PLAYER.sessionPath);
  console.log('>> [Playsite] Login successful');
}

// ─── SSR BO helpers ───────────────────────────────
async function ssrGotoGateway(ssrPage) {
  await ssrPage.goto(SSR_DEPOSIT_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ssrPage.waitForTimeout(2000);
  const leftItem = ssrPage.locator('ul li').filter({ hasText: CONFIG.gatewayName }).first();
  if (await leftItem.count()) {
    await leftItem.click({ force: true });
  } else {
    await ssrPage.locator('li, .list-group-item').filter({ hasText: CONFIG.gatewayName }).first().click({ force: true });
  }
  await ssrPage.waitForTimeout(1500);
}

async function ssrSelectCurrencyTab(ssrPage) {
  const tabLink = ssrPage.locator(`a[href$="-${testCurrency}"]`).first();
  if (await tabLink.count()) {
    await tabLink.click({ force: true });
  } else {
    await ssrPage.locator('ul li a').filter({ hasText: testCurrency }).first().click({ force: true });
  }
  await ssrPage.waitForTimeout(500);
}

async function ssrSubmit(ssrPage) {
  await ssrPage.getByRole('button', { name: /Submit/i }).first().click({ force: true });
  await ssrPage.waitForTimeout(2000);
}

// ─── Playsite helpers ─────────────────────────────
async function playSiteSelectPkgMethod(playerPage, method) {
  await playerPage.locator('.fa.fa-times').click().catch(() => {});
  const pkgBtn = playerPage.locator('button, [role="button"]').filter({ hasText: CONFIG.deposit.packageName }).first();
  if (await pkgBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await pkgBtn.click();
  } else {
    const pkgSel = playerPage.getByRole('combobox').first();
    await pkgSel.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await pkgSel.selectOption({ label: CONFIG.deposit.packageName });
  }
  await playerPage.waitForTimeout(2500);
  const tv  = ({ 'crypto-payment': 'crypto' })[method.tab] || method.tab;
  const sel = playerPage.locator('select').filter({ has: playerPage.locator(`option[value="${tv}"]`) }).first();
  if (await sel.count()) { await sel.selectOption(tv); await playerPage.waitForTimeout(800); }
}

async function playSiteGetCard(playerPage) {
  const parts = CONFIG.gatewayName.split(' ');
  return playerPage.locator(parts.map(p => `[data-paygate-name*="${p}"]`).join('')).first();
}

async function playSiteCheckGateway(playerPage, method, label) {
  await playerPage.goto(DEPOSIT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await playerPage.waitForTimeout(1500);
  await playSiteSelectPkgMethod(playerPage, method);
  const visible = await (await playSiteGetCard(playerPage)).isVisible({ timeout: 3000 }).catch(() => false);
  await snap(playerPage, label);
  return visible ? 'visible' : 'hidden';
}

async function playSiteCheckBank(playerPage, method, bankName, label) {
  await playerPage.goto(DEPOSIT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await playerPage.waitForTimeout(1500);
  await playSiteSelectPkgMethod(playerPage, method);
  const card = await playSiteGetCard(playerPage);
  if (!(await card.isVisible({ timeout: 3000 }).catch(() => false))) {
    await snap(playerPage, label);
    return 'gateway-not-found';
  }
  await card.click({ force: true });
  await playerPage.waitForTimeout(1500);
  let result = 'hidden';
  const ddToggle = playerPage.locator('.dropdown-toggle').first();
  if (await ddToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
    await ddToggle.click({ force: true });
    await playerPage.waitForTimeout(600);
    const opt = playerPage.locator('.dropdown-menu a, .dropdown-item').filter({ hasText: bankName }).first();
    result = await opt.isVisible({ timeout: 3000 }).catch(() => false) ? 'visible' : 'hidden';
    await ddToggle.click({ force: true }).catch(() => {});
  } else {
    const row = playerPage.locator('.redeposit__bank-table tbody tr').filter({ hasText: bankName });
    result = await row.isVisible({ timeout: 3000 }).catch(() => false) ? 'visible' : 'hidden';
  }
  await snap(playerPage, label);
  return result;
}

// ─── Min/Max helpers ──────────────────────────────
async function navigateToAmountStep(playerPage, method) {
  await playerPage.goto(DEPOSIT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await playerPage.waitForTimeout(1500);
  await playSiteSelectPkgMethod(playerPage, method);
  const card = await playSiteGetCard(playerPage);
  if (!(await card.count())) return 'SKIP: gateway card not found (may be disabled)';
  await card.click({ force: true });
  await playerPage.waitForTimeout(2000);
  const ddToggle = playerPage.locator('.dropdown-toggle').first();
  if (await ddToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
    await ddToggle.click({ force: true });
    await playerPage.waitForTimeout(500);
    const firstOpt = playerPage.locator('.dropdown-menu a, .dropdown-item').first();
    if (await firstOpt.count()) { await firstOpt.click({ force: true }); await playerPage.waitForTimeout(500); }
  }
  const bankRow = playerPage.locator('.redeposit__bank-table tbody tr:not(:first-child)').first();
  if (await bankRow.count()) await bankRow.click({ force: true });
  const nextBtn = playerPage.locator('.redeposit__step3-selection .redeposit__button').first();
  if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nextBtn.click({ force: true });
    await playerPage.waitForTimeout(1500);
  }
  const amtInput = playerPage.locator('#txtAmount[name="txtAmount"]');
  if (!(await amtInput.isVisible({ timeout: 5000 }).catch(() => false))) {
    return 'SKIP: amount input not visible (QR/redirect flow?)';
  }
  return 'OK';
}

async function checkAmountValidation(playerPage, amt, label) {
  const amtInput   = playerPage.locator('#txtAmount[name="txtAmount"]');
  const confirmBtn = playerPage.locator('.multi-lang[data-lang="DEPOSITWITHDRAW.Confirm"]').first();
  await amtInput.fill('', { timeout: 8000 });
  await amtInput.fill(String(amt), { timeout: 8000 });
  await playerPage.waitForTimeout(800);

  const inlineMsg = playerPage.locator('.redeposit__validate-wrapper span, .redeposit2__validate-wrapper span, .text-danger, .invalid-feedback').first();
  if (await inlineMsg.isVisible({ timeout: 1000 }).catch(() => false)) {
    const msg = (await inlineMsg.innerText().catch(() => '')).trim();
    if (msg) return { passed: true, message: `${label} (inline): "${msg}"` };
  }

  const isRed = () => playerPage.evaluate(() => {
    for (const el of document.querySelectorAll('.redeposit2__limit-amount')) {
      const m = window.getComputedStyle(el).color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (m && parseInt(m[1]) > 150 && parseInt(m[1]) > parseInt(m[2]) * 1.5) return true;
    }
    return false;
  }).catch(() => false);

  if (await isRed()) return { passed: true, message: `${label}: limit turned red` };
  if (await confirmBtn.evaluate(el => el.disabled || el.classList.contains('disabled')).catch(() => false))
    return { passed: true, message: `${label}: Confirm disabled` };

  await confirmBtn.click({ force: true });
  await playerPage.waitForTimeout(1500);

  if (await isRed()) return { passed: true, message: `${label}: limit turned red after click` };

  const inlineAfter = playerPage.locator('.redeposit__validate-wrapper span, .redeposit2__validate-wrapper span, .text-danger, .invalid-feedback').first();
  if (await inlineAfter.isVisible({ timeout: 1000 }).catch(() => false)) {
    const msg = (await inlineAfter.innerText().catch(() => '')).trim();
    if (msg) return { passed: true, message: `${label} (after click): "${msg}"` };
  }

  const swal = playerPage.locator('.swal2-modal');
  if (await swal.isVisible({ timeout: 2000 }).catch(() => false)) {
    const msg = (await swal.locator('.swal2-content').innerText().catch(() => '')).trim();
    await playerPage.locator('.swal2-buttonswrapper .swal2-confirm[type="button"]').click({ force: true }).catch(() => {});
    return { passed: true, message: `${label} (modal): "${msg}"` };
  }
  return { passed: false, message: `${label}: no validation for ${amt}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test — SSR level + Min/Max (staging / UAT / prod)
// ─────────────────────────────────────────────────────────────────────────────
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('Paygate SSR settings — gateway/QR/bank toggles and min/max validation', async ({ browser }) => {
  test.setTimeout(0);
  const results = {};

  const enabledMethods = Object.entries(CONFIG.deposit.methods).filter(([name, m]) => {
    if (methodOverride) return name === methodOverride;
    return m.enabled;
  });
  if (enabledMethods.length === 0) {
    console.log(`>> No deposit methods enabled for "${CONFIG.gatewayName}"`);
    console.log('>> RESULT: PASS');
    return;
  }

  const bankMethodEntry = enabledMethods.find(([n]) => n === 'Bank') || enabledMethods.find(([n]) => n.toLowerCase().includes('bank'));
  const qrMethodEntry   = Object.entries(CONFIG.deposit.methods).find(([n]) => n === 'QR');
  const bankMethod      = bankMethodEntry?.[1];
  const qrMethod        = qrMethodEntry?.[1];
  const firstMethod     = enabledMethods[0]?.[1];
  const testBankName    = bankMethod?.banks?.[testCurrency]?.find(b => b.enabled)?.name || null;

  // SSR BO (stage-bo.linkv2.com) and Playsite (stage-mem.linkv2.com) are different domains,
  // so they share one context without session conflict — one browser window, two tabs.
  let ctx = null, ssrPage = null, playerPage = null;

  try {
    console.log('>> Opening SSR BO and Playsite in one browser...');
    ctx        = await browser.newContext();
    ssrPage    = await ctx.newPage();
    playerPage = await ctx.newPage();
    await loginSSRBO(ssrPage);
    await loginPlaysite(playerPage);

    await snap(ssrPage,    'SSR-Setup - SSR BO');
    await snap(playerPage, 'SSR-Setup - Playsite');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // SECTION SSR — SSR-level tests
    // All verified in Playsite
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n>> ════════════════════════════════════════════');
    console.log('>> SECTION SSR — SSR-level Settings');
    console.log('>> ════════════════════════════════════════════');

    // ── SSR-S1: Gateway Enable/Disable → Playsite ─────────────────────────
    console.log('\n>> [SSR-S1] Gateway Enable/Disable → Playsite');
    try {
      await ssrGotoGateway(ssrPage);
      await snap(ssrPage, 'SSR-S1a - Gateway Settings');
      const nameRegex = new RegExp(CONFIG.gatewayName.replace(/[()\[\]]/g, '\\$&'));
      const gCb   = ssrPage.getByRole('checkbox', { name: nameRegex }).first();
      const wasOn = await gCb.isChecked().catch(() => true);

      if (wasOn) await gCb.click({ force: true });
      await ssrSubmit(ssrPage);
      await snap(ssrPage, 'SSR-S1b - Gateway OFF');
      const offResult = firstMethod
        ? await playSiteCheckGateway(playerPage, firstMethod, 'SSR-S1c - Playsite Gateway OFF')
        : 'SKIP';
      console.log(`>> [SSR-S1] Gateway OFF → Playsite: ${offResult}`);

      await ssrGotoGateway(ssrPage);
      const gCb2 = ssrPage.getByRole('checkbox', { name: nameRegex }).first();
      if (!(await gCb2.isChecked().catch(() => false))) await gCb2.click({ force: true });
      await ssrSubmit(ssrPage);
      await snap(ssrPage, 'SSR-S1d - Gateway ON');
      const onResult = firstMethod
        ? await playSiteCheckGateway(playerPage, firstMethod, 'SSR-S1e - Playsite Gateway ON')
        : 'SKIP';
      console.log(`>> [SSR-S1] Gateway ON → Playsite: ${onResult}`);

      results['SSR-S1-gateway-toggle'] = (offResult === 'hidden' && onResult === 'visible')
        ? `PASS — OFF→hidden, ON→visible`
        : `FAIL — OFF→${offResult}, ON→${onResult}`;
    } catch (e) {
      results['SSR-S1-gateway-toggle'] = `FAIL: ${e.message.split('\n')[0]}`;
      try {
        await ssrGotoGateway(ssrPage);
        const nr = new RegExp(CONFIG.gatewayName.replace(/[()\[\]]/g, '\\$&'));
        const cb = ssrPage.getByRole('checkbox', { name: nr }).first();
        if (!(await cb.isChecked().catch(() => false))) await cb.click({ force: true });
        await ssrSubmit(ssrPage);
      } catch {}
    }
    console.log(`>> [SSR-S1] ${results['SSR-S1-gateway-toggle']}`);

    // ── SSR-S2: QR Pay ON/OFF → Playsite ──────────────────────────────────
    if (qrMethod) {
      console.log('\n>> [SSR-S2] QR Pay ON/OFF → Playsite');
      try {
        await ssrGotoGateway(ssrPage);
        await ssrSelectCurrencyTab(ssrPage);
        const qrCb    = ssrPage.getByRole('checkbox', { name: 'QR Pay' });
        const qrExists = await qrCb.count() > 0;
        if (!qrExists) {
          results['SSR-S2-qrpay'] = `SKIP — QR Pay checkbox not found for ${testCurrency}`;
        } else {
          await snap(ssrPage, 'SSR-S2a - QR Settings');

          if (await qrCb.isChecked().catch(() => true)) await qrCb.click({ force: true });
          await ssrSubmit(ssrPage);
          await snap(ssrPage, 'SSR-S2b - QR OFF');
          const offResult = await playSiteCheckGateway(playerPage, qrMethod, 'SSR-S2c - Playsite QR OFF');
          console.log(`>> [SSR-S2] QR OFF → Playsite: ${offResult}`);

          await ssrGotoGateway(ssrPage);
          await ssrSelectCurrencyTab(ssrPage);
          const qrCb2 = ssrPage.getByRole('checkbox', { name: 'QR Pay' });
          if (!(await qrCb2.isChecked().catch(() => false))) await qrCb2.click({ force: true });
          await ssrSubmit(ssrPage);
          await snap(ssrPage, 'SSR-S2d - QR ON');
          const onResult = await playSiteCheckGateway(playerPage, qrMethod, 'SSR-S2e - Playsite QR ON');
          console.log(`>> [SSR-S2] QR ON → Playsite: ${onResult}`);

          results['SSR-S2-qrpay'] = (offResult === 'hidden' && onResult === 'visible')
            ? `PASS — QR OFF→hidden, ON→visible`
            : `FAIL — OFF→${offResult}, ON→${onResult}`;
        }
      } catch (e) {
        results['SSR-S2-qrpay'] = `FAIL: ${e.message.split('\n')[0]}`;
        try {
          await ssrGotoGateway(ssrPage); await ssrSelectCurrencyTab(ssrPage);
          const cb = ssrPage.getByRole('checkbox', { name: 'QR Pay' });
          if (!(await cb.isChecked().catch(() => false))) await cb.click({ force: true });
          await ssrSubmit(ssrPage);
        } catch {}
      }
      console.log(`>> [SSR-S2] ${results['SSR-S2-qrpay']}`);
    } else {
      results['SSR-S2-qrpay'] = 'SKIP — QR method not in fixture';
      console.log(`>> [SSR-S2] ${results['SSR-S2-qrpay']}`);
    }

    // ── SSR-S3: Gateway Transfer ON/OFF → Playsite ────────────────────────
    if (bankMethod) {
      console.log('\n>> [SSR-S3] Gateway Transfer ON/OFF → Playsite');
      try {
        await ssrGotoGateway(ssrPage);
        await ssrSelectCurrencyTab(ssrPage);
        const gtCb    = ssrPage.getByRole('checkbox', { name: 'Gateway Transfer' });
        const gtExists = await gtCb.count() > 0;
        if (!gtExists) {
          results['SSR-S3-bank-method'] = `SKIP — Gateway Transfer not found for ${testCurrency}`;
        } else {
          await snap(ssrPage, 'SSR-S3a - Gateway Transfer Settings');

          if (await gtCb.isChecked().catch(() => true)) await gtCb.click({ force: true });
          await ssrSubmit(ssrPage);
          await snap(ssrPage, 'SSR-S3b - Gateway Transfer OFF');
          const offResult = await playSiteCheckGateway(playerPage, bankMethod, 'SSR-S3c - Playsite GT OFF');
          console.log(`>> [SSR-S3] GT OFF → Playsite: ${offResult}`);

          await ssrGotoGateway(ssrPage);
          await ssrSelectCurrencyTab(ssrPage);
          const gtCb2 = ssrPage.getByRole('checkbox', { name: 'Gateway Transfer' });
          if (!(await gtCb2.isChecked().catch(() => false))) await gtCb2.click({ force: true });
          await ssrSubmit(ssrPage);
          await snap(ssrPage, 'SSR-S3d - Gateway Transfer ON');
          const onResult = await playSiteCheckGateway(playerPage, bankMethod, 'SSR-S3e - Playsite GT ON');
          console.log(`>> [SSR-S3] GT ON → Playsite: ${onResult}`);

          results['SSR-S3-bank-method'] = (offResult === 'hidden' && onResult === 'visible')
            ? `PASS — GT OFF→hidden, ON→visible`
            : `FAIL — OFF→${offResult}, ON→${onResult}`;
        }
      } catch (e) {
        results['SSR-S3-bank-method'] = `FAIL: ${e.message.split('\n')[0]}`;
        try {
          await ssrGotoGateway(ssrPage); await ssrSelectCurrencyTab(ssrPage);
          const cb = ssrPage.getByRole('checkbox', { name: 'Gateway Transfer' });
          if (!(await cb.isChecked().catch(() => false))) await cb.click({ force: true });
          await ssrSubmit(ssrPage);
        } catch {}
      }
      console.log(`>> [SSR-S3] ${results['SSR-S3-bank-method']}`);
    } else {
      results['SSR-S3-bank-method'] = 'SKIP — bank method not in fixture';
      console.log(`>> [SSR-S3] ${results['SSR-S3-bank-method']}`);
    }

    // ── SSR-S4: Bank ON/OFF → Playsite ────────────────────────────────────
    if (bankMethod && testBankName) {
      console.log(`\n>> [SSR-S4] Bank "${testBankName}" ON/OFF → Playsite`);
      try {
        await ssrGotoGateway(ssrPage);
        await ssrSelectCurrencyTab(ssrPage);
        await snap(ssrPage, `SSR-S4a - Bank "${testBankName}" Settings`);

        const bankRow  = ssrPage.getByRole('row', { name: testBankName });
        const bankCb   = bankRow.getByRole('checkbox').first();
        const bankExists = await bankCb.count() > 0;

        if (!bankExists) {
          results['SSR-S4-bank-toggle'] = `SKIP — bank "${testBankName}" row not found`;
        } else {
          if (await bankCb.isChecked().catch(() => true)) await bankCb.click({ force: true });
          await ssrSubmit(ssrPage);
          await snap(ssrPage, `SSR-S4b - Bank OFF`);
          const offResult = await playSiteCheckBank(playerPage, bankMethod, testBankName, 'SSR-S4c - Playsite Bank OFF');
          console.log(`>> [SSR-S4] Bank OFF → Playsite: ${offResult}`);

          await ssrGotoGateway(ssrPage);
          await ssrSelectCurrencyTab(ssrPage);
          const bankRow2 = ssrPage.getByRole('row', { name: testBankName });
          const bankCb2  = bankRow2.getByRole('checkbox').first();
          if (!(await bankCb2.isChecked().catch(() => false))) await bankCb2.click({ force: true });
          await ssrSubmit(ssrPage);
          await snap(ssrPage, `SSR-S4d - Bank ON`);
          const onResult = await playSiteCheckBank(playerPage, bankMethod, testBankName, 'SSR-S4e - Playsite Bank ON');
          console.log(`>> [SSR-S4] Bank ON → Playsite: ${onResult}`);

          results['SSR-S4-bank-toggle'] = (offResult === 'hidden' && onResult === 'visible')
            ? `PASS — "${testBankName}" OFF→hidden, ON→visible`
            : `FAIL — OFF→${offResult}, ON→${onResult}`;
        }
      } catch (e) {
        results['SSR-S4-bank-toggle'] = `FAIL: ${e.message.split('\n')[0]}`;
        try {
          await ssrGotoGateway(ssrPage); await ssrSelectCurrencyTab(ssrPage);
          const row = ssrPage.getByRole('row', { name: testBankName });
          const cb  = row.getByRole('checkbox').first();
          if (!(await cb.isChecked().catch(() => false))) await cb.click({ force: true });
          await ssrSubmit(ssrPage);
        } catch {}
      }
      console.log(`>> [SSR-S4] ${results['SSR-S4-bank-toggle']}`);
    } else {
      results['SSR-S4-bank-toggle'] = testBankName ? 'SKIP — no bank method' : `SKIP — no enabled bank for ${testCurrency}`;
      console.log(`>> [SSR-S4] ${results['SSR-S4-bank-toggle']}`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // SECTION C — Min/Max Validation
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n>> ════════════════════════════════════════════');
    console.log('>> SECTION C — Min/Max Validation');
    console.log('>> ════════════════════════════════════════════');

    for (const [methodName, method] of enabledMethods) {
      console.log(`\n>> ===== Min/Max: ${CONFIG.gatewayName} — ${methodName} [${testCurrency}] =====`);
      try {
        const navResult = await navigateToAmountStep(playerPage, method);
        if (navResult !== 'OK') {
          console.log(`>> ${navResult}`);
          results[`${methodName}-minmax`] = navResult;
          continue;
        }
        await snap(playerPage, `${methodName}-C-01 - Deposit Page`);

        const displayedMinText = await playerPage.locator('.redeposit2__limit-amount').nth(0).innerText().catch(() => '');
        const displayedMaxText = await playerPage.locator('.redeposit2__limit-amount').nth(1).innerText().catch(() => '');
        const displayedMin = parseDisplayedLimit(displayedMinText);
        const displayedMax = parseDisplayedLimit(displayedMaxText);
        const fixtureMin   = method.limits?.[testCurrency]?.min;
        const fixtureMax   = method.limits?.[testCurrency]?.max;

        console.log(`>> Playsite min: "${displayedMinText.trim()}"  max: "${displayedMaxText.trim()}"`);
        console.log(`>> Fixture [${testCurrency}] min: ${fixtureMin ?? 'N/A'}  max: ${fixtureMax ?? 'N/A'}`);

        const testMin  = displayedMin > 0 ? displayedMin : (fixtureMin || 10);
        const testMax  = displayedMax > 0 ? displayedMax : (fixtureMax || 30000);
        const belowMin = testMin > 1 ? testMin - 1 : 0;
        const aboveMax = testMax + 1;
        console.log(`>> Test amounts — belowMin: ${belowMin}  aboveMax: ${aboveMax}`);

        const minCheck = await checkAmountValidation(playerPage, belowMin, 'MIN');
        await snap(playerPage, `${methodName}-C-02 - Below Min (${belowMin})`);
        results[`${methodName}-minmax`] = minCheck.passed
          ? `PASS — ${minCheck.message}` : `FAIL — ${minCheck.message}`;
        console.log(`>> [C-min] ${results[`${methodName}-minmax`]}`);

        const maxCheck = await checkAmountValidation(playerPage, aboveMax, 'MAX');
        await snap(playerPage, `${methodName}-C-03 - Above Max (${aboveMax})`);
        results[`${methodName}-maxcheck`] = maxCheck.passed
          ? `PASS — ${maxCheck.message}` : `FAIL — ${maxCheck.message}`;
        console.log(`>> [C-max] ${results[`${methodName}-maxcheck`]}`);

      } catch (err) {
        results[`${methodName}-minmax`] = `FAIL: ${err.message.split('\n')[0]}`;
        console.log(`>> ${CONFIG.gatewayName} ${methodName}: FAIL — ${err.message.split('\n')[0]}`);
      }
    }

  } finally {
    if (ssrPage)    await ssrPage.close({ runBeforeUnload: false }).catch(() => {});
    if (playerPage) await playerPage.close({ runBeforeUnload: false }).catch(() => {});
    if (ctx)        await ctx.close().catch(() => {});
  }

  // ── Summary ──────────────────────────────────────
  console.log('\n>> ════════════════════════════════════════════');
  console.log('>> PAYGATE SSR SETTINGS — SUMMARY');
  console.log('>> ════════════════════════════════════════════');
  for (const [k, v] of Object.entries(results)) console.log(`>>   ${k}: ${v}`);
  console.log(`>> Screenshots captured: ${screenshots.length}`);
  const allPassed = Object.values(results).every(r => r.startsWith('PASS') || r.startsWith('SKIP'));
  console.log(allPassed ? '>> RESULT: PASS' : '>> RESULT: FAIL');
});
