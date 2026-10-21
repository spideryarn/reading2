# Narrow check 2: plan 261020b, C2-F1 and C2-F2 fixes (read-only)

Do not change any file. Discovery is closed except for the one question in item 3. Your previous
answer is `docs/plans/261020b-longer-documents-up-to-400-pages-code-review-2-sol.md`. The fixes are
commit `77cdb5c28` (`git show 77cdb5c28`).

1. C2-F1: `activeImportPrice` in src/store/pg-billing.ts now locks every job of the article whose
   reservation is unsettled, in id order, after the article. Closed? Any lock-order problem from
   locking several job rows?
2. C2-F2: src/web/add-high-power.ts and src/web/AddPage.tsx. Closed? Did the `completed` argument
   break any path that must still send (a repeat paste, an import that completed)?
3. A case I suspect, so please confirm or refute it with evidence. A long PDF import is priced at 5
   slots, then stopped or failed after fetch, so its reservation is released. A script then PUTs
   High-powered AI. No unsettled reservation exists, and `articleSlots` sees no charged ingest, so
   is the switch charged one slot (the legacy "none" fallback), once and for ever? Then a Retry
   reserves 5 and runs the whole pipeline on Opus. Does the switch even succeed on a draft that
   was never published (does `ownedSlug` find an article row, and is `high_power_since` honoured
   by the retry)? If the case is real, propose the smallest fix, for example: High-powered weighs
   the article by `slotsForPages` of its current raw source's `raw_pages` (draft or published), or
   counts released ingest rows' slots for that article.

Severity P0–P3 as before. IDs C3-F1…. End with a verdict.
