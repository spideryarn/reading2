1. **P1 — FIXED: Dig deeper could leave Citations hidden on narrow screens.** The handler selected the current mode without clearing `bandAway`. [Reader.tsx:1161](/home/greg/code/spideryarn2/.claude/worktrees/fbc2qmbg-citation-tooltip-dig-deeper/src/web/reader/Reader.tsx:1161) now explicitly reveals the band. The whole-page regression at [test:594](/home/greg/code/spideryarn2/.claude/worktrees/fbc2qmbg-citation-tooltip-dig-deeper/tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx:594) **failed at both 390px and 600px before the fix**, then passed.

2. **P2 — FIXED: Replacement lists inherited old failures and no-match notes.** Retaining a work ID also retained messages about its previous reference. [useCitations.ts:427](/home/greg/code/spideryarn2/.claude/worktrees/fbc2qmbg-citation-tooltip-dig-deeper/src/web/useBibliography.ts:427) now clears terminal messages when the list generation changes, preserving active streams and ordinary refreshes. Regressions at [test:673](/home/greg/code/spideryarn2/.claude/worktrees/fbc2qmbg-citation-tooltip-dig-deeper/tests/bibliography-investigate-client.test.tsx:673) and [test:694](/home/greg/code/spideryarn2/.claude/worktrees/fbc2qmbg-citation-tooltip-dig-deeper/tests/bibliography-investigate-client.test.tsx:694) **were red first: 2 failed, 18 passed**. Both now pass.

3. **P2 — REPORTING: Touch readers receive no visible payment explanation.** The cost notice appears only in the native `title`: [ProseHoverCard.tsx:2064](/home/greg/code/spideryarn2/.claude/worktrees/fbc2qmbg-citation-tooltip-dig-deeper/src/web/ProseHoverCard.tsx:2064), [notice:2100](/home/greg/code/spideryarn2/.claude/worktrees/fbc2qmbg-citation-tooltip-dig-deeper/src/web/ProseHoverCard.tsx:2100). Keeping the footer compact is defensible; copying the glossary’s omission does not make payment disclosure accessible. I left this explicit product choice for you.

4. **P2 — REPORTING, wider scope: The glossary has the same hidden-band defect.** [openTermInGlossary:1224](/home/greg/code/spideryarn2/.claude/worktrees/fbc2qmbg-citation-tooltip-dig-deeper/src/web/reader/Reader.tsx:1224) selects Glossary without clearing `bandAway`. It predates this change and remains untouched.

5. **P3 — FIXED documentation: The visibility claim exceeded the implementation.** The panel-local `lastDug` ref disappears on unmount, so an investigation finishing while the band is closed need not be visible on return. The wording at [citations.md:499](/home/greg/code/spideryarn2/.claude/worktrees/fbc2qmbg-citation-tooltip-dig-deeper/docs/project/bibliography.md:499) now states that boundary and excludes dormant bars. This was an editorial correction; no behavioral red is claimed. `doc-links` passes.

**Plan checks:** F1 is implemented while the panel remains mounted; the return-after-completion limitation is above. F2’s implementation waits for loading and controlled bar updates; I corrected its delay test to reuse the same mounted panel. F3 now also covers slug changes, late frames, continued admission and remounting after completion. Production remounts owner reads through [ArticlePage.tsx:224](/home/greg/code/spideryarn2/.claude/worktrees/fbc2qmbg-citation-tooltip-dig-deeper/src/web/article/ArticlePage.tsx:224); cleanup also works when a hook is reused.

Admission and failure reconciliation remain sound. Visitor actions remain null. Card states, closing, Scholar searches and provenance are preserved; CSS permits footer wrapping. I found no reachable defect caused solely by `lastDug`’s render-time assignment or focus-token reuse under the current synchronous acknowledgements.

Gate results:

| Check | Result |
|---|---|
| Requested eight suites | **8 files passed; 209 tests passed; 0 failed** |
| Additional narrow-screen suite | **1 file passed; 11 tests passed; 0 failed** |
| `npm run typecheck` | Blocked by tsx IPC `EPERM` |
| Same script via `node --import tsx` | **4 projects passed; 2,930 sources covered; 0 errors** |
| Scoped lint | **5 files checked; 1 warning, 3 informational findings** |
| Full `npm test` | **0 tests collected; 1 setup error**—sandbox blocks local Postgres/Docker |
| Citation Postgres suite retried alone | Same blocker: **0 tests collected; 1 setup error** |

No commits were made.