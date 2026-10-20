Review completed and fixes applied. Full findings are in [261020d-code-review-sol.md](/var/tmp/spideryarn-worktrees/fb-chat-principles/docs/plans/261020d-code-review-sol.md).

Key outcomes:

- The five insertions do not create unresolved prompt contradictions.
- Removing “They are reading it” loses nothing valid.
- Removing “make deep reading cheaper” did lose the efficiency/“get there quicker” principle. I did not alter the measured prompt without a paid rerun.
- Prompt caching remains sound and now has stronger cross-kind prefix tests.
- Coverage and “near the top” test loopholes are fixed and mutation-tested red→green.
- The supplied verdicts unblind to exactly 12–12 and control 13–10–1; both verdict lists are now committed as reproducible evidence.
- Eval claims, balance limitations, source-hash mismatch, and Learn/Tutorial merge metadata are now documented accurately.
- The exact prompt evaluated remains unverifiable: `after.json`’s `chatPrinciples` hash does not match the committed file. Historical evidence was not rewritten.

Verification:

- 302 relevant tests passed.
- Typecheck passed across 3,855 files.
- Scoped lint and diff/JSON checks passed.
- Full `npm test` could not run because local Postgres/Supabase is unavailable; the broader unit lane also encountered unrelated sandbox/git-launcher failures.
- Nothing was staged or committed.