import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { CaptchaHelper } from './helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { DepositPage } from './pages/DepositPage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { StatementPage } from './pages/StatementPage.js';
import { PLAYER, BACKOFFICE, DEPOSIT } from './config.js';

test('deposit reject — verify balance and rollover unchanged', async ({ browser }) => {

  // ── PART 1: Player — login fresh + save session + check stats before ──
  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  const loginPage = new LoginPage(playerPage, 'player');
  const depositPage = new DepositPage(playerPage);
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

  // ── PART 2: Submit deposit ──
  await depositPage.navigate();
  await depositPage.selectBankTransfer(DEPOSIT.bankName);
  await depositPage.submit(DEPOSIT.amount);

  // ── PART 3: Verify pending in Cash History ──
  await statementPage.navigateToCashHistory();
  const tx = await statementPage.getLatestTransaction();
  await statementPage.verifyLatestStatus('Pending');
  console.log(`>> Transaction: ${tx.txNo} | ${tx.dateTime}`);

  await playerContext.close();

  // ── PART 4: Backoffice — login fresh + save session + reject deposit ──
  const boContext = await browser.newContext();
  const boPage = await boContext.newPage();
  const backoffice = new BackofficePage(boPage, 'backoffice');
  const boCaptcha = new CaptchaHelper(boPage, 'backoffice');

  await backoffice.loginAndSaveSession(
    BACKOFFICE.username,
    BACKOFFICE.password,
    boCaptcha,
    BACKOFFICE.sessionPath
  );

  await backoffice.rejectDeposit(actualUsername, 'test manual reject');

  await boContext.close();

  // ── PART 5: Player — restore session + verify after rejection ──
  const playerContext2 = await browser.newContext({ storageState: PLAYER.sessionPath });
  const playerPage2 = await playerContext2.newPage();
  const loginPage2 = new LoginPage(playerPage2, 'player');
  const withdrawalPage2 = new WithdrawalPage(playerPage2);
  const statementPage2 = new StatementPage(playerPage2);

  await loginPage2.loginWithSession();

  await statementPage2.navigateToCashHistory();
  await statementPage2.verifyLatestStatus('Rejected');

  await withdrawalPage2.navigate();
  const after = await withdrawalPage2.getStats('after');
  console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

  // ── Assertions — unchanged ──
  expect(after.balance).toBeCloseTo(before.balance, 1);
  expect(after.rollover).toBeCloseTo(before.rollover, 1);
  expect(after.target).toBeCloseTo(before.target, 1);
  console.log('>> Balance and rollover unchanged ✅');

  // ── Report ──
  const txBonusAmount = parseFloat(tx.bonus) || 0;
  const report = `
========================================
   DEPOSIT REJECT TEST REPORT
========================================
Date/Time     : ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
Player        : ${actualUsername}
----------------------------------------
TRANSACTION
  Date/Time   : ${tx.dateTime}
  Txn No      : ${tx.txNo}
  Description : ${tx.description}
  Type        : ${tx.type}
  Status      : Rejected ❌
  Amount      : MYR ${tx.amount}
  Bonus       : MYR ${txBonusAmount.toFixed(2)}
  Remark      : test manual reject
----------------------------------------
DEPOSIT
  Amount      : MYR ${DEPOSIT.amount.toFixed(2)}
  Package     : ${DEPOSIT.packageName} (x${DEPOSIT.rolloverMultiplier})
----------------------------------------
BALANCE
  Before      : MYR ${before.balance.toFixed(2)}
  After       : MYR ${after.balance.toFixed(2)}
  Expected    : Unchanged
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