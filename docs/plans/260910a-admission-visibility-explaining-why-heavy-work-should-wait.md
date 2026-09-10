# Admission visibility: explaining why heavy work should wait

Up: [260908f-overseer-and-fleet-improvement-roadmap.md](260908f-overseer-and-fleet-improvement-roadmap.md)
§ *Stage: Admission visibility — reuse the gate already present*, which is the spec this plan
implements. Queue item `qi-5e9beszv`, dispatched by the Overseer on 2026-09-10.

**One sentence:** the box already refuses test runs it has no memory for, and nobody can see it
happen — so this puts the *same* decision, computed by the *same* code, on the Box health tab,
labelled honestly as a **forecast** rather than as an event, beside a record of the refusals that
really happened and a census of what is running.

**Acceptance, from the roadmap:** *an agent and Greg can find out why work should wait.*

**Not in this stage:** enforcement. The next roadmap stage ("Enforced launch admission") may build an
admission owner with atomic reservations; nothing here reserves, locks, queues or refuses anything
that was not already refused. Every sentence this feature puts on screen has to survive that
distinction being read strictly, which is most of what the design below is about.

**Two rounds of plan review refused this plan** — ten established P1s between them, and every single
one was the same defect: a true number under a label promising more than it could deliver. The
design below is what survived. The findings and their dispositions are at the end, and the largest
consequence is that a whole feature was **cut** rather than fixed (§6), because it kept generating
the defect faster than the fixes closed it.

---

## Background, for a reader who has not met any of this

Three things, in plain words.

**The box.** One Hetzner machine, 16 cores, ~31 GB of RAM plus swap, shared by a dozen or so agent
sessions each working in its own git worktree. Any of them may decide to run the test suite.

**What went wrong on 2026-09-08.** Eighteen test suites started within an hour. Peak memory of a
single suite is about 5 GB *before its first worker forks* — measured, and the measurement is the
whole point, because it means capping workers per run barely helps. The box reached load 391 with
swap 100% full and the kernel's OOM killer fired on postgres.

**The gate that came out of it.** [`vitest-admission.ts`](../../vitest-admission.ts) is evaluated
when a run's vitest config is evaluated, i.e. in the process that is about to run tests, before it
runs any. It reads `MemAvailable` from `/proc/meminfo`, subtracts a reserve the machine writes into
`~/.config/spideryarn/vitest-memory-reserve-gb`, subtracts the fixed 5 GB a run costs, divides what
is left by 0.198 GB per worker, and either admits (possibly with fewer workers than asked),
or refuses with a message that says `NO TESTS RAN AND NOTHING WAS VERIFIED`.

It is a **valve, not a bound** — its own header says so at length. Runs arriving one after another
each see less memory than the last and are cut down and then refused; runs arriving in the same
instant all read the same figure and all admit. Bounding a simultaneous cohort needs an atomic
claim, which is a scheduler, which is the next stage and not this one.

**What is missing.** The decision is invisible. It exists for a few milliseconds inside a process
that then either runs tests or dies printing a paragraph into one tmux pane. An agent whose suite
was refused sees the paragraph; nobody else ever does. Greg, looking at the dashboard and wondering
why the box is busy and work is not moving, has nothing to read. That is the gap.

---

## The three questions this feature answers

Deliberately phrased as questions a person actually asks, because the panel's headings are these:

1. **If a test run started right now, what would the gate say?** — a **forecast**, computed by
   calling the gate on a fresh memory reading, stamped with when it was computed.
2. **Was anything actually refused, and when?** — a journal, one appended line written by the two
   places that already decide, so the answer is a record rather than an inference.
3. **What is running that I would recognise?** — a census of live process roots, with a heading that
   claims exactly that and no more.

And running through all three: **nothing on this panel enforced anything**, and the panel says so in
those words rather than in a footnote.

A fourth question — *how much of the last day would the gate have refused?* — was designed twice and
cut. §6 says why, and keeps the design for whoever picks it up.

---

## Design

### 1. The forecast: call the gate, never restate it, never call it an enforcement

`tools/fleet/routes-admission.ts` imports `decideAdmission`, `readMemorySnapshot`,
`readReserveBytes`, `resolveParallelWorkers` and `ADMISSION_POLICY_VERSION` from
`../../vitest-admission.js`. That import direction is already precedented — `readiness-loop.ts` and
`readiness-parse.ts` both do it, and `tests/fleet-imports.test.ts` only polices imports into `src/`,
so a root-level, node-builtins-only module is fine.

**No threshold, ratio or byte figure is written down a second time**, in this repo or in the
browser. Everything numeric on the page arrives from the gate's own return value or its own message
string. This is the roadmap checkbox *"Do not independently reimplement thresholds in the browser"*.

**Five outcomes**, because the gate's union plus the two ways of failing to ask it do not collapse
into four without a lie:

| Outcome | When | Source |
|---|---|---|
| `would-admit` | `admit`, and `workers === nominalWorkers` | the gate |
| `would-reduce` | `admit`, and `workers < nominalWorkers` | the gate |
| `would-refuse` | `refuse` — either arm | the gate, message carried verbatim |
| `not-applicable` | no reserve file (machine never opted in), or not Linux | the gate |
| `unknown` | the gate could not be *asked* | this module |

