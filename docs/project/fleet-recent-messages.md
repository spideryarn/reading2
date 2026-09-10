# The cross-agent message feed

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md).

> add a "Recent messages" tab with a rolling window of the last N messages across all agents (making
> it easy to filter)
>
> — Greg, 2026-09-08

The **Recent messages** tab of the fleet dashboard: the last N messages across every session on the
box, newest first, filtered by session, speaker or text. `GET /api/feed`, served by
[`routes-recent-feed.ts`](../../tools/fleet/routes-recent-feed.ts) and drawn by
[`FeedPanel.tsx`](../../tools/fleet/web/src/FeedPanel.tsx).

How it was built and what was passed over is
[260909b](../plans/260909b-recent-messages-tab-a-rolling-window-across-all-agents.md); making the
rows clickable and scannable, the day after, is
[260909c](../plans/260909c-recent-messages-tab-clickable-to-sessions-and-scannable-status-and-timing.md).
Adding a tab at all is [fleet-dashboard-modes.md](fleet-dashboard-modes.md). This doc is the part a future reader
has to know **before changing anything here**, and all of it is about one thing: what the feed is
entitled to claim.

## Why this tab needs more honesty machinery than the detail pane

`RecentMessages.tsx` shows one session's tail, and it answers *is this row telling me the truth?* The
person looking at it chose that session and usually knows what it was doing, so a wrong answer has
their own memory to contradict it.

**This feed has nothing.** It shows turns from sessions the reader was never watching, so a message
that is misattributed, or a session quietly missing from the window, looks exactly like a correct
one. Every field below that reads as defensive bookkeeping exists for that asymmetry.

## The merge is exact, and the payload says when it isn't

Each session is asked for **its own newest N** — the same N the reader asked for — then everything is
merged, sorted descending, and cut to N. That is exactly "the last N messages across all agents", and
the proof is one line: any message among the true newest N must be among its own session's newest N.

Asking each session for a small fixed *k* instead is wrong in the case the tab exists for: if one
agent has written 40 of the last 50 messages, the *k*=6 version shows six of them and pads the rest
from quieter sessions — and looks entirely normal doing it.

**The proof has four premises**, and a payload that cannot vouch for all of them must not be
described as complete:

1. the census is fixed;
2. each message belongs to exactly one session;
3. every session really supplied its newest N;
4. local and global "newest" use the same total order.

So `FeedCoverage` is a **required top-level field** — `complete`, or `indeterminate` with typed
reasons — and `complete` is constructible only when nothing fired. Six things demote it:
`byte-budget`, `unreadable`, `no-transcript`, `undated`, `out-of-order`, `duplicate-conversation`.

**The first design got this wrong in an instructive way**: it listed only the byte-truncated sessions
as an advisory line beside the feed. GPT Sol's objection is the one to remember — *an unreadable
session can contain all of the true newest messages*, and listing it as one more row in a census does
nothing to stop the list above looking authoritative. Uncertainty about the window is a property of
the window, not of a row inside it.

Three decisions inside that, each of which stops the warning being useless:

- **The exemption keys off the launcher's own `kind`, never off the reason code.** A row declared
  `shell` or `setup` has no conversation to miss — six of the box's rows — and counting those would
  make coverage permanently indeterminate, which is **a warning that never clears, and one nobody
  reads**. But `claudeSessionId` is null for *two* things: a session that is not a Claude, **and a
  legacy Claude that predates the launcher pinning one**. Both produce `no-claude-session-id`, so
  exempting the code rather than the declaration would hide a real conversation. Verified against the
  live box: coverage still comes back `complete`.
- **Every incomplete session is named.** There is deliberately no "the truncation fell outside the
  window" exemption: it would rest on unread turns being older than read ones, which is the very
  monotonicity `out-of-order` exists because we cannot assume — and that check can only see turns
  that came back. **`complete` has to mean proven, or it means nothing.** The cost was measured
  first: 0 sessions cut short at N=25, 1 at N=50, 3 at N=100.
- **Reasons are keyed by `sessionId`, never by name.** Names are reassigned when a session dies and
  two sessions can wear one, so a warning keyed by name can point at the wrong agent.

## The guard turn: every session is asked for N+1

One API turn is written as **up to four JSONL records sharing a `message.id`** — 1497 of 2806 ids in
the measured transcript appeared on more than one line — and `recordsToTurns` coalesces them.

So when the byte budget stops the walk *inside* a shared id, the oldest turn returned is built from
only the records that fell above the boundary: **a real-looking turn with some of its text and tool
calls missing, and a count that says "complete"**. No count can see this.

