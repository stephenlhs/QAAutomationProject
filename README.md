# QA Automation Project (v2)

Automated testing suite for deposit, withdrawal, and member-setup flows using Playwright.
Supports Staging, UAT, and Production environments with auto captcha solving and 2FA handling.

---

## Quick Setup (any PC)

### 1. Prerequisites — install once

| Tool | Download | Notes |
|------|----------|-------|
| Node.js (LTS) | https://nodejs.org | Check "Add to PATH" during install |
| Python 3 | https://www.python.org/downloads/ | Check "Add Python to PATH" during install |
| Git | https://git-scm.com/download/win | Keep defaults |

Verify installs:
```
node -v
npm -v
python --version
git --version
```

### 2. Clone the repository

```
git clone https://github.com/stephenlhs/QAAutomationProject.git
cd QAAutomationProject
```

### 3. Install Node.js dependencies

```
npm install
```

### 4. Install Python dependencies

```
pip install openpyxl ddddocr
```

### 5. Install Playwright browser

```
npx playwright install chromium
```

### 6. Set up environment variables

```
copy .env.example .env
```

Open `.env` and fill in your credentials. Required keys are documented inside `.env.example`.

### 7. Start the dashboard

Double-click **`start-dashboard.bat`**

This starts the captcha server (port 3333) and the QA Dashboard (port 4000), then opens your browser automatically.

---

## Running Tests via Dashboard

1. Double-click `start-dashboard.bat`
2. Select environment (Staging / UAT / Prod)
3. Click the test you want to run
4. Watch live output in the terminal panel

---

## Running Tests via Terminal

Start the captcha server first (keep it running in a separate terminal):
```
node captcha-server.js
```

Then in a second terminal, run any of the commands below.

### Create Member (first-time setup)

Creates member accounts and saves login sessions for later tests.

```
# Staging — creates member with x9048_ prefix in BO
npx playwright test AutomationProject/staging/CreateMemberAndSaveSession.spec.js --headed --project=staging-member-setup

# UAT
npx playwright test AutomationProject/uat/CreateMemberAndSaveSession.spec.js --headed --project=uat-member-setup

# Production
npx playwright test AutomationProject/prod/CreateMemberAndSaveSession.spec.js --headed --project=prod-member-setup
```

To create a specific member by name (e.g. `claudep1` with MYR currency):
```
CUSTOM_MEMBERS='[{"username":"claudep1","currency":"MYR"}]' npx playwright test AutomationProject/staging/CreateMemberAndSaveSession.spec.js --headed --project=staging-member-setup
```

### Deposit Tests

Run with a specific player and amount using environment variable overrides:

```
# Approve Deposit — staging
CUSTOM_PLAYER_USERNAME=x9048_claudep1 CUSTOM_PLAYER_PASSWORD=ssss1234 CUSTOM_DEPOSIT_AMOUNT=50 npx playwright test AutomationProject/staging/ManualApproveDeposit.spec.js --headed --project=staging

# Reject Deposit — staging
CUSTOM_PLAYER_USERNAME=x9048_claudep1 CUSTOM_PLAYER_PASSWORD=ssss1234 CUSTOM_DEPOSIT_AMOUNT=50 npx playwright test AutomationProject/staging/ManualRejectDeposit.spec.js --headed --project=staging
```

Replace `staging` with `uat` or `prod` for other environments.

> **Deposit page mode:** The deposit page must be set to **All-in-One** mode in BO settings before running deposit tests. Compact mode is not supported by the automation.

> **Deposit package:** Staging uses `Stephen Turnover Package` (rollover x1) by default. Override with `DEPOSIT_PACKAGE_NAME` in `.env` if needed.

### Withdrawal Tests

> **Prerequisite:** Disable the payment gateway (paygate) in BO settings before running withdrawal tests. These tests are designed for **manual withdrawal** flow only. If paygate is enabled and the withdrawal amount falls within its limit, the transaction will be routed to the gateway instead and the test will hang.

```
# Approve Withdrawal — staging
CUSTOM_PLAYER_USERNAME=x9048_claudep1 CUSTOM_PLAYER_PASSWORD=ssss1234 CUSTOM_WITHDRAWAL_AMOUNT=10 npx playwright test AutomationProject/staging/ManualApproveWithdrawal.spec.js --headed --project=staging

# Reject Withdrawal — staging
CUSTOM_PLAYER_USERNAME=x9048_claudep1 CUSTOM_PLAYER_PASSWORD=ssss1234 CUSTOM_WITHDRAWAL_AMOUNT=10 npx playwright test AutomationProject/staging/ManualRejectWithdrawal.spec.js --headed --project=staging
```

Replace `staging` with `uat` or `prod` for other environments.

### View HTML Report

```
npx playwright show-report
```

---

## Environment Variable Overrides

Pass these as prefixes on any test command to override defaults without editing `.env`:

