# Articles whose images did not import, and the figures Readability deletes with their wrapper

**[SPIDERYARN-READING2-6A](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6A)** · 2026-09-30 ·
status: *stage 1 built* — plan reviewed by GPT Sol, *build with changes*, all seven findings taken

Greg, 2026-09-30:

> I think you now have access to the production database. So have a look at some of the articles,
> and look for cases where the images didn't import correctly, and check that they now do. This might
> involve going back to the original sources to see, you know, what it was about the images that
> caused a problem and consider what fixes might solve things, and then, you know, run spikes to see
> if you can fix them and then make whatever updates are needed so that going forwards it won't be a
> problem. Now, in some cases, I can imagine this potentially would require real complexity or risk.
> If that's the case, probably hold off. We're only looking for sort of clean, general, robust
> approaches that won't add too much complexity. If it's going to be loads of complexity, it's really
> hard, then let's discuss it first. Prioritise your changes by a combination of ease and value.

The session's own limits: production may be read, never written — re-running a stage on a production
article is a write, so the re-runs are a list for Greg (§ *What production needs*, below).

## How production was read

`.env.prod` is on the box now, so this was the first session able to look. Every query ran inside
`begin read only … rollback` through the transaction pooler, never a bare `SET` —
[database.md § Never `SET` anything on the transaction pooler](../project/database.md). The bucket
was read with `GET /storage/v1/object/info/…` only.

## What production holds — 41 live articles, all Greg's

| | images | stored | failed | articles |
|---|---|---|---|---|
| web images (`assets.entries`) | 154 | 41 | 113, all `storage` | 4 failed wholesale, 6 fine |
| PDF figures (`assets.pdfFigures`) | 75 | 22 | 53 — `ambiguous` 36, `not-located` 9, `no-raster` 7, `caption-not-in-page-text` 1 | 15 |

Every one of the 63 stored objects is in the bucket (and a made-up hash answers 400, so the check
can fail). The manifests are not the whole story, though: an image that stage 2 threw away never
reaches the assets step, so it is in no manifest at all. That is where the one new cause was.

## Five causes, ranked by ease × value

### 1. Readability deletes a figure along with its wrapper — **build this** (easy, high value)

Found by comparing the images in each live source with what stage 2 keeps today:

| article | figures with a picture, in the source | kept by stage 2 |
|---|---|---|
| Nature Neuroscience `s41593-022-01026-4` | 8 | **0** |
| Nature Scientific Data `s41597-021-01033-3` | 5 | **0** (the 3 "stored" images are the *related articles* thumbnails) |
| Sebastian Raschka's Substack, `gpt-6-astra-…` | 23 | **14** |
| Wolfram, Asterisk, arXiv HTML, Noema, Paul Graham, PMC | — | every in-body figure |

The mechanism is one, in two shapes. **A picture has no text, so Readability judges the element
around it by whatever text is left** — and what is left is a caption with a link in it, or an
enlarge button:

- **Springer Nature** (Nature, Scientific Reports, BMC, Springer Link share this markup):
  `figure > div.figure-content > div.figure-item > (picture, div "Full size image" link)`. The
  item's only text is the link, so its link density is 1; `article` in the class gives it weight 25;
  `_cleanConditionally` removes it on *"High weight and mostly links"* and the picture goes with it.
  Measured with Readability's debug log, 8 of 8.
- **Substack**: `div.captioned-image-container > figure > (a > picture, figcaption)`. When the
  caption carries a link — *"Source: https://…"* — the container has weight 0 and link density
  0.20–0.70, and goes on *"Low weight and a little linky"*. 9 of 9 lost figures, and exactly the
  nine whose captions link.

**The fix is two pieces, after GPT Sol's plan review** (below) replaced the spike's one:

- **Nature's button is furniture.** `div.c-article-section__figure-link` is Springer Nature's own
  label on a control it generates, which is the whole licence of
  [`src/furniture.ts`](../../src/furniture.ts). A fifth entry, narrowed to what the corpus shows:
  inside a `<figure>`, no picture, and every word inside a link. Removing that one element alone
  brings back all eight Nature pictures, because the item around the picture then has no link text
  to be judged by.
- **Rule C in [`src/protect.ts`](../../src/protect.ts), for a wrapper that dies of its caption.**
  Before Readability, for each `<figure>` holding an `img`, `picture` or `video`, look at every `div`
  between the figure and its picture and every `div` that wraps nothing but the figure (walking up
  while that holds, each judged on its own), and **unwrap one only if Readability's own
  link-density rules would delete it**: fewer than ten commas, and link density over 0.2 at class
  weight under 25, or over 0.5 at 25 and above. The weight and density are Readability 0.6.0's
  `_getClassWeight` and `_getLinkDensity` — fragment links count 0.3 — copied, with the regexes
  pinned against the live prototype the way rules A and B pin theirs. So `kept` counts a figure only
  where Readability would really have taken it: the nine Substack figures whose captions cross the
  line, not the six whose links are too short to matter.
