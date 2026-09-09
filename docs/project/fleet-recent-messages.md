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
[260909b](../plans/260909b-recent-messages-tab-a-rolling-window-across-all-agents.md). Adding a tab
at all is [fleet-dashboard-modes.md](fleet-dashboard-modes.md). This doc is the part a future reader
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

- **`no-claude-session-id` is not a coverage failure.** It is a shell, or a scheduled session whose
  pane is still running `sleep` — nine of 21 rows on this box. Counting them would make coverage
  permanently indeterminate, and **a warning that never clears is one nobody reads**. Verified
  against the live box: coverage comes back `complete`.
- **`byte-budget` fires only when the truncation is inside the window.** A session cut short whose
  oldest returned message is already older than the feed's cutoff has had everything it could
  contribute read.
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
reads every sixty seconds is not. So the tab is fetched when it opens and when the reader asks, never
on a timer, and **never from the collection loop** — [overseer-direction.md](overseer-direction.md)
and the responsive-collection stage of
[260908f](../plans/260908f-overseer-and-fleet-improvement-roadmap.md) both say the collector may not
be held by a slow reader.

An earlier draft of the plan quoted 266 kB on the wire. That was the size of all 579 **candidate**
turns, not the 50 the route serialises — a number measured on a step's input, read as a number about
its output. Re-measure through `feedPayload` itself if you touch this.

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
