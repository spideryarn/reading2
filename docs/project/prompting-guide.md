# Prompting guide — the words a prompt puts in front of a reader

Every prompt in this app that writes words for a reader carries **one shared plain-words rule**.
This is what the rule is, how it trades plain words against the paper's own wording, where it
lives, and how to measure a prompt change before calling it an improvement. Part of
[architecture.md](architecture.md); the prompts themselves are listed in
[ai-gateway.md](ai-gateway.md) and each mode's own doc, and a new mode's checklist is
[mode.md](mode.md).

## The rule, in Greg's words

> we want to make this plainer/simpler language rule common across *all* prompts that generate
> text of any kind. And ideally also in a way that it will apply to all future prompts … P.S. I do
> think this is a subtle goal, because a) on the one hand we really want to use simple language;
> b) on the other, we'd like to stay true to the wording of the paper. I think perhaps (a) is more
> important (especially for summaries, explanations), though perhaps (b) plays more of a rule in
> headings? Not sure. Use your judgment.
>
> — Greg, 2026-09-28

It began with two reader reports on the same complaint, three weeks apart:

> use slightly plainer/simpler/easier-to-understand language, while still trying to stay close to
> the language of the text
>
> — Greg, 2026-09-03

> we want the summaries to really use simpler language, because half the problem is we may not know
> what the jargon means, and the glossary as well especially should explain in simpler language.
>
> — Greg, 2026-09-26

**The first version failed in a way worth knowing.** It said *keep the article's own words for the
things it names, and ordinary words for everything else*. Every term of art is a thing the article
names, so the rule exempted exactly the jargon. The fix: **a name is a handhold, not an
explanation**. Keep the author's term, because the reader will meet it again in the prose, but make
the sentence understandable to someone who does not already know it. And, in the same breath,
**plainer means equally specific**. The product augments reading
([vision.md](vision.md)), so a plainer sentence that has lost a number, a direction or a hedge is
worse, not plainer.

## The trade-off, by kind of text

| what the prompt writes | which wins | so |
|---|---|---|
| **explains** — an answer, a summary, a definition, a reason, feedback, a caption | plain words | say what it means here, in everyday words, first; keep the article's term and explain it where it first appears; never explain one hard word with another |
| **asks** — a question put to the reader | plain words | the article's term as the topic; the rest in ordinary words; never explain the term inside the question or give the answer away |
| **names** — a label, heading or title the model writes | the author's wording | the author's key term with ordinary words around it: a landmark the reader matches to the text, never a pile of field nouns |
| **copies** — a quotation, a name, an author's heading | the author's wording, exactly | untouched |
| **speaks** — words heard, not read | plain words | short sentences, the meaning before the name, no brackets, no notation read aloud |

The reader is **a curious reader who has not studied this field**, unless the prompt or the
reader's own profile says otherwise. The referee prompts name their reader as a peer reviewer in the
field, and a reader whose profile claims the background gets it assumed
([reader-profile.md](reader-profile.md)).

**Why plain wins in explanation.** An explanation is what the reader reads instead of the prose, for
a moment. Blind reads found the plain version better in 67–70 of about 90 pairs, with fidelity no
worse ([the plan](../plans/260926a-plainer-summaries-and-glossary.md)). What the paper's wording is
for, meeting the term again in the text, survives through the handhold.

**Why the author wins in a label.** A label has no room to explain, and its job is to be recognised
against the page. At the coarse zoom levels a column of labels is a summary in its own right, so
"the author's term" is not licence for jargon either.

## Where it lives, and how a prompt uses it

`plainWords(...kinds)` in [`src/plain-words.ts`](../../src/plain-words.ts). It returns a
`PLAIN WORDS` section: a short core in every call, plus one paragraph for each kind of text the
prompt writes (`"explain"`, `"ask"`, `"landmark"`, `"spoken"`). Interpolate it as its own section,
near the end, the way `PROFILE_RULES` in `src/profile.ts` is:

```ts
const SYSTEM = `…the prompt's own sections…

${plainWords("explain", "landmark")}

${PROFILE_RULES}`;
```

- **Name every kind the prompt writes.** The sketch prompt writes claims and node labels, so it asks
  for `"explain"` and `"landmark"`. A prompt with its own measured, field-specific rules (the
  summary and glossary prompts) takes the core alone, `plainWords()`, and keeps its own detail.
- **The prompt's own rules win where they are more specific.** The core says so. A field's length,
  shape, which source may support it, which field a fact belongs in, and anything to be copied
  exactly are all the prompt's business. Do not delete a field rule to make room for this one.
