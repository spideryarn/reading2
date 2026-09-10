# Stage 1 task — the reports log, the inbox, the drain and the CLI (plan 260910e)

You are implementing Stage 1 of `docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md`
in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/work-reports`. Work only there. Read the
plan in full first — **the design section is the reviewed version and is the spec**; the Sol review it
answers is `docs/plans/260910e-work-reports-plan-review-sol.md` (WR-P3, P4, P5, P6, P9 are yours). Then
`AGENTS.md` § Writing code.

**Another subagent is building Stage 2 in the same worktree at the same time** (`tools/overseer/decisions.ts`,
`scripts/overseer-decisions.ts`, `tools/fleet/decisions-view.ts`, `routes-decisions.ts`, `wire.ts`,
the decisions web client and panel, the decisions tests). Do not touch those files. Tests of theirs may go
red while they work; that is not yours to fix.

## Already written, import it

`tools/fleet/artefact-ref.ts` (+ `tests/fleet-artefact-ref.test.ts`): `ArtefactRef`, `ArtefactCheck`,
`CheckedArtefact`, `parseArtefactRef(s)`, `parseCheckedArtefacts`, `parseArtefactSpec` (the CLI's
`commit:`/`path:`/`decision:`/`queue:` spelling), `untrustedTextProblem(text, max)`, `pathProblem`,
`artefactHref`, `describeArtefactCheck`. Use `untrustedTextProblem` for **every** text field. If you need
to change this module, say so and why.

## Read before writing (reuse, do not reinvent)

- `tools/overseer/decisions.ts` — the model: strict per-event parser (nothing defaulted), a fold that
  collects problems instead of throwing, three read arms with an init marker so a lost file never reads
  as empty, idempotency by byte-identical payload. Match its comment style and density (the reason for a
  choice, the review finding that caused it; not descriptions of the code).
- `tools/overseer/jsonl.ts` (`truncateToLastLine`, `writeAll`). There is **no `reports.lock`**: the
  drain runs only inside a daemon holding `overseer.lock` — say so where the drain is defined.
- `tools/overseer/store.ts` `RegisterEntry`, `SessionRegister`, `storeRoot`.
- `tools/fleet/execution-identity.ts` (`readBootIdentity`, `readProcessStart`, `parseProcStat`) and
  `tools/fleet/execution-token.ts` (`executionTokenText`, `isExecutionTokenText`).
- `tools/overseer/daemon.ts` — `DaemonOptions` and how `attention` / `usage` / `jobs` are injected and
  run on their own intervals in `runOverseer`, and how their errors become notes. **Merge `origin/dev`
  is the orchestrator's job; you re-read `daemon.ts` immediately before editing it** — two other
  sessions edit it (the usage pass; recovery-inventory in `take()`, startup and the tick). Make one
  small additive edit: an optional `reports` option and its own interval beside the others.
- `scripts/overseer.ts` — `parseArgv`, `Parsed`, `runParsed`, and the `run` composition.
- `tests/overseer-daemon-usage-pass.test.ts` — how a test drives the daemon with fakes.

## Build

1. `tools/overseer/reports.ts`:
   - `ReportSubmission` and `ReportEvent` types exactly as the plan's "The record" (a discriminated union
     per kind; `execution` a union, not optionals). `parseSubmission(text)` and `parseReportEvent(line)`,
     strict. Field limits: summary ≤ 1000 chars, `needs` ≤ 500, `plan` a repo path (`pathProblem`),
     `queueItem` the queue id rule, `occurrence.jobId` `^[a-z0-9-]{1,41}$` and `scheduledAt` ISO,
     revision lists ≤ 20 shas each, `corrects` a uuid or null, `observedExecution`
     `isExecutionTokenText` or null, session name `^[A-Za-z0-9._-]{1,64}$`.
   - `submitReport(root, submission)`: `report-inbox/.tmp-<eventId>` opened `wx`, write, fsync, rename to
     `<eventId>.json`, fsync the directory. Returns the path.
   - `drainReports({ root, register, now, checkArtefact, appendDecision, limits })` — **synchronous**, the
     four steps in the plan's diagram. Start of pass: replay every `processing/<id>.json` from step [2]
     with its frozen bytes. Then the inbox, oldest first by mtime then name: only names matching
     `<uuid>.json`; open with `O_RDONLY | O_NOFOLLOW`, `fstat` must be a regular file, ≤ 16 KiB, the
     name's uuid must equal `eventId`; anything else is counted in the outcome and left alone (never read,
     never deleted — but `.tmp-*` older than an hour may be removed, and say so). Step [1] freezes
     `receivedAt`, the execution comparison (same-verified-run / different-verified-run / unverifiable
     with reason; null for non-session actors) and each artefact's check, into `processing/<id>.json`
     written temp + rename. A `decision` submission is refused in this stage with "decision reports are
     wired in stage 3" — but keep `appendDecision` in the signature (a no-op fake in tests) so Stage 3
     only fills it. Step [3] appends to `reports.jsonl` (repair with `truncateToLastLine` first; skip if
     the same event id is already there with identical bytes; a same id with different bytes is a
     refusal). Step [4] unlinks processing then inbox. Refusal: one `refused/<id>.json` written temp +
     rename containing `{ eventId, refusedAt, why, original }` (original as text, ≤ 16 KiB), then the
     inbox file is removed; keep the newest 200. **Transient** failures (a checker that could not run is
     `unchecked`, which is fine; an `appendDecision` that reports lock contention; an fs error) leave the
     item pending and are reported in the outcome. Limits default: 50 files, 1 MiB, 200 probes, 5 s.
     Returns a `ReportDrainOutcome` naming counts: recorded, refused, pending, skipped-entries, replayed.
   - `readReports(root)` → `never-written | reports | unreadable`, with a `reports.created` marker
     written before the first append; `foldReports(events)` → rows oldest-first + problems (duplicate
     event id with other bytes; `corrects` naming an unknown, later, or the same event). A correction
     marks the corrected row `correctedBy: { eventId, actor, at }`; the earlier row is never changed
     otherwise. **No inferred disagreement between kinds.**
   - `readInbox(root)` for the listing: in-flight inbox items (parsed submissions or "unreadable"),
     `processing/` items, and refused records.
2. `tools/overseer/report-artefacts.ts` — `makeArtefactChecker({ repoDir, decisionsRoot, queueRoot })`:
   commit: `git cat-file -e <sha>^{commit}` then `git merge-base --is-ancestor <sha> refs/remotes/origin/dev`
   ⇒ on-dev / found-locally / not-found; path: `git cat-file -e refs/remotes/origin/dev:<path>` ⇒ on-dev,
   else `realpath` of `join(repoDir, path)` inside `realpath(repoDir)` and a regular file ⇒ found-locally,
   else not-found; decision: `readDecisions` (found / not-found; unreadable ⇒ unchecked); queue item: the
   queue's reader in `tools/overseer/idea-queue.ts`. All git via `execFileSync("git", [...], { cwd:
   repoDir, timeout: 2000, stdio: "pipe" })` — argv, never a shell. Distinguish "git said no" (exit 1 /
   128 with a not-found message ⇒ not-found) from "could not run git" (timeout, ENOENT ⇒ unchecked).
3. `tools/overseer/report-identity.ts` — `observeOwnExecution()`: walk `process.ppid` upward through
   `/proc/<pid>/stat` (`parseProcStat`) and `/proc/<pid>/cmdline`, at most 20 steps, to the nearest
   process whose argv[0] basename is `claude`; return its token text via `readBootIdentity` +
   `readProcessStart` + `executionTokenText`, or a reason. Injectable reads for tests.
4. `scripts/overseer.ts` — `report progress|blocked|completed|decision` and `reports`:
   - common flags: `--summary <text>` (required), `--artefact <spec>` (repeatable), `--plan <path>`,
     `--queue-item <id>`, `--corrects <eventId>`, `--session <name>` | `--as overseer|greg`; with neither,
     the tmux session name from `tmux display-message -p '#S'` when `$TMUX` is set; else refuse.
   - `blocked --on <kind> --needs <text>`; `completed --ending <kind> [--reviewed <sha>]... [--tested
     <sha>]... [--merged <sha>]...`; `decision --file <json|->` (parsed and then refused as not yet wired).
   - prints the event id and "submitted, not yet recorded — the daemon records it within about 30 s; `npx
     tsx scripts/overseer.ts reports --event <id>` shows whether it has".
   - `reports [--session <name>] [--kind <kind>] [--search <text>] [--event <id>] [--json]`: recorded rows
     (each line says "claimed by …", the execution comparison, artefacts with `describeArtefactCheck`,
     "not stated" for empty revision lists, and "corrected by …"), then in-flight, then refused with
     reasons. Every empty case prints a sentence, never nothing.
   - `run`: compose `reports: { drain: (register) => drainReports({ root, register, now, checkArtefact:
     makeArtefactChecker({ repoDir: <this checkout>, … }), appendDecision: <no-op in this stage> }) }`.
5. `tools/overseer/daemon.ts` — `reports?: { intervalMs?: number; drain: (register: SessionRegister) =>
   ReportDrainOutcome }`, run every `intervalMs ?? 30_000` while not halted, passing `store.register`;
   a throw becomes a note (reuse an existing note kind if one fits; add one to `notes.ts` only if none
   does, and say so); a non-zero refused or pending count is logged once per pass.

## Tests first, red then green

`tests/overseer-reports.test.ts` (parsers, drain, fold, read arms), `tests/overseer-reports-cli.test.ts`
(grammar and runParsed arms, with `OVERSEER_STORE_DIR` pointed at a temp dir), and a daemon case in a
new `tests/overseer-daemon-reports.test.ts`. Temp directories only — never `~/.overseer`. Fresh uuids
(`tests/fixture-ids.test.ts` fails the suite on a uuid shared between test files). Each case seen red
before its code exists:

- duplicates: the same submission dropped twice ⇒ one row; same id, other bytes ⇒ refused and listed.
- execution: equal token ⇒ same-verified-run; different ⇒ different-verified-run; no observed token, name
  not in register, or register entry unverified ⇒ unverifiable with the reason; the Overseer as actor ⇒ null.
- untrusted text: a control character, a bidi override, and oversize — in summary, needs, plan, and a
  revision entry — each refused naming the field; `path:../x` and `path:/etc/passwd` refused.
- unknown kind `"ready"`: refused by the CLI parser, and by the drain when a file is dropped by hand.
- a nonexistent artefact (valid sha, fake checker says not-found) ⇒ kept, `not-found`.
- explicit correction ⇒ both rows kept, the earlier marked corrected by id/actor/time; `corrects` naming
  a later, unknown or self event ⇒ refused; `completed` then `progress` without `corrects` ⇒ both kept,
  neither marked.
- crash at each boundary (after processing written; after the reports append; after unlinking
  processing): re-drain yields exactly one row, and the frozen `receivedAt` / checks survive even though
  the fake register and checker return different values on the retry.
- a backlog of 120 submissions with the daemon "down" ⇒ drained over three passes, oldest first, nothing
  lost; the per-pass byte and probe limits hold.
- inbox hygiene: a symlink named `<uuid>.json`, a directory, a non-uuid name, a file whose name ≠ its
  eventId, a 17 KiB file ⇒ never parsed as a report; the first three skipped and counted, the last two
  refused.
- a transient failure (checker throws / appendDecision says locked) ⇒ item still pending, nothing written.
- lost log: `reports.created` present, `reports.jsonl` absent ⇒ `unreadable`, not empty.
- the daemon option: a fake drain is called on its interval with the store's register; a throwing drain
  becomes a note and the daemon keeps running.
- `observeOwnExecution` with fake `/proc` reads: finds the `claude` ancestor; none within 20 steps ⇒ reason.

## Gates, then stop

Your three test files, `npx vitest run tests/fleet-artefact-ref.test.ts tests/overseer-daemon*.test.ts`,
`npm run typecheck` (read the exit code; ✗ lines go to stderr, and the last lines are always ✓), and
`npx biome lint <files you touched>`. Not the full suite. **Do not commit** — the orchestrator reads the
diff and commits. Files you may touch: `tools/overseer/reports.ts`, `tools/overseer/report-artefacts.ts`,
`tools/overseer/report-identity.ts`, `tools/overseer/daemon.ts` (additive), `tools/overseer/notes.ts`
(only if needed), `scripts/overseer.ts`, `tools/overseer/cli-help.ts` (only if help text lives there),
and your three test files. Anything else: stop and say so.

Report back, briefly: files changed; each required test and whether you saw it red; gate results with
exit codes; anything in the plan you found wrong or had to decide; anything left undone. The conclusion,
not the file contents.
