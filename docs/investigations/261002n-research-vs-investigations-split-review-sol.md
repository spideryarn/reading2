Verdict: fixes applied; several classifications need reconsideration. No files were moved.

1. **FOR YOU — recommended moves to investigations.** These examine our own product, code or records; being “not an eval” does not make them external research. Left in place as requested.

   | File currently in research | Reason |
   |---|---|
   | `260909a-usage-history-…md` | Investigates our imports, locking and measured history data. |
   | `260909b-a-shared-team-box-…md` | Evaluates our account, process and security constraints. |
   | `260928b-academic-bulk-import-…md` | Investigates our ingest/shelf requirements and measured costs. |
   | `260910a-reader-study-protocol-…md`, plus its two reviews | Designs an evaluation of Spideryarn; “not run” changes its status, not its subject. |
   | `260828c-decorated-mode-ideas.md` | Documents our working playground, observed failures and resulting decisions. |
   | `260902k-spideryarn-reading-intent-brief.md` | Synthesizes a trawl of our own repositories and conversations. |
   | `260902k-old-version-materials/shipped-copy-and-product-framing.md` | Audits our previous shipped UI and documentation. |

   All moved entries fit investigations. Shelf-facet terms and the typeface survey fit research under the majority-substance rule.

2. **FOR YOU — legacy materials need an ownership decision.** The remaining positioning sources and unevaluated designer/Fable/Sol decorated-mode ideas are neither external research nor investigations. Choose an archive home or an explicit legacy exception. The reading-science, web-platform and external research reports can stay in research.

3. **FIXED — stale wildcard paths** in `docs/investigations/261002a-research-write-ups-review-prompt.md`. Twelve targets still pointed into research; exact-filename replacements had missed them. No other relocation defects were found, including relative links inside moved files.

4. **FIXED — guidance consistency.** Corrected “four folders” in `vision.md`, added investigations to the naming guidance, recorded your mixed-document rule, and removed two unsupported generalizations. Greg’s correction is quoted verbatim as an excerpt. `AGENTS.md` and `evals/README.md` needed no further changes.

5. **FIXED — test coverage** in `tests/plan-name.test.ts`. The original test meaningfully catches a missing entry, but accepts investigations pointing at another existing folder. Added an assertion for its destination and extension. That wrong-directory mutation passed the original test and failed the new assertion.

6. **FOR YOU — broader verification and landing limits.** Requested tests passed **32/32**; typecheck passed through `node --import tsx`, and lint passed. Full `npm test` was blocked by Docker access. The commit guard hit read-only Git metadata, so changes remain uncommitted and unpushed.

Files changed:

- [review prompt](/home/greg/code/spideryarn2/.claude/worktrees/investigations-folder/docs/investigations/261002a-research-write-ups-review-prompt.md)
- [investigations.md](/home/greg/code/spideryarn2/.claude/worktrees/investigations-folder/docs/project/investigations.md)
- [research.md](/home/greg/code/spideryarn2/.claude/worktrees/investigations-folder/docs/project/research.md)
- [vision.md](/home/greg/code/spideryarn2/.claude/worktrees/investigations-folder/docs/project/vision.md)
- [engineering-manager.md](/home/greg/code/spideryarn2/.claude/worktrees/investigations-folder/docs/reusable/engineering-manager.md)
- [write-planning-doc.md](/home/greg/code/spideryarn2/.claude/worktrees/investigations-folder/docs/reusable/write-planning-doc.md)
- [plan-name.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/investigations-folder/tests/plan-name.test.ts)