**The names are `would-` prefixed on purpose.** The first version of this plan called them
`admitted` / `reduced` / `refused`, which are past-tense words for events, and nothing here is an
event: the panel is answering a hypothetical about a run that does not exist. The panel's invariant
sentence is fixed by the review and reads:

> **Gate forecast — this panel admitted or refused nothing.**

When the gate answered, the next sentence says *the forecast was computed at `<time>`* — not that
the memory was read then, because `computedAtMs` is stamped after the outcome exists. A test using
this repo's vitest config asks again when it starts, and only that run's own in-process refusal stops
it. The gate's refusal text is carried as `forecastCallMessage` with
`messageContext: "dashboard-forecast-call"`, because it uses real-run grammar and names the
dashboard's pid. A renderer must introduce it as raw output from this forecast call, not as an event
or as the message a hypothetical test process would have produced.

The worker-count caveat belongs only to `would-admit` and `would-reduce`: *A reduced worker count is
the config default; `--maxWorkers` on the command line overrides it.* Putting it on
`not-applicable`, `unknown` or `not-modelled` would turn a qualification of a worker number into a
non-sequitur under an answer that carries no worker number.

That clause is not a nicety where a worker forecast exists. `vitest.config.ts`'s own comment says
the number it logs *"is what the CONFIG asked for, and is deliberately not called the resolved
one"*, because `--maxWorkers` beats it and that escape hatch is preserved on purpose. A dashboard
that presented `would-reduce` as a settled worker count would contradict the config it is
describing.

**Where the nominal ask comes from, and the env var this must not eat.** `resolveParallelWorkers()`
reads `VITEST_MAX_WORKERS` **and deletes it** — deliberately, because vitest reads it later and
would de-serialise the private-postgres lane. Calling it inside the dashboard would therefore (a)
consume the dashboard's own environment, so a second GET could answer differently from the first,
and (b) answer with the *dashboard's* environment, which has nothing to do with the shell a future
test run will start in. So the forecast deletes the variable from its own copy before asking and
restores it afterwards, and reports **the machine's default ask** — the worker file, or half the
cores — saying so in those words. `scripts/readiness-loop.ts`'s `nominalWorkers()` already
save-and-restores for the same reason and is the precedent to cite.

**`would-reduce` is a 200 MB-wide band on this box.** Measured 2026-09-10: reserve 4 GB, worker file
2, so capacity is `floor((MemAvailable − 4 GB − 5 GB) ÷ 0.198 GB)` against a nominal ask of 2. At
20.2 GB available, capacity is 56 and the answer is `would-admit`; the answer is `would-reduce` only
while capacity is exactly 1, i.e. while `MemAvailable` sits between about 9.20 and 9.40 GB, and
below that it is `would-refuse`. It must still be built and tested — a worker file of 8 on a laptop
makes it the common case — but nobody should read its absence here as evidence of anything.

**The trap in the naming.** A missing or unreadable `/proc/meminfo` on an opted-in Linux box is
`would-refuse`, **not** `unknown`. That is the gate's own deliberate choice — *"a check that quietly
switches itself off when its input goes missing protects nothing, and looks exactly like a check that
ran"* — and the value of this panel is that it repeats the gate rather than second-guessing it.
It is safe to say here precisely because the outcome is now named as a forecast: *the gate would
refuse a run on this reading* is true, and no reader can take it for a run that was refused.

`unknown` is a real state and not a tidy-up: `readReserveBytes` **throws** on a file that exists and
is empty, unreadable or not a positive number, and `resolveParallelWorkers` throws on a bad worker
count file. A thrown exception inside a dashboard route must not become a blank card, and must not
become "everything is fine" either.

### 2. Policy revision: a version-indexed explanation that fails closed

The gate carries `ADMISSION_POLICY_VERSION`, *"bump when the arithmetic changes, so a log line can
be traced to a rule"*. The first draft of this plan proposed a second literal to compare against it,
and the review's answer to that is better and is taken: **a map from policy version to the prose that
describes it**, which fails closed on a version it has never heard of.

```ts
const EXPLANATIONS: Record<number, PolicyExplanation> = { 1: { …how v1 decides… } };
```

An unrecognised `ADMISSION_POLICY_VERSION` yields no prose at all and a payload that says *this
dashboard has no explanation for admission policy vN; policy wording is withheld*. Any numbers the
gate returned stay because they come from the gate; the narration goes, because narration is the
thing that would be wrong. Saying only "any numbers" matters: if a reader threw before the gate
could be asked, an `unknown` outcome has none to call live. Nobody has to remember to increment
anything, and nobody can clear the warning by making two numbers equal without reading either.

### 3. Forecast, observed, not-modelled — three labels and no fourth

The roadmap asks for *"a clear statement of whether a signal is an enforced admission decision or an
advisory resource claim. A claim file is not a lock."*

Established while reading the tree, and worth stating plainly because it is the load-bearing fact of
this whole stage: **there is no resource-admission claim file in this repo today, and no admission
lock.** (There are plenty of other locks — the health-history writer's, the readiness runner's, the
scheduler's occurrence reservations. None of them is about resources, and an earlier draft of this
sentence said "no lock" flatly and was simply false.) Nothing reserves capacity, nothing waits on
anything, and **the only resource gate that stops an ordinary vitest launch** is
`vitest-admission.ts`, inside the very process it stops. So every block on the panel
carries one of exactly three labels, and **the word "enforced" is never one of them** — it appears
only inside a sentence describing where enforcement actually happens:

