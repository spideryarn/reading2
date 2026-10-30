Found and fixed three in-scope issues. No wider decision is needed.

## Findings

1. **P1 — `unmeasured-picture` could fail open through the composite route.**  
   [src/collect-pdf-figures.ts:1192](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/collect-pdf-figures.ts:1192)

   An unplaceable paint disappeared from `pictures`, allowing the whole-drawing guard to see no picture and accept a tight rendered crop. I made this route fail closed when an answered page contains a usable but unmeasurable picture, and made the single-picture guard aggregate repeated identities. Added a regression at [tests/collect-pdf-composite-figures.test.ts:367](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/tests/collect-pdf-composite-figures.test.ts:367); observed red before the fix and green afterward.

2. **P2 — the new 16-call policy was not pinned by a test.**  
   [tests/collect-pdf-composite-figures.test.ts:215](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/tests/collect-pdf-composite-figures.test.ts:215)

   The ceiling test enforced whichever value `MAX_LOCATE_CALLS` exported, so reverting 16 to 8 remained green. Added an exact `16` assertion.

3. **P2 — failure-union documentation became stale.**  
   [src/assets.ts:200](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/assets.ts:200)

   Corrected “first nine” to eleven and removed another obsolete numeric count.

Verified:

- Summed shares are consistently used for settled `taken`, region-vs-region, and region-vs-choice conflicts.
- Abort finalisation cannot lose or double-record markers. A started storage put may leave an orphaned content-addressed blob after abort, but cannot alter the returned manifest or counters.
- The incremental deadline test would fail both the old implementation and a batch-layout implementation.
- Both new failure words are exhaustively mapped; `src/web` has no reason-specific switch requiring changes.
- LeCun replay: **18 stored, 7 located, 9 calls**.

Checks:

- Requested focused suite: **170 passed**.
- Typecheck: all **4,049** source files covered and passed. `npm run typecheck` itself could not open `tsx`’s IPC socket in this sandbox, so I ran the same script via `node --import tsx`.
- Lint: no errors; six existing complexity advisories.
- Full `npm test`: could not start because local Postgres/Docker is unavailable.
- No commit made.