# Summary loses Parts & Sections, and gets a touch wider

Up: [summaries.md](../project/summaries.md) · reports spya-fc0h87 (7Q), spya-wequmw (7R),
spya-b3ggv4 · Overseer queue item qi-sv4fy24q

## What Greg asked

> Make the Summary mode column ever so slightly wider (if on a wide screen)
>
> — Greg, 2026-10-01 (SPIDERYARN-READING2-7Q)

> In the Summary mode UI at the top, somehow indicate with the UI that *either* we're in
> Parts/Sections submode, or we're in simple-summarised-text submode. … And get rid of the "Simple"
> text - perhaps replace with an icon or similar.
>
> — Greg, 2026-10-01 (SPIDERYARN-READING2-7R)

and later the same day, which replaces the first half of 7R:

> I'm looking at the summary mode, and I think actually getting rid of parts and sections is
> probably the way forward. It was an experiment, and it's just not working that well. We already
> have the structure mode, and so I think that probably overlaps with the summary parts and
> sections, and so let's just get rid of parts and sections.
>
> So that just leaves the slider that ranges from sort of brief to fuller summaries. So we can
> altogether get rid of all of the machinery that does those parts and sections summaries.
>
> — Greg, 2026-10-01 (spya-b3ggv4)

> if they are the same data that we need for Structure mode, I guess we still need to do the AI
> processing for them. But we don't need to show them as we do in Summary mode.
>
> — Greg to the Overseer, 2026-10-01

## What changes

```
 before                                        after
 [ Parts | Sections ]  ○──●──○ Simple  ⓤ       ▤ ○──●──○ ▤▤  ⓤ
 the outline, or the paragraphs                the paragraphs, always
 band 288–400px                                band 288–448px (wide windows only)
```

1. **The outline goes from Summary.** The Parts | Sections pills, the nested gist outline in
   `SummaryPanel.tsx` (its open/closed sets, `+N` badges, follow-the-reader scroll), its CSS, and
   `?deep=`. `?summary=` keeps only the three plain-words levels; its default is `simple`, the stop
   the slider rests on today. An old link saying `?summary=gists` or `?deep=2` lands on Summary at
   that default, because the parsers already degrade an unknown value to the default.
2. **The slider is always live.** It had an idle, faint state while the outline showed. Now there is
   nothing else in the mode, so it is always on.
3. **No "Simple" text.** The level's name beside the slider goes; a small icon sits at each end
   (short text on the left, longer text on the right), the tooltip names the three levels, and
   `aria-valuetext` still names the current one for a screen reader. Icons chosen from Sonnet's
   web research (below).
4. **A touch wider on a wide window.** A fourth band shape, `roomy`, for Summary only: the same as
   the standard band but capped at 28rem (448px at a 16px root) instead of 25rem (400px). It only
   grows once the prose has its 544px, so laptops below ~1000px and phones are unchanged.
   `Reader.tsx` picks the band shape in two places with the same ternary; that becomes one
   `bandShapeFor(mode)` in `layout.ts`.

## What is kept, and why

- **The gists, the Hierarchy stage, and `buildSummaryTree`.** Structure, Outline, Masthead, the
  shelf, hover cards, Diagram, Debate and the graph all read them. Nothing in `src/hierarchy*.ts`
  changes.
- **`TreeNode.question`** (the Socratic question on the root and the parts). Summary's outline drew
  it, but Marginalia reads it too (`mode-catalog.ts` § marginalia), so it stays generated.
- **`showsChildren` / `currentEntryId` in `tree.ts`**: kept if anything besides `SummaryPanel`
  calls them; removed with their tests if not. Decided by grep during the build, recorded in the
  commit.
- **The bar's Summary press still arms nothing.** Opening Summary on an article with no plain-words
  version shows the existing empty state ("Write it"), as the slider does today. Whether opening
  should start the run is 7T/7V's queue item (fb7t-7v), and which level opens first is 8N's
  (fb8n); both were told to merge this first.

