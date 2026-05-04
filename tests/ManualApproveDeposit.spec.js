import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { LoginPage } from './pages/LoginPage.js';
import { BackofficePage } from './pages/BackofficePage.js';
import { DepositPage } from './pages/DepositPage.js';
import { WithdrawalPage } from './pages/WithdrawalPage.js';
import { StatementPage } from './pages/StatementPage.js';

const DEPOSIT_AMOUNT = 50;
const ROLLOVER_MULTIPLIER = 1;
const BANK_NAME = 'C zh test - zh test all';

test('deposit approve — verify balance and rollover', async ({ browser }) => {

 // ── PART 1: Player — check stats before ──
const playerContext = await browser.newContext({ storageState: '.auth/player.json' });
const playerPage = await playerContext.newPage();
const loginPage = new LoginPage(playerPage);
const depositPage = new DepositPage(playerPage);
const withdrawalPage = new WithdrawalPage(playerPage);
const statementPage = new StatementPage(playerPage);

await loginPage.loginWithSession();

// Get username dynamically
const actualUsername = await loginPage.getLoggedInUsername();
console.log(`>> Logged in as: ${actualUsername}`);

  await withdrawalPage.navigate();
  const before = await withdrawalPage.getStats('before');
  console.log(`>> BEFORE — Balance: ${before.balance}, Rollover: ${before.rollover}, Target: ${before.target}`);

  // ── PART 2: Submit deposit ──
  await depositPage.navigate();
  await depositPage.selectBankTransfer(BANK_NAME);
  await depositPage.submit(DEPOSIT_AMOUNT);

  // ── PART 3: Verify pending in Cash History ──
  await statementPage.navigateToCashHistory();
  const tx = await statementPage.getLatestTransaction();
  await statementPage.verifyLatestStatus('Pending');
  console.log(`>> Transaction: ${tx.txNo} | ${tx.dateTime}`);

  await playerContext.close();

// ── PART 4: Backoffice ──
  const boContext = await browser.newContext({ storageState: '.auth/backoffice.json' });
  const boPage = await boContext.newPage();
  const backoffice = new BackofficePage(boPage);

  await backoffice.loginWithSession();
  const outstanding = await backoffice.getMemberOutstandingBalance(actualUsername);
  await backoffice.approveDeposit('test manual approve');

  await boContext.close();

  // ── PART 5: Player — verify after approval ──
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
  console.log(`>> AFTER — Balance: ${after.balance}, Rollover: ${after.rollover}, Target: ${after.target}`);

  // ── Calculations ──
  const txBonusAmount = parseFloat(tx.bonus) || 0;
  const totalCredit = DEPOSIT_AMOUNT + txBonusAmount;
  const effectiveBalance = before.balance + outstanding.total;
  const rolloverIncrease = totalCredit * ROLLOVER_MULTIPLIER;

  let expectedRollover, expectedTarget;
  if (effectiveBalance <= 20) {
    expectedRollover = 0;
    expectedTarget = rolloverIncrease;
  } else {
    expectedRollover = before.rollover;
    expectedTarget = before.target + rolloverIncrease;
  }

  const expectedBalance = before.balance + totalCredit;

  // ── Assertions ──
  expect(after.balance).toBeCloseTo(expectedBalance, 1);
  expect(after.rollover).toBeCloseTo(expectedRollover, 1);
  expect(after.target).toBeCloseTo(expectedTarget, 1);
  console.log(`>> All assertions passed ✅`);

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
  Amount      : MYR ${DEPOSIT_AMOUNT.toFixed(2)}
  Bonus       : MYR ${txBonusAmount.toFixed(2)}
  Package     : Stephen Turnover Package (x${ROLLOVER_MULTIPLIER})
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