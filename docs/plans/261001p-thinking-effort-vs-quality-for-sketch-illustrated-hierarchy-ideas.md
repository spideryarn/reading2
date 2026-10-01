# Thinking effort vs quality for Sketch, Illustrated, Hierarchy and Ideas

**Status as of 2026-10-01:** planned; GPT Sol reviewed the first draft (verdict *reframe*, twelve
findings, folded in below — [the review](../../evals/thinking-effort/reviews/plan-review-sol-r1.md)).
Stage 1 (the harness) built and smoked on `cargocult` for $1.12.

**Stages 2–3, as of 20:45:** Sketch, Ideas (with its `medium` round) and 23 of 32 Illustrated draws
are in; Sketch is judged. Then the OpenRouter **account** ran out of credit ($309.13 of $310,
shared by the dev and prod keys) and three Illustrated calls came back `402 ai-no-credit`. The
harness stopped itself; those three rows and their claims are moved to
`evals/results/thinking-effort-261001/outage-402/`, so a resume re-runs exactly them. The Overseer
has told Greg. Illustrated waits for the top-up; the write-up so far is
[research 261001c](../research/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md).

**Hierarchy is decided already, by the smoke run:** with thinking off, both draws answered with a
sentence of prose before the JSON ("Looking at this structure, I'll trace the natural argument
flow: …") and the shipping parser (`stripFence` + `parseJsonFrom`) refused both. That is the known
failure of turning thinking off — the reasoning moves into the visible answer — and it fails the
hard gate below (a draw that would cost a reader a retry). So Hierarchy stays at `low` and its full
run is not bought. Reopening it would mean a production change first (a parser that skips a
preamble, or a prompt that forbids one), and then this eval; that is a separate question. The two
refused answers are in `evals/results/hierarchy-structure/2026-10-01-17-41-52-smart-off/trees/`.

## Why

[Research 261001b](../research/261001b-cost-per-article-and-the-cross-mode-article-cache/README.md)
found that thinking is about a quarter of a normal article's Claude bill ($12.71 of $50.06 at list
price over 30 days, 44 normal articles), and that four modes are three-quarters of it: Sketch
$2.69, Illustrated $2.37, Hierarchy $2.17, Ideas $2.08. Halving all four would save about 9% of a
normal article ([261001o § F](261001o-one-shared-article-first-prefix-cached-across-modes.md));
that is the halving scenario, not a promise of this eval.

Greg was asked whether to test lowering their effort:

> A yes, might as well. and make sure this is written up (e.g. in docs/research ). use your
> judgment on how to proceed
>
> — Greg, 2026-10-01

And his leanings, relayed by the Overseer the same day:

> BTW The Sketch and Illustrated diagrams aren't working that well as is, so I'm leaning towards
> standardising the effort level for them if it makes them cheaper. Is Hierarchy the same as
> Structure? If so, that's pretty important, but I'm not convinced the problem it's solving needs a
> really high effort level. I can see how Ideas is quite tricky, but I'm also not finding it *that*
> valuable. I guess we'll see what the data say.
>
> — Greg, 2026-10-01

