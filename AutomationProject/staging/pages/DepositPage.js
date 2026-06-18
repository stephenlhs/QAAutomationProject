import { expect } from '@playwright/test';
import { URLS, DEPOSIT } from '../config.js';

export class DepositPage {
  constructor(page) {
    this.page = page;

    this.packageButton = page.getByRole('button', { name: DEPOSIT.packageName });
    this.methodDropdown = page.getByRole('combobox').nth(1);
    this.bankDropdown = page.getByText('Please Choose▼');
    this.amountInput = page.locator('#txtAmountBank');
    this.submitButton = page.getByRole('button', { name: 'Submit' });
    this.confirmYesButton = page.getByRole('button', { name: 'Yes' });
    this.confirmOkButton = page.getByRole('button', { name: 'OK' });
    this.closePopup = page.locator('.fa.fa-times');
  }

  async navigate() {
    await this.page.goto(`${URLS.playsite}user/deposit`);
    await this.page.waitForTimeout(1500);
    await this.closePopup.click().catch(() => {});
    console.log('>> Navigated to Deposit page');
  }

  async selectPackage(packageName) {
    const pkgBtn = this.page.locator('button, [role="button"]').filter({ hasText: packageName }).first();
    const pkgBtnVisible = await pkgBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (pkgBtnVisible) {
      await pkgBtn.click();
      await this.page.waitForTimeout(500);
      console.log(`>> Package selected via button: ${packageName}`);
    } else {
      const pkgSelect = this.page.getByRole('combobox').first();
      await pkgSelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await pkgSelect.selectOption({ label: packageName });
      await this.page.waitForTimeout(500);
      const chosen = await pkgSelect.locator('option:checked').innerText().catch(() => '?');
      console.log(`>> Package selected via dropdown: "${chosen}"`);
    }
    await this.page.waitForTimeout(2500);
  }

  async selectBankTransfer(bankName) {
    await this.selectPackage(DEPOSIT.packageName);
    await this.methodDropdown.selectOption('bank-in-transfer');
    await this.bankDropdown.click();
    await this.page.locator('.dropdown-option').filter({ hasText: bankName }).first().click();
    console.log(`>> Selected bank: ${bankName}`);
    // Wait for form to settle after bank selection before amount input becomes interactive
    await this.amountInput.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await this.page.waitForTimeout(800);
  }

  async submit(amount) {
    await this.amountInput.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await this.amountInput.click();
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
