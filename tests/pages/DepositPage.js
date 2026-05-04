import { expect } from '@playwright/test';

export class DepositPage {
  constructor(page) {
    this.page = page;

    this.depositLink = page.getByRole('link', { name: ' Deposit' });
    this.packageButton = page.getByRole('button', { name: 'Stephen Turnover Package' });
    this.methodDropdown = page.getByRole('combobox').nth(1);
    this.bankDropdown = page.getByText('Please Choose▼');
    this.amountInput = page.locator('#txtAmountBank');
    this.submitButton = page.getByRole('button', { name: 'Submit' });
    this.confirmYesButton = page.getByRole('button', { name: 'Yes' });
    this.confirmOkButton = page.getByRole('button', { name: 'OK' });
    this.closePopup = page.locator('.fa.fa-times');
  }

  async navigate() {
    await this.depositLink.click();
    await this.page.waitForURL(/deposit/, { timeout: 8000 });
    await this.closePopup.click().catch(() => {});
    console.log('>> Navigated to Deposit page');
  }

  async selectBankTransfer(bankName) {
    await this.packageButton.click();
    await this.methodDropdown.selectOption('bank-in-transfer');
    await this.bankDropdown.click();
    await this.page.getByText(bankName).click();
    console.log(`>> Selected bank: ${bankName}`);
  }

  async submit(amount) {
    await this.amountInput.fill(String(amount));
    await this.submitButton.click();
    await this.page.waitForTimeout(3000);
    await expect(this.confirmYesButton).toBeVisible({ timeout: 10000 });
    await this.confirmYesButton.click();
    await expect(this.confirmOkButton).toBeVisible({ timeout: 8000 });
    await this.confirmOkButton.click();
    console.log(`>> Deposit submitted: ${amount}`);
  }
}