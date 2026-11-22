---
test: ../checkout_test.md
status: failed
started: 2026-11-22T16:04:25.887Z
duration_s: 89
session_id: 6641fed7-b893-4cc2-9dd5-394dd322ac75
---

# Acceptance Scenarios — Result

## Step 1 - Verify base price displays $100 ✓ passed (4.12s)
md5: a6a849e146c55d88ced41f96836bf937
Open http://localhost:4173.
Verify the page displays "$100".

## Step 2 - Apply promo code SAVE20 ✗ failed (75.3s)
md5: f3ebe52a062045ad428d2382f3a36735
Reason: Screenshot failed: TimeoutError: screenshot: Timeout 60000ms exceeded.
Call log:
  - taking page screenshot
  - waiting for fonts to load...
  - fonts loaded
 — bug verdict: Screenshot capture timed out [environment_issue/platform_failure, confidence 0.88]
Enter "SAVE20" into the promo code input.
Click the "Apply" button.
Verify "$80" is displayed.
Verify "Discount applied" is displayed.

## Step 3 - Complete order after applying promo code ⏭ skipped
