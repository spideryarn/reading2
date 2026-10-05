# An arXiv link of any shape imports the paper, through a source resolver other sources can join

Status as of 2026-10-05: **plan, not built** — evidence: no `src/paper-sources.ts` in the tree. The
eval it rests on is run and written up in
[261005e](../investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md).

Report `spya-ayettj` (Sentry SPIDERYARN-READING2-DH), from Greg, 2026-10-05. This plan is **part 1 of
2**: arXiv only. Part 2, the other paper sources, is queue entry `qi-5m89dnxa` and a separate
session; it adds sources to the mechanism built here.

## Goal

> If I include a link like this, the right move is to grab either the html or the pdf, rather than
> reading in this exact link.
>
> `https://arxiv.org/abs/2608.13566?utm_campaign=ai-tinkerers__paperclub__…&utm_source=paperclub`
>
> 1) run evals to figure out whether html or pdf is better. Then even if someone gives us a link like
> this, automatically download the actual paper (either html or pdf as you decide). Arxiv is a common
> source, so it would be nice to optimise the import for it to be correct. And ideally to make it
> cost-efficient/quick.
>
> — Greg, 2026-10-05, report spya-ayettj

**What happens today** (reproduced with `evals/arxiv-html-vs-pdf/abs-repro.ts`, free): that link
imports arXiv's *abstract page*. The article is 304 words in 8 blocks: the title, the author line,
"View PDF HTML (experimental)", the abstract, the subject line and the submission history. The
paper itself is 22 pages. Nothing fails, and the article carries the paper's title, so it looks
like the paper.

**What should happen:** an arXiv link of any shape imports the paper. The shapes: `abs`, `pdf`
(with or without `.pdf`), `html`, old-style ids (`hep-th/9901001`), with or without a version,
with tracking parameters, on `arxiv.org`, `www.arxiv.org`, `export.arxiv.org` or
`browse.arxiv.org`, and arXiv's own DOI (`doi.org/10.48550/arXiv.<id>`).

## The decision the eval makes: HTML first, the PDF when arXiv has no HTML

arXiv serves most papers three ways: the abstract page, a PDF, and (for papers whose TeX source
its converter could handle) an HTML rendering at `arxiv.org/html/<id>`. Our pipeline already has
an extractor for each of the last two: a web page goes through Readability, which is free and
takes seconds; a PDF is read by a model, page by page, which costs money and takes a minute or
more.

**HTML first; the PDF when arXiv answers that it has no HTML.** The numbers, the per-paper
judgements and what each arm gets wrong are in
[261005e](../investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md),
and the summary is § What the eval found below. The HTML arm wins on cost, on time and, once four
faults in our own extractor are fixed, on correctness; fixing them is a stage of this plan.

**The order the stages land in matters.** The resolver lands first because part 2 builds on it and
starts in a few hours. Between that push and the four fixes, an arXiv paper with aligned equations
imports with those equations in fragments. That is still far better than the abstract page it
imports as today, and the fixes follow in the same session.

## Design

One new module and three places that ask it.

```
 pasted address
      │
      ▼
 normaliseUrl ──► resolvePaperSource(url) ──► null: not a source we know. Nothing changes.
                         │
                         ▼
                  ResolvedPaper {
                    source:       "arxiv"
                    id:           "2608.13566"          (version kept if the link had one)
                    canonicalUrl: "https://arxiv.org/abs/2608.13566"
                    slug:         "arxiv-2608-13566"
                    candidates:   [ { url: ".../html/2608.13566", expect: "html" },
                                    { url: ".../pdf/2608.13566",  expect: "pdf"  } ]
                  }
```

### `src/paper-sources.ts`: the registry

Pure string work: no network, no Node APIs, so the add page in the browser can import it.

```ts
export interface PaperSource {
  name: string;
  /** A parsed http(s) address → the paper it names, or null when it is not one of ours. */
  resolve(url: URL): ResolvedPaper | null;
}
const SOURCES: readonly PaperSource[] = [arxiv];
export function resolvePaperSource(url: string): ResolvedPaper | null;
```

**Adding a second source is adding one object to `SOURCES`** and its tests. The three callers
below do not change. That is the whole of what part 2 needs from this plan.

