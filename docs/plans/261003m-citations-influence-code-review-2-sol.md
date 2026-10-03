Fixed the metadata fencing gap and corrected the cancellation claim. No commits, DDL, migrations applied, paid calls, or edits to `evals/results/`.

The supplied guarantee is **too strong about request lifetime**: the timeout settles the wait and signals abort; a transport ignoring abort can finish after allowance release. Its late result is ignored. The other stated checks match the code. “Strict spaced” matching folds case/punctuation and collapses whitespace; the stored quotation is the extract’s own slice.

| ID | Severity / evidence | Disposition |
|---|---|---|
| F15 | P2, established by failing test: citation metadata was outside the untrusted fence. | Fixed; fenced metadata, updated instructions, bumped influence version to `/2`. |
| F16 | P2, established by failing press harness: underlying request can settle after allowance release. | Corrected claims; retained a late-result test. Transport limitation reported. |
| F17 | P2, established acceptance boundary: identical title/year can pass despite different authors; actual misattribution is reasoned. | Reported identity-policy limitation. |
| F18 | P2, established call path: eval capture inherits the paid influence call and discards its result; additional cost is reasoned. | Wider; reported. |
| F19 | P2, established layout: paper-passages metadata has the same fencing gap; model impact is reasoned. | Wider; reported. |

Migration inspection passed: additive only, CHECKs consistent, all five columns explicitly written/cleared, journal/snapshot aligned. Public payload omits the investigation. Owner UI and chat share the effective read path. Tooltip date uses the press’s `at` in the reader’s local zone. Full F1–F9 and prose audit is in the review file below.

Raw final results:

```text
 Test Files  7 passed (7)
      Tests  388 passed (388)
```

Supporting mapper, prompt-coverage and doc-link tests:

```text
 Test Files  3 passed (3)
      Tests  41 passed (41)
```

Both mutations were noticed and restored: cross-page quote matching failed one test; removing the version guard failed one test. Typechecking passed through `node --import tsx` after the normal launcher hit sandbox IPC restrictions. Migration-chain check passed; lint reported one existing complexity advisory.

Please run the Postgres suites: `citation-investigate-route` for CHECKs and clearing on upsert; `store-export-covers-tables` for exported fields; `ai-calls-spend-pg` for ledger persistence. Actual influence cost/usefulness remains unmeasured.

Files changed:

- [src/citation-influence.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/citation-influence.ts)
- [src/citation-effective-influence.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/citation-effective-influence.ts)
- [src/citation-investigate.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/citation-investigate.ts)
- [tests/citation-influence.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/tests/citation-influence.test.ts)
- [tests/citation-investigate.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/tests/citation-investigate.test.ts)
- [docs/project/citations.md](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/docs/project/citations.md)
- [261003m plan](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md)
- [Stage 2 review](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/docs/plans/261003m-citations-influence-code-review-2-sol.md)
- [Postmortem](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/docs/postmortems/261003g-a-fence-covers-the-page-but-trusts-the-article-label.md)

land after fixes