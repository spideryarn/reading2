# Figures with enough resolution to read

Status, 2026-09-11: **built, GPT Sol-reviewed, on `dev`, not deployed.** Cluster F's first stage in
[260908f](260908f-prioritised-spideryarn-codebase-improvements.md#f-give-figures-enough-resolution-to-read).
Its second stage (WebP/AVIF) is not this plan and was not started.

> TRIAL a supported candidate around 1,280px under the existing per-image and per-article byte and
> time caps, falling back to src when selection or fetch fails
>
> — Greg's answer to the F product question, 2026-09-11, relayed by the Overseer dispatch

## The problem

The assets step (stage 4.5, [article-images.md](../project/article-images.md)) hosts one URL per
`<img>`: its `src`. On publishers that treat `src` as a thumbnail and put the real picture in `srcset`,
we stored the thumbnail and threw the `srcset` away. The monkeys report
([SPIDERYARN-READING2-2B](../user-feedback/260907_0735-the-monkeys-illustration-does-not-load.md),
[260908a](260908a-the-monkeys-illustration-did-not-load.md#the-picture-we-serve-is-the-smallest-one-the-publisher-offers))
measured it: a 300 px image under a 659 px column, and a ⤢ with nothing to enlarge.

## What changed

- **`preferredCandidateOf`** ([`src/assets.ts`](../../src/assets.ts)) picks at most one candidate from
  the `<img>`'s own `srcset`: from a list of **widths**, the smallest at least 1,280 px wide, or the
  widest if none is; from a list of **densities** (added the same day — § Density descriptors,
  added below), the highest above 1× and at most 2×. It falls back to the `src` on anything else:
  widths mixed with densities, a candidate with no descriptor, `h` descriptors, parentheses,
  duplicate widths or densities, a density outside a bounded grammar, a relative,
  protocol-relative, `data:` or non-http candidate, an empty comma-delimited candidate, non-ASCII
  descriptor whitespace, or a list over 8 KB or 32 candidates. A sibling `<source>` is never read.
  If the choice *is* the `src` there is nothing extra to fetch.
- **`collectAssets`** ([`src/collect-assets.ts`](../../src/collect-assets.ts)) fetches that candidate
  first, through the same `fetchImpl` as the `src`, so the address guard, redirect checks and byte cap
  apply to it unchanged. It gets **one attempt**, because the `src` is its retry. Any failure — a
  refusal, a 404, over the cap, a format we do not host — and the `src` is fetched exactly as before.
  Both requests happen under the one `GATE` permit, one after the other, so concurrency still bounds
  requests in flight. A failed candidate is settled at once (reservation released, arrived bytes
  charged, a `too-large` charged whole), so the `src` gets what is left of the one article budget. The
  clock is checked between the two.
- **The manifest key is still the `src`.** The candidate goes in a new optional `from` on the stored
  entry. The reading view looks elements up by `src` and needed no change to find the bigger bytes:
  [`src/web/rehost.ts`](../../src/web/rehost.ts) changed in comments only.
- **Nothing is written into the blocks**, so block ids and extraction are untouched.
- The pipeline log line gains `fromSrcset`, the count of stored images that are a candidate.

### The `ASSETS_VERSION` decision

**Not bumped.** Instead the candidates go into `assetsInputHash` as a third element **that is absent
when no image has one**, so:

- an article with no qualifying `srcset` hashes exactly as before and re-fetches nothing;
- an article that has one now reads *not current* — since density descriptors count, that includes
  most Wikipedia articles — and the next run of the step **on that article**
  (a re-ingest, or someone re-running it) fetches the bigger picture. Nothing re-runs a stale step on
  its own; there is no scheduler ([cron-scheduler.md](../project/cron-scheduler.md)). So there is no
  automatic whole-library re-fetch, as the stage required.

Bumping the version would call every manifest in the library stale, including those the step would
rewrite identically. The test that pins the no-candidate hash to the old formula went red when the
third element was made unconditional.

### Passed over

- **Writing `from` into the `src` when our own delivery fails** (the `unverified` fallback in
  `rehost.ts`). That fallback keeps the publisher's `src` and drops every other candidate. Since the
  step may now have fetched the candidate rather than the `src`, the `src` left behind is no longer
  "the one URL we fetched". Writing `from` in instead would restore that sentence, but it puts a URL
  from the manifest into the DOM after `sanitizeArticle` has run, which is a second way past
  `stripOwnApiUrls` — and this path only runs when our own asset route has already failed. The
  comments now say what is true.
- **Rewriting Wikipedia thumbnail URLs to a chosen width** (`/500px-` → `/1280px-`). The biggest gain
  for Wikipedia, but URL surgery for one publisher; not taken (the Overseer, 2026-09-11).
- **A per-image wall clock across both requests.** The per-request timeout (15 s) and the article's
  180 s budget are unchanged. A candidate adds at most one 15 s attempt before the `src`'s own two, so
  one image's worst case goes from 30 s to 45 s. It is still inside the article budget, which is what
  binds.

## Evidence

**Tests.** `tests/figure-candidates.test.ts` (new) covers selection and every refused form, agreement
with the browser's `imageSourcesIn`, and the join: a manifest built by the real `collectAssets` from
the real monkeys markup, read by the real `rehostImages` for an owner and for a visitor. It asserts no
`asteriskmag.com` URL on either draw, that the object fetched is the bigger picture's, and the fallback
when the object is missing. `tests/collect-assets.test.ts` gains the fetch behaviour, including the
**real** `fetchAsset` refusing a candidate on a private address and one that redirects to one, then
falling back.

Watched red before the build (12 failures), and each guard checked by mutation — one change at a time,
the focused suites run, the file restored:

| mutation | what went red |
|---|---|
| manifest keyed on the candidate | the join (owner, visitor, fallback) and the keying test |
| candidate given two attempts | the one-attempt test |
| no clock check after the candidate | the clock test |
| candidate `too-large` refunded | the per-image-cap and shared-budget tests |
| a failed candidate keeps its reservation | the shared-budget test |
| candidates left out of the hash | the "changes when a candidate appears" test |
| the hash's third element made unconditional | the "unchanged for an article with no candidate" test |
| density descriptors accepted | the refusal test, and the hash test |
| candidates not checked with `isRehostableUrl` | the refusal test |
| widest chosen instead of smallest-above-1,280 | the selection test |
| the candidate URL read with `&amp;` left in | the entity test and the join |

Code review added one more red→green probe: leading, doubled and trailing commas, and non-ASCII
whitespace around a width descriptor, were accepted even though the policy says malformed lists fall
back whole. The refusal test failed before `widthCandidatesOf` was tightened and passed afterwards.

The same review made the public-boundary decision executable: `Assets` crosses the public DTO whole,
but its exact-key test did not exercise the new optional `from`. Adding a candidate URL to the fixture
made `tests/public-dto.test.ts` fail until `assets.entries[].from` was named as allowed. This publishes
no address absent from the payload already: `from` is the `<img srcset>` URL in `blocks[].html`.

**A real diagram and a real chart, normal and enlarged.** Two figures from Asterisk, the monkeys'
publisher: a diagram (*The Sweet Lesson of Neuroscience*, `graph_thought_assessors_update`) and a
text-heavy chart (*The Mystery in the Medicine Cabinet*, `dynomight_chart`). Each went through the real
`collectAssets` and the real guarded fetch into an in-memory bucket — once as published, once with the
`srcset` stripped (the old policy). Each was then drawn the way `prose.css` (column,
`max-width: 100%`) and `lightbox.css` (natural size, capped) draw it, in Chrome, on a 1280×900 desktop
at 2× and a 390×844 phone at 3×.

| figure | old: `src` | now: 1440w candidate | ratio |
|---|---|---|---|
| diagram | 300×287, **25.7 KB** | 1440×1380, **283 KB** | 11× |
| chart | 300×368, **51.5 KB** | 1440×1768, **554 KB** | 10.7× |

| drawn at (CSS px) | old | now |
|---|---|---|
| desktop column | 300 wide, both figures | 659, the full column |
| desktop ⤢ | 300 — the same as the column | 797 (diagram), 622 (chart; bound by height) |
| phone column | 300 | 358 |
| phone ⤢ | 300 | 374 |

**One visible side effect:** these publishers' `<img>`s carry no `width` attribute, so a figure that
sat at 300 px in the column now fills it. That is the point for a diagram. For a small decorative
picture it is a layout change a reader will notice.

**The difference is legibility, not polish.** At 300 px on the 3× phone the diagram's small labels
(*"Neocortex, Hippocampus, Striatum"*, *"Shapes future learning"*) are a blur that cannot be read; at
1,440 px every label is sharp. On desktop the chart's body text is soft and hard to read at 300 px in
the column, and crisp at 659. The ⤢ now enlarges something — before, it drew the thumbnail at the same
300 px. **So the gain is worth the bytes for figures like these, and the trial stands.**

The same publisher's other widths, for what a different target would cost (bytes downloaded
2026-09-11):

| | 300 | 600 | 840 | 1200 | 1440 | AVIF 1440 |
|---|---|---|---|---|---|---|
| diagram | 26 KB | 91 KB | 144 KB | 229 KB | 283 KB | 59 KB |
| chart | 51 KB | 157 KB | 241 KB | 410 KB | 554 KB | 146 KB |

What it costs is uneven. A diagram or chart is a few hundred KB. A **painting stored as PNG is the
expensive case**: the monkeys' 1,440 px PNG is 1.61 MB against 126 KB today (260908a's measurements),
and all of that goes through our bucket and to every reader. The per-image (16 MiB) and per-article
(64 MiB) caps are unchanged and bound the worst case. The AVIF column is what the second F stage could
save, and it is not this stage.

**Where it applies, in the local corpus** (2026-09-11): 153 `<img>` elements with a `srcset`, in 20
revisions. Only two publishers use width descriptors: noema (imgix) and Asterisk. Wikipedia — the
corpus's commonest source of diagrams — uses density descriptors, which the section below adds.
Substack's `src` is already its 1,456 px variant and the candidate would be the same URL, so nothing
changes there.

The comparison script is not committed; it sat in the session scratchpad. It is `collectAssets` plus
`playwright-core`, and the tables above are its output.

## Not done

- **No deploy**, and no re-run of the step on any existing article, local or production.
- **No real-browser check of the running app.** The reading view's code did not change (comments
  only), and the join is tested through the real `rehostImages`. The legibility comparison was drawn in
  Chrome using the app's own CSS rules, not inside the app.
