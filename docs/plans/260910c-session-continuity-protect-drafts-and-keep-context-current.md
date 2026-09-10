# Session continuity: protect drafts and keep context current

**Status:** in progress · revision 3 of the plan, after GPT Sol refused revision 1 and Fable
arbitrated · worktree `session-continuity` · branch `worktree-session-continuity`

**Where it stands, 2026-09-10.** Pushed to `dev` at `536b1b68` after all 95 `tests/fleet-*` files
passed on the tree merged with `origin/dev` and `npm run typecheck` was exit 0: Stage 1 and its
two follow-ups, Stage 2a, Stage 3 (closed), Stage 4a and Stage 5a. **The Overseer restarted the
dashboard on `536b1b68` at 12:45Z** (its decision log, `1209bc70`), so all of that is live —
including one tap on Start launching one session — and it chose to restart before Stage 1's second
Sol round closed, on the grounds that the round re-checks four fixed P1s rather than reopening the
design. **That premise did not hold**: round 2 found five new P1s (F17–F21) in the code the
restart put live — all rare or cosmetic, none dangerous — and the Overseer was told so. **It
restarted again at 14:50Z on `67d28c58`** (decision log `2cf2b4c5`), which put live Stage 1's
round-2 fixes and the shared single-flight reader, and logged its own lesson: *"restart on closed
rounds, or say the code is one round short when restarting early."* **Stage 1 is closed** (two Sol
rounds and an independent check of the round-2 fixes). **Stage 3 is closed** (two rounds).
**Stage 5 is closed** (one round, accepted, no P0/P1). **On `dev` since the 14:50Z restart, not yet
live:** Stage 2b (`0e3d92c0`), 4b (`cd35abac`), 5c (`c2d1c191`), the abort follow-up (`f5fe6fec`)
the Playwright traps doc (`7411ca37`), **the verified Stages 2+4 fixes (`16e54022`) and Stage 5's F80
fix (`32389249`)** — all pushed to `dev` at `5e8df0da`, after all 100 fleet and doc-link test files
passed on the tree merged with `origin/dev` and typecheck was exit 0. **The browser check passed
every Stage 1–4 bullet.** **Stages 2, 4 and 5 are closed**: 2 and 4 on an independent Opus
verification of GPT Sol's fixes from a review killed at its timeout, 5 on one Sol round. **Committed
with this status line:** F29, the limit that verification found, and F30, the one F29's implementer
found — both built by Opus, red-first, with no cross-family review. **F31**, found last and
deliberately not fixed, is the named follow-up where the drafts chain stops. **Still to do:** the
full suite, and the debrief. **For Greg:** the
Sessions text filter and the page's touch targets, below.

**One P3 note on Stage 5's F80 fix, left as it is:** its `rejectedStart` helper in
`NewSessionPanel.tsx` repeats `describeError` from `transport.ts` almost word for word, so there are
now two spellings of "a thrown thing, as a sentence". Not worth reopening a closed stage for; the
next change to either should import the one from `transport.ts`.

**Stage 5c — built.** An Opus subagent; eight tests in a new `tests/fleet-detail-reader.test.tsx`,
the ones that could fail seen red, the rest proved by mutation. *Read again* now uses the shared
single-flight reader — one per effect run, keyed on the api and the identity, stopped on teardown —
rather than a third copy of the mechanism. A tap in the frame before the button disables is
**dropped, not coalesced**: it is a duplicate of the tap that just started the read, and a trailing
read would be a second multi-megabyte disk read for a sub-second freshness gain. It adds a 30 s
deadline (`MESSAGES_READ_DEADLINE_MS`) where there was none, so a read that never answers no longer
leaves "Reading…" on screen for the life of the tab. It found one late-discovery sequence nothing
covered — every `fleet-web` identity test goes through `App`, where a claim change also remounts
the reader, so none could see the hook's own logic — and added it. The detail pane's focus target is
now a named `<section>`, implicitly a `region`, so its label is announced; biome clean on those lines.
**Its one flag, taken as a follow-up:** `MessagesApi.recent` takes no abort signal, so a read the
page abandons still finishes on the server — the same class as F5 for the feed.

**The abort follow-up — built** (`f5fe6fec`), an Opus subagent. `MessagesApi.recent(row, signal?)`
hands the signal to `fetch` only when it is defined, the shape F5 set for the other two feeds.
**It found the step the brief did not name:** `App` hands the page the messages API wrapped in
`withClockSkew`, not the API itself, and that wrapper dropped the signal — so tests written against
the hook alone would have passed while the production read stayed uncancellable. The wrapper now
passes it on, with one test on the wrapper and one that mounts the real `App`. Seven of the eight
new tests were red before any source change, and each abort test also asserts the signal was *not*
aborted a moment earlier, so a signal that is always aborted cannot pass.

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
> reading, an action outcome, a refusal — can be **presented under**, or **restored for**, a
> conversation other than the one it was created against, **among the changes the browser has
> evidence for**. Whether a keystroke **reaches** the right conversation is not decided here: the
> server decides it, freshly, at the moment of the write.

**The evidence clause is Sol's F15, and it is a limit, not a gap to close later.** A replacement that
happens entirely inside readings the box could not verify — a session first seen unverifiable,
replaced, and then verified for the first time as the new run — leaves the browser no evidence that
anything changed, so nothing on the page can detect it. The only way to guarantee otherwise is to
withhold or discard everything created before the first verified reading, which is Sol's F2/F3 rule
that Fable's arbitration declined: on this box that would blank the dashboard in exactly the weather
it is most needed. Stage 2's drafts are safe regardless — they persist only under a verified
conversation and restore only under a live verification of the same one — so what this limit can
leave behind is an outcome card, not a message.

### Delivery — what the server already protects, and the one thing it does not

**This section was wrong in revision 2 and the correction matters more than the original claim.**
Revision 2 said, on Sol's F1, that a message could be delivered into a *stranger's* conversation
because `verifyTarget` checked identifiers that survive a replacement. Fable caught it and the code
settles it:

`tools/fleet/steer.ts` § `readCandidates` (~915) reads each candidate's **live**
`/proc/<pid>/cmdline`, and `isClaudeForSession` (~810) requires an interactive `claude` whose
distinct `--session-id` set is exactly the claimed uuid —
`const ours = distinct.size === 1 && distinct.has(claudeSessionId)`. It is not the tmux-env claim
that is compared; it is the live argv of whatever is actually under the pane. A replacement running
a different conversation is `other-claude` → `competing-claude`, refused. `claude --resume <uuid>`
is refused too, because `claude-argv.ts` keeps only `--session-id` values and `--resume`'s value is
optional and deliberately unread. **And the drainer is covered**: `SendCoordinator.message` →
`steer.ts` § `sendMessage` (line 1323) → `verifyTarget`, so a queued item is re-verified against a
fresh reading at delivery rather than against what was true at enqueue. Sol's observation that
`enqueue` performs no execution check is correct and does not matter, because `drain` does.

So what passes `verifyTarget` is a **same-conversation relaunch**: a new process running
`claude --session-id <the same uuid>`. Not a stranger — the conversation the person was reading.

**The residual gap, sized honestly.** A relaunched agent has lost its in-memory context, so *"yes,
go ahead with that"* can land in the right conversation at an agent that no longer knows what
*that* was. Real, much smaller than revision 2 claimed, and plausibly a caveat rather than a
refusal. Plus the pid-recycling race already written down and accepted in `steer.ts` § KNOWN GAPS.
Sent back to the Overseer on 2026-09-10 with a recommendation to drop or heavily re-scope the queue
item raised off revision 2.

