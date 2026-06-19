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
    await this.page.goto(`${URLS.playsite}user/deposit`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await this.page.waitForTimeout(1000);
    await this._closePopups();
    console.log('>> Navigated to Deposit page');
  }

  async _closePopups() {
    for (let i = 0; i < 10; i++) {
      const btn = this.page.locator('.js-popup-close-btn').first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        await this.page.waitForTimeout(400);
      } else { break; }
    }
    const timesBtn = this.page.locator('.fa.fa-times').first();
    if (await timesBtn.isVisible().catch(() => false)) {
      await timesBtn.click({ force: true }).catch(() => {});
      await this.page.waitForTimeout(300);
    }
  }

  async selectPackage(packageName) {
    const pkgBtn = this.page.locator('button, [role="button"]').filter({ hasText: packageName }).first();
    const pkgBtnVisible = await pkgBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (pkgBtnVisible) {
      await pkgBtn.click();
      await this.page.waitForTimeout(500);
      console.log(`>> Package selected via button: ${packageName}`);
    } else {
      const pkgSelect = this.page.locator('select.redeposit2__select-package');
      const fallbackSelect = this.page.getByRole('combobox').first();
      const hasPkgSelect = await pkgSelect.isVisible({ timeout: 3000 }).catch(() => false);
      const selectEl = hasPkgSelect ? pkgSelect : fallbackSelect;
      await selectEl.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      // Wait for options to be populated — UAT SPA loads them asynchronously
      await this.page.waitForFunction(
        () => {
          const sel = document.querySelector('select.redeposit2__select-package') || document.querySelector('select');
          return sel && sel.options.length > 1;
        },
        { timeout: 10000 }
      ).catch(() => {});
      const optionTexts = await selectEl.locator('option').allInnerTexts().catch(() => []);
      console.log(`>> Available packages: ${JSON.stringify(optionTexts)}`);
      const exactMatch = optionTexts.find(t => t.trim() === packageName);
      const partialMatch = optionTexts.find(t => t.includes(packageName) || packageName.includes(t.trim()));
      if (exactMatch) {
        await selectEl.selectOption({ label: exactMatch });
      } else if (partialMatch) {
        await selectEl.selectOption({ label: partialMatch });
      } else if (optionTexts.length > 1) {
        await selectEl.selectOption({ index: 1 });
        console.log(`>> Package fallback: selected index 1 (wanted "${packageName}")`);
      } else {
        console.log(`>> Package select: no options found, skipping`);
      }
      await this.page.waitForTimeout(500);
      const chosen = await selectEl.locator('option:checked').innerText().catch(() => '?');
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
