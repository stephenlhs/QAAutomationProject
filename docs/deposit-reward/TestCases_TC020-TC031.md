# Deposit Reward — Test Case Document
## TC-020 through TC-031 (Not Yet Automated)

**Module:** Deposit Reward  
**Environment:** Staging — `https://stage-mem.linkv2.com` (player) / `https://stage-bo.linkv2.com` (backoffice)  
**Player under test:** `claudestag1` (BO username: `x9048_claudestag1`)  
**Setting 1 (staging):** Min deposit MYR 50 · Counter 1 = 10% · Counter 2 = 20% · Counter 3+ = 30% · Cap MYR 25  
**Document date:** 2026-06-26  

---

## Summary Table

| TC ID  | Title                                                               | Priority | Type            | Precondition                                                    |
|--------|---------------------------------------------------------------------|----------|-----------------|-----------------------------------------------------------------|
| TC-020 | Counter resets to 1 after 48 h of inactivity                       | H        | Functional      | Player at Counter 2 or 3; 48 h pass with no qualifying deposit  |
| TC-021 | Player has multiple promo codes — uses oldest first                 | M        | Functional      | At least 2 un-redeemed promo codes in inbox                     |
| TC-022 | Player has multiple promo codes — uses newest first                 | M        | Functional      | At least 2 un-redeemed promo codes in inbox                     |
| TC-023 | Promo code expires before use — system rejects it                  | H        | Functional      | Promo code issued; expiry window has elapsed                    |
| TC-024 | BO disables Deposit Reward mid-session; player redeems held code   | H        | Admin/Negative  | Player holds a valid un-redeemed code; feature is enabled       |
| TC-025 | Boundary — deposit exactly MYR 50.00 earns promo code              | H        | Boundary        | Feature enabled; player logged in                               |
| TC-026 | Boundary — deposit MYR 49.99 (one cent below min) earns no promo  | H        | Boundary        | Feature enabled; player logged in                               |
| TC-027 | Player enters promo code with zero-amount deposit (no deposit made) | M       | Negative        | Player holds a valid un-redeemed code                           |
| TC-028 | BO rejects deposit that included a promo code — code not consumed  | H        | Admin/Negative  | Player submits deposit with valid promo; BO has not approved yet |
| TC-029 | Max cap — large deposit bonus calculation does not exceed MYR 25   | H        | Boundary        | Counter 3+ active; player has promo code                        |
| TC-030 | Concurrent deposits — same promo code submitted twice simultaneously | H       | Concurrency     | Player holds one valid un-redeemed code                         |
| TC-031 | Promo code earned at Counter 3 used after 48 h reset (counter = 1) | M        | Counter/Reset   | Player at Counter 3; obtains promo; waits 48 h; new deposit     |

---

## Per-TC Detail Blocks

---

## TC-020: Counter resets to 1 after 48 h of inactivity

**Pre-conditions:**
- Deposit Reward feature is enabled in BO.
- Player `claudestag1` has completed at least two qualifying deposits and is currently at Counter 2 (20% tier). Counter 3 (30% tier) is also acceptable.
- No qualifying deposit has been made by the player for 48 consecutive hours.
- BO setting for counter reset is confirmed to be 48 h.

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | BO | Verify current counter value in BO → Deposit Reward → agent settings or player record | Counter is shown as 2 (or 3) for `claudestag1` |
| 2 | Player | Wait 48 h without making any deposit (or BO advances clock / sets counter expiry if staging supports it) | No system activity on `claudestag1` deposit record |
| 3 | Player | Submit a qualifying deposit of MYR 50.00 | Deposit is accepted; status = Pending |
| 4 | BO | Approve the deposit | Deposit status changes to Approved |
| 5 | Player | Navigate to Inbox | A new promo code is present in the format `XXXXXXXX$YY` |
| 6 | Player | Note the bonus amount encoded in the promo code | Bonus amount = MYR 5.00 (10% of MYR 50 — Counter 1 rate), confirming reset |
| 7 | BO | Search deposit list for `claudestag1`, check system remark | Remark should reflect Counter 1 bonus (MYR 5.00) |

