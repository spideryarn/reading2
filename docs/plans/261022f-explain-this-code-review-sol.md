## Findings

- **C1 — P1 — [src/glossary.ts:1742](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/src/glossary.ts:1742) — established arithmetic, reasoned failure — not fixed.** The enlarged allowance can outlive its job. The 96-entry book reserves 73,240 tokens, whose project-standard deadline is 964 seconds; `MAX_ENTRIES` reserves 91,600 tokens, or 1,206 seconds. Jobs abort after 740 seconds, while Glossary’s scheduling estimate remains 120 seconds at [jobs.ts:833](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/src/jobs.ts:833). A long-thinking valid response can therefore be aborted and discarded before `finishedText` sees it. Fixing this requires choosing lower headroom/count, checkpointing, or a different job lifetime.

- **C2 — P1 — [names-1 result:30](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/evals/results/glossary-citations/names-1/source-spya-f550ta.json:30) — established — fixed narrowly, but not re-measured.** The Results claim that the citation guard held was false. `names-1` returned citation-only Stenhoff and Martin Uman/“Rakov and Uman”; `names-3` returned Uman again. The earlier investigation had explicitly classified those shapes as citations. I repeated the citation exception beside the new passing-name rule at [glossary.ts:1145](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/src/glossary.ts:1145), added a red-first test, and corrected the plan/docs. A paid rerun is still needed before claiming the regression is closed.

- **C3 — P2 — [plan:93](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/docs/plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md:93) — established evidence gap — not fixed.** The part-by-part conclusion rests on two runs, while the same pre-spread prompt varied by 22 entries. The book outputs and scratch runner were deleted, and the three committed names arms carry three different `glossary.ts` hashes. The results are useful examples, but do not establish that the one-line instruction caused reliable coverage or Torricelli recall.

- **C4 — P2 — [src/glossary.ts:1484](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/src/glossary.ts:1484) — established — not fixed.** “Part by part” is controlled by the requested count, not article length. A 38,255-word book with 90 existing entries asks for the 20-entry floor and loses the instruction precisely while seeking quieter missed terms. The implementation therefore does not consistently work through a long piece part by part.

- **C5 — P3 — [plan:41](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/docs/plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md:41) — established — fixed.** “An essay’s request is byte-for-byte unchanged” was too broad: long essays now exceed 20 and gain the new line. The request is byte-identical, apart from the names rule, only when its count remains at most 20. I corrected the plan, code comment, test wording, and glossary doc.

F1 is answered. F2, F3, F5 and F6 are moot after dropping parallel stretches. F4 is answered by explicitly retaining a 150-entry ceiling and naming *Find more* beyond it. F7 was built, but exposed C1. F8 is only partly answered: block coverage was measured and the names-heavy/underline cost is disclosed, but visual acceptability remains untested.

Version handling is otherwise coherent: `/9` remains appendable, `panelRunKind` shares that predicate, the pipeline/store use the exported current version, and older-prompt notices remain quiet. `suggestedCount` has one production caller, and the Find-more path passes `existing.entries.length`.

Verification:

- Focused glossary and doc-link tests: 119 passed.
- Expanded relevant tests: 132 passed.
- Typecheck: all 3,929 source files covered, clean.
- Lint: one pre-existing complexity advisory at `src/glossary.ts:353`.
- No production access, commit, or push.

**REJECT**