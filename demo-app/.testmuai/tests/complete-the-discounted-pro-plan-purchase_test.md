---
assurance:
  id: t-2
  base: sha256:3737b0c2221ad38af5d51d182fce03dd61a5b936738d6ae81e9b2c35bdd510ce
---
# Complete the discounted Pro Plan purchase

> Confirm completing the order after applying SAVE20 shows Order Confirmed: $80 paid.

## Step 1 @verifies ac-1

At http://localhost:4173, reach the Pro Plan checkout, then assert the displayed base price is $100.

## Step 2 @verifies ac-2, ac-3

On the Pro Plan checkout, enter SAVE20 in the promo-code field and use Apply, then assert the total is $80 and “Discount applied” is shown.

## Step 3 @verifies ac-4

On the discounted Pro Plan checkout, use Complete Order to finish the order, then assert the displayed confirmation reads “Order Confirmed: $80 paid”.
