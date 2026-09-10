# Stage 2 task: the view, the dispositions and the CLI

You are implementing Stage 2 of
`docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md`, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory`. Read the plan in full first,
including Findings. §2 (dispositions), §4 (the view) and §5 (dismissal) are this stage. Stage 1 is
committed: read its code in `tools/overseer/recovery.ts` and the recovery parts of `store.ts` and
`daemon.ts` before you design anything, and build on them rather than beside them. Where the plan and
this brief disagree, the plan wins; tell me.

## Files — yours

- `tools/overseer/recovery-view.ts` (new): the classification, pure, first match wins, exactly as
  plan §4 lists it; and the evidence pass, async and bounded to the first page. `dir` gets a `stat`.
  The transcript comes from `findTranscript` in `tools/fleet/transcript.ts`, reused and not
  rewritten, with the found path `stat`ted once for its mtime. `lastActivity`, `resume` and
  `manual` with the SSH path (the host name from `os.hostname()`, plus `cd <dir>`) come after. One
  `checkedAt` for the whole pass. Inject `projectsDir`, `stat` and `hostname` so tests need no fake
  home.
- `tools/overseer/recovery.ts`: the derived dispositions (`resumed` and `superseded`, per plan §2 as
  revised by Sol's F2), and the request-id idempotency for `dismissed`. **Also the retention rule
  Stage 1 deferred**: resolved records older than 30 days leave the index and stay in the journal.
  Unresolved records never leave, and this must not disturb the pending-merge rule. Pending entries
  now carry the collection behind their last sighting (`lastSeen.observation`, Sol's F12), and
  `replay.not-run` carries `retry` and `previous` (F13). Read both before you touch the fold.
- `tools/overseer/store.ts`: the view goes into `recovery.json` beside the fold. It has its own
  clock, and is written when it changed.
- `tools/overseer/daemon.ts`: the view pass. It runs after a fold change, after each accepted
  inventory, and at most once a minute otherwise, never on a request. It also appends the derived
  dispositions and drains `~/.overseer/recovery-inbox/` each tick. **Merge `origin/dev` and re-read
  the file immediately before editing it.** `work-reports` has added a `reports` option and an
  interval; the usage pass is `web-260910`'s. If `work-reports` has put a generic inbox-drain helper
  in a leaf module by then (listing `<uuid>.json` files oldest first, skipping symlinks and
  `.tmp-` files, with a `refused/` directory), reuse it.
- `scripts/overseer-recovery.ts` (new): `list` reads `recovery.json` read-only and prints every
  retained record, with the overflow sentence when `overflow > 0`. `dismiss <id> --why "<sentence>"`
  writes one request file atomically (tmp + rename) into the inbox, named by a fresh request id.
  The CLI never writes `events.jsonl` or `recovery.json`.
- Tests: `tests/overseer-recovery-view.test.ts` (new), and additions to
  `tests/overseer-daemon-recovery.test.ts`.

## Not yours

Everything under `tools/fleet/`. You *import* `findTranscript`, and edit nothing there. Also the
page (Stage 3), `admissible.ts`, `observation.ts`, the action routes, and every other test file.

## Tests first, red then green

The plan's Stage 2 list, every item by name. Report the red run's summary line before you
implement.

The inventory-trust rule gets its own daemon test. A refused payload, a failed collection, or a held
baseline arriving after the reboot makes **every** record `unknown`, whatever rows the stale
inventory carries.

Both `already-live` arms get one:
- the same conversation under a different token: `resumed` appended once, and a second view appends
  nothing;
- the same conversation under the same token: `already-live`, and no disposition.

## Gates, constraints, report

The same as Stage 1's brief (`docs/plans/260910e-recovery-inventory-stage1-task.md` § Gates you run,
§ Constraints, § What to report back). Use a `ri2-` scratchpad prefix. Do not commit.
