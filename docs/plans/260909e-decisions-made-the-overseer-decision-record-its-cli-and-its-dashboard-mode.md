# "Decisions made" — the Overseer's decision record, its CLI, and its dashboard mode

**Status, 2026-09-09: planned, reviewed twice by GPT Sol, nothing built yet.** Round one returned
*"needs rethinking"* (two P0s, seven P1s); round two on the rewrite found **no P0 remaining** and
*"not yet safe to build exactly as written"* (seven P1s). Both rounds are taken in full — see
§ What the plan-stage reviews changed. Stage checkboxes and a status paragraph under each heading are kept current as the work lands.

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
   anything. This is gate 1's *"never hide who decided"* pointed at the second audience, and it took
   five separate mechanisms because two rounds of review found five ways to do it — see § The five
   ways the count could lie.
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

## The boundary with `questions-mode`

Session `questions-mode` (queue item `qi-25bs5ysg`) builds the surface for what still needs Greg.
This was proposed here on 2026-09-09 while that session had not yet started, carried into its brief by
the Overseer, and **accepted by it as written** when it began.

**The line: theirs is what is still blocking; mine is what no longer is.** A question stops work
until Greg answers. A decision unblocked the work at the cost of a review he is owed. The two
surfaces answer different questions of his — *"is anything waiting on me?"* and *"what was done in
my name?"* — which is why they are two tabs rather than one list with a filter.

**The awkward case is an *assumption pending Greg*, and it belongs here.** Gate 2's product default
is a decision that was taken and that he may veto; the work carried on, so nothing is blocked on him.
It is a record in this file with `reviewed: false`, and the not-yet-reviewed count is what makes it
visible. `questions-mode` agreed, and will link to a row here rather than duplicate it if one of its
items ever wants to point at a decision.

**Neither tab may quietly become the other.** The failure to watch for is a question being recorded
as a decision to get it off the blocking list — which is the same act as calming the count, and is
what gate 1 is about. If a decision turns out to have been a question, the honest repair is a record
here saying so, superseded when Greg answers.

**The symmetric failure is the other tab's, and its defence is better than this one's:**

> The symmetric failure is this tab's, and it is worth naming beside theirs: a *decision* shown as a
> *question* re-blocks work that was already unblocked, and costs Greg a turn answering something
> nobody was waiting for. The defence here is structural rather than a rule about reading: **a
> Questions item is composed only from things that are parked right now** — a live dialog on a pane,
> or a turn that ended handing over a decision — and never from a record of something that already
> happened. This panel's composition function cannot reach the decision record at all.
>
> — session `questions-mode`, 2026-09-09

**Say the asymmetry out loud, because it is the useful part.** Their boundary holds *by
construction*: the panel cannot reach this file, so the failure is unreachable rather than
forbidden. This tab's boundary is only a **rule** — nothing structural stops a question being
written here as a decision, and the record's `supersedes` is a repair rather than a prevention. That
is a real difference in kind and this plan should not claim parity it does not have.

## The five ways the count could lie

Sol's reviews found that "only Greg may review" is one rule guarding one of five doors. All five are
closed in the **fold**, not in the writers, because a rule enforced at one entrance has an unguarded
second entrance and there are three of them (the CLI, the route, a hand-edited file).

1. **Somebody else records the review.** A `reviewed` or `reversed` whose envelope `by` is not
   `greg` is a **problem**, never a promotion — exactly as `idea-queue.ts` refuses an `authorized`
   from anyone but Greg.
2. **The decision is edited after the review.** The first draft had an `amended` event with an
   unspecified patch and no revision — so the question, the options, the decision, the why or the
   sessions could all change while the row stayed reviewed. That is the approval-after-edit hole the
   queue's `revision` mechanism exists to close, and Sol called it a P0. **A `decided` record is
   immutable.** There is no amend event and no revision, because there is nothing to revise.
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
5. **A correction quietly cancels the thing it corrects.** Dropping `amended` closed door 2 and
   opened this one, which round two found: **records do get corrected**, and the hand log proves it
   — an 08:20Z claim about Codex credits was withdrawn at 08:25Z on Sol's evidence. With no link
   between the two, a correction either masquerades as an unrelated decision or does not get made.
   So a new `decided` may carry **`supersedes: <id>`**, validated against an existing earlier
   record, and the fold enforces the property that matters: **superseding never reduces the pending
   count without replacing it.** A superseded record is marked as such and drops off the unreviewed
   list only because its successor has taken its place there — never because it was cancelled.
   Superseding a record Greg has already reviewed leaves the *successor* unreviewed, which is the
   whole point: he reviewed the old fact, not the new one.

