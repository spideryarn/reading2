# Stage 3 code review findings

## Findings

### WR-S3-1 — P1 — `tools/fleet/web/src/DecisionsPanel.tsx:696-717`

The compact Sessions rows render a latest completed report as, for example, `work-reports completed
(finished) · …`, without saying that this is only the session's claim. In a list headed “Sessions” that
reads as the session's current state, which crosses the design's central boundary: report kinds must
never become done/completed state, and every displayed report must remain explicitly a claim. The same
wording is used when the register is unavailable. Fixed after a red panel test: `LatestClaim` now says
`latest: claimed by …` before the kind and summary in both session-list shapes.

### WR-S3-2 — P1 — `tools/fleet/routes-reports.ts:277-321`

The route suppresses the body for a successful HEAD request only. `HEAD /api/reports` sends a JSON
body when a reader throws, and a HEAD request for a missing reports subpath sends its 404 JSON body as
well. HEAD has the same response metadata as GET but no response body on success or failure; the route's
current behaviour breaks that contract precisely on the loud failure arms. Red route tests and fix
completed: both the thrown-reader 500 and missing-subpath 404 emitted bodies before the fix. `sendJson`
now suppresses its body for HEAD on every route arm; the existing successful-HEAD case remains green.

### WR-S3-3 — P2 — `tools/overseer/reports.ts:993-1085`

Quarantine names use `Date.now()` plus a per-pass sequence that restarts at zero, while pruning decides
“newest” by sorting those names. If two passes run in the same millisecond, entries moved by the later
pass sort among the first pass's oldest sequence numbers and can be deleted immediately instead of the
oldest retained entries. That breaks the specified newest-200 diagnostic retention. Red same-millisecond
quarantine test and fix completed: quarantine batches now receive a process-monotonic millisecond stamp,
so a later pass sorts after an earlier one even when the wall clock has not ticked.

### WR-S3-4 — P0 — `tools/overseer/reports.ts:1088-1092`

Inbox enumeration is capped, and a symlink is correctly renamed without following its target, but
quarantine pruning calls `rmSync(..., { recursive: true })` on old entries. A quarantined directory can
contain an arbitrarily large tree, so one pruning operation can still monopolise the synchronous daemon
and wedge its heartbeat—the failure the inbox bound was added to prevent. A narrow deletion substitution
cannot preserve all three requirements (move directories out of the hostile prefix, retain at most 200,
and actually discard older non-empty trees). This needs a separately budgeted, resumable cleanup protocol;
not fixed in this review.

### WR-S3-5 — P1 — `tools/overseer/reports.ts:1646-1709`, `tools/fleet/routes-reports.ts:69-93,195-224`

The daemon's pass is bounded, but the dashboard route calls `readInbox`, which uses whole-directory
`readdirSync` calls and opens every matching inbox file. The route's 8 MiB preflight covers only
`reports.jsonl`; a flooded inbox can therefore make `GET /api/reports` do unbounded synchronous directory
and byte work before its 2 MiB response cap applies. It will not falsely return an empty log, but it can
fail to return at all and block the fleet server. A truthful fix needs a bounded inbox-summary read and a
wire arm/count that says the count was capped, rather than silently reporting a partial exact count; not
fixed in this review.

## Wider things not fixed

- WR-S3-4 needs a budgeted quarantine cleanup design; WR-S3-5 needs an explicit bounded/incomplete inbox
  summary shape across the reader, route, wire parser and panel. No files outside Stage 3 were changed.

## Gate results

- Stage 3 test files, with the sandbox-only real-Git case excluded: `Test Files 8 passed (8)`;
  `Tests 179 passed | 1 skipped (180)` (exit 0).
- The same Stage 3 run without exclusion: `Test Files 1 failed | 7 passed (8)`;
  `Tests 1 failed | 179 passed (180)` (exit 1). The sole failure is the brief's expected
  `spawnSync git EPERM` real-Git test.
- Related decision-panel, doc-link and built decision-route gates: `Test Files 3 passed (3)`;
  `Tests 65 passed (65)` (exit 0).
- `node --import tsx scripts/typecheck.ts`: exit 0; all four TypeScript projects checked and all 1,982
  source files covered.
- `npm run build:fleet`: exit 0. Scoped Biome lint: exit 0 with pre-existing advice only.
  `git diff --check`: exit 0.

## Verdict

**Not approved.** Decision-report attribution and replay satisfy gate 1, the inbox scan itself is capped
and clears invalid prefixes, claims remain claims after WR-S3-1, and the route's method/HEAD/failure arms
are correct after WR-S3-2. WR-S3-4 still permits an unbounded recursive operation in the daemon, and
WR-S3-5 leaves the dashboard's inbox read unbounded, so the stage is not ready to land. WR-S3-3 is fixed.
