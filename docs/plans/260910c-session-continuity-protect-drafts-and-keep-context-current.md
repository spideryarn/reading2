# Session continuity: protect drafts and keep context current

**Status:** planning · revision 2, after GPT Sol refused revision 1 · worktree `session-continuity`
· branch `worktree-session-continuity`

Roadmap stage: [260908f](260908f-overseer-and-fleet-improvement-roadmap.md) § *Stage: Session
continuity — protect drafts and keep context current*. Queue item `qi-aav3g688`, authorised by Greg
2026-09-09, dispatched by the Overseer 2026-09-10.

---

## What this is for, in one paragraph

A tmux pane is furniture. The `claude` running inside it can exit and be replaced any number of
times, and across that replacement the pane's handle, the pane's pid and `CLAUDE_SESSION_ID` are all
unchanged — so every address the fleet dashboard holds for a session goes on resolving, and every
piece of state the dashboard is holding *about* that session goes on being drawn. The half-typed
message you were about to send to the agent that was reasoning about your worktree is still in the
box. The previous run's transcript is still under the new run's name. The last action's outcome card
still says what happened, as though it happened to this one.

[Execution identity](../../tools/fleet/execution-identity.ts) landed on 2026-09-09 and is the key
that can tell the two runs apart: boot id, pid and the process's exact start tick, verified by
bracketing two process-table reads around one `/proc` read. It is on every row already
(`FleetRow.execution`), and its own doc comment names this stage's job in as many words:

> A page that keys anything to a session — a draft, a transcript heading, a measured age — compares
> this reading's token to the one it stored, and quarantines rather than continuing when they differ
> or when there is no reading.

Nothing does that yet. This stage makes the dashboard do it, and while it is in there, fixes the
three other ways the detail pane's context goes quietly out of date.

## Jargon, for anybody reading this cold

- **Execution token** — `boot:pid:startTicks`, the string that identifies one run of one process.
  `tools/fleet/execution-token.ts` is the browser-importable half: `executionTokenText`,
  `continuityOf` (same / replaced / unverifiable) and `identityWriteGate`.
- **Verified / unverifiable** — the box either could name the process under a pane durably, or could
  not. *Unverifiable is not a soft "same"*: it is the arm that must hold rather than act. It is also
  **common, not rare** — the probe's own tolerance was widened from 5 s to 15 s in September because
  slow collections on a loaded box were turning every row `unknown`.
- **Draft** — text a person has typed into a box and not yet sent.
- **The feed** — the Recent messages tab (`FeedPanel.tsx`), the last N messages across every
  session. Not the same thing as the per-session transcript in the detail pane.

## What this guarantees — stated at its true strength

Revision 1 of this plan claimed that after it was built, no state the browser held about a session
could be *presented under, or delivered to*, an execution other than the one it was created against.
**That was false and Sol refused the plan for it.** The corrected claim is:

> After this stage, no state the browser **holds and draws** about a session — a draft, a transcript
> reading, an action outcome, a refusal — can be **presented under**, or **restored for**, an
> execution other than the one it was created against. Whether a message **reaches** the run it was
> written for is not decided here and is not protected by this stage.

### The uncovered hazard, named rather than implied

**Delivery is not protected, and the server cannot currently catch it either.** Sol's F1, verified
independently against the source: `tools/fleet/steer.ts` § `verifyTarget` runs six checks against
the live box in the moment before it types, and an in-pane replacement passes all six. Check 4
compares the pane's pid, which belongs to the pane's *shell* and never died; check 5 requires a live
`claude --session-id <expected uuid>` under that pane, and the replacement is launched from that
shell reading `$CLAUDE_SESSION_ID`, which tmux pinned before the first claude ran and never
rewrites — so it presents the same conversation id on its own argv. Queueing is weaker again:
`routes-actions.ts` § `enqueue` records the session and conversation with no live execution check,
and the drainer delivers later against the same claims.

The repair is server-side and structural — every execution-bound steer, answer, action and queued
message carries the verified token from the row the person acted on; the server re-derives identity
immediately before sending, acting, enqueueing **and draining**, and refuses on mismatch or
unverifiability; queue items retain the token so a replacement invalidates rather than inherits
them. That is `steer.ts`, `routes-steer.ts`, `routes-actions.ts`, `queue.ts` and `drain.ts`, none of
which is in this stage's file set, and `queue`/`drain` is shared runtime. **Escalated to the
Overseer on 2026-09-10 as its own queue item, with Sol's exact proposed wording.** It is not built
here and this plan does not pretend it is.

