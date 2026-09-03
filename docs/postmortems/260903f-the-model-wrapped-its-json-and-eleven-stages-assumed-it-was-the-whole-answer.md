# The model wrapped its JSON, and eleven stages assumed it was the whole answer

**2026-09-03.** Greg pasted a sutta into `/add` and **Building the hierarchy** stopped with the
generic *"trying again is worth a go"* sentence. Ninety minutes earlier the same shape had killed
`timeline` on a different article. Both were the model putting something around its JSON, and every
stage in the pipeline assuming there was nothing around it.

Fixed in [260903k](../plans/260903k-model-json-answer-extraction-in-the-shared-parse-seam.md).

## The real cause

`stripFence` in [`src/parse-json.ts`](../../src/parse-json.ts) removes a code fence **only at the
exact start and the exact end** of the response. It is documented as deliberately blunt: *"an opening
fence at the very start and a closing one at the very end, nothing in between examined."* Eleven
stages then wrote the identical two lines —

```ts
return parseJsonFrom(stripFence(raw), "the table-of-contents response");
```

— which quietly asserts that **the JSON is the whole response**. The model is under no such
obligation, and when it added material the assertion failed in two ways that read as unrelated bugs:

| what the model did | what the reader was told | what it looked like |
| --- | --- | --- |
| prose, then a fenced document | `does not begin with { or [ — 2774 characters` | a refusal, or a prompt fault |
| a document, then a close fence or prose | `it breaks at position 5409 of 13547 characters` | a truncation, or a token ceiling |

**Both rows are candidate explanations rather than established fact**, and the postmortem is the
wrong place to blur that. What was measured is *wrapper shape ⇒ that diagnostic*; the inverse does not
follow. *"Does not begin with { or ["* fits a refusal written in prose just as well, and *"breaks at
position 5409"* fits a genuine syntax error at 5409 with 8,138 characters after it — so **that a valid
document ended at 5409 is unsupported.** Nothing kept the responses, so neither can now be settled.
That is the sharpest argument for recommendation 3 below. ⟨GPT Sol, 2026-09-03⟩

Neither was the article, the budget, or the model's competence. `mn10` is 195 blocks and 70,536
characters, comfortably inside the budget; a real re-run of the same stage on the same blocks
**succeeded** — 218 s, $0.4169, a response the same ~13k size as the one that failed. So it is a
sampling artefact: most samples are bare JSON, and the occasional one is dressed.

## The class

**A parser that assumes its input is exactly the payload, when the producer only promised the payload
is in there somewhere.** The fix is always the same — locate the payload rather than trimming the
ends — and the tell is always the same: a `strip`/`clean`/`sanitize` helper whose contract is "handles
the shapes we have seen", cited by callers as though it were "handles the shapes there are".

Two properties make this class expensive rather than merely wrong:

1. **The same cause presents as several different bugs**, so it is triaged several times and fixed
   nowhere. Two stages, two sentences, two theories, one cause.
2. **The blunt helper's own docstring is what makes it look safe.** `parse-json.ts` is one of the
   best-documented files in the tree and it *says* it is blunt — so eleven callers read that, and none
   of them drew the conclusion that they were the ones who had to make up the difference.

The single most telling artefact is this sentence in that header:

> `parseHits` in src/search.ts is the caller that then goes looking for the first `{` itself, and **it
> is the only one that needs to.**

That claim was false when it was written, and today's two failures are the proof. `search.ts` had
already built the right machinery — `objectEnd`, a scan from the opening brace to its matching close
that respects string literals and escapes — and left it module-private, behind a comment explaining
that nobody else needed it. **The remedy already existed in the tree, one import away, marked
unnecessary.**

## Which commit introduced it

Not one. `stripFence` was correct for every shape anyone had seen, and the eleven call sites were
consolidated *into* that shape by the refactor that gave `parse-json.ts` its one copy of the
fence-stripping — an improvement that also made the flaw uniform. The failure needed a model sample
nobody had drawn yet. That is the honest answer, and it is the argument for the prevention below
rather than for a revert.

