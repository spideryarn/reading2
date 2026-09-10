# Stage 3 task: the fleet boundary and the page

You are implementing Stage 3 of
`docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md`, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory`. Read the plan in full first,
including Findings; §6 is this stage. Stages 1 and 2 are committed. **The format you read is
whatever `tools/overseer/store.ts` and `recovery-view.ts` actually write to
`~/.overseer/recovery.json`**: `recoveryFileText` in `store.ts` writes it, and the view's types are in
`recovery-view.ts`. Read that code before designing the parser: the plan describes intent, and the
code is the contract. Where the plan and this brief disagree, the plan wins; tell me.

Three facts from Stage 2 that the page must draw honestly, each its own state and never an empty
list:

- **`view` is `null` until the daemon's first pass after a start.** Show "not yet checked by this
  daemon", with the records it has, their classification unknown.
- **Before any collection is accepted, every record is `unknown`**, carrying the inventory-trust
  sentence. Show that sentence once, as a banner, not on every row.
- **`resume: manual` carries the host and the directory as two separate facts.** Render them as
  "on <host>, in <dir>". Do not assemble a `cd` or `ssh` command string.

## Files — yours

- `tools/fleet/wire.ts`: **append one block** at the end of the file, holding `RecoveryFeed` and
  the record, evidence and banner shapes the page draws. Types only, with no imports and no runtime
  values. That is the file's own rule. `schedule-preview` is also appending a block there: merge
  `origin/dev` and re-read before you edit.
- `tools/fleet/recovery-feed.ts` (new): reads `recovery.json` **asynchronously**
  (`fs/promises`). The directory comes from `OVERSEER_STORE_DIR` (absolute) or `~/.overseer`,
  resolved the way `tools/fleet/attention.ts` resolves it; reuse its resolver if it is exported,
  and otherwise say so rather than copying a third one. Parse at this boundary with a validator of
  its own. **Do not import `tools/overseer/store.ts` or `recovery.ts`**: fleet parses the daemon's
  files itself, under the roadmap's ownership contract. The arms are `published`, `absent`,
  `unreadable` (with why), `unsupported-schema` (saw/known), and `oversized` (refused before
  reading, over an explicit byte ceiling). There is **no path from any failure to an empty list**.
  Project the first page (100): unresolved first, grouped by classification with `interrupted`
  first, newest disappearance first within a group; then `olderCount`, `overflow`, the replay
  state, and the view's `checkedAt` and inventory-trust sentence.
- `tools/fleet/routes-recovery.ts` (new): `makeRecoveryRoute(readers?)` with `handle(req, res):
  boolean`, modelled on `tools/fleet/routes-decisions.ts`, which you should read whole.
  `GET /api/recovery` only, read-only, and no write path of any kind. The readers are injected so
  tests never touch `~/.overseer`. Async: the handler must not block the request thread on a
  synchronous read.
- `tools/fleet/server.ts`: **three lines only**: the import, `const recoveryApiRoute =
  makeRecoveryRoute();` beside `decisionsApiRoute`, and `if (recoveryApiRoute.handle(req, res))
  return;` beside its dispatch line. Merge `origin/dev` and re-read immediately before editing;
  four sessions have been in this file today.
- `tools/fleet/web/src/recovery-client.ts` (new): modelled on `decisions-client.ts`, with its own
  strict parser, a timeout, and a `no-answer` arm for the browser's own failures. The factory takes
  its request leaf so tests exercise the real parse path.
- `tools/fleet/web/src/RecoveryPanel.tsx` (new): a self-contained section. It fetches on mount, and
  on the page's `refreshNonce` if one is passed. It polls no faster than once a minute and only
  while mounted. Heading: "Interrupted work". The banners go at the top: inventory not trustworthy
  (every record `unknown`, and why), replay not run, overflow (exact count, and "those events
  survive only in `events.jsonl`"), and the view's age. Each record shows:
  - the name, its classification, and why;
  - the recorded directory and whether it exists;
  - the transcript: found, or found under a claim and **labelled unverified**, or not found and why;
  - the last activity, with a floor drawn as `≥`;
  - the latest evidence, meaning the last seen status and harness and when;
  - resume support, as a sentence;
  - for `manual`, the SSH path (host and directory) as plain text.

  **No buttons, no links that act, no command text.** Follow the house styling of the neighbouring
  panels (`DecisionsPanel.tsx`, `OverseerPanel.tsx`): Tailwind with the `tw:` prefix, the same
  card and heading classes. It must work at phone width: rows wrap, and long paths break
  (`break-all` on paths).
- `tools/fleet/web/src/App.tsx`: **one line**, `<RecoveryPanel … />` directly below
  `<OverseerPanel … />` inside the `mode === "overseer"` arm (approved by the Overseer). Merge first
  and re-read.
- Tests, new:
  - `tests/fleet-recovery-feed.test.ts`: every arm; the ordering; the first-page cap with
    `olderCount`; a malformed record; an unknown schema; the oversized refusal.
  - `tests/fleet-recovery-route.test.ts`: through `makeRecoveryRoute` with injected readers. Only
    GET, and the status codes and headers match `routes-decisions`.
  - `tests/fleet-recovery-wiring.test.ts`: drives the composition `server.ts` calls, plus the
    source check that `server.ts` constructs the route and dispatches to it, and that `App.tsx`
    mounts `RecoveryPanel` inside the overseer arm. Model it on `tests/fleet-health-wiring.test.ts`.
  - `tests/fleet-recovery-panel.test.tsx`: renders each banner and each classification with
    fixtures, asserts no `<button>` exists, and asserts the unverified-transcript label.

## The acceptance fixture and the browser check

Write `scripts/overseer-recovery-drill.ts` (new). It builds a **disposable store** under a directory
given on the command line, by driving the real `runOverseer` with a scripted source and an injected
boot id. The steps:

1. Boot B1, generation G1, four sessions: a Claude that was working (with a transcript under a temp
   `projects/` dir); one whose Claude had exited (`no-claude`); a shell running a job; and one whose
   directory is then deleted.
2. The first accepted empty post-reboot snapshot (`rows: []`, null generation, a new producer run,
   boot B2).
3. Generation G2, with the working Claude resumed under a new token.

It then prints the directory. **It never touches `~/.overseer`**, and it refuses to run if its
target resolves to it. This drill is the acceptance artefact: after a simulated reboot, Greg sees
the recoverable work and the missing evidence, and nothing is started.

For the browser check, run the fleet server against that store on a free port of its own:
`OVERSEER_STORE_DIR=<dir>` and a port that is not 8787 (read `tools/fleet/server.ts` for how it
takes a port). Then open `#overseer` and check the section at 1280 px and at 400 px with Playwright,
following `docs/project/browser-control.md` and `docs/project/browser-testing-playwright.md`.
Screenshots go into the repo and are then moved into the scratchpad with a `ri3-` prefix, because
the Playwright MCP cannot write outside the repo. **Kill only the PID you started**, found by its
`/proc/<pid>/cmdline`. Never `pkill`, and never touch the server on 8787. Report what the page shows
for each of the four sessions.

## Gates, constraints, report

The same as Stage 1's brief (`docs/plans/260910e-recovery-inventory-stage1-task.md` § Gates you run,
§ Constraints, § What to report back). Add `npm run build:fleet` (exit code read). Use a `ri3-`
scratchpad prefix. Do not commit.