- **`forecast`** — the gate's answer for a hypothetical run, on a reading taken at a stated instant.
  It stopped nothing. Enforcement exists, but it is elsewhere: inside a vitest process evaluating
  this repo's config, refusing itself.
- **`observed`** — a reading of what is running. It stopped nothing and reserved nothing.
- **`not-modelled`** — we have no cost model for this, so there is no answer to give (see §5).

### 4. Recognised live process roots — and the three words that are not in its heading

The first draft reused `health.ts`'s `ps` grouping; round 1 was right that this cannot meet the
roadmap checkbox, since it groups *processes* by a keyword anywhere in argv. Round 2 was right about
the replacement, twice over, and both corrections are about the **label** rather than the data:

- **It is not "heavy", and it is not "active".** A live Chrome root may be idle, or deliberately
  parked for reconnection — `actions.ts` documents that case. Presence establishes presence. Making
  it a claim about load would need per-root resource evidence this stage is not gathering.
- **It is not "reviews".** `codex` is how this very plan is being implemented; `codex exec` is a
  generic batch job, and the tree's own vocabulary already calls it `codex-batch`. A stage-1
  implementation run appearing on screen as *a review in progress* is a small lie told confidently.

So the block is headed **"Recognised live process roots"**, its subtitle names the finite list of
things it can recognise — vitest runners, Codex batch jobs, browsers — and it says outright that
anything it does not recognise is not counted at all. `AdmissionRequest.kind` keeps `"review"` as
the **caller's declared intent**, which is a different thing from an intent inferred from an
executable, and §5 keeps them apart.

**The recognisers are reused, not rewritten**, and this is the single most valuable thing round 2
produced. `tools/fleet/actions.ts` already has them, already takes a `ProcRecord`, and already
carries the scars: `isVitestRunner` matches on an **executable path** and its header explains that
matching the string "vitest" catches an agent who is merely editing `vitest.config.ts`; the browser
rule matches `comm` exactly, because a substring match once *"counted 162 'chrome' processes that
were mostly MCP servers whose arguments mentioned chrome"*. My own naive fold reproduced exactly
that error — 33 "browser" roots on a box that had a handful — so the census imports `ProcRecord`,
`isVitestRunner` and the browser rule rather than growing a second, worse copy. Only `codex-batch`
needs a new recogniser, written to the same rule: an executable path, never a substring.

**Identity, because two reads of `/proc` are not one observation.** Reading `cmdline` and then
`stat` for a pid can staple an old parent relation onto a reused pid's new argv, describing a
process that never existed — `execution-identity.ts` uses start ticks and before/after bracketing
for precisely this. So the census keeps `startTicks` per row, brackets its walk, and classifies
anything that changed under the read as **uncertain** rather than guessing.

Then the fold: a process whose ancestor carries the same class is not a root, and a Chrome helper
(`--type=` in argv) is never a root. Every count is accompanied by an **uncertain** count and an
**unreadable** count — a process that vanished mid-walk is unreadable, not absent.

**Measured on this box, 2026-09-10**, over 425 processes: **37.7 ms median, 56.0 ms worst**. That
cannot go on the request path — the dashboard is one Node process the Overseer has no alternative
to, and 56 ms of blocked event loop per tab open is over the ceiling `fleet-dashboard-modes.md`
sets. It goes on the timer in §7.

### 5. The typed admission request

A type, plus a route that answers one. Types in `wire.ts` (types only — appended at the end,
re-reading the file first, since other sessions are live in it):

```ts
export type AdmissionKind = "test" | "review" | "browser";

/** DECLARED by the requester, not measured. Nothing verifies it, and today nothing uses it. */
export type AdmissionCostClass = "light" | "moderate" | "heavy";

export type AdmissionRequest = {
  kind: AdmissionKind;
  cost: AdmissionCostClass | null;
  /**
   * Who would do the work. `ExecutionToken` and not a bare pid: a pid is
   * reusable, and this repo already has boot id + start ticks for exactly that
   * reason (wire.ts § ExecutionToken).
   */
  owner: ExecutionToken | null;
  /** The CALLER's clock. Diagnostic only — never sorted on. See below. */
  requestedAtClientMs: number | null;
};
```

`GET /api/admission?kind=…` builds one and answers it; the default is `kind=test`, the case the gate
actually governs.

**`cost` is on the type and is not accepted by the endpoint.** `?cost=light` and `?cost=heavy`
would produce identical answers — the same fixed vitest model for `kind=test`, the same
`not-modelled` for everything else — and a query parameter that looks semantically active while
changing nothing is API surface that teaches the wrong thing. The HTTP route therefore returns
`cost: null`: the field is the requester's declaration, and this caller supplied none. It stays on
`AdmissionRequest` for the next admission owner, where a real requester can declare one.

