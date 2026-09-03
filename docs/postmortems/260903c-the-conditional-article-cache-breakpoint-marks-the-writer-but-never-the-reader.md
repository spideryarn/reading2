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

## The fix that is right for the long term

Recommended, **not implemented** — see the report accompanying this postmortem for the diff-level
shape and the saving.

**Mark the article when any *other* member of this job's cache group is involved, not only a later
one — and take the earlier ones from what actually ran.** Concretely, at
[src/jobs.ts:528](../../src/jobs.ts):

- **later** steps still in the plan ⇒ mark, because a write is coming that somebody will read
  (today's behaviour, unchanged);
- **earlier** steps of the same group whose `status` is `done` ⇒ mark, because the entry exists and
  this call should ask for it.

The `status` test matters and is free: `runStep` walks `job.steps` in order and mutates each entry in
place, so by the time the reader builds its `StepContext` the earlier steps already say `done` (they
ran) or `skipped` (their artefact was fresh and no call was made). Without that test, a job whose
first mode was already done would mark a prefix nothing has written and pay the premium alone —
re-creating the original bug pointing the other way.

`sharesArticleCache` stays the group predicate; only its argument changes, plus a `status` filter on
the earlier half. The reader's marker is not a second write: on a warm prefix it is a read at 0.1×
that also refreshes the TTL for free.

**Delete rather than fix?** No — and the numbers say so rather than taste. Deleting the optimisation
(never mark) saves only the write premium, `prefix × $0.50/MTok`: $0.0127, $0.0127 and $0.0136 on the
three jobs, $0.039 total, 5.2%. Fixing it saves `prefix × $1.80/MTok`: $0.0458, $0.0458 and $0.0490,
**$0.140 total, 18.6%** of the three jobs' $0.756. Fixing is worth 3.6× deleting. `prompt-caching.md`
is right that the question is "is anyone coming" — the answer here is yes, somebody is already here,
and the code was looking the wrong way down the corridor.

## What would have caught the whole class

Ranked by value per unit of effort.

1. **An assertion that the two sides agree, in `tests/article-cache-group.test.ts`** — cheap, and it
   is the one that fails today. For every ordered pair of same-group stages, *both* members of a
   two-step job must get `cacheArticle: true`. Written against the `runStep` call site, not against
   `sharesArticleCache` alone, so it sees the `slice(i + 1)`. Minutes to write, and it would have
   gone red on `24335207`.
2. **A batched-modes gate in `evals/cost`** — the eval already computes the number; it just does not
   judge it. `checkColdDraw` returns `[]` for `phase: "batched"`. Give the batched phase its own
   rule, the mirror of `modeDrawIsCold`: *in a job holding two members of one cache group, the second
   member's `cacheRead` must be within 10% of the first member's `cacheWrite`* — fatal otherwise, and
   `null` telemetry fatal as "unknown", exactly as the cold rule already does. This is the check that
   makes the class visible rather than this instance, because it asks about money reaching its
   destination rather than about a predicate's return value. Costs one eval run's money to exercise.
3. **A request-shape unit test per stage: a stage told `cacheArticle: true` must emit exactly one
   `cache_control`, and told `false`, none.** Mechanical, free, deterministic, eight stages. It would
   not have caught *this* bug (the flag was correctly plumbed; the flag was wrong), but it closes the
   neighbouring hole where a stage forgets the field entirely, which is the accident
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
