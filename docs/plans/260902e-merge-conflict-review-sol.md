Your `src/store/jobs-fs.ts` resolution is correct and complete, with one important detail already handled: the version must change to a genuinely different string, such as `"2026-09-02-tickets"`.

The worktree changed while I was reading: merge commit `7b074e3` has now landed, followed by `56074e4`. I made no changes.

### 1. `jobs-fs.ts`

The committed resolution is right:

```ts
const state = processSingleton<QueueState>(
  "jobs-fs",
  "2026-09-02-tickets",
  () => ({
    index: new Map(),
    attempts: new Map(),
    tickets: new Map(),
    forgotten: new Set(),
    writes: new Map(),
    writeCounter: 0,
    loaded: null,
  }),
);

const { index, attempts, tickets, forgotten, writes } = state;
```

See [jobs-fs.ts:101](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/jobs-fs.ts:101).

I walked every reference:

- There are no remaining `keys` references.
- `index`, `attempts`, `tickets`, `forgotten`, and `writes` are only instantiated inside the singleton factory. Their module-local bindings are references to those shared objects.
- `writeCounter` is accessed only as `++state.writeCounter` at [jobs-fs.ts:178](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/jobs-fs.ts:178).
- `loaded` is accessed only through `state.loaded`, including the retry-on-failed-load path and `reloadForTests`.
- Removal and all three test resets use `tickets`, not `keys`.

No auto-merged use in this file falls back to module-owned state.

### 2. Version behaviour

`processSingleton` throws. It neither replaces the object nor returns stale state:

```ts
if (held.version !== version) {
  throw new Error(/* Stop the server and start it again */);
}
return held.value;
```

See [process-state.ts:103](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/process-state.ts:103).

That is safe here. Replacement would create an empty lock universe, run `loadFromDisk`, sweep the running job, and recreate the $5.43 failure.

The trade-off is deliberate: this particular source-shape transition cannot hot-reload successfully. The new copy fails before loading or sweeping anything; the old claimant retains the old state and can continue. After it settles, stop and restart the process to load the new shape. Stopping earlier may waste that one in-flight call, but it cannot overlap it with a replacement claimant.

Keeping `"2026-09-02"` would not have been a bump at all. The committed `"2026-09-02-tickets"` is correct.

### 3. `tickets` lifetime

Nothing in your change requires module lifetime. It requires at least process lifetime.

If a reloaded module received an empty `tickets` map while keeping the shared `index`:

- `sameWork`, `sourceTaken`, and `nameTaken` would all fail to recognize existing jobs at [jobs-fs.ts:479](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/jobs-fs.ts:479).
- Duplicate jobs could be queued.
- Two simultaneous URL mints using different slugs could run concurrently; the per-slug claim rule would not join them.
- A later `persist(job)` would obtain `undefined` from the empty map and could overwrite the file without its ticket, making the loss durable.

Putting `tickets` in `QueueState` is therefore necessary, not merely tidy.

### 4. `Stored`

It is right:

```ts
type Stored = Job & Partial<EnqueueTicket>;
const stored: Stored = { ...job, ...ticket };
```

The canonical new on-disk shape should be:

- `workKey`: always present when there is a ticket.
- `reservesName`: explicitly `true` or `false`.
- `urlKey`: present only when defined.

Spreading the ticket preserves meaningful `false`; `JSON.stringify` omits only the undefined `urlKey`. Reloading also handles compatibility correctly at [jobs-fs.ts:314](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/jobs-fs.ts:314):

- Old record with `workKey` but no `reservesName` → ticket with `reservesName: false`.
- Record predating `workKey` → no ticket, not an invented empty key.
- New record with `reservesName: false` → remains false.

### 5. Two other findings

The newly added `tests/two-servers-one-queue.test.ts` originally used the old string argument and `.created`; the merge commit has now corrected all four calls to tickets and `kind === "created"`.

I would add one companion case that reloads the module and then classifies `sameWork` or `nameTaken`. The existing test proves that `index` and `attempts` survive re-evaluation, but does not specifically fail if only `tickets` becomes module-local.

`docs/project/ingest-queue.md`: yes, keep both sections, with “The article’s line” first. The committed order is correct.

`drizzle/meta/_journal.json`: the committed resolution is not complete. The filenames do not collide, but the snapshots form a fork:

- [0052_snapshot.json:2](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/drizzle/meta/0052_snapshot.json:2) has parent `5f6c3225-…`.
- [20260902141103_snapshot.json:2](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/drizzle/meta/20260902141103_snapshot.json:2) has the same parent.

Drizzle snapshots must be a linear chain. Merely assigning journal indices 52 and 53 leaves both children of 0051; the next generation/check will reject that fork. The project runbook explicitly warns that changing only `prevId` is also wrong because the snapshot contents were generated from the wrong schema base ([database.md:672](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/docs/project/database.md:672)).

Because `0052_per_article_job_queue` is already applied to the shared local database and the BYOK migration is documented as not applied there—and is not on `main`—the least destructive repair is:

1. Preserve `0052_per_article_job_queue`, including its `when`.
2. Regenerate the BYOK migration and snapshot on top of `0052`.
3. Reapply its hand-written backfill/comments to the regenerated SQL.
4. Let the regenerated journal entry become index 53 with its new later timestamp.
5. Update references to its old filename.

That should be a forward corrective commit now; do not rewrite or reset the landed merge.