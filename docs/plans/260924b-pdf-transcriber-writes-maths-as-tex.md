# The PDF transcriber writes maths as TeX

The deferred half of Greg's report SPIDERYARN-READING2-30 (2026-09-12, *"all the equations and
formulae are being displayed as raw latex"*), queue item `qi-njx3xh37`. The parent plan is
[260912d-render-latex-equations-in-the-reading-view.md](260912d-render-latex-equations-in-the-reading-view.md):
its stage 1 draws delimited TeX as maths in the reading view, and its § *Stage 2, deferred* is this
plan's requirements (F1, F9, F7 from its [plan review](260912d-plan-review-sol.md)). The note is
[260912_0804-equations-render-as-raw-latex.md](../user-feedback/260912_0804-equations-render-as-raw-latex.md).

Greg delegated the go/no-go on 2026-09-24 — *"use your judgment, keep it simple"* — and the
orchestrator decided to build it.

**The contract, since Greg widened it the same day:**

> ideally we would have some general way of representing LaTeX that might also be useful for HTML
> imports too, not just PDFs...?
>
> — Greg, 2026-09-24, on report 30

That representation already exists, and it is the only one: **delimited TeX (`\(…\)`, `\[…\]`) in
block text, drawn at display** by `src/web/maths.ts` ([maths.md](../project/maths.md)). Every
importer's job is to put maths into block text in that form. The PDF transcriber is the first
(stages 1–3 below); HTML imports are the second (§ Stage 3b).

## What and why

