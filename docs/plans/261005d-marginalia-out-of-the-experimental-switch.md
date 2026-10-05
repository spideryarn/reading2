# Marginalia out of the experimental switch

Up: [plans.md](../project/plans.md)

Report `spya-vv54j2` (Sentry SPIDERYARN-READING2-C2, queue item `qi-ef6fvbcm`), from an admin, so
trusted input. Greg, 2026-10-04:

> Let's take the annotations mode out of experimental features, i.e. make it a mainstream feature
> available to everybody.

"Annotations" is the mode called Marginalia since 2026-10-01
([261001n](261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md)).

## What changes for a reader

- **Switch off**: the Marginalia toggle is at the right-hand end of the modes in the bottom bar, in
  its own frame, and *Marginalia* is a row in the command bar. Until now both were drawn only with
  the switch on, or while the notes were already open.
- **Switch on**: as today.
- **A visitor** (signed out, or on somebody else's article) gains the toggle too. `POLICY.marginalia`
  is already `available`, and a visitor's column draws what the payload carries. It has no relation
  words (owner only, [marginalia.md](../project/marginalia.md)) and a visitor's press starts no job.
- **A new article has its relation words made on import**, with the other main modes, when the add
  page's *Generate the main modes* box is ticked (the default). See the first decision below.
- **A first-opened article arrives in Summary and Marginalia** for every signed-in reader whose
  window has room for both (from 900 usable px), not only for a reader with the switch on. See the
  second decision.

## The build

1. `MODE_CATALOG.marginalia.experimental` to `false` (`src/mode-catalog.ts`), and `marginalia` out of
   `BEHIND_THE_SWITCH` (`tests/dock-experimental-modes.test.tsx`): the two edits
   [mode.md § Moving a mode in or out of the switch](../project/mode.md#moving-a-mode-in-or-out-of-the-switch)
   names.
2. `relations` into `AUTO_MODE_STEPS` (`src/auto-mode-steps.ts`), in `STEP_ORDER`, and into the
   literal list in `tests/auto-modes.test.tsx`; the sentence the add page says (`autoModesDetail`)
   gains Marginalia by derivation, and its test follows.
3. `firstOpenSearch` (`src/web/last-view.ts`) loses its `marginalia` argument; the effect that
   applies the default still waits for the experimental store's `loaded`, because that snapshot is
   also where `signedIn` comes from. Tests in `tests/last-view.test.ts` and
   `tests/first-open-default-wiring.test.tsx`.
4. Whatever else names the old state: the comment in `Dock.tsx` about the third frame, the
   command-pick catalogue if it is compared exactly, `/help` and `/features` (their *experimental*
   tag is read from the catalog), tests that assumed the toggle absent with the switch off.
5. Docs: `experimental-features.md` (the row leaves the table, with Greg's words),
   `marginalia.md`, `url-state.md`, `mode.md` if it says so, `interface-vision.md` line on gating.

## Two decisions taken here, each named so Greg can reverse it

**1. Relation words are made on import.** The add page's list is *every mode outside the switch
that makes something on a press* (`derivedAutoModeSteps`, held equal to the written list by a
test). Marginalia's press makes `relations`, so leaving the switch puts it on that list by the
existing rule. One `capable`-tier call per article, **cold**: Relations shares a cached article
with no other step (`src/models.ts`), so there is no cache discount. The one measured run was
$0.045 and 14 seconds ([261003f](261003f-marginalia-relation-words-and-timeline-events.md)). An
article too short to have turns stores an empty list without a model call. It reads no other step,
so it is a one-step job.

*The alternative*: keep it off the list with a named exception in `auto-modes.ts`, so the words are
made on the first press of the toggle. Cheaper per import. Passed over because the first-open
default below turns the column on *without* a press, which by design spends nothing, so a new
article would arrive with a margin that has no relation words until the reader turns the column off
and on again.

**2. The first-open default includes Marginalia for everybody signed in.** Greg asked for it
(`spya-ax5tmm`, plan [261005a](261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md)):
*"(if there's even more room) Marginalia mode in right-hand"*. That plan held Marginalia back for
readers with the switch off only because the mode was experimental, and left the question
`Q-marginalia-switch`, which this report answers.

## The simpler option passed over

The flag and nothing else. Then the derived-list test is red (so decision 1 has to be made one way
or the other regardless), and the first-open default would go on reading the experimental switch to
decide about a mode that is no longer experimental, with a comment saying why that is now false.

## Checked, and not changing

- **No route is gated on the switch**; nothing on the server changes except the queued list.
- **Arriving with `?margin=1` spends nothing**: `useRelations` spends through `useAutoRun`, which
  waits for a press. Unchanged.
- **The bar is one button wider with the switch off.** `dock-fit.ts` sheds labels by measured width.
- **Articles already imported** have no relation words until their owner presses the toggle; no
  backfill.

## Tests, red first

- `tests/dock-experimental-modes.test.tsx`: `marginalia` out of the list; red until the flag moves.
- `tests/auto-modes.test.tsx`: the literal list with `relations`; red until the written list follows.
- `tests/last-view.test.ts`: at 900px the default is Summary and Marginalia with no switch argument.

## Not done here

- No backfill of relation words for existing articles.
- Signed-out readers still get no first-open default (`Q-first-open-visitors` in 261005a stands).

## GPT Sol's plan review, 2026-10-05

[261005d-marginalia-plan-review-sol.md](261005d-marginalia-plan-review-sol.md). No P0; verdict
*rework*, for consequences the plan missed rather than the approach. All taken. (Four earlier
attempts returned no verdict: the model was at capacity.)

- **P1, the cost premise was false.** The plan said the call reuses a cached prefix. It does not.
  Decision 1 above now gives the full cold cost.
- **P1, the server's own test.** `tests/publication-queues-the-main-modes.test.ts` holds a second
  written copy of the queued requests; it gains `["relations"]`. `ingest-queue.md` lists the jobs.
- **P2, named tests.** Three assertions in `tests/auto-modes.test.tsx`; the switch-off toggle case
  in `tests/dock-experimental-modes.test.tsx` (now drawn, unpressed); the switch-off case in
  `tests/first-open-default-wiring.test.tsx`; the command-pick catalogue, regenerated (one line).
- **P2, a signed-out visitor's press.** `tests/public-network-trace.test.tsx` now presses the toggle
  on and then off from a bare public page and asserts nothing private and nothing but GETs.
- **P2, copy that would be false.** `/help` called Marginalia experimental; the relation-word card
  said "when you turn it on"; the mode's card said turning it on makes the pass.
- **P2, docs.** `reading-view-overview.md`, `mode.md`, `marginalia.md`, `interface-vision.md`.
- **P3, stale comments**, and `STEP_ORDER` already holds `relations`.

It confirmed: the queue is for the importing owner only and honours the opt-out; a visitor's press
arms nothing; arrival with `?margin=1` sends no job.

## GPT Sol's code review, 2026-10-05

[261005d-marginalia-code-review-sol.md](261005d-marginalia-code-review-sol.md). Verdict: approve,
no P0 or P1, after fixes of its own, which I read and re-ran the gates on.

- **P2, fixed by the reviewer.** Two doc passages still said the column was behind the switch
  (`reading-view-overview.md`, the widths table in `url-state.md`).
- **P3, fixed.** Source comments that still said the relation words are first made only by a press
  (`useRelations.ts`, `activation.ts`, `auto-run-targets.ts`, `rerun-steps.ts`, `reset-role.ts`,
  `MarginaliaColumn.tsx`, `Dock.tsx`).
- **P3, fixed.** The switch-on separator test in `tests/dock-mode-order.test.ts` passed for the
  wrong reason: it counted Marginalia's own frame as a line between runs. It now asks about the
  bands only, as the bar does.
- **P3, fixed.** Stale mode counts in test comments and a dead Marginalia exclusion.
- It tried to break the three claims (the import queue is owner-scoped and honours the opt-out; a
  visitor's two presses arm and request nothing private; the first-open default spends nothing) and
  they held. It could not run the Postgres queue test in its sandbox; I ran it, green.

## What landed

Built as planned, in one stage (`623f4793b`, then the review fixes).

- **Gates.** Typecheck green. The full suite once before the review: 7 red, 3 of them tests this
  change had to follow (fixed, then green) and 4 the fresh-worktree ones that need `npm run build`.
  After the review, the 14 affected files re-run: 421 passed. The full suite was not run a second
  time; what changed after it is comments and four test files, each re-run.
- **Browser** (Sonnet, Playwright on the box, local dev, switch off): the toggle is in the bar at
  1440, 820 and 390px and opens and closes the column; the command bar has the row; a first open at
  1440 arrives in Summary and Marginalia, at 820 in Summary alone; a signed-out reader of a public
  article has the toggle and its press opens the column with no error; `/help` and `/features` no
  longer tag it experimental. At 820 a press swaps the notes in for Summary's band, and at 390 it
  says the notes need a wider window; both are the existing narrow-window behaviour. Shots:
  `261005d-shot-2-open-1440.png`, `261005d-shot-4-fresh-1440.png`. Not checked: a real iPad or
  phone, Safari.

## Questions for Greg (not blocking)

**[Q-relations-on-import]** Now that Marginalia is a main mode, its *so / but / vs* words are made
when an article is added, like Glossary and Quotes: one more model call per article, about 4 to 5
cents on the one article measured. The other choice is to make them only the first time the owner
presses Marginalia, which costs nothing for articles nobody opens the column on, but then a new
article that opens in Summary and Marginalia by default has no relation words until the column is
turned off and on. Built: on import. Reversing it is one line and one exception in
`src/web/auto-modes.ts`.

**Decided: when Marginalia is opened** — Greg, 2026-10-05: "generate linking words when Marginalia
mode is opened". Dispatched to session `relations-on-open`.

**[Q-relations-backfill]** Articles added before this have no relation words until their owner
presses the toggle. Leave it, or make them for existing articles in one paid sweep?

**Decided: leave it** — Greg, 2026-10-05: "yes leave that for now".