- **`kind=test`** → the gate's forecast, per §1.
- **`kind=review` / `kind=browser`** → **`not-modelled`**, and nothing else. The first draft ran
  these through `decideAdmission` and labelled the answer advisory; the review's F2 is right that
  "advisory" says nobody enforces the answer and does not make the answer *relevant*. A codex review
  and a headless Chrome do not cost 5 GB plus 0.198 GB per vitest worker, and passing them through
  that arithmetic would give a small review and a large browser job the same advice off a test
  suite's cost. So the categories exist as types, the route accepts them, and it answers: *no
  measured cost model or launch gate exists for this kind.*

**`requestedAtClientMs` is diagnostic and is never ordered on.** A browser clock drifts —
`routes-health-history.ts` stamps its window with the server's clock for exactly this reason — so
any future queue position must be stamped `receivedAtMs` by whatever owns admission, not by the
caller. Recorded here so the next stage inherits the rule rather than the field.

### 6. The refusal record — what this stage builds, and the replay it cut

**Correction to the first draft, and it was the sharpest finding of round 1.** That draft asserted
that no admission refusal is durably recorded anywhere on this box. That is false, and the review
produced the counter-example: `logs/tmux-jobs/grfd-check3-0934-2389191.log` line 80 holds a real
refusal, in full, with its numbers — `MemAvailable 8.39 GB, and swap 12.29 GB of 32.00 GB used`. It
is there because `scripts/tmux-job.ts` opens its log before running the command precisely so output
survives the pane. Refusals also survive in agent transcripts. **The accurate statement is:**

> No complete, centralized admission-refusal journal exists. Some refusals survive incidentally in
> tmux-job logs and agent transcripts, but those sources are incomplete and are not a stable fleet
> API.

**A scan of those traces was considered and rejected, on a measurement.** The newest 40 log tails
(32 KiB each) cost 4.3 ms median / 23.7 ms worst; all 136 across every worktree cost 10.5 ms median
/ 61.8 ms worst. Affordable. What kills it is not cost but honesty: the refusal in that log is at
**line 80 of an 800 KB file**, because the refused step was one of several in an `npm run check`, so
neither a head scan nor a tail scan reliably finds it, and the primary's logs alone are 55 MB. A
scanner that sometimes misses reports *no recent refusals* in the same words as one that looked
properly — a silence that reads as a finding, which is
[silent-success.md](../reusable/silent-success.md)'s subject.

**The Overseer authorised the cheap fix instead, on 2026-09-10:**

> take the cheap fix, one appended line per refusal from the two places that already compute one,
> written to a small dedicated file the panel reads, not a scan of tmux-job logs; that widening of
> your file set is authorised, name the two files in your plan and keep each edit to the append.

**So the roadmap checkbox *"Show active heavy tests/reviews/browser jobs and the last refusal"* is
met by the journal**, not by an inference and not by a scan: §6b. It is the only part of this
feature that reads a record of something that actually happened, and it is the reason the replay
below could be cut without leaving the checkbox open.

#### The would-refuse replay, cut from this stage

Both drafts also proposed replaying `decideAdmission` over the 24 hours of health history the
dashboard already keeps, to say how much of the day the gate *would* have refused. **It is cut**,
and this section records why, because the reasoning is worth more than the feature.

It generated four findings across two review rounds and every one of them was the same shape: a
second, independent interpretation of somebody else's recorded data, drifting from the first.

- The stored record is deliberately loose (`Record<string, unknown>`, crossing version boundaries)
  and has `collector-failed`, `sample-omitted` and `memory: unknown` arms, so a replay needs its
  own three-class union — and must never map a failed `free` onto the gate's `broken` snapshot,
  which would manufacture a refusal out of a collector fault.
- Counts alone erase unobserved time. Round 2's scenario is exact and damning: one hour of samples
  followed by twenty-three hours of nothing renders as *"60 readable, 0 refused"* under a heading
  that says *the last day*. Fixing it needs coverage, and `history-series.ts` already owns the span
  algebra for coverage — so a second one on the same screen could disagree with the chart above it.
- A cache's own `computedAtMs` is not the freshness of what it read. A scan a second old, over a
  file whose newest sample is ten hours old, reports as current. The history UI already carries
  `lastAttemptAt`, `lastSuccessAt`, failure, poisoning and lock state to stop exactly that.
- And the tab that would show it already triggers its own history scan, so the panel would cause two
  reads of the same file per open.

Every one of those is fixable. Together they are a second, careful reader of a store owned by
someone else, needing coverage algebra extracted from a file another session owns — and it answers a
softer question than the journal does. *A run asked and was told no, at 04:12* is what an agent
needs; *37% of yesterday would have refused* is a nice-to-have. **Simplest version first**: the
journal ships, the replay is written down here with its constraints intact so whoever builds it
starts from round 2's findings rather than rediscovering them.

**One measurement worth keeping from the cut work**, because the next attempt will need it. The gate
reads `MemAvailable` from `/proc/meminfo`; `health.ts` reads the sixth column of `free -b`'s `Mem:`
row. Sampled a few milliseconds apart on 2026-09-10: `free` said 20,207,513,600 bytes and
`/proc/meminfo` said 20,206,481,408 — 0.005% apart, the number moving between two reads rather than
two different numbers. **They are the same kernel figure, so a replay is legitimate arithmetic.**
Swap is not the same measurement and does not need to be: the gate uses swap only in the *text* of
its refusal message, never in the arithmetic that decides.
### 6b. The refusal journal — one appended line, from the places that already decide

