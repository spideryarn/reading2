Verdict: refuse the plan as written. F1 is an established P0: expected TeX deterministically causes extra paid calls and prevents checkpoint reuse.

## Findings

### F1 — P0 — established: expected TeX causes repeat charging

(a) The claim that command tokens “cost nothing” is false. `pdf-score.ts` explicitly classifies commands such as `\frac` and `\sum` as forbidden markup, includes command names in precision, and treats forms such as `x_1` as invented protected tokens ([pdf-score.ts:256](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/pdf-score.ts:256), [pdf-score.ts:571](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/pdf-score.ts:571), [pdf-score.ts:723](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/pdf-score.ts:723)).

The harness produced:

- `\(\frac{a}{b}\)`: precision `0.667`, markup `["\\frac"]`
- `\(x_1\)`: invented `["x_1"]`
- `\(\sum x\)`: markup `["\\sum"]`

A content warning causes a second paid attempt, and only a passing result is checkpointed ([pdf-read.ts:2481](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/pdf-read.ts:2481), [pdf-read.ts:2521](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/pdf-read.ts:2521), [pdf-read.ts:2530](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/pdf-read.ts:2530)). Therefore common mathematical chunks are charged twice and charged again on later runs, contradicting “pays in full once” in the plan.

(b) Replace “Why the scorer should not mind” with:

> **Stage 2 includes making the PDF checks TeX-aware before changing the prompt.** Recognised, balanced `\(...\)` and `\[...\]` spans get a comparison form that removes TeX control words and structural syntax while preserving operands, prose inside `\text{…}`, and printed numbers. The forbidden-markup check runs on text outside those recognised spans and on malformed or undelimited TeX. Recall, precision and protected-token checks use the same comparison form. Stage 2 does not land until a maths-bearing chunk passes on its first attempt, is checkpointed, and is reused without another model call.

Add tests for `\frac`, `\sum`, subscripts, `\text`, malformed delimiters, first-attempt passage, and checkpoint reuse.

### F2 — P1 — established: old offsets can silently re-anchor to the wrong words

(a) The plan only discusses anchors whose quote contains TeX. A formula’s source-to-MathML length change also shifts every later offset in the block. When the quoted prose occurs twice, `resolveMark` chooses the occurrence nearest the old offset ([annotate.ts:290](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/web/annotate.ts:290)). A sufficiently shortened formula can therefore move an anchor from the intended first occurrence to the second, even though the quote itself contains no maths. That contradicts the file’s explicit rule that no highlight is safer than a wrong highlight.

This affects pre-existing comments and chats, plus model anchors derived from `block.text`.

(b) Have `renderMaths` identify transformed blocks. For those blocks, do not use a pre-transform offset to disambiguate multiple matches:

```ts
resolveMark(text, anchor, { offsetTrusted: !mathsTransformed })

// When offsetTrusted is false:
// zero occurrences => null
// one occurrence   => that occurrence
// multiple         => null
```

Add a regression with a long TeX source followed by two identical phrases and prove that no mark moves to the other phrase. The plan must explicitly name the loss: ambiguous marks in transformed blocks disappear rather than move.

### F3 — P1 — established: the second sanitisation removes external-link behaviour

(a) `sanitizeArticle` deliberately performs `sanitizeBlockHtml` and then `openExternalLinksInNewTab` ([sanitize.ts:103](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/web/sanitize.ts:103)). The plan subsequently calls `sanitizeBlockHtml` again on every changed maths block. DOMPurify removes the app-added `target="_blank"`; the harness confirmed it. A paragraph containing both an external link and an equation will start navigating away from Spideryarn, including in note previews and lightboxes.

(b) The changed-block tail must be:

```ts
const clean = sanitizeBlockHtml(mutatedHtml);
const presented = openExternalLinksInNewTab(clean);
```

Replace the diagram’s final `sanitizeBlockHtml` line with “`sanitizeBlockHtml`, then reapply `openExternalLinksInNewTab`”. Test a block containing both maths and an outbound link.

### F4 — P1 — established: Temml does require supporting CSS

