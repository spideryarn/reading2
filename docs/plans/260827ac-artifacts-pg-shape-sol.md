The shape as stated is wrong in two important places: the adapter must be bound to an already-resolved job draft, not a resolver, and transaction membership must be a construction-time capability, not an optional argument to `write`.

## Ranked findings

1. **NO-SHIP: `{ articleId, revisionId }` is not a sufficient address.** Confidence: high.

`createPgArtifactStore(resolve)` copies the surface shape of the filesystem factory but not its semantics. `createFsArtifactStore` calls a pure, deterministic resolver from the supplied slug (`src/store/artifacts-fs.ts:419-425`). `openOrBeginJobDraft` is stateful: it locks, may mint a revision, and fences a live job (`src/store/pg-revisions.ts:673-760`). It must run once per advance, not lazily or repeatedly behind store methods.

The bound address should be an immutable value along these lines:

```ts
interface JobDraftRef {
  slug: string;
  articleId: string;
  revisionId: string;
  jobId: string;
  attemptId: string;
}
```

Each field is load-bearing:

- `slug` makes the existing method argument checkable.
- `articleId` is required by both composite block foreign keys; see `docs/plans/260827aa-delete-the-importer.md:253-255`.
- `revisionId` addresses the draft.
- `jobId` and `attemptId` are required to fence `beginStep`, the final write, and the job transition. `revision_step_runs.attempt_id` is explicitly the job attempt token (`src/db/schema.ts:975-992`).

Recommendation: use `createPgArtifactStore(ref, executor)`, not `createPgArtifactStore(resolve)`.

Leaving `slug` in the methods is acceptable if every method begins with a mandatory `slug === ref.slug` assertion and mismatch throws. Then it is not unused; it is a cross-adapter consistency guard. The current interface comment claiming Postgres “resolves” the slug is no longer true and must change (`src/store/artifacts.ts:230-232`).

Reproduction to require: construct a store for draft A and call every method with slug B. Every call must throw before issuing storage reads or writes; none may return `false` or `null`.

2. **NO-SHIP: the two modes are not “read” and “write.”** Confidence: high.

The pre-step instance performs reads, but it also performs `beginStep`. The transaction-bound instance writes, but it must also read its own uncommitted writes for validation and call fenced `finishStep`.

The current order makes this explicit:

- `stepIsDone` before the run: `src/jobs.ts:325`
- `beginStep` before the model call: `src/jobs.ts:369`
- stage/model call: `src/jobs.ts:379-384`
- postcondition read: `src/jobs.ts:386`
- `finishStep`: `src/jobs.ts:392`

Therefore option (a), as named, hides real writes in the “read” side and real reads in the “write” side.

The best fourth shape is:

- One internal adapter implementation bound to `ref + DbLike`.
- A preflight capability exposing reads, `interrupted`, and `beginStep`.
- A transaction capability exposing reads, `write`, and `finishStep`.
- A private coordinator `commitStepIn(tx, …)` that constructs the transaction capability and performs artefact write + step completion + upload/job transition.

If you want the smallest type change, choose **(c), but remove the default**:

```ts
createPgArtifactStore(ref, dbOrTx)
```

Never allow `dbOrTx = getDb()`. A default makes forgetting the caller’s transaction compile and succeed in separate commits.

Ranking the listed choices:

1. Fourth capability split, backed by one implementation.
2. (c), with an explicit mandatory `Db | Tx`.
3. (a), only if the two factories are thin capability views over one implementation.
4. (b). An optional transaction on `write` is the exact silent split this landing exists to prevent.

The private `…In(tx)` split belongs at the coordinator’s whole atomic operation, not merely around the artefact update. An artefact-only transaction can still commit before the job fence.

3. **NO-SHIP: `has` cannot own general freshness.** Confidence: high.

The plan’s phrase “`has()` must consult `revision_step_runs` and compare the stamp” is too broad (`docs/plans/260827aa-delete-the-importer.md:256`). `has` receives no expected stamp, and expected input is step-specific: `ideas` hashes blocks plus tree, while other steps use different inputs (`src/pipeline.ts:1338-1349`). Teaching the adapter those rules would duplicate pipeline logic in storage.

Keep three questions distinct:

1. Is there a complete, readable stored generation?
2. Did its run finish successfully?
3. Is its recorded stamp current against today’s expected stamp?

For Postgres, I recommend `has` mean:

- Empty `kinds` → `false`, matching filesystem.
- Invalid `(step, kind)` → throw, matching `pathFor`.
- Every requested physical value can be reconstructed and passes the same shallow runtime shape checks as the filesystem decoder.
- A matching `revision_step_runs` row exists with `status = "done"`.
- Where storage has collapsed two logical artefacts, the run row is internally consistent with the stored value. In particular, `toc.input_hash` must match the stored block rows.
- It does **not** compare against what the step would produce today.
- It does **not** require `attempt_id` to match the current job after completion. Carried successful rows deliberately have no copied attempt ID (`src/store/pg-revisions.ts:599-603`).

Then `stampFor` returns the recorded stamp, and `stepIsDone` retains the expected comparison already present at `src/pipeline.ts:502-509`.

That yields the honest cases:

| State | `has` | `stepIsDone` |
|---|---:|---:|
| Carried glossary, still current | true | true |
| Carried glossary, stale input | true | false via stamp |
| Artefacts exist, run is running/error | false | false |
| No block rows and no done run | false | false |
| Intentional empty blocks plus done run | true | later publication refuses |
| Stage-3 rows with a stale carried `toc` run | false | false |

