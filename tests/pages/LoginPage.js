import { expect } from '@playwright/test';

export class LoginPage {
  constructor(page, testId = 'default') {
    this.page = page;
    this.testId = testId;

    this.loginLink = page.getByRole('link', { name: ' Login' });
    this.usernameInput = page.getByRole('textbox', { name: 'Username' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.captchaInput = page.getByRole('textbox', { name: 'Captcha' });
    this.captchaImg = page.locator('#login-form').getByRole('img');
    this.signInButton = page.getByRole('button', { name: 'Sign In' });
    this.loginForm = page.locator('#login-form');
  }

  async goto() {
    await this.page.goto('https://stage-mem.linkv2.com/');
  }

  async closePopups() {
    const closeSelectors = ['text=x', '.fa.fa-times', 'text=×'];
    for (const selector of closeSelectors) {
      const el = this.page.locator(selector).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }
  }

  async login(username, password, captchaHelper) {
    await this.loginLink.click();
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);

    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`>> [${this.testId}] Player login attempt ${attempt}...`);

      const captchaText = await captchaHelper.solve(this.captchaImg);

      if (captchaText.length !== 4) {
        console.log(`>> Not 4 digits, refreshing...`);
        await this.captchaImg.click();
        await this.page.waitForTimeout(1000);
        continue;
      }

      await this.captchaInput.fill(captchaText);
      await this.signInButton.click();
      await this.page.waitForTimeout(1500);

      const stillVisible = await this.loginForm.isVisible().catch(() => false);
      if (!stillVisible) {
        console.log(`>> [${this.testId}] Player login successful!`);
        await this.page.waitForTimeout(1000);
        await this.closePopups();
        return;
      }

      console.log(`>> Captcha wrong, retrying...`);
      await this.captchaImg.click();
      await this.page.waitForTimeout(1000);
    }

    throw new Error('Player login failed after 3 attempts');
  }

  async loginWithSession() {
    await this.page.goto('https://stage-mem.linkv2.com/');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2000);

    // Close any extra tabs
    const context = this.page.context();
    const pages = context.pages();
    for (const p of pages) {
      if (p !== this.page) {
        await p.close().catch(() => {});
      }
    }

    await this.closePopups();

    const loginVisible = await this.loginForm.isVisible().catch(() => false);
    if (loginVisible) {
      throw new Error('Session expired — run: npx playwright test tests/auth.setup.js --headed');
    }

    console.log(`>> [${this.testId}] Player session restored ✅`);
  }

  async getLoggedInUsername() {
    try {
      await this.page.waitForTimeout(1000);
      // Get text from header area
      const allText = await this.page
        .locator('header, nav, .navbar, [class*="header"]')
        .first()
        .innerText({ timeout: 5000 })
        .catch(() => '');
      console.log(`>> Header text: ${allText}`);
      const match = allText.match(/Hi\s*[,，]\s*(\S+)/);
      return match ? match[1].trim() : 'unknown';
    } catch {
      console.log('>> Could not get username');
      return 'unknown';
    }
  }
}