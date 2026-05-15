# QA Automation Project

Automated testing suite for deposit, withdrawal and game flows using Playwright.
Supports multiple environments: Staging, UAT and Production.

---

## Prerequisites

Before you begin, install the following:

### 1. Node.js
- Download from https://nodejs.org
- Choose LTS version
- During install, check "Add to PATH"
- Verify installation:
  node -v
  npm -v

### 2. Python
- Download from https://www.python.org/downloads/
- During install, check "Add Python to PATH"
- Verify installation:
  python --version

### 3. Visual Studio Code
- Download from https://code.visualstudio.com
- Install recommended extensions:
  - Playwright Test for VSCode
  - JavaScript (ES6+)

### 4. Git
- Download from https://git-scm.com/download/win
- Keep all default settings during install
- Verify installation:
  git --version

---

## Installation

### Step 1 - Clone the repository
  git clone https://github.com/stephenlhs/QAAutomationProject.git
  cd QAAutomationProject

### Step 2 - Fix PowerShell execution policy (Windows only)
Open PowerShell as Administrator and run:
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

### Step 3 - Install Node.js dependencies
  npm install

### Step 4 - Install Playwright browsers
  npx playwright install

### Step 5 - Install Python dependencies
  pip install ddddocr Pillow

### Step 6 - Install OTPAuth for 2FA support
  npm install otpauth

### Step 7 - Create environment file
Copy .env.example to .env and fill in your values:
  copy .env.example .env

Edit .env with your credentials:
  TEST_ENV=staging

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

### Step 8 - Create auth folder
  mkdir .auth

---

## Environments

  Environment   Playsite                        Backoffice
  -----------------------------------------------------------------------
  Staging       https://stage-mem.linkv2.com/   https://stage-bo.linkv2.com/login
  UAT           https://mem2.linkv2.com/#        https://ag-uat.linkv2.com/login
  Production    https://998hihi.com/             https://bo.v2hotel.com/login

---

## Running Tests

### Option 1 - QA Dashboard (Recommended)
Double-click start-dashboard.bat in the project root.

This will automatically:
  1. Start captcha server (port 3333)
  2. Start dashboard server (port 4000)
  3. Open browser at http://localhost:4000

From the dashboard you can:
  - Select environment (Staging / UAT / Prod)
  - Set deposit amount for deposit tests
  - Set withdrawal amount for withdrawal tests
  - Add/remove members for create member test
  - Click Run button for any test
  - See live output in real time
  - Track pass/fail count per session

### Option 2 - Command Line
Open two terminals:

Terminal 1 - Start captcha server (keep running):
  node captcha-server.js

Terminal 2 - Run tests:

  Staging (default):
  npx playwright test tests/ManualApproveDeposit.spec.js --headed

  UAT:
  $env:TEST_ENV="uat"; npx playwright test tests/ManualApproveDeposit.spec.js --headed

  Production:
  $env:TEST_ENV="prod"; npx playwright test tests/ManualApproveDeposit.spec.js --headed

### View HTML report
  npx playwright show-report

---

## Configuration

All credentials are stored in .env file (never committed to git).
Test settings are in tests/config.js.

  PLAYER        - Player site login credentials per environment
  BACKOFFICE    - Backoffice login credentials + 2FA secret per environment
  DEPOSIT       - Deposit amount (overridable from dashboard), bank name, package name
  WITHDRAWAL    - Withdrawal amount (overridable from dashboard)
  MEMBER_SETUP  - Member creation settings per environment
  MEMBERS       - List of test members (overridable from dashboard)
  URLS          - Environment URLs + member prefix + popup selectors

---

## Project Structure

QAAutomationProject/
├── tests/
│   ├── pages/                              Page Object Model classes
│   │   ├── LoginPage.js                    Player site login + session management
│   │   ├── BackofficePage.js               Backoffice login (with 2FA) + approve/reject
│   │   ├── DepositPage.js                  Deposit flow actions
│   │   ├── WithdrawalPage.js               Withdrawal flow actions
│   │   └── StatementPage.js                Cash history verification
│   ├── helpers/
│   │   └── CaptchaHelper.js                Auto captcha solver via ddddocr
│   ├── config.js                           Centralized config (reads from .env)
│   ├── CreateMemberAndSaveSession.spec.js  Create members + bank account + change password
│   ├── ManualApproveDeposit.spec.js        Deposit approve test
│   ├── ManualRejectDeposit.spec.js         Deposit reject test
│   ├── ManualApproveWithdrawal.spec.js     Withdrawal approve test
│   ├── ManualRejectWithdrawal.spec.js      Withdrawal reject test
│   └── SlotGame.spec.js                    Slot game manual play + statement verify
├── .auth/                                  Saved login sessions (not in git)
├── .env                                    Environment credentials (not in git)
├── .env.example                            Environment template (safe to share)
├── captcha-server.js                       Local captcha solving server (port 3333)
├── solve_captcha.py                        Python captcha OCR script
├── server.js                               QA Dashboard web server (port 4000)
├── index.html                              QA Dashboard UI
├── start-dashboard.bat                     One-click launcher for dashboard
├── playwright.config.js                    Playwright configuration
└── README.txt                              This file

---

## Test Flow

