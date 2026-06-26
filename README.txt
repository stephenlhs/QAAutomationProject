# QA Automation Project (v2)

Automated testing suite for deposit, withdrawal, paygate, and member-setup flows using Playwright.
Supports Staging, UAT, and Production environments with auto captcha solving and 2FA handling.

---

## Prerequisites

Before you begin, install the following:

### 1. Node.js
- Download from https://nodejs.org
- Choose LTS version
- During install, check "Add to PATH"
- Verify: node -v  /  npm -v

### 2. Python
- Download from https://www.python.org/downloads/
- During install, check "Add Python to PATH"
- Verify: python --version

### 3. Git
- Download from https://git-scm.com/download/win
- Keep all default settings during install
- Verify: git --version

### 4. Visual Studio Code (optional but recommended)
- Download from https://code.visualstudio.com
- Recommended extension: Playwright Test for VSCode

---

## Installation

### Step 1 - Clone the repository
  git clone https://github.com/<your-username>/QAAutomationProject.git
  cd QAAutomationProject

### Step 2 - Fix PowerShell execution policy (Windows only)
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

### Step 3 - Install Node.js dependencies
  npm install

### Step 4 - Install Playwright browser
  npx playwright install chromium

  NOTE: If the install hangs at "100% 0.0s", add the following folder to
  Windows Defender exclusions, then re-run:
    C:\Users\<you>\AppData\Local\ms-playwright

### Step 5 - Install Python dependencies
  pip install ddddocr openpyxl

### Step 6 - Create environment file
  copy .env.example .env

  Open .env and fill in your credentials:

  STAGING_PLAYER_USERNAME=your-player-username
  STAGING_PLAYER_PASSWORD=your-player-password
  STAGING_BO_USERNAME=your-bo-username
  STAGING_BO_PASSWORD=your-bo-password
  STAGING_BO_2FA_SECRET=your-2fa-secret-if-enabled

  UAT_PLAYER_USERNAME=
  UAT_PLAYER_PASSWORD=
  UAT_BO_USERNAME=
  UAT_BO_PASSWORD=
  UAT_BO_2FA_SECRET=

  PROD_PLAYER_USERNAME=
  PROD_PLAYER_PASSWORD=
  PROD_BO_USERNAME=
  PROD_BO_PASSWORD=
  PROD_BO_2FA_SECRET=

---

## Environments

  Environment   Playsite                  Backoffice
  --------------------------------------------------------
  Staging       configured in .env        configured in .env
  UAT           configured in .env        configured in .env
  Production    configured in .env        configured in .env

NOTE: Staging members have a BO prefix (e.g. player1 appears as <prefix>player1
in BO). The prefix is set in staging/config.js. Always use the full prefixed
name as CUSTOM_PLAYER_USERNAME for staging tests.

---

## QA Dashboard (Recommended)

The QA Dashboard is a web UI to run tests without using the terminal.

### Start the dashboard (one click)
  Double-click: start-dashboard.bat

This will:
  - Start Captcha Server on port 3333
  - Start QA Dashboard on port 4000
  - Start ngrok public tunnel (check ngrok window for your HTTPS URL)
  - Open browser automatically at http://localhost:4000

### Dashboard features
  - Switch environments (Staging / UAT / Prod)
  - Set custom deposit and withdrawal amounts
  - Select paygate method (Bank / EWallet / QR / Crypto)
  - Create members with currency selection
  - Run / Stop any test with one click
  - Live test output streaming
  - Pass / Fail stats tracker
  - Captcha server online/offline indicator
  - Pause / Resume banner for paygate vendor callbacks

### Access dashboard remotely via ngrok
  start-dashboard.bat starts ngrok automatically.
  Check the ngrok window for a line like:
    Forwarding  https://xxxx-xxxx.ngrok-free.app -> http://localhost:4000

  Use that URL on your phone or any device to access the dashboard
  and click the Approved/Rejected resume buttons remotely.

### First-time ngrok setup
  winget install ngrok.ngrok
  ngrok update
  ngrok config add-authtoken YOUR_TOKEN

  Get your authtoken from: https://dashboard.ngrok.com/authtokens (free account)
  NOTE: The free plan generates a new URL every time ngrok restarts.

---

## Running Tests (Terminal)

