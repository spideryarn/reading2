Reviewed `fd143749e` alone, against the round-one findings. No P0–P2 findings
within the reopened scope.

| ID | Severity | Finding | Status |
|---|---|---|---|
| R1 | P3 | `src/store/pg-skim-briefs.ts:162` claimed a job inserted after the live-job check must target the replacement row. Its profile may already have been read from the deleted row. | **Fixed comment only:** name the accepted gap and the profile-hash warning. No executable behaviour changed, so no red-first regression was needed. |

**Retry and missing-brief wording: correct.** The HTTP boundary restricts a brief
job to Quotes, Ideas and Skim (`parseSkimBrief`); these read stored article data
and have no fetch/upload step. Omitting the old URL makes `slugForRetry` keep
the named article. `enqueue` then restores its URL with `urlForSlug`, so the
job still has its display/source context. The work key and source reservation
also return to the bare-slug request's semantics. Normal brief requests carry
no upload; upload retries outside this branch retain both their upload data
and their existing allocation path. A missing brief returns `"gone"` before
force or freshness comparisons, and the skip uses the deletion sentence.

Keeping this fix keyed on `skimBrief` is sufficient and appropriate for this
review. The known same-URL problem for other late-stage retries remains outside
scope. A wider fix should distinguish a retry naming an existing article from
an ingest retry: an ingest whose early steps already succeeded still needs
its original source/checkpoints and must not be classified merely by the work
left unfinished.

**C5: correct for already queued/running jobs, with the documented limit.**
`ACTIVE` is exactly `queued` and `running`. Including stopping jobs is necessary
because a last step may still commit; including expired running claims is
conservative because the queue may requeue them. Terminal jobs cannot write
through their old claim. Retrying one creates a new job with its old profile
snapshot, which can differ from the current sentence just as after an edit.
The owner, slug and brief-id predicates scope the query to the correct target;
the same id on another article does not block creation.

Create holds the owner-filtered article lock. `enqueueIn` takes that same lock
before inserting, and session completion takes article then job. The live-job
query needs no job-row lock: the article mutex serializes inserts and route
completion. A concurrent cancellation or terminal settlement may cause an
unnecessary 409, but cannot admit a stale route through a terminal claim.

The gap is real: read old brief/profile → delete → recreate → insert job.
It is acceptable under the documented edit-during-run semantics, not a full
guarantee that an old request can never populate a replacement. The route
retains the old profile hash; the brief GET compares it with the current
sentence through `skimResponseFor`, reporting `profileChanged` when different.
Identical replacement text is semantically equivalent. An absolute incarnation
guarantee would still require a stronger fence. No broader change made.

**C1–C3 landed as intended.** Reads repeat ownership in the child-row join;
mutations authorize while acquiring the article lock. Brief route persistence,
prerequisite publication and job ending now share `StoreSession.commit`'s
transaction, with live-claim and draft fencing; a publication failure rolls
the route back too. The default route keeps its existing path. Forced brief
steps check existence before spending. The existing structure/power gates may
refuse earlier; they do not buy a deleted brief's Skim call.

Validation: **242 unit tests passed across five files**; full typecheck passed
(`node --import tsx scripts/typecheck.ts`), scoped Biome lint and
`git diff --check` passed. Independent GPT Sol source review found no blocking
defect. No network or Postgres run attempted; full `npm test` therefore remains
unverified here. Please run:

```bash
npm test -- --project private-postgres \
  tests/skim-briefs-pg.test.ts tests/article-transfer.test.ts \
  tests/store-pg-session.test.ts tests/jobs-walk.test.ts \
  tests/jobs-commit-path.test.ts tests/retry-keeps-the-checkpoints.test.ts \
  tests/retry-is-only-for-a-failed-job.test.ts
```

The comment correction and this report are left uncommitted for the parent
stage to collect. The pre-existing round-two prompt is untouched.
Concurrent edits in `src/routes.ts`, `src/types.ts` and the web files are not
part of this review and were not changed by this reviewer.
