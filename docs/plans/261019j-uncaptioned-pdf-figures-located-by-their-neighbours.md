# Uncaptioned PDF figures, located by the prose either side of them

Queue item qi-ab5x79na, superseding qi-s63n3xxs (Stage B of
[261019e](261019e-uncaptioned-pdf-figures-are-kept.md)). Report spya-x9gn3d; question
[q-jpamyd](../user-feedback/questions/q-jpamyd.md), answered by Greg as spya-kgdjwn on 2026-10-19:

> Here are the goals. We ideally don't want to ever miss a diagram/figure/table, even if it doesn't
> have a caption. We can either add a caption for it (saying uncaptioned), or give it a unique random
> figure ID of our own, or generate all the captions with an LLM (and mark as AI-generated) - whatever
> you think is best. I don't really care too much about the details, but we do want to include all of
> the figures and diagrams and tables if we can. If there's a reason why this is really hard or really
> complex, then please explain. Get help from GPT Sol. And I guess it would be helpful to check that
> this is working.
>
> — Greg, 2026-10-19

## Where things stand

Stage A (261019e, on `dev`) keeps an uncaptioned figure as an empty marker — `<figure
data-spya-pdf-figure="…"></figure>` — whose ref folds in the prose either side of it. The `assets`
step then refuses it `uncaptioned`, and the reader sees *"We couldn't recover this figure"* with
**View the original**. Tables were never the problem: an uncaptioned table's cells already render
(261001q). So what is left is **the picture**: on Rovelli's *The Order of Time*, 27 of 33 figures.

The identity question Greg offers three answers to is already settled by Stage A — the marker's ref
*is* our own figure id — so this plan is only about recovering the picture.

## The idea: the located route, asked by neighbours instead of by caption

There is already a third route for a figure the page cannot prove
([src/pdf-figure-locate.ts](../../src/pdf-figure-locate.ts), 260924e stage 2): a vision model is shown
the claimed page and its two neighbours and asked for the page and box of *the figure with this
caption*, and `judgeLocatedBox` accepts the answer only if the box points at exactly one clean,
embedded picture nobody else has. For an uncaptioned figure the question changes and nothing else
does:

> A figure in this document has no caption. In the text it comes right after the passage ending
> «…like this one for Gorgo:» and right before the passage starting «There is a cone-shaped
> "past"…». Find it.

Rovelli's transcript, read from the stored `pdf-chunk` checkpoints on 2026-10-19, shows why that is
a good question: every one of the 27 sits between two passages that point at it (*"like this:"*,
*"shown below"*, *"these ones:"*), and the two stacked figures on a page have different neighbours —
p36's first sits after *"…such as this:"* and its second after *"…made up entirely of light cones:"*.
So the stacked pages that Stage B's positional rule left `ambiguous` (34, 36, 37, 56, 57, 67) are
separable here, because a person looking at the page can tell which picture follows which sentence,
and so can the model.

### What changes

1. **The neighbours, from the blocks.** `pdfFigureNeighboursIn(blocks)` in src/collect-assets.ts,
   beside `pdfFigureCaptionsIn` and by the same walk: for each marker with no caption, the last ~300
   characters of the nearest text block before it and the first ~300 of the nearest after it,
   skipping other empty media blocks, plus its place in a run of adjacent uncaptioned figures
   ("the 1st of 2 figures between these passages"). A marker with neither neighbour gets none and is
   refused as today.
2. **The locator's request becomes a union**: `{ kind: "caption"; caption }` or
   `{ kind: "neighbours"; before; after; position }`, with a prompt for each. The caption prompt is
   byte-for-byte unchanged (it is what the 30-call test run measured). The neighbour prompt is new
   and is measured on Rovelli before landing (below).
3. **An uncaptioned marker is held for the located route** (`uncaptioned` joins the refusals a look
   at the page can settle) when it has neighbours, instead of being failed at once. If the route does
   not place it, it keeps `uncaptioned`, as today.
4. **The caps.** `MAX_LOCATE_CALLS` is 8 an article and `MAX_LOCATE_LOOKS` 24; a book needs one per
   figure. Both rise, to 48 and 64 — at the measured ~$0.002 a call that is ten cents for the worst
   article, against a transcription that costs dollars. The 180 s step budget is the real limit and
   is measured on Rovelli; if 27 windows do not fit, the windows' page renders are cached across
   adjacent windows (they overlap almost entirely on a book like this) before anything else.
5. **Freshness.** The neighbours become a decision input, so `assetsInputHash` carries them as one
   more optional element, present only when some marker has them (the preferred-candidates pattern
   in that function's comment). `PDF_FIGURE_RECOVERY_POLICY` goes to `pdf-figures/7`: the same
   uncaptioned marker can now go from refused to stored.
6. **Alt text.** `rehost` gives every injected picture `alt=""` because the visible figcaption says
   it already. An uncaptioned picture gets an honest label instead — *"Figure without a caption, from
   page N of the original"* — not a description, since nothing we store has described it (GPT Sol,
   261019e plan review, finding 5).

The composite route (a model box rendered when it holds several pictures or a drawing) stays
caption-only: `judgeLocatedRegion` binds the box to the caption it finds printed on the page, and an
uncaptioned figure has none. So an uncaptioned **vector** figure keeps the Stage A note. Rovelli has
none (every image is one greyscale bitmap); it is a limit to name, not a case this book exercises.

### The risk, and what bounds it

