# The conditional article-cache breakpoint marks the writer and never the reader

**2026-09-03.** Written from a cost eval, not from a bug report. Nothing was red, nothing threw, every
artefact was correct, and every test passed. The only symptom was the bill.

The optimisation in
[prompt-caching.md § And on the normal path, the pipeline breakpoints lose money](../project/prompt-caching.md#and-on-the-normal-path-the-pipeline-breakpoints-lose-money)
has never worked for a pair of stages. Not "worked and regressed" — **never**, since the day it
landed. It has been paying the 1.25× cache-write premium and collecting nothing back, which is
precisely the loss it was introduced to stop.

## What happened

`evals/cost` priced what a reader who presses two mode buttons in one job pays. Three batched-mode
jobs, one per cache group, all against the same 16,855-word `long-html` fixture. Raw results in
`evals/results/cost/2026-09-03-05-4{7,8,9}-*/run.json`.

| job | writer | its `cacheWrite` | reader | reader `input` | reader `cacheWrite` | reader `cacheRead` |
|---|---|---:|---|---:|---:|---:|
| `arc,tweets` | arc | 25,428 | tweets | 27,533 | **0** | **0** |
| `glossary,quotes` | glossary | 25,428 | quotes | 27,802 | **0** | **0** |
| `ideas,timeline` | ideas | 27,239 | timeline | 30,194 | **0** | **0** |

Both steps of each pair ran inside one job (`byStep[].jobIds` is a single id in each file), seconds
apart, well inside the 5-minute TTL. The writer paid the premium. The reader paid full price for the
whole article again.

## The root cause

`runStep` decides the flag from the steps that come **after** this one:

```ts
// src/jobs.ts:528-531
cacheArticle: sharesArticleCache(
  step.name,
  job.steps.slice(job.steps.indexOf(step) + 1).map((s) => s.name),
),
```

`sharesArticleCache` ([src/pipeline.ts:289-306](../../src/pipeline.ts)) asks "is a later step of this
job in my cache group". For the **last** member of a group that is `false` by construction — and the
last member is the reader. Every article stage renders its only breakpoint conditionally:

```ts
// src/arc.ts:400-405, and the same eight lines in tweets.ts:481-486, glossary.ts:1297-1302,
// quotes.ts:1047-1052, ideas.ts:953-958, timeline.ts:1259-1264, quiz.ts:890-895, sketch.ts:530-535
{ type: "text", text: articleText(meta, evidence),
  ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" } } : {}) }
```

So the reading request goes out with **no `cache_control` anywhere in it**. A cache lookup happens at
a request's breakpoints; a request that carries none performs none, and reads nothing however warm
the entry is. The write premium is a bet on a read that the code makes structurally impossible.

Reproducing the call site over the real predicate — the flag each step of a job would get:

```
job [arc, tweets]                -> arc=true       tweets=false
job [glossary, quotes]           -> glossary=true  quotes=false
job [ideas, timeline]            -> ideas=true     timeline=false
job [ideas, timeline, sketch]    -> ideas=true     timeline=true   sketch=false
```

**Exactly one step per job is wrong, and it is always the last member of the group.** For the
two-mode job — the shape a reader who presses two buttons actually produces, and the only shape the
eval measured — that is half the modes, and it means the pair never shares anything. The three-mode
row is the reason to say "never worked for a pair" rather than "never worked at all": in
`[ideas, timeline, sketch]` the middle step does mark and would read. That case has never been
measured, and it does not soften the pair case, which is the common one.

### Why it is that, and not a prefix mismatch

The obvious rival explanation — the two prompts diverge somewhere in the cached prefix — is refuted by
one number in the table above: **the reader's `cacheWrite` is also 0.**

If the reader had sent a breakpoint and the prefix had failed to match, it would have written its own
entry, and we would see `cacheWrite ≈ 25,428` on the reader. Zero write *and* zero read is only
possible if no `cache_control` reached the provider at all. That is the field the flag controls.

The arithmetic agrees that the prefixes are in fact identical. Prices back out of the ledger exactly
at Sonnet-5 rates ($2.00/MTok input, $2.50 write, $0.20 read, $10.00 output — arc's
`3,406 × $2 + 25,428 × $2.50 + 518 × $10 = $0.075562` matches its `75,562,000` nano-dollar row to the
cent). On that basis arc's whole prompt is `3,406 + 25,428 = 28,834` tokens and tweets' is `27,533`;
subtracting the shared 25,428 leaves tweets a 2,105-token instruction suffix, which is the right size
for its `SYSTEM` block plus `renderPrompt`. Both stages call `articleText(meta, evidence)` into
`system[0]`, neither sends tools, and the stage-specific text is `system[1]` and after. The prefix is
sound. Only the marker is missing.

### The control experiment is in the same eval run

`labels` sends its breakpoint **unconditionally**, on every call
([src/labels.ts:1596](../../src/labels.ts)). In the ingest draws of
`evals/results/cost/2026-09-03-05-22-04-41wlze3j-long-html/run.json`:

| draw | `labels` calls | `cacheWrite` | `cacheRead` |
|---|---:|---:|---:|
| 1 | 3 | 3,207 | 0 |
| 2 | 3 | 3,390 | 0 |
| 3 | 3 | 3,336 | 0 |
| 4 | **4** | 3,321 | **1,107** |

Three parallel batches all write and none reads — the documented fan-out rule, an entry is not
readable until the first response starts streaming. Draw 4 made a fourth call (a shortfall re-ask,
issued after the batches returned), and **it read 1,107 tokens**: three writes of ~1,107 each, one
read of 1,107.

Same repo, same eval run, same model, same provider. The only difference between the call that reads
and the eight article-stage calls that do not is whether the reading request carries `cache_control`.
That is as close to an A/B as this codebase will ever hand us for free.

Two side notes from that table:

- **`hierarchy` is not affected.** Its structure call sends no breakpoint at all (`grep cache_control
  src/hierarchy.ts` is empty) and its row is `cacheWrite 0, cacheRead 0`. The ingest path writes
  nothing it fails to read; the only cache on that path is labels-to-labels, and it works.
- **[prompt-caching.md § the labels row](../project/prompt-caching.md#where-the-caches-are) is now out
  of date on a fact.** It says the labels prefix is ~660 tokens on the 141-block article and ~950 on
  the 360-block one, "both under the 1,024-token floor", so labels "caches nothing at all on the
  articles we have". On `long-html` the prefix is ~1,107 and it clears the floor. The doc predicted
  it would start working on its own the day an article's outline got long enough. It has.

## How much this actually cost, and where — which is less than the percentages suggest

The waste is confined to jobs carrying **two members of one cache group**, and it is worth being
exact about who emits that shape, because "18.6% of a batched job" reads like money leaving the
account today and mostly it is not.

- **The reading view never batches.** Every mode button enqueues exactly one step —
  `steps: [step]` in [`useStepJob.start`](../../src/web/useStepJob.ts) — so a reader pressing
  "Find the terms" and then "Choose the quotes" makes two jobs, minutes apart, and misses the
  5-minute TTL anyway. **True when this was written; no longer universally true.** Later that day
  Illustrated's *"Draw the Sketch, then paint"* gained `precededBy`, so one press can post
  `["sketch", "illustrated"]` in a single job — [diagram.md § Illustrated](../project/diagram.md#illustrated).
  Whether that pair shares a cache group has not been measured.
- **An ordinary ingest carries no article stage at all** since `arc` left `DEFAULT_INGEST_STEPS` on
  2026-08-29.
- **What does emit it:** `POST /api/jobs`, which takes whatever step list a client sends; the CLI;
  and `evals/cost`, which is where it was found.

So the money already lost to this is small, and the same sentence explains why nobody noticed. **The
value of the fix is almost entirely forward-looking**, and that is not a hedge: the obvious next
feature here is a "generate these three" affordance, or an ingest that carries two modes, and it
would have shipped a 1.25× tax collecting nothing, invisibly, on the shape it was specifically
designed to reward. The optimisation would have gone on looking like a saving while being a cost, for
as long as the second reader stayed hypothetical.

**Which is the real lesson about the measurement, not just the bug.** The eval priced a job shape
production does not currently produce, and that is exactly why it found something: the cheap,
common shapes had been argued about for a fortnight and the expensive rare one had never been run.

## The class it belongs to

**A one-sided contract: the code that pays is not the code that collects, and only the paying side
was implemented.** Caching is a two-party protocol — one request writes the entry, another asks for
it — and `cacheArticle` was designed, named, reviewed, tested and documented entirely from the
writer's point of view ("should this step *pay to cache*"). The reader's half of the protocol was
never given a name, so nothing in the system had anywhere to notice it was missing.

It is the same family as
[260826h-chat-cache-automatic-breakpoint.md](260826h-chat-cache-automatic-breakpoint.md) and the
`ideas`/`ARTICLE_RENDERER` near-miss recorded in the same doc: the marker is present, the code looks
cached, the bill goes up, nothing is red. It is
[silent-success.md](../reusable/silent-success.md) with money as the only observable — and this time
the check that agreed with the code was not one check but the whole suite, because the suite was
testing the same one-sided idea the code implemented.

There is a second, sharper property worth naming. **The fix for the previous instance of this class
introduced this one.** Commit `24335207` was written to stop paying an unread premium; the mechanism
it chose — a later-only predicate — created an unread premium in the one case it was explicitly
preserving. A narrowing fix that narrows past the case it was protecting looks, from inside, exactly
like a correct narrowing fix.

## Which commit introduced it

**`24335207` — "Only pay to cache the article when somebody is coming to read it", 2026-08-26.**

Before it, every article stage marked the article unconditionally
(`cache_control: { type: "ephemeral" as const }`, a plain field). Writer and reader both carried a
breakpoint, and a job holding two stages of one group did read warm. That commit replaced the field
with `...(opts.cacheArticle ? … : {})` in each stage and added the later-only predicate — correctly
turning the marker off for a lone ingest, and incorrectly turning it off for every reader.

So the optimisation regressed on the same commit that documented it as working. `b7b7aa5f` later
carried the same predicate to `quiz`; it changed nothing about the shape.

## Why nothing caught it

This is the part worth sitting with.

- **`tests/article-cache-group.test.ts` asserts the bug.** It has ten cases, several written after
  reviews, and every one of them asks the writer's question. `sharesArticleCache("arc", ["tweets"])`
  is `true`, `sharesArticleCache("arc", [])` is `false` (commented "tweets has already been paid for;
  caching now buys nobody anything" — which is exactly backwards for a reader), and
  `sharesArticleCache("arc", job.slice(1))` is `true` for `["arc","tweets"]` — the writer of the pair,
  never the reader. A test suite that pins one side of a two-sided contract makes the missing side
  harder to see, not easier.
- **`evals/prompt-caching.ts` exercises search and chat, and says in its own closing lines that it
  does not cover this**: *"The pipeline's shared block is `articleText`; to check it, run two of arc,
  tweets or glossary back to back on one article and compare their `cacheReadTokens` in the pipeline
  log."* The instruction was correct, printed on every run, and nobody ran it for eight days.
- **`evals/cost/report.ts` states the mechanism correctly and applies it to the wrong case.** Its
  `modeDrawIsCold` comment reads: *"a single-mode job leaves that false — so no breakpoint is sent,
  and Anthropic can neither write nor read one."* The codebase already knew that no breakpoint means
  no read. It used that fact to justify a per-mode coldness guard and never turned it around on the
  batched case.
- **No typecheck, lint or unit test can see this.** The request is well-formed, the answer is
  correct, the artefact is right, the job succeeds. The only difference between working and broken is
  a number in a usage field on a paid call.

**It was found by measuring money and by nothing else.**

## The fix

**Implemented 2026-09-03**, and measured before it was believed.

**Mark the article when any *other* member of this job's cache group is in the job — in either
direction, position-blind.** `sharesArticleCache` stays the group predicate and is unchanged; what
changed is the argument it gets, which is now built by a named function of its own,
`cacheArticleForStep(steps, index)` in [src/pipeline.ts](../../src/pipeline.ts). The call site in
[src/jobs.ts](../../src/jobs.ts) no longer contains a `slice(i + 1)` — no longer contains any
argument-shaping at all, which is the point. The thing that was wrong for eight days was invisible
because it was an inline expression at a call site nothing could test without a job, a store session
and a claim.

Filtering is by **position** rather than by name, so a job holding one step twice — a forced re-run
queued behind a fresh one — still sees a genuine pair rather than a lone step.

### What this postmortem originally recommended, and why it was wrong

The first draft added a condition: mark for earlier steps of the group **only when their `status` is
`done`**, reasoning that otherwise a job whose first mode was `skipped` would mark a prefix nothing
had written. Fable was asked to arbitrate the design and argued it out, correctly:

- **`done` does not mean a warm entry exists.** A job that stalls and resumes an hour later has
  `done` earlier steps whose entries expired long ago. The marker is exactly as speculative with the
  test as without it, so the test buys certainty it cannot deliver.
- **What it really buys** is one avoided write premium in the narrow case "earlier group member was
  `skipped`, none later" — about 1.3¢ on a 17,000-word article. **Per cache group, not per job**, a
  correction from Sol: an all-mode job in which only one member of each of the three groups actually
  runs wastes three premiums, about 3.9¢ here, scaling with length. Still not enough to buy the
  filter, and Sol agreed — `skipped` no more proves the absence of a warm entry than `done` proves
  the presence of one, and the 3.6× asymmetry is decisive either way.
- **What it costs** is a load-bearing dependency on `runStep` mutating `job.steps` in place as it
  walks. True today; silently broken by any reordering of the `StepContext` construction. That is the
  kind of fact this postmortem exists to stop us leaning on.
- **And the asymmetry points the other way.** A marker sent onto a cold prefix costs 0.25× of that
  prefix; a marker withheld from a warm one costs 0.9×. Where the predicate must guess it should
  guess *yes*, and the `status` filter made it guess no in order to save cents.

Marking **unconditionally** — reverting `24335207` outright — is the option that asymmetry almost
argues for, and it is deliberately not taken. It breaks even once a same-group call lands inside the
TTL more than 0.25/(0.25 + 0.9) ≈ 22% of the time, and nobody has measured that rate. Deciding it by
argument is the class of mistake this file is about.

### Verified, on a paid run, before being believed

Standing rule 5 below says a cache optimisation is unbuilt until a measured read exists, and all
three previous instances of this class were argued rather than measured. So:

**All three cache groups, because one pair proves the *structural* fix and not that the other two
groups' prefixes actually match** — Sol's closing point, and it was right. Three paid jobs:

| group | writer's `cacheWrite` | reader's `cacheRead`, **before** | reader's `cacheRead`, **after** |
|---|---:|---:|---:|
| `arc` → `tweets` | 25,428 | 0 | **25,428** |
| `glossary` → `quotes` | 25,428 | 0 | **25,428** |
| `ideas` → `timeline` | 27,234 | 0 | **27,234** |

**Every read is exactly its group's write.** The reader's uncached input collapses to its own
instruction suffix in each case — `tweets` 27,533 → 2,112, `quotes` 27,802 → 2,516, `timeline`
30,194 → 3,074 — which is the independent confirmation that the prefixes were identical all along
and only the marker was missing.

```
npm run eval:cost -- --against <slug> --steps arc,tweets      --batched-modes   # 07-37-36-kde669em
npm run eval:cost -- --against <slug> --steps glossary,quotes --batched-modes   # 08-06-13-hqgwm8ep
npm run eval:cost -- --against <slug> --steps ideas,timeline  --batched-modes   # 08-07-34-l88h0dje
```

**The saving is the reader's prefix at $1.80/MTok** — the gap between paying $2.00 for it and
$0.20 — so $0.0458, $0.0458 and $0.0490: **$0.1406 across the three, exactly the figure predicted
before any of it was run.** On the `arc,tweets` pair, where the suffix happened to be stable enough
to subtract directly, predicted $0.045770 against measured $0.045756 — agreement to 0.03%.

**What not to quote:** the `arc,tweets` job total moved $0.1572 → $0.1007, and that 36% is not the
fix. Output tokens vary run to run — those two generations differed by 1,068 of them — and only the
input side is attributable. `ideas,timeline` makes the point harder: its total went *up*, because
`timeline` happened to spend 17,690 reasoning tokens that run. The cache saving was still collected
in full underneath. **A cache fix must be measured on the input side or not at all.**

**Delete rather than fix?** No — and the numbers say so rather than taste. Deleting the optimisation
(never mark) saves only the write premium, `prefix × $0.50/MTok`: $0.0127, $0.0127 and $0.0136 on the
three jobs, $0.039 total, 5.2%. Fixing it saves `prefix × $1.80/MTok`: $0.0458, $0.0458 and $0.0490,
**$0.140 total, 18.6%** of the three jobs' $0.756. Fixing is worth 3.6× deleting. `prompt-caching.md`
is right that the question is "is anyone coming" — the answer here is yes, somebody is already here,
and the code was looking the wrong way down the corridor.

## What would have caught the whole class

Ranked by value per unit of effort.

1. ✅ **An assertion that the two sides agree** — **built, in two files, and the second is the one
   that matters.**

   `tests/article-cache-group.test.ts` now generates every ordered pair of same-group stages from the
   tables and requires *both* members of a two-step job to get `true`. Watched going red against the
   old predicate first: four failures, every one a reader. The two tests that pinned the bug are gone
   — including the one whose comment said an earlier stage "has already been paid for" so caching now
   "buys nobody anything", which is the bug stated in English and asserted.

   **But that file could not have caught this**, and Sol proved it the blunt way on the built code:
   reverting *only* `runStep` to the later-only call left all 154 focused tests green. The predicate
   was never the broken part. So `tests/article-cache-call-site.test.ts` runs a real two-mode job
   through the real walk with a recording registry and asserts what
   `StepContext.cacheArticle` each step is **actually handed**. Against the old call site it reports
   `[true, false]`; that is the test that would have gone red on `24335207`.

   The lesson generalises past this bug: **a predicate extracted for testability is only tested where
   it is called.** The `slice(i + 1)` lived at a call site needing a job, a store session and a claim
   before it would run, which is exactly why nothing tested it and exactly why it was wrong.
2. ✅ **A batched-modes gate in `evals/cost`** — **built**, as `checkBatchedDraw`, and it took two
   goes to get the shape right. The rule is *the verdict comes from the ledger, never from the
   predicate*: **every call that paid to write a cache entry must be followed, within its cache
   group, by a call that reads about that many tokens.** An unclaimed write is a lost bet whether the
   cause is a missing breakpoint, a diverged prefix or an expired TTL, which is why it should survive
   the next mechanism. Run against the three real pre-fix result files it fires on all three, and it
   passes the post-fix run.

   **The first version drew its scope too wide and Sol broke it in two ways.** It searched the whole
   draw for a claiming read, so one group's read absolved another group's lost write — arc writing
   25,428 unread went unreported because `timeline` read what `ideas` wrote — and it had to forgive
   the label fan-out by hand, which was unsafe in both directions (three parallel label writes with
   no re-ask, the shape actually measured, drew three fatal findings). Both are gone for one reason:
   membership now comes from `STAGE_EFFORT` and `ARTICLE_RENDERER`, so `hierarchy` is **out of
   scope** rather than forgiven, and reads are consumed at most once each.

   That means this postmortem's original claim — that a predicate-based check "would have passed on
   the broken code" — was **too broad**, as Sol said. A check that recomputed each step's
   `cacheArticle` decision would have passed; one that used the tables only to *identify a compatible
   pair* and then demanded a read would have failed. The right line is narrower and worth stating
   exactly: **take membership from the tables, take the verdict from the money.** Membership is a
   symmetric question the pipeline has always answered correctly; direction is the one it got wrong.

   Its last rule is the one no write can trigger: **a same-group pair that wrote and read nothing at
   all is fatal.** That is what a regression switching `cacheArticle` off everywhere looks like, and
   the write rule cannot see it, because it only ever asks about writes that happened.
3. **A request-shape unit test per stage: a stage told `cacheArticle: true` must emit exactly one
   `cache_control`, and told `false`, none.** Mechanical, free, deterministic, eight stages. **Not
   built.** It would not have caught *this* bug (the flag was correctly plumbed; the flag was wrong),
   but it closes the neighbouring hole where a stage forgets the field entirely, which is the accident
   `tests/article-cache-group.test.ts` § "agrees with itself about which renderer" was written for.
4. **Run `evals/prompt-caching.ts`'s own closing instruction, on a schedule.** It has told every
   reader for eight days exactly how to find this. The cheapest version is to stop printing the
   instruction and make the script do it: add a third pair to the eval that runs two pipeline stages
   of one group back to back and applies the same PASS/PARTIAL/FAIL verdict. It already has the
   verdict function, the pricing table and the report writer.
5. **Standing: treat a cache optimisation as unbuilt until a measured read exists.** The doc's own
   rule — *"A check you have never seen fail is not evidence"* — has a caching-shaped corollary. A
   `cache_control` marker with no accompanying non-zero `cacheRead` from a real call is a hypothesis,
   and a hypothesis that costs 1.25× to hold. Neither of the two prior instances of this class had a
   measured read either; all three were argued.
