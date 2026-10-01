# The command bar lists sub-modes

Reports: SPIDERYARN-READING2-77 (spya-r7d6dz), overseer queue qi-dswgrget.

> In the Command bar, include sub-modes, e.g. Quiz mode, Illustrated diagram, etc.
>
> — Greg, 2026-10-01 (from `/read/dongetal25-spya-vfmvmm?mode=remember&remember=quiz`)

## What exists

The bar (`src/web/CommandBar.tsx`, ranking in `src/web/command-match.ts`) has three kinds of row:
`mode`, `page`, `action`. A mode row opens a mode exactly as its Dock button does
(`Dock` § `useActivateMode`: arm through `armActivationForMode`, then the Reader's `onMode`). It
cannot reach a sub-mode, and `src/mode-catalog.ts` says so in so many words on Remember's aliases:
*"`quiz` would name a destination and then not go there. It comes back when a command can encode
`{ mode: "remember", remember: "quiz" }`, and not before."* This is that day.

Four modes have sub-modes, each a query parameter and each with its own chip control:

| Mode | Param | Sub-modes | Chip arms (gesture seam) | Labels live in |
|---|---|---|---|---|
| Remember | `?remember=` | Recall, Quiz | Quiz → `quiz` | literal in QuizPanel.tsx |
| Diagram | `?diagram=` | Force, Drift, Trail, Sketch, Illustrated (all but Sketch experimental) | Sketch, Illustrated | `KIND_UI` in DiagramPanel.tsx |
| Referee | `?referee=` | Criteria, Claims, Mirror, Candidates | Claims, Candidates (`REFEREE_TARGET`) | `REFEREE_VIEW_LABEL` in RefereeMode.tsx |
| Summary | `?summary=` | Brief, Simple, Fuller (plus the outline, `gists`, which has no control of its own since today) | every level → `simple` | `PLAIN` in SummaryMode.tsx |

There is **no single sub-mode registry** today — the brief assumed one. The labels are four private
tables in four React files, and the arming rule is four inline calls.

## What we'll build

1. **`src/web/sub-modes.ts`, a pure registry** (no React, no nuqs value imports — command-match.ts
   must stay pure). A discriminated union

   ```ts
   type SubMode =
     | { mode: "remember"; view: RememberView }
     | { mode: "diagram"; view: DiagramKind }
     | { mode: "referee"; view: RefereeView }
     | { mode: "summary"; view: SimpleLevel };
   ```

   with one total `Record` per mode giving each sub-mode its **label**, a one-line **description**
   for the bar, and (Diagram only) whether it is **experimental**. The four panels' label tables
   move here and the panels import them, so the chip and the bar row cannot be called different
   things. `KIND_UI` keeps its icon, blurb and `how`, and reads its label and experimental flag
   from the registry. Also here: `subModeParams(sub)`, the query-string writes a sub-mode is
   (`{ mode, remember: "quiz", thread: null }` — Remember's rule 1, thread cleared on the way to
   Quiz, in the same write), so the reading view and the off-view href cannot disagree.
2. **activation.ts answers the money question for a sub-mode**, as it does for a mode:
   `armActivationForSubMode(slug, sub)` and `subModeGenerates(sub)` from one table, delegating to
   the rules that already exist (`activationForDiagram`, `REFEREE_TARGET`, `"quiz"`, `"simple"`). A
   Diagram sub-row says `generates` for all five pictures, for the reason `modeGenerates` gives for
   the delegated row (Force/Drift/Trail buy an embedding on mount). The chips keep their own calls,
   which already read the same tables; a test holds that the row's target is the one the mounting
   band claims (`bandTarget`).
3. **A fourth `Command` kind, `submode`**, carrying only its `SubMode` (like a mode row carries
   only its `Mode`). `commandText` builds its words from the registry: label = the sub-mode's
   label ("Quiz"), aliases = the parent mode's label and the sub-mode's own (so typing `diagram`
   lists them under the Diagram row, and `quiz` puts Quiz first), description from the registry.
   `commandId` = `submode:<mode>:<view>`. Drawn with the parent's name as a muted prefix
   (`Remember › Quiz`), and `data-kind="submode"`.
4. **Which sub-rows appear**: only those whose parent mode is in the `modes` prop (so the
   experimental switch and the Dock still decide, by construction), and for Diagram only the
   pictures `shownBehindTheSwitch` would show with the switch's value — so `CommandBar` gains an
   `experimental` prop from the Dock. Order: all mode rows, then sub-mode rows in parent Dock order
   and the chip order within each, then pages and actions. That keeps "the mode rows are exactly
   what the Dock lists, first" intact.
5. **Enter on a sub-row** — `Dock` § a new `activateSubMode` beside `activateMode`:
   - reading view: `armActivationForSubMode(slug, sub)`, then `onMode(sub.mode, sub)`. The
     Reader's `onMode` keeps every side effect it has (herald, band back, rail, trajectory arm) and,
     when given a sub, writes `mode` and the sub's params in **one** `useQueryStates` push, so one
     Back undoes it. It does **not** call `armActivationForMode`: the mode's own press would arm the
     picture `?diagram=` currently says, not the one the row names — the exact orphan-token bug
     `activationForDiagram`'s docblock walks through.
   - Metadata page (no `onMode`): `navigate` to the article href with those params, arming nothing,
     as the mode rows there already do.
6. **Aliases**: drop `simple` from Summary's aliases (it opened the outline, not Simple — there is
   now a row called Simple), and rewrite Remember's `quiz` comment to say the row exists.
