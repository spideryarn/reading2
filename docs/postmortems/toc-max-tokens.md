# The table of contents that ran out of room

**2026-08-25.** Greg pasted <https://www.anthropic.com/constitution> into the Add box. It fetched,
extracted and split fine, then stopped at stage 4 with:

> **Building the table of contents**
> Hit max_tokens — the JSON is truncated. Raise it and retry.

There was a Retry button next to it. Pressing it made the identical call and failed identically.

## What actually happened

[`src/toc.ts`](../../src/toc.ts) made one model call with `max_tokens: 32000`, a number somebody had
typed once. The job record says the run took six minutes and its last progress line was
`20k characters of tree so far`.

That last detail is the whole story. Twenty thousand characters of JSON is five or six thousand
tokens. The allowance was 32,000. So **roughly 26,000 tokens had gone on thinking** before the
answer was half written.

The measured numbers:

| | blocks | gistable | input tokens | answer needed |
|---|---|---|---|---|
| the article that worked | 141 | 117 | 18,630 | ~8,600 |
| the constitution | 360 | 360 | 48,107 | ~20,000 |

Neither was close to a context-window problem — 48k of input against a 1M window. The problem was
entirely on the output side, and it had two halves that had been quietly added together:

1. **`max_tokens` is not an output cap. It is an output-plus-reasoning cap.** On Claude Opus 5 the
   thinking tokens come out of the same allowance as the answer. `budget_tokens` no longer exists on
   this model, so how much thinking happens is not something the caller sets — `output_config.effort`
   is the only dial, and this call ran at `high`.
2. **Stage 4's answer grows linearly with the article, without a bound.** It writes one `navLabel`
   for every gistable block. Two and a half times the paragraphs, two and a half times the JSON.

A fixed number cannot be right for a quantity that scales with the input and shares its allowance
with a quantity nobody controls. 32,000 was simply the article length at which that stopped being
survivable; 141 blocks fit, 360 did not.

## Why nothing caught it

The suite is good and it tested none of this. Every stage-4 test is about `buildTree` — the model's
proposal becoming the stored artefact — because that is where a wrong answer would be *silent*. The
request itself had no test at all, on the reasonable-sounding grounds that a request is just
parameters.

It was, and one of the parameters was wrong for every article above a size nobody had tried.

## The fix that didn't work, which is the interesting part

The obvious fix is to compute the budget instead of typing it: estimate the answer from the block
count, add a reservation for thinking, pass the sum. That is what went in first.
`THINKING_HEADROOM` was set to 40,000 — the 26,000 observed above, with half again on top — and the
constitution's budget went from 32,000 to **77,100**.

It failed again.

This time it had emitted 40,000 characters of JSON before it ran out — about 13,000 tokens of answer.
So of a 77,100-token allowance, roughly **64,000 went on thinking**. The reservation had not been too
small. Given more room, adaptive thinking at `effort: "high"` had simply taken it.

That is the thing worth carrying away from this bug, and neither the first fix nor the reasoning
behind it had it:

> **Adaptive thinking expands into whatever room you give it.** Raising `max_tokens` raises the
> thinking with it, so the two do not converge. No headroom constant is safe on its own.

`max_tokens` is a ceiling, not a leash. The leash is `output_config.effort`, and until this run
nothing in the pipeline had ever set it to anything but `"high"` — not from a comparison, but because
`"high"` was what got typed when the stages were written.

## What changed

[`src/token-budget.ts`](../../src/token-budget.ts) now owns the arithmetic, and writes the budget as
what it actually is: **the answer the stage estimates, plus a flat reservation for reasoning.**
`THINKING_HEADROOM` stays at 40,000, now documented as slack rather than as a fix.

And **stage 4 dropped to `effort: "medium"`.** It is the stage that can most afford to: the reasoning
it needs is finding topic shifts and balancing the levels, which is real work done once, while the
bulk of what it writes is one mechanical label per paragraph — and a mechanical label does not get
better for being brooded over. The two sibling stages keep `"high"`, because their answers are short
enough that the reasoning is nearly all of what they do.

Each stage estimates its own answer, because only it knows the shape of its JSON.
[`estimateTocTokens`](../../src/toc.ts) does stage 4's from `blocks.json`, on constants measured by
rebuilding three finished trees into the JSON the model emits and counting them: about 40 tokens per
nav label, 106–167 per internal node. The constitution now gets 77,100 instead of 32,000.

Two distinct failures, kept distinct:

