Verdict: Stage 1 is not ready to land as `0fe613bf`. Normal `overseer run` behavior is preserved, but the new state reader has a fail-open path, concurrent updates can silently disappear, and help handling is incomplete.

The working tree changed during this review: uncommitted follow-up work now adds a schema and a separate state lock. I reviewed the requested commit; those changes address parts of P1-2/P1-3 below, but the `null` fail-open and CLI/help findings remain.

## Findings

### P0 — malformed known fields become valid empty state

`tools/overseer/cli-state.ts:135-145`

Both fields use nullish defaulting:

```ts
const rawMine = o["mine"] ?? [];
const rawPaused = o["paused"] ?? [];
```

Therefore all of these are accepted as empty state:

```json
{}
{"mine": null, "paused": null}
{"mine": [], "paused": null}
```

I confirmed `parseCliState({mine:null, paused:null})` returns:

```json
{"kind":"read","state":{"mine":[],"paused":[]}}
```

That contradicts the module’s central guarantee. `runMine list` reports “nothing is being looked after”; `mine add` proceeds through `cliStateForWriting` and replaces the malformed file.

There is also no actual writer that “need not carry both” fields: `writeCliState` receives a complete `CliState` and writes both arrays. The test deliberately accepting `{}` weakens the exact boundary this file says it protects.

Require both keys for schema 1 and distinguish absence with `Object.hasOwn`; explicit `null`, missing required keys, and non-arrays should be `unusable`. If legacy migration is genuinely required, make it an explicit versioned migration rather than `?? []`.

### P1 — concurrent `mine` updates silently lose sessions

`scripts/overseer.ts:1272-1287`, `tools/overseer/cli-state.ts:189-196`

The per-PID temporary path prevents two processes writing the same temporary file. It does not protect the read-modify-write:

1. Both processes read `["a"]`.
2. One adds `b`; one adds `c`.
3. Both atomically rename.
4. The final state is either `["a","b"]` or `["a","c"]`.

Both commands print success. One session is no longer tracked for `tick` or `closeout`. That is precisely the silent-success class this state module is intended to prevent.

Last-writer-wins is not acceptable for this list. Use the existing `takeLock` machinery with a separate short-lived `cli-state.lock`, covering read, edit, and rename. It already uses `O_EXCL`, detects dead holders, and refuses rather than waiting indefinitely. A bounded caller retry is reasonable. An append-only log is unnecessary complexity.

The daemon’s `overseer.lock` is not a problem: it locks one pathname, not the directory. A distinct `cli-state.lock` does not contend with it.

### P1 — there is no schema boundary, so an older CLI can erase future state

`tools/overseer/cli-state.ts:130-152, 189-196`

The prompt’s concern that “a single unrecognised field makes the whole file unusable” is factually reversed: unknown top-level and pause-record fields are silently ignored.

For example:

```json
{
  "mine": ["agent-a"],
  "paused": [],
  "dispatchReservations": ["qi-123"]
}
```

parses successfully. The next `mine add` writes only `mine` and `paused`, deleting `dispatchReservations`.

Add a required schema version and reject versions this build does not understand. Strictness on malformed safety-relevant entries is correct: skipping a bad `mine` or `paused` entry is worse than refusing. Recovery should be a clear diagnostic or repair command, not tolerant data loss.

The uncommitted follow-up’s schema is the right direction, although it still uses `o["schema"] ?? 1`, so explicit `"schema": null` incorrectly passes as schema 1.

### P1 — subcommand help exits 1 as an unknown option

`scripts/overseer.ts:1057-1064, 1178-1221`

The suspected outcome is correct, but the mechanism is slightly different. Because `.helpOption(false)` is inherited when each subcommand is created, `usage --help` does not trigger `commander.helpDisplayed`; it is simply an unknown option.

The exact behavior is:

- exit code: `1`
- stdout: empty
- stderr begins:

```text
✗ error: unknown option '--help'

overseer — the fleet's history, and the daemon that records it
...
```

