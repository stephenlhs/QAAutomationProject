# QA Automation Project

Automated testing suite for deposit and withdrawal flows using Playwright.

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

### Step 6 - Create auth folder
  mkdir .auth

---

## Project Structure

QAAutomationProject/
├── tests/
│   ├── pages/                          Page Object Model classes
│   │   ├── LoginPage.js                Player site login
│   │   ├── BackofficePage.js           Backoffice login + actions
│   │   ├── DepositPage.js              Deposit actions
│   │   ├── WithdrawalPage.js           Withdrawal actions
│   │   └── StatementPage.js            Cash history actions
│   ├── helpers/
│   │   └── CaptchaHelper.js            Auto captcha solver
│   ├── auth.setup.js                   Save login sessions
│   ├── ManualApproveDeposit.spec.js    Deposit approve test
│   ├── ManualRejectDeposit.spec.js     Deposit reject test
│   ├── ManualApproveWithdrawal.spec.js Withdrawal approve test
│   └── ManualRejectWithdrawal.spec.js  Withdrawal reject test
├── .auth/                              Saved login sessions (not in git)
├── captcha-server.js                   Local captcha solving server
├── solve_captcha.py                    Python captcha OCR script
├── playwright.config.js                Playwright configuration
└── .env                                Environment variables (not in git)

---

## Running Tests

### Step 1 - Start captcha server
Open a terminal and keep it running:
  node captcha-server.js

### Step 2 - Save login sessions (first time only)
Open a second terminal:
  npx playwright test tests/auth.setup.js --headed

### Step 3 - Run individual tests

Manual Approve Deposit:
  npx playwright test tests/ManualApproveDeposit.spec.js --headed

Manual Reject Deposit:
  npx playwright test tests/ManualRejectDeposit.spec.js --headed

Manual Approve Withdrawal:
  npx playwright test tests/ManualApproveWithdrawal.spec.js --headed

Manual Reject Withdrawal:
  npx playwright test tests/ManualRejectWithdrawal.spec.js --headed

Run all tests:
  npx playwright test --headed

### Step 4 - View test report
  npx playwright show-report

---

## Test Flow

### Deposit Tests
  1. Player logs in to player site
  2. Check balance + rollover/target before
  3. Submit deposit (Bank Transfer)
  4. Verify transaction status = Pending in Cash History
  5. Agent logs in to backoffice
  6. Check player outstanding balance in Member Account
  7. Approve / Reject deposit
  8. Player checks balance + rollover/target after
  9. Assert values match expected
  10. Generate test report

### Withdrawal Tests
  1. Player logs in to player site
  2. Check balance + rollover/target before
  3. Verify rollover >= target (must be met)
  4. Test insufficient balance error
  5. Submit withdrawal
  6. Verify transaction status = Pending in Cash History
  7. Agent logs in to backoffice
  8. Approve / Reject withdrawal
  9. Player checks balance + rollover/target after
  10. Assert values match expected
  11. Generate test report

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

### Withdrawal Reject
  - Balance unchanged
  - Rollover/Target unchanged

---

## Reports

After each test run, a report file is generated:

  Test                    Report File
  -----------------------------------------------------------------------
  Approve Deposit         test-report-deposit-approve.txt
  Reject Deposit          test-report-deposit-reject.txt
  Approve Withdrawal      test-report-withdrawal-approve.txt
  Reject Withdrawal       test-report-withdrawal-reject.txt

HTML report with screenshots and videos:
  npx playwright show-report

---

## Troubleshooting

### PowerShell execution policy error
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

### Session expired error
Re-run auth setup:
  npx playwright test tests/auth.setup.js --headed

### Captcha server not running
Make sure to start captcha server before running tests:
  node captcha-server.js

### ddddocr not found
  pip install ddddocr Pillow

### Port 3333 already in use
  netstat -ano | findstr :3333
  taskkill /PID <PID> /F

---

## Tech Stack

  Tool              Purpose
  -----------------------------------------------------------------------
  Playwright        Browser automation
  Node.js           Runtime environment
  Python            Captcha OCR processing
  ddddocr           Captcha recognition
  Page Object Model Test architecture pattern

---

## Author

Stephen - QA Engineer