**Assertions:**
- [ ] Promo code appears in inbox after the post-48-h qualifying deposit.
- [ ] Bonus amount in code = MYR 5.00 (10% × MYR 50 = Counter 1 — not Counter 2 or 3).
- [ ] BO deposit list remark confirms Counter 1 bonus amount.
- [ ] Player balance after BO approval = balance before + MYR 50 (deposit only; promo not yet redeemed).

**Edge cases / Notes:**
- ⚠ VERIFY: Confirm whether the 48 h timer is based on last qualifying deposit approval timestamp or submission timestamp.
- ⚠ VERIFY: Staging may not support manual clock manipulation; if not, this TC requires a real 48 h wait or a test environment backdoor. Coordinate with dev team.
- If the timer resets on any deposit (including sub-min), document this as a separate finding.

---

## TC-021: Player has multiple promo codes — uses oldest first

**Pre-conditions:**
- Deposit Reward feature is enabled.
- Player `claudestag1` has earned at least 2 qualifying deposits (e.g., two separate MYR 100 deposits approved by BO), resulting in 2 un-redeemed promo codes visible in the inbox.
- Both promo codes are valid (not expired, not redeemed).

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | Player | Navigate to Inbox; note timestamp and code value of the oldest promo code (Code A) and newest (Code B) | Two promo codes are visible; Code A has an earlier date than Code B |
| 2 | Player | Submit a qualifying deposit of MYR 50.00 and enter Code A (oldest) in the promo code field | Deposit accepted; status = Pending |
| 3 | BO | Approve the deposit | Status = Approved |
| 4 | Player | Check balance and inbox | Balance = balance before + MYR 50 + bonus encoded in Code A; Code A is marked as used/removed from inbox; Code B remains |
| 5 | BO | Search deposit list; read system remark | Remark confirms bonus amount matching Code A |

**Assertions:**
- [ ] Bonus credited matches the value encoded in Code A (the oldest code).
- [ ] Code A is consumed (no longer redeemable or removed from inbox).
- [ ] Code B remains available and un-redeemed in the inbox.
- [ ] Player balance = pre-deposit balance + MYR 50 + Code A bonus.

**Edge cases / Notes:**
- ⚠ VERIFY: Does the system allow the player to choose which code to apply, or does it auto-select? If auto-select, confirm which one takes priority (oldest vs. newest).
- If system auto-applies the newest code despite player selecting oldest, record as a defect.

---

## TC-022: Player has multiple promo codes — uses newest first

**Pre-conditions:**
- Same as TC-021: player holds 2 un-redeemed promo codes (Code A = older, Code B = newer).

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | Player | Navigate to Inbox; identify Code A (older) and Code B (newer) | Two codes visible, distinguishable by date |
| 2 | Player | Submit a qualifying deposit of MYR 50.00 and enter Code B (newest) | Deposit accepted; status = Pending |
| 3 | BO | Approve the deposit | Status = Approved |
| 4 | Player | Check balance and inbox | Balance = balance before + MYR 50 + bonus in Code B; Code B consumed; Code A remains |
| 5 | BO | Read system remark on approved deposit | Remark matches Code B bonus value |

**Assertions:**
- [ ] Bonus credited matches value in Code B (newest).
- [ ] Code B is consumed; Code A still available in inbox.
- [ ] Player balance = pre-deposit balance + MYR 50 + Code B bonus.

**Edge cases / Notes:**
- If Code A and Code B encode different bonus amounts (different counter tiers), verify the correct amount for the selected code is applied.

---

## TC-023: Promo code expires before use — system rejects it