**One new leaf module, three one-line writer edits, and a reader.** The module is
`admission-journal.ts`, at the repo root beside the gate, with **no imports but node builtins** — the
same discipline `overseer-claim.ts` and `attempt-clock.ts` keep, and here it is forced: one of its
callers is `vitest.config.ts`, evaluated at the start of every test run in this repo, and a config
that imported `tools/fleet/` would drag the dashboard into every suite's startup.

**Where the appends go, named as the Overseer asked.**

| File | The edit |
|---|---|
| `vitest.config.ts` | in `workersForThisRun()`, one call before the existing `throw` on `decision.kind === "refuse"` |
| `scripts/readiness-loop.ts` | one call at the existing consumer of `decideTick`, when the skip's cause is memory admission |
| `tools/fleet/readiness-loop.ts` | **the third file, and it is why the second is possible**: `TickDecision`'s skip arm carries only `why`, so a consumer can tell an admission refusal from the other twelve skips only by matching the sentence. One optional `cause` discriminator on that arm, set at the admission branch, no behaviour change |

That third file is a readiness file and outside the original file set. It is named here rather than
slipped in: without it the second writer is a string match on prose, which is the kind of check that
goes quietly wrong when somebody rewords a sentence. **The Overseer authorised it on 2026-09-10** —
no behaviour change — and noted that the readiness loop picks up `dev` on its own tick, so the new
writer starts working without anybody restarting it. **If GPT Sol objects to the third file at
review, the readiness writer drops and only `vitest.config.ts` writes**, and the panel then says the
journal sees test runs only, which is still the answer an agent needs.

**The first rule of this writer is that it may not break what it observes.** A refusal is already a
bad moment; a journal that threw would turn "your test run was refused" into "your test run crashed
in the config". So every append is wrapped, failures are swallowed, and the panel says the journal
is best-effort. It is a record of refusals, not a proof of their absence.

**~~Concurrency is solved by staying under `PIPE_BUF`.~~ That was false, and the correction is the
most important thing in this section.** This plan claimed that an `appendFileSync` of under 4 KiB
with `O_APPEND` is atomic on Linux and called it "the whole locking story". **`PIPE_BUF` atomicity is
a guarantee about pipes and FIFOs, not regular files.** `O_APPEND` makes the *offset update* atomic,
so concurrent appenders do not overwrite each other — but it says nothing about all-or-nothing
*failure*, and a write that fails partway leaves a fragment.

GPT Sol found it in the Stage 3 review and I reproduced it directly, which is the only reason it is
stated this firmly: capping a file with `RLIMIT_FSIZE` and appending a 217-byte line gave `EFBIG`,
**60 bytes of a JSON object left on disk, and one unparseable line** — and the next successful append
then joined that fragment, so the reader lost *both* records as one bad line. Disk full mid-line is
the realistic version, and it is a state a journal about resource exhaustion should expect to meet.

So the append-only JSONL shape is abandoned for **one file per record**: serialise, write to a
temporary name in the same directory, then `rename` into place. A rename within a directory is
atomic, so a reader sees a whole record or no record and never a fragment; there is no shared file to
interleave in, so there is no rotation race either (the second defect the review found, where two
consecutive rotations lost an append that had returned success). Pruning becomes deleting the oldest
files, which cannot lose a concurrent write.

The line stays small and fixed for the reasons that survive the redesign:
`at`, `source` (`test-run` | `readiness-precheck`), `policyVersion`, `availableBytes`,
`reserveBytes`, swap totals, `pid`, and the host. **Not the gate's message** — it is reconstructible
from those numbers, and an unbounded string is how a bounded file stops being bounded.

**~~Appenders never rotate; the reader prunes.~~ Also wrong, and found by the same review.** The
two-file scheme borrowed from `health-history.ts` said a rename cannot lose an append, because the
appender either wrote into the old inode — still read as `.prev` — or into the new file. That holds
for *one* rotation. It does not hold for **two**: Sol paused a real writer after it had opened the
live file and before it wrote, rotated twice, and released it. The writer returned success having
written into an inode the second rotation had already unlinked, and the reader never saw the entry.
A record that reports success and then does not exist is worse than no journal.

**One file per record removes both defects rather than patching them**, and it removes the machinery
too: no shared file, so no interleaving and no rotation; `rename` is atomic, so a reader sees a whole
record or nothing; pruning is unlinking the oldest files, which cannot race a writer that is creating
a new one. `health-history.ts`'s scheme is right *for `health-history.ts`*, which has a single-writer
lock — that was the borrowed idea's unstated premise, and this journal deliberately has many writers
and none.

**What the journal cannot see, on the panel, in its own words:** refusals from test runs using this
repo's vitest config on this machine, and from the readiness loop. Not a run on another machine, not
a run that bypassed the config, and not an append that failed. Empty means *nothing was recorded*,
which is a weaker claim than *nothing was refused*, and the panel makes the weaker one.

### 7. Everything expensive happens on a timer, and the route serves a cache