`candidates` is an ordered list rather than one address because the fallback is part of what a
source knows: arXiv's is "the HTML, else the PDF". A source with only a PDF lists one.

The arXiv id shapes are not written a fifth time. `ARXIV_ID_SHAPE` and the path patterns in
`src/cited-in-spideryarn.ts` § `identityOf` already recognise `abs`, `html` and `pdf` paths on
three hosts; the id pattern moves into the new module and `cited-in-spideryarn.ts` and
`paper-text.ts` § `arxivPdfUrl` read it from there. (`src/citations.ts` and
`src/article-registry.ts` match ids inside prose, which is a different job, and stay.)

### Caller 1: what the article is known by (`src/ingest.ts`)

- **`sourceAddress(input)`**, new: `normaliseUrl`, then the resolved paper's `canonicalUrl` when
  there is one. `POST /api/jobs` (`parseJobRequest` in `src/routes.ts`), the add page
  (`src/web/AddPage.tsx`) and `npm run ingest` (`scripts/stage.ts`) call it where they call
  `normaliseUrl` today (the CLI calls neither today). So the job's `url`, `meta.url`, the masthead's
  source link and the metadata page all say `https://arxiv.org/abs/2608.13566`: the address a
  person cites, with the tracking parameters gone.
- **`urlKey`** resolves too, so *"do we already have this?"* answers the same for every shape,
  including an article already on the shelf under its `pdf/` address. A version is part of the
  identity: `2608.13566` (the latest) and `2608.13566v1` stay two articles, because merging two
  different texts is the expensive mistake `urlKey`'s own header rules out.
- **`slugFromUrl`** uses the resolved `slug`. Today `abs/2608.13566` slugs as `arxiv-2608`: the
  extension-stripper reads `.13566` as a file extension.

`normaliseUrl` itself does not change. Its contract is that it never turns an address into a
different address, and this does.

### Caller 2: what is fetched (`src/pipeline.ts`, the `fetch` step)

```
 candidates = resolvePaperSource(ctx.url)?.candidates ?? [{ url: ctx.url }]
 for each candidate, in order:
     doc = fetchDocument(candidate.url, { signal })     ← unchanged, every defence on every hop
     not the last candidate, and it failed or is the wrong kind → try the next
     otherwise → this is the document (or, for the last one, this is the failure)
```

- **`fetchDocument` is called exactly as today**, once per candidate. The SSRF guard, the pinned
  dispatcher, the redirect cap, the byte cap and the type sniff run on each. No defence is edited,
  and the candidate addresses are fixed strings on `arxiv.org` built from a matched id, never
  text copied from the pasted address.
- **A candidate is skipped** when it throws a `FetchFailure` (arXiv answers 404 for a paper with
  no HTML) or when the bytes are not the kind the candidate promised. A Stop or a deadline is not
  skipped past: if `ctx.signal` has fired, the failure is thrown as it is today.
- **The last candidate is accepted or fails exactly as a pasted address does today**, so the
  reader-facing failure sentences are unchanged.
- It resolves from `ctx.url` in the step, not only at the route, so a retry, a refresh and a job
  queued by any other path fetch the paper too.
- The step's detail says which was used (`312 KB, arXiv HTML` / `1,040 KB, arXiv PDF`) and the log
  line gains `source` and `format`. No address is logged.

### Caller 3: relative links (`src/extract.ts` § `runExtract`)

