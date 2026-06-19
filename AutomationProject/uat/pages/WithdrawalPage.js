import { expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { URLS } from '../config.js';

export class WithdrawalPage {
  constructor(page) {
    this.page = page;

    this.amountInput      = page.getByRole('textbox');
    this.submitButton     = page.getByRole('button', { name: 'Submit' });
    this.confirmYesButton = page.getByRole('button', { name: 'Yes' });
    this.confirmOkButton  = page.getByRole('button', { name: 'OK' });
    this.withdrawalRoot   = page.locator('#withdrawalAppRoot');
    this.balanceDisplay   = page.locator('text=/[A-Z]{2,4}\\s+[\\d,]+\\.\\d+/');
  }

  async navigate() {
    await this.page.goto(`${URLS.playsite}user/withdrawal`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await this.page.waitForTimeout(1000);
    await this._closePopups();
    console.log('>> Navigated to Withdrawal page');
  }

  async _closePopups() {
    for (let i = 0; i < 10; i++) {
      const btn = this.page.locator('.js-popup-close-btn').first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        await this.page.waitForTimeout(400);
      } else {
        break;
      }
    }
    const timesBtn = this.page.locator('.fa.fa-times').first();
    if (await timesBtn.isVisible().catch(() => false)) {
      await timesBtn.click({ force: true }).catch(() => {});
      await this.page.waitForTimeout(300);
    }
  }

  async getStats(label = 'stats') {
    const screenshotsDir = join(process.cwd(), 'screenshots');
    mkdirSync(screenshotsDir, { recursive: true });
    await this.page.screenshot({ path: join(screenshotsDir, `withdrawal-${label}.png`) });

    const balanceText  = await this.balanceDisplay.first().innerText().catch(() => '0');
    const balanceMatch = balanceText.match(/[\d,]+\.\d+/);
    const balance      = balanceMatch ? parseFloat(balanceMatch[0].replace(/,/g, '')) : 0;

    const fullText      = await this.withdrawalRoot.innerText({ timeout: 15000 }).catch(() => '');
    const rolloverMatch = fullText.match(/(\d[\d,.]*)\s*\/\s*(\d[\d,.]*)/);
    const rollover      = rolloverMatch ? parseFloat(rolloverMatch[1].replace(/,/g, '')) : 0;
    const target        = rolloverMatch ? parseFloat(rolloverMatch[2].replace(/,/g, '')) : 0;

    console.log(`>> [${label}] Balance: ${balance}, Rollover: ${rollover}, Target: ${target}`);
    return { balance, rollover, target };
  }

  async submitWithdrawal(amount) {
    await this.amountInput.click();
    await this.amountInput.fill(String(amount));
    await this.submitButton.click();
    await this.confirmYesButton.click();
    await expect(this.page.getByText('Send request successfully')).toBeVisible({ timeout: 5000 });
    await this.confirmOkButton.click();
    console.log(`>> Withdrawal submitted: ${amount}`);
  }

  async verifyInsufficientBalance(amount) {
    await this.amountInput.click();
    await this.amountInput.fill(String(amount));
    await this.submitButton.click();
    await this.confirmYesButton.click();
    await expect(this.page.getByText('Insufficient balance')).toBeVisible({ timeout: 5000 });
    await this.confirmOkButton.click();
    console.log('>> Insufficient balance error verified ✅');
  }

  async verifyRolloverError(amount) {
    await this.amountInput.click();
    await this.amountInput.fill(String(amount));
    await this.submitButton.click();
    await this.confirmYesButton.click();
    await expect(this.page.getByText(/Rollover amount must greater/i)).toBeVisible({ timeout: 5000 });
    await this.confirmOkButton.click();
    console.log('>> Rollover error verified ✅');
  }
}
