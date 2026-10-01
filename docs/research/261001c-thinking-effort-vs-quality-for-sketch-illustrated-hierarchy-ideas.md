# Thinking effort vs quality: Sketch, Illustrated, Hierarchy and Ideas

2026-10-01. Worktree `thinking-effort-eval`. The plan, with the method and the decision rule fixed
before the results, is [261001p](../plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md);
every number below is from `evals/results/thinking-effort-261001/` (Sketch, Ideas, Illustrated) and
`evals/results/thinking-effort-smoke/` plus `evals/results/hierarchy-structure/2026-10-01-17-*` (the
Hierarchy smoke), produced by `evals/thinking-effort/`.

Why it was run: [research 261001b](261001b-cost-per-article-and-the-cross-mode-article-cache/README.md)
found thinking is about a quarter of a normal article's Claude bill, and these four modes are
three-quarters of that thinking. Greg, asked whether to test lowering their effort:

> A yes, might as well. and make sure this is written up (e.g. in docs/research ). use your
> judgment on how to proceed
>
> — Greg, 2026-10-01

His leanings, relayed by the Overseer, are quoted in the plan: Sketch and Illustrated are weak today
and he would standardise them if cheaper; Hierarchy matters but may not need much effort; Ideas is
less valuable to him.

## The answer, in plain words

| mode | today | decided | why |
|---|---|---|---|
| **Sketch** | `high` | **`low`** | Neither judge sees a loss (mean U 1.56 and 1.69 against a no-difference 2.0). Each call is 57% cheaper and four times faster. |
| **Illustrated** | `high` (implicit) | **stays `high`** | Both judges find `low` clearly worse (mean U 1.06 and 0.31). The brief stops choosing a style from the article, and its captions become riddles. At `medium` the judges split (1.56 and 1.06); the rule takes the worse of the two, and a close call keeps today's effort. |
| **Ideas** | `high` | **stays `high`** | Below `high` it writes broken JSON most of the time: 10 of 16 draws at `medium` and at `low`, against 1 of 16 at `high`. |
| **Hierarchy** | `low` | **stays `low`** | It is already at the bottom of the effort ladder. With thinking off, both draws put a sentence of prose before the JSON, and the shipping parser refused them. |

**What it saves.** Sketch at `low` costs 57% less per call ($0.235 → $0.100), and its picture
arrives in about 40 seconds instead of about three minutes.

Across the 44 normal articles in 261001b's 30 days, Sketch spent about $4.66 (its $6.77 total, less
the book's $2.11). 57% of that is about $2.66, which comes to **about 6¢ a normal article, roughly
5% of the mean normal article's Claude bill** ($48.52 over 44 articles, $1.10 each).

That is about half the 9–10% the plan hoped for. The hope assumed all four modes could halve their
thinking, and only one could.

**Sketch and Illustrated are not standardised, and that departs from the plan's rule.** The plan
said the two would end on the higher level each passes. Read literally, Illustrated passing only
`high` would hold Sketch at `high` as well. I set that aside, for two reasons:

- **Greg's leaning was conditional.** He said *"I'm leaning towards standardising the effort level
  for them if it makes them cheaper"*. Standardising at `high` makes neither of them cheaper.
- **It buys nothing technically.** The reason relayed for standardising was a shared cache, and
  Illustrated shares a cache with nothing at any effort: its article is fenced, so its bytes differ
  from every other stage's (src/models.ts § `ArticleStage`).

So each mode takes its own result. If Greg wants them on one level regardless, it is one line, and
he can say so.

