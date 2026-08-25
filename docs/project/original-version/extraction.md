# Extraction — Readability in production, and one important correction

Their content-extraction stage is the direct ancestor of ours
([content-extraction.md](../content-extraction.md)). Most of what is worth taking is the
**sanitisation allow-list** and a **quality-measurement harness**. One widely-repeated claim about
their architecture turns out not to be true of the code, and that correction is the most valuable
thing on this page.

Reference docs: `docs/reference/HTML_CONTENT_PROCESSING_OVERVIEW.md`,
`HTML_SANITISATION_AND_PRETTIFICATION.md`. Code: `lib/services/html-document-processor.ts`,
`app/api/extract-url/route.ts`, `lib/utils/html-sanitizer.ts`.

## The correction: the escalation ladder was never built

Their overview doc describes a three-tier ladder — Readability, then a headless browser for
JS-heavy or infinite-scroll pages, then AI transcription — and quotes timings for each. **This
folder previously repeated that as fact.** Checking the code: there is no Puppeteer or Playwright
import anywhere in `app/api/extract-url/route.ts`, and no code path that escalates between methods.

What actually exists is simpler and, on reflection, better: **the user picks a method up front**
(`readability`, `ai-transcription`, `as-is`, or `vision-ai` for PDFs), and each either succeeds or
returns a structured error naming what to try next:

```js
if (!article) {
  // Readability failed - return error instead of falling back
  return createProblemDetail({
    type: '/errors/readability-failed',
    status: 422,
    detail: URL_EXTRACTION_CONFIG.ERROR_MESSAGES.READABILITY_FAILED,
    suggested_method: 'ai-transcription'
  })
}
```

