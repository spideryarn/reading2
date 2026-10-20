# Structure answers the block's number, not its id

**Status:** revision 3, built in the worktree and measured; the blind quality panel and GPT Sol's
code review are below. Revisions 1 and 2 proposed a regex `pattern` on the id instead; the
measurement in § Evidence turned that down, and Sol's read-only review of revision 2
([261020aa-plan-review-sol.md](261020aa-plan-review-sol.md), *revise*) is what sent it back to be
measured properly. The file was renamed from `261020aa-block-id-fields-carry-the-id-pattern-in-the-schema.md`
when the design changed.

Feedback: spya-mxdf6r (#661, SPIDERYARN-READING2-MT), a suggestion from Greg (admin;
`feedback-reporter.ts` exit 0), 2026-10-20, from `/changelog#release-176`. Overseer queue item
`qi-9tqs9hpz`. It follows
[261019l](261019l-structure-recovers-a-start-that-splices-the-line-number-into-the-id.md), and it
does the deferred `qi-vcsypqem` ("stop inviting the model to splice the line number"). Greg asked
for this prompt change, which is why an unattended run makes one.

> In a recent feedback report, I talked about how Adrian had a problem loading the structure for the
> article he uploaded. … And I just saw in a recent changelog that you'd done something to make it
> more robust to AI errors. I'm just wondering, can't we define the schema, you know, for the JSON or
> whatever, or make sure it's valid JSON? I guess I'm just looking for a clean way to deal with this
> rather than a hacky way. Search the web for best practices.
>
> — Greg, 2026-10-20

## The short answer

**The JSON was already valid by construction.** Structure has sent a strict JSON schema since
`toc/11` (2026-10-02, [261001s](261001s-structure-answer-writes-code-to-correct-an-id.md)), and so
does every other JSON-returning stage bar the named exceptions in
[prompting-guide.md](../project/prompting-guide.md). What failed on Adrian's article was one *value*
inside valid JSON: a section's `start` named a block that does not exist. The prompt shows each block
as `[582] spya-xcf0dz <h1>: PART VI. EVIDENCE GAPS`, and the model, copying the id, wrote
`spya-582xcf0dz`. 261019l then decoded that after the fact, which is the hacky part.

**The clean fix is to stop asking the model to copy an opaque id at all.** The splice shows the
model already knows the line: it is trying to write 582. So `start` is now that number, an integer
in the schema, and code maps it to the block. There is no string left to mangle, and the decoder
goes.

## What the web says (2026-10-20)

