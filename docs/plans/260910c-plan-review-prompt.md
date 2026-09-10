# Review: a plan for making the fleet dashboard's per-session state follow the *execution* rather than the tmux handle

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/session-continuity` (a git worktree of
spideryarn2), branch `worktree-session-continuity`. TypeScript + ESM throughout; the dashboard's
browser code is React 18 under `tools/fleet/web/src/`, compiled by a second, DOM-only tsconfig
project that **cannot import anything touching `node:`**. Tests are vitest; the browser tests are
jsdom (`tests/fleet-web.test.tsx`, 10.6k lines).

## The candidate

Live pre-commit; nothing is built yet. This is a **plan review**, before any code.

The candidate is one untracked file:

- `docs/plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md`

(Not durable — I will record the commit SHA in the plan once it lands.)

Read it first. Then the code it plans to change, which is all committed and unmodified:

- `tools/fleet/execution-token.ts` — `executionTokenText`, `continuityOf`, `identityWriteGate`.
  The browser-importable half of execution identity, and the thing the plan builds on.
- `tools/fleet/execution-identity.ts` — where the reading comes from (node-only; read for context).
- `tools/fleet/web/src/types.ts` — `FleetRow` (see the `execution` field's own doc comment, which
  states this stage's requirement), `parseExecution`, `coherentWith`.
- `tools/fleet/web/src/SessionDetail.tsx` — the detail pane. `text`, `outcome`, `queueOutcome`,
  `answeringOff` are the state at issue; ~line 657 onwards.
- `tools/fleet/web/src/SessionsPanel.tsx` ~line 683 — `<SessionDetail key={selected.id} …>`, the
  line the plan proposes to change.
- `tools/fleet/web/src/RecentMessages.tsx` — `identityOf`, `Held`, `useRecentMessages` (~line 440
  onwards). The per-session transcript reader.
- `tools/fleet/web/src/FeedPanel.tsx` — `useFeed` (~line 95–130), the recent-messages feed reader.
- `tools/fleet/web/src/useActions.ts` — the `/api/actions` poll (whole file, 102 lines).
- `tools/fleet/web/src/transport.ts` and `useFleetState.ts` — the manners Stage 4 proposes to copy.
- `tools/fleet/web/src/NewSessionPanel.tsx` ~line 270–380 — the creation-poll deadline Stage 5 must
  preserve.
- `tests/fleet-web.test.tsx` ~line 5027–5250 (the conversation-claim regressions) and ~line
  5520–5900 (the discovery-deadline regressions) — the two Baseline regressions the plan promises
  not to redo.
- `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Session continuity"
  (~line 1258) — the six checkboxes and the acceptance paragraph the plan must actually satisfy.

Start with those; it is where to begin, not the limit of scope.

## What it is meant to do

Background, in case it is not obvious from the files: a tmux pane outlives the `claude` process
inside it. Across a replacement, the pane handle (`$1643`), the pane pid, and `CLAUDE_SESSION_ID`
are all unchanged — so the dashboard goes on drawing the *previous* run's state under the *new*
run's name: a half-typed message about to be sent to a stranger, the old transcript, the old action
outcome. `FleetRow.execution` (boot id + pid + `/proc` start ticks) is the one field that can tell
the two runs apart. Nothing consumes it in the browser yet. This plan makes the browser consume it.

The contract the plan must satisfy is the roadmap's acceptance paragraph, verbatim:

> suspend/resume preserves the right draft; a replacement session never inherits it; creation
> polling terminates under permanent failure; recent messages cannot show a previous execution as
> the current one.

Deliberately out of scope, and I want to know if you think any of these is wrong rather than merely
unstated: no server change; no localStorage (sessionStorage only for v1); no SSE work; no changes to
`collect.ts`, `live.ts`, `HealthPanel.tsx`, the Usage tab, or `tools/overseer/` (other agents are
editing those files right now).

## What you can and cannot run, and what you may change

