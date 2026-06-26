# AI Agent Workflow Design

## Vision

Turn the QA Dashboard into a self-sufficient AI-powered test authoring and healing platform.
Instead of manually writing Playwright spec files, describe what you want to test in plain language — the AI plans, generates, runs, and fixes tests automatically.

---

## The 3 Agents

### 🗺 Planner
**Input:** Natural language description of a user flow  
**Output:** Structured test plan — pre-conditions, numbered steps with actor (Player/Backoffice), expected outcome per step, final assertions, edge cases  
**Use when:** You want to think through a new test scenario before generating code

### 🧪 Tester
**Input:** Test plan from Planner, or a direct plain-language description  
**Output:** Complete, runnable Playwright spec file following the project's exact patterns  
**Use when:** You need to generate a new spec file for a new module, flow, or edge case  
**Save:** The generated file can be saved directly to `AutomationProject/{env}/` from the dashboard

### 🔧 Debugger
**Input:** Failed test log (last 60 lines auto-loaded) + optional spec content  
**Output:** Root cause (1 sentence) + exact fix (code diff) + how to prevent recurrence  
**Use when:** A test fails and you want to know why and how to fix it fast

---

## Workflow Architecture

```
User describes flow (plain language)
         │
         ▼
  ┌─────────────┐
  │   Planner   │  →  structured test plan (steps, actors, expected values)
  └──────┬──────┘
         │ plan
         ▼
  ┌─────────────┐
  │   Tester    │  →  generates .spec.js following project patterns
  └──────┬──────┘
         │ save to AutomationProject/{env}/
         ▼
   Dashboard → Run Test
         │
         ├── PASS → Excel report generated ✅
         │
         └── FAIL → log auto-sent to:
                    ┌──────────────┐
                    │   Debugger   │  →  diagnoses root cause + suggests fix
                    └──────────────┘
                            │
                          fix applied → re-run
```

---

## Element / Flow Capture

### Phase 1 — Manual description (current)
User describes the flow in the chat:
- Which page / URL
- Steps: "Player clicks Deposit, selects bank, fills amount, submits"
- Expected outcome: "Cash History shows Pending, after BO approves — balance increases by amount + bonus"

The Tester agent maps these to existing Page Objects and generates the full spec.

### Phase 2 — Playwright Codegen integration (planned)
1. User clicks **"Start Capture"** in the dashboard
2. Playwright opens browser in codegen mode
3. User performs the flow manually
4. Dashboard receives the recorded interactions as JSON
5. Tester converts to a spec file automatically, no description needed

---

## Code Generation Patterns

The Tester agent is aware of the exact project conventions:

| Pattern | Description |
|---------|-------------|
| `snap(page, label, el?)` | Screenshot helper — writes PNG + updates manifest JSON |
| `MANIFEST_NAME` | Screenshot manifest per test (label + path list) |
| `TXN_MANIFEST_NAME` | Transaction summary for Excel report (all balance/rollover fields) |
| 5-part test structure | Part 1: Player before → Part 2: Submit → Part 3: Cash History → Part 4: BO action → Part 5: Player after |
| `expandAdvancedSearch()` | Idempotent BO panel toggle — checks `#txtTransactionId` visibility before clicking |
| Balance retry loop | Up to 5 reloads after approve/reject to handle server-side cache |
| `{ browser }` fixture | All tests use `browser` (not `page`) for multi-context flows |
| `test.setTimeout(0)` | Always set — tests have no timeout |

---

## Debugger — Known Failure Patterns

| Log signal | Root cause | Fix |
|------------|------------|-----|
| `Timeout 30000ms exceeded` | Selector not found | Check element locator, try `{ force: true }` or wait |
| `Expected X, Received Y` on balance | Server-side balance cache | Retry polling loop already in place |
| Advanced Search panel closes on retry | `searchWithdrawal` called twice | `expandAdvancedSearch()` idempotency check |
| `selectOption` fails | Bank option value differs per env | Use `selectOption({ label: text })` |
| Captcha wrong 3× | ddddocr server offline | Check port 3333, restart captcha-server |
| 2FA code rejected | Clock skew | Sync system clock; verify `*_2FA_SECRET` in `.env` |
| `Cannot read properties of null` | Session expired | Re-run CreateMember to refresh `.auth/` session |

---

## Implementation Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Done | Claude chat with `TRIGGER_JSON` — run existing tests via natural language |
| 2 | ✅ Done | Debugger quick action — last log sent to Claude for analysis |
| 3 | ✅ Done | Agent selector UI (Planner / Tester / Debugger), per-agent system prompts, save-spec endpoint |
| 4 | 📋 Planned | Playwright codegen capture → pipe recorded actions into Tester agent |
| 5 | 📋 Planned | Self-healing loop: Debugger auto-applies simple fixes + auto-reruns |

---

## File Structure

```
QAAutomationProject/
├── docs/
│   └── AI_AGENT_DESIGN.md        ← this file
├── AutomationProject/
│   ├── staging/
│   │   └── *.spec.js             ← Tester saves generated specs here
│   ├── uat/
│   │   └── *.spec.js
│   └── prod/
│       └── *.spec.js
├── index.html                    ← AI Agent tab lives here (client-side)
└── server.js                     ← /save-spec endpoint saves generated files
```

---

## API Design

### `POST /save-spec`
Saves a Claude-generated spec file to the project.

**Request:**
```json
{
  "env": "staging",
  "filename": "MyNewTest.spec.js",
  "content": "import { test } from '@playwright/test';\n..."
}
```

**Response:**
```json
{ "ok": true, "path": "AutomationProject/staging/MyNewTest.spec.js" }
```

**Validation:**
- `env` must be `staging`, `uat`, or `prod`
- `filename` must match `/^[a-zA-Z0-9_-]+\.spec\.js$/`
- Content written to `AutomationProject/{env}/{filename}` relative to project root

---

## Future Ideas

- **Visual diff** — when Tester generates a spec, show diff against nearest existing spec
- **Locator healer** — when a selector fails, Debugger suggests alternative selectors from the live DOM
- **Multi-step planner** — Planner chains multiple spec files (e.g. CreateMember → Deposit → Withdrawal as one campaign)
- **Schedule** — trigger Tester from a cron job to regenerate stale specs after BO config changes
