Reviewed the exact 726-line candidate with SHA-256:

`a2345b5db0c607010efd5366eba4374bf71d53891bb30d768083b647043b16bd`

The file changed several times during review, so this verdict applies only to those bytes.

## Findings

### F1 — P2, established: stage L substantially repeats shipped protection

[Stage L](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:549) proposes testing that safe refusals retain their status, database exceptions are scrubbed, and sensitive sentinels do not escape.

Those contracts already have unusually strong coverage:

- [routes-status-classes-survive-the-store-guard.test.ts](/home/greg/code/spideryarn2/tests/routes-status-classes-survive-the-store-guard.test.ts:1) statically reconciles the route mapper and guard, including binding identity and negative controls.
- [db-error-scrub.test.ts](/home/greg/code/spideryarn2/tests/db-error-scrub.test.ts:360) covers safe refusals and sensitive Drizzle errors.
- [comment-referee-mark.test.ts](/home/greg/code/spideryarn2/tests/comment-referee-mark.test.ts:375) is the real route→guard→Postgres end-to-end proof.

The novel issue is narrower: [the outer mapper](/home/greg/code/spideryarn2/src/routes.ts:6420) is not total over `unknown`; `null` or hostile `status`/`message` accessors can make the catch handler itself throw. No reachable production source of such values is established.

Consequence: an M-sized prevention stage could duplicate shipped work and add another contract surface without demonstrating a current omission.

Smallest correction: narrow L to the unknown-throw mapper hypothesis. Treat the existing three suites as constraints, not tests to recreate. Require a red route-level witness for `null`/hostile accessors before changing code; defer if no realistic seam can produce it.

Verify by showing the new test red before the correction and green afterward while the three existing defenses remain unchanged and green.

### F2 — P2, established; concurrency premise reasoned: retention reopens a recorded decision

[Stage O](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:616) asks Greg to choose cadence and says not to add cleanup to a reader request. The authoritative decision already says the opposite: abandoned drafts are swept per article when that article next runs a step, and explicitly says not to reopen the choice ([cron-scheduler.md](/home/greg/code/spideryarn2/docs/project/cron-scheduler.md:42)).

Likewise, [stage I](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:501) would move the retention signpost into `database.md`, although `cron-scheduler.md` already owns the decision.

The race concern is legitimate but not yet an established data-loss path. The current sweeper enumerates protection and later deletes by ID without rechecking ([pg-revisions.ts](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:2528)); whether an ordinary path can newly protect an old candidate during that interval remains unresolved.

Consequence: a less-capable implementer could discard an approved simpler design or create duplicate documentation ownership. An inadequately specified race fix could also leave protection non-atomic.

Smallest correction:

- State the existing per-article, on-demand decision and plan that implementation.
- If measurements justify reconsidering it, explicitly ask Greg to reverse that decision.
- Keep `cron-scheduler.md` as the fact’s home; `database.md` may link to it.
- State the race oracle explicitly: protection added after enumeration must win, delete zero rows, and preserve every article/job pointer. Require locking or an atomic delete-time recheck against the same protection predicate.

Verify with a barrier-controlled fixture between enumeration and deletion, plus the documentation ownership test.

### F3 — P2, established: research priority contradicts the plan’s own scoring

P is described as “before more features,” has a value/effort ratio of 2, and addresses an open question recorded as worth resolving early ([priority table](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:99), [Q6](/home/greg/code/spideryarn2/docs/project/open-questions.md:76)). Yet the prescribed batches schedule A–D and then E/F without placing P ([batch order](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:118)).

Consequence: speculative product work can begin before the cheap study protocol intended to distinguish observed friction from conjecture.

Smallest correction: put preparation of P in the first review batch, or immediately after it and before E/F/M. Running the study may still wait for Greg, consent and recruitment.

Verify that the narrative batch order agrees with the table and with P’s “before more features” claim.

### F4 — P2, established: the live candidate has undeclared dependencies

The declared candidate is the plan plus this prompt, but the plan now depends on five additional untracked files:

- command evidence at [line 85](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:85)
- two postmortems at [A](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:184) and [D](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:321)
- two Sol review artifacts at [line 698](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:698)

All five are currently untracked. The document-link test passes only because they happen to exist in this shared dirty tree. This violates the review template’s requirement for a complete untracked manifest ([review-prompt-template.md](/home/greg/code/spideryarn2/docs/reusable/review-prompt-template.md:24)).

Consequence: the declared candidate cannot be reproduced, reviewed, or landed independently; omitting the supporting files would leave broken links.

Smallest correction: either add all five files to the candidate manifest and review/land them together, or remove those dependencies and retain the essential evidence inside the plan.

Verify from a clean checkout containing exactly the declared candidate, then rerun the document-link test.

### F5 — P3, established: evidence labels and reconciliation table need a final editorial pass

The plan defines three exact evidence states—Reproduced, Proved from code, Hypothesis—but the priority table uses informal variants such as “code gap,” “code risk,” and “code + dated reader report” ([definitions](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:62), [table](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:99)). The sweep ritual specifically requires one of those states on every finding ([improve-the-codebase.md](/home/greg/code/spideryarn2/docs/reusable/improve-the-codebase.md:194)).

There is also an exact duplicated Stripe row at [lines 669–670](/home/greg/code/spideryarn2/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:669).

Smallest correction: give every A–P row a canonical state, optionally separating “mechanism evidence” from “benefit evidence,” and remove the duplicate row.

Verify mechanically that every row contains one of the three declared states.

## Verdict

No established P0 or P1. I do not refuse the plan.

The plan is broadly accurate, appropriately cautious about hypothetical benefits, and substantially specific enough for implementation. In particular, the revised A stages now preserve existing rows, gate writes safely, require bounded failure ordering, and distinguish code-proved reachability from observed incidents. I found no recommendation that weakens owner/public/privacy boundaries or intentionally discards reader data.

I recommend resolving F1–F4 before handing stages to a less-capable implementer; F5 is editorial. The promised guarantee—an actionable, evidence-labelled plan rather than a complete bug audit or proven product-benefit claim—is met in substance, but the candidate manifest and literal evidence labelling still need correction.

Checked: client opening reads, mode boundaries and activation, glossary/chat handoff, term interaction, article images, route migration and binary responses, database-error handling, retry/config duplication, PDF extraction, revision retention/schema behavior, relevant prior plans/postmortems/feedback, privacy/public-sharing/auth contracts, open questions, and git history.

Skipped as directed: orchestrator/fleet, production data and services, paid inference, browser/runtime verification, full-suite execution, and claims of measured product benefit.

Validation run against the reviewed bytes: `npx vitest run --project unit tests/doc-links.test.ts` — 1 file, 14 tests passed.

## Author's landing record

The plan, evidence and review artifacts were committed together in
`2d12f5fda18b284e27238ec280b294503d3db0d4`. This identifies the resulting candidate,
including author corrections after review; it does not imply this reviewer independently
checked every final byte. The plan's review ledger records the findings and their disposition.
