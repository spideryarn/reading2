# Summary writes itself when you open it (7T), and why Parts & Sections stay at import (7V)

Overseer queue item `qi-z57nm25x`. Two suggestions from Greg, filed 2026-10-01 on production build
`7aaead6d`:

- **SPIDERYARN-READING2-7T** (`spya-x0pvsh`)

  > When I open any of the Summary submodes, if they haven't already been generated, automatically
  > kick off the generation. In other words, don't require me to press a button to trigger the
  > generation.
  >
  > And update new-mode.md accordingly - opening a mode should always trigger generation if it
  > hasn't happened already.

- **SPIDERYARN-READING2-7V** (`spya-qxufp9`)

  > It looks as though we generate the Summary-mode Parts & Sections automatically on article
  > import.
  >
  > Do we need to do that? Could we defer generating them until they're needed (e.g. if the user
  > clicks on the Summary mode or anything else that depends on them?
  >
  > If that's going to substantially complicate things, stop and let's discuss.

## Where things stand (origin/dev at `d5addd8c`)

- Summary's Parts & Sections went on 2026-10-01 (fb7q-7r,
  [261001p](261001p-summary-loses-parts-and-sections-a-touch-wider.md)). Summary is now only the
  three plain-words levels (Brief, Simple, Fuller), all written by one `simple` job.
- Pressing **Summary** on the bar arms nothing (`MODE_TARGET.summary` is `none`,
  `src/web/activation.ts`). The band opens on an empty state with a **Write it** button. The
  band's own slider and the command bar's three sub-mode rows already arm `simple` and the band's
  `useSimple` → `useAutoRun` claims it — so the machinery is all there; only the bar press is
  missing.
- `docs/project/new-mode.md` was renamed `mode.md` (spya-ucu35y). It already says
  *"Opening it for the first time starts it"*; Summary is now the one artefact mode that breaks it.

## 7T — what we build

**One row.** `MODE_TARGET.summary` becomes `{ kind: "fixed", target: "simple" }`. So:

```
press Summary on the bar ─► armActivation(slug, "simple") ─► band mounts ─► useSimple/useAutoRun
                                                                             claims the token
   nothing stored ──► posts the `simple` job, shows its progress (no "Write it" to press)
   already stored ──► the token is spent on nothing; the level is shown
```

Everything else follows from it, with no second edit:

- **Command bar** marks the Summary row `generates` (`modeGenerates` reads `MODE_TARGET`).
- **`bandTarget`'s Summary special case goes**: the `fixed` row answers `"simple"` for itself.
- **Add page's "Generate the main modes" box now includes Summary**, because `auto-modes.ts`
  derives its list from `modeStep`, which reads `MODE_TARGET`. This is the spend question the
  Overseer handed over. **Chosen: include it.** Greg's own list in 5Y named it (*"it'll
  automatically generate the structure and the summary and the quotes and ideas…"*), and the rule
  he asked for in 7T says a mode you will open is a mode that will be generated anyway. Cost: Simple
  is on Opus, about **$0.10 warm / $0.18 cold** per article
  ([summaries.md](../project/summaries.md)), on top of the box's ~$0.31.
- **Arriving does not spend**, unchanged: a restored `?mode=summary` arms nothing, as for every
  other mode (`useAutoRun` needs an armed token). So a remembered view, a shared link or a visitor
  costs nothing. Greg's words are about opening, and the press is how one opens.
- **Visitors**: a visitor's band has no `useAutoRun` to claim with (SummaryMode.tsx § visitor).
  **But the press still armed a token** — true of every mode before this change, not new with it
  (GPT Sol's plan review, P1). Unclaimed, the token waits; a reader drawn as a visitor for a moment
  (a private read that came back 401) could later claim it as the owner and spend on what was only
  an arrival. **Fixed here for all modes**: the Dock's `useActivateMode` / `useActivateSubMode` arm
  only when the reader is not a visitor. Red-first in `tests/command-bar.test.tsx`.

The **Write it** button stays in the empty state, for the case where a press did not arm (a
restore, a link) — and as the retry after an automatic run that failed, since `useAutoRun` makes one
automatic attempt per slug and session (Sol P2).

**Found in the browser check:** while the press's own run was starting, the empty state still said
*"Nobody has asked for a plain-words version of this piece yet"* beside *"Writing it in plain
words"*. That line now hides while a job is running (`SimplePanel.tsx`, red-first in
`tests/simple-panel.test.tsx`).

### Tests (red first)

- `tests/every-mode-draws-its-surface.test.tsx` § `SPENDS`: `summary` becomes
  `{ kind: "posts", steps: ["simple"] }` — red until the row changes, since the test presses the
  bar and counts posts.
- `tests/command-bar.test.tsx` § `GENERATES`: `summary: true`.
- `tests/auto-modes.test.tsx`: the pinned list gains `simple`.
- `tests/modes-that-start-themselves.test.tsx` if it enumerates modes.

### Docs

- `mode.md`: the "Opening it for the first time starts it" bullet says **always**, in Greg's
  words, and names the only exceptions — modes with nothing to fill until the reader has written
  something (Search, Chat, Referee's Criteria, Remember's Recall), and arrival without a press.
- `summaries.md`, `reading-view-overview.md` if they say the press arms nothing.

## 7V — why Parts & Sections are not deferred

The Parts & Sections were never Summary's own: they are the **Hierarchy stage's gists**, the
summaries on each node of the one tree
([granularity-zoom.md § The tree](../project/granularity-zoom.md#the-tree)). That tree is read by
Structure, the Masthead, the shelf entries, hover cards, Diagram, Debate and the reading position
down the spine. In principle the tree could be cut first and the gists written later; in practice
one hierarchy call writes both, a final tree without gists fails validation, and the heading-only
provisional tree is unfinished infrastructure the pipeline cannot yet publish
([hierarchy.md](../project/structure-step.md); Sol's plan review, P2). So deferring the gists means
splitting the Hierarchy stage, or deferring it and giving every surface that reads the tree an
"article with no tree yet" state — the thing 260930c deferred as its own plan. That is the "substantially complicate things" Greg asked to be
told about, and he has since answered it himself:

> if they are the same data that we need for Structure mode, I guess we still need to do the AI
> processing for them.

So 7V ends **Declined**, with that reason. Two things already address what he was after:

- **Bulk import's minimal papers** (261001m) skip Hierarchy entirely until *Read this* — a
  deferred-tree route for when you import many papers.
- **The thinking-effort eval** (261001p-thinking-effort-vs-quality…) is testing whether Hierarchy
  needs its `high` effort, which is the likelier saving on every import.

## Simpler option passed over

Leaving the bar press alone and making the band auto-start on *mount* when empty. Rejected: that
would also spend on arrival (a restored view, a shared link), which is exactly what
`useAutoRun`'s press-then-claim rule exists to stop
([reading-view-overview.md § True across the whole view](../project/reading-view-overview.md#true-across-the-whole-view)).

## Deferred

- Which level opens first (Brief vs Simple) — fb8n's item.
- Opening an article before its tree exists — 260930c's deferred plan.