## What would have caught it

Ranked by ease and value.

1. **Cheapest, highest value: test the helper against shapes the producer is *allowed* to emit, not
   the ones we have seen.** `tests/parse-json.test.ts` already had an `AWKWARD` table of eighteen
   inputs — bare fence, `json` fence, CRLF, backticks inside a string, a fence around nothing, an
   indented close. It is a good table and it missed both failures, because every entry asks *"does
   `stripFence` agree with the two spellings it replaced?"* — a refactoring-equivalence question. Not
   one entry asked *"and does the result parse?"* Adding "prose before" and "junk after" to that table
   costs two lines and would have gone red the day it was written.
2. **When a helper is documented as deliberately blunt, the docstring should name who makes up the
   difference — and a test should hold that list.** "It is the only one that needs to" was a fact
   about the tree, asserted in prose, with nothing to notice it going stale as ten more callers
   arrived.
3. **A diagnostic that distinguishes shapes it can distinguish for free.** *"It breaks at position
   5409"* covers both a genuine mid-document syntax error and a complete document with 8,138
   characters of junk after it — different bugs, different fixes. Half an hour went into a token-ceiling
   theory because of it. The plan adds the case, computed as arithmetic (re-parse the prefix up to the
   offset) rather than by matching V8's wording, which is the stale-in-a-Node-upgrade trap `ranOut`
   next door already avoids on purpose.
4. **Costly, and rejected for now: keep the response that would not parse.** Both raw responses are
   gone for good, so the shape had to be reconstructed from V8's error-message wording. That is a real
   cost and it was paid knowingly — [the plan](../plans/260903k-model-json-answer-extraction-in-the-shared-parse-seam.md#decided-the-failed-response-is-still-kept-nowhere)
   records Fable's reasoning, the 2026-08-28 `aiCalls.raw_response` decision it rests on, and the
   trigger that would change the answer.

## The fix that is right, and the one that looked right

The obvious repair — *"find the first JSON document in the response and use it"* — was written into
this plan, sent for review, and **rejected as a silent-success regression.** It would have taken the
wrong answer, successfully:

```
I first considered {"events":[]}.
Final answer:
{"events":[{…the real events…}]}
```

`timeline` treats zero events as a legitimate result, so that empty document would have been stored
and nothing would have said so. The bug we set out to fix at least *announced itself*. A truncated
second document is the same shape of trap.

So the rule shipped is **extract, but refuse to choose**: exactly one candidate document, with
nothing outside it that could be another, or throw. And `{` only — every one of the eleven prompts
asks for a root object, so scanning for `[` would buy nothing and risk latching onto a footnote
marker like `[1]` in a preamble.

**The class inside the class**, and it is the more useful of the two: *when a parser is made
permissive to accept more inputs, the failure mode moves from "rejects a good answer" to "accepts the
wrong one", and the second is worse because it is quiet.* Permissiveness is only safe where it cannot
change which value comes back. That generalises well beyond JSON, and it is the thing to check the
next time somebody loosens a parser to fix a production failure.

## The thing worth carrying elsewhere

Sentry withheld both messages, correctly — a step's free-text diagnostic has no registered code, and
[`src/job-failure.ts`](../../src/job-failure.ts) § *The log, and not Sentry* explains why that is the
right trade. But it means the only copy of the one sentence that mattered was in the Vercel runtime
logs — and it took a while to find there, because **searching by `jobId` does not find it.** That
matches only the `POST /api/jobs/<id>/advance` request-path lines, all of them `200`; the failure
line names the *slug*, not the id. A full-text `query` on a fragment of the slug found it at once.
Retention is one day, so both sentences would have been gone by tomorrow. Added as the fourth bullet
of [vercel-hosting-deployment.md § Searching the logs](../project/vercel-hosting-deployment.md#searching-the-logs-which-is-where-handled-failures-actually-are).
