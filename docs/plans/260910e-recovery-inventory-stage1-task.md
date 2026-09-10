# Stage 1 task: the recovery journal and the fold

You are implementing Stage 1 of
`docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md`, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory`. Read the plan in full first:
§1, §2 and §3 are this stage's design, and "Findings" records what the plan review changed. Where
the plan and this brief disagree, the plan wins; tell me about the disagreement.

## Files — yours

- `tools/overseer/recovery.ts` (new): the `recovery-candidate` and `recovery-disposition` event
  types (two arms; there is **no** replay-done event, per the plan's F9), `RecoveryCandidateId` and
  its hash (the previous execution plus the removing collection's identity, per F3), the candidate
  rule, `withRecoveryCandidates`, `foldRecovery` (keep-first by id, plus the pending-merge rule), the
  size and capacity caps, and the legacy derivation (straight into the fold, with deterministic
  ids). Pure: no I/O.
- `tools/overseer/diff.ts`: add the two arms to `OverseerEvent` **and nothing else**. `diff()`'s
  behaviour does not change.
- `tools/overseer/jobs.ts` and `tools/overseer/status-cli.ts`: handle the two arms explicitly in
  their exhaustive switches (`foldOccurrences` ignores them; `describeEvent` gives them one line).
  Nothing else in either file.
- `tools/overseer/store.ts`: `parseEvent` for the new kinds (exact, like the existing arms; a
  malformed line of a known kind is unreadable); the third fold in `Store.append`;
  `~/.overseer/recovery.json`, written through the existing `writeAtomically` from `checkpoint()`
  when the fold (or the stored boot id) changed; in `openStore`, after the one torn-tail repair,
  **a second bounded replay from `recovery.json`'s own cursor**; the legacy derivation, run over the
  whole log (bounded by `REPLAY_CEILING_BYTES`) when the file is absent or of unknown schema, with
  `replay: { kind: "not-run", why }` over the ceiling or across a hole; and a read-only
  `OverseerStore.recovery`, plus whatever the daemon needs to read and record the boot id.
- `tools/overseer/daemon.ts`: in `take()`, insert candidates immediately before
  `store.append(events)` on the accept path, covering `goneWhileAway`'s events too. Before `diff()`,
  the boot-id close-out (plan § "The host's boot id"); make the boot-id reader injectable through
  `DaemonOptions`, so tests can drive B1 → B2. **Merge `origin/dev` and re-read the file immediately
  before editing it.** The usage pass belongs to session `web-260910`, and `work-reports` is adding
  a `reports` option and one interval. Keep your hunks to the places named.
- New tests: `tests/overseer-recovery.test.ts` (unit) and `tests/overseer-daemon-recovery.test.ts`
  (through the real parser, gate, differ and store, driven by a scripted source; copy the harness
  shape of `tests/overseer-daemon-ordering.test.ts`, and do not edit that file or
  `tests/overseer-daemon.test.ts`).

## Not yours

Everything under `tools/fleet/`, `scripts/`, the view/classification (Stage 2), the page (Stage 3),
`tools/overseer/admissible.ts`, `observation.ts`, the action routes, and every other test file. If
you need one of them, stop and tell me.

## Tests first, red then green

Write the Stage 1 test list from the plan before the implementation, and run it to watch it fail.
Report the red run's summary line. A test that was never red proves nothing. Include, by name:
the first accepted empty post-reboot snapshot (candidates survive register removal); a generation
change with sessions back; an ordinary watched close (no candidate); `goneWhileAway`; a crash before
the candidate append; a crash between candidate and removal (a complete candidate line with a torn
gone line after it, re-derived from a *later* collection: one record); a crash before the recovery
checkpoint (`recovery.json` behind `current.json`); distinct disappearances of one run giving two
ids; a reboot that reuses the tmux pid (boot id B1 → B2); old schema with no `recovery.json`
(derived once and written; the second start restores without scanning; deleting the file re-derives
identical ids; `tmux-server-changed` gives `watched: true`; the `goneWhileAway` signature gives
`watched: false`; a gone with no surviving entry gives an `entry: null` stub; a log with no world
change gives none, and says so); the caps (an oversize stub with the event intact; 501 unresolved
gives `overflow: 1` with none evicted).

**The live-log check, read-only.** Copy `~/.overseer/events.jsonl` into the scratchpad directory
`/tmp/claude-1000/-home-greg-code-spideryarn2/1eddb8de-fb5b-4e50-aac6-fe2bbe7555b2/scratchpad/`
with a `ri1-` prefix, and record its line count and sha256. Open it with `openStore({ root })` in a
scratch root that holds only that copy, never the live store. It must parse every line and derive
0 candidates. Fail outright if it read fewer events than the copy holds. Put the numbers in your
report.

## Gates you run

- Focused: `npx vitest run tests/overseer-recovery.test.ts tests/overseer-daemon-recovery.test.ts`
  plus every existing suite that reaches the files you changed. At least
  `tests/overseer-store*.test.ts`, `tests/overseer-daemon*.test.ts` and `tests/overseer-diff.test.ts`;
  grep `tests/` for importers of `store.js`, `diff.js` and `daemon.js`, and run all of them.
- `npm run typecheck`, **reading its exit code**: it writes ✗ to stderr, and its last lines are ✓
  even when red. Do not pipe it through `tail`.
- `npx biome lint <files you touched>`. Never pass `--formatter-enabled=true`.
- Do not run the full suite; I will. Anything over ~2 minutes goes through
  `npx tsx scripts/tmux-job.ts --name ri1-<what> <command>` (only `--name`, no `--`). A backgrounded
  process on this box is killed under load.
- `tests/fixture-ids.test.ts` fails if any uuid appears in two test files. Mint fresh uuids and ids
  for your fixtures rather than copying one.

## Constraints

- Never touch the live `~/.overseer`, the running daemon, or the dashboard on 8787.
- Do not commit, do not stash, reset, checkout or restore. Leave the changes in the working tree; I
  read the diff and commit.
- Match the surrounding style: this code carries long, argued comments on its design decisions.
  Write comments like that where a decision is non-obvious (why the daemon writes candidates and
  `diff()` doesn't; why the id excludes `at`; why a separate file), and no more.
- Exhaustive `switch` with a `never` default wherever the code switches on event kind. The existing
  consumers of `OverseerEvent` (the CLI's `describeEvent`, `foldOccurrences`, and others) will stop
  compiling when the union grows. Handle each one deliberately; do not add a `default:` that drops
  things.

## What to report back

The conclusion, not the material: what you built, file by file, in a few lines each; any decision
the plan left open and how you settled it; the red run's summary, and the green runs' summaries
with exit codes; the live-log numbers; and anything you found that the plan got wrong.
