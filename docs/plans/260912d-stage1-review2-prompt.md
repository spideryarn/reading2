# Review, round 2 (narrow): your own three fixes to the maths rendering

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations, branch
worktree-fb30-render-latex-equations.

## The candidate

Committed: `88919ff8` — your fixes for F12, F13 and F14, committed by me unchanged.
              git diff a77328c9 88919ff8
              changed paths: `git diff --name-only a77328c9 88919ff8`

Your round-1 review is `docs/plans/260912d-stage1-review-sol.md`; the prompt it answered is
`docs/plans/260912d-stage1-review-prompt.md`. The stage commits it reviewed were `0598da9d` and
`a77328c9`.

## What this round is — and is not

**Discovery is closed.** Under the house workflow (docs/reusable/engineering-manager.md § GPT Sol, "Two
rounds per stage"), this round is a narrowly scoped check that each of F12, F13 and F14 **is actually
closed by the fix in `88919ff8`**, and that the fix did not break the invariant it touched. It is not
a fresh review of the stage. Treat the fixes as code written by someone else.

Answer each of these, one per finding, established or reasoned:

- **F12** — is the server's rendered form now the same text the browser draws, for every shape the
  browser can produce: a formula split by an inline element, one formula rendered beside one left as
  source, existing MathML/SVG, text inside `code`/`pre`, nested block elements inside a block (an
  `<li>` holding a `<p>`)? `renderedBlockMathsText` in `src/quote-in-block.ts` walks jsdom text nodes
  with a local-name skip set; the browser uses `closest(SKIP)` in `src/web/maths.ts`. Do those two
  skip rules agree in every namespace? Does `root.textContent` of a jsdom fragment equal the
  browser's `renderedText` for the same block when nothing is rendered at all?
- **F13** — every resolver of a model-backed passage in `src/web/search-hits.ts` now uses
  `findOnlyQuote` in a rendered-maths block. Is there a resolver that still passes a `block.text`
  offset into rendered text? And does `findOnlyQuote`'s "careful pass first, forgiving pass only if
  the careful one found nothing" ever return a unique forgiving match when the careful pass found two?
- **F14** — `RENDERED_MATHS` is an enumerable symbol on the block object. Does every path that copies
  or rebuilds a block between `renderArticleMaths` and the consumers (`rehostImages`' two draws and
  its fallback, React state, any `structuredClone`, `JSON` round-trip, or `{...block}` with a
  whitelist of keys) keep it — and if one drops it, is the failure the safe direction (offset trusted
  in a block whose text changed)?

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable; you can run one test file at a
time (`npx vitest run tests/<one>.test.ts`) and scripts (`node --import tsx <script>`). No network.
The route tests and the full suite are mine to run.

For each finding: an ID continuing from F14 (F15, …), a severity (P0/P1/P2/P3), established or
reasoned, (a) the input that shows it, (b) the smallest fix. Severity: P0 data loss, exploitable
security, incorrect charging, or broadly unusable; P1 user-visible wrong behaviour or an
authoritative contract violated; P2 design risk with no wrong behaviour today; P3 prose. Refuse only
on an established P0 or P1.

If all three are closed, say so in one line each and stop.

Do not change any file.
