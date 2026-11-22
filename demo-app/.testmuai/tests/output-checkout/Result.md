---
test: ../checkout_test.md
status: passed
started: 2026-11-22T15:59:13.718Z
duration_s: 113
session_id: 3fb77464-c300-4699-b3cb-1b8390c6799f
---

# Acceptance Scenarios — Result

## Step 1 - Verify base price displays $100 ✓ passed (0.99s)
md5: a6a849e146c55d88ced41f96836bf937
Open http://localhost:4173.
Verify the page displays "$100".

## Step 2 - Apply promo code SAVE20 ✓ passed (55.4s)
md5: f3ebe52a062045ad428d2382f3a36735
Enter "SAVE20" into the promo code input.
Click the "Apply" button.
Verify "$80" is displayed.
Verify "Discount applied" is displayed.

## Step 3 - Complete order after applying promo code ✓ passed (51.8s)
md5: e29712d31732164933c72c6c4ab177e6
Click the "Complete Order" button.
Verify "Order Confirmed: $80 paid" is displayed.