**The tree is read-only.** This is a plan review: there is nothing to fix but prose. Do not edit any
file. /tmp and the node_modules caches are writable if you want a scratch harness. You can run one
test file (`npx vitest run tests/fleet-web.test.tsx` is large but runs) and a script
(`node --import tsx <script>`). You have no network, not even loopback.

## Attack it

Independently, before you read my own doubts at the bottom.

The invariant to break is this one, stated at what I believe is its true strength — please tell me
whether **this statement is accurate**, rather than whether the design is "sound":

> After this plan is built, no state the browser holds about a session — a draft, a transcript
> reading, an action outcome, a refusal — can be presented under, or delivered to, an execution
> other than the one it was created against, except while that execution's identity is
> *unverifiable*, during which the page holds what it has and presents nothing new.

Concretely, the scenarios I would most like attacked:

1. **The mount key.** The plan proposes keying `<SessionDetail>` on an epoch advanced only by
   `continuityOf(previous, current).kind === "replaced"`, holding on `unverifiable`. Is there a
   sequence of readings — including `claimed-only`, `conflicting` conversations, a row disappearing
   and returning, two different sessions selected in turn, and the `not-reported` arm from an older
   producer — that gets the wrong answer? Note `parseExecution`/`coherentWith` in types.ts: the
   browser can downgrade a reading, so what arrives is not always what the collector produced.
2. **The draft store.** Key `sy.draft.v1:<purpose>:<sessionId>:<token>` in sessionStorage; write
   through on every change; restore only when the current verified token matches the key; during an
   unverifiable gap keep writing to the last verified key for that session in this tab. Can a draft
   be shown to, or sent to, the wrong run? Consider: two tabs, a pid reused after a reboot (does the
   `boot` field actually close that?), a session id reused by tmux, and the case where the page is
   reloaded *while* the reading is unverifiable.
3. **The `answeringOff` split.** The plan splits one sticky flag into a dialog-scoped one and a
   page-scoped one. What is the correct key for "this dialog"? `row.question` is re-parsed from a
   fresh payload every 60 s, so object identity is useless; is there a stable signature on it, and
   does using it risk a *different* dialog with identical text being treated as the same one — and
   would that be wrong?
4. **The feed's evidence digest.** Stage 3 re-reads the feed when a digest over the rows changes
   (session set, status kind, question present, execution token), floored at 20 s and only while
   visible. Is that digest capable of firing in a loop, or of being so quiet that the feature is
   theatre? The plan claims the last-read clock is what keeps it honest — is that claim accurate?
5. **Whether the plan is worth building at all.** Reframing, reducing or cancelling a stage is a
   legitimate finding. If Stage 3 or Stage 4 costs more than it returns, say so.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract in this repo
        it contradicts
  - (b) the smallest change that closes it — exact replacement wording for the plan
A finding with no (a) goes last.

Severity, graded by consequence:
  P0  data loss, exploitable security, or the tool broadly unusable
  P1  user-visible wrong behaviour, or an authoritative contract violated
  P2  design or maintainability risk with no wrong behaviour today
  P3  non-behavioural prose or comment defect

Refuse only on an **established** P0 or P1 — direct evidence, no unresolved material inference —
and name what established it.

## My own suspicions, which are worth less than yours

These are already mine; spend most of the run elsewhere.

- I suspect the unverifiable-gap rule in Stage 2 ("keep writing to the last verified key") is the
  weakest paragraph in the plan, and that there is a sequence where it stores text typed at run B
  under run A's key.
- I suspect "meaningful new evidence" in Stage 3 is too weak to be worth the code — a session
  writing turns without changing status produces no evidence at all — and that the honest version of
  that stage might be *just* the last-read clock and the error arm, with the auto-refresh dropped.
- I am unsure whether `useRecentMessages`'s `identityOf` should include the token at all once the
  component is remounted on replacement, or whether that is two mechanisms for one job.
