import { expect } from '@playwright/test';
import { mkdirSync } from 'fs';

export class BackofficePage {
  constructor(page, testId = 'default') {
    this.page = page;
    this.testId = testId;

    this.usernameInput = page.getByRole('textbox', { name: 'Username' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.captchaInput = page.getByRole('textbox', { name: 'Captcha' });
    this.captchaImg = page.getByRole('img');
    this.loginButton = page.getByRole('button', { name: 'Login' });
  }

  async goto() {
    await this.page.goto('https://stage-bo.linkv2.com/login');
  }

  async closeExtraTabs() {
    const context = this.page.context();
    const pages = context.pages();
    for (const p of pages) {
      if (p !== this.page) await p.close().catch(() => {});
    }
  }

  // ── Login + save session + continue ──
  async loginAndSaveSession(username, password, captchaHelper, sessionPath) {
    await this.goto();
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1000);

    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);

    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`>> [${this.testId}] Backoffice login attempt ${attempt}...`);

      const captchaText = await captchaHelper.solve(this.captchaImg);

      if (captchaText.length !== 4) {
        await this.captchaImg.click();
        await this.page.waitForTimeout(1000);
        continue;
      }

      await this.captchaInput.fill(captchaText);
      await this.loginButton.click();
      await this.page.waitForTimeout(1500);
      await this.page.getByText('× Close').click().catch(() => {});

      const stillOnLogin = this.page.url().includes('/login');
      if (!stillOnLogin) {
        console.log(`>> [${this.testId}] Backoffice login successful ✅`);

        mkdirSync('.auth', { recursive: true });
        await this.page.context().storageState({ path: sessionPath });
        console.log(`>> [${this.testId}] Session saved to ${sessionPath} ✅`);
        return;
      }