The first draft put a history scan in the request handler and claimed it was "well under" 7 ms. The
review measured it: **18.85 ms median, 26.65 ms worst** on the current 1.8 MiB store — and opening
Box health *already* triggers the existing history request, so the tab would have caused two scans
of the same file. Cutting the replay (§6) removes that read entirely, which is one of the reasons
the cut was worth making rather than merely acceptable.

What is left needing a cadence is the census, at **37.7 ms median, 56.0 ms worst**. That is still
far too much for a handler — the dashboard is one Node process the Overseer has no alternative to.
So:

**`admission-wiring.ts` owns a repeating task**, and it is **end-chained, never a fixed interval**:
it waits the cadence *after* each pass finishes, which is the non-overlap rule `server.ts` already
follows for its own refresh loop. A fixed interval on a box under load queues passes on top of each
other, which is how a 56 ms cost becomes a stall.

**The forecast is not cached.** One `/proc/meminfo` read and some arithmetic, sub-millisecond, per
request — because it is the one answer that must be current, and caching it would put a stale
verdict under a live-sounding sentence.

**The cache is a state, not a value, and every producer gets its own.** Round 2's F12 is the rule
here: modelling an unreadable *process* while not modelling a failure to enumerate `/proc` at all
leaves the exact hole the dashboard's own standing rule forbids — *a reading that could not be taken
must not render as a reading*. So each cached producer is a discriminated union:

| State | Meaning |
|---|---|
| `not-yet-computed` | the dashboard started less than one cadence ago. Not an empty result |
| `value` | a completed pass, with the instant it completed |
| `failed` | a pass that threw, with its cause — **and the last good value, explicitly marked stale, if there is one** |

Each producer is caught separately, so one half failing never blanks the other, and **the repeating
task never throws out into the server**. Startup, a top-level `/proc` failure, and a one-half-only
failure are all tested rather than reasoned about.

### 8. Where it appears

**A section on the Box health tab, not a new tab** — the product default the Overseer recorded for
Greg. It belongs there: the same card already carries the memory reading the gate consumes. Recorded
as Greg's to overturn; if he wants a tab, `fleet-dashboard-modes.md` is six edits in three files and
this section moves whole.

Client shape follows the `HealthHistory` precedent, which is already an on-demand fetcher living
inside `HealthPanel`: a typed client with an injectable `AdmissionApi` seam and a parser
(`admission-client.ts`), a section (`AdmissionSection.tsx`), mounted in `HealthPanel.tsx` with the
api defaulted there and injectable from `App.tsx`.

**Three kinds of nothing, kept apart**: *the machine has no admission policy* (`not-applicable`),
*the server could not ask its own gate* (`unknown`), and *this browser never got an answer* — a
client-side arm, in the browser's voice, never in the server's.

**The panel already has rules, set by the Box health rework that landed at `6e8e28e3` and is already
in this worktree's base.** Session `spideryarn2-8d`, which wrote it, handed them over on 2026-09-10
and a reviewer will hold this section to them:

- **Nothing may be drawn that a reader could take for a healthy zero.** `health-view.ts` now refuses
  to build a progress bar at all when there is no number behind it. So a forecast that is
  unavailable is a *sentence*, never an empty or zeroed shape.
- **The order inside the history card is now** record prose → four charts → verdict strip and its
  time axis → legend. The strip moved from top to bottom at Greg's request; a section placed near
  `HealthHistory` should read as part of that order rather than interrupting it.

**And the merge hazard here is duplication, not conflict.** That session's edits to `HealthPanel.tsx`
(a `StatBar` import, a line in `StatTile`, a `Bar` component at the end) are in different parts of
the file from this section's (a mount line beside `<HealthHistory …/>` and one optional prop), so a
merge will not raise a marker — which is precisely the shape that can silently duplicate or drop a
block instead. After every `origin/dev` merge: grep `HealthPanel.tsx` for `function Bar(` and for
this section's own component and check each appears **exactly once**, and run
`npx vitest run tests/fleet-web.test.tsx`, which now pins the bars and the tile copy.

---

## What this deliberately does not do

- **It reserves nothing and refuses nothing new.** Reading the panel changes no behaviour anywhere.
  The journal in §6b is the one thing this stage adds to a path outside the dashboard, and it only
  writes a line where a refusal was already being thrown.
- **It scores nothing but test runs** — §5.
- **It does not touch `collect.ts` or the refresh path.** No new per-session or per-pane work.
- **It classifies conservatively and under-reports** rather than over-reporting heavy work — §4.

---

## Stages

Implementation is delegated to GPT Sol via
[codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md), per the dispatch brief; this
session writes the prompts, runs the gates, reviews, and commits.

### Stage 1 — the forecast and the wire

- [x] `wire.ts` types (§1, §2, §5). Types only, appended, file re-read first.
- [x] `tools/fleet/routes-admission.ts`: `parseAdmissionRequest`, `explainAdmission` (pure over
      values a test hands in), the version-indexed explanation map, and the handler.
- [x] `tools/fleet/admission-wiring.ts`: the composition, so a test drives the same function
      `server.ts` calls — the lesson `health-wiring.ts` exists to record.
