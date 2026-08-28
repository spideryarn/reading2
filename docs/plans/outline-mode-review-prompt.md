# Review request: the Outline mode plan

You are reviewing a **plan, not code** — nothing has been built yet. Repo:
`/Users/greg/Dropbox/dev/experim/spideryarn2` (Spideryarn, an AI-assisted reading app). Read-only.

## The plan

`docs/plans/outline-mode.md`. Read it in full first.

## What it is, in one paragraph

The app renders an article as a table: rows are the article's blocks in order, columns are levels of
a table-of-contents tree, and each coarse column is drawn by a fixed full-height panel that lists
that whole level with the item you are reading held on a focus line. The product owner says the
result is busy and that he cannot see the whole document structure or tell where he is in it, because
the three coarse columns are three parallel flat lists he has to fuse by eye. The plan proposes an
eighth **mode** — a single nested list of the whole document in the band between the left-hand rail
and the prose — which **never scrolls** and which spends whatever vertical room it has on the branch
of the tree the reader is currently in: the current part expands to its sections, the current section
gets its one-sentence gist, and so on down a fixed ladder until the height runs out.

## Context you should read, in this order

1. `CLAUDE.md` — the project's working agreements, and the invariant everything rests on (block ids).
2. `docs/project/granularity-zoom.md` — the core feature. Especially § The tree, § Node shape
   (the `gist` / `navLabel` distinction is a hard contract), § The tabular view, § The spine,
   § The arc, § The other view: fisheye (the 2026-08-24 sketch this plan descends from).
3. `docs/project/column-context.md` — **the most important one for this review.** It is the record of
   building the per-column fisheye three days ago: the research, the line-budget arithmetic, five
   separate bugs found only by measuring in a browser, and an explicit decision that the fisheye must
   vary *size* and never *length*. The new plan reverses that decision and argues why. Judge that
   argument hard.
4. `docs/project/summaries.md` — especially § The ladder and § Following the reader. The existing
   summary panel is the closest thing to what is being proposed and the plan claims it is 80% of it.
5. `docs/reusable/silent-success.md` — the failure mode this repo cares most about.

Relevant code: `src/web/tree.ts` (`buildSummaryTree`, `currentEntryId`, `showsChildren`,
`buildOutline`), `src/web/context.ts` (`levelList`, `landmarkLines`, the `Tier` type),
`src/web/ContextPanel.tsx`, `src/web/SummaryPanel.tsx`, `src/web/layout.ts` (`fitView`, `MODE_MIN` /
`MODE_IDEAL`), `src/web/params.ts` (`MODES`), `src/web/App.tsx` (the `inMode` dispatch, `atRow`).

## What I most want from you

Ordinary review findings are welcome, but these six are where I think the plan is weakest and I would
rather you spent your effort there than on style:

1. **Is the "reverses the size-not-length decision" argument actually sound?** `column-context.md`
   rejected per-distance line counts because entries would rewrap at every section boundary and the
   panel would glide. The plan claims that in one merged list the blast radius is small enough. Is
   that right? What cases make it wrong — a shallow tree, a very uneven branching factor, a part with
   one section, a reader oscillating across a boundary?

2. **Is the fit actually computable without measuring?** The plan estimates line counts from
   character counts at a known band width (288–400px) rather than rendering and measuring, following
   the precedent in `column-context.md § How much a landmark says` — but there the consequence of a
   bad estimate was a slightly blank column, and here it is rows pushed off a panel that cannot be
   scrolled. Is the trade still right? If not, what is the cheapest honest alternative that does not
   introduce a measure-resize-measure loop?

3. **What does this get wrong that will not announce itself?** This repo's recurring bug is a check
   that agrees with the code because it shares an assumption. Where in this design would something be
   silently wrong — a row that is never drawn, a current-node walk that disagrees with what is
   rendered, a fallback that quietly substitutes one kind of text for another? Note in particular
   that `currentEntryId` and the renderer must agree about which rows are drawn, and that
   `summaries.md` records that exact bug being caught only by review.

4. **Does the ladder spend the space in the right order,** and is "leftover space stays blank"
   defensible? The rungs are: all parts → current part's sections → current section's gist →
   current section's paragraphs → the arc sentence → stop.

5. **Is this the right place for the feature at all?** The plan's own § Why this is not something we
   already have argues against three existing surfaces. The cheaper alternative it rejects is adding
   a fourth rung to summary mode's existing `LENGTH` control instead of an eighth mode. The product
   owner explicitly chose the eighth mode so he can compare — but tell me if the plan is wrong that
   the two are meaningfully different, or if there is a fifth option nobody has named.

6. **What is missing from the plan entirely?** Accessibility, touch (`docs/project/touch.md` — this
   app is mostly used on an iPad), the URL-state rules (`docs/project/url-state.md`), what a visitor
   who does not own the article sees (`src/web/visitor.ts`), the interaction with the rail being
   narrowed in parallel (`docs/plans/spine-rail.md`), or anything else it has not thought about.

Please be specific and concrete: name the file, the function, the article shape, or the window size
that breaks each thing. If a finding is a matter of taste rather than a defect, say so.