## The simpler option passed over

Keep `SummaryPanel.tsx` as a thin shell around the slider and paragraphs, deleting only the outline
branch. Rejected: the shell would be a component whose only job is to wrap one child in
`ModeSurface` and a row, with props (`root`, `deep`, `atRow`, `onDeep`) nothing passes any more.
The band in `SummaryMode.tsx` draws `ModeSurface` itself instead, and `SummaryPanel.tsx` is deleted.

## Deferred, and not by accident

- **Summary is no longer free on arrival.** It was the gist outline, already written; now an
  article whose owner has never pressed shows an empty state, and a visitor sees "Nobody has made a
  plain-words version". That is what Greg chose; generating on open is fb7t-7v's question.
- **8F (Brief a little shorter)** is fb8m-8f's, agreed with the Overseer 2026-10-01, so the Brief
  prompt is not touched here.

## Stages

1. **Remove the outline, always-live slider, end icons.** Red first: a test that Summary's band
   renders no Parts/Sections controls and lands `?summary=gists` on a plain-words level. Then the
   cut: `SummaryPanel.tsx`, `summary-expand.test.tsx`, `summary-question-replaces-gist.test.tsx`,
   the outline half of `summary.css`, `deepParam` and `MIN/MAX_SUMMARY_DEPTH`, the `gists` value,
   `last-view.ts`'s `deep` key, `activation.ts`'s `gists` branch, and the catalog, the features
   tile and `sub-modes.ts` wording.
2. **The roomy band.** Red first in the layout tests (Summary at 1440 wide gets 448, at 1000 the
   same as the standard band), then `bandShapeFor`.
3. **Docs.** `summaries.md` rewritten around the slider, the outline's history cut to a paragraph
   and pointers into git; `reading-view-overview.md`'s Summary line; `granularity-zoom.md` and any
   doc that sends a reader to Summary's outline.
4. **Browser check**, desktop 1440 and 390px phone, owner and visitor, `?summary=gists&deep=2`.

GPT Sol reviews this plan before stage 1, and the built code before the push.

## GPT Sol's plan review, and what changed

[261001p-summary-loses-parts-and-sections-plan-review-sol.md](261001p-summary-loses-parts-and-sections-plan-review-sol.md).
No P0s. Each finding checked against the code:

- **P1, "Generate the main modes" skips Summary** (`modeStep` reads `MODE_TARGET`, which says
  `none`). True, and already true before this change: the checkbox never wrote the plain-words
  levels. Now that Summary is nothing but them, the add-page promise is thinner than it reads.
  **Deferred to fb7t-7v** (Summary: generate on opening, and maybe not at ingest), because whether
  Summary spends on arrival or at ingest is exactly that item's question; told via the Overseer.
- **P1, old `?deep=` links**: deleting the key from `last-view.ts` would let a remembered view be
  restored over an incoming legacy link. **Taken**: `deep` moves to `NEVER_REMEMBERED`.
- **P1, the width arithmetic**: the roomy band grows from 957px and reaches 448px at about 1004px,
  so the "unchanged at 1000px" example was wrong, and a bare 28rem cap is narrower than standard at
  a 12px root. **Taken**: the cap is `max(MODE_IDEAL, 28rem)`, as the wide band does, and the test
  pins 950px (unchanged) and 1440px (448px).
- **P1, more tests pin the outline**: mode-surface-changes-no-markup, simple-panel,
  pressing-a-chip-arms-it, public-network-trace, every-mode-draws-its-surface, last-view,
  command-bar-sub-modes. **Taken**, each rewritten to the new behaviour rather than deleted where it
  still guards something.
- **P2s, all taken**: add `roomy` to layout-margin.test.ts's shape sweep; one `bandShape` value fed
  to both `fitView` and `notesFit`; `visitor.ts`'s explanation updated (the policy stays
  `available`); `subModeParams()` clears `?summary=` for the new default `simple`; `bandTarget`
  returns `simple` for Summary unconditionally.