- [x] `server.ts`: the mount, beside the health retention route.
- [x] Tests, red first: low memory → `would-refuse` carrying the gate's own message; unreadable
      `/proc/meminfo` → `would-refuse`, not `unknown`; no reserve file → `not-applicable`; empty or
      garbage reserve file → `unknown` with the thrown message; capacity below nominal →
      `would-reduce`; an unrecognised policy version withholds the prose and keeps the numbers;
      `kind=review|browser` → `not-modelled` with no `decideAdmission` call; `VITEST_MAX_WORKERS` is
      restored after a forecast and two successive forecasts agree; `parseAdmissionRequest` on junk;
      exact path match; the 500 arm; a comment-stripped source guard on the `server.ts` mount,
      checked red by commenting the mount out; and a wiring test that would go red if the server
      built its own deps instead.

**Status:** complete. Implemented in `e4a38579`; corrected by the Stage 1 code review on 2026-09-10.

### Stage 2 — the client section, showing the forecast

Deliberately second rather than last: **the visibility is the deliverable**, so the earliest stage
that puts something true on screen comes before the stages that enrich it. If this plan has to stop
early, it should stop with a working panel that answers one question rather than three unrendered
payloads.

- [ ] `admission-client.ts` (seam + parser + the three nothings), `AdmissionSection.tsx`, mounted in
      `HealthPanel.tsx`, injectable from `App.tsx`.
- [ ] Tests: opening Box health issues the request; each of the five outcomes renders its own
      sentence; the forecast's disclaimer sentence is present verbatim; a browser that never got an
      answer says so in its own voice, not the server's.
- [ ] The real page at 390 × 844 and at desktop width, on its own port, never `:8787`.

**Status:** not started.

### Stage 3 — the refusal journal

- [ ] `admission-journal.ts` — append (bounded, atomic, swallowing), read, and prune. Node builtins
      only; nothing may import `tools/` or `src/` from it.
- [ ] The three writer edits named in §6b, each one line at a point that already decides.
- [ ] The reader on the dashboard's timer, and the block on the panel.
- [ ] Tests, red first: two processes appending concurrently lose nothing; a line is refused rather
      than truncated if it would exceed the cap; an append that throws does not propagate, and the
      refusal still reaches the caller unchanged; a prune mid-append loses no line; **an empty
      journal renders as "nothing was recorded", never as "nothing was refused"**; and a source
      guard, comment-stripped, on the `vitest.config.ts` call — checked red by commenting it out.

**Status:** not started. **Authorised by the Overseer on 2026-09-10**, widening the file set; §6b
names the third file and says what to drop if that widening is one file too far.

### Stage 4 — the census, on the end-chained task

- [ ] The census (§4), pure over a list of `ProcRecord`-shaped rows a test supplies, reusing
      `actions.ts`'s `isVitestRunner` and browser rule rather than growing new regexes; a new
      `codex-batch` recogniser on an executable path.
- [ ] The end-chained task and the three-state cache (§7).
- [ ] Tests: a Chrome helper is not a root; a vitest **worker** is not a root; an agent merely
      editing `vitest.config.ts` is not a runner and an MCP server mentioning chrome is not a
      browser (both are recorded failures in `actions.ts`, so both get a test here); a row that
      changed under the read is `uncertain`, not guessed; a vanished pid is `unreadable`, not
      absent; `/proc` unenumerable is a **failed** cache state with its cause, not an empty census;
      the task never throws into the server; and `not-yet-computed` renders as itself.

**Status:** not started.

---

## The simpler option this passed over

**Printing the gate's decision into the dashboard's startup log and stopping there.** Perhaps twenty
lines: `server.ts` already logs several sentences at boot.

It fails the acceptance sentence in both halves. An agent cannot read the dashboard's stdout, and
Greg reads the page on his phone, not a tmux pane. And a decision computed once at boot is wrong
within minutes on a box whose available memory is the thing that moves. The panel exists because the
answer changes.

---

## Review dispositions — round 1

Full review: [260910a-admission-visibility-plan-review-sol.md](260910a-admission-visibility-plan-review-sol.md).
Verdict **REFUSE as written**, F1–F5 established P1s, F6–F7 P2s. Every finding was checked against
the tree before being taken; two were verified by hand because the design turned on them.

