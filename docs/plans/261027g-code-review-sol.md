Fixed all findings below in the working tree; nothing committed. No unexpected runtime behavior changes found.

| ID | Severity | File:line | Finding and fix |
|---|---|---|---|
| R1 | S1 | `docs/project/marginalia.md:32`; `interface-vision.md:81,101,174` | Current Claims lists/checks do **not** feed Marginalia. Clarified that it reads Reception’s legacy claim-source rows. |
| R2 | S1 | `src/structure-slices.ts:63` | Changing prompt tags does not mark stored trees outdated. Corrected the checkpoint/stamp explanation. |
| R3 | S1 | `src/ai-call.ts:3233` | Repointed test verifies keyword nesting, not changed transcripts. Distinguished the wire test from the real transcript probe. |
| R4 | S1 | `docs/plans/261027g-partial-renames-swept-and-the-rename-policy.md:27,48` | Blanket completion claim contradicted retained implementation names and `article_citations`. Qualified the claim and table. |
| R5 | S1 | Same plan:87 | F2 treated Dig deeper as a current button. Recorded its removal and the pending server removal/reuse decision before recommending a rename. |
| R6 | S2 | `docs/project/url-state.md:377`; `glossary.md:1486`; `src/web/threshold.ts:6` | The surviving categorical bar belongs to Claims. Corrected related helper, CSS and test comments too. |
| R7 | S2 | `src/store/pg.ts:2903` | Sharing flag covers Sources, including Claims-only articles. Replaced “Reception” with “Sources.” |
| R8 | S2 | `src/web/DesignPage.tsx:1571` | Text inputs belong to Claims and Investigate. Fixed the displayed label and matching CSS comment. |
| R9 | S2 | `src/web/reader/ModeBoundary.tsx:33` | Reset parameter selects Sources’ view. Corrected ownership. |
| R10 | S2 | `tests/sources-claims.test.ts:323` | Prompt-version comparison is against Reception, not Claims itself. Fixed title. |
| R11 | S2 | `tests/answer-opening.test.ts:3`; `glossary-and-bibliography-ask-in-chat.test.tsx:40` | Corrected claim-mark ownership and distinguished claim versus angle origins. |
| R12 | S2 | `tests/reception-order.test.ts:2` | Describes both Reception and Claims. Fixed header and obsolete query-key reference. |
| R13 | S2 | `tests/a-broken-mode-leaves-the-article-readable.test.tsx:1311` | Cases press Sources and generate Bibliography. Corrected misleading Reception titles. |
| R14 | S2 | `tests/every-mode-draws-its-surface.test.tsx:1285`; broken-mode test:1306 | Restored historical Citations/Debate names where sentences explicitly describe the earlier behavior. |
| R15 | S2 | `tests/quiz-mark-stream-lifetime.test.ts:43` | Route tests do not cover prompts and verdict classification. Pointed each responsibility to its actual tests. |

All repointed targets exist; remaining coverage references checked out. No altered Greg quotations found. The fixture and assertion changes introduce no identified regression.

Validation: **586 tests passed across 12 files**. Typecheck passed through the same script using `node --import tsx` after the npm wrapper’s IPC socket was blocked. The touched quiz lifetime test could not initialize because the sandbox blocks local Postgres. Lint reported three existing errors on unchanged lines.

VERDICT: LAND AFTER FIXES