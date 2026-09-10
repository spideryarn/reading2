# Stage 2 task: the route and the panel's first control

You are implementing Stage 2 of
`docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md` in the
worktree `/home/greg/code/spideryarn2/.claude/worktrees/recovery-resume` (branch
`worktree-recovery-resume`).

**Read the whole plan first.** Its section **"Review dispositions: Sol, plan round 1" overrides
§1–§7 wherever they differ**, and this brief follows the dispositions. G9 especially: there is no
separate resume file, feed or GET route.

Then read the inventory's fleet side, which you are extending and should imitate:

- `tools/fleet/recovery-feed.ts` and `tools/fleet/routes-recovery.ts`;
- `tools/fleet/web/src/recovery-client.ts` and `tools/fleet/web/src/RecoveryPanel.tsx`;
- their tests, `tests/fleet-recovery-*.test.ts*`;
- `tools/fleet/routes-new.ts`, for `checkRequest` (a same-origin `Origin` and a JSON content type,
  which is the CSRF defence) and for how a mutation route is written here.

**Rules of the tree.**

- Work only in this worktree.
- Do not commit, push, or run any git command that changes state (checkout, restore, stash, reset,
  clean).
- Another subagent is building Stage 1 (`tools/overseer/recovery-resume*.ts`, `daemon.ts`,
  `store.ts`) in this same worktree at the same time. Do not edit its files, and expect its
  half-finished files in a full typecheck.
- Read files outside the worktree only through Bash, never the Read tool.
- **Never touch the live dashboard on port 8787, the live daemon, or `~/.overseer`.** For the
  browser check, start your own server on a port of your own, from a temp store, and **kill only
  your own PID** when you are done. Never `pkill` by name: other agents' servers are running.

## What this stage is for

The recovery panel gets its first control. For an `interrupted` record whose resume is `supported`,
and whose preview has a **pinned account**, **Resume…** opens an inline confirmation. It shows:

- what the session was doing: the brief, and where it got to;
- what we cannot be sure of;
- the account it will run under;
- the exact nudge that will be typed.

Its button queues one request. Each record then shows its request's state. Other records get manual
instructions, or nothing. The footer says what the one control does.

## The contract you build against

