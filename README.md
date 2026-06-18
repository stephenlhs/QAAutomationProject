# QA Automation Project (v2)

Automated testing suite for deposit, withdrawal, paygate, and member-setup flows using Playwright.
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
git clone https://github.com/<your-username>/QAAutomationProject.git
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

> **Windows Defender note:** If the install hangs at 100% 0.0s, add `C:\Users\<you>\AppData\Local\ms-playwright` to Windows Defender exclusions, then re-run.

### 6. Set up environment variables

```
copy .env.example .env
```

Open `.env` and fill in your credentials. Required keys are documented inside `.env.example`.

### 7. Start the dashboard

Double-click **`start-dashboard.bat`**

This starts:
- Captcha server (port 3333)
- QA Dashboard (port 4000)
- ngrok public tunnel (see ngrok window for your HTTPS URL)
- Opens browser at `http://localhost:4000`

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
# Staging — creates member with the configured BO prefix
npx playwright test AutomationProject/staging/CreateMemberAndSaveSession.spec.js --headed --project=staging-member-setup

# UAT
npx playwright test AutomationProject/uat/CreateMemberAndSaveSession.spec.js --headed --project=uat-member-setup

# Production
npx playwright test AutomationProject/prod/CreateMemberAndSaveSession.spec.js --headed --project=prod-member-setup
```

To create a specific member by name (e.g. `player1` with MYR currency):
```
CUSTOM_MEMBERS='[{"username":"player1","currency":"MYR"}]' npx playwright test AutomationProject/staging/CreateMemberAndSaveSession.spec.js --headed --project=staging-member-setup
```

### Deposit Tests

Run with a specific player and amount using environment variable overrides:

```
# Approve Deposit — staging
CUSTOM_PLAYER_USERNAME=<member_prefix>player1 CUSTOM_PLAYER_PASSWORD=your_password CUSTOM_DEPOSIT_AMOUNT=50 npx playwright test AutomationProject/staging/ManualApproveDeposit.spec.js --headed --project=staging

# Reject Deposit — staging
CUSTOM_PLAYER_USERNAME=<member_prefix>player1 CUSTOM_PLAYER_PASSWORD=your_password CUSTOM_DEPOSIT_AMOUNT=50 npx playwright test AutomationProject/staging/ManualRejectDeposit.spec.js --headed --project=staging
```

Replace `staging` with `uat` or `prod` for other environments.

> **Deposit page mode:** The deposit page must be set to **All-in-One** mode in BO settings before running deposit tests. Compact mode is not supported.

> **Deposit package:** Staging uses `Stephen Turnover Package` (rollover x1) by default. Override with `DEPOSIT_PACKAGE_NAME` in `.env` if needed.

### Withdrawal Tests

> **Prerequisite:** Disable the payment gateway (paygate) in BO settings before running withdrawal tests. These tests are for **manual withdrawal** flow only. If paygate is enabled and the withdrawal amount falls within its limit, the transaction will be routed to the gateway and the test will hang.

```
# Approve Withdrawal — staging
CUSTOM_PLAYER_USERNAME=<member_prefix>player1 CUSTOM_PLAYER_PASSWORD=your_password CUSTOM_WITHDRAWAL_AMOUNT=10 npx playwright test AutomationProject/staging/ManualApproveWithdrawal.spec.js --headed --project=staging

# Reject Withdrawal — staging
CUSTOM_PLAYER_USERNAME=<member_prefix>player1 CUSTOM_PLAYER_PASSWORD=your_password CUSTOM_WITHDRAWAL_AMOUNT=10 npx playwright test AutomationProject/staging/ManualRejectWithdrawal.spec.js --headed --project=staging
```

Replace `staging` with `uat` or `prod` for other environments.

### Paygate Tests (VaderPay C2)

Tests end-to-end paygate deposit flows with a manual pause/resume step for vendor callbacks.

Configure which payment methods and banks to test by editing the fixture file for each environment:
```
AutomationProject/staging/fixtures/VaderpayC2.json
AutomationProject/uat/fixtures/VaderpayC2.json
AutomationProject/prod/fixtures/VaderpayC2.json
```

```
# Paygate Deposit — staging
npx playwright test AutomationProject/staging/PaygateDepositTest.spec.js --headed --project=staging

# Paygate Deposit — UAT
npx playwright test AutomationProject/uat/PaygateDepositTest.spec.js --headed --project=uat

# Paygate Deposit — Prod
npx playwright test AutomationProject/prod/PaygateDepositTest.spec.js --headed --project=prod

