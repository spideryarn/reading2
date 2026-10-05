# An arXiv link of any shape imports the paper, through a source resolver other sources can join

Status as of 2026-10-05: **plan, revised after GPT Sol's first review, not built** — evidence: no
`src/paper-sources.ts` in the tree. The eval it rests on is run and written up in
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
and the summary is § What the eval found below. The HTML arm wins decisively on cost and time. On
correctness it is better on tables, references and the symbols in maths, and worse wherever one of
seven faults in our own web extractor bites; fixing those is a stage of this plan.

**HTML-first is switched on only when those fixes are in** (Sol's F10). The resolver lands first,
because part 2 builds on it and starts in a few hours, with arXiv's candidate list holding **the
PDF only**. That already fixes Greg's report: the link imports the paper, by the path a pasted PDF
link takes today. The commit that puts the HTML candidate in front is the one that carries the
fixes and the re-run that shows them working.

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
                    source:      "arxiv"
                    versionedId: "2608.13566"       (the version kept if the link had one)
                    workId:      "2608.13566"       (never a version)
                    key:         "arxiv.org/abs/2608.13566"
                    slug:        "arxiv-2608-13566"
                    candidates:  [ { url: ".../html/2608.13566", expect: "html", marker: "ltx_document" },
                                   { url: ".../pdf/2608.13566",  expect: "pdf" } ]
                  }
```

### `src/paper-sources.ts`: the registry

Pure string work: no network, no Node APIs, so the browser can import it.

```ts
export interface PaperSource {
  name: string;
  /** A parsed http(s) address → the paper it names, or null when it is not one of ours. */
  resolve(url: URL): ResolvedPaper | null;
}
const SOURCES: readonly PaperSource[] = [arxiv];
export function resolvePaperSource(url: string): ResolvedPaper | null;
```

**A source whose paper and candidate addresses can be read off the pasted address is one object in
`SOURCES`**, and the three callers below do not change. That is what part 2 gets. A source that is
only discovered *after* a fetch (a `doi.org` link that redirects to a publisher) is not expressible
here and is not built: it needs a second look at the fetched document's final address, which is a
change to the fetch step, and part 2 decides whether it wants one (Sol's F4).

`candidates` is an ordered list rather than one address because the fallback is part of what a
source knows. Each candidate says what kind of document it must be (`expect`) and, for HTML, a
string the page must contain to count as the paper (`marker`), so an error page served with a 200
is not taken for one.

**A source matches an origin, not a hostname** (Sol's F5): http or https, no credentials, no
non-default port, then host and path. `arxiv.org:444` is not arXiv.

**Two ids, because two jobs want different ones.** An import keeps the version (`versionedId`): a
link to `v1` is a link to what `v1` says. Matching a citation to an article ignores it (`workId`),
as `identityOf` in `src/cited-in-spideryarn.ts` does today and its tests require. The id pattern
and the arXiv DOI form move into the new module; `identityOf` and `paper-text.ts` § `arxivPdfUrl`
read them from there and keep their behaviour. (`src/citations.ts` and `src/article-registry.ts`
match ids inside prose, which is a different job, and stay.)

### Caller 1: is this the same article? (`src/ingest.ts`)

- **`urlKey`** answers with the resolved paper's `key` when there is one. So *"do we already have
  this?"* is the same answer for every shape, including an article already on the shelf.
  A version is part of the key: `2608.13566` (the latest) and `2608.13566v1` stay two articles,
  because merging two different texts is the expensive mistake `urlKey`'s own header rules out.
- **`slugFromUrl`** uses the resolved `slug`. Today `abs/2608.13566` slugs as `arxiv-2608`: the
  extension-stripper reads `.13566` as a file extension.
- `normaliseUrl` does not change. Its contract is that it never turns an address into a different
  address.

**What the article's address is afterwards** (Sol's F2). The store keeps one address per article:
`article_revisions.final_url`, where stage 1's redirects ended. `meta.url`, `urlForSlug`, the
shelf lookup and the masthead's source link all read it, and stage 2 cannot overwrite it
(`META_COLUMNS` in `src/store/artifacts-pg.ts`). So after this plan an arXiv article's address is
the one its text came from: `arxiv.org/html/2608.13566`, or `arxiv.org/pdf/…` when there was no
HTML. That is why `urlKey` has to resolve: it is what makes that address and a freshly pasted
`abs` link one article. **The source link therefore opens arXiv's HTML or PDF, not the abstract
page.** Making it the abstract page needs a second address column and every reader of the first
taught which one it wants; it is in § Questions and decisions for Greg, not built.

**Jobs already queued when this deploys** (Sol's F1). A job row stores the `urlKey` it was queued
with. A job queued from a `pdf/` link before the deploy has the old key; if the same reader pastes
the `abs` link while it is still running, recomputing the old job's key with the new code would
match it, adopt its slug, and queue a second job on the same article that the stored keys cannot
recognise as the same work — a second slot charged. So the in-flight lookup
(`inFlightSlugForUrlKey` in `src/jobs.ts`) compares what an active job was **queued** as, not a
recomputation: it uses the unresolved key of the job's address. For that to match every new job,
the address a job is queued with is the resolved paper's canonical address:

- **`sourceAddress(input)`**, new in `src/ingest.ts`: `normaliseUrl`, then
  `https://arxiv.org/abs/<versionedId>` when the address resolves. `parseJobRequest`
  (`src/routes.ts`), the add page (`src/web/AddPage.tsx`) and `npm run ingest`
  (`scripts/stage.ts`) use it where they use `normaliseUrl` today. A new job's address and its
  resolved key are then the same string's key, with the tracking parameters gone.
