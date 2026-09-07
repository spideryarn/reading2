# Review prompt: mode catalog, Stage 1 (code review)

This is the **obligatory end-of-stage review**, and it is a code review, not a plan review. Weight it
higher than the plan review you gave earlier: a plan-stage review cannot find a field that is read in
a fourth place nobody grepped for.

## Repository and revision

Worktree: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar`
Branch: `worktree-worktree-command-bar`, base commit `3ac53baa` ("Plan a mode catalog and a command
bar, reviewed before any code").

**The change under review is the uncommitted working tree against `3ac53baa`.** Get it with:

```
git diff 3ac53baa -- src/web/Dock.tsx tests/client-imports.test.ts docs/project/new-mode.md docs/project/web-client.md docs/project/experimental-features.md src/modes.ts
```

Two files are **untracked** and will not appear in that diff. Read them directly:

- `src/mode-catalog.ts` — the new module, the heart of the change
- `tests/mode-catalog.test.ts` — its test

## What Stage 1 was supposed to do

Read `docs/plans/260906h-mode-catalog-and-a-command-bar.md`, § "The catalog: what moves, and what
emphatically does not" and § "Stage 1 — the catalog". In short: move `blurb` (renamed `description`)
and `experimental` out of `MODES_UI` in the 2,354-line `src/web/Dock.tsx` into a new pure
`src/mode-catalog.ts` that imports only `./modes.js`, add a new `aliases` field for a command bar
arriving in Stage 2, and leave `label`, `icon`, `keepLabel`, `POLICY` and `MODE_TARGET` exactly where
they are.

Stage 2 — the command bar itself — is **not** in this diff and is out of scope for this review.

## What I most want checked

1. **Did any fact get lost or silently reworded in the move?** All 14 descriptions were supposed to
   move **verbatim**. I checked them by eye against the diff and believe they did; check me. Also
   check the reasoning comments in `MODES_UI` — the long per-mode ordering rationales were supposed
   to survive untouched.
2. **Is totality preserved?** Before this change, `interface ModeUi` had a required
   `experimental: boolean`, and `ModesMissingFromDock` proved every mode had a row — together they
   forced the author of mode fifteen to *decide* its experimental status. After the change, does
   anything still force that decision? Is `Record<Mode, ModeCatalogEntry>` actually equivalent, or
   did something weaken? Check specifically that no `Partial`, optional field, index signature or
   default sneaked in.
3. **Is the import direction actually safe?** `src/mode-catalog.ts` must be importable by the server
   without dragging `src/web/` or React across the seam. `tests/client-imports.test.ts` was edited to
   admit it — check that edit is correct and does not weaken what that test proves for other modules.
4. **Are there prose claims elsewhere in the repo that this change made false?** The implementer
   found and fixed three (`Dock.tsx` header, `experimental-features.md`, `modes.ts` § remember).
   **Sweep for more.** This is the highest-value thing you can do here: grep the repo for text
   asserting that a blurb, description or experimental flag lives in `MODES_UI` or `Dock.tsx`. Docs,
   comments, plans and test docblocks all count. A stale pointer sends the next author to a field
   that no longer exists.
5. **`tests/mode-catalog.test.ts` — is it worth its place?** Does it assert anything a typechecker
   already guarantees (waste), and does it miss anything that could actually go wrong? Note two
   deliberate refusals, both documented in its docblock: it does not assert the catalog agrees with
   `MODES_UI` (vacuous — those fields no longer exist there), and it does not assert experimental
   membership (that would duplicate `BEHIND_THE_SWITCH` in
   `tests/dock-experimental-modes.test.tsx`, which is a deliberately hand-maintained canary and must
   stay independent). Are those refusals right?
6. **The aliases are new product copy.** They are the one thing here with no prior art. Look for: an
   alias that promises an action the mode does not perform; an alias that would send a reader to the
   wrong mode; a collision the uniqueness test would not catch because it is semantic rather than
   textual. Note `referee` takes `review`/`reviewer` — `src/modes.ts` § referee says that word was
   freed by the `review` → `remember` rename. Is claiming it for `referee` right, or would a reader
   typing "review" more likely want `remember`?

## Verify rather than reason where you can

You can run these; they need nothing outside the tree:

```
npx tsc --noEmit -p tsconfig.json
npx vitest run tests/mode-catalog.test.ts tests/dock-experimental-modes.test.tsx tests/client-imports.test.ts tests/dock-fit.test.ts tests/dock-corner-controls.test.tsx tests/dock-experimental-switch.test.tsx tests/diagram-kind-gating.test.tsx
```

I ran both: typecheck clean, 7 files / 170 tests passing. A finding you reproduced outranks one you
reasoned to.

`tests/doc-links.test.ts` has **two pre-existing failures that are not mine** — broken links in
`260906a-labels-leave-the-blocking-hierarchy-step.md` and
`260906f-…-escape-inventory.md`, both other agents' plan docs. Do not report those.

**Do not change any file.** Read-only review.

## Severity scale — use exactly these

- **P0** — will break production, lose reader data, or spend money without disclosure.
- **P1** — a wrong or unmaintainable design that is expensive to unpick later.
- **P2** — worth fixing, but the stage is sound without it.
- **P3** — nit, taste, wording.

Give **every finding an ID** (`F1`, `F2`, …) and a severity, with file and line. Say what is wrong
and what you would do instead. Also say briefly what you checked and **cleared** — I need to know the
coverage, not only the objections.

## My suspicions, last, so they do not anchor you

- The implementer edited three prose claims that were not in its brief, because they would otherwise
  have gone stale. I think that was right, but it means the change is wider than the plan said, and I
  want a second pair of eyes on whether those three edits are accurate and whether they are the only
  ones.
- `outline: ["tree", "map"]` is the thinnest alias set and the one the implementer flagged as least
  sure. `tree` may belong to `hierarchy` instead — `CLAUDE.md` says Hierarchy and the
  granularity-zoom tree are the same structure.
- I am not certain `description` was the right rename for `blurb`. It reads better in a catalog, but
  `blurb` was the repo's established word and the rename touches nothing that would go red.
