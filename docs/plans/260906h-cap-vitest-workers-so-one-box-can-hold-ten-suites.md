# Cap vitest's workers, so one box can hold ten suites

**Status:** built 2026-09-06.

One `npm test` is well behaved. Ten of them at once is what actually happens on the Hetzner box, and
nothing anywhere told any of them to leave room for the others.

> kill all the running tests on gjd-remote - it's over-subscribed. you may need a patient ssh
>
> And then make a change that will make running tests less resource-intensive, so that this will be
> less of a problem going forwards. Ideally first make the change on the current remote box, and
> then also to the provisioning setup for future boxes.
>
> — Greg, 2026-09-06

## What it looked like

Measured on the box at 17:55 on 2026-09-06, before anything was killed:

| | |
| --- | --- |
| load average | **142.58** (16 cores) |
| vitest fork workers | **76**, from 8 concurrent `vitest run` invocations |
| worktrees running a suite | 7 — `changelog-page` (two runs), `extraction-stage-c`, `sweep-four`, `shelf-table-looks`, `spine-concentric`, `critiques-mode`, `delete-store-flag` |
| memory | 28 of 30 GB used, **2 GB available** |
| heaviest single fork | 2.5 GB RSS |

Killing the vitest processes took the load to 55 within a minute and gave 18 GB back. Another agent
had started a fresh full-suite run before I finished checking, which is the point: **this is a
steady state, not an incident.** Nothing was wrong with any individual run.

The mechanism is vitest's default worker count, `availableParallelism() - 1`
(`getDefaultThreadsCount` in vitest 4.1.11) — **15 forks per run on this box**, decided by each run
in ignorance of every other. It is the same shape as the failure `infra/hetzner/provision.sh`
already guards against for MCP servers, in its own words:

