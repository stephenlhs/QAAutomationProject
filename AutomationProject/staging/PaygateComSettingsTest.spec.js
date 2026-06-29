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
const COM_BO_USERNAME = process.env.STAGING_COM_BO_USERNAME || '';
const COM_BO_PASSWORD = process.env.STAGING_COM_BO_PASSWORD || '';
const COM_BO_ROLE     = process.env.STAGING_COM_BO_ROLE     || 'Agent';

// Load fixture
const fixturesDir = join(__dirname, 'fixtures');
let CONFIG = null;
for (const f of readdirSync(fixturesDir).filter(f => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(fixturesDir, f), 'utf-8'));
  if (c.classIdentifier === gatewayId) { CONFIG = c; break; }
}
if (!CONFIG) { console.error(`No fixture for classIdentifier: "${gatewayId}"`); process.exit(1); }

const boBase                   = URLS.backoffice.replace('/login', '');
const COM_PAYMENT_STATUS_URL   = `${boBase}/dashboard/system-settings/payment-status`;
const COM_SETTINGS_URL         = process.env.STAGING_COM_SETTINGS_URL || `${boBase}/dashboard/cash-admin-settings/33107`;
const SSR_DEPOSIT_SETTINGS_URL = `${boBase}/dashboard/payment-gateway/deposit-individual-settings`;
const DEPOSIT_URL              = `${URLS.playsite}user/deposit`;
const MANIFEST_NAME            = 'manifest-paygate-com-settings.json';

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
async function loginCOMBO(browser) {
  const comCtx  = await browser.newContext();
  const comPage = await comCtx.newPage();
  await comPage.goto(URLS.backoffice, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await comPage.waitForTimeout(1000);
  const roleTab = comPage.locator('li').filter({ hasText: COM_BO_ROLE }).first();
  if (await roleTab.count()) await roleTab.click({ force: true }).catch(() => {});
  await comPage.waitForTimeout(300);
  await comPage.getByRole('textbox', { name: 'Username' }).fill(COM_BO_USERNAME);
  await comPage.getByRole('textbox', { name: 'Password' }).fill(COM_BO_PASSWORD);
  const cap = new CaptchaHelper(comPage, 'com-bo');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const captchaImg  = comPage.getByRole('img').first();
    const captchaText = await cap.solve(captchaImg);
    if (captchaText.length !== 4) { await captchaImg.click(); await comPage.waitForTimeout(1000); continue; }
    await comPage.getByRole('textbox', { name: 'Captcha' }).fill(captchaText);
    await comPage.getByRole('button', { name: 'Login' }).click();
    await comPage.waitForTimeout(1500);
    if (!comPage.url().includes('/login')) break;
    await captchaImg.click();
    await comPage.waitForTimeout(1000);
  }
  if (comPage.url().includes('/login')) throw new Error('COM BO login failed after 3 attempts');
  await dismissModals(comPage);
  console.log('>> [COM BO] Login successful');
  return { comCtx, comPage };
}

async function loginSSRBO(browser) {
  const ssrCtx  = await browser.newContext();
  const ssrPage = await ssrCtx.newPage();
  const bo  = new BackofficePage(ssrPage, 'backoffice');
  const cap = new CaptchaHelper(ssrPage, 'backoffice');
  await bo.loginAndSaveSession(BACKOFFICE.username, BACKOFFICE.password, cap, BACKOFFICE.sessionPath, BACKOFFICE.twoFASecret);
  await bo.closeExtraTabs();
  await dismissModals(ssrPage);
  console.log('>> [SSR BO] Login successful');
  return { ssrCtx, ssrPage };
}

async function loginPlaysite(browser) {
  const playerCtx  = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  const lp  = new LoginPage(playerPage, 'player');
  const cap = new CaptchaHelper(playerPage, 'player');
  await lp.loginAndSaveSession(PLAYER.username, PLAYER.password, cap, PLAYER.sessionPath);
  console.log('>> [Playsite] Login successful');
  return { playerCtx, playerPage };
}

