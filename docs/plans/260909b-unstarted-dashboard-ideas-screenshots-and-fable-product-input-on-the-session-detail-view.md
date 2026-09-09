# Unstarted dashboard ideas, screenshots, and Fable product input on the Session detail view

**Status as of 2026-09-09: Stages 1 and 2 done — a written proposal, not code. Paused by the
Overseer before Stage 3.** Nothing here is built and nothing should be started from it until the
Overseer says resume: the five-hour Claude usage window went 8% → 40% in 84 minutes on the night of
2026-09-08 with half the current session count, and Greg asked for agents to be paused rather than
risk the fleet freezing while he slept. Stages 3+ exist only for whatever Greg or the Overseer picks
out of the ranking below.

Evidence for every "not started" claim is a `file:line` or a census row. **A GPT Sol review of that
evidence was dispatched and its verdict is not in this document yet** — see § Sol review, pending.

Up: [overseer-direction.md](../project/overseer-direction.md) is the direction this serves;
[260908f-overseer-and-fleet-improvement-roadmap.md](260908f-overseer-and-fleet-improvement-roadmap.md)
is the census this plan must not contradict.

## Goal

Greg, 2026-09-08:

> look for ideas in @docs/project/overseer-direction.md and related conversations that we haven't
> started work on, especially re web-dashboard UI improvements (ask the agent to take some
> screenshots, and get Fable product input on improving them), especially the Session detail view.

So this is a **review-then-build** job with the review as the deliverable:

1. **Stage 1** — a census of ideas that exist in the docs and in past conversations and that
   **nobody is building**. The hard part is not finding ideas; it is subtracting the eight things in
   flight tonight so the proposal does not collide with a live worktree.
2. **Stage 2** — screenshots of the dashboard as it actually is, at desktop and phone width, and
   Fable's product reading of them. Ends with a **ranked proposal** sent to the Overseer, and a stop.
3. **Stage 3+** — only what is picked.

## References