- `figure` is not among the tags `_cleanConditionally` walks (`form`, `fieldset`, `table`, `ul`,
  `div`), so once the at-risk `div` is gone, those two rules have nothing to remove. **That is the
  whole guarantee.** Candidate selection is a separate way to lose a figure — one outside the
  selected article is never appended — and rule C does not change it.
- Rule C joins the prose-retention fallback like A and B. GPT Sol constructed a page where it must:
  four sibling `<article>` sections and a figure with a long linked caption, where unwrapping lets
  the figure win candidate selection and all four sections go. The fallback catches it, and it is a
  test.

**Simpler options passed over:**

- *A furniture selector for `.c-article-section__figure-link`* — one line, Nature only, and it does
  not reach Substack, whose trigger is a link in the caption, which is content.
- *Raise Readability's `linkDensityModifier`* — one option, and it moves the threshold on every
  element of every page to save a handful of figures.
- *Re-insert lost pictures after Readability*, by matching the source's figures to the output's
  captions — more parts, and a caption-matching heuristic of its own.
- *A class token, like rules A and B* — rule B's token takes weight to 25, and Nature's wrapper is
  already at 25 and dies on the *high*-weight rule.
- *A generic "link-only control" deletion inside the figure*, which the spike did. GPT Sol: a photo
  credit written as a link is link-only too, and short enough that `proseRetention` never sees it
  go. Replaced by the one publisher-labelled selector.

### 2. The `storage` failures — **already fixed; four articles need a re-run** (no code)

All 113 failed web images are `storage`, dated 2026-08-30 to 2026-09-03: the bucket allowlist that
refused every image on production in those days,
[260903f](../postmortems/260903f-the-bucket-allowlist-drifted-again-on-production.md). Every
article ingested since stores its images. The manifests still say `failed`, so the reader is
hot-linking those images: `todo`, `towards-a-theory-of-bugs-…` (102 images),
`what-if-we-had-bigger-brains-…` (7), `2605-20355v1-spya-ygtwkz` (3).

### 3. PDF figures refused before the model locator shipped — **re-run** (no code)

The locator ([article-images.md](../project/article-images.md), 2026-09-28) takes figures both
page-reading routes refused, `ambiguous` included. It reached production at 06:19 UTC that day. Eight
PDF articles ran their assets step before that and have 31 refused figures between them that it has
never seen: `arxiv-2512-spya-uxu036`, `entropy-24-00930-spya-bmvfyb`,
`distributed-representations-composition-superpos-spya-f…`, `2406-01506v1-spya-wcc6gz`,
`entropy-26-00481-with-cover-from-taylor-beck-spya-naz56…`, `s41598-023-33209-9-spya-hxekgz`,
`arxiv-1811-spya-vw9rn6`, `9689-full-spya-m43th2`. A re-run costs ~$0.002 a call, at most
`MAX_LOCATE_CALLS` per article.

### 4. PDF figures the locator also refuses — **discuss, do not build**

Three articles ran after the locator shipped and called it 14 times: `bf03197835-spya-qfwsw2` (2
calls), `arxiv-2212-spya-u5293w` (8), `pnas-202123432-spya-rekvg9` (4). `pnas` recovered **none**
of its 4. Two more (`arxiv-2508`, `dongetal25`) never called it, because their refused figures are
drawn, and the locator refuses vector figures in v1. `ambiguous` — a page with two captions or two
pictures — is the biggest single bucket, 36 of 53. Doing better here means pairing several pictures
to several captions on one page, or a drawn figure beside another, which is exactly the
*"ownership would be inferred rather than shown"* that the earlier PDF plans deferred on purpose.
That is real complexity, so it goes to Greg as a question with the numbers, not as code.

### 5. Smaller things, recorded

- **Articles with no assets manifest at all**, ingested before the step existed: `noema-mythology-
  of-conscious-ai` (5 images, hot-linked), `writes` (1), `constitution` (0). An `assets` run fixes
  them.
- **PDFs from before figure markers existed** (2026-09-06): `temporal-context-reinstatement-spya-
  dhqkf9` (19 figure captions), `lawrence-kuhn-…-spya-hs…` (7), `analog-cognition-…-spya-kn0z4z`
  (8) show captions and no pictures. They need `extract` re-run — a model transcription, so money and
  new block text — and so they are Greg's call rather than a routine re-run.
- **Hero images outside the article body** — Noema's lead illustration sits in a `splash` block
  above the text, and Readability leaves it out on purpose. Keeping it would be a new "lead image"
  rule and a product decision. Not built.