### Step 1 - Start captcha server
Open a terminal and keep it running:
  node captcha-server.js

### Step 2 - Create members (first time only)
  # Staging
  npx playwright test AutomationProject/staging/CreateMemberAndSaveSession.spec.js --headed --project=staging-member-setup

  # Specific member
  CUSTOM_MEMBERS='[{"username":"player1","currency":"MYR"}]' npx playwright test AutomationProject/staging/CreateMemberAndSaveSession.spec.js --headed --project=staging-member-setup

### Step 3 - Run individual tests

  Manual Approve Deposit (staging):
  npx playwright test AutomationProject/staging/ManualApproveDeposit.spec.js --headed --project=staging

  Manual Reject Deposit (staging):
  npx playwright test AutomationProject/staging/ManualRejectDeposit.spec.js --headed --project=staging

  Manual Approve Withdrawal (staging):
  npx playwright test AutomationProject/staging/ManualApproveWithdrawal.spec.js --headed --project=staging

  Manual Reject Withdrawal (staging):
  npx playwright test AutomationProject/staging/ManualRejectWithdrawal.spec.js --headed --project=staging

  Paygate Deposit (staging):
  npx playwright test AutomationProject/staging/PaygateDepositTest.spec.js --headed --project=staging

  Paygate Withdrawal (staging):
  npx playwright test AutomationProject/staging/PaygateWithdrawTest.spec.js --headed --project=staging

  Deposit Reward — base suite (staging, TC-001 to TC-019):
  npx playwright test AutomationProject/staging/DepositReward.spec.js --project=staging

  Deposit Reward — advanced suite (staging, TC-020 to TC-033):
  npx playwright test AutomationProject/staging/DepositReward_Advanced.spec.js --project=staging

  Replace "staging" with "uat" or "prod" for other environments (Deposit Reward is staging-only).

### Step 4 - View HTML report
  npx playwright show-report

---

## Project Structure

QAAutomationProject/
├── AutomationProject/
│   ├── helpers/
│   │   └── CaptchaHelper.js          Auto captcha solver (shared across all envs)
│   ├── staging/
│   │   ├── fixtures/
│   │   │   └── VaderpayC2.json       Paygate method config (methods, banks, amounts)
│   │   ├── pages/                    Page Object Models
│   │   │   ├── BackofficePage.js
│   │   │   ├── DepositPage.js
│   │   │   ├── LoginPage.js
│   │   │   ├── StatementPage.js
│   │   │   └── WithdrawalPage.js
│   │   ├── config.js
│   │   ├── CreateMemberAndSaveSession.spec.js
│   │   ├── DepositReward.spec.js          Deposit Reward base suite (TC-001 to TC-019)
│   │   ├── DepositReward_Advanced.spec.js Deposit Reward advanced suite (TC-020 to TC-033)
│   │   ├── ManualApproveDeposit.spec.js
│   │   ├── ManualRejectDeposit.spec.js
│   │   ├── ManualApproveWithdrawal.spec.js
│   │   ├── ManualRejectWithdrawal.spec.js
│   │   ├── PaygateDepositTest.spec.js
│   │   └── PaygateWithdrawTest.spec.js
│   ├── uat/                          Same structure as staging
│   └── prod/                         Same structure as staging
├── docs/
│   ├── deposit-reward/
│   │   ├── TestCases_TC020-TC031.md  Test case definitions for advanced suite
│   │   ├── planner.md                Design notes and approach
│   │   └── tester.md                 Execution notes
│   └── AI_AGENT_DESIGN.md
├── reports/                          Auto-generated Excel reports per env
├── .auth/                            Saved login sessions (not committed to git)
├── .env                              Your credentials (not committed to git)
├── .env.example                      Credential template (safe to share)
├── captcha-server.js                 Captcha OCR server on port 3333
├── server.js                         QA Dashboard backend on port 4000
├── index.html                        Dashboard UI
├── start-dashboard.bat               One-click launcher (all servers + ngrok)
├── playwright.config.js              Playwright project config
└── README.txt                        This file

---

## Test Flow Summary

