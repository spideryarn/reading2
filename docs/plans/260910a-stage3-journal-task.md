# Task: Stage 3 — the refusal journal

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility` (a linked git worktree),
branch `worktree-admission-visibility`. TypeScript + ESM, `tsx`, vitest. Node 22.

**Read first:**

1. `docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md` — **§6 and §6b
   are this stage's contract**, and §6 explains why a scan of tmux-job logs was measured and
   rejected. Read both "Review dispositions" sections; they record F1–F35 and the words that are
   banned.
2. `vitest-admission.ts` (the gate, **unchanged**) and `vitest.config.ts` § `workersForThisRun` —
   the first writer.
3. `tools/fleet/readiness-loop.ts` § `decideTick` and `scripts/readiness-loop.ts` at its consumer —
   the second writer.
4. `tools/fleet/health-history.ts` — **for its ideas, not its code**: the two-file rotation and the
   "absence is a stated arm" discipline. It has a single-writer lock; this journal deliberately has
   many writers and none.
5. `docs/reusable/silent-success.md`.

## Why this exists, in one paragraph

A refusal today is thrown into the stdout of the run that was refused and nowhere else. The plan
first claimed no refusal is durably recorded anywhere; that was **false** — one survives in full at
`logs/tmux-jobs/grfd-check3-0934-2389191.log:80` because `tmux-job.ts` opens its log before running
the command. But those traces are incomplete and are not an API: the one known refusal sits at line
80 of an 800 KB file, so neither a head nor a tail scan reliably finds one, and a scanner that
sometimes misses says *"no recent refusals"* in the same words as one that looked properly. So we
write a journal instead. The Overseer authorised widening the file set for it on 2026-09-10.

## What to build

### `admission-journal.ts` — a new module at the repo root, beside the gate

**No imports but node builtins, ever.** One of its callers is `vitest.config.ts`, evaluated at the
start of every test run in this repo; a config that reached into `tools/fleet/` would drag the
dashboard into every suite's startup. This is the same discipline `tools/fleet/overseer-claim.ts`
and `attempt-clock.ts` keep, and here it is forced rather than chosen.

Three exported pieces:

- **`recordRefusal(entry, options?)`** — append one line. Rules, each of which is load-bearing:
  - **It may never throw and may never block.** A refusal is already a bad moment; a journal that
    threw would turn "your test run was refused" into "your test run crashed in the config". Wrap
    everything, swallow everything, and return whether it wrote so a caller *may* know but need not.
  - **One `appendFileSync` of at most 1 KiB with `O_APPEND`.** That is the entire concurrency story:
    Linux makes an append below `PIPE_BUF` (4096 bytes) atomic, so many writers need no lock. If the
    serialised line would exceed the cap, **refuse to write it rather than truncate** — a truncated
    JSON line is an unparseable line, and unparseable lines are what the reader has to count.
  - Fixed small fields only: `at` (ISO), `source` (`"test-run" | "readiness-precheck"`),
    `policyVersion`, `availableBytes`, `reserveBytes`, swap totals, `pid`, `host`. **Not the gate's
    message** — it is reconstructible from those numbers, and an unbounded string is how a bounded
    file stops being bounded.
- **`readRefusals(options?)`** — read the live file and the rotated one, oldest first, returning a
  discriminated result: entries, plus a count of unparseable lines (**counted, never hidden**), or a
  stated arm for *the directory does not exist* versus *it could not be read*. Those are different
  facts and the panel says which.
- **`pruneRefusals(options?)`** — the reader's job, not the writers'. When the live file passes its
  cap, rename it to the `.prev` name. **Rename, never rewrite**: an appender opens by path each
  time, so it either wrote into the old inode (still read as `.prev`) or into the new file, and no
  line is lost. A rewrite would drop any append that landed between read and write.

Default directory `~/.fleet-admission/`, overridable for tests.

### The three writer edits — one line each, and nothing else

| File | The edit |
|---|---|
| `vitest.config.ts` | in `workersForThisRun()`, one `recordRefusal(...)` immediately before the existing `throw` on `decision.kind === "refuse"` |
| `tools/fleet/readiness-loop.ts` | `TickDecision`'s skip arm gains an **optional** `cause` field, set to a memory-admission marker at the admission branch. No behaviour change; nothing else reads it yet |
| `scripts/readiness-loop.ts` | one `recordRefusal(...)` at the existing consumer of `decideTick`, when the skip's `cause` is that marker |

The `cause` discriminator exists because `TickDecision`'s skip arm carries only `why`, so a consumer
could otherwise tell an admission refusal from the other twelve skips only by matching prose — a
check that goes quietly wrong the day somebody rewords a sentence.

### The route and the panel

Add the journal's reading to the existing `/api/admission` answer as its own top-level field with its
own arms, and a block on `AdmissionSection.tsx` under the forecast. **The panel's sentence when the
journal is empty must be "nothing was recorded", never "nothing was refused"** — a weaker claim, and
the true one. Also say, on the page, what the journal cannot see: refusals from test runs using this
repo's vitest config on this machine and from the readiness loop, and nothing else — not another
machine, not a run that bypassed the config, not an append that failed.

Reading the journal is a small bounded file read; it may stay on the request path, but **say in your
answer what you measured it at.**

## The tests — red first, every one

Put them in `tests/admission-journal.test.ts` and extend the existing admission tests for the route
and panel arms.

1. Two processes appending concurrently lose nothing. Drive real concurrent appends (child processes
   or many interleaved sync appends) rather than asserting the property in prose.
2. A line that would exceed the cap is refused, not truncated; the file stays parseable.
3. An append that throws — unwritable directory — does not propagate, and **the caller's refusal
   still reaches its own caller unchanged**. Test this at `vitest.config.ts`'s shape, not only at
   the journal's.
4. A prune between two appends loses no line: append, prune, append, read, expect both.
5. Unparseable lines are counted and the readable ones still returned.
6. *Directory absent* and *directory unreadable* are different arms, and neither is an empty list.
7. **An empty journal renders as "nothing was recorded", and the rendered text does not contain
   "nothing was refused"** or any equivalent claim about the box.
8. A comment-stripped source guard on the `vitest.config.ts` call — **comment the call out and watch
   the guard go red before relying on it**.
9. The readiness path: a skip whose `cause` is the marker records; the other skip reasons do not.

## What you may and may not touch

In scope: `admission-journal.ts` (new), `vitest.config.ts` (one call),
`tools/fleet/readiness-loop.ts` (one optional field + one assignment), `scripts/readiness-loop.ts`
(one call), `tools/fleet/routes-admission.ts`, `tools/fleet/admission-wiring.ts`,
`tools/fleet/wire.ts` (types only, appended), `tools/fleet/web/src/admission-client.ts`,
`tools/fleet/web/src/AdmissionSection.tsx`, and tests.

**Do not touch** `vitest-admission.ts`, `tools/fleet/collect.ts`, `routes-actions.ts`,
`routes-new.ts`, `health*.ts`, `actions.ts`, `tools/overseer/`, `scripts/gjd-remote.ts`,
`scripts/claude-accounts.ts`, or any readiness file beyond the two lines named above. **Do not
commit.** **Do not touch the dashboard on :8787.**

**A warning specific to this stage: you are editing `vitest.config.ts`, which every test run in this
repo evaluates.** A mistake there does not fail one suite, it fails all of them, for every agent on
this box. Keep the edit to the single call, and run the focused suites afterwards to prove the
config still evaluates.

## Running things

- `npx vitest run tests/admission-journal.test.ts tests/fleet-admission-explain.test.ts tests/fleet-admission-route.test.ts tests/fleet-admission-panel.test.tsx`
- Typecheck via `node --import tsx scripts/typecheck.ts` — judge by exit code. The literal
  `npm run typecheck` fails in this sandbox on the tsx IPC socket.
- Do **not** run the full `npm test`; I run it.

## At the end

List every file changed, what each test failed with before it passed, what you measured the
journal read at, and anything in the stage you could not implement.
