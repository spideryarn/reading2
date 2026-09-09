# Review this plan before it is built

You are reviewing a **plan**, not code. It has not been built yet. I want the design wrong-footed now
rather than after three stages of work.

The repo is Spideryarn; the area is `tools/fleet/`, an internal fleet dashboard that shows the tmux
sessions of Claude agents running on one box, read on a phone over Tailscale. It is an internal tool
with no untrusted callers, but a high bar for *honesty*: its whole value is that it does not quietly
fill gaps in, because the person reading it is deciding whether an agent is stuck.

## What exists already

- `tools/fleet/transcript.ts` — `readRecentMessages({claudeSessionId, dir, limit, maxBytes})` reads
  the **tail** of one session's JSONL transcript, byte-bounded (default 1 MiB, 256 kB chunks), and
  returns a three-armed union: `found` (with `turns`, `reachedStartOfFile`, `bytesRead`, `fileBytes`,
  `lastModified`, `toolResultsSkipped`), `not-found` (with a typed reason), `unreadable`. It is
  tested and I am not modifying it beyond adding a helper.
- `GET /api/messages?id=<tmux handle>` — one session's last 12 turns, for the detail pane. Limit is
  hardcoded 12 server-side.
- `tools/fleet/web/src/messages-client.ts` — browser parser, deliberately four-armed (the server's
  three plus `no-answer` for "this page never got an answer it could read"). Every scalar is
  `X | null` where null means *the server did not say*, so a `0` is never invented.
- `tools/fleet/routes-health-history.ts` — the precedent for a route module with gzip and a clamp.
- `collect.ts` — a 60-second collection loop. Project docs say it must never be held by a slow reader.

## The plan

# A "Recent messages" tab — a rolling window across all agents

**Session:** `recent-messages-tab` · **Worktree:** `recent-messages-tab` · **Dispatched by:** the Overseer, 2026-09-09.

Greg, 2026-09-08:

> add a "Recent messages" tab with a rolling window of the last N messages across all agents (making
> it easy to filter)

## What this is for

The fleet dashboard can already show one session's last twelve turns, once you have chosen a session
and opened it. That answers *is this row telling me the truth?* It does not answer the question Greg
actually asked, which is one level up: **what is the fleet saying right now**, without picking a row
first. Eighteen sessions on the box tonight and no way to read across them except eighteen taps.

The existing per-session view is [`RecentMessages.tsx`](../../tools/fleet/web/src/RecentMessages.tsx)
over `GET /api/messages?id=` (`tools/fleet/server.ts`), reading
[`readRecentMessages`](../../tools/fleet/transcript.ts). **This stage reuses that reader unchanged and
writes no second transcript parser.** Everything below is a fan-out, a merge, and a list.

## The measurements this design rests on

Taken tonight against the live fleet from this worktree, read-only, calling `readRecentMessages` once
per row in the running dashboard's own snapshot. 21 rows, of which 12–15 had a conversation id (the
fleet moved between runs; the other rows are shells and scheduled sessions still running `sleep`).

| per-session `limit` | wall | disk read | turns | text | JSON on the wire |
|---|---|---|---|---|---|
| 6 | 43 ms | 3.0 MB | 72 | 14 kB | — |
| 12 | 199 ms | 5.2 MB | 176 | 28 kB | 83 kB |
| 50 | 250 ms | 10.2 MB | 579 | 93 kB | 266 kB |
| 100 | 362 ms | 13.2 MB | 955 | 177 kB | 453 kB |

Four things follow, and each one decides something below:

1. **The whole fan-out is cheap in time.** A quarter of a second for the entire fleet at N=50. The
   transcripts total 65 MB on disk (largest single one: 35 MB) and the byte-bounded tail reader never
   touches more than ~10 MB of that. This is affordable on its own route; it would not be affordable
   inside the 60-second collection loop, and it does not go there —
   [overseer-direction.md § A higher bar for robustness](../project/overseer-direction.md) and the
   responsive-collection stage of [260908f](260908f-overseer-and-fleet-improvement-roadmap.md) both
   say the collector must never be held by a slow reader.
2. **The cost that matters is the wire, not the disk.** 266 kB of JSON at N=50, read on a phone over
   Tailscale. That is the number that decides the refresh cadence and the gzip below — the disk cost
   never enters into it.
3. **`at` is sound as a global sort key.** Every one of 955 sampled turns had one; they are ISO UTC
   on the box's own clock, and within a session they were monotonic with zero inversions. All
   sessions are the same box and the same clock, so comparing them across sessions is comparing two
   readings of one clock. **This is the load-bearing assumption of the whole feature**, so it is
   asserted in the payload rather than trusted: see *Undated turns* below.
4. **Reading more turns per session is nearly free in disk terms** (limit 6 and limit 12 both read
   roughly one 256 kB chunk per session), which is what makes the exact merge below affordable.

## The design

### The merge is exact, and that is a property worth paying for

The feed asks each session for **its own newest N** — the same N the reader asked for — then merges,
sorts descending by `at`, and takes the newest N.

