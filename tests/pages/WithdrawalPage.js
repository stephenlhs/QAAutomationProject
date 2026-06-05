import { expect } from '@playwright/test';
import { URLS } from '../config.js';

export class WithdrawalPage {
  constructor(page) {
    this.page = page;

    this.amountInput      = page.getByRole('textbox');
    this.submitButton     = page.getByRole('button', { name: 'Submit' });
    this.confirmYesButton = page.getByRole('button', { name: 'Yes' });
    this.confirmOkButton  = page.getByRole('button', { name: 'OK' });
    this.withdrawalRoot   = page.locator('#withdrawalAppRoot');
    this.balanceDisplay   = page.locator('text=/MYR \\d+\\.\\d+/');
  }

  async navigate() {
    await this.page.goto(`${URLS.playsite}user/withdrawal`);
    await this.page.waitForTimeout(1500);
    console.log('>> Navigated to Withdrawal page');
  }

  async getStats(label = 'stats') {
    await this.page.screenshot({ path: `withdrawal-${label}.png` });

    const balanceText  = await this.balanceDisplay.first().innerText().catch(() => '0');
    const balanceMatch = balanceText.match(/[\d,]+\.\d+/);
    const balance      = balanceMatch ? parseFloat(balanceMatch[0].replace(/,/g, '')) : 0;

    const fullText      = await this.withdrawalRoot.innerText();
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