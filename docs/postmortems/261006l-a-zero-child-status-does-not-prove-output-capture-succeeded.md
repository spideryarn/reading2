# A zero child status does not prove output capture succeeded

Code review of `06a035438` found all three new check-order tests red in the review sandbox.
The script printed the correct list when run directly; the test's subprocess capture lost it.
No reader-facing defect was established. The failure prevented the new tests from verifying the
build order in this environment.

## What happened

[`tests/check-steps.test.ts`](../../tests/check-steps.test.ts) spawned
`node --import tsx scripts/check.ts --list` and checked only `run.status === 0` before reading
`run.stdout`. Each case then failed because `steps[0]` was `undefined`.

On Node `v26.8.1`, an independent reproduction using the same pipe-backed `spawnSync` call returned:

```json
{"status":0,"stdout":"","stderr":"","error":{"code":"EPERM","syscall":"spawnSync /usr/bin/node"}}
```

The same child arguments with stdout and stderr attached to ordinary files returned status zero,
no error, and 14 step lines beginning `typecheck`, `build`, `build:fleet`, `test`. This isolates
the transport used to capture the evidence. It does not establish which operating-system call
inside Node produced the restriction.

`git blame 06a035438 -- tests/check-steps.test.ts` assigns the whole new helper to
`06a035438f51c44216f9811d06994fcce49c8c75`, the commit intended to make setup and the check command
build the artifacts read by the suite. An existing sibling,
[`runWrapper`](../../tests/helpers/wrapper-env.ts), already uses file-backed capture and rejects
`result.error` for this sandbox failure mode. Other subprocess tests use status-and-output checks;
those were not investigated or changed by this review.

## The class: child completion mistaken for successful evidence capture

The test collapsed two independent outcomes: whether the child completed successfully and whether
the parent obtained its output. A zero status did not discharge `run.error`. Treating empty
captured output as the program's answer hid the actual failure behind a build-order assertion.
The list's first-line control correctly prevented a false green, but diagnosed the wrong boundary.

## Why the earlier evidence did not expose it

The candidate's reported passing runs proved the check in an environment where this capture worked.
They did not prove that synchronous pipe capture worked in the review sandbox. Running the script
directly also passed because it did not use this parent-side capture path. The runtime's explicit
error was present; the helper ignored it.

## What would have caught it, ranked by ease against value

1. **Reject subprocess errors before interpreting output.** One boundary check exposes the actual
   fault even when status is zero. The stage fix adds this check alongside file-backed capture.
2. **Reuse a capture path already proved in the target environment.** Ordinary file descriptors
   recover the output here without weakening the assertions or changing the command under test.
   Keep the existing timeout and remove the temporary capture files afterwards.
3. **Run the focused subprocess test in the restricted review environment.** Cheap when that
   environment is available; it exposed the original shape before any change.
4. **Skip assertions on `EPERM`, or replace execution with source-text matching** — rejected.
   Either would discard the evidence that the executable list and its ordering actually work.
   A repository-wide subprocess abstraction is also outside this narrow stage; an existing helper
   already supplies the useful pattern.

## The fix that is right for the long term

The review fix changes the test's capture transport and checks `run.error`; the actual list,
ordering checks, and child timeout remain the contract. Child status and evidence transport must
both succeed before output is interpreted. File-backed capture follows the existing helper's
pattern, without changing build behavior. The wider sibling tests remain outside this review's
scope, so the class is closed here rather than asserted closed across the repository.

I would verify the capture boundary before diagnosing the command from an empty answer. The
program's successful exit and the parent's successful observation are separate facts.

Up: [Postmortems](../project/postmortems.md).
