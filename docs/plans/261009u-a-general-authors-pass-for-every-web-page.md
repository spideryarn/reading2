# A general authors pass for every web page, in place of the arXiv one

Up: [plans.md](../project/plans.md). Report `spya-vfk2zh` (Greg, 2026-10-09 20:41 UTC, on
`/changelog`, release 1.4.8). An administrator's report, so trusted input.

> In release 1.4.8, you have a bunch of stuff that's specific to archive about how we deal with
> authors. I guess I don't think we should be building things that are specific to a particular site
> unless we really have to. I think my hope is that something like that we could handle with an LLM,
> especially a cheapish one like DeepSeek 4.1 Flash or Haiku 5.5, where we give it, I don't know,
> just the first few sections of the article and say, ask it to do some post-processing on it after
> it's been imported, looking for typical things like extracting and reformatting authors and
> affiliations and maybe even noticing stuff like authors' abstract acknowledgements, and maybe we
> default fold them. I don't know. Maybe that's out of scope. The key point is just that this kind of
> thing, maybe I'm misunderstanding, but this kind of thing is the sort of thing I'd hope we could do
> with an LLM in a general way rather than deterministic scripts that are specific to particular
> sites. That said, archive is obviously a really important one, so it's good that we're getting that
> right.
>
> — Greg, 2026-10-09

And, after the brief was written:

> Use your judgment re replacing the arXiv code. Maybe run some quick spikes/evals - ideally we'd
> replace with the LLM if it works well enough, and if the LLM author post-processing costs well
> under $0.01
>
> — Greg, 2026-10-09

## The short answer

**It works, and it is cheaper, so the arXiv affiliations code is gone.** One small call to Haiku
5.5 over the top of the page, about **$0.0005 an article**, held to the page's own words by code. On
13 arXiv papers, three draws each, it gave **the same authors and affiliations as before on 9, better
on 2, and was wrong on none**. Before, the arXiv call cost $0.002–0.010 (median $0.005), on Sonnet.
The same pass now runs on **every web page that names its authors in its metadata but not their
institutions**. Before, those pages got nothing.

Two arXiv-specific pieces stay, and § 1 says why: reading the names out of arXiv's markup, and the
rewrite that stops the author rows being mangled in the article's own text.

## 1. How much of 1.4.8's author work was arXiv-specific

Greg is partly right. Three pieces of work landed for arXiv HTML papers this week:

| what | plan | arXiv-specific? | model? |
|---|---|---|---|
| **Names** for the masthead, read from LaTeXML's markup (`latexmlAuthorNames`) | [261007d](261007d-front-matter-folded-by-default-and-arxiv-html-authors.md) | yes, deterministic | no |
| **The title block in the article text**, rewritten into one row per author before Readability (`tidyTitleBlock`) | [261009d](261009d-arxiv-html-title-block-tidied-at-import.md) | yes, deterministic, about 400 lines of `src/latexml.ts` | no |
| **Affiliations** on the masthead names | [261009m](261009m-arxiv-html-affiliations-by-the-authors-pass.md) | the plumbing was; the reading was not | **yes**: the PDF path's general authors prompt, on Sonnet |

So the affiliations were already a model's job. What was arXiv-specific was how it was fed:
`latexmlTitleBlock` read each author's text out of LaTeXML's markup, and a per-author check relied
on that markup. It also ran on the capable tier, at ten times the price of the cheap one. **That
part is what this replaces.**

The other two are not "post-processing the authors", and a model is the wrong tool for both:

- **The names from the markup are arXiv's equivalent of a journal's `citation_author` meta tags.**
  The page says outright who its authors are, and we read it. They also give the model a fixed list
  to be held to. Measured without them (below), the general pass refuses 4 of 13 arXiv papers. The
  shared check cannot tell where one author's row of name and institution ends and the next begins
  unless each row ends in an email.
