# Argument refusal depends on unrelated runtime configuration

Review caught this before landing. In `scripts/stage.ts`, `ingest --froce` with
Storage credentials absent reported a Storage boot error instead of the unknown flag.
The parser had already refused the arguments, but the caller loaded the server graph
before printing that refusal.

## Root cause and class

**A pure refusal still depends on unrelated runtime configuration.** Extracting a
pure parser is insufficient when its caller starts the runtime before using the
answer. The new CLI tests inherited the unit lane's credentials and `VITEST` guard,
which suppresses the production boot check, so they did not cover this dependency.

Commit `616208526` introduced the parser and the promise that malformed arguments
are refused before environment loading. It retained the earlier CLI's eager boot
dependency to obtain `STEP_ORDER` for usage. The ordering already has a leaf home,
[`src/step-order.ts`](../../src/step-order.ts), which the pipeline re-exports.

## Fix and evidence

Import `STEP_ORDER` from its leaf and call `loadRuntime()` only after `parsed.ok`.
This is also the long-term fix: usage needs step names, not the pipeline runtime.
The remaining typed runtime bindings are filled before any valid command runs.

The new case in [`tests/stage-argv.test.ts`](../../tests/stage-argv.test.ts) was red
against the candidate: `NODE_ENV=production`, an empty `VITEST`, and pinned empty
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` produced `no Supabase Storage configured`
and omitted `--froce`. After the fix, the same command run directly prints the flag
refusal and full usage, with exit 1. A subsequent test run could not validate its
spawned CLI cases because this review sandbox returned `spawnSync /usr/bin/node
EPERM`; that restriction also prevented the existing fake-MCP subprocess tests.
The pure argv cases passed. This records the limit rather than calling that run green.

## What would have caught it, ranked by ease against value

1. **One CLI case without runtime credentials or the test boot bypass** — added;
   proves a refusal does not borrow a configured developer machine.
2. **Read boot ordering at the caller, as well as parser unit tests** — cheap and
   catches the class wherever a pure helper is introduced inside an eager entrypoint.
3. **A runtime dependency-injection framework for every script** — rejected; a
   leaf import and moving one call close this case without another execution path.

Up: [Postmortems](../project/postmortems.md)
