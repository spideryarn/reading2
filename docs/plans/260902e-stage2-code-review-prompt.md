# Code review: stage 2, modes that start themselves when you click them

You are reviewing **built code**. Repository root is this working directory (a git worktree of
Spideryarn, branch `worktree-article-job-queue`). Read-only: do not edit anything.

**Weight this above the plan review you gave earlier** — that one read prose; this is the half where
the bugs are.

## What to read

Stage 2 is uncommitted in the working tree. Get the scoped diff with:

```
git diff HEAD --stat
git diff HEAD -- src/web/activation.ts src/web/useAutoRun.ts src/web/jobEngine.ts src/web/useStepJob.ts
git diff HEAD -- src/web/Dock.tsx src/web/DiagramPanel.tsx src/web/JobProgress.tsx src/web/WrittenForYou.tsx
git diff HEAD -- src/web/useIdeas.ts src/web/useQuotes.ts src/web/useTimeline.ts src/web/useSketch.ts src/web/useGlossary.ts
git diff HEAD -- tests/
```

Then:

- `docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md` §§ 2a–2f.
- `docs/plans/260902e-...-review-sol.md` — your own review of the plan. **Blocker 1 (mount is not
  clicking), blocker 2 (the first-poll baseline), items 5, 7 and 8 are all stage 2.** Check each
  landed in code, not only in prose.
- `docs/plans/260831ai-...-review-sol.md` — your earlier review of the plan this is a recut of.
- Stage 1 is committed and pushed (`540927f`, `750672c`); it is context, not scope.

## What it does

Clicking a mode in the bottom bar runs its job if that mode has never been run for this article.
Five paid modes: Glossary, Ideas, Quotes, Timeline, and Sketch inside Diagram. **Only a click
auto-runs** — a pasted `?mode=quotes` URL and Back/Forward must show the empty state and spend
nothing. Greg decided that explicitly, taking your side.

## Where I want you hardest

1. **The activation token** (`src/web/activation.ts`). `{nonce, sessionEpoch, slug, target}`, minted
   only in `DockModes`' `onClick` and the Sketch chip's `onClick`, held in a `Map` keyed on
   `(slug, target)`, consumed by delete-before-return, with `sessionEpoch` checked at **consumption**
   rather than at mint. Walk every path by which a panel can mount and ask whether a token can be
   spent that no press produced, or a press lost. Specifically: two panels mounting from one token;
   `<StrictMode>`'s double-invoked effect; a click that navigates to a different article; rapid
   Ideas → Quotes; a click on the already-selected mode; a token still live when the GET fails.
2. **The builder kept a token alive across its panel unmounting**, deliberately, and wrote up the
   trade in `activation.ts` § *A token outlives its panel*. The cost admitted is that a kept token
   can be spent on a later arrival at that band, possibly reached by Back. Is that bounded the way
   the comment claims — by the one-attempt guard, the epoch, and the tab's life — or is there a
   sequence where a Back step spends a token and the reader sees a paid job they did not ask for?
   This is the one I most want a second opinion on.
3. **The one-attempt guard** — `jobEngine.beginAutoAttempt(slug, step)`, a session `Set`, insert
   then answer, cleared in `teardown()`. Is it genuinely synchronous ahead of every `await` on every
   path? It is what replaces the button as the structural answer to the original version's
   generate-fail-generate loop, so a hole in it is the whole feature.
4. **`ensure` / `regenerate`.** Auto-run and the empty-state buttons must be **unforced** and the
   *again* buttons forced. If any empty-state button still forces, a click during the auto-start
   window carries a different `work_key`, stage 1 does not de-duplicate it, and the reader pays
   twice. Check all five hooks and all five panels, not a sample.
5. **First-poll reconciliation** in `useStepJob` — the id `start()` returned is reconciled once even
   when it first appears as `done`, guarded by a per-mount `announced` set. Does it reload exactly
   once, never zero, never twice, and does it avoid turning historical completions into news?
6. **The tests.** Which would pass while the feature was broken? The builder reports watching each
   go red against a disabled mechanism and quotes the failures; check the mechanisms it disabled
   were the load-bearing ones. It also reports that `<StrictMode>`'s double-invocation only actually
   bites the **glossary** case, because the other four settle on an update — verify that, because
   if it is wrong the other four tests are asserting something they never exercise.

## Known and deliberate

- No readiness dot, no queue positions — Greg's calls.
- `npm test` is not a reliable gate here; it swings run to run on a shared Postgres. Do not read a
  red full run as evidence about this diff without checking the file against it.
- The real-browser pass (§ 2f) is running separately and is not your job.

## Ground rules

Be concrete, name files and lines, rank findings, and say for each whether it is a bug you can
demonstrate or a risk you are inferring. Say NO-SHIP if it deserves it. Where you disagree with a
decision already made, say so once and review within it.