(a) The plan’s “no CSS and no fonts” claim, and its log claim that the stripped display style has the same default, contradict Temml itself. Temml says its minimum installation includes CSS and a 10 KB font ([README.md:3](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/node_modules/temml/README.md:3)). Its stylesheet says `display:block` is necessary in Firefox and Safari ([Temml-Local.css:33](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/node_modules/temml/dist/Temml-Local.css:33)), directly relevant to the reported iPad. It also supplies WebKit fraction, accent, script-font, enclosure and alignment corrections.

The policy strips Temml’s inline `style="display:block math"`, while the proposed overflow rule does not replace the vendor stylesheet.

(b) Replace the dependency paragraph with:

> Temml’s JS, `Temml-Local.css`, and its 9.4 KB local script font are loaded together after the first eligible maths span is found. The CSS is required for Safari/Firefox display layout and Temml’s browser corrections. No remote font is used. The lazy payload is approximately 116 KB gzip JS, 2.8 KB gzip CSS, and a 9.4 KB font when requested.

Import the vendor CSS lazily and retain the `.prose math.tml-display` overflow rule as an app-specific addition.

### F5 — P1 — reasoned from established output: hostile TeX can create an unbounded layout box

(a) Temml’s `maxSize` default is `[Infinity, Infinity]` ([Settings.js:49](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/node_modules/temml/src/Settings.js:49)). The harness showed:

```tex
\rule{1000000em}{1000000em}
```

becoming:

```html
<mspace mathbackground="black" width="1000000em" height="1000000em">
```

Those attributes survive the existing sanitiser. Thus text that was previously inert can create a million-em box and make the reading view unusable. Re-sanitisation does not bound resource or layout amplification.

(b) Use explicit limits and a source-length ceiling, for example:

```ts
const TEMML_OPTIONS = {
  throwOnError: true,
  trust: false,
  maxExpand: 1000,
  maxSize: [50, 500] as [number, number],
};

if (tex.length > MAX_TEX_CHARS) leaveSourceAlone();
```

Choose the final limits from a real equation corpus. Test huge `\rule`, `\hspace`, `\raisebox`, macro expansion, and an oversized source span.

### F6 — P1 — established: Temml can mint duplicate `spya-*` IDs despite `trust:false`

(a) `\label` is not trust-gated. Combined with `\tag`, Temml emits an HTML `id` ([label.js:7](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/node_modules/temml/src/functions/label.js:7), [buildMathML.js:284](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/node_modules/temml/src/buildMathML.js:284)). The harness confirmed:

```tex
x\label{spya-aaaaaa}\tag{1}
```

survives sanitisation as `<mtr id="spya-aaaaaa">`. `\ref`/`\eqref` can likewise emit an anchor ([ref.js:20](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/node_modules/temml/src/functions/ref.js:20)).

That contradicts both “block ids are untouched by construction” and the unique-ID contract ([block-ids.md:37](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/docs/project/block-ids.md:37)).

(b) Inspect only the generated Temml fragment before insertion. If it contains `id`, `name`, `href`, or `xlink:href`, leave that source span unchanged. These cross-formula features cannot work reliably when each span is rendered independently anyway. Add `\label`, `\tag`, `\ref`, and a colliding `spya-*` regression.

### F7 — P1 — established: the prompt’s higher-priority rules forbid its proposed change

(a) The plan says only rule 8 changes. But the prompt says rules are in importance order, rule 1 demands exact printed notation, and rule 2 says the only permitted transformation is joining hyphenation ([pdf-read.ts:377](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/pdf-read.ts:377)). A lower-priority rule asking for TeX contradicts both. The model may continue flattening maths while obeying the higher rule.

A second implementation trap is that a TypeScript template literal must spell the source delimiters as `\\(`, `\\)`, `\\[`, `\\]`; writing the plan’s literal Markdown spelling loses the backslashes at runtime.

(b) Replace rules 1–2 and 8 together:

