import { expect } from '@playwright/test';
import { URLS } from '../config.js';

export class StatementPage {
  constructor(page) {
    this.page = page;
  }

  async navigateToCashHistory() {
    await this.page.goto(`${URLS.playsite}user/cash-history`);
    await this.page.waitForTimeout(1500);
    console.log('>> Navigated to Cash History page');
  }

  async getLatestTransaction() {
    const latestRow = this.page.getByRole('row').nth(1);
    const cells = await latestRow.getByRole('cell').allInnerTexts();
    console.log('>> Transaction row:', cells);

    return {
      dateTime:    cells[0] || '-',
      txNo:        cells[1] || '-',
      description: cells[2] || '-',
      type:        cells[3] || '-',
      status:      cells[4] || '-',
      amount:      cells[5] || '-',
      bonus:       cells[6] || '-',
      row:         latestRow
    };
  }

  async verifyLatestStatus(status) {
    const latestRow = this.page.getByRole('row').nth(1);
    const found = await latestRow.getByRole('cell', { name: status }).isVisible({ timeout: 5000 }).catch(() => false);
    if (!found) {
      console.log(`>> Cash History status not "${status}" yet — reloading...`);
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);
    }
    await expect(latestRow.getByRole('cell', { name: status })).toBeVisible({ timeout: 10000 });
    console.log(`>> Cash History status: ${status} ✅`);
  }

  async verifyRejectRemark(remark) {
    const remarkTooltip = this.page.locator('i').filter({ hasText: new RegExp(remark, 'i') }).first();
    await expect(remarkTooltip).toBeVisible({ timeout: 5000 });
    console.log(`>> Reject remark visible: ${remark} ✅`);
  }
}
