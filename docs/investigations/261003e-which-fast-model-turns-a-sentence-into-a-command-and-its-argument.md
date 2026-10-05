# Which fast model turns a sentence into a command and its argument?

Written 2026-10-03, Stage 1 of
[plan 261003k](../plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md).
It follows [261002c](261002c-jev-picks-a-command.md), which asked only whether Jev could pick a row.
The numbers are in `evals/command-pick/results/261003/summary.md` (`summarise.ts`), the saved
answers are beside it, and how to rerun it is in
[evals/command-pick/README.md](../../evals/command-pick/README.md).

**Measured again on 2026-10-04**, production's arrangement only, after the list gained nicknames and
the two *Find more* rows:
[261004e](261004e-command-pick-re-measured-after-more-nicknames-and-find-more-rows.md).

## The question

A reader types or dictates a sentence into the command bar and it matches none of the bar's rows.
Which arrangement of models turns that sentence into the right row, or one of the five argument
commands **with its words**, or "none" — fast enough to feel like the bar?

> let's start with an eval to see if Jev can do a good job of it. And if not, then fine, let's use
> something like DeepSeek or Luna. It's got to be something with quite a low latency.
>
> — Greg, 2026-10-03 (spya-t0dg9u)

## What was measured

- **The list is the bar's own.** 64 rows: what the bar gives an owner on an article with
  Experimental on, read from `src/command-pick-catalogue.generated.json`, which a test writes from
  the functions the bar itself calls. Plus five argument commands whose words we wrote (`arg:find`,
  `arg:jump-first`, `arg:glossary`, `arg:tag-add`, `arg:tag-remove`) and `none`. 70 options.
- **192 requests**, all labelled before any answer was scored:
  - the 72 from the first run, relabelled against the real ids;
  - 80 new ones of ours: Greg's two, 27 sentences for the five argument kinds that the bar's verbs
    do not parse ("is consciousness mentioned anywhere", "take the tag draft off"), ten dictated
    rambles, rows the first run never asked for, and 20 with no right answer;
  - **a blind set of 40**, written by a separate Sonnet subagent that saw only each row's id, name
    and one-line description.
- **The bar answers 6 of the 192 itself** (`rankCommands` or `parseArgumentQuery` finds something).
  Production never sends those, so **the 186 it cannot answer are the set that counts**.
- **An answer is scored whole**, after the check production will make: an id that was not offered
  is `none`; an argument whose words are empty or are not in the sentence is `none`; and the
  outcome is right when the id is accepted *and*, for an argument command, the words are exactly
  the expected ones.
- **The arms**, one call per request:

  | arm | what it is asked |
  |---|---|
  | `jev-pick` | Jev (`typesafe/jev-1.13`), one `choice` over the 70 options |
  | `jev-words` | the same request, plus one yes/no question per word: is this word part of what to look for, define or tag? The argument is the words scored 0.5 or more |
  | `deepseek` | `deepseek/deepseek-v4.1-flash`, JSON `{id, argument, confidence}`; reasoning effort `none`, on the zero-retention upstreams (Fireworks answered every call) |
  | `luna` | `openai/gpt-5.6-luna` (the quick tier), the same; reasoning effort `none` |
  | `haiku` | `anthropic/claude-haiku-4.5`, the same; no `reasoning` sent, since it does not think unless asked |
  | `jev-pick` + each of the three | Jev picks; whenever it picks an argument command, right or wrong, the small model is asked only for the words. Latency and cost are the two calls added |

  No chat arm spent a thinking token (checked on every response).

## The numbers

On the 186 requests the bar cannot answer itself:

| arrangement | calls | whole outcome right | median / p90 latency | p90, argument requests | cost per request |
|---|---|---|---|---|---|
| Jev, pick only | 1 | 133 (72%) — it has no words | 0.28 s / 0.34 s | 0.33 s | $0.00021 |
| Jev, pick + word questions | 1 | 162 (87%) | 0.29 s / 0.33 s | 0.32 s | $0.00022 |
| DeepSeek V4.1 Flash | 1 | 176 (95%) | 1.39 s / 2.54 s | 2.11 s | $0.00009 |
| **GPT Luna** | 1 | **178 (96%)** | 1.11 s / 1.39 s | 1.40 s | $0.00011 |
| Haiku 4.5 | 1 | 174 (94%) | 1.12 s / 1.94 s | 1.31 s | $0.00461 |
| Jev picks, DeepSeek extracts | 1–2 | 175 (94%) | 0.29 s / 1.81 s | 2.36 s | $0.00022 |
| Jev picks, Luna extracts | 1–2 | 175 (94%) | 0.29 s / 1.20 s | 1.58 s | $0.00021 |
| **Jev picks, Haiku extracts** | 1–2 | 175 (94%) | **0.29 s / 1.09 s** | 1.32 s | $0.00024 |

