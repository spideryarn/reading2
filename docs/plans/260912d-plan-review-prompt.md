# Review: a plan to render LaTeX equations in the reading view

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations, branch
worktree-fb30-render-latex-equations. TypeScript + ESM; a React client under `src/web/`, a pipeline
under `src/`. Read `AGENTS.md` (= `CLAUDE.md`) for orientation if you need it.

## The candidate

Live pre-commit: base `ab3fa8db`; scoped paths: `package.json`, `package-lock.json` (temml 0.13.5
added, exact); untracked: `docs/plans/260912d-render-latex-equations-in-the-reading-view.md` (the
plan — this is what you are reviewing). Nothing is built yet.

Start with the plan, then: `src/web/article/access.ts` (§ `resolveAccess`), `src/web/sanitize.ts`,
`src/sanitize-policy.ts` (§ `installArticlePolicy`, the MathML notes), `src/web/annotate.ts` (the
offset space; `renderedText`, `annotateHtml`, the `<math>` skip), `src/web/selection.ts`,
`src/web/rehost.ts` (§ `rehostBlockHtml` — the shape the new pass copies), `src/pdf-read.ts`
(§ `SYSTEM`, rule 8; `renderHtml`), `src/pdf-score.ts`, `src/pdf-integrity.ts`,
`docs/project/block-ids.md`. That is where to begin, not the limit.

## What it is meant to do

Greg (the product owner) uploaded a maths-heavy PDF and saw raw LaTeX in the prose. The plan:

1. A browser-side pass at article ingress that finds delimited TeX in block text nodes and replaces
   it with temml's MathML, re-sanitised through the existing article policy; lazy-loaded only when a
   span is found.
2. A one-rule change to the PDF transcription prompt so maths comes back as delimited TeX instead of
   flattened plain text.

Invariants it must not break: block ids and stored html are never written (block-ids.md); the
sanitiser policy is not weakened and nothing reaches the DOM unsanitised; `renderedText`,
`annotateHtml` and the live DOM keep one offset space; an article without maths pays nothing
measurable.

Out of scope, deliberately: undelimited TeX, maths in side panels, normalising `block.text`,
re-extracting existing articles.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you can
build a throwaway harness under /tmp — e.g. to see what temml emits for a given input, or what the
article policy does to it (`src/sanitize.ts` § `sanitizeHtml` is the server binding of the same
policy). You have no network, not even loopback.

## Attack it

Independently, before you read my questions below. Try to break: (a) the security argument —
anything temml can emit, or any input a hostile PDF or web page can put into a text node, that ends
up in the DOM in a form the existing policy would not have allowed, or that a second parse turns
into something else; (b) the offset-space argument — any consumer of `block.html` that runs before
or outside `resolveAccess` and so disagrees with the rendered html; (c) the delimiter rules —
ordinary prose they would wrongly render, and common model TeX they would miss; (d) stage 2's
prompt change — anything in the scorer, the integrity checks, the seam-hyphen mend, dedup, the
front-matter pass or the checkpoint cache that TeX in record text would break; (e) whether the
plan's ordering of stages or its choice to do both is wrong.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario it does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — exact replacement wording for the plan, or a code sketch
A finding with no (a) goes last.

Severity: P0 data loss, exploitable security, incorrect charging, or broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design/maintainability risk
with no wrong behaviour today; P3 prose. Refuse only on an established P0 or P1 — direct evidence
with no unresolved material inference — and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Whether re-running DOMPurify over temml's output, then serialising and re-parsing it through
  `innerHTML` in `renderedText`/`annotateHtml`/React, is stable (a MathML mXSS shape).
- Whether anything reads `block.html` from the raw payload rather than the sanitised article
  (e.g. search, quotes, the lightbox, notes-view, PdfFigureNote), and would disagree on offsets.
- Whether stage 2 should be a separate plan, given it changes every future maths-bearing PDF.

Do not change any file.
