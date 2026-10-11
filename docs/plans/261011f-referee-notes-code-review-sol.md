## Findings

- **C1 — P0 — not fixed, wider product/security decision:** [public-reader.ts](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/src/store/public-reader.ts:711) still publishes the body of a criterionless comment after it is marked Major or Minor; omitting `severity` from the projection does not withhold the review note itself. This was already deferred in the plan, but I still consider it unsafe unless Greg explicitly accepts it or `severity IS NULL` is added to the public filter.

- **C2 — P1 — fixed:** pending sort state lived in the replaceable Notes panel, so leaving and returning during a PATCH re-enabled Copy over stale grouping. [useComments.ts](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/src/web/useComments.ts:394) now owns counted pending state, including two quick presses and article changes. Red-first coverage: [referee-notes-panel.test.tsx](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/tests/referee-notes-panel.test.tsx:116), [recolour-write-order.test.tsx](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/tests/recolour-write-order.test.tsx:240). Root-cause write-up: [postmortem](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/docs/postmortems/261011b-a-transient-consumer-cannot-own-an-asynchronous-write-s-pending-state.md:1).

- **C3 — P1 — fixed:** a severity-marked wordless highlight still counted as pristine and could be automatically removed by an overlapping selection. [fresh-highlight.ts](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/src/web/fresh-highlight.ts:38) now treats severity as reader work. Red-first test: [referee-notes.test.ts](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/tests/referee-notes.test.ts:87).

- **C4 — P1 — fixed:** Notes was absent from the generated command catalogue, so command-bar discovery failed. Regenerated at [command-pick-catalogue.generated.json](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/src/command-pick-catalogue.generated.json:638); the existing catalogue test was red before regeneration.

- **C5 — P2 — fixed:** `/severity` was absent from the authenticated-route inventory and ordering contract. Added at [authenticated-api-route-contract.test.ts](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/tests/authenticated-api-route-contract.test.ts:875); the existing suite failed before the fix.

- **C6 — P2 — fixed:** sorting moved a focused toggle into another section and dropped keyboard focus. Focus now returns to the pressed Major/Minor control without stealing deliberately moved focus. Red-first test: [referee-notes-panel.test.tsx](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/tests/referee-notes-panel.test.tsx:125).

- **C7 — P2 — fixed:** the panel missed several established UI contracts: delayed `BandWaiting`, note-specific toggle-group names, author voice only around quoted source text, typography-role tokens, and wrapping of unbroken text. Fixes are in [RefereeNotesPanel.tsx](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/src/web/RefereeNotesPanel.tsx:57), [voices.css](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/src/web/styles/voices.css:68), and [referee.css](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/src/web/styles/referee.css:939), with red-first component, type-role, and narrow-width tests.

- **C8 — P2 — fixed:** the Postgres test claimed but did not prove another owner’s comment id returns the same 404. Added the cross-owner case at [comment-severity.test.ts](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/tests/comment-severity.test.ts:210).

- **C9 — P2 — fixed:** `severity_at` was missing from the central event-time contract, the new suite was incorrectly added to the closed historical migration ledger, and live docs/code comments still described five Referee views. These are corrected, including [event-times.test.ts](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/tests/event-times.test.ts:357) and [comments.md](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton/docs/project/comments.md:385).

No model-owned answer, citation, search, model, or error reaches copied text; the narrow projection and sentinel tests are sound.

On your doubts:

- `useComments.sort` catches ordinary request/read failures, so its returned queue promise resolves; the panel now also consumes an unexpected rejection. The queue continues and settles after either the Notes panel or the whole hook unmounts.
- `orderComments<T extends Passaged>` is correct. It preserves each caller’s richer item type while reading only passage-order fields; cloning the readonly arrays is appropriate.
- I no longer object to bare `Summary`: it is an empty structural heading, not model-authored prose, and matches the explicitly settled product decision.

Verification:

- Scoped unit run: **13 files, 749 passed, 3 skipped**.
- Authenticated route contract: **523 passed**.
- Typecheck: all four projects clean.
- Changed-file lint: no errors.
- `git diff --check`: clean.
- `npm test` could not start the Postgres lane because this sandbox cannot reach the local database. The newly added Postgres cases therefore remain for your environment.
- No commits made; unrelated existing worktree changes were left untouched.

**VERDICT: DO NOT LAND — C1 still needs explicit acceptance or a public-query fix.**