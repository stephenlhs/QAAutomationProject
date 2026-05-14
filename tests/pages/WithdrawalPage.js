import { expect } from '@playwright/test';
import { URLS } from '../config.js';

export class WithdrawalPage {
  constructor(page) {
    this.page = page;

    this.withdrawalLink = page.getByRole('link', { name: ' Withdrawal' });
    this.amountInput = page.getByRole('textbox');
    this.submitButton = page.getByRole('button', { name: 'Submit' });
    this.confirmYesButton = page.getByRole('button', { name: 'Yes' });
    this.confirmOkButton = page.getByRole('button', { name: 'OK' });
    this.withdrawalRoot = page.locator('#withdrawalAppRoot');
    this.balanceDisplay = page.locator('text=/MYR \\d+\\.\\d+/');
  }

 async navigate() {
  // Close any popups first
  const closeSelectors = ['text=x', '.fa.fa-times', 'text=×'];
  for (const selector of closeSelectors) {
    const el = this.page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      await this.page.waitForTimeout(300);
    }
  }

  await this.withdrawalLink.click();
  await this.page.waitForURL(/withdrawal/, { timeout: 10000 });
  await this.page.waitForTimeout(1500);
}

  async getUsername() {
  const usernameEl = this.page.locator('text=/Hi,/').locator('..').locator('generic').last();
  const username = await usernameEl.innerText().catch(() => USERNAME);
  return username.trim();
}

  async getStats(label = 'stats') {
    await this.page.screenshot({ path: `withdrawal-${label}.png` });

    const balanceText = await this.balanceDisplay.first().innerText().catch(() => '0');
    const balanceMatch = balanceText.match(/[\d,]+\.\d+/);
    const balance = balanceMatch ? parseFloat(balanceMatch[0].replace(/,/g, '')) : 0;

    const fullText = await this.withdrawalRoot.innerText();
    const rolloverMatch = fullText.match(/(\d[\d,.]*)\s*\/\s*(\d[\d,.]*)/);
    const rollover = rolloverMatch ? parseFloat(rolloverMatch[1].replace(/,/g, '')) : 0;
    const target = rolloverMatch ? parseFloat(rolloverMatch[2].replace(/,/g, '')) : 0;

    console.log(`>> [${label}] Balance: ${balance}, Rollover: ${rollover}, Target: ${target}`);
    return { balance, rollover, target };
  }

  async submitWithdrawal(amount) {
    await this.amountInput.fill(String(amount));
    await this.submitButton.click();
    await this.confirmYesButton.click();
    await expect(this.page.getByText('Send request successfully')).toBeVisible({ timeout: 5000 });
    await this.confirmOkButton.click();
    console.log(`>> Withdrawal submitted: ${amount}`);
  }

  async verifyInsufficientBalance(amount) {
    await this.amountInput.fill(String(amount));
    await this.submitButton.click();
    await this.confirmYesButton.click();
    await expect(this.page.getByText('Insufficient balance')).toBeVisible({ timeout: 5000 });
    await this.confirmOkButton.click();
    console.log('>> Insufficient balance error verified ✅');
  }

  async verifyRolloverError(amount) {
    await this.amountInput.fill(String(amount));
    await this.submitButton.click();
    await this.confirmYesButton.click();
    await expect(this.page.getByText(/Rollover amount must greater/i)).toBeVisible({ timeout: 5000 });
    await this.confirmOkButton.click();
    console.log('>> Rollover error verified ✅');
  }
}