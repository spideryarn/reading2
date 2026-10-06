# The fleet collector's this-box check gets an anchor that works under systemd

Queue item `qi-j4jyf3ab`, handed over by the Overseer on 2026-10-06. Postmortem:
[260910b](../postmortems/260910b-a-later-check-reads-an-earlier-fallback-as-evidence.md).

## What is wrong

`selfCheck` in `tools/fleet/collect.ts` asks whether the tmux listing just read is a listing of
this box. It exists because a `tmux` pointed at another socket succeeds and returns plausible
sessions belonging to nobody (`41de8c8d`). Its only anchor is `TMUX` and `TMUX_PANE`: "we run in
a pane, so that pane must be in the listing".

The dashboard has run as `fleet-dashboard.service` since the evening of 2026-09-08. That process
has no `TMUX`, so the check answers `cannot-check` on every collection and has done for four
weeks. Nothing says so anywhere: the verdict is computed and dropped unless it is `absent`.

Measured on the box, 2026-10-06 (`scripts`-free, read-only):

- The service is pid 3219330, uid 1000, with `INVOCATION_ID` and no `TMUX` or `TMUX_TMPDIR`. The
  unit has no `PrivateTmp`.
- `tmux display-message -p '#{socket_path} #{pid}'` prints `/tmp/tmux-1000/default 132280`
  (tmux 3.4).
- `/tmp/tmux-1000/` holds three other socket files left by spikes (`s3a-sock`,
  `spike-resume-sock`, `gjddoctor2434629`). The first draft called that proof a wrong-socket
  listing "is not hypothetical on this box". The builder checked: no server answers on any of
  them, so today a child pointed there fails as `unread`. The hazard needs a second live server,
  which those spikes each were for a while.

## What we will build

One stage, three parts.

### 1. An anchor for a process that is not in a pane

A process with no usable `TMUX` normally reaches tmux through the **default socket for its user**:
`${TMUX_TMPDIR:-/tmp}/tmux-<uid>/default`. That is the box it means to be reading. So:

- `list-panes` gains a fifth field, `#{socket_path}`, last on the line (a path may contain a
  space; the first four fields may not). `PaneListing`'s `read` arm carries
  `socketPath: string | null`, parsed beside `tmuxServerPid`. Malformed rows or disagreeing
  socket fields return null; a newline in a pathname must not become a truncated socket path.
  An expected or canonical expected path containing a newline gives `cannot-check`, including
  when its continuation itself looks like a pane row.
- `selfCheck`, **only when `TMUX` is absent or empty**, compares the listing's socket path with
  the expected default socket, both through `realpath` (macOS reports `/private/tmp/…`).
  - Both resolve and are equal, or different names have the same device/inode → a new arm,
    `{ kind: "socket-matches"; socketPath }`.
  - Both resolve and name different filesystem objects → `absent`, naming both paths.
  - The listing carried no socket path, the uid cannot be read, or **either `realpath` fails** →
    `cannot-check`, with why. Failure to compare device/inode also gives `cannot-check`.
    `absent` requires a verified difference (Sol F3: a socket removed after the listing must
    not become a wrong-box refusal).
- With `TMUX` and `TMUX_PANE` both populated, nothing changes: the pane and server-pid checks stay as
  they are, and touch no filesystem.
- With `TMUX` set and `TMUX_PANE` missing, the answer stays `cannot-check` as today. tmux picks
  its socket from `TMUX` alone, so comparing against `default` there would refuse a correctly
  selected named server (Sol F2).

The expected path is computed by us from the uid and the server's own environment, and the
listed path is reported by the tmux child. Intended mismatches include the cases `41de8c8d` named:
a `TMUX` or `TMUX_TMPDIR` that differs in the child, a `-S`/`-L` in a wrapper, a different `tmux`
on `PATH`.