Hence `GUARD_TURNS`: ask for N+1 and discard the oldest whenever the walk did not reach the start of
the file. The turn below a discarded one is whole by construction, because its records are contiguous
and the boundary is below them. Completeness then reads `reachedStartOfFile || contributed >= N`.

**If you change the per-session limit, change it with the guard.** Asking for exactly N restores the
bug silently.

## There is no instant this feed describes

The roster is up to sixty seconds old when the fan-out starts, and the transcripts are then read over
~250 ms. A session created after collection is absent; one that has since died is still present and
its transcript still reads; a session read early may have appended while a later one was read.

So the payload carries `collectedAt`, `readStartedAt` and `readFinishedAt`, and the tab prints all
three. A single "as of" timestamp would imply a snapshot that never existed.

## Attribution is labelled, never asserted

`CLAUDE_SESSION_ID` is pinned when a pane is created and never updated
([transcript.ts](../../tools/fleet/transcript.ts)), so a re-used pane reads the **previous**
conversation — real messages, well formed, correctly attributed, and not this agent's. Every message
carries a `FeedAttribution`:

- `claimed-only` — a pinned id, nothing confirming and nothing contradicting it. The ordinary case.
- `suspect` — something disagrees, today a transcript untouched for 30+ minutes against a `working`
  row.
- `verified` — **currently unreachable, deliberately.** It needs `FleetRow.execution`; until that
  lands, an arm nothing can produce is better than a `verified` that means *we did not check*. When
  it lands, `attributionOf` reads that field and nothing else moves.

## Cost, and why it is not polled

Measured on the box, 21–23 rows:

| | at N=50 |
|---|---|
| wall | ~250–300 ms |
| transcript bytes read | ~10 MB (of 65 MB on disk) |
| response | 40 kB, **8 kB gzipped** |

**The cost that decides the cadence is the disk, not the wire.** 8 kB is nothing; 10 MB of transcript
reads every sixty seconds is not. So there is no timer, and **never a read from the collection
loop** — [overseer-direction.md](overseer-direction.md) and the responsive-collection stage of
[260908f](../plans/260908f-overseer-and-fleet-improvement-roadmap.md) both say the collector may not
be held by a slow reader.

The tab reads when it opens visibly, when the reader asks, and when the session list it already has
shows evidence that the list may be out of date: a session appearing or going, a status or a dialog
changing, a different conversation claimed, a run replaced, or a different tmux server. "Replaced"
means a different *verified* token after the row has established a baseline; learning its first
verified token is not a replacement. A row that merely fails to verify is the box's weather, and
counts for nothing. So is a tmux-server pid going missing and returning: only two different named
pids establish a different world. Never sooner than `FEED_REREAD_FLOOR_MS` after the last read
started, except that two different named pids discard an old-world read and start again at once;
never from a hidden tab. The digest is `feedEvidence` in `feed-client.ts`; the rules are
`feedReader` in `FeedPanel.tsx`
([260910c](../plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md), Stage 3).

The reader owns one live request slot. A request during one live read coalesces into exactly one more;
the 15-second deadline releases the slot and generation-discards a late answer. The real HTTP client
passes an abort signal, but a substituted API that ignores abort can leave its old promise unresolved —
the page cannot make another implementation settle it, only stop waiting for it.

**What it cannot notice is the commonest case:** a session writing turns without changing status
produces no evidence at all. That is why the panel prints how long ago it last read, and why that
clock, not the re-read, is what keeps the list honest.

An earlier draft of the plan quoted 266 kB on the wire. That was the size of all 579 **candidate**
turns, not the 50 the route serialises — a number measured on a step's input, read as a number about
its output. Re-measure through `feedPayload` itself if you touch this.

## What a row is entitled to say about its session

A row shows what its session is **doing now** — the same `StatusPill` the Sessions list draws, and a
click on the session name opens it there. Both of those are joins between two different answers, and
the whole of this section is about what has to be true before either is allowed.

**The status is never on `/api/feed`.** It is read out of the live session list `/api/state` already
supplies, by `sessionId`. A status field on the feed would be a second reading of the same tmux
output on a different cadence, kept in step by nothing — and the two tabs disagreeing about whether a
session is working is exactly the failure
[overseer-direction.md § `idle` is the bug](overseer-direction.md) exists to prevent.