By set (whole outcome right):

| | Jev pick + words | DeepSeek | Luna | Haiku | Jev + any extractor |
|---|---|---|---|---|---|
| blind set (40) | 35 | 40 | 39 | 40 | 39 |
| wants an argument, bar cannot answer (43) | 28 | 43 | 41 | 42 | 42 |
| no right answer (35) | 28 | 31 | 32 | 32 | 27 |

**Picking the id**, ignoring words, all five are level: 174 to 177 of 186 (94–95%). Jev's 94% is the
first run's 94%, on a longer list and mostly new requests.

**The words.** Every chat model, asked for the id and the words together or for the words alone,
returned exactly the expected words on every request but one (Haiku alone, "define entropy" for
"entropy"), and never words that were not in the sentence. **Jev's word questions do not work**:
exact on 33 of 48, and the misses are the shape you would guess — it keeps a neighbour ("neuroscience
tag", "this neuroscience", "article consciousness"). Moving the cut to 0.7 gets 39 of 49. Tags are
where it fails; it was right on nearly every find, jump and glossary request.

**When Jev's first choice is wrong, a right row is in its top three: 11 of 11.**

### Confidence, and what would have run at once

Under the plan, only a row that just moves the reader may run without a second Enter; argument
commands, anything that generates, Archive, Export and the Experimental switch are always shown
first. Of Jev's kept answers of that kind, how many were wrong:

| cut | would run at once | wrong |
|---|---|---|
| none | 56 | 5 |
| 0.8 | 42 | 4 |
| 0.9 | 37 | 1 |
| 0.95 | 35 | 0 |

The five: "highlight the bit about consciousness" → the Search mode (0.83); "how much am I paying
for this" → Metadata (0.56); and three requests about *all* my articles that went to this
article's own section — "make all my articles public" → Access & sharing (0.91), "stop sharing all
of my articles" → the same (0.87), "run everything again on every article I have" → AI processing
(0.81). Each opens a page or a section; none changes anything.

The chat models' confidence is a number they were asked to write down, and it does not separate
right from wrong: Luna said 0.98 for "archive everything on my shelf" → Archive and for "regenerate
the timeline for all my papers" → Timeline › Run again.

### Requests with no right answer

Every arm picked a row that writes or spends for at least one of them: Archive for "archive
everything on my shelf" (Jev 0.80, Luna 0.98) and for "archive this for good so it can never come
back" (Jev, DeepSeek 0.90, Haiku 0.85); Timeline › Run again for "regenerate the timeline for all
my papers" (all but Haiku); Archive for "delete this article" (DeepSeek, Haiku 0.85 — Jev went to
Metadata and Luna said none). Six such picks by Jev's two arms and eight by the three chat models.
None would run without a second Enter, because of what the row is, not because of how sure the
model was.

## What this says

