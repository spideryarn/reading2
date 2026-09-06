# Review prompt: cap vitest's workers

You are reviewing a small change to a TypeScript/ESM repo (Spideryarn). Be adversarial and concrete.
Some of your findings will be wrong and I will check each one; say which you are confident about.

## The problem

Ten-plus git worktrees share one 16-core Hetzner box, each with its own Claude Code agent, and each
agent runs `npm test` whenever it likes. Vitest's default worker count is `availableParallelism() - 1`,
decided per run in ignorance of every other run. Measured on the box on 2026-09-06 before anything
was changed: 8 concurrent `vitest run` invocations, **76 fork workers on 16 cores**, load average
142.58, 2 of 30 GB available. Killing the vitest processes took load to 55 within a minute; another
agent started a fresh full-suite run before I finished looking, so this is a steady state and not an
incident.

## The change

1. `vitest.config.ts` resolves a worker cap in three layers — `VITEST_MAX_WORKERS` (this run), then
   `~/.config/spideryarn/vitest-max-workers` (this machine), then a quarter of the cores — and puts
   it in the config shared by all three test projects. The serial `private-postgres` lane overrides
   it back to 1.
2. It **deletes `VITEST_MAX_WORKERS` from `process.env`** after reading it. Vitest reads that
   variable itself, in `resolveConfig`, *after* the line that turns `fileParallelism: false` into
   `maxWorkers: 1`, and does it for every project — so leaving it set de-serialises the
   `private-postgres` lane, whose files share one database and one job-queue singleton and which is
   serial deliberately. Reproduced directly: `{fileParallelism: false, maxWorkers: 1}` resolves to 1
   with no env and to 4 with `VITEST_MAX_WORKERS=4`.
3. `infra/hetzner/provision.sh` writes `3` to that machine file, and checks it.
4. `tests/vitest-worker-caps.test.ts` covers both, including pinning vitest's own behaviour.

## Evidence already gathered

Unit lane, 612 files, 18-core Mac, one run at a time, identical results at every setting
(`2 failed | 609 passed | 1 skipped`, the two failures pre-existing):

| workers | wall |
| --- | --- |
| 17 (vitest default) | 79.9s |
| 8 | 109.4s |
| 4 (the new default here) | 171.1s |

The machine-wide knob was **first** written into the `env` block of `~/.claude/settings.json`, which
`provision.sh` already maintains. Measured on the box: a variable set there is not present in the
environment of a Claude Code Bash tool call — and neither is `CLAUDE_CODE_SCROLL_SPEED`, which has
been in that block since the box was built (`printenv` exit 1, tool call confirmed executed in the
transcript, not denied). That is why the machine layer is a file the config reads rather than an
environment variable. Note the probe ran through `scripts/run-claude.ts` (`claude -p`), which passes
a denylist-filtered environment but preserves `HOME` and drops `CLAUDE_CONFIG_DIR`, so the child read
the same settings file.

Mutation-checked: removing the `delete` reddens exactly the test that claims it; changing the cap
value reddens three.

## What I want from you

1. **Correctness of the deletion.** Is `delete process.env.VITEST_MAX_WORKERS` inside the config
   module reliable in vitest 4.1.11 — is the config module evaluated before `resolveConfig`, exactly
   once, in the same process? If it can be evaluated more than once, the two parallel lanes could get
   different caps, which vitest rejects with a hard error ("Multiple projects with different
   maxWorkers but same groupOrder"). Is that reachable? Should the value be memoised, and does
   memoising break the test's ability to vary the environment?
2. **Does the cap actually apply?** `maxWorkers` is set in the object spread into all three projects.
   Confirm it reaches the forks pool for `unit` and `shared-services`, and that `private-postgres`
   still runs one file at a time. Point at the vitest code path.
3. **Is the default right?** A quarter of the cores costs a solo unit-lane run 91s. Argue for half
   (or another rule) if you think the arithmetic favours it — note the measured curve is strongly
   sublinear, and the box additionally sets 3.
4. **The machine-file layer.** Is `~/.config/spideryarn/vitest-max-workers` a reasonable mechanism?
   Failure modes: an unreadable file falls through to the default; a file with rubbish in it throws.
   Is that the right way round? Should XDG_CONFIG_HOME be honoured?
5. **Anything the tests claim but do not check**, and any assertion that would pass for the wrong
   reason or is machine-dependent (this suite runs on both an 18-core Mac and a 16-core Linux box,
   only one of which has the machine file).
6. Anything else that is wrong, over-built, or would surprise the next reader.

## The diff

Attached: `260906h.diff` (`vitest.config.ts`, `infra/hetzner/provision.sh`, `docs/project/testing.md`)
plus the new test file `tests/vitest-worker-caps.test.ts` and the plan
`docs/plans/260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md`, all in the repo.
