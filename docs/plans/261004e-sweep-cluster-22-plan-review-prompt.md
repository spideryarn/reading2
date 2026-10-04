# Review: a plan to move the live conversation's tap-to-talk decisions into a pure module, before it is built

You are reviewing a plan before it is built. Read-only: do not edit any file.

Repo: this worktree, branch `worktree-sweep5-c22-live-tap-policy` (TypeScript, ESM, React client).
Base `origin/dev` at `0a98b28ab`.

## The candidate

Live pre-commit: two untracked files,
`docs/plans/261004e-sweep-cluster-22-live-tap-policy-as-a-pure-function.md` (the plan) and this
prompt. Nothing else has changed.

Read the plan, then the code it changes: `src/web/live/useLiveConversation.ts` (`TalkMode`, the
`TAP_*` constants, `sendTap`, `detectorOff`, the `input_audio_buffer.committed` handler, the `error`
handler's tap branch, the `response.created` handler, the mode reset in `start`, and
`enterTapToTalk` / `talk` / `doneTalking`), `src/web/live/LiveStatus.tsx` (the Talk button's
`disabled`), the existing tests in `tests/live-session-flow.test.tsx` from line 2225, and the pure
siblings it would sit beside (`src/web/live/stall.ts`, `tail.ts`, `mic-placement.ts`).

The evidence is `docs/investigations/261003b-fifth-sweep-web-client.md` § W10 and your own earlier
review, `docs/investigations/261003b-fifth-sweep-review-sol-on-server-and-web.md` (the W10 bullet).

## What it is meant to do

No behaviour change. Four decisions leave the hook for `src/web/live/tap.ts`; the hook keeps the
effects. One `clearTimeout` is added to `stop`.

## What I want from you

Independent pass first.

- Is the extraction worth its keep at all, by the deletion test (does it concentrate complexity
  behind a smaller interface, or spread it)? "Drop it" or "do less" is an acceptable answer; say
  which of the four functions earn their place and which do not.
- Is each proposed signature able to express what the code does today, exactly? Name any branch of
  today's code the proposed function cannot reproduce.
- Walk the sixteen (event kind × mode) cells of the `error` handler's tap branch as it is today.
  Is any reachable cell wrong today (a live defect the extraction would preserve)? If so, give the
  event sequence that reaches it.
- Is sharing `mayTalk` between the handler (refs) and `LiveStatus` (rendered state) sound, or do
  the two sources differ in a way that would change when the button is disabled?

Severity: P0 data loss, security, wrong charging, service unusable · P1 user-visible wrong
behaviour or an authoritative contract violated · P2 design or maintainability risk · P3 prose.
Mark each finding *established* (direct evidence) or *reasoned*. Give each an ID, F1, F2, ….
For each: (a) the concrete scenario or contract it fails, (b) the smallest change that closes it.
Refuse only on an established P0 or P1.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. `LiveStatus` disables Talk on `live.thinking || live.speaking || pendingTools.length > 0`; the
   handler refuses on `toolResponses.current.responding || speakingNow.current ||
   toolRequests.current.size > 0`, plus a pending `doneTimer`. Are those the same facts?
2. An `entry` refusal that arrives after the reader has already pressed Talk and Done (mode
   `tap-sending`, commit sent, reply owed): the mode goes back to hands-free but `owedSince` is not
   cleared and no `response.create` follows. Reachable in practice? Worth fixing here?
3. Is clearing `doneTimer` in `stop` really behaviour-neutral, given the hang-up grace window?

Do not change any file.
