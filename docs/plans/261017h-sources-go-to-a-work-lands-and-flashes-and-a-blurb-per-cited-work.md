# Sources: *Open in Sources* lands on the work and flashes it, a roomier list, and a blurb per cited work

Report `spya-m53cdk` (SPIDERYARN-READING2-JF), Greg, 2026-10-17, on
`arxiv-2308-08708-spya-xax6v4` (Butlin et al., *Consciousness in Artificial Intelligence*):

> I clicked "Go to sources" for a citation tooltip.
>
> It opened the Sources mode, but it was hard to actually see which source was being referred to -
> can we scroll to the right source (perhaps centred in the scrollable area), and flash it.
>
> Also, there's not much vertical real estate for the scrollable area with the actual sources. e.g.
> we can hide this ("Unless a row says otherwise, we have read none of these works, only the
> article that cites them") behind an information-tooltip, and anything else that's
> repetitive/not adding much information.
>
> And finally, the Source mode isn't that helpful. I know we had switched to "Ask in chat" for a
> deep dive on a source, but that's a bit heavy-weight/slow. I wonder if we should:
> - Whenever I click on "Go to Sources" for a citation, automatically run a websearch and provide a
>   brief (couple of sentences) blurb based on whatever's available for each source as part of
>   generating the Sources mode (with clear indication in info-tooltip that it's just a quick web
>   search, whether or not it's based on finding the Abstract, or the article itself, or what
>   other people said about it, better to say nothing than hallucinate if you can't find any
>   primary/authoritative sources, etc)
> - How expensive would it be to do this for all the citations when generating Sources mode? Run
>   some spikes/evals. If we can do a decent enough job of it for a few cents for all the
>   citations for a standard article, it's worth doing. (And the "Ask in Chat" remains for a deep
>   dive on any of them)
>
> I'm thinking we could get away with Haiku 5.5 for this brief-citation-blurb work.
>
> — Greg, 2026-10-17 (`spya-m53cdk`)

The card's button is labelled *Open in Sources* (ProseHoverCard.tsx); "Go to sources" is the same
button.

## What is there now

- *Open in Sources* calls Reader's `openBibliographyWork`, which sets a focus (`focusOn(id)`) and
  moves to Bibliography. `BibliographyPanel` lowers the threshold bar if the work is hidden, and
  `useLandOnItem` (src/web/item-focus.ts) scrolls the row with `block: "nearest"` and nothing
  else. On a band that has just opened at the top, `nearest` puts the row at the bottom edge, and
  with no flash a reader cannot tell which of a dozen rows it is. That is the report's first half.
- Above the list, in the band: the chip row (`head`), the order row, the threshold slider (in
  *prioritised* only), and `CITE_LIST_NOT_READ` on a line of its own while any visible row has
  nothing of its own to say about reading. The band's (i) already holds the mode's card, the
  count and who made the list.
