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

### Step 6 - Create environment file
Create a .env file in the project root with the following:
  ANTHROPIC_API_KEY=your-key-here
  TELEGRAM_BOT_TOKEN=your-token-here
  TELEGRAM_CHAT_ID=your-chat-id-here

### Step 7 - Create auth folder
  mkdir .auth

---

## Configuration

All credentials and test settings are centralized in tests/config.js.
Update this file to change player, backoffice agent, deposit or withdrawal settings.

  // tests/config.js

  export const PLAYER = {
    username: 'automatemyr',
    password: 'ssss1234',
    sessionPath: '.auth/player.json',
  };

  export const BACKOFFICE = {
    username: 'stephen@mv1',
    password: 'qwert123',
    sessionPath: '.auth/backoffice.json',
  };

  export const DEPOSIT = {
    amount: 50,
    rolloverMultiplier: 1,
    bankName: 'C zh test - zh test all',
    packageName: 'Stephen Turnover Package',
  };

  export const WITHDRAWAL = {
    amount: 10,
  };

To change player or agent: update config.js only. All spec files will pick up the change automatically.

---

## Project Structure

QAAutomationProject/
├── tests/
│   ├── pages/                              Page Object Model classes
│   │   ├── LoginPage.js                    Player site login + session management
│   │   ├── BackofficePage.js               Backoffice login + approve/reject actions
│   │   ├── DepositPage.js                  Deposit flow actions
│   │   ├── WithdrawalPage.js               Withdrawal flow actions
│   │   └── StatementPage.js                Cash history verification
│   ├── helpers/
│   │   └── CaptchaHelper.js                Auto captcha solver
│   ├── config.js                           Centralized credentials and test settings
│   ├── CreateMemberAndSaveSession.spec.js  Create members + bank account + change password
│   ├── ManualApproveDeposit.spec.js        Deposit approve test
│   ├── ManualRejectDeposit.spec.js         Deposit reject test
│   ├── ManualApproveWithdrawal.spec.js     Withdrawal approve test
│   └── ManualRejectWithdrawal.spec.js      Withdrawal reject test
├── .auth/                                  Saved login sessions (not in git)
├── captcha-server.js                       Local captcha solving server
├── solve_captcha.py                        Python captcha OCR script
├── playwright.config.js                    Playwright configuration
└── .env                                    Environment variables (not in git)

---

## Running Tests

### Step 1 - Start captcha server
Open a terminal and keep it running throughout all tests:
  node captcha-server.js

### Step 2 - Create members (first time only)
To create new test members, update MEMBERS array in CreateMemberAndSaveSession.spec.js:
  const MEMBERS = [
    { username: 'automyr1', currency: 'MYR' },
    { username: 'automyr2', currency: 'MYR' },
  ];

Then run:
  npx playwright test tests/CreateMemberAndSaveSession.spec.js --headed --project=member-setup

This will:
  - Create member in backoffice
  - Update bank account
  - Login to playsite and change password

### Step 3 - Run individual tests
Open a second terminal and run:

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
  1. Player logs in first time + session saved
  2. Check balance + rollover/target before
  3. Submit deposit (Bank Transfer)
  4. Verify transaction status = Pending in Cash History
  5. Backoffice logs in fresh + session saved
  6. Check player outstanding balance in Member Account
  7. Search player in Cash Deposit List
  8. Approve / Reject deposit
  9. Player restores saved session (no captcha needed)
  10. Verify balance + rollover/target after
  11. Assert values match expected
  12. Generate test report

### Withdrawal Tests
  1. Player logs in first time + session saved
  2. Check balance + rollover/target before
  3. Verify rollover >= target (must be met)
  4. Test insufficient balance error
  5. Submit withdrawal
  6. Verify transaction status = Pending in Cash History
  7. Backoffice logs in fresh + session saved
  8. Search player in Cash Withdraw List
  9. Approve / Reject withdrawal
  10. Player restores saved session (no captcha needed)
  11. Verify balance + rollover/target after
  12. Assert values match expected
  13. Generate test report

### Create Member Flow
  1. Backoffice logs in
  2. Check username availability
  3. Create member with currency
  4. Update bank account (unique account number generated)
  5. Login to playsite with initial password
  6. Change password to new password
  7. Context closed (no session saved)

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

### Deposit Reject
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
  Rollover Not Met        test-report-withdrawal-rollover-not-met.txt

HTML report with screenshots and videos:
  npx playwright show-report

---

## Troubleshooting

### PowerShell execution policy error
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

### Port 3333 already in use
  netstat -ano | findstr :3333
  taskkill /PID <PID number> /F
  node captcha-server.js

### ddddocr not found
  pip install ddddocr Pillow

### Git not recognized
  Download and install Git from https://git-scm.com/download/win

### Session expired error
No longer needed - each test logs in fresh automatically.
Just make sure captcha server is running:
  node captcha-server.js

---

## Playwright Config Projects

  Project         Description
  -----------------------------------------------------------------------
  chromium        Runs all tests except CreateMemberAndSaveSession
  member-setup    Runs CreateMemberAndSaveSession only (no dependencies)

Run specific project:
  npx playwright test tests/CreateMemberAndSaveSession.spec.js --headed --project=member-setup
  npx playwright test tests/ManualApproveDeposit.spec.js --headed

---

## Tech Stack

  Tool              Purpose
  -----------------------------------------------------------------------
  Playwright        Browser automation
  Node.js           Runtime environment
  Python            Captcha OCR processing
  ddddocr           Captcha recognition
  Page Object Model Test architecture pattern
  config.js         Centralized test configuration

---