      console.log(`>> [${this.testId}] Captcha wrong, retrying...`);
      await this.captchaImg.click();
      await this.page.waitForTimeout(1000);
    }

    throw new Error(`[${this.testId}] Backoffice login failed after 3 attempts`);
  }

  // ── Restore existing session ──
  async loginWithSession() {
    await this.page.goto('https://stage-bo.linkv2.com/dashboard/home');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1000);
    await this.closeExtraTabs();

    const isLoginPage = this.page.url().includes('/login');
    if (isLoginPage) {
      throw new Error('BO Session expired — run auth setup again');
    }

    console.log(`>> [${this.testId}] Backoffice session restored ✅`);
  }

  async getMemberOutstandingBalance(username) {
    await this.closeExtraTabs();

    // Navigate to Member Account
    await this.page.locator('a').filter({ hasText: 'Members' }).click();
    await this.page.getByRole('link', { name: 'Member Account' }).click();
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1000);

    // Search player
    await this.page.getByRole('textbox', { name: 'Username' }).fill(`x9048_${username}`);
    await this.page.getByRole('button', { name: 'Search' }).click();
    await this.page.waitForTimeout(2000);
    await this.closeExtraTabs();

    // Wait for data
    await this.page.waitForSelector('text=Sport Total Outstanding Balance', { timeout: 10000 })
      .catch(() => console.log('>> Outstanding data not found'));

    // Screenshot
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await this.page.screenshot({ path: `member-account-${timestamp}.png`, fullPage: true });
    console.log(`>> Screenshot saved: member-account-${timestamp}.png`);

    // Parse outstanding values
    const getVal = async (labelText) => {
      try {
        const el = this.page.getByText(labelText).last();
        const parent = el.locator('..');
        const fullText = await parent.innerText();
        console.log(`>> "${labelText}" parent text: "${fullText}"`);
        const numbers = fullText.match(/[\d,]+\.\d+/g);
        return numbers ? parseFloat(numbers[numbers.length - 1].replace(/,/g, '')) : 0;
      } catch {
        return 0;
      }
    };

    const sport   = await getVal('Sport Total Outstanding Balance:');
    const casino  = await getVal('Live Casino Total Outstanding Balance:');
    const lottery = await getVal('Lottery Total Outstanding Balance:');
    const games   = await getVal('Games Total Outstanding Balance:');
    const p2p     = await getVal('P2P Total Outstanding Balance:');
    const total   = sport + casino + lottery + games + p2p;

    console.log(`>> Outstanding — Sport: ${sport}, Casino: ${casino}, Lottery: ${lottery}, Games: ${games}, P2P: ${p2p}, Total: ${total}`);

    // Go directly to Cash Deposit List
    await this.page.goto('https://stage-bo.linkv2.com/dashboard/cash/deposit-list', {
      waitUntil: 'domcontentloaded'
    });
    await this.page.waitForTimeout(1000);
    await this.closeExtraTabs();
    console.log(`>> Navigated to Cash Deposit List: ${this.page.url()}`);

    return { sport, casino, lottery, games, p2p, total };
  }

  async approveDeposit(username, comment = 'test manual approve') {
    await this.closeExtraTabs();

    if (!this.page.url().includes('deposit-list')) {
      await this.page.locator('a').filter({ hasText: 'Cash Transactions' }).click();
      await this.page.getByRole('link', { name: 'Cash Deposit List' }).click();
    }

    // Search by username
    await this.page.locator('#txtUserName').fill(`x9048_${username}`);
    await this.page.getByRole('button', { name: 'Search' }).click();
    await this.page.waitForTimeout(1000);
    console.log(`>> Searching deposit for: x9048_${username}`);

    await this.page.getByTitle('Edit').first().click();
    console.log('>> Opened latest deposit');

    await this.page.locator('textarea[name="userComment"]').fill(comment);
    await this.page.locator('#ticket-detail').getByText('Approved').click();
    await this.page.getByRole('button', { name: 'OK' }).click();

    await expect(this.page.getByText('Success')).toBeVisible({ timeout: 15000 });
    console.log('>> Deposit approved ✅');
  }

  async rejectDeposit(username, comment = 'test manual reject') {
    await this.closeExtraTabs();

    if (!this.page.url().includes('deposit-list')) {
      await this.page.locator('a').filter({ hasText: 'Cash Transactions' }).click();
      await this.page.getByRole('link', { name: 'Cash Deposit List' }).click();
    }

    // Search by username
    await this.page.locator('#txtUserName').fill(`x9048_${username}`);
    await this.page.getByRole('button', { name: 'Search' }).click();
    await this.page.waitForTimeout(1000);
    console.log(`>> Searching deposit for: x9048_${username}`);

    await this.page.getByTitle('Edit').first().click();
    console.log('>> Opened latest deposit');

    await this.page.locator('textarea[name="userComment"]').fill(comment);
    await this.page.locator('#ticket-detail').getByText('Rejected').click();
    await this.page.getByRole('button', { name: 'OK' }).click();

    await expect(this.page.getByText('Success')).toBeVisible({ timeout: 15000 });
    console.log('>> Deposit rejected ✅');
  }

  async approveWithdrawal(username, comment = 'test manual approve withdrawal') {
    await this.closeExtraTabs();

    await this.page.locator('a').filter({ hasText: 'Cash Transactions' }).click();
    await this.page.getByRole('link', { name: 'Cash Withdraw List' }).click();

    // Search by username
    await this.page.locator('#txtUserName').fill(`x9048_${username}`);
    await this.page.getByRole('button', { name: 'Search' }).click();
    await this.page.waitForTimeout(1000);
    console.log(`>> Searching withdrawal for: x9048_${username}`);

    await this.page.getByTitle('Edit').first().click();
    console.log('>> Opened latest withdrawal');

    await this.page.locator('textarea[name="userComment"]').fill(comment);
    await this.page.locator('#ticket-detail').getByText('Approved').click();
    await this.page.getByRole('button', { name: 'OK' }).click();

    await expect(this.page.getByText('Success')).toBeVisible({ timeout: 15000 });
    console.log('>> Withdrawal approved ✅');
  }

  async rejectWithdrawal(username, comment = 'test manual reject withdrawal') {
    await this.closeExtraTabs();

    await this.page.locator('a').filter({ hasText: 'Cash Transactions' }).click();
    await this.page.getByRole('link', { name: 'Cash Withdraw List' }).click();

    // Search by username
    await this.page.locator('#txtUserName').fill(`x9048_${username}`);
    await this.page.getByRole('button', { name: 'Search' }).click();
    await this.page.waitForTimeout(1000);
    console.log(`>> Searching withdrawal for: x9048_${username}`);

    await this.page.getByTitle('Edit').first().click();
    console.log('>> Opened latest withdrawal');

    await this.page.locator('textarea[name="userComment"]').fill(comment);
    await this.page.locator('#ticket-detail').getByText('Rejected').click();
    await this.page.getByRole('button', { name: 'OK' }).click();

    await expect(this.page.getByText('Success')).toBeVisible({ timeout: 15000 });
    console.log('>> Withdrawal rejected ✅');
  }
}