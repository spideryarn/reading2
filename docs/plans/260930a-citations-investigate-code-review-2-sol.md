Verdict: **approve with the fixes made**

- **D-1 · P1** — [investigate-quote-guard.ts:86](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/investigate-quote-guard.ts:86): C-1 rejected legitimate s-ending quotes such as `‘fitness’ is …` and `‘fitness’ as …`. Fixed without reopening the plural-possessive leak; later apostrophes, quoted terms, and adversarial later closes remain guarded. Red → green coverage is at [investigate-quote-guard.test.ts:153](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/tests/investigate-quote-guard.test.ts:153), across every two-way split plus character-by-character chunks.

- **D-2 · P2** — [CitationInvestigation.tsx:234](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/web/CitationInvestigation.tsx:234): the ControlTip incorrectly claimed extracts were “not the paper itself”; an extract can contain part or most of a paper. It now says extracts may be an abstract or part of a paper and that Spideryarn does not fetch the page itself. Red → green coverage is at [citations-panel.test.tsx:904](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/tests/bibliography-panel.test.tsx:904).

The remaining reviewed behavior is sound: whole-draft replacement on all failure endings, re-read after opened-stream failure, previous-answer restoration, owner-only rendering, accurate stored-field provenance, one-at-a-time admission, abort on leave, unchanged glossary stream behavior, plain-text rendering, and http(s)-only outbound links with `noopener`. Added explicit transport-failure and injection/link tests.

Checks:

- Requested unit tests: **100 passed**
- Full typecheck script: **passed** via `node --import tsx scripts/typecheck.ts`
- Scoped Biome lint: no errors
- No commit made
- Unrelated existing worktree changes were untouched.