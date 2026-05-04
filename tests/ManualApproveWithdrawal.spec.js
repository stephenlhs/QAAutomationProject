import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { StatementPage } from './pages/StatementPage.js';

const WITHDRAW_AMOUNT = 10;
const USERNAME = 'automatemyr1';

test('withdrawal approve — verify balance decreases and rollover resets', async ({ browser }) => {

  // ── PART 1: Player — check stats before ──
  const playerContext = await browser.newContext({ storageState: '.auth/player.json' });
  const playerPage = await playerContext.newPage();
  const loginPage = new LoginPage(playerPage);
  const withdrawalPage = new WithdrawalPage(playerPage);
  const statementPage = new StatementPage(playerPage);

  await loginPage.loginWithSession();
const actualUsername = await loginPage.getLoggedInUsername();
console.log(`>> Logged in as: ${actualUsername}`);

  await withdrawalPage.navigate();
  const before = await withdrawalPage.getStats('before');
  console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

// ── PART 2: Validate rollover met ──
  if (before.rollover < before.target) {
    console.log(`>> Rollover not met: ${before.rollover} < ${before.target}`);
    await withdrawalPage.verifyRolloverError(WITHDRAW_AMOUNT);

    // Generate report for rollover not met
    const report = `
========================================
   WITHDRAWAL TEST REPORT
========================================
Date/Time     : ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
Player        : ${actualUsername}
----------------------------------------
RESULT        : ❌ CANNOT PROCEED
Reason        : Rollover not met
----------------------------------------
ROLLOVER / TARGET
  Current     : ${before.rollover.toFixed(2)} / ${before.target.toFixed(2)}
  Required    : Rollover >= Target
  Shortfall   : ${(before.target - before.rollover).toFixed(2)} more needed
----------------------------------------
BALANCE
  Current     : MYR ${before.balance.toFixed(2)}
----------------------------------------
ACTION NEEDED : Please complete more bets before withdrawing
========================================
`;
    console.log(report);
    writeFileSync('test-report-withdrawal-rollover-not-met.txt', report);
    console.log('>> Report saved to test-report-withdrawal-rollover-not-met.txt');

    await playerContext.close();
    return; // stop test gracefully without throwing error
  }

  // ── PART 3: Test insufficient balance ──
  await withdrawalPage.verifyInsufficientBalance(before.balance + 1000);

  // ── PART 4: Submit withdrawal ──
  await withdrawalPage.navigate();
  await withdrawalPage.submitWithdrawal(WITHDRAW_AMOUNT);

  // ── PART 5: Verify pending ──
  await statementPage.navigateToCashHistory();
  const tx = await statementPage.getLatestTransaction();
  await statementPage.verifyLatestStatus('Pending');

  await playerContext.close();

  // ── PART 6: Backoffice — approve withdrawal ──
  const boContext = await browser.newContext({ storageState: '.auth/backoffice.json' });
  const boPage = await boContext.newPage();
  const backoffice = new BackofficePage(boPage);

  await backoffice.loginWithSession();
  await backoffice.approveWithdrawal('test manual approve withdrawal');

  await boContext.close();

  // ── PART 7: Player — verify after approval ──
  const playerContext2 = await browser.newContext({ storageState: '.auth/player.json' });
  const playerPage2 = await playerContext2.newPage();
  const loginPage2 = new LoginPage(playerPage2);
  const withdrawalPage2 = new WithdrawalPage(playerPage2);
  const statementPage2 = new StatementPage(playerPage2);

  await loginPage2.loginWithSession();

  await statementPage2.navigateToCashHistory();
  await statementPage2.verifyLatestStatus('Approved');

  await withdrawalPage2.navigate();
  const after = await withdrawalPage2.getStats('after');

  const expectedBalance = before.balance - WITHDRAW_AMOUNT;
  expect(after.balance).toBeCloseTo(expectedBalance, 1);
  expect(after.rollover).toBeCloseTo(0, 1);
  expect(after.target).toBeCloseTo(0, 1);
  console.log('>> All assertions passed ✅');

  // ── Report ──
  const report = `
========================================
   WITHDRAWAL APPROVE TEST REPORT
========================================
Date/Time     : ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
Player        : ${actualUsername}
----------------------------------------
TRANSACTION
  Date/Time   : ${tx.dateTime}
  Txn No      : ${tx.txNo}
  Description : ${tx.description}
  Type        : ${tx.type}
  Status      : Approved ✅
  Amount      : MYR ${tx.amount}
----------------------------------------
WITHDRAWAL
  Amount      : MYR ${WITHDRAW_AMOUNT.toFixed(2)}
----------------------------------------
BALANCE
  Before      : MYR ${before.balance.toFixed(2)}
  After       : MYR ${after.balance.toFixed(2)}
  Diff        : MYR -${(before.balance - after.balance).toFixed(2)}
----------------------------------------
ROLLOVER / TARGET
  Before      : ${before.rollover.toFixed(2)} / ${before.target.toFixed(2)}
  After       : ${after.rollover.toFixed(2)} / ${after.target.toFixed(2)}
  Expected    : 0.00 / 0.00 (reset after approval)
----------------------------------------
VALIDATIONS
  Insufficient Balance  : ✅ Verified
  Rollover Met          : ✅ Verified
----------------------------------------
RESULT        : ${
    after.balance.toFixed(2) === expectedBalance.toFixed(2) &&
    after.rollover.toFixed(2) === '0.00'
      ? '✅ ALL ASSERTIONS PASSED'
      : '❌ SOME ASSERTIONS FAILED'
  }
========================================
`;
  console.log(report);
  writeFileSync('test-report-withdrawal-approve.txt', report);

  await playerContext2.close();
});