The same applies to `status --help`, `mine --help`, and `mine add --help`.

If help is re-enabled, `exitOverride` throws a `CommanderError` with `exitCode === 0` and code `commander.helpDisplayed` after writing help. The current catch would still convert that into `{kind:"error"}`, so merely re-enabling the option is insufficient.

Keep stdout and stderr captures separate, inspect `CommanderError.exitCode`/`code`, and return help as help—ideally with the captured subcommand help text.

For current Commander error paths, `written` contains the same error that was thrown, so the fallback does not presently lose a real error. Structurally, however, “any captured output beats the exception” can discard a later thrown message and makes help/error classification impossible.

### P1 — generated help omits a supported spelling

`tools/overseer/cli-help.ts:51-56`, `scripts/overseer.ts:1130-1131`

`mine` is runnable: its default subcommand is `list`, and the parser test proves bare `mine` works. Yet `usageRows` omits the group row, and help only advertises:

```text
mine list
mine add <name>
mine rm <name>
```

This directly contradicts both the requested grammar, `mine [list]`, and the claim that generated help cannot drift from the parser.

Render the default-child spelling, for example:

```text
overseer mine [list]
```

The plan’s fourth “did not know” conclusion—“`mine` is not runnable”—is false.

### P1 — missing `reconcile-jobs --why` lost its safety-specific refusal

`scripts/overseer.ts:1118-1125, 1237-1239`

Previously, an absent reason printed the four-line explanation telling the operator to inspect the log and `gjd-remote ls`. It now prints Commander’s generic:

```text
error: required option '--why <what you checked>' not specified
```

followed by the entire root help. Exit code and stderr remain correct, but the important operational guidance disappeared from the most consequential existing write command.

Map Commander’s `commander.missingMandatoryOptionValue` for this command to the domain-specific refusal, or otherwise preserve that validation at the command seam.

Worse, deleting the `why.trim()` check from `runParsed` leaves the new test suite green: the blank-reason test only confirms that parsing succeeds. The CLI would then clear the scheduler hold with a blank audit reason.

### P2 — timestamp validation does not enforce the type’s stated contract

`tools/overseer/cli-state.ts:68, 103-120, 228-230`

The contract says UTC ISO 8601, but `Date.parse` accepts RFC dates, date-only strings, and offset timestamps. `recordPause` then sorts the original strings lexicographically.

For example, `2026-09-09T09:00:00+02:00` is chronologically earlier than `2026-09-09T08:00:00.000Z`, but string sorting puts it later. “Resume oldest first” can therefore be wrong.

Validate canonical `toISOString()` form or normalize accepted timestamps before storing and sorting. This must be fixed before `paused` gains a consumer.

### P2 — importing the HTTP route is not currently dangerous, but it is the wrong owner

`tools/overseer/cli-state.ts:49`

`routes-rename.ts` currently has no import-time effects; it imports built-ins and the pure `origin.ts`. The `fleet-attention` test restricts the opposite direction—what `tools/fleet` may reach in `tools/overseer`—so this import does not violate that test.

Still, a state-domain module should not depend on an HTTP route merely for a regex. Extract the session-name grammar into a dependency-free leaf used by the route and the CLI. This is architectural cleanup, not a blocker.

## Existing-command behavior audit

The live systemd invocation is bare `overseer run`. That path remains correct:

- `attention === true` and `usage === true` when neither negation is present.
- `--no-attention` and `--no-usage` produce `false`.
- `url` and `tickMs` remain genuinely absent when omitted.
- When attention is enabled but `attentionRunner` returns `null`, the missing `OPENROUTER_API_KEY` message still fires.
- When explicitly disabled, the `--no-attention` message fires instead.

The ordinary valid paths for `status`, `events`, `notes`, `attention`, `usage`, and `reconcile-jobs` otherwise preserve their values and defaults.

The conversion nevertheless did not keep behavior “identical”:

