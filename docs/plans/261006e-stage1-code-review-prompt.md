# Code review, and fix: 261006e stage 1 — a Skim term chip opens the glossary's own card

You are the reviewer-fixer. You may edit files in this worktree. **Fix what is inside this stage,
narrowly, each fix with a test seen red first; report, do not fix, anything wider.** Do not commit.

## The candidate

Commit `0432a7404` on this worktree's branch. `git show --stat 0432a7404` lists its paths:

- `src/web/SkimPanel.tsx` (§ `TermChip`, `StopCardView`, `closeTerm`, `focusCurrentRow`)
- `src/web/ProseHoverCard.tsx` (§ `TermCard` exported; `onOpen`, `onOpenTerm` optional)
- `src/web/modes/skim/SkimMode.tsx`, `src/web/stop-card.ts`, `src/web/styles/skim.css`
- `tests/skim-panel.test.tsx`, `tests/stop-card.test.ts`, `tests/skim-purpose-line.test.tsx`
- `docs/project/skim.md`, `docs/project/tooltips.md`
- the plan `docs/plans/261006e-skim-cue-situates-the-quote-and-term-chips-use-the-glossary-card.md`
  and your own plan review `docs/plans/261006e-plan-review-sol.md` (F2, F3, F4 are this stage's)

**Out of scope, and do not touch:** `src/skim.ts`, `src/types.ts`, `tests/skim.test.ts`,
`scripts/eval/**`, `src/skim-v9-eval-tmp.ts`, `evals/**`, `docs/investigations/**`. Another agent is
editing those in this worktree right now for stage 2; they are uncommitted and not part of this
review. A red test caused by those files is not a finding here; say so and move on.

## What it is for

Greg's report: *"In Skim mode, the Glossary clues don't have to say "also at stop X". And they
should provide/reuse the usual "go to glossary" etc in rich tooltips"*. The plan's Stage 1 and its
"Sol's plan review" section say what was decided.

## Your independent pass first

Read the diff as a hostile reader. Run `npx vitest run tests/skim-panel.test.tsx tests/stop-card.test.ts tests/tooltip-interactive.test.tsx`
yourself (they need nothing outside the tree; a red that comes from the sandbox being unable to
spawn is not a finding). Look for: states where the card cannot be closed or cannot be opened;
hover-held and pinned state disagreeing; a term card left open over a different stop; keyboard
(Tab into the card, Escape, Enter on the chip); the visitor's band; what Hide and Dig deeper do to
the panel's state and focus; the prose hover card drawing differently than before for any reader;
the docs saying anything the code does not do.

Severity: **P0** wrong for readers or loses data; **P1** a real bug a reader will meet; **P2** worth
fixing; **P3** note. Every finding gets an id (F1…), file and line, whether you fixed it, and the
test you saw red. End with `VERDICT: ready` or `VERDICT: not ready`.

## My own suspicions (already mine; spend most of the run elsewhere)

- `TermChip`'s click handler: `if (held && !pinned) return;` — a touch tap may set `held` through
  focus before the click arrives, so the tap would never pin and the card would close when focus
  moves. The sentence I would least like to be wrong about: "a tap opens the card and it stays
  until a tap elsewhere".
- `acts` is a new object every render; whether that defeats anything memoised in `TermCard`.
- `.skim-term-card`'s `max-height: max(6rem, calc(50dvh - 4rem))`: whether the card can still run
  off a short window.
