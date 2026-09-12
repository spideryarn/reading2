## Findings

**F17 — P3 — established: the UI overstated the search bound.**

- **(a)** The button tooltip and mode catalogue promised “one web search,” although the enforced boundary is one search-backed model call; the provider may perform several searches inside it. The new assertion failed against the previous copy with: `Runs one web search...`.
- **(b)** I changed the wording to “one search-backed model call” in [CitationsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/citations-review-2/src/web/CitationsPanel.tsx:590) and [mode-catalog.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-review-2/src/mode-catalog.ts:417). The regression test is in [citations-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/citations-review-2/tests/citations-panel.test.tsx:227).
- Red first: 1 failed, 18 passed. After the fix: 19 passed. `git diff --check` is clean.

No P0, P1, or P2 findings remain beyond F12, F15, and F16 below.

## F11–F16

- **F11 — fixed correctly.** Every paid call reaches the atomic database allowance before `callOnce`. The `finally` releases the concurrency lease after provider errors, the 60-second abort, and ordinary client disconnects. A killed process leaves only a 90-second lease, while the attempt correctly remains counted. The code, migration CHECK, schema snapshot, and tests all use the exact `citation-find` bucket. The limits are 2 concurrent, 20/hour and 60/day per owner, and 600/day globally.
- **F12 — still established, accepted product risk.** A result whose excerpt happens to contain the title can still be a review or discussion rather than the work’s own page. The URL nevertheless comes exclusively from that call’s `url_citation` annotations, never model-written text, and the host is shown. Given the recorded owner-only, experimental v1 decision, this does **not** change my ship verdict.
- **F13 — fixed correctly.** The 80 cap is applied after both dedupe folds, so 80 distinct final works survive. The regression test covers the former underfill.
- **F14 — fixed sufficiently.** The client cannot paint a late result over a row that is no longer `search`, and server attachment also upgrades only current `search` rows. More importantly, normal `search → DOI → search` reruns do not retain one ID: the dedupe key changes from `work:…` to `doi:…` and back, so the stale find does not naturally resurface. If the same search identity and ID returns, retaining its previously verified find is appropriate. A conditional server write would be extra cleanup, not a safety requirement.
- **F15 — correctly remains open at P2.** An href-only HTML change is outside the freshness fingerprint and can leave a derived article link stale. This is not a migration, ownership, spend, or deployment blocker.
- **F16 — correctly remains latent at P2.** The database does not structurally couple a find’s owner to the article owner, but every production read and write derives the article through the authenticated owner. No production ownership-transfer path exists; the local re-owner utility moves both tables. It is future hardening, not a present exploit.

The four migrations are safe for populated production: they add a nullable column or new tables, and widen existing CHECK constraints with strict supersets of their old values. The owner FK is added while `citation_finds` is newly empty. Drizzle applies the pending sequence transactionally, so the shared rate table cannot be left temporarily without its CHECK. The new bucket list includes every value currently written.

The supplied database-backed run reports all 14 Citations-related files green: 595 tests. Per the requested limits, I ran only the focused panel test locally and did not run the full suite or typecheck.

## Wider, reported not fixed

The already-known glossary `ask` and `lookup` paid routes still lack equivalent spend limiting. I did not change them; they are outside Citations mode and are not introduced or worsened by this deploy.

## Verdict

**Safe after the fixes applied here** — the deciding point is that F11 is genuinely closed: no Citations paid call can begin without an atomic, bounded per-owner and global allowance.