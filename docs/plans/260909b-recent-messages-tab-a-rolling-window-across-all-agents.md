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

- [x] ~~`readRecentMessagesForSessions` in `transcript.ts`~~ — **not built, and `transcript.ts` is
      untouched.** The brief allowed an additive multi-session helper there; the fan-out turned out to
      be four lines of `Promise.all` inside the route, so a helper in a file two other sessions are
      live in would have been coupling bought for nothing. Fewer parts touching each other.
- [x] `tools/fleet/routes-recent-feed.ts` — the merge, the exact-N argument, the completeness
      accounting, the clamp, the gzip
- [x] the wire types, as one block at the end of `wire.ts` (the only file both the server and the
      browser project can see; it is types-only and may hold no runtime value, which is why the
      staleness threshold is a stated duplicate rather than a shared constant)
- [x] one mount line in `server.ts`, plus the route construction beside `retention`
- [x] `tests/fleet-recent-feed.test.ts` — 31 tests

*Status: **done**. 31 tests green; 422 green across the five suites this touches
(`fleet-imports`, `fleet-compile-guards`, `fleet-web`, `fleet-recent-feed`, `messages`).
`npm run typecheck` exits 0.*

**The tests were checked to go red rather than asserted to be load-bearing.** Eight mutations, each
reverted after:

| mutation | tests red |
|---|---|
| sort flipped to oldest-first | 4 |
| `mayBeMissing` hard-coded empty | 2 |
| the nothing-was-trimmed branch inverted | 1 |
| `complete` always true | 3 |
| fan-out asks a fixed k=6 instead of the limit | 1 |
| undated turns no longer split out | 2 |
| staleness check disabled (`suspect` unreachable) | 2 |
| unreadable sessions dropped from the census | 2 |

**Two things the plan had wrong, both found by the tests failing on my own fixtures:**

1. `complete` is `reachedStartOfFile || turns.length >= limit`, and a fixture that returns exactly
   `limit` turns is therefore complete — so a test meaning to exercise incompleteness has to return
   *fewer* than it asked for. My first fixture did not, and the test asserted the wrong thing while
   looking right.
2. The `mayBeMissing` condition is sharper than "this session was cut short". A session cut short
   whose oldest *returned* message is already older than the feed's cutoff has had everything it
   could contribute to this window read, so naming it is noise. My first fixture put the truncated
   session's messages *below* the cutoff and then expected a warning. The code was right and the
   plan's prose was the thing that had been vague.

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