- **Anthropic** strict schemas support `pattern` (regex, no lookaround/backreference/`\b`), `enum`,
  `const`, `anyOf`, `minItems` 0 or 1; not `minimum`/`maximum`/`minLength`/`maxLength`. Grammars
  have size limits and are cached for 24 hours; changing the format invalidates the prompt cache.
  [platform.claude.com § structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
- **OpenAI** strict mode supports `pattern` too.
  [developers.openai.com § structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
- **OpenRouter** documents only `response_format`; it recommends validating downstream, because
  enforcement varies by upstream.
- **Ids versus indices:** no vendor guidance and no paper either way. We measured it ourselves.
- **Constrained decoding and reasoning:** *Let Me Speak Freely?* (Tam et al., EMNLP 2024,
  [arXiv 2408.02442](https://arxiv.org/abs/2408.02442)) finds strict formats can cost reasoning, on
  older models. At `low` under a schema, Structure did no thinking in any answer below, in any arm.

## Evidence

All runs use production's own request (`wholeDocumentRequest`) at production effort, varying only
the prompt's two `start` passages and the `start` schema
([evals/structure-id-pattern/run.ts](../../evals/structure-id-pattern/run.ts); results in
`evals/results/structure-id-pattern/`). Adrian's article was read from production read-only
(`scripts/eval/skim-inputs-from-production.ts`, kept out of the repo). Every answer is also built
with the strict `"refuse"` parser, so 261019l's recovery flatters no arm.

| arm | what `start` is | Adrian's article: builds strictly | Part VI starts at its heading (block 582) | authored headings dropped / children dropped | corpus (3 articles × 5) |
|---|---|---|---|---|---|
| `incumbent` (`toc/12`) | the id, free string | 6 / 10 | **3 / 10** | 0 / 2 | (261001s: fine) |
| `pattern` | the id, `pattern: ID_PATTERN` | 20 / 20 | **9 / 20** | 11 / 9 | 15 / 15 build, 0 / 1 |
| `line` (`toc/13`, shipped) | the number, integer | 20 / 20 | **20 / 20** | 1 / 0 | 15 / 15 build, 0 / 0 |

- **The pattern arm closes the splice but not the fault.** The probe (`run.ts probe`, $0.003) shows
  OpenRouter's Anthropic route compiles the pattern: a lookahead is a 400 from the grammar compiler,
  and asked to write `spya-582xcf0dz` under the pattern the model wrote `spya-xcf0dz`. But on the
  real article, kept off the digit, the model often lands on a **real but wrong** id. It writes 590
  or 591, whose ids also begin with `x`. It writes 56, the table-of-contents line "Part VI. Evidence
  Gaps". It writes 615, or repeats 595. That is 10 of 20 answers, against 3 of 10 under the
  incumbent. A loud failure became a silent wrong boundary, which is the worse trade by this
  codebase's own rule (structure-prompt.ts § `EFFORT`, on welding). On source-f550ta it also wrote
  the heading at 12 as 13 in four of five answers; the line arm wrote 12.
- **The line arm put every part on a heading.** On Adrian's article, 20 of 20 answers have Part VI
  at 582, and every top-level start is an `h1`. They vary only in whether the foreword or the
  executive summary gets its own part. It had 1 authored heading dropped in 35 answers, against 11
  for the pattern.
- **Fewer top-level parts on scaling-hypothesis** (7–11 against 9–12) is grouping, not welding: no
  authored heading was dropped. The blind panel below is the check on whether readers would mind.
- **It is cheaper and faster:** about $0.27 and 33 s a call on Adrian's article, against $0.28–0.30
  and 38–43 s, because a number is fewer output tokens than an id.

## The design

1. **The prompt.** Two passages change and nothing else, exactly as measured:
   - "Give each child one "start": the id of the first block it covers." becomes "…the number in
     square brackets of the first block it covers — for the line "[582] spya-xcf0dz <h1>: …" that is
     582, an integer.";
   - the example's `"start": "<firstBlockId>"` becomes `"start": <firstBlockNumber>`.

   `toc12System` in the eval rebuilds `toc/12` from production by swapping them back, and a test
   pins the round trip, so the measured arm and the shipped prompt are the same bytes.
2. **The schema** types `start` as `{ type: "integer" }` at both depths. Anthropic's subset has no
   `minimum`/`maximum`, so the range is checked where the number is resolved.
3. **The converter.** `startAsId` (src/structure-starts.ts) maps an integer in range to
   `blocks[n].id` before the shared kernel runs. Anything else passes through unchanged and is
   refused or dropped like any other start that names no block. A string, from an answer stored
   before `toc/13`, still resolves as an id. The number indexes exactly the array the prompt
   numbered. Every caller parses against that array: `body` in `treeFrom` and the checkpoint gate,
   and the slice itself in src/structure-slices.ts.
4. **`PROMPT_VERSION` becomes `toc/13`.** The words changed, so the stamp moves, which also moves
   `EXPANSION_PROMPT_STAMP` to `toc/13+expand/8`; deepening checkpoints miss once, and deepening is
   off by default. The whole-document checkpoint key digests the wire body, so no `toc/12`
   checkpoint is replayed under the new request.
5. **261019l's line-number decoder goes** (`splicedLineNumber`, `outcome: "line-number"`,
   `startsRecovered`). There is no id string left to splice a number into.
   - What stays from 261019l is the principled part. A first child's start is not checked, because
     it is pinned to its parent's.
   - On the last answer, a start that names no block drops its child, within the one-in-ten
     budget.
   - For a number, "names no block" now means out of range.
6. **The scoped expansion call is unchanged.** It sends no schema yet, and its prompt numbers a
   slice from 0 and asks for ids; deepening is off by default. Changing it is the follow-up below.

## Which other steps would benefit

Greg asked which other pipeline steps would benefit. The pattern was taken out of the other stages
again, because the evidence above is that constraining an id's shape can turn a dropped item into a
silently wrong one.

Thirteen stages ask the model to copy a block id into a free string, and each drops an id it cannot
find:

- Crossrefs, Bibliography, Illustrated, Timeline, Simple, Quiz, Ideas, Sources claims, Relations,
  Sketch, FAQ and Tweets;
- Matter on the chat wire, which also has no `assertNoBlockIdEnums` declaration.

They would be the next candidates for the same change, but each renders its article with
`articleWithIds` and **no numbers**. So each is its own measured prompt change, and nobody has seen
any of them fail this way. Queued as one item, with this evidence, rather than built blind.

## Passed over

- **A `pattern` on the id** (revisions 1 and 2). Measured above: it makes the splice impossible, and
  makes a wrong-but-real id three times as likely on the article that failed.
- **Both line and id, refused when they disagree** — Sol's design-consult recommendation
  ([261020aa-design-consult-sol.md](261020aa-design-consult-sol.md)). The id is the half that gets
  copied wrong (10 of 20 under the pattern), so the pair would refuse often. Refusing sends the step
  back to the re-ask, and the reader back to Retry. The number alone was right 20 of 20.
- **An `enum` of the article's ids.** `assertNoBlockIdEnums` exists to forbid it: a grammar of up
  to 2,000 values compiled per article, and a mistyped prefix forced to finish as some real id.
- **Raise effort, or a think-first line.** That trade is settled by 261001s's eval. Neither makes a
  start valid by construction.
- **Keep the decoder as defence in depth** (Sol, plan review, finding 1, against revision 2's
  pattern design). With an integer there is no id string for a splice to appear in, so the decoder
  could only fire on a pre-`toc/13` answer. None is replayed under the new request.

## Stages

One stage:

- the prompt, the schema and `startAsId`;
- `toc/13`;
- the decoder removed, its tests rewritten to pin the new behaviour;
- a new test file (`tests/structure-block-number-start.test.ts`), red on `HEAD` because `startAsId`
  and the integer schema do not exist there;
- the docs (structure-step.md, prompting-guide.md, and 261019l's status line).

Then:

- **the blind quality panel**, the pre-registered rule from 261001s § Stage 2: `toc/12` frozen
  against `toc/13`, the eight articles, two draws per arm, Sol ranks and Opus scores. Results below;
- **GPT Sol's code review.**

## Results

**Blind quality panel: no loss.** The rule is 261001s's, unchanged. The panel compared `toc/12`
frozen (`evals/structure-whole-document/toc12-frozen.ts`) against `toc/13`, on the eight articles,
two draws per arm, with Sol ranking and Opus scoring, blind. Runs are in
`evals/results/hierarchy-structure/2026-10-20-17-25-14-toc12-frozen+incumbent/`, and judging in
`evals/results/structure-id-pattern/judging/structure/`.

| article | U, Sol rank | U, Opus score |
|---|---:|---:|
| replication-crisis | 4 | 3.5 |
| entropy | 2 | 1.5 |
| noema | 3.5 | 2 |
| towards-a-theory-of-bugs | 2 | 2 |
| analog-cognition | 1 | 0.5 |
| after-work | 1.5 | 2 |
| spider-silk | 4 | 4 |
| cargocult | 2 | 0 |
| **mean** | **2.50** | **1.94** |

- Both means are above 1.5, so the worse judge still says no visible loss.
- One `toc/12` draw on spider-silk was invalid: a child's `start` was an empty string, the class
  this change removes. Without spider-silk the means are 2.29 and 1.64.
- The per-article dips, named rather than hidden: Opus gives cargocult 0 and analog 0.5, and Sol
  gives analog 1.
- Hard gates:
  - invalid draws: 1 for `toc/12`, 0 for `toc/13`;
  - children dropped and authored headings dropped: 0 in both arms;
  - mean depth-1 parts: 8.1 in both arms.
- `toc/13` was slightly cheaper and faster: $1.09 against $1.13 for 16 draws, and 19.4 s against
  20.7 s.
- **Neither arm thought at all** (0 reasoning tokens in 32 draws, where `toc/11` averaged 3,400 in
  261001s). It is equal across the arms, so it does not bear on this comparison. But Structure at
  `low` now does no thinking, and that is worth knowing.

The panel's procedure differed from 261001s in three small ways. The eight articles are not in this
box's local database, so their 261001s corpus files were read from the primary checkout and not
committed. Both judge prompts gained a line telling the judge not to open the run directory, the
eval code or these plan files, which keeps them blinder. Opus scored through `scripts/run-claude.ts`.

**GPT Sol's code review: "ship after my fixes"**
([261020aa-code-review-sol.md](261020aa-code-review-sol.md)). It fixed:

- three request pins I had missed (the prompt hoist, the slices request digest, and request
  parity). Re-pinning them also proves the canonical digest moved, so no `toc/12` checkpoint can
  replay;
- the harness, which had scored the line arm through ids rather than through `startAsId`;
- a missing test that a number resolves against a slice's own zero-based array
  (`tests/structure-slices-adversarial.test.ts`);
- the lost coverage of `treeFrom`'s earlier-fault failure message, now on a drop;
- decoder-era bookkeeping and comments left behind.

It left two things, both now queue items:

- the prompt still ends "Use only block ids that appear in the input". Those are the measured bytes,
  so changing them is a measured revision of its own (`qi-snsehjva`);
- a few historical eval helpers still emit id starts. They parse unchanged.

**Queued:** `qi-pdsk59zs`, the other thirteen stages, each to be measured on its own;
`qi-snsehjva`, the stale sentence and the scoped expansion call. `qi-vcsypqem` is done by this
change.