**It is a weaker check than the pane one, and the code says so.** It compares the server's
reported socket with the expected default. The pane check can also notice that our own pane
went missing; neither anchor proves the whole listing survived (Sol F6). And it trusts the `tmux`
executable: a wrapper that
fabricates output is outside what it can see.

`collect()` takes the environment, uid, realpath and file comparison as an optional parameter
with production defaults, so a test can drive the wiring instead of grepping the source. This is item 2
of the postmortem's "what would have caught it".

### 2. The verdict is published

- `FleetSnapshot` carries the verdict, and `/api/state` serves it as `selfCheck`. Its transport
  type is declared in `wire.ts` and the field is required on `FleetStateWire`, so a composition
  edge that forgets it is a type error. With no snapshot yet it is `{ kind: "not-collected" }`,
  not an invented verdict.
- Nothing new is drawn on the page. The page's `FleetState` derives from the wire type, so
  `"selfCheck"` is added to its documented `Omit` list, with the reason (Sol F1). No schema bump.
  A visible warning is a product decision and is listed below as a question.
- The published verdict describes the **retained rows**. A refused attempt keeps the previous
  snapshot and its verdict, and is represented by `error`, as today.
- **No logging change** (Sol F4). The first draft added a stderr line when the collection error
  changed, on the postmortem's statement that a firing leaves no trace. That stopped being true:
  `refreshOnce` already calls `logError("collection failed: …")` on every failure
  (`tools/fleet/refresh.ts:130`), wired to `console.error` in `server.ts`, which is the journal
  under systemd.

### 3. The comments stop saying it cannot be checked

The two comments in `collect.ts` that say production returns `cannot-check`, and the test that
pins that wording, are rewritten to match. The unit file's header still says "INSTALLED BUT NOT
ENABLED"; the queue item marks that file as Greg's, so it is reported, not edited.

## The refusal, and its retreat

Part 1 turns a path that never refused in production into one that can. If it fires wrongly the
dashboard keeps its last snapshot and goes stale, on the tool with the higher robustness bar.

**Decided in advance:** before the dashboard is restarted, the built code is run on the box
against the real tmux and must answer `socket-matches`. The run uses the service's own
environment, read from `/proc/<MainPID>/environ`, its uid and its working directory — not an
interactive shell with two variables removed, which keeps a different `PATH` and possibly a
`TMUX_TMPDIR` (Sol F5). That is evidence for this deployment's configuration, not proof a later
filesystem failure cannot happen; those land in `cannot-check`, not `absent`. If it answers anything else for a reason that is not a real wrong socket, the
`absent` arm for the socket anchor does not ship: a mismatch becomes `cannot-check` with the two
paths in its `why`, published but not refusing. The plan would then say *documented*, not
*closed*.

The refusal relies on **tmux's default-socket rule**, intact socket metadata and a verified
filesystem identity difference. The live run validates the recorded service configuration;
it does not prove every valid pathname or alias was handled. Tests exercise those separately.

## Passed over

- **Simpler: only publish the verdict, add no anchor.** It makes the gap visible and leaves it
  open. The anchor extends the existing check, and the item asks
  for both.
- **Simpler: set `TMUX` in the unit file.** A made-up pane id would make the check answer
  `absent` for ever, and a real one does not exist for a service.
- **Stronger: prove through `/proc` that the listed server pid holds the expected socket**
  (`/proc/net/unix` inode against `/proc/<pid>/fd`). It asks nothing of tmux at all. Passed over
  for now: Linux-only, more parts, and once the listed socket path equals the expected one the
  pid reported on that socket is that server's by construction.

## Done looks like

- Each new arm has a test seen red first; `collect()`'s wiring is tested by calling it, or the
  smallest extracted function that makes that possible.
- A mutation pass: dropping the comparison, swapping the field index, and handing the check an
  empty env each turn a test red.
- `npm test` for the fleet files, `npm run typecheck`, lint on touched files.
- The live no-`TMUX` run prints `socket-matches`; after the Overseer-sanctioned restart,
  `/api/state` shows `"selfCheck":{"kind":"socket-matches",…}`.