## The record

`tools/overseer/decisions.ts`, mirroring `idea-queue.ts` closely enough that a reader of one can read
the other.

```
DecisionEvent = Envelope & (
  | { kind: "decided"; id; class; decidedAt; question; options[]; chose; why;
      advisers[]; bearsOn; supersedes: string | null }
  | { kind: "reviewed"; id; note: string | null }      // GREG ONLY, enforced in the fold
  | { kind: "reversed"; id; why:  string | null }      // GREG ONLY, and terminal
)
```

**There is no `decidedBy`.** The first draft had one and narrowed it to `"overseer"`; round two's
answer is to delete it. Two reasons, and the second is the interesting one. A constant field is a
schema invariant wearing a per-row disguise — v1's whole record is Overseer-originated, so say that
once in the schema. And gate 2 says of a product default: *"record it as an **assumption pending
Greg** … **You are not deciding**; you are unblocking under a standing decision he already made."*
So `decidedBy: "overseer"` is **semantically false on the `assumption` class**, which is one of the
three. The envelope's `by` keeps recording who wrote the line, which is a different and answerable
question. This slightly sharpens what the tab is: not *"decisions the Overseer made"* but **things
done in Greg's name that he has not yet reviewed**, of which assumptions are one class.

**`decidedAt` is separate from the envelope's `at`.** When the decision was taken, versus when the
line was written. They are the same for a live write and different for the one seeded record
(§ Migration), and conflating them would date a historical decision to its import and compute its
age from the wrong instant.

- **`class`** — `assumption` | `decision` | `decline`. [overseer.md § gate 1](../project/overseer.md)
  says *"every decision, assumption and decline goes in the log"*. A record with no category cannot
  implement that sentence, cannot tell a gate-2 product default from a low-stakes call, and cannot
  later hand one class to `questions-mode` without parsing prose. Sol's P1-3; it was missing from the
  first draft entirely.

  **All three classes go on the tab, and the runbook's "assumptions only" sentence is retired.** That
  was a question this plan put to the Overseer, and it answered under gate 2 rather than waiting for
  Greg — 2026-09-09:

  > Greg's words for this mode are *"explains the question, options, tradeoffs, decision made, and
  > why, so that I can at least review them afterwards"* — assumptions, decisions and declines are
  > all decisions made in his name, so all three classes belong on the tab, and the first screen is
  > the not-yet-reviewed count and list, newest first; the runbook's "assumptions only" sentence
  > predates today's widening and I will retire it against your landed tab.
  >
  > — the Overseer, 2026-09-09

  So § The log, and the surface Greg reads is the Overseer's to edit, not this session's, and the
  ordering below is settled: **not-yet-reviewed first, newest first within that.**
- **`question`** — plain, per [AGENTS.md § Explain plainly and briefly](../../AGENTS.md). Not a slug,
  not a title: the sentence Greg would have been asked.
- **`options`** — at least two, each `{ name, tradeoffs }`, both non-blank, names distinct. "The
  options" with one entry is a decision with no alternative considered; two identical entries is the
  same thing wearing a disguise.
- **`chose`** — `{ option: string; note: string | null }`, where `option` **must match one of the
  `options` by name**. The first draft made this free text on the argument that Greg's answer is
  often a fifth option; round two's objection is decisive: free text permits *"options A and B …
  decided C"*, with no trade-offs recorded for the thing actually done, which is the one row on the
  page that most needs them. **A fifth option is an option**: add it to `options` with its
  trade-offs, then choose it. `note` carries any prose the choice needs beyond naming it.
- **`why`** — required, non-blank.
- **`advisers`** — a non-empty set drawn from `sol` | `fable` | `nobody`, with `nobody` exclusive:
  `["nobody", "sol"]` is a contradiction, and an empty array cannot be told from a field somebody
  forgot.
- **`bearsOn`** — `{ sessions: SessionRef[]; plan: string | null }`, session names distinct. See
  § What a session reference carries, which is the other thing the review changed.
- **`supersedes`** — `string | null`, naming an existing record decided earlier. § The five ways,
  door 5.

There is no `decidedBy` field at all — see above. An event arriving with one is **rejected** rather
than accepted-and-ignored, so a writer built against the older shape fails loudly instead of having
a field silently dropped.

**What this does not do**, stated because a claimed protection is worse than an admitted gap:
anything running as this user can append a line saying `by: "greg"`. That is equally true of the
Markdown file this replaces, and of the idea queue. Gate 1 is a governance constraint, not an OS
boundary.