This is a documented primitive-level difference: filesystem `has` may return true while a running marker exists, because `interrupted` is separate. Postgres needs the done row as a completion and empty-value witness. The observable `stepIsDone` result agrees.

The JSONB side does not literally need `JSON.parse`, but it still needs runtime shape validation. Drizzle’s TypeScript type does not validate stored JSONB (`src/db/schema.ts:338-344`).

4. **HIGH: do not bury the `toc` freshness rule inside `has`.** Confidence: high.

`toc` currently declares no `stamp` (`src/pipeline.ts:1057-1069`). If the adapter compensates with a private `toc` special case, there will be a third independently written status/hash test beside:

- `articleMetadata`: `src/store/pg.ts:612-659`
- publication: `src/store/pg-revisions.ts:848-878`

That recreates the exact class documented in `docs/postmortems/260827d-toc-status-never-checked.md:89-106`.

Give `toc` a normal pipeline stamp. Its expected input should hash the **stage-3** `blocks` artefact, not the `toc` copy; that also lets the filesystem adapter detect stage-3 output diverging from an old `data/<slug>/blocks.json`. `stampFor("toc")` can continue reading labels/run provenance.

Without that change, the adapter will necessarily contain a one-off freshness policy and the shape remains wrong.

5. **HIGH: empty blocks must mean authoritative delete-all.** Confidence: high.

The importer’s current conditional encloses both deletion and insertion (`src/store/import.ts:567-597`), so an empty array leaves inherited rows untouched. That is unsuitable for the adapter.

Correct order:

1. Upsert identities for the supplied blocks; zero rows is fine.
2. Always delete every `revision_blocks` row for the revision.
3. Insert the replacement rows; skip only this insert when empty.
4. Record the completed step in the same transaction.

A no-op on empty is a classic silent success: the stage returns `[]`, old rows survive, `read` returns the old article, and the run reports done. Delete-all stores exactly what the stage produced. Whether an article with no blocks is publishable is a separate policy; publication already refuses it at `src/store/pg-revisions.ts:837-840`.

Required reproduction: start with N carried blocks, write `{ blocks: [] }`, and assert the transaction sees zero rows. Then assert publication refuses. Also force the later job fence to fail and verify the delete rolls back.

6. **HIGH: `recordStepRun` is not the right primitive for `beginStep`/`finishStep`.** Confidence: high.

One correction to the premise: as written, `recordStepRun` does **not** clobber an existing `attempt_id` during its conflict update. `values` omits the property (`src/store/pg-revisions.ts:794-804`), so `set: values` updates only the listed columns (`src/store/pg-revisions.ts:808-810`). An insert creates a null attempt, but an update leaves the column untouched.

The danger arrives when the function is extended:

- `beginStep` needs to install an attempt.
- `finishStep` must predicate on that attempt.
- A generic upsert whose conflict target is only `(revision_id, step_name)` can overwrite a newer attempt unless its statement is explicitly fenced.

Use separate statements:

- `beginStep`: fenced insert/upsert after proving `jobs.id`, `jobs.attempt_id`, `status = running`, and `draft_revision_id` all match the bound ref. Use `NO_INPUT_HASH` initially rather than inventing a blocks hash.
- `finishStep`: `UPDATE … WHERE revision_id = ? AND step_name = ? AND attempt_id = ? AND status = 'running'`; require `rowCount === 1`.
- Error completion: the same fence, setting `status = 'error'`.
- Final artefact/stamp update and `finishStep` occur inside the coordinator transaction; if the job transition fence fails, all roll back.

Keep `recordStepRun` for unfenced/import or compatibility uses, or refactor it underneath these operations, but do not make the generic upsert itself the ownership protocol.

7. **MEDIUM: `revision_step_runs` is not the whole `StepStamp`.** Confidence: high.

The row has input hash, implementation version, prompt version, and model, but no `profileHash` (`src/db/schema.ts:956-993`). `ideas.profileHash` lives only in the JSON artefact, and `null` is a real recorded value (`src/store/artifacts.ts:190-195`).

Therefore `stampFor` must merge:

- row fields, especially `implementationVersion`;
- artefact-embedded fields, including `profileHash`;
- conflict checking where both carry the same field.

Do not expose `NO_INPUT_HASH` as a genuine recorded input hash. Preserve `profileHash: null` rather than dropping it with `??` or a truthiness test. The filesystem implementation demonstrates the required null handling at `src/store/artifacts-fs.ts:381-388`.

## Recommendations on the three questions

1. **Addressing:** bind an already-resolved `JobDraftRef`; do not bind a resolver. Keep `slug` temporarily as a mandatory consistency assertion. The proposed `{articleId, revisionId}` resolver shape is incomplete.

2. **Transaction:** prefer the capability-split fourth option. If minimizing interface work, use option (c) with an explicit, non-defaulted `Db | Tx`, and place the private `…In(tx)` boundary around the coordinator’s entire atomic commit. Reject optional `tx` on `write`.

3. **`has`:** make it “all requested outputs are readable and backed by a successfully completed stored generation,” with run-row/internal consistency checks but no comparison to today’s expected stamp. Leave freshness to `stampFor` + `sameStamp`, and give `toc` a real pipeline stamp rather than reproducing its rule inside the adapter.