1. **P1 — [src/front-matter-authors.ts:438](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/src/front-matter-authors.ts:438): ownership verification still accepted false affiliations.**  
   `York` was accepted as owning `New York University` because the author name occurred inside the affiliation. Ordinary one-letter words could also masquerade as markers, e.g. `Alice Smith D` / `D Delta Institute`. I added failing adversarial tests, excluded name matches overlapping the affiliation, and now recognize markers only when structurally marked by `<sup>` or `<sub>`. Existing drop, merge, and reorder rejection tests remain green.

2. **P1 — [src/front-matter-authors.ts:95](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/src/front-matter-authors.ts:95): hidden provenance could be lost or missed.**  
   A hidden LaTeXML contact’s bare text could be moved out of its stamped parent during preparation. Inline CSS variants such as `display : none`, opacity/filter hiding, and page-local stylesheet rules were also missed. I reproduced the moved-text bug with the real `1706.03762v7` fixture, then stamped whole hidden subtrees, wrapped marked bare text during preparation, added computed/page-local style handling, and guaranteed cleanup before stored HTML is returned.

3. **P2 — [src/front-matter-authors.ts:64](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/src/front-matter-authors.ts:64), [src/reserved.ts:52](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/src/reserved.ts:52): the walk was not work-bounded and the internal stamp was unregistered.**  
   Twenty thousand empty nodes did not stop traversal, and the reserved-attribute test rejected `data-spya-hidden`. I added a 20,000-node traversal bound and registered/scrubbed the attribute. Tests also verify that neither element nor temporary text stamps leak into extracted HTML.

4. **P2 — [src/model-names.ts:49](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/src/model-names.ts:49): job registration omitted the Haiku 5.5 display name.**  
   The enumerating models test failed for `anthropic/claude-haiku-5.5`. I added the display-name entry. The job’s routing, cost category, disposition, reasoning table, plain-words exemption, and setup documentation were otherwise present.

5. **P2 — [src/front-matter-authors.ts:90](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/src/front-matter-authors.ts:90): external stylesheets remain outside hidden-text detection.**  
   Inline and page-local CSS are now covered, but a linked stylesheet can still hide adversarial text from a browser while leaving it visible to this static pass. Fetching or rendering external CSS expands the network/security design, so I documented the boundary and recommend the author decide whether that broader work is warranted.

6. **P2 — [evals/results/front-matter-authors-2026-10-09/run-5-final-haiku.metrics.json](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/evals/results/front-matter-authors-2026-10-09/run-5-final-haiku.metrics.json): the final measurement predates the stricter verifier.**  
   The evaluation correctly captures callback-provided declared authors and contains three draws, so the fourth plan finding was implemented. Because this review tightened acceptance behavior, rerun it before describing the artifact as a measurement of the exact final code.

No further defect was found in `runExtract`: it runs once, after every refusal, only for declared names with no affiliation; the second prose arm cannot duplicate it; aborts propagate and ordinary failures fall back to declared names. I also found no live stale reference or breakage from removing `arxiv-affiliations.ts` or `latexmlTitleBlock`.

Files edited:

- [src/front-matter-authors.ts](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/src/front-matter-authors.ts)
- [src/model-names.ts](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/src/model-names.ts)
- [src/models.ts](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/src/models.ts)
- [src/reserved.ts](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/src/reserved.ts)
- [tests/front-matter-authors.test.ts](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/tests/front-matter-authors.test.ts)
- [tests/reserved.test.ts](/var/tmp/spideryarn-worktrees/fbvfk2zh-general-front-matter/tests/reserved.test.ts)

Checks: focused suite passed, 43/43; relevant registration suites passed, 216/216; equivalent full typecheck passed all four projects. The literal `npm run typecheck` launcher was blocked by a sandbox `tsx` IPC `EPERM`, and `npm test` could not start its private database lane because Docker access is unavailable. No commit, push, database, environment, or infrastructure change was made.

**ready to push after the fixes above**