- Per-work prose beyond the bibliography was taken out on purpose:
  [bibliography.md § Nothing about the work beyond the article's bibliography](../project/bibliography.md#nothing-about-the-work-beyond-the-articles-bibliography)
  (Greg, 2026-10-03: *"err on the side of saying … nothing about a paper beyond what's available in
  the bibliography … better to say less and allow the user to ask for more"*), and *Dig deeper*'s
  button went on 2026-10-09 for *Ask in chat*. A blurb brings back a sentence about the work, so it
  must be **a sentence about the work from a source we fetched, labelled as such**, never the
  model's memory and never the citing paragraph restated. Greg's own words in this report set the
  same bar: *"better to say nothing than hallucinate"*.

## Stages

### Stage 1 — land, centre, flash; and give the list the room (small, lands first)

1. **Landing**: `useLandOnItem` scrolls the row to the **centre** of its scroller and **flashes**
   it with the existing `flashElement` (src/web/flash.ts: its colour, its length, its
   reduced-motion rule). The flash waits until the row is in place, so a smooth scroll does not
   spend the wash travelling. This is the shared hook, so Glossary, Ideas and Claims landings
   (a chat's way back to its item) get the same: one job, one look
   ([controls.md § Controls that do the same job look the same](../project/controls.md#controls-that-do-the-same-job-look-the-same)).
   The old reason for `nearest` was that *a row already on screen does not move*; a centred row
   with a flash is what Greg has asked for, and the way back from a chat benefits the same way.
   Test first: a jsdom test that the row's own scroller is set to centre it (not `scrollIntoView`,
   not the window; see F1 below) and that the row carries the flash class, red before the change.
2. **Room**: `CITE_LIST_NOT_READ` leaves the band and goes into the band's (i) card, which is
   where the other whole-list sentences went (plans 261001l, 261001m). Then a browser pass at
   1440×900 and 390×844 to measure what else sits above the first row, and take out anything else
   that repeats (each removal named in this plan with its reason). Nothing that is a control goes.

### Stage 2 — spike: what a blurb per cited work costs, and how often it is right

Written up as [261017c-citation-blurbs-cost-and-quality](../investigations/261017c-citation-blurbs-cost-and-quality.md).
On three real bibliographies (the reported article, one essay-shaped, one other paper), measure
three ways to get the evidence a blurb is written from:

- **A. Registries first, free.** OpenAlex (by DOI, arXiv id, else title + first author, through
  the client `related-work.ts` already has) and arXiv's own API for an arXiv id: the work's
  abstract, when it has one. Haiku 5.5 then writes up to two sentences per work **from the
  abstract only**, batched (one call for the whole list, or a few). Cost: tokens alone.
- **B. One quick web search per work** (Exa through `openrouter:web_search`, the
  `web-search-subagent` shape: Haiku, one search, code keeps only links the search returned).
  About $0.007–0.008 a work by the 261012b spike, so ~$0.30 for 40 works.
- **A+B.** A for every work, B only for a work A found nothing for — the clicked one, or all of
  them, depending on what B costs per article.

For each: coverage (share of works that get a blurb), cost per article (from the ledger, not
arithmetic), wall time, and faithfulness — every blurb sentence checked against its evidence by
an Opus judge plus a hand check on a sample: *supported*, *not in the evidence*, *wrong work*.
Also how often a blurb only restates the title (which is the "repetitive" Greg wants gone).

### Stage 3 — build (shape decided by Stage 2, and by Greg where it is a product call)

The working assumption, to be confirmed by the spike:

- A new step, `citation-blurbs`, runs **after** Bibliography on a press (not on import), writes
  per-work `{ blurb, basis: "abstract" | "web-page" | …, sourceUrl, sourceHost, fetchedAt,
  model }` onto its own column/row keyed by the work's id and the bibliography's hash, so
  re-making Bibliography does not orphan or mismatch blurbs. Every stage runnable on its own.
- A row draws the blurb under its by-line, in the model's font
  ([fonts.md](../project/fonts.md)), with a quiet *from the abstract at openalex.org* / *from a
  web search* basis; the (i) card says what a blurb is and is not (*a quick search, not a
  reading; written only from what was found; nothing when nothing authoritative was*).
- *Ask in chat* stays as the deep dive.
- Code, not the model, decides which source a blurb is written from and whether that source is
  the work (the identity rules `registryIdentifiesCitation` and `pageNamesTitle` already
  enforce). The model may decline (`null`), and that is stored as *no blurb*, not retried.

**The product question Stage 2 will likely raise**: whether to run blurbs for every work whenever
Bibliography is made (cheapest per work if A covers most works), or only on *Open in Sources* /
a press in the band. Asked with a question file per
[feedback-reports.md § Asking Greg a question](../project/feedback-reports.md) once the numbers
are in, not guessed.

## Passed over

- **A web search per work for every work, every time** (B alone): the simplest, and it matches
  Greg's words most literally, but at ~$0.30 an article it is ten times "a few cents", and for a
  paper with a DOI the abstract is the authoritative source anyway.
- **Asking the model what it knows of the work** (no fetch): cheapest and the one thing Greg and
  bibliography.md both rule out — it is the model's memory dressed as a fact.
- **Bringing back *Dig deeper***: it reads the paper and writes paragraphs on the bigger model;
  Greg's point is that the light version is what is missing.

## Limits

No deploy; land on `dev`. No production write: the spike reads production bibliographies
(reading is fine) and writes its results to the investigation doc and local files. Spend: the
spike's calls go through the gateway and the ledger, a dollar or two at most.

## The plan review, and what it changed

GPT Sol, read-only, [261017h-sources-blurbs-plan-review-sol.md](261017h-sources-blurbs-plan-review-sol.md):
*proceed with changes*, no P0, seven P1s.

- **F1 (P1), taken.** `scrollIntoView({block:"center"})` scrolls every scrollable ancestor, the page
  included (tests/skim-panel.test.tsx already says so), and `scrollToAndFlash` watches `window`,
  not the band's scroller. So the landing finds the row's own scroller (the nearest ancestor that
  scrolls: `.tl-scroll` in Bibliography), sets that scroller's `scrollTop` to centre the row,
  **instantly**, and flashes at once. Instant because the band has just opened, or the reader
  pressed for this row: there is no travel to watch, and no settle to wait for. The page under the
  band does not move; the test asserts that.
- **F2 (P2), accepted as it is.** A band flash replaces a prose flash still running (one `live`
  wash in flash.ts). The reader has just pressed *Open in Sources*, so the row is where they are
  looking; a held flash behind a covering band is untouched.
- **F9 (P2), taken.** The (i) keeps `showListReadNote`'s condition, and once blurbs exist the
  sentence changes with them (Stage 3). The blurb is a newer, labelled exception to the 2026-10-03
  rule, and bibliography.md will say so with Greg's quote.
- **F3–F8, all on the spike and the build, taken into the spike's brief**: a per-citation lookup
  of our own (related-work.ts has none, and keeps a 400-character opening only); the cascade
  Crossref abstract for a confirmed DOI → arXiv `summary` → OpenAlex by identifier → Semantic
  Scholar abstract, its TLDR recorded as a separate, model-written kind; a zero-model baseline
  (the abstract's first sentences cut by code); identity by a strict rule, and `resultIsTheWork`
  rather than `pageNamesTitle` for a web result; evidence classed primary or secondary; a
  supporting quote per blurb that code finds in that work's evidence, or no blurb; opaque
  indices per work in the batch; real `webSearches` counts (median, p95, max), not one assumed;
  gates declared before the results; only public or Greg's own articles as fixtures, because the
  spike sends every cited title to outside services.
- **F7 (P1), for Stage 3**: key the stored blurb by `(article, entry id)` and attach it only while
  a recomputed fingerprint (citation identity, source kind and id, prompt version, model) matches,
  as `citation_lookups` does; distinct states for *no evidence*, *model declined*, *failed check*
  and *transient failure*, and only the terminal ones kept.
- **F8 (P1), for Stage 3**: no whole-list web search without an allowance taken before the calls.
  Until then, a web search only for the work the reader pressed.

## What the browser pass measured (Stage 1, part 2)

On a 69-work bibliography locally (`fd-src-s41598-023-33209-9…`), Sonnet, 2026-10-17. Above the
list: the chip row 46px, the order row 42px (74 on a phone, where it wraps), the threshold 84px
(101), the not-read line 80px (103). The list had 69% of the band at 1440×900 and 60% at
390×844: about 4.5 rows on a desktop, 3.5 on a phone. *Open in Sources* landed the row flush
against the list's bottom edge, with no flash, at both widths: the report reproduced.

Taken: the not-read line goes into the (i) (~80–100px back), and the threshold's foot line says
the same thing in one line instead of two (*38 citations hidden. Drag left to show them.*, ~20px
back). The foot line stays: it is there so a slider never hides things silently
(GlossaryPanel.tsx § GateSlider). Left: the order row's wrap on a phone (rows wrap by design,
[narrow-windows.md](../project/narrow-windows.md)), and *search Scholar ↗* on each row without a
link, which repeats but is a control, and per-row.

## Progress

- 2026-10-17: plan written; reviewed (above); spike and Stage 1 under way.
- 2026-10-17: Stage 1 and 2 committed (8160890cf); GPT Sol's Stage 1 code review fixed (784b217d6).
  Stage 3 designed and reviewed again by Sol
  ([261017h-stage-3-design-citation-blurbs.md](261017h-stage-3-design-citation-blurbs.md)).
- 2026-10-18: 3a, evidence (a34253620). 3b, the step (d8933fe53): a real local run on a 40-work
  list made 12 notes from 16 abstracts for $0.0095. 3b's own notes for the code review: the 16k
  output ceiling for a batch of 20 is tight (13k across two calls); `too-long` refused 4 of 16
  twice, now split into `quote-too-long` to say why. 3c (the panel, visitors, chat) under way.
- 2026-10-18: 3c (c288a99ff): the note on the row, in the hover card, for visitors and in chat.
  Eval on the shipped code (261017c): 74 of 75 sentences supported, none about the wrong work;
  coverage 40% on the reported paper, 64% on the coding paper. GPT Sol's Stage 3 code review
  ([261017h-stage-3-code-review-sol.md](261017h-stage-3-code-review-sol.md)), *ship after fixes
  (made)*: a Crossref cooldown is now waited out within the run's bounds (b1f486d33). Coverage and
  a web search for the clicked work are question
  [q-ny49p3](../user-feedback/questions/q-ny49p3.md). Done, on `dev`.