### Deposit Tests
  1. Player logs in fresh + session saved (captcha solved once)
  2. Check balance + rollover/target BEFORE
  3. Submit deposit (Bank Transfer)
  4. Verify transaction status = Pending in Cash History
  5. Backoffice logs in fresh + session saved (with 2FA if enabled)
  6. Check player outstanding balance in Member Account (staging only)
  7. Search player in Cash Deposit List
  8. Approve / Reject transaction
  9. Player restores saved session (no captcha needed)
  10. Verify balance + rollover/target AFTER
  11. Assert values match expected
  12. Generate test report

### Withdrawal Tests
  1. Player logs in fresh + session saved
  2. Check balance + rollover/target BEFORE
  3. Verify rollover >= target (must be met, else generate report and stop)
  4. Test insufficient balance error
  5. Submit withdrawal
  6. Verify transaction status = Pending
  7. Backoffice approves/rejects
  8. Player restores session
  9. Verify balance + rollover/target AFTER
  10. Generate test report

### Create Member Flow
  1. Backoffice logs in (with 2FA if enabled)
  2. Check username availability
  3. Create member with currency
  4. Update bank account (unique number: 12344321XXXYYY)
  5. Login to playsite with initial password (1234ssss)
  6. Change password to new password (ssss1234)

### Slot Game Test
  1. Player logs in fresh
  2. Record balance + rollover BEFORE
  3. Navigate to game (Pragmatic — Sweet Bonanza 1000)
  4. Pause — player plays manually
  5. Press ENTER to resume automation
  6. Record balance + rollover AFTER
  7. Check statement for bet details
  8. Generate test report

---

## Business Logic

### Deposit Approve - Rollover/Target Calculation

  Condition                          Result
  -----------------------------------------------------------------------
  Balance + Outstanding <= 20        Rollover RESETS to 0 / deposit amount
  Balance + Outstanding > 20         Rollover STACKS - target increases

### Withdrawal Approve
  - Balance decreases by withdrawal amount
  - Rollover/Target resets to 0/0

### Withdrawal/Deposit Reject
  - Balance unchanged
  - Rollover/Target unchanged

---

## 2FA (Google Authenticator) Support

Backoffice accounts with Google Authenticator enabled are handled automatically.

  1. Add the 2FA secret key to .env:
     STAGING_BO_2FA_SECRET=your-secret-key

  2. Find your secret key:
     - Login to BO
     - Go to Profile > Google Authenticator
     - Copy the text code shown below the QR code

  3. The script auto-generates the 6-digit code during login
     No manual intervention needed!

  Accounts without 2FA:
  - Leave STAGING_BO_2FA_SECRET empty in .env
  - Script will skip 2FA automatically

---

## Google Authenticator Setup for New BO Accounts

When a new BO account is created, the system may force GA setup before accessing BO.

Steps to setup GA for a new account:

  1. Login to BO manually with the new account
  2. Go to Profile > Google Authenticator
  3. Copy the text code shown below the QR code
     Example: GE3EOQKNIRKEKWCX

  4. Add to .env:
     STAGING_BO_2FA_SECRET=GE3EOQKNIRKEKWCX

  5. Scan QR code with Google Authenticator app on your phone
  6. Enter the 6-digit code shown in the app to verify

  7. Script will now auto-generate 2FA codes on every login
     No manual intervention needed!

  Note:
  - Each account has a unique secret key
  - Secret key is found in Profile > Google Authenticator page
  - If secret key changes (re-setup GA), update .env accordingly
  - System clock must be accurate for TOTP codes to work

---

## Reports

After each test run, a report file is generated:

  Test                    Report File
  -----------------------------------------------------------------------
  Approve Deposit         test-report-deposit-approve.txt
  Reject Deposit          test-report-deposit-reject.txt
  Approve Withdrawal      test-report-withdrawal-approve.txt
  Reject Withdrawal       test-report-withdrawal-reject.txt
  Rollover Not Met        test-report-withdrawal-rollover-not-met.txt

HTML report with screenshots and videos:
  npx playwright show-report

---

## Troubleshooting

### PowerShell execution policy error
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

### Port 3333 already in use (captcha server)
  netstat -ano | findstr :3333
  taskkill /PID <PID number> /F
  node captcha-server.js

### Port 4000 already in use (dashboard server)
  netstat -ano | findstr :4000
  taskkill /PID <PID number> /F
  node server.js

### ddddocr not found
  pip install ddddocr Pillow

### otpauth not found
  npm install otpauth

### Git not recognized
  Download and install Git from https://git-scm.com/download/win

### Player username is undefined
  Make sure .env file exists with correct credentials:
  copy .env.example .env
  Then fill in your credentials in .env

### Session expired error
  Each test logs in fresh automatically
  Just make sure captcha server is running

### 2FA code rejected
  - Make sure secret key in .env matches BO Profile > Google Authenticator
  - Make sure your system clock is correct (TOTP is time-based)

### Environment not switching
  Check for leftover env variable in terminal:
  echo $env:TEST_ENV
  Remove-Item Env:TEST_ENV

---

## Playwright Config Projects

  Project         Description
  -----------------------------------------------------------------------
  chromium        Runs all tests except CreateMemberAndSaveSession
  member-setup    Runs CreateMemberAndSaveSession only (no dependencies)

---

## Tech Stack

  Tool              Purpose
  -----------------------------------------------------------------------
  Playwright        Browser automation
  Node.js           Runtime environment
  Python            Captcha OCR
  ddddocr           Captcha recognition
  otpauth           2FA TOTP code generation
  Page Object Model Test architecture pattern
  config.js         Centralized test configuration
  dotenv            Environment variable management
  server.js         QA Dashboard web server
  index.html        QA Dashboard UI

---