- **Delete the prompt's old plain-words bullet** when it gains the section, so it gives one rule, not
  two.
- **Watch for the rule fighting one already there.** Chat and Remember may bring in what they
  found on the web, so neither may be told to use "no term the piece did not use"; that clause was
  written once and cut for exactly this reason.
- **Block ids and numbers are not words for a reader either, and that rule lives with the ids.**
  `BLOCK_ID_NOTE` in [`src/article-prompt.ts`](../../src/article-prompt.ts) is printed in every
  `articleWithIds` article, so a prompt shown ids is told not to write "block 39" or "block
  spya-…" in prose, and a prompt shown none is not. The hierarchy prompts, which number their
  own blocks, do not say it yet: no leak has been seen there, and the note's wording does not fit
  their numbered lines, so `toc/10` passed it by (`src/article-prompt.ts` says why).
  Why it is not in the core above:
  [260928c](../plans/260928c-block-refs-shown-to-readers.md).
- **Summarising the whole piece? Leave its paperwork out.** `paperwork(kind)` in
  [`src/paperwork.ts`](../../src/paperwork.ts) is a second shared section, beside `plainWords`: the
  authors' list, affiliations, acknowledgements, funding and disclosures are paperwork when they
  only record how the piece was produced, and content when the piece uses them. `"summary"` leaves
  it out; `"structure"` keeps the node a table of contents must have and labels it. Summary, Tweets
  and both hierarchy prompts carry it; the evidence is
  [261001p](../plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md).
- **No words for a reader, no rule.** A prompt whose output is a verdict, a URL, ids or a verbatim
  transcription is listed in `PLAIN_WORDS_EXEMPT` in the same file, with its reason. A transcriber
  told to prefer common words is a transcriber invited to tidy.

**It is the default, and a test holds it.** `tests/plain-words-coverage.test.ts` finds every file
that calls a model and fails unless the file uses `plainWords(` or is exempt with a reason. It
finds the call by the wire function that makes it, and it lists by hand the prompt files whose call
is made elsewhere. Its header says what it cannot see. Name a new prompt `…_SYSTEM`, like every
other prompt here, so people and tools can find it.

**Changing the shared text changes every prompt that uses it.** So bump the version stamp of every
stamped prompt it reaches, and measure first.

## What the model writes back

The prompt is half the contract; the other half is the code that reads the answer. These four traps
have each cost a paid call or shown a reader something wrong, and each is written up where it
happened. The shared parse seam is [`src/parse-json.ts`](../../src/parse-json.ts) §
`parseJsonAnswer`.

