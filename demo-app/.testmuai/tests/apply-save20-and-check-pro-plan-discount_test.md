---
assurance:
  id: t-4
  base: sha256:51e0a99a53079df8d493a79441f58d1a6f78f9b6f8be56e925b9b5ba83263178
---
# Apply SAVE20 and check Pro Plan discount

> At the Pro Plan checkout, enter SAVE20 and use Apply; observe the $80 total and the exact discount-applied message.

## Step 1 @verifies ac-6

At http://localhost:4173, open the Pro Plan checkout and inspect its displayed base price, then assert the visible text is exactly "Base price: $100".

## Step 2 @verifies ac-7, ac-9

On the Pro Plan checkout at http://localhost:4173, enter promo code SAVE20 and use Apply, then assert the visible total is $80 and the feedback text is exactly "Discount applied".
