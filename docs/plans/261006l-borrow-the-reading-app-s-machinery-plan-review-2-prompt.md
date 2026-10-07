# Review, second pass: the revised plan for the fleet dashboard's history discipline

Repo: this worktree. Round one is `docs/plans/261006l-borrow-the-reading-app-s-machinery-plan-review-sol.md`
(yours). The plan `docs/plans/261006l-borrow-the-reading-app-s-machinery-for-the-fleet-dashboard.md`
has been rewritten from `## Stages` down; untracked, base `844816cce`.

## Scope: narrow

Discovery is closed. Check only that the fixes for F1 and F2 (both P1) are adequate as now written in
Stage 1, and that the choice to drop the debounce entirely (rather than adopt your F3 protocol) does
not itself create a P0 or P1. The dispositions are in the plan's `## Plan review` table. Treat the
revised text as unreviewed work by someone else.

The statement to judge for accuracy: *"With every write synchronous, local state set before the
address, push by `window.location.hash =`, replace by `history.replaceState` wrapped in try/catch,
and the hashchange handler re-reading `window.location.hash`, React state and the address agree
after every write except after a throwing replaceState, where the address is stale until the next
successful write and nothing else is wrong."* Is that accurate? In particular: after a throwing
replace, can a later queued hashchange (from an earlier push) overwrite the newer local state with
the stale address?

The tree is read-only; you may run one test file or a /tmp harness.

Give findings with IDs numbered from F10, severity P0–P3 (same scale as round one), established or
reasoned, (a) the scenario and (b) the exact replacement wording. End with a one-line verdict:
build / build with the listed changes / do not build.

Do not change any file.
