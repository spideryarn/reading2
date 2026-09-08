# Wave 2: the write path, usage limits, box-health history, the attention inbox, and a Codex adapter

Greg, 2026-09-08, in one message:

> Use @docs/reusable/engineering-manager.md to work on:
> - securing the write path
> - usage limits (perhaps there's an API we can call to get the updated status? failing that, I'll add
>   an admin key. use Sonnet for web research if needed)
> - for the Box Health, show graphs of recentish history (last 24h), so that I can tell whether there
>   might have been problems/disruptions to be aware of, and include the amount/proportion of swap used
> - attention inbox
> - v1 of Codex/GPT harness adapter
>
> Push and pull periodically

The direction, the constraints and every earlier quote live in
[orchestrator-direction.md](../project/orchestrator-direction.md). This plan does not restate them; it
says what gets built, by whom, in what order, and what done looks like.

## Two things are already answered, and the answer changes the work

**Usage limits: there is no API, and the admin key would not help.** Greg offered one; the research
was done and hand-verified earlier the same day, and is written up in
[§ Can we call an API instead? Mostly no, and not with an admin key](../project/orchestrator-direction.md#can-we-call-an-api-instead-mostly-no-and-not-with-an-admin-key).
The short version: every `/v1/organizations/*` usage endpoint reports **Console API-key spend**, not
subscription quota — Anthropic's own FAQ says *"This API only tracks Claude Code usage on the Claude
API"* — and admin keys are minted for a Console organisation, which a personal Max subscription may
not have. The headers that do carry the real numbers are undocumented, unversioned, and currently
reported returning persistent 429s.

**So this stage is not research, it is construction**, and the sources are already identified: the
local `~/.claude.json` cache as a *hint that must be checked against its own `resets_at`*, and the
transcript 429 as *ground truth*. No Sonnet web research is being spent on a question that was
answered today. **Do not ask Greg for the admin key.**

**Swap is already collected.** `parseSwap` and `parseSwapActivity` in `tools/fleet/health.ts` already
return total, used, `usedFraction`, the per-file breakdown, and live si/so from `vmstat` — and
`health-view.ts` already renders a swap card with the *"swap is a cliff, not a slope"* thresholds. So
the swap half of Greg's third bullet is **mostly done**, and what is missing is the part he actually
asked for: **history**. Whoever takes it should check the rendered card against his ask rather than
rebuild the collector.

## Ownership: two agents, one tree of files

Greg added a sixth item mid-run — *"borrow from Spideryarn for voice-dictation and realtime-dialog for
all input-message-text-boxes"* — and said *"if helpful, use `gjd-remote new-claude` to fan these out."*
So this is six workstreams across six sessions, and the split below was **negotiated by message, not
assumed**: proposed to `claude-agents-dashboard` at 12:45 and accepted at 12:58 with three collisions
named.

| item | session | why |
|---|---|---|
| **1. securing the write path** | `claude-agents-dashboard` | A9, A10, A11, A6 are all `owner: dashboard` in [§ The backlog](../project/orchestrator-direction.md#securing-the-live-write-path-a-stage-but-not-the-top-one). The write path is `routes-*.ts` and `steer.ts`. **A6 already landed** (`0a5a3008`, CSP + anti-framing). |
| **2. usage limits** | `w2-usage-limits` | Account-level, not pane-level. Collector and 429 ground truth here; the `FleetStatus` arm is the dashboard's. |
| **3. box-health 24h history + swap** | `fleet-health-history` | Retained in the dashboard process, against the direction doc's assignment — see below. |
| **4. attention inbox** | **split** | The Overseer decides what needs Greg and why; the dashboard renders and collects the tap. |
| **5. Codex/GPT harness adapter v1** | `w2-harness-adapter` | It is a question about what a session *is*, which is the Overseer's tense. |
| **6. dictation + realtime dialog** | `w2-fleet-dictation` | Dictation first, by Greg's call; the dialog stage is gated on it. |

**Every collision has the same shape, and the seam is a type in each case: one side detects, the other
renders.** The dashboard owns `FleetStatus` (five exhaustive switches depend on it) and owns the row
type, so a Codex session and a rate-limited session become *arms it adds*, from *field names we send
it first*. Its words, and they are the rule: **"Send me the shape, not the rows."**

**The split on #4 is the seam working, not a boundary being crossed** — the same shape as A12, which
the dashboard closed on the Overseer's behalf because the prefix belongs where the message is
delivered. Here the ranking belongs where the durations are, which is the store.

### `wire.ts`, and why the Overseer's types are going into it

The dashboard is spiking `tools/fleet/wire.ts`: **one leaf module holding every type that crosses the
server/browser boundary, imported by both sides, so a field one side adds is a compile error on the
other rather than a silently-missing render.** It exists because of the same morning's postmortem —
sixteen instances of a hand-written join that nothing checked, ten of them lossy, the worst being a
body that sent `dryRun` while the route only ever parsed `mode`, so **every box action ever pressed
was a dry run reported as "Done."**

`~/.overseer/current.json` is exactly that kind of boundary and currently has exactly that protection:
none. **So the Overseer's published types go into `wire.ts` when it lands** — we write them, the
dashboard imports them, and neither side can drop a field the other set. The store's parsers are
already leaf-shaped for an unrelated reason (pure, no `execFileSync` and no `Date.now()` inside them),
so they should fit. **If the spike is disproved** — every server type reaches `node:child_process`
transitively and the client tsconfig has no node types — the fallback is a hand-written mirror **plus
a test that fails when the two drift**, which is second best and much better than nothing.

### Where the health history lives, and the one thing owed in return

[§ Two tenses](../project/orchestrator-direction.md#two-tenses-the-seam-between-the-overseer-and-the-dashboard)
assigns the vitals history to the Overseer's past tense, and `daemon.ts` says outright *"No health
history and no local collection"*. **It is being built in the dashboard process instead**, and the
argument for that beat the doc: the reading already exists in-process there, **there is one collector
on this box and it is not ours** (a collection costs ~12s of grepping thirty-five transcripts, on a
box that has hit load 391 with the OOM killer firing), and writing at the source removes both a
transport hop and a dependency on the Overseer being up. It gets its own root, `~/.fleet-health/`, so
there is never a question of two writers on one file. Greg decides whether the direction doc moves.

**The contract taken in return: a gap must render as a gap, never a line drawn across it.** Writing
the history inside the dashboard means a dashboard crash punches a hole in exactly the record Greg
opens to find out whether something went wrong — and his stated purpose is *"so that I can tell
whether there might have been problems/disruptions to be aware of"*. An interpolated line through the
ninety minutes the box was thrashing answers that question with a confident **no**. So the sample
interval is recorded, and a wider-than-interval gap is a **datum** ("no reading"), not a missing one.
Two smaller ones in the same family: a 24h axis on a process up for 20 minutes must say so rather than
letting the axis imply a day, and `health.ts`'s readings are unions with `unknown` arms that **must
not be flattened to numbers on the way to disk** — a stored `null` cannot tell "load was 0" from
"`nproc` failed".

## Ordering, and why it is not Greg's list order

Greg's list is a list, not a ranking — he ranked this work explicitly earlier the same day
([§ The order of work](../project/orchestrator-direction.md#the-order-of-work)): *"attention triage,
then perhaps box vitals and throttling, then account usage limits, then scheduler"*, and separately
put the write path in as *"a stage, but it doesn't have to be the top-priority."* Nothing has changed
that. So on the Overseer's side the order is **attention first**, and the write path stays where he
put it.

## Stages

Each ends with the tree green and committed, and would make sense as a stopping point.

### Stage A — the attention list, the deciding half

**The premise triage was about to be built on is wrong**, and it was measured:
[§ `idle` is the bug](../project/orchestrator-direction.md#idle-is-the-bug-the-vocabulary-describes-the-pane-not-the-work).
`needs-you` means *Claude Code says a dialog is open*; ten of fifteen sessions genuinely waiting on
Greg had ended their turn handing him a decision **in prose, ending in a full stop**, and not one
showed as needing him. So the first thing this stage owes is a way to see those.

- A typed `Attention` list written into `~/.overseer/current.json`, one entry per **question**, not
  per session — *"at 11pm nobody cares which of 36 asked"*.
- **Sorted by kind first** (irreversible, product, technical, other) **and only then by age**: *"age
  is a tie-breaker, not a rank"*.
- **Duplicate collapse**, because a repeated duplicate is the strongest available signal that a
  *policy* is missing.
- **Answerable-from-a-phone** as an explicit field, since a question needing a diff read just makes
  him feel behind.
- Ranking is by **consequence and reversibility, never by self-reported confidence** — A18 and Fable
  reached that independently, and confidence ranking promotes exactly the confident mistakes you want
  caught.

**Done looks like**: the list appears in `current.json`, a schema bump if a reader ignoring it would
be wrong, and — the honest check — **it finds prose-ending questions that `needs-you` misses**, with
the count measured against the live fleet and written into this doc. A list that only reproduces
`needs-you` is a failure of this stage, not a pass.

#### The shape, and the four decisions inside it

Published into `tools/fleet/wire.ts` (which landed as `3df3e833`), so the dashboard imports it rather
than re-declaring it. Types only, no imports, no runtime values — a `const` there is bundled into the
browser.

```ts
/** Why we believe this needs Greg. The two arms are answered by DIFFERENT MECHANISMS. */
export type AttentionEvidence =
  | {
      /** The harness says a dialog is open. Mechanical, observed, and it has options. */
      kind: "dialog";
      question: string;
      /** In the order the harness drew them. Answering picks one of these. */
      options: readonly string[];
    }
  | {
      /** The turn ended handing Greg a decision in prose. INFERRED, and it may be wrong. */
      kind: "prose";
      /** The tail of the turn, so a person can check the inference rather than trust it. */
      excerpt: string;
      /** What made us think so, in words. Never a score. */
      why: string;
    };

/** Consequence and reversibility. NOT confidence, and NOT urgency. */
export type AttentionKind = "irreversible" | "product" | "technical" | "other";

/** Whether answering this from a phone is a real option. */
export type AttentionAnswerability =
  | { kind: "phone" }
  | { kind: "needs-a-screen"; why: string }
  | { kind: "unknown"; why: string };

export type AttentionItem = {
  /** Stable across snapshots, so a card cannot move under a finger. */
  id: string;
  /** tmux's own handle — the address, and stable across renames. */
  sessionId: string;
  sessionName: string;
  /** When we FIRST saw this question. Not when we last saw it. */
  waitingSince: string;
  kind: AttentionKind;
  evidence: AttentionEvidence;
  answerability: AttentionAnswerability;
  /** Other sessions asking the same thing. Answer once, apply to all. */
  duplicates: readonly { sessionId: string; sessionName: string; waitingSince: string }[];
};

export type AttentionList =
  | {
      kind: "list";
      /** Already sorted: by `kind` first, then by `waitingSince`. The renderer must not re-sort. */
      items: readonly AttentionItem[];
      /** THE POSITIVE CONTROL. Zero items out of zero scanned is a broken probe. */
      sessionsScanned: number;
      scannedAt: string;
    }
  | { kind: "unknown"; why: string; scannedAt: string };
```

**One — the evidence union is the load-bearing part, and flattening it is the bug this stage is most
likely to ship.** A dialog is *observed*: the harness drew it, the options are enumerated, and
answering means picking one. A prose question is *inferred*: we read the tail of a turn and decided it
was a question, and answering means free text. Those are different risks, not different confidences —
A10 says a live Claude descendant does not prove an empty input box owns the keystrokes, so **arbitrary
prose must stay a narrower capability than answering a recognised dialog**. A single `question: string`
field with a boolean beside it would let a renderer draw the same card for both, which is how the
dangerous one gets the easy affordance.

**Two — there is no confidence field anywhere, and that is deliberate.** Fable and Astra's A18 reached
it independently: *ranking by self-reported confidence promotes exactly the confident mistakes you most
want caught*. `AttentionKind` ranks by consequence and reversibility. If a score turns up in a later
draft, it is a regression.

**Three — `waitingSince` is first-seen, not last-seen, and it is why the store had to come first.**
The pane says a dialog is open; it cannot say for how long. Duration is a fact only something with a
memory can produce, which is the whole reason
[§ The order of work](../project/orchestrator-direction.md#the-order-of-work) says attention triage
*arrives* first but cannot be *built* first.

**Four — the producer sorts, and the renderer must not.** *"Do not reorder or replace a card's options
while his finger is approaching them"* (Astra). Stable `id`s make that possible; a renderer that
re-sorts on every payload throws it away. And `sessionsScanned` is the positive control — an empty
list is only good news if something looked.

**What is deliberately NOT in the type**: a routing field. *Who should answer this* (the Overseer for
what it can verify, Sol for evidence in the tree, Fable for wording and defaults, Greg for anything
irreversible) is a real part of the design, but it is a **decision the Overseer acts on**, not
something the phone renders — and shipping it as a field invites a UI that shows Greg a queue of
things it has decided not to ask him. It lands when something answers, not when something lists.

#### Stage A, built — and what the measurement says

Landed 2026-09-08. `tools/overseer/turn-tail.ts` cuts the tail of an ended turn out of a pane,
`attention-classify.ts` asks one small model one closed question about it, `attention.ts` groups and
ranks, `attention-pass.ts` walks the fleet and holds the budget, `attention-memory.ts` remembers what
was already decided, and the list rides on `Checkpoint.attention` in `~/.overseer/current.json`. **No
`STORE_SCHEMA` bump**: a reader that ignores the field draws no inbox, which is *poorer* rather than
*wrong*, and that is the store's own stated rule. `npx tsx scripts/overseer.ts attention` runs a pass
by hand; `--dry` reads the panes and costs a pass without spending anything.

**The evaluation is the point of the stage rather than a footnote**, because a list that only
reproduced `needs-you` would be a failure. Method: capture every live pane ONCE, to disk; run the
classifier against those bytes; and — with no sight of the classifier's output — have a Fable
subagent read the same captures cold and say for each session whether it is genuinely waiting on
Greg. One capture, two readers, because a fleet of thirty changes underneath you and a second capture
would make every disagreement ambiguous between *the classifier was wrong* and *the box moved*.

**It was done twice, and the second one is the one that counts.** GPT Sol reviewed the first and was
right that it would not carry a general claim: the dashboard snapshot behind its `needs-you` number
was collected 3m20s after the panes were frozen, and its "7 of 9" was three stochastic readings of
the same three examples — repeatability, not population recall. So the whole thing was re-run on a
**fresh, held-out capture**, after every fix, with the dashboard state fetched concurrently.

| | first capture, 12:40 | **held-out capture, 13:50** |
|---|---|---|
| Sessions | 32 | 25 |
| Fable: genuinely waiting on Greg | 3 (+1 cannot-tell) | **4** (no cannot-tell) |
| **`needs-you` found** | 0 of 3 | **0 of 4** — 0 `needs-you` rows out of 24 |
| Classifier, three cold runs | found 2, 2, 3 of the 3; 2 invented | **found 4, 4, 4 of the 4; 0 invented** |
| Sessions the two readers agreed on | 30 of 32 | **25 of 25** |

The four the held-out capture found — `claude-agents-dashboard`, `fb2g-gutter-icons-on-touch`,
`gjd-remote-on-remote-box`, `overseer-orchestrator-design-and` — are the same four in all three runs
and the same four Fable named, and **every one of them read as `idle` on the dashboard**.

**What that does and does not support, and Sol was right to push twice.** The defensible sentence is:
*on this held-out capture the classifier matched Fable's four positives, repeatably, while the nearest
dashboard snapshot showed none of them as `needs-you`.* **The numbers are not what they look like.**
"4 of 4, three times" is **four positives read three times**, not twelve independent ones, and the
zero inventions are **twenty-one negatives read three times**, not sixty-three. Three runs measure
REPEATABILITY; they do not enlarge the population. Seven positives across two captures is not a
population, both ground truths come from one model family, and the second capture is smaller and
calmer than the first. The next gate is a third capture with a human adjudicating rather than Fable.

**Two clocks that are not the same clock.** The dashboard collects every ~65s and serves the cache,
so `/api/state` cannot be sampled at the same instant as a pane: the held-out comparison's snapshot
was collected **54 seconds** before the capture, against 3m20s for the first. That is **nearby, not
simultaneous**, and the word matters — a session can end a turn in 54 seconds, and on a fleet this
size several do.

**Where it wobbles, and I said this wrong twice before Sol corrected it.** The SET of flagged sessions
was identical across the three held-out runs. The `kind` was not: `fb2g-gutter-icons-on-touch` came
back `irreversible`, `other` and `technical` on the same tail. **Those are not adjacent buckets.**
`irreversible` is first in the ranking and `other` is last, so that spread is the whole axis, and the
honest statement is that **presence is stable and RANKING IS UNVALIDATED** — not that the wobble is
confined to somewhere cheap. It is still the cheaper of the two failures, because a misplaced item is
on the list and a missed one is invisible; but "cheaper" is not "measured", and nothing here measures
the ranking.

**And on the arm that matters, the answer is sharper than *it wobbles*.** No session in either capture
produced an `irreversible` verdict from an obvious case, so two tails were **derived from a real
capture by one stated change** and classified eight times each: *"Say the word and I'll push it to
main"* → `irreversible` 8 of 8; *"Say the word and I'll remove the worktree"*, with and without the
uncommitted-work clause → `irreversible` 8 of 8 both ways. Then the arguable one, which
`orchestrator-setup` asked for and which is the finding: *"The migration is written and reviewed and
I have not run it. Say the word and I'll run it."* → **`technical` 8 of 8**. Not noisy — confidently
and consistently wrong.

**That settles the sampling question in the direction that does not flatter us.** Majority-of-three
would not fix the migration case; **it would ratify it**. Which is Fable's warning arriving as a
measurement rather than a principle: a vote is a machine for laundering confidence into agreement,
and the confident mistake is the one you most want caught. Nor is the fix more context —
`orchestrator-setup` pointed out that `meta.dir` tells you whose *code*, not whose *data*, and
[database.md § `DATABASE_URL=…` does not do what it looks like](../project/database.md#database_url-npm-run-dbmigrate-does-not-do-what-it-looks-like)
is a whole section about a migration that hit the wrong database and printed `✓ migrations applied`.
A classifier handed the tree would answer *"local, therefore technical"* with more confidence and the
same wrongness.

**A mechanical consequence floor is the proposed fix, and it is half a fix.** The idea: a tail whose
offered action matches a small reviewed list is floored at *cannot tell*, which the model may raise
and may not lower — the same shape as everything else that has held here, where the lock is enforced
by the kernel and the wire types by the compiler. Probed against four derived tails, and the answer
is that **the vocabulary hypothesis holds in one failure and not the other**:

| derived tail | catchable word | 8 runs |
|---|---|---|
| "The migration is written… Say the word and I'll run it." | migration | `technical` 8 — **the floor would catch it** |
| "…rewrites every article's slug in place; the old ones are not kept anywhere." | none | `irreversible` 2, `technical` 5, `other` 1 — **the floor would miss it** |
| "…goes to all 214 registered readers; there is no way to unsend it." | none | `irreversible` 8 — right without help |
| "a migration in a scratch worktree against my own local Supabase" | migration | `irreversible` 8 — over-cautious already |

So the floor is worth building and must not be sold as guarding the top of the ranking: the case it
misses is the one that is *also* noisy, and the case it would over-flag is one the model already
over-flags on its own. **Floor plus a visible "this list may be under-ranked" line, not floor
instead of it.** Ordering agreed with `orchestrator-setup`: transcripts first (they buy presence),
then the floor, then nothing about giving the classifier more context until the floor proves
insufficient.

**What a pass costs, corrected.** A cold pass over 25 sessions: **10 model calls, $0.0036**, on
`openai/gpt-5.6-luna` through OpenRouter (32 sessions / 11 calls / $0.0039 on the first capture). A
re-run against identical captures is **0 calls** — the cache works. **But "0 calls at steady state"
was wrong and Sol caught it**: over 4.5 minutes on the live fleet, **8 of 12 ended-turn tails were new
or changed**, because a session that ends a turn mints a tail. At the 2-minute cadence that is a few
calls a pass, and the honest arithmetic is roughly **$0.50–$1.00/day** rather than the $0.21 first
claimed. Still cheap; four times cheap.

**And a cost trap worth carrying forward, in three cases rather than the two first written down.**
`usage.cost` alone reports **$0.00000 for a pass that cost money**: this box's key is BYOK, so the
gateway charges its own account nothing and the real figure is in
`usage.cost_details.upstream_inference_cost`. **But adding the two together is the other half of the
same bug** — on an ordinary call `upstream == cost`, one sum reported twice, so a naive sum doubles
the bill, and the first draft here did exactly that while fixing the first half. The repo had already
solved all of it in **`src/ai-spend.ts`** (not `ai-call.ts`, which is what was first claimed here),
whose `normaliseByokUpstream` insists on `=== true` *"because that is what keeps 'we were not told'
from being read as 'yes'"* — and which names a **third case**: `cost: 0` **and** a real upstream
figure **without** `is_byok`. Its answer is to record the call as **unpriced** rather than guess.
`callCost` mirrors all three with the citation; unpriced calls stay out of the total and are counted,
and a total containing one prints as a floor. *That is the same rule `StatusSince` reached from the
other direction the same day — a quantity that is a lower bound must not be able to render as a
reading — and two instances found separately are what make it a rule rather than a preference.*

**The floor on recall this design cannot lift — and the one it can.** Claude Code draws on the
terminal's *alternate screen*, which has no scrollback, so `capture-pane -S -80` and a bare capture
return the same ~25 lines (measured). A turn that asked and then printed forty lines has pushed its
own question off the top. **That is a property of the PANE, not of the session**, and
`orchestrator-setup` measured the difference at 13:15: of the 25 most recently modified of 268
transcripts on the box, **25 of 25 had a retrievable turn-ending assistant text**, and **5 of 25 —
20% — were longer than 25 lines**, the longest 47. So one session in five has a tail this capture
cannot see in full, and the transcript has it exactly, untruncated and ANSI-free, at
`~/.claude/projects/<slugified-cwd>/<session-id>.jsonl`. **The next slice.** It does not replace the
`dialog` arm — the harness draws those and they are not in the transcript — which lines the two
sources up with the evidence union already published.

**GPT Sol reviewed this twice before it landed and would not approve it either time. Nine findings
across the two rounds, all real, all fixed** — which is the second review earning its keep, since a
plan-stage review could not have found any of them. The second round mattered as much as the first:
three of its findings were **holes in the fixes**, including one that would have let the worst bug
survive an upgrade.

1. **A classifier failure published a false *nothing needs you*.** One ended turn, one 429, and the
   result was `{"kind":"list","items":[],"sessionsScanned":1}` — with `breakdownBalances()` green
   throughout, because every row *did* enter a bucket. The accounting proves the walk happened; it
   cannot prove the judgement did. Worse, the failed verdict was **cached**, so every later pass over
   an unchanged fleet answered from memory, made zero calls, and repeated the same wrong silence.
   Now: an `unreadable` verdict is never cached, and an EMPTY list with anything unclassified becomes
   `unknown`. **Incompleteness suppresses the claim of absence and never the items** — a partial list
   costs an agent wall-clock, and an empty one on evidence we did not get is a false claim about
   Greg's obligations.
2. **A scan of nothing drew as a calm fleet**, which the wire type's own comment forbids. And the
   test that was supposed to catch it asserted only that the two results *differed* — which they did,
   by the count, while both were still `kind: "list"`. A check answering a weaker question than the
   one it is named for.
3. **An unrecognised dialog counted as a pane we understood.** A harness dialog-format change would
   have turned every question on the box into a calm fleet. Measured while fixing it: none of the six
   `dialog-*` captures carries the `⏵⏵` footer, because Claude Code takes it away with the input box,
   so the signal is the dialog's key-hint line — `pane.ts`'s own *"the one marker that prose never
   produces by accident"*. It is a second copy of a private function and the duplication is declared
   and pinned against all six fixtures.
4. **`waitingSince` survived exactly the unobserved gap the store refuses to span.** `store.ts` will
   not republish the previous list after a restart; `attention.json` quietly undid that by persisting
   the waits, so a question answered during downtime and asked again came back *"waiting since"* a
   moment nobody observed. The waits now carry the epoch that observed them and are dropped when it
   changes; **the verdicts are kept**, because a verdict is about text and a wait is about continuous
   observation.
5. **Both parsers cast rather than parsed.** `{"evidence":{"kind":"dialog"}}` crossed the evidence
   boundary with no question and no options, and `inboxLines()` threw on a missing `duplicates`.
   Every field and every arm is parsed now, in both.
6. **`readTurnTail` did not return only what the agent said.** The backward walk ran past an earlier
   `❯` in the scrollback — *Greg's own last message* — so a turn that said "Done." could be handed to
   the classifier with "Should I deploy this now?" attached to the front and become a confident card
   quoting a question nobody's agent asked, with the fingerprint caching the contamination. **The
   worst of the six**, and the one furthest from anything a plan could have anticipated.
7. **A shutdown released the store's lock with a pass still in flight**, so a `Restart=always` daemon
   could have two writers on `attention.json`. The pass is awaited before the lock is released, and
   the write is atomic.

**And then the second round, which is why one review is not enough.** Three of these are holes in the
fixes above rather than new ground:

8. **The 429 could still survive an upgrade.** The pass had stopped *writing* an `unreadable`
   verdict, and a memory file from an older build could still *hold* one — read back as a cache hit,
   never added to `unclassified`, publishing the same false calm indefinitely. **A fix that only
   covers newly-written records is not a fix.** `CacheableVerdict` now excludes the arm at the type
   level, so neither a writer nor a reader can express it, and a file holding one is refused whole.
9. **The completeness field was counting the wrong things**: distinct fingerprints rather than
   affected sessions (two sessions sharing one failed tail is two sessions unjudged), it omitted a
   session with no pane, and an empty list plus an unparseable pane printed *"nothing needs you"* with
   a caveat under it **retracting the claim**. Keyed on `sessionsUnreadable` now, so that case is
   `unknown`; and a partial list says **"at least N"** rather than N with a footnote.
10. **A per-process epoch was not enough, and the exception path was still open.** A daemon can
    outlive a tmux restart, after which `$1` names a different session — this repo already treats
    `tmuxServerPid` as the generation, and it is in the epoch now. The `catch` path called
    `stopHere()` before the await that the normal path did. And `overseer attention` is **read-only by
    default** with `--write` as the opt-in, because it does not honour the daemon's lock and an atomic
    rename stops a torn file rather than a lost update.

**One accounting point of Sol's, which is about the register rather than the code.** Adding the
Overseer's seam to `tests/no-undeclared-spend.test.ts`'s ALLOWED map exempts it; it does not record
what it spends, and that file says so in as many words — *a green test is not a register*. There is
now an `UNMETERED_SPEND` entry in `src/spend-declarations.ts` naming the account, the per-pass cost
and why neither seam can be used.

**How to run this again**, because a measurement nobody can repeat is an anecdote. The capture/replay
is in the CLI rather than in a throwaway script for exactly that reason:

```
npx tsx scripts/overseer.ts attention --dry --capture-to /tmp/panes      # freeze the fleet, spend nothing
npx tsx scripts/overseer.ts attention --panes /tmp/panes --out /tmp/run.json --no-write
```

Then hand `/tmp/panes` to a Fable subagent with no sight of `/tmp/run.json`, ask it per session
whether that session is genuinely waiting on Greg and why, and compare. **Order matters**: an
agreement produced by letting the second reader see the first one's answer is worth nothing.

**Tests**: 109 across six files, plus a type-level half in `tests/overseer-attention.test.ts` that
goes red at `npm run typecheck` and cannot at `npm test` (vitest strips types) — it asserts that no
field reaches both arms of the evidence union, and that a `confidence` or a `routeTo` will not
compile. Every fixture under `tests/fixtures/overseer-turn-tails/` is a real capture.
**Mutation-checked: 22 deliberate breakages of the finished code, 22 of 22 caught** — and six of them
reinstate Sol's findings exactly, which is the only way to know that tests written after a fix would
have caught the bug before it.

**Two things named rather than claimed as done.** The `prose` arm gets no answer control in v1, and
the reason is now stronger than *it is inferred rather than observed*: finding 6 means a card could
have quoted **Greg's own last message back at him as his agent's question**, so a button would have
acted on his sentence. And the dialog key-hint recogniser is a declared second copy of `pane.ts`'s
private `isFooter`; `claude-agents-dashboard` is exporting it, and the swap is one import and a
deletion — **the fixtures stay**, because they are what would catch the export itself drifting.

**Still open, and named rather than left to be discovered.** One live pane came back `unreadable` on
the held-out capture: a session with no status line at all above its input box, after a `/clear`. The
arm did its job — it said so instead of guessing — and it is a real gap in the recogniser, and if that
session had been one of the four it would have been a silent miss rather than a visible one. And
`duplicates: []` remains a positive claim ("nobody else is asking") that can only be made about the
sessions actually read; a pass skips Codex panes and mid-turn ones, so within one pass it means "none
of the ones I read". The dashboard is declining the field as `readonly [...] | null` for the
version-skew case; the same caution applies inside a single pass.


### Stage B — usage limits, and the reading that refuses to lie

- `tools/overseer/usage.ts`, pure parsers, string in and a discriminated union out — the shape
  `health.ts` already uses and the reason it is trusted.
- **A reading whose `resets_at` is in the past is `stale`, never a percentage.** Measured: the file
  was 48 minutes old and its `five_hour` window had reset 27 minutes earlier, so its `utilization: 70`
  described a window that no longer existed. **The file always parses and always yields a plausible
  number**; nothing in it announces the number is void.
- **The transcript 429 is ground truth**: `"error":"rate_limit"`, `apiErrorStatus: 429`, and a
  `quotaLimits` object carrying `rateLimitType` and a `resetsAt`. Exact, greppable, cannot be stale.
- Account identity from `claude auth status` — which matters the moment there is more than one, and
  multiple Max subscriptions is **medium-term by Greg's call**, so this stage records *which account*
  and builds no rotation.

**Done looks like**: a usage block in `current.json` that says `unknown` when it cannot tell, with a
test that feeds it an expired `resets_at` and watches it refuse. And a **positive control** — a probe
that finds no 429s anywhere must be distinguishable from a probe that is broken
([silent-success.md](../reusable/silent-success.md)).

### Stage C — the Codex/GPT harness adapter, v1

Half of this exists and was measured: `tools/overseer/work.ts` already recognises `codex exec` in the
process tree, because **4 sessions were running it and 0 showed as anything but idle**. And
`steer.ts` already refuses to send keystrokes to a Codex batch job. What does not exist is the
**type**: a session's harness is currently an assumption, not a field.

- A `Harness` discriminated union with a **capability declaration per harness** — what can be
  steered, what can be answered, what can only be watched.
- The principle it serves is already written down: *"One adapter per harness, and honest about what
  each can do. Claude, Codex and bare shells have genuinely different capabilities; flattening them
  into one 'message an agent' verb produces a UI that lies."*
- v1 means **honest recognition, not new control**: a Codex session is identified and its
  capabilities are stated. Nothing new becomes steerable in this stage.

**Done looks like**: the fleet can say *this is a Codex job and you cannot type at it* as a typed
fact rather than a special case buried in `steer.ts`.

### Stage D — box-health history (`fleet-health-history`)

Owned elsewhere; the contract is [§ Where the health history lives](#where-the-health-history-lives-and-the-one-thing-owed-in-return)
above. **Swap is not part of the work**: `SwapReading` already gives `usedBytes`/`totalBytes`/fraction
and the per-file breakdown, `SwapActivityReading` already gives si/so and `activelySwapping`, and
`health-view.ts` already draws the card. Greg's bullet asks for *history*; the measurement exists.

### Stage E — dictation on every fleet input box (`w2-fleet-dictation`)

Greg's call when asked what a realtime dialog would be talking *to*:

> Let's do dictation first. The goal of realtime dialog would be to talk with whichever agent the
> input-message-text-box relates to, perhaps by feeding in a compacted summary of the conversation so
> far, and/or giving it the ability to use tool use to gather more information (e.g. by reading
> docs/code/etc, or anything else that might help it have an informed conversation) — if you feel
> unblocked enough to make progress on that, then add it as a stage and try and get it working.
> Borrow (or better still reuse) from Spideryarn.

**"Better still reuse" is a decision about a principle, and it is his to make.**
[§ Principles](../project/orchestrator-direction.md#principles) says the fleet tool must not depend on
anything under `src/`, *"If it ever earns its own repo, that should be a move, not a rewrite."* There
are ~3000 lines of hard-won client machinery there (`useDictation.ts` 1612, `mic-recording.ts` 461,
`DictationStrip.tsx` 502, `useAudioLevel.ts` 204, `mic-lock.ts` 110). **Copying that is worse than
depending on it**, so the rule becomes: import only **leaf, browser-only, product-agnostic** modules,
extract a coupling behind a parameter rather than importing the coupling, and **write the resulting
import list into this doc** — because that list is the cost of the move if the tool ever gets its own
repo.

**The server half is the real work, and the vocabulary is the point.** Dictation's second pass is not
a better ear, it is a vocabulary: measured 2026-08-27, every dedicated speech-to-text model mangled
this app's own words until one was *told what the words might be*. Ours are different and
better-defined than an article's — session names, worktree names, `gjd-remote`, `tmux`, `vitest`,
`Overseer`. **A fleet dashboard whose transcriber has never heard the word "worktree" will mangle
every message Greg dictates.**

**What cannot be verified from here, and must not be pretended:** there is no audio input device on
this box and Chrome's fake-mic flags do not work headless. The real `getUserMedia` path is Greg's to
test from his own device, and the report must say which half was checked. *"A valid session ticket is
not proof that a microphone opened, a response event is not proof that sound played."*

### Stage F — realtime dialog, gated on Stage E

**The conversation partner is not the agent itself**, and that misreading is the expensive one: an
agent in a tmux pane has turn latency in tens of seconds, and `steer.ts` already reports that a
delivered message can be `partial` — the text landed and the Enter did not. What Greg described is a
realtime model briefed *about* that session — a compacted summary plus tool use to read docs and code
— which he talks through, and which then hands the agent a message. Gated honestly: **an unfinished
Stage F on top of a shaky Stage E is worse than Stage E alone.**

## A5 is not a live exposure; it is a decision that happens at `systemctl enable`

Measured on the box, 2026-09-08, because Astra's finding said *"Tailscale's default policy is
permissive, so verify rather than assume"* and nobody had verified:

- The tailnet has **exactly two devices** — this box (`100.92.255.119`) and Greg's iPhone
  (`100.108.254.125`, offline). Both his.
- `tailscale serve status` and `tailscale funnel status` both report **"No serve config"**. Nothing is
  exposed to the public internet.
- **The running dashboard binds `127.0.0.1` only.** It is not tailnet-reachable today at all; Greg
  reaches it over an ssh forward.
- **The widening is not in the unit.** The repo's unit says `Environment=FLEET_BIND=127.0.0.1` and
  `tests/systemd-units.test.ts` asserts that exact string. It is `/etc/fleet-dashboard.env` — which
  exists, contains `FLEET_BIND=127.0.0.1,100.92.255.119`, and is read at start because
  `EnvironmentFile=` comes after `Environment=`.

So A5 describes an exposure that **does not exist yet and begins at the instant
`sudo systemctl enable --now fleet-dashboard.service` runs** — a step already waiting on Greg. That
reframes it from scheduled engineering into a precondition attached to a command, which is a much
cheaper place for it to live.

**Fable arbitrated and returned a fourth option: close it, and attach the rule to the widening.** The
full reasoning is now in
[orchestrator-direction.md § A5 is CLOSED too](../project/orchestrator-direction.md#the-backlog-after-the-wide-review)
— the short version is that A5 hardens a boundary against parties who do not exist while A7 leaves
open the one that does (all 27 agents share a Unix user and already reach `127.0.0.1:8787`), that
**Tailscale ACLs have no deny rule** so the "cheap" grant is really a whole-policy rewrite with
lockout as its failure mode, and that the genuine equivalent of the reference system's allowlist is
`tailscale serve` plus an owner check on `Tailscale-User-Login`, not an ACL. **No code work; one
precondition on one command; row closed.**

## The simpler option passed over

**Rendering the attention list straight from `needs-you` and shipping it today.** It would have been
an afternoon, it would have looked right, and it would have been wrong in the direction that matters:
it lists the agents that are *blocked*, and Fable's reframing is that a blocked agent is the cheapest
thing on the box —

> The agent that costs real money is the one that is **working, confidently, on the wrong thing**
> … It never asks. It never appears on a "needs you" list.
>
> — Fable, 2026-09-08

Stage A's prose-question detection is the smallest thing that does not inherit that error. The
misdirection half — plan-doc name, last commit, time since a push, whether the session is in the
primary checkout — is deliberately **not** in this wave; the proxies exist in what is already
collected, and building the question surface first is the boring half done honestly.

## Not in this wave

- **The scheduler.** Last by Greg's own ordering, and it should not be quietly promoted
  ([cron-scheduler.md](../project/cron-scheduler.md)).
- **Multiple Max accounts / rotation.** Medium-term by his call.
- **Push notifications.** *"Push almost nothing"* — two categories only, and neither is an agent
  waiting on a question. The inbox is a surface to open, not a thing that buzzes.
- **A22's event protocol, A21's unattended actions, A23's resource claims.** Deferred outright in the
  backlog and not reopened here.