**Transitions, each with a test:** no two `decided` with one id; no event for an unknown id (never a
row created by a side effect); no duplicate `eventId`; a `reviewed` or `reversed` timestamped before
its `decidedAt`; `reversed` is terminal, and it counts as Greg having seen the record; repeated
`reversed`, and `reviewed` after `reversed`, are problems.

**`commandId` is a conflict key, not a mute button.** The queue carries the key without consuming it;
the first draft claimed the cost and skipped the behaviour (Sol's P2-3), and the *second* draft
over-corrected into "a repeat is dropped as the retry it is" — which silently swallows a genuinely
different write that happens to reuse a key. So: same key with a **byte-identical** payload returns
the original result and appends nothing; same key with a **different** payload is **refused as a
conflict**. And the duplicate-`eventId` check runs **first**, so a reused command can never mask one.

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

**So v1 shows what it can measure and says what it cannot.** Per row: the decision's age (from
`decidedAt`), and the sessions it names split by their `ExecutionRef` arm — with **"live" meaning the
stored token still matches the register's verified run for that name**, not merely that the name is
present. A name whose token has changed is a *different run*, and drawing it as live would be the
name-reuse error wearing a badge. No hours, and no ordering by a number that does not exist.
Ordering is **unreviewed first, then newest first**, which is the thing the surface is actually for.

**And the missing measurement is made possible rather than abandoned** — but only partly, and round
two was right that the first version of this paragraph claimed more than the field delivers.

A `SessionRef` is `{ name: string; execution: ExecutionRef }`, where `ExecutionRef` is a **three-arm
union rather than `string | null`**:

```
| { kind: "verified"; token: string; since: string }   // the register named a verified run
| { kind: "not-found" }                                // the register was read; this name was not in it
| { kind: "unavailable"; why: string }                 // no checkpoint, unreadable, stale, or ambiguous
```

`null` could not carry those three apart, and *we could not look* rendered as *it was not there* is
the exact mistake this repo keeps making. The CLI resolves it **at the moment the decision is
written**, which is the one moment the identity is knowable.

**Three honesty limits, stated because the field is easy to over-read:**

- `RegisterEntry.verifiedExecution` is **sticky by design** — during an observation that could not
  verify anything it holds the *last* verified run, not proof of what is running now. So `verified`
  means *the register's last verified run for this name, as of this checkpoint*, and `since` is
  carried so a reader can see how old that is.
- A checkpoint that is absent, unreadable, or older than the daemon's own staleness bound is
  `unavailable`, not `not-found`. So is a name matching two register entries: **an ambiguous
  identity is not an identity.**
- **The token makes a later measurement *joinable*, not *correct*.** It can be joined to
  `session-seen` and `session-execution-changed` in `events.jsonl` to tell a reused name from the run
  that was actually there — off the request path, never scanned per request. What that would yield is
  **observed run-lifetime**, which is still not *work attributable to this decision*. Nothing
  available on this box measures that, and the plan should not imply a later stage will.

Cheap now, impossible to add retrospectively — which is the whole reason it is stored today.

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

- **scroll the active mode button into view** when the dock mounts and when the mode changes —
  `inline: "nearest"`, `block: "nearest"`, no smooth scroll (the mode switch cuts it). It must run
  **after the fit rung has settled**, and depend on `fitClass` as well as `mode`: the rung changes
  the button widths, so scrolling first scrolls to the wrong offset. Round two's point, and it is the
  kind of thing that would have looked like an intermittent bug.
- **an overflow affordance** so a scrollable bar looks scrollable: an edge fade on whichever side has
  more to show. **It must be an overlay or mask that contributes no width to `.dock`**, or it feeds
  back into `fit.ts`'s measurement and the ladder starts oscillating. Its state updates on manual
  scroll, on resize, on a fit change, and after a programmatic scroll.

Tested at **left, middle and right overflow**, not only the direct `#decisions` load.

