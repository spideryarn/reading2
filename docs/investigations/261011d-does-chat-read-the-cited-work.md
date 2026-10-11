# Does chat read the cited work?

**Status as of 2026-10-11: measured; the gate passed and the citation-card button was built.**
Evidence: all four sampled chats called `read_cited_work`; two read a confirmed PDF, and both
failures said the paper had not been read.

## What we needed to learn

Adding a tool definition would not establish that chat uses it. Before putting *Does it say that?*
on every citation card, we needed to know whether a real standard-power chat, given exactly that
question beside the citing paragraph, would call the new tool and distinguish the selected passages
from the whole paper.

This is the gate in
[261011w](../plans/261011w-does-the-cited-work-say-that-at-the-citing-sentence.md#stage-2-the-gate-does-chat-call-it-measured-2026-10-11).
The raw calls and complete answers are in
[`read-cited-work-v1-2026-10-11T12-45-35-631Z.json`](../../evals/results/read-cited-work-v1-2026-10-11T12-45-35-631Z.json).

## What we ran

On 2026-10-11:

```sh
npx tsx evals/read-cited-work.ts --label v1 --max 4
```

The script chose one DOI or arXiv citation from each of four local articles and ran one real chat
turn per case, with tools and web search enabled. Each turn had a whole-block anchor on the citing
paragraph and the same `askDoesItSayThat` question the card sends. Nine paid model calls cost
$0.54.

## What happened

- Chat called `read_cited_work` in 4 of 4 cases.
- Code confirmed and read the PDF in 2 of 4. Both answers limited their negative claims to the
  passages shown, rather than claiming the whole paper was silent.
- One PDF was correctly refused because the bibliography's label did not match the paper's title.
- Wiley refused the other read. Chat said it had not read the paper, then separately named the
  abstract page it found by web search.

The raw result is the source for the article names, tool traces, timings and complete answers; the
plan records the compact per-case table.

## Decision

The gate passed, so stage 3 built the citation-card button. We ruled out changing the tool prompt to
force a call: the unprompted call rate was already 4 of 4, and forcing a read would be wrong when the
question can be answered from the article alone. We also ruled out treating a failed PDF read as an
answer about the paper; both measured failures support keeping that distinction explicit in the
tool result.

---

Up: [Investigations](../project/investigations.md)
