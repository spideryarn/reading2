1. **P2 — Shelf query included the original title. Fixed.** Shared metadata columns pulled `titleOriginal` into the library projection despite its policy exclusion. The existing projection test failed. Moved it into the article projection in [pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbfyj3m4-import-title-tidying/src/store/pg.ts:1176).

2. **P2 — Recasing could corrupt entity syntax. Fixed.** A doubly encoded HTML title produced `The &Amp; History of Science`. Added a conservative recasing guard and a regression test through extraction and storage.

3. **P2 — Wrapped title repetitions became false acronym evidence. Fixed.** Repeated `THE FUTURE\nOF NASA` produced `The FUTURE of NASA`. Whitespace is now normalised before excluding title repetitions.

4. **P3 — Abbreviations and subtitle boundaries were mishandled. Fixed.** `PH.D.` became `Ph.d.`, dotted abbreviations broke inside compounds, and `QUESTION:AN ANSWER` produced `Question:an Answer`. Added handling and regression tests in [title-tidy.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbfyj3m4-import-title-tidying/src/title-tidy.ts:84).

5. **P2 — Acronym scanning allocated excessive memory. Fixed.** The 4.5 MB probe used about **319 MB RSS / 1.85 seconds** before, versus **167 MB / 0.55 seconds** afterwards. Replaced whole-body letter and word arrays with counting and iteration.

6. **P3 — UI tests missed page wiring. Fixed.** Helper tests could pass with restoration disconnected. Added page-level checks for shelf gating, visitors, restoration after renaming, and visible PATCH failures. All five deliberate mutations were caught by assertions.

7. **P2 — Every change is not undoable through the UI. Unfixed; requires a wider decision.** Executed a 359-character example: tidying preserves its original, but restoration returns HTTP 400 because rename permits at most 300 characters. This remains the plan’s acknowledged limitation.

8. **P3 — Acronym and name inference remains imperfect. Unfixed; documented.** Shortened running heads can preserve ordinary `FUTURE` as capitals. Without body evidence, `AI`, `UK`, and `WWII` can lose capitals; names such as `MCDONALD` remain ambiguous.

Checked 45 realistic titles and 1,320 mixed-case variants; none of the mixed-case variants was recased. Storage/export mapping otherwise looked complete, and I found no downstream requirement that `meta.title` equal the `<h1>` text.

**139 tests passed**, typechecking passed using the socket-free launcher, and `npm run db:chain` passed. The two Postgres suites were attempted but blocked by sandbox access to the local database. Changes remain uncommitted.

**Verdict: conditional pass after these fixes, pending Postgres validation; universal UI undo remains unsupported.**