- **The title-block rewrite fixes the article's own text, not its metadata.** Without it, Readability
  deleted one author from the prose and fused the other seven, with their hover-only labels, into one
  194-word paragraph. A model cannot restore text that Readability has already deleted. Rewriting the
  displayed prose with a model would also put words on the page that we could not check. It is a
  format adapter, like the LaTeXML maths and equation rewrites: arXiv is the one source whose markup
  says exactly what each piece is.

## 2. Every site-specific extraction rule we have

From a read of `content-extraction.md`, `fetching.md` and `src/`, 2026-10-09. D = deterministic,
M = a model call.

| kind | rule | sites |
|---|---|---|
| **where to fetch** | `src/paper-sources.ts`: a link of any shape becomes the paper's own address | arXiv (HTML first, then PDF), ACL Anthology, PMLR, NeurIPS, CVF, JMLR, NBER (D) |
| | `src/challenge-page.ts`: a bot check is refused as one | Anubis (hal.science, winehq) (D) |
| **body clean-up** | `src/latexml.ts`: equations, listings, SVG objects, boxed passages, undefined macros | arXiv / ar5iv HTML (D) |
| | `src/furniture.ts`: edit links, header anchors, figure links | MediaWiki, Sphinx/MkDocs, PLOS, Springer Nature (D) |
| | `src/reader-comments.ts`: comment threads | WordPress, Blogger, Disqus (D) |
| | `src/notes.ts`, `src/callouts.ts`, `src/protect.ts`, `src/maths-import.ts`: footnotes, callout boxes, structure Readability would drop, maths | gwern/pandoc, Wikipedia, Substack, Tufte, MkDocs, Docusaurus, ArchWiki, LaTeXML, PLOS, KaTeX, MathJax (D) |
| **front matter** | `latexmlAuthorNames`, `tidyTitleBlock` (§ 1) | arXiv (D) — **kept** |
| | `latexmlTitleBlock` + `src/arxiv-affiliations.ts` (§ 1) | arXiv (M, Sonnet) — **replaced by this plan** |
| **front matter, general** | `src/meta-authors.ts`: `citation_author` (+ institution), `dc.creator` | any page that declares them (D) |
| | `src/pdf-frontmatter.ts`, `src/pdf-authors.ts`: title, byline, authors, affiliations | any PDF (M, Sonnet) |
| | `src/paper-metadata.ts`: title, authors, abstract, DOI | a batch-added paper (M, DeepSeek) |
| | `src/title-tidy-model.ts`: an imported title's capitals and site suffix | everything (M, DeepSeek) |
| | `src/web/front-matter.ts`: the leading byline rows folded in the reading view | everything (D, display only) |

Most of the site-specific code is body clean-up, and it is the right shape for that job: each rule
mends one platform's markup, and a model has nothing to add. **Front matter had exactly one
site-specific path, arXiv's, and this plan replaces its model half.** Before this change, a web page
that was not arXiv and printed its authors' affiliations without meta tags got none.

## 3. What is built

Revised after GPT Sol's plan review (§ The plan review). The first draft also *found* authors on
pages that declare none; that is now out (finding 3).

```
stage 2 (runExtract), any HTML page
  markHidden(doc): stamp what the page hides (hidden, inline display:none, aria-hidden),
                   before prepareDocument un-hides collapsed sections for Readability
  prepareDocument (an arXiv title block becomes one row per author)
  pageOpening(doc): the visible text from the main heading on, inside its <article>/<main>,
                    before Readability; one record per paragraph-level element;
                    <br>, <sup>, <sub> are word breaks; ≤ 40 records, ≤ 6,000 characters
  the names the page declares (citation_author, dc.creator, LaTeXML's markup)
    └─ none, or any already with an affiliation → no call
    └─ otherwise → one Haiku 5.5 call: { authors: [{ name, affiliations }] }, one per declared name
         └─ verifyAuthors (src/pdf-authors.ts, unchanged), the declared names as the byline:
            every name back, in order; each affiliation found on the page, its characters stored
         └─ each affiliation the page's exact words (no glued-marker allowance: not `M Company`)
         └─ each affiliation provably that author's (`ownedBy`):
              printed in a record that names that author and no other; or
              right after a marker printed on that author's name, never in somebody else's row; or
              unmarked, and given to every author it could belong to
    └─ any refusal or failure → the declared names alone, exactly as before
```

