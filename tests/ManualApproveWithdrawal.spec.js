import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { CaptchaHelper } from './helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { StatementPage } from './pages/StatementPage.js';
import { PLAYER, BACKOFFICE, WITHDRAWAL } from './config.js';

test('withdrawal approve — verify balance decreases and rollover resets', async ({ browser }) => {

  // ── PART 1: Player — login fresh + save session + check stats before ──
  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  const loginPage = new LoginPage(playerPage, 'player');
  const withdrawalPage = new WithdrawalPage(playerPage);
  const statementPage = new StatementPage(playerPage);
  const captcha = new CaptchaHelper(playerPage, 'player');

  await loginPage.loginAndSaveSession(
    PLAYER.username,
    PLAYER.password,
    captcha,
    PLAYER.sessionPath
  );

  const actualUsername = await loginPage.getLoggedInUsername();
  console.log(`>> Logged in as: ${actualUsername}`);

  await withdrawalPage.navigate();
  const before = await withdrawalPage.getStats('before');
  console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

  // ── PART 2: Validate rollover met ──
  if (before.rollover < before.target) {
    console.log(`>> Rollover not met: ${before.rollover} < ${before.target}`);
    await withdrawalPage.verifyRolloverError(WITHDRAWAL.amount);

    const report = `
========================================
   WITHDRAWAL APPROVE TEST REPORT
========================================
Date/Time     : ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
Player        : ${actualUsername}
----------------------------------------
RESULT        : ❌ CANNOT PROCEED
Reason        : Rollover not met
----------------------------------------
ROLLOVER / TARGET
  Current     : ${before.rollover.toFixed(2)} / ${before.target.toFixed(2)}
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
    await playerContext.close();
    return;
  }

  // ── PART 3: Test insufficient balance ──
  await withdrawalPage.verifyInsufficientBalance(before.balance + 1000);

  // ── PART 4: Submit withdrawal ──
  await withdrawalPage.navigate();
  await withdrawalPage.submitWithdrawal(WITHDRAWAL.amount);

  // ── PART 5: Verify pending in Cash History ──
  await statementPage.navigateToCashHistory();
  const tx = await statementPage.getLatestTransaction();
  await statementPage.verifyLatestStatus('Pending');
  console.log(`>> Transaction: ${tx.txNo} | ${tx.dateTime}`);

  await playerContext.close();

  // ── PART 6: Backoffice — login fresh + save session + approve withdrawal ──
  const boContext = await browser.newContext();
  const boPage = await boContext.newPage();
  const backoffice = new BackofficePage(boPage, 'backoffice');
  const boCaptcha = new CaptchaHelper(boPage, 'backoffice');

  await backoffice.loginAndSaveSession(
    BACKOFFICE.username,
    BACKOFFICE.password,
    boCaptcha,
    BACKOFFICE.sessionPath,
    BACKOFFICE.twoFASecret // pass secret here
  );

  await backoffice.approveWithdrawal(actualUsername, 'test manual approve withdrawal');

  await boContext.close();

  // ── PART 7: Player — restore session + verify after approval ──
  const playerContext2 = await browser.newContext({ storageState: PLAYER.sessionPath });
  const playerPage2 = await playerContext2.newPage();
  const loginPage2 = new LoginPage(playerPage2, 'player');
  const withdrawalPage2 = new WithdrawalPage(playerPage2);
  const statementPage2 = new StatementPage(playerPage2);

  await loginPage2.loginWithSession();

  await statementPage2.navigateToCashHistory();
  await statementPage2.verifyLatestStatus('Approved');

  await withdrawalPage2.navigate();
  const after = await withdrawalPage2.getStats('after');
  console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

  // ── Assertions ──
  const expectedBalance = before.balance - WITHDRAWAL.amount;
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
  Amount      : MYR ${WITHDRAWAL.amount.toFixed(2)}
----------------------------------------
BALANCE
  Before      : MYR ${before.balance.toFixed(2)}
  After       : MYR ${after.balance.toFixed(2)}
  Expected    : MYR ${expectedBalance.toFixed(2)}
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