# A trailing comma, three answers, and a bug report that changed shape

Three real answers from the summaries eval's `gists-toc6` arm, 2026-09-06, kept
because **five of twenty live calls in that eval came back unparseable and
nothing anywhere keeps the response** — `src/parse-json.ts` says so in its own
header, and the sentence it prints is normally the entire evidence a debugger
gets.

These are model-written gists and questions with no article prose, which is what
makes them committable; the runs they came from live under `/output/`, which is
gitignored for the opposite reason.

## What the bytes show

`n0003` is a depth-2 node, so the prompt tells the model to omit `question`. The
model writes the comma that would have preceded that field and then obeys the
instruction:

    "n0003": {"gist": "GPT-3, 175b parameters, unexpectedly learns … scale.",},

| File | Commas | What it is |
|---|---|---|
| `scaling-hypothesis-1-comma.raw.json` | **1** | The first capture. One comma in 8,706 characters, and the whole answer is refused. |
| `noema-20-commas.raw.json` | **20** | **The one that matters.** One on essentially every depth-2 node in the answer. |
| `scaling-hypothesis-clean.raw.json` | **0** | Kept as the negative case: the same document, same prompt, no commas at all. |

Removing them parses the first two cleanly — 42 and 27 nodes, none missing and
none invented:

    node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");
             console.log(Object.keys(JSON.parse(t.replace(/,(\s*[}\]])/g,"$1")).nodes).length)' <file>

**That one-liner fails on the third file, and the reason is worth knowing rather
than papering over.** `scaling-hypothesis-clean.raw.json` is wrapped in a
` ```json ` fence, despite the prompt saying *"JSON only, no prose, no code
fence"*. The harness accepts it because `parseJsonAnswer` already strips fences —
a tolerance that exists, is deliberate, and is why this answer counts as clean.
So the model disobeys the output instruction in at least two ways; the parser
forgives one of them and not the other, and which one you hit is luck. Check a
file with `parseJsonAnswer` rather than bare `JSON.parse` if you want the
harness's own verdict.

## Why the second file changed the bug report

With one comma this reads as occasional slippage. With twenty it is the model's
**habit** on nodes told to omit a field — and the count in a single answer ranges
from 1 to 20 while *any* count above zero fails the entire parse. So the rate of
broken answers says nothing about how close the clean ones were to breaking, and
a fix that waits for the failure rate to look alarming is waiting for the wrong
number.

**This is not confined to the eval.** `src/hierarchy.ts`'s structure call has the
same optional-`question` shape and goes through the same parser, which has no
trailing-comma tolerance — so the same character can fail a reader's real
hierarchy build and leave nothing behind to diagnose it from. That is its own
piece of work; these bytes are the evidence for it.

## Distribution, for whoever picks it up

Five failures in twenty calls; all five on `gists-toc6` and none on `gists-toc5`
(4 calls, so that is not yet a finding); four of the five on one document, which
`scaling-hypothesis-clean.raw.json` argues against reading as a fact about that
article. Break offsets were 399, 460, 463, 1174 and 1821 — all early, which is
where the first depth-2 node without a question falls.

**One of the five was a different failure and is not here.** It was truncated
(*"it ends part-way through — cut off after 5268 characters"*) against
`budgetForNodes(27)` = 6,400 tokens shared with adaptive thinking, which is
marginal on a small document once the gists lengthen. Read the error text: *"ends
part-way through"* is the cap, *"breaks at position N"* is the comma.
