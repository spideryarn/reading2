# Structure goes one level deeper where the article does

Started 2026-10-29, for feedback `spya-pn7gvw` (Greg, admin, suggestion). Worktree
`fbpn7gvw-structure-one-level-deeper`. Up: [structure.md](../project/structure.md).

**Status: stage 1 (the reading view copes with a deeper tree) is the work for tonight. Stage 2 (the
structure step makes one) waits on two things: Greg's answer to
[q-vrnbyj](../user-feedback/questions/q-vrnbyj.md), and the box's OpenRouter key, which is over its
monthly limit until 1 November, so no prompt can be measured before then.**

## What Greg asked

> I sometimes think that structure mode should actually go even more detailed, so perhaps even one
> more level of hierarchy. I think there are potentially a bunch of problems with this. One is that
> it'll make it slower and more expensive. Another is, just visually and in the UI, would it fit?
> Would it need a third column? How would we decide when it's justified or needed? I suppose one
> option for that would be for the user to be able to request an extra level of hierarchy. And as
> for the third column, you know, maybe we display it if there's the extra level of hierarchy and if
> the page is wide enough. Otherwise it would just show the first two or something. But if we take
> this article as an example, and you're welcome to look at it, I'm in the section of other theories
> of consciousness, and I'd quite like to see, at the very least, each of them have their own
> section. Maybe even more detail than that.
>
> — Greg, 2026-10-29, `spya-pn7gvw`, on `arxiv-2308-08708-spya-xax6v4` in Structure, Expanded

## What he saw, read from production

The tree is root → parts (depth 1) → sections (depth 2) → one leaf per paragraph, because the prompt
says *"Go 3 levels deep"* and the output schema cannot express anything deeper
([`src/structure.ts`](../../src/structure.ts) § `STRUCTURE_OUTPUT_SCHEMA`). On this paper (667 blocks,
38,412 words, `toc/12`, Sonnet 5.5):

| section | paragraphs | words | the author's own sub-headings inside it |
|---|---|---|---|
| 2.4 Other Theories and Conditions | 76 | 7,131 | 2.4.1 Attention Schema Theory · 2.4.2 Predictive Processing · 2.4.3 Midbrain Theory · 2.4.4 Unlimited Associative Learning · 2.4.5 Agency and Embodiment ((a), (b), (c)) · 2.4.6 Time and Recurrence |
| 3.1 Implementing Indicator Properties in AI | 48 | 5,226 | five, 3.1.1–3.1.5 |
| 1.2 Methods and Assumptions | 34 | 3,321 | three |
| 2.1 / 2.2 / 2.3 (one per theory) | 21–27 | 1,417–2,360 | three each |

So the sub-sections Greg wants are already in the article, marked by the author with `h4`s, and the
model is shown those tags (`renderBlocks` prints `<h4>`); it has nowhere to put them.

**A second defect, separate from depth:** the author's `h3` "2.5 Indicators of Consciousness" is
inside the model's section 2.4 instead of starting its own, although the prompt calls the author's
headings hard boundaries. Across production it is not rare — see below.

### How common, across production

Read-only, the 67 articles with a finished tree created in the last 60 days (script in the session's
scratchpad, not committed):