- GPT Sol has reviewed this plan and then the code.

## Questions for Greg

- **[Q-selfcheck-page]** Should the dashboard page itself show a warning when the verdict is
  `cannot-check`? Recommendation: not yet. With this change the production path answers
  `socket-matches` in the recorded live run; add a warning if `cannot-check` becomes useful to show.
- **[Q-unit-header]** `infra/hetzner/systemd/fleet-dashboard.service` still opens with
  "INSTALLED BUT NOT ENABLED … The dashboard is up under scripts/tmux-job.ts". That has been
  false since 2026-09-08. Recommendation: let an agent correct the comment.

## Log

- 2026-10-06 — plan written; evidence above gathered in worktree `qi-j4jyf3ab-selfcheck-systemd`.
- 2026-10-06 — GPT Sol plan review,
  [261006h-fleet-selfcheck-plan-review-sol.md](261006h-fleet-selfcheck-plan-review-sol.md):
  *build with changes*, F1–F6. All six checked against the source and accepted; the plan above is
  the revised one. F1 and F4 were established and I confirmed both (`FleetState` in `types.ts`
  derives from the wire type; `refreshOnce` already logs). The logging part was cut.
- 2026-10-06 — built by an Opus subagent, red first (30 failing before any code), 20 mutations
  each turning a test red. What landed beyond the plan's wording: `selfCheck(listing, anchor)`
  with both required; `snapshotFrom` takes the verdict as a required argument; both source-text
  guards replaced by tests that call `collect()` (the postmortem's "no test calls `collect()`"
  had gone stale — two already did); an empty `TMUX_TMPDIR` is treated as unset, as tmux does.
- 2026-10-06 — **the retreat did not fire.** Run with the service's own twelve environment
  variables from `/proc/3219330/environ` under `env -i`, against the real tmux:
  `VERDICT: {"kind":"socket-matches","socketPath":"/tmp/tmux-1000/default"}`. Negative controls:
  the check's `TMUX_TMPDIR` pointed at a scratch directory holding a `tmux-1000/default` file gave
  `absent` naming both paths; pointed at `/nonexistent` gave `cannot-check`. No second live tmux
  server was available, so "a real other server answers" was simulated from the anchor side, not
  observed.
- 2026-10-06 — code review found a false refusal for newline-fractured socket metadata and a
  pathname-versus-inode alias risk. Regressions were seen red before fixes: ambiguous metadata
  now yields `cannot-check`, and differing canonical names are compared by device/inode before
  refusal. File comparison failure also yields `cannot-check`. Scratch files exercise these
  paths without tmux contact; a live connection through a hardlink was not observed. Root cause:
  [261006l-a-resolved-path-is-not-a-socket-identity.md](../postmortems/261006l-a-resolved-path-is-not-a-socket-identity.md).
- 2026-10-06 — reviewer validation: the original collector suite passed 77 tests; after fixes
  it passed 83. Ten fleet/client/ordering files passed 798 tests; doc links passed 17. All four
  TypeScript projects passed using `node --import tsx scripts/typecheck.ts` because the `tsx`
  CLI's IPC listener is denied in this sandbox. Scoped lint passed with one existing `useConst`
  warning. No tmux server was contacted, and no restart or deployed-state check was performed.
- 2026-10-06 — the reviewer's diff read as a proposal and accepted whole. Every change moves a
  verdict away from `absent`, towards `cannot-check` or `socket-matches`, so none can add a
  refusal. Re-run after its fixes with the service's environment: still `socket-matches`
  (13 sessions, server 132280). Typecheck, `fleet-collect`, `fleet-refresh` and `doc-links`
  green. No second review round: F10 (a pathname swapped between the tmux reply and the
  comparison) is left open as reasoned and out of scope, and is the `/proc` option under
  "Passed over".

---

Up: [plans.md](../project/plans.md)
