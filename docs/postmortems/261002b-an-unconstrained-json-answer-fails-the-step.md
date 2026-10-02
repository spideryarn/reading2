# An unconstrained JSON answer fails the step

**2026-10-02.** Plan: [261001s](../plans/261001s-structure-answer-writes-code-to-correct-an-id.md).
Found by [261001p § Ledger](../plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md)
while measuring something else.

## What happened

The Structure (hierarchy) call answers in JSON. Every node carried
`"range": ["<firstBlockId>", "<lastBlockId>"]`. Sometimes the answer contained this instead of a
string:

```
"range":["spya-y09vju","spya-zhzzzz".replace("zhzzzz","jcpyd5"),],
```

`parseJsonAnswer` refused the whole answer, the step failed, and the reader got a Retry button for
a call that had already been billed. On `toc/10` it happened in **2 of 70** fresh answers (stage 0
of the plan), and in 4 of the 32 earlier answers kept by 261001p. Eight edits were found in all.
**Seven were on a range's end and one on a start.**

The same answers showed what the model was doing. In two of the eight, the receiver was an
invented id and the replacement a real one: a mistyped id, corrected. In one, the "correction" was
a no-op, `"spya-c5z6sr".replace("spya-c5z6sr","spya-c5z6sr")`, which landed on a block *before* the
range's start. In others, one real id was replaced with another: a change of mind about a boundary,
not a typo.

**It was not only Structure.** The thinking-effort eval
([research 261001c](../research/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md))
found Ideas and Sketch writing malformed JSON of a different shape (`{"blockId": "spya-p4pyuy": "", …}`):
1 in 16 each at today's effort, and Ideas 10 in 16 below `high`. Production's one inspected Sentry
event of this kind (SPIDERYARN-READING2-5S) was the Quotes stage. Skim (then Trajectory) had the
`.replace` habit with quote ids, and fixed it in its own way
([260928a](../plans/260928a-trajectory-mode-stage1-real-runs.md)).

## Root cause

A model writing JSON token by token cannot take back what it has written. When it decides that
something it is writing is wrong, it repairs it in place, and in a data format the only repair it
knows is code. Nothing stopped it, because **we asked for JSON in prose and nothing enforced the
format.** Every pipeline stage relied on a sentence in the prompt ("JSON only, no prose") and on a
strict parser afterwards. The parser was right to refuse. Its refusal was simply the first place
anything noticed.

Structure made it worse by asking for the hardest id at the worst moment. A section's end is "the
block before the next section's start". The model has to work it out and then copy a random
11-character id from a paragraph it was not attending to. The end was also **redundant**:
`planChildRanges` believes starts and computes every end, and the scoped expansion call had already
stopped asking for ends for exactly this reason.

## The class

**An unconstrained JSON answer.** A model that cannot backspace writes its slip, or its correction,
into a data format that nothing constrains, and a strict parser then turns a sampling accident into
a failed step. The tell is a malformed answer that is *almost* right: valid up to one value, which
is code, a stray token, or a field repeated.

## Which commit introduced it

There was no single bad commit. The class arrived with the first model call that asked for JSON:
`2287dca18` (2026-08-24, "Add stage 4: generate the ToC tree with Claude"), the `range` pair
included. Every later stage copied the pattern. `e04e879df` (2026-09-03) made the shared parser
tolerate prose around the JSON and trailing commas. That was correct, and it was the right
boundary to stop at: a parser that repaired values would have had to guess what the model meant.

## The fix that is right for the long term — and the one that was nearly built

**Built:** structured outputs. Anthropic's `output_config.format` takes a strict JSON schema, and on
a completed, non-refusal answer decoding is constrained to it, so `.replace(…)`, a stray value or a
missing field cannot be written. It works on our route (OpenRouter's Messages wire), with streaming
and with adaptive thinking. Every article stage and most other JSON calls now go through one
validator (`src/messages-structured-output.ts`) that refuses the documented subset violations this
code relies on, when the schema or request is built and before they become a paid request; the
provider remains the final authority. Structure also stopped asking for ends (`toc/11`, starts
only), so the hardest id is no longer requested at all.

Measured, on fresh answers, before and after:

| | before | after |
|---|---|---|
| Structure, 70 answers on 4 articles | 2 malformed (`toc/10`) | 0 (`toc/11`) |
| Structure, quality panel (8 articles × 2) | 1 of 16 invalid | 0 of 16; no visible loss from either blind judge; 27 % cheaper, 37 % faster |
| Ideas, `high`/`medium`/`low` | 1, 10 and 10 in 16 malformed (research 261001c) | 0 in 48 |
| Sketch at `low` | 2 of 16 invalid without the schema | 0 of 16 with it; no visible loss |
| Quotes | — | 12 of 12 valid |

**Nearly built, and rightly dropped: evaluating the `.replace` in the parser.** It looked like the
cheapest fix. It would have let an invented id through wherever a stage does not resolve ids. GPT
Sol's example was a tweet's text, `"accurate".replace("accurate","invented")`, which no check
would ever see. And the evidence showed that the model's "correction" is sometimes a no-op, or a
change of mind about a boundary. A lenient parser would have believed the model's second thought
without knowing it was one.

**What a schema does not do:** make an id right. Under a schema, a model that has started a wrong
id can no longer correct it, so it finishes the string. The result is an invented id, which the
resolver refuses as before, or a wrong real one, which nothing can see, exactly as before. So every
id check stays. **No schema may put an `enum` of the article's ids on an id field**: that would
force a mistyped prefix to finish as *some* real id, which is a wrong id let through silently.

**One cost to keep watching.** At `low` effort a schema can make adaptive thinking skip thinking
entirely. Structure thought 0 tokens on some articles. It passed the quality rule anyway, but that
is a property of this prompt at this effort, not a guarantee.

## What would have caught it, ranked by ease against value

1. **Every compatible call that expects response JSON sends a schema through the shared adapter;
   every exception is named.** It costs a schema constant per stage, and a test per stage that the
   request carries it. Done for the article stages and the simple chat calls; the rule is written
   down for new ones
   ([prompting-guide.md § What the model writes back](../project/prompting-guide.md#what-the-model-writes-back)).
2. **Keep the raw answer of any failed parse in an eval.** The `.replace` shape was only seen
   because 261001p's harness kept the raw text of answers it could not parse. A harness that
   records only "parse failed" cannot tell a sampling slip from a prompt bug.
3. **Do not ask the model for a field the code recomputes.** Structure's end was redundant and
   the hardest thing in the answer to produce.
4. A parser that repairs values: rejected (above).
5. Labels or indices instead of ids, Skim's fix: rejected for Structure. A dense namespace turns a
   typo into a different real block, where a sparse one turns it into a refusal.
