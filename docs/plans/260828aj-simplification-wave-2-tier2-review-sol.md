Verdict: **revise the 2.5 gate; leave the production migrations in place.** `collectCitations`, `useStepJob`, the three current `stageCli` tails, and ordinary `isMain` behavior are sound as committed. The AST gate gives a false guarantee: I executed its committed detector functions against adversarial sources and confirmed they return `null` for unsafe code.

## Findings

1. **Medium — the new-tail gate confuses syntactic presence with execution.**

   [tests/paid-cli-ledger.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/paid-cli-ledger.test.ts:861) accepts this reversed helper:

   ```ts
   if (isMain(entry)) return;
   loadEnvLocal();
   await withLedger("cli", main);
   ```

   `callsWith` sees `isMain(entry)` but never checks the negation. Direct execution silently does nothing; importing the module runs it.

   The caller branch also accepts an unreachable tail plus an indirect unmetered call:

   ```ts
   async function leak() { await main(); }
   await leak();
   if (false) await stageCli(import.meta.url, main);
   ```

   `executedCalls` finds `stageCli` inside the dead branch, while the walker deliberately skips `leak`’s function body. The exact committed `ledgerOffence` returned `null`.

   It similarly accepts `if (false) await withLedger("cli", main)` inside `stageCli`, and does not require the wrapper to be awaited.

   **Fix the detector; do not revert `stageCli`.** Require the actual top-level tail shape, check the guard’s polarity and unconditional exit, and add these exact counterexamples as red controls.

2. **Low — dispatch authenticates a basename, not the helper module.**

   `importedLocalName` uses `spec.endsWith("/cli-ledger.js")`. Therefore:

   ```ts
   import { stageCli } from "./fake/cli-ledger.js";
   async function main() { /* paid call */ }
   await stageCli(import.meta.url, main);
   ```

   passes even if that fake helper simply calls `main()` bare. The exact detector returned `null`.

   For the listed `src/` CLIs, require `./cli-ledger.js` exactly, or resolve and compare the imported module path.

## The eight answers

1. **The `.env.local` ordering argument holds for the committed files, with one scope correction.** Only `labels`, `pdf-read`, and `tweets` moved onto `stageCli`; the other fifteen only changed their guard to `isMain`. All runtime module statements execute before the bottom tail. The export declarations after the guard in two evals have no runtime effect.

   In each of the three paid files, the old code before `loadEnvLocal()` only reads and validates `process.argv`; nothing reads environment configuration. Invalid invocations now read `.env.local` before printing usage, but that is harmless behavior drift. I found no file where configuration is frozen too early.

2. **The requested dispatch cases:**

   - Unused genuine import: rejected.
   - Both exact tails present: rejected because the old tail reaches `main` outside the accepted `stageCli` argument.
   - Re-export only: does not select the new branch; rejected without a valid legacy tail.
   - Aliased static import: recognized and accepted correctly.
   - Dynamic import: ignored; new-tail-only form is rejected.
   - Import from a differently named helper: rejected.
   - Import from another module also named `cli-ledger.js`: **accepted incorrectly**.
   - Genuine import in a dead branch plus indirect `main()` execution: **accepted incorrectly and can spend outside the ledger**.

3. **No, `stageCliOffence` does not enforce “guard, then env, then wrapper” semantically.** It enforces approximate AST positions:

   - It does not check `!isMain(entry)`.
   - Any nested `return` makes `leaves` true.
   - An unconditional return between guard and env passes.
   - A wrapper in `if (false)` passes.
   - A non-awaited wrapper passes.
   - A helper closure can hide a bare `main()` call from the walker.

   This is the main confirmed defect.

4. **`isMain` can produce a false positive, but only under unusual module-identity settings.** With `--preserve-symlinks-main`, a symlinked entry and its real target can exist as distinct ESM instances. If the target is imported separately, both paths realpath to the same file and the imported instance answers true. None of this repository’s package scripts enables that flag.

   Ordinary direct starts return before filesystem access. A mismatch performs two synchronous `realpathSync` calls per `isMain` invocation—not merely “two stat calls once per process.” An imported collection of guarded modules can therefore perform several. On cold NFS or a deep symlink chain, resolution blocks startup and may require multiple path lookups; there is no honest millisecond estimate without that filesystem. I would leave it unless preserved-symlink module identity is supported deliberately.

5. **Each surface gets its own `lastFailure` ref.** It is created inside each `useJobs()` invocation. StrictMode, concurrent rendering, or two mounted surfaces do not share it. The module-scoped `driving` set is shared, but failure state is not.

6. **Citation accumulation is unchanged.** `converse` creates one `Map` above the round loop and drains it once at completion. A round-one URL remains present in round two, so the first title still wins and the second sighting is ignored. `explain` has one map for its single stream, as before.

   The missing converse integration test is worth adding before the remaining stream refactor because its unique assertion is cross-round persistence. It does not block or justify reverting this extraction.

7. **I found no lasting new state error from the collapse.** A second press leaves the previous failure visible while its POST is pending, but the old boolean did the same. Concurrent presses resolve by completion order; once a job is visible the buttons are disabled, and an earlier double press is deduplicated server-side. A post-unmount continuation may still call setters, but the old implementation did too.

   The single `lastFailure` ref is not a transaction identifier: another overlapping action can overwrite it between `await queue.run()` and `lastFailure()`. That coupling already existed more severely through `queue.error`; I could not confirm a new user-visible regression from the available surfaces. **Leave it.**

8. **Weakest commit-message claim:** `a547ca3`’s statement that the gate checks “the guard, then the env read, then the wrapper, by position and not by presence.” It checks positions of matching syntax, but not guard direction, reachability, or awaiting. Second weakest is the `isMain` comment’s “two stat calls once per process.”

I made no edits and did not use the moving tree’s red full-suite result as evidence.