### ManualApproveDeposit / ManualRejectDeposit
  1.  Player logs in, records balance/rollover/target BEFORE
  2.  Player submits deposit (Bank Transfer)
  3.  Cash History verified — transaction shows Pending
  4.  BO logs in, approves or rejects transaction
  5.  Player verifies Cash History — final status shown
  6.  Player records balance/rollover/target AFTER
  7.  Assertions:
        Approved -> balance increases + rollover recalculated
        Rejected -> balance/rollover/target unchanged

### ManualApproveWithdrawal / ManualRejectWithdrawal
  1.  Player logs in, records balance/rollover/target BEFORE
  2.  If rollover not met -> verifies rollover-gate error, exits early
  3.  Player submits withdrawal
  4.  BO logs in, approves or rejects transaction
  5.  Player verifies balance/rollover/target AFTER
  6.  Assertions:
        Approved -> balance decreases + rollover/target resets to 0
        Rejected -> balance/rollover/target unchanged

### PaygateDepositTest (VaderPay C2)
  1.  Player logs in, records balance/rollover/target BEFORE
  2.  Player selects package, payment method, gateway card, submits deposit
  3.  Cash History verified — transaction recorded as In Process
  4.  TEST PAUSES — dashboard shows yellow banner with txNo and Approved/Rejected buttons
  5.  Contact vendor to confirm outcome, click Approved or Rejected in dashboard
  6.  Cash History revisited — final transaction status captured
  7.  Player records balance/rollover/target AFTER
  8.  BO logs in, verifies transaction in Cash Deposit List
  9.  Assertions:
        Approved -> balance increases + rollover recalculated
        Rejected -> balance/rollover/target unchanged

  NOTE: The site blocks a new deposit if a previous paygate transaction is still
  Pending. Before re-running, go to BO > Cash Deposit List and reject the
  pending transaction to clear it.

### PaygateWithdrawTest (VaderPay C2)
  1.  Player logs in, records balance/rollover/target BEFORE
  2.  If rollover not met -> verifies rollover-gate error, exits early
  3.  Player submits paygate withdrawal
  4.  Cash History verified
  5.  Player records balance/rollover/target AFTER
  6.  BO logs in, verifies transaction in Cash Withdraw List

### DepositReward Base Suite (TC-001 to TC-019, staging only)
  Tests core Deposit Reward behaviour: BO enable/disable, tier rates, bonus cap,
  counter resets, and rollover.
  1.  BO enables Deposit Reward with 4 tier settings
  2.  Player makes qualifying deposits at various amounts
  3.  BO approves; player checks inbox for promo code
  4.  Player applies promo code on next deposit
  5.  Assertions: correct bonus per tier, capped at $25 MYR, rollover x3

### DepositReward Advanced Suite (TC-020 to TC-033, staging only)
  Edge-case tests that run serially and share claudestag1 player state.

  TC-020  Setting 2 fresh counter — 1st-tier rate applied
  TC-021  Multiple codes — uses oldest first, newest unaffected (balance proof)
  TC-022  Multiple codes — uses newest first
  TC-023  Code expiry — SKIPPED (requires staging clock control)
  TC-024  BO disables feature mid-session; held code still redeemable
  TC-025  Boundary — exact $50.00 earns promo code
  TC-026  Boundary — $49.99 earns no promo code
  TC-027  Promo code entered with zero/blank deposit amount
  TC-028  BO rejects deposit with promo code — code not consumed
  TC-029  Max cap — large deposit bonus capped at $25
  TC-030  Concurrent same-code submission
  TC-031  Cross-setting: Setting 1 code redeemed on Setting 2 deposit
  TC-032  Rollover requirement increases by bonus x rollover multiplier
  TC-033  Old code keeps rollover from issuance (X3), ignores new setting (X5)

  NOTE: Tests use describe.serial — a failure stops all subsequent tests in the suite.

### CreateMemberAndSaveSession
  1.  BO creates each member account
  2.  Sets member bank account
  3.  Player logs in and changes password from initial to new
  4.  Saves player + BO sessions for subsequent tests

---

## VaderpayC2Config.json

Located at AutomationProject/<env>/fixtures/VaderpayC2Config.json