- **`budgetFor` throws before the call** when the estimate plus the reservation exceeds what one
  response can hold — around 876 blocks. Nothing is spent, and the message says the article needs
  section-by-section processing, which is [not built](../project/table-of-contents.md#long-articles).
- **`stop_reason: "max_tokens"` still throws**, with a message that carries the budget and the
  estimate so the constants can be re-tuned from the failure, and that does not tell the reader to
  retry. Since 2026-08-26 it also carries `failureKind: "bug"`, so the card withholds the button —
  and its last sentence was **softened at the same time**, which matters more than the tag. It read
  *"Retrying will fail the same way until it does"*: a proof, from two observations on one article.
  Unlike `budgetFor` above this is not arithmetic — adaptive output varies between calls — so it now
  says *unlikely*. A hidden button under a claimed certainty would have been the same overclaim
  wearing a different hat.

What was deliberately **not** done: keeping whatever JSON arrived and building a tree from the part
that made it. A table of contents that silently describes two thirds of an article is precisely
[silent-success.md](../reusable/silent-success.md), and it is worse than the bug it would hide. The
failure stays loud.

## The quiet version of the same failure, which was already possible

Reviewing this, GPT-5.6-sol pointed at the thing next door, and it is the better catch of the two.

`stop_reason: "max_tokens"` only fires when the API cuts the response off mid-token. A model that
*senses* it is running out of room does something else: it closes its JSON tidily and writes fewer
labels than there are paragraphs. That parses. `buildTree` then builds a completely valid tree from
it — correct partition, every block tiled, every id real — with a hundred paragraphs missing from
the sidebar and nothing anywhere saying so. `validate-tree.ts` only *warns* about an unlabelled
gistable leaf, deliberately, and the queue never runs it.

So the loud failure this bug had was one prompt-tweak away from becoming a silent one. `checkCoverage`
in [`src/toc.ts`](../../src/toc.ts) now stands between them: it refuses a tree that labels less than
95% of the gistable blocks, and refuses any label naming a block that is not in the article. 95% and
not 100% because the escape hatch is real and documented — the model may skip a trivial transition
sentence — but every real tree we have came back at 100% (29 of 29, 117 of 117, 18 of 18), so it has
never actually used it, and a twentieth of an article going missing is not editorial judgement.

## The two siblings had the same bug, unfired

[`src/arc.ts`](../../src/arc.ts) and [`src/tweets.ts`](../../src/tweets.ts) both passed
`max_tokens: 16000`. Their answers are small and roughly constant — a sentence per part, a bounded
thread — so it is tempting to call them fine.

They were not fine, and the reason is the half of the problem that has nothing to do with the answer:
**both read the whole article and think about it inside that same 16,000.** The arc was next in the
queue behind the ToC on this very article, with 48k tokens of input and an allowance smaller than the
one that had just been exhausted by thinking alone. It would have failed on its turn. Both now use
the same budget function.

## What would have caught it earlier

- A test that the request scales with the article. [`tests/token-budget.test.ts`](../../tests/token-budget.test.ts)
  now asserts a 400-block article gets more than five times a 40-block one — anything that returns a
  constant fails it.
- A test that the estimate clears what a **real** tree cost, computed from the committed
  `example/` fixture rather than from the estimator's own arithmetic, so it moves if the fixture
  does. The first draft of the constants passed a self-consistent test and was under two of the three
  real trees.
- Reading the progress detail as evidence. `20k characters of tree so far` was in the job record the
  whole time and it says, to anyone who does the subtraction, that the answer was not what filled the
  budget. Nobody did the subtraction, and the failure message did not invite it — so the message now
  does it for you, and reports the answer and the reasoning as two separate figures. That one line
  is the difference between diagnosing this in one run and diagnosing it in two.

## And a second bug, found by finally running the thing

With the budget fixed, the constitution's tree built — and
`npm run validate-tree -- data/constitution` reported **eleven** structural failures, all of the form
`sourceHeading "Claude's Constitution" does not match any heading block in its range`.

Every one of the eleven was an apostrophe. The blocks carry the publisher's curly `’`; the model had
quoted the headings back with a typewriter `'`. Not one of the eleven was a heading the model had got
wrong, which is the only thing that check exists to catch — and this article was simply the first to
reach it with apostrophes in its headings. `sameHeading` in
[`src/validate-tree.ts`](../../src/validate-tree.ts) now folds the punctuation that has two spellings
before comparing, and still fails a heading that was rewritten rather than quoted. See
[table-of-contents.md](../project/table-of-contents.md#the-apostrophe-that-failed-eleven-headings).

It is worth noting *how* this was found: by running the stage on the real article rather than
stopping when the tests went green. Nothing in the suite could have caught it, because every fixture
in the repo was written in ASCII.

## What is still open

**~~The Retry button still appears under a permanent failure.~~ Fixed, 2026-08-26.** A job now
carries `failureKind` beside the message it already copied off the failing step, and the card asks
`jobWorthRetrying(job)` before drawing the button. `TooLongForOnePass` says `blocked`, so the button
that started this is gone.

Three things about the fix are worth keeping, because each went against the obvious version:

- **Not the `permanent` flag this paragraph used to propose.** Wrong concept, not merely a coarse
  one: configuration changes, providers change their policies, websites change what they serve.
  Nothing here is permanent. The answerable question is *should this unchanged attempt be offered
  again now?*, which is what `FailureKind` in [`src/messages.ts`](../../src/messages.ts) already
  means — and three of its four members answer no. `TooLongForOnePass` is `blocked`, the kind that
  means a request cannot pass a size or policy boundary. A fifth kind would have bought no new
  reader action.
- **A field, not a bracketed code.** The codes in `src/messages.ts` exist because a stored comment or
  chat turn keeps `err.message` and has nowhere else to put anything. A job is a struct with room for
  a field, so it does not inherit a workaround it does not need.
- **Not just this one case.** Fixing `TooLongForOnePass` alone would have been the same bug with a
  mechanism on top making it look handled. Four other failures cannot come out differently either,
  and all four are permanent for one reason: `forceForRetry` forces from the first step that did not
  finish, so **a retry never re-runs a step that succeeded** and therefore re-reads the identical
  artefact. A missing source URL, a page Readability has already refused over cached bytes, a tree
  that does not contain its own root, a PDF over the page cap. Model-output failures — malformed
  JSON, the wrong number of arc sentences, an empty answer — keep the button, because the next call
  is a fresh draw.
- **And truncation, which is the interesting one**, added a round later. Running past `max_tokens`
  mid-answer is *not* arithmetic, so it is the one entry here that says **unlikely** rather than
  *cannot* — see [What changed](#what-changed) above for the wording, which was softened rather than
  left to disagree with a hidden button. Counting it turned up the thing a report of four had
  missed: there were **six** call sites, not four. `glossary` and `tweets` meet the same truncation
  and had been left out of every list of this, including the one in this file, because each stage
  wrote its own `new Error` around the shared message and nothing tied the six together. That is now
  a compile error rather than a habit — `truncationFailure` returns the `Error`, so a stage cannot
  wrap it in one of its own. The sixth site, `src/labels.ts`, is deliberately untagged: it retries
  the batch itself with double the headroom, so "the same attempt twice" is not what happened.

The mechanism is [`src/job-failure.ts`](../../src/job-failure.ts); the design is written up in
[ingest-queue.md § The failures Retry is not offered under](../project/ingest-queue.md#the-failures-retry-is-not-offered-under).
One trap is worth naming here. A `failureKind` read off a thrown object is a value from outside the
type system — a JSON round-trip, or an error built by a version of this code that knew a kind this
one does not — and handing that straight to `canRetry` looks it up in a `Record`, misses, and
returns `undefined`. Which is falsy. An unrecognised kind would have **hidden** the button, which is
the wrong direction and would have looked exactly like the feature working.

**~~Section-by-section generation is still not built~~ — built, 2026-08-26.** The batching lands in
[`src/labels.ts`](../../src/labels.ts) and the plan is
[toc-scaling.md](../plans/toc-scaling.md). Exactly the shape GPT-5.6-sol recommended when it reviewed
this bug: one whole-article call for the structure, and the nav labels in section-sized batches at
lower effort, in parallel, with exact coverage checked before anything is published. The ceiling went
from 876 blocks to 1,976 — about 55,000 words to about 123,500.

Two things that only showed up once it ran, and both belong in this file because both are this bug's
family. First, the labels are 73% of what this stage was asking for, measured off the tree: **the
thing that broke was mostly the thing that is invisible in reading mode**, which nobody had counted
before the split forced the question. Second, at `effort: "medium"` a label batch returned 41 labels
for the 42 paragraphs it was asked about — twice — well-formed, untruncated, and silent. The
`(ordinal, label)` wire format caught it. That is the same failure as this postmortem's, one order of
magnitude smaller and with the loud half removed, and it is the reason the exact-set check is not
optional.

**~~Effort has not been swept.~~ Partly swept, 2026-08-26.** The structure call is back at
`"high"` — with the labels gone it has room to think, and boundaries and titles are the part worth
thinking about. The label batches were compared at `"low"` against `"medium"` on the 141-block
article: `"low"` returned every label twice over, `"medium"` dropped one twice, and the eval's
numbers were identical on the batches that came back whole. `"low"` stays. `src/arc.ts` and
`src/tweets.ts` are still `"high"` by inheritance rather than by comparison.

The sweep is now possible because there is somewhere to record it: [`evals/`](../../evals) holds a
mechanical eval over committed artefacts, and `evals/results/` holds the numbers, so the next such
question gets answered against a file rather than against a memory.

## The general shape

> When a model call has a number in it, ask what happens to that number when the article gets three
> times longer. If the answer is "nothing", the number is a bug that has not fired yet.

The same question applies to anything else sized once against the article we happened to have —
[the reading view's column widths](../project/granularity-zoom.md), the fetch cap, the thread length.
This one fired first because stage 4's output is the only one that grows without a bound.

## See also

- [table-of-contents.md § The budget](../project/table-of-contents.md#the-budget) — the design, kept
  where stage 4's other decisions live
- [silent-success.md](../reusable/silent-success.md) — why the fix does not salvage a partial answer
- [ingest-queue.md](../project/ingest-queue.md) — the Retry button, and what it does and doesn't redo