The judge checks the geometry of an answer, never its truth (src/pdf-figure-locate.ts § What it
cannot do): a tight box round the wrong clean picture passes. With a caption, the model is matching
words; here it is matching *position in the reading order*, which on a page with one picture between
the two passages is easy and on a run of diagrams is where a mistake would be. What bounds it:

- two markers choosing one picture get it neither (existing rule);
- a picture the bitmap route gave a captioned figure cannot be chosen (`taken`);
- the window is the marker's page and its neighbours, so a wrong answer is a neighbouring diagram,
  not one from elsewhere in the book.

**Open for review:** whether to add a cheap veto — when a neighbour snippet is found on the chosen
page's text layer, the picture must lie below the "before" passage / above the "after" one. That is
Sol's Stage B rule used as a check on the model's answer rather than as the only proof. It is extra
machinery; the Rovelli run decides whether it is needed (every chosen picture checked by eye against
its page).

### The simpler options passed over

- **Stage B as written (positional text gate alone)**: deterministic, but carries page-tagged
  snippets out of `pdf-read`, positioned text runs through the raster read, and still leaves every
  two-figure page `ambiguous` — at most 18 of 27 here, before replaying real anchors.
- **LLM-written captions at transcription time** (Greg's third option): a prompt change, so every
  cached chunk goes stale and every PDF is re-read at full price to get them; and a caption still does
  not find the picture — the bitmap route needs a *printed* caption.
- **"Uncaptioned" as a caption**: names the figure, recovers nothing.
- **Trusting one marker and one picture on a page**: reopens 260924e.

## After GPT Sol's plan review

[The review](261019j-uncaptioned-pdf-figures-plan-review-sol.md) returned **GO WITH CHANGES**. What
was taken, and what was not:

1. **The order veto ships in v1** (finding 1), as `judgeNeighbourOrder`, plus a run check
   (`disorderedRuns`): figures that share one pair of neighbours must come down the page in order or
   none of the run is kept. Measured on Rovelli, the veto as first written refused two right
   photographs because the text was wrapped *beside* them; it now uses an anchor only when its line
   overlaps the picture left to right.
2. **Neighbours stay read from the blocks** (finding 2), and the review's preferred fix — the
   transcript's own neighbours carried in a reserved attribute — is not taken: src/reserved.ts rules
   that values in that namespace are ids we minted, never the document's text, and a security rule
   is not this plan's to bend. Instead the one thing a continuation join can make false is kept out
   of the veto: `before` (the end of the preceding block, which may be printed below the figure) is
   only shown to the model, and the veto anchors on `beforeStart`, which cannot be.
3. **Separate allowances** (finding 3): captioned figures keep 8 calls and 24 windows and are asked
   first; uncaptioned figures get `MAX_UNCAPTIONED_LOCATE_CALLS` = 40. The clock is shared, and the
   overlapping windows are cached a page at a time because the first Rovelli run took 156 s of 180.
4. **A `LocateSubject` union** (finding 4), required `neighbours` on the collector's options, the
   composite route only in the caption arm, and a test through `recoverPdfFigures`.
5. **Freshness** (finding 5): the neighbours go into `assetsInputHash` as a tagged object keyed by
   ref; the policy is `pdf-figures/7`.
6. **Alt text** (finding 6): *"Figure without a caption"*, no page number — a located picture's
   page need not be the marker's.

## After GPT Sol's code review

[The review](261019j-uncaptioned-pdf-figures-code-review-sol.md) returned **SHIP AFTER MY FIXES**,
and its fixes were checked and kept:

1. **A run keeps a picture only when every member was placed in order.** Two figures that share
   their neighbours differ only by order, so one located member on its own proves neither's place.
   On Rovelli the only run (p67–68) was already refused, so the result below is unchanged.
2. **A run is named by its first marker's ref**, not by its prose, which can repeat elsewhere in a
   book; the key is in `assetsInputHash`.
3. The caption reaches the caption prompt untrimmed, as before this change.
4. Tests for the page cache (reuse, eviction, re-read after the pass restarts at low pages), the
   document edges, empty media and the two fixes above; stale "caption-only" and "Stage B" comments.

## Result

On Rovelli, 25 of 28 uncaptioned figures recovered, every one the right picture, in 76 s; the three
left are transcript mismatches the conflict rule refused safely —
[261019a](../investigations/261019a-uncaptioned-pdf-figures-located-on-rovelli.md).

## Verification

1. Unit: the neighbour walk (run of two, a neighbour that is another figure, no neighbours); the
   request union and both prompts; held → located → stored for an uncaptioned marker with a scripted
   locator; refused `uncaptioned` when the locator declines; caps; the hash changes with the
   neighbours and with the policy, and a captioned-only article's hash changes only by the policy.
2. Rovelli on the local stack: the same PDF, the stored transcription (no new transcription calls),
   `extract`, `blocks`, then `assets` with the real locator. Count stored/refused per figure, check
   each stored picture against its page by eye, record time and cost, and write it up in
   `docs/investigations/`.
3. A browser look at a few of the recovered diagrams in the reading view.

The production re-import is a follow-up after deploy, for the Overseer or Greg; this work writes
nothing to production.

## Stages

1. This plan; GPT Sol plan review (`--sandbox review`).
2. Build with failing tests first; measure on Rovelli locally; decide the veto.
3. GPT Sol code review (`--sandbox workspace-write`), gates, docs (`article-images.md`,
   `content-extraction.md` if it says uncaptioned figures stay unrecovered), bookkeeping, push to `dev`.
