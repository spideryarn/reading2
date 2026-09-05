# Narrow final check: F8 account-cache teardown only

Repo: /Users/greg/dev/spideryarn/reading2. Read-only documentation review. Do not edit files,
commit, push, access services, inspect secrets or personal data. No tests need rerunning for this
narrow source-contract check; the documentation check just passed independently in round two.

General discovery is closed after two rounds. Your second review closed F1–F7 and found only F8.
Check **only whether the final F8 wording actually closes that finding**, including preservation
of the existing direct-switch versus sign-out policy. Do not begin a third whole-plan audit.

Live pre-commit source baseline: fd370cfe050fc9ad0bdfd107668b857abaab5219. Latest inspected shared
HEAD: 99fe2cb822c188f5e01566df9c0f8c417afe4fed. The candidate is untracked; read files directly.
Exact changed scope for this narrow check:

- docs/plans/260905e-main-app-architecture-review.md: A0's “Account teardown is also a writer”
  paragraph and the “Close the cache-ordering gap” stage's new teardown checkbox.
- docs/plans/260905e-main-app-architecture-review-closure.md: F8 disposition and round-two record.
- docs/plans/260905e-main-app-architecture-review-f8-prompt.md: this prompt.

Evidence: docs/plans/260905e-main-app-architecture-review-round2-sol.md § F8, plus
src/web/lib/offline-store.ts § forgetUser and src/web/lib/api.ts § saving/auth callback. The
other eight candidate documents/review artifacts are listed in the round-two prompt and results;
they are unchanged by this amendment. This is a plan, not a claim that the code bug is fixed.

Replacement contract: teardown atomically advances/retains owner epoch and deletes bodies; no
pre-retirement ticket may commit, including after the same account signs in again. Test release
of a paused response after completed teardown, B unchanged, new A request can save. Direct A → B
switching that currently retains partitioned copies is not silently changed into a purge policy.

Return F8 CLOSED or OPEN, with exact evidence and an explicit READY / NOT READY verdict for this
fix. Refuse only for an established P0/P1 in this fix with no unresolved material inference.
