# Review: stage 1 — delimited TeX in an article renders as maths, and a quote across it saves

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations, branch
worktree-fb30-render-latex-equations. TypeScript + ESM; React client under `src/web/`, API routes in
`src/routes.ts`.

## The candidate

Committed, two commits (a merge of `origin/dev` sits between them — do NOT review a range across it,
it sweeps in other sessions' files):

- `0598da9d` — the renderer: `git diff e6f63d3a 0598da9d` · `git diff --name-only e6f63d3a 0598da9d`
- `a77328c9` — the server quote checks: `git diff 476641fb a77328c9` · `git diff --name-only 476641fb a77328c9`

Start with: `src/web/maths.ts`, `src/maths-tex.ts`, `src/quote-in-block.ts`, `src/routes.ts`
(`createFree`'s anchor check, `checkAnchor`), `src/web/article/access.ts` (§ `resolveAccess`),
`src/web/annotate.ts` (`resolveMark`), `src/web/TableView.tsx` (`resolveAnchors`), and the tests
`tests/maths*.test.ts`, `tests/quote-in-block.test.ts`. That is where to begin, not the limit — the two
manifests are.

## What it is meant to do

`docs/plans/260912d-render-latex-equations-in-the-reading-view.md` § Stage 1 is the contract, with
`docs/project/maths.md` the doc it produced. `docs/plans/260912d-plan-review-sol.md` is your own plan
review: F2, F3, F4, F5, F6, F8, F10, F11 were to be closed by this stage; F1, F7, F9 are the deferred
stage 2 and out of scope.

Invariants: stored html, `block.text` and `data-spya-*` block ids are never written, and no rendered
formula can mint an `id`/`name`/`href`; nothing reaches the DOM that the article policy would not have
allowed, and the new markup goes through that policy before anything parses it; outbound links keep
their new-tab behaviour; `renderedText`, `annotateHtml` and the live DOM keep one offset space, and an
old anchor in a rendered-maths block never moves to different words; an article with no maths never
loads temml, in the browser or on the API's cold start; hostile TeX cannot produce an unbounded
layout box; the server accepts a quote iff it is in the block as stored **or** as the reader saw it
drawn, and refuses words that are in neither.

Stage 1b (the second commit) exists because the browser check found that a comment or chat whose
selection crossed a rendered formula was refused with a 400: the server compared against `block.text`
(TeX) while the selection held rendered symbols.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage — each finding red-first, with the test that
reproduces it — and leave everything wider as a finding for me to decide. Do not commit. List every
file you changed at the end.

/tmp and the node_modules caches are writable. You can run one test file at a time
(`npx vitest run tests/<one>.test.ts`) and scripts (`node --import tsx <script>`). You have no
network, not even loopback, so anything needing Postgres will skip — `tests/maths-quote-route.test.ts`
is one; its result, and the full suite's, are mine to run. The implementer's browser check (Chromium
only — WebKit would not launch on this box) is summarised in the plan's Log.

## Attack it

Independently, before you read my questions below. Break the invariants above: hostile TeX and hostile
surrounding HTML (a hostile PDF or web page controls the text nodes); the delimiter scanner on real
prose and real model TeX; the parity between `renderedMathsText` (server, string rules) and the
browser's rendered, sanitised `textContent` (DOM rules); the offset space for comments, chats,
glossary terms and search hits in a block that renders maths; the lazy-load and abort paths; the
`resolveAccess` fallback; the server's slow path and its load-failure fallback.

For each finding give:
  - an ID continuing from your plan review (F12, F13, …), a severity (P0/P1/P2/P3), and whether it is
    established or reasoned
  - (a) the input or mutation I can run that shows it fails its own claim
  - (b) the fix itself with its red test, or the smallest change that closes it
A finding with no (a) goes last.

Severity: P0 data loss, exploitable security, incorrect charging, or broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design/maintainability risk
with no wrong behaviour today; P3 prose. Refuse only on an established P0 or P1, and name what
established it.

## Previous findings

| ID | Finding | Disposition | Where to look |
|----|---------|-------------|---------------|
| F1 | TeX makes the scorer charge twice | deferred with stage 2 | plan § Stage 2, deferred |
| F2 | old offsets re-anchor to wrong words | fixed | `resolveMark(…, { offsetTrusted })`, `rendersMaths`, TableView `resolveAnchors` |
| F3 | second sanitise drops new-tab links | fixed | `renderArticleMaths` tail |
| F4 | temml needs its CSS and font | fixed | `loadTemml` lazy-imports `Temml-Local.css` |
| F5 | unbounded layout box | fixed — temml **clamps** to `maxSize` rather than refusing | `MAX_SIZE_EM/PT`, `MAX_EXPAND`, `MAX_TEX_CHARS` |
| F6 | `\label` mints `spya-*` ids | fixed | `mathElement` (client), `acceptsMarkup` (server) |
| F7 | prompt rules 1–2 forbid TeX | deferred with stage 2 | plan |
| F8 | single-dollar converts shell vars | fixed — `$…$` needs a TeX signal | `findMathSpans` |
| F9 | TeX weakens dedup | deferred with stage 2 | plan |
| F10 | fallback drops rendered maths | fixed | `presentable` in `resolveAccess`, `tests/maths-access.test.ts` |
| F11 | mXSS spike used jsdom | checked in Chromium (19 hostile cases), not WebKit | plan Log |

Treat the fixes as unreviewed code written by someone else, and spend most of the run on what has
changed since.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- `rendersMaths` identifies our formulas by a class, `rendered-maths`, that the sanitiser does not
  reserve; the code argues a forged class only costs the forger's own block its offset tie-breaker.
  Is that the only consequence?
- The server scans `block.text` for spans while the client scans each **text node** of `block.html`.
  `block.text` inserts a space at nested block boundaries and collapses whitespace; a span split
  across two text nodes (an `<em>` inside a formula) renders on neither side — but could the two
  disagree about *which* spans exist in some other shape?
- `placeQuoteInBlock` accepts either form of the whole block, not per span. A quote that mixes one
  span's source with another span's symbols is refused. Is there a real selection that produces that?
- Glossary term marks and search hits still resolve with the offset trusted in a maths block — only
  comments and chats got `offsetTrusted: false`. Deliberate or a gap?

Do not commit.
