## Findings

- F1 — Low: [`openUploadedOriginal`](/var/tmp/spideryarn-worktrees/fb-r6a5s5-open-original/src/web/SourceLink.tsx:187) could reject without being handled if `window.open()` threw, leaving the existing button silent. The HTML standard permits `InvalidAccessError` when the document is no longer fully active. I moved tab creation inside the existing failure boundary and added a regression test. Confirmed red before the fix and green afterward. [HTML Standard](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html)

- F2 — Low: the no-activation test covered only PDFs, so moving the guard into that branch could leave web originals unprotected. I made it exercise both branches in [`command-bar-metadata-rows.test.tsx`](/var/tmp/spideryarn-worktrees/fb-r6a5s5-open-original/tests/command-bar-metadata-rows.test.tsx:441).

- F3 — Low: `originalOf`’s owner/visitor rules and Metadata’s Dock handoff lacked direct coverage. I added cases for web visitors, owner-only PDFs, HTML uploads, web-over-PDF precedence, and the deliberate `hasShelfRow` versus owner-page distinction in [`metadata-origin.test.tsx`](/var/tmp/spideryarn-worktrees/fb-r6a5s5-open-original/tests/metadata-origin.test.tsx:195).

The production logic otherwise looks correct:

- All runnable paths reach `run()` synchronously from Enter/click or pass through `hasGesture`; model-picked prose cannot auto-run it because `opensOnly` is false. Nothing consumes activation between the check and the single `window.open`. `navigator.userActivation.isActive` is the correct transient-activation signal. [HTML Standard](https://html.spec.whatwg.org/multipage/interaction.html)
- The helper extraction otherwise preserves SourceLink’s tab timing, opener removal, fragment, fallback navigation, revocation, and error text.
- `originalOf` and Metadata’s owner/fixture handling match the plan.
- No tests, eval inputs, help source, or docs relied on Plain’s removed `original` alias; generated corpora were updated.

Checks:

- Six relevant Vitest files: 80 passed, 2 skipped.
- Typecheck driver: all four projects passed; all 3,840 files covered.
- Biome lint on edited files: passed.
- `git diff --check`: passed.
- `npm run typecheck` itself could not start because the sandbox denied `tsx`’s IPC socket; running the same driver via `node --import tsx scripts/typecheck.ts` passed.
- No commit made; unrelated existing worktree changes were untouched.

Verdict: Approve after fixes—no remaining production defect found.