```text
1. Copy ordinary prose exactly. Preserve the mathematical meaning and equation numbers exactly,
   representing mathematical notation according to rule 8.
2. Outside the mathematical representation required by rule 8, the only transformation allowed is
   joining a word broken by end-of-line hyphenation.
...
8. ... Write inline mathematical notation between \( and \), and displayed notation between \[ and
   \]. Keep equation numbers outside those delimiters as plain text. Never use dollar delimiters.
```

In the TypeScript source, double those backslashes and add a runtime assertion against `SYSTEM`.

### F8 — P1 — established: single-dollar parsing still converts ordinary technical prose

(a) Pandoc’s rules do not distinguish maths from shell variables. Both of these become candidates:

```text
Set $x=$y before running it.
Expand $PATH/$HOME first.
```

Temml successfully parses `x=` and `PATH/`, so `throwOnError` does not save them. The plan’s price example proves only one negative case.

(b) Since Stage 2 promises never to emit dollars, omit single-dollar delimiters from v1. Keep `$$`, `\(` and `\[`; add `$…$` later only after obtaining Greg’s actual specimen. If legacy single-dollar support is retained, require a strong TeX signal such as a command, braces, subscript or superscript and document that bare `$x$` is deliberately missed.

### F9 — P1 — reasoned: TeX also weakens context-page and duplicate suppression

(a) `withoutRepeats` uses a different fold that deletes punctuation without inserting separators ([pdf-read.ts:3083](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/pdf-read.ts:3083)). For example, `\frac{a}{b}` becomes `fracab`, which does not match the PDF text layer’s operands. A context-page equation re-emitted under the next page’s number can therefore fall below the 90% context match and, being under twenty words, bypass exact-repeat suppression. The duplicate equation reaches the article.

(b) The TeX comparison transformation required by F1 must be shared with `withoutRepeats` and `wordsOf`, not implemented only in `pdf-score.ts`. Add a regression containing a short context-page equation deliberately mislabelled as a requested page and prove it is removed.

### F10 — P2 — reasoned: both rehost draws and its fallback must retain rendered maths

(a) `rehostImages` rebuilds its second draw from the article passed to it, which is good, but `resolveAccess`’s rejection fallback explicitly returns `clean` ([access.ts:372](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/web/article/access.ts:372)). If implementation introduces separate `clean` and `rendered` variables, an image-promise rejection will replace the maths-rendered first draw with raw TeX.

(b) Make the value passed to rehosting and fallback the same object:

```ts
const presentable = await renderMaths(sanitizeArticle(found.article));
const rehosted = await rehostImages(presentable, ...);
// ...
.catch(() => accessWith(presentable));
```

Add a rejected-image-promise test around a maths-bearing block.

### F11 — P2 — established proof gap: the mXSS spike used the wrong parser

(a) The recorded spike uses server `sanitizeHtml`, which is jsdom-backed. The project’s own browser sanitiser says a jsdom result cannot establish safety under Chrome/Safari because parser disagreement is the mXSS mechanism. My jsdom probes were idempotent and reparse-stable for ordinary, labelled and hostile-size outputs, but that does not settle the browser boundary.

(b) Amend Stage 1’s done criteria to require hostile Temml outputs to be sanitised, serialised, inserted through `innerHTML`, serialised again, and checked in Chromium and WebKit/Safari. Cover foreign-content nesting, labels/refs, nested anchors, malformed delimiters, `annotation-xml`, URL-bearing commands, and a second sanitisation no-op.

## Stage decision

The ordering is right: renderer first, prompt second. I would ship neither until F2–F6 are resolved, but Stage 1 can still land alone once they are.

Stage 2 is not a one-rule prompt edit. It necessarily includes the scorer and dedup changes in F1 and F9. Keeping it in this plan is reasonable because the producer and consumer are coupled, but it should remain a hard-gated second stage; splitting it into a follow-up plan would also be defensible if Stage 1 needs to move immediately.

I found no executable Temml/DOMPurify bypass in the available jsdom harness. The concrete security failures are structural/layout capabilities—unbounded MathML dimensions and runtime ID/link creation—not script execution.

No files were changed and no Vitest file was run; the evidence above came from read-only source inspection and throwaway Node/Temml/sanitiser probes.