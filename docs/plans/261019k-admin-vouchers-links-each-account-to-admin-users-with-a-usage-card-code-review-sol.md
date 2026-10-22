Reviewed and fixed the implementation. No commits, Git mutations, or production access.

Checks:

- Targeted tests: 104 passed.
- Native-title guard: 3 passed.
- Full typecheck passed via `node --import tsx scripts/typecheck.ts`.
- Exact `npm run typecheck` was attempted but the sandbox blocked `tsx`’s IPC socket with `EPERM`.
- Dependency lint and `git diff --check`: clean.

1. **P1 — Wrong account from ambiguous email:** Fixed/verified. Waiting vouchers link only on exactly one normalized match; claimed IDs always win. Added stronger precedence coverage.
2. **P2 — Account failures and stale links:** Fixed. Waiting vouchers no longer link from stale account data after refresh failure; claimed links retain ID-based navigation and clearly label stale usage.
3. **P2 — Historical or missing claimant address:** Fixed. Claimed links remain in Status, and a fresh ID-matched user address now fills a missing `claimantEmail`.
4. **P2 — Scroll effect could run after every render:** Fixed. Added explicit dependencies, retained the successful-scroll guard, and tested delayed data, one-shot scrolling, missing rows, clearing, and changed targets.
5. **P3 — Comments mislabeled as questions:** Verified fixed. The card says “comments”; tests assert the wording.
6. **P3 — Tooltip/link accessibility:** Verified and strengthened. Keyboard focus opens the card, `aria-describedby` points to it, focus remains on the link, and “Open in Users” contains no nested control.
7. **P2 — Silent-success test gaps:** Fixed. Added controls for claimed-ID precedence, unresolved claimant email, loading and failed usage, stale refreshes, and changing `?user=`.
8. **No boundary violation found:** The card exposes only existing admin account metadata, counts, dates, plan, and spend. No native `title` tooltip was introduced.