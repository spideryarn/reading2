Reviewed and fixed three documentation findings:

- D-01 — [principles.md](/var/tmp/spideryarn-worktrees/fbvqmfrs-digest-answers/docs/project/principles.md:51): removed task-specific guidance from Greg’s answer to question 3. The remaining two principles match the approved proposal, split only into headings and body text.
- D-02 — [plan 261031d](/var/tmp/spideryarn-worktrees/fbvqmfrs-digest-answers/docs/plans/261031d-sources-digest-acting-on-greg-s-answers-principles-readers-that-search-again-layout-choices.md:52): changed “Both consultants” to “Opus”; Sol did not explicitly recommend adding planned searches.
- D-03 — [plan 261031d](/var/tmp/spideryarn-worktrees/fbvqmfrs-digest-answers/docs/plans/261031d-sources-digest-acting-on-greg-s-answers-principles-readers-that-search-again-layout-choices.md:38): restored Sol’s qualification that an attacker does not “ordinarily” see the resulting query.

Everything else checks out:

- `sources-digest/4` reaches the artefact, `isOutdated`, currentness comparison, and step-run stamp through the shared constant. No live site hard-codes `/3`; `/1` UI fixtures are intentionally old.
- The verdict instruction is consistent with all four `check` verdicts.
- `.digest-head` comes later than `.rcp-group-head` and `.where-head`, so its same-specificity color and padding declarations win. Both digest selectors are used only by `SourcesDigestPanel`.
- The §2 anchor resolves.
- The constrained, measurement-gated B′ decision now represents both consultations faithfully.

Checks:

- Typecheck passed via `node --import tsx scripts/typecheck.ts`; the exact npm command was blocked before execution by the sandbox denying `tsx`’s IPC socket.
- Focused Vitest: 44 passed.
- Targeted Biome: no errors; seven existing specificity warnings elsewhere in `reception.css`.
- Full `npm test` could not start because the sandbox cannot reach local Postgres.

VERDICT: approve with changes