| ID | Finding | Disposition |
|---|---|---|
| F1 | The panel labels a forecast as enforcement; `reduced` is only a config default that `--maxWorkers` overrides; `resolveParallelWorkers` eats `VITEST_MAX_WORKERS` so two GETs could disagree | **Taken in full.** Verified at `vitest.config.ts:88-101` — the config's own comment says the number "is deliberately not called the resolved one". Outcomes renamed `would-*`, the disclaimer sentence adopted close to verbatim, the env var saved and restored, the nominal ask relabelled as the machine default. §1, §3 |
| F2 | Review/browser requests were being scored with vitest's cost model, which is irrelevant to them | **Taken in full.** Non-test kinds answer `not-modelled` and `decideAdmission` is not called for them. §5 |
| F3 | The reused `ps` grouping does not satisfy "show active heavy jobs" — it counts processes by a keyword, cannot see a codex review, and calls anything Chrome-flavoured a browser | **Taken, first branch.** A conservative job-root census in this stage's own module, with explicit uncertain and unreadable arms. Measured at 37.7 ms median, and the naive fold's 33 browser "roots" is written into the plan as the failure to design against. §4 |
| F4 | The replay is not exact for every stored sample; a failed `free` must not become the gate's `broken` snapshot | **Taken in full**, including the three-class union and the wording. Coverage handled by reporting counts rather than a percentage, so the second calculation the finding warned about never exists. §6 |
| F5 | "No refusal is durably recorded" is false — one survives at `grfd-check3…log:80` | **Taken.** Verified by reading that log. Premise corrected to "no complete, centralized journal"; the output renamed *Would-refuse history*; the roadmap's "last refusal" recorded **unmet and deferred**. A trace scanner was measured and rejected on honesty rather than cost. §6 |
| F6 | The cost claim is disproved: 18.85 ms median / 26.65 ms worst, and the tab causes two scans | **Taken.** Everything expensive moves off the request path onto a timer; the route serves a cache with its age on screen. Synthetic worst case to be measured in Stage 2. §7 |
| F7 | The request shape discards `ExecutionToken` and uses a caller clock where the repo uses the server's | **Taken in full.** `owner: ExecutionToken \| null`, and `requestedAtClientMs` diagnostic only with the `receivedAtMs` rule recorded for the next stage. §5 |

The review's answer to suspicion 4 — prefer a version-indexed explanation map that fails closed over
two numbers somebody must remember to increment — was also taken, and is §2.

## Review dispositions — round 2

Full review: [260910a-admission-visibility-plan-review-sol-r2.md](260910a-admission-visibility-plan-review-sol-r2.md).
Verdict **REFUSE as written**, F8–F12 established P1s, F13–F15 P2s, F16 P3. Round 1's F1, F2, F5 and
F7 were confirmed closed; F3 and F4 were not, and are closed here.

**Round 2 reviewed the plan before the Overseer authorised the refusal journal**, so its answer to
my second suspicion — that deferring "last refusal" was correct because no complete source exists —
is superseded by §6b, which builds the source rather than looking for one. Its reasoning stands and
is the argument *for* the journal.

| ID | Finding | Disposition |
|---|---|---|
| F8 | `review` is a false census label — `codex exec` is a generic batch job, and this plan's own implementation runs would appear on screen as reviews | **Taken in full.** The observed class is `codex-batch`; `AdmissionRequest.kind = "review"` survives only as the caller's *declared* intent, never inferred from an executable. §4, §5 |
| F9 | Process presence does not establish *active heavy work* — a Chrome root may be parked and idle, and unrecognised heavy processes are omitted rather than counted uncertain | **Taken in full.** The heading is now "Recognised live process roots", the recogniser scope is stated on the page, and no claim of heaviness or activity is made. This closes F3. §4 |
| F10 | Counts erase unobserved time: one hour of samples then 23 hours of nothing reads as "60 readable, 0 refused" under a *last day* heading | **Taken by cutting the feature.** The scenario is exact and I could not close it without a second coverage calculation beside `history-series.ts`'s. §6 |
| F11 | `computedAtMs` is not history freshness — a fresh scan of a ten-hour-stale file reports as current | **Taken by cutting the feature**, and recorded in §6 as a constraint on whoever rebuilds it. The surviving cache states carry the instant a pass *completed*, which for a `/proc` census is genuinely the observation time |
| F12 | The cache has no top-level failure lifecycle: no `/proc`-unenumerable, no store-unreadable, no before-first-pass, no one-half-failed | **Taken in full.** Three-state discriminated cache per producer, caught separately, task never throws into the server, and each state is tested. §7 |
| F13 | The timer relocates blocking rather than removing it, and the open tab still causes two history scans | **Taken.** Cutting the replay removes the history scan altogether, so only the census has a cadence; and it is end-chained per `server.ts`'s existing non-overlap rule rather than a fixed interval. §7 |
| F14 | The census omits the identity and race rules its data source requires — a `cmdline` read and a `stat` read can staple an old parent onto a reused pid | **Taken in full**, and it produced the best change in this round: the recognisers are now *reused* from `actions.ts`, which already matches on executable paths because a substring match once counted 162 "chrome" processes that were MCP servers. Start ticks retained; changed-under-read is `uncertain`. §4 |
| F15 | The GET accepts a `cost` that cannot affect its answer | **Taken in full.** `cost` stays on the type and leaves the endpoint. §5 |
| F16 | "No claim file anywhere and no lock" and "the only thing that stops work starting" are literally false — the tree has writer locks, readiness locks and scheduler reservations | **Taken in full.** Narrowed to "no resource-admission claim file or admission lock" and "the only resource gate that stops an ordinary vitest launch". §3 |

**The largest disposition is a deletion**, and it is worth naming as a pattern rather than an
outcome. The would-refuse replay drew F4 in round 1 and F10, F11 and F13 in round 2. Every fix was
available and every fix was real; what the second round made clear is that they were a *series* —
each one closing the resolution at which the previous answer was wrong, because the feature was a
second reader of somebody else's store and that is a class of defect, not an instance of one. The
plan review's own guidance is to bound the question rather than keep answering it, and the way to
bound this one was to stop building it. What ships instead — a journal written by the two processes
that already decide — answers the sharper question with no interpretation at all.