- **Types**: the block headed "Gradual recovery: resume requests" in `tools/fleet/wire.ts`. That is
  `RecoveryResumeSection` (the new required `resume` field of `RecoveryFeed`'s `published` arm),
  `RecoveryResumeProjection`, `RecoveryResumeRequestState` (seven arms), `RecoveryResumePreview`
  (with `account`), `RecoveryResumePostBody` and `RecoveryResumePostAnswer`.
  - Follow them exactly. If you truly need a change, make it and say why.
  - **Typecheck is red in `recovery-feed.ts` until you produce `resume`. That is your first job.**
- **The request leaf**, `tools/overseer/recovery-resume-request.ts`, which Stage 1 is writing. It
  exports:
  - `RECOVERY_RESUME_DIR` and `CANDIDATE_ID_PATTERN`;
  - `writeResumeRequest(root, { candidateId, requestedAt, actor, seen }) → { kind: "written"; path }
    | { kind: "refused"; why }`;
  - `pendingFor(root, candidateId) → boolean`.

  Request files are nonce-named, so a second tap writes a second file. **The launch occurrence is
  the duplicate guarantee, not the route.** If the file is not there yet when you need it, write
  against this API and check back. **Do not write your own copy.** Importing it from `tools/fleet/`
  needs one entry in the allowlist in `tests/fleet-attention.test.ts` (~425–450, and the test at
  ~616). Add it there with a sentence saying why it passes the test: its closure is node builtins
  only, and it never reaches the store.
- **The store root**: resolve it exactly the way `recovery-feed.ts` does. Reuse that function; do
  not copy it.

## Files (yours)

**`tools/fleet/recovery-feed.ts`**: parse the optional top-level `resume` field of `recovery.json`
into `RecoveryResumeSection`, with a strict validator of its own.

- Absent is `absent`. A malformed field is `unreadable`, and it names what was wrong. An unknown
  schema is `unsupported-schema`.
- **A bad `resume` field never changes the `records`, `view` or any other part of the feed.** Test
  that explicitly.
- Cross-check against the records: a `resume` request or preview for a candidate id the file does
  not hold is `unreadable`, in the same spirit as the inventory's F29.

**`tools/fleet/routes-recovery-resume.ts`** (new): **POST `/api/recovery/resume` only** (the GET is
gone: the page reads `/api/recovery`).

- It runs `checkRequest`, reads a bounded body, validates `RecoveryResumePostBody`, and checks
  `candidateId` against `CANDIDATE_ID_PATTERN`.
- If `pendingFor` is true, it answers 200 `already-requested` and writes nothing (a courtesy, not a
  guarantee). Otherwise it calls `writeResumeRequest` with `actor: "dashboard"`, and answers 202
  `queued`.
- A bad body is 400, a bad origin 403, and `refused` 409. Every other method is 405.
- **It never launches, and never reads tmux or the launch store.** `already-launched` needs the
  projection: read `recovery.json`'s `resume` through `recovery-feed.ts`. If it shows the candidate
  launched or resumed, answer 200 `already-launched` and write nothing.

**`tools/fleet/server.ts`**: one dispatch branch beside `/api/recovery`'s, **approved by the
Overseer**. Keep it a separate, minimal hunk. `access-review` may be restructuring this file's
handler construction tonight, so re-read it immediately before the edit.

**`tools/fleet/web/src/recovery-client.ts`**: parse the new `resume` section browser-side, with the
same arms. It rejects contradictions, for example two request states for one candidate, or a
`resumed` state beside a pending one for the same candidate. Add a `post` for the route.

**`tools/fleet/web/src/RecoveryPanel.tsx`**: small targeted edits; this file is yours now.

- **Resume…** appears only when all of these hold:
  - the card is `interrupted`;
  - its evidence says `resume.kind === "supported"`;
  - the section is `published` with `launcher.kind === "wired"`;
  - its preview's `account.kind === "pinned"`.

  Otherwise:
  - supported, but unwired or with no pinned account: the manual instructions, plus one line saying
    why the page cannot resume it;
  - section `absent`: one quiet line, "Resume is not available from this dashboard yet";
  - section `unreadable` or `unsupported-schema`: an alarm banner above the list. **The list itself
    is unchanged.**
- **The inline confirmation** (not a dialog). It shows:
  - the brief and the last words, **as labelled quotations**;
  - the uncertainty list;
  - "Runs under account ‹name›";
  - the nudge, verbatim;
  - the directory;
  - the line "Starts one session. Any others you pick wait until this one is verified running";
  - a **Resume this session** button, disabled while the POST is in flight.

  A lost answer is covered by the next poll. A second tap answers `already-requested`, and the
  page says so plainly.
- **A state line for each of the seven `RecoveryResumeRequestState` arms**, in plain words:
  - `pending`: its `why` and `until`;
  - `launched`: its `waitingFor`, with the four verification parts shown as ticks;
  - `ended-unverified`: its `how`;
  - `needs-greg`: its `why`, and `disposeCommand` as display text in a code element;
  - `refused`: its reason, with **Resume…** offered again;
  - `disposed` and `resumed`.
- **The pace line**: when the projection's `pace` is `waiting-for-verification`, one line at the
  top of the list names the session everything is waiting for.
- **Manual instructions**, for `resume.kind` `not-supported` with a verified conversation, and for a
  supported record the page cannot resume: `gjd-remote ssh`, then `cd ‹dir›`, then
  `CLAUDE_CONFIG_DIR=‹configDir› claude --resume ‹uuid›` when the account is pinned, or with a note
  that the account's config directory must be the one holding the transcript when it is not.
  - Build them only from a uuid matching a strict uuid regex, and shell-quote the paths.
  - They are display text in a code element, never a link.
  - `manual` keeps today's host-and-directory text.
- **No control of any kind** on `unknown`, `present-but-unmatched` or `ended-before-reboot`.
- **The footer**, replaced with the plan's §5 wording exactly.

**Tests**: `tests/fleet-recovery-resume-route.test.ts` and
`tests/fleet-recovery-resume-panel.test.tsx`, on the existing recovery panel tests' harness.
Extend `tests/fleet-recovery-feed.test.ts` for the `resume` section, and
`tests/fleet-recovery-wiring.test.ts` so it pins the new POST route's dispatch in `server.ts`, the
same way it pins `/api/recovery`.

**Not yours:** `tools/overseer/**` (except reading), `App.tsx`, `OverseerPanel.tsx`, and every other
fleet file.

## Red first

The plan's Stage 2 list, adjusted by the dispositions:

- the POST refuses a missing `Origin`, a foreign `Origin` and a non-JSON body;
- `already-requested` and `already-launched` write nothing;
- the `resume` section's arms, including that a malformed section leaves `records` intact;
- the button appears only under the four conditions above;
- each of the seven state arms renders;
- manual instructions are never built from a non-uuid;
- the footer says what the control does.

Write each test, run it and see it fail for the intended reason, then implement. Then mutate the
finished code:

- let a POST through without an `Origin`;
- show **Resume…** with an unknown account;
- build manual instructions from a non-uuid;
- let an unreadable `resume` section blank the records.

Each must turn a test red. Revert each one.

## Gates

- the focused suites, plus every `tests/fleet-recovery-*` file, `tests/fleet-attention.test.ts` and
  `tests/fixture-ids.test.ts`: report the exit codes;
- `npm run build:fleet`: its exit code;
- `npm run typecheck`: read the **exit code** and list every error. Stage 1's half-finished files may
  add some; say which are whose;
- `npx biome lint` on your files (never `--formatter-enabled`).

**Then the browser check.** Build a temp store holding a `recovery.json` with a `resume` field. You
can drive `scripts/overseer-recovery-drill.ts` for the base file, then add `resume` by hand from
the types. Cover:

- one interrupted supported record with a pinned account and a wired launcher;
- one pending with a gate reason;
- one refused;
- one `needs-greg`;
- one `resumed`;
- one supported with an unknown account (manual only);
- one `manual`;
- one `unknown`.

Serve it from your own fleet server on its own port, with `OVERSEER_STORE_DIR` pointed at the temp
store. Use Playwright on this box: read `docs/project/browser-control.md`, then
`docs/project/browser-testing-playwright.md`. The Playwright MCP cannot write screenshots outside
the repo: save them into the repo, copy them to the scratchpad, then delete them.

At 1280 px and at 400 px, check:

- the confirmation opens and shows its parts;
- a tap queues, and exactly one file appears under `pending/`;
- a second tap says already requested;
- nothing is wider than the screen at 400 px;
- there are no console errors.

## Report back

Briefly:

- the files;
- the red→green counts;
- the mutations, and which tests each turned red;
- the gate exit codes;
- what the browser check showed, with the screenshot paths in the scratchpad;
- every decision the plan did not settle;
- anything you needed outside your file set.

Do not paste code.
