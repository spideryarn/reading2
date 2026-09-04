## Findings

1. High — the promised mutation evidence is not in the reviewed artefact.

The plan says every suite has a retained mutation and an account of what it does not cover ([plan](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md:1911)). The commit message makes the same claim, but [the scoped diff](/tmp/claude-1000/-home-greg-code-spideryarn2/225d6eb2-0057-42cc-8a0a-ae321540a3b5/scratchpad/b12.diff:1) does not contain those records.

None of the ten additions records both:

- the conversion-specific mutation watched red; and
- the behaviors that mutation did not cover.

`list-reconciles-expired` and `one-article-for-one-address` contain older mutation notes already present before this conversion. `second-job-queues` adds only the mutation that stayed green ([second-job-queues.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/second-job-queues.test.ts:172)). The other files contain no identifiable conversion mutation record.

Practical consequence: Stage G cannot audit the claimed evidence, and future reviewers cannot distinguish “tested and red” from “reported green.” This is precisely the silent-success class Stage B exists to prevent.

Reasoned from the old files, scoped diff, current files, plan, and commit message.

2. Medium — `quiz-mark-route` still reaches the filesystem ledger, contrary to its registry entry.

The registry lists only `fixture-loader` and says “the provider is stubbed to reject, so no ledger row” ([registry](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.ts:652)). But the suite deliberately reaches the provider in its negative control ([quiz-mark-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/quiz-mark-route.test.ts:425)) and starts then aborts a successful stream ([quiz-mark-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/quiz-mark-route.test.ts:529)).

The streaming wrapper records spend for rejection, abort, and every other exit through `finally` ([ai-call.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/ai-call.ts:1165)). The dated witness already records `ai-calls-fs:fsCostStore.record` for this suite ([witness](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-witness.json:345)).

It should have `mechanisms: ["ledger-redirect", "fixture-loader"]`, and the reason should acknowledge the ledger. This does not invalidate the Postgres quiz assertions, but it makes the registry’s remaining-filesystem account false.

Reasoned from the call path and corroborated by the existing witness.

3. Medium — the query-string suite actively uses the condemned `CHAT_SWEPT` symbol, but the registry names only the fixture loader.

Its GET request always calls `sweepChat` ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/routes.ts:7124)). The Postgres sweep writes `CHAT_SWEPT`, imported from `fs.ts` ([pg-chat.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/pg-chat.ts:81), [pg-chat.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/pg-chat.ts:651)). Yet its entry says only `fixture-loader` and “what is left is the seeder’s copy step” ([registry](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.ts:981)).

Add `shared-symbol`. This is condemned-module reach, not a filesystem read returning an empty answer, but Stage G’s account would otherwise disagree with the code.

Reasoned from the executed route path.

4. Low — four converted entries contradict the registry’s own `database-integration` definition.

These entries explicitly say they are converted and reach no condemned module, yet remain `database-integration`:

- [list-reconciles-expired](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.ts:559)
- [one-article-for-one-address](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.ts:596)
- [second-job-queues](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.ts:754)
- [upload-records](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.ts:1017)

The lane entries prevent Stage B’s derived remaining set from trying to convert them again, so this is not presently operationally dangerous. The risk is semantic: a reader or tool treating `database-integration` as “work remains” gets a false answer.

I agree with the plan’s resolution: rerun the witness and remove these entries rather than inventing a completed/transitional category. Shrinking the map is cleaner than recategorising. Leaving them temporarily is tolerable only while the category-plus-lane derivation is the canonical worklist.

Reasoned from the registry definitions and lane logic.

## Postgres reach and assertion preservation

Every suite has an ungated `expect(STORE).toBe("postgres")`; none imports or calls any of the thirteen named filesystem-only readers. The only matches for `loadThreads` are comments explaining its removal.

| Suite | Non-vacuous Postgres evidence | Old behavior lost |
|---|---|---|
| `the-query-string…` | Seeds an article and thread, reads the store-minted thread id, then requires that id and transcript/summary differences from the route ([test](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/the-query-string-does-not-decide-the-route.test.ts:146)). | None |
| `chat-spoken-route` | Appends through the route and reads the conversation back through owner-scoped `chatStore.load`; replay assertions also inspect stored state. | None; `loadThreads` was replaced. |
| `chat-live-ticket-route` | Seeds a real article/thread; ticket and tool paths load Postgres state, and successful tickets journal through the Postgres adapter. | None |
| `chat-live-turn` | Real `begin`, retry, finish and stop operations; stored conversations are read through `chatStore.load`. | None; `loadThreads` was replaced. |
| `quiz-mark-route` | Quiz artifacts are published into Postgres revisions; the positive control reaches the model only when the batch, question and current revision all exist. | None; direct file overwrite became a real second publication. |
| `second-job-queues` | Holder and requested jobs use `pgJobStore`; route assertions require created rows and distinct/same ids. | None |
| `upload-records` | Every lifecycle operation uses the selected Postgres upload adapter and reads the resulting row state. | None |
| `list-reconciles-expired` | Seeds real job rows, updates `lease_expires_at` using the database clock, and reads settlement results back. | None |
| `one-article-for-one-address` | Exercises real partial unique indexes and verifies the allocation/repair results from Postgres. | None |
| `article-cache-call-site` | Seeds an article and job and runs the production claim/publication path; exact read-call assertions prevent an empty fake from satisfying it. | None |