**Pre-conditions:**
- Deposit Reward feature is enabled.
- Player `claudestag1` has earned a promo code.
- The code's expiry window (as configured in BO settings — confirm expiry duration with dev team) has elapsed without the code being used.
- ⚠ VERIFY: Confirm that promo codes have an expiry mechanism and the expiry period from BO settings.

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | Player | Navigate to Inbox | Promo code is still displayed but past its expiry date (if visible) |
| 2 | Player | Submit a qualifying deposit of MYR 50.00 and enter the expired promo code | Deposit accepted; status = Pending |
| 3 | BO | Approve the deposit | Status = Approved |
| 4 | BO | Read system remark on approved deposit | Remark should indicate the code is expired (e.g., "Promo code expired" or "Promo code not found") |
| 5 | Player | Check balance | Balance = balance before + MYR 50 only (no bonus credited) |

**Assertions:**
- [ ] BO remark contains text indicating code expiry (exact wording to be confirmed).
- [ ] No bonus is credited — balance increase equals deposit amount only (MYR 50).
- [ ] Expired code is not consumed as "redeemed" — subsequent re-use should still return an expiry error, not "already redeemed".

**Edge cases / Notes:**
- ⚠ VERIFY: Whether the system has a promo code expiry feature at all. If not, mark this TC as N/A pending feature clarification.
- ⚠ VERIFY: Does the inbox still show expired codes, or does the system auto-remove them?

---

## TC-024: BO disables Deposit Reward mid-session; player redeems held code

**Pre-conditions:**
- Deposit Reward feature is enabled.
- Player `claudestag1` holds at least one valid un-redeemed promo code in their inbox.
- BO is logged in and has access to the Deposit Reward settings page.

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | BO | Navigate to Deposit Reward → Agent Setting and uncheck "Enable Playsite" (disable the feature); save changes | Feature is disabled; confirmation dialog shown and dismissed |
| 2 | Player | Navigate to Inbox | Promo code may still be visible (code was issued while feature was active) |
| 3 | Player | Submit a deposit of MYR 50.00 and enter the held promo code | Deposit submitted; status = Pending |
| 4 | BO | Approve the deposit | Status = Approved |
| 5 | BO | Read system remark on approved deposit | Remark behavior is to be observed — may say "feature disabled", "not found", or may still credit bonus |
| 6 | Player | Check balance | Expected: no bonus (feature disabled); actual result to be recorded |
| 7 | BO | Re-enable Deposit Reward feature to restore staging state | Feature re-enabled; subsequent tests are not affected |

**Assertions:**
- [ ] With feature disabled, BO remark does NOT credit bonus on the deposit.
- [ ] Balance increase = MYR 50 (deposit only, no bonus).
- [ ] BO remark explicitly states why bonus was not granted (e.g., "deposit reward disabled" or similar).
- [ ] After re-enabling the feature, the system behaves normally again.

**Edge cases / Notes:**
- ⚠ VERIFY: The expected system behaviour when BO disables the feature while a player holds a live code is not documented. Record actual remark verbatim.
- If the system still credits the bonus despite the feature being disabled, file as a bug.

---

## TC-025: Boundary — deposit exactly MYR 50.00 earns promo code

**Pre-conditions:**
- Deposit Reward feature is enabled.
- Player `claudestag1` is at a known counter position (note current counter before test).
- No promo codes currently in inbox (or inbox state is documented).

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | Player | Note current balance | Balance recorded |
| 2 | Player | Submit a deposit of exactly MYR 50.00 (the minimum threshold) | Deposit accepted; amount field shows 50.00; status = Pending |
| 3 | BO | Approve the deposit | Status = Approved |
| 4 | Player | Navigate to Inbox | A new promo code is present in the format `XXXXXXXX$YY` |
| 5 | Player | Record the bonus amount encoded in the promo code | Bonus = MYR 5.00 if Counter 1 (10% × 50), or MYR 10.00 if Counter 2 (20% × 50), etc. — matches current counter |
| 6 | Player | Check balance | Balance = balance before + MYR 50 |