## What is in scope, and what is emphatically not

In: `tools/fleet/web/src/` — the detail pane and its state, the composer's draft, the per-session
transcript reader, the recent-messages feed reader, `useActions`, `App.tsx` (F7), the two client
API seams `feed-client.ts` and `actions-client.ts` (F5), and their tests.

Out, and owned by other live sessions right now: `HealthPanel.tsx`, the Usage Limits tab,
`usage-feed.ts`, `live.ts` and the SSE transport, `collect.ts`, `health.ts`, `tools/overseer/`. Out
and escalated: the server-side write path named above.

**No server change is made.** The brief allowed read-side additions to `routes-recent-feed.ts` and
the transcript routes "if identity must travel in a request". It does not need to:
`GET /api/messages?id=$1643` is resolved server-side from the tmux handle, and every question this
stage answers is about state the browser holds, against a field already on the wire. (Sol's F1 shows
the server *does* need changing for a guarantee this stage does not make — see the hazard above.)

---

## The simpler option, and why it is most of the design

The obvious cheap fix is one character: mount the detail pane with a key that includes the execution
token instead of `key={selected.id}`. React then throws away the whole component — draft, outcome
cards, `answeringOff`, the held transcript — the instant the run changes, with no per-field
plumbing. It is right, and Stage 1 does exactly that. Two things stop it being the whole stage:

1. **Flicker.** The token is absent whenever the reading is not `verified`, which on a loaded box
   happens for a collection or two at a time. A key built naively from the token would read
   `T → "" → T` and remount twice, wiping whatever was being typed for a reason that is not a
   replacement. So the key is built from **the last token that was verified**, advanced only by
   `continuityOf(...) === "replaced"`.
2. **A remount cannot make a draft survive a reload**, and on a phone the page is reloaded every
   time iOS reclaims the tab. That is Stage 2, a different mechanism with a different failure mode.

Second simplification recorded: **the transcript reader gets identity of its own** rather than
relying on the remount. Sol's F3 is right that this is not redundancy — `useRecentMessages` is
exported, and its identity is *the* answer to "which agent is this reading about". Leaving that
answer wrong because one caller happens to remount would be a correct page resting on a caller's
good manners, the shape [RecentMessages.tsx § F18](../../tools/fleet/web/src/RecentMessages.tsx)
already refused once.

---

## Stages

Each ends green and committable. Every stage gets a GPT Sol review (`--sandbox workspace-write`; the
reviewer fixes inside the stage and reports wider).

### Stage 0 — plan review · **done**

- [x] Sol reviewed revision 1 read-only and **refused it**: F1–F3 and F5–F7 established P1s.
      Artefact: `sc-plan-review-answer.md` (contents transcribed into the ledger below).
- [x] Plan sha sent to the Overseer; F1 escalated as a separate queue item.
- [ ] Fable arbitrates the one product judgment F2 and F3 share (withhold vs caveat). Pending.

### Stage 1 — Detail state follows the execution, not the handle

Roadmap checkbox 1. Files: `continuity.ts` (new), `SessionsPanel.tsx`, `SessionDetail.tsx`,
`App.tsx`, `RecentMessages.tsx`, `tests/fleet-web.test.tsx`.

- [ ] `continuity.ts`: **`useExecutionEpoch(row: FleetRow | null)`**, called unconditionally, which
      keeps the last verified token **per `row.id`**. Its returned key always contains both the
      session id and that session's epoch (`JSON.stringify([row.id, epoch])`) so changing selection
      changes the key even when either reading is unverifiable. A first verified token establishes
      that session's baseline **without reporting a replacement**; the same token holds; a different
      verified token increments its epoch; an unverifiable or missing row **preserves but never
      updates** the baseline. (Sol F4, verbatim.) No imports but `react` and `../../execution-token`,
      so the DOM-only project can compile it.
- [ ] `SessionsPanel` mounts `SessionDetail` with that key. Red first: a replacement under one handle
      (same `id`, same `claudeSessionId`, different `execution.token`) clears the composer, the steer
      outcome card and the queue outcome card; a snapshot that goes `unknown` and returns with **the
      same** token clears nothing; switching between two sessions that are both unverifiable still
      changes the key.
