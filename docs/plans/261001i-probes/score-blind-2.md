# Blind score 2: P09–P12 and H1–H4, A and B files

Scored against `key-<id>.md` with the current `scoring.md`. I was not told which file came from which
round. Shares are scaled to the rubric's range and rounded to one decimal. Half credit was given
where a probe touched an item without naming it fully. Plans the probe was barred from opening are
left out of the docs denominator. None of the MUST lists here named a barred plan. Precision: −1
for each wrong or duplicative action from the key that the probe planned, and −1 if more than half
of the docs it opened were dead ends by its own account. No probe stated a tool-call count, so that
column is "—". Confidence is the probe's own figure.

| File | Docs /4 | Reuse /4 | Rules /3 | Disposition /2 | Traps /2 | Precision | Total /15 | Tool calls | Confidence | Biggest miss |
|---|---|---|---|---|---|---|---|---|---|---|
| P09-A | 4.0 | 2.4 | 3.0 | 2 | 1.0 | 0 | **12.4** | — | 7/10 | Did not name `evals/quiz-reading-goal.ts` (`blindOrder`, `generate`) or the bars checker; never measures both the no-profile and the profiled system blocks |
| P09-B | 4.0 | 1.6 | 3.0 | 2 | 0.7 | 0 | **11.3** | — | 7/10 | Missed the whole `evals/quiz-reading-goal*` harness, judge file and bars; no plan to declare the bars first or to read the flagged outputs by hand |
| P10-A | 4.0 | 3.2 | 1.2 | 2 | 1.8 | 0 | **12.2** | — | 7/10 | Rules: no plan to leave the visitor path alone, and no browser check in a Sonnet subagent |
| P10-B | 2.7 | 3.2 | 1.5 | 2 | 1.0 | 0 | **10.4** | — | 8/10 | Never opened `docs/project/icons.md`; missed the trap of a spinner on revalidation and the fact that the state is rarely visible |
| P11-A | 1.3 | 3.0 | 1.5 | 2 | 0.4 | 0 | **8.2** | — | 6/10 | Missed `src/store/public-reader.ts` § `PUBLIC_PROJECTIONS`, `security-map.md` and the 260929a postmortem; the only trap it saw was the pinning tests |
| P11-B | 1.3 | 4.0 | 0.8 | 2 | 1.0 | 0 | **9.1** | — | 6/10 (9/10 already built) | Did not open `security-map.md` or the 260929a postmortem; no rule on widening the DTO going to Greg, on visitors never paying, or on the signed-out browser check |
| P12-A | 2.0 | 3.6 | 2.3 | 2 | 0.3 | 0 | **10.1** | — | 4/10 | Missed every search-specific trap: the `?conf=` / prioritised filter, the log line's drop counts; never opened `silent-success.md` or `sentry-error-monitoring.md` |
| P12-B | 2.0 | 2.8 | 2.3 | 2 | 1.5 | 0 | **10.6** | — | 5/10 | Never opened `sentry-error-monitoring.md`, `silent-success.md` or `write-postmortem.md`; named none of the client filter code (`resolveHits`, `applyConf`, `PRIORITY_CONF`) |
| H1-A | 4.0 | 2.0 | 2.3 | 1 | 0.8 | −1 | **9.1** | — | 5/10 | Saw `CITATION_INVESTIGATE_LOOKUP_FAILED` but still planned message and catch edits without finding the narrow client gap; missed `findTheWork` and `sayToReader` |
| H1-B | 4.0 | 4.0 | 2.3 | 2 | 0.4 | −1 | **11.7** | — | 6/10 | Plans to fix the `useCitations.ts` catch alone, without noting that nine sibling hooks share it; missed `isLookupCallFailure` (a no-match is not a failure) |
| H2-A | 4.0 | 2.7 | 1.5 | 2 | 1.0 | 0 | **11.2** | — | 9/10 | Never names the rollback `src/store/export.ts` / `db:export` as the wrong exporter to edit |
| H2-B | 4.0 | 2.7 | 1.5 | 2 | 1.5 | 0 | **11.7** | — | 8/10 | Never names the rollback exporter (`db:export`, `store-roundtrip`) trap |
| H3-A | 4.0 | 4.0 | 2.3 | 2 | 0.5 | −1 | **11.8** | — | 7/10 | Three of its five docs were dead ends by its own account; missed "log at the queue's seam, not inside a stage" |
| H3-B | 4.0 | 4.0 | 2.3 | 2 | 0.5 | 0 | **12.8** | — | 7/10 (5/10 on gap) | Missed the seam rule and the timing traps (`Date.now` not ISO strings; a job spans several `advanceJob` calls) |
| H4-A | 4.0 | 4.0 | 1.5 | 2 | 0.0 | 0 | **11.5** | — | 7/10 | Did not see that the "not built" bullet in `admin.md` is stale; no traps found (UTC month, eval rows excluded, `mergeUsers`) |
| H4-B | 4.0 | 4.0 | 1.5 | 2 | 0.5 | 0 | **12.0** | — | 9/10 | Rules: the period and unpriced marker, and the UTC month; missed that eval and dev-CLI rows must stay excluded |

Mean over all 16 files: 11.0. I do not know which round each letter belongs to, so the letters are
not reported as round means. The A files sum to 86.5 and the B files to 89.6.

## Judgement calls, for audit
- P09 rules: both probes were credited with "read `prompting-guide.md` before a prompt change"
  because they follow and cite its method. Neither asked to check the exit code together with a
  fresh answer file on the Sol run, and neither lost credit for that.
- P09 reuse: "a new small sibling eval" / "or a sibling script" was hedged and does not paste the
  prompt, so no −2 for a second copy.
- P10-A plans a local `GlossaryLoading` instead of a shared one with `Tweets.tsx`. The key does not
  call that a second copy of an existing helper, so no −2.
- P11-A named `src/store/pg.ts` `REVISION_READ_POLICY` in place of `PUBLIC_PROJECTIONS`, so no
  credit for that reuse item.
- H1: `describeFetchFailure` was left out of the reuse denominator, because the key makes it
  conditional. Both probes got −1 for planning edits to the `useCitations.ts` catch without the
  sibling-hooks caveat, which the key lists as a wrong action. H1-B got disposition 2 because it
  pinned the residual client-catch gap after finding the sentence already built. H1-A got 1
  because it noticed the work was built but planned no clear response.
- H3-A precision: −1, because it lists `ingest-queue.md`, `performance.md` and `debugging.md` as
  "nothing relevant", which is 3 of its 5 docs. H3-B called 3 of its 6 docs not useful, which is
  exactly half and not more, so no penalty.