And one finding nobody asked for: **today's `high` also writes broken JSON**, in 1 of 16 Ideas
draws and 1 of 16 Sketch draws. Nothing retries a malformed answer, so the reader gets a failed card
and a Retry button, and the failed call is still billed ([below](#a-finding-on-the-side-broken-json-at-todays-effort)).

## Method, briefly

The plan has it in full. In short:

- **Eight real articles**, full length, read from the local store as the pipeline reads them:
  `replication-crisis` (150k characters, the long one), `spider-silk` (63k), `entropy-24-00930` (a
  journal paper, 57k, 4 figures), `noema-mythology-of-conscious-ai` (53k),
  `towards-a-theory-of-bugs` (47k), `analog-cognition-and-consciousness` (45k, 8 figures),
  `after-work-we-ll-have-each-other` (34k), and `cargocult` (21k).
- **Four draws per article**, through the shipping generators: today's request twice (`base-a`,
  `base-b`), and the cheaper level twice (`low-a`, `low-b`).
  - Illustrated's base sends no `output_config`, byte-for-byte production. Every Illustrated arm
    paints the same Sketch, with the same figures.
  - Generation order was shuffled per article.
  - No cache, standard model, no reader profile.
- **One blind lineup per article**: the four draws under shuffled labels, with the key kept apart.
  Two judges, two methods, the same rubric
  ([evals/thinking-effort/rubrics.md](../../evals/thinking-effort/rubrics.md), written from each
  mode's doc):
  - **GPT Sol ranks** the four, ties allowed.
  - **Opus scores** each one 1–5 on five criteria against written anchors.
- **The measure: U**, per article. Of the four (cheap, base) pairs, it counts how many the cheap
  draw wins; a tie counts ½.
  - If effort made no difference, U averages 2. The standard error of an eight-article mean is
    about 0.46.
  - **Clear loss**: mean U ≤ 1.1. **Possible loss**: up to 1.5. Either judge's verdict counts, and
    the worse of the two wins.
- **Hard gates**: the cheap level must not fail more often than base, and it must save at least a
  third of the thinking, taking the median over the seven articles under 100k characters.
- **What it can claim**: a screen for a *visible* loss, not proof of equivalence (GPT Sol's first
  review). A loss too small for two judges to see on eight articles may exist.

**Two reviews by GPT Sol shaped it.**
- [The plan review](../../evals/thinking-effort/reviews/plan-review-sol-r1.md) reframed the first
  draft. That draft had five articles, one draw each, and one control pair used as a noise floor.
  Sol replaced it with two draws per arm, one lineup per article, and a rule fixed in advance.
- [The harness review](../../evals/thinking-effort/reviews/harness-review-sol-r1.md) fixed three
  problems before any money was spent:
  - a resume that could pay twice;
  - concurrent modes that could corrupt each other's files;
  - billed answers that lost their accounting when they failed to parse.

## Sketch: `low`

### The judges

| judge | mean U | verdict |
|---|---:|---|
| GPT Sol, ranking | 1.56 | no visible loss (just above the 1.5 line) |
| Opus, scoring | 1.69 | no visible loss |

Per article (U; 2 = no difference, 4 = low won every comparison, 0 = lost every one):

| article | Sol | Opus |
|---|---:|---:|
| replication-crisis | 2.5 | 2.5 |
| entropy | 0 | 0 |
| noema | 0 | 1.5 |
| theory-of-bugs | 4 | 1 |
| analog-cognition | 4 | 3 |
| after-work | 0 | 2 |
| spider-silk | 2 | 3.5 |
| cargocult | 0 | 0 |

The spread is the result. On half the articles Sol puts both `high` draws above both `low` ones; on
two it puts both `low` draws on top; the two judges agree on the direction for only some articles.
That is what "no visible loss" looks like at this sample size: no consistent direction, not
`low` being as good everywhere.

**What decided the comparisons**, in Sol's words. Where `low` won:

> Y clearly funnels the concrete examples into the question of advance detection, then into
> irreducibility and parallel consequences, while W forces most demonstrations into one long chain
> and adds weaker causal links among consequences. *(theory-of-bugs: Y was `low-b`, W `base-a`)*

Where it lost:

> X states the shared pattern more faithfully as status from group membership rather than
> achievement and then zooms into the crucial evidence about what work supplies, while Y
> overgeneralizes the cases as all being about gossip. *(after-work: X was `base-b`, Y `low-b`)*

And `high`'s overclaiming, the failure [sketch.md](../project/sketch.md) names:

> Z turns provability into an unsupported yes-or-no decision fork that equates failure to find a
> proof with a real lurking bug, making the overclaim even stronger than X's. *(theory-of-bugs: Z
> was `base-b`)*

**My own blind read** of one lineup (noema), written down before I opened the key: X > W ≈ Y > Z.
It came out base-b, base-a, low-b, low-a, the same order Sol gave. All four drew the same shape
(biases funnel into four arguments, which converge on "functionalism looks shaky", then loop back);
the `low` draws were thinner, and one used a decision diamond on a question the essay leaves open.
The differences were small.

### The cost

Means over 16 draws each:

| | thinking | output | cost per call | wall clock |
|---|---:|---:|---:|---:|
| `high` | 13,033 | 18,489 | $0.235 | 176 s |
| `low` | 965 | 4,931 | $0.100 | 42 s |

The median thinking reduction on the seven typical articles is **99%**: `low` often thinks under
200 tokens. Validity: 1 invalid draw in 16 at each level, both on `replication-crisis`.

## Ideas: stays `high`

| | invalid draws | thinking (median) | cost per call | wall clock (median) |
|---|---:|---:|---:|---:|
| `high` | **1 of 16** | 7,079 | $0.153 | 113 s |
| `medium` | **10 of 16** | 1,355 | $0.091 | 42 s |
| `low` | **10 of 16** | 0 | $0.069 | 27 s |

Ideas returns a list of propositions, each with quoted passages and block ids. Below `high`, the
model loses track of that structure partway through the answer. A typical failure:
`{"blockId": "spya-p4pyuy": "", "quote": "", "reasoning": ""}`, where an id is followed by a stray
value. Thinking seems to be what keeps this long, quote-heavy JSON well formed. A 60% failure rate
is not shippable at any quality, so the quality panel was not run: most lineups would have had
fewer than four candidates to rank.

**What would reopen it**: constrained output. The Anthropic API's structured outputs
(`output_config.format` with a JSON schema) make a malformed answer impossible, and none of these
stages uses them today. Whether that works on our wire (OpenRouter's Messages route) is unverified.
If it does, `low` Ideas — 55% cheaper and four times faster — would be worth re-testing for
quality.

## Hierarchy: stays `low`

Hierarchy has run at `low` since 2026-09-04, so the only cheaper setting on the same model is
thinking off (`thinking: {type: "disabled"}`, no `output_config`). On `cargocult`, both draws with
thinking off honoured the setting: zero thinking tokens, `end_turn`, $0.065 against the incumbent's
$0.085. But both answers began with a sentence of prose — *"Looking at this structure, I'll trace the
natural argument flow: …"* — before the JSON, and the shipping parser refused them. That is the
known failure of turning thinking off: the reasoning moves into the visible answer. The harness gate
that a draw must validate stopped it there, so the 32-draw panel was not bought. The refused answers
are in `evals/results/hierarchy-structure/2026-10-01-17-41-52-smart-off/trees/`.

Reopening it would take a production change first — a parser that skips a leading preamble, or
structured outputs again — and the saving is small: about 4,000 thinking tokens a call, roughly 2¢.
Greg's question, *"I'm not convinced the problem it's solving needs a really high effort level"*,
has the answer that it already runs at the lowest one.

## Illustrated: stays `high`

Judged on the brief, the written composition the image model paints, because two paintings of one
identical brief vary visibly.

| level | Sol mean U | Opus mean U | verdict | invalid | thinking | cost per call | wall clock |
|---|---:|---:|---|---:|---:|---:|---:|
| `high` (today) | — | — | — | 0 of 16 | 20,874 | $0.320 | 245 s |
| `medium` | 1.56 | **1.06** | clear loss (Opus) | 0 of 16 | 7,345 | $0.182 | 122 s |
| `low` | **1.06** | **0.31** | clear loss (both) | 1 of 16 | 2,121 | $0.126 | 74 s |

**`low` loses the two things [illustrated.md](../project/illustrated.md) says the mode is for.**

- **Choosing the style from the article.** At `high`, the essay that invokes golems and souls gets
  an illuminated manuscript. At `low`, the style falls back to an antique map justified only as
  *"charts an argument's territory — generic"* (Opus, noema).
- **Captions a reader can decode.** The reader's complaint was that without readable lettering the
  pictures make no sense. At `low` the captions become riddles: *"THE NEARER LANTERN", "THE FORGE
  LEFT UNLIT"*, *"Cryptic captions needing a key: 'THE DROWNED TALLY', 'THE NEEDLED SLICE'"* (Opus,
  noema and entropy). Sol, on noema: the `high` briefs *"choose the article's own
  illuminated-manuscript register from its golems, Scala naturae, gods, soul, and breath, while Y's
  map is less intrinsically tied to the essay"* (Y was `low-b`).

**`medium` is a close call, and the rule keeps `high`.**
- Sol sees no consistent loss. On replication-crisis it ranks a `medium` brief top for *"the
  clearest evidence-causes-remedies structure with accurate, concise lettering"*.
- Opus scores `medium` lower on five of eight articles, and its mean U falls just under the
  clear-loss line, at 1.06.
- Had `medium` been adopted, it would have saved about 43% a call, about 4¢ a normal article.
  Greg could still choose it on this evidence, knowing the judges split.

**`low`'s one invalid draw was a separate question**, and it was settled before the quality verdicts
came in. The gate as worded (no more invalid draws than base) fails 1 against 0. At these counts
that is a coin flip, so Opus arbitrated, and the plan records a fixed test: 32 more validity-only
`low` draws, failing at 3 or more invalid. That test was stopped after 4 draws (0 invalid, $0.69),
because both judges had by then found `low` clearly worse on quality, so its validity could no
longer change the outcome.

**One note on method.** The Opus judge for the `low` round gave each article to its own sub-judge.
All four candidates of an article still shared one context, which is what U needs, but the scale
was not shared across articles. The `medium` round's judge scored every article itself.

## A finding on the side: broken JSON at today's effort

At `high`, 1 of 16 Ideas draws and 1 of 16 Sketch draws were malformed JSON. In production
([traced in code](#how-a-malformed-answer-reaches-a-reader)), a malformed answer:

- is billed and recorded as a normal call, because the ledger row is written when the stream ends,
  before the stage parses it;
- fails the step: `parseJsonAnswer` (src/parse-json.ts) mends only one narrow case, a single object
  with trailing commas, and nothing retries;
- reaches the reader as a failed card with the generic "gave up" sentence and a Retry button, which
  makes a fresh draw.

So roughly one Sketch or Ideas press in sixteen fails for the reader today. Two fixes fit, cheapest
first: one automatic retry with the parse error fed back (the
[labels stage already does this](../postmortems/260924a-a-malformed-label-pair-kills-the-step-without-a-retry.md)),
or structured outputs. Either is its own piece of work; neither was done here.

### How a malformed answer reaches a reader

- `parseJsonFrom` throws `MalformedJson` (src/parse-json.ts, the "is not valid JSON" message).
- Each stage calls it through its own `parseJson` wrapper (src/ideas.ts, src/sketch.ts,
  src/illustrated.ts).
- The job runner re-queues only a lapsed lease, never a failed step (src/jobs.ts).
- src/job-failure.ts maps an unknown failure to a retryable kind.

## Cache groups

Effort is part of the prompt-cache key ([prompt-caching.md](../project/prompt-caching.md)).

- **Sketch** leaves the big `ids` + `high` group (ideas, timeline, quiz, faq, simple, tweets) and
  is alone at `ids` + `low`.
- **Illustrated** is unchanged, and shares a cache with nothing anyway: its article is fenced, so
  its bytes differ from every other stage's.

In production a cross-job share almost never happens: each mode is its own job, and a job marks the
article only for a sibling in the same job ([261001b](261001b-cost-per-article-and-the-cross-mode-article-cache/README.md)).
So the change costs close to nothing today. It does narrow the 261001o caching options, which
assumed one effort per group.

## What it cost

**About $22.30 in API spend**, all through OpenRouter: 138 generation calls in this harness
(including the smoke, the medium rounds and the 4 stopped validity draws), the three Hierarchy smoke
calls ($0.22), and three smoke plates ($0.20). The judges ran on Codex and Claude subscriptions.

Partway through, on 2026-10-01 at about 20:30, the OpenRouter **account** (shared by the dev and prod
keys) ran out of credit, at $309.13 of $310. Three Illustrated calls came back
`402 ai-no-credit`, and the harness stopped itself rather than record them as answers. The account
was topped up to $410 in total (the Overseer relayed it), and those three cells were re-run; the failed rows are kept in
`evals/results/thinking-effort-261001/outage-402/`. This eval was about $17 of the dev key's
$50.89 that day.

## What this does not show

- **Equivalence.** It is a screen: a loss too small for two judges to see on eight articles may
  exist.
- **High-powered AI articles (Opus).** The eval ran the standard model; the new effort applies to
  Opus too, untested.
- **The variance of the `low` arm** beyond two draws per article.
- **Illustrated's plates.** Its brief was judged, not the painting, because image draws of one
  identical brief vary visibly.

---

Up: [research.md](../project/research.md)
