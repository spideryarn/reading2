# `evals/extraction/fixtures/` — thirty-five pages Readability has to get right

Captured **2026-08-28**, **2026-08-30** and **2026-09-04**, hashed, and committed. Run by hand, not by
`npm test` — see [evals/README.md](../../README.md) and
[../../../docs/plans/260827ab-readability-repair-pass.md](../../../docs/plans/260827ab-readability-repair-pass.md),
which is the plan the first twenty-one were chosen for. The fourteen added 2026-09-04 (below, "The
nine added 2026-09-04" and "The five added 2026-09-04, on Greg's copyright decision") were chosen for
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

## The five added 2026-09-04, on Greg's copyright decision

Five more from the same trawl were held back at first — copyrighted third-party prose, or a licence
that needed a check before committing — and reported to Greg rather than promoted silently. His
answer, verbatim:

> It's fine to include copyrighted material in the eval, as long as we attribute it to them. We're
> not publishing or stealing it.
>
> — Greg, 2026-09-04

So: these five are committed as test inputs in a private repo, the same footing the README already
states for the first twenty-one (see "Why the HTML is committed and not just the URLs", above) — not
published, not redistributed as content, kept only so the eval has bytes to measure against. What
changes here is that the attribution has to be right, because it is now the condition of inclusion
rather than a nice-to-have.

| file | source | rights holder | what it is here to break |
|---|---|---|---|
| `blogger_bldgblog.html` | [bldgblog.blogspot.com](https://bldgblog.blogspot.com/) | © Geoff Manaugh, BLDGBLOG. The captured page carries no separate machine-readable copyright statement in its own HTML; attributed to the named author, on the same footing as `aaronson.html` and `acx.html` already are in this corpus | An index page gluing **20 distinct post-title entries** (confirmed: `class="post-title"` × 20, e.g. "A Burglar's Guide to TV") into one giant block — the inverse of the existing giant-block cases, which are single-article internal-structure failures, not an index page |
| `hn_dropbox.html` | [news.ycombinator.com/item?id=8863](https://news.ycombinator.com/item?id=8863) | Hosted by Hacker News / Y Combinator; **copyright in each comment rests with the individual commenter who posted it**, not with Y Combinator or with this corpus. No single rights holder is attributed for the page as a whole | The classic "My YC app: Dropbox" thread: a nested comment tree, `<table>`-indented (71 indent cells), that Readability glues into one 23,038-character block — a different shape from the giant blocks above, live and unedited rather than internal document structure |
| `quanta_year_physics.html` | [quantamagazine.org](https://www.quantamagazine.org/the-year-in-physics-20241217/) | © Quanta Magazine / Simons Foundation. The page's own footer reads "All Rights Reserved © 2026" and separately, "An editorially independent publication supported by the Simons Foundation" — both quoted from the captured HTML | Byline whitespace damage: `<em>By </em>` and `<span class='byline__author …'>Natalie Wolchover</span>` sit in separate elements across newlines, so the byline text node reads with embedded whitespace runs — the pattern no existing fixture documents at all |
| `npr_ozy_style_feature.html` | [npr.org/sections/goatsandsoda](https://www.npr.org/sections/goatsandsoda/) | © NPR. No explicit copyright line was present in this snapshot's captured bytes (the page's footer script markup is there; the rendered copyright text is not) — attributed to NPR as the named, well-known publisher of the page, on the same footing as the news/government/legal fixtures already in this corpus | Raw `<iframe>` embed markup captured **as literal reading text**: an "Embed" widget's `<input value="...">` and a sibling `<code>` block both hold the literal string `<iframe src="https://www.npr.org/player/embed/…">`, which is exactly the text Readability would surface if it admits that widget |
| `archwiki_install.html` | [wiki.archlinux.org/title/Installation_guide](https://wiki.archlinux.org/title/Installation_guide) | **GNU Free Documentation License 1.3 or later** — quoted directly from the page's own footer: *"Content is available under GNU Free Documentation License 1.3 or later unless otherwise noted."* Checked per Greg's instruction rather than assumed; this page is GFDL, not CC BY-SA | Twelve `Note`/`Tip` admonition boxes (`class="archwiki-template-box-note"` / `-tip`) whose label sits in a `<strong>` before a sibling `<ul>` rather than inline with the text it labels — the "admonition label detached from its body" shape, and the first MediaWiki instance in this corpus that isn't Wikipedia itself |

Registered in `corpus.mts`'s `EXTRA_FIXTURES`, same as the nine above and for the same reason.

## The assertion manifests, added 2026-09-05

Fifteen of the thirty-five now carry a `<name>.manifest.json` beside the HTML: what an extraction
of that page has to contain, what it must not, the structure floors, the exact byline, and **which
part of the page is the article**. The schema and the reasoning are in
[../manifest.mts](../manifest.mts); the scorer that reads them is
[../scorecard.mts](../scorecard.mts) and the run is [../score.mts](../score.mts).

Three rules make them worth more than a prose list, and each was written because of a specific way
this corpus has already been wrong:

- **Binary per fixture, never averaged.** An arm that satisfies every declared assertion while
  wrecking the 95% nobody declared anything about must not score well.
- **Every needle says why it is there.** 260830at's marker rule scored 246/246 and nobody could tell
  from the number that the corpus contained none of the content it would have deleted.
- **Every manifest about an article says which part of the page that is** — `articleRegion`, added
  the same day, after GPT Sol built an arm on `aaronson` out of the page's own comment thread that
  returned **178 characters of the post, 0.542%**, and passed every metric, both gates and every
  assertion. Provenance proves text came from somewhere on the page; it cannot tell 5,560 words of
  post from the 52,776 words of comment underneath. `minArticleChars` is a floor on the region now,
  and each manifest's `note` records three measured numbers — the region's own characters, the whole
  source body's, and what the shipped extraction gives back of the region — so the region can be
  argued with rather than trusted. `aaronson`'s region is **9.3%** of its source body;
  `arxiv-abs`'s is 24.6%; `ar5iv-attention`'s is 99.7%, because on that page the wrapper *is* the
  paper.
- **Every needle has to be findable in the fixture's own bytes**, checked by
  [../../../tests/extraction-manifests.test.ts](../../../tests/extraction-manifests.test.ts). A
  `mustNotContain` needle that is not on the page is satisfied by an arm that deletes the article.
  That check caught five needles on the day it was written, including one that lives only in a
  `<meta content=>` attribute and could never have matched.
- **And no region may credit a string the same manifest forbids**, checked over the whole corpus by
  [../score.mts](../score.mts), which exits non-zero on it. Added 2026-09-05 after GPT Sol found
  three: `ar5iv-attention`'s region held Google's reproduction licence, `aaronson`'s held WordPress's
  trackback line, `plos-biology`'s held 26 repeats of *"View Article | PubMed/NCBI"*. On all three,
  removing known junk **lowered** `articleRecall` and **raised** `exclusionPrecision` at the same
  time, so the two numbers disagreed about what the article was and an arm could be rewarded for
  either answer. Each has an `except` now.

The fifteenth is **`pg-greatwork`**, added 2026-09-05 and worth its own line: paulgraham.com holds a
55,000-character essay in one `<td>` as 595 `<br>` and no `<p>` in the source at all, so Readability
builds every paragraph itself and 216 of the output's nodes have no source element of their own.
Until that day `articleRecall` credited only *directly* stamped nodes, which meant deleting all 216
— 81% of the output — moved the number not at all, and a **correct** extraction of the page scored
0.115. It scores 0.924 now. Its `p: { atLeast: 200 }` floor is derived from the source's 235 `<br>`
runs, not from what the pipeline produces, and it is what stops an arm handing the reader the whole
essay as one undifferentiated block.

A manifest records **what the reader should get, not what they do get**. `wiki-gdp-table` asserts
three tables and the pipeline produces one; `quanta-year-physics` asserts the byline
`Natalie Wolchover` and the pipeline produces `By Natalie Wolchover December 17, 2024`. Both fail
today, deliberately: a manifest that wrote the bug down as the answer could never show the bug being
fixed. **Eleven of the fifteen fail on the shipped arm as of 2026-09-05** — the four that pass are
`shakespeare-hamlet`, `python-docs-itertools`, `negative-controls` and `pg-greatwork` — and each of
the eleven names
something a reader has actually lost.

**Every `minArticleChars` was re-derived on 2026-09-05** when the measure changed from "gistable
characters of output" to "characters of the declared article region that came back". Copying the old
numbers across would have been exactly the mistake the ar5iv floors made — a floor written against
one measure is not valid under another. Each note carries the arithmetic.

**There is no per-arm judgement any more, and there was.** `score.mts --record` used to write
`acceptable | damaged | improved` into a `labels` block here, computed from the same card those
labels were meant to audit — and it called an arm that returned 182 characters of a 33,000-character
article `acceptable`. What `--record` stores now is a `findings` block: whether the declared
assertions held, whether the gates passed, which metrics fell against the shipped arm, and how many
characters of article came back. Each gate is recorded **on its own**, because summarising two
questions as one boolean recorded "both gates passed" for `pmc-article`, where only one of them
could be asked. See [`manifest.mts`](../manifest.mts) § `ArmFinding`.

### `synthetic/negative_controls.html` — the only page here nobody published

The corpus was checked for the shapes that defeat a length-or-character-class rule, over all
thirty-five fixtures, on 2026-09-05. It has **no scoreline block, no numeric table cell that reaches
a block, and no symbol-only scene break that is article content rather than junk** — which is the gap
this README already admits above, in "a page of genuinely one- and two-character article content is
still missing here". A corpus without them cannot contradict such a rule, and 260830at's scored
246/246 on exactly this corpus.

So `synthetic/negative_controls.html` is hand-written: a short piece about a football result that
carries a scoreline (`1–0`), a four-row table of numbers, a line of arithmetic alone on its own line,
a `❦` scene break, two two-word lines of dialogue, and a dated `Update (11 March):`. Its manifest
sets **`noPunctuationOnlyBlocks: false`**, and that is the sharpest thing on the page: the scene
break *is* a punctuation-only block and *is* the author's, so the rule is not universally safe and
the fixture says so.

Being synthetic is a real cost — its damage is only what its author thought of — so it is a
*supplement* to the real controls, not a replacement. Four of the eight shapes have a genuine home in
a captured page: `gutenberg-pride`'s `“Not one.”`, `ar5iv-attention`'s `Encoder:`, `aaronson`'s
`Update (Feb. 29):` and `arxiv-abs`'s whole 250-word article. It is registered in
[../corpus.mts](../corpus.mts) as `SYNTHETIC_CONTROLS` and deliberately **not** in `ALL_FIXTURES`,
because `provenance.mts` and `block-census.mts` publish totals from that list and `block-census.mts`
exists because a denominator got published that nobody could reproduce.

## The case that is missing, and it is the one that would falsify the fix

**A page with surviving hidden furniture.** Stage 2 now strips `aria-hidden="true"` before parsing
([`src/extract.ts`](../../../src/extract.ts)), and the pattern that breaks it is a navigation drawer
hidden by external CSS only — no `[hidden]`, no inline `display: none` — sitting *inside* the article
container. GPT Sol raised it and it reproduces: thirty items, 1,370 characters admitted. Outside the
article container link density sinks it either way.

**That 1,370 is markup, and it has been misquoted since.** `navRail()` in
[`scorecard.mts`](../scorecard.mts) reconstructs that rail for the polarity pair, and its thirty
labels are **393 characters of text** — 422 with the spaces between them, inside 1,211 bytes of list
markup. Every metric on the card measures text, so the polarity test spent a fortnight claiming a
"thousand-character" mutation it was not making, by asserting against the markup length. GPT Sol
counted it again on 2026-09-05. All three numbers are now assertions in
`tests/extraction-scorer.test.ts` rather than sentences here.

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