arXiv's HTML names its figures relatively (`<img src="2608.13566v1/x1.png">`), so they resolve
correctly against `arxiv.org/html/2608.13566` and wrongly against `arxiv.org/abs/2608.13566`.
Stage 2 uses the *job's* address as the base today
([fetching.md § What's still loose, item 1](../project/fetching.md#whats-still-loose)).

`runExtract` gains `sourceUrl`: the address the article is known by, written to `meta.url`. Its
existing `url` stays the base that relative links resolve against, and the `extract` step passes
**the manifest's final URL** for it (the address the bytes actually came from, after redirects)
and the job's address as `sourceUrl`. That closes the loose end for every fetched page, not only
arXiv: after a redirect, relative links have been resolving against the wrong address.

**This is the one change that reaches articles that are not arXiv's.** It changes nothing until an
article is refreshed, and then only for a page that was redirected *and* uses relative links, where
today's answer is wrong. Named here so it is decided rather than inherited.

## What is not in this plan

- **Any source but arXiv** — part 2.
- **Following a redirect into a source.** A shortener or a `doi.org` link that *redirects* to arXiv
  is resolved by the fetcher, after this resolver has looked. Only arXiv's own DOI form is
  recognised, because that is string work. Re-resolving on the final address is one more hop and
  is the natural next step for part 2, where `doi.org` leads to most publishers.
- **ar5iv, alphaXiv, Hugging Face paper pages.** Other sites' renderings of the same papers. Part 2
  can decide whether they map to arXiv.
- **Re-importing articles already on the shelf.** An article imported from an `abs` link before this
  stays an abstract until it is refreshed; pasting the link again adopts it, as any address already
  on the shelf is adopted. No backfill: production data is the reader's.
- **Tidying arXiv's HTML beyond the four faults that lose content** — the cosmetic ones are listed
  in 261005e.
- **A completeness cross-check of the HTML against the PDF** — 261005e § What was decided.

## The simpler option passed over

**Rewrite `abs` to `pdf` and stop** — one function, and `paper-text.ts` § `arxivPdfUrl` already
does it for cited papers. Passed over because the eval is what Greg asked for and it does not say
"PDF": see § What the eval found. The fallback list costs one loop.

**Rewrite at the route only**, leaving the fetch step alone (make the job's `url` the HTML address).
Passed over because the fallback needs the fetch step anyway (only the fetch can discover there is
no HTML), and because the article would then be known by its `html/` address, which is not the one
people cite or paste, so the dedup would still need the resolver.

## Stages

### Stage: the eval (done before this plan was reviewed)

- [x] Reproduce: what the `abs` link imports today.
- [x] `evals/arxiv-html-vs-pdf/run.ts`: both arms through our own extractors, on six papers.
- [x] Judge each paper's two arms against the paper: text, maths, figures, tables, references.
- [x] Write it up in `docs/investigations/261005e-…`, with what it cost ($0.62).

### Stage: the resolver and its three callers

- [ ] Tests first, red: `tests/paper-sources.test.ts` — every link shape in § Goal resolves to the
      same paper; near-misses do not (`arxiv.org/list/…`, `arxiv.org/abs/` alone, `notarxiv.org`,
      `arxiv.org.evil.example`, an id with trailing junk, a userinfo address).
- [ ] `src/paper-sources.ts`, and the id pattern's other readers pointed at it.
- [ ] Tests first, red: `sourceAddress`, `urlKey` and `slugFromUrl` over the same shapes
      (`tests/ingest.test.ts`).
- [ ] Tests first, red: the fetch step over an injected fetch — HTML served → HTML stored; HTML 404
      → PDF stored; HTML address serving a PDF → next candidate; both fail → the PDF's failure; Stop
      during the first → no second request; a non-source address → one request, as today.
- [ ] Tests first, red: `runExtract` with `sourceUrl` — `meta.url` is the article's address and a
      relative `<img>` resolves against `url`.
- [ ] Build the three callers. `npm run typecheck`, the touched test files, `npm run lint` on them.
- [ ] Mutate: reverse the candidate order, drop the kind check, drop the signal check — each must
      turn a test red.
- [ ] One real import, locally, of Greg's link, end to end through the queue; a Sonnet subagent
      opens it in a browser and checks the figures load, the maths draws and the source link reads
      `arxiv.org/abs/…`. And one of a paper with no HTML.
- [ ] Docs: `fetching.md` (a new section, and loose end 1 closed), `content-extraction.md`,
      `ingest-queue.md`, `architecture.md` § Shared code, `help-page.md`/`/help` if it describes
      what pasting a link does.
- [ ] GPT Sol code review (write-capable, fixes inside the stage), gates, commit, push to `dev`.

### Stage: the HTML arm's four faults (LaTeXML pages)

All four are in stage 2's preparation of the page, before Readability, and apply to any LaTeXML
page (arXiv's HTML and ar5iv), recognised by its own class names, never by the address. Each is a
rewrite that **leaves the page as it was when its exact expected shape does not hold**, the rule
`src/maths-import.ts` already works to. A new module, `src/latexml.ts`, called from
`prepareDocument` in `src/extract.ts`; fix 4 goes where Readability's keep-list already lives
(`src/protect.ts`).

Fixtures are cut from the real pages the eval fetched (the smallest element that shows the fault,
with the prose replaced), under `tests/fixtures/latexml/`.

- [ ] **1. An aligned equation is one display formula.** A `table.ltx_equationgroup` (and a
      multi-row `table.ltx_equation`) whose cells hold only inline formulas becomes one
      `\[\begin{aligned} a &= b \\ &+ c \end{aligned}\]`, cells joined with `&` and rows with `\\`,
      the leading `\displaystyle` of each cell dropped, in an element that keeps the table's `id`
      (cross-references point at it). The equation number is kept as text beside it, as a
      single-line equation's is today. Only if the reading view would draw the result
      (`texWouldDraw`); otherwise the table is left alone. Red first on equation (1) of
      `2605.20355v1`.
- [ ] **2. An SVG plot in an `<object>` is an image.** `object[type="image/svg+xml"][data]` inside a
      `figure.ltx_figure` becomes `<img src=…>` with its width and height, so stage 4.5 hosts it like
      any other figure. First check that stage 4.5 accepts an SVG at all (`src/assets.ts`,
      `src/collect-assets.ts`); if it refuses SVG on purpose, that refusal is a defence and stays,
      and this fix is written up instead of built.
- [ ] **3. A code listing is one code block.** `.ltx_listing` with `.ltx_listingline` children
      becomes a `<pre>` holding the lines' text joined with newlines.
- [ ] **4. A data table inside a list item survives.** `table.ltx_tabular` is stamped for
      Readability to keep, the way `src/protect.ts` already stamps other authored structure. Red
      first on the introduction of `2610.01658v1`.
- [ ] Re-run `evals/arxiv-html-vs-pdf/run.ts --html-only` on the five papers; the block counts and
      the outline show each fault gone (fragmented equations, pictureless figures, one-line code
      blocks, the missing tables), and the corpus fixtures' extraction is unchanged
      (`npm test` covers them).
- [ ] Docs: `content-extraction.md`, `maths.md`.
- [ ] GPT Sol code review, gates, commit, push.

Not built, and named in 261005e: the author block, theorem labels as headings, "Cited by" text in
reference entries, boxed passages drawn as SVG.

### Stage: bookkeeping

- [ ] `docs/user-feedback/261005_1912-….md`, `feedback-endings.ts`, `overseer-queue.ts done`.

## What the eval found

Six papers, both arms, 2026-10-05; the detail is in 261005e.

- **Cost and time:** the HTML arm's extraction is free and took 3–41 s; the PDF arm's cost
  $0.09–0.13 and took 92–164 s. The eval spent $0.62.
- **Correctness:** text is a draw. The HTML arm is better on tables (the author's own, with header
  rows), figures (real images), references (the whole list) and the symbols in maths (the author's
  TeX). Judges preferred the HTML arm on three of the four papers judged so far.
- **About one recent paper in nine has no HTML** (4 of 36 probed): arXiv answers 404, and the PDF is
  the only option.
- **Four faults in our own web extractor** make the HTML arm lose content, and the paper the judge
  preferred as a PDF lost on two of them. They are stage "the HTML arm's four faults" below.
- **One fault is arXiv's:** its converter dropped one figure of 18. Not detectable from the HTML
  alone; a cross-check against the PDF is named in 261005e and not built.

## Questions and decisions

Nobody is reading the chat, so decisions taken on Greg's behalf are recorded here.

- **A version in the link is kept** (`…v1` imports v1 and is a different article from the
  unversioned link, which imports the latest). The alternative, always the latest, would change
  what a deliberate `v1` link means.
- **A `pdf/` link gets the HTML too**, when there is one. Greg asked for the better format to be
  chosen for him "even if someone gives us a link like this", and the choice is about the paper,
  not about which button on arXiv's page the link was copied from.

## Reviews

- Plan review, GPT Sol: *(pending)*
- Code review, GPT Sol: *(pending)*
