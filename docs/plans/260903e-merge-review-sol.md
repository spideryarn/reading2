Yes: the sentence is false as a general account of the pre-fix behavior. But the incoming implementation currently returns the correct message because it already has two independent protections.

### Observed probe results

| Case | Incoming `e8f27caa` | Its parent, before both protections |
|---|---|---|
| One wrapper, `ECONNRESET` | `STORAGE_BUSY` | `STORAGE_BUSY` |
| Same store wrapped twice | `STORAGE_BUSY`; same object returned | `STORAGE_FAILED`; different object |
| One guarded store calling another | `STORAGE_BUSY` | `STORAGE_FAILED` |

The exact observed messages were:

- `STORAGE_BUSY`: “This app could not reach its database just then, so that did not go through. It is usually a moment's trouble rather than anything lasting — waiting a few seconds and trying again generally works. [db-busy]”
- `STORAGE_FAILED`: “This app asked its database for something it would not do, so that did not go through. That is a bug here rather than anything you did, and trying again will not help until somebody fixes it. It has been recorded. [db-failed]”

So your errno reasoning accurately describes the old implementation: the first scrub discarded `ECONNRESET`, and the second scrub downgraded the result.

Where your reasoning does not describe the incoming file is between steps 3 and 4:

- A literal second call to `guardDbStore` returns early at [dev-db-errors.ts](</tmp/claude-1000/-home-greg-code-spideryarn2/88b5a2b0-797c-4c1d-a29a-de36e3f1dfb1/scratchpad/dev-db-errors.ts:495>).
- Even if that early return were removed, the first scrub adds `SCRUBBED`, and the outer guard returns the error before rebuilding its chain at [dev-db-errors.ts](</tmp/claude-1000/-home-greg-code-spideryarn2/88b5a2b0-797c-4c1d-a29a-de36e3f1dfb1/scratchpad/dev-db-errors.ts:359>).

Therefore the early return is not currently “the only thing standing” between the blip and `STORAGE_FAILED`; `SCRUBBED` is already the belt-and-braces protection contemplated by option (b).

### Ranked findings

1. **P1 — Reproduced: `SCRUBBED` creates an untested escape through the privacy boundary.**

   The incoming code says the marker “can only be put here,” but uses the globally obtainable `Symbol.for(...)`. I constructed an error containing that symbol and `SENTINEL-forged`; the guard returned the same error and sentinel unchanged.

   More importantly, a guarded outer store can catch an error from a guarded inner store, mutate its `message` or add an enumerable field, then rethrow it. I reproduced:

   ```text
   message: SENTINEL-mutated
   extra: SENTINEL-extra
   ```

   Both crossed the outer guard unchanged because the object retained `SCRUBBED`. There is no such mutation in the current known nested paths, so this is latent rather than a live leak, but it contradicts this file’s central invariant.

   I would make the marker module-private rather than `Symbol.for`, freeze the fully constructed scrubbed error, and add forged/mutated-error regression cases. That is hardening the existing mechanism, not adding another one.

2. **P1 — Reproduced: your challenged sentence and the longer historical claim are false.**

   The incorrect generalization occurs both in the immediate comment and in the header at [dev-db-errors.ts](</tmp/claude-1000/-home-greg-code-spideryarn2/88b5a2b0-797c-4c1d-a29a-de36e3f1dfb1/scratchpad/dev-db-errors.ts:467>), as well as the test header at [dev-store-guard-idempotent.test.ts](</tmp/claude-1000/-home-greg-code-spideryarn2/88b5a2b0-797c-4c1d-a29a-de36e3f1dfb1/scratchpad/dev-store-guard-idempotent.test.ts:13>) and the plan.

   Take option (a): correct all those claims and add errno coverage. I would add two cases because they pin different mechanisms:

   - Same store wrapped twice with `ECONNRESET` remains exactly `STORAGE_BUSY`.
   - A guarded store calling a different guarded store with `ECONNRESET` remains exactly `STORAGE_BUSY`.

   Do not add another transient-decision marker; the existing `SCRUBBED` handling already carries the classification forward by carrying the sanitized error itself.

3. **P2 — Reproduced: throwing `null` or `undefined` breaks the scrubber.**

   Both produced an uncoded `TypeError`:

   ```text
   Cannot read properties of null (reading 'status')
   Cannot read properties of undefined (reading 'status')
   ```

   The unsafe access is [dev-db-errors.ts](</tmp/claude-1000/-home-greg-code-spideryarn2/88b5a2b0-797c-4c1d-a29a-de36e3f1dfb1/scratchpad/dev-db-errors.ts:376>). This loses the expected `StoreFailure` classification and diagnostic. Optional/null-safe accesses in `mayPassThrough`, `classNameOf`, and `framesOf`, plus exact-message tests, would fix it simply.

4. **P3 — Reproduced: the “class instance fails loudly” check misses mixed classes.**

   A class with one enumerable arrow-function method and one prototype method passes `wrapped !== 0`; the returned guard contains the arrow method but silently drops the prototype method. My probe observed `guarded.inherited === undefined`.

   Current stores are object literals, so this is not a merge blocker. If preserving the stated invariant matters, explicitly reject callable prototype methods rather than relying on `wrapped === 0`.

The incoming dedicated suite itself passed all six tests. I made no working-tree changes.