---
name: Firebase financial boundaries
description: Private expense storage and cold-cache transaction behavior in Packyo's existing Firebase setup.
---

Keep expense ledgers behind the authenticated API in a client-denied root; do not put financial records inside the shared trip branch.

**Why:** The existing deployed Firebase rules grant every authenticated account read/write access to the trips branch, but deny unlisted roots. A UI membership check alone cannot protect a financial subbranch beneath that broad grant.

**How to apply:** Check current trip membership in the API on every read and mutation, enforce creator/host edit permissions, and verify direct Firebase reads cannot bypass it. Broad trip/review rule hardening is separate work requiring care for older clients and invite flows.

The broad trip write grant also means an attacker could tamper with membership itself. An API membership check is not a complete security boundary until membership writes are protected. Treat rule hardening as a release concern for shared financial tracking, not merely cosmetic cleanup.

Firebase transactions can invoke their updater with null from a cold local cache even when a record exists on the server.

**Why:** Initial live API checks rejected existing expense edits and settlements when null was treated as proof that the ledger did not exist.

**How to apply:** Do not abort solely on the first null callback. A null compare-and-swap can force a retry against the actual server value; then inspect the transaction result and report missing records appropriately. Test edits and settlements with a fresh SDK connection, not just warmed references.
