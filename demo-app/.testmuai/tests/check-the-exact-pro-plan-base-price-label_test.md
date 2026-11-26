---
assurance:
  id: t-10
  base: sha256:a36986c116f9dfac3bd2232db61bdd615eae6c555ad7c8c8bc882ef45f65d47d
---
# Check the exact Pro Plan base-price label

> At http://localhost:4173, inspect the Pro Plan checkout's visible price label and establish that it reads exactly "Base price: $100"; do not assert the browser URL or its formatting.

## Step 1 @verifies ac-11, ac-1

At http://localhost:4173, inspect the visible price label at the Pro Plan checkout, then assert its text reads exactly "Base price: $100".