**Assertions:**
- [ ] A promo code is issued for a deposit of exactly MYR 50.00.
- [ ] Bonus amount encoded in code is correct for the current counter tier (10%/20%/30% of MYR 50, capped at MYR 25).
- [ ] No error message is shown to the player.
- [ ] BO deposit list shows the transaction as Approved with correct bonus remark.

**Edge cases / Notes:**
- This is the lower boundary value. MYR 50.00 must qualify — confirm this is inclusive (≥ 50, not > 50).
- Run this TC with the counter explicitly at 1 (after a reset) to keep the expected bonus simple and predictable.

---

## TC-026: Boundary — deposit MYR 49.99 earns no promo code

**Pre-conditions:**
- Deposit Reward feature is enabled.
- Player `claudestag1` is logged in.
- Inbox state is documented (no existing unredeemed codes, or codes are noted).

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | Player | Note current balance | Balance recorded |
| 2 | Player | Submit a deposit of MYR 49.99 (one cent below minimum) | Deposit accepted; status = Pending |
| 3 | BO | Approve the deposit | Status = Approved |
| 4 | Player | Navigate to Inbox | No new promo code appears for this transaction |
| 5 | Player | Check balance | Balance = balance before + MYR 49.99 (no bonus) |

**Assertions:**
- [ ] No promo code is issued for a deposit of MYR 49.99.
- [ ] Player inbox contains no new message referencing this transaction.
- [ ] Balance increase = MYR 49.99 only.
- [ ] BO remark on the approved deposit contains no bonus amount.
- [ ] Counter value does NOT advance (the deposit was sub-minimum).

**Edge cases / Notes:**
- This is the upper boundary value just below threshold — critical to confirm the system uses strict ≥ 50 comparison, not rounding.
- Verify that the gateway does not round MYR 49.99 to MYR 50 on any internal record.

---

## TC-027: Player enters promo code without making a deposit

**Pre-conditions:**
- Deposit Reward feature is enabled.
- Player `claudestag1` holds at least one valid un-redeemed promo code.

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | Player | Navigate to the deposit page | Deposit form is displayed |
| 2 | Player | Expand the "Promo Code" section and enter a valid promo code | Promo code field accepts input |
| 3 | Player | Attempt to submit the deposit with amount = 0 (or leave the amount blank) | System should show a validation error preventing submission — OR the submit button is disabled |
| 4 | Player | Observe whether the promo code is consumed or remains in inbox | Promo code must NOT be consumed; it remains available |
| 5 | Player | Navigate to Inbox | Promo code is still present and un-redeemed |

**Assertions:**
- [ ] Deposit with zero/blank amount cannot be submitted — form validation blocks it.
- [ ] Promo code is NOT consumed or invalidated by this attempt.
- [ ] No pending deposit transaction appears in cash history.
- [ ] Player balance is unchanged.

**Edge cases / Notes:**
- ⚠ VERIFY: If the deposit form allows submission with amount = 0 and the code is entered, determine whether the code is flagged as "used" even with no deposit.
- This TC primarily tests frontend validation, but the backend assertion (code not consumed) is critical.

---

## TC-028: BO rejects a deposit that included a promo code — code is not consumed

**Pre-conditions:**
- Deposit Reward feature is enabled.
- Player `claudestag1` holds at least one valid un-redeemed promo code.
- BO is prepared to reject (not approve) the deposit.

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | Player | Note current balance | Balance recorded |
| 2 | Player | Submit a qualifying deposit of MYR 50.00 with a valid promo code | Deposit accepted; status = Pending; promo code entered is shown |
| 3 | BO | Locate the deposit in the Pending list | Deposit visible with promo code field populated |
| 4 | BO | Reject the deposit (provide a rejection reason) | Deposit status = Rejected |
| 5 | Player | Check cash history | Latest transaction status = Rejected |
| 6 | Player | Navigate to Inbox | Promo code is still present and available for future use |
| 7 | Player | Submit a new qualifying deposit of MYR 50.00 with the same promo code | Deposit accepted; status = Pending |
| 8 | BO | Approve this second deposit | Status = Approved |
| 9 | Player | Check balance and inbox | Balance = balance before + MYR 50 + promo bonus; promo code is now consumed |

