# Review the Spideryarn improvement plan

Read-only review. Do not change any repository file, commit, contact services, spend on inference,
or mutate a database. The root task is **plan only**, for the Spideryarn product; orchestrator/fleet
work is explicitly excluded. Follow `docs/reusable/improve-the-codebase.md` and the review template.

Baseline: `4adcdfd62703b6565a27a03c50f20f8a215f1bd8` (pulled from origin/dev).
The initial live, untracked candidate declared at dispatch was:

- `docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md`
- this review prompt

There are no application-code changes. Read the candidate directly; an ordinary git diff cannot
show its untracked contents. Source citations and reproducible commands are in the plan. Inspect
current source, original plans and feedback to check the claims, not only the prose. Existing
untracked scratch/eval files belong to other sessions and are not in scope.

Give an independent assessment of accuracy, prioritisation by ease/value, and whether the stages
are safe and specific enough for a less-capable implementer. The promised guarantee is an actionable,
evidence-labelled plan, **not a complete bug audit or proven product benefit**. Do not demand
implementation of the plan during this review.

Check in particular that it does not re-propose shipped work, claim hypothetical benefits as
reproduced defects, lose reader data through a recommended shortcut, weaken owner/public/privacy
contracts, or reopen prior product decisions without explicitly asking for a new decision.

Use stable IDs F1, F2, etc and this severity scale:

- P0: data loss, exploitable security, incorrect charging, broadly unusable service.
- P1: reachable wrong user behaviour or authoritative contract violation (including a plan that
  directly instructs an implementer to introduce one).
- P2: maintainability/design risk without wrong behaviour today.
- P3: non-behavioural prose issue.

Refuse only for established P0/P1, with exact evidence and the smallest correction. For speculative
claims, name the unresolved premise. For each finding give the file/symbol, consequence, and how to
verify the correction. Do not pad with generic best practices. Finish with a clear verdict and
which source areas you checked/skipped.

You may run an isolated unit test with `npx vitest run --project unit tests/doc-links.test.ts` if
your sandbox allows it. Do not run a full suite: it needs local services that the review environment
cannot reach. The root already ran product clone/complexity census, saw Knip abort on the stale
client-shell stamp, and passed the typecheck script using `node --import tsx`; the full `npm test`
attempt failed before collection on loopback EPERM, and the plan labels it accordingly.

Author's known uncertainties (lower priority than your independent pass): the three client opening
GET race nominations are under separate Sol reachability review; treat the plan's instruction to
prove them before fixing as material. PDF metadata changes and retention are deliberately separate
decision/measurement stages. Product choices are proposals, not already approved behaviour.

## Author's closure: final candidate manifest

The text above preserves the original review brief. During review, supporting artifacts were
added and the live plan revised. The reviewer identified the incomplete manifest as F4. The final
candidate contains exactly these eight new files, all to be committed together:

- `docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md`
- `docs/plans/260908f-prioritised-spideryarn-codebase-improvements-evidence.md`
- `docs/plans/260908f-prioritised-spideryarn-codebase-improvements-review-prompt.md`
- `docs/plans/260908f-prioritised-spideryarn-codebase-improvements-review-sol.md`
- `docs/plans/260908f-prioritised-spideryarn-codebase-improvements-races-review-sol.md`
- `docs/plans/260908f-prioritised-spideryarn-codebase-improvements-races-review-sol-2.md`
- `docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md`
- `docs/postmortems/260908d-build-only-config-work-runs-during-static-analysis.md`

Corrections to the initial brief: Knip reported a config-load error, continued to print findings,
and exited 1; “abort” above was too broad. The client races are now independently traced from
mounted UI, still awaiting deterministic runtime reproduction. Retention already has an approved
on-demand policy; only operation and measurement remain. The plan's final ledger records F1–F5.
The resulting candidate commit is recorded in the full review artifact after commit.
