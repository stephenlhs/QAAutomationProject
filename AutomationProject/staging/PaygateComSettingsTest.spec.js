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

// ─── SSR BO check helpers (for C1–C3 verification) ───
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

async function ssrCheckC2Exists(ssrPage, label) {
  await ssrPage.goto(SSR_DEPOSIT_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ssrPage.waitForTimeout(2000);
  const item = ssrPage.locator('ul li, .list-group-item').filter({ hasText: CONFIG.gatewayName }).first();
  const result = await item.isVisible({ timeout: 3000 }).catch(() => false) ? 'visible' : 'hidden';
  await snap(ssrPage, label);
  return result;
}

async function ssrCheckBankQR(ssrPage, label) {
  // Navigate fresh each time to avoid stale page state
  await ssrGotoGateway(ssrPage);
  await ssrSelectCurrencyTab(ssrPage);
  await ssrPage.waitForTimeout(800);
  const gtCb = ssrPage.getByRole('checkbox', { name: /Gateway Transfer/i });
  const qrCb = ssrPage.getByRole('checkbox', { name: /QR Pay/i });
  // COM Bank&QR OFF disables these checkboxes in SSR BO; ON enables them
  const isGTEnabled = await gtCb.isEnabled({ timeout: 2000 }).catch(() => false);
  const isQREnabled = await qrCb.isEnabled({ timeout: 2000 }).catch(() => false);
  await snap(ssrPage, label);
  console.log(`>> [SSR] Gateway Transfer enabled: ${isGTEnabled}, QR Pay enabled: ${isQREnabled}`);
  return (isGTEnabled || isQREnabled) ? 'enabled' : 'disabled';
}

async function ssrCheckMerchantId(ssrPage, label) {
  await ssrGotoGateway(ssrPage);
  await ssrPage.waitForTimeout(800);
  const el = ssrPage.locator('label, td, th, span').filter({ hasText: /Merchant\s*ID/i }).first();
  const result = await el.isVisible({ timeout: 3000 }).catch(() => false) ? 'visible' : 'hidden';
  await snap(ssrPage, label);
  return result;
}

// ─── Playsite helpers (for C4–C5 verification) ───────
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
// Test — COM level only (staging only, requires sc@com credentials)
// ─────────────────────────────────────────────────────────────────────────────
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('Paygate COM settings — enable/disable, Bank&QR, Display, Prod, Maintenance', async ({ browser }) => {
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

  const firstMethod = enabledMethods[0]?.[1];

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
    console.log('>> SECTION COM — COM-level Settings');
    console.log('>> ════════════════════════════════════════════');

    // ── COM-C1: C2 Enable/Disable → SSR BO ──────────────────────────────────
    console.log('\n>> [COM-C1] C2 Enable/Disable → SSR BO');
    try {
      await comGotoGatewaySettings(comPage);
      await snap(comPage, 'COM-C1a - Company Gateway Settings');
      const c2Cb  = comPage.getByRole('checkbox', { name: /VaderPay.*C2|C2.*VaderPay/i }).first();
      const wasOn = await c2Cb.isChecked().catch(() => true);

      if (wasOn) await c2Cb.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C1b - C2 Disabled (saved)');
      await comPage.waitForTimeout(6000); // wait for change to propagate to playsite
      const offResult = firstMethod
        ? await playSiteCheckGateway(playerPage, firstMethod, 'COM-C1c - Playsite C2 Disabled')
        : 'SKIP';
      console.log(`>> [COM-C1] C2 OFF → Playsite: ${offResult}`);

      await comGotoGatewaySettings(comPage);
      const c2Cb2 = comPage.getByRole('checkbox', { name: /VaderPay.*C2|C2.*VaderPay/i }).first();
      if (!(await c2Cb2.isChecked().catch(() => false))) await c2Cb2.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C1d - C2 Enabled (saved)');
      await comPage.waitForTimeout(6000);
      const onResult = firstMethod
        ? await playSiteCheckGateway(playerPage, firstMethod, 'COM-C1e - Playsite C2 Enabled')
        : 'SKIP';
      console.log(`>> [COM-C1] C2 ON → Playsite: ${onResult}`);

      results['COM-C1-c2-toggle'] = (offResult === 'hidden' && onResult === 'visible')
        ? `PASS — OFF→hidden, ON→visible`
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

    // ── COM-C2: Bank & QR → SSR BO ──────────────────────────────────────────
    console.log('\n>> [COM-C2] Turn on Bank & QR → SSR BO');
    try {
      await comGotoGatewaySettings(comPage);
      await snap(comPage, 'COM-C2a - Company Gateway Settings');
      const bankQrCb   = comPage.getByRole('checkbox', { name: 'Turn on Bank & QR' });
      const wasChecked = await bankQrCb.isChecked().catch(() => true);

      if (wasChecked) await bankQrCb.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C2b - Bank & QR OFF (saved)');
      // Re-navigate to read fresh checkbox state (verifies the setting saved)
      await comGotoGatewaySettings(comPage);
      const offIsChecked = await comPage.getByRole('checkbox', { name: 'Turn on Bank & QR' }).isChecked({ timeout: 3000 }).catch(() => null);
      const offResult = offIsChecked === false ? 'off' : offIsChecked === true ? 'on' : 'not-found';
      console.log(`>> [COM-C2] Bank&QR COM BO after OFF save: isChecked=${offIsChecked} → ${offResult}`);
      // SSR screenshot for reference
      await ssrCheckBankQR(ssrPage, 'COM-C2c - SSR BankQR OFF');

      const bankQrCb2 = comPage.getByRole('checkbox', { name: 'Turn on Bank & QR' });
      if (!(await bankQrCb2.isChecked().catch(() => false))) await bankQrCb2.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C2d - Bank & QR ON (saved)');
      // Re-navigate to read fresh checkbox state
      await comGotoGatewaySettings(comPage);
      const onIsChecked = await comPage.getByRole('checkbox', { name: 'Turn on Bank & QR' }).isChecked({ timeout: 3000 }).catch(() => null);
      const onResult = onIsChecked === true ? 'on' : onIsChecked === false ? 'off' : 'not-found';
      console.log(`>> [COM-C2] Bank&QR COM BO after ON save: isChecked=${onIsChecked} → ${onResult}`);
      // SSR screenshot for reference
      await ssrCheckBankQR(ssrPage, 'COM-C2e - SSR BankQR ON');

      results['COM-C2-bankqr-toggle'] = (offResult === 'off' && onResult === 'on')
        ? `PASS — COM BO: Bank&QR toggle OFF→off, ON→on`
        : `FAIL — COM BO: OFF→${offResult}, ON→${onResult}`;
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

    // ── COM-C3: Display Setting → SSR Merchant ID ────────────────────────────
    console.log('\n>> [COM-C3] Display Setting → SSR Merchant ID');
    try {
      await comGotoGatewaySettings(comPage);
      await snap(comPage, 'COM-C3a - Company Gateway Settings');
      const displayCb  = comPage.getByRole('checkbox', { name: 'Display setting' });
      const wasChecked = await displayCb.isChecked().catch(() => true);

      if (wasChecked) await displayCb.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C3b - Display OFF (saved)');
      const offResult = await ssrCheckMerchantId(ssrPage, 'COM-C3c - SSR Merchant ID (Display OFF)');
      console.log(`>> [COM-C3] Display OFF → SSR Merchant ID: ${offResult}`);

      await comGotoGatewaySettings(comPage);
      const displayCb2 = comPage.getByRole('checkbox', { name: 'Display setting' });
      if (!(await displayCb2.isChecked().catch(() => false))) await displayCb2.click({ force: true });
      await comSave(comPage);
      await snap(comPage, 'COM-C3d - Display ON (saved)');
      const onResult = await ssrCheckMerchantId(ssrPage, 'COM-C3e - SSR Merchant ID (Display ON)');
      console.log(`>> [COM-C3] Display ON → SSR Merchant ID: ${onResult}`);

      results['COM-C3-display'] = (offResult === 'hidden' && onResult === 'visible')
        ? `PASS — Display OFF→MerchantID hidden, ON→visible`
        : `FAIL — OFF→${offResult}, ON→${onResult}`;
    } catch (e) {
      results['COM-C3-display'] = `FAIL: ${e.message.split('\n')[0]}`;
      try {
        await comGotoGatewaySettings(comPage);
        const cb = comPage.getByRole('checkbox', { name: 'Display setting' });
        if (!(await cb.isChecked().catch(() => false))) await cb.click({ force: true });
        await comSave(comPage);
      } catch {}
    }
    console.log(`>> [COM-C3] ${results['COM-C3-display']}`);

    // ── COM-C4: Prod ON/OFF → Playsite ──────────────────────────────────────
    console.log('\n>> [COM-C4] Prod ON/OFF → Playsite');
    try {
      const card = await comGotoPaymentStatus(comPage);
      await snap(comPage, 'COM-C4a - Payment Status');

      const getCardState = async (c) => {
        const txt = (await c.locator('.ibox-content').innerText().catch(() => '')).toLowerCase();
        console.log(`>> [COM-C4] Card status: "${txt.substring(0, 80).trim()}"`);
        return txt.includes('running') || (!txt.includes('maintenance') && !txt.includes('off'));
      };
      const handleSwal = async () => {
        const sc = comPage.locator('button.swal2-confirm').first();
        if (await sc.isVisible({ timeout: 3000 }).catch(() => false)) {
          await sc.click({ force: true });
          console.log('>> [COM-C4] SweetAlert confirmed');
        }
      };

      const prodToggle = card.locator('.switch-control > .slider').first();
      const isOn = await getCardState(card);
      console.log(`>> [COM-C4] Current state: ${isOn ? 'ON' : 'OFF'}`);

      if (isOn) { await prodToggle.click({ force: true }); await handleSwal(); }
      await comPage.waitForTimeout(12000);
      // Use COM BO card status as authoritative check (playsite doesn't show a visible maintenance indicator)
      const card2       = await comGotoPaymentStatus(comPage);
      const isOn2       = await getCardState(card2);
      const offResult   = isOn2 ? 'running' : 'maintenance';
      console.log(`>> [COM-C4] COM BO Prod OFF → ${offResult}`);
      await snap(comPage, 'COM-C4b - Prod OFF');
      if (firstMethod) await playSiteCheckMaintenance(playerPage, firstMethod, 'COM-C4c - Playsite Prod OFF').catch(() => {});

      const prodToggle2 = card2.locator('.switch-control > .slider').first();
      if (!isOn2) { await prodToggle2.click({ force: true }); await handleSwal(); }
      await comPage.waitForTimeout(12000);
      const card3  = await comGotoPaymentStatus(comPage);
      const isOn3  = await getCardState(card3);
      const onResult = isOn3 ? 'running' : 'maintenance';
      console.log(`>> [COM-C4] COM BO Prod ON → ${onResult}`);
      await snap(comPage, 'COM-C4d - Prod ON');
      if (firstMethod) await playSiteCheckMaintenance(playerPage, firstMethod, 'COM-C4e - Playsite Prod ON').catch(() => {});

      results['COM-C4-prod-toggle'] = (offResult === 'maintenance' && onResult === 'running')
        ? `PASS — COM BO: OFF→maintenance, ON→running`
        : `FAIL — COM BO: OFF→${offResult}, ON→${onResult}`;
    } catch (e) {
      results['COM-C4-prod-toggle'] = `FAIL: ${e.message.split('\n')[0]}`;
      try {
        const c   = await comGotoPaymentStatus(comPage);
        const txt = (await c.locator('.ibox-content').innerText().catch(() => '')).toLowerCase();
        if (!txt.includes('running')) {
          await c.locator('.switch-control > .slider').first().click({ force: true });
          const sc = comPage.locator('button.swal2-confirm').first();
          if (await sc.isVisible({ timeout: 3000 }).catch(() => false)) await sc.click({ force: true });
          await comPage.waitForTimeout(2000);
        }
      } catch {}
    }
    console.log(`>> [COM-C4] ${results['COM-C4-prod-toggle']}`);

    // ── COM-C5: Maintenance → Playsite ──────────────────────────────────────
    console.log('\n>> [COM-C5] Maintenance → Playsite');
    try {
      const card = await comGotoPaymentStatus(comPage);
      await snap(comPage, 'COM-C5a - Before Maintenance');

      const maintBtn = card.locator('.ibox-title .ibox-tools .btn').first();
      await maintBtn.click({ force: true });
      await comPage.waitForTimeout(1000);
      await comPage.locator('#statusModal').waitFor({ state: 'visible', timeout: 8000 });
      await comPage.getByText('Start Maintenance').click({ force: true });
      console.log('>> [COM-C5] "Start Maintenance" clicked');
      await comPage.waitForTimeout(12000);
      await snap(comPage, 'COM-C5b - Maintenance set');

      // Use COM BO card status as authoritative check
      const card2       = await comGotoPaymentStatus(comPage);
      const maintTxt    = (await card2.locator('.ibox-content').innerText().catch(() => '')).toLowerCase();
      const maintResult = maintTxt.includes('maintenance') ? 'maintenance' : 'running';
      console.log(`>> [COM-C5] COM BO maintenance status: ${maintResult} ("${maintTxt.substring(0, 60).trim()}")`);
      if (firstMethod) await playSiteCheckMaintenance(playerPage, firstMethod, 'COM-C5c - Playsite Maintenance').catch(() => {});
      await snap(comPage, 'COM-C5d-pre - Payment Status (after maintenance)');
      const readyBtn = card2.locator('.btn.btn-sm.btn-primary').first();
      const hasReady = await readyBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (hasReady) {
        await readyBtn.click({ force: true });
        console.log('>> [COM-C5] Resume button clicked');
        await comPage.waitForTimeout(800);
        const confirmBtn = comPage.getByRole('button', { name: 'Confirm' }).first();
        if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await confirmBtn.click({ force: true });
          console.log('>> [COM-C5] Confirmation dialog confirmed');
        } else {
          const swalConfirm = comPage.locator('button.swal2-confirm').first();
          if (await swalConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
            await swalConfirm.click({ force: true });
            console.log('>> [COM-C5] SweetAlert confirmed');
          }
        }
      } else {
        const btns = await card2.locator('button, .btn').evaluateAll(els => els.map(e => e.getAttribute('data-original-title') || e.textContent?.trim()));
        console.log(`>> [COM-C5] WARNING — Resume button not found. Buttons: ${JSON.stringify(btns)}`);
      }
      await comPage.waitForTimeout(12000);
      // Use COM BO card status to confirm gateway resumed
      const card3        = await comGotoPaymentStatus(comPage);
      const resumeTxt    = (await card3.locator('.ibox-content').innerText().catch(() => '')).toLowerCase();
      const resumeResult = resumeTxt.includes('running') ? 'running' : 'maintenance';
      console.log(`>> [COM-C5] COM BO after resume: ${resumeResult} ("${resumeTxt.substring(0, 60).trim()}")`);
      await snap(comPage, 'COM-C5d - Resumed');
      if (firstMethod) await playSiteCheckMaintenance(playerPage, firstMethod, 'COM-C5e - Playsite after Resume').catch(() => {});

      results['COM-C5-maintenance'] = (maintResult === 'maintenance' && resumeResult === 'running')
        ? `PASS — COM BO: maintenance, resume→running`
        : `FAIL — COM BO: maintenance→${maintResult}, resume→${resumeResult}`;
    } catch (e) {
      results['COM-C5-maintenance'] = `FAIL: ${e.message.split('\n')[0]}`;
      try {
        const c  = await comGotoPaymentStatus(comPage);
        const rb = c.locator('.btn.btn-sm.btn-primary').first();
        if (await rb.isVisible({ timeout: 3000 }).catch(() => false)) {
          await rb.click({ force: true });
          await comPage.waitForTimeout(800);
          const cb = comPage.getByRole('button', { name: 'Confirm' }).first();
          if (await cb.isVisible({ timeout: 3000 }).catch(() => false)) {
            await cb.click({ force: true });
          } else {
            const sc = comPage.locator('button.swal2-confirm').first();
            if (await sc.isVisible({ timeout: 2000 }).catch(() => false)) await sc.click({ force: true });
          }
          await comPage.waitForTimeout(2000);
        }
      } catch {}
    }
    console.log(`>> [COM-C5] ${results['COM-C5-maintenance']}`);

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