**Assertions:**
- [ ] After BO rejection, the promo code is NOT marked as redeemed — it remains usable.
- [ ] Promo code is still present in the inbox after the rejected transaction.
- [ ] The player can successfully redeem the same code on a subsequent approved deposit.
- [ ] Bonus is correctly credited on the second (approved) deposit.
- [ ] BO remark on the rejected deposit does not state "already redeemed" (it was never consumed).

**Edge cases / Notes:**
- ⚠ VERIFY: Whether the system locks the promo code during the "Pending" state (before BO action) and releases it upon rejection.
- If the code is consumed on rejection, file as a critical bug — the player permanently loses the bonus.

---

## TC-029: Max bonus cap — large deposit bonus does not exceed MYR 25

**Pre-conditions:**
- Deposit Reward feature is enabled.
- Player `claudestag1` is at Counter 3+ (30% tier) — has made at least 3 qualifying deposits.
- Player holds a promo code earned at Counter 3 (encodes MYR 25, the cap).

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | Player | Note current balance | Balance recorded |
| 2 | Player | Submit a large deposit (e.g., MYR 200.00) to trigger Counter 3 → 30% = MYR 60, above cap | Deposit accepted; status = Pending |
| 3 | BO | Approve the deposit | Status = Approved |
| 4 | Player | Read promo code from inbox | Promo code is present; bonus amount encoded = MYR 25.00 (cap applied, not MYR 60) |
| 5 | Player | Submit a new deposit of MYR 100.00 using the capped promo code (MYR 25) | Deposit accepted with code; status = Pending |
| 6 | BO | Approve deposit | Status = Approved |
| 7 | Player | Check balance | Balance = balance before step 5 + MYR 100 + MYR 25 (not MYR 30 or MYR 60) |
| 8 | BO | Read system remark on the deposit approved in step 6 | Remark shows bonus = MYR 25 (the capped amount) |

**Assertions:**
- [ ] Promo code issued at Counter 3 for MYR 200 deposit encodes exactly MYR 25.00 (cap), not MYR 60.
- [ ] Bonus credited on redemption = MYR 25.00 — not higher.
- [ ] BO remark confirms MYR 25.00 bonus applied.
- [ ] Test across multiple large deposit amounts (e.g., MYR 100, MYR 200, MYR 500) — each earns exactly MYR 25 encoded in the code.

**Edge cases / Notes:**
- Also test the exact cap boundary: MYR 83.34 deposit at 30% = MYR 25.00 (just at cap). Deposit of MYR 83.33 should yield MYR 24.99 in the code.
- Verify cap applies per promo code issuance, not per redemption.

---

## TC-030: Concurrent deposits — same promo code submitted twice simultaneously

**Pre-conditions:**
- Deposit Reward feature is enabled.
- Player `claudestag1` holds exactly one valid un-redeemed promo code.
- Two browser sessions (or two API calls) can be launched concurrently in the test.

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | Player (Session A) | Begin filling deposit form with MYR 50.00 and the promo code — do NOT submit yet | Form ready in Session A |
| 2 | Player (Session B) | Simultaneously begin filling deposit form with MYR 50.00 and the same promo code — do NOT submit yet | Form ready in Session B |
| 3 | Player (Session A & B) | Submit both deposits as close to simultaneously as possible (within the same second) | Both deposits show status = Pending |
| 4 | BO | Approve both deposits (one at a time) | Both deposits approved |
| 5 | BO | Read system remarks on both approved deposits | Only one deposit should credit the bonus; the other should show "already redeemed" or equivalent |
| 6 | Player | Check balance | Balance = (balance before) + MYR 50 + MYR 50 + bonus (once only) |

