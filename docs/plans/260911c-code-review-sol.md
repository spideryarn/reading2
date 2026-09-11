## Findings

- **P2 — fixed:** [tests/link-summary-stream-lifetime.test.ts:25](/home/greg/code/spideryarn2/.claude/worktrees/g-paid-singleflight-slice/tests/link-summary-stream-lifetime.test.ts:25)  
  A thrown `linkSummaryStore.claim()` error is framed by the route as `pending`. Previously, the terminal frame plus one model call could therefore pass without the second request actually receiving `pending` from Postgres. I added a pass-through wrapper around the real claim, recorded its returned kinds, and asserted the sequence is exactly `claimed`, then `pending`; the third request must use the stored result without claiming again. The real Postgres claim remains in use.

- **P3 — not changed:** [docs/plans/260911c-paid-single-flight-joins-the-route-table.md:232](/home/greg/code/spideryarn2/.claude/worktrees/g-paid-singleflight-slice/docs/plans/260911c-paid-single-flight-joins-the-route-table.md:232)  
  The focused-suite paragraph names 16 files but reports “15 files” and provides only an aggregate log, so the omitted suite cannot be identified safely from the evidence.

- **P3 — not changed:** [docs/plans/260911c-code-review-prompt.md:33](/home/greg/code/spideryarn2/.claude/worktrees/g-paid-singleflight-slice/docs/plans/260911c-code-review-prompt.md:33)  
  The prompt says four files are untracked, while `git status` shows five—the review prompt itself is also untracked.

No other defects found. The verifier reproduced byte-identical captures and reported a pure move. The six rows preserve order, gates, ownership checks, return/await behavior, and route precedence. There are 49 table rows plus 33 remaining guards, matching the 82-control total. The paid oracle’s polling is sound under JavaScript run-to-completion, the rail checks are not materially weaker, cacheable coverage still refuses shrinkage and duplicate bindings, `/api/quiz` remains a valid control, the article slice should remain deferred, and the registry classifications match existing migration-test precedent.

Verification: fallback typecheck passed; seven focused unit files passed, 124 tests. Contract/cache/registry ran 356 tests successfully except the registry’s child-process test, blocked by sandbox `tsx` socket `EPERM`. The two Postgres lifetime suites could not run because the sandbox denied `127.0.0.1:54362` and Docker access. `git diff --check` passed.

**Verdict: Approve with the P2 oracle gap fixed; no code blocker remains.**