- Unknown flags and excess arguments previously disappeared; now they fail.
- Missing values for `--url`, `--out`, and similar flags previously degraded into defaults/null; now they fail.
- Invalid `--tick-ms` and `--max-calls` previously reached their consumers as `NaN`/bad values; now they fail.
- Repeated valued options used the first occurrence before and the last occurrence now.
- Subcommand `--help` previously got ignored and ran the command; now it fails. It should instead show help.
- Missing `reconcile-jobs --why` lost its specific diagnostic.

Those strictness changes are mostly improvements, but the plan should say “valid invocations preserved; malformed invocations tightened,” not “behavior identical.”

## Output capture

The recursive capture is complete for the command tree as currently built. `configureOutput` merges the supplied writers with Commander’s existing `outputError`; the latter calls the captured `writeErr`. With recursion, nested option errors and `showHelpAfterError` would also be captured. I found no current Commander path from `parseArgv` to the real streams.

The test proves much less:

- Replace the recursion with “configure root and direct children only.” Every tested case still passes, while `mine add --bad` leaks from the grandchild.
- It never exercises a help-output path.
- It combines stdout and stderr, so it cannot detect Commander choosing the wrong channel.
- It does not assert the returned outcomes inside the capture test; a parser that silently accepts those cases could satisfy the “printed nothing” assertion.

Add a nested `mine add` failure and separate spies for each stream.

## Other mutation holes in the tests

Specific mutations that remain green:

- `tests/overseer-cli-state.test.ts:135-144`: change the temp name to `${path}.tmp`. The “carries this process’s pid” test still passes because it only proves the PID path is absent after completion.
- `tests/overseer-cli-parse.test.ts:202-208`: omit only the `mine rm` usage row. Another `mine …` row satisfies the root-command substring assertion.
- `tests/overseer-cli-parse.test.ts:210-222`: delete rendering of `registeredArguments`. No assertion requires `<name>` in `mine add`/`rm`.
- `tests/overseer-cli-parse.test.ts:138-146`: delete the blank-`why` refusal in `runParsed`. The test explicitly expects parsing to succeed and never exercises execution.
- `tests/overseer-cli-state.test.ts:248-253`: move name validation after the state read. The “refused before anything is read” test uses a healthy empty directory and still passes; use an unusable file to distinguish ordering.
- `tests/overseer-cli-state.test.ts:240-246`: remove the unreadable-list `console.error`. It still returns 1 with empty stdout, satisfying every assertion.
- Force parsed `attention.dry` to remain false or ignore a valid `events --limit 2`; there are tests for defaults and invalid values, but not positive wiring for most options.
- In `main`, return 0 for parse errors or print them with `console.log`; all unit tests remain green because none executes the real CLI entry point.

The strongest missing test is a small subprocess matrix asserting exit code, stdout, and stderr for root help, subcommand help, unknown command, missing `--why`, blank `--why`, and one valid read-only command.

## Plan conclusions

Of the four Stage 1 conclusions:

1. `option.mandatory` versus `option.required`: correct.
2. Subcommands copying output configuration at creation: correct.
3. Partly wrong: `--limit 0` did not “select nothing.” `readEventTail` uses `events.slice(-limit)`, and `slice(-0)` is `slice(0)`, so it selected every event. `NaN` likewise removed the bound. The bug is real; its documented direction is wrong.
4. “`mine` is not runnable”: false; it runs the default `list` child.

One broader premise is also currently false: `scripts/gjd-remote.ts` still uses `node:util.parseArgs` and explicitly says it has no argument-parsing dependency. No branch visible in this checkout contains a Commander conversion. Commander remains a defensible choice here, but Stage 1 presently creates two parsers rather than satisfying “one parser in the repo.”

Finally, because systemd runs the primary checkout and `/home/greg/code/spideryarn2/node_modules/commander` is currently absent, the landing/restart procedure must install dependencies in that checkout first. Otherwise the live daemon will crash before argument parsing with `ERR_MODULE_NOT_FOUND`.