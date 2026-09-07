# Review prompt: the command bar, Stage 2 (code review)

This is the **obligatory end-of-stage review**, and it is a code review of a user-facing feature.
Weight it higher than the plan review: a plan-stage review cannot find a keyboard handler that fires
inside a textarea, or a test that asserts a token instead of a spend.

You reviewed this plan before it was built, and Stage 1 after it landed. This is the last round.

## Repository and revision

Worktree: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar`
Branch: `worktree-worktree-command-bar`, base commit `e601e463` ("A mode catalog: what a mode IS, out
of the component that draws it").

**The change under review is the uncommitted working tree against `e601e463`.** Get the tracked part
with `git diff e601e463`. **New files are untracked and will not appear in that diff** — get their
names with `git status --short` and read each one directly. `src/web/CommandBar.tsx` and
`src/web/command-match.ts` are the heart of the change.

## What Stage 2 was supposed to do

Read `docs/plans/260906h-mode-catalog-and-a-command-bar.md` § "The command bar" and § "Stage 2". In
short: a Spotlight/Alfred-style modal opened by Cmd/Ctrl-K and by a new Dock button, listing the
app's 14 modes, where Enter opens a mode **exactly as pressing its Dock button does** — same
activation, same generate-on-open, same cost.

Five of its design decisions came from your own round-1 review and are not optional: one shared
`activateMode` callback rather than two matching call sites; the visible mode list passed as a prop
(because `Dock` imports `CommandBar`, so the reverse import is a cycle); cost parity tested through
the real harness rather than via `pendingActivation`; the matcher and keyboard contract specified
tightly; and an Escape precedence rule against the Dock drawer's capture-phase handler.

**The product owner's decisions are fixed and not up for review**, and are listed in the plan's
§ "The four product calls": modes only; `No command matches.` with no fallback; Cmd/Ctrl-K plus a
Dock button; the bar lists exactly what the Dock lists. You may report if the *code* fails to deliver
one of them.

## What I most want checked

1. **Cost parity — the load-bearing claim of the whole feature.** Does activating a mode from the bar
   really do what pressing its Dock button does, for all 14 modes? Check the `activateMode`
   extraction actually captured everything the old `onClick` did, in the right order. Check the
   parity test asserts on real spend — queued job steps and direct POSTs — and not merely on an
   activation token. Diagram's Force, Drift and Trail paths spend through **mount-time POSTs that
   leave no token at all**; a test that only compares `pendingActivation` would pass while the bar
   spent differently. Is Diagram's delegated `PressContext` (`{ diagram }`) supplied correctly from
   the bar's side?
2. **Is there any path where the bar spends money the Dock would not, or fails to spend where the
   Dock would?** Including: activating a mode the reader is already in; activating while an
   activation from a previous press is still pending; double-Enter or key repeat; activating an
   experimental mode with the switch off (should be impossible — it should not be listed).
3. **The `generates` marker.** It is derived from `MODE_TARGET`. Is it total — can mode fifteen
   arrive unmarked? Is the derivation right (`fixed` and `delegated` generate, `none` does not)? Does
   the accessor added to `activation.ts` leak the table or otherwise widen that module's contract?
4. **The keyboard handler.** Does Cmd/Ctrl-K fire when it should not — inside an `input`, `textarea`,
   `select`, `contenteditable`, or while another modal is open? Does it ignore `e.repeat`? Does it
   `preventDefault()` only when it claims the press? Is the Dock drawer's **capture-phase** Escape
   handler still able to eat the bar's Escape in any ordering?
5. **No dependency cycle.** `CommandBar` must not import from `Dock.tsx`. Verify by reading the
   imports, and note `npm run check` includes a `cycles` gate that I will run.
6. **The matcher.** Is `rankModes` total and deterministic — are ties really broken by input order,
   and is the ranking a strict order rather than something that can return the same mode twice or
   drop one? Does `canonical` in `command-match.ts` actually get used by
   `tests/mode-catalog.test.ts`, so the table and the matcher share one normaliser rather than two
   that agree today?
7. **Accessibility and the modal contract**, against `FeedbackDialog.tsx` as the precedent: focus
   trap, focus restore to the opener, `role="listbox"` with `aria-activedescendant`, and the Dock
   button's ARIA as a modal opener (that file has a five-kinds-of-button rule — does the new button
   obey it?).
8. **Anything user-visible that would embarrass us**: a row that can be activated but does nothing,
   an empty state that flashes, a bar that opens on a page where its `activateMode` cannot work.

## Verify rather than reason where you can

You can run these; they need nothing outside the tree. A finding you reproduced outranks one you
reasoned to:

```
npx tsc --noEmit -p tsconfig.json
npx vitest run tests/command-match.test.ts tests/command-bar.test.tsx tests/every-mode-draws-its-surface.test.tsx tests/dock-experimental-modes.test.tsx tests/mode-catalog.test.ts tests/dock-fit.test.ts tests/dock-corner-controls.test.tsx tests/dock-experimental-switch.test.tsx tests/diagram-kind-gating.test.tsx tests/client-imports.test.ts
```

(Adjust the file names to what actually exists — `git status --short` will tell you.)

`tests/doc-links.test.ts` has **two pre-existing failures that are not mine** — broken links in
`260906a-labels-leave-the-blocking-hierarchy-step.md` and `260906f-…-escape-inventory.md`, both other
agents' plan docs. Do not report those. Anything touching Postgres or a local service will fail for
sandbox reasons; do not report those either.

**Do not change any file.** Read-only review.

## Severity scale — use exactly these

- **P0** — will break production, lose reader data, or spend money without disclosure.
- **P1** — a wrong or unmaintainable design that is expensive to unpick later.
- **P2** — worth fixing, but the stage is sound without it.
- **P3** — nit, taste, wording.

Give **every finding an ID** (`F1`, `F2`, …) and a severity, with file and line. Say what is wrong
and what you would do instead. Also say briefly what you checked and **cleared** — coverage matters
as much as objections, and this is the last round before it ships.

## My suspicions, last, so they do not anchor you

- The cost-parity test is the one I am least able to check by reading. It was supposed to
  parameterise the existing phase-A trigger in `tests/every-mode-draws-its-surface.test.tsx` rather
  than build a second, weaker harness. If it built a second harness instead, say so plainly — that is
  a P1 dressed as a passing test.
- The `generates` marker over-warns when the artefact already exists. That is a known, recorded
  trade-off (the Dock under-warns in the same case), not a finding. But tell me if it *under*-warns
  anywhere, which would be a real problem.
- Mounting from `Dock.tsx` was partly to avoid `App.tsx`, which another agent is rewriting. If that
  has produced something contorted, I would rather know now.