(Yes: Hierarchy is the stage that builds the tree Structure draws, and the granularity zoom reads
the same tree — [granularity-zoom.md § The tree](../project/granularity-zoom.md#the-tree).)

## What each mode runs at today

| mode | where effort is set | today | the cheaper candidate |
|---|---|---|---|
| Sketch | `STAGE_EFFORT.sketch` (src/models.ts) | `high` | `low` (then `medium` if `low` fails) |
| Ideas | `STAGE_EFFORT.ideas` | `high` | `low` (then `medium`) |
| Illustrated | **nowhere**: src/illustrated.ts sends adaptive thinking and no `effort`, so the API default, `high`, implicitly. (A High-powered AI article gets an explicit `high` injected by src/messages-stream.ts.) | `high` (implicit) | `low` (then `medium`) |
| Hierarchy | `EFFORT` in src/hierarchy-prompt.ts, shared with the expand calls (`EXPAND_EFFORT`), which are switched off for readers today | **`low` already** (moved there 2026-09-04 on eight blind judgements) | **thinking off** (`thinking: {type: "disabled"}`, no `output_config`; Sonnet 5 accepts it) |

## The method

### What this eval can and cannot claim

Sol's first finding: eight articles and two draws per arm are a **screen for a visible loss**, not
proof of equivalence. A null result means "no loss this panel could see", and the write-up says
exactly that. That is the bar Greg's licence asks for in a beta that optimises for speed: he has
said he finds Sketch and Illustrated weak, finds Ideas less valuable, and doubts Hierarchy needs
much effort. A loss small enough to hide from two judges on eight articles is a loss he has
pre-accepted for three of the four modes; Hierarchy gets the stricter rule below.

### Corpus: eight real articles, full length, from the local database

Not the `data/` fixture cuts a worktree gets; read from the local Postgres store with
`readArticle(slug, store)`, as the pipeline does. Block counts are recorded per run.

| slug | kind | blocks | characters |
|---|---|---:|---:|
| `replication-crisis-spya-hrjamq` | encyclopedic, **the long one** | 551 | 150k |
| `spider-silk-spya-ge30uz` | encyclopedic, science | 263 | 63k |
| `entropy-24-00930-spya-pywwkq` | **journal paper with figures** (MDPI *Entropy*) | 99 | 57k |
| `noema-mythology-of-conscious-ai` | magazine essay, argued | 141 | 53k |
| `towards-a-theory-of-bugs-the-ruliology-of-the-unexpected` | technical essay, many figures | 244 | 47k |
| `analog-cognition-and-consciousness-4-28-26-spya-f03kqf` | talk / notes | 92 | 45k |
| `after-work-we-ll-have-each-other-spya-we6h75` | essay | 97 | 34k |
| `cargocult-spya-rz663q` | a speech, short | 41 | 21k |

Normal articles in 261001b are 30–60k characters; six of the eight are in or near that band.

### Arms

Each mode runs through its **shipping generator** (`generateSketch`, `generateIdeas`,
`generateIllustrated`, and the Hierarchy harness's request), never a copy of the prompt. Per article
and surviving mode, four draws:

- **base-a, base-b** — today's request, twice. For Illustrated that means no `output_config` at all,
  byte-for-byte what production sends (Sol F4).
- **low-a, low-b** — the cheaper candidate, twice. Hierarchy's separate smoke used thinking off twice.

`medium` is bought only if `low` shows a clear loss (Sol's simpler design): a second round,
base-a/b against medium-a/b, same rules.

Held fixed so only effort varies:
- **Illustrated's input Sketch**: every Illustrated arm for an article gets the same Sketch (base-a's).
- **Illustrated's figures**: loaded once per article through the production loader, the identical
  list passed to every arm, its count and fingerprint recorded (Sol F6).
- **Ideas**: `previous: null`. **Every arm**: `cacheArticle` off, the standard (not High-powered)
  model, no reader profile.
- **Generation order**: shuffled per article with a recorded seed, so effort does not correlate with
  time of day or upstream load; the effort override is restored in a `finally` and asserted (Sol F12).

**Illustrated is judged on its brief**, the text the image model paints from — that is what effort
changes. Plates vary visibly between draws of one identical brief (evals/illustrated/run.ts header),
so one draw per brief would let image luck decide. Plates are drawn only for a sample shown in the
write-up (Sol F9).

**Hierarchy off was preflighted** on the real Messages wire before the panel: zero thinking tokens,
`end_turn`, valid JSON, a tree that builds (Sol F5). It failed at valid JSON twice, so the full
Hierarchy panel and its other fourteen `off` draws are cancelled (status above).

Remaining calls: 3 modes × 8 articles × 4 = 96 text calls, plus a few plates for the write-up.
Hierarchy's three smoke calls (one incumbent, two `off`) and the other smoke calls are already
spent. At $0.15–0.40 a text call, **about $20–45 more**, the long article the largest single item.
Hard ceiling for the whole eval: **$80**; past that I stop and report.

### What is recorded per run

Thinking tokens, output tokens, input tokens, cost (src/pricing.ts, as the ledger prices it),
wall-clock latency, stop reason, the effort actually sent, the serving upstream where the response
says it, and whether the output validated (the generator's own checks; a throw is a failure, with
its message). Everything goes in one stamped directory under `evals/results/`, raw outputs included.
Each mode owns its JSONL, order seed, README and configuration manifest, so Sketch and Ideas can run
as separate processes into that directory; Illustrated follows once Sketch's base-a files exist.
The environment override is process-local. A create-only claim is written immediately before every
paid cell, so a crash after payment but before its result is recorded makes resume stop for inspection
rather than buying the cell again. The corpus snapshot records one revision and refuses a different
one from another mode process.

### Seams in `src/`

- **Illustrated** gains an optional `effort` option on `generateIllustrated`, "never set in the app"
  like `systemOverride`. Unset, the request is exactly today's. If `low` or `medium` is adopted,
  production starts sending it.
- **Sketch and Ideas** already honour `SPIDERYARN_PIPELINE_EFFORT` via `effortFor`.
- **Hierarchy**: the harness's `CallSpec` becomes a union — adaptive with an effort, or off — and
  gains `smart-off` arms. Nothing in `src/` changes for the eval. Had `off` survived and been
  adopted, `EXPAND_EFFORT` would have been decoupled and kept at `low`: expansion is off for readers
  today and was not measured here (Sol F5).

### Judging, blind

For each surviving mode and article, **one anonymous lineup of the four draws** (Sol F8), labels W/X/Y/Z
shuffled per article with a recorded seed, the key kept in a file the judges never see. The judges
can of course count four candidates; they are not told what differs or that two pairs share recipes.

- **Judge 1, GPT Sol**: ranks the four against the mode's rubric, ties allowed, with one sentence
  on what separated each adjacent pair. One run per mode, all eight lineups.
- **Judge 2, Opus**, a different prompt and method: scores each of the four on every rubric
  criterion against **written behavioural anchors** (what a 1, 3 and 5 look like), all four in one
  context so the calibration is shared; the ranking is derived from the totals.
- **Me**: I read at least one lineup per mode myself, including one where the judges disagree.

Sketch is judged from its rendered picture and its scene JSON; Illustrated from its brief; Ideas
from its list with each cited passage quoted; Hierarchy from `blind.ts`'s rendering. Every judge
gets the article text with block ids.

### The rubric per mode

Written from [sketch.md](../project/sketch.md), [illustrated.md](../project/illustrated.md),
[ideas.md](../project/ideas.md) and [hierarchy.md](../project/hierarchy.md) as 3–5 gradeable
criteria each, and quoted verbatim in the research write-up.

### The measure, and the decision rule — fixed before the results

**Per article**, from a judge's ranking: **U** = how many of the four (low, base) pairs the low draw
wins; a tie counts ½. U runs 0–4; if effort made no difference, U averages 2. **Per mode**, the
mean U over the eight articles. Under no difference its standard error is about 0.46 (Mann–Whitney
variance for two against two, 20/12, over eight articles).

A judge response that omits a candidate, criterion or ranking is not a score: rerun that judge on
the same frozen lineup and record the failed attempt. If it still cannot return a complete result,
that judge and mode are undecided and no effort change is made from the panel.

- **Clear loss**: mean U ≤ 1.1 for either judge (about two standard errors below 2).
- **Possible loss**: 1.1 < mean U ≤ 1.5 for either judge.
- **No visible loss**: mean U > 1.5 for both judges.

Either judge's verdict counts: judge disagreement resolves to the worse of the two.

**Hard gates, every mode**: every low draw validated (a failure that would cost a reader a retry
counts against it); and the saving is real. For each article, reduction is
`1 - mean(low-a, low-b) / mean(base-a, base-b)` in thinking tokens; the **median reduction across
the seven articles under 100k characters** must be at least a third (Sol F10). A missing token count
fails this gate rather than disappearing from the median.

**Hierarchy's structural gates, had its smoke passed** (Sol F7), by failure class, never pooled across articles:
- Zero tolerance across all sixteen `off` draws: a hard failure, an invented or missing id, a missing
  gist, a dropped section.
- Repairs: compared as repair classes and moved-block intervals against the two base draws on the
  same article, not as the over-counted `repairedBlocks` sum.
- Boundaries, depth and fan-out: read per article, with a direction only where one means something.

**What gets adopted**:
- **Sketch, Illustrated, Ideas**: `low` unless *clear loss* or a hard gate fails; then the
  `medium` round under the same rule; failing that, today's effort stays. *Possible loss* still
  adopts: this is where Greg's leanings decide it (weak today; less valuable; modest loss accepted).
- **Standardising Sketch and Illustrated**: they end on one level — the higher of the two levels
  each passes on its own. (If Sketch passes `low` and Illustrated only `medium`, both go to
  `medium`.)
- **Hierarchy**: already stopped at its JSON hard gate, so `low` stays. Had the smoke passed, `off`
  would have required *no visible loss* from both judges **and** every structural gate.

### Written mid-run (19:47, 44 of 96 draws in, before any judging): the validity gate

Today's `high` also produces invalid answers — malformed JSON in mid-answer, the shipping parser's
refusal, e.g. `{"blockId": "spya-p4pyuy": "", "quote": "", …}`. At this point Ideas base had failed
1 of 12 draws and Sketch base 1 of 8. So "every low draw validated", read literally, would also fail
`high` itself, and would fail any candidate whose failure rate merely equals production's. That is
a flaw in the gate as written, found by the data rather than chosen after it, and it is recorded
here before the counts are complete.

What I will do with it, so it is fixed before the final counts: **report the literal gate, and
decide on the comparison** — a candidate fails the validity gate if its invalid draws exceed the
base arms' invalid draws on the same articles (16 against 16 per mode). On the counts so far Ideas
`low` (5 of 12) already fails that, so the Ideas `medium` round has been started early (it costs
about $2 and changes nothing about the rule). The base failures themselves are a production
reliability finding, written up separately.

**Ideas is decided by that gate (20:08, its 48 draws complete):** invalid JSON in **1 of 16** draws
at `high`, **10 of 16** at `medium`, **10 of 16** at `low`. Both cheaper levels fail the
comparison, so Ideas stays at `high`, and its quality panel is not run (most lineups would not have
four valid candidates to rank). Nothing retries a malformed answer in production — the reader gets
a failed card and a Retry, and the failed call is billed — so a 60% failure rate is not shippable at
any quality.

### Cache groups — what a change would move

Effort is part of the cache key (prompt-caching.md). Today `sketch` and `ideas` are in the big
`ids` group at `high` (with tweets, timeline, quiz, faq, simple). If both move to `low` they form an
`ids`+`low` group of two; to `medium`, they join `crossrefs`. Illustrated shares with nothing either
way. In production a cross-job share is almost never used (261001b), so this costs close to nothing
today, but it constrains the 261001o caching options, and the write-up says so.
`tests/article-cache-group.test.ts` will need its groups updated.

## Stages

1. **Harness** (this worktree): `evals/thinking-effort/`, the `smart-off` arms, the Illustrated
   seam, the lineup builder. Smoke on `cargocult`. Sol reviews the harness before the full run,
   because a harness bug spends the whole budget on the wrong question. Commit.
2. **Full runs** for Sketch, Illustrated and Ideas, in tmux. Results committed under `evals/results/`.
3. **Blind judging**: Sol and Opus; my sample; unblind; tabulate.
4. **Decide, change, write up**: the research doc
   (`docs/research/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md`),
   Sol on the decision with the numbers, the effort changes and the docs that own them, Sol on the
   code, gates, commit, push to `dev`, the feedback note and the awaiting-approval line. No deploy.

## Simpler options passed over

- **Judging by one model, or by eye.** Cheaper; the memory "re-reading your own work is a zero
  check" is why not.
- **Five articles, one draw per arm, base-vs-repeat as the threshold** — the first draft. Sol F1/F2:
  one control difference is not a noise floor, and a single lower draw has unmeasured variance.
- **Buying `medium` up front.** Only needed if `low` fails; Sol's simpler design.
- **Judging Illustrated on its plates.** Image-model variance would decide it (Sol F9).

## What this does not answer

- Equivalence: a loss too small for this panel to see may exist (above).
- High-powered (Opus) articles: untested; an effort change applies to them too.
- Hierarchy's expand calls at `off`: not measured, so not changed.