**The predeclared reading** (GPT Sol's F6 on the plan, fixed before any answer was scored): on the
186, the whole outcome right at least 85% of the time and p90 latency at most 1.2 s; among
arrangements meeting both, one call when it is within 3 points of the best, otherwise the more
accurate.

Three meet both: Jev with its word questions (87%), Jev then Luna (94%, p90 1.20 s), Jev then Haiku
(94%, p90 1.09 s). The one-call arrangement is 7 points behind, so **the rule selects Jev for the
pick and a small model only when the pick takes an argument**, and between the two extractors it
lands on Haiku by a tenth of a second.

What we would say beside that:

1. **Luna alone is the most accurate thing measured and misses the latency floor by 0.19 s.** One
   call, 96%, better on `none` than Jev (32 of 35 against 27), a fifth of a second over. If the
   floor were 1.4 s the rule would pick it. Whether a 1.1 s median feels like the bar is a product
   call the eval cannot make; the hybrid's median is 0.29 s because three requests in four never
   make the second call.
2. **Luna against Haiku as the extractor is not settled.** Both were exact on all 48. Haiku was
   steadier (p90 1.0 s against 1.4 s, and Luna had single calls of 13 s and 26 s); Luna is the
   model the quick tier already uses and costs a fifth as much per extraction ($0.00003 against
   $0.00017). Either is fine.
3. **Argument requests are the slow ones**: p90 1.3–1.6 s in the hybrid, over the floor on their
   own. They are always shown as a row first, so the wait ends in something to look at, not in an
   action.
4. **Start the run-at-once cut at 0.95, not the 0.8 the first run suggested.** At 0.8 four wrong
   answers would have run and at 0.9 one; at 0.95 none, for 35 automatic runs against 0.8's 42. The evidence is
   five wrong answers, most from requests written to be traps, so this is a starting point fitted
   to one table — the same weakness 261002c named. What is solid is the other half: when Jev is
   unsure or wrong the right row was in its top three every time, so showing the top three is a
   good fallback.
5. **Jev is the weak one on "none".** It reads "all my articles" as "this article". Since those
   picks only open a section, that is a wrong page, not harm — but it is the hybrid's cost against
   Luna alone.
6. **Confidence must not gate anything that writes or spends**, from any model. That rule is the
   plan's already; this is the measurement behind it.

## Things found on the way

- **An id with the article's address in it is easy to get wrong.** Metadata's id is
  `page:/read/<slug>/metadata`; Luna answered `page:/read/metadata` once. The check turned it into
  `none`, which happened to be right. Stage 2 should send the model short keys.
- **The bar's own verb parse is wrong on one of the six it answers**: "find mentions of dopamine"
  gives the words `mentions of dopamine`. Every model gave `dopamine`.
- **Luna and DeepSeek cached the list** (about 3,950 of 4,000 input tokens read from cache), which
  is why they cost a fortieth of Haiku, whose request set no cache marker. In production the list
  changes with the reader's state, so expect less caching than this.

## Caveats

- **Small, and mostly ours.** 152 of the 192 requests were written by the agent that wrote the
  prompts. The blind 40 came out *easier* than ours (every arrangement that returns words scored
  88–100% on them), so they are a check on bias, not a harder test.
- **One run per arm**, from the Hetzner box. Run-to-run variation and latency from a reader's
  browser through our server are unmeasured. The latency floor is passed or missed by 0.1–0.2 s,
  which is inside what a second run could move.
- **The selection rule arrived after the calls were made**, with the coordinator's relay of the
  plan review, and before any answer was scored or read. The same message added eight
  destructive-sounding requests (`n73`–`n80`) and a confidence field for the chat models; the chat
  arms were rerun whole with it, and the first pass's answers are not used.
- **No label was changed after seeing an answer.** Labels that differ from the first run's
  (`p01`, `p09`, `p11`, `p14`, `p38`, `p42`, `h01`, `h19`) and the two of the blind writer's we
  changed (`b35`, `b39`) are marked in `phrases.ts` with the reason; all were decided before
  scoring. Some are judgement calls: "delete this article" accepts `none` or the Metadata page
  (the bar itself nicknames that row `delete`), and a question about the article's content accepts
  Chat or `none`.
- **Exact words is a strict score.** "the hippocampus" for "hippocampus" was accepted where we
  listed it beforehand; nothing else was.
- **One slice of the list**: an owner, on an article, Experimental on. The other places the bar
  opens have fewer rows.
- **Jev is still alpha**, and its pick goes through a declared bypass here; the gateway has had a
  Decisions route since 2026-10-02 but not a `choice` question.
- **The chat arms did not go through `openRouterJson("eval", …)`**: that seam sets `reasoning` and
  `provider` itself, and those are what the arms differ in. They use a new declared bypass,
  `command-pick-chat`.

## Spend

$1.87 in all, recorded in the ledger as job `eval`: $0.95 for the first pass of every arm and the
probes, $0.90 for the chat arms' second pass with the confidence field, $0.01 for Jev on the eight
added requests and the hybrid's extraction calls. Haiku is $1.77 of it. The blind set's subagent
ran on the session's subscription.