All old test cases remain. Expectation counts either stayed equal or increased by the new Postgres sentinel. The only assertion whose meaning changed was `expect(STORE).toBe("files")` becoming `postgres`. No filesystem-byte assertion was simply dropped; quiz’s file mutation retained its reader-visible behavior as a publication.

Some validation cases intentionally reject before touching storage. That is appropriate: their asserted behavior is input validation, while each suite’s persistence claims have a non-empty positive control.

## `second-job-queues` green mutation

The recorded conclusion is correct.

`tryEnqueue` returns immediately after a clean insert ([pg-jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/pg-jobs.ts:206)). Therefore the two “different job is accepted” cases never reach the re-read classifier.

The double-click case does cause a conflict and reaches `sameWork` ([pg-jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/pg-jobs.ts:283)), but the sole conflicting row already agrees on owner, slug and work key. Removing only the work-key predicate cannot change that answer.

This file therefore exercises:

- `sameWork`, but not the necessity of its work-key predicate;
- none of `sourceTaken`;
- none of `nameTaken`;
- none of the primary-key/id-collision path.

That was reasoned from the test inputs and classifier; I could not reproduce it by mutation because the sandbox blocked database access.

## Isolation

I found no collision among the ten.

The private lane is explicitly serial: `fileParallelism: false`, `maxWorkers: 1` ([vitest.config.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/vitest.config.ts:171)). Fixed slugs are distinct. Reused-looking thread ids are scoped by article. Random identifiers are used where global uniqueness matters. There is no `truncate`.

Completed runs clean their articles, jobs, uploads and conversations. `list-reconciles-expired` and `upload-records` deliberately leave fixed `auth.users` rows, but seed them idempotently; those rows do not make a second run fail. A process killed before teardown can leave scoped fixture rows, but I found no normal successful-run residue that breaks a subsequent non-fresh run.

## Registry definitions and merge

The four definitions are:

> `filesystem-adapter-behaviour`: none until stage G; its subject is the filesystem implementation and it dies with the adapter.

> `store-agnostic-fake`: swap the filesystem fake for a narrow `ArtifactReads` or purpose-built fake.

> `database-integration`: move it, or finish moving it; it belongs on Postgres but is not fully there yet.

> `shared-mechanism-collateral`: no per-file work; a shared mechanism put it on the list and fixing that mechanism removes it.

Six new verdicts appropriately use `shared-mechanism-collateral`, subject to the two missing mechanisms above. The other four do not satisfy the literal `database-integration` definition anymore; they are intentional temporary occupants awaiting the witness rerun.

I found no duplicated registry key, conflicting owner verdict, or alphabetical merge damage. Nine static registry tests passed; the remaining registry test was blocked when its child `tsx` process hit a sandbox `EPERM`, not by an assertion failure.

## Test execution

I ran the requested command:

```text
npx vitest run --project private-postgres tests/second-job-queues.test.ts
```

The managed sandbox denied the local PostgreSQL connection with `connect EPERM 127.0.0.1:54362`. Private setup then installed its poison URL and collection failed with a database/Blob-store URL mismatch. Result: zero tests collected, exit 1. Therefore none of the findings above is claimed as runtime-reproduced. The retained `b2-full.log` reports the batch passing elsewhere, but that is not my reproduction.

## Verdict

Land with named follow-ups; do not call it complete as-is.

1. Retain the exact mutation, observed red result, and uncovered ground for every suite. Where that evidence no longer exists, rerun the mutations rather than reconstructing the claim.
2. Add `ledger-redirect` to `quiz-mark-route`.
3. Add `shared-symbol` to the query-string suite.
4. Rerun the witness at Stage B’s boundary and remove the four completed `database-integration` entries.

I do not think Stage B’s approach is wrong. Explicit store selection, real per-run Postgres, serialized files, non-vacuous readbacks and assertion-by-assertion comparison are the right structure. The defect is that its mutation-evidence discipline was reported but not retained—the process guard, not the conversions themselves, needs tightening before the remaining fourteen.