- **No `unsupported-format` failure on production at all**, so hosting WebP/AVIF is not where the
  losses are today.

## What production needs, once the Overseer deploys stage 1

For Greg, not run by this session. All against production, as the owner in `.env.prod`:

| articles | command | why |
|---|---|---|
| `s41593-022-01026-4-spya-bh0g5s`, `s41597-021-01033-3-spya-e06dkg`, `gpt-6-astra-looped-transformers-and-spya-spqbsp` | the article's **Reset** ([260928a](260928a-reset-and-regenerate-article.md)), with *regenerate* ticked if the extras should come back | cause 1: the figures are in the stored raw page and were dropped at stage 2 |
| the four in cause 2 | `npx tsx scripts/stage.ts assets <slug> --force` | cause 2 |
| the eight in cause 3 | `npx tsx scripts/stage.ts assets <slug> --force` | cause 3 |
| `noema-…`, `writes`, `constitution` | `npx tsx scripts/stage.ts assets <slug>` | cause 5 |

**Cause 1 cannot be done one step at a time** (GPT Sol): an `extract`-only job publishes new
extracted HTML beside the old blocks, and a `blocks`-only job is refused because `blocks` must travel
with `hierarchy`. It has to be one job. **Reset already is one**: `enqueueReset` (src/jobs.ts) queues the
default ingest steps — `fetch` already done, then `extract`, `blocks`, `hierarchy`, `assets` — with
`extract` forced, over the stored copy, so nothing is fetched again. It drops the extras from the
draft and queues them again only if asked. That is safe for block ids — the draft carries the published blocks,
unchanged text keeps its id, each recovered figure gets a new one, and `assertIdsCarried` refuses a
run that shares none. A new hierarchy queues its labels; other modes read stale until next asked
for.

## Stages

1. **The furniture entry and rule C**, red test first: trimmed real fixtures — one Springer Nature figure,
   one Substack figure with a linked caption, one Substack figure without — in
   `tests/extract-figure-wrappers.test.ts`, asserting the picture survives `readArticle`, the enlarge control
   does not, and the fallback rolls rule C back like A and B. Then the doc lines:
   [article-images.md](../project/article-images.md) (the images stage 2 can lose before the assets
   step sees them) and [content-extraction.md](../project/content-extraction.md) if it lists the
   rules. GPT Sol code review.
2. **The note** under `docs/user-feedback/`, this plan's status, and the re-run list confirmed.

Deferred, named: cause 4 (to Greg as a question), the lead image, WebP/AVIF hosting.

## Stage 1, as built

- **The furniture entry**: `div.c-article-section__figure-link`, narrowed by `isFigureButton`
  (inside a figure that holds a picture, not in its caption, no picture of its own, every word inside
  a link) — [`src/furniture.ts`](../../src/furniture.ts).
- **Rule C**: `unwrapFigureWrappers` and its gate `readabilityWouldTakeItForItsLinks`, with
  `POSITIVE`, `NEGATIVE` and `HASH_URL` copied and pinned — [`src/protect.ts`](../../src/protect.ts).
- **Tests**: [`tests/extract-figure-wrappers.test.ts`](../../tests/extract-figure-wrappers.test.ts),
  red before the change (three of seven at first; the rest were counterfactuals and negatives), with
  fixtures cut verbatim from the two live pages in `tests/fixtures/figure-wrappers/`. GPT Sol's
  rollback page could not be rebuilt from its description, so a second, narrow Sol run supplied it
  against the built gate
  ([question](260930e-figures-readability-deletes-with-their-wrapper-p1-4-question-prompt.md),
  [answer](260930e-figures-readability-deletes-with-their-wrapper-p1-4-question-sol.md)); taking
  rule C's row out of `WITHDRAWALS` turns that test and the bookkeeping test red.
- **The corpus**: rule C fires on one of the 35 fixtures, `quanta_year_physics`, and its output is
  **byte-identical** in both arms. The lead figure is a video player whose YouTube consent notice
  carries a *"privacy policy."* link, so the wrapper really is at risk — but the figure sits outside
  the article Readability selects. That is pinned in `tests/extract-protect.test.ts` rather than
  excluded, and `kept`'s comment says what it counts: a wrapper, not necessarily a picture.
- **The live pages through the shipping `readArticle`**, 2026-09-30:

  | page | figures with a picture, before → after | what fired |
  |---|---|---|
  | Nature `s41593` | 0 → **8** of 8 | furniture ×8 |
  | Substack (Raschka) | 14 → **23** of 23 | rule C, `kept` = 9 — exactly the nine that were lost |
  | Wolfram, Asterisk, Noema | unchanged | nothing |
