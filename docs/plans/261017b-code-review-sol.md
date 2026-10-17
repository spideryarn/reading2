## Findings

C1 — P1 — established — `srcset.split(",")` corrupted valid `data:` URLs and filenames containing commas, producing broken image addresses. Reproduced with failing tests before fixing. Evidence: [save-page-bookmarklet.ts:77](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/web/save-page-bookmarklet.ts:77), [save-page-bookmarklet.test.ts:195](/var/tmp/spideryarn-worktrees/refused-site-open-copy/tests/save-page-bookmarklet.test.ts:195). **FIXED** in `src/web/save-page-bookmarklet.ts` and `tests/save-page-bookmarklet.test.ts`.

C2 — P1 — established — relative SVG `xlink:href` references were not made absolute, so external SVG symbols would disappear after an addressless upload. The fix avoids namespace-sensitive CSS selectors and preserves local `#fragment` references. Evidence: [save-page-bookmarklet.ts:121](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/web/save-page-bookmarklet.ts:121), [save-page-bookmarklet.test.ts:216](/var/tmp/spideryarn-worktrees/refused-site-open-copy/tests/save-page-bookmarklet.test.ts:216). **FIXED** in `src/web/save-page-bookmarklet.ts` and `tests/save-page-bookmarklet.test.ts`.

C3 — P1 — established — scrubbing every non-checkbox/radio input value deleted the visible labels of submit, reset, and button inputs. Reproduced red before fixing; non-visible image-input values remain scrubbed. Evidence: [save-page-bookmarklet.ts:163](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/web/save-page-bookmarklet.ts:163), [save-page-bookmarklet.test.ts:232](/var/tmp/spideryarn-worktrees/refused-site-open-copy/tests/save-page-bookmarklet.test.ts:232). **FIXED** in `src/web/save-page-bookmarklet.ts` and `tests/save-page-bookmarklet.test.ts`.

C4 — P3 — established — Help said typed content was omitted, but edited `contenteditable` text is serialized, and extracted personal content can become part of a shared article. The raw source-file privacy claim itself is true: its route is authenticated and public article routes do not expose it. Evidence: [adding-articles.md:26](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/web/help/pages/adding-articles.md:26). **FIXED** in `src/web/help/pages/adding-articles.md` and regenerated `src/help-corpus.generated.json`.

No further defect found in the challenge recognisers, refusal precedence, `url: null` upload path, React 19 link handling, pointer gate, byte cap, or filename handling.

Verification:

- Targeted suite: 183 passed, 1 skipped.
- Typecheck: all 3,761 source files covered and passed.
- Vite production build passed.
- Extracted and executed the exact minified bookmarklet from the production bundle: self-contained, successful download, corrected behavior retained, 4,121-byte URL.
- Direct Chrome launch was blocked by the sandbox’s Crashpad restriction; Firefox and Safari were unavailable. Cross-browser execution is therefore reasoned and production-payload-tested, not directly smoke-tested in those engines.
- `npm test` could not pass global setup because the sandbox denied access to local Supabase/Docker.
- Lint exited successfully with two informational complexity advisories.
- No security-map defence files were edited. No commit was made.

SHIP AFTER FIXES (MADE)