**But `$1643` means nothing outside one tmux server**, so the payload carries `tmuxServerPid` and the
join is gated on it. After a tmux restart, a feed read a minute ago holds handles that now name
*different* sessions: the lookup would succeed, take an unrelated session's status, and open the
wrong conversation on a click — all of it looking entirely normal. This was GPT Sol's P0 on
[260909c](../plans/260909c-recent-messages-tab-clickable-to-sessions-and-scannable-status-and-timing.md);
the plan had claimed there was "nothing to design at the addressing level".

**Not knowing and knowing otherwise are different arms**, and collapsing them either way is a
mistake. Two pids that *disagree* are proof: no status, and no link. A pid that is *missing* is only
ignorance — any server predating the field answers that way for every row, so refusing outright
switches the whole feature off on no evidence, which is "a warning that never clears, and one nobody
reads". So an unverified row keeps a way in, but **it reaches the Sessions tab without selecting
anything**. Selecting on trust was the tempting middle and it is the one option that is wrong: the
pane it opens prints a handle that *matches the one clicked*, so a reader has nothing to notice.

**And the check has to survive the click, or it is theatre.** `sel` is a handle; `selpid` goes with
it, and the Sessions tab declines to resolve one against a snapshot of the other. Proving the join
safe and then handing over a bare handle leaves the destination matching `$1643` against whatever
tmux server it is looking at by the time it renders — which is the original bug, one component
further along. A URL with no `selpid` (a tap on the list, a hand-typed link, an old bookmark)
resolves exactly as it always did.

**Six arms, because there are six different things to say**, and five of them are silences that must
not read as a quiet session:

| | the row says |
|---|---|
| no state payload at all | session list has not arrived |
| a payload, `collectedAt === null` | no session census yet |
| one side named no tmux server | status not checked *(reaches Sessions, selects nothing)* |
| the two pids disagree | cannot be matched to a session *(link dropped)* |
| census finished, no such row, `unreadableRows > 0` | not in the readable session list |
| census finished, no such row, none dropped | not in the current session list |

The second is the one worth remembering: the server answers a good payload with no rows for the ten
seconds a first collection takes, and reading "not in the session list" off that calls **every
session on the box** absent. It is the same distinction the Sessions tab draws between "No sessions."
and "Collecting…".

**Timing: the age is shifted, the timestamp is not.** `turn.at` is the box's clock. The age is a
subtraction across two clocks, so it goes through the page's `ClockSkew`; the absolute instant is
printed by `zonedLine(turn.at)` **unshifted**, because shifting a string drawn as a wall clock
asserts an instant nothing happened at (`withClockSkew` in messages-client.ts carries the same
warning). Both come off one field.

Three things the age says that a subtraction would not. It carries *clocks not compared* while the
skew is unknown — this tab has its own route and can be on screen before the masthead has anything to
say about the clocks, and an unknown skew is not a small error but an unbounded one, so it is
labelled rather than hedged. A turn stamped more than five seconds into the future says **how far
ahead** rather than clamping to "0s ago"; the tolerance is the latency in the measurement, not a
threshold borrowed from somewhere else. And a timestamp is checked for canonical ISO before it
becomes a number, because `Date.parse("0")` is January 2000 rather than a refusal.

## Filters

Session, speaker, free text, and a hide-tool-calls toggle, all in the URL hash so a filtered view
survives the reload iOS performs when it reclaims the tab ([mode.ts](../../tools/fleet/web/src/mode.ts)
§ the hash). Two things worth keeping:

- **Hide-tool-calls hides only turns that were *nothing but* tool calls.** A turn that says something
  and calls a tool is a message, and hiding it would drop the agent's own words.
- **Free text searches the returned excerpt**, which the reader caps at 2,000 characters — not the
  whole message. Expanding a message shows what the server sent, and the "cut short" line stays up
  after expanding for exactly that reason.

## What is shared with the detail pane, and what is not

[`Turn.tsx`](../../tools/fleet/web/src/Turn.tsx) holds `SPEAKERS` and `Turn`. **The feed imports only
`SPEAKERS`** and draws its own body, which needs provenance, an attribution reading and a collapsed
first line that the detail pane does not.

That split is both reviewers at once. The session owning `RecentMessages.tsx` asked for the
extraction on a correctness argument — `SPEAKERS` is a nine-arm map in which `compact-summary` and
`injected` are machine-written text wearing a person's role, and a second renderer that collapsed
them *"shows a fabricated recap as something a person said"*. GPT Sol argued the two surfaces want
different bodies and that one component serving both by a `collapsed` prop is harder to read than
two. The hazard is in the map, so the map has one home; the bodies do not.