- [ ] `identityOf` in `RecentMessages.tsx` — **wording pending Fable**, see the ledger. What is
      settled either way: a `conflicting` conversation reading must not go on presenting the held
      transcript as this session's, and an in-flight read is generation-discarded when identity
      changes.
- [ ] `answeringOff`, split into two with the right owners and the existing key (Sol F7, verbatim):
      `grants-permission` is keyed by `[row.id, verified execution token,
      questionSafetyKey(row.rawQuestion)]` and clears whenever that tuple changes, **including a
      transition through no question**. Use the existing `questionSafetyKey` in `types.ts` — it
      already mirrors the server's `sameQuestion` fields and distinguishes identical prompt text with
      different material; never object identity or prompt text alone. `answering-disabled` is a
      **page-level latch owned by `App.tsx`**, independent of selection, dialog and mode — `App`
      unmounts the Sessions panel on a mode change, so a latch held any lower is lost by switching
      tabs and back. It clears only after a state payload *received after the refusal* reports
      `answeringEnabled.kind === "enabled"`.

Done: a replaced execution inherits nothing; an unverifiable flicker costs nothing; a new dialog gets
its buttons back; a server-wide refusal survives a tab change.

### Stage 2 — Unsent drafts, per execution and per input

Roadmap checkbox 2. Files: `drafts.ts` (new), `SessionDetail.tsx`, tests.

- [ ] `drafts.ts`: `useDraft(purpose, key)` over **sessionStorage** — per tab, dies with the tab,
      survives the reload iOS forces. Key `sy.draft.v1:<purpose>:<sessionId>:<token>`; `purpose` is
      in the key because two boxes on one screen must not share a draft.
- [ ] Access through `window.sessionStorage`, never the bare global: under jsdom the bare name is
      shadowed by Node's own and reads `undefined`, which is how a guard passes its tests and fails
      in a browser. Safari private mode throws on the *accessor*, not only on write; a full quota
      throws `QuotaExceeded` on write. Both fall back to memory for the life of the page, and the
      composer says once, quietly, that the draft will not survive a reload — a caveat that changes
      what you would do in the next ten seconds (finish the message now), which is the bar
      `SessionDetail.tsx`'s clutter rule sets.
- [ ] Only the person's own typing is stored, capped at 8 kB, so a pasted transcript can neither
      fill the quota nor sit in storage. Nothing else: no transcript, no server payloads, no
      identifiers beyond the key.
- [ ] A **Clear** control beside the composer: empties the box and removes the stored draft. A
      successful send already clears the box and now also removes the stored draft.
- [ ] **The unverifiable gap — wording pending Fable**, see the ledger. Revision 1's rule ("keep
      writing to the last verified key") is **dead**: Sol's F2 showed it binds text typed at run B
      into run A's storage key, which is the exact failure this stage exists to prevent.
- [ ] Tests: suspend/resume restores the draft; a different token restores nothing and leaves the
      old draft unread in storage; storage that throws on the accessor, on `getItem`, and on
      `setItem`; Clear removes the key; over-cap text is not stored.
- [ ] **v1 wires one input**: the session composer, the one that can reach a stranger's terminal.
      `purpose` exists so the Overseer message card and the broadcast box are one line each later;
      both are page-level rather than execution-level and are not part of this stage.

**Not built, and it is Greg's call, not mine** (Overseer ruling, 2026-09-10 — logged as an
assumption pending Greg rather than decided):

> **localStorage instead of sessionStorage.** What it buys: a draft survives *closing* the tab, not
> just the reload iOS forces — so a message half-written on the phone last night is still there this
> morning. What it would need: an expiry we would have to pick, a Clear (already built), and the
> same 8 kB cap. What it risks: text typed at an agent outliving the session it was meant for, on a
> browser that may be shared or borrowed, with no session boundary to end it. One line from Greg
> settles it either way.

### Stage 3 — The feed knows when it last read, and re-reads on evidence

Roadmap checkbox 3. Files: `FeedPanel.tsx`, **`feed-client.ts`** (F5), tests.

Today `useFeed` fetches on mount and on the button, has a generation guard, and has **no clock, no
error state and no abort**. A feed read costs the box ~250 ms and ~10 MB of transcript reads, so it
must not become a poll; but a tab left open for an hour shows an hour-old list with nothing saying
so. Retained as the roadmap wrote it — the Overseer's ruling, 2026-09-10, and Sol agrees it is worth
keeping: status, dialog, conversation, world and execution changes are high-signal triggers, and the
last-read clock makes staleness visible rather than making the feed current.