- 1,950 sections; **141 hold two or more author sub-headings, in 30 of the 67 articles**; median 3.
- 207 sections are "fat" (10+ paragraphs and 800+ words, 260904d's measure); 71 of those have
  author sub-headings, so 136 fat sections would need the model to find its own joins.
- **150 author headings at the same level as their section's own heading sit inside a section, in
  26 articles** — the swallowed-2.5 shape. Some of these may be deliberate merges of very short
  headed stretches (the 5–9 children target pulls that way), so this is an upper bound, not a count
  of bugs.

### What it costs today

From production's ledger: this paper's `structure` call cost **$0.22 and took 22 s**, with 2,742
output tokens; its `labels` step $0.42. Median `structure` call over the last 30 days (30 articles):
**$0.15, 31 s**; p90 $0.37, 62 s.

## The prior work, and why this is smaller than it

[260904d](260904d-deepen-fat-sections.md) built an adaptive **deepening wave** — scoped extra calls
per fat section — which is in the code and switched off (`SPIDERYARN_DEEPEN_STRUCTURE`). It stopped
at stage 5b: on a book it made the step slower than its lease. Its own stage 1 measured the simpler
thing, **a conditional fourth level asked for in the one whole-document call**, and found it works
on articles and mid-size books, and named it as the fallback (§ Alternatives considered). That is
this plan's stage 2. The waves stay off; they are for books.

Its reader-side idea survives too: **a column is a frontier, not a depth.** A printed table of
contents is ragged, and a reader reads "this chapter has sub-sections" as information.

## Product choices, and where they went

Two are Greg's, in [q-vrnbyj](../user-feedback/questions/q-vrnbyj.md) with mockup
[m-pe3zds](../mockups/m-pe3zds.md). Recommendations, both agreed with Opus while thinking:

1. **When the extra level is made.** Recommended: **automatically, in the one structure call**, and
   only where the article earns it — first where the author's own sub-headings divide a section,
   then where a long section (roughly 10+ paragraphs and 800+ words) has clear topic shifts; never a
   short section. Estimated +$0.01–0.03 and a few seconds on an article that gets it (a few hundred
   to ~1,500 more output tokens on a call whose bill is mostly input), nothing on one that does not.
   **Not recommended: on the reader's request.** A request re-cuts a tree that other things hang off:
   the paragraph labels are made again (≈ $0.40 here), the modes built from the old tree read as out
   of date, positional node ids move, and the reader waits 10–30 s at the moment they asked.
2. **How Structure shows it.** Recommended: **no third column; column B opens the current section's
   sub-sections under it**, as the list face already does with depth. Works at every width the
   columns are drawn at. Greg's own idea, a third column from roughly a 1,460px window, is the
   alternative: a third layout to fit, measure and ribbon, seen only on wide screens, and at laptop
   widths Fisheye would show nothing new. Revisit if column B visibly crowds.

**Not a choice: old articles stay as they are** ([principles.md § 1](../project/principles.md)). The
question offers re-running this one paper's structure once stage 2 lands (≈ $0.65 with its labels),
which is a production write and so Greg's to say yes to.

## Stage 1 — the reading view copes with a ragged tree (tonight; no model call)

Needed whichever way Greg answers, because both ways end in a tree where some sections have
sub-sections and their neighbours do not. Today nothing makes such a tree, so nothing a reader sees
changes: **every test that holds today's output must hold bit-for-bit on today's trees.**

What breaks on a ragged tree (a read-only survey of the code, 2026-10-29):

- **`sectionDepth = leafDepth - 1`** ([`src/web/position.ts`](../../src/web/position.ts)) is one
  number for the whole article. One deepened section makes it 3, and everywhere else depth 3 is the
  paragraphs: `?at=` becomes paragraph-granular, Quiz's "where to look again" drops questions,
  the return chip and block-link card lose their section, and ← / → steps paragraphs.
- **Both Structure faces treat a section's children as paragraphs**: `structureProjection`'s
  paragraph rung ([`src/web/structure.ts`](../../src/web/structure.ts)) and the Fisheye list's
  ([`src/web/outline.ts`](../../src/web/outline.ts)). Sub-sections would be drawn as paragraph rows,
  never current, with no gist, and their paragraphs unreachable.
- **Expanded recurses correctly** but clamps rows at `lvl-3`, which the stylesheet draws as a
  paragraph.
- **`buildGeometry` is not fine** (Sol, PR-3): on an undeepened branch of a globally deeper tree,
  the leaf lands in an intermediate column with `continuation: false`.
- Fine already: the tree invariants and validation (per node, no depth cap), `labels.ts`'s sibling
  sets, the arc, the spine (L1/L2 only), Diagram (`MAX_DRAWN_DEPTH = 2`, deeper is simply not
  drawn), counts, questions, Marginalia.

The changes, as revised after Sol's plan review
([261029a-plan-review-sol.md](261029a-plan-review-sol.md)):

1. **"Section" keeps today's meaning everywhere outside Structure** (PR-1, PR-2). The reading
   position (`?at=`), Quiz's "where to look again", the return chip, block-link cards and the crumbs
   go on using the section level: `sectionDepth` becomes `max(1, min(leafDepth - 1, 2))`, so a
   sub-section is inside its section, never a section of its own. Identical to today on every tree
   production can hold (the prompt cannot go past depth 2 and the deepening wave is off); it differs
   only on a uniformly deeper tree, which exists in tests alone, and the commit says so. So a saved
   `?at=` URL means what it meant, and the URL does not start churning inside a deepened section.
2. **Structure gets its own, finer list: the frontier.** `structureFrontier` starts with the section
   level and replaces it with the deepest internal node below it where one exists, never the root;
   supplements are collapsed as `navigableItems` does. It feeds Structure's "you are here"
   (`useColumnContext` while Structure is open) and
   Structure's ← / →, passed as explicit start rows rather than a depth. On a uniform three-level
   tree it equals the section list (a test proves it over every fixture). Five shapes tested:
   ordinary, root-only, a part with leaves directly under it, supplement, provisional. It is the
   section list on every one of today's shapes, including the shallow part's section-level leaves.
3. **`buildGeometry`: a leaf is real only in the leaf column** (PR-3); in any column between its
   parent and the leaf column it is a continuation. Mixed-depth and supplement geometry tests.
4. **The list (Fisheye).** The floor grows by one rung: every part, the current part's sections,
   **the current section's sub-sections**, and the gist of the deepest current node. 261003k
   deferred exactly this ([§ Not in this change](261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md#not-in-this-change)).
   The paragraph rung, where it is drawn, hangs off the deepest current node.
5. **Expanded** draws sub-sections at a fourth level with their gists, styled as sections, not
   paragraphs (a new indent level in `outline-mode.css` and `structure-mode.css`; `paragraph` is
   a flag on the row, not a depth). This is the view Greg was in.
6. **Two columns: unchanged in this stage, except that the paragraph rung only ever lists leaves**
   (a guard; it is not reached at the shipped rung). Opening sub-sections under column B's current
   section is the part that depends on Greg's layout answer, and Sol's PR-4 shows it is not a small
   splice: the panel measures and windows one flat list, so a sub-section run could be cut in half
   or take rows from the sections. When it is built, the current section and its sub-sections are
   one measured unit, windowed as a unit, with a count in its place when it does not fit, and the
   section's card withheld only when the whole unit is drawn.
7. **Tests**: one ragged fixture with this paper's shape (titles only, made-up gists — no prose),
   through `buildSections`, the frontier, `buildGeometry`, keynav, quiz-sections, the list and
   Expanded projections and their panel; and the identity tests in 1 and 2, each seen red first.

**Done**: `npm test`, `npm run typecheck` green; a Sol code review; a Sonnet browser check on a
local article whose tree a scratch script deepens by its own headings (local database only), at
1,280 px and on a 390 px phone, light and dark, in Fisheye and Expanded. Docs: structure.md,
granularity-zoom.md § the tree (ragged depth is allowed).

## Stage 2 — the structure step makes the level (after 1 November, after Greg's answer)

If Greg picks "automatically" (recommended):

- **Schema**: `depth2Schema` gains optional `children` of a new `depth3Schema` (title, gist, start,
  sourceHeading) — the same shape depth 1 already has. Optional, as depth 1's is, so a section with
  none is an ordinary answer.
- **Prompt** (`PROMPT_VERSION` bump; `tests/structure-whole-document-request-parity.test.ts` pins the
  string): *go a fourth level (sub-sections) only inside a section the author's own sub-headings
  divide, or one longer than ~10 blocks with clear topic shifts; never split a short section*; gist
  length for depth 3 the same as depth 2's band; no questions below depth 1 (unchanged).
- **Heading precedence, stated outright** (Sol PR-6, PR-7): an author heading at the same level as
  the headings that start a section's siblings starts a sibling section; a deeper one starts a
  sub-section; an author heading beats the 5–9 fan-out target and the short-section floor. "Never
  split a short section" applies only to joins the model invents. A post-build count of swallowed
  same-or-shallower headings goes on the run and in the eval.
- **The headings fallback stays three levels** (Sol PR-5: production's fallback is
  `buildBoundedHeadingTree`, whose batching guarantee depends on its shape). A fallback tree is
  provisional and rare; deepening it is a later change if ever.
- **Measure before shipping**: this paper, the 13 articles of 260904d's corpus or a fresh sample of
  production articles' blocks, and one book; per article cost, latency, how many sections deepened,
  how many short sections were split at model-invented joins (target: none under 10 blocks), and
  heading-driven splits counted separately; and the swallowed-heading count before and after.
  Two runs each for stability. Ship only if the median article's `structure` call grows by less than
  ~20% in cost and time.
- Then, with Greg's yes, re-run this paper's structure in production (≈ $0.65 with labels).

If he picks "on request" instead, stage 2 is the deepening wave's scoped call behind a Structure
button, and this section is rewritten first.

Queued for the Overseer to pick up after 1 November: `overseer-queue.ts` item naming this plan.

## Not in this change

- **A third column** — unless Greg chooses it.
- **The adaptive deepening waves** (260904d stages 6–8) — books, not articles.
- **A fifth level**, and any backfill across the shelf.
- **Splitting a swallowed same-level heading mechanically** — the new section would need a gist, so
  it is a model's job; stage 2's prompt is where it is attempted, and the 150 above are its measure.

## Simpler options passed over

- **Raise the depth cap to four everywhere** — most sections are 2–7 paragraphs, so a fourth level
  there is one paragraph per node (260904d measured it).
- **Make the sub-sections from the author's headings with no model call** — free, but every
  internal node must carry a gist (`tree-invariants.ts`), and a gistless sub-section is exactly what
  the reader at that zoom needs most. It also does nothing for a long section with no sub-headings.
- **Leave it** — the 141 sections across 30 of 67 recent articles say the gap is common, not this
  paper's quirk.