The reproduction in the parent plan found that the PDF transcriber, obeying prompt rule 8 (*"No
LaTeX … Plain text only"*), flattens a displayed equation into lines of symbols — equation (1) of
Newman et al. came out as eight lines, `≠` as `6=`. There is no plain-text spelling of a fraction or
a stacked sum, so rule 8 asks for something that does not exist, and stage 1 has nothing to draw.

The fix is to ask for TeX between `\(…\)` and `\[…\]`, which stage 1 already renders. But the PDF
checks (`src/pdf-score.ts`) read `\frac` as forbidden markup and `x_1` as an invented number, so
today a TeX maths chunk fails its content check, is **asked for a second paid time**, and is never
checkpointed. So the checks change first.

## The design

**One comparison form, in one place** — `mathsAsText(text)` in a new pure module `src/pdf-tex.ts`
(its own module because `pdf-score.ts` already imports `pdf-integrity.ts`, and both need it). Every balanced `\(…\)` and `\[…\]` span in a record's text is replaced by what a
reader would read off the printed page, as words:

- control words dropped (`\frac`, `\sum`, `\left`, `\cdot`, …), except Greek letters, which become
  their Unicode letter (`\alpha` → `α`, a letter the text layer holds), and operator names, which
  become the word (`\log` → `log`, printed as a word);
- `\begin{…}`/`\end{…}` dropped with their environment name (which is not on the page); invisible,
  layout, cross-reference and colour commands such as `\label`, `\hspace` and `\color` are refused;
- a sub- or superscript **joined to its base** (`x_{1}` → `x1`, `\log_2` → `log2`), because that is
  how pdf.js hands a subscript back — the baseline for this paper holds `Yt+1`, `log2`, `Xp`;
- every other brace, `&`, `\\`, spacing command and `<`/`>` a separator; `\{`/`\}` the printed
  braces; operands, digits and `\text{…}` prose kept as they are.

It is a small recursive walk rather than a chain of regexes, because groups nest
(`x_{\mathrm{max}}`).

**A span is recognised only if stage 1 draws it as visible maths** (G2): every control word first
passes an allow-list of symbols, relations, arrows, delimiters, accents, fonts, fractions and roots
(plus Greek and operator names); braces must balance; the span may be no longer than stage 1's
`MAX_TEX_CHARS`; TeX comments and `\text{…}` holding a dozen words are refused. The allowed source
then passes stage 1's exact bounded Temml renderer and markup acceptance rule, which catches invalid
sequences made entirely of valid words — a missing `\right`, a one-argument `\frac`, or mismatched
environments. Anything else — `\phantom`, `\hspace`, `\label`/`\tag`, `\href`, a command Temml does
not know — stays text, and `MARKUP` catches its delimiter or control word. An allow-list, because a
missing entry costs one retried chunk, while a missing deny-list entry would let a reader see nothing
where the check saw words.

**Where it applies** (F1, F9): to the model's record text, before it is tokenised, in `scorePage`
(recall, precision, order, missing runs, protected tokens, markup) and `thinPages`; in
`withoutRepeats` and `wordsOf`, which now read words with the scorer's own `comparisonWords`
(their private fold deleted punctuation rather than splitting on it, so the text layer's `x∈X` was
`xx` and could never match `x \in X`); in the page-presence floor's word count (G3); and in the
bibliography rule's word count (G7). The PDF baseline is not transformed except in `wordsOf`, where
it is a no-op on a text layer without TeX. `meta.title` and `meta.byline` go through `plainMaths`,
which prints `The \(p\)-adic` as `The p-adic` for the masthead, the shelf and the tab (G6).

**The markup check therefore runs only outside recognised spans.** Inside a span there is no control
word left for `MARKUP` to find. An unrecognised `\(` or `\[` is matched by its opener even if it has
no control word — important for a TeX comment, whose hidden words must not satisfy recall. Dollar
delimiters and bare TeX in prose also stay markup and still cost a retry, which is right: the prompt
forbids them, and stage 1 refuses a bare `$x$` anyway.

**The prompt** (F7): rules 1, 2 and 8 rewritten together, since rules are in priority order and
rule 1 demands exact printed notation. Rule 1 keeps "copy exactly" for prose and says maths keeps its
meaning, symbols and numbers exactly, written as rule 8 says; rule 2's single allowed transformation
applies outside maths; rule 8 asks for `\(…\)` inline and `\[…\]` displayed, equation numbers
outside the delimiters, never `$`. The backslashes are doubled in the template literal, and a
module-scope assertion throws at import if `SYSTEM` does not contain the four delimiters as written.
`PROMPT_VERSION` goes to `pdf-v4`; the cache key already changes with the prompt, because
`promptFingerprint()` hashes `SYSTEM` itself.

## The simpler option passed over

**Only the prompt change** — the first draft of the parent plan. Refused on F1: a maths chunk would
be charged twice and never checkpointed, so every re-run pays again.

**Relaxing the checks instead** — dropping `\\[a-zA-Z]{2,}` from `MARKUP` and letting `_` through
`protect`. Smaller, but it blinds the markup check everywhere, which is the cheap signal that a model
has stopped following instructions, and it leaves `\frac{a}{b}` folding to the invented token
`frac`, costing precision on every equation.

**Not transforming the text layer too.** It holds no TeX, and transforming it would be a second place
the rule could drift.

## Stages

1. **Red first.** Unit tests in `tests/pdf-tex.test.ts` for `\frac`, `\sum`, subscripts, Greek,
   `\text{…}`, environments; a TeX maths chunk scored by `check` today fails (markup, invented) — seen
   red; malformed delimiters and `$…$` still flagged. In `tests/pdf-read.test.ts`: a stubbed whole
   stage whose reader writes some lines as TeX passes with one ask per chunk, is checkpointed, and a
   second run asks nothing; the F9 regression — a short context-page equation, as TeX, relabelled as
   the requested page, is removed by `withoutRepeats`; the prompt's delimiters are in `SYSTEM` as
   single backslashes.
2. **Build** the comparison form, wire it, rewrite the prompt, bump the version. Mutate and watch
   the tests notice.
3. **Measure** the same paper (19 pages, the MDPI mirror, 2,138,371 bytes — the file the parent's
   reproduction used) through `npm run eval:pdf-read`: per-page recall against the baseline
   (0.915–1.0, page 8 lowest), chunks asked twice, whether equation (1) comes out as delimited TeX.
   Plus one run of the stage against an in-memory checkpoint store, twice, to see the second run ask
   nothing on the real paper. **If recall is materially below baseline, stop and report.**
4. Docs: [content-extraction.md](../project/content-extraction.md),
   [maths.md](../project/maths.md), the parent plan's stage 2 section, the feedback note.

## What done means

The unit tests above red then green; the measurement recorded here with its numbers; typecheck and
the PDF test files green; GPT Sol plan and code reviews taken or overruled below. Existing articles
are untouched — a re-import is how a PDF on the shelf gets TeX.

## What is not known

- Whether the model obeys "never `$`" reliably. If it slips, the chunk is retried (as today for any
  markup), which costs money but not correctness.
- Whether TeX output is noisier for recall than flattened symbols on this paper — the measurement is
  what answers it.

## Review ledger

**Plan review** — [260924b-…-plan-review-sol.md](260924b-pdf-transcriber-writes-maths-as-tex-plan-review-sol.md),
GPT Sol, independent (it ran its own temml probe). Refused on G1–G4, G6.

- **G1** (P1, recovery checkpoints a reading with content warnings) — **overruled**: not specific to
  TeX. Recovery is the structural path; a recovered chunk with a content warning is published with a
  note and checkpointed today for any warning, by design (the 2026-08-30 publish-with-notes call). The
  TeX change adds no new way to reach it. Reported as wider than this stage.
- **G2** (P1, spans that compare as words while the reader sees something else) — **taken**: the
  allow-list and exact renderer check above, with regressions for invisible commands, TeX comments
  and invalid sequences made only from allowed commands.
- **G3** (P1, `\frac \sum \sqrt` clear the presence floor) — **taken**, with the formula as the
  regression.
- **G4** (P1, a two-token context fraction escapes dedup) — **overruled**: the four-word floor on
  the context rule and the twenty-word floor on exact repeats apply to every record, plain text
  included — they are what protect a repeated one-word list item or `(1)`. A three-token plain
  fragment of the context page escapes today exactly as `\frac{a}{b}` would. F9's actual mechanism,
  the fold mismatch that let a full equation escape, is fixed and pinned.
- **G5** (P0 reasoned, `x1` against a baseline that splits `x 1`) — **left to the measurement**: this
  paper's text layer glues (`Yt+1`, `log2`), and a split baseline costs recall a token or two per
  script, not a failed chunk, unless a chunk is nearly all maths. The measurement below is the check.
- **G6** (P1, TeX in title and byline) — **taken**: `plainMaths`.
- **G7** (P1 reasoned, bibliography share counts raw TeX) — **taken**: the count reads
  `mathsAsText`. No dedicated test; `bibliographyPages` is private and the change is one call.
- **G8** (P2, no decision rule) — **taken**: the rule is declared below, before measuring.

**Code review** — [260924b-…-code-review-sol.md](260924b-pdf-transcriber-writes-maths-as-tex-code-review-sol.md),
GPT Sol, write-capable, one round. It fixed five P1s red-first inside the stage, each read and
re-gated here:

- **H1** — an unescaped `%` is a TeX comment: the check counted the words after it, and the reader
  would see none. Recognition now refuses a span with one.
- **H2** — the allow-list proves each word, not the sequence: `\frac{a}`, a `\left(` with no
  `\right`, mismatched environments passed while stage 1 would leave them raw. Recognition now also
  asks stage 1's own bounded temml renderer and acceptance rule. None of the 67 live spans would
  have changed (0 refused), so the measurement stands.
- **H3** — `$x$`, `$$…$$` and an unrecognised `\(` with no control word in it escaped `MARKUP`. Now
  markup, without catching `$5 and $10` or `$PATH/$HOME`.
- **H4** — nested braces slipped past the `\text` paragraph limit; `alignedat`'s `{2}` and `[t]`
  were counted as printed.
- **H5** — `plainMaths` collapsed spaces in a title with no maths in it.
- **H6** (P3) — the docs said per-page recall was identical; two pages differ by 0.001. Corrected.
- **H7** (P1, reported) — a relation is not checked: `x = 1` and `\(x \ne 1\)` score the same,
  because `fold` drops symbols. True of the plain-text check before this, and of any word-level check;
  **left, and named in `mathsAsText`'s docblock.**
- **H8** (P1, reported) — G1 again; overruled above for the same reason.

**What H2 nearly shipped, and the test that caught it.** Sol loaded temml synchronously with
`createRequire(import.meta.url)("temml")`. I added `temml.cjs` to `tests/pdf-bundle-trace.test.ts`
and built: **it is not traced into the API function.** In production every span would have been
unrecognised, and every maths chunk asked twice — the P0 this plan exists to prevent, with every
unit test green. Fixed with `loadPdfMathsRenderer` (since stage 3b `loadMathsRenderer` in `src/maths-server.ts`), a literal `await import("temml")` (the seam the
tracer already follows for the quote check) called at the top of `runPdfExtract`; the synchronous
path stayed as a fallback for evals and the CLI until the env sweep refused it (§ Log, below). `tests/pdf-tex-stage-loads-temml.test.ts` takes
the fallback away, as production does, and runs the stage: green with the loader call, red without
it. After the fix the build's trace and cold-start tests pass. No second Sol round: the change is a
correction to the review's own fix, and the wiring test and the build are stronger evidence than a
read.

## The measurement's decision rule, declared before it ran

Baseline (the parent's run, old prompt): mean recall 0.993 over 17 pages, per page 0.915–1.0, page 8
lowest. **Materially below** means any of: mean recall under 0.97; any page under 0.88; a chunk
failing its content check on its final attempt. Also required: zero spans stage 1 refuses to draw,
zero dollar spans, equation (1) delimited, and the second run over the same checkpoint store asking
nothing. One run; a second only if a number lands within 0.02 of its line.

## What the measurement found

2026-09-24, the same 19-page PDF, `openai/gpt-5.6-luna` through OpenRouter, the real stage against an
in-memory checkpoint store, then a second run over the same store. A **control** run with the base
commit's prompt and checks (`3ddb24dc`, `pdf-v3`) was made the same way, because the declared rule's
third clause tripped and needed a baseline to read against. Two runs each, $0.09 each.

| | new (`pdf-v4`, TeX) | control (`pdf-v3`) |
|---|---|---|
| mean recall, pages checked | 0.993, 17 | 0.993, 17 |
| per page | 0.915–1.0, page 8 lowest; page 1 0.975 | the same except page 11 (0.999 vs 1.0) and page 14 (0.997 vs 0.996) |
| chunks asked twice | 3 of 5 | 3 of 5 |
| chunks ending on a content warning | 2 — page 1's DOI/journal line, page 8's figure-lattice labels | the same 2, plus an invented `i=1\|A` |
| markup / invented on any final chunk | none | one invented |
| checkpointed on run 1; asked again on run 2 | 3; the 2 warned chunks | 3; the same 2 |
| delimited spans; refused by stage 1; dollar spans | 67 (14 display); 0; 0 | 0 |

- **Equation (1)** is one record: `\[ I(X;Y) := \sum_{x\in X}\sum_{y\in Y} P(x,y)\log_2\frac{P(x|y)}{P(x)} \] (1)`;
  equation (4)'s `≠` is `\ne`, not `6=`.
- **Maths chunks pass first time and are reused.** Chunks 15–18 and 19 passed first time and were
  read back on run 2 without a call. Chunks 1–5 and 6–10 hold equations (1)–(4) and had no markup and
  nothing invented; they failed only on the two non-maths runs above, which the control fails on
  identically — and a chunk ending on a content warning is never checkpointed, by the existing rule
  (only a passing reading is kept). Chunk 11–14's first attempt wrote `\sx`, which is not TeX
  (stage 1 would have left it raw); the markup check caught it and the second attempt passed. That
  retry is the check doing its job.
- **G5** (`x1` against a split baseline) did not show: mean recall is the control's to three places;
  the two 0.001 page-level differences go in opposite directions.
- **Against the declared rule**: mean 0.993 ≥ 0.97, worst page 0.915 ≥ 0.88, zero refused spans, zero
  dollar spans, equation (1) delimited. The third clause (a chunk failing on its final attempt) and
  the "second run asks nothing" line both trip — on two chunks whose faults are not maths and which
  the control shares exactly. **Not a regression; shipped.**

## Stage 3b: HTML imports

**What a web page carries, measured on the extraction corpus** (`evals/extraction/fixtures/`): three
of the pages with maths deliver it the same way — a MathML `<math>` holding its own TeX source in an
`<annotation encoding="application/x-tex">`.

| fixture | `<math>` | with an x-tex annotation | wrapper |
|---|---|---|---|
| `ar5iv.html` (LaTeXML) | 142 | 142 (and `alttext`) | none — the `<math>` itself |
| `wiki_transformer.html` (MediaWiki) | 188 | 188 (and `alttext`) | `span.mwe-math-element`, which also holds a fallback `<img alt="{\displaystyle …}">` |
| `distill_momentum.html` (KaTeX) | 268 | 268 | `span.katex` = MathML + an `aria-hidden` HTML rendering; `span.katex-display` for display |

The source-DOM pass converts all 598. Readability then retains **551 drawable spans** in the
extracted articles: 142, 188 and 221 respectively. The first measurement called that 598 in block
text; it had crossed the before/after-Readability boundary, and a regex then over-counted 17
`\\[` line-spacing commands inside Distill TeX as new formula openers. The corpus test now asks the
reading view's own `findMathSpans` instead.

**Before this stage**: the sanitiser deleted `<annotation>` (src/sanitize-policy.ts), so the
TeX is thrown away. ar5iv keeps native MathML, whose text is the symbols; Wikipedia shows its SVG
fallback images; KaTeX's MathML *and* its HTML rendering both survive, since
`unhideCollapsedSections` lifts `aria-hidden` — the formula's text twice. Maths is a second
representation on every one of them.

**The formats, and which are built:**

1. **MathML with an x-tex annotation** — built. The one seam covers all three fixtures and KaTeX in
   general: a `<math>` with the annotation (or, failing it, a TeX `alttext`) becomes a text node
   `\(tex\)`, or `\[tex\]` when it is `display="block"`. The whole wrapper goes with it — the
   `.katex` span (its HTML twin included), `.katex-display`, and `.mwe-math-element` (its fallback
   image included) — so nothing is left drawn twice. A leading `{\displaystyle …}` / `{\textstyle
   …}` wrapper, which MediaWiki adds to every formula, is taken off.
2. **MathJax v2 `<script type="math/tex">`** (`; mode=display` for display) — built, in the same
   pass: a static fetch never runs MathJax, so the source is the script's text. A preceding
   `.MathJax_Preview` sibling goes with it. No corpus fixture has one; the test's fixture is
   hand-written.
3. **`<img alt="TeX">` alone** — **not built, named next.** Only with a class that says the alt is
   TeX (WordPress.com's `img.latex`): an arbitrary alt is prose. Wikipedia's image is already covered
   by (1), via its wrapper.
4. **Bare MathML with no annotation** — **not built, named next.** It needs a MathML-to-TeX
   converter; the candidates are a dependency (`mathml-to-latex`, MIT) or a hand-written walker for
   the common elements. It stays native MathML meanwhile, which draws well already, so it is the
   least urgent.

**Where it sits**: `canonicaliseMaths(doc)` in a new `src/maths-import.ts`, called from
`prepareDocument` in `src/extract.ts` — the one place both Readability callers (`readArticle` and
`readArticleWithProvenance`) prepare the source DOM, before Readability and before the sanitiser
deletes the annotation. After the furniture, note and callout recognisers, so none of them sees a
changed input, and before `protectAuthoredStructure`, which stays last (K6).

**A failed conversion leaves the page as it was** — the rule that keeps it small. The page's declared
TeX is trusted as the formula's source; nothing compares it with the MathML (K4). A formula is
converted only if stage 1 would draw it: the same bounded temml renderer and acceptance rule
(`src/maths-tex.ts`), loaded server-side. The loader moved out of `src/pdf-tex.ts` into a shared
`src/maths-server.ts` — one literal `await import("temml")` the bundle traces, awaited by
`runPdfExtract` always and by `runExtract` only when the raw page holds `<math` or `math/tex` (K7),
and by every test and eval that reaches the check without a stage — there is no synchronous
fallback (§ Log). Also left as the page had it: TeX holding its own closer
(`\]` for display, `\)` inline); maths inside every element the reading view skips, including
existing MathML and SVG (K2); a formula a link points at by id (K3); a wrapper whose exact known
formula-and-twin topology does not hold (K3); and a MathJax source nested in a KaTeX or MediaWiki
formula.

**Block ids.** A new article is fine: its ids are minted from the TeX. **An article already on the
shelf changes only if it is re-extracted** (a refresh). Measured (K5) by running each fixture's
stage 2 without and with the conversion, then stage 3 over the new article with the old blocks as the
previous run:

| fixture | blocks before → after | carried | reminted (all hold maths) | carried, text changed |
|---|---|---|---|---|
| ar5iv | 149 → 149 | 122 | 27 | 10 |
| wiki_transformer | 365 → 365 | 314 | 51 | 0 |
| distill_momentum | 145 → 145 | 87 | 58 | 0 |

Every reminted block holds maths; no block without maths moved; title, refusal and the furniture,
note, callout and protection stats are identical on all three (K6). A reminted block loses what was
anchored to it — the designed failure (block-ids.md § Two honest limits), and the parent plan's
warning. And since block text changes, `hashBlocks` does, so a refresh re-runs the paid downstream
stages for that article, as any text change would. Not mitigated: a mapping step would be a second
mechanism.

**Fable arbitrated this, 2026-09-24: accept it.** Skipping the conversion on a refresh would make
stage 2's output depend on stage 3's artefact and leave the existing shelf on MathML for good.
A maths-neutral key in `carryOverIds` would be fuzzy matching by another name, and would still
re-mint a block that is only a formula. What would change it: a read-only production count of
comments, highlights and notes anchored to blocks whose html holds `<math`, KaTeX or MathJax. If
that is more than a handful, the answer is a one-off remapping script run with Greg's approval, not
a mechanism.

**Passed over**: converting in the browser at display time (stage 1 already skips `<math>`, and the
annotation has been sanitised away by then); keeping MathML as a second stored form (the brief: one
representation).

**Review ledger, stage 3b.** Plan review
[260924b-…-3b-plan-review-sol.md](260924b-pdf-transcriber-writes-maths-as-tex-3b-plan-review-sol.md)
refused on K1, K2. All eight taken: K1 (display from the wrapper, and the outer `.katex-display`
replaced) and K2 were already in the build and are pinned; K3 guards added (wrapper topology, link
targets), with tests seen red by mutation; K4 by rewording the promise; K5 and K6 by the measurement
above, and by moving the call after the recognisers; K7 by the raw-page test and the mock retarget;
K8 by tense, now that it is built.

**Done means**: a failing test per built format (a TeX-annotated `<math>`, the three wrappers, a
MathJax script, display vs inline), plus a temml-refused formula left alone; destructive wrapper,
nested-formula and MIME-lookalike cases seen red then fixed; all 598 source formulas converted and
all 551 formulas retained by Readability found by the reading view's scanner; the bundle and
cold-start tests green after a build; content-extraction.md and maths.md updated.

**Code review, stage 3b** — [260924b-…-3b-code-review-sol.md](260924b-pdf-transcriber-writes-maths-as-tex-3b-code-review-sol.md),
GPT Sol, write-capable, one round. It fixed, red-first: **L1** (P0) an outer `<math>` adopting a
nested formula's annotation and deleting its siblings; **L2** (P0) wrapper checks that were shallow
— now the exact KaTeX and MediaWiki topologies only; **L3** nested MathML/SVG converted though the
reading view skips it, and detached candidates counted; **L4** the MathJax type test (`math/texture`,
case, nesting, a preview that is a link); **L5** the measurement, now 551 spans kept by Readability
out of 598 converted, counted with the reading view's own scanner. **L6** (a peer's typecheck error in
`tests/shelf-cached-paint.test.tsx`) is not this stage's. I read its diff; the corpus still converts
598 of 598; after a build, 26 scoped files and 661 tests pass, bundle trace and cold start included.

## Log

- 2026-09-24 — plan written; the PDF re-downloaded from the mirror (same byte count as the parent's
  run); text-layer baseline dumped to confirm pdf.js glues subscripts to their base.
- 2026-09-24 — **the synchronous temml fallback removed.** `createRequire(import.meta.url)("temml")`
  in `src/maths-server.ts` (and in `src/pdf-tex.ts` at `42cb3bf5` before it) is a non-literal
  `require`, which `tests/env-reads-are-literal.test.ts` and `tests/env-names-are-inventoried.test.ts`
  refuse; dev had been red on both since `42cb3bf5`. It was also untraced into the built function,
  so it only ever worked where it did not matter. Now `texWouldDraw` answers `false` until
  `loadMathsRenderer()` has run, and every caller that is not a stage loads it first: `beforeAll` in
  `tests/{maths-import,pdf-tex,pdf-read,extract-protect,table-oracle}.test.ts`, top-level `await` in
  `evals/extraction/{arms,provenance,table-oracle,tidy,probe}.mts` and
  `evals/pdf/{bakeoff/score,bakeoff/detail,item-boundaries/compare}.mts`. The two stage wiring tests
  lost their `node:module` mock, which is no longer needed: they never load temml themselves, so a
  stage that forgot fails them — checked by commenting out each stage's load (both red, then green).
