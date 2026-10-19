# A PDF's uncaptioned figures are kept

Report spya-x9gn3d (#611), from Greg, 2026-10-18, on Rovelli's *The Order of Time* imported as a
PDF, at block `spya-k6tf3t`:

> The text references a diagram here, but I don't see one. How did we lose it? Was it not in the
> original PDF?
>
> Look at the original file yourself. I'm not so fussed about fixing this particular document, but
> rather improving things going forward.

Queue item qi-kwn2p7gh. Related:
[260906a](260906a-figures-from-a-pdf-are-placeholders-with-no-image.md) (the bitmap route),
[260924e](260924e-a-pdf-figure-paired-to-the-wrong-caption.md) (the caption-on-the-page gate),
[261001q](261001q-pdf-tables-and-composite-figures.md) (composites),
[article-images.md](../project/article-images.md).

## What happened

Read from production, read-only, on 2026-10-19 (the article's current revision, its stored
`pdf-chunk` checkpoints, and the original PDF from the `sources` bucket).

**The diagram is in the PDF, and the model saw it.** Page 32 prints *"Those of Leonidas are shown
below, alongside Gorgo's:"* and then an embedded bitmap. The stored transcription has a `figure`
record for page 32 — with an empty caption, because the book prints none.

**We threw it away when building the page.** `src/pdf-read.ts`'s prompt rule 7 asks for *"ONE
record of type "figure" whose text is the caption exactly as printed (empty string if there is
none)"*, and the renderer then skips every record whose text is empty (`if (!text) continue`). The
comment above that render loop calls it *"v1's boundary rather than an oversight; giving those a
media block of their own is a separate decision"* (GPT Sol, I-3).

The numbers for this book: the model emitted **33 figure records, 27 of them uncaptioned. All 27
were dropped**; the 6 captioned ones all have their picture stored. The pages it marked are pages
that paint an image; the pages it did not mark include the cover and title pages. So the model's
"this is a figure" judgement is good here, and the loss is ours, not the model's.

An image survey of the whole PDF (every image extracted and looked at, 2026-10-19): **42 images on
36 pages**, of which 5 are decoration (cover, title page, a drop cap, two publisher logos) and none is
scanned text. The rest are the book's diagrams — the light-cone sequence on pages 31–39, the time
diagrams with Smurfs, portraits and photographs — and only 6 of them carry a printed caption. Every
image is one whole greyscale bitmap with its labels baked in; there are no vector figures. None of
the 5 decorations got a figure record from the model.

Two facts about the layout matter below. **Each diagram sits at the top of its page**, so the
sentence introducing it (*"like this:"*) often ends the previous page. And **five pages carry two
stacked images** (34, 36, 37, 57, 67).

**And even with a marker, the figure would have been refused.** The bitmap route attaches a picture
only where the page's text layer prints the marker's caption (`captionPrintedOn`,
[260924e](260924e-a-pdf-figure-paired-to-the-wrong-caption.md)), and an empty caption is never
printed — `caption-not-in-page-text`. The drawn route and the model locator are only tried for a
captioned marker. So keeping the figure is one half and recovering its picture is another.

**How common.** Production holds 11 live PDF articles. Rovelli's is the only one whose prose points
at diagrams it does not show; papers caption their figures. Books — and essays printed from the web —
are where uncaptioned figures live, and books are exactly where Greg's reading is going.

## The class

A caption was the only evidence we accepted that a picture belongs to a figure, and the transcript
step dropped any figure that had no caption rather than handing that evidence question on. **A
figure without the usual evidence was silently treated as no figure**, with nothing in any manifest,
because the manifest only ever sees markers that exist (the same shape as
[article-images.md § An image the step never sees](../project/article-images.md#an-image-the-step-never-sees)).

## The plan, after review

The first draft paired an uncaptioned figure by *"the text before it or the text after it is printed
on its page"*. GPT Sol's plan review
([261019e-uncaptioned-pdf-figures-plan-review-sol.md](261019e-uncaptioned-pdf-figures-plan-review-sol.md))
returned **RETHINK**, and its finding 2 is decisive: 260924e's real failure had one marker and one
picture on the claimed page, the transcriber had filed the figure under the page where *its
introducing paragraph ends* — which is exactly the "text before it" — and the picture on that page
was the previous figure's. The draft's gate would have passed that wrong pairing. A safe rule needs
**position**: the picture below the text before it and above the text after it, located in the
page's positioned text. That is a materially bigger build, so it is split off.

### Stage A — built here: an uncaptioned figure is kept, and says it was not recovered

The silent loss is the bug Greg hit: prose saying *"shown below"* over nothing. Stage A ends the
silence without risking a wrong picture.

1. **`src/pdf-read.ts` renders an empty `figure` record** as `<figure data-spya-pdf-figure="…"></figure>`
   — a marker, no `<figcaption>` — instead of skipping it. The per-page ordinal counts it, as the
   comment there says it must: it is a figure that was emitted. Sol confirmed nothing downstream
   removes such a block (finding 1: front matter ignores empty records, the sanitiser keeps the
   reserved attribute, every `<figure>` is a leaf block, the marker scan needs no caption).
2. **Its ref folds in the text either side of it** (Sol finding 4). With no caption, page and ordinal
   would be its only identity, so a re-extraction that found one more uncaptioned figure earlier on
   the page would hand the old figure's ref — and through `emptyKey`, its block id — to the new one.
   `pdfFigureRef` takes an optional `context` for an uncaptioned figure: the number of emitted
   figures on its page, the end of the rendered block before it and the start of the block after
   it. The count makes an adjacent run remint as a whole if another indistinguishable figure is
   inserted, rather than moving the old ids down by one. A captioned figure's ref is byte-for-byte
   what it was, so nothing stored today moves, and `PDF_FIGURE_REF_VERSION` stays `pdffig1` — no
   uncaptioned ref has ever existed to be reinterpreted. If the neighbours change, the ref changes and
   the block re-mints: a lost anchor rather than a moved one.
3. **The gate refuses it by name.** `pairPageFigures` refuses a marker with no caption as
   `uncaptioned`, a new word in both failure unions, instead of borrowing
   `caption-not-in-page-text`, which claims a caption that does not exist. It still counts towards
   its page's markers, so a captioned figure sharing a page with one becomes `ambiguous` rather than
   taking a picture that may be the uncaptioned one's — the safe side, and no worse than today, when
   the uncaptioned figure was invisible and the captioned one could take its picture unchecked.
4. **What the reader sees** is what any unrecovered PDF figure already gets (Sol finding 8 corrected
   the draft here): `PdfFigureNotes` prints *"We couldn't recover this figure"* and, for the owner,
   **View the original** opening the PDF at that page. In Skim and Structure it is a figure stop
   called *"Figure N"*, which now lands on that note rather than on nothing.

`PDF_FIGURE_RECOVERY_POLICY` is not bumped: no existing marker is decided differently, and
`assetsInputHash` already carries every marker's ref, so an article whose re-extraction gains
uncaptioned markers is stale for `assets` by that alone.

**Forward-only** (Sol finding 7). `extract` has no currency stamp, so existing PDF articles keep the
blocks they have until someone re-extracts them. For this book that is a re-run of `extract` (from
the stored `pdf-chunk` checkpoints, if they are still cached) and then `assets` — a production write,
and not one this work makes.

### Stage B — written up, queued for Greg: recover the picture by position

The design Sol proposed, in outline: `pdf-read` carries page-tagged snippets from the raw records
either side of the figure (before continuation joins, skipping footnotes, references and publisher
furniture, stopping at another figure or table); the raster read keeps each image's paint box and
the page's positioned text runs (`textRunsFrom`, `src/pdf-figure-layout.ts`; image boxes,
`src/pdf-figure-read.ts`); and an uncaptioned marker pairs only when a uniquely-located "before"
snippet on the page is above the picture or a uniquely-located "after" snippet is below it, with both
consistent when both are present. The snippets go into `assetsInputHash` (Sol finding 6), the
recovery policy goes to `/7`, and `rehost` gives an uncaptioned picture an honest `alt` (*"Figure N —
no caption in the article"*) instead of the `alt=""` it gives a captioned one (finding 5).

On this book it would bring back at most 18 of the 27 — the upper bound from counting one marker and
one picture per page, not yet replayed against real anchors (Sol finding 1). Two figures on one page
stay `ambiguous` either way (pages 34, 36, 37, 56, 57, 67); pairing them top to bottom is a further
step after that.

It is queued rather than built because it adds real machinery to a gate whose whole job is never to
show the wrong picture, and that trade is Greg's: he has said he would rather have *"a bit of extra
stuff … than have no figure imported at all"* (2026-10-01), which argues for it, and the rule to name
added complexity before building it argues for asking.

### The simpler option passed over

Dropping the caption check for an uncaptioned marker and trusting the transcript's page. Smaller, and
it reopens 260924e on the documents most likely to trigger it.

### The prompt is not changed

Rule 7 already asks for an empty-caption figure record and the model already produces them. No
prompt change, no prompt-version bump, no paid run.

## Stages

1. ✅ Plan; GPT Sol review (RETHINK — split into A and B as above).
2. Stage A with failing tests first: the renderer keeps an empty figure record with a marker and no
   caption; its ref is stable for the same neighbours and changes with them, and a captioned ref is
   unchanged; the gate refuses it `uncaptioned` and counts it on its page; render → blocks → marker
   scan end to end.
3. GPT Sol code review (fixes in place), gates, `article-images.md`, the postmortem, push to `dev`;
   Stage B queued with a question for Greg.
