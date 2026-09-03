# Review prompt: 260902o, Stage A, the code

You are GPT Sol, reviewing built code in the Spideryarn repo (this working tree, read-only). You
reviewed the plan: `docs/plans/260902o-adding-a-mode-review-sol.md`; the plan with your findings
folded in is `docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md`.
Treat the code as unreviewed code written by someone else.

One commit: **`git show 569bad78`** — Stage A. Items: T0.1 (`CACHEABLE` in `src/web/lib/api.ts`
plus the stateless quiz-mark exemption plus the referee exclusion), T0.2 (`CriteriaPanel`
cleanup), T0.3 (`reading-view-overview.md`), T1.1 (`MODES_UI` exhaustiveness in
`src/web/Dock.tsx`), T1.2 (the label's one home: `MODE_LABEL`), T1.3 (`src/web/visitor.ts`:
`POLICY: Record<Mode, VisitorPolicy>`, three variants, the if-chain and fall-through deleted).

Run `git show 569bad78 --stat` then `git show 569bad78`. Two sibling commits (`b78d7e2a`,
`50b25cad`) are under separate review; ignore them unless Stage A depends on them.

## What I want

1. **T1.3, the semantics.** Diff the old `visitorGap` against the new for every one of the
   thirteen modes: same return for each? The `owners-only` sentence now takes its noun from
   `MODE_LABEL[mode]` where `COSTS` used to spell it; the old strings were "Search", "Chat",
   "Remember", "Diagram", "Timeline", "Referee" — does `MODE_LABEL` say the same six words? Then
   `markedModes` and the dock tooltip, which read from this file — unchanged output? Run
   `npx vitest run tests/visitor-gaps.test.ts` and `npx vitest run tests/public-network-trace.test.tsx`.
2. **T1.3, the test.** One assertion was deleted from `tests/visitor-gaps.test.ts` ("never shows
   a visitor a bare mode id"). Was it only guarding the fall-through, or did it also pin something
   a wrong `POLICY` row could now break — a mode marked `available` that should spend? Say what,
   if anything, now catches a *wrong* row as opposed to a missing one.
3. **T1.1.** `satisfies readonly ModeUi[]` without `as const` — the author says the `mode`
   literal survives and `keepLabel` would not with `as const`. Confirm by reading the type, and
   confirm the mutation: delete one row, does `ModesMissingFromDock` go red? (You cannot run
   typecheck; reason from the types, or say you could not.)
4. **T0.1.** `storesNothing()` exempts `POST /api/quiz/:slug/mark` from invalidation. Is a mark
   really stateless server-side — read the route in `src/routes.ts` — or does it write anything
   (a ledger row, a score) that the cached quiz GET reflects? Then the referee exclusion: is the
   docstring's reason correct about `slugOf` and `resourceOf`, and is the test's explicit
   not-cached assertion honest? Run `npx vitest run tests/cacheable-covers-artefact-routes.test.ts`
   and `npx vitest run tests/api-fetch-offline.test.ts`.
5. **T1.2.** The controls bar now renders `MODE_LABEL[mode]` under a CSS uppercase. Any place
   still rendering a raw mode id to a reader? `grep -n "{mode}" src/web/*.tsx` and judge each.
6. **The `header()` fix.** `saving()` read `res.headers.get(...)` directly and a headerless stub
   threw; it now goes through `header()`. Is the fix in the right place, or should the stub have
   been made honest instead?
7. **Anything you would not ship.** One-line comments that now say something false, a
   deleted comment that carried a decision, a test made vacuous.

## Format

For each finding: **(a)** the input under which the code fails its own claim, runnable; **(b)** the
smallest change that closes it, described. Rank by (a). Then a verdict: ship / ship with changes /
not ready.

Read-only tree. One test file at a time with `npx vitest run tests/<one>`; `npm test` and
`npm run typecheck` are blocked.