- [ ] An explicit **last read** clock, drawn in the panel. The load-bearing half: it is what keeps
      every other honesty claim on this panel true under a stale read.
- [ ] Failures kept and drawn, last good feed left underneath — the `useFleetState` rule. A feed you
      cannot currently read is not an empty feed.
- [ ] **The API seam** (Sol F5): `FeedApi.recent(limit, signal?)` passes the signal to `fetch`. An
      `AbortController` confined to the hook cannot abort a fetch the hook does not make.
- [ ] One request in flight; a refresh asked for during one schedules exactly one more attempt. The
      hook **races the API promise against its own deadline**, so timeout settlement and
      pending-refresh progress do not depend on a test double honouring abort, and it
      generation-discards any late result. Effect teardown and a world change abort the controller.
- [ ] Re-read on a **canonical digest** (Sol F6, verbatim): `tmuxServerPid` plus rows sorted by id,
      each as `[id, claudeSessionId, status.kind, questionSafetyKey(rawQuestion),
      execution-verdict]`, where a verified verdict contains `executionTokenText(token)` and every
      unverifiable arm contains only its stable kind/cause — **never the prose `why`**, which
      changes wording between collections and would fire the digest for nothing. The initial read
      establishes the baseline. Evidence arriving inside the 20 s floor schedules exactly one
      trailing read at the earliest permitted time; further changes coalesce into it, and visibility
      is re-checked when it fires. A tmux-server change takes the same discard-and-read path. This
      cannot loop, because the digest depends only on `/api/state` — a feed result and `lastReadAt`
      do not alter it.
- [ ] And the panel must **not** claim more than that: a working session that writes ten turns
      without changing status produces no evidence at all. That is why the clock is the first item
      and not the last.

### Stage 4 — `useActions` gets the transport's manners, and says how old it is

Roadmap checkbox 5. Files: `useActions.ts`, **`actions-client.ts`** (F5), **`SessionDetail.tsx`**
(F8), tests.

`/api/actions` is the server's own memory — the vocabulary and the queues — a different resource,
cost and clock from `/api/state`. It polls every 10 s and skips a hidden tab; it does not refresh on
becoming visible or on coming back online, drops a refresh asked for while one is in flight, has no
timeout or abort, and offers no age for its last good feed.

- [ ] Refresh on `visibilitychange` → visible, and on `online`.
- [ ] A refresh during an in-flight request schedules one fresh attempt instead of returning.
- [ ] `ActionsApi.feed(signal?)` (F5), plus the same promise-versus-deadline race, so a request that
      never settles cannot stop the poll for ever.
- [ ] `lastGoodAt`, **and something that draws it** (Sol F8 — a returned field nothing renders is
      not the fix the plan claimed): the actions feed's last-good age and current error go beside
      the SessionDetail action and queue surfaces, last good feed retained underneath. The Health
      and Overseer consumers are out of scope and may adopt the field in their own work.
- [ ] Unchanged, and asserted: it never touches `/api/state`, and confirming an action never
      refreshes the target's identity as a side effect — `routes-steer.ts`'s whole guard is that the
      claims it checks are the person's, and a client that re-read them would have the box checking
      itself against itself.

### Stage 5 — The regressions, the decision, and the browser

Roadmap checkboxes 4 and 6.

- [ ] Extend, do not redo, Baseline's two: the creation-polling **absolute discovery deadline**
      (`NewSessionPanel.tsx`) and the conversation-claim refresh. New cases: **a poll begun before
      the absolute deadline but resolving after it must not update the launch or erase the give-up
      state — the absolute deadline wins, the late result is discarded, and no further poll starts**
      (Sol F9: revision 1 said "a session discovered after the deadline" without naming a winner);
      the panel unmounted mid-poll; a duplicate tap on Launch. The existing tests stay as they are.
- [ ] Decide the **Sessions text filter**. The roadmap says *only if the current list makes finding a
      known task cumbersome*. Evidence so far: the box carries **25 tmux sessions** today, drawn in
      three bands with five orders available, one column on a phone. Judgment and reasoning recorded
      here; built only if the answer is yes.
- [ ] Browser check in a Sonnet subagent with Playwright on this box, per
      `docs/project/browser-control.md`: 390 px and desktop, keyboard-only, and returning from
      offline. Against this worktree's own dev server on its own port — **never the live dashboard**,
      and the subagent is told to kill only its own pid.