> N sessions x M servers spawns node processes with no memory cap each, which is the documented way
> this box dies (anthropics/claude-code#45880, closed "not planned").

The cost is not only that the box is unpleasant. `vitest.config.ts` already carries a 30s timeout
"**because this box is never idle**", raised after a `npm run check` came back with seven failures
of which six were contention and one was real — and the six hid the one for a whole extra pass. A
suite thrashing against 75 sibling processes is manufacturing exactly those.

## The change

**1. A default cap in `vitest.config.ts`: half the machine's cores, floor of 2.**

The config file is the one choke point *every* invocation passes through — `npm test`, `npm run
check`, a bare `npx vitest run tests/foo.test.ts` typed by an agent, a run inside `scripts/run-codex.ts`.
Anything that wraps `npm test` instead would miss the direct invocations, and the box had several.

**2. `VITEST_MAX_WORKERS` becomes a knob we own, and is taken away from vitest.** See the trap
below — this half is not optional, and it is the reason the change needed a test.

**3. The box says it is crowded, in `~/.config/spideryarn/vitest-max-workers`**, which
`infra/hetzner/provision.sh` writes with `3` and then verifies. A per-run cap cannot see the other
runs; the machine knows how many neighbours it has and the config file never will. Written to the
running box as well as to provisioning, so it does not wait for a rebuild.

### That was going to be an environment variable, and the environment variable does not arrive

The obvious home was the `env` block of `~/.claude/settings.json` — provisioning already writes that
file, for `CLAUDE_CODE_SCROLL_SPEED`, and "environment variables applied to every session" is what
the block is for. It was written, and then checked rather than assumed. Measured on the box, through
a fresh session (`scripts/run-claude.ts`, which filters the child's environment by denylist but
keeps `HOME` and drops `CLAUDE_CONFIG_DIR`, so the child reads the same settings file):

```
printenv VITEST_MAX_WORKERS        -> exit 1, no output   (tool call confirmed executed, not denied)
printenv CLAUDE_CODE_SCROLL_SPEED  -> exit 1, no output
```

The second line is the one that settles it: that variable has been in that block since the box was
built. **Nothing in `env` reaches a Bash tool call.** A knob set that way looks configured, is inert,
and reports nothing — and the first probe's `NOTHING` could just as easily have been a denied tool
call, which is why the transcript was read rather than the answer believed.

So the machine layer is a file the config reads. It has no propagation semantics to be wrong about:
cron, tmux, ssh and every shell see the same number. The settings.json key was removed from the box
again, so that nothing is left looking like a setting that isn't one.

### The trap, which is why this has a test and not just a comment

Vitest reads `VITEST_MAX_WORKERS` itself, in `resolveConfig` — and does it **after** the line that
turns `fileParallelism: false` into `maxWorkers: 1`, for every project:

```
resolved.maxWorkers = 1                                    // offset 11351, from fileParallelism: false
if (process.env.VITEST_MAX_WORKERS) resolved.maxWorkers =  // offset 20757
  Number.parseInt(process.env.VITEST_MAX_WORKERS)
```

So setting it **de-serialises the private-postgres lane**, which is serialised on purpose because
its files share one database and one job-queue singleton
([260903e](260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md)). A flag that
means "use less of this machine" silently changes *what the suite tests*, and buys back the
nondeterministic red that plan was written to remove.

Reproduced directly, in 15ms, before any of this was built:

```
{ fileParallelism: false, maxWorkers: 1 }  ->  1     # no env
{ fileParallelism: false, maxWorkers: 1 }  ->  4     # VITEST_MAX_WORKERS=4
```

This is not hypothetical. [260906f](260906f-repair-realtime-chat-final-validation.md) records
`VITEST_MAX_WORKERS=4 npm run check` run twice as a "reduced-contention full gate" — the right
instinct, on a knob that also quietly turned the database lane parallel.

`resolveParallelWorkers()` therefore reads the variable and `delete`s it, which is the only lever a
config file has: everything vitest does with it happens later.
`tests/vitest-worker-caps.test.ts` pins **vitest's** behaviour as well as ours, so a version that
fixes the ordering upstream turns red here rather than leaving a defence nobody dares delete.

## What it costs, measured

The unit lane (612 files, the only lane the cap touches — the private lane is serial already and
`shared-services` is four files), on an 18-core Mac, one run at a time:

| workers | wall | vs default |
| --- | --- | --- |
| 17 (vitest's default) | 79.9s | — |
| 9 (half — the new default) | ~109s, measured at 8 | +37% |
| 4 (a quarter) | 171.1s | +114% |

Identical results at every setting: `2 failed | 609 passed | 1 skipped`, the two failures
pre-existing and unrelated to any of this.

Note the shape: 4.25× the workers buys 2.1× the wall time, because `import` and `transform`
dominate rather than cores. **Parallelism past a handful of workers is already poor value in this
suite**, which is what makes a cap cheap at all.

**Half rather than a quarter, on GPT Sol's argument.** A quarter more than doubles a solo run;
half costs 37% for most of the protection, and the machine file is where a genuinely crowded machine
states its own number rather than having one guessed for it by a rule that has to be right
everywhere. Sol's counter to itself is worth keeping: eight steady-state runs at three workers is
still 24 forks on 16 cores. This is a cap, not a bound — see "the simpler options passed over".
Anyone who wants one run fast on an idle machine can say `VITEST_MAX_WORKERS=8 npm test`, and after
this change that is a safe thing to type.

## The simpler options passed over

- **Keep killing runs by hand.** What Greg asked for first, and it works — load 142 to 55 in a
  minute. It is not a change, it needs a human to notice, and the box was oversubscribed again
  within a minute of the kill.
- **A machine-wide semaphore: `flock`, N test runs at a time.** This is the only mechanism that
  bounds the *total*, and it remains the right next lever if capping is not enough. Not first,
  because it can only live at an entry point everyone agrees to use — and the box's evidence is that
  agents run `npx vitest run <files>` directly — and because a waiting run is indistinguishable from
  a hung one, so a wedged holder stalls everybody. A cap degrades; a lock blocks.
- **A per-fork memory cap (`NODE_OPTIONS=--max-old-space-size`), like the MCP servers get.** Treats
  the RAM and not the CPU, and the heaviest fork here was doing real work — an OOM kill would be a
  red test rather than a slow one.
- **Setting the number only on the box, leaving the repo default alone.** Cheapest, but every other
  machine that ever runs several agents has the same problem, and a default of "take the whole
  machine" is wrong everywhere; the box's own number is then a small override rather than the only
  defence.

## What the review changed

[GPT Sol's review](260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites-review-sol.md) returned
"request changes" and was right twice. Both defects were invisible to the tests as first written,
because those read the config *object* rather than what vitest resolves from it — which is the third
finding, and the reason the other two existed.

1. **`--maxWorkers` was being silently swallowed.** The cap was in the block shared by the three
   projects, and vitest prefers a project's `maxWorkers` over the global one — so the ordinary
   `vitest --maxWorkers=8` escape hatch did nothing. Moved to the config root, where the parallel
   lanes fall back to it and a CLI flag still wins. Confirmed by resolving the real config:
   `unit`/`shared-services` end up with no project-level cap at all, and `private-postgres` keeps
   its 1.
2. **A watch-mode restart lost the override.** Vite re-evaluates the config on every edit, and by
   then the variable had been consumed and deleted — Sol measured `unit=8` before a restart and
   `unit=4` after. The consumed value is now kept on `globalThis` (not in a second environment
   variable, which every child process would inherit).
3. **An unreadable machine file no longer shrugs.** Only `ENOENT` is silent; a file that exists and
   cannot be read is a machine whose stated policy is not being applied.
4. Documentation drift: the plan still described the settings.json mechanism that had already been
   abandoned, and the incident was restated in four places. Fixed, and the config comment cut to a
   rationale plus links.

Both new tests were mutation-checked: putting the cap back on the projects reddens the
`--maxWorkers` test, and dropping the carrier reddens the restart test.

Sol also argued the default should be **half** the cores rather than a quarter — a quarter more than
doubles a solo run for protection the machine file already provides where it is actually needed.
Taken; see the measurements above.

### And what the second review changed

[The second pass](260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites-review-2-sol.md)
confirmed the root placement holds for every invocation shape, and found three more things.

1. **The restart fix was worse than the bug, so it went.** A config file cannot tell a watch restart
   from a second vitest in the same process, so remembering the override on `globalThis` leaked it
   into instances that never asked: Sol measured `unit=7` in an instance started with no override at
   all. Both mistakes cost the same thing — a run faster or slower than asked — and **neither can
   reach the serial lane**, which names its own `maxWorkers: 1`. So the carrier is gone, watch mode
   forgets an override on the first restart, and a test now pins the absence of the leak. The
   simpler wrong thing beats the more complicated wrong thing.
2. **The provisioning test proved nothing.** It accepted any digits and then checked those same
   digits parsed, so changing provisioning to `99` left it green. It now requires the number
   provisioning writes and the number its own verify block greps for to be the same, and to be a
   plausible cap. Mutation-checked by setting the write to `99`.
3. Small honesty repairs: the error message still said "quarter", the temp directory was never
   removed, this file called a two-failure run "green", and the test header claimed nothing read the
   real machine file when resolving the config necessarily does.

## Verification

- `tests/vitest-worker-caps.test.ts`, 20 tests: vitest's own behaviour, the deletion, the serial lane
  staying serial with `VITEST_MAX_WORKERS=6` set (the end-to-end version), `--maxWorkers` still
  winning, an override surviving a re-evaluation, the three layers and their precedence, a bad value
  in either refused rather than guessed at, and `provision.sh` read to confirm it writes the path
  this config reads.
- Fork count watched live during a full `npm test`: 4 workers under a cap of 4, against 15 uncapped.
- Full suite: `753 passed`, with two files red — `pdf-bundle-trace` and `cold-start-lazy-imports`,
  both of which assert `api-dist/vercel.js is missing — run npm run build` in a worktree that has
  never been built. Both were red before this change too. Not green, and not this change's.
- The box: settings.json probed through a fresh Claude session and the transcript read (not the
  answer believed), which is how the inert mechanism was caught; then the file written and the
  provisioning check run against it by hand.
