import { expect } from '@playwright/test';
import { URLS } from '../config.js';

export class LoginPage {
  constructor(page, testId = 'player') {
    this.page    = page;
    this.testId  = testId;

    this.loginLink    = page.getByRole('link', { name: ' Login' });
    this.usernameInput= page.getByRole('textbox', { name: 'Username' });
    this.passwordInput= page.getByRole('textbox', { name: 'Password' });
    this.captchaInput = page.getByRole('textbox', { name: 'Captcha' });
    this.signInBtn    = page.getByRole('button',  { name: 'Sign In' });
    this.captchaImg   = page.locator('#login-form').getByRole('img');
    this.loginForm    = page.locator('#login-form');
  }

  // ── Close popups ───────────────────────────────────────────
  async closePopups() {
    const selectors = ['text=x', '.fa.fa-times', 'text=×'];
    for (const sel of selectors) {
      const el = this.page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }
  }

  // ── Close extra tabs ───────────────────────────────────────
  async closeExtraTabs() {
    const pages = this.page.context().pages();
    for (const p of pages) {
      if (p !== this.page) await p.close().catch(() => {});
    }
  }

  // ── Login + save session ───────────────────────────────────
  async loginAndSaveSession(username, password, captchaHelper, sessionPath) {
    console.log(`>> [${this.testId}] Navigating to playsite...`);
    await this.page.goto(URLS.playsite);
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1000);
    await this.closeExtraTabs();
    await this.closePopups();

    await this.loginLink.click();
    await this.page.waitForTimeout(500);
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);

    let loggedIn = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`>> [${this.testId}] Login attempt ${attempt} as: ${username}`);

      const captchaText = await captchaHelper.solve(this.captchaImg);

      if (captchaText.length !== 4) {
        console.log(`>> [${this.testId}] Captcha length invalid (${captchaText.length}), retrying...`);
        await this.captchaImg.click();
        await this.page.waitForTimeout(1000);
        continue;
      }

      await this.captchaInput.fill(captchaText);
      await this.signInBtn.click();
      await this.page.waitForTimeout(2000);

      // ── Check for wrong credentials error ──
      const wrongCreds = await this._detectLoginError();
      if (wrongCreds) {
        throw new Error(
          `❌ Player login failed for "${username}": ${wrongCreds}\n` +
          `>> Please check the username and password are correct.`
        );
      }

      const stillVisible = await this.loginForm.isVisible().catch(() => false);
      if (!stillVisible) {
        loggedIn = true;
        console.log(`>> [${this.testId}] Login successful ✅`);
        break;
      }

      console.log(`>> [${this.testId}] Captcha wrong or login failed, retrying...`);
      await this.captchaImg.click();
      await this.page.waitForTimeout(1000);
    }

    if (!loggedIn) {
      throw new Error(
        `❌ Player login failed for "${username}" after 3 attempts.\n` +
        `>> Captcha may be unsolvable or credentials are incorrect.`
      );
    }

    await this.closeExtraTabs();
    await this.closePopups();

    // Save session
    await this.page.context().storageState({ path: sessionPath });
    console.log(`>> [${this.testId}] Session saved to ${sessionPath} ✅`);
  }

  // ── Restore session ────────────────────────────────────────
  async loginWithSession() {
    console.log(`>> [${this.testId}] Restoring session...`);
    await this.page.goto(URLS.playsite);
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1000);
    await this.closeExtraTabs();
    await this.closePopups();

    const loginVisible = await this.loginForm.isVisible().catch(() => false);
    if (loginVisible) {
      console.log(`>> [${this.testId}] Session expired, re-login needed`);
    } else {
      console.log(`>> [${this.testId}] Session restored ✅`);
    }
  }

  // ── Get logged in username ─────────────────────────────────
  async getLoggedInUsername() {
    try {
      const el = this.page.locator('.user-info, .username, [class*="username"], [class*="user-name"]').first();
      const text = await el.innerText({ timeout: 5000 });
      return text.trim();
    } catch {
      console.log(`>> [${this.testId}] Could not get username from UI`);
      return 'unknown';
    }
  }

  // ── Detect login error messages on the page ────────────────
  async _detectLoginError() {
    // Only check for visible text that clearly indicates wrong credentials.
    // Intentionally narrow — we don't want false positives from unrelated page elements.
    const errorKeywords = [
      'invalid username',
      'invalid password',
      'incorrect username',
      'incorrect password',
      'wrong username',
      'wrong password',
      'username or password',
      'account not found',
      'user not found',
      'login failed',
      'invalid credentials',
    ];

    // Check common error container selectors
    const selectors = [
      '.alert-danger',
      '.swal2-html-container',
      '.toast-error',
      '.login-error',
      '#login-error',
    ];

    for (const sel of selectors) {
      try {
        const el = this.page.locator(sel).first();
        const visible = await el.isVisible({ timeout: 800 });
        if (visible) {
          const txt = await el.innerText();
          const lower = txt.toLowerCase();
          if (errorKeywords.some(k => lower.includes(k))) {
            return txt.trim();
          }
        }
      } catch {}
    }
    return null;
  }
}
