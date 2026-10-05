**Request changes to the committed candidate: F7 and F8 are established P1s. Both are now fixed in the worktree. No commits made.**

- **F7 — P1, established; B.** While a replacement loads, focus another control, then blur it between commits. The arriving composer steals focus. A new test failed before the fix. Smallest fix: cancel pending focus on `focusin`; implemented and tested in floating and card placements.
- **F8 — P1, established; D.** A block covered by Notes before the first ordinary part is reassigned to that part. The regression failed, and the Notes-first fixture passes `checkTree`. Smallest fix: preserve an existing tree path before applying the prefix fallback; implemented.
- **F9 — P2, established; D.** `headBlock` throws when an existing root lacks `children`. A helper test reproduced it. Smallest fix: treat a missing child list as empty; implemented.
- **F10 — P2, established; C tests.** The copied `ReaderNavHarness.onMode` retains Chat’s thread when returning to Quiz. Its new test failed while production behaved correctly. Smallest fix: use `returnToSubMode` in the harness; implemented.
- **F11 — P3, established; plan.** F4’s disposition says textarea-only, while implementation also transfers focus from Send. A rendered test confirms that behaviour. Added an explicit implementation disposition.
- **F12 — P1, established, wider/pre-existing.** Removing the stored root’s `children` crashes the real reading view earlier in `buildChains`. Left unchanged for your decision. Validate or guard persisted child lists before geometry traversal.

For **A**, I found no downstream dependency on the thrown `FetchFailure` identity or fields. Retry and CLI ingest use the job’s classified result. Losing Node errno reduces debugging detail; safely restoring it would require an explicit allowlist, rather than copying arbitrary cause text. The reader sentences follow `copy.md`.

For **C**, reading `subNav.remember` is appropriate: it follows nuqs state when React leads the address.

Verification: **281 targeted tests across 11 files passed**, including existing focus tests and doc links. All typecheck projects passed via `node --import tsx scripts/typecheck.ts`. Lint reported two existing complexity notices. Full `npm test` was blocked by database access; the broader unit run reported an unrelated Overseer failure and was interrupted.

Changed worktree files:

- `src/web/ChatDialog.tsx`
- `src/web/marginalia/notes.ts`
- `tests/chat-dialog-keeps-the-caret-across-a-switch.test.tsx`
- `tests/command-bar-sub-modes.test.tsx`
- `tests/marginalia-notes.test.ts`
- `docs/project/marginalia.md`
- `docs/plans/261004l-four-small-queued-fixes-fetch-failure-sentences-composer-focus-stale-remember-param-marginalia-head-at-the-top.md`
- `docs/postmortems/261005a-current-focus-cannot-prove-that-focus-never-moved.md`
- `docs/postmortems/261005b-a-positional-prefix-is-not-necessarily-uncovered-content.md`
- `docs/postmortems/261005c-a-copied-integration-seam-drifts-from-production.md`