That is exactly "the last N messages across all agents", and it is provable in one line: any message
among the true newest N must be among its own session's newest N. The tempting cheaper version — ask
each session for a small fixed k, say 6, and merge — is **wrong in the case the tab exists for**: if
one agent has just written 40 of the last 50 messages on the box, the k=6 version shows six of them
and pads the rest with older messages from quieter sessions, while looking entirely normal. Given
measurement 4, exactness costs about 5 MB of page cache and 150 ms, so there is no reason to be
approximate.

**The invariant can still be broken from underneath, and the payload says so when it is.** A session
whose newest N do not fit in the byte budget comes back short, and a short answer is
indistinguishable on screen from a quiet agent. So the route computes, per session, whether the
answer was *complete* — `reachedStartOfFile === true`, or `turns.length >= N` — and the feed carries
the incomplete ones as a named list. The tab says "may be missing messages from *X*" rather than
silently ranking a truncated session below a chatty one. This is the
[silent-success](../reusable/silent-success.md) failure for this feature, written down before it
happens.

### Cadence and byte budget: its own route, its own everything

`GET /api/feed?limit=N` in a new `tools/fleet/routes-recent-feed.ts`, a route module rather than
lines in `server.ts` for the reason `routes-health-history.ts` gives — importing `server.ts` binds
port 8787, so anything living there cannot be driven by a test. `server.ts` gets one mount line.

- **On demand plus an explicit refresh, not a poll.** The tab fetches when it opens and when the
  reader asks. 266 kB every sixty seconds to a phone is not a rolling window, it is a download.
- **Gzip above 8 kB**, reusing `routes-health-history.ts`'s decision and its `accept-encoding` check
  verbatim. JSON of prose compresses well; this is what makes N=50 tolerable over Tailscale.
- **`limit` clamped** (default 50, max 200) the way `windowHoursFrom` clamps hours, and for the same
  reason: not a security limit — this server has no untrusted caller — but a limit on how much gets
  serialised because somebody typed a number into a URL.
- **Never in `collect.ts`.** The collection loop is not touched by this stage at all.

### Attribution is labelled, never asserted

`CLAUDE_SESSION_ID` is pinned at pane creation and never updated
([transcript.ts](../../tools/fleet/transcript.ts)), so a re-used pane reads the *previous*
conversation: real messages, well formed, correctly attributed, and not the conversation on screen.
The per-session view can lean on the reader's own eyes for that. **This tab cannot**, and that is the
sharpest difference between the two: it shows turns from sessions the reader was never watching and
has no independent sense of, so a misattributed message here has nothing to contradict it.

So every message in the feed is labelled with the session it was *read for*, with the confidence
reading beside it, never as a bare assertion of who said it.

`FleetRow.execution` (`verified` / `claimed-only` / `unknown`, from session
`260908f-roadmap-exec-identity`) is **not on `dev` as of this plan** — checked, no hit for
`execution` in `wire.ts` or `types.ts`. So the route computes the reading behind a single function
with the three arms already named, sourced today from what does exist: the transcript's
`lastModified` against the row's status, which is the same comparison `transcriptAge` makes in
messages-client.ts. When `execution` lands, that one function reads the row's field instead and
nothing else moves.

### Undated turns

Zero of 955 sampled turns had a null `at`, so this is a case that exists in the type and not in the
data. It gets the cheap honest treatment rather than either of the two lies: **a turn with no
timestamp is not dropped** (a feed that silently omits messages is the one thing this must not be)
**and not interleaved at a guessed position** (which would assert an ordering nothing supports). It
is carried in a separate undated group after the dated ones, with a line saying why. If the count is
ever non-zero in practice, that line is the signal to design something better.

### Filters

In the URL hash, via the existing `setParam` — [mode.ts](../../tools/fleet/web/src/mode.ts) already
argues why (this page is reloaded whenever iOS reclaims the tab, and a filter that resets every time
is one nobody sets). No persistence beyond the hash, as the brief says.

Four, all client-side over the fetched window, so changing one costs no request:

- **session** — multi-select from the sessions actually present in the feed
- **speaker** — person / agent / tool / machinery
- **free text** — plain substring, case-insensitive, no regex
- **hide tool calls** — a toggle

### What is rendered

Newest first (**the API returns turns newest *last*, so the inversion is ours to do** — a peer's
warning, and worth stating because it is the kind of thing that looks right in a test fixture built
by the same person who got it backwards). Each line: session name, speaker, age, and the first line
of the text with expand-in-place for the rest.

A session whose transcript could not be read is **a row saying so with its typed reason**, not an
absence. Nine of 21 rows tonight answer `no-claude-session-id` — shells and scheduled sessions — and
a feed that omitted them would look like a fleet of twelve.

## What I passed over

- **No new server route at all: have the browser call the existing `/api/messages?id=` once per
  session and merge client-side.** Genuinely simpler, and rejected on two counts. HTTP/1.1 caps a
  browser at six connections per origin, so 21 rows is four sequential waves at phone latency; and
  the per-session route's limit is fixed at 12 server-side, so the exact merge above is not available
  — the client would be merging twelve-turn windows and could not ask for more. Worth revisiting if
  the route ever grows a `limit`.
