P0: none.

P1: none.

- **P2 — DOC-ORIENTATION — Fixed.** The original prose claimed the alternative surfaces always say where the reader is, contradicting the empty-head case where `MarginaliaHead` returns `null` ([MarginaliaColumn.tsx:570](/home/greg/code/spideryarn2/.claude/worktrees/fbrx43ku-hide-headings-rail/src/web/marginalia/MarginaliaColumn.tsx:570)). Qualified the claims and linked the exceptions in [experimental-features.md:250](/home/greg/code/spideryarn2/.claude/worktrees/fbrx43ku-hide-headings-rail/docs/project/experimental-features.md:250), [Reader.tsx:600](/home/greg/code/spideryarn2/.claude/worktrees/fbrx43ku-hide-headings-rail/src/web/reader/Reader.tsx:600), and [headings-crumbs-wiring.test.tsx:463](/home/greg/code/spideryarn2/.claude/worktrees/fbrx43ku-hide-headings-rail/tests/headings-crumbs-wiring.test.tsx:463). The quotation was untouched. The Marginalia doc’s one-way claim remains accurate.

- **P2 — QUEUE-EMPTY-HEAD — Not fixed; wider bookkeeping.** The empty-head gap is a live ordinary state that removes the breadcrumb without providing another locator, and the plan both suggests corrective work and explicitly leaves it unqueued ([plan:75](/home/greg/code/spideryarn2/.claude/worktrees/fbrx43ku-hide-headings-rail/docs/plans/261004k-hide-the-headings-rail-while-structure-or-marginalia-is-on.md:75)). Merely recording a live defect as known conflicts with the project’s deferral rule ([written-down-is-not-checked.md:70](/home/greg/code/spideryarn2/.claude/worktrees/fbrx43ku-hide-headings-rail/docs/reusable/written-down-is-not-checked.md:70)). It should receive a queue proposal or be explicitly declined. The contained-failure and one-frame alias cases are bounded, recover automatically or offer an exit, and do not need separate entries.

Everything else checked out:

- `fit` is established before `marginRoom`; there is no shadowing. Every later use retains the same meaning.
- Scroll, keyboard, CSS, tooltips, and the mode herald already tolerate an absent bar.
- The tests fail on the intended predicates. The shared-tree mutation is safe: it spans the settled `open()`, is restored in `finally`, and each case unmounts afterward.
- Focused test: 12/12 passed. `git diff --check` passed. Full suite not run.
- Changes are uncommitted.

VERDICT: approve with changes