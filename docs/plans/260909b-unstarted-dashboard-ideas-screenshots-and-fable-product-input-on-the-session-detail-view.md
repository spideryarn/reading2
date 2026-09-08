# Unstarted dashboard ideas, screenshots, and Fable product input on the Session detail view

**Status as of 2026-09-09: Stage 1 and 2 in progress — a written proposal, not code.** Nothing here
is built. Stages 3+ exist only for whatever Greg or the Overseer picks out of the Stage 2 ranking.
Evidence for every "not started" claim is a `file:line` or a census row, cited in the table below.

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
- [ ] Screenshots at 1280 and 390: Sessions list, Session detail (working, and the row the
      attention inbox is waiting on), Box health, Overseer tab, attention inbox.
- [ ] Fable product input on the screenshots + the Stage 1 table + Greg's quotes.
- [ ] Ranked proposal in this doc: each item with a mock, a cost, and its dependency.
- [ ] Send the proposal to the Overseer by `SendMessage` and **stop**.

### Stage 3+ — build what is picked

*Status: not started, and deliberately unwritten.* Stages get added here when the Overseer answers.