So the "no automatic fallback" policy is real and worth keeping — **fail with an error that names
the alternative, rather than quietly trying something else.** A silent fallback means you can never
tell which method produced the text you're reading, and a 30-second AI transcription firing
automatically because Readability hiccuped is a surprise nobody asked for. This is the same instinct
as [CODING_PRINCIPLES](process-and-docs.md#their-coding-principles): fail fast and fatally, no
fallbacks masking bad input.

But the *ladder* is aspiration. The timings quoted for it — Readability ~100–400ms, Puppeteer 2–5s,
LLM 10–30s — are only verifiable for the paths that exist. Treat the Readability and
AI-transcription numbers as plausible and the browser-escalation numbers as unbuilt.

**This is a pattern, not a one-off.** Their prompt caching
([prompt-caching.md](prompt-caching.md)), their mobile support
([reading-view-ui.md § Mobile](reading-view-ui.md#mobile)), their typography settings UI
([typography.md](typography.md)) and their skeleton screens
([design-system.md](design-system.md)) are all documented in the present tense and not built. When
reading anything in that repo, **check the code before believing the doc**. Ours has the same risk
and the same cure — [testing.md](../testing.md) and the doc-link test exist so that our docs are
checkable rather than merely confident.

## The fetch, and one hard-won fix

The fetch lives in `app/api/extract-url/route.ts` — `fetchWebpageContent` and `fetchPdfContent` —
not, as this page once said, in `lib/utils/readability-extractor.ts`, which never fetches anything
and only wraps `@mozilla/readability` over `jsdom`. Three guards there are worth copying: a **size
cap** (`MAX_HTML_SIZE_BYTES = 4 * 1024 * 1024`), a **30-second timeout** (`FETCH_TIMEOUT_MS`, flat,
the same value for the HTML fetch, the PDF fetch and the HEAD-based content-type sniff — this page
previously said "around 20 seconds", which was wrong), and **browser-like `User-Agent` and `Accept`
headers**, because plenty of publishers serve something different to something that announces itself
as a script.

**Take the shape of all three and none of the numbers.** Our cap is 32 MB, because one of the three
articles Greg named as a hard case is a 4.9 MB PDF that theirs would have refused
([fetching.md](../fetching.md#size-and-the-header-that-lies-about-it)). And their size check reads
`Content-Length` first — which describes the *compressed* size, so it is a check on the wrong
number.

And one fix nobody would guess in advance: `lib/server/setup-ssl-root-cas.ts` patches Node's root
certificate store, **because some university servers serve incomplete certificate chains**. Browsers
paper over this by fetching the missing intermediate; Node does not, so the fetch just fails. The
URL that taught them this is `sas.upenn.edu/~cavitch/pdf-library/Nagel_Bat.pdf`, and they have a
live integration test asserting a 502 against it.

> **Two corrections, both found on 2026-08-25 when we rebuilt this stage.** First, the URL now
> fetches cleanly — the server was fixed at some point in the intervening year, and their test is
> asserting a failure that no longer happens. Second, and more useful: **their fix has rotted.** The
> `ssl-root-cas` package it depends on was last published around 2019. `NODE_EXTRA_CA_CERTS` is not
> a substitute, because it adds trusted *roots* and the missing certificate is an *intermediate*.
> There is no maintained turnkey answer, so ours doesn't try to repair the chain — it explains it,
> and says the page will look fine in a browser.
> [fetching.md § Certificates](../fetching.md#certificates-and-the-case-that-looks-like-it-works)
> has the full comparison. This is the folder's own rule turned on itself: **check the code before
> believing the doc**, including when the doc is one of ours.

## Sanitise once, at import — never at render

A deliberate reversal on their part: sanitisation used to happen at display time and was moved to
storage time. Two reasons, and both hold here.

**Performance** — sanitising once beats sanitising on every view, obviously.

**Consistency** — with display-time sanitising, what is stored and what is shown can differ, and any
second consumer (an export, an API, another view) gets whatever it remembers to do for itself. One
that forgets is a hole, and nothing reports it.

Our pipeline already has this shape: stage 2 writes a sanitised `article.html` and everything
downstream reads that ([architecture.md § Pipeline](../architecture.md#pipeline)). Worth knowing it
is a decision someone else made the other way first.

**Prettification is behind a feature flag** (`ENABLE_HTML_PRETTIFICATION`) that falls back to the
sanitised-but-unprettified HTML on any error. You do not build a fallback like that unless
prettification broke something once.

## Sanitisation: the allow-list is the valuable part

`lib/utils/html-sanitizer.ts`, built on DOMPurify with `USE_PROFILES: { mathMl: true, svg: true,
html: true }`. What they explicitly **add back**, because the defaults drop it and academic prose
needs it:

- **Structure** — `article`, `section`, `header`, `main`, `aside`, `footer`, `figure`, `figcaption`
- **MathML** — the semantic wrappers (`semantics`, `annotation`, `annotation-xml`) plus the full
  element set (`mrow`, `mi`, `mn`, `mo`, `mfrac`, `msub`, `msup`, `msubsup`, `munder`, `mover`,
  `munderover`, `mtable`, `mtr`, `mtd`, `mroot`, `msqrt`, `mtext`)
- **Citation and reference** — `cite`, `abbr`, `dfn`, `time`, and `data-doi`, `data-ref`,
  `data-cite`, `data-bibref`
- **Code** — `code`, `pre`, `samp`, `kbd`, `var`
- **Tables** — `colspan`, `rowspan`
- **Accessibility** — `aria-label`, `aria-describedby`, `aria-labelledby`, `role`, `title`, `lang`,
  `dir`

Stripped: `script`, `object`, `embed`, `applet`, `iframe`, `form` and every form control, `meta`,
`link`, `base`, `frame`, `frameset`; all `on*` handlers individually; `javascript:`, `vbscript:` and
`data:text/html` protocols; `formaction`, `srcdoc`.

**Worth copying wholesale as a starting point.** It is a year of hitting real pages distilled into a
list, and every entry on it is something that was missing once. Two notes for us:

- Their prettifier keeps `pre`, `code` and math **unformatted** — pretty-printing HTML inside a
  `<pre>` changes what the reader sees. Anything that reindents our `article.html` must do the same.
- They allow `data-*` through on purpose, for publisher metadata. We assign our own `data-` free
  ids, so ours needs thought rather than a copy: an inherited `data-` attribute must never be
  confused with one of ours ([block-ids.md](../block-ids.md)).

## Quality measurement: real, and worth rebuilding

`lib/testing/html-content-fidelity-generator.ts` plus `scripts/analyze-content-fidelity.ts` is
implemented and genuinely useful — unlike the DeepEval material in
`LLM_EVALUATION_FRAMEWORKS_FOR_CONTENT_EXTRACTION.md`, which is unbuilt research.

The generator builds synthetic hard documents — an academic paper with MathML, tables and citations;
a news article with awkward layout — each carrying typed `ContentCheck`s
(`exact_text`, `element_count`, `attribute_value`, `structure_intact`, `mathematical_equation`,
`data_integrity`), every one flagged critical or not. The scorer is a plain weighted average:

```js
const contentPreservation = Math.min(100, textSimilarity * 100)
const structuralIntegrity  = Math.min(100, structuralSimilarity * 100)
const dataAccuracy = 100 - (criticalFailures / totalChecks * 100)
const ratioScore = contentRatio >= 0.5 && contentRatio <= 1.5 ? 100 :
                   contentRatio >= 0.3 && contentRatio <= 2.0 ?  80 : 60

const overall = contentPreservation * 0.4 + structuralIntegrity * 0.2 +
                dataAccuracy * 0.3 + ratioScore * 0.1
```

`contentRatio` is extracted length over original length — a cheap two-sided sanity check that
catches **both** failure directions: Readability eating half the article, and Readability dragging in
the nav and the comments. Run by hand, not in CI, and deliberately so: it is a human-in-the-loop
instrument, not a gate.

**Take the two-sided ratio check now, cheaply.** It is a handful of lines and it catches the extraction
failure that is otherwise hardest to notice — a page that extracted *something*, so nothing errored,
but not the article. That is a textbook [silent success](../../reusable/silent-success.md), and
[testing.md](../testing.md) is the right home for it. The weighted score is worth having later, when
there is more than one article to compare.

## Keep the untouched original

Their storage layout is worth copying wholesale in one respect: **the raw fetched HTML or PDF is
kept in storage, before any processing**, specifically so a document can be re-processed later
without re-fetching it.

That is cheap insurance and it gets more valuable over time — the URL may be paywalled, changed, or
gone by the time you want to re-extract, and re-extraction is exactly what happens when the
extractor improves. We already do this (`data/<slug>/raw.html`); it is worth stating as a rule
rather than leaving it as a coincidence of the pipeline's shape.

The rest of their schema is a database's business, with one idea that transfers: **AI output lives
in a separate `document_enhancements` table, keyed `(document_id, type, subtype)` — overlays on the
document, never inline mutations of its HTML.** That is our `tree.json` / `arc.json` /
`comments.json` layout in database form, arrived at independently, and it is the same reasoning:
regenerating an overlay must never be able to damage the thing it overlays
([granularity-zoom.md § The arc](../granularity-zoom.md#the-arc)).

## Document lifecycle: atomic, no "processing" state

There is no status column on their `documents` table. The row is written **once, at the end**, after
sanitisation, prettification, id assignment and storage have all succeeded. There is no partially
processed document visible anywhere.

The reader sees a single blocking screen with a method-aware caption — *"Extracting content with
Mozilla Readability…"*, *"Processing with LLM transcription…"* — and then either a finished document
or a structured error suggesting the next method. No incremental progress inside one extraction.

**Both halves are right for us.** Write the artefact atomically or not at all — a half-written
`blocks.json` that later stages happily consume is the worst possible outcome. And name the step in
the progress text: "Extracting with Readability" tells the reader what is slow and what might fail,
where "Loading…" tells them nothing
([design-system.md § Loading](design-system.md#loading-states)). Our
[`src/ingest.ts`](../../../src/ingest.ts) shows the reader the exact commands about to run, which is
the same idea taken further.

## PDFs: out of scope, but the lesson transfers

Four generations, documented across `PDF_TO_HTML_*.md` and `PDF_UPLOAD_PIPELINE*.md`: v1 plain LLM
transcription; v2 PDF → per-page PNG → vision model per page ("functional but expensive", their
words); v3 — the current default — handing the PDF **natively** to a multimodal model with no image
conversion step, which also yields bounding boxes.

Three lessons that survive the change of subject:

1. **Don't parse structurally when a multimodal model will read it.** They tried classic parsing and
   page-image-plus-vision first, and converged on giving the model the bytes.
2. **Infrastructure constraints beat quality arguments.** GROBID and PyMuPDF need native system
   dependencies that don't run on Vercel, so they were ruled out regardless of how good they were.
   Worth remembering the next time a library is chosen on merit alone — see
   [third-party-library-selection.md](../../reusable/third-party-library-selection.md).
3. **They kept both branches** rather than resolving cost-versus-fidelity once. The expensive
   page-image pipeline is still there as the high-quality option. Sometimes the honest answer is two
   paths and a choice, which is the same shape as their extraction methods above.

## What they never solved, and we did

Two gaps, both confirmed in their code rather than inferred:

- **No charset handling at all.** `response.text()` throughout, which assumes UTF-8 always. A page
  declaring Shift_JIS only in a `<meta>` tag came through as mojibake, silently.
- **Brittle error classification.** Their test for a TLS chain problem was
  `error.message === 'fetch failed'` — which is undici's wrapper for *every* connection failure, so
  it matched DNS failures and refused connections too. The outer handler matched on
  `.includes('rate limit')` and `.includes('timeout')`. Copy the *shape* — typed Problem Details
  with distinct error types — and none of the string-sniffing.

Both are handled in [fetching.md](../fetching.md), the second by reading `err.cause.code`, which is
the only place the difference actually lives.

## See also

- [overview.md](overview.md) — the map to that codebase
- [../fetching.md](../fetching.md) — our stage 1, and the evidence behind every number in it
- [../content-extraction.md](../content-extraction.md) — our Readability stage
- [ids.md](ids.md) — what gets attached to the elements this stage produces
- [../testing.md](../testing.md) — where a fidelity check would live here
- [../../reusable/silent-success.md](../../reusable/silent-success.md) — the failure mode the ratio check catches