- **`src/front-matter-authors.ts`**: `markHidden`, `pageOpening`, the prompt, the schema, the parse,
  `checkFrontMatterAnswer` and the pipeline's reader, which logs and degrades as the PDF path's
  `authorsOrNothing` does.
- **Why read before Readability**: Readability keeps what it judges to be prose, and it removes the
  byline element in order to report it separately. A short author list is exactly what it drops: on
  2610.01658 both authors' rows were missing from the article, so a pass over the extracted article
  found nobody (run 1).
- **Ownership, made general.** 261009m proved each affiliation was printed in that author's own
  LaTeXML record. This proves it from the printed words instead, so it holds on any site: the three
  ways above, and nothing else. The model "correcting" `Engineerin` to `Engineering` on 2610.03261 is
  refused by it: the corrected spelling is printed only in the other two authors' rows.
- **Model**: Haiku 5.5 (`anthropic/claude-haiku-5.5`), job `front-matter-authors`, on a route pinned
  to Anthropic like `pdf-frontmatter`. It is not on a tier, so High-powered AI does not change it.
  It is metered on the article's `extract` step, beside the title tidy.
- **Removed**: `src/arxiv-affiliations.ts`, `latexmlTitleBlock` in `src/latexml.ts`, the
  `titleBlock` plumbing and the `affiliations` option in `src/extract.ts`, its wiring in
  `src/pipeline.ts`, `tests/arxiv-affiliations.test.ts`, and `evals/arxiv-affiliations/`.

**Not built:**

- *Finding authors on a page that declares none* (PLOS's sticky header, a blog's "By …"). It is
  measured, and it worked on the few pages tried, but a model choosing a page's author from its
  prose could put a quoted person over a correct byline (GPT Sol, finding 3). Doing it safely needs a
  corpus of interviews, news and photo credits that should give nobody. That is separate work.
- *Noticing the abstract and acknowledgements, and folding them.* Greg said "maybe that's out of
  scope", and it is a separate decision with its own risk: hiding the author's own text. The reading
  view already folds the leading byline rows on every article by a general rule
  ([261007d](261007d-front-matter-folded-by-default-and-arxiv-html-authors.md)). The acknowledgements
  are at the end, which this pass does not read, and folding by block id would need a pass over the
  stored blocks, not over the page. It is on the Overseer's queue as `qi-ad4wgkaq`, waiting on Greg.
- *Replacing the PDF path's authors pass with this.* Measured, because the brief asked. On stored
  PDF blocks (run 6), Haiku matched Sonnet on 3 of 6 and refused 3. Stored PDF text has glued
  markers (`1Department`), which the exact-words check refuses, and no `<sup>` to show which words
  are markers, which the ownership check needs. The PDF path is already general and has its
  own byline pass, so there is no site-specific code there to remove.
- *A cache.* Re-extraction calls again, at a twentieth of a cent.

## 4. Measured

`evals/front-matter/measure.ts`, 2026-10-09. Live pages run through `runExtract` with the production
wiring, the reader recording exactly what production hands it; six PDFs already imported locally
(their stored blocks and stored names). Every call is in the ledger. Results and the comparison
script are in
[`evals/results/front-matter-authors-2026-10-09/`](../../evals/results/front-matter-authors-2026-10-09/).
**Run 6 is the final code**, after both reviews: Haiku, three draws per page. "Before" on arXiv
is what the 261009m path stored on the same pages in run 3, before it was removed. Run 5 was the
same before the code review's fixes. Runs 1–4 are the design's dead ends and the model comparison
(§ Ledger).

**arXiv HTML, 13 papers × 3 draws** (run 6):

