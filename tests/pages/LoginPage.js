import { mkdirSync } from 'fs';
import { URLS } from '../config.js';

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
    await this.page.goto(URLS.playsite);
  }

  async closePopups() {
    for (const selector of URLS.popupCloseSelectors) {
      const el = this.page.locator(selector).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }
  }

  async closeExtraTabs() {
    const pages = this.page.context().pages();
    for (const p of pages) {
      if (p !== this.page) await p.close().catch(() => {});
    }
  }

  // ── Login + save session ──
  async loginAndSaveSession(username, password, captchaHelper, sessionPath) {
    await this.goto();
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1000);
    await this.closeExtraTabs();
    await this.closePopups();

    await this.loginLink.click();
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);

    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`>> [${this.testId}] Login attempt ${attempt}...`);

      const captchaText = await captchaHelper.solve(this.captchaImg);

      if (captchaText.length !== 4) {
        console.log(`>> [${this.testId}] Not 4 digits, refreshing...`);
        await this.captchaImg.click();
        await this.page.waitForTimeout(1000);
        continue;
      }

      await this.captchaInput.fill(captchaText);
      await this.signInButton.click();
      await this.page.waitForTimeout(1500);

      const stillVisible = await this.loginForm.isVisible().catch(() => false);
      if (!stillVisible) {
        console.log(`>> [${this.testId}] Login successful ✅`);
        await this.page.waitForTimeout(1000);
        await this.closeExtraTabs();
        await this.closePopups();

        mkdirSync('.auth', { recursive: true });
        await this.page.context().storageState({ path: sessionPath });
        console.log(`>> [${this.testId}] Session saved to ${sessionPath} ✅`);
        return;
      }

      console.log(`>> [${this.testId}] Captcha wrong, retrying...`);
      await this.captchaImg.click();
      await this.page.waitForTimeout(1000);
    }

    throw new Error(`[${this.testId}] Login failed after 3 attempts`);
  }

  // ── Restore existing session ──
  async loginWithSession() {
    await this.goto();
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2000);
    await this.closeExtraTabs();
    await this.closePopups();

    const loginVisible = await this.loginForm.isVisible().catch(() => false);
    if (loginVisible) {
      throw new Error('Session expired — run auth setup again');
    }

    console.log(`>> [${this.testId}] Player session restored ✅`);
  }

  // ── Get logged in username ──
  async getLoggedInUsername() {
    try {
      await this.page.waitForTimeout(1000);
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