- **Putting the feed in the `/api/state` payload.** One less route, and it would put 266 kB of agent
  prose into a poll that happens every sixty seconds whether the tab is open or not, inside the
  collection loop the roadmap explicitly protects. Not close.
- **A persisted message store — tail every transcript into one append-only file, like
  `health-history.ts`.** This is the version that would make search-over-history possible later. It
  is a second store, a writer, a rotation policy and a schema, and measurement 1 says the fan-out
  costs 250 ms — so nothing needs it *yet*. Named here because when history search is asked for, this
  is the design to reach for, and this plan is where somebody will look.
- **Reusing `RecentMessages.tsx` by importing from it.** Rejected in favour of extracting `Turn` and
  `SPEAKERS` into a new `web/src/Turn.tsx`, at the request of session
  `dashboard-titles-descriptions-detail`, which owns that file tonight. Its reason is better than my
  original plan to duplicate the markup, and is recorded in Stage 2.

## Stages

Each ends committable, with a GPT Sol review at the end.

### Stage 1 — the fan-out reader and the route

- [ ] `readRecentMessagesForSessions` in `transcript.ts` — **additive only**, a multi-session helper
      that calls the existing reader and adds no parsing of its own
- [ ] `tools/fleet/routes-recent-feed.ts` — the merge, the exact-N argument, the completeness
      accounting, the clamp, the gzip
- [ ] one mount line in `server.ts`
- [ ] tests: the exact-N invariant, a session cut short by the budget being *named* rather than
      silently ranked, undated turns kept, unreadable sessions carried as rows, the clamp

*Status: not started.*

### Stage 2 — the client and the feed component

- [ ] `web/src/Turn.tsx` — `Turn` and `SPEAKERS` moved out of `RecentMessages.tsx` **as a new file
      only**; the peer that owns `RecentMessages.tsx` deletes its copy and changes one import when
      its own stage is green. Two copies exist harmlessly until then, and neither of us edits the
      other's file.
- [ ] `web/src/feed-client.ts` — parse with the same four-arm discipline as `messages-client.ts`
- [ ] `web/src/FeedPanel.tsx` — the list, the filters, expand-in-place
- [ ] tests, including the newest-first inversion and the "read failed" row

*Status: not started.*

### Stage 3 — the tab, and the docs

- [ ] `messages` entries in `MODES`, `MODE_LABELS`, `MODE_ICONS`, `MODE_TIPS`; additive mount in
      `App.tsx`
- [ ] **re-run the mode tests and `npm run typecheck` on the post-merge tree** — three sessions are
      adding entries to the same array and the same four `Record<Mode, …>` maps tonight, and a merge
      can keep both sides' entries or drop one without ever raising a conflict marker. A clean merge
      is not evidence. (Flagged by `usage-limits-tab`; matches this repo's own history.)
- [ ] a doc under `docs/project/` with a line under its entry point

*Status: not started.*

## Coordination

| Peer | File | Agreement |
|---|---|---|
| `usage-limits-tab` | `Dock.tsx`, `mode.ts` | Owns the tab list. Its key is `usage`, mine is `messages` — no collision. It expects to run past 2h and told me not to wait: I add my own entries and merge at the end. It declined to add my lines for me, correctly — a tab that mounts nothing is a blank panel with no way to tell whether it is broken. |
| `dashboard-titles-descriptions-detail` | `RecentMessages.tsx` | Asked me to extract rather than duplicate. I create `Turn.tsx`; it changes its import later. |
| `overseer-tab-messaging` | `MODE_TIPS.overseer` | Third hand in `Dock.tsx`, different key. |
| `260908f-roadmap-exec-identity` | `FleetRow.execution` | Not landed. I design for it behind one function. |

---

Up: [plans.md](../project/plans.md)


## What I want from you

Rank findings P0/P1/P2. I care most about:

1. **The exactness argument.** The plan claims that asking each session for its own newest N, merging
   and taking N, is exactly "the last N messages across all agents". Is that actually right? Where
   does it break? I have already found one break (a session cut short by the byte budget) and handled
   it by naming those sessions in the payload — is that handling sufficient, and are there other
   breaks I have not found? Consider in particular: sessions that appear or vanish between the
   snapshot and the reads, and turns that are coalesced from multiple records.
2. **The global sort by `at`.** I measured 955 turns with zero null timestamps, monotonic within a
   session, all on one box's clock. Is sorting across sessions by that string sound? What would make
   it unsound that I have not tested for? Note `at` is deliberately NOT clock-shifted anywhere.
3. **Honesty failures.** This tab shows messages from sessions the reader was never watching, so a
   wrong or missing message has nothing to contradict it. Where can this design show something false
   or omit something while looking healthy? Be specific and adversarial — this is the review I most
   want.
4. **Whether the cost decisions follow from the measurements**, which are in the plan. Particularly:
   on-demand-plus-refresh rather than polling, and gzip.
5. **Anything in the staging that will not actually end committable**, or any ordering that will
   force rework.

Do not review prose style. Do tell me if a stage is missing a test that would have caught a class of
bug rather than an instance.