Controls which payment methods are tested:

  {
    "gatewayName": "VaderPay C2",
    "packageName": "Stephen Turnover Package",
    "deposit": {
      "Bank":    { "enabled": false, "tab": "online-transfer", "amount": 50, "username": "", "password": "" },
      "EWallet": { "enabled": false, "tab": "e-wallet",        "amount": 50, "username": "", "password": "" },
      "QR":      { "enabled": true,  "tab": "qr-code-payment", "amount": 50, "username": "your_player", "password": "your_password" },
      "Crypto":  { "enabled": false, "tab": "crypto-payment",  "amount": 50, "username": "", "password": "" }
    },
    "withdraw": {
      "Bank":    { "enabled": true,  "amount": 50, "username": "", "password": "" },
      "EWallet": { "enabled": false, "amount": 50, "username": "", "password": "" }
    }
  }

Set enabled: true for the methods you want to test.
Leave username/password blank to use the default player from .env.

---

## Rollover / Target Business Logic

  Condition                           Result
  --------------------------------------------------------
  Balance + Outstanding <= 20         Rollover RESETS  (target = deposit x multiplier)
  Balance + Outstanding > 20          Rollover STACKS  (target += deposit x multiplier)
  Rollover already met                Rollover RESETS

  Withdrawal Approved -> Balance decreases, Rollover/Target resets to 0/0
  Withdrawal/Deposit Rejected -> Balance, Rollover, Target all unchanged

---

## 2FA (Google Authenticator) Support

BO accounts with Google Authenticator are handled automatically.

  1. Go to BO > Profile > Google Authenticator
  2. Copy the text secret key shown below the QR code
  3. Add to .env:
       STAGING_BO_2FA_SECRET=YOUR_SECRET_KEY
  4. Script auto-generates the 6-digit code on every login

  NOTE: Leave 2FA secret blank in .env if the account has no 2FA.
  NOTE: System clock must be accurate — TOTP codes are time-based.

---

## Environment Variable Overrides

  Variable                    Purpose                         Example
  -----------------------------------------------------------------------
  CUSTOM_PLAYER_USERNAME      Player to log in as             <prefix>player1
  CUSTOM_PLAYER_PASSWORD      Player password                 your_password
  CUSTOM_DEPOSIT_AMOUNT       Deposit amount                  50
  CUSTOM_WITHDRAWAL_AMOUNT    Withdrawal amount               10
  CUSTOM_MEMBERS              JSON array for CreateMember     [{"username":"p1","currency":"MYR"}]
  DEPOSIT_PACKAGE_NAME        Deposit bonus package name      Stephen Turnover Package
  DEPOSIT_ROLLOVER_MULTIPLIER Rollover multiplier             1

---

## Troubleshooting

### PowerShell execution policy error
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

### Port already in use
  netstat -ano | findstr :3333
  netstat -ano | findstr :4000
  taskkill /PID <PID> /F

### ddddocr not found
  pip install ddddocr

### openpyxl not found
  pip install openpyxl

### Playwright browser install hangs at 100% 0.0s
  Add C:\Users\<you>\AppData\Local\ms-playwright to Windows Defender exclusions,
  then re-run: npx playwright install chromium

### 2FA code rejected
  - Confirm 2FA secret in .env matches BO > Profile > Google Authenticator
  - Ensure system clock is accurate

### Withdrawal test hangs at submit
  - Disable payment gateway in BO settings (manual withdrawal tests only)
  - Cancel any pending withdrawal in BO before re-running

### Deposit test fails on bank selection
  - Set deposit page to All-in-One mode in BO settings (not Compact)
  - Allow ~5 minutes after changing the setting

### Paygate resume button not appearing
  - Restart server (node server.js) — ANSI fix requires a fresh server process

### Paygate txNo not found in BO deposit list
  - For rejected transactions the test tries Rejected first, then Pending/InProcess
  - If still not found, check BO manually — vendor callback may not have updated yet

### ngrok authentication failed / version too old
  - Run: ngrok update
  - Then retry: ngrok http 4000

---

## Tech Stack

  Tool              Purpose
  --------------------------------------------------------
  Playwright        Browser automation
  Node.js           Runtime environment
  Python            Captcha OCR
  ddddocr           Captcha recognition
  openpyxl          Excel report generation
  otpauth           2FA TOTP code generation
  Page Object Model Test architecture pattern
  dotenv            Environment variable management
  ngrok             Remote dashboard access via public URL

---