- A pre-deploy `pdf/` job and a post-deploy `abs` paste therefore do not match in flight, and the
  second paste makes a second article, which is what production does today. Nothing new can go
  wrong in the window; the dedup simply starts with jobs queued after the deploy.

### Caller 2: what is fetched (`src/pipeline.ts`, the `fetch` step)

```
 candidates = resolvePaperSource(ctx.url)?.candidates ?? [{ url: ctx.url }]
 for each candidate, in order:
     doc = fetchDocument(candidate.url, { signal })     ← unchanged, every defence on every hop
     it is the kind the candidate promised, and carries its marker → this is the document
     the source says it has no such rendering (404 or 410), or it is the wrong kind,
         and there is another candidate → try the next
     anything else → fail, as a pasted address fails today
```

- **`fetchDocument` is called exactly as today**, once per candidate. The SSRF guard, the pinned
  dispatcher, the redirect cap, the byte cap and the type sniff run on each. No defence is edited,
  and the candidate addresses are fixed strings on `arxiv.org` built from a matched id, never text
  copied from the pasted address.
- **Only absence moves on** (Sol's F3). A timeout, a rate limit, a DNS or TLS failure, a blocked
  address or an oversized body on the first candidate is the step's failure, after `fetchDocument`
  has made its own retries. Falling back past those would hide the real cause and, for the HTML
  candidate, quietly spend money on the PDF read.
- **Every candidate must be what it promised, the last one too.** A PDF address that serves an HTML
  error page stores nothing and fails with the existing sentence for a document that is not what
  it should be (the implementer picks the closest of `fetchFailed`'s existing sentences; no new
  published sentence).
- A non-source address has one candidate with no `expect`, and behaves exactly as today.
- It resolves from `ctx.url` in the step, not only at the route, so a retry, a refresh and a job
  queued by any other path fetch the paper too. A refresh of an article whose address is
  `arxiv.org/pdf/…` resolves again and will take the HTML if arXiv now has one.
- The step's detail says which was used (`312 KB, arXiv HTML` / `1,040 KB, arXiv PDF`) and the log
  line gains `source` and `format`. No address is logged.

### Caller 3: relative links (`src/pipeline.ts`, the `extract` step)

arXiv's HTML names its figures relatively (`<img src="2608.13566v1/x1.png">`), so they resolve
correctly against `arxiv.org/html/2608.13566` and wrongly against `arxiv.org/abs/2608.13566`.
Stage 2 uses the *job's* address as the base today
([fetching.md § What's still loose, item 1](../project/fetching.md#whats-still-loose)).

The `extract` step passes `runExtract` **the manifest's final URL** (the address the bytes came
from, after redirects), falling back to the job's address for a manifest that has none.
`runExtract` itself does not change. That closes the loose end for every fetched page, not only
arXiv.

**This is the one change that reaches articles that are not arXiv's.** It changes nothing until an
article is refreshed, and then only for a page that was redirected *and* uses relative links, where
today's answer is wrong. Named here so it is decided rather than inherited.

## What is not in this plan

- **Any source but arXiv** — part 2.
- **Following a redirect into a source** — above, under the registry.
- **ar5iv, alphaXiv, Hugging Face paper pages.** Other sites' renderings of the same papers. Part 2
  can decide whether they map to arXiv.
- **Re-importing articles already on the shelf.** An article imported from an `abs` link before this
  stays an abstract until it is refreshed; pasting the link again adopts it, as any address already
  on the shelf is adopted. No backfill: production data is the reader's.
- **A completeness cross-check of the HTML against the PDF** — 261005e § What was decided.
- **Tidying arXiv's HTML beyond the faults that lose or falsify content** — the cosmetic ones are
  listed in 261005e.

## The simpler option passed over

**Rewrite `abs` to `pdf` and stop** — one function, and `paper-text.ts` § `arxivPdfUrl` already
does it for cited papers. It is, in effect, what the first stage ships. Passed over as the end
state because the eval is what Greg asked for and it does not say "PDF". The candidate list costs
one loop.

**Rewrite at the route only**, leaving the fetch step alone. Passed over because only the fetch
can discover that there is no HTML, and because a retry or a refresh starts from the stored
address, not the route.

## Stages

### Stage: the eval (done before this plan was reviewed)

- [x] Reproduce: what the `abs` link imports today.
- [x] `evals/arxiv-html-vs-pdf/run.ts`: both arms through our own extractors, on six papers.
- [x] Judge each paper's two arms against the paper: text, maths, figures, tables, references.
- [x] Write it up in `docs/investigations/261005e-…`, with what it cost ($0.62).

### Stage: the resolver and its three callers, arXiv as PDF only

- [ ] Tests first, red: `tests/paper-sources.test.ts` — every link shape in § Goal resolves to the
      same paper; near-misses do not (`arxiv.org/list/…`, `arxiv.org/abs/` alone, `notarxiv.org`,
      `arxiv.org.evil.example`, `arxiv.org:444/abs/…`, an id with trailing junk, a userinfo
      address, a non-arXiv DOI, `doi.org:444`). `identityOf`'s existing any-version tests stay green.
- [ ] `src/paper-sources.ts`, and the id pattern's other readers pointed at it.
- [ ] Tests first, red: `sourceAddress`, `urlKey` and `slugFromUrl` over the same shapes
      (`tests/ingest.test.ts`); `urlKey` of an ordinary address is byte-for-byte what it was.
- [ ] Tests first, red, for the deploy window: an active job whose address is the `pdf/` shape (as
      queued before this change) is **not** adopted by a new `abs` request; an active job queued
      through `sourceAddress` **is**, from any shape (`tests/one-article-for-one-address.test.ts`
      or beside it; these need Postgres and are mine to run).
- [ ] Tests first, red: the fetch step over an injected fetch — candidate served and right kind →
      stored; first is 404 → second stored; first is 410 → second; first is the wrong kind or lacks
      its marker → second; first is 503, a timeout, a blocked address, too large → that failure,
      **no second request**; last is the wrong kind → failure, nothing stored; Stop during the
      first → no second request; a non-source address → one request, as today.
- [ ] Tests first, red: the extract step resolves a relative `<img>` against the manifest's final
      URL, and against the job's address when the manifest has none.
- [ ] Build it, with arXiv's candidates `[pdf]`. `npm run typecheck`, the touched test files,
      `npm run lint` on them.
- [ ] Mutate: reverse the candidate order, drop the kind check, let a 503 fall through, recompute
      the in-flight key — each must turn a test red.
- [ ] One real import, locally, of Greg's link, end to end through the queue: the article is the
      paper.
- [ ] Docs: `fetching.md` (a new section, and loose end 1 closed), `ingest-queue.md`,
      `architecture.md` § Shared code.
- [ ] GPT Sol code review (write-capable, fixes inside the stage), gates, commit, push to `dev`.

### Stage: the HTML arm's faults (LaTeXML pages), and HTML first

All of it is in stage 2's preparation of the page, before Readability. A new module,
`src/latexml.ts`, called from `prepareDocument` in `src/extract.ts`; fix 4 goes where
Readability's keep-list lives (`src/protect.ts`).

**The rules every rewrite here follows** (Sol's F6):

- It applies only beneath `article.ltx_document`. Class names alone are not proof a page is
  LaTeXML's.
- It requires an exact, documented shape of direct children, and **leaves the page as it was when
  the shape does not hold** — the rule `src/maths-import.ts` already works to.
- It keeps the container's `id` and every descendant `id` or `name` that a link in the page points
  at, or it leaves the source unchanged. Stage 3 repoints cross-references by those ids.

Fixtures are cut from the real pages the eval fetched (the smallest element that shows the fault,
with the prose replaced), under `tests/fixtures/latexml/`, each with a negative twin: the same
classes outside `article.ltx_document`, an extra authored sibling, a linked descendant.

- [ ] **1. An aligned equation is one display formula.** Only the measured shape:
      `table.ltx_equationgroup.ltx_eqn_align` (and its single-`tbody` form) whose formula cells
      hold one inline `<math>` each. One formula cell in a row is emitted with no `&`, two with
      one `&` between them; rows are joined with `\\` inside `\begin{aligned}…\end{aligned}`; the
      leading `\displaystyle` of each cell is dropped. One equation number for the group is kept as
      text beside it, as a single-line equation's is today. A group with several independently
      numbered rows, any other cell count, or any other alignment environment (`eqnarray`,
      `gather`, `multline`, `split`) is left alone until it has a fixture of its own. Only if the
      reading view would draw the result (`texWouldDraw`). Red first on equation (1) of
      `2605.20355v1`.
- [ ] **2. An SVG plot in an `<object>` is an image, and SVG is still not hosted** (Sol's F8). An
      otherwise-empty `object[type="image/svg+xml"][data]` beneath a LaTeXML figure becomes an
      `<img>` with the same address, `id` and dimensions. An object with fallback children is left
      alone. Nothing in `src/assets.ts`, the bucket's allowed types or the owned-asset route
      changes: stage 4.5 records `unsupported-format` for an SVG and leaves it linked to the
      publisher, as it does for every SVG today. Tested: the conversion, and that the asset step's
      answer for the result is `unsupported-format`.
- [ ] **3. A code listing is one code block.** A `.ltx_listing` whose element children are all
      `.ltx_listingline` becomes a `<pre>` holding each line's **child nodes** (links and anchors
      kept), separated by newline text nodes.
- [ ] **4. A data table inside a list item survives** (Sol's F7). First reproduce and name the
      exact Readability branch that removes it. If a weightless `KEEP_COLUMN` stamp defeats that
      branch, add it as a rule of its own in `src/protect.ts` — its own `RULES` key,
      `ProtectOptions` switch and `WITHDRAWALS` entry, so `armThatKeptTheProse` rolls it back when
      it costs prose — and never `KEEP_CONTENT`, which that file forbids on a table. Tested on the
      real introduction of `2610.01658v1` and on an adversarial page where a large table would win
      Readability's scoring: there the rescue must roll back. If the stamp cannot do it safely, the
      fault is recorded and not fixed here.
- [ ] **5. The byline is the paper's authors.** A LaTeXML page declares no author meta tags, so
      the byline is Readability's guess, and it was wrong on every paper in the eval. The names in
      `.ltx_authors .ltx_personname` (direct text, footnote marks and affiliations left out) are
      handed to the same path a page's declared authors take (`src/meta-authors.ts`), in the page's
      order.
- [ ] **6. A cross-reference keeps its number.** Trace why `2610.01988v1` reads "in , 28 and 29";
      fix it if the cause is ours and the fix obeys the rules above, else record it.
- [ ] **7. A boxed passage keeps its words.** The `tcolorbox` in `2608.13566` is drawn as SVG with
      its text in a `foreignObject`, and its 58 words vanish. Trace where; keep the text and its
      links without loosening the sanitiser. If it cannot be done without touching the sanitiser's
      policy, it is recorded as a known loss and reported to Greg, not built.
- [ ] Re-run `evals/arxiv-html-vs-pdf/run.ts --html-only` on the five papers and re-judge the two
      the PDF arm won, same rubric. Record the result in 261005e. The corpus fixtures' extraction
      is unchanged (`npm test`).
- [ ] **Then** put the HTML candidate first, in the same commit as that evidence.
- [ ] One real import of Greg's link, locally, end to end; a Sonnet subagent opens it in a browser
      and checks the figures load, the maths draws, the tables have their headers.
- [ ] Docs: `content-extraction.md`, `maths.md`, `fetching.md`, and `/help` if it describes what
      pasting a link does.
- [ ] GPT Sol code review, gates, commit, push.

### Stage: bookkeeping

- [ ] `docs/user-feedback/261005_1912-….md`, `feedback-endings.ts`, `overseer-queue.ts done`.

## What the eval found

Six papers, both arms, 2026-10-05; the detail and the limits of the method are in 261005e.

- **Cost and time:** the HTML arm's extraction is free and took 3–41 s; the PDF arm's cost
  $0.09–0.13 and took 92–164 s. The eval spent $0.62.
- **Correctness:** text is a draw. The HTML arm is better on tables (the author's own, with header
  rows), references (the whole list) and the symbols in maths (the author's TeX). Judges preferred
  the HTML arm on three papers and the PDF arm on two; both PDF preferences rest on faults in the
  list above. Figures were not compared end to end: the judges read text, not pictures, and the
  stage that recovers a PDF's pictures was not run.
- **Of 36 recent papers probed in three categories, 4 had no HTML**: arXiv answers 404, and the
  PDF is the only option.
- **One fault is arXiv's:** its converter dropped one figure of 18. Not detectable from the HTML
  alone.

## Questions and decisions

Nobody is reading the chat, so decisions taken on Greg's behalf are recorded here.

- **A version in the link is kept** (`…v1` imports v1 and is a different article from the
  unversioned link, which imports the latest). The alternative, always the latest, would change
  what a deliberate `v1` link means.
- **A `pdf/` link gets the HTML too**, when there is one. Greg asked for the better format to be
  chosen for him "even if someone gives us a link like this", and the choice is about the paper,
  not about which button on arXiv's page the link was copied from.
- **For Greg, not blocking: should the source link open the abstract page?** After this plan the
  link on an arXiv article opens the HTML or PDF the text came from. The abstract page is the
  address people cite and share. Storing it needs a new column on `article_revisions` (the
  article's own address, beside the address its bytes came from) and a migration; a schema change
  is his call. Until then nothing is wrong, only less tidy.

## Reviews

- **Plan review, GPT Sol, round 1** (`261005l-arxiv-link-imports-the-paper-plan-review-sol.md`,
  on commit `1459ef9d3`): *do not build*, ten findings. Each was checked against the code.

  | ID | Finding | Disposition |
  |---|---|---|
  | F1 (P0) | A job queued before the deploy keeps its old key; the new `urlKey` adopts its slug and a second job is charged | **Fixed in the plan**: the in-flight lookup compares the address a job was queued with, and new jobs are queued with the canonical address. § Caller 1 |
  | F2 (P1) | `meta.url` is `final_url`; stage 2 cannot set it | **Accepted, the design changed**: no `sourceUrl`; the article's address is where its text came from, and `urlKey` is what joins the shapes. The abstract-page link is a question for Greg |
  | F3 (P1) | Falling back on any failure hides the cause; the last candidate's kind was unchecked | **Fixed**: only 404/410 or a wrong kind moves on; every candidate must match; an HTML marker |
  | F4 (P1) | A source found only after a redirect is not "one more object" | **Accepted as wording**: the claim is narrowed to statically recognisable sources; the post-fetch hook is not built and is part 2's call |
  | F5 (P1) | Match an origin, not a hostname; imports keep the version and citations drop it | **Fixed**: origin rule, `versionedId` and `workId` |
  | F6 (P1) | The equation and listing rewrites could destroy ids and authored nodes | **Fixed**: the three rules, narrowed shapes, negative fixtures |
  | F7 (P1) | Stamping a table needs the rollback machinery `protect.ts` requires | **Fixed**: fix 4 as worded |
  | F8 (P1) | SVG must not be hosted | **Agreed, and it never was going to be**: the image stays linked to the publisher |
  | F9 (P1) | The write-up claimed more than it measured; the boxed passage is content, not cosmetic | **Fixed** in 261005e and here; the boxed passage is fix 7. **Overruled in part**: Sol would not switch HTML on until fix 7 passes. If fix 7 needs the sanitiser's policy changed it is recorded and reported instead, because that policy is a defence and the PDF arm has silent losses of its own (a scrambled table column) |
  | F10 (P2) | Do not switch HTML-first on before the fixes | **Accepted**: the first stage ships arXiv as PDF only |

- Plan review, GPT Sol, round 2 (the fixes above only): *(pending)*
- Code review, GPT Sol: *(pending)*
