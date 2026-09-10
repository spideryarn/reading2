# Admission visibility: explaining why heavy work should wait

Up: [260908f-overseer-and-fleet-improvement-roadmap.md](260908f-overseer-and-fleet-improvement-roadmap.md)
§ *Stage: Admission visibility — reuse the gate already present*, which is the spec this plan
implements. Queue item `qi-5e9beszv`, dispatched by the Overseer on 2026-09-10.

**One sentence:** the box already refuses test runs it has no memory for, and nobody can see it
happen — so this puts the *same* decision, computed by the *same* code, on the Box health tab,
labelled honestly as a **forecast** rather than as an event, and beside it a census of the heavy work
already running.

**Acceptance, from the roadmap:** *an agent and Greg can find out why work should wait.*

**Not in this stage:** enforcement. The next roadmap stage ("Enforced launch admission") may build an
admission owner with atomic reservations; nothing here reserves, locks, queues or refuses anything
that was not already refused. Every sentence this feature puts on screen has to survive that
distinction being read strictly, which is most of what the design below is about.

**Round 1 of the plan review refused this plan** — five established P1s, all of them variants of the
same defect: a true number under a label that promised more than it could deliver. The design below
is the corrected one; the findings and their dispositions are at the end, including the roadmap
checkbox this stage deliberately leaves unmet.

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
2. **What heavy work is already running?** — a census of *job roots*, classified conservatively,
   with everything it is not sure about counted separately and out loud.
3. **How often would the gate have refused, over the last day?** — the gate replayed over the health
   history the dashboard already keeps, so *why did work wait an hour ago* has an answer.

And running through all three: **nothing on this panel enforced anything**, and the panel says so in
those words rather than in a footnote.

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
event: the panel is answering a hypothetical about a run that does not exist. The panel's sentence
is fixed by the review and reads:

> **Gate forecast — this panel admitted or refused nothing.** For the memory reading taken at
> `<time>`, the gate returned `<outcome>`. A test using this repo's vitest config asks again when it
> starts, and only that run's own in-process refusal stops it. A reduced worker count is the config
> default; `--maxWorkers` on the command line overrides it.

That last clause is not a nicety. `vitest.config.ts`'s own comment says the number it logs *"is what
the CONFIG asked for, and is deliberately not called the resolved one"*, because `--maxWorkers`
beats it and that escape hatch is preserved on purpose. A dashboard that presented `would-reduce`
as a settled worker count would contradict the config it is describing.

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
dashboard has no explanation for admission policy vN; the numbers below are live, the wording is
withheld*. The numbers stay because they come from the gate; the narration goes, because narration
is the thing that would be wrong. Nobody has to remember to increment anything, and nobody can clear
the warning by making two numbers equal without reading either.

### 3. Forecast, observed, not-modelled — three labels and no fourth

The roadmap asks for *"a clear statement of whether a signal is an enforced admission decision or an
advisory resource claim. A claim file is not a lock."*

Established while reading the tree, and worth stating plainly because it is the load-bearing fact of
this whole stage: **there is no claim file anywhere in this repo today, and no lock.** Nothing
reserves capacity, nothing waits on anything, and the only thing in the codebase that stops work
starting is `vitest-admission.ts`, inside the very process it stops. So every block on the panel
carries one of exactly three labels, and **the word "enforced" is never one of them** — it appears
only inside a sentence describing where enforcement actually happens:

- **`forecast`** — the gate's answer for a hypothetical run, on a reading taken at a stated instant.
  It stopped nothing. Enforcement exists, but it is elsewhere: inside a vitest process evaluating
  this repo's config, refusing itself.
- **`observed`** — a reading of what is running. It stopped nothing and reserved nothing.
- **`not-modelled`** — we have no cost model for this, so there is no answer to give (see §5).

### 4. What heavy work is running: a job-root census, conservative on purpose

The first draft reused `health.ts`'s existing `ps` grouping, and the review was right that this does
not meet the roadmap checkbox: that reading groups *processes* by a keyword anywhere in argv, cannot
tell a codex review from any other node process, and its own header says it deliberately calls
anything Chrome-flavoured a browser. Under a heading that says *what heavy work is running*, that is
a promise the data cannot keep, and a caveat underneath does not repair it.

So this stage builds a small census of its own, in its own module, reading `/proc` directly:

- **Classify by argv elements, not by a substring of the joined line** — the memory of this box
  records `ps -eo args | grep -c` over-counting because it matches its own apparatus. Read
  `/proc/<pid>/cmdline`, split on `NUL`, and match elements.
- **Fold processes to job roots** by walking `ppid` from `/proc/<pid>/stat`: a process whose ancestor
  carries the same class is not a root, and a Chrome helper (`--type=` in argv) is never a root.
- **Report only what it is confident about**, plus an explicit **uncertain** count and an explicit
  **unreadable** count. A process that vanished mid-walk is unreadable, not absent.
