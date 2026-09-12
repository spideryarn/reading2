The committed candidate is refused as submitted: I established three P1s. All three are fixed in the uncommitted worktree, with red-first regressions. I found no remaining established P0/P1.

### F12 — P1, established: server and browser rendered different formula sets

(a) With:

```text
block.text: We define \(x^2\) now.
block.html: <p>We define \(<em>x^2</em>\) now.</p>
quote:      define x2
```

The candidate server accepted `define x2`, although the browser leaves the split formula as TeX. Conversely, with one intact formula and one split formula, it refused the genuine mixed selection `x2, second \(y^2\)`. Existing MathML/SVG text exposed the same disagreement.

(b) The server now parses `block.html`, walks individual text nodes, skips the same code/foreign elements as the browser, and renders each node independently. Four red regressions cover split delimiters, mixed selections, MathML, and SVG.

### F13 — P1, established: model passages could move to the wrong repeated words

(a) A block beginning with a long formula followed by two occurrences of `the same words` caused the source-space `start` for the first occurrence to select the second occurrence after the formula shrank to rendered symbols.

(b) Model-backed search, idea, timeline, and referee passages now use their stored offset only when offsets remain trustworthy. In rendered-maths blocks, a unique quote is marked exactly; repeated quotes fall back to the whole block. The regression failed by selecting the second occurrence before the fix.

Glossary and literal search were not a gap: both derive offsets directly from rendered text. Generated Quotes carry no stored offset and retain their existing first-occurrence rule.

### F14 — P1, established: article HTML could forge maths provenance

(a) This authored markup made the candidate treat an unchanged block as rendered maths:

```html
<math class="rendered-maths"><mi>x</mi></math>
```

With repeated anchor text, that turned off a valid exact comment/chat offset and suppressed its mark.

(b) Renderer provenance is now an internal symbol attached to changed blocks, rather than an HTML class. It cannot arrive through article HTML or JSON, and an enumerable-symbol regression confirms it survives the object spreads used during image rehosting.

Verification passed:

- Maths, parity, quote-placement, search-hit, quote-matching, annotation, access-fallback, cold-start, and bundle-trace tests.
- Typecheck: all projects passed.
- `git diff --check` passed.
- Targeted Biome checks passed for the new code. The broader invocation still reports existing unrelated findings in `TableView.tsx` and route complexity.
- Per your instruction, I did not run the full suite or `tests/maths-quote-route.test.ts`.
- No commit was made.

Files changed:

- [docs/plans/260912d-render-latex-equations-in-the-reading-view.md](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/docs/plans/260912d-render-latex-equations-in-the-reading-view.md)
- [docs/project/maths.md](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/docs/project/maths.md)
- [src/maths-tex.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/maths-tex.ts)
- [src/quote-in-block.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/quote-in-block.ts)
- [src/quote-match.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/quote-match.ts)
- [src/routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/routes.ts)
- [src/web/TableView.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/web/TableView.tsx)
- [src/web/maths.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/web/maths.ts)
- [src/web/search-hits.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/src/web/search-hits.ts)
- [tests/maths-parity.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/tests/maths-parity.test.ts)
- [tests/maths.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/tests/maths.test.ts)
- [tests/quote-in-block.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/tests/quote-in-block.test.ts)
- [tests/search-hits.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb30-render-latex-equations/tests/search-hits.test.ts)

The two pre-existing untracked plan/feedback files were left untouched.