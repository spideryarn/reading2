Verdict: **CONDITIONAL ACCEPT after fixes** — stage 3b is sound, but the conclusion is **598/598 source formulas canonicalised and 551 formulas retained as drawable block text**, not 598 in block text; one unrelated typecheck failure remains.

- **L1 — P0 — established, fixed.** An outer `<math>` could adopt a nested formula’s annotation and delete sibling content. Annotation ownership is now restricted to the nearest `<math>`. Evidence: [maths-import.ts:84](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/maths-import.ts:84), red/green test [maths-import.test.ts:178](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/maths-import.test.ts:178).

- **L2 — P0 — established, fixed.** Wrapper validation was shallow: authored content inside an allowed MathML container, or nested publisher wrappers, could be deleted or partially converted. KaTeX and MediaWiki wrappers now require exact formula/twin topology. Evidence: [maths-import.ts:106](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/maths-import.ts:106), tests [maths-import.test.ts:165](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/maths-import.test.ts:165).

- **L3 — P1 — established, fixed.** Nested MathML/SVG was converted despite the reading view skipping it, and detached snapshot descendants inflated the conversion count. The importer now shares the full skip set and ignores detached candidates. Evidence: [maths-import.ts:49](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/maths-import.ts:49), [maths-import.ts:185](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/maths-import.ts:185).

- **L4 — P1 — established, fixed.** The MathJax selector accepted `math/texture`, missed case variants, converted scripts nested in other formula wrappers, and could remove a preview carrying a link or link target. All are now guarded by red/green tests. Evidence: [maths-import.ts:64](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/maths-import.ts:64), [maths-import.test.ts:104](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/maths-import.test.ts:104), [maths-import.test.ts:226](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/maths-import.test.ts:226).

- **L5 — P2 — established, fixed.** “598 of 598 in block text” was an invalid measurement. All 598 source-DOM formulas convert, but Readability retains 142 + 188 + 221 = **551** drawable spans. The former regex also miscounted 17 Distill `\\[` spacing commands as formula openers. The corpus test now uses the reading view’s scanner. Evidence: [maths-import.test.ts:241](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/maths-import.test.ts:241), [plan:249](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:249).

- **L6 — P2 — established, reported only.** Typecheck is blocked by unrelated concurrent work: `archived` should be `archivedAt` in [shelf-cached-paint.test.tsx:576](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/shelf-cached-paint.test.tsx:576). Untouched as instructed.

Checks:

- Requested Vitest gate: **8 files, 138 tests passed**.
- `npm run typecheck`: exited 1 because this sandbox denies `tsx`’s `/tmp` IPC socket.
- Equivalent non-IPC invocation checked every project; stage files are clean, with only L6 failing.
- Scoped lint: exit 0.
- `{\displaystyle a}{b}` remains intact.
- HTML escaping round-trips without changing the TeX seen by the span scanner.
- Lazy loading test proves no Temml import for prose and one import for a candidate maths page.
- Reviewed against current `HEAD` `0e3bc642`; the prompt’s `2cc54abf` was no longer the worktree HEAD.