7. **Docs**: reading-view-overview.md § The command bar gets a paragraph; CommandBar.tsx header
   gets the 2026-10-01 widening under call 1.

## Simpler options passed over

- **Aliases only** (`quiz` → Remember row): refused already in mode-catalog.ts — a word that names a
  destination and does not go there.
- **Rows as `page`s with an href** (`?mode=remember&remember=quiz`): no new kind, but `navigate`
  scrolls the window to the top, skips the Reader's `onMode` side effects, and arms nothing, so
  Enter on *Illustrated* would land on an empty state saying "press to draw" — a press that did not
  count as a press. Off the reading view it is exactly what we do.
- **Sub-rows interleaved under their parent mode**: reads nicer when browsing the empty-query list,
  but breaks "modes first, in Dock order" that tests/command-bar.test.tsx holds and the ranking tie
  rule leans on. The muted parent prefix carries the grouping instead.
- **Leave the label tables where they are and copy them**: one fact in two places, the drift this
  repo keeps paying for.

## Not in scope

Summary's outline (`gists`) gets no row: it has no control of its own since today (pressing Parts
or Sections chooses it), and the Summary mode row is the way there. Search's matcher, Quotes' rank,
Glossary's sort and the like are orderings within a mode, not sub-modes.

## Review record

GPT Sol on the plan, 2026-10-01 ([review](261001d-command-bar-lists-sub-modes-review-sol.md)):
*proceed with changes*, no P0. What changed:

- **P1-1, Force/Drift/Trail spend on mount, not on a press.** True and pre-existing
  (activation.ts § `activationForDiagram` names it; Back or a pasted link reaches them too). A
  sub-row press does not make it worse — it is a press — and the rows wear `generates`. Named here
  rather than fixed: closing it is the useSimilar/useProjection gates, not the bar.
- **P1-2, the activation tests.** Split as suggested: `subModeGenerates` is "may do paid work"
  (all of Diagram), and the test that matters is that `subModeTarget` equals `bandTarget` for the
  band that mounts, for every sub-mode — `ModeBoundary` retires exactly that.
- **P1-3, Diagram's "plus the current picture" rule.** Taken: the bar gets the degraded
  `?diagram=` the Dock already computes, so with the switch off and `diagram=trail` open, Trail is
  offered where the chip is. Tested on the reading view and the metadata page.
- **P1-4, what counts as a sub-mode.** The repo has called Quotes' orders and Search's views
  sub-modes too. **Decision: this ships the controls that replace the whole band** (the four
  above), because those are Greg's two examples and what a reader would "go to". Quotes' rank and
  Search's Words | Meaning are left out and named in the feedback note as a possible follow-up
  for Greg, not silently dropped.
- **P2-5, compound names.** Taken: each sub-row also answers to *Illustrated diagram*, *Diagram
  Illustrated* and *Illustrated mode*, so Greg's own phrasings match.

GPT Sol on the built code, 2026-10-01 ([review](261001d-command-bar-lists-sub-modes-code-review-sol.md)):
no P0/P1. It fixed two P2s in place. Defaults are now written as *remove* on both paths, as nuqs
does, so the metadata link no longer spells out `remember=recall`. And a Reader-shaped nuqs
harness now proves one `pushState` and one Back, where the tests had stopped at a mocked `onMode`.
It also mutated the Diagram row to arm the current picture, and both tests went red.

Browser check (Playwright, local, experimental on and off): Quiz and Simple open in one history
entry and Back undoes them; sub-rows sit between modes and pages; no overflow at 390px; gating
right with the switch off.

## Stages

1. Registry + activation + panels read labels from the registry (no behaviour change). Tests: the
   registry is total and the panel chips draw the registry's labels; `subModeGenerates` agrees with
   what each chip arms.
2. The `submode` command kind, ranking, rendering, Dock/Reader wiring. Tests first (red): typing
   `quiz` offers *Remember › Quiz* first; Enter on it pushes `mode=remember&remember=quiz` with no
   `thread`, arms `quiz`; Enter on *Illustrated* arms `illustrated` not `sketch` when `?diagram=` was
   `sketch`; experimental off hides Remember/Referee rows and Diagram's Force/Drift/Trail/Illustrated;
   Metadata page navigates and arms nothing; `generates` marker on Quiz, absent on Recall.
3. Docs, browser check (Sonnet subagent, Playwright on the box), GPT Sol code review, push.
