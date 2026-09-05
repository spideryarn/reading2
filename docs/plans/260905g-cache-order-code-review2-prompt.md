# Review (round 2): the fixes for F14–F18

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence`, branch
`worktree-cache-order-fence`. TypeScript + ESM, Vitest.

**This is a narrowly scoped check of the fixes, not a fresh pass.** You have reviewed this work three
times (plan rounds 1–2 = F1–F13, code round 1 = F14–F18). Discovery is closed. What I need is: did
each of F14–F18 actually get closed, and did closing it break something. Please do not open new
lines of enquiry outside the changed code and its immediate blast radius — a genuine P0/P1 you
happen to trip over is of course still worth reporting.

## The candidate

Live pre-commit; base `cda25e24`. All paths tracked and modified — untracked: **none**.

```
src/web/lib/offline-store.ts
src/web/lib/api.ts
tests/offline-store.test.ts
tests/cache-issue-order.test.ts
tests/api-fetch-offline.test.ts
tests/cacheable-covers-artefact-routes.test.ts
tests/offline-remount.test.tsx
tests/shelf-cached-paint.test.tsx
docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md
```

`git diff cda25e24 -- src/web/lib/offline-store.ts` is where nearly all of it is. Your round-1 code
review is at `docs/plans/260905g-cache-order-code-review-sol.md`; its prompt, which has the full
contract and the settled decisions, is `260905g-cache-order-code-review-prompt.md`. Not durable — I
will record the resulting commit SHA here once it lands.

## The ledger

| ID | Finding, abbreviated | Disposition | What changed |
|----|---|---|---|
| F14 | eviction can delete the body just written and return `true` | fixed | `evict(instance, by, spare)`; the just-committed slug is filtered out of the candidates. The number to drop is still `freshest.size - MAX_ARTICLES`, computed **before** the filter, so the cap is enforced exactly as hard and the next candidate goes instead. Two new tests: a full cache with a backwards clock, and one with every stamp identical. **I did not take your suggestion of a logical recency counter** — it changes the schema and the LRU semantics for a case nobody has reported, and the spare-exclusion closes the honesty violation on its own. Eviction can still pick the *wrong* victim after a clock step; it can no longer pick the row it was called for. Overruled deliberately, flagged here. |
| F15 | one public call gets several 3-second budgets | fixed | A `Deadline` — one absolute moment — is taken at the top of each exported function and threaded into `open`, every `bounded`, and `evict`. Measured on `performance.now()` rather than `Date.now()`, because a budget measured on a clock an NTP step can move is not a budget. `start()` keeps its own `DEADLINE_MS`, being shared between callers and owning the decision to switch the cache off; `touch` takes a fresh budget because `readCached` has already answered by then. The existing deadline test's `< 10_000` is tightened to `< 4_500`, and a new two-lock test measures the whole call. Reproduced your 5004 ms as 5013 ms before fixing. |
| F16 | a rejected transaction callback commits partial state | fixed | `bounded` now aborts on a rejected `work` as well as on the timer. Two new fault-injection tests: a failure on `meta.put(commit)` after the response `put`, and one on the epoch advance after `retire`'s deletes. Both halves reproduced first — the body committed without its commit row, and the deletes committed without the advance. |
| F17 | the replacement test does not cover the clock-inversion input | fixed | Added the old future-stamp setup with the corrected expectation: a later ticket returns `true` and replaces a row stamped in the future. Verified it discriminates — reintroducing `existing.savedAt > now` turns only this test red. |
| F18 | the plan contradicts its own correction | fixed | The Stage 2b checklist now gives failure containment as the reason atomicity is required, and says plainly that no test asserts it, pointing at the F16 test that asserts the containment instead. |

## One thing I found and fixed that you did not report

While checking the F14 tests I found they were **green when run alone and red only in a whole-file
run** — a false green. `beforeEach`'s raw `indexedDB.open` with no version creates the database at
version 1, and the module's own v1 → v2 upgrade then clears the seeded rows, so eviction never
triggers and the assertion is satisfied by an absence. A whole-file run hides it because the upgrade
describe has already been through. Closed with an `onVersion2()` helper called by the two seeding
paths that need it — deliberately **not** folded into `seed`, because the upgrade describe seeds a
version-1 row on purpose and booting the module there would upgrade the database out from under the
thing under test. My first attempt did exactly that and broke it; the second is what you see.

Verified: the F14 test is now green whole-file, green alone, and red alone when the `spare` filter is
mutated out. **Please check that helper's placement** — a test-infrastructure fix that papers over a
real ordering dependency would be worse than the trap.

## What you can and cannot run

Tree read-only; `/tmp` writable. Please run `npx vitest run tests/offline-store.test.ts` and
`tests/cache-issue-order.test.ts`, and rebuild whichever of your round-1 harnesses bear on F14, F15
and F16 — those harnesses are what made round 1 worth having, and re-running them against the fixes
is the highest-value thing in this pass. No network, not even loopback.

I have run: the nine cache suites, **148 green**; `npm run typecheck` clean; `biome check` clean on
the four touched files; `npm test` at the previous revision — 712 passed, 3 failed, none of them this
work (two need `npm run build`, which I ran, after which they pass; one is another agent's
`debate-step-registration.test.ts` from `39701ce7`).

## Attack the fixes

For each of F14, F15, F16: is it actually closed, or closed only for the input you used to
demonstrate it? Then, specifically:

- **F14**: can `spare` exclusion push the cache permanently over `MAX_ARTICLES`, or fail to drop
  enough, in any interleaving? What if the spared slug is the *only* candidate?
- **F15**: is the budget genuinely absolute across `open` + commit + evict, including when `open`
  consumes most of it? Does `start()` keeping its own `DEADLINE_MS` reopen the hole? Is `touch`
  taking a fresh budget defensible?
- **F16**: does aborting on rejection introduce a path where a legitimate failure now also aborts a
  transaction that had already done something we wanted kept? Are all seven `bounded` call sites
  still correct with the new abort?
- Does `performance.now()` behave for this purpose in every environment the client runs in?

For each finding: an ID (**continuing from F18** — new ones from F19 up), a severity, established or
reasoned, (a) the input or mutation that shows it fails, (b) the smallest closing change. Same scale:
P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or a violated contract; P2
design risk with no wrong behaviour today; P3 prose.

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

1. `spare` is a slug, and eviction's unit is the article. A response with `slug: ""` (the shelf, the
   profile) passes `""` as spare. Does that accidentally spare anything?
2. The `Deadline` is threaded by hand through several functions. Did any call site get a fresh one
   where it should have inherited?
3. `bounded` aborting on rejection now runs on paths where the rejection was ordinary (a `get` that
   found nothing throwing for an unrelated reason). Anything made worse?

Do not change any file.
