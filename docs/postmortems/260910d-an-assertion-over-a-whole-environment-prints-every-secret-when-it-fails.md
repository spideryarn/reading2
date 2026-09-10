# An assertion over a whole environment prints every secret when it fails

On 2026-09-10 a test that was meant to go red did go red, and its failure message was the test
worker's whole environment, real keys included. It happened in Stage 2b of
[260910f](../plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md). The
failure output was an Opus implementation subagent's tool result, which is that subagent's own
context. So the values were sent to the model API and are stored in its transcript on disk. **Nothing
reached a reader, nothing was committed and nothing was pushed.** Whether to rotate is Greg's
decision, and it is with the Overseer. This file names variables only. No value appears in it.

## What happened

The test is in `tests/overseer-launchers.test.ts`:
*"a tmux-headless session carries no account-routing variable into the wrapper"*. It puts a stand-in
`node` where the wrapper would run, and the stand-in writes `env` to a file (`:753`). The test then
has to show that none of the daemon's account-routing variables (`CLAUDE_CONFIG_DIR`,
`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `CODEX_HOME`) reached the session. The house rule is
red first, so the subagent ran the test before the fix, and it failed as intended. The assertion's
subject held the whole environment, so vitest printed all of it.

Among the names in that output were `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`,
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` and `CLAUDE_CODE_MESSAGING_TOKEN` (live). Also there were
`SUPABASE_SERVICE_ROLE_KEY`, which belongs to the local stack (`SUPABASE_URL` is 127.0.0.1), and
`STRIPE_SECRET_KEY`, which is in test mode.

The red version was never committed, and its transcript is not something this write-up may open, so
I cannot quote the first assertion. The fixed version is in `e3bcace3`. It compares **names**
(`:764-770`):

```ts
const present = (name: string): boolean => new RegExp(`^${name}=`, "m").test(seen);
expect(Object.keys(routed).filter(present)).toEqual([]);
```

When that fails it prints something like `["CLAUDE_CONFIG_DIR"]`, and nothing else. The one other
assertion on `seen` is `.toBe(true)` on a boolean, so it cannot print the dump either.

## The class: an assertion over a whole environment prints every value on failure

A matcher's failure message is built from its subject. If the subject is an environment, then the
message is that environment, whether it is an object, a spawn's `env`, or the text of `env` or
`printenv`. And nobody chose to print it. It is a side effect of asking a yes-or-no question about
it.

**Red-first testing makes this worse, not better.** The house rule says a test must be watched to
fail before it counts. For a test like this, that means the first run is **designed** to print the
failure message. The leak is the expected path, not an accident. Every other part of the discipline
held: the test really was red, it went green after the fix, and the fix was right. The rule that
makes a test trustworthy is also what made this one print.

How far each shape leaks, measured for this file under this repo's vitest (4.1.11). I used a
synthetic five-variable object with sentinel values, and a scratch config with no setup files:

| Shape | Values printed on failure |
|---|---|
| `expect(env).toEqual(…)`, `.toStrictEqual(…)` | **every one**: the diff is the whole object, and the diff's truncation default is 0, meaning none |
| `expect(dump).not.toContain("X=")`, `.not.toMatch(/^X=/m)` on the text | **every one**: the "Received" block is the whole string |
| a custom message, `expect(x, JSON.stringify(env))` | **every one** |
| `expect(env).toMatchObject({ X: … })` | the named keys, plus the first property shown in the header (`{ PATH: '/usr/bin', …(4) }`) |
| `expect(env).not.toHaveProperty("X")` | X's value, plus that same header |
| `expect(names.filter(present)).toEqual([])` | names only |

So `toMatchObject` and `toHaveProperty` leak less, but they still leak: the header shows the first
property's value, and nothing decides which variable comes first.

## Why every worker held those keys

**Yes, every vitest worker carries them by default, and that is a contributing cause.** It is not the
only cause.

