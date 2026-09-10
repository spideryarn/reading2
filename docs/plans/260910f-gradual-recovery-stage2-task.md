# Stage 2 task: the route and the panel's first control

You are implementing Stage 2 of
`docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md` in the
worktree `/home/greg/code/spideryarn2/.claude/worktrees/recovery-resume` (branch
`worktree-recovery-resume`). **Read the whole plan first**, including its "Review dispositions"
section if one is present, which overrides the sections above it. Then read the inventory's fleet
side, which you are extending and should imitate: `tools/fleet/recovery-feed.ts`,
`tools/fleet/routes-recovery.ts`, `tools/fleet/web/src/recovery-client.ts`,
`tools/fleet/web/src/RecoveryPanel.tsx`, and their tests (`tests/fleet-recovery-*.test.ts*`). Read
`tools/fleet/routes-new.ts` for `checkRequest` (same-origin `Origin` and a JSON content type, the
CSRF defence) and for how a mutation route is written here.

**Rules of the tree.** Work only in this worktree. Do not commit, push, or run any git command that
changes state (checkout, restore, stash, reset, clean). Another subagent is building Stage 1
(`tools/overseer/recovery-resume*.ts`, `daemon.ts`) in this same worktree at the same time: do not
edit its files, and expect its half-finished files to show up in a full typecheck. Read files
outside the worktree only through Bash, never the Read tool. **Never touch the live dashboard on
port 8787, the live daemon, or `~/.overseer`.** For the browser check, start your own server on a
port of your own, from a temp store, and **kill only your own PID** when you are done. Never
`pkill` by name. Other agents' servers are running.

## What this stage is for

The recovery panel gets its first control. For an `interrupted` record whose resume is `supported`,
**Resume…** opens an inline confirmation. It shows what the session was doing (the brief, where it
got to), what we cannot be sure of, and the exact nudge that will be typed. Its button queues one
request. Each record then shows its request's state. Other records get manual instructions, or
nothing. The footer says what the one control does.

## The contract you build against

- **Types**: the block headed "Gradual recovery: resume requests" at the end of
  `tools/fleet/wire.ts`: `RecoveryResumeProjection`, `RecoveryResumeFeed`,
  `RecoveryResumePostBody` and `RecoveryResumePostAnswer`. Follow them exactly. If you truly need a
  change, make it and say why.
- **The request leaf**, `tools/overseer/recovery-resume-request.ts`, being written by Stage 1. It
  exports `RECOVERY_RESUME_DIR`, `CANDIDATE_ID_PATTERN`, and `writeResumeRequest(root, input) → {
  kind: "written" } | { kind: "already-pending" } | { kind: "already-done"; occurrenceId? } | {
  kind: "refused"; why }`, where `input` is `{ candidateId, requestedAt, actor, seen }`. If the file
  is not there yet when you need it, write against this API and check back later. **Do not write
  your own copy.** Importing it from `tools/fleet/` needs one entry in the allowlist in
  `tests/fleet-attention.test.ts` (~425–450, and the test at ~616). Add it there with a sentence
  saying why it passes the test: its closure is node builtins only, and it never reaches the store.
- **The store root**: resolve it exactly the way `recovery-feed.ts` does (`OVERSEER_STORE_DIR` or
  `~/.overseer`). Reuse that function; do not copy it.

## Files (yours)

- `tools/fleet/recovery-resume-feed.ts` (new): reads `recovery-resume.json` asynchronously, with a
  size ceiling checked on the open file, as `recovery-feed.ts` does after its F27 fix. It has its
  own strict validator, and the four arms of `RecoveryResumeFeed`. **There is no path from a failure
  to "nothing queued".** One malformed request makes the whole feed `unreadable`, naming the
  request.
- `tools/fleet/routes-recovery-resume.ts` (new), on `routes-recovery.ts`'s pattern:
  - `GET /api/recovery/resume` returns the feed;
  - `POST /api/recovery/resume`: `checkRequest`; a bounded body; `RecoveryResumePostBody`
    validated; `candidateId` checked against `CANDIDATE_ID_PATTERN`; then `writeResumeRequest`
    with `actor: "dashboard"`. The answers are 202 `queued`, 200 `already-requested` or
    `already-launched`, 400 for a bad body, 403 for the origin, 409 for `refused`.
  - The route **never launches, and never reads tmux or the launch store**;
  - HEAD like GET; every other method 405.
