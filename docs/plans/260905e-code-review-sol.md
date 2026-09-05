No P0 findings. Five findings:

- **F1 — P1 — [src/hierarchy-cascade.ts:1660](/home/greg/code/spideryarn2/.claude/worktrees/feedback-diagram-text-and-socratic/src/hierarchy-cascade.ts:1660)**  
  `proposalFromTree` omits `question`. When stage 5 successfully deepens any section, the rebuilt tree loses every root/part question. Reproduced end-to-end: four questions before `deepenTree`, zero afterward.  
  **Smallest fix:** copy `node.question` alongside `gist` and `sourceHeading`, and extend the round-trip/deepening test.

- **F2 — P1 — [src/hierarchy.ts:1561](/home/greg/code/spideryarn2/.claude/worktrees/feedback-diagram-text-and-socratic/src/hierarchy.ts:1561)**  
  Questions are filtered using proposal depth before `collapseRestatedRungs` runs at line 1613. A redundant depth-1 wrapper can be removed, promoting its depth-2 children—correctly emitted without questions—to final depth 1. Reproduced: the resulting two depth-1 parts had no questions and `droppedQuestions` remained zero.  
  **Smallest fix:** request fallback questions one proposal level deeper and retain them according to final, post-collapse depth; add a root-level-collapse regression.

- **F3 — P1 — [src/hierarchy-deepen.ts:2224](/home/greg/code/spideryarn2/.claude/worktrees/feedback-diagram-text-and-socratic/src/hierarchy-deepen.ts:2224)**  
  The claim that expansions only create depth ≥2 nodes is false. A flat stage-4 tree can put the root itself on the frontier; expanding it creates depth-1 children. The scoped protocol at [src/hierarchy-expand.ts:245](/home/greg/code/spideryarn2/.claude/worktrees/feedback-diagram-text-and-socratic/src/hierarchy-expand.ts:245) cannot request or return questions. Reproduced with a ten-block, 2,500-word flat root. This currently affects only the opt-in deepening path.  
  **Smallest fix:** when the expansion target is the root, request, validate, and carry questions on its children; add a flat-root deepening test.

- **F4 — P2 — [evals/hierarchy-structure/run.ts:600](/home/greg/code/spideryarn2/.claude/worktrees/feedback-diagram-text-and-socratic/evals/hierarchy-structure/run.ts:600)**  
  `droppedQuestions` was added to the eval’s `BuildReport` construction sites but is discarded from the saved result, printer, and floor calculations. Thus the evaluation intended to detect prompt drift cannot report this new failure mode. Production merge sites themselves are complete.  
  **Smallest fix:** add an optional `droppedQuestions` field to the historical result shape and thread it through serialization and reporting.

- **F5 — P2, speculative decision — [src/hierarchy.ts:225](/home/greg/code/spideryarn2/.claude/worktrees/feedback-diagram-text-and-socratic/src/hierarchy.ts:225)**  
  Terminal punctuation cannot reliably distinguish statements from questions. The rule drops a malformed question such as “How did this affect the U.S.” while converting an unpunctuated statement into a question. This is not a security issue—React renders it as escaped text—but it can misclassify model output.  
  **Smallest fix:** choose a purely syntactic normalization policy rather than treating punctuation as semantics, and test both cases.

The requested suite passed: **136 tests**. The two stage-5 suites also passed: **94 tests**, demonstrating the missing regressions above. Typechecking and `git diff --check` passed. I found no issue in the diagram breakpoint/accessibility implementation, public DTO decision, or checkpoint-key update.