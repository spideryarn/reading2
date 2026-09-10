# Stage C task: the daemon, the drill, the page, the docs

You are implementing Stage C of `docs/plans/260910f-scheduled-dispatch-one-durable-occurrence-one-reconciled-launch.md`
in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/scheduled-dispatch`.

Read these first:
- the whole plan, with its "Review dispositions" section overriding D1–D8;
- the Stage B brief (`…-stageB-task.md`) and what Stage B built;
- the launch protocol's Stage 3 as merged from dev: its daemon composition, the named
  `LaunchProtocol` value it composes, `protocol.view()`, `scripts/overseer-launches.ts`, and
  `scripts/launch-protocol-drill.ts`, whose patterns you copy;
- `tools/overseer/launch-gate.ts`.

## What this stage is for

This stage makes the scheduled path live in the one process that owns it, while it stays **disarmed**:
- the daemon hands the protocol to the tick;
- it computes the launch gate once per tick;
- it writes `occurrences.json` at every checkpoint.

It also proves the acceptance paragraph end to end, on scratch infrastructure only.

## The pieces

1. **`tools/overseer/daemon.ts`.** Small, targeted edits only. Another session owns the usage pass,
   so re-read each region immediately before you edit it, and never rewrite a region.
   - Pass the composed protocol's `launchOccurrence` / `resumeOccurrence` / `abandon` / `view` into
     `schedulerTick`. That replaces Stage B's "Stage C wires this" placeholders.
   - Compute the **`AccountChoice`** once per tick (plan § dispositions, M11: a scheduled session
     runs on a Claude pool account the scheduler chooses, never the daemon's own).
     1. Read the account registry (`readAccountRegistry` in `tools/overseer/accounts.ts`).
     2. Keep the Claude-family pool accounts only; never the orchestrator, never the default
        `.claude`.
     3. Take the first account in registry order for which
        `bothGates(healthGate(<latest admitted snapshot's health>, "clear"),
        accountQuotaGate(<that account's section of the daemon's accountUsage>, nowMs, "clear",
        30 * 60_000))` answers clear. That gives `{ kind: "chosen", account, notes }`.
     4. If no account is clear, the answer is `{ kind: "held", why, until }`, carrying every
        account's reason and the earliest `until`.
     - **Read the same two values the recovery resume pass already reads, so both launch paths
       gate on one piece of evidence:**
       - health: `accepted?.snapshot.health` (`daemon.ts` ~1123);
       - account usage: the daemon's own `accountUsage` variable (`daemon.ts` ~896, refreshed by
         the usage pass at ~1418).

       Line numbers are as of a866b2e4, so re-read them. The usage pass belongs to another
       session: read its result, never edit its code.
     5. Hand it to the planner and put its notes in the tick's log line.
   - A resume checks only its own stored account's gate: `run.account` from `view().fold()`.
   - At every checkpoint, next to the `writeSchedulePreview` call:
     1. build `occurrences.json` from `protocol.view()`;
     2. read each attempt's exit.json with `readArtefacts(view.attemptDir(id, attempt),
        correlationId)`;
     3. adapt each record with `observedOf`;
     4. take `next` from the same planner pass the preview used;
     5. write it with `writeOccurrencesFile`.
   - A throw or a failed write is one log line and one `daemon.jsonl` note. It never stops the
     daemon. The journal standing is `whole`, `history-lost` or `not-open`, the last when the
     protocol could not be composed.
   - The preview gets the same merged launch index the tick uses.
2. **`scripts/scheduled-dispatch-drill.ts`**, which is D8 as amended by F8 and the M notes. It uses:
   - a scratch store root, a scratch admission directory, and a disposable tmux socket;
   - a stand-in `claude` placed first on **the creating client's PATH**. A new tmux session takes
     its environment from the client, not the server, so assert which `claude` resolves before any
     launch.
   - The stand-in prints a `stream-json` result event (`schedule fixture ran`) and appends one line
     to a marker file per invocation.
   - `schedule-fixture`'s real definition with `dispatch` overridden to `live` and authorised
     **inside the scratch only**. The real pin stays dry-run.

   What it drives:
   - It drives the scheduler tick and the protocol's reconciliation, and it **tears down and reopens
     every store, the owner and the protocol at each boundary**: before plan, after plan, after
     reserve, after `launching`, after invocation but before `start.json`, after `start.json` but
     before `exit.json`, and after `exit.json` but before the next reconcile.
   - Per boundary it asserts exact counts: marker lines, sessions on the socket, and reservations
     held. Final state: `completed`, and `succeeded` in `occurrences.json`. The answer route serves
     the answer.

   Extra rows:
   - a day of downtime gives exactly one launch;
   - running the page's exact cancel command, `tmux kill-session -t '=<correlationId>'`, must end
     `signalled`, then `interrupted`, then `released`;
   - a stand-in that writes an empty answer must end `missing-answer`, never `succeeded`;
   - a stand-in reporting a usage limit must end `quota-refused`.

   Negative control: a no-op launcher must make the first post-invocation row fail. The drill exits
   non-zero on any mismatch.
   **Two constraints from launch-protocol's Stage 2b (e3bcace3):**
   - **A routed `run-claude --account <handle>` reads the account's live profile over the network
     before it spawns anything, so no offline run through the `tmux-headless` adapter can reach
     `ok`.**
     - Launch-protocol's own real-tmux test asserts only `run-claude`'s refusal of an unregistered
       handle: `not-run`, and no `claude` spawned.
     - **Decided (checked 2026-09-10): option (b).**
       - The routed path calls `readProfile` (`tools/overseer/accounts.ts:382`, from
         `run-claude.ts:801`), which `fetch`es `https://api.anthropic.com/api/oauth/profile`
         (`accounts.ts:88`, `:390`).
       - That is a real network request inside the wrapper's own process, not a call through the
         `claude` binary, so no stand-in can answer it. Option (a), where a stand-in answers
         everything the routed path asks, is therefore closed.
     - **The success rows use an unrouted `run-claude`**, started through a test launcher composed
       the same way as the real one: the same artefact directory, the same `--launch-dir`, the same
       attempt-private prompt, and the same tmux session named by the correlation id. **Only
       `--account` is dropped.**
     - **A separate row drives the real `tmux-headless` adapter with an unregistered handle.** It
       must end at `run-claude`'s refusal (`not-run`, and no `claude` spawned), which reads as
       `launch-failed`.
     - Say in the report that the success path skipped the routed profile read and why.
     - No occurrence may read `succeeded` off a run that did not happen.
   - **Every test or drill that spawns a wrapper uses `tests/helpers/wrapper-env.ts`.**
     - `wrapperEnv` pins `PATH` and the account-routing names through `SPIDERYARN_ENV_PINNED`.
     - `resolveAsWrapper` does the preflight through the wrapper's own `.env.local` load.
     - The reason is Sol's F22 on the protocol: an inherited `PATH` is not pinned, so `.env.local`
       could put the real, paid `claude` back in front of the stand-in.
3. **`tests/scheduled-dispatch-drill.test.ts`** runs the drill, and its negative control, where
   tmux is present, and is skipped otherwise.
4. **`tests/overseer-daemon-occurrences.test.ts`** checks the daemon wiring against a temp store
   root, with fakes for everything that is not the launch store:
   - `occurrences.json` is written each checkpoint;
   - a projection throw is a note, not a crash;
   - the gate's `held` reaches the planner;
   - a composed-but-unarmed daemon launches nothing.
5. **A browser check** of the Overseer tab at 1280 and 390 px, against a SCRATCH fleet server on
   its own port reading a scratch store that holds the drill's `occurrences.json`. Never port 8787.
   Delegate it to a browser subagent that reads `docs/project/browser-control.md` first, and tell
   it to kill only its own PID.
6. **Docs:**
   - one pointer line in `docs/project/overseer.md` § standing jobs, naming the occurrences section
     and where the result lives. It is a rule doc, so propose the wording in the debrief rather than
     editing it, unless it is pure signposting;
   - the roadmap stage's status paragraph;
   - the plan's status.

## Red first

- The daemon writes `occurrences.json` at a checkpoint.
- An unopenable launch store gives `not-open` and keeps running.
- The drill's exact counts at every boundary.
- The cancel row.
- The empty-answer and quota rows.
- The negative control failing.

## How to work

- Use a temp dir per test, and never `~/.overseer`.
- Keep your own tmux socket under the temp dir; never touch the default server.
- Run no real `claude`: the stand-in only. The PATH assertion is what guarantees that.
- Run the focused suites, `npm run typecheck` (read the exit code, both streams), and
  `npx biome lint <files>`.
- Do not commit, and do not run the full suite.
- Never start, stop or signal the real daemon or the dashboard.

## Report back

Report the drill's full output (the normal run and the negative control), the files changed,
exact results with exit codes, and every departure.