- **Three classes to start**: `test` (vitest), `review` (codex), `browser` (chrome/chromium/
  playwright). Anything else is not counted as heavy work at all, and the panel says the census only
  looks for those three.

**Measured on this box, 2026-09-10**, over 425 processes: **37.7 ms median, 56.0 ms worst**, folding
to 40 candidate roots. Two things follow. First, **this cannot go on the request path** — the
dashboard is a single Node process the Overseer has no alternative to, and 56 ms of blocked event
loop per tab open is over the ceiling `fleet-dashboard-modes.md` sets. It goes on the timer in §7.
Second, the raw fold gave **33 browser roots**, which is certainly wrong — Chrome helpers whose
parents are not themselves classified read as roots. That over-count is the census's characteristic
failure and it is the reason for the conservative rules above and for the uncertain arm: on this
panel an over-count means *the box looks busier than it is*, which is a wrong number under a true
label, the exact defect the review refused the first draft for.

### 5. The typed admission request

A type, plus a route that answers one. Types in `wire.ts` (types only — appended at the end,
re-reading the file first, since other sessions are live in it):

```ts
export type AdmissionKind = "test" | "review" | "browser";

/** DECLARED by the requester, not measured. Nothing verifies it, and today nothing uses it. */
export type AdmissionCostClass = "light" | "moderate" | "heavy";

export type AdmissionRequest = {
  kind: AdmissionKind;
  cost: AdmissionCostClass;
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

`GET /api/admission?kind=…&cost=…` builds one and answers it. The default, with no query string, is
`kind=test`, `cost=heavy` — the case the gate actually governs.

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

### 6. The would-refuse history — and the checkbox this stage does not close

**Correction to the first draft, and it was the sharpest finding.** That draft asserted that no
admission refusal is durably recorded anywhere on this box. That is false, and the review produced
the counter-example: `logs/tmux-jobs/grfd-check3-0934-2389191.log` line 80 holds a real refusal, in
full, with its numbers — `MemAvailable 8.39 GB, and swap 12.29 GB of 32.00 GB used`. It is there
because `scripts/tmux-job.ts` opens its log before running the command precisely so output survives
the pane. Refusals also survive in agent transcripts. **The accurate statement is:**

> No complete, centralized admission-refusal journal exists. Some refusals survive incidentally in
> tmux-job logs and agent transcripts, but those sources are incomplete and are not a stable fleet
> API.

**And a scan of those traces was considered and rejected, on a measurement.** The newest 40 log
tails (32 KiB each) cost 4.3 ms median / 23.7 ms worst; all 136 across every worktree cost 10.5 ms
median / 61.8 ms worst. Affordable. What kills it is not cost but honesty: the refusal in that log
is at **line 80 of an 800 KB file**, because the refused step was one of several in an
`npm run check`, so neither a head scan nor a tail scan reliably finds it, and the primary's logs
alone are 55 MB. A scanner that sometimes misses a refusal reports *no recent refusals* in exactly
the same words as one that looked properly — a silence that reads as a finding, which is
[silent-success.md](../reusable/silent-success.md)'s subject.

**So the roadmap's "the last refusal" is recorded as UNMET**, deferred to a stage that authorises a
centralized writer, and this is the item to put in front of Greg: one appended line per refusal,
from the two places that already compute one, would make the real answer trivially available. Both
of those places are outside this stage's file set.

What the panel shows instead, under its own honest heading **"Would-refuse history"**: the gate
replayed over the health history at `~/.fleet-health/`, which the dashboard already keeps.

**The replay obeys the stored union, not today's file contents.** The history's `report` is
deliberately `Record<string, unknown>` because records cross version boundaries, and a sample may be
`collector-failed` or `sample-omitted`, and `memory` itself has an `unknown` arm. So each sample
lands in one of three classes:

| Class | When |
|---|---|
| **replayable** | a finite stored `memory.availableBytes` — apply today's policy to that recorded value |
| **admission-unknown** | collector failure, omitted sample, missing/unknown/unrecognised memory shape |
| **unobserved** | no sample there at all — a gap, or before the record begins |

**A failed `free` is not a failed `/proc/meminfo`.** Mapping an `unknown` memory reading onto the
gate's `broken` snapshot would produce a *would-refuse* out of a collector problem — manufacturing a
refusal from a missing measurement. `admission-unknown` exists to stop exactly that.

The panel states **counts, not coverage**: *of N readable memory samples in the last 24 hours, M
would have been refused, and K samples could not be replayed.* Counts rather than a percentage of
the day deliberately — `history-series.ts` already owns one coverage calculation for the chart, and
a second one here could disagree with it on the same screen. The panel's wording:

> For samples containing a readable stored memory value, this applies today's policy to that
> recorded value. Other samples are admission-unknown. These are sampled counterfactuals, not
> decisions made by a run.

**The one equality this rests on, measured rather than assumed.** The gate reads `MemAvailable` out
of `/proc/meminfo`; `health.ts` reads the sixth column of `free -b`'s `Mem:` row. Sampled on this box
on 2026-09-10, a few milliseconds apart: `free` said 20,207,513,600 bytes and `/proc/meminfo` said
20,206,481,408 — a gap of 0.005%, which is the number moving between two reads rather than two
different numbers. Swap is **not** the same measurement, and does not need to be: the gate uses swap
only in the *text* of its refusal message, never in the arithmetic that decides.

### 7. Everything expensive happens on a timer, and the route serves a cache

The review measured the history scan the first draft put in the request handler: **18.85 ms median,
26.65 ms worst** over the current 1.8 MiB store, returning 1,346 samples in the window — not the
"well under 7 ms" the draft claimed, and worse than that, opening Box health *already* triggers the
existing history request, so the tab would have caused two scans. The store rotates at 8 MiB and may
read two files, so the bound is 16 MiB, and 250 ms of blocked event loop is a frozen control plane.

Add the census's 38–56 ms and the request path is indefensible. So:

**`admission-wiring.ts` owns a timer.** It recomputes the census and the would-refuse replay on the
dashboard's own refresh cadence, keeps a small summary in memory, and **the route never scans
anything**. The forecast — one `/proc/meminfo` read and some arithmetic, sub-millisecond — is the
only thing computed per request, because it is the one that must be current.

The payload carries `computedAtMs` for the cached halves and a separate instant for the forecast, so
the panel can say how old each is; a cache with no age on screen is how a stale number becomes a
current claim. And the synthetic worst case — a full 2 × 8 MiB store, including the rotation retry
`health-history.ts` performs — gets measured during Stage 1 and written here, rather than reasoned
about.

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

---

## What this deliberately does not do

- **It reserves nothing and refuses nothing new.** Reading the panel changes no behaviour anywhere.
- **It does not show the last refusal**, and says so — §6. Roadmap checkbox recorded unmet.
- **It scores nothing but test runs** — §5.
- **It does not touch `collect.ts` or the refresh path.** No new per-session or per-pane work.
- **It classifies conservatively and under-reports** rather than over-reporting heavy work — §4.

---

## Stages

Implementation is delegated to GPT Sol via
[codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md), per the dispatch brief; this
session writes the prompts, runs the gates, reviews, and commits.

### Stage 1 — the forecast and the wire

- [ ] `wire.ts` types (§1, §2, §5). Types only, appended, file re-read first.
- [ ] `tools/fleet/routes-admission.ts`: `parseAdmissionRequest`, `explainAdmission` (pure over
      values a test hands in), the version-indexed explanation map, and the handler.
- [ ] `tools/fleet/admission-wiring.ts`: the composition, so a test drives the same function
      `server.ts` calls — the lesson `health-wiring.ts` exists to record.
- [ ] `server.ts`: the mount, beside the health retention route.
- [ ] Tests, red first: low memory → `would-refuse` carrying the gate's own message; unreadable
      `/proc/meminfo` → `would-refuse`, not `unknown`; no reserve file → `not-applicable`; empty or
      garbage reserve file → `unknown` with the thrown message; capacity below nominal →
      `would-reduce`; an unrecognised policy version withholds the prose and keeps the numbers;
      `kind=review|browser` → `not-modelled` with no `decideAdmission` call; `VITEST_MAX_WORKERS` is
      restored after a forecast and two successive forecasts agree; `parseAdmissionRequest` on junk;
      exact path match; the 500 arm; a comment-stripped source guard on the `server.ts` mount,
      checked red by commenting the mount out; and a wiring test that would go red if the server
      built its own deps instead.

**Status:** not started.

### Stage 2 — the census and the would-refuse replay, on the timer

- [ ] The job-root census (§4) and the replay (§6), both pure over inputs a test supplies, both
      driven by the timer in `admission-wiring.ts` (§7), never by the handler.
- [ ] Measure the synthetic worst case (2 × 8 MiB store, rotation retry) and write it into §7.
- [ ] Tests: the census's uncertain and unreadable arms; a Chrome helper is not a root; a vitest
      worker is not a root; the replay over a fixture history containing a reading, a gap, a
      `collector-failed` line, a `sample-omitted` line, a `memory: unknown` sample and an
      unrecognised report shape — **none of which may become a zero, a healthy value or a refusal**;
      and that a stale cache renders with its age rather than as current.

**Status:** not started.

### Stage 3 — the client section

- [ ] `admission-client.ts` (seam + parser + the three nothings), `AdmissionSection.tsx`, mounted in
      `HealthPanel.tsx`, injectable from `App.tsx`.
- [ ] Tests: opening Box health issues the request; each outcome renders its own sentence; the
      forecast's disclaimer sentence is present verbatim; a browser that never got an answer says so
      in its own voice.
- [ ] The real page at 390 × 844 and at desktop width, on its own port, never `:8787`.

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
