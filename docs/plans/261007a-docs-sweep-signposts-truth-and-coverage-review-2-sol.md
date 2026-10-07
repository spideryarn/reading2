ship — checked R1–R31 against source; no further corrections needed to those fixes. All findings below are fixed. `tests/doc-links.test.ts` passed **17/17**.

Line numbers refer to corrected files.

| ID | Severity | Doc:line | Finding and evidence | Fixed |
|---|---|---|---|---|
| S1 | P1 | mode.md:588 | Drizzle asks **create-or-rename**, not rename-or-drop (`node_modules/drizzle-kit/api.js:9601`). Corrected the prompt and TTY wording. | Yes |
| S2 | P1 | mode.md:594 | Stored-name checklist omitted `jobs.reset.regenerate[]`; the Skim migration rewrites it alongside `jobs.steps` (`drizzle/20261001224759_skim.sql:63`). | Yes |
| S3 | P1 | mode.md:598 | Checklist omitted the stored `debate/6` tag (`src/debate.ts:223,1956`, `src/db/schema.ts:3020`). Added it and clarified the retained work hash and both ledger columns. | Yes |
| S4 | P1 | mode.md:615 | Missing browser storage: saved mode/query words (`src/web/last-view.ts:114,550`) and offline API URL keys (`src/web/lib/offline-store.ts:385`). | Yes |
| S5 | P1 | mode.md:607 | Missing historical stored names in feedback URLs and diagnostics (`src/db/schema.ts:5212,5242`). The Skim migration explicitly preserves feedback evidence. | Yes |
| S6 | P2 | mode.md:639,644,650 | Precedent summaries omitted reset rewriting, the rebuilt partial-index predicate and retargeted historical links. Both precedent plans document these. | Yes |
| S7 | P1 | fetching.md:522 | `asked_url` lookup requires a registered source (`src/store/find-article.ts:144`). OSF is unregistered, so the claim that it already makes such articles findable was false. | Yes |

Changed only **`mode.md` and `fetching.md`**: completed the stored-name checklist, clarified the precedents, and narrowed the OSF lookup claim.

The Signing in quotation matches the source plan character for character. No headings or quotes changed; no commits made; no other tests run.