---
mode: testing
url: http://localhost:4173
tags: [acceptance]
---

# Acceptance Scenarios

## Step 1 - Verify base price displays $100
Open http://localhost:4173.
Verify the page displays "$100".

## Step 2 - Apply promo code SAVE20
Enter "SAVE20" into the promo code input.
Click the "Apply" button.
Verify "$80" is displayed.
Verify "Discount applied" is displayed.

## Step 3 - Complete order after applying promo code
Click the "Complete Order" button.
Verify "Order Confirmed: $80 paid" is displayed.

