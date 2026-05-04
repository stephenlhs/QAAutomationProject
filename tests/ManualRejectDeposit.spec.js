import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { DepositPage } from './pages/DepositPage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { StatementPage } from './pages/StatementPage.js';

const DEPOSIT_AMOUNT = 50;
const ROLLOVER_MULTIPLIER = 1;
const USERNAME = 'automatemyr1';
const BANK_NAME = 'C zh test - zh test all';

test('deposit reject — verify balance and rollover unchanged', async ({ browser }) => {

  // ── PART 1: Player — check stats before ──
  const playerContext = await browser.newContext({ storageState: '.auth/player.json' });
  const playerPage = await playerContext.newPage();
  const loginPage = new LoginPage(playerPage);
  const depositPage = new DepositPage(playerPage);
  const withdrawalPage = new WithdrawalPage(playerPage);
  const statementPage = new StatementPage(playerPage);

  await loginPage.loginWithSession();
const actualUsername = await loginPage.getLoggedInUsername();
console.log(`>> Logged in as: ${actualUsername}`);

  await withdrawalPage.navigate();
  const before = await withdrawalPage.getStats('before');
  console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

  // ── PART 2: Submit deposit ──
  await depositPage.navigate();
  await depositPage.selectBankTransfer(BANK_NAME);
  await depositPage.submit(DEPOSIT_AMOUNT);

  // ── PART 3: Verify pending ──
  await statementPage.navigateToCashHistory();
  const tx = await statementPage.getLatestTransaction();
  await statementPage.verifyLatestStatus('Pending');

  await playerContext.close();

  // ── PART 4: Backoffice — reject deposit ──
  const boContext = await browser.newContext({ storageState: '.auth/backoffice.json' });
  const boPage = await boContext.newPage();
  const backoffice = new BackofficePage(boPage);

  await backoffice.loginWithSession();
  await backoffice.rejectDeposit('test manual reject');

  await boContext.close();

  // ── PART 5: Player — verify after rejection ──
  const playerContext2 = await browser.newContext({ storageState: '.auth/player.json' });
  const playerPage2 = await playerContext2.newPage();
  const loginPage2 = new LoginPage(playerPage2);
  const withdrawalPage2 = new WithdrawalPage(playerPage2);
  const statementPage2 = new StatementPage(playerPage2);

  await loginPage2.loginWithSession();

  await statementPage2.navigateToCashHistory();
  await statementPage2.verifyLatestStatus('Rejected');
  await statementPage2.verifyRejectRemark('test manual reject');

  await withdrawalPage2.navigate();
  const after = await withdrawalPage2.getStats('after');

  // ── Assertions — unchanged ──
  expect(after.balance).toBeCloseTo(before.balance, 1);
  expect(after.rollover).toBeCloseTo(before.rollover, 1);
  expect(after.target).toBeCloseTo(before.target, 1);
  console.log('>> Balance and rollover unchanged ✅');

  // ── Report ──
  const report = `
========================================
   DEPOSIT REJECT TEST REPORT
========================================
Date/Time     : ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
PPlayer        : ${actualUsername}
----------------------------------------
TRANSACTION
  Date/Time   : ${tx.dateTime}
  Txn No      : ${tx.txNo}
  Description : ${tx.description}
  Type        : ${tx.type}
  Status      : Rejected ❌
  Amount      : MYR ${tx.amount}
  Remark      : test manual reject
----------------------------------------
BALANCE
  Before      : MYR ${before.balance.toFixed(2)}
  After       : MYR ${after.balance.toFixed(2)}
----------------------------------------
ROLLOVER / TARGET
  Before      : ${before.rollover.toFixed(2)} / ${before.target.toFixed(2)}
  After       : ${after.rollover.toFixed(2)} / ${after.target.toFixed(2)}
  Expected    : Unchanged
----------------------------------------
RESULT        : ${
    after.balance.toFixed(2) === before.balance.toFixed(2) &&
    after.rollover.toFixed(2) === before.rollover.toFixed(2)
      ? '✅ ALL ASSERTIONS PASSED'
      : '❌ SOME ASSERTIONS FAILED'
  }
========================================
`;
  console.log(report);
  writeFileSync('test-report-deposit-reject.txt', report);

  await playerContext2.close();
});