**Acceptance for the whole stage** (roadmap, unchanged): suspend/resume preserves the right draft; a
replacement session never inherits it; creation polling terminates under permanent failure; recent
messages cannot show a previous execution as the current one.

---

## The review ledger

Round 1, GPT Sol, 2026-09-10, on revision 1. Verdict: **refuse**. Sol also ran
`npx vitest run tests/fleet-web.test.tsx` itself: 430 tests passed.

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F1 | Browser-only identity cannot protect *delivery*; `verifyTarget` and `enqueue` both pass an in-pane replacement | P1 established | **Gap taken, repair escalated.** Invariant narrowed above; hazard named; server work sent to the Overseer as its own queue item. Outside this stage's file set. |
| F2 | The unverifiable-gap draft rule binds run B's text into run A's storage key | P1 established | **Accepted — revision 1's rule is dead.** Replacement wording pending Fable (withhold vs caveat). |
| F3 | Adding only the token leaves transcript quarantine incomplete: `coherentWith` can keep a verified token while downgrading the conversation to `unverifiable`, and a `conflicting` conversation does the same | P1 established | **Partly accepted.** The `conflicting` case is real and will be handled. Sol's blanket rule — no identity, no read, no held view unless `identityWriteGate` allows — is **contested**: on a loaded box it would blank every session's transcript, against `RecentMessages.tsx`'s stated purpose. Pending Fable. |
| F4 | The mount key's selection domain is underspecified | P1 reasoned | **Accepted verbatim**, Stage 1. |
| F5 | Stages 3 and 4 cannot abort through APIs that take no `AbortSignal` | P1 established | **Accepted verbatim.** `feed-client.ts` and `actions-client.ts` added to scope, plus the promise-versus-deadline race. |
| F6 | The feed digest omits `claudeSessionId` and `tmuxServerPid` | P1 established | **Accepted verbatim**, Stage 3. |
| F7 | `answeringOff` needs `questionSafetyKey` and a genuinely page-level owner in `App.tsx` | P1 established | **Accepted verbatim**, Stage 1. Found an existing helper I was about to reinvent. |
| F8 | `lastGoodAt` planned as a field nothing renders | P2 established | **Accepted verbatim**, Stage 4. |
| F9 | The late-discovery regression names no winner | P2 reasoned | **Accepted verbatim**, Stage 5. |

## Risks, and what would catch each

- **A remount that fires on flicker** wipes a draft mid-typing and looks like the tool eating your
  words. Caught by the Stage 1 test that pushes an `unknown` reading between two identical verified
  ones and asserts the key did not move.
- **A draft restored under the wrong run** renders perfectly. Caught by keying storage on the token:
  there is no path that reads a draft without a matching verified token, so the bug would have to be
  a wrong token rather than a wrong comparison. F2 was exactly this bug in the plan, found before it
  was code.
- **The feed becoming a poll** by accident. Caught by a test that pushes twenty identical snapshots
  and asserts one read, and by the 20 s floor being a constant a test can read.
- **An abort that aborts nothing** — F5's shape, where a controller is created in a hook that does
  not own the fetch. Caught by asserting the signal reaches the client, and by the deadline race
  that makes the hook correct even when it does not.
- **Storage that throws on access** is invisible on this box and normal on a phone in private mode.
  Caught by tests that stub `window.sessionStorage` to throw on the accessor, on `getItem` and on
  `setItem`.
- **A green suite that proves nothing.** Everything here is written red first. Baseline recorded
  before any change: `fleet-web`, `fleet-feed-panel` and `fleet-execution-identity`, **535 tests,
  exit 0**. The two environment reds in a fresh worktree (`cold-start-lazy-imports`,
  `pdf-bundle-trace`) are expected and are not mine.

## Decision log

- 2026-09-10 — **No server change in this stage**, and the guarantee narrowed to match. The delivery
  hazard is real, verified, escalated, and named above rather than papered over.
- 2026-09-10 — Remount on a *replaced* verified token rather than threading an identity through five
  pieces of state. Simpler, and it is `continuityOf` used as designed. The transcript reader keeps
  an identity of its own anyway, because it is exported (F3).
- 2026-09-10 — sessionStorage for v1. localStorage is a retention question for Greg, written above
  as a one-line decision rather than a default. Overseer's ruling.
- 2026-09-10 — Stage 3's evidence-driven refresh **retained**, not reduced to the clock alone.
  Overseer's ruling; Sol concurs that the triggers are high-signal.
