# Second review: main app architecture contracts

Repo: /Users/greg/dev/spideryarn/reading2, branch dev. Documentation only. Do not edit files,
commit or push; do not inspect secrets, personal articles, databases or providers.

## Candidate identity and evidence

Source audit base: fd370cfe050fc9ad0bdfd107668b857abaab5219. Current shared-checkout HEAD at prompt
preparation: 99fe2cb822c188f5e01566df9c0f8c417afe4fed. Candidate files are still untracked; read them
directly, not only `git diff`:

- docs/plans/260905e-main-app-architecture-review.md
- docs/plans/260905e-mode-catalog-and-command-bar.md
- docs/plans/260905e-main-app-architecture-evidence.md
- docs/plans/260905e-main-app-architecture-review-closure.md
- docs/plans/260905e-main-app-architecture-review-prompt.md
- docs/plans/260905e-main-app-architecture-review-sol.md
- docs/plans/260905e-main-app-architecture-review-round2-prompt.md

The original prompt carries Greg's contract and review scope; the two proposals carry his exact
brief and the recommendations. The closure records first-review findings and changes, not proof
that the changes work. The full-check evidence is unchanged: two unrelated fixture-publication
failures, with typecheck/build clean. A current doc-check rerun passed 14/14 after a peer fixed the
intervening citation failure. You may independently run only:

`npx vitest run --project unit tests/doc-links.test.ts --reporter=dot`

## Task

Second and final general-discovery review of this documentation stage. Independently check the
amended contracts, especially the concrete failure paths F1–F6 from your first review. The goal is
implementation-ready staged recommendations, not implemented code. Do not demand a production
refactor or a red reproduction test to be added as part of this docs-only task; the plan specifies
those as the first implementation steps. Check that the first-step tests would actually catch the
claimed class and that simpler defaults do not hide product decisions.

For each previous finding return CLOSED or OPEN with source/section evidence. New discoveries must
follow the original evidence/severity contract: established P0/P1 requires a concrete consequence
with no unresolved load-bearing inference. Preserve F1–F7 IDs; assign F8 onward if necessary.
Return an explicit READY / READY WITH CHANGES / NOT READY verdict and minimal changes for any
remaining findings. Do not repeat resolved findings just because future implementation is required.

## Author's changed choices, for scrutiny after independent reading

- F1: no automatic unknown-POST resend in the small pilot; durable server idempotency before such
  retry is enabled. Existing active-work dedupe is explicitly insufficient. Unknown is a result.
- F2: exact activation capture/retirement at the boundary seam, outside failed-child effects.
- F3: explicit semantic inputs and a narrowed ordinary-Chat pilot, preserving profile/drafts and
  visibly creating a new Chat by default. Existing caller migrations require full parity.
- F4: one inline price/effects confirmation only when not already disclosed before submission.
- F5: monotonic issued sequences but eligibility checked against last successful commit, not max
  issue; therefore no pending-response body queue. Reservation deadline; network still works.
- F6: all cache writers covered, with whole-article atomic eviction rather than rowwise deletion.

Report your verdict in your final answer; no file edits.
