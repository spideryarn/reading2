I fixed the stage-local findings; no commits were made.

Findings:

- **Medium — quote provenance:** [quotes.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/quotes.md:8), [skim.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/skim.md:18), [summary.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/summary.md:13). Copy implied authorial provenance where only presence in the article is proven. Reworded it and added a regression assertion at [help-page.test.tsx](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/tests/help-page.test.tsx:515).

- **Medium — Structure over-promised:** [structure.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/structure.md:8). It called the model-built structure the article’s own table of contents and promised every section a summary despite the headings-only fallback. Corrected both claims.

- **Medium — Skim promised unavailable explanations:** [skim.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/skim.md:8). Its stop card only shows Glossary or Ideas material already made. Added that condition and changed “sentence” to the accurate “passage”.

- **Medium — AI judgements stated as facts:** [faq.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/faq.md:7), [ideas.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/ideas.md:8), [referee.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/referee.md:8), [search.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/search.md:8). Made the model’s role explicit.

- **Medium — Learn’s description was incomplete and unconditional:** [learn.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/learn.md:8). Recall corrects something only when needed, and Explore was omitted. Fixed both.

- **Low — smaller factual overstatements:** [citations.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/citations.md:8), [debate.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/reception.md:8), [diagram.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/diagram.md:7), [glossary.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/glossary.md:8). Corrected prioritisation/link provenance, search-empty wording, Sketch’s “mostly” ordered layout, and Glossary’s unchecked background material.

- **Low — contradictory or unclear wording:** [plain.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/plain.md:8), [marginalia.md](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/web/help/pages/modes/marginalia.md:8). Plain now acknowledges persistent Glossary underlines; “each level with” became “each beside”.

- **Low — test did not typecheck:** [help-ask-dictation.test.tsx](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/tests/help-ask-dictation.test.tsx:224). Typed the textarea selector as `HTMLTextAreaElement`.

The dictation implementation and shared section parser otherwise match the established contracts. I found no remaining functional divergence in the scoped code.

Checks:

- Corpus regenerated successfully.
- Focused suite: **240 passed, 1 skipped**.
- `git diff --check`: passed.
- `npm run typecheck` could not start because this sandbox forbids `tsx`’s IPC socket. Running the same script as `node --import tsx scripts/typecheck.ts` passed all four projects and covered all 3,528 source files.

Wider item left: [src/types.ts](/var/tmp/spideryarn-worktrees/fby5gfpf-help-dictate-and-tldr/src/types.ts:1085) has a pre-existing stale comment claiming every quote is a sentence the author wrote. It is outside this stage and contradicts the stronger invariant immediately below it.

**Verdict: SHIP AFTER MY FIXES**