---
assurance:
  id: t-1
  base: sha256:9fc3d5caefec4e49034658a81ebdc1db4c40ab33f3a009eb77aed1e865579314
---
# Apply SAVE20 and check the Pro Plan checkout total

> Confirm applying SAVE20 to the $100 Pro Plan checkout produces an $80 total and the Discount applied message.

## Step 1 @verifies ac-1

At http://localhost:4173, reach the Pro Plan checkout, then assert the displayed base price is $100.

## Step 2 @verifies ac-2, ac-3

On the Pro Plan checkout, enter SAVE20 in the promo-code field and use Apply, then assert the total is $80 and “Discount applied” is shown.
