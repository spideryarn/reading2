# Asking a model to omit a field makes it emit the comma anyway

**2026-09-06.** A prompt instruction that says *"include this field here, omit it there"* reliably
produces **invalid JSON** at the places it is omitted, because the model writes the separator for the
field and then obeys the instruction not to write the field. `src/parse-json.ts` had no tolerance for
it, so the whole answer was thrown away and a paid call was lost.

Found while measuring something else. Nobody reported it, and nobody could have: nothing keeps the
response.

## What it looks like

```json
"n0003": {"gist": "GPT-3, 175b parameters, unexpectedly learns…",},
```

`src/hierarchy.ts` asks for a `question` on the root and depth-1 nodes and for it to be **omitted**
deeper. On a deep node the model writes the comma that would have preceded `question`, then omits
`question`. One character.

## How often

Measured across the five rounds of `docs/plans/260905f-…`, twenty live calls:

| | calls | unparseable |
|---|---|---|
| the arm carrying the new gist rules | 16 | 5 |
| the arm carrying the old ones | 4 | 0 |

**5 of 20**, and the count *within* one answer runs from 1 to **20** — one captured answer has a
trailing comma on essentially every deep node. Any count above zero fails the whole parse, so the
broken-answer rate understates how close the clean answers were to breaking. The split between the
two arms is far too small to attribute to prompt length and is recorded rather than believed.

The raw bytes are in [`evals/results/summaries/trailing-comma/`](../../evals/results/summaries/trailing-comma/)
— model-written JSON with no article prose in it, promoted out of gitignored `output/` because the
captures cost real money and are the only evidence there will ever be.

## The class

**A conditional field in an output schema is a conditional *separator*, and models get the separator
wrong.** The instruction is about the field; the model's failure is about the punctuation the field
would have carried. Anywhere a prompt says "omit X when Y", expect `,}`.

Its sibling, found while writing the fix: the *same* prompt says *"JSON only, no prose, no code
fence"* and the third captured file arrives **fence-wrapped**. `parseJsonAnswer` already tolerated
fences and did not tolerate commas, so which disobedience you survived was luck. A file labelled
*clean* in the first draft of this write-up was not clean; it only failed the other way.

## The fix

`dropTrailingCommas` in [`src/parse-json.ts`](../../src/parse-json.ts) — a string-aware scanner,
applied **only** to the extracted span, **only** after a strict parse has already thrown, and taken
only if the repaired text parses. A genuinely broken answer still throws, which is that module's
whole disposition: a refusal costs the reader a Retry click, a wrong guess corrupts an artefact and
says nothing.

**Not a regular expression.** `text.replace(/,(\s*[}\]])/g, "$1")` is the obvious one-liner and it
edits article prose: every gist, quote and glossary definition is the author's own words, and a
sentence can end `…, }` inside a string value. The scanner tracks string and escape state exactly as
`objectEnd` does. `tests/parse-json.test.ts` has the decoy that a regex fails.

## Two things the tests caught about the fix itself

1. **The repair was written twice and each copy hid the other.** One site over the whole text before
   the brace hunt, one inside it. With *either* disabled, all 65 tests still passed. Only a
   perturbation found it. The whole-text site was deleted: the extraction site is strictly larger
   (it also mends *"a document, a comma, then a sign-off"*), and the earlier one quietly re-admitted
   array-rooted answers, which that function excludes on purpose.
2. **The regression test reads the captured files rather than fixtures**, asserts each still fails a
   bare `JSON.parse`, and checks every node kept its gist — because a repair that dropped content
   would parse just as happily as one that did not. It asserts the directory holds three files, so
   emptying it fails rather than passes over nothing.

## What would have caught it, ranked

1. **Keeping the raw answer when a parse fails.** This module deliberately keeps the model's writing
   out of the log, and correctly — but the consequence is that a failed answer exists nowhere, so a
   reader's failure is undiagnosable. A quarantine write (not a log line) under a debug flag would
   have turned five silent losses into one afternoon.
2. **A note in the schema section of every prompt**: a field that is conditional needs the model told
   *"and no comma where you omit it"*, or the field made unconditional-and-nullable.
3. **Counting the repair when it fires.** Nothing records it, so a model that starts doing this on
   every answer is quietly accommodated instead of noticed. Named at the code, not fixed: this module
   has no logger by design and `parseJsonAnswer` returns the value alone.
