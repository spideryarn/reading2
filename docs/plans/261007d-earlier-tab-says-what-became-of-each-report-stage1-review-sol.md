I found five code/data issues. Three were P1 wrong behaviour; all fixes are applied and uncommitted. No P0 or unresolved P1 remains.

### Findings

**C1 — P2 — established: the real admin-detection seam had no test**

- (a) Mutation: changing `FeedbackHost` from `admin={isAdmin(readerId)}` to `admin={false}` left the candidate’s original 162 dialog tests green. The new host-level test then failed because it observed `/api/feedback` instead of `/api/admin/feedback/earlier`.
- (b) Added a test that mounts the production `FeedbackHost` with `ADMIN_USER_ID_LOCAL` and verifies all five admin filters. Applied.

**C2 — P1 — established: a mistyped report number was classified as attempted abuse**

- (a) On the candidate, `node --import tsx scripts/feedback-reporter.ts --report-id 999` could say Sentry held a forged event, even though `#999` may simply be a mistyped conversational number.
- (b) Added a distinct `missing-number` verdict and corrected the operating instructions. Missing `spya-` IDs retain the security warning; missing numbers do not. Applied.

**C3 — P2 — established: valid PostgreSQL integer report numbers above nine digits were rejected**

- (a) `--report-id 1000000000` failed parsing even though the column accepts values through `2147483647`.
- (b) Parse up to ten digits, then explicitly enforce PostgreSQL’s positive `integer` maximum. Applied.

**C4 — P1 — established: `spya-jghnva` displayed a question Greg had already answered**

- (a) `feedbackComment("spya-jghnva")` returned “Still waiting on you,” while its note records that the middle wording was measured, failed, and was dropped.
- (b) Removed the stale comment and its stale `awaiting-approval.md` entry, regenerated the map, and pinned the result in a test. Applied.

**C5 — P1 — established: an imports-only question appeared under an unrelated report**

- (a) `feedbackComment("spya-hbqezu")` returned the failed-import question because one combined note named both `spya-a5gzb9` and `spya-hbqezu`.
- (b) Split the report headers into separate notes while retaining the shared narrative, regenerated the map, and added a regression test. Applied.

**D1 — P3 — established: three changed docs did not match the implementation**

- (a) The admin doc and route comment omitted the stored number; `feedback-reports.md` claimed every note needed a comment although the test checks the selected per-report comment; the plan still said Stage 1 was unbuilt.
- (b) Corrected all three descriptions. Applied.

### Builder departures

All five are acceptable:

- The identity column plus deterministic `row_number()` backfill is safe. An empty-table `setval(..., NULL)` is a strict no-op, and the repository grants the application role usage on newly created sequences.
- Falling back only on 404 is correct. A 403 is a real authorization/configuration failure and should remain visible.
- Showing the status word under every admin filter is consistent and useful.
- Requiring each combined declined/awaiting report to have a selected comment is sound; only the documentation had overstated it as every note.
- Sharing `listMine`’s projection and row mapper does not alter its contract.

The repeated status expression uses three array parameters, not roughly 460 scalar binds. Counts and rows use the same status expression and transaction snapshot, so I found no disagreement path. Numeric lookups remain owner-scoped despite globally unique numbers; before migration, lookup failure remains exit 2 rather than “no report.” Non-admin behaviour and the hidden Write-panel guards are unchanged.

Of the 21 added `comment:` lines, the two bad associations are C4 and C5. I found no unsupported new claim in the remainder.

### Verification

- Red-first evidence: 1 dialog mutation failure, 2 reporter failures, and 1 endings failure before their fixes.
- `feedback-dialog`: 163 passed
- `feedback-reporter`: 36 passed
- `feedback-unswept`: 22 passed
- `feedback-endings`: 38 passed
- `feedback-shipped-emails`: 17 passed
- `doc-links`: 18 passed
- Typecheck: all 3,366 source files covered and green
- Generated endings check: 461 reports, current
- `git diff --check`: clean
- Touched-file lint: green, with five pre-existing complexity advisories in `src/routes.ts`

### Files changed

- [plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md)
- [admin.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/project/admin.md)
- [feedback-reports.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/project/feedback-reports.md)
- [combined feedback note](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/261001_1035-past-imports-say-more-and-why-you-are-reading-says-if-saved.md)
- [separate saved-reason note](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/261001_1041-why-you-are-reading-says-if-saved.md)
- [skim feedback note](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/261006_0545-skim-cue-should-situate-the-quote.md)
- [awaiting-approval.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/awaiting-approval.md)
- [comment-scope postmortem](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/postmortems/261007d-a-note-scoped-comment-can-describe-the-wrong-report.md)
- [identifier-provenance postmortem](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/postmortems/261007e-an-alternate-identifier-does-not-inherit-the-primary-identifiers-provenance.md)
- [feedback-reporter.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/scripts/feedback-reporter.ts)
- [feedback-endings.generated.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/feedback-endings.generated.ts)
- [routes.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/routes.ts)
- [feedback-dialog.test.tsx](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/tests/feedback-dialog.test.tsx)
- [feedback-endings.test.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/tests/feedback-endings.test.ts)
- [feedback-reporter.test.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/tests/feedback-reporter.test.ts)

The two pre-existing untracked review prompt/result files were left untouched. Nothing was committed.

VERDICT: approve with fixes