# Paygate Withdrawal — staging only
npx playwright test AutomationProject/staging/PaygateWithdrawTest.spec.js --headed --project=staging
```

Override the bank and currency at run time:
```
PAYGATE_TEST_CURRENCY=THB PAYGATE_BANKS=BangkokBank npx playwright test AutomationProject/staging/PaygateDepositTest.spec.js --headed --project=staging
```

> See **Paygate Test Flow** below for details on the pause/resume mechanism.

### View HTML Report

```
npx playwright show-report
```

---

## Environment Variable Overrides

Pass these as prefixes on any test command to override defaults without editing `.env`:

| Variable | Purpose | Example |
|----------|---------|---------|
| `CUSTOM_PLAYER_USERNAME` | Player to log in as | `<member_prefix>player1` |
| `CUSTOM_PLAYER_PASSWORD` | Player password | `your_password` |
| `CUSTOM_DEPOSIT_AMOUNT` | Deposit amount | `50` |
| `CUSTOM_WITHDRAWAL_AMOUNT` | Withdrawal amount | `10` |
| `CUSTOM_MEMBERS` | JSON array for CreateMember | `[{"username":"abc","currency":"MYR"}]` |
| `DEPOSIT_PACKAGE_NAME` | Deposit bonus package name | `Stephen Turnover Package` |
| `DEPOSIT_ROLLOVER_MULTIPLIER` | Rollover multiplier for assertions | `1` |
| `PAYGATE_GATEWAY` | Gateway classIdentifier to test | `vaderpayc2` |
| `PAYGATE_METHOD` | Limit to one method (Bank/QR/EWallet/Crypto) | `Bank` |
| `PAYGATE_TEST_CURRENCY` | Currency for bank list lookup | `THB` |
| `PAYGATE_BANKS` | Comma-separated bank name(s) to select | `BangkokBank` |

---

## Project Structure

```
QAAutomationProject/
├── AutomationProject/
│   ├── helpers/
│   │   └── CaptchaHelper.js          Auto captcha solver (shared across all envs)
│   ├── staging/
│   │   ├── fixtures/
│   │   │   └── VaderpayC2.json       Gateway config — methods, banks per currency, limits
│   │   ├── pages/                    Page Object Models
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
│   │   ├── ManualRejectWithdrawal.spec.js
│   │   ├── PaygateDepositTest.spec.js
│   │   ├── PaygateDepositSettingsTest.spec.js
│   │   └── PaygateWithdrawTest.spec.js
│   ├── uat/                          Same structure as staging (excl. PaygateWithdrawTest)
│   └── prod/                         Same structure as staging (excl. PaygateWithdrawTest)
├── reports/                          Auto-generated Excel reports per env
├── .auth/                            Saved login sessions (not committed to git)
├── .env                              Your credentials (not committed to git)
├── .env.example                      Credential template (safe to share)
├── captcha-server.js                 Captcha OCR server on port 3333
├── server.js                         QA Dashboard backend on port 4000
├── index.html                        Dashboard UI
├── write-report.py                   Excel report generator (openpyxl)
├── start-dashboard.bat               One-click launcher (Windows) — starts all servers + ngrok
├── playwright.config.js              Playwright project config
└── README.md                         This file
```

---

## Environments

| Environment | Playsite | Backoffice |
|-------------|----------|------------|
| Staging | configured in `.env` | configured in `.env` |
| UAT | configured in `.env` | configured in `.env` |
| Production | configured in `.env` | configured in `.env` |

> **Staging member prefix:** BO stores staging members with a prefix (e.g. member `player1` appears as `<prefix>player1` in BO). The prefix is set in the staging `config.js`. Always use the full prefixed username as `CUSTOM_PLAYER_USERNAME` for staging tests.

---

## Test Flow Summary

### CreateMemberAndSaveSession
1. BO logs in and creates each member account
2. Sets member bank account
3. Player logs in and changes password from initial to new
4. Saves player + BO sessions for subsequent tests

### ManualApproveDeposit / ManualRejectDeposit
1. Player logs in and records balance/rollover/target before deposit
2. Player submits deposit (Bank Transfer, Maybank)
3. Cash History verified — transaction shows Pending
4. BO logs in and approves or rejects the pending transaction
5. Player verifies transaction status in Cash History
6. Player records balance/rollover/target after
7. Assertions: approve → balance increases + rollover recalculated; reject → balance/rollover unchanged

### ManualApproveWithdrawal / ManualRejectWithdrawal
1. Player logs in and records balance/rollover/target before withdrawal
2. If rollover not met → test verifies rollover-gate error and exits early
3. Player attempts withdrawal above balance (verifies insufficient-balance error), then submits valid amount
4. BO logs in and approves or rejects the pending transaction
5. Player verifies transaction status and balance/rollover after
6. Assertions: approve → balance decreases + rollover/target resets to 0; reject → balance/rollover unchanged

### PaygateDepositTest (VaderPay C2)
1. Player logs in and records balance/rollover/target before deposit
2. Player selects package, payment method, gateway card, and submits deposit
3. Cash History verified — transaction recorded as In Process
4. **Test pauses** — dashboard shows yellow banner with txNo, amount, and Approved/Rejected buttons
5. Contact vendor to confirm outcome, then click **Approved** or **Rejected** in the dashboard
6. Cash History revisited to capture final transaction status
7. Player records balance/rollover/target after
8. BO logs in, verifies transaction appears in Cash Deposit List
9. Assertions (approved): balance increases + rollover recalculated using package multiplier; (rejected): balance/rollover/target unchanged

> **Pending ticket:** The site blocks a new deposit if a previous paygate transaction is still Pending. Before re-running, go to BO → Cash Deposit List and reject the pending transaction to clear it.

### PaygateWithdrawTest (VaderPay C2)
1. Player logs in and records balance/rollover/target before withdrawal
2. If rollover not met → test verifies rollover-gate error and exits early
3. Player submits paygate withdrawal
4. Cash History verified — transaction recorded
5. Player records balance/rollover/target after
6. BO logs in, verifies transaction in Cash Withdraw List and confirms paygate label

---

## VaderpayC2.json

Located at `AutomationProject/<env>/fixtures/VaderpayC2.json` (staging, uat, prod each have their own copy).

Controls which payment methods are tested, the deposit amount per method, and which banks/wallets are available per currency:

```json
{
  "gatewayName": "VaderPay C2",
  "classIdentifier": "vaderpayc2",
  "deposit": {
    "packageName": "Stephen Turnover Package",
    "amount": 50,
    "methods": {
      "Bank": {
        "enabled": true,
        "tab": "online-transfer",
        "amount": 100,
        "banks": {
          "MYR": [
            { "name": "CIMB",          "enabled": true  },
            { "name": "Maybank Berhad","enabled": true  },
            { "name": "RHB Bank Berhad","enabled": false }
          ],
          "THB": [
            { "name": "BangkokBank",   "enabled": true  }
          ]
        }
      },
      "QR":     { "enabled": true,  "tab": "qr-code-payment" },
      "EWallet":{ "enabled": false, "tab": "e-wallet" },
      "Crypto": { "enabled": false, "tab": "crypto-payment" }
    }
  }
}
```

- Set `enabled: true/false` on each **method** to include/exclude it from the test run.
- The `amount` field on a method overrides the global deposit amount for that method (e.g. Bank minimum is 100 MYR).
- Under `banks`, each currency lists the banks available for that currency. Set `enabled: false` to hide a bank from the dashboard and skip it during automated selection.
- The dashboard bank list updates automatically when you change the currency selector — only `enabled: true` banks are shown.

---

## ngrok — Remote Dashboard Access

`start-dashboard.bat` starts ngrok automatically. The ngrok window will show a public HTTPS URL like:
```
Forwarding  https://xxxx-xxxx.ngrok-free.app -> http://localhost:4000
```

Use that URL on your phone or any device to access the dashboard and click the Approved/Rejected resume buttons remotely.

### First-time ngrok setup

Install ngrok (Windows):
```
winget install ngrok.ngrok
ngrok update
ngrok config add-authtoken YOUR_TOKEN
```

Get your authtoken from https://dashboard.ngrok.com/authtokens (free account).

> **Note:** The free plan generates a new random URL every time ngrok restarts.

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

**Playwright browser install hangs at 100% 0.0s**
- Windows Defender is blocking zip extraction — add `C:\Users\<you>\AppData\Local\ms-playwright` to Defender exclusions, then re-run `npx playwright install chromium`

**Paygate test — resume button not appearing**
- Restart the server (`node server.js`) — the ANSI stripping fix requires a fresh server process
- Check that the test output panel shows the `>> PAUSE:` line; if it shows garbled characters, the server needs restarting

**Paygate test — txNo not found in BO deposit list**
- For rejected transactions the test tries `Rejected` status first, then falls back to `Pending/InProcess`
- If still not found, check BO manually — the vendor callback may not have updated the status yet