That is a `Dock.tsx` change of maybe thirty lines. **The coarse-pointer share count is deliberately
NOT touched here:** `questions-mode` is landing the fix `fleet-dashboard-modes.md` § What this costs
already asks for — `Dock.tsx` setting a `--dock-mode-count` custom property from `MODES.length`, with
`tailwind.css` reading it — which deletes the hand-kept literal rather than incrementing it, so a
third tab cannot get it wrong. Bumping `8 → 9` here would only be a line for them to delete, and both
sessions editing one declaration is the collision neither of us needs. If that fix does not land,
this session bumps the literal instead; they have undertaken to say so the same day rather than leave
it to be discovered by watching `dev`. **It is recorded here as a deliberate
cross-cutting decision rather than slipped in**, because `Dock.tsx` is the file every mode author is
in. The alternative considered and rejected: a third fit rung that shaves button padding, as the
product's own bar has — it buys ~11px, which does not close a 360px floor against a 390px viewport,
so it postpones the problem by one tab rather than fixing it.

**If the browser stage shows the active tab still unreachable on a direct phone load, the work does
not ship the tab** — and it does not ship the fallback either. The Overseer settled that on
2026-09-09: *"If the active tab is still unreachable at 390px on a direct `#decisions` load, that
goes to Greg as you say, and you record it as important work left rather than shipping a section on
the Overseer tab."* A section on the Overseer tab is a product deviation from what Greg asked for,
not a panel move, so nobody here takes it.

The Overseer confirmed the `Dock.tsx` change is welcome and that nobody else was in that file as of
2026-09-09 10:20Z, with the lines to be announced to it when they exist. **That is a reading, not a
lock** — round two's correction — so the sequence is: merge `origin/dev`, *then* verify visually, and
verify again after any later merge that touches the dock.

