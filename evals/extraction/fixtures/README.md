# `evals/extraction/fixtures/` — thirty pages Readability has to get right

Captured **2026-08-28**, **2026-08-30** and **2026-09-04**, hashed, and committed. Run by hand, not by
`npm test` — see [evals/README.md](../../README.md) and
[../../../docs/plans/260827ab-readability-repair-pass.md](../../../docs/plans/260827ab-readability-repair-pass.md),
which is the plan the first twenty-one were chosen for. The nine added 2026-09-04 (below, "The nine
added 2026-09-04") were chosen for
[../../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md](../../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md)
instead, and sit in `corpus.mts`'s `EXTRA_FIXTURES`, not `CORPUS` — see the comment there for why:
`CORPUS` is the denominator of a published figure in the first plan, and these fixtures would change
it retroactively if they were added there.

```bash
npx tsx evals/extraction/corpus.mts            # stock Readability vs what stage 2 ships, all of them
npx tsx evals/extraction/probe.mts <url>       # one page: what did it keep, and is any of it junk?
npx tsx evals/extraction/fixtures/verify.mts   # are these the bytes the numbers came from?
npx tsx evals/extraction/fixtures/verify.mts --refetch   # and does the web still serve them?
```

## Why the HTML is committed and not just the URLs

> Yes, commit and make the eval reproducible.
>
> — Greg, 2026-08-28

A URL is not a fixture. Every page here can be edited, redesigned, paywalled or deleted by somebody
else, and an eval whose inputs move is an eval whose old numbers mean nothing — you cannot tell an
extractor that improved from a publisher that changed their template. 5.8 MB buys the ability to
compare next year's number against the same document.

`hashes.json` holds a sha256 apiece. **A mismatch is a new fixture version, never a quietly updated
hash** — the rule [evals/pdf/README.md](../../pdf/README.md) states for its PDFs, and it binds
harder here, because a web page changes under you without telling anyone. `--refetch` reports drift
without touching anything; a page that has drifted is a historical snapshot, which is fine as long
as nobody believes it is live.

## How they were captured, and why that matters to the numbers

Plain HTTP GET with a browser-ish `User-Agent` and nothing else. **No JavaScript was executed**, so
what is committed is what a server sends a non-browser — which is precisely the input
[`src/fetch.ts`](../../../src/fetch.ts) hands stage 2. A page whose text only appears after
hydration is out of scope for this eval and belongs to stage 1
([fetching.md](../../../docs/project/fetching.md)); every fixture here was checked to have its
article text in the initial bytes.

Each was re-fetched with a bare default `curl` user-agent and still returned 200, so none of them
depends on pretending to be a browser.

## The fifteen

Slots are the failure modes in
[the plan's table](../../../docs/plans/260827ab-readability-repair-pass.md#six-ways-it-goes-wrong):
**T**runcation, **B**oilerplate, **W**rong container, lost **S**tructure, **D**uplication,
**N**othing.

| file | slot | source | licence | what it is here to break |
|---|---|---|---|---|
| `pg_greatwork.html` | N/S/T | [paulgraham.com](https://www.paulgraham.com/greatwork.html) | © Paul Graham | **Zero `<p>` in the document.** 12k words in nested layout `<table>`s inside `<font>`, paragraphs separated by `<br><br>`, title is a GIF |
| `man_open.html` | S/B | [man7.org](https://man7.org/linux/man-pages/man2/open.2.html) | per-page, mostly GPL/verbatim | Prose that lives inside `<pre>`: 14 `<pre>` against 7 `<p>`, roff hard-wrapped |
| `rfc9110.html` | T/S | [rfc-editor.org](https://www.rfc-editor.org/rfc/rfc9110.html) | IETF Trust, no cache restriction | 295 nested sections five heading levels deep, 161 `<pre>` of ABNF, 13 tables, 72k words. RFCs are never revised, so this one cannot drift |
| `whatwg.html` | T/S | [html.spec.whatwg.org](https://html.spec.whatwg.org/multipage/parsing.html) | CC BY 4.0 | **No wrapper element at all** — 1,543 `<p>` and 1,055 `<li>` are direct children of `<body>`, so scoring has nothing to grab but `<body>` |
| `wiki_transformer.html` | S/D/B | [Wikipedia](https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)) | CC BY-SA 4.0 | 188 formulas each carrying MathML **and** its LaTeX source, so every one lands in `textContent` twice |
| `ar5iv.html` | S/T | [ar5iv](https://ar5iv.labs.arxiv.org/html/1706.03762) | per-paper arXiv licence | LaTeXML output for *Attention Is All You Need*: 142 `<math>`, a different math convention from Wikipedia's. The likeliest of the fifteen to disappear |
| `arxiv_abs.html` | W | [arXiv](https://arxiv.org/abs/1706.03762) | metadata CC0 | The only prose is a 250-word abstract, competing with metadata panels of comparable weight |
| `aaronson.html` | B/W | [Shtetl-Optimized](https://scottaaronson.blog/?p=7784) | © the author | 5,560 words of post, **52,776 words of comment thread**, all server-rendered in the initial HTML |
| `acx.html` | B | [Astral Codex Ten](https://www.astralcodexten.com/p/your-book-review-the-educated-mind) | © the author | A 24k-word review inside six subscribe widgets, a share rail and a comments module |
| `gwern.html` | D/S | [gwern.net](https://gwern.net/scaling-hypothesis) | public domain | 34 footnote refs whose targets are in a terminal section, plus three `collapse` blocks present in HTML and hidden by CSS |
| `tufte.html` | D | [Tufte CSS](https://edwardtufte.github.io/tufte-css/) | MIT/Apache | A controlled probe: margin notes sit **mid-sentence** in the DOM, so any linearisation interleaves them |
| `mdn_cache.html` | B/D/S | [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) | CC BY-SA 2.5 | 550 `<li>` of sidebar, plus an inline "In this article" `<nav>` that repeats every heading |
| `gutenberg.html` | T/B | [Project Gutenberg](https://www.gutenberg.org/cache/epub/1342/pg1342-images.html) | public domain text | 131k words, 2,147 `<p>`, 65 chapters, all flat siblings — the size stress test — bracketed by two near-identical licence blocks |
| `cornell.html` | W/B | [Cornell LII](https://www.law.cornell.edu/uscode/text/17/107) | US statute, public domain | The inverse of Aaronson: a 450-word statute buried under Notes and Source Credit ten times its length |
| `constitution.html` | T | [anthropic.com](https://www.anthropic.com/constitution) | © Anthropic | **A quarter of the article inside three closed accordions**, `aria-hidden="true"` on the containers. Added second, because the first fourteen contained no instance of it |
| `acx_footnotes.html` | — | [Astral Codex Ten](https://www.astralcodexten.com/p/your-book-review-the-pale-king) | © the author | The modern Substack footnote shape, absent from the first fifteen: a numbered `<a class="footnote-anchor">` marker inline in prose and a matching `<div class="footnote">` at the foot of the post. Added for the footnote-support investigation, not the readability-repair-pass table above |

### Why the fifteenth was added afterwards

The first fourteen were picked to fill the failure-mode table, and between them they held **not one
collapsed accordion**. So the un-hide arm was inert on the entire corpus, and "zero regressions in
fourteen pages" — which is what the run printed, truthfully — was a safety claim about a change with
nothing to act on. It looked like evidence and was the absence of evidence, which is the shape
[silent-success.md](../../../docs/reusable/silent-success.md) is about.

The page that *had* the failure mode was the one it was found on, and it was not in the corpus. It is
now, captured the same way as the rest — plain GET, browser-ish `User-Agent`, no JavaScript.

The licence column records what the page says about itself. These are **committed as test inputs in
a private repo**, not redistributed; none of the fifteen prohibits caching. `gutenberg.html` asks
that its header be kept with the text, which it is, since the file is byte-identical to what was
served.

### The sixteenth: `acx_footnotes.html`, captured 2026-08-28 for footnote support

Added for a different reason than the first fifteen, and not part of the readability-repair-pass
table above. Before anyone designs footnote support, the question was what actually survives
Readability, and the corpus had no example of the commonest modern shape — a Substack or Ghost post
with real footnotes. `acx.html`, already in the corpus, is a Substack post but that particular one
has none.

`acx_footnotes.html` is [Astral Codex Ten's review of *The Pale King*](https://www.astralcodexten.com/p/your-book-review-the-pale-king),
which carries genuine numbered footnotes end to end: an inline `<a class="footnote-anchor">` marker
in the prose, and a matching `<div class="footnote">` — `<a class="footnote-number">` plus
`<div class="footnote-content">` — in a list at the foot of the post. Captured the same way as the
rest: plain GET, browser-ish `User-Agent`, no JavaScript, and the article text (including every
footnote) is in the initial bytes. Re-fetched with a bare default `curl` user-agent and returned
byte-identical output, so it does not depend on pretending to be a browser either. © the author,
same as `acx.html` and `aaronson.html`.

## The five added 2026-08-30, and the different question they answer

The first sixteen were chosen to answer *"what did Readability throw away?"* These five answer the
opposite one — *"what did it keep that is not the article, and what did it keep in the wrong
shape?"* — which is the question
[../../../docs/plans/260830at-readability-tidy-pass.md](../../../docs/plans/260830at-readability-tidy-pass.md) is
about. The measure is `probe.mts`'s marker/tiny/longest-block counts rather than `droppedChars`, and
**four of these five score perfectly on `droppedChars` while being visibly wrong to a reader.**

| file | slot | source | licence | what it is here to break |
|---|---|---|---|---|
| `mkdocs_tabs.html` | D/B | [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/reference/content-tabs/) | MIT | **The case the section below says is missing.** Five tabbed widgets whose inactive panels are hidden by an external CSS sibling selector on a `:checked` radio — no `[hidden]`, no inline `display:none`, no `aria-hidden`. Readability admits every panel, so alternative C and C++ examples run together with no boundary and the two tab labels arrive glued as one block reading `CC++` |
| `whitman.html` | S | [Project Gutenberg](https://www.gutenberg.org/files/1322/1322-h/1322-h.htm) | public domain | *Leaves of Grass*. Ratio **1.000, nothing dropped**, and the longest block is **67,890 characters** — several distinct poems melted into one node, because the verse lives in `<pre>` and nothing splits it. The live successor to the `<br>` failure |
| `hacker_howto.html` | S | [catb.org](http://www.catb.org/~esr/faqs/hacker-howto.html) | © 2001 Eric S. Raymond | The same shape by a different route: a DocBook FAQ rendered as an HTML `<table>`, so twenty-one question-and-answer pairs arrive as **one 14,572-character block**. The essay above it extracts perfectly |
| `mactutor_turing.html` | B/S | [MacTutor](https://mathshistory.st-andrews.ac.uk/Biographies/Turing/) | © Univ. of St Andrews; credit, non-commercial | **18 markers and 15 tiny blocks.** A CMS convention wraps bare years in `<span class="non-italic">` mid-sentence, so `1931`, `in` and `'s` become top-level blocks, next to a `<dt>Born</dt><dt>Died</dt>` facts box and an external-links rail |
| `shakespeare_hamlet.html` | — | [Open Source Shakespeare](https://www.opensourceshakespeare.org/views/plays/play_view.php?WorkID=hamlet&Act=3&Scene=1&Scope=scene) | public domain (site says so) | **The control.** 52 blocks, mostly speeches, longest 1,539 characters, and **every one correct**. It catches a model being careless with short content — but note it does **not** defeat a crude "drop blocks under seven characters" rule, because none of its blocks is that short. That gap is recorded in [the plan](../../../docs/plans/260830at-readability-tidy-pass.md#what-the-review-overturned); a page of genuinely one- and two-character article content is still missing here |

Two of them were verified by hand against the live page and not only through the probe. `catb.org`
answered **HTTP 408 with a 110-byte body** on the first capture attempt; had that been committed it
would have sat in the corpus as a fixture with no article in it, and the runner would have reported a
page rather than a failure — the [silent-success](../../../docs/reusable/silent-success.md) shape
again, this time in the act of building the instrument. Every capture is now checked for its own
article text before it is hashed.

**What was looked for and not found:** the classic `<br><br>`-instead-of-`<p>` page. Readability's
own `_replaceBrs` reflows those into paragraphs, and `pg_greatwork.html` — twelve thousand words with
zero `<p>` in the source — comes out with **266 of them**. A search across personal sites, poetry
archives, mailing-list archives and legacy academic pages turned up no live instance of the failure
in that form. The reader-facing symptom it used to cause is alive; the mechanism has moved to `<pre>`
and to layout tables, which is what `whitman.html` and `hacker_howto.html` are for.

## The nine added 2026-09-04, from the corpus trawl

Before this trawl, the corpus had **zero government/legal, zero non-Latin-script, zero bot-wall, and
zero case that isolates the code-whitespace bug on its own** — the gaps named in
[../../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md](../../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md#what-the-trawl-found).
54 pages were fetched plain, the same way as the first twenty-one — no JavaScript, browser-ish
`User-Agent` — and each of the nine below was checked to hold its own distinctive text before it was
hashed, the same check `hacker_howto.html`'s HTTP 408 near-miss (above) established. They are
registered in `corpus.mts`'s `EXTRA_FIXTURES`, not `CORPUS`, for the same reason `acx_footnotes.html`
is: captured for a different investigation than the readability-repair-pass table, so adding them to
`CORPUS` would silently move that plan's published denominator.

| file | source | licence | what it is here to break |
|---|---|---|---|
| `python_docs_itertools.html` | [docs.python.org](https://docs.python.org/3/library/itertools.html) | PSF licence | The code-whitespace-collapse bug at its worst: every token of the 30-recipes section is wrapped in its own `<span class="k">`/`<span class="nf">` etc., so a naive `\s+` collapse mangles every code sample, plus a 30-recipes-in-one-block giant-block failure |
| `rfc8259_json.html` | [rfc-editor.org](https://www.rfc-editor.org/rfc/rfc8259) | IETF Trust, no cache restriction | The same code-mangling bug on ABNF grammar, on a *short* RFC — unlike the existing 295-section, 72k-word `rfc9110.html` |
| `wiki_gdp_table.html` | [Wikipedia](https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal)) | CC BY-SA 4.0 | **Total loss of a large data table.** None of the other twenty-nine fixtures loses a table entirely |
| `plos_biology.html` | [PLOS Biology](https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.1002165) | CC BY 4.0 | 43% of blocks are reference-list buttons — the first journal-site furniture case; the existing academic fixtures (`ar5iv.html`, `arxiv_abs.html`, `wiki_transformer.html`) are LaTeXML, an abstract page and an encyclopedia respectively, none of them a journal's own furniture |
| `medium_about.html` | [blog.medium.com](https://blog.medium.com/medium-a-new-place-on-the-internet-for-sharing-ideas-and-their-connections-2e04efc80d1a) | Medium's own generic 404-template text, not any author's article | **Silent success:** Readability confidently parses a 404 SPA shell as a short "article". Minimal copyright surface since the captured text is Medium's boilerplate, not a byline'd post |
| `pmc_article.html` | [ncbi.nlm.nih.gov/pmc](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7280519/) | captured content is Google's reCAPTCHA challenge page, no NIH content at all | A second, mechanically different bot-wall from `medium_about.html`'s — a challenge page rather than an app shell — on a platform readers actually paste links from |
| `distill_momentum.html` | [distill.pub](https://distill.pub/2017/momentum/) | CC BY 4.0 | Two novel patterns: the byline date lives in a custom `<dt-byline>` web-component's sibling markup rather than a plain `<time>`, and interactive canvas/SVG figures degrade when scripts don't run |
| `wiki_ar_ai.html` | [Arabic Wikipedia](https://ar.wikipedia.org/wiki/%D8%B0%D9%83%D8%A7%D8%A1_%D8%A7%D8%B5%D8%B7%D9%86%D8%A7%D8%B9%D9%8A) | CC BY-SA 4.0 | **Fills the entire non-Latin-script/RTL gap** — zero such fixtures existed before this. A maintenance banner is the article's first block, and the page exercises the block-level `dir`/`lang` gap the trawl found missing |
| `eurlex_regulation.html` | [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52022XC0504(01)) | EU institutions' documents are explicitly reusable under Commission Decision 2011/833/EU | Fills the entirely-absent government/legal category: a Commission Communication (*Ecodesign and Energy Labelling Working Plan 2022-2024*, 2022/C 182/01) buried under EUR-Lex's own multilingual-display chrome |

**Five more from the same trawl were considered and held back**, because they are copyrighted
third-party prose or need a licence check that is Greg's call, not an agent's: `blogger_bldgblog`
(an index page gluing twenty articles into one giant block, © Geoff Manaugh), `hn_dropbox` (a nested
Hacker News comment thread, mixed user-generated copyright), `quanta_year_physics` (clean
byline/date-whitespace mangling, © Quanta Magazine/Simons Foundation), `npr_ozy_style_feature` (a raw
`<iframe>` embed captured verbatim as reading text, © NPR), and `archwiki_install` (fills the "wiki
that isn't Wikipedia" gap, but its GFDL-flavoured licence wants a check before committing). Their raw
HTML sits in the trawl's scratchpad, not under `fixtures/`, until Greg decides.

## The case that is missing, and it is the one that would falsify the fix

**A page with surviving hidden furniture.** Stage 2 now strips `aria-hidden="true"` before parsing
([`src/extract.ts`](../../../src/extract.ts)), and the pattern that breaks it is a navigation drawer
hidden by external CSS only — no `[hidden]`, no inline `display: none` — sitting *inside* the article
container. GPT Sol raised it and it reproduces: thirty items, 1,370 characters admitted. Outside the
article container link density sinks it either way.

**Not one of the first fifteen contained it, and `mkdocs_tabs.html` now does** — added 2026-08-30,
though as tabbed alternative content rather than as the nav drawer this paragraph imagined. So
"thirteen byte-identical" was a true statement about a pattern the corpus could not then exhibit, and
the un-hide arm had exactly one page it acted on. The
behaviour is pinned synthetically in
[`tests/extract-unhide.test.ts`](../../../tests/extract-unhide.test.ts), which is a record, not a
sample. **A real page with that pattern is the most valuable thing that could be added here** —
mobile-first publisher templates are where to look.

## What is deliberately not here

**A full-body duplicate** — a page rendering an AMP or print variant twice into one document. The
pattern is real and lives almost entirely on news and regional-publisher sites, which fail the
"still exists in a year" test that everything above passes. Duplication is covered instead at three
smaller scales: formula-level (Wikipedia, 188×), heading-level (MDN's inline ToC) and block-level
(Gutenberg's two licence blocks). If a full-body case is ever needed, snapshot one from a news site
and accept that the live URL will rot — the fixture is the committed HTML, so rot only costs
re-fetchability.

**Pages that need a browser.** Nine candidates were rejected for refusing a plain fetch, and two of
those are worth knowing about because they answer 200:
`lore.kernel.org` returns a 7.5 KB Anubis bot-check titled *"Making sure you're not a bot!"*, and a
Springer Nature article returns a 3 KB challenge page. Both are well-formed HTML with a 200 status
and none of the content — a **[silent success](../../../docs/reusable/silent-success.md)** that any
"did we get HTML?" check would pass.

**A prevalence sample.** Every fixture here was chosen *because it looked hard*, so no fraction
computed over this set estimates how often ordinary reading breaks. The plan says what a
representative sample would take.

## See also

- [../corpus.mts](../corpus.mts) — the runner, and the manifest of what each fixture is for
- [../inventory.mts](../inventory.mts) — the instrument, and the five bugs it shipped with
- [../../../docs/plans/260827ab-readability-repair-pass.md](../../../docs/plans/260827ab-readability-repair-pass.md) — the plan and the findings