| | |
|---|---|
| same as before | 8 papers with their affiliations, and 2610.08790 with its names only (it prints no affiliations), every draw |
| better than before | 2 papers, every draw (below) |
| no call, as before | 2610.08781, 2610.10548 (LaTeXML's markup gives no names) |
| worse than before | none in run 6. In run 5, 2610.03261 on 1 draw of 3: the model "corrected" the page's typo `Engineerin`, the ownership check refused it, and the names were kept without affiliations |
| wrong | 0 |
| cost | about **$0.0005** a paper ($0.0003–0.0008); 66 calls in the run, $0.034 |
| time | 1.4–4.8 s |

Before, on Sonnet: $0.0024–0.0100 a paper, median $0.0049. The two that are better, each checked
against the page:

- **2610.08785**: both authors carry the marker `1`, and `1 EECS, MIT, Cambridge MA, USA` is
  printed beneath them. The old per-author check gave Stephen Bates nothing, because that line is not
  in his own LaTeXML record.
- **2610.08750**: `Jose Eduardo Escrig Molina` is printed with two groups at Wageningen, and
  `Daniel Probst` with one. Before, the whole list was refused.

**Without the declared names** (run 4, `--no-declared`, on the first draft's names branch): 4 of 13
refused. Each of those papers prints author rows of name and institution with no email after them,
and the shared check cannot divide such rows into people. That is why `latexmlAuthorNames` stays.

**Other web pages, 11** (run 6): Frontiers and Distill declare affiliations in their meta tags, so
there is no call. Paul Graham, Wikipedia and Simon Willison declare no names, so there is no call
either. JStatSoft, ACL Anthology, PLOS and gwern are asked, and their names stay as they were:
none of those pages prints an institution in its opening. (`compare.ts` lists PLOS as "arm only".
That is an artefact: import then keeps exactly what it kept before, which for PLOS is no list.) **Noema**: `Anil Seth` gets `Centre for
Consciousness Science at the University of Sussex` and `Canadian Institute for Advanced Research
Program on Brain, Mind and Consciousness`, on all three draws, read off the author's bio line. The
eval's plain fetch could not read Nature, MDPI, PMC, eLife, Royal Society, LessWrong or (from run 5)
Astral Codex Ten. That is a gap in the eval, not in the pass.

**DeepSeek V4.1 Flash against Haiku 5.5** (run 3, the first draft's checks): the same on every arXiv
paper, at the same price (median $0.0006 against $0.0005). On a PDF with an unmarked, shared line of
institutions (JCO 2005), **DeepSeek split the line between the authors by what it seemed to know
about them**: right in fact, but not printed on the page. It did so on both runs. Haiku gave every
author both institutions, as the prompt says. The ownership check now refuses DeepSeek's answer too,
but a model that has to be caught is the worse one to start from, so the pass runs on Haiku.

**Total spend for every run**: about $0.13.

## The plan review

GPT Sol, read-only, 2026-10-09 ([the review](261009u-general-authors-plan-review-sol.md)), verdict
*revise before build*. Each finding was checked, and each one was right.

| | Sev | Finding | Outcome |
|---|---|---|---|
| 1 | P1 | Ownership weaker than the arXiv check: a swap across a separate numbered list, or inside one record, passed | Accepted: `ownedBy`'s three proofs, the nearest marker only, never a marker in somebody else's row; tests for both swaps, Vaswani ↔ Parmar and the JCO split. The first fix was itself red on Vaswani (the `1` in Parmar's row is the equal-contribution mark Vaswani has too), which is why a marker counts only outside another author's row |
| 2 | P1 | Hidden text read (`<span hidden>Malicious University</span>` accepted); `aria-hidden` already removed by then; traversal ran into footers; huge first block | Accepted: `markHidden` stamps before `prepareDocument`. A stamp, not a set of elements, because the LaTeXML rewrite works on a copy, and a set of nodes went red on exactly that. The walk is bounded to the heading's `<article>`/`<main>`, and capped as it reads. Tests on real hidden DOM, including `aria-hidden` inside the arXiv title block |
| 3 | P1 | Finding authors where none are declared can overwrite a correct byline | Accepted: affiliations only, for declared names; § 3 Not built |
| 4 | P2 | The eval rebuilt the declared names rather than capturing them; run 3 predated the final checks; no repeat draws | Accepted: the reader records what it is handed; runs 5 and 6, three draws |

## The code review

GPT Sol, write-capable, 2026-10-09 ([the review](261009u-general-authors-code-review-sol.md), on
[the scoped diff](261009u-general-authors-code-review.diff)), verdict *ready to push after the fixes
above*. It fixed what it found, red first, and the author read the diff.

| | Sev | Finding | Outcome |
|---|---|---|---|
| 1 | P1 | `York` was taken as named in a record that prints `New York University`; a one-letter word (`Alice Smith D` / `D Delta Institute`) passed as a marker | Kept: a name inside the affiliation is not an occurrence of that author, and a marker counts only when it is printed in `<sup>`/`<sub>` (the records carry which) |
| 2 | P1 | Hidden text missed: `display : none`, opacity, `<style>` rules; and a hidden LaTeXML contact's bare text moved out of its stamped parent by the rewrite | **Partly kept.** The wider hiding rules and whole-subtree stamps are kept, and the stamps are now set only on candidate elements, not on every element of the page. **Not kept: wrapping hidden text in new `<span>`s on every page before `prepareDocument`.** That reshapes the DOM which every rewrite there measures (exact-shape checks, maths, the `aria-hidden` sections of half the web), to close a narrow gap. The gap is a page's own hidden words placed in its own affiliation, and the stored text is still the page's own characters. Its test is `it.fails`, so it turns red if the gap is ever closed |
| 3 | P2 | The walk was not bounded in nodes; the stamp was not a registered reserved attribute | Kept: 20,000 nodes; `data-spya-hidden` registered in `src/reserved.ts` and scrubbed if the page brings its own |
| 4 | P2 | Haiku 5.5 had no display name | Kept (`src/model-names.ts`) |
| 5 | P2 | External stylesheets are not seen | Accepted as the boundary: fetching a page's CSS at import is a network and security change, for the same narrow gap |
| 6 | P2 | Run 5 predates these checks | Re-run as run 6 (§ 4) |

## Stages

1. The module, the job registered (route, reasoning, cost category, the plain-words exemption), the
   `runExtract` option and the pipeline wiring; the arXiv affiliations path removed; tests red first
   (`tests/front-matter-authors.test.ts`, with a stub gateway) and mutants killed; runs 5 and 6.
2. Docs (`content-extraction.md`, `setup-dev.md`), GPT Sol's code review, the gates, push, the
   feedback note and `feedback-endings.ts`.

## Ledger

- 2026-10-09: prior-work check (plans 260929d, 261007d, 261009d, 261009m; `docs/user-feedback/`;
  `git log origin/dev`; `gjd-remote ls`: no other session on this). An Explore subagent made the
  inventory in § 2.
- 2026-10-09: spike. **Run 1**: records from the extracted article's blocks, with the model naming
  byline records that hold names and institutions; 13 of 25 refused, all by the shared check, for
  two reasons: author rows that carry an institution cannot be divided into people, and Readability
  drops short author rows. **Run 2**: the names held to the declared list, and the records read from
  the page before Readability. **Run 3**: PLOS's twice-printed byline handled; DeepSeek against Haiku.
  **Run 4**: arXiv without declared names.
- 2026-10-09: GPT Sol's plan review, *revise before build*; all four taken (§ The plan review).
  Red first: the `3M Company` case, the Vaswani swap, the separate-list and same-record swaps, the
  JCO split, hidden text in the arXiv block. Mutants: the ownership check off (4 tests fail). The
  names-equal check off fails no test: a merged name is already refused by `verifyAuthors`' name
  shape, so it is kept as the second line and said so. The stamp clean-up off fails no test either,
  because Readability does not carry the attribute through; it is kept so that no stamp is left in
  the DOM it hands on. **Run 5**.
- 2026-10-09: GPT Sol's code review, *ready to push after the fixes above*; four of its fixes kept,
  the span wrapping not (§ The code review). **Run 6** on the final code. Plan renamed from 261009t
  to 261009u: the letter was taken on `dev` meanwhile (the Overseer noticed).
