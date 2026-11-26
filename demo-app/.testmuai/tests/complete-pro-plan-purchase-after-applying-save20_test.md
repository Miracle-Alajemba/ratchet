---
assurance:
  id: t-5
  base: sha256:bb082ec54d733bb449d6db824e8d10fdfc189ed04c37b97f6866a99237f8647b
---
# Complete Pro Plan purchase after applying SAVE20

> At the Pro Plan checkout, apply SAVE20 and then complete the order; observe the exact $80 paid confirmation.

## Step 1 @verifies ac-6

At http://localhost:4173, open the Pro Plan checkout and inspect its displayed base price, then assert the visible text is exactly "Base price: $100".

## Step 2 @verifies ac-7, ac-9

On the Pro Plan checkout at http://localhost:4173, enter promo code SAVE20 and use Apply, then assert the visible total is $80 and the feedback text is exactly "Discount applied".

## Step 3 @verifies ac-8

On the Pro Plan checkout after applying SAVE20, use Complete Order to complete the discounted purchase, then assert the visible confirmation text is exactly "Order Confirmed: $80 paid".