**Assertions:**
- [ ] The promo code bonus is credited exactly once, regardless of concurrent submission.
- [ ] At least one of the two BO remarks indicates "already redeemed" or equivalent.
- [ ] Total balance increase = MYR 100 (two deposits) + one bonus only.
- [ ] No scenario where bonus is credited twice (double credit = critical bug).

**Edge cases / Notes:**
- ⚠ VERIFY: The system may not have server-side idempotency protection for concurrent promo submissions. This scenario is the most likely vector for double-credit abuse.
- If both deposits credit the bonus, escalate as a P0 security bug immediately.
- Automation note: use `Promise.all` to launch both `submitDeposit` calls concurrently in Playwright.

---

## TC-031: Promo code earned at Counter 3 used after 48 h counter reset (counter = 1)

**Pre-conditions:**
- Deposit Reward feature is enabled.
- Player `claudestag1` is at Counter 3 (or higher).
- Player earns a promo code from a Counter 3 qualifying deposit (code encodes 30% bonus, max MYR 25).
- Player then allows 48 h to elapse without another qualifying deposit, so the counter resets to 1.
- Player holds the Counter 3 promo code (still un-redeemed, not expired).

**Steps:**

| # | Actor | Action | Expected Result |
|---|-------|--------|-----------------|
| 1 | Player | Earn promo code via Counter 3 qualifying deposit (MYR 50 → promo encodes MYR 15.00 = 30%) | Promo code appears in inbox encoding MYR 15.00 |
| 2 | System | 48 h elapses with no qualifying deposit | Counter resets to 1 |
| 3 | BO | (Optional) Confirm counter is now 1 via BO player record or deposit reward settings | Counter shown as 1 for `claudestag1` |
| 4 | Player | Submit a qualifying deposit of MYR 50.00 and enter the Counter 3 promo code (MYR 15) | Deposit accepted; status = Pending |
| 5 | BO | Approve the deposit | Status = Approved |
| 6 | Player | Check balance | Balance = balance before + MYR 50 + MYR 15 (Counter 3 code still honoured) |
| 7 | Player | Navigate to Inbox | A new promo code is issued — encodes MYR 5.00 (Counter 1 rate: 10% × MYR 50) |
| 8 | BO | Read system remark | Remark confirms MYR 15 bonus credited (from old code) and new Counter 1 promo issued |

**Assertions:**
- [ ] Old Counter 3 promo code (MYR 15.00) is still honoured even though counter has reset to 1.
- [ ] Bonus credited = value encoded in the promo code at time of issuance (MYR 15), NOT recalculated at current counter rate.
- [ ] New promo code issued for this deposit reflects Counter 1 rate (MYR 5.00 = 10% of MYR 50).
- [ ] Counter advances to 2 after this deposit (not re-starting from scratch on next deposit).

**Edge cases / Notes:**
- ⚠ VERIFY: Whether the bonus amount is fixed at issuance time (encoded in the code string) or recalculated at redemption time. If recalculated, a Counter 3 code used after reset might only credit Counter 1 rate — document this as intended or as a defect.
- ⚠ VERIFY: After redeeming the old code, does the counter become 2 (continuing from reset-1), or does the redemption itself not affect the counter?
- This TC requires a real 48 h wait or staging clock manipulation.

---

## Known Bugs — Do Not Re-Test

| TC ID  | Bug Description |
|--------|----------------|
| TC-010 | System logs "already redeemed" remark but still credits bonus intermittently (BUG CONFIRMED) |
| TC-012 | Sub-min deposit with valid promo code sometimes does not credit bonus (BUG CONFIRMED) |

---

*Document produced by: Planner Agent (senior QA analyst role)*  
*IDs TC-001 through TC-019 are taken by previously automated tests.*