- **Every compatible call that expects response JSON back sends a strict schema; every exception is
  named.** A model writing JSON cannot take
  back a token, so when it decides something it wrote is wrong it patches it in place — as code
  (`"spya-zhzzzz".replace("zhzzzz","jcpyd5")`), a stray value, or a repeated field — and the strict
  parser fails the whole step. On a completed, non-refusal answer, a schema makes those shapes
  impossible to write. Use the shared
  adapter and validator in [`src/messages-structured-output.ts`](../../src/messages-structured-output.ts)
  (`withMessagesJsonSchema` on the Messages wire, the chat adapter beside it), never a hand-written
  `output_config` or `response_format`. Six rules come with it:
  - **The schema states every part of the live answer shape that the provider's subset can
    express.** Do not add an answer variant merely because the parser accepts it: a parser may stay
    more tolerant for old stored answers without widening what the live decoder may produce. Limits
    the schema language cannot state, and semantic checks such as resolving an id, stay in code.
    Adding a schema changes no semantic instruction, though answer-format wording may need to stop
    asking for a code fence or another shape the schema does not emit.
  - **No `enum` of the article's block ids on an id field**, ever (`assertNoBlockIdEnums`): it would
    force a mistyped prefix to finish as *some* real id, a wrong id let through silently. Ids are
    still resolved against the article after the parse, exactly as before — a schema makes the
    syntax right, not the id.
  - **No recursion**: Anthropic refuses a self-referencing `$ref`. Unroll to the depth the prompt
    asks for (Structure's three levels).
  - **The chat adapter validates OpenAI's stricter subset too**: its root is an object and every
    declared object property is required. Represent an optional value as a required nullable field,
    or as fully required object variants under `anyOf`.
  - **The schema is part of the cache key**: an article stage's row in `ARTICLE_OUTPUT_FORMAT`
    (src/pipeline.ts) names the same constant, and `tests/article-cache-output-format.test.ts`
    checks the request agrees.
  - **At `low` effort, check the call still thinks.** Under a schema, adaptive thinking can drop to
    nothing; Structure did on some articles and still passed its quality panel, but that was
    measured, not assumed.

  Where a call does not fit yet (streaming partial JSON to the reader, web search on the same
  call, tool arguments) the reason is in
  [261001s § Stage 3a](../plans/261001s-structure-answer-writes-code-to-correct-an-id.md).
  [261002b](../postmortems/261002b-an-unconstrained-json-answer-fails-the-step.md).
- **The JSON is somewhere in the answer, not the whole of it.** Models wrap their JSON in prose or a
  fence despite being told not to. The shared parser now *extracts but refuses to choose*: exactly
  one candidate document, or it throws. Taking "the first JSON in the response" would accept
  `{"events":[]}` from a preamble as a real empty answer — making a parser more permissive moves the
  failure from rejecting a good answer to accepting the wrong one, quietly.
  [260903f](../postmortems/260903f-the-model-wrapped-its-json-and-eleven-stages-assumed-it-was-the-whole-answer.md).
- **"Omit this field when…" produces the comma anyway.** The model writes the separator, then obeys
  the instruction not to write the field, and the JSON is invalid (5 of 20 calls in one
  measurement). `dropTrailingCommas` now mends that one shape after a strict parse fails; the other
  way out is a field that is always present and nullable.
  [260906b](../postmortems/260906b-asking-a-model-to-omit-a-field-makes-it-emit-the-comma-anyway.md).
- **A model's claim used as a join key gives a confident wrong join.** Figures were paired to
  captions on the page number the transcriber *said*, and two swapped silently. The fix makes the
  measured side corroborate the claim (`captionPrintedOn` in
  [`src/pdf-figures.ts`](../../src/pdf-figures.ts)) before the join is trusted.
  [260924a](../postmortems/260924a-a-figure-paired-on-the-transcripts-page-claim.md).
- **One bad item and a broken draw are different failures.** The labels step threw on one malformed
  pair and lost the batch with no retry, though the caller already had a graded answer. The fix
  re-asks for what is missing, forgives a bounded gap, classes each fault as either "this item is
  missing" or "this draw is broken", and names the terminal error with a `code` so Sentry can tell
  them apart.
  [260924a](../postmortems/260924a-a-malformed-label-pair-kills-the-step-without-a-retry.md).

## Measuring a prompt change

Reading a few outputs and finding them better is not evidence: the same prompt, run twice, reads
differently. This is the method that worked, in `evals/plain-words/`:

1. **Call production's own function** (`wholeDocumentRequest`, `generateGlossary`, `explainStream`,
   `converse`, …), not a copy of the prompt, on a few real local articles of the difficulty the
   change is for. Record a hash of the prompt source with each run.
2. **Run the old prompt twice.** The second run is the control, and it tells you how much two
   samples of one prompt disagree.
3. **Separate the arms in time, not in code.** Run `before` on the commit before the change and
   `after` on the commit with it. Never overwrite an arm.
4. **Pair like with like** (the same node, term, question or case), **shuffle the sides** with a
   tested coin, and keep the key in its own file. **Check the key is balanced before judging.** A
   broken coin once put the new arm on the same side 94 times in 95: a float LCG, in
   [260926a](../plans/260926a-plainer-summaries-and-glossary.md). The tested one is `blindCoin` in
   [`evals/plain-words/run.ts`](../../evals/plain-words/run.ts); count which side each arm landed on
   in the key, because a judge with a side preference will look like a prompt effect.
5. **A blind judge, in a fresh subagent that reads only the pairs file**, answers two questions per
   pair: which one would a reader from outside the field understand more easily, and did either one
   lose, bend or blur a claim? Plainness without the fidelity question rewards vagueness.
6. **Compare with the control.** The old prompt against itself split 55–46; the new against the old,
   70–13. A result inside the control's spread is not an effect. A one-bullet change to chat
   produced 13–5 and then 9–9, and was not one.
7. **Use cheap screens, but only as screens.** Hard-word counts, words per line and over-limit
   lists catch regressions. A falling hard-word share can also mean a vaguer sentence, and an
   explanation adds common words around the same hard ones.
8. **Read the outputs anyway.** Two regressions the numbers could not see were found by reading:
   outside knowledge filed under the article's own label, and people dropped from a glossary.

Keep each paid run to a few dollars. The cost of a tree is in [open-questions.md](open-questions.md)
§ Q7.