- **Format support** (F's second stage).

## Density descriptors, added

The first version of this stage read width descriptors only, and so did not reach Wikipedia, which
marks every figure as a `src` plus `1.5x, 2x` — 250–500 px thumbnails in the local corpus. That was put
to Greg as the open question. **The Overseer decided it the same day**, under Greg's standing *"use
your judgment, keep things simple"*: take the `2x` too, since it is the small change and Wikipedia is
where most of the corpus's diagrams come from. Rewriting Wikipedia's thumbnail URLs to a chosen width
was not taken.

- **The rule:** from a list of densities, the highest above 1× and at most 2×. So `1.5x, 2x` gives the
  `2x`, a lone `1.5x` gives that, and a lone `3x` gives nothing. A density is relative to the `src`,
  whose width the markup does not state, so there is no pixel target; 2× is the bounded step.
- **The grammar** is a bounded subset of HTML's floating-point number (no sign, no exponent, at most two
  integer and three fractional digits). A list that mixes widths and densities is refused whole, as
  are duplicate densities.
- **Everything else is the width path's**: the same fetch, guards, single attempt, fallback, budget and
  `from`. The collect-assets test for a `2x` checks the success and the fallback.
- **Cost, measured:** Wikipedia's *Tenets of open science* diagram, 250 px **20.6 KB** → 500 px
  **47.8 KB** (2.3×). A `2x` doubles the width, so it stays well short of 1,280 px; the gain is a sharp
  figure at column size on a 2× screen, and a ⤢ that shows twice the pixels.
- **Staleness:** most Wikipedia articles now carry a candidate, so their `assets` step reads stale and
  picks up the `2x` the next time it runs on them. Nothing re-runs it on its own.
- Wikipedia markup whose `srcset` is protocol-relative (`//upload…`, 14 of 70 blocks in the local
  corpus) has a protocol-relative `src` too, so those images are not hosted at all. Unchanged.

Red first (four new tests failed), then five mutations, each turning its own test red: the 2× cap
removed, 1× accepted, mixed kinds accepted, the lowest density taken, and an exponent accepted.
