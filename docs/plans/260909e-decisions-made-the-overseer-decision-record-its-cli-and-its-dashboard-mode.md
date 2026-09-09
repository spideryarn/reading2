# "Decisions made" — the Overseer's decision record, its CLI, and its dashboard mode

**Status, 2026-09-09: planned and reviewed once by GPT Sol; nothing built.** The first draft was
rewritten against that review — Sol's verdict on it was *"needs rethinking"*, and the two things it
was right about are recorded below in § What the plan-stage review changed. Stage checkboxes and a
status paragraph under each heading are kept current as the work lands.

Up: [dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md) via
[overseer.md](../project/overseer.md), whose gate 1 this turns from a hand-kept Markdown list into a
file with a shape.

## What Greg asked for

> For low-stakes decisions, I'm probably fine with you making the decision on my behalf (get input
> from GPT Sol or another Fable prompted in a different way if important/unsure/tricky). In that
> case, let's create a new mode for "Decisions made" [by you without asking me] that explains the
> question, options, tradeoffs, decision made, and why, so that I can at least review them
> afterwards. That way you're not blocked, the fleet is empowered, and I still have visibility.
>
> — Greg, 2026-09-09

Queue item `qi-yfssng42`, authorised by Greg on 2026-09-09 (the queue's own `authorized` event is
stamped 07:36:56Z; the Overseer's hand log records the conversation at 08:15Z). It is the "real
decision log" proposal that had been sitting in [overseer-queue.md](../project/overseer-queue.md)
§ Improvements the Overseer noticed but may not originate.

## What this record is, and why that constrains the design

**The record is the whole of the permission.** [overseer.md § gate 2](../project/overseer.md) says
so in as many words: *"A decision he has not seen is still a decision he can reverse, so the record
is the whole of the permission."* The Overseer is allowed to decide low-stakes things on Greg's
behalf **because** he can review them afterwards. So this is not a log that happens to be useful; it
is the counterparty to an authority that has already been granted, and everything odd-looking below
follows from that.

Three consequences, and they are the design:

1. **A record missing its options or its why is not a record.** The permission was granted for
   *"explains the question, options, tradeoffs, decision made, and why"*. A row that says only *"went
   with B"* is a decision Greg cannot review, which means it is a decision he did not authorise. So
   those fields are **required at the type and non-blank in the parse**, and a `decided` event
   without them is a problem, not a sparse record.
2. **Nothing but Greg may make a decision look reviewed.** *"Not yet reviewed"* is the number he
   looks for, and anything that can decrement it can make the page calm without anybody having read
   anything. This is gate 1's *"never hide who decided"* pointed at the second audience. Three
   separate mechanisms, because there turned out to be three ways to do it — see § The four ways the
   count could lie.
3. **Log blindness is the failure this cannot recover from** — [overseer.md § The log, and the
   surface Greg reads](../project/overseer.md#the-log-and-the-surface-greg-reads). *"A morning log of
   two hundred entries is unbounded authority with a paper trail."* So unreviewed comes first, and
   the facts nobody has to read stay off the first screen.

### The simpler option passed over

**One line per decision, rewritten in place, in a plain JSON array.** Cheaper to write and to read,
and it is what the hand-kept log already is. Rejected for the reason `idea-queue.ts` states about the
queue and which applies with more force here: a record whose purpose is *who decided what, and has
Greg seen it* loses the second half the moment a rewrite can silently change the first. Two writers
lose each other's edit; and *"reviewed"* becomes a mutable boolean rather than an event with a name
against it.

Append-only events, folded — the same shape, the same `jsonl.ts` append discipline, the same
`lock.ts`, a second file beside `queue.jsonl` in `~/.overseer/`. **The cost of that choice, named:**
the envelope, the strict per-event parse, the transition validation, and an idempotency key that is
actually consumed (§ Stage 1). All four are in Stage 1 because they were named.

## What is NOT the daemon's

`~/.overseer/` is the store and **the daemon is its single writer for events** (`events.jsonl`,
`current.json`). This is not that. It is a second file with its own lock, exactly as the idea queue
is — `decisions.jsonl`, `decisions.lock`, `decisions.created` — written by a CLI and by nothing else.
Nothing here touches the daemon, `store.ts`, or `idea-queue.ts`.

## The four ways the count could lie

Sol's review found that "only Greg may review" is one rule guarding one of four doors. All four are
closed in the **fold**, not in the writers, because a rule enforced at one entrance has an unguarded
second entrance and there are three of them (the CLI, the route, a hand-edited file).

1. **Somebody else records the review.** A `reviewed` or `reversed` whose envelope `by` is not
   `greg` is a **problem**, never a promotion — exactly as `idea-queue.ts` refuses an `authorized`
   from anyone but Greg.
2. **The decision is edited after the review.** The first draft had an `amended` event with an
   unspecified patch and no revision — so the question, the options, the decision, the why or the
   sessions could all change while the row stayed reviewed. That is the approval-after-edit hole the
   queue's `revision` mechanism exists to close, and Sol called it a P0. **`amended` is dropped from
   v1** rather than mitigated: the case it served (a decision that turns out to bear on one more
   session) is thin, the hole it opens is the central one, and a decision is cheap to supersede with
   a new record. If a real need appears, it comes back **with** a revision that `reviewed` names.
3. **A decision hides behind an unrelated parse error.** `appendEvents` must refuse a batch that
   makes the record worse — but the queue's version of that check has a real bypass, and copying it
   literally would inherit it: `current.problems` includes unreadable-line problems, while the
   candidate is folded from `readEvents`, which **silently drops** unreadable lines, and only the two
   counts are compared ([`idea-queue.ts`](../../tools/overseer/idea-queue.ts) around lines 1289 and
   1322). With one pre-existing unreadable line, one newly illegal event nets to zero and is
   accepted. So here the candidate is compared against **a clean fold of the same parsed prefix**,
   which closes it in one line and keeps the property that a record with a bad line can still be
   appended to. *(The queue has this bug today. It is not this session's file — see § Needs the
   Overseer.)*
4. **A corrupt line is rendered as a low count.** An unreadable `decided` line is a hidden decision,
   and a headline saying *3 not yet reviewed* over a view with problems is a number nobody should
   act on. So **the count is unavailable, not zero, whenever the view carries any problem** — the
   house rule in
   [fleet-dashboard-modes.md § Absence is stated, never drawn](../project/fleet-dashboard-modes.md#absence-is-stated-never-drawn).

## The record

`tools/overseer/decisions.ts`, mirroring `idea-queue.ts` closely enough that a reader of one can read
the other.

```
DecisionEvent = Envelope & (
  | { kind: "decided"; id; class; question; options[]; decision; why; advisers[]; bearsOn }
  | { kind: "reviewed"; id; note: string | null }      // GREG ONLY, enforced in the fold
  | { kind: "reversed"; id; why:  string | null }      // GREG ONLY, and terminal
)
```

- **`class`** — `assumption` | `decision` | `decline`. [overseer.md § gate 1](../project/overseer.md)
  says *"every decision, assumption and decline goes in the log"* and § The log says the 8am surface
  shows **assumptions only**. A record with no category cannot implement either sentence, cannot tell
  a gate-2 product default from a low-stakes call, and cannot later hand one class to `questions-mode`
  without parsing prose. Sol's P1-3; it was missing from the first draft entirely.
- **`question`** — plain, per [AGENTS.md § Explain plainly and briefly](../../AGENTS.md). Not a slug,
  not a title: the sentence Greg would have been asked.
- **`options`** — at least two, each `{ name, tradeoffs }`, both non-blank, names distinct. "The
  options" with one entry is a decision with no alternative considered; two identical entries is the
  same thing wearing a disguise.
- **`decision`** — what was decided, non-blank. Free text rather than an index into `options`,
  because [Greg's answer is often a fifth option](../project/overseer.md) — three times in seven, in
  the fleet's own record — and an index could not hold one.
- **`why`** — required, non-blank.
- **`advisers`** — a non-empty set drawn from `sol` | `fable` | `nobody`, with `nobody` exclusive:
  `["nobody", "sol"]` is a contradiction, and an empty array cannot be told from a field somebody
  forgot.
- **`bearsOn`** — `{ sessions: SessionRef[]; plan: string | null }`, session names distinct. See
  § What a session reference carries, which is the other thing the review changed.
- **`decidedBy`** — **`"overseer"` only in v1.** The first draft allowed `greg` too; Sol's P1-4 is
  that a Greg-origin decision does not await Greg's review, so counting it makes the pending count
  wrong and excluding it makes `decidedBy` a lever for calming the count. Reversed. Who *recorded*
  an event is the envelope's `by`, as in the queue.

**What this does not do**, stated because a claimed protection is worse than an admitted gap:
anything running as this user can append a line saying `by: "greg"`. That is equally true of the
Markdown file this replaces, and of the idea queue. Gate 1 is a governance constraint, not an OS
boundary.

**Transitions, each with a test:** no two `decided` with one id; no event for an unknown id (never a
row created by a side effect); no duplicate `eventId`; a `reviewed` or `reversed` timestamped before
its `decided`; `reversed` is terminal, and it counts as Greg having seen the record; repeated
`reversed`, and `reviewed` after `reversed`, are problems. `commandId` is **consumed**, not merely
carried: a second event with a `commandId` already in the log is dropped as the retry it is. The
queue carries the key without consuming it; the first draft claimed the cost and skipped the
behaviour, which was Sol's P2-3.

## What a session reference carries, and the ranking that is not being built

[overseer.md](../project/overseer.md) asks for assumptions *"ranked by how many agent-hours have been
committed since each one"*. **That number cannot be computed honestly today, and the first draft's
attempt at it was the review's other main finding.**

The proposed arithmetic was `now − max(decidedAt, startedAt)` over the sessions named, read from the
live register. Four things are wrong with it, and they are not fixable by arithmetic:

- it measures **elapsed tmux lifetime**, including idle time and every unrelated thing that session
  did — not work committed on this decision;
- `now` extends every session through a **dead or deaf daemon**; the register's own comment says
  presence is established only at `lastGoodSnapshotAt`;
- a session **name is reusable**, and `RegisterEntry.verifiedExecution`'s comment says so at length:
  only the execution token distinguishes a run from a later launch in the same pane. `max(…)` does
  not repair this — a later unrelated launch under the same name contributes its whole lifetime;
- the register cannot see a session that has **ended**, so the rows with the most work behind them
  read lowest. Ordering by a known subtotal puts the most expensive row last.

**So v1 shows what it can measure and says what it cannot.** Per row: the decision's age, and the
sessions it names split three ways — *live* (in the register now), *not found* (ended, or never
there), and the count of each. No hours, and no ordering by a number that does not exist. Ordering is
**unreviewed first, then newest first**, which is the thing the surface is actually for.

**And the missing measurement is made possible rather than abandoned.** A `SessionRef` is
`{ name: string; executionToken: string | null }`, and the CLI **looks the token up in the register
at the moment the decision is written**. That is the one moment the identity is knowable; every later
reading is guessing. `null` is honest and means *this session was not in the register when the
decision was recorded*. With the token stored, a later stage can compute real hours against
`events.jsonl` — off the request path — and tell a reused name from the run that was actually there.
Cheap now, impossible to add retrospectively.

**Where the ranking module lives.** The panel and the CLI both draw these session counts, and two
renderings of one measurement is how a page and a terminal come to disagree — `scripts/overseer.ts`
says so where it imports the dashboard's own grouping rather than restating it. One module,
`tools/fleet/decisions-view.ts`, used by the route and by the CLI. It is fleet-side because the route
cannot import `tools/overseer/store.ts` (that closes the cycle `overseer-status.ts`'s header exists to
prevent); `loadCheckpoint` from `attention.ts` is the fleet-owned reader, already used twice, and
importing it closes no cycle. A `scripts/` file importing a fleet module is fine and has the
`scripts/overseer.ts → tools/fleet/usage-feed.ts` precedent.

**It is a lookup, not a list.** `OverseerRegister` on the wire is capped at eight entries, so a
decision naming the ninth-longest-waiting session would read *not found* against it — a lie the cap
invented. The module reads the checkpoint directly and looks up only the names the decisions mention.

*(`tests/fleet-imports.test.ts` does not police a general fleet↔overseer direction — it guards the
`tools/`→`src/` closure and transport ownership. The first draft over-cited it; Sol's correction.)*

**Seven-day counts, and no verdict.** *"A week with zero vetoes is a red flag"* is the doc's rule, and
the first draft tried to draw it. Deferred: the threshold ("enough decisions") was undefined and the
cohort ambiguous. v1 shows the factual trailing-seven-day counts of decisions taken, reviewed and
reversed. The verdict comes back when its rule is exact — cheap code, non-cheap meaning.

## The mode: a ninth tab, and the dock genuinely cannot take it as it stands

**A ninth tab, `decisions`, labelled "Decisions".** The two alternatives in the brief were checked
and neither is available: the landing surface (`qi-thd98yqw`) is a **proposal nobody has authorised**,
and gate 3 forbids building into it; the Overseer tab has no assumptions area to replace.

**But the dock has already run out of room, and this is measured rather than feared.** Session
`readiness-tab` reported it at 06:12Z on 2026-09-09, in the Overseer's own hand log:

> The dock has run out of rungs: at 390 px coarse-pointer the eight modes fit only as icon buttons
> and the standalone Refresh sits past the edge; flex-grow cannot help when there is no free space,
> so a ninth tab makes it worse. To be told to the sessions still landing tabs.

Sol reached the same conclusion from the stylesheet: under `@media (pointer: coarse)` every button
has a 40px floor, so nine modes need ≥360px before borders, margins, gutters, Refresh and the active
label — and `.dock-modes` has `flex-shrink: 0`, so **changing the grow weight from 8 to 9 does
nothing at 390px**; it only matters where there is spare space. The bar scrolls, with a hidden
scrollbar and nothing to say a button is off-screen, and **nothing scrolls the active control into
view** on a direct `#decisions` load.

So the tab needs one small cross-cutting fix to be honest, and it helps all nine modes rather than
just this one:

- **scroll the active mode button into view** when the dock mounts and when the mode changes
  (`block: "nearest"`, no smooth scroll — the mode switch cuts it), and
- **an overflow affordance** so a scrollable bar looks scrollable: an edge fade on whichever side has
  more to show.

That is a `Dock.tsx` and `tailwind.css` change of maybe thirty lines, and `flex: 8 → 9` goes with it
for correctness even though it changes nothing at 390. **It is recorded here as a deliberate
cross-cutting decision rather than slipped in**, because `Dock.tsx` is the file every mode author is
in. The alternative considered and rejected: a third fit rung that shaves button padding, as the
product's own bar has — it buys ~11px, which does not close a 360px floor against a 390px viewport,
so it postpones the problem by one tab rather than fixing it.

**If the browser stage shows the active tab still unreachable on a direct phone load, the work does
not ship the tab.** The fallback — a section on the Overseer tab — is a product deviation from what
Greg asked for, not a panel move, so it goes to him rather than being taken here.

Six places in three files, per
[fleet-dashboard-modes.md § The registrations](../project/fleet-dashboard-modes.md#the-registrations):
`MODES` and `MODE_LABELS` in `mode.ts`; `MODE_ICONS` and `MODE_TIPS` in `Dock.tsx`; the mount in
`App.tsx`; the share count in `tailwind.css`. Two are checked by nothing.

**The data is on-demand, not pushed.** It is a page Greg opens in the morning, not a number the fleet
needs every 73 seconds, and pushing it would serialise every decision's options and trade-offs to
every open tab on every cycle. So: a route module, an exact path, a stated maximum, a typed client
with an injectable seam, an injected-and-defaulted `App.tsx` API prop, and a lifecycle test.

**What "a stated maximum" means here, since a general row cap could hide an unreviewed decision:**
every **unreviewed** record is sent, always. Reviewed history is capped, with the withheld count on
the payload and drawn on the page. If the unreviewed set alone exceeds the byte ceiling, the route
**fails loudly** rather than truncating — a decision Greg has not seen must never be the row that
fell off the end.

**Read-only, for the same reason `GET /api/queue` is.** The dashboard has no authentication;
reachability is the whole boundary. A `POST …/reviewed` would let anything able to reach the port
mark decisions reviewed in Greg's name — precisely the number the record exists to protect. Only the
CLI writes `reviewed`, and a review button waits on the same identity story the queue's writes wait
on (§ Needs Greg).

## Migration: one hand-authored seed, and no importer

**No prose importer.** The lines in
[260908i](260908i-overseer-decision-log-for-the-two-astra-plans.md) are sentences, not fielded
records; reading them in would produce rows with an empty `options`, an empty `why` and one adviser
nobody can name — exactly the shape the fold refuses, and the worst possible first screen.

**But "none of them qualify" was too strong**, and Sol found the counter-example: the 08:12Z entry
records a low-stakes decision with three options, their costs, what was decided, why, and *"Advised
by nobody"* — every required field, already written. So: **one hand-authored seed record** for that
decision, checked in as a fixture the CLI can `add`, left `unreviewed` rather than inventing a review
history. The first screen then has real data on day one, which is also the only way to see whether
the layout works.

## Stages

Each stage: tests red first, then green; `npm test` and `npm run typecheck` judged by exit code;
lint the touched files; then a GPT Sol review of the scoped diff and the raw test output before the
commit. Implementation goes to Codex (`gpt-5.6-sol`, `--sandbox workspace-write`) with a prompt file;
I run the checks, review, and commit. Which stages Codex implemented is recorded here as they land.

### Stage 1 — the record and the CLI

- [ ] `tools/overseer/decisions.ts`: schema constant, `DecisionEvent`, envelope, strict `parseEvent`
      (every non-blank and uniqueness rule above), `foldDecisions` → `DecisionView`, `appendEvents`
      under its own lock with the **clean-prefix** candidate comparison, `mintId` (`dec-` + eight of
      the queue's alphabet), `commandId` consumption.
- [ ] The fold's teeth, **each with a test seen red when the rule is removed**: only Greg's
      `reviewed`/`reversed`; `<2` or duplicate options; blank `question`/`decision`/`why`; empty or
      contradictory `advisers`; duplicate ids; an event for an unknown id; out-of-order review;
      post-reversal events; a duplicate `commandId`.
- [ ] The clean-prefix comparison specifically: a fixture with one unreadable line plus one illegal
      new event must be **refused**, and that test must go red against the queue's count-only shape.
- [ ] `scripts/overseer-decisions.ts` on Commander (as `scripts/overseer.ts` is; the queue CLI's
      hand-rolled parser is not the shape to copy): `template`, `add --file <path|->`,
      `list`, `show <id>`, `export`, `reviewed <id>`, `reversed <id>`. `--by` required on every write
      and never defaulted. `add` resolves each named session's `executionToken` from the register at
      write time.
- [ ] Three read arms carried through, not flattened: `never-written`, `decisions` (possibly empty),
      `unreadable`.

### Stage 2 — the view module and the seed

- [ ] `tools/fleet/decisions-view.ts`: per-record age and the live / not-found session split from
      the checkpoint; the trailing-seven-day factual counts; the unreviewed-first ordering; and the
      **count-unavailable** arm whenever the view carries problems.
- [ ] Mutation-checked: rendering a not-found session as live must go red; the headline count
      surviving a problem in the view must go red; ordering falling back to newest-first while
      unreviewed rows exist must go red.
- [ ] The CLI's `list` prints the same numbers from the same module.
- [ ] The one hand-authored seed record for the 08:12Z decision, `unreviewed`.

### Stage 3 — the route and the mode

- [ ] `tools/fleet/routes-decisions.ts` (`GET /api/decisions`), mounted in `server.ts`, with a
      **comment-stripped** source guard on the mount — the needle survives inside a `//`, which is
      how such a line actually dies.
- [ ] The maximum: every unreviewed record always; reviewed history capped with a withheld count;
      a loud failure rather than a truncation if the unreviewed set alone exceeds the ceiling.
- [ ] Wire types in **one additive end block** of `wire.ts` (types only, no runtime values); any
      vocabulary array stays in the node module with `as const satisfies`.
- [ ] `decisions-client.ts` with an injectable `DecisionsApi` seam; strict client parsing; a
      *this browser never got an answer* arm distinct from the server's own two silences.
- [ ] `DecisionsPanel.tsx`; the six registrations; the `Dock.tsx` active-into-view scroll and the
      overflow affordance (§ The mode).
- [ ] Tests: `fleet-feed-panel.test.tsx`'s four assertions (`MODES` contains it with its label; the
      hash opens into it — mutate the `App.tsx` arm and watch it red; the button writes the hash; the
      empty state names **which** nothing it is), asserted against `MODES` and never a literal list,
      driven by `mountFull()`. Plus: a complete row renders every required field; problems suppress
      the headline count; route composition through the same path `server.ts` uses; timeout and
      no-answer.

### Stage 4 — see it, and land it

- [ ] Browser-verified at 390×844 and 1280 by a Sonnet subagent on its own throwaway port
      (`FLEET_PORT=8791`), never `:8787`'s process, killed by its own pid. **The gating check: on a
      direct `#decisions` load at 390px, is the active tab visible and reachable?** If not, the tab
      does not ship and the question goes to Greg (§ The mode).
- [ ] `npm run typecheck` **on the post-merge tree**, and count the mode entries — a merge can drop
      one with no conflict marker.
- [ ] Docs: a line under the entry point that owns a new `decisions.md`, and a link back up. The
      before/after for `overseer.md`'s gate 1 **NOT BUILT** block and § The log, and the surface Greg
      reads goes in the debrief for the Overseer to land, since that wording is a rule.

## What the plan-stage review changed

GPT Sol reviewed the first draft on 2026-09-09 and returned *"needs rethinking"*, with two P0s and
seven P1s. Taken in full: `amended` dropped; the clean-prefix comparison; the count unavailable under
problems; the `class` field; `decidedBy` narrowed back to `overseer`; the wider parse and transition
validation; `commandId` actually consumed; the route's unreviewed-always maximum; the seven-day
verdict deferred; the one-row seed; the over-citation of `tests/fleet-imports.test.ts` corrected.

**The largest change is the ranking.** The first draft's agent-hours number was *"not an honest
measurement"* and it was right — the answer is to store the execution identity at decision time,
which makes the real measurement possible later, and to show only age and a live/not-found split now.

**And the first draft doubted the brief where the brief was right.** It said the claim that the dock
is out of room at eight tabs *"is not in `design-a-screen.md` or `fleet-dashboard-modes.md`"*, which
is true and was the wrong place to look: it is in the Overseer's hand log at 06:12Z, measured by
`readiness-tab`. An unverified brief claim is worth flagging; concluding it is unfounded because two
greps missed it is not the same thing.

## Needs Greg

1. **A review button on the page needs an identity story.** Until then a decision can only be marked
   reviewed from a terminal. The cheap shape the queue plan already proposes: mutations only from
   allowlisted Greg-device tailnet identities, loopback read-only. One answer unblocks both.
2. **The 8am surface currently says *assumptions only*.** This mode shows assumptions, decisions and
   declines with the class visible, which broadens that rule. Confirm, or say which classes belong on
   the first screen.
3. **Only if the browser stage fails**: whether "Decisions made" may live as a section of the
   Overseer tab rather than its own tab, if a ninth tab cannot be made reachable at 390px.

## Needs the Overseer

- **`idea-queue.ts` has a live authorisation bypass** (§ The four ways the count could lie, item 3).
  Not this session's file. It should go to whoever holds `tools/overseer/idea-queue.ts`.
- `questions-mode` was not running when this was planned, so the decision/question boundary — theirs
  is what still blocks Greg, mine is what no longer does, with *assumptions pending Greg* landing
  here — is a proposal rather than an agreement. Pass it on when that session starts.
- A dashboard restart, for the tab to be live. Not mine to do.