Six places in three files, per
[fleet-dashboard-modes.md § The registrations](../project/fleet-dashboard-modes.md#the-registrations):
`MODES` and `MODE_LABELS` in `mode.ts`; `MODE_ICONS` and `MODE_TIPS` in `Dock.tsx`; the mount in
`App.tsx`; the share count in `tailwind.css`. Two are checked by nothing — and the sixth is
`questions-mode`'s to delete, per above, so this stage edits five.

**The data is on-demand, not pushed.** It is a page Greg opens in the morning, not a number the fleet
needs every 73 seconds, and pushing it would serialise every decision's options and trade-offs to
every open tab on every cycle. So: a route module, an exact path, a stated maximum, a typed client
with an injectable seam, an injected-and-defaulted `App.tsx` API prop, and a lifecycle test.

**What "a stated maximum" means here, since a general row cap could hide an unreviewed decision:**
every **unreviewed** record is sent, always. Reviewed history is capped at **the most recent 100
records**, with the exact withheld count on the payload and drawn on the page. The whole response is
bounded at **2 MiB**; if the unreviewed set alone exceeds that, the route **fails loudly** with a
named arm rather than truncating — a decision Greg has not seen must never be the row that fell off
the end. (Round two's objection to the first draft was that "a stated maximum" with no number is not
one.)

**Every aggregate is unavailable under problems, not just the headline.** A corrupt line could have
hidden a decision, a review *or* a reversal, so the seven-day counts go the same way as the pending
count. And the payload carries **the instant it was composed**, drawn on the page: this is an
on-demand route, so a dashboard left open overnight would otherwise show a plausible pending count
from twelve hours ago with nothing to say so.

**Read-only, for the same reason `GET /api/queue` is.** The dashboard has no authentication;
reachability is the whole boundary. A `POST …/reviewed` would let anything able to reach the port
mark decisions reviewed in Greg's name — precisely the number the record exists to protect. Only the
CLI writes `reviewed`, and a review button waits on the same identity story the queue's writes wait
on (§ Needs Greg).

## The joint question for Greg: the dock is full

**Raised once, on behalf of two tabs.** `questions-mode` is landing mode ten while this lands mode
nine, and it and this session agreed to put the shape question to Greg jointly rather than each
raising half of it — the Overseer's own practice when two tabs share a question. This draft is
this session's; `questions-mode` reviews it, and whichever of us debriefs second carries it.

### What this is about, in plain words

The fleet dashboard has a bar along the bottom with one button per **mode** (a tab: Sessions, Box
health, Deploys …). It is the only navigation the page has. Two more modes are landing today, taking
it from eight to ten, and the bar has run out of room on a phone.

### The measurement, and what kind of claim it is

**Observed**, by session `readiness-tab` at 06:12Z on 2026-09-09, at 390 px on a touch viewport:

> The dock has run out of rungs: at 390 px coarse-pointer the eight modes fit only as icon buttons
> and the standalone Refresh sits past the edge; flex-grow cannot help when there is no free space,
> so a ninth tab makes it worse.

**Derived**, from `tailwind.css` — and stated as a derivation, not a reading, because nobody has yet
put a ruler on nine or ten. Under `@media (pointer: coarse)` every button has a 40 px floor
(`.dock-btn { min-width: 2.5rem }`); the active mode keeps its label even at the last fit rung; and
`.dock` also carries Refresh, two 0.15 rem gaps, a left gutter and a trailing gutter element. That
puts eight modes at roughly 440 px against a 390 px viewport, with each further mode adding about
41 px — so ten lands near 520 px.

**The two agree at eight**, which is the useful part: an independent observation and an independent
derivation reach the same verdict at the count we can actually check. Neither has been measured at
nine or ten, and `questions-mode` will put a ruler on it during its browser stage.

The bar does not clip — `.dock` has `overflow-x: auto` at every width, deliberately, so the failure
is an honest drag rather than a silent disappearance. What it does not have is any sign that there
is more to drag, or any guarantee that the tab you are on is the part you can see.

### What is already being done regardless of the answer

Both sessions are landing a fix that makes a scrolling bar honest: the active mode is scrolled into
view on load and on change, and an edge fade shows which side has more. That makes ten modes
**survivable** — you always see where you are, and the bar visibly looks scrollable. It does not make
ten modes **fit**, and no amount of CSS will.

### The options

**A — Live with a scrolling strip.** Ship the scroll-into-view fix and stop there. A horizontally
scrolled tab strip is an ordinary mobile pattern (browser tabs, app store categories). *Costs:* you
never see all ten at once on a phone, and finding a tab you have not used lately means dragging.
*Gains:* nothing further to build; adding an eleventh mode costs nothing new.

**B — Change the navigation shape.** Either a "More" overflow button holding the tail of the list, or
a two-row bar on narrow screens. *Costs:* real work in the file every mode author edits, and an
overflow menu makes the hidden modes second-class — the one you want is always in the menu.
*Gains:* everything is reachable without dragging, and the count stops mattering.

**C — Some of these should not be tabs.** `questions-mode`'s option, and the one worth thinking about
hardest, because the bar being full may be a symptom rather than the problem. Ten peers implies ten
equally important things, and they are not. Candidates, none of them decided:

- **Queued ideas, Decisions and Questions are three views of one thing** — what the Overseer is
  going to do, what it did in your name, and what it needs from you. They could be one tab with
  three sub-views, taking the bar from ten to eight.

  **And the merge is real work rather than a re-parenting of three panels, which is worth knowing
  before choosing it.** The three have three different **freshness contracts**: Queued ideas is a
  file read on demand; Decisions is append-only history where a minute's staleness changes nothing;
  Questions is a join between a roughly two-minute-old judgement and a roughly 73-second-old
  snapshot, and it is **the only one of the three where being a minute stale changes what Greg does
  next**. One tab has to present all three honestly or state which part of itself is older. That is
  the thing a merge has to solve rather than assume — `questions-mode`, 2026-09-09.
- **Readiness and Deploys** both answer *is what we have good enough to ship*.
- **Usage limits and Box health** — one is the box's body and the other its budget. `mode.ts` says
  they sit adjacent on purpose, so this is the weakest of the three.

*Costs:* a sub-view layer to build, and someone must decide the groupings — which is a product call,
not an engineering one. *Gains:* the bar stops growing, and the page starts saying which things are
peers.

**D — Drop something.** If a tab is not being opened, it is not paying for its 41 px. Nobody is
measuring which tabs get used, so this cannot be answered today; it becomes answerable if that is
worth instrumenting.

### What would decide it

- If the phone is where you actually read this, A is the weakest — dragging to find a tab is the
  thing you would do most.
- If tabs keep arriving (and they have, four in one night), C is the only option that stops the
  problem recurring; A and B both postpone it.
- If the dashboard is mostly a desktop page and the phone is for glancing, A is fine and the rest is
  not worth building.

**Neither session is asking to build B or C now.** Both are shipping A's fix because a scrolling bar
should be honest whatever else happens. The question is whether C is worth queueing.

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

### Stage 1 — the record, and the CLI's writes

- [ ] `tools/overseer/decisions.ts`: schema constant, `DecisionEvent`, envelope, strict `parseEvent`
      (every non-blank and uniqueness rule in § The record), `foldDecisions` → `DecisionView`,
      `appendEvents` under its own lock with the **clean-prefix** candidate comparison, `mintId`
      (`dec-` + eight of the queue's alphabet), `commandId` handling.
- [ ] The fold's teeth, **each with a test seen red when the rule is removed**: only Greg's
      `reviewed`/`reversed`; `<2`, duplicate or blank options; a `chose.option` naming no option;
      blank `question`/`why`; empty, duplicated or contradictory `advisers` (`nobody` is exclusive);
      blank or duplicated session names; a malformed `ExecutionRef`; duplicate decision ids;
      duplicate `eventId`; an event for an unknown id; a review dated before its decision; repeated
      `reviewed`; `reversed` terminal, and implying reviewed; `supersedes` naming a missing or later
      record; and **superseding never reducing the pending count without replacing it**.
- [ ] **`commandId` is a conflict key, not a mute button.** Same key + byte-identical payload → the
      original result, nothing appended. Same key + different payload → **refused as a conflict**,
      never silently treated as the retry. Duplicate-`commandId` handling must not mask a duplicate
      `eventId`, which is a separate problem with a separate test.
- [ ] The clean-prefix comparison specifically: a fixture with one unreadable line plus one illegal
      new event must be **refused**, and the test written so that swapping the baseline for the
      queue's count-only shape turns it green. This is the test `queue-priority` can copy.
- [ ] `scripts/overseer-decisions.ts` on Commander: `template`, `add --file <path|->`, `show <id>`,
      `export`, `reviewed <id>`, `reversed <id>`. `--by` required on every write, never defaulted.
      `add` resolves each session's `ExecutionRef` from the register at write time, with the three
      arms kept apart.
- [ ] Three read arms carried through, not flattened: `never-written`, `decisions` (possibly empty),
      `unreadable`.

**`list` is deliberately not in this stage.** It needs the age and live/not-found rendering, which is
Stage 2's module — round two caught that the first split made Stage 1 un-green on its own.

### Stage 2 — the view module, `list`, and the seed

- [ ] `tools/fleet/decisions-view.ts`: per-record age from `decidedAt`; the session split, where
      **live means the stored token still matches the register's verified run**; the trailing
      seven-day factual counts; unreviewed-first then newest-first ordering; the composed-at instant;
      and the **all-aggregates-unavailable** arm whenever the view carries problems.
- [ ] Mutation-checked: rendering `not-found` or `unavailable` as live must go red; matching on name
      rather than token must go red; any aggregate surviving a problem in the view must go red;
      ordering falling back to newest-first while unreviewed rows exist must go red.
- [ ] The CLI's `list` prints the same numbers from the same module.
- [ ] **The seed, with a real application step.** A checked-in fixture is not a populated store, so:
      `overseer-decisions seed` — idempotent by `commandId`, safe to run twice, and it must be run
      for the record to exist. It preserves the historical `decidedAt` (2026-09-09 08:12Z) against
      its own envelope `at`, and stores `execution: { kind: "unavailable", why: "seeded from the
      hand-kept log" }` for its named session rather than resolving a token against a later
      same-named launch.

### Stage 3 — the route and the mode

- [ ] `tools/fleet/routes-decisions.ts` (`GET /api/decisions`), mounted in `server.ts`, with a
      **comment-stripped** source guard on the mount — the needle survives inside a `//`, which is
      how such a line actually dies.
- [ ] The maximum, with numbers: every unreviewed record always; reviewed history capped at 100 with
      an exact withheld count; 2 MiB overall; a named loud failure rather than truncation if the
      unreviewed set alone exceeds it.
- [ ] Wire types in **one additive end block** of `wire.ts` (types only, no runtime values); any
      vocabulary array stays in the node module with `as const satisfies`.
- [ ] `decisions-client.ts` with an injectable `DecisionsApi` seam; strict client parsing; a
      *this browser never got an answer* arm distinct from the server's own silences.
- [ ] `DecisionsPanel.tsx`; **five** of the six registrations (the coarse-pointer share count is
      `questions-mode`'s to delete); the `Dock.tsx` active-into-view scroll and the
      overflow affordance (§ The mode). Copy: the tab is **things done in Greg's name that he has not
      yet reviewed**, not "decisions the Overseer made" — assumptions are one of the three classes and
      gate 2 says of those that the Overseer *is not deciding*.
- [ ] Tests: `fleet-feed-panel.test.tsx`'s four assertions (`MODES` contains it with its label; the
      hash opens into it — mutate the `App.tsx` arm and watch it red; the button writes the hash; the
      empty state names **which** nothing it is), asserted against `MODES` and never a literal list,
      driven by `mountFull()`. Plus: a complete row renders every required field; problems suppress
      **every** aggregate; all unreviewed records survive the reviewed cap; the withheld count is
      exact; oversized unreviewed data produces the specified failure; the global Refresh reloads
      this panel; a failed refresh invalidates rather than leaves a stale headline; route composition
      through the same path `server.ts` uses; timeout and no-answer.

### Stage 4 — see it, and land it

- [ ] **Merge `origin/dev` first**, then browser-verify — round two's ordering, and it matters
      because the dock is the shared file. Re-verify after any later merge that touches it.
- [ ] Browser-verified at 390×844 and 1280 by a Sonnet subagent on its own throwaway port
      (`FLEET_PORT=8791`), never `:8787`'s process, killed by its own pid.

      **The gating check, corrected: is the active tab visible and reachable on a direct load at
      390px — measured on the LAST mode in the bar, not on this one.** The first draft asked only
      about `#decisions`, and that is not the worst case: `decisions` sits seventh of nine, so
      passing it would have said almost nothing. The worst case is the mode furthest from the scroll
      origin, which at nine is `deploys`. So three loads: `#sessions` (first), `#decisions`
      (mid-bar), `#deploys` (**last, and the one that actually tests scroll-into-view**).

      Fields, agreed with `questions-mode-s2` so its ten-mode reading and this nine-mode one are
      comparable side by side: bar height; whether Refresh sits past the edge; which fit rung is
      active; whether the active button is reachable without a horizontal drag; and
      `scrollWidth`/`clientWidth`/**`scrollLeft`** on `.dock`. The three together are what separate
      *the bar overflows and we scrolled to the right place* from *the bar overflows and the active
      button is off-screen* — overflow alone is expected and is the honest failure the dock was
      built to have.

      **Read after the fit rung has settled**, never during the first paint: the rung changes button
      widths, which is why the scroll effect is keyed on `fitClass` as well as `mode`.

      **The predictions, written down before either session measures — `questions-mode-s2`'s
      discipline, and the reason the shared load is worth taking at all.** This session reads at
      nine modes and that session at ten, and both read `#deploys`, so the two are comparable. A
      first draft of this said *"if `#deploys` reads the same in both, one of us measured before the
      rung settled"* — which names one cause for a symptom that has at least three, and the other
      two are likelier: one of us measured a tree with the wrong mode count (the same bar twice, for
      an honest reason), or the rung is the same at nine and ten because both are past the last one,
      in which case the per-mode delta is icon width rather than glyph-plus-label. **A matching pair
      is evidence that something is wrong, not evidence of which thing.** So, pre-registered:

      - `clientWidth` on `.dock` must be **identical** in both readings (390 at coarse). If it is
        not, one reading is not at 390×844 coarse and nothing else in the pair is comparable.
      - `scrollWidth` at ten must exceed `scrollWidth` at nine by **one mode's width — about 41px**,
        which is the figure this plan derived and the number actually under test. A delta near zero
        means somebody measured the wrong tree; a delta far from 41 **falsifies the per-mode figure**,
        which is a result worth having on its own.
      - The fit rung at nine and at ten, reported **as a rung rather than as a description**. If they
        are equal, the expected delta is icon width rather than 41px, and we say so rather than
        calling the 41 wrong.

      That is what makes the shared load capable of coming back false, which is the only version
      worth the extra measurement.

      **Every number carries the sha it was taken on.** Reachability is a property of the
      scroll-into-view fix rather than of the bar, so a reading taken without it in the tree would be
      a true measurement of a false thing — `questions-mode-s2`'s catch. The overflow half
      (`scrollWidth`/`clientWidth`, the rung, Refresh's position, bar height) is fix-independent and
      may be taken any time; the reachability half (`scrollLeft`, is the active button on screen) may
      not.

      If the gating check fails, the tab does not ship and this is recorded as *important work left*
      for Greg (§ The mode).
- [ ] `npm run typecheck` **on the post-merge tree**, and count the mode entries — a merge can drop
      one with no conflict marker.
- [ ] The stale mode-count comments, since this work is in those files anyway: `Dock.tsx`'s header
      still says three modes, `fit.ts` reasons from four buttons, and `fleet-dashboard-modes.md`
      still cites `flex: 3` where the code says 8. Round one raised these and the first rewrite did
      not take them.
- [ ] Docs: a line under the entry point that owns a new `decisions.md`, and a link back up. The
      before/after for `overseer.md`'s gate 1 **NOT BUILT** block **and** for § The log, and the
      surface Greg reads goes in the debrief as a **proposal for Greg** — gate 3 forbids the Overseer
      changing a constraint on its own decision log, and it agreed (§ Needs Greg).

## What the plan-stage reviews changed

**Round one** returned *"needs rethinking"* — two P0s and seven P1s. Taken in full: `amended`
dropped; the clean-prefix comparison; the count unavailable under problems; the `class` field;
`decidedBy` narrowed; wider parse and transition validation; `commandId` actually consumed; the
route's unreviewed-always maximum; the seven-day verdict deferred; the one-row seed; the
over-citation of `tests/fleet-imports.test.ts` corrected.

Its largest finding was that the agent-hours ranking was *"not an honest measurement"*, and it was
right — hence storing the execution identity at decision time and showing only age and a session
split now.

**And round one's brief was right where the first draft doubted it.** The draft said the claim that
the dock is out of room at eight tabs *"is not in `design-a-screen.md` or `fleet-dashboard-modes.md`"*
— true, and the wrong place to look: it is in the Overseer's hand log at 06:12Z, measured by
`readiness-tab`. Flagging an unverified brief claim is right; concluding it is unfounded because two
greps missed it is not the same thing.

**Round two** on the rewrite found **no P0 remaining** and *"not yet safe to build exactly as
written"*, with seven P1s. Every one is taken, and four of them changed the design rather than
tightening it:

- **`SessionRef` claimed more than it could deliver.** `verifiedExecution` is *sticky*, so it holds
  the last verified run rather than proof of what is running now; and `string | null` could not tell
  *not there* from *we could not look*. Hence the three-arm `ExecutionRef`, "live" meaning the token
  still matches, and the explicit statement that a later metric would be **observed run-lifetime**,
  not work attributable to a decision.
- **Dropping `amended` left no way to correct a record**, and the hand log proves the case: an
  08:20Z claim was withdrawn at 08:25Z. Hence `supersedes`, and the rule that superseding never
  reduces the pending count without replacing it.
- **`decidedBy: "overseer"` is semantically false on the `assumption` class**, since gate 2 says of
  a product default *"you are not deciding"*. Removed; Overseer-origin is a schema invariant. The
  Overseer agreed and asked for the sharper name to be used in the tab's own copy.
- **A free-text `decision` permits "options A and B, decided C"** with no trade-offs for what was
  actually done. Hence `chose.option` must name a listed option: a fifth option is an option, and it
  gets its trade-offs written down before it is chosen.

Plus: real numbers on the route maximum (100 reviewed, 2 MiB, a loud failure); every aggregate
unavailable under problems, not just the headline; a composed-at instant on the payload; `commandId`
as a **conflict** key rather than a mute button; the stages re-split so each is green on its own
(`list` moved to Stage 2, the seed given a real idempotent application step, merge-then-browser in
Stage 4); and the dock fix specified properly — after the fit rung settles, `inline: "nearest"`, the
fade as an overlay contributing no width, tested at three overflow positions.

**Round two also caught a governance error that was not in the plan at all.** The Overseer had
retired the runbook's *"assumptions only"* sentence under gate 2. Gate 3's list includes *"modifying
your own constraints — these gates, the queue that authorises you, **the decision log** … You may
*propose* a change to any of them"*, and a rule bounding what the decision log's surface may show is
exactly that. Raised with the Overseer, which agreed: the tab's classes and ordering stay its gate-2
default, the runbook sentence stays as written, and its retirement goes to Greg as a proposal at the
debrief.

## Needs Greg

1. **A review button on the page needs an identity story.** Until then a decision can only be marked
   reviewed from a terminal. The cheap shape the queue plan already proposes: mutations only from
   allowlisted Greg-device tailnet identities, loopback read-only. One answer unblocks both.
2. **Only if the browser stage fails**: whether "Decisions made" may live somewhere other than its
   own tab, if a ninth tab cannot be made reachable at 390px. Not decided here, and not decided by
   the Overseer either — it would be recorded as *important work left*.

*(A third — whether all three classes belong on the first screen — was put to the Overseer and
**decided** by it under gate 2 on 2026-09-09; see § The record. Reversible by Greg at the debrief.)*

## Needs the Overseer

- ~~**`idea-queue.ts` has a live authorisation bypass**~~ (§ The four ways the count could lie,
  item 3) — reported 2026-09-09 and **routed by the Overseer to `queue-priority`**, whose file it is
  today, with the fix and the red-first test. Stage 1's test #8 is written to be copyable there.
- ~~the decision/question boundary~~ — passed on: it is written into `questions-mode`'s brief for
  when that session starts.
- A dashboard restart, for the tab to be live. Not mine to do.
- The `Dock.tsx` lines, announced to the Overseer once they exist (agreed 2026-09-09).