| Reference | Why |
|---|---|
| [overseer-direction.md § Attention](../project/overseer-direction.md#attention-and-who-the-overseer-is-really-watching) | Fable's reframing: the expensive agent is the one working confidently on the wrong thing. The three surfaces — inbox, log, roster. |
| [overseer-direction.md § `idle` is the bug](../project/overseer-direction.md#idle-is-the-bug-the-vocabulary-describes-the-pane-not-the-work) | The vocabulary describes the pane; Greg needs to know about the work. Measured, not asserted. |
| [overseer-direction.md § What Greg asked for on 2026-09-08](../project/overseer-direction.md#what-greg-asked-for-on-2026-09-08-in-his-own-words) | The five verbatim asks, several of which name a mechanism. |
| [overseer-direction.md § Later, and deliberately not now](../project/overseer-direction.md#later-and-deliberately-not-now) | A21–A30, Astra's deferred list; the fence around what must not be proposed yet. |
| [260908f roadmap § census](260908f-overseer-and-fleet-improvement-roadmap.md) | Shipped / built-not-wired / proposed at `77c7a502`, kept current by the Overseer. |
| [overseer-queue.md](../project/overseer-queue.md) | The slow lane; being on it is the authorisation gate 3 asks for. |
| `tools/fleet/web/src/SessionDetail.tsx:1-95` | The file's own header: six sections, the clutter pass, and Fable's caveat rule. |
| `tools/fleet/web/src/mode.ts` | Three modes, state in the URL hash — `#sessions?order=uptime&sel=%242475`. |
| [vision.md § Principles](../project/vision.md#principles) | The augmentation principle, and its narrow application here (§ Does the augmentation principle apply?). |

## Principles and constraints for this plan

- **Subtract before adding.** An idea already owned by a live session is not a candidate, however
  good. The eight in flight on 2026-09-08 night are listed in Stage 1 and excluded by name.
- **Do not edit the shared web files before Stage 3.** `SessionDetail.tsx`, `SessionsPanel.tsx`,
  `App.tsx`, `Dock.tsx`, `OverseerPanel.tsx` belong to other sessions tonight.
  `SessionDetail.tsx` is being re-parented by `dashboard-titles-descriptions-detail`; anything here
  that touches it must be agreed with that session **by name** and land after it.
- **Screenshot the worktree's own build, not only the live page.** The live server on 8787 runs from
  the primary checkout and lags `dev` by a restart, so reading it as evidence about current code is
  the mistake [§ the runtime record](260908f-overseer-and-fleet-improvement-roadmap.md) already
  documents. A second read-only instance runs on `127.0.0.1:8799` from this worktree.
- **The simpler option passed over:** proposing from the docs alone, with no screenshots and no
  Fable. Rejected because the docs describe intent and the screenshots show what a phone actually
  renders — and the 2026-09-08 clutter pass found *3,398px at 390px wide, 31 buttons*, which no
  amount of reading the doc would have surfaced.

## Stages

### Stage 1 — what has NOT been started

*Status: in progress.*

- [x] Read the direction doc's five named sections, the roadmap census, and `overseer-queue.md`.
- [x] Sweep past transcripts for dashboard/Session-detail ideas (Sonnet subagent, read-only).
- [ ] Inventory what the dashboard renders today, with `file:line` (Sonnet subagent, read-only).
- [ ] Produce the census table: idea · where it came from · what exists today · who is on it.

#### Owned tonight, and therefore not candidates

Excluded by name so the proposal cannot collide with a live worktree: session titles and
descriptions, and the Session-detail re-layout that leads with the last message, and the
new-session notify line (`dashboard-titles-descriptions-detail`); a Usage limits tab with 24 h
history (`usage-limits-tab`); message-the-Overseer and broadcast (`overseer-tab-messaging`);
execution identity (`260908f-roadmap-exec-identity`); the usage card (`260908f-roadmap-usage`);
actions / kill / drain / quarantine / receipts (`claude-agents-dashboard`); scheduler arming
(`overseer-md-agent-coordinator`).

**And four more, dispatched by Greg while this sweep was running** — the Overseer named them on
request, 2026-09-09 ~01:35:

- `recent-messages-tab` — a Recent messages tab: a rolling window of the last N turns across all
  agents, with filters. **This takes S3 off the list**, which was a candidate an hour ago.
- `deploys-tab` — a Deploys tab: recent production deploys with time and changelog entries from
  `src/web/changelog-versions.ndjson`, no Vercel calls.
- `readiness-tab` — a Readiness tab: latest tests / typecheck / check on `dev`, when last run, 24 h
  graphs. **L4 sits against its edge** and is left unranked below rather than claimed.
- `dashboard-modes-doc` — a doc on adding a new mode or tab. No code, so it takes nothing.

That is twelve owners in one night, and it is the reason this stage subtracts before it proposes:
two of the five Session-detail candidates found by the sweeps were owned by somebody within an hour
of being written down.

#### A measurement taken for this plan: the page cannot tell a worktree from the primary checkout

**This is first-hand, not a reading of the docs, and it corrects the guess it started as.**

`whereLine` renders `repo · worktree` and silently drops a part that is null
(`tools/fleet/web/src/view.ts:259-262`). On the live fleet at 2026-09-09 01:30, **14 of 18 rows carry
`worktree: null` and `meta.dir = /home/greg/code/spideryarn2`** — the shared primary checkout, which
[AGENTS.md](../../AGENTS.md) tells every agent not to work in. So the page appears to say that most
of the fleet is editing the shared tree.

It is not. `meta.dir` is the directory `new-claude` pinned **at launch**, and the pane's own shell
never moves, so `/proc/<panePid>/cwd` repeats the same wrong answer. **The Claude process — the
pane's child — is the one that moved**, and reading its `cwd` says worktree for **8** of those 14.
The remaining Claude session genuinely in the primary is `fb2p-quotes-always-outlined-in-text`,
idle for six hours.

Both controls held, which is why this is worth acting on:

- **Positive:** this session shows `meta.dir` = primary while its Claude process sits in
  `.claude/worktrees/dashboard-ideas-review`, because it called `EnterWorktree` after launch.
- **Negative:** `fb2p-…` and `Overseer` come back as the primary, so the probe is not simply
  answering "worktree" to everything.

Limits worth stating before anyone builds on it: the probe walks one level down and looks at three
children (`pgrep -P … | head -3`), so a session with many children could be misread; one pane pid was
already `UNREADABLE`. Script: `scratchpad/dash-cwd-probe.sh`.

**Why it matters here.** This is exactly the misdirection proxy Fable named — *"the agent that costs
real money is the one that is working, confidently, on the wrong thing … or building in the primary
checkout"* — and the fact is one `readlink` from a field the collector already has. The page today
renders neither the true value nor the false one.

#### The census

Ideas that survive the subtraction. **Ownership is the column to read first** — three sessions
(`recent-messages-tab`, `dashboard-modes-doc`, `deploys-tab`) launched after this brief was written
and the Overseer has been asked what they own, so rows marked *ask* are unranked until it answers.

**Session detail** — Greg's emphasis.

| # | Idea | Where it came from | What exists today | Who is on it |
|---|---|---|---|---|
| S1 | The detail says what the session is **doing**, not what its pane looks like — work kind and elapsed (review / test / browser / other) | `260908f:835-848`, census row 466 | `classifyPaneWork` (`tools/overseer/work.ts:693`) and `probeProcessTable` (`work-probe.ts:58`) exist with **zero non-test callers**; `RegisterEntry` has no `work` field | nobody named — *ask*, the Overseer may hold it |
| S2 | The composer keeps an unsent draft across a reload | Astra A19-20 (*preserve drafts across phone suspension*); census row 474 | **Nothing.** Zero hits for `localStorage`, `sessionStorage` or `draft` in `tools/fleet/web/src/` (verified for this plan) | nobody |
| ~~S3~~ | ~~Recent messages refreshes while the pane is open~~ | `RecentMessages.tsx:47-49` — fetched on open and on *Read again*, never on the 5 s loop, so a phone left open shows a frozen conversation | — | **`recent-messages-tab`, dropped** |
| S4 | *Yes, once* and *yes, and auto-approve for the session* drawn as visibly different grants | A9's second half, 2026-09-08: *"make 'yes, once' and 'yes, and auto-approve this for the session' VISIBLY different … the pane renders them as adjacent list items"* | `QuestionCard` draws the pane's options as a list; A9's material-binding half landed, this half is not confirmed | nobody found |
| S5 | Show the harness's own suggested reply, with *send this* / *say something else* | `260907e:581-582` | unticked checkbox, nothing rendered | nobody |

**Sessions list.**

| # | Idea | Where it came from | What exists today | Who is on it |
|---|---|---|---|---|
| L1 | A row says whether the session is in a **worktree or the shared primary checkout** | Fable's misdirection proxy; measured above | `whereLine` (`view.ts:259-262`) drops a null worktree, so 14 of 18 rows render identically and the true answer is in `/proc/<claude pid>/cwd` | **nobody — confirmed by the Overseer.** But `260908f-roadmap-exec-identity` is landing a per-pane `/proc` read this hour, so **the readlink rides on that pass rather than adding a second** |
| L2 | *Command line unchanged for N hours* as a visible hang signal, **on the list** | Greg, 2026-09-08: *"Perhaps check in on the agents that haven't changed command line in 7h. That sounds like something has hung!"* — plus the `npx playwright install webkit` that ran 5 h 43 m unnoticed | `LastWrote` (`SessionDetail.tsx:581-599`) answers this **per session, and only if you open it**: it needs the transcript read that happens on open, so it cannot appear on a card as written. And being transcript-based it says nothing about a `shell` pane — which is exactly where the wedged install lived. Greg's ask was fleet-level | nobody |
| L3 | Free-text filter over the list | `260908f:1043-1045` | unticked, and explicitly conditional on someone needing it | nobody |
| L4 | A red gate leads with **which worktree last touched the failing files**, not the assertion | `260907e:1705-1743`, from `split-routes-one-slice`, 2026-09-08: *"the field worth showing first is not the assertion but which worktree last touched the files it names"* | every item under the stage unticked | **unranked** — `readiness-tab` now owns the tests-on-`dev` surface this would live on, and attribution is a feature of that surface rather than a separate one. Offer it to that session, don't build it here |

**Cross-cutting.**

| # | Idea | Where it came from | What exists today | Who is on it |
|---|---|---|---|---|
| X1 | The page says **which revision it is** — server sha and build time against the bundle's own stamp, disagreement shown rather than logged | `260907e:1759-1785`; census: *"No client build revision anywhere"* | **Nothing.** Zero hits for `revision`, `buildSha` or `__BUILD` in the web client (verified). This is the reason my own brief had to warn me not to read the live page as evidence | nobody |
| X2 | Times in local as well as UTC | `overseer-queue.md:57-58`, Greg moves between London and Athens | proposed for the CLI; the page has the same problem | nobody |

**Overseer tab.**

| # | Idea | Where it came from | What exists today | Who is on it |
|---|---|---|---|---|
| O1 | The **decision log** — what was decided on Greg's behalf, by whom, since he last looked | Greg's own first bullet in § What we are going towards; the 8 am surface of the three | `overseer.md:51` says **not built as of 2026-09-08**; kept by hand in a markdown file | *ask* — a proposal on `overseer-queue.md`, not dispatched |
| O2 | A review surface where a proposal sits until a person looks at it | `overseer.md:240-246`: *"Rule 3 is not built"*, *"Nothing a rule writes reaches a person yet"* | nothing | *ask* |

**Deliberately not proposed.** A21 (generic unattended action buttons), A22 (event protocol), A23
(resource claims), A30 (a budget on the Overseer) are on Astra's *later, and deliberately not now*
list, and multi-account rotation and multi-box are Greg's own SOON / SOMEDAY MAYBE. They are
recorded here so the next sweep does not re-find them, not ranked.

### Stage 2 — screenshots and Fable product input

*Status: in progress.*

- [ ] Second read-only dashboard on `127.0.0.1:8799` from this worktree, isolated by
      `FLEET_HEALTH_DIR` and `FLEET_ANSWER_ENABLED=0`, so it cannot contend with the live one.
- [x] Screenshots at 1280 and 390: Sessions list, Session detail (working, and the row the
      attention inbox is waiting on), Box health, Overseer tab, attention inbox. **16 files** in
      `scratchpad/shots/`.
- [ ] Fable product input on the screenshots + the Stage 1 table + Greg's quotes.

#### What the screenshots measure

Page heights, from the PNGs themselves (`scratchpad/dash-png-dims.py`), phone = 390×844:

| view | phone height | screens |
|---|---|---|
| one session's detail (`$2475`, *working*, no question) | **4,544px** | **5.4** |
| another session's detail (`$2600`) | 3,922px | 4.6 |
| a **shell** pane's detail | 1,104px | 1.3 |
| the sessions list, 20 sessions | 3,334px | 4.0 |
| the attention inbox | 3,095px | 3.7 |

**The 2026-09-08 clutter pass measured a needs-you detail at 3,398px and 31 buttons and cut it
down.** 4,544px is bigger, but it is **not a like-for-like regression measurement** and should not
be quoted as one: it is a different view a day later — a *working* session with no question card —
and much of its height is the Recent-messages transcript, whose length varies by session. The shell
row's 1,104px is the useful control: the length is content, not chrome.

**What is above the fold on a phone when you open one session** (`shot-session-2475-390-abovefold.png`).
In order: the fleet header; an attention-inbox card; a *New session* card carrying two lines of
prose about `gjd-remote`; the `19 SESSIONS / Order` list header — and only then the session you
tapped. **The thing you asked for starts more than half a screen down, under three pieces of chrome
that belong to the list.** The detail is supposed to *replace* the list at this width
(`choosePanes` in `fit.ts`), and it does; what it does not replace is everything `App.tsx` and
`SessionsPanel` draw above it.

**What a list card spends itself on** (`shot-sessions-390-abovefold.png`). Two cards fit above the
fold out of twenty. Each spends three of five lines on identifiers — `spideryarn/reading2`, then
`dashboard-ideas-review · $2602 · %2605` — and the repo is identical on every row on this box. Both
visible cards read `WORKING` / *no title yet* and are otherwise indistinguishable. This is also L1
rendering: both of those sessions are in worktrees, and the card cannot say so.

Two smaller things the shots caught: the header counts **20 sessions** while the attention line
underneath says **1 of 18** could not be judged — two denominators on one screen; and the header,
the attention banner and the *New session* card together take ~430px before any content.

#### Two corrections to the screenshot agent's own report

Recorded because both would have gone into the proposal as findings if taken at face value.

- It reported the attention card's *"show the last 22 lines of its screen"* disclosure as possibly
  *"dead markup"* because Playwright could not target it. It is not: `AttentionPanel.tsx:665-676` is
  a real `<details>` with a caveat paragraph and a `<pre>` of the captured excerpt. That was a
  tooling failure, not a UI gap.
- It also reported that the inbox flipped from *"at least 1 waiting on you"* to *"nothing is
  waiting on you"* while it was working, and never flipped back over a 100-second poll. **That one
  is real** — but **my explanation of it was wrong**, and Fable refuted it from the code. See
  § *The vanishing card, and the explanation I got wrong* below.
- [x] Ranked proposal in this doc: each item with a mock, a cost, and its dependency.
- [ ] Send the proposal to the Overseer by `SendMessage` and **stop**.

## The ranked proposal

**Fable's ranking, 2026-09-09**, with its rulings marked. Nothing here is built. Items are ordered
by what changes a decision, and every one names the session it must be agreed with.

### Fable corrected three things in Stage 1 before ranking anything

Recorded first, because two of them were mine and one changes what an item costs.

- **4,544px is not a regression against the clutter pass's 3,398px, and I was right to hedge but
  wrong about why.** Roughly **3,100 of those pixels are the transcript**, which did not exist at
  the earlier measurement. Non-transcript chrome is about 1,900, plus ~490 of fleet chrome above the
  detail. *"The clutter pass held. The transcript's rendering is the new cost, and it is separate
  work."*
- **L2's premise was too pessimistic.** I wrote that `LastWrote` "cannot appear on a card as
  written" because it needs the transcript read that happens on open. Fable: `stat()` the
  transcript's mtime — **the path is already on the page, so no read is needed**. I had answered a
  harder question than the one that matters.
- **My observation 1 undersold itself.** I said the tapped session starts half a screen down. The
  sharper fact is *what* is above it: on `$2475` the inbox card at the top **is about the same
  session you just tapped**. The inbox says *waiting 33m, S8-2 is a question for Greg*; the detail
  underneath says `WORKING · wrote 32s ago` and offers no question and nothing to answer.

  > One screen, one session, two verdicts, and the place where Greg would act (the composer) is not
  > attached to the thing he would be acting on. So it matters more than a scroll problem: **the
  > detail does not know what the inbox knows.**
  >
  > — Fable, 2026-09-09

### 1 · On a phone, the detail is the whole page

When `sel` is set and the viewport is narrow, draw no inbox card, no *New session* card and no
`19 SESSIONS / Order` header. `← All sessions` is the way back and already exists.

```
  BEFORE (390px)                        AFTER
  ┌────────────────────────────┐        ┌────────────────────────────┐
  │ Fleet  19 sessions  11 …   │        │ ← All sessions             │
  ├────────────────────────────┤        │ WORKING  wrote 32s  up 9h  │
  │ AT LEAST 1 WAITING ON YOU  │        │ Overseer.md agent coord.   │
  │  ┃ TECHNICAL   waiting 33m │  ~490  ├────────────────────────────┤
  │  ┃ overseer-md-agent-co…   │   px   │ WHAT IT NEEDS FROM YOU     │
  ├────────────────────────────┤        │  S8-2 is a question for…   │
  │ [New session]  Starts a …  │        │  [ answer box ]            │
  ├────────────────────────────┤        └────────────────────────────┘
  │ 19 SESSIONS      Order ▾   │
  ├────────────────────────────┤        the fold now falls below the
  │ ← All sessions             │ ← fold  thing you tapped, not above it
```

*Changes a decision:* the decision surface is above the fold instead of below it.
*Cost:* one conditional. *Depends on:* `App.tsx` — **agree with `dashboard-titles-descriptions-detail`
by name and land after it.**

### 2 · The inbox's judgement about this session becomes section 1 of its detail

If the Overseer holds a card for this session, render it *inside* the detail as **What it needs from
you**, with the composer directly under it — and show both facts with their sources, side by side,
rather than hiding the contradiction.

```
  WHAT IT NEEDS FROM YOU
  ┃ The agent says S8-2 is a question for Greg between amending
  ┃ gate 4 and building the minimal reservation first.
  ┃
  ┃ judged waiting 33m · scanned 1m ago · inferred from its last turn
  ┃ transcript says wrote 32s ago
  ┃                                            ▸ show its last 22 lines
  ┌──────────────────────────────────────────────────────────┐
  │ e.g. do 8b first and leave gate 4                         │
  └──────────────────────────────────────────────────────────┘
   [ Send now ]  [ Queue (~73s) ]
```

Two sources disagreeing, both named, is the honest form — and it is the half of the augmentation
principle that carries over here: *never hide that a decision was made, or who made it.*
**This absorbs S5** — if the Overseer's judgement carries a recommendation it belongs on this card,
so S5 is not built separately. *Cost:* small; the page already fetches the inbox, key it by session.
*Depends on:* `SessionDetail.tsx` — **agree with `dashboard-titles-descriptions-detail` by name.**

### 3 · The misdirection proxies, which no screen shows at all

Not in my census; Fable's answer to *what is missing entirely*. A `wrote X ago` line on **every list
card** (from the transcript's mtime — a `stat`, not a read), and `last commit / pushed` on the
detail.

```
  ┃ WORKING                                  up 9h 28m     ← today
  ┃ no title yet
  ┃ spideryarn/reading2
  ┃ dashboard-ideas-review · $2602 · %2605

  ┃ WORKING · wrote 3h ago · no commit in 4h        $2602  ← proposed
  ┃ Overseer.md agent coordinator
```

> `WORKING · wrote 3h ago · no commit in 4h` is "go look"; `pushed 5m ago` is "leave it".
> `up 9h 27m` changes no decision and can shrink.
>
> — Fable, 2026-09-09

*Cost:* small for the mtime half, small-moderate for the git half. *Depends on:* the git half needs
the session's **real** cwd, which is item 4's readlink.

### 4 · L1 — worktree or the primary checkout, with ink only on the bad case

A worktree is the normal state and gets its name; the shared primary gets a loud label. Today's page
is wrong in the direction that trains Greg to ignore it: 8 of the 14 rows that look like the primary
are in worktrees.

```
   dashboard-ideas-review · $2602              ← in a worktree: just the name
   ⚠ PRIMARY CHECKOUT · fb2p-quotes… · $2496   ← the one that wants an answer
```

*Depends on:* `260908f-roadmap-exec-identity`'s per-pane `/proc` pass — **ride on it, do not add a
second read.**

### 5 · A shell pane's detail is its command line, elapsed and parent — and nothing else

Delete the two paragraphs of apology. They change belief, not action.

```
  BEFORE   SHELL, BUSY · up 5h 43m
           "this row has no Claude session id, so there is no way to tell
            this conversation from whatever is in that pane now"
           "A shell. Nothing can be typed at it…"

  AFTER    SHELL · npx playwright install webkit · 5h 43m
```

The wedged `playwright install webkit` that ran 5 h 43 m unnoticed is the whole case: the first form
said nothing, the second **is** the finding. This is L2 in its list form too. *Depends on:* the
process-table read — `probeProcessTable` has zero callers and `exec-identity` is landing the `/proc`
pass.

### 6 · Subtractions on the working detail

Each trivial; together most of the phone's scroll. Hide *Waiting to go to it* when the queue is
empty (four lines of prose for "nothing"); collapse *Force* behind one disclosure while its buttons
are dry-run-only and therefore cannot do anything; transcript timestamps
`2026-09-08T23:11:55.754Z` → relative (**this dissolves X2 for the detail with no timezone
decision**); tool-only turns → one line each, `Bash · Edit · Write ×2` (**7 of 12 turns on `$2475`**);
harness notices hidden by default (**on `$2600` it is the first and longest thing in the
transcript**); the *New session* card's two lines of `gjd-remote` prose move into the box it opens;
*"there may be more"* becomes a tap on the count.
*Depends on:* `RecentMessages.tsx` — **agree with `recent-messages-tab` by name.** The
lead-with-the-last-message re-layout is owned and Fable declined to re-rule on it.

### 7–9 · The rest, in order

- **S2 — drafts survive a reload.** `localStorage` keyed by session id. An action saved, not a
  belief; a phone suspends mid-sentence. Cheap, unowned, no dependency.
- **X1 — the page says which revision it is.** One line in the dock. *"It is for agents rather than
  Greg, but it already cost this plan a warning to itself."*
- **Order option `last wrote`, stalest first.** An option, not the default; see whether it becomes
  the one he uses.

### What Fable ruled against, and why

| | Ruling |
|---|---|
| **S1** — a generic work classifier on the detail | **Don't.** The direction doc's own measurement already found the Codex arm's yield small and conditional. Items 3 and 5 are the small tweaks that get most of it; S1 is the hard version |
| **S4** — *yes once* vs *yes and auto-approve* drawn differently | **Don't.** The fleet is 35 auto to 1 default and the doc rules a permission dialog is a **launch defect, not a queue item for Greg**. S4 designs the rendering of a thing that should not be on the screen |
| **L3** — free-text filter | Not at twenty sessions |
| **L4** — red-gate attribution | Offer it to `readiness-tab`; not this plan's |
| **O1 / O2** — decision log, proposal-review surface | **Name it, don't start it.** O1 is *"the most valuable unbuilt thing in the whole system — it is the 8am surface"*, but it is Overseer data rather than dashboard chrome and it sits on `overseer-queue.md` awaiting Greg's promotion |
| the two denominators (20 vs 18) | Beneath notice as a bug; a one-word copy fix — *"1 session could not be judged"*, no denominator. Reconciling two snapshots to agree on a count is the hard version of a problem a dropped word removes |

### The vanishing card, and the explanation I got wrong

I put the disappearing inbox card to Fable as *"the classifier changed its mind with no new
evidence"*. **It read the code and that is not a path the code has.** Three mechanisms decide it
before any product judgement does: a verdict is cached by the tail's **fingerprint**, which excludes
the clock and the input box, so identical text is a cache hit and no model call
(`attention-classify.ts`, `planClassifications`); verdicts **survive a restart**, only the wait
clocks reset on an epoch change (`attention-memory.ts` § epoch); and a pane that is **mid-turn is
not classified at all** — *"nothing has ended, so nothing can have been asked"*
(`attention-pass.ts:87`, `turn-tail.ts:344`).

**And my own screenshot said which path it was.** `shot-session-2475-390-abovefold.png` has the card
saying *waiting 33m, scanned 1m 27s ago* beside a detail for the same session reading
`WORKING · wrote 32s ago`. The session had already resumed; **the card was the stale one and the
next pass withdrew it correctly**. My *"nobody sent anything"* meant no *human* did — the transcript
on that very page shows a peer message arriving over the socket and the agent going straight back to
work.

> Peer messages and the Overseer's own nudges end waits without Greg all night. That is not a flap;
> it is the system working.
>
> — Fable, 2026-09-09

**Ruling (Fable, 2026-09-09): do not make cards sticky.** A pinned *waiting* card about a session
that is mid-turn is a false claim about a person's obligations, and it is the **unsafe** direction
rather than merely the untidy one — an answer typed into a pinned card lands in a live turn, which
is the *"a message beginning `1` while a dialog is up is an approval"* hazard. Astra's finger rule
does not apply: a prose card has no controls to move under a finger.

**What is actually wrong is that the disappearance is silent** — Greg taps through and finds
nothing, with no account of why. The fix is a **tombstone, not a pin**, and it ranks alongside item
2 above:

```
  ⊘ overseer-md-agent-coordinator — was waiting 33m
    resumed 00:53 (turn started)
```

Published for one pass when a session was in the last list and is absent from this one. The pass
already knows which arm each session fell into (`breakdown`), so it is a diff of two lists plus a
sentence. **It is O1 — the calibrate surface — in its smallest possible form.** With item 2 the
phone lands on *"judged waiting 33m at 00:51 · now WORKING, wrote 12s ago"*, and the loop closes
without pinning anything.

**And the one real flap to guard against, measured before built.** A tail can change cosmetically —
a `✻ Waiting for 1 background agent` line, output scrolling — giving a new fingerprint, a new model
call, and possibly a different verdict on the same question with the wait clock reset. *That* is the
classifier changing its mind. Fable's simplest-version-first: have the pass **count**
*"question → no-question on a new fingerprint while the pane stayed `ended`"* and print it. Nonzero
over a day ⇒ inherit the wait clock when the new tail contains the old one. Zero ⇒ nothing to build.
*"Do not add hysteresis on a hypothesis."*

### One ruling worth quoting whole

> A list card carries one identifier, `$id`, small and last; the repo and the `%` window id move to
> *Where it is* on the detail.
>
> — Fable, 2026-09-09

The repo is identical on 19 of 20 rows and `%2605` is a tmux window id nobody types. The only
identifier with a job is `$id`, because the Overseer tab cross-references by it.

### Sol review, pending

Dispatched 2026-09-09 00:58 into tmux job `dashideas-sol-0058-1867344`, prompt at
[260909b-unstarted-dashboard-ideas-review-prompt.md](260909b-unstarted-dashboard-ideas-review-prompt.md),
answer due at `docs/plans/260909b-unstarted-dashboard-ideas-review-sol.md`. Its brief is not to
review the ranking — Fable did that — but to **try to falsify each "nobody built this" claim with a
grep**, and to name how the `/proc` probe behind L1 could be wrong.

**Do not read this plan as reviewed until that file exists and is non-empty**, and check its mtime
rather than only that it is there: a killed run still writes an answer, so a stale file and a fresh
verdict look identical. If the review did not survive the pause, re-run the one command above; the
prompt is committed, so it is reproducible.

### Stage 3+ — build what is picked

*Status: not started, and deliberately unwritten.* Stages get added here when the Overseer answers.