**What this stage is therefore about.** Not where a keystroke lands — the server settles that,
freshly, at the moment of the write, which is exactly what `identityWriteGate`'s own header says a
cached `allowed` may not be trusted for. This stage is about **what the page holds and draws**: a
draft, a transcript, an outcome, a refusal. The server's freshness check protects the keystroke's
destination and says nothing about what is on the screen, so the misattribution this stage fixes is
entirely uncovered by it.

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

## Withhold, caveat or relabel — Fable's ruling, 2026-09-10

Sol's F2 and F3 both wanted the page to **withhold** whenever the execution is not verified: no
typing, no sending, no transcript, "Read again" disabled. I thought that too strong and would not
overrule a P1 on my own judgment, so Fable arbitrated. Its principle, and this plan now follows it:

> **Withhold what you would be inventing. Caveat what you have but cannot place. Relabel what you
> have and can place somewhere else.**

The argument that decided it: *"not verified"* is not one state, and Sol's rule collapses two.

- **Cannot tell** (`unknown`, `claimed-only`, or verified-with-`unverifiable`-conversation) — no new
  fact has arrived; the page knows exactly what it knew before this stage existed. On this box,
  absence of confirmation is *the weather*, not evidence of replacement, and `wire.ts`'s own type
  comment says so: *"none of them means there is nothing running."* A page that goes dark in the
  weather is a page you cannot use when you most need it.
- **Can tell, and it is different** (`conflicting`, `not-claimed`, or a non-addressable harness) — a
  fact has arrived. Here the page acts, under the rule Fable already set for shells on 2026-09-08: a
  control the page *knows* will be refused is not offered.

| Reading | Transcript | Type | Send / Queue | Draft |
|---|---|---|---|---|
| verified + conversation verified | show | yes | live | persist, keyed by conversation id |
| cannot tell | show + caveat (`StaleNote` stands) | yes | live, one line beside Send | keep in memory |
| `conflicting` | show, **relabelled** as the previous conversation, alarm tone | yes | **disabled**, with the gate's sentence | keep on screen, do not persist |
| `not-claimed` / non-addressable | as today | — | **disabled** (existing shell rule) | — |

Two consequences worth stating separately, because they are where the design got better rather than
merely settled:

- **`StaleNote` should consume the execution reading rather than guess.** It already asks this exact
  question in violet — *"this may not be this session's conversation"* — from an inference about
  transcript age. When the conversation reading is `verified`, its hazard is **disproved** and it can
  withdraw; when unverifiable, it stands as written. A note that guessed becomes a note that reports.
- **A confirm dialog is the wrong fourth option.** It would fire in the box's normal state, so it
  trains the tap-through reflex and is inert by the second day, on a page already measured at four
  screens. The cheap version that passes the ten-second rule is a **changed label or one line on the
  control itself** — and under *can tell* there is nothing to make deliberate, because we know.

## Stages

Each ends green and committable. Every stage gets a GPT Sol review (`--sandbox workspace-write`; the
reviewer fixes inside the stage and reports wider).

### Stage 0 — plan review · **done**

- [x] Sol reviewed revision 1 read-only and **refused it**: F1–F3 and F5–F7 established P1s.
      Artefact: `sc-plan-review-answer.md` (contents transcribed into the ledger below).
- [x] Plan sha sent to the Overseer; F1 escalated as a separate queue item.
- [x] Fable arbitrated the one product judgment F2 and F3 share (withhold vs caveat) — see the
      section below. It also found the error in F1, which is why § Delivery now says the opposite of
      what revision 2 said.

### Stage 1 — Detail state follows the execution, not the handle

Roadmap checkbox 1. Files: `continuity.ts` (new), `SessionsPanel.tsx`, `SessionDetail.tsx`,
`App.tsx`, `RecentMessages.tsx`, `tests/fleet-web.test.tsx`, and two lines in
`tests/fleet-overseer-badge.test.tsx` (it mounts `SessionsPanel` directly and needed the new props).

**Status: built, awaiting Sol's stage review.** Implemented by an Opus subagent, reviewed by me
before commit; ten new tests, each seen red first. What the code taught the plan:

- **The `identityOf` wording above was self-contradictory**, and the implementer caught it before I
  did. Revision 3 said "the verified conversation id, or a stable kind/cause marker": that breaks
  the existing sibling test (a claim change under one handle with an `unknown` reading gives two
  equal identities), and `verified → unknown → verified` becomes three identities, putting a
  transcript read on the refresh loop. **Built instead: the epoch key plus `row.claudeSessionId`**
  — *which run* and *what the server actually fetches* (`server.ts:772` resolves `/api/messages`
  from the row's claim). `useRecentMessages` calls `useExecutionEpoch` itself, so it does not rely
  on its caller remounting it.
- **My own review of the first build found two bugs.** (A) An intermediate version keyed the
  `conflicting` arm on the *observed* conversation while the held turns were the *claimed* one's;
  if the claim then caught up under the same process, nothing re-read and the previous
  conversation's turns rendered with no heading and no caveat. (B) The dialog key used the raw
  token, which is null on every unverifiable collection, so buttons the server had just refused came
  back in exactly the weather this design exists for. Both now use the epoch; both have a test that
  was seen red.
- **One test was testing an impossible state**: a `conflicting` reading carrying the *same* token
  as an earlier verified one. One process cannot change the `--session-id` on its own argv. It now
  carries a new token.
- **Two tests passed on the old code** until rewritten: the flicker test (nothing remounted before,
  so nothing could be lost) and the two-unverifiable-sessions test (at one pane the list replaces
  the detail, so moving A → B passes through "nothing selected" and remounts whatever the key is —
  it now runs at a pinned 1280 px so selection moves directly).
- **Checked and not a bug**: the App latch captures its payload before an `await`. Both the
  payload's `answeringEnabled` and the tap-time `answering-disabled` read
  `process.env["FLEET_ANSWER_ENABLED"]`, so they only disagree across a restart.
- **Left alone, and noted for the debrief**: `QuestionsPanel` holds its own `answering-disabled`
  state, a second latch for one server-wide fact.

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
- [ ] `identityOf` in `RecentMessages.tsx` gains the **verified conversation id** — not the raw
      `claudeSessionId` claim, and not the execution token. A transcript belongs to a conversation.
      `coherentWith` can keep a verified token while downgrading the conversation, so the token
      alone would not notice (Sol F3, the half that is right). An in-flight read is
      generation-discarded when this identity changes, as today.
- [ ] `conflicting` is **relabelled, not withheld**: the turns stay — they are a real conversation,
      correctly attributed, and *"what did the old one say before it died"* is a question that gets
      asked — under an alarm-tone heading saying they are the previous conversation in this pane and
      naming what is running now. "Read again" stays live and reads the same file. What is withheld
      is the *implication* that this is the pane's current state, which is a heading rather than a
      hidden panel.
- [ ] `StaleNote` consumes the execution reading: withdraws when the conversation is verified,
      stands unchanged when it is not.
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

Roadmap checkbox 2. Files: `drafts.ts` (new), `SessionDetail.tsx`, `MessageOverseerCard.tsx`,
`BroadcastCard.tsx`, tests.

**Status: split in two, and the first half is in flight.** Widening the stage to all three inputs
(below) changed what it is blocked on. The composer half needs `SessionDetail.tsx` and
`tests/fleet-web.test.tsx`, where Sol's Stage 1 reviewer has write access; the rest does not. So:

- **2a — built**, an Opus subagent: `drafts.ts` and its one hook, the Overseer message card,
  the broadcast box, and tests in a new `tests/fleet-drafts.test.tsx` plus the two cards' own test
  files. Disjoint from both reviewers' write scopes. Every new test seen red against a stub with the
  final signature; twelve deliberate mutations, each red on exactly its target test. What it taught
  the plan:
  - **A vacuous-test class, found and fixed.** `vi.spyOn(Storage.prototype, …)` under jsdom spies
    on *Node's* `Storage`, not the one behind `window.sessionStorage`, so a "never reads the old
    draft" test passed with a spy that never fired and the storage-refusal tests could not have
    worked. Spies now go through `Object.getPrototypeOf(window.sessionStorage)`, and the test also
    asserts the spy saw the key. The same shape as the `localStorage` shadowing note in
    `src/web/install-hint.ts`, one layer down.
  - **"One conversation per mount" is true of the composer and false of the Overseer card.** The
    composer remounts per process; the Overseer card stays mounted while the Overseer moves between
    rows and processes. So the hook takes an optional `scope` — the card passes
    `useExecutionEpoch`'s key for the Overseer's row — and the fail-safe belongs to the **text**
    rather than the mount: words that may be meant for another conversation stay on screen and are
    never stored until the box is empty, after which persistence resumes. Taken literally, revision
    3's "stop persisting for the rest of the mount" would have switched drafts off on that card for
    the life of the tab after one Overseer change.
  - **The Overseer card restores no draft under `conflicting`**, because its Send is not gated by
    execution (the server's `verifyTarget` protects that send), and a draft written for one
    conversation should not appear in front of a live button aimed at another.
  - The shape the composer adopts in 2b: `useDraft({ purpose, address: draftAddressOf(reading) })`,
    where `draftAddressOf` maps verified-and-verified → `verified`, `conflicting` → `hold(claimed)`,
    `not-claimed` or a non-addressable harness → `hold(null)`, and everything else → `cannot-tell`.
    `hold(claimed)` is already §3's "restore the claimed draft, never persist edits".
  - Copy, one shown near Clear when it applies: *"This browser will not let the page keep a copy, so
    a reload would lose this message."* / *"Too long to keep a copy of, so a reload would lose this
    message."*
- **2b — after Sol's Stage 1 round 2 lands**: the session composer's wiring, the composer under
  each reading (Fable's table), and the `conflicting` restore. 2a is in (`08fa8e19`).

  **Why round 2 stays write-capable rather than report-only so 2b could overlap it.** Round 2 can
  write to `SessionDetail.tsx` and `tests/fleet-web.test.tsx`, which are 2b's files, so the only way
  to run them together would be to take the reviewer's write access away. It would buy nothing: when
  the Stage 1 follow-up finishes, the Stage 3 round-2 check, Stage 4a and Stage 1 round 2 are three
  things running tests, which is `overseer.md`'s ceiling, so 2b could not start alongside them
  anyway. Giving up the house default — a reviewer that fixes what it finds — for no gain in
  throughput is a bad trade; 2b goes after.

**Stage 4 was held rather than started alongside 2a.** With two reviewers and 2a running, three
things in this worktree were running tests, and `docs/project/overseer.md` caps test-running work at
three: *"beyond three the suites go red for reasons that are nobody's bug."* When 2a finished it was
split the same way as this stage — **4a** (the hook, the client seam, and a new test file) started
at once, disjoint from everything running; **4b** (drawing the age and error beside the queue in
`SessionDetail`) waits for 2b.

- [ ] `drafts.ts`: `useDraft(purpose, key)` over **sessionStorage** — per tab, dies with the tab,
      survives the reload iOS forces. Key `sy.draft.v1:<purpose>:<verified conversation id>`;
      `purpose` is in the key because two boxes on one screen must not share a draft.

      **Keyed by the conversation, not by the execution token** — Fable's ruling, and it is a
      deviation from the roadmap's literal *"per execution"* that is worth the words. A draft is
      addressed to a conversation, not to a process. Keying by the token would drop a person's typed
      work on the *benign* replacement — a same-conversation relaunch, where the recipient has not
      changed — which is destruction rather than caution. Keying by the verified conversation id
      gets every case right: a relaunch restores it; a genuinely different conversation in the pane
      never finds it, because the key is not there; and it cannot legitimately collide, because two
      interactive claudes on one uuid are `competing-claude` and refused. The tmux handle is
      deliberately **not** in the key: a conversation that moved panes is the same recipient.

      It also makes the unverifiable gap safe rather than merely survivable — see below.
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
- [ ] **The unverifiable gap.** Revision 1's rule ("keep writing to the last verified *token* key")
      is dead — Sol's F2 showed it binds text typed at run B into run A's key. Under a
      conversation-id key the problem dissolves: persistence during a gap writes under the last
      verified *conversation*, and **restoration is gated on live verification of that same
      conversation id**, so a draft for C can only ever come back when C is what is running. A token
      key could not do this, because a token names a process that may be dead; a conversation key
      names the recipient. Typing stays enabled throughout (Fable's ruling); Send stays live under
      *cannot tell* with one line beside it, and is disabled under *can tell*.
- [ ] **Never silently destroy typed text.** Where revision 1 said "different verified token →
      drop", the rule is now: a different verified conversation leaves the text **on screen**,
      persists nothing, and lets the disabled Send do the protecting. Dropping a person's words on
      the evidence of a process id was a bug wearing caution's clothes.

      **How that meets Stage 1's remount**, which Fable's table did not have to reckon with: a
      `conflicting` reading always arrives with a new process, so the detail pane has just been
      remounted and its box is empty. "Keep on screen" therefore means **restore the draft stored
      under the *claimed* conversation into the box** — the reading names it — with Send and Queue
      disabled and further edits not persisted. A genuinely different *verified* conversation
      (the claim itself changed) restores nothing: the old draft stays in storage under its own key
      and comes back only if that conversation does.
- [ ] **The composer under each reading** — Fable's table, composer rows. Assigned here because no
      stage owned it in revision 3: *cannot tell* keeps Send and Queue live with one line beside
      Send; *can tell* (`conflicting`, `not-claimed`, non-addressable harness) disables them with
      `identityWriteGate`'s sentence. Typing is enabled in every arm. The gate supplies the sentence
      and **not** the enable condition — its own header says a cached verdict is not authority, and
      its refusals for the *cannot tell* arms are exactly what Fable ruled must not disable the
      controls.
- [ ] **One quiet limitation, stated rather than discovered.** A session whose Claude was started
      without `--session-id`, in a pane that has `CLAUDE_SESSION_ID` set, reads
      `conversation.kind === "unverifiable"` for as long as it runs, so its drafts never persist.
      Harmless, because `verifyTarget` refuses a send to that pane anyway (`noUsableClaude`) — but
      it is the kind of quiet gap that should be in the plan rather than found later as a bug.
- [ ] Tests: suspend/resume restores the draft; a different token restores nothing and leaves the
      old draft unread in storage; storage that throws on the accessor, on `getItem`, and on
      `setItem`; Clear removes the key; over-cap text is not stored.
- [ ] **All three inputs, not one.** Revision 3 wired only the session composer and deferred the
      other two. That was a narrowing of the roadmap's *"per execution and input purpose"*, and
      `docs/project/overseer.md` gate 2 is explicit that narrowing scope is never the agent's call —
      *"scope is where his fifth options come from."* Widened back, 2026-09-10, and reported to the
      Overseer as a correction rather than a request:
      - the **session composer**, keyed by its row's verified conversation id;
      - the **Overseer message card**, keyed by the Overseer row's verified conversation id — the
        strongest case of the three, because the Overseer is the session relaunched most often;
      - the **broadcast box**, keyed by purpose alone, because it has no single recipient and so
        nothing for a replacement to inherit.

**Not built, and it is Greg's call, not mine** (Overseer ruling, 2026-09-10 — logged as an
assumption pending Greg rather than decided):

> **localStorage instead of sessionStorage.** What it buys: a draft survives *closing* the tab, not
> just the reload iOS forces — so a message half-written on the phone last night is still there this
> morning. What it would need: an expiry we would have to pick, a Clear (already built), and the
> same 8 kB cap. What it risks: text typed at an agent outliving the session it was meant for, on a
> browser that may be shared or borrowed, with no session boundary to end it. One line from Greg
> settles it either way.

### Stage 3 — The feed knows when it last read, and re-reads on evidence

Roadmap checkbox 3. Files: `FeedPanel.tsx`, **`feed-client.ts`** (F5), a new
`tests/fleet-feed-freshness.test.tsx` (it runs on fake timers throughout, so it is not folded into
`fleet-feed-panel.test.tsx`), and one section of `docs/project/fleet-recent-messages.md`.

**Status: built, one correction in flight, then Sol's stage review.** Implemented by an Opus
subagent in parallel with Stage 1's review — the file sets do not overlap. Ten cases, each seen red
first. Three of them (twenty identical snapshots, the `why`-only difference, cannot-loop) would have
passed on the old code, since a page that never re-reads trivially "reads once"; each now ends with
a real change that must cause a read, and the implementer broke the new code twice on purpose to
prove they fail for the right reason. Judgment calls it made, all accepted: a 15 s read deadline
(`FEED_READ_DEADLINE_MS`, three times the server's own per-session limit); the floor measured from
when the last read *started*; only a change between two *known* tmux-server pids bypasses the floor,
so a collector that intermittently omits the pid cannot use that path to escape it; a hidden tab
defers only the reads the page starts itself; the first digest is a baseline, never a trigger.

**The correction, and it is a flaw in the spec rather than the build.** F6's wording, accepted
verbatim, put the execution reading's *kind* into the digest. The implementer flagged the
consequence: every verified ↔ unknown flip counts as evidence, and on a loaded box that flip is
routine, so the feed would re-read about once a minute — ~10 MB of transcript reads each time,
triggered by nothing that changed a transcript. That is the very distinction Fable's ruling draws.
The execution component is now **the last verified token per row id**, so a real replacement
triggers a read and a flicker does not — the same idea as `useExecutionEpoch`, applied to many rows.

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

**Stage 5a — the creation-poll half — status: built, ahead of stage order, awaiting the Stage 5
review.** Its files (`NewSessionPanel.tsx` and a new `tests/fleet-new-session-deadline.test.tsx`)
overlap nothing else in flight, so it ran in parallel. Implemented by an Opus subagent. **It found
two production bugs, and one of them could have launched two agents from one press:**

- **A double tap on Start launched two sessions.** The only guard was the button's `disabled`,
  which takes effect after the redraw, so two taps before it both reached `api.start`. Now a
  `posting` ref guards the action itself — the same shape as the existing `blocked` guard for
  dictation — released in a `finally` so an api that throws cannot leave the button dead. Red first:
  `expected 2 to be 1`.
- **A late poll answer could beat the deadline.** The deadline was checked only when the 3-second
  interval ticked, and the tick landing exactly on the 4-minute mark does not pass it (`>`), so for
  up to one interval a poll begun before the deadline could land and settle the launch as though it
  were on time, with no give-up ever drawn. The clock is now also checked when an answer arrives,
  before it is read. Red first, for both a late `started` and a late `failed`.
- **The F9 trade-off, accepted as written:** a genuine `started` arriving a second after the
  4-minute mark is thrown away and the panel says it stopped asking. The banner already sends the
  reader to the session list, which is where that session will appear.
- **Unmount mid-poll and tap-after-give-up passed on the old code**; each was proved able to fail by
  a deliberate mutation (removing `clearInterval`; reusing the old launch's start time).
- **React here is 19.2.8, not 18** as this plan's review prompts said. React 19 no longer warns
  about a state update on an unmounted component, so a `console.error` spy cannot catch that
  teardown class; the timer and request counts are what catch it. Corrected in the later prompts.

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
      offline. **Never the live dashboard**, and the subagent is told to kill only its own pid.

      **How, since there is no fixture mode.** The fleet server's rows come only from real tmux
      (`FLEET_PORT` moves the port, nothing injects state), and every behaviour this stage adds
      turns on execution readings that are derived from `/proc` — a *replaced* run needs a real
      `claude` to be replaced, which the brief forbids on the live box. So the check does not go
      through the fleet server at all: `npm run build:fleet` builds `tools/fleet/web/dist`, a static
      server serves it on a side port, and **Playwright's `page.route` answers `/api/*` from
      fixtures**. The client asks only relative URLs (`api/state`, `api/messages?id=…`,
      `api/actions`, `api/feed`), so a replacement, a flicker, a `conflicting` reading and a
      refused answer are each one JSON edit, and *offline* is `context.setOffline`. What that cannot
      prove is the wire from a real collector — which the unit tests' `parseFleetState` round trips
      and the existing server tests cover, and which this stage does not change.
- [ ] **One existing-control defect already found, for this stage's accessibility line.** Biome
      reports `useAriaPropsSupportedByRole` twice in `SessionsPanel.tsx` (lines 879 and 891 at
      `93c3af30`): the detail pane's focus target is a `div` with `tabIndex={-1}` and an
      `aria-label`, and a label on an element with no role may not be announced at all — so the
      region the page moves focus into on selection has no name to a screen reader. Present
      unchanged in the parent commit, so not a Stage 1 regression. The fix is one attribute,
      `role="region"`, and the roadmap makes it this stage's: *"keyboard labels, focus and touch
      targets are acceptance criteria for existing controls."*
- [ ] **Risk noted up front**: this account's Sonnet subagents hit a hard weekly 429 on 2026-09-07
      that was not due to reset until 2026-09-12. If the browser subagent dies on a 429, it is
      rerun on Opus rather than skipped.

**Acceptance for the whole stage** (roadmap, unchanged): suspend/resume preserves the right draft; a
replacement session never inherits it; creation polling terminates under permanent failure; recent
messages cannot show a previous execution as the current one.

---

## The review ledger

**Three plans share the letter `260910c` today** — this one, bounded transport and responsive
collection — which the naming scheme allows by design (`docs/reusable/write-planning-doc.md`), so
nothing already committed is renamed. But review artefacts named only `260910c-stageN-…` collide:
on 2026-09-10 I overwrote responsive collection's `260910c-stage2-code-review-prompt.md` in this
working tree with my own Stage 2 prompt, a file my merge of `origin/dev` had brought in. It was
caught before any commit, from the write tool reporting *updated* rather than *created*, and
restored from `HEAD`. **This plan's review artefacts from Stage 2 onwards carry the slug:**
`260910c-session-continuity-stageN-code-review-*`. The unslugged Stage 1 and Stage 3 artefacts
below are this plan's and stay where they are.

Round 1, GPT Sol, 2026-09-10, on revision 1. Verdict: **refuse**. Sol also ran
`npx vitest run tests/fleet-web.test.tsx` itself: 430 tests passed.

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F1 | Browser-only identity cannot protect *delivery*; `verifyTarget` and `enqueue` both pass an in-pane replacement | graded P1 established; **actually reasoned, and its conclusion is wrong** | **Not accepted.** The conversation check reads live argv, not the row's claim, and `drain` re-verifies through `sendMessage`. Only a same-conversation relaunch passes. See § Delivery. My revision-2 escalation repeated Sol's conclusion after quoting the doc comment that disproves it; corrected to the Overseer the same day. The invariant it prompted me to narrow stays narrowed — that part was right for a different reason. |
| F2 | The unverifiable-gap draft rule binds run B's text into run A's storage key | P1 established | **Gap accepted, repair overruled via Fable.** Revision 1's token key is dead; the conversation-id key dissolves the finding. Sol's repair (no typing while unverifiable) is not built: unverifiable is the box's normal weather, and typing is not an act on the box. |
| F3 | Adding only the token leaves transcript quarantine incomplete: `coherentWith` can keep a verified token while downgrading the conversation | P1 established | **Gap accepted, blanket repair overruled via Fable.** The identity is the verified *conversation id*, which is the half Sol was right about; `conflicting` is relabelled rather than hidden. Sol's rule — no held view unless `identityWriteGate` allows — would blank every transcript on a loaded box, against `RecentMessages.tsx`'s stated purpose, and misuses a gate whose own header forbids caching its verdict. |
| F4 | The mount key's selection domain is underspecified | P1 reasoned | **Accepted verbatim**, Stage 1. |
| F5 | Stages 3 and 4 cannot abort through APIs that take no `AbortSignal` | P1 established | **Accepted verbatim.** `feed-client.ts` and `actions-client.ts` added to scope, plus the promise-versus-deadline race. |
| F6 | The feed digest omits `claudeSessionId` and `tmuxServerPid` | P1 established | **Accepted, then corrected in the build.** Both omissions were real and are fixed. But the replacement wording's "unverifiable arms contain only their stable kind/cause" made every verified ↔ unknown flip a trigger — a re-read a minute on a loaded box. The execution component is now the last verified token per row. |
| F7 | `answeringOff` needs `questionSafetyKey` and a genuinely page-level owner in `App.tsx` | P1 established | **Accepted verbatim**, Stage 1. Found an existing helper I was about to reinvent. |
| F8 | `lastGoodAt` planned as a field nothing renders | P2 established | **Accepted verbatim**, Stage 4. |
| F9 | The late-discovery regression names no winner | P2 reasoned | **Accepted verbatim**, Stage 5. |

Stage 1 code review, round 1, GPT Sol, 2026-09-10, on `93c3af30`
(`260910c-stage1-code-review-sol.md`). Verdict: **refuse the guarantee as stated**. Run
write-capable; its fixes verified by me: `fleet-web`, `fleet-overseer-badge`,
`fleet-questions-panel` and `fixture-ids` pass; typecheck is red only in
`tests/fleet-overseer-message.test.tsx`, which Stage 2a was rewriting at the time, and Sol's own
typecheck passed. Mutation checks on each fix were Sol's, and are in its answer.

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F10 | A transcript response carries no provenance: if the server's snapshot moves from claim C to D mid-request, D's turns arrive and are labelled C | P1 established | **Accepted; follow-up.** `readRecentMessages` stamps every answer with the conversation id it read; the browser discards an answer whose stamp differs from the claim it asked under. The brief allowed exactly this — a read-side addition "if identity must travel in a request". The world is not needed in the stamp: two tmux servers holding one conversation uuid hold one conversation. |
| F11 | Under an unverifiable execution, a changed claim or tmux world kept the draft and both cards | P1 established | **Fixed by Sol, and the fix introduced a flicker — follow-up.** Sol put `tmuxServerPid` and the claim into the mount key; `collect.ts:550` returns `tmuxServerPid: null` whenever `list-panes` fails, which on a loaded box is weather, so the key can read `123 → null → 123` and wipe the composer. The same rule the epoch and Stage 3's digest already follow applies: hold the last known value and move the key only between two known values. |
| F12 | An unverifiable flicker erased an established conflict, leaving the previous conversation's turns uncaveated | P1 established | **Fixed by Sol, accepted.** The last established conflict is held until a verified conversation positively refutes it, with wording that says the latest pass could not re-check. |
| F13 | The page latch recorded the tap-time payload, so a payload that arrived while the answer was pending counted as evidence after the refusal | P1 established | **Fixed by Sol — and I had dismissed this.** I reasoned that the payload flag and the tap-time refusal read one env var and so only disagree across a restart; but the latch exists *for* the restart case, so that was the case in which the race matters. The boundary is now the latest committed payload at the moment the refusal arrives. |
| F14 | `question A → refusal → no question → identical A` resurrected the old refusal | P1 established | **Fixed by Sol, accepted** — F7's rule that a transition through no dialog is a change, now made final rather than merely hidden. |
| F15 | A replacement hidden entirely inside unverifiable readings cannot be detected, so the absolute guarantee is false | P1 established contract gap | **Guarantee narrowed**, the first of the two options Sol offered; see § What this guarantees. The second (withhold everything before a first verified reading) is the rule Fable's arbitration already declined. Not an overrule. |
| F16 | `QuestionsPanel` owns a second `answering-disabled` latch for the same server-wide fact | P1 established, wider than the detail pane | **Accepted; follow-up.** `App` owns the one latch; `QuestionsPanel` takes it and its handler as props, and keeps only its dialog-scoped refusal local. |

Stage 1 code review, **round 2** — the last discovery round — GPT Sol, 2026-09-10, on `c71ddbac`
and `3b4d7a07` (`260910c-stage1-code-review-r2-sol.md`). Verdict: **refused the two commits as
committed on F17–F21, fixed all five in the tree, and found no remaining P0 or P1 in Stage 1.**
Its fixes verified by me before commit (gates below), and F17/F18 sent for an independent scoped
check because they change the one hook every panel uses.

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F17 | React batched a delivered payload and the answer's resolution into one turn, so the layout-effect ref (F13's fix) named the previous commit and an enabled payload that arrived *before* the refusal cleared it | P1 established | **Fixed by Sol, accepted; scoped check.** `useFleetState` records the newest *delivered* payload synchronously at the transport boundary (`latestDeliveredState`), and App latches against that. |
| F18 | React batching erased intermediate evidence: `conflicting → unknown` and `question A → none → identical A`, delivered in one turn, rendered only their last member, so a conflict vanished and a stale refusal survived | P1 established | **Fixed by Sol, accepted; scoped check.** Each transport delivery is committed with `flushSync`. Sol's postmortem `docs/postmortems/260910b-react-batching-erased-transport-evidence.md` names the class — *a snapshot store was asked to preserve an event* — and records the rejected alternative (an event reducer at the transport boundary) with the condition for revisiting it: high-frequency delivery. Accepted as the narrow fix: snapshots arrive at most every five seconds. |
| F19 | The route's 404 and its catch arm returned unstamped answers, which the browser accepted as an older server's | P1 established | **Fixed by Sol, accepted.** The 404 stamps `null`; the catch arm stamps the row's claim. |
| F20 | The `moved` refusal claimed a read happened and that waiting would help — neither supported by a `null` stamp or a C→D→C sequence | P1 established | **Fixed by Sol, accepted.** The copy now says only that the answer named a different claim, and offers Read again "as it is now". |
| F21 | The Questions tab's alarm said a refusal withheld buttons that could never have existed | P1 established | **Fixed by Sol, accepted.** One eligibility predicate, shared by the button gate and the alarm. |
| F22 | The provenance wrapper stamped options that could be mutated during the `await` | P2 established | **Fixed by Sol, accepted** — primitives snapshotted before the await. |
| F23, F24 | First-known world/claim, and two provenance policies, survived mutation | P2 established | **Fixed by Sol, accepted** — regressions added, each proved by its mutation. |

**Round 1 missed F17–F21, and so did I.** Every earlier transition test pushed each payload in its
own `act`, forcing a commit between states, so the tests shared the implementation's assumption
that one delivery meant one render — the postmortem's "why nothing went red". Discovery for Stage 1
is now closed; the F17/F18 check is scoped to those fixes and does not reopen it.

**The scoped check of F17/F18 — an independent Opus agent, read-only: all four questions hold.**
Removing `flushSync` in memory turned exactly the two F18 tests red and left both F17 tests green,
so each fix stands on its own; `onState` is reached only after an `await` on every transport path,
never from inside a render or effect, so `flushSync` is always legal there; every interleaving of a
refusal and a delivery, including both in one turn, leaves `under` naming a payload delivered no
later than the refusal; and a delivery was already one render, so nothing re-renders more than
before. **Stage 1 is closed**: two Sol rounds, then an independent check of the round-2 P1 fixes,
no open P0 or P1.

Two notes it raised outside its scope, recorded rather than built:

- **A transport that ever delivered from inside a render or effect would break F18 again**, since
  `flushSync` would warn and fall back to batching. Nothing guards against it, so the rule is now a
  fifth promise in `transport.ts`'s list of what a replacement must keep — which is where whoever
  writes the SSE transport will read it.
- **A named limit on the answering latch:** its boundary is the order payloads *arrive*, not the
  order the server *sent* them. A poll response sent before a 503 but arriving after it could clear
  the latch. It needs the server restarted with a different `FLEET_ANSWER_ENABLED` at exactly that
  moment; comparing `servedAt` would close it. Not built.

**The Stage 1 follow-up — built**, an Opus subagent, from the three open rows above; every change
seen red first, and every test that passed on the old code proved able to fail by a deliberate
mutation, restored afterwards.

- **F11's flicker** — `useDetailTargetKey(row, tmuxServerPid)` in `continuity.ts` replaces the
  hand-built key in `SessionsPanel`. It holds the last *known* tmux pid and the last known claim per
  session, with `useExecutionEpoch`'s render-phase pattern: a null reading keeps what was held, a
  first known value is not a change, and only a different known value moves the key. An empty-string
  claim counts as unknown, as the transcript reader already treats it.
- **F10** — `readRecentMessages` returns `RecentMessagesOf`, the unchanged `RecentMessages` plus
  the conversation id it was asked to read, stamped by one wrapper so no arm added later can forget
  it. No other caller changed: `server.ts` serialises the payload whole, and `routes-recent-feed.ts`
  maps fields explicitly. The browser reads the stamp as stamped or unstamped, and a mismatch on
  *any* arm — found, not-found or unreadable — becomes a new `moved` arm, drawn as a refusal naming
  both ids with Read again live. A stamp present but neither a string nor null is `no-answer`
  rather than silently unstamped.
- **F16** — `QuestionsPanel` takes App's latch and handler. It also draws the latched refusal and
  the server's reason on the Questions tab, since otherwise a refusal made on the other tab would
  leave its buttons missing with no explanation.

### Stage 4a — built

An Opus subagent: `useActions.ts`, four lines of `actions-client.ts`, and a new
`tests/fleet-actions-freshness.test.tsx`, eleven cases each seen red on the old hook. The one that
cannot fail against correct old code — *never requests `/api/state`* — was proved by inserting a
`fetch("api/state")` into the reader and watching it go red; the test also asserts its own spy fired
and that a confirmed action posts the page's stale row identifiers rather than re-reading them.
Judgment calls, accepted: an 8 s read deadline (`ACTIONS_READ_DEADLINE_MS`), under the 10 s poll so
a lost read costs one poll rather than two; a poll tick during a read is skipped rather than queued;
a person's refresh still reads from a hidden tab, and only the page's own poll skips one; `error`
stays a string because the renderers in `ActionButtons.tsx` take one.

**What 4b draws, from 4a's own note:** `lastGoodAt`, `error` and `pollMs` on the `actions` object
`SessionDetail` already receives; the age is `now − lastGoodAt` on App's one clock; a suggested
stale threshold of `2 × pollMs + ACTIONS_READ_DEADLINE_MS`, checked against the tests that pass
`actionsPollMs={0}`; and `SessionQueue` currently draws its error *instead of* its status line,
which 4b must check still leaves the items drawn underneath.

### Stage 4b — built

An Opus subagent: `SessionDetail.tsx`, a targeted edit to `ActionButtons.tsx`, and a new describe in
`tests/fleet-web.test.tsx`. One line, `read {age} ago`, at the top of "Waiting to go to it", wearing
a tooltip that says the age covers both the queue and the list of actions above it. It is absent
before the first good read and while reads work; it appears once no read has worked for
`actionsStaleAfterMs(pollMs) = 2 × pollMs + ACTIONS_READ_DEADLINE_MS` — 28 s at the real 10 s poll,
because a working poll leaves at most one interval plus one read between good feeds and one read
lost to its deadline adds at most one more — or at once when a read fails, followed in the alarm
colour by the reason. At a 0 ms poll the deadline is the floor, so a feed is never stale on arrival.
The last good queue stays drawn underneath.

- **Drawn once, above the queue, rather than beside both the queue and the action buttons** — a
  deliberate reading of F8's "beside the action and queue surfaces". The buttons come from a list
  that does not change while the server runs, and a button posts and lets the server decide, so an
  old list changes nothing you would do; an old queue does. The tooltip says the age covers both.
- **A side effect on a shared component, caught and made opt-in.** Its first build changed the
  empty-queue branch of `SessionQueue` to say "Nothing was waiting at the last read that worked."
  when a last good read exists — right for the session detail, where the error is already drawn in
  the age line above, but `SessionQueue` is shared with the **Overseer** tab's `FleetQueues`, which
  draws no age: a held, empty queue with a failed read there lost its reason. Sent back: the new
  sentence is now behind an `errorDrawnAbove` prop only `SessionDetail` sets, the Overseer tab's
  wording is back as it was, and a test on that tab went red on the first build and passes now.
- **One vacuous test of its own, caught by itself:** a regex beginning `\b` against text that runs
  straight into it ("…go to itread 0s ago") made every `not.toMatch` pass whatever was drawn.

**One reader, not two — built.** 4a reported that its `actionsReader` and Stage 3's `feedReader`
repeated the same core almost line for line — one read in flight, one pending, a deadline racing
the API promise, the generation check, abort on stop — differing only in what triggers a read. Two
copies of one mechanism is the drift this repo's "prefer simple" rule names, so once Sol's Stage 3
round 2 was out of `FeedPanel.tsx`, an Opus subagent extracted it: `single-flight-reader.ts`, with
its own eleven tests, which both hooks now use. A behaviour-preserving refactor, and the proof is
that the four protected test files (`fleet-feed-freshness`, `fleet-feed-panel`,
`fleet-actions-freshness`, `fleet-web`) passed without an edit.

- **The gate stays with the caller**, through an `admit` hook the core asks only when the slot is
  free. So the two hidden-tab rules stay deliberately different, as they were: the feed defers every
  read while hidden (F52); the actions hook lets a person's refresh read from a hidden tab.
- **One mutation shortfall, accepted rather than fixed.** Removing *only* the generation check —
  keeping the in-flight check — turns the core's own suite red but neither hook's, because every
  hook test settles the newer read before delivering the stale answer, so the in-flight check alone
  catches it. That gap predates the refactor: the two originals had the same double guard and the
  same tests. The core's suite now covers the case directly, which is where the guard lives. Adding
  it to the hook suites would mean editing the files whose being untouched is the proof that nothing
  changed, for no gain.
- The Read-again guard in Stage 5 is a third instance of the same problem, and its brief says to
  use this module rather than write a third copy.

Stage 3 code review, round 1, GPT Sol, 2026-09-10, on `8465380d`
(`260910c-stage3-code-review-sol.md`), concurrently with the Stage 1 review in disjoint files; its
IDs start at F50 to keep the two apart. Verdict: **"no P0/P1 remains after the fixes. I would
accept the revised Stage 3."** Its fixes verified by me: `fleet-feed-freshness`, `fleet-feed-panel`,
`fixture-ids` and `doc-links` pass; typecheck shows no error in any Stage 3 file.

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F50 | A first `unknown → verified` reading triggered a re-read though it proved no replacement; the execution memory also crossed tmux worlds | P1 established | **Fixed by Sol, accepted.** Per-row, per-world epochs: a first verification is epoch 0, only a later different token advances it. |
| F51 | `tmuxServerPid` going `42 → null → 42` caused a re-read with no world change | P1 established | **Fixed by Sol, accepted.** The pid travels beside the digest rather than inside it; only two different *named* pids take the immediate world path. **The same flicker class as the one Sol's own Stage 1 F11 fix introduced** into the detail pane's mount key, found independently here — which is some evidence the class is real rather than theoretical. |
| F52 | Mounting, refreshing or changing the limit while hidden started requests | P1 established | **Fixed by Sol, accepted.** Every read entry point defers until visible. |
| F53 | The verified-token memory was written during render, so a render React discards could move it | P2 reasoned | **Fixed by Sol, accepted.** Written from an effect; `rememberVerified` returns the same object when nothing changed, so the effect does not retrigger. The implementer's argument that a render-time write was harmless did not hold: a discarded render could make a later unverifiable snapshot look like a replacement. |
| F54 | "Never sooner than the floor" omitted the deliberate tmux-restart exception | P3 established | **Fixed by Sol, accepted** — the doc says two different named pids re-read at once. |
| F55 | "One read in flight" is impossible when an injected API ignores abort and never settles | P3 reasoned | **Fixed by Sol, accepted** — the accurate claim is one live reader slot, with abandoned promises generation-discarded. |

Sol also answered two of my stated doubts and I accept both: anchoring the floor to a read's
*start* is right (a 15 s timeout then permits the next evidence read at 20 s; anchoring to
completion would make it 35 s for nothing), and the Read again button does keep the one-pending-refresh
promise — two activations before React draws `disabled` coalesce into one trailing read, now with a
UI-level test.

**Round 2 is narrow, not a second discovery pass.** The fixes to F50–F52 are P1 fixes nobody but
their author has read, and the rule is that such a fix gets a scoped check of that fix. Scope:
F50–F53 only.

Stage 3 code review, round 2, GPT Sol, 2026-09-10, on `f5c7b048`
(`260910c-stage3-code-review-r2-sol.md`). Verdict: **"no production defect remains in F50–F53"** —
each fix holds, with the sequences it was asked about walked through. Two coverage findings, both
fixed in the test file only; production code unchanged.

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F56 | Making `null → 42` count as a tmux restart left the suite green | P2 established | **Fixed by Sol, accepted** — a regression for `null → 42 → 43`, proved by that mutation. |
| F57 | Moving the evidence memory back into render, or disabling the unchanged-object reuse, left the suite green | P2 established | **Fixed by Sol, accepted** — abandoned-render and identity tests, proved by those mutations. |

**Stage 3 is closed**: two rounds, the second a scoped check, no open P0 or P1.

Stages 2 and 4 code review, GPT Sol, 2026-09-10, combined because both end in `SessionDetail.tsx`
(`260910c-session-continuity-stage2-4-code-review-prompt.md`). **Killed at its 45-minute timeout
before writing an answer** — dispatched before the Overseer's 30-minute rule — but it had found four
defects, each by a red-first integration test, fixed them, and written the postmortem
`docs/postmortems/260910c-a-mutable-text-hook-erased-the-submission-it-produced.md`. All four are one
class, *provenance erased at a mutable boundary*: the drafts hook handed back a changing value and a
`clear()` that acted on whatever was current, so an asynchronous success had authority over text it
never sent. The fix gives each request a **submission ticket** carrying a generation; unfiled text
keeps its target scope across a remount and is never stored.

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F25 | A Send (and a Queue) finishing after a same-conversation relaunch left the already-sent draft restored | P1 established | **Fixed by Sol, verified.** |
| F26 | The broadcast box's old success cleared newer text typed while it was in flight | P1 established | **Fixed by Sol, verified.** |
| F27 | Text typed before the pane could be placed vanished when it remounted on a verified target — including when the delivery lands in the same instant as the typing | P1 established | **Fixed by Sol, verified.** |
| F28 | The mounted Overseer card, moved between conversations, kept the first one's words beside a live Send | P1 established | **Fixed by Sol, verified.** |
| F29 | The generation that decides whether a success may clear is kept per *box*, not per *conversation*: a Send to A, a remount onto B and typing there before A answers, and A's success is ignored — its sent draft stays in storage and returns with A, inviting a duplicate message | P2 established, found by the verifier | **Fixed — Opus, red-first, no cross-family review.** Beside the per-box generation, `drafts.ts` now keeps one per *stored key*, advanced whenever a box writes or removes that key, and the ticket records both. A success removes the stored copy if nothing has written *that key* since the ticket, whatever the box has done since, and clears the box only if the box itself is unchanged — so A's success removes A's copy after the box has moved to B, never touches B's text, and still leaves alone an edit made to A's own box after the send. Red first for Send and Queue and for the Overseer card's version of it; the guards proved by deliberate mutation. Not a regression — the old code removed nothing in that case either. |
| F30 | Text typed before any conversation could be verified, then sent, then filed under A when A verified, survived A's success in A's stored key and came back after a reload — the ticket had been taken with no stored key | P2 established, found by F29's implementer | **Fixed — Opus, red-first, no cross-family review.** When a success clears a box, the box also removes the key its words were filed under *after* the send. The box only hears of a success while its generation is unchanged since the ticket, so that key holds exactly the sent words; an edit made after the send stops the clear and so survives, proved by a deliberate mutation. |
| F31 | The same sequence as F30, but the pane is *unmounted* while the request is open — the success lands with no box mounted to remove A's copy, so the sent words come back when A is next shown | P2 established, found and deliberately **not** fixed | **A named follow-up, and where this chain stops.** Every gap in this hook so far has been real and narrower than the last — F25–F28 from the review, F29 from its verifier, F30 and F31 from F29's implementer — and a chain like that has no natural floor. Closing F31 needs a record, outside the mounted component, of which key each box's words were filed under: more machinery for a narrower case. So F30 was the last discovery on this hook in this stage, by decision, and F31 is written down rather than built. |

**Why no Codex rerun.** A 30-minute rerun of work that had just overrun 45 minutes would likely time
out again, and Codex is rationed. Instead an **independent Opus agent** — a different model from the
author, which is what the house rule asks of a check of author-only P1 fixes — verified the work on a
scratch copy of the tree with the committed source put back, so nothing was reverted under the Stage
5 reviewer running at the same time: the six tests covering the four defects each failed on the
committed code and pass now. Nothing needed finishing; every file matched the last version in the
reviewer's own log. Its two other additions are coverage — the verified-relaunch test separating
"outcome cards reset" from "the same conversation's draft returns", which Stage 1's changed fixtures
had blurred, and a poll-tick test proved non-vacuous by a deliberate mutation. It corrected one
overclaim in the postmortem and added F29's limit to it. **Stages 2 and 4 close on this**, with F29's
fix — built by Opus, red-first, and read by me — the one part of them no cross-family reviewer saw.

Stage 5 code review, GPT Sol, 2026-09-10, on `05990f06`, `c2d1c191` and `f5fe6fec`
(`260910c-session-continuity-stage5-code-review-sol.md`), run under the Overseer's 30-minute budget
rule. Verdict: **"Accept. No P0/P1 findings."** It walked every guarantee — same-frame taps, the
exact four-minute boundary (accepted under `>`, `+1 ms` discarded), StrictMode's rehearsal mount, a
claim discovered between two taps — and found them accurate.

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F80 | A rejected `NewSessionApi.start()` released the posting guard but escaped the click handler as an unhandled rejection, with nothing on screen | P2 established | **Fixed by Sol, accepted** — caught, shown as a refusal, the `finally` release kept; a test that went red first. I had seen this path when reading 5a's diff and let it pass as older than the change; it was right to fix. |
| F81 | The abort reaches `fetch` and stops there: `server.ts` starts `readRecentMessages()` without watching for the request closing, and the reader takes no signal, so an abandoned transcript read still finishes on the box | P2 reasoned, wider | **Not built — a named follow-up, and a correction.** The commit message of `f5fe6fec` says an abandoned read "now stops costing the box". **That overstates it**: the browser stops waiting and aborts its fetch, and the server finishes the read anyway. The accurate claim is Stage 5's 5d as its review prompt stated it — *the fetch is aborted, not merely ignored*. Making the server honour it means deriving a signal from the request closing and checking it in transcript discovery and between tail-read chunks, in the shared `server.ts` and `transcript.ts`; it saves a rare read (only on a 30 s deadline, an unmount or an identity change), so it is left for a later stage rather than built on shared server code here. |

**Stage 5 is closed after one round.** Its one fix is a P2 — the rule that a fix nobody but its
author has read gets a scoped check is written for P1s — and I read it before landing.

**The browser check** (a Sonnet subagent, Playwright on the box, against a build of `03743ea3` with
every `/api/*` answered from fixtures — never the live page): **Stages 1–4 passed every bullet**, at
390 px and 1280 px, keyboard-only and through an offline return, and it confirmed 4b left the
Overseer tab's queue wording unchanged. Two of the brief's bullets were wrong because I wrote it
before later stages landed — a relaunch's draft "must be gone" (Stage 2 now restores it) and the
feed "must refresh" on coming back online (Stage 3 re-reads only on evidence); the checker read the
code, not the brief, and said so. Two Playwright traps it hit are now in
`docs/project/browser-testing-playwright.md` (`7411ca37`).

- **The Sessions text filter — not built; a one-line decision for Greg.** Measured: 25 rows at
  390 px span about 4.5 screen-heights, and a known title mid-list took 6 scroll gestures to reach;
  the titles are distinct, and none of the five existing orders helps match by topic. The checker's
  verdict, "mildly cumbersome, not severe", is ambiguous against the roadmap's "only if
  cumbersome", so it goes to Greg with the evidence and a recommendation to queue it as a small
  follow-up.
- **Touch targets — a named limit, not patched here.** Several controls are under ~44 px, among
  them ones this stage touched: the composer's Clear (51×28), Start it and Read again, and the
  actions age line's tooltip (70×17). None is out of line with the page — every `Button` is
  `tw:h-7`, 28 px, and the age wears the same inline tooltip every other age does — so raising one
  would break the page's one-height rule, and raising all is the design-system work the roadmap
  excludes.

**Two process lessons, both mine.** *A brief written ahead goes stale*: the browser brief was
drafted before Stages 2–4 landed and asserted two behaviours they deliberately changed; re-read a
drafted brief against what landed before dispatching it. *Two write-capable reviewers in one tree
must each be told about the other*: I dispatched Stage 5's reviewer while Stages 2+4's was running
under a prompt that said "nothing else is editing". Stage 5's prompt fenced off the other's files,
but not the reverse; the only overlap turned out to be one line.

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
- **A third environment red, found and proved on 2026-09-10.** In a worktree that has never run
  `npm run build:fleet`, `tests/fleet-decisions-route.test.ts` › *server.ts wiring* fails with
  `process.exit unexpectedly called with "2"`: `server.ts` refuses to start without
  `tools/fleet/web/dist/index.html` (its own comment says why — a server with no client once
  answered 404 to the only person who visited). Proved rather than reasoned: after one
  `npm run build:fleet` the file passes 15 of 15. `dist/` is gitignored, so the build leaves nothing
  to commit. Same class as the two above — a build artefact a fresh worktree lacks — and worth
  adding to the brief the Overseer gives every fleet agent.

## Decision log

- 2026-09-10 — **No server change in this stage**, and the guarantee narrowed to display and drafts.
  Revision 2 narrowed it because delivery looked unprotected; revision 3 keeps the narrowing because
  delivery is *somebody else's* protection — the server's, applied fresh at the moment of the write.
  Same boundary, sounder reason.
- 2026-09-10 — **Fable arbitrated withhold vs caveat**, and this plan follows its ruling rather than
  Sol's F2/F3 repairs. Recorded as an overrule with an arbitration behind it, not as my own
  judgment: two established P1s do not go past on an author's say-so.
- 2026-09-10 — **Drafts keyed by verified conversation id, not by execution token.** A deviation
  from the roadmap's literal "per execution", taken deliberately and argued in Stage 2: a draft is
  addressed to a conversation, and a token key destroys typed work on a benign relaunch.
- 2026-09-10 — **A lesson about reviews, worth keeping.** F1 arrived graded "established", named the
  right file, and reached the wrong conclusion; I verified its premise (which fields survive a
  replacement — true) and not its conclusion (what `verifyTarget` compares — false), then escalated
  it. A finding arrives already framed as a defect with a fix implied, which makes a wrong premise
  harder to see than wrong code — review-prompt-template.md says exactly this, and it was still the
  thing that got me. Check the conclusion against the code, not just the premise.
- 2026-09-10 — Remount on a *replaced* verified token rather than threading an identity through five
  pieces of state. Simpler, and it is `continuityOf` used as designed. The transcript reader keeps
  an identity of its own anyway, because it is exported (F3).
- 2026-09-10 — sessionStorage for v1. localStorage is a retention question for Greg, written above
  as a one-line decision rather than a default. Overseer's ruling.
- 2026-09-10 — Stage 3's evidence-driven refresh **retained**, not reduced to the clock alone.
  Overseer's ruling; Sol concurs that the triggers are high-signal.