// ─── COM BO helpers ───────────────────────────────
async function comGotoGatewaySettings(comPage) {
  await comPage.goto(COM_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await comPage.waitForTimeout(1500);
  const pgTab = comPage.locator('.nav-tabs a, .nav-item a, li a').filter({ hasText: 'Payment Gateway' }).first();
  if (await pgTab.count()) await pgTab.click({ force: true });
  await comPage.waitForTimeout(1000);
  const vaderItem = comPage.locator('ul li a, .list-group-item a').filter({ hasText: /VaderPay.*C2|C2.*VaderPay/ }).first();
  if (await vaderItem.count()) {
    await vaderItem.click({ force: true });
  } else {
    await comPage.locator('li, .list-group-item').filter({ hasText: 'VaderPay (C2)' }).first().click({ force: true });
  }
  await comPage.waitForTimeout(1000);
}

// Click a currency tab (MYR, THB, etc.) inside the "Turn on Bank & QR" section
async function comSelectBankQRTab(comPage, currency) {
  const tab = comPage.locator('a, button').filter({ hasText: new RegExp(`^${currency}$`) }).first();
  await tab.click({ force: true });
  await comPage.waitForTimeout(800);
}

async function comSave(comPage) {
  await comPage.getByRole('button', { name: 'Save Changes' }).click({ force: true });
  await comPage.waitForTimeout(2000);
}

async function comGotoPaymentStatus(comPage) {
  await comPage.goto(COM_PAYMENT_STATUS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await comPage.waitForTimeout(1000);
  await comPage.locator('#txtSearch').fill('VaderPayC2');
  await comPage.getByRole('button', { name: 'Search' }).click();
  await comPage.waitForTimeout(1500);
  return comPage.locator('payment-status-element')
    .filter({ hasText: 'VaderPayC2' })
    .filter({ hasNotText: 'Withdraw' })
    .filter({ hasNotText: 'EWallet' })
    .first();
}

// ─── SSR BO verification helpers ─────────────────
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

// C1: Check if C2 gateway appears in the SSR left panel list
async function ssrCheckC2Exists(ssrPage, label) {
  await ssrPage.goto(SSR_DEPOSIT_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ssrPage.waitForTimeout(2000);
  const item = ssrPage.locator('ul li, .list-group-item').filter({ hasText: CONFIG.gatewayName }).first();
  const result = await item.isVisible({ timeout: 3000 }).catch(() => false) ? 'visible' : 'hidden';
  await snap(ssrPage, label);
  return result;
}

// C2: When "Turn on Bank & QR" is OFF, Gateway Transfer + QR Pay sections disappear in SSR.
//     Check both — return 'visible' if either is found, 'hidden' if neither.
async function ssrCheckBankQRSections(ssrPage, label) {
  await ssrGotoGateway(ssrPage);
  await ssrSelectCurrencyTab(ssrPage);
  await ssrPage.waitForTimeout(800);
  const gtEl = ssrPage.locator('label, td, th, .checkbox').filter({ hasText: /Gateway Transfer/i }).first();
  const qrEl = ssrPage.locator('label, td, th, .checkbox').filter({ hasText: /QR Pay/i }).first();
  const gtVisible = await gtEl.isVisible({ timeout: 2000 }).catch(() => false);
  const qrVisible = await qrEl.isVisible({ timeout: 2000 }).catch(() => false);
  await snap(ssrPage, label);
  console.log(`>> [SSR] Gateway Transfer: ${gtVisible}, QR Pay: ${qrVisible}`);
  return (gtVisible || qrVisible) ? 'visible' : 'hidden';
}

// C3: Check if a specific bank row is visible in the SSR deposit settings bank table
async function ssrCheckBankRow(ssrPage, bankName, label) {
  await ssrGotoGateway(ssrPage);
  await ssrSelectCurrencyTab(ssrPage);
  await ssrPage.waitForTimeout(800);
  const bankRow = ssrPage.getByRole('row', { name: bankName }).first();
  const visible = await bankRow.isVisible({ timeout: 3000 }).catch(() => false);
  await snap(ssrPage, label);
  console.log(`>> [SSR] Bank row "${bankName}": ${visible ? 'visible' : 'hidden'}`);
  return visible ? 'visible' : 'hidden';
}

// C4: Check if Merchant ID label is visible in SSR gateway settings
async function ssrCheckMerchantId(ssrPage, label) {
  await ssrGotoGateway(ssrPage);
  await ssrPage.waitForTimeout(800);
  const el = ssrPage.locator('label, td, th, span').filter({ hasText: /Merchant\s*ID/i }).first();
  const result = await el.isVisible({ timeout: 3000 }).catch(() => false) ? 'visible' : 'hidden';
  await snap(ssrPage, label);
  return result;
}

// ─── Playsite helpers (C5–C6) ────────────────────
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

// C5: Check if gateway card is visible on playsite (Prod on/off)
async function playSiteCheckGateway(playerPage, method, label) {
  await playerPage.goto(DEPOSIT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await playerPage.waitForTimeout(1500);
  await playSiteSelectPkgMethod(playerPage, method);
  const visible = await (await playSiteGetCard(playerPage)).isVisible({ timeout: 3000 }).catch(() => false);
  await snap(playerPage, label);
  return visible ? 'visible' : 'hidden';
}

// C6: Check if gateway card shows maintenance state on playsite
async function playSiteCheckMaintenance(playerPage, method, label) {
  await playerPage.goto(DEPOSIT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await playerPage.waitForTimeout(1500);
  await playSiteSelectPkgMethod(playerPage, method);
  const card = await playSiteGetCard(playerPage);
  if (!(await card.isVisible({ timeout: 3000 }).catch(() => false))) {
    await snap(playerPage, label);
    return 'hidden';
  }
  const cardText    = (await card.innerText().catch(() => '')).toLowerCase();
  const cardHtml    = (await card.innerHTML().catch(() => '')).toLowerCase();
  const hasMaintCls = await card.locator('[class*="maintenance"],[class*="disabled"],[class*="unavailable"]').count() > 0;
  if (cardText.includes('maintenance') || cardHtml.includes('maintenance') || hasMaintCls) {
    await snap(playerPage, label);
    return 'maintenance';
  }
  await card.click({ force: true });
  await playerPage.waitForTimeout(2000);
  const swalText = (await playerPage.locator('.swal2-modal, .swal2-container').innerText().catch(() => '')).toLowerCase();
  const errText  = (await playerPage.locator('.alert, .error-message, [class*="error"], [class*="alert"]').innerText().catch(() => '')).toLowerCase();
  const bodyText = (await playerPage.locator('.redeposit, .deposit-form, [class*="deposit"]').innerText().catch(() => '')).toLowerCase();
  const hasMaint = swalText.includes('maintenance') || errText.includes('maintenance') || bodyText.includes('maintenance') ||
    swalText.includes('unavailable') || swalText.includes('not available');
  await snap(playerPage, label);
  return hasMaint ? 'maintenance' : 'visible';
}

// ─────────────────────────────────────────────────────────────────────────────
// Test — COM level only (staging only, requires COM BO credentials)
//
// COM-C1: C2 Enable/Disable         → verify in SSR BO (C2 in left panel list)
// COM-C2: Turn on Bank & QR         → verify QR Pay section in SSR BO
// COM-C3: Turn on Bank & QR         → verify specific bank under Gateway Transfer in SSR BO
// COM-C4: Display Setting           → verify Merchant ID in SSR BO
// COM-C5: Prod On/Off (pay status)  → verify in Playsite (card visible/hidden)
// COM-C6: Maintenance (pay status)  → verify in Playsite (maintenance state)
// ─────────────────────────────────────────────────────────────────────────────
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('Paygate COM settings — C2 toggle, Bank&QR, Display, Prod, Maintenance', async ({ browser }) => {
  test.setTimeout(0);
  const results = {};

  if (!COM_BO_USERNAME || !COM_BO_PASSWORD) {
    console.log('>> SKIP — COM credentials not configured (add STAGING_COM_BO_USERNAME/PASSWORD to .env)');
    console.log('>> RESULT: SKIP');
    return;
  }

  const enabledMethods = Object.entries(CONFIG.deposit.methods).filter(([name, m]) => {
    if (methodOverride) return name === methodOverride;
    return m.enabled;
  });
  const firstMethod  = enabledMethods[0]?.[1];
  const bankMethod   = (enabledMethods.find(([n]) => n === 'Bank') || enabledMethods.find(([n]) => n.toLowerCase().includes('bank')))?.[1];
  const testBankName = bankMethod?.banks?.[testCurrency]?.find(b => b.enabled)?.name || null;

  let comCtx = null, comPage = null;
  let ssrCtx = null, ssrPage = null;
  let playerCtx = null, playerPage = null;

  try {
    console.log('>> Opening COM BO, SSR BO, and Playsite simultaneously...');
    ({ comCtx, comPage }       = await loginCOMBO(browser));
    ({ ssrCtx, ssrPage }       = await loginSSRBO(browser));
    ({ playerCtx, playerPage } = await loginPlaysite(browser));

    await snap(comPage,    'COM-Setup - COM BO');
    await snap(ssrPage,    'COM-Setup - SSR BO');
    await snap(playerPage, 'COM-Setup - Playsite');

    console.log('\n>> ════════════════════════════════════════════');
    console.log('>> COM-level Settings');
    console.log('>> ════════════════════════════════════════════');

    // ── COM-C1: C2 Enable/Disable → verify in SSR BO ────────────────────────
    // Turn OFF C2 in COM → SSR left panel should not show C2
    // Turn ON  C2 in COM → SSR left panel should show C2
    console.log('\n>> [COM-C1] C2 Enable/Disable → SSR BO');
    try {
      await comGotoGatewaySettings(comPage);
      await snap(comPage, 'COM-C1a - COM Gateway Settings');
      const c2Cb  = comPage.getByRole('checkbox', { name: /VaderPay.*C2|C2.*VaderPay/i }).first();
      const wasOn = await c2Cb.isChecked().catch(() => true);

      if (wasOn) await c2Cb.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C1b - C2 OFF saved');
      const offResult = await ssrCheckC2Exists(ssrPage, 'COM-C1c - SSR C2 OFF');
      console.log(`>> [COM-C1] C2 OFF → SSR: ${offResult}`);

      await comGotoGatewaySettings(comPage);
      const c2Cb2 = comPage.getByRole('checkbox', { name: /VaderPay.*C2|C2.*VaderPay/i }).first();
      if (!(await c2Cb2.isChecked().catch(() => false))) await c2Cb2.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C1d - C2 ON saved');
      const onResult = await ssrCheckC2Exists(ssrPage, 'COM-C1e - SSR C2 ON');
      console.log(`>> [COM-C1] C2 ON → SSR: ${onResult}`);

      results['COM-C1-c2-toggle'] = (offResult === 'hidden' && onResult === 'visible')
        ? `PASS — C2 OFF→SSR hidden, ON→SSR visible`
        : `FAIL — OFF→${offResult}, ON→${onResult}`;
    } catch (e) {
      results['COM-C1-c2-toggle'] = `FAIL: ${e.message.split('\n')[0]}`;
      try {
        await comGotoGatewaySettings(comPage);
        const cb = comPage.getByRole('checkbox', { name: /VaderPay.*C2|C2.*VaderPay/i }).first();
        if (!(await cb.isChecked().catch(() => false))) await cb.click({ force: true });
        await comSave(comPage);
      } catch {}
    }
    console.log(`>> [COM-C1] ${results['COM-C1-c2-toggle']}`);

    // ── COM-C2: "Turn on Bank & QR" toggle → verify in SSR BO ──────────────
    // "Turn on Bank & QR" is a gateway-level toggle that controls ALL payment methods
    // (bank, QR, ewallet) across all currencies for this gateway.
    // Turn OFF → SSR should not show Gateway Transfer or QR Pay sections under C2
    // Turn ON  → SSR shows Gateway Transfer + QR Pay sections
    console.log('\n>> [COM-C2] Turn on Bank & QR → SSR Gateway Transfer + QR Pay sections');
    try {
      await comGotoGatewaySettings(comPage);
      await snap(comPage, 'COM-C2a - COM Gateway Settings');
      const bankQrCb = comPage.getByRole('checkbox', { name: 'Turn on Bank & QR' });
      const wasOn    = await bankQrCb.isChecked().catch(() => true);

      if (wasOn) await bankQrCb.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C2b - Bank&QR OFF saved');
      const offResult = await ssrCheckBankQRSections(ssrPage, 'COM-C2c - SSR Bank&QR OFF');
      console.log(`>> [COM-C2] Bank&QR OFF → SSR: ${offResult}`);

      await comGotoGatewaySettings(comPage);
      const bankQrCb2 = comPage.getByRole('checkbox', { name: 'Turn on Bank & QR' });
      if (!(await bankQrCb2.isChecked().catch(() => false))) await bankQrCb2.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C2d - Bank&QR ON saved');
      const onResult = await ssrCheckBankQRSections(ssrPage, 'COM-C2e - SSR Bank&QR ON');
      console.log(`>> [COM-C2] Bank&QR ON → SSR: ${onResult}`);

      results['COM-C2-bankqr-toggle'] = (offResult === 'hidden' && onResult === 'visible')
        ? `PASS — Bank&QR: OFF→SSR hidden, ON→SSR visible`
        : `FAIL — OFF→${offResult}, ON→${onResult}`;
    } catch (e) {
      results['COM-C2-bankqr-toggle'] = `FAIL: ${e.message.split('\n')[0]}`;
      try {
        await comGotoGatewaySettings(comPage);
        const cb = comPage.getByRole('checkbox', { name: 'Turn on Bank & QR' });
        if (!(await cb.isChecked().catch(() => false))) await cb.click({ force: true });
        await comSave(comPage);
      } catch {}
    }
    console.log(`>> [COM-C2] ${results['COM-C2-bankqr-toggle']}`);

    // ── COM-C3: Individual bank toggle → verify specific bank row in SSR ────
    // With "Turn on Bank & QR" ON, each currency tab has individual bank checkboxes.
    // Uncheck a specific bank under the test currency tab in COM
    // → that bank row should disappear from SSR's Gateway Transfer bank list.
    console.log(`\n>> [COM-C3] Individual bank "${testBankName}" toggle under ${testCurrency} → SSR bank list`);
    if (!testBankName) {
      results['COM-C3-bank-row'] = `SKIP — no enabled bank found for ${testCurrency} in fixture`;
    } else {
      try {
        // Ensure Bank & QR is ON first (so bank checkboxes are visible in COM)
        await comGotoGatewaySettings(comPage);
        const bankQrCb = comPage.getByRole('checkbox', { name: 'Turn on Bank & QR' });
        if (!(await bankQrCb.isChecked().catch(() => false))) {
          await bankQrCb.click({ force: true });
          await comSave(comPage);
          await comGotoGatewaySettings(comPage);
        }
        await snap(comPage, 'COM-C3a - COM Gateway Settings (Bank&QR ON)');

        // Select the test currency tab to see its bank list
        await comSelectBankQRTab(comPage, testCurrency);
        await snap(comPage, `COM-C3b - ${testCurrency} tab`);

        // Uncheck the specific bank
        const bankRow = comPage.getByRole('row', { name: testBankName }).first();
        const bankCb  = bankRow.getByRole('checkbox').first();
        const wasOn   = await bankCb.isChecked().catch(() => true);
        if (wasOn) await bankCb.click({ force: true });
        await comSave(comPage);
        await snap(comPage, `COM-C3c - "${testBankName}" OFF saved`);
        const offResult = await ssrCheckBankRow(ssrPage, testBankName, `COM-C3d - SSR "${testBankName}" OFF`);
        console.log(`>> [COM-C3] Bank "${testBankName}" OFF → SSR: ${offResult}`);

        // Re-check the bank
        await comGotoGatewaySettings(comPage);
        await comSelectBankQRTab(comPage, testCurrency);
        const bankRow2 = comPage.getByRole('row', { name: testBankName }).first();
        const bankCb2  = bankRow2.getByRole('checkbox').first();
        if (!(await bankCb2.isChecked().catch(() => false))) await bankCb2.click({ force: true });
        await comSave(comPage);
        await snap(comPage, `COM-C3e - "${testBankName}" ON saved`);
        const onResult = await ssrCheckBankRow(ssrPage, testBankName, `COM-C3f - SSR "${testBankName}" ON`);
        console.log(`>> [COM-C3] Bank "${testBankName}" ON → SSR: ${onResult}`);

        results['COM-C3-bank-row'] = (offResult === 'hidden' && onResult === 'visible')
          ? `PASS — "${testBankName}": OFF→SSR hidden, ON→SSR visible`
          : `FAIL — OFF→${offResult}, ON→${onResult}`;
      } catch (e) {
        results['COM-C3-bank-row'] = `FAIL: ${e.message.split('\n')[0]}`;
        // Recovery: re-enable the bank
        try {
          await comGotoGatewaySettings(comPage);
          await comSelectBankQRTab(comPage, testCurrency);
          const br = comPage.getByRole('row', { name: testBankName }).first();
          const cb = br.getByRole('checkbox').first();
          if (!(await cb.isChecked().catch(() => false))) await cb.click({ force: true });
          await comSave(comPage);
        } catch {}
      }
    }
    console.log(`>> [COM-C3] ${results['COM-C3-bank-row']}`);

    // ── COM-C4: Display Setting → verify Merchant ID in SSR BO ──────────────
    // Turn OFF → SSR should not show Merchant ID field
    // Turn ON  → SSR should show Merchant ID field
    console.log('\n>> [COM-C4] Display Setting → SSR Merchant ID');
    try {
      await comGotoGatewaySettings(comPage);
      await snap(comPage, 'COM-C4a - COM Gateway Settings');
      const displayCb = comPage.getByRole('checkbox', { name: 'Display setting' });
      const wasOn     = await displayCb.isChecked().catch(() => true);

      if (wasOn) await displayCb.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C4b - Display OFF saved');
      const offResult = await ssrCheckMerchantId(ssrPage, 'COM-C4c - SSR Merchant ID OFF');
      console.log(`>> [COM-C4] Display OFF → SSR Merchant ID: ${offResult}`);

      await comGotoGatewaySettings(comPage);
      const displayCb2 = comPage.getByRole('checkbox', { name: 'Display setting' });
      if (!(await displayCb2.isChecked().catch(() => false))) await displayCb2.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C4d - Display ON saved');
      const onResult = await ssrCheckMerchantId(ssrPage, 'COM-C4e - SSR Merchant ID ON');
      console.log(`>> [COM-C4] Display ON → SSR Merchant ID: ${onResult}`);

      results['COM-C4-display'] = (offResult === 'hidden' && onResult === 'visible')
        ? `PASS — Merchant ID: Display OFF→hidden, ON→visible`
        : `FAIL — OFF→${offResult}, ON→${onResult}`;
    } catch (e) {
      results['COM-C4-display'] = `FAIL: ${e.message.split('\n')[0]}`;
      try {
        await comGotoGatewaySettings(comPage);
        const cb = comPage.getByRole('checkbox', { name: 'Display setting' });
        if (!(await cb.isChecked().catch(() => false))) await cb.click({ force: true });
        await comSave(comPage);
      } catch {}
    }
    console.log(`>> [COM-C4] ${results['COM-C4-display']}`);

    // ── COM-C5: Prod On/Off → verify in Playsite ────────────────────────────
    // Turn OFF → Playsite should not show C2 gateway card
    // Turn ON  → Playsite should show C2 gateway card
    console.log('\n>> [COM-C5] Prod On/Off → Playsite');
    try {
      const card = await comGotoPaymentStatus(comPage);
      await snap(comPage, 'COM-C5a - Payment Status');

      const getCardState = async (c) => {
        const txt = (await c.locator('.ibox-content').innerText().catch(() => '')).toLowerCase();
        console.log(`>> [COM-C5] Card status: "${txt.substring(0, 80).trim()}"`);
        return txt.includes('running') || (!txt.includes('maintenance') && !txt.includes('off'));
      };
      const handleSwal = async () => {
        const sc = comPage.locator('button.swal2-confirm').first();
        if (await sc.isVisible({ timeout: 3000 }).catch(() => false)) {
          await sc.click({ force: true });
          console.log('>> [COM-C5] SweetAlert confirmed');
        }
      };

      const prodToggle = card.locator('[data-original-title="Prod On/Off"]').first();
      const isOn = await getCardState(card);
      console.log(`>> [COM-C5] Current state: ${isOn ? 'ON' : 'OFF'}`);

      if (isOn) { await prodToggle.click({ force: true }); await handleSwal(); }
      await comPage.waitForTimeout(4000);
      await snap(comPage, 'COM-C5b - Prod OFF');
      const offResult = firstMethod
        ? await playSiteCheckGateway(playerPage, firstMethod, 'COM-C5c - Playsite Prod OFF')
        : 'SKIP';
      console.log(`>> [COM-C5] Prod OFF → Playsite: ${offResult}`);

      const card2       = await comGotoPaymentStatus(comPage);
      const isOn2       = await getCardState(card2);
      const prodToggle2 = card2.locator('[data-original-title="Prod On/Off"]').first();
      if (!isOn2) { await prodToggle2.click({ force: true }); await handleSwal(); }
      await comPage.waitForTimeout(4000);
      await snap(comPage, 'COM-C5d - Prod ON');
      const onResult = firstMethod
        ? await playSiteCheckGateway(playerPage, firstMethod, 'COM-C5e - Playsite Prod ON')
        : 'SKIP';
      console.log(`>> [COM-C5] Prod ON → Playsite: ${onResult}`);

      results['COM-C5-prod-toggle'] = (offResult === 'hidden' && onResult === 'visible')
        ? `PASS — Prod OFF→Playsite hidden, ON→visible`
        : `FAIL — OFF→${offResult}, ON→${onResult}`;
    } catch (e) {
      results['COM-C5-prod-toggle'] = `FAIL: ${e.message.split('\n')[0]}`;
      try {
        const c   = await comGotoPaymentStatus(comPage);
        const txt = (await c.locator('.ibox-content').innerText().catch(() => '')).toLowerCase();
        if (!txt.includes('running')) {
          await c.locator('[data-original-title="Prod On/Off"]').first().click({ force: true });
          const sc = comPage.locator('button.swal2-confirm').first();
          if (await sc.isVisible({ timeout: 3000 }).catch(() => false)) await sc.click({ force: true });
          await comPage.waitForTimeout(2000);
        }
      } catch {}
    }
    console.log(`>> [COM-C5] ${results['COM-C5-prod-toggle']}`);

    // ── COM-C6: Maintenance → verify in Playsite ────────────────────────────
    // Start Maintenance → Playsite should show maintenance state
    // Resume (Ready)    → Playsite should show normal card
    console.log('\n>> [COM-C6] Maintenance → Playsite');
    try {
      const card = await comGotoPaymentStatus(comPage);
      await snap(comPage, 'COM-C6a - Before Maintenance');

      const maintBtn = card.locator('button[data-target="#statusModal"]').first();
      await maintBtn.click({ force: true });
      await comPage.waitForTimeout(1000);
      await comPage.locator('#statusModal').waitFor({ state: 'visible', timeout: 8000 });
      await comPage.locator('#statusModal button[type="submit"]').click({ force: true });
      console.log('>> [COM-C6] "Start Maintenance" clicked');
      await comPage.waitForTimeout(4000);
      await snap(comPage, 'COM-C6b - Maintenance set');

      const maintResult = firstMethod
        ? await playSiteCheckMaintenance(playerPage, firstMethod, 'COM-C6c - Playsite Maintenance')
        : 'SKIP';
      console.log(`>> [COM-C6] Maintenance → Playsite: ${maintResult}`);

      const card2    = await comGotoPaymentStatus(comPage);
      await snap(comPage, 'COM-C6d-pre - Payment Status (maintenance active)');
      const readyBtn = card2.locator('button[data-original-title="Ready"]').first();
      const hasReady = await readyBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (hasReady) {
        await readyBtn.click({ force: true });
        console.log('>> [COM-C6] "Ready" clicked to resume');
        const swalConfirm = comPage.locator('button.swal2-confirm').first();
        if (await swalConfirm.isVisible({ timeout: 5000 }).catch(() => false)) {
          await swalConfirm.click({ force: true });
          console.log('>> [COM-C6] SweetAlert confirmed');
        }
      } else {
        const btns = await card2.locator('button').evaluateAll(els => els.map(e => `${e.getAttribute('data-original-title') || ''} ${e.textContent?.trim() || ''}`));
        console.log(`>> [COM-C6] WARNING — Ready button not found. Buttons: ${JSON.stringify(btns)}`);
      }
      await comPage.waitForTimeout(4000);
      await snap(comPage, 'COM-C6d - Resumed');

      const resumeResult = firstMethod
        ? await playSiteCheckMaintenance(playerPage, firstMethod, 'COM-C6e - Playsite after Resume')
        : 'SKIP';
      console.log(`>> [COM-C6] Resume → Playsite: ${resumeResult}`);

      results['COM-C6-maintenance'] = ((maintResult === 'maintenance' || maintResult === 'hidden') && resumeResult === 'visible')
        ? `PASS — maintenance→${maintResult}, resume→visible`
        : `FAIL — maintenance→${maintResult}, resume→${resumeResult}`;
    } catch (e) {
      results['COM-C6-maintenance'] = `FAIL: ${e.message.split('\n')[0]}`;
      try {
        const c  = await comGotoPaymentStatus(comPage);
        const rb = c.locator('button[data-original-title="Ready"]').first();
        if (await rb.isVisible({ timeout: 3000 }).catch(() => false)) {
          await rb.click({ force: true });
          const sc = comPage.locator('button.swal2-confirm').first();
          if (await sc.isVisible({ timeout: 3000 }).catch(() => false)) await sc.click({ force: true });
          await comPage.waitForTimeout(2000);
        }
      } catch {}
    }
    console.log(`>> [COM-C6] ${results['COM-C6-maintenance']}`);

  } finally {
    if (comPage)    await comPage.close({ runBeforeUnload: false }).catch(() => {});
    if (comCtx)     await comCtx.close().catch(() => {});
    if (ssrPage)    await ssrPage.close({ runBeforeUnload: false }).catch(() => {});
    if (ssrCtx)     await ssrCtx.close().catch(() => {});
    if (playerPage) await playerPage.close({ runBeforeUnload: false }).catch(() => {});
    if (playerCtx)  await playerCtx.close().catch(() => {});
  }

  // ── Summary ──────────────────────────────────────
  console.log('\n>> ════════════════════════════════════════════');
  console.log('>> PAYGATE COM SETTINGS — SUMMARY');
  console.log('>> ════════════════════════════════════════════');
  for (const [k, v] of Object.entries(results)) console.log(`>>   ${k}: ${v}`);
  console.log(`>> Screenshots captured: ${screenshots.length}`);
  const allPassed = Object.values(results).every(r => r.startsWith('PASS') || r.startsWith('SKIP'));
  console.log(allPassed ? '>> RESULT: PASS' : '>> RESULT: FAIL');
});
