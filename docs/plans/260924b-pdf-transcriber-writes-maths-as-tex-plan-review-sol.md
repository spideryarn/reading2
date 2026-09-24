Reviewed the untracked plan against commit `3ddb24dc` explicitly; I ignored live edits from other agents. No files changed.

### G1 — P1 — established: recovery can checkpoint malformed TeX without retrying it

The plan says malformed delimiters and forbidden TeX “still cost a retry” ([plan:49](</home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:49>)), but that is true only in the ordinary attempt loop.

In recovery, `src/pdf-read.ts:2350-2374` retries only structural failures; a `content-warning`—including markup from malformed TeX—is accepted immediately. Phase 2 then checkpoints any recovered reading at `src/pdf-read.ts:2631-2635`, regardless of whether its verdict passed. The next run reuses that checkpoint because cached content warnings trigger no recovery (`src/pdf-read.ts:2462-2469`).

Change the plan to cover recovery explicitly: content warnings in `recover` receive the same retry treatment as the ordinary loop, and only a passing recovered reading is checkpointed. Add a test that forces recovery, returns malformed TeX first, then valid TeX, and proves only the valid response is stored and reused.

### G2 — P1 — established: the comparison form can hide omissions and accept TeX the renderer leaves raw

The proposed rule exempts every balanced span, drops control words, and preserves their arguments ([plan:27](</home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:27>)). That creates several deterministic holes:

- `\(\phantom{the omitted sentence}\)` compares as “the omitted sentence”, satisfying recall, but Temml renders it inside `<mphantom>`—invisible to the reader. The current `MARKUP` check would catch `\phantom`.
- `\(x\hspace{999em}\)` compares as `x` because the plan explicitly drops the dimension, hiding a number the current markup/protected-token checks catch.
- `\[x\label{spya-aaaaaa}\tag{1}\]` can compare as `x 1`, but the renderer rejects the generated `id` and leaves raw TeX. Renderer refusal is explicit in [maths-tex.ts:202](</home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/maths-tex.ts:202>) and [maths-tex.ts:217](</home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/maths-tex.ts:217>).
- A whole sentence inside `\text{…}` compares identically to ordinary prose and is no longer markup, but is displayed as a maths object.

A read-only Temml 0.13.5 probe confirmed `\phantom{omitted prose 1863}` produces `<mphantom>…</mphantom>`.

The comparison exemption needs a separate raw-span validity policy. Share `findMathSpans`, reject spans the renderer refuses, and conservatively forbid invisible, layout, cross-reference, trust-bearing, unknown, and prose-only constructs. Add regressions for `\phantom`, `\hspace`, `\label`/`\tag`, unknown commands, malformed groups, oversized spans, and paragraph-sized `\text`.

### G3 — P1 — established: TeX command names can counterfeit the structural presence floor

The plan applies the comparison form in scoring, thinning, and dedup, but not in `pdf-integrity.ts` ([plan:44](</home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:44>)).

[lexicalWords](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-integrity.ts:111) counts raw command names. Thus a valid record containing only:

```tex
\[\frac{1}{2}+\sum_{1}^{2}+\sqrt{4}\]
```

has three “lexical words”—`frac`, `sum`, `sqrt`—and satisfies the page-presence guard at [pdf-integrity.ts:127](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-integrity.ts:127), despite containing no visible lexical word. Because content failures are published after attempts, this can replace a prose-bearing page with an equation without triggering structural recovery.

Apply the comparison form before counting transcribed lexical words, while leaving the baseline rule intact. Add a page-empty regression using the formula above.

### G4 — P1 — established: F9’s short-equation regression cannot pass through the planned wiring alone

The plan promises that a short context-page equation is removed ([plan:82](</home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:82>)), but `withoutRepeats` invokes `isContextPage` only for four or more words (`src/pdf-read.ts:3094` at `3ddb24dc`). Anything shorter than twenty words is then kept unconditionally (`src/pdf-read.ts:3097-3099`).

After the proposed comparison, `\frac{a}{b}` has only `a b`, so it still bypasses both rules. Sharing the comparison form does not by itself meet F9.

Specify the short-form rule: for a recognized maths record below four comparison tokens, use a stricter sequence/multiset match against context and require it not to match the requested pages. Pin the exact two-token fraction case, not merely an equation with four operands.

### G5 — P0 — reasoned: joining scripts to their base can still cause repeat charging

The plan canonicalizes `x_{1}` as `x1` based on one paper and declines to transform the baseline ([plan:36](</home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:36>), [plan:73](</home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:73>)). If pdf.js returns `x 1`, `protectedOf` can forgive `x1` as an invented protected token, but recall and precision still compare exact folded tokens in `scorePage` (`src/pdf-score.ts:706-752` at `3ddb24dc`). `x1` therefore matches neither `x` nor `1`.

On a maths-heavy chunk this can create a content warning, a second paid call, and no ordinary checkpoint. Actual prevalence is unresolved, hence reasoned.

Define an equivalence that handles both fused and split baselines—rather than choosing one—and test `x1`/`x 1`, `Yt+1`/`Y t + 1`, and split forms of `10^{-3}`. The same equivalence must feed context suppression.

### G6 — P1 — established: mathematical titles and bylines remain raw TeX

The article body passes through the maths renderer, but metadata does not. Front matter joins record text verbatim at [pdf-frontmatter.ts:305](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pdf-frontmatter.ts:305); `pdf-read.ts:2727-2765` stores that directly as `meta.title`; and the masthead prints it as a plain React string at [Metadata.tsx:752](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/Metadata.tsx:752). The byline follows the same path.

A PDF titled “The \(p\)-adic …” will therefore render its in-article `<h1>` correctly but show raw delimiters on the shelf, masthead, and browser title.

Add an explicit plain-string projection for metadata title/byline, while preserving the original record text for the rendered article. Test both the front-matter title path and `titleFrom`.

### G7 — P1 — reasoned: bibliography exclusion still counts raw TeX syntax

The plan covers phase-2 dedup, but `bibliographyPages` still counts raw whitespace-separated source at `src/pdf-read.ts:3038-3043` (`3ddb24dc`). A compact displayed formula can represent many visible operands as one raw “word”, changing the reference/body ratio and potentially pushing a year-dense final page above the 80% exclusion threshold. That removes the whole page from content scoring.

Use comparison words for both numerator and denominator and add boundary tests on either side of 80%, with a maths-bearing body record. The phase-2 fold itself is otherwise covered, subject to G4.

### G8 — P2 — established: “materially below baseline” has no decision rule

The measurement records useful facts, but “materially below baseline” is undefined and the parent establishes that identical model, prompt, and PDF can produce materially different mathematical output between runs. One new-prompt run cannot distinguish regression from model variance.

Predeclare thresholds and repeat count before measuring. At minimum record:

- weighted overall recall and worst-page recall;
- precision, order, invented tokens, markup, and quality warnings;
- first-attempt and second-attempt chunk counts;
- recognized spans versus spans the renderer actually accepts;
- first-run checkpoint count and second-run model-call count.

Use repeated old/new runs or an explicitly justified tolerance interval. Also require zero accepted-but-unrenderable spans; checking only that equation (1) has delimiters is insufficient.

F7 is met. F1 remains unmet through G1–G3/G5, and F9 remains unmet through G4.

Verdict: **refuse the plan as written; established P1 paths can checkpoint malformed TeX, hide omitted content, duplicate short context equations, and expose raw TeX downstream.**