- **All three lanes load `.env.local` into the worker.** The unit lane does it in
  `tests/setup/unit-no-database.ts:128`, the private lane in `tests/setup/private-db.ts:57` and the
  shared lane in `tests/setup/shared-db.ts:94`. All three have done so since `5aceccfe` (2026-09-04,
  *"npm test stops sharing a database with everybody else's dev server"*). `src/env.ts`
  `loadEnvLocal()` writes every assignment in the file over `process.env`, apart from pinned names.
  The unit lane doesn't need the keys. It loads the file so that its poisons land after the file
  (see that file's header), and it deletes nothing afterwards.
- **Not loading it in setup would not have kept the keys out.** Code under test calls `loadEnvLocal()`
  itself, and so does every wrapper through `scripts/subagent-cli.ts` `loadRepoEnv()`, whose header
  says it *"loads the whole file into this process — every secret this repo owns"*. The setup's call
  only decides when the load happens, because `loadEnvLocal()` runs once per process. Keeping the
  values out of a worker takes an explicit scrub and a pin. Skipping the load is not enough.
- **The test handed the whole environment on, as it should have.** `wrapperEnv()` →
  `accountNeutralEnv()` (`tests/helpers/`, plan 260910d) is `{ ...process.env }` minus the routing
  names. That is correct for a child process, which needs `PATH`, `HOME` and the rest. It also means
  whatever the worker holds reaches the tmux session and ends up in the dump.
- **The house knew this, and wrote it down twice.** `vitest.config.ts:156-158` says that
  `.env.local` *"setup files load and which beats the inherited environment, so its OPENAI_API_KEY and
  CODEX_API_KEY reappear in workers — the same for every runner, so not this class, but not absent
  either."* [testing.md § `.env.local` is loaded into tests](../project/testing.md#envlocal-is-loaded-into-tests)
  says the same. That section also says `vite.config.ts` does the load at config time, which is out
  of date: `vitest.config.ts` is a separate file and does not import `src/env.ts`. The load happens in
  the setup files now.
- **Not every name came from `.env.local`.** `scripts/run-claude.ts:158-159` describes
  `CLAUDE_CODE_MESSAGING_TOKEN` as part of the calling Claude Code session's own plumbing: *"None of
  these is a secret — `CLAUDE_CODE_MESSAGING_TOKEN` is"*. So it most likely reached the worker from
  the subagent's shell, not from the file. I have not checked `.env.local` itself, since this
  write-up may not open it. If that is right, then a fix limited to `.env.local` would still have
  printed a live token. The scrub below has to cover both what the shell passes in and what the
  file adds.

## Which commit introduced it

**No commit.** The leaking assertion existed only in the working tree, for one run. The names-only
form landed in `e3bcace3` (*"The new session-environment test compares variable names only. Its first
red run printed the test worker's environment, keys included"*).

The conditions came from two commits, both of them sound on their own terms:

- `5aceccfe` put `.env.local` into every worker.
- Plan 260910d's `accountNeutralEnv` gave every spawned child a copy of the worker's environment.

**The sibling is older than either.** In `tests/run-codex.test.ts`, *"hands codex an environment with
the other secrets taken out of it"* (`e91671aa`, 2026-08-26) has a stand-in codex run
`env\nenv >&2\nenv > "$out"`. It then asserts on the concatenated output. See below.

## Why nothing went red

- **The run was meant to be red, and nothing checks what a red run prints.** Every gate here asks
  whether a test passed. None asks what its failure message contained.
- **The house's own guards are aimed at the model child, not at the test.** `sanitisedEnv` in
  `scripts/subagent-cli.ts` denies secrets by name at the wrapper boundary. That protects a
  `run-claude`/`run-codex` child. A harness subagent running `npx vitest` in its own Bash tool is on
  the other side of that boundary, and its tool output goes straight into its context.
- **The rule existed, but only in one place.** `src/env.ts`'s own warning line says it prints
  *"Names only, never values. These are secrets"*. That rule lives in that one function and does not
  apply to test assertions.
- **The one test written with this risk in mind has the same shape.** The run-codex test uses
  sentinel values for the secrets it plants. But its assertions are on a string that contains the
  child's whole environment. That covers every variable the denylist lets through, and on this box it
  includes the real `CODEX_API_KEY`.

## Same class, not yet leaked

Found by grepping `tests/` for `expect(…)` over an `env` object, `process.env` or `options.env`, for
stand-ins that run `env`/`printenv`, and for `JSON.stringify` of an environment. **Not fixed here.**

| Site | Shape | What a failure would print |
|---|---|---|
| `tests/run-codex.test.ts:894`, `:895`, `:896` | `expect(everything).not.toContain("…-SENTINEL")`, where `everything` is stdout + stderr + activity log + answer, each holding the child's `env` | the codex child's whole environment: the worker's `{ ...process.env }` (`:831`) minus `sanitisedEnv`'s denylist, plus `CODEX_API_KEY` under `--auth key-first` |
| `tests/run-codex.test.ts:898` | `expect(everything).toContain("PATH=")` | the same, if the stand-in ever fails to dump |
| `tests/run-codex.test.ts:908` | `expect(answer).toContain(envFileValue("CODEX_API_KEY") ?? …)` | **the real key twice over**: the *expected* value is read out of `.env.local` (`:807-819`), and the received value is the dump |

Checked and excluded, because their subject is a synthetic literal rather than a worker's
environment:

- `tests/readiness-loop.test.ts:759-760`: `gitEnv(source)` over `{ KEEP_ME: "yes", … }`.
- `tests/fleet-collect.test.ts:256`: `JSON.stringify(env)` over four literals.
- `tests/claude-accounts.test.ts:222`: a fixture's `settings.json`.

`tests/health.test.ts:513-651` already compares `Object.keys(env)`, which is the right shape.

**What the grep cannot see.** There are 49 `...process.env` spreads in `tests/`. Any test that
asserts on a child's stdout, where that child happens to print its environment, is a member of the
class, and grep cannot tell which ones do. That gap is the argument for item 1 below.

## What would have caught it, ranked by ease against value

1. **Scrub secret-shaped values out of the worker, and pin them, in each lane's setup.** Do this after
   `loadEnvLocal()`. Match names on `KEY|SECRET|TOKEN|PASSWORD`, plus a short named list for the
   exceptions:
   - `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` stay in the database lanes, where they are the
     local stack's.
   - `DATABASE_URL`-shaped values carrying credentials get a named entry.

   Replace each value with a sentinel such as `unit-lane-no-secret`, then add the names to
   `SPIDERYARN_ENV_PINNED`, so that neither a later `loadEnvLocal()` nor a child's can put the real
   value back. Use a sentinel rather than deleting the variable: `unit-no-database.ts`'s header
   explains why deleting the variables was the worse bug for Storage (a *missing* credential picks a
   working fallback). The mechanism exists already, as `PINNED`, the poisons and the `done` flag. This
   is one loop per setup file.

   **It closes every shape at once**: objects, text dumps, custom messages, and a child's stdout,
   including the ones grep cannot see. It also covers the shell's own tokens, which a fix limited to
   `.env.local` would miss.

   Its cost: any test that silently relies on a real key breaks. testing.md already calls that wrong
   (*"Never rely on a variable being unset"*), and a fresh clone has no `.env.local` anyway. The
   `provider-guard` still stops a sentinel key from spending. *Proposed, not built.* Prove it by
   re-running this incident's shape against it, a red assertion over a dump, and grepping the output
   for a value.
2. **A names-only helper, and a static test that refuses the other shape.** The helper would be
   something like `envNames(dumpOrObject, names): string[]` in `tests/helpers/`, which is what
   `e3bcace3` wrote inline. The static test scans `tests/` for `expect(` whose subject is
   `process.env`, a value spread from it, or text read from an `env`/`printenv` stand-in, and fails
   unless the matcher is a name comparison. It needs an allow-list with a reason for each entry, and
   the list may only shrink. On day one that list holds the run-codex rows above. It costs a
   file-walker of the kind `tests/fleet-imports.test.ts` already has. It is syntactic, so it misses
   the stdout case, which is why it ranks below item 1.
3. **A sentence in testing.md's `.env.local` section: "assert names, never an environment's
   values"**, with a link here. It is cheap, and on its own it will not hold
   ([written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)). The section already
   says the keys are in the worker, and that did not help. It is worth having as the failure message
   of item 2, and to fix the stale `vite.config.ts` claim at the same time.
4. **A custom matcher that refuses to diff an object with a `*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*`
   key.** Rejected as the main guard. It covers only the object shape, and two of the three known
   instances are strings: this one's dump, as far as its fix suggests, and run-codex's. Matching on
   names also misses a credential inside a URL. And it has to be *used*, which is the habit that
   failed.
5. **Redacting values with a snapshot serializer registered in setup.** Rejected, and measured:
   `expect.addSnapshotSerializer` does not reach failure diffs in vitest 4.1.11. A serializer matching
   any object with a `KEY` name left the sentinel in both a `toEqual` diff and a `not.toContain`
   "Received" block.
6. **A lint rule.** Rejected. `npm run lint` has a baseline that is not clean, so a lint finding is
   advice, not a gate ([static-analysis.md](../project/static-analysis.md)). And a lint rule cannot
   tell an environment object from any other.
7. **A reporter that scrubs known secret values from failure output.** Rejected. It would have to be
   given the values, which puts the secrets in one more place, and it would not reach a subagent that
   reads vitest's raw stdout.

## The fix that is right for the long term

**What shipped is the right fix for one test.** It is not the design. Names-only comparison makes
this one assertion safe, and nothing else. The run-codex test is still one failure away from printing
a real key. Every future test that spawns with `{ ...process.env }` and reads what the child saw
starts from the same place.

**The design is item 1: a test worker holds no secret it does not need.** Then the question of which
assertions are safe stops mattering, because no failure message can contain a value that is not
there. Beneath that, item 2 makes the names-only shape the one the suite enforces.

Rotation is a separate question, with the Overseer for Greg. By the brief's account the ones that
matter are the live keys: `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`,
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` and `CLAUDE_CODE_MESSAGING_TOKEN`. The local
`SUPABASE_SERVICE_ROLE_KEY` and a test-mode `STRIPE_SECRET_KEY` weigh less.

## The thing I would tell myself

A red-first run is a run whose failure message I have already decided to read, and I have to decide
what is in it before I run it. I would have asked what a toEqual prints on a user object. I did not
ask it of an environment, because I was thinking about the four routing names I cared about and not
the forty I didn't. The failure message is sized by the subject, not by the question. If the subject
is an environment, the answer has to come back as names, and that has to be decided before the first
run. The first run is the one that prints.

---

Up: [postmortems.md](../project/postmortems.md)
