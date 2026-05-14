import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { CaptchaHelper } from './helpers/CaptchaHelper.js';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { DepositPage } from './pages/DepositPage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { StatementPage } from './pages/StatementPage.js';
import { PLAYER, BACKOFFICE, DEPOSIT } from './config.js';

test('deposit approve — verify balance and rollover', async ({ browser }) => {

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

  // ── PART 4: Backoffice — login fresh + save session + check outstanding + approve ──
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

  const outstanding = await backoffice.getMemberOutstandingBalance(actualUsername);
  await backoffice.approveDeposit(actualUsername, 'test manual approve');

  await boContext.close();

  // ── PART 5: Player — restore session + verify after approval ──
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

  // ── Calculations ──
  const txBonusAmount = parseFloat(tx.bonus) || 0;
  const totalCredit = DEPOSIT.amount + txBonusAmount;
  const effectiveBalance = before.balance + outstanding.total;
  const rolloverIncrease = totalCredit * DEPOSIT.rolloverMultiplier;

  let expectedRollover, expectedTarget;
  if (effectiveBalance <= 20) {
    expectedRollover = 0;
    expectedTarget = rolloverIncrease;
    console.log(`>> Effective balance <= 20 — rollover RESETS`);
  } else {
    expectedRollover = before.rollover;
    expectedTarget = before.target + rolloverIncrease;
    console.log(`>> Effective balance > 20 — rollover STACKS`);
  }

  const expectedBalance = before.balance + totalCredit;

  // ── Assertions ──
  expect(after.balance).toBeCloseTo(expectedBalance, 1);
  expect(after.rollover).toBeCloseTo(expectedRollover, 1);
  expect(after.target).toBeCloseTo(expectedTarget, 1);
  console.log('>> All assertions passed ✅');

  // ── Report ──
  const report = `
========================================
   DEPOSIT APPROVE TEST REPORT
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
  Bonus       : MYR ${txBonusAmount.toFixed(2)}
  Total Credit: MYR ${totalCredit.toFixed(2)}
----------------------------------------
DEPOSIT
  Amount      : MYR ${DEPOSIT.amount.toFixed(2)}
  Bonus       : MYR ${txBonusAmount.toFixed(2)}
  Package     : ${DEPOSIT.packageName} (x${DEPOSIT.rolloverMultiplier})
----------------------------------------
BALANCE
  Before      : MYR ${before.balance.toFixed(2)}
  After       : MYR ${after.balance.toFixed(2)}
  Diff        : MYR +${(after.balance - before.balance).toFixed(2)}
----------------------------------------
OUTSTANDING BREAKDOWN
  Sport       : ${outstanding.sport.toFixed(2)}
  Live Casino : ${outstanding.casino.toFixed(2)}
  Lottery     : ${outstanding.lottery.toFixed(2)}
  Games       : ${outstanding.games.toFixed(2)}
  P2P         : ${outstanding.p2p.toFixed(2)}
  Total       : ${outstanding.total.toFixed(2)}
  Effective   : ${effectiveBalance.toFixed(2)} (balance + outstanding)
  Logic       : ${effectiveBalance <= 20 ? 'RESET' : 'STACKED'}
----------------------------------------
ROLLOVER / TARGET
  Before      : ${before.rollover.toFixed(2)} / ${before.target.toFixed(2)}
  After       : ${after.rollover.toFixed(2)} / ${after.target.toFixed(2)}
  Expected    : ${expectedRollover.toFixed(2)} / ${expectedTarget.toFixed(2)}
----------------------------------------
RESULT        : ${
    after.balance.toFixed(2) === expectedBalance.toFixed(2) &&
    after.target.toFixed(2) === expectedTarget.toFixed(2)
      ? '✅ ALL ASSERTIONS PASSED'
      : '❌ SOME ASSERTIONS FAILED'
  }
========================================
`;
  console.log(report);
  writeFileSync('test-report-deposit-approve.txt', report);

  await playerContext2.close();
});