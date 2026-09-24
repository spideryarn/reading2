### K1 — P1 — established

Distill display maths would be stored as inline TeX. The plan chooses `\[…]` only from `<math display="block">`, but Distill marks display on the outer `.katex-display`; its inner `<math>` has no `display` attribute. The fixture has 95 such wrappers. Evidence: [plan:257](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:257), [distill_momentum.html:1532](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/evals/extraction/fixtures/distill_momentum.html:1532), [maths.md:25](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/project/maths.md:25).

Change to the plan: define display as any of `<math display="block">`, an enclosing `.katex-display`/`.mwe-math-element-block`, or MathJax’s `mode=display`. For KaTeX, replace the outer `.katex-display`, not merely the nearer `.katex`. Record inline/display/refused counts separately for each fixture.

### K2 — P1 — established

The proposed domain includes annotated `<math>` inside `code`/`pre`/`kbd`/`samp`. Replacing native MathML there with `\(…\)` makes it raw source permanently, because the browser renderer deliberately skips those ancestors. That directly violates “never worse than today.” Evidence: [plan:257](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:257), [maths.md:29](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/project/maths.md:29), [maths-tex.ts:35](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/maths-tex.ts:35), [maths.ts:118](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/maths.ts:118).

Change to the plan: share the renderer’s ancestor exclusions, excluding the source `<math>` itself, and add negative tests for `code`, `pre`, `kbd`, and `samp`. Add positive tests showing maths inside an ordinary heading and inside an outer link remains eligible and preserves that ancestry.

### K3 — P1 — reasoned

“Replace the whole wrapper” has no topology or attribute guard. It can delete authored siblings, a wrapper that is itself a link, or an author `id`/`name` before stage 3 can retarget fragment links. The fixtures already carry IDs on all 142 ar5iv `<math>` elements and all 188 MediaWiki wrappers, although these particular fixtures contain no links to them. Evidence: [plan:259](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:259), [ar5iv.html:170](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/evals/extraction/fixtures/ar5iv.html:170), [wiki_transformer.html:1403](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/evals/extraction/fixtures/wiki_transformer.html:1403), [blocks.ts:1208](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/blocks.ts:1208).

Change to the plan: replace a known wrapper only when it has the exact formula-twin/fallback topology and no extra authored content. Preserve author `id`/`name` in replacement markup so stage 3 can retarget it; if the wrapper is an `<a>`, keep the link and replace only its formula contents. Otherwise leave the source unchanged.

### K4 — P2 — established

Temml acceptance proves that the annotation is renderable and cannot mint links/IDs; it does not prove that it represents the existing MathML. For example, MathML displaying `x` with an x-tex annotation containing `y` passes the proposed gate and changes visible content from `x` to `y`. Therefore “never worse than today” is stronger than the mechanism. Evidence: [plan:281](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:281), [maths-tex.ts:202](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/maths-tex.ts:202), [maths-tex.ts:220](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/maths-tex.ts:220).

Change to the plan: either compare rendered text with the existing MathML and refuse disagreement, or explicitly say the declared x-tex annotation is trusted as canonical and rename this promise to “a failed conversion leaves today’s representation unchanged.” Add a disagreement test.

### K5 — P2 — established

The block-ID account is too categorical. Pass two folds punctuation away, so an old block reading `x` and a new block containing `\(x\)` can share an ID when the match is unique. Conversely, because conversion happens before Readability, its scoring or block boundaries could change and churn blocks without maths. Regardless of ID survival, changed block text changes `hashBlocks`, invalidating downstream generated artefacts. Evidence: [plan:288](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:288), [blocks.ts:923](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/blocks.ts:923), [blocks.ts:947](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/blocks.ts:947), [source-hash.ts:114](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/source-hash.ts:114).

Change to the plan: replace the prediction with measurement. Run each fixture’s old extracted blocks as the baseline for the new extraction and record `idChurn`—carried, reminted, and lost—plus carried IDs whose text changed. Name the resulting downstream fingerprint invalidation and paid-stage reruns.

The fixture `hashes.json` itself should not move: it hashes the committed source bytes, which this change does not edit. The extraction outputs and `hashBlocks` values may move.

### K6 — P2 — reasoned

The seam covers both Readability callers, but its order changes more than the plan names. It runs before furniture, notes, callouts, protection, Readability scoring, and provenance stamping. Thus wrapper deletion can affect recognizer inputs; changed text can affect Readability selection; and the provenance denominator/source HTML necessarily changes. “Counts recorded” does not test these consequences. Evidence: [plan:275](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:275), [extract.ts:714](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/extract.ts:714), [extract.ts:740](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/extract.ts:740), [extract.ts:969](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/extract.ts:969).

Change to the plan: preferably place canonicalisation last in `prepareDocument`, immediately before Readability, after the source-shape recognizers. Extend “done” to compare before/after article HTML, refusal, metadata, note/callout/furniture/protection stats, block counts, and provenance coverage for all three fixtures—not merely conversion counts.

### K7 — P2 — established

The literal dynamic import is traceable and remains outside module-scope API cold start, but two gaps remain:

- Awaiting it unconditionally at the top of `runExtract` makes every HTML extraction pay for Temml, including pages with no candidate maths. The cold-start test explicitly checks structure, not timing.
- Moving the synchronous fallback from `pdf-tex.ts` to `maths-server.ts` makes the existing PDF stage test vacuous: its mock disables `createRequire("temml")` only when the caller path contains `pdf-tex`.

Evidence: [plan:283](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:283), [cold-start-lazy-imports.test.ts:22](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/cold-start-lazy-imports.test.ts:22), [cold-start-lazy-imports.test.ts:63](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/cold-start-lazy-imports.test.ts:63), [pdf-tex-stage-loads-temml.test.ts:17](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/pdf-tex-stage-loads-temml.test.ts:17).

Change to the plan: add a cheap raw-input candidate scan before loading, or explicitly measure and accept the unconditional cost. Update the fallback mock to target `maths-server`, retain the PDF stage proof, add the equivalent HTML-stage proof, and update the cold-start seam description.

### K8 — P3 — established

The reframing describes unbuilt behavior in the present tense: “HTML imports convert,” while Stage 3b repeatedly labels formats “built.” Evidence: [maths.md:10](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/project/maths.md:10), [plan:255](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:255).

Change to the plan: use future tense or “Stage 3b will…” until the implementation lands; call the formats “in scope” rather than “built.”

Verdict: **REFUSE as written — K1 and K2 are established P1s; the seam is viable once display inference and the renderer’s code/pre exclusions are made explicit.**