- `tools/fleet/server.ts`: one dispatch branch beside `/api/recovery`'s, as a **separate, minimal
  hunk**. It needs the Overseer's approval, which I am getting. Write it so it can be dropped
  cleanly.
- `tools/fleet/web/src/recovery-resume-client.ts` (new): fetch, and a browser-side parser for the
  feed. It rejects contradictions, for example a `resumed` state whose request is also pending, or
  two requests for one candidate. It also posts.
- `tools/fleet/web/src/RecoveryPanel.tsx`: small targeted edits; this file is yours now. It polls
  the resume feed only while mounted, like the inventory feed. The record card gains:
  - **Resume…** only when the card is `interrupted`, its evidence `resume.kind === "supported"`, and
    the projection's `launcher` is `wired`. When unwired, show the manual instructions instead, with
    one line saying resume from the page is not switched on yet;
  - **the inline confirmation** (not a dialog). It shows the brief and the last words **as labelled
    quotations**, the uncertainty list, the nudge verbatim, and the directory. It carries the line
    "Starts one session. Any others you pick wait until this one is seen running", and a **Resume
    this session** button. The button is disabled while a POST is in flight. After an answer, the
    card shows the request's state from the projection. If the answer was lost, the next poll shows
    it. A second tap answers `already-requested`, and the page says so plainly;
  - **the state line** for each `RecoveryResumeRequestState` arm, in plain words, including
    `pending`'s `why` and `until`, `launched`'s `waitingFor`, and `refused`'s reason with
    **Resume…** offered again;
  - **manual instructions** for `resume.kind` `not-supported` with a verified conversation, and for
    `manual`: `gjd-remote ssh`, then `cd ‹dir›`, then `claude --resume ‹uuid›`. They are built only
    when the uuid matches a strict uuid regex, and the directory is shell-quoted. They are display
    text in a code element, never a link. `manual` keeps today's host-and-dir text;
  - **no control of any kind** on `unknown`, `present-but-unmatched` or `ended-before-reboot`.
  - **The footer**, replaced with the plan's §5 wording exactly.
- Tests: `tests/fleet-recovery-resume-route.test.ts` and
  `tests/fleet-recovery-resume-panel.test.tsx`, following the existing recovery panel tests'
  harness. Extend `tests/fleet-recovery-wiring.test.ts` so it pins the new route's dispatch in
  `server.ts`, the same way it pins `/api/recovery`.

**Not yours:** `tools/overseer/**` (except reading), `App.tsx` (the panel is already mounted),
`OverseerPanel.tsx`, and every other fleet file.

## Red first: the plan's Stage 2 list, every item

Write each test, run it and see it fail for the intended reason, then implement. Then mutate:

- let a POST through without an `Origin`;
- show **Resume…** on an `unknown` card;
- build manual instructions from a non-uuid;
- make the feed return `published` with no requests when the file fails to parse.

Each must turn a test red. Revert each.

## Gates

- the focused suites, plus every `tests/fleet-recovery-*` file, `tests/fleet-attention.test.ts` and
  `tests/fixture-ids.test.ts`: report the exit codes;
- `npm run build:fleet`: its exit code;
- `npm run typecheck`: read the **exit code**;
- `npx biome lint` on your files (never `--formatter-enabled`).

**Then the browser check.** Build a temp store holding a `recovery.json` and a
`recovery-resume.json`. You can drive `scripts/overseer-recovery-drill.ts` for the first, and write
the second by hand from the types. Cover:

- one interrupted supported record;
- one pending with a gate reason;
- one refused;
- one `resumed`;
- one `manual`;
- one `unknown`.

Serve it from your own fleet server on its own port, with `OVERSEER_STORE_DIR` pointed at the temp
store. Use Playwright on this box: read `docs/project/browser-control.md`, then
`docs/project/browser-testing-playwright.md`. The Playwright MCP cannot write screenshots outside
the repo: save them into the repo, copy them to the scratchpad, then delete them. At 1280 px and at
400 px, check:

- the confirmation opens and shows its three parts;
- a tap queues;
- a second tap says already requested;
- nothing is wider than the screen at 400 px;
- there are no console errors.

A POST against your temp store is fine. Check it wrote exactly one file under `pending/`.

## Report back

Briefly: the files, the red→green counts, the mutations and what they turned red, the gate exit
codes, what the browser check showed (and the screenshot paths in the scratchpad), every decision
the plan did not settle, and anything you needed outside your file set. Do not paste code.