| Variable | Purpose | Example |
|----------|---------|---------|
| `CUSTOM_PLAYER_USERNAME` | Player to log in as | `x9048_claudep1` |
| `CUSTOM_PLAYER_PASSWORD` | Player password | `ssss1234` |
| `CUSTOM_DEPOSIT_AMOUNT` | Deposit amount in MYR | `50` |
| `CUSTOM_WITHDRAWAL_AMOUNT` | Withdrawal amount in MYR | `10` |
| `CUSTOM_MEMBERS` | JSON array for CreateMember | `[{"username":"abc","currency":"MYR"}]` |
| `DEPOSIT_PACKAGE_NAME` | Deposit bonus package name | `Stephen Turnover Package` |
| `DEPOSIT_ROLLOVER_MULTIPLIER` | Rollover multiplier for assertions | `1` |

---

## Project Structure

```
QAAutomationProject/
├── AutomationProject/
│   ├── helpers/
│   │   └── CaptchaHelper.js          Auto captcha solver (shared across all envs)
│   ├── staging/
│   │   ├── pages/                    Page Object Models for staging
│   │   │   ├── BackofficePage.js
│   │   │   ├── DepositPage.js
│   │   │   ├── LoginPage.js
│   │   │   ├── StatementPage.js
│   │   │   └── WithdrawalPage.js
│   │   ├── config.js                 Staging URLs + env vars
│   │   ├── CreateMemberAndSaveSession.spec.js
│   │   ├── ManualApproveDeposit.spec.js
│   │   ├── ManualRejectDeposit.spec.js
│   │   ├── ManualApproveWithdrawal.spec.js
│   │   └── ManualRejectWithdrawal.spec.js
│   ├── uat/                          Same structure as staging
│   └── prod/                         Same structure as staging
├── reports/                          Auto-generated Excel reports per env
├── .auth/                            Saved login sessions (not committed to git)
├── .env                              Your credentials (not committed to git)
├── .env.example                      Credential template (safe to share)
├── captcha-server.js                 Captcha OCR server on port 3333
├── server.js                         QA Dashboard backend on port 4000
├── index.html                        Dashboard UI
├── start-dashboard.bat               One-click launcher (Windows)
├── playwright.config.js              Playwright project config
└── README.md                         This file
```

---

## Environments

| Environment | Playsite | Backoffice |
|-------------|----------|------------|
| Staging | https://stage-mem.linkv2.com/ | https://stage-bo.linkv2.com/login |
| UAT | https://mem2.linkv2.com/# | https://ag-uat.linkv2.com/login |
| Production | https://998hihi.com/ | https://bo.v2hotel.com/login |

> **Staging member prefix:** BO stores staging members with the prefix `x9048_` (e.g. member `claudep1` appears as `x9048_claudep1` in BO). Always use the full prefixed name as `CUSTOM_PLAYER_USERNAME` for staging tests.

---

## Test Flow Summary

### CreateMemberAndSaveSession
1. BO logs in and creates each member account
2. Sets member bank account
3. Player logs in and changes password from initial to new
4. Saves player + BO sessions for subsequent tests

### ManualApproveDeposit / ManualRejectDeposit
1. Player logs in and records balance/rollover before deposit
2. Player submits deposit (Bank Transfer, Maybank)
3. BO logs in and approves or rejects the pending transaction
4. Player verifies transaction status and balance/rollover after
5. Assertions: approve → balance increases + rollover recalculated; reject → balance/rollover unchanged

### ManualApproveWithdrawal / ManualRejectWithdrawal
1. Player logs in and records balance/rollover before withdrawal
2. If rollover not met → test verifies rollover-gate error and exits early
3. Player attempts withdrawal above balance (verifies insufficient-balance error), then submits valid amount
4. BO logs in and approves or rejects the pending transaction
5. Player verifies transaction status and balance/rollover after
6. Assertions: approve → balance decreases + rollover/target resets to 0; reject → balance/rollover unchanged

---

## Troubleshooting

**PowerShell execution policy error**
```
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Port already in use**
```
netstat -ano | findstr :3333
netstat -ano | findstr :4000
taskkill /PID <PID> /F
```

**ddddocr not found**
```
pip install ddddocr
```

**openpyxl not found**
```
pip install openpyxl
```

**2FA code rejected**
- Confirm `STAGING_BO_2FA_SECRET` (or UAT/PROD equivalent) in `.env` matches the secret shown in BO → Profile → Google Authenticator
- Ensure your system clock is accurate (TOTP is time-based)

**Withdrawal test hangs at submit**
- Disable the payment gateway in BO settings — these tests are for manual withdrawal only
- If a previous run left a pending withdrawal, cancel it in BO before rerunning

**Deposit test fails on bank selection**
- Ensure deposit page mode is set to **All-in-One** in BO settings (not Compact)
- Allow ~5 minutes for the mode setting to take effect after changing it

**ngrok remote dashboard access**
```
npm install -g ngrok
ngrok config add-authtoken YOUR_TOKEN
ngrok http 4000
```
