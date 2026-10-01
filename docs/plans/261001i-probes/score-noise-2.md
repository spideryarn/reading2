# Blind scores, noise check 2 (blind2/, P09–P12, H1–H4)

Scored against `key-<id>.md` with the current `scoring.md` rubric. Barred plans (260929…, 260930…, 2610…) are left out of the Docs denominator. A doc counts only if the probe lists it as opened or quotes its decisive section; a rule or doc merely cited is not "opened". Conditional key items ("only if the gap is taken up", "if it came via Feedback") are left out of denominators. No probe stated a tool-call count.

| File | Docs /4 | Reuse /4 | Rules /3 | Disposition /2 | Traps /2 | Precision | Total /15 | Confidence | Biggest miss |
|---|---|---|---|---|---|---|---|---|---|
| P09-A | 4.0 | 2.4 | 2.5 | 2 | 0.9 | 0 | 11.8 | 7/10 | Never names `evals/quiz-reading-goal-judge.md` or the per-judge bars checker, and misses the no-profile vs profiled split and the judge-floor trap. |
| P09-B | 4.0 | 1.6 | 2.5 | 2 | 0.6 | 0 | 10.7 | 7/10 | Skips `evals/quiz-reading-goal.ts` (`blind`, `score`, `sourceProvenance`) entirely, and leans on a home-made "example" screen rather than reading flagged outputs by hand. |
| P10-A | 4.0 | 3.2 | 2.3 | 2 | 1.5 | 0 | 13.0 | 8/10 | No browser check in a Sonnet subagent, and does not see that the loading state is rarely visible because `Reader` owns the read. |
| P10-B | 1.3 | 3.2 | 1.5 | 2 | 1.0 | 0 | 9.0 | 8/10 | Never reaches `docs/project/icons.md` § The loading spinner or the decisive `glossary.md` paragraph (status never returns to loading), so it misses the revalidation and rarely-visible traps. |
| P11-A | 1.3 | 3.0 | 1.8 | 2 | 0.4 | 0 | 8.5 | 6/10 | Does not open `docs/project/security-map.md` or postmortem `260929a`, and names `REVISION_READ_POLICY` instead of `PUBLIC_PROJECTIONS` (the silent-failure hop). |
| P11-B | 1.3 | 3.5 | 1.3 | 2 | 0.2 | 0 | 8.3 | 8/10 | Says outright that `security-map.md` was not opened; no provenance-never-crosses rule, no signed-out browser check, no prod read-only rule. |
| P12-A | 2.0 | 2.7 | 2.3 | 2 | 1.3 | 0 | 10.2 | 5/10 | Does not open `sentry-error-monitoring.md` or `silent-success.md`, and skips the prior-work check (git log, sibling notes) before building. |
| P12-B | 2.0 | 1.9 | 2.6 | 2 | 1.8 | 0 | 10.3 | 5/10 | Names neither `scripts/feedback-reporter.ts` nor `feedback-endings.ts`, and misses the filter-side helpers (`applyConf`, `keepAbove`, `PRIORITY_CONF`). |
| H1-A | 4.0 | 4.0 | 2.3 | 2 | 0.6 | -1 | 11.9 | 6/10 | Plans to fix the `useCitations.ts` raw-`err.message` catch alone, without saying that nine sibling hooks share the pattern (that is a sweep to propose). |
| H1-B | 4.0 | 1.0 | 2.3 | 1 | 0.6 | -1 | 7.9 | 6/10 | Picks the dead `/find` route as the gap to fix, and misses `findTheWork`, `sayToReader` and `INVESTIGATE_LOOKUP_KEPT`. |
| H2-A | 4.0 | 2.7 | 1.5 | 2 | 0.8 | 0 | 10.9 | 9/10 | Never warns that `src/store/export.ts` / `db:export` is the rollback, not the reader's export. |
| H2-B | 4.0 | 2.7 | 2.3 | 2 | 1.3 | 0 | 12.2 | 8/10 | Misses that an article never run through Quotes has no `quotes.json` by design, and does not name the `quotes` column on `articleRevisions`. |
| H3-A | 4.0 | 4.0 | 3.0 | 2 | 0.8 | 0 | 13.8 | 7/10 | Misses that one job spans several `advanceJob` claims, and that timing comes from `Date.now()`, not the ISO strings. |
| H3-B | 4.0 | 4.0 | 2.3 | 2 | 0.5 | -1 | 11.8 | 7/10 | Never names "log at the queue's seam, not inside a stage", and by its own account three of its five docs were dead ends. |
| H4-A | 4.0 | 3.5 | 1.9 | 2 | 1.0 | 0 | 12.4 | 8/10 | Never says "this month" means the current UTC month (`currentUtcMonth`), and misses the unpriced marker and the `mergeUsers` join. |
| H4-B | 4.0 | 3.5 | 1.5 | 2 | 0.5 | 0 | 11.5 | 9/10 | No period, unpriced-marker or UTC-month rule, and does not say that eval and dev-CLI spend must stay excluded. |

Mean, A files: 11.6. Mean, B files: 10.2.
