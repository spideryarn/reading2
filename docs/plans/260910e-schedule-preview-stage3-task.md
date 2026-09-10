# Stage 3 task — the browser section (plan 260910e)

You are implementing Stage 3 of `docs/plans/260910e-schedule-preview-make-periodic-work-inspectable-before-launch.md`
in the worktree you are in (`/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview`). Read the plan's § D6, D7
and § Stage 3, and `docs/project/fleet-dashboard-modes.md` in full — it is the checklist for this kind of work, and its
sections *Where the panel's data comes from*, *The seam*, *Absence is stated* and *The test* are your spec for shape.

Stage 2 built what you display: the `SchedulePreview` types appended to `tools/fleet/wire.ts`, the parser
`tools/fleet/schedule-parse.ts` (`parseSchedulePreview`), and `tools/overseer/schedule-preview.ts`
(`readSchedulePreviewFile`, `schedulePreviewLines` — read it to see what the CLI says, so the page says the same
things). The daemon writes `~/.overseer/schedule.json` (or `$OVERSEER_STORE_DIR/schedule.json`) every checkpoint tick.

Exemplars to copy for structure, not content: `tools/fleet/routes-admission.ts` + `tools/fleet/admission-wiring.ts`
(a pure payload function, an exactly-matched path, a `make…()` composition a join test can drive),
`tools/fleet/web/src/health-history-client.ts` (a typed client with an injectable seam and late-bound `fetch`),
`tools/fleet/web/src/AdmissionSection.tsx` and `HealthPanel.tsx`'s `admissionApi = httpAdmissionApi` defaulted prop
(a section that fetches its own route inside a panel). Times on screen go through `tools/fleet/zones.ts` /
`tools/fleet/web/src/instant.ts`.

## What to build

1. **`tools/fleet/routes-schedule.ts`** — `GET /api/overseer/schedule`, exactly matched, read-only. A pure
   `schedulePayload(deps)` that reads the preview file through an injected reader (default:
   `readSchedulePreviewFile(storeDir)`) and answers one of: the parsed preview, `absent` (the running daemon predates
   this build or has never written one — say so), `unreadable` + why, `unsupported-schema` + the number, plus
   `servedAt`. Bounded: refuse to parse a file over a stated size (say 256 KiB) with a sentence rather than reading it.
   No subprocess, no repo reads.
2. **`tools/fleet/schedule-wiring.ts`** — `makeSchedule(options?)` returning `{ deps, route }`, resolving the store dir
   with `storeRoot()` from `tools/overseer/store.ts` (`OVERSEER_STORE_DIR` when absolute, else `~/.overseer`; it
   THROWS on a relative value). Catch that throw and build a route that answers `unreadable` with the reason, not a
   crash — the same shape `server.ts` uses around `openUsageHistoryForRead(defaultUsageHistoryDir())`.
3. **`tools/fleet/server.ts`** — one composition line beside `makeAdmission()` and one mount line
   (`if (schedule.route.handle(req, res)) return;`) beside the admission mount, with a short comment in the file's
   voice. Nothing else in that file.
4. **`tools/fleet/web/src/schedule-client.ts`** — `ScheduleApi = { read: () => Promise<ScheduleView> }`,
   `makeScheduleApi(fetchImpl)`, `httpScheduleApi` late-bound. It re-parses the payload with `parseSchedulePreview`
   (the one parser) and adds the browser's own arm: *this page could not reach the route* (network failure, non-200),
   in the page's voice, never the server's.
5. **`tools/fleet/web/src/SchedulePreview.tsx`** — a `Card` section titled for what it is (e.g. *What the scheduler
   would run next*), fetching on mount and every 60 s, with a caveat line under the title built from the preview's own
   `caveat` and `writtenAt` age. A headline line (the daemon's word — OFF / ARMED / BLOCKED — and its sentence,
   capabilities, arming instant or the reason there is none, history). Then one row per job: id, resource class,
   dispatch mode (dry-run visibly different), the verdict sentence, next due as a time via `instantTip`/`zonedLine`
   (London first) and relative, last attempt and result, and a disclosure (a `<details>` is fine) with the prompt, the
   behaviour hash against its pin, the launcher lease, `session timeout: not built`, `session no-overlap: not
   enforced`, and each document with pinned and current digests — **a changed document drawn loudly**, since that is
   the roadmap's acceptance sentence. Every absence is its own sentence (§ Absence is stated). It must work at 390 px
   wide without scrolling the page sideways (long hashes and paths wrap or truncate with the full value in a tooltip).
   Use the existing `ui` primitives, `Tooltip`/`Explain`, and the `tw:` Tailwind prefix the rest of the client uses.
6. **`tools/fleet/web/src/OverseerPanel.tsx`** — a defaulted prop `scheduleApi = httpScheduleApi` on `OverseerPanel`
   and ONE mount line, `<SchedulePreview api={scheduleApi} … />`, directly after `<OverseerStatusCard … />`. Nothing else
   in that file. Another session (`action-receipts`) may have added a ReceiptList there; leave it alone. A third
   (`recovery-inventory`) will mount a panel in `App.tsx` — you do not touch `App.tsx`.

## How

- Tests first where behaviour is new: `tests/fleet-schedule-route.test.ts` (the payload over a disposable store dir:
  absent, a real file written by Stage 2's `writeSchedulePreview`, unreadable, oversized, unknown schema; and the join
  through `makeSchedule()` rather than a hand-built route; and a comment-stripped source check that `server.ts` mounts
  it — see *The test* in fleet-dashboard-modes.md for why comments must be stripped, and check it red by commenting the
  mount out) and `tests/fleet-schedule-preview-section.test.tsx` (drives the seam, not `fetch`: each absence says which
  nothing it is; a dry-run row and a changed document are visibly marked; opening the Overseer tab triggers the read —
  copy the mounting helpers from an existing `tests/fleet-*.test.tsx` that renders `OverseerPanel` or `HealthPanel`).
  Assertions on row text must not be satisfied by a tooltip's `sr-only` span — assert on a specific element.
  **Do not copy a uuid from another test file** (`tests/fixture-ids.test.ts`).
- Run `npx vitest run tests/fleet-schedule-*.test.ts* tests/fleet-schedule-parse.test.ts tests/fleet-imports.test.ts tests/fleet-compile-guards.test.ts tests/fleet-overseer*.test.ts* tests/fixture-ids.test.ts`,
  `npm run build:fleet` (must succeed), `npm run typecheck` judged by exit code (never piped through `tail`), and
  `npx biome lint` on touched files. Not the full `npm test`.
- **Do not commit**; no git command that changes state.
- Never restart, kill or reconfigure the dashboard on port 8787 or the Overseer daemon. If you want to look at the page,
  do not; the manager will arrange a browser check separately.
- Stay inside the files named above and their tests. Anything else: stop and report.
- Scratch: `/tmp/claude-1000/-home-greg-code-spideryarn2/649e0f1c-7c49-4f44-80ad-314e4bce9858/scratchpad/stage3/`.

## Your answer

The files changed; each test seen red first and the command; suite, build and typecheck results with exit codes; and
anything you decided differently from this task.
