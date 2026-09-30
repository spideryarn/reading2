# A fixed window stands in for a condition

The deploy's `test` gate went red twice at `45158b23`, on a box at load 7–9, with 13 and then 6
failures. Every one passed when run alone. The daemon failures were not bugs in what shipped; the
Storage failure was. Behind them were two causes, each with its own class.

- **Five daemon test files** stopped the Overseer daemon after a fixed 300–700 ms and then asserted
  that a pass had run, or that its result was on disk. That bets on how much a loaded box can do in
  the window, and at load 7–9 the bet lost.
- **One Postgres test** exposed a real race in the product. When two writers create the same new
  object in Supabase Storage at once, a read in between can get a 500. `storeRawSource` treated that
  500 as fatal.

The evidence is the gate's own output, which `scripts/deploy.ts` has kept since `e9519628`:
`logs/deploy/2026-09-29T22-44-22-460Z-45158b23-test.log` and `…T23-23-20-094Z-…`.

## What broke

| file | what the window was standing in for | what happened under load |
| --- | --- | --- |
| `overseer-daemon-reports` | "the drain was called three times" | ran it once: `expected 1 to be greater than 2` |
| (same file) | (same) | **hung for 30 s.** The fake source waited for an `abort` event with `addEventListener`, and the signal had already been aborted before the source started. An event that has already fired is never delivered again. |
| `overseer-daemon-usage-pass`, `fleet-usage-history-wiring` | "a usage pass happened and its result reached the checkpoint / history" | `expected 0 to be greater than 0`: no pass fitted in the window |
| `overseer-store-usage` › *an incomplete scan does NOT displace…* | "the first daemon's good report landed" | it had not. The second daemon had nothing stored to defend, so the partial report won, and the test blamed the carry rule for a failure of its own set-up. |
| `load-article-serialisation` | nothing: this is the real race | two of four concurrent loads got `Storage get failed (500)` |

## Class 1: a fixed window stands in for a condition

**A test that waits a set number of milliseconds and then asserts something happened has replaced
the thing it means ("the pass ran, and a tick wrote it") with a guess at how long that takes.** The
guess holds on the machine where the test was written and fails on a slower one. It fails in the
direction nobody investigates: red means "the box is busy, re-run it".

It has a quieter twin that never goes red. A **negative** assertion over a fixed window ("nothing
fired", "no overlap", "nothing was written") passes more easily the more starved the box is. At
worst it asserts over zero ticks and checks nothing at all.

**The root cause is one hop further in.** The daemon puts a pass's result in memory, and only the
*next heartbeat tick* writes it to `current.json`. Stopping does not write it (`runOverseer`'s exit
path settles the passes in flight and then writes only a `daemon-stopped` note). So "a pass
finished" and "a pass is on disk" are different events, a timer apart. Every one of these tests
covered that gap with a window instead of naming it.

## Class 2: a dependency's guarantee, asserted in a comment and never checked

`storeRawSource` skipped the read-back after a successful create with the words *"no other writer
can have been in the middle of the same key — that is what create-only means"*. storage-api does not
provide that. The subagent traced it in the local container (storage-api v1.69.11,
`/app/dist/storage/uploader.js`):

- `canUpload` checks a create-only POST by trying the INSERT in a transaction it rolls back. Then
  `completeUpload` upserts. So two writers of one new key can both get 200.
- The second deletes the first's version file inside its transaction, before its own row commits.
  A `get` in that gap reads the committed row, stats a file that is gone, and gets 500.

The Storage container's own log shows exactly this sequence at 23:16:05Z: four HEADs of one key, two
200 POSTs, two 409s, then two 500 GETs on `ENOENT`. A scratch hammer of `storeRawSource` with 16
writers failed 30 of 150 trials unfixed, and 0 of 150 with the fix.

It is harmless for the *bytes*, because the key is their hash. It is not harmless for the *read*,
and the read is what failed. The class: **a property of somebody else's server, stated as fact in
our comment, with nothing anywhere that would notice it being false.**

## Which commits introduced them

- The windows came in with the daemon's pass tests, one stage at a time, each copying the last
  file's `abortAfter`: `b0ef496d` (2026-09-08, the usage timer), `2f849e7b` (2026-09-08, attention),
  `8fbbd686` and `16d14485` (2026-09-09, `onPass` and the history), `313b6bf5` (2026-09-10, the
  reports drain). Only the last one dropped the `if (signal.aborted)` check the others carried.
- The create-only comment is `ef7bd9e8` (2026-08-27, *"Stop believing a dedup hit…"*). The test that
  exposed it, `df7a7980` (2026-09-01, *"The unserialised arm was fast because it was never
  concurrent"*), was written to prove that same path genuinely runs concurrently. It did its job.

## The fixes

- **The windows are gone.** `tests/helpers/overseer-until.ts` has three pieces:
  - `until(what, condition)`: vitest's own `vi.waitFor`, polling for the fact the test asserts, with
    a 20 s deadline whose message names that fact.
  - `tickAfter(root)`: waits for a checkpoint written by a tick that started after the call. This is
    the named gap between "finished" and "on disk".
  - A `heldOpen` that handles an already-aborted signal.

  Negative tests now wait for a counted witness first: five ticks, three slow passes. The
  carry-rule test asserts that its first run landed before relying on it. The fifth file,
  `overseer-store-attention`, had the same windows and had not lost yet, so it got the same fix.

  **Checked:** the four files that failed, pinned to one core with five busy loops, failed 3 of 27
  tests before the fix (the gate's own assertions). After it, all 27 pass, and all 76 in five files
  pass with eight busy loops.
- **The read-back retries a Storage 5xx**, three times over about a second, and nothing else
  (`readBack` in `src/store/blobs.ts`, via a typed `StorageFailed`). A 4xx, a size refusal, `null`
  or a hash mismatch are thrown or refused as before. Red first in `tests/raw-source-store.test.ts`
  with the gate's exact error.

**The long-term fix for class 2 is the same one**, unless storage-api makes a create-only POST
atomic. We cannot change that, and a retry on a read that is only ever idempotent costs nothing. If
hosted Storage turns out to answer these 500s for longer than a second, the retry says so by
throwing the 500 it last saw, rather than hiding it.

## What would have caught the class, ranked by ease against value

1. **Stop on the condition, never on a clock**, stated where people copy from. The helper's header
   says it, and each converted runner points at it. Done. It is the only one that prevents rather
   than detects.
2. **Run a new timing-sensitive test file once under contention before landing it.** Pin it to one
   core alongside a few busy loops
   (`taskset -c 3 node -e 'while(1){}' &` ×5, then `taskset -c 3 npx vitest run <file>`). That took
   seconds, and it reproduced both of the gate's assertions on the first try. Cheap, but it is a
   habit, and habits lapse.
3. **For a dependency's guarantee in a comment, point at the evidence or say it was not checked.**
   `ef7bd9e8`'s sentence reads as settled. *"Create-only, per the API; not verified under concurrent
   writers"* would have been the true sentence and an invitation to check.
4. A lint rule against `setTimeout(() => controller.abort(), …)` in `tests/`: **rejected.** The same
   expression is a legitimate safety cap in `overseer-source.test.ts` (5 s, never the thing
   measured) and a correct "abort at any moment" in `fetch-asset.test.ts`. The tell is what the test
   asserts afterwards, which a pattern cannot see.
5. Fake timers for the daemon: **rejected for these tests.** They exist to prove the real timers,
   the real store and the real file are wired together. Faking the clock would test a daemon that
   is not the one on the box.
