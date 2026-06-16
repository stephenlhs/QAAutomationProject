import { test, chromium } from '@playwright/test';
import { CaptchaHelper } from '../helpers/CaptchaHelper.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { URLS, MEMBER_SETUP, MEMBERS, ENV_NAME } from './config.js';

// ── Strip staging prefix from username for BO form ──────────
// The BO create-member form shows the prefix (x9048_) as a fixed label.
// We only fill the part after it.
const BO_PREFIX = ENV_NAME === 'staging' ? 'x9048_' : '';
function stripPrefix(username) {
  return BO_PREFIX && username.startsWith(BO_PREFIX)
    ? username.slice(BO_PREFIX.length)
    : username;
}

// =============================
// HELPER: Generate unique bank account number
// =============================
function generateBankAccountNumber() {
  const timestamp = Date.now().toString().slice(-3);
  const random = Math.floor(Math.random() * 900 + 100).toString();
  return `12344321${random}${timestamp}`;
}

// =============================
// HELPER: Close popups
// =============================
async function closePopups(page) {
  const closeSelectors = ['text=x', '.fa.fa-times', 'text=×'];
  for (const selector of closeSelectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

// =============================
// HELPER: Close extra tabs
// =============================
async function closeExtraTabs(page) {
  const pages = page.context().pages();
  for (const p of pages) {
    if (p !== page) await p.close().catch(() => {});
  }
}

// =============================
// HELPER: Create member in backoffice
// =============================
async function createMember(page, username, currency = 'MYR') {
  console.log(`>> [${username}] Checking availability...`);

  await page.goto(`${URLS.backoffice.replace('/login', '')}/dashboard/cash/cash-member/create-compact`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  await page.locator('input[name="Username"]').fill(stripPrefix(username));
  await page.getByRole('button', { name: 'Check Availability' }).click();
  await page.waitForTimeout(1000);

  const isAvailable = await page.getByText('This username is available.').isVisible().catch(() => false);
  const isTaken = await page.getByText('This username is not').isVisible().catch(() => false);

  if (isTaken) {
    console.log(`>> [${username}] Username already exists, skipping...`);
    return;
  }

  if (!isAvailable) {
    console.log(`>> [${username}] Could not verify availability, skipping...`);
    return;
  }

  console.log(`>> [${username}] Creating member with currency: ${currency}...`);

  await page.getByRole('textbox', { name: 'Password must contain 8 - 15' }).fill(MEMBER_SETUP.initialPassword);
  await page.locator('input[name="ConfirmPassword"]').fill(MEMBER_SETUP.initialPassword);
  await page.locator('select[name="Currency"]').selectOption(currency);

  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(1000);

  const okVisible = await page.getByRole('button', { name: /^ok$/i }).isVisible({ timeout: 5000 }).catch(() => false);
  if (okVisible) await page.getByRole('button', { name: /^ok$/i }).click();

  console.log(`>> [${username}] Member created ✅`);
}

// =============================
// HELPER: Update bank account
// =============================
async function updateBankAccount(page, username) {
  console.log(`>> [${username}] Updating bank account...`);

  await page.goto(`${URLS.backoffice.replace('/login', '')}/dashboard/cash/cash-member/list-compact`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  let found = false;
  for (let retry = 1; retry <= 10; retry++) {
    await page.locator('input[name="filterKeyword"]').fill(username);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForTimeout(1500);

    const updateBtn = page.getByTitle('Update Bank Account').first();
    if (await updateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      found = true;
      break;
    }

    console.log(`>> [${username}] Not found yet, retrying... (${retry}/10)`);
    await page.waitForTimeout(2000);
  }

  if (!found) throw new Error(`Player ${username} not found after 10 retries`);

  await page.getByTitle('Update Bank Account').first().click();
  await page.waitForTimeout(1000);

  let bankUpdated = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const accountNumber = generateBankAccountNumber();
    console.log(`>> [${username}] Trying account number: ${accountNumber} (attempt ${attempt})`);

    // Bank account name should NOT include the staging prefix
    await page.locator('input[name="txtfullname"]').fill(stripPrefix(username));

    // Select bank — wait for options to load first
    await page.waitForTimeout(300);
    await page.locator('select[name="bank"]').selectOption(MEMBER_SETUP.bankCode);
    await page.waitForTimeout(800);

    // Fill account number — try by name first, fallback to nth
    const acctInput = page.locator('input[name="txtaccountno"], input[name="accountno"]').first();
    const acctVisible = await acctInput.isVisible({ timeout: 2000 }).catch(() => false);
    if (acctVisible) {
      await acctInput.clear();
      await acctInput.fill(accountNumber);
    } else {
      await page.locator('input[type="text"]').nth(4).clear();
      await page.locator('input[type="text"]').nth(4).fill(accountNumber);
    }

    const defaultCheckbox = page.locator('#chkSetDefault');
    if (await defaultCheckbox.isVisible().catch(() => false)) {
      await defaultCheckbox.check();
    }

    await page.locator('.modal.in .modal-footer .btn-primary, .modal.show .modal-footer .btn-primary')
      .filter({ hasText: 'Submit' })
      .click();
    await page.waitForTimeout(1500);

    const modalStillOpen = await page.locator('input[name="txtfullname"]').isVisible().catch(() => false);
    if (!modalStillOpen) {
      console.log(`>> [${username}] Bank account updated: ${accountNumber} ✅`);
      bankUpdated = true;
      break;
    }

    console.log(`>> [${username}] Duplicate or error, trying new number...`);
    await page.waitForTimeout(500);
  }

  if (!bankUpdated) throw new Error(`Failed to update bank account for ${username}`);

  console.log(`>> [${username}] Bank account setup complete ✅`);
}

// =============================
// HELPER: Login player + change password only
// =============================
async function loginAndChangePassword(browser, username) {
  console.log(`>> [${username}] Starting playsite setup...`);

  const context = await browser.newContext();
  const page = await context.newPage();
  const captchaHelper = new CaptchaHelper(page, username);

  try {
    // ── Step 1: Login with initial password ──
    await page.goto(URLS.playsite);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await closeExtraTabs(page);
    await closePopups(page);

    await page.getByRole('link', { name: ' Login' }).click();
    await page.waitForTimeout(500);
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(MEMBER_SETUP.initialPassword);

    let loggedIn = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`>> [${username}] Login attempt ${attempt}...`);

      const captchaImg = page.locator('#login-form').getByRole('img');
      const captchaText = await captchaHelper.solve(captchaImg);

      if (captchaText.length !== 4) {
        await captchaImg.click();
        await page.waitForTimeout(1000);
        continue;
      }

      await page.getByRole('textbox', { name: 'Captcha' }).fill(captchaText);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.waitForTimeout(1500);

      const stillVisible = await page.locator('#login-form').isVisible().catch(() => false);
      if (!stillVisible) {
        loggedIn = true;
        console.log(`>> [${username}] Login successful ✅`);
        break;
      }

      console.log(`>> [${username}] Captcha wrong, retrying...`);
      await captchaImg.click();
      await page.waitForTimeout(1000);
    }

    if (!loggedIn) throw new Error('Could not login with initial password');

    await closeExtraTabs(page);
    await closePopups(page);

    // ── Step 2: Change password ──
    console.log(`>> [${username}] Changing password...`);
    await page.goto(`${URLS.playsite}user/account`);
    await page.waitForTimeout(1500);

    await page.locator('#txtOldPassword').fill(MEMBER_SETUP.initialPassword);
    await page.locator('#txtNewPassword').fill(MEMBER_SETUP.newPassword);
    await page.locator('#txtConfirmPassword').fill(MEMBER_SETUP.newPassword);
    await page.getByRole('button', { name: 'Change Password' }).click();
    await page.waitForTimeout(1000);

    const okBtn = page.getByRole('button', { name: 'OK' });
    if (await okBtn.isVisible().catch(() => false)) await okBtn.click();

    console.log(`>> [${username}] Password changed to ${MEMBER_SETUP.newPassword} ✅`);

  } catch (err) {
    console.log(`>> [${username}] Error: ${err.message}`);
  } finally {
    try { await page.goto('about:blank', { timeout: 3000, waitUntil: 'commit' }); } catch {}
    await page.close({ runBeforeUnload: false }).catch(() => {});
    await context.close().catch(() => {});
  }
}

// =============================
// TEST: Create members + update bank + change password
// =============================
test('create members setup', async () => {
  test.setTimeout(0);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--start-maximized'],
  });

  try {

  // ── PART 1: Login to backoffice ──
  const boContext = await browser.newContext();
  const boPage = await boContext.newPage();
  const boCaptcha = new CaptchaHelper(boPage, 'create-member-bo');
  const backoffice = new BackofficePage(boPage, 'create-member-bo');

  await backoffice.login(MEMBER_SETUP.boUsername, MEMBER_SETUP.boPassword, boCaptcha, MEMBER_SETUP.twoFASecret);
  console.log('>> Backoffice login successful ✅');

  // ── PART 2: Create each member ──
  for (const member of MEMBERS) {
    await createMember(boPage, member.username, member.currency);
  }

  // ── PART 3: Update bank account for each member ──
  for (const member of MEMBERS) {
    try {
      await updateBankAccount(boPage, member.username);
    } catch (err) {
      console.log(`>> [${member.username}] Bank update failed: ${err.message}`);
    }
  }

  await boPage.close({ runBeforeUnload: false }).catch(() => {});
  await boContext.close();
  console.log('>> Backoffice tasks complete ✅');

  // ── PART 4: Login to playsite + change password ──
  for (const member of MEMBERS) {
    await loginAndChangePassword(browser, member.username);
  }

  // ── Summary ──
  console.log('\n>> =============================');
  console.log('>> SETUP COMPLETE');
  console.log('>> =============================');
  MEMBERS.forEach(m => {
    console.log(`>>   ✅ ${m.username} (${m.currency}) — password: ${MEMBER_SETUP.newPassword}`);
  });
  console.log('>> =============================\n');
  console.log('>> RESULT: PASS');
  console.log('>> TEST COMPLETE');

  } finally {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise(r => setTimeout(r, 3000)),
    ]);
    try { browser.process()?.kill(); } catch {}
  }
  process.exit(0);
});