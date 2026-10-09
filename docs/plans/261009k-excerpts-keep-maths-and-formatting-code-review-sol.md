1. **Medium — [src/web/search-hits.ts:135](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/search-hits.ts:135), [src/quote-match.ts:446](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/quote-match.ts:446):** `Found.start` points to the search match, not the beginning of the displayed snippet. Repeated text could therefore inherit formatting from the wrong occurrence. Added exact `shortStart`/`longStart` offsets and used them at Search, Ideas, and Timeline call sites.

2. **Medium — [src/web/CommentDialog.tsx:667](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/CommentDialog.tsx:667), [src/web/Dock.tsx:4809](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/Dock.tsx:4809):** comment and asked-question excerpts discarded their stored anchor offset, so repeated selections used the first occurrence’s formatting. Passed `comment.start`/`item.start`; whole-paragraph behaviour remains unchanged.

3. **Medium — [src/web/excerpt-html.ts:200](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:200):** `near` was measured in complete rendered text while matching excluded SVGs, controls, and other dropped content. Added an offset projection so content before the excerpt cannot shift repeat selection.

4. **Low — [src/web/excerpt-html.ts:124](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:124):** although normal loads replace blocks, mutating an existing block could return a stale cached result. Cache entries now validate the drawn HTML, source HTML, and renderer. The parsed tree itself remains immutable: ranges are cloned and output nodes are recreated.

5. **Medium — [src/web/excerpt-html.ts:83](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:83):** preserved MathML could retain ARIA and other ID-reference attributes such as `aria-labelledby`, pointing back into the article. Expanded addressing removal and added a regression covering IDs, ID references, data attributes, links, styles, handlers, and nested HTML. No sanitizer or policy files were edited.

6. **Low — [src/web/excerpt-html.ts:184](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:184), [tests/excerpt-html.test.ts:116](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/tests/excerpt-html.test.ts:116):** no further defect after auditing `finish`, `withAncestors`, formula widening, and `inertMath`. The text-only shortcut is sound because its output was serialized from text nodes, escaping markup; a regression now pins this. `querySelectorAll` returns a static snapshot, so replacing nested nodes during iteration is safe.

7. **Low — test environment and call-site audit:** I agree with moving the twelve affected suites to jsdom. Their import graph now reaches the browser sanitizer through `Excerpt`; the plan’s alternatives would either obscure that dependency or duplicate production behaviour. The new excerpt tests and the [Skim integration test:777](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/tests/skim-panel.test.tsx:777) are meaningful. I added coverage for cache invalidation, dropped-content offsets, snippet offsets, text-only injection, and hostile MathML. The remaining call sites use excerpts only as visible children—not attributes, ARIA labels, clipboard strings, or measured text—and preserve quotation marks, ellipses, and whole-paragraph fallbacks.

Commands and results:

- Focused and affected suites: **16 files, 452 tests passed**.
- `npm run typecheck`: could not launch its `tsx` wrapper because the sandbox rejected `/tmp/tsx-1000/14.pipe` with `EPERM`.
- `node --experimental-strip-types scripts/typecheck.ts`: **passed all projects; all 3,586 source files covered**.
- `npm test`: could not start the database-backed lane because local Postgres/Supabase was unavailable; it failed during global setup before assertions.
- Biome lint on the substantive changed implementation/tests: **clean**. Wider touched-file lint only reported an existing unrelated `escape` naming error in `quick-search-panel.test.tsx`.
- `git diff --check`: **clean**.

ship after my fixes