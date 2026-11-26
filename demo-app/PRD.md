# Product Requirements Document: Pro Plan Checkout

Target URL: http://localhost:4173

## Acceptance Criteria
- At the Pro Plan checkout, the visible price label reads exactly "Base price: $100"; verify the label only, and do not assert the browser URL or its formatting.
- Entering promo code SAVE20 and clicking "Apply" updates the total to $80 and shows "Discount applied".
- Clicking "Complete Order" after applying SAVE20 displays "Order Confirmed: $80 paid".
