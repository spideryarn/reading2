# Web search through a subagent: what a search tool should hand back

Up: [investigations.md](../project/investigations.md). Plan this informs:
[261012g](../plans/261012g-web-search-through-a-subagent-for-chat-and-the-guide.md).

**Why:** Greg's reply to [q-w26r6u](../user-feedback/questions/q-w26r6u.md), 2026-10-12:

> Perhaps the web search tool that we create has an option for web search to run in a subagent
> (which hands back links/summary) for the caller-agent to retrieve if it chooses to? Or is there an
> OpenRouter web search API that would do this well? Run some spikes.

The guide's search failed because OpenRouter's search runs *inside* the model's reply, so its
results vanish when the guide calls its next-steps tool before writing anything
([261011t § The guide](../plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address.md)).
Three ways out were on the table:

1. **A subagent**: our own `search_web` tool. A small model runs the search and hands back links,
   each with a sentence. Its answer is an ordinary tool result, so it is still there in the next
   round.
2. **An OpenRouter search API**: the same tool, but returning the raw results with no summary.
3. **GPT Sol's in-loop design**: keep provider search in the guide, and when it searched and wrote
   nothing, carry the results forward and force a words-only round
   ([consult](../plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address-guide-consult-sol.md)).

## Method

[`evals/web-search-subagent-spike.ts`](../../evals/web-search-subagent-spike.ts), one run, six
queries of the "where does this piece sit" kind (responses to an essay, a theory's critics, a
replication record, an idea's influence), five arms each, all through `openRouterJson` and in the
ledger. Results: `evals/results/web-search-subagent-spike-2026-10-12T15-24-46.json`. Total $0.30.

| arm | what it is | median time | median cost | results | text back |
|---|---|---|---|---|---|
| `raw` | GPT Luna, Exa forced, replies `DONE`; we keep the annotations | 5.1 s | $0.0070 | 5 of 5, every time, ~10k chars of extracts | none |
| `parallel` | the same on OpenRouter's Parallel engine | 5.1 s | $0.0050 | 5, ~3.7k chars of extracts | none |
| `luna` | Exa, then Luna writes ≤5 title-link-sentence lines | 8.8 s | $0.0070 | 5 | ~1.3k chars |
| `haiku` | the same on Claude Haiku 5.5 | 8.0 s | $0.0080 | 5 | ~1.7k chars |
| `probe` | Sonnet, Exa + a local `offer_next_steps`, told to write nothing | 5.8 s | $0.0214 | 5, ~10k chars | 0 chars, `offer_next_steps` called |

## What it found

- **There is no OpenRouter search API.** Its docs list none
  ([web search](https://openrouter.ai/docs/guides/features/server-tools/web-search), read
  2026-10-12): search exists only as a tool inside a model call. The `raw` arm, a forced search on a
  cheap model that replies with one word, is the nearest thing. Exa costs $0.007 a search (up to 10
  results), Parallel $0.001–0.005. The model's own tokens are negligible next to that on Luna.
- **Sol's precondition holds.** In 6 of 6 `probe` calls, Sonnet searched, wrote nothing, called
  `offer_next_steps`, and **the Exa annotations still arrived**, five each. So the in-loop design
  would work. It is still a special case in the loop every conversation runs through, and the
  subagent makes it unnecessary.
- **The summary is worth having, and it has to be checked.** Both summarisers wrote readable,
  specific lines that said what each page found. For example, on ego depletion: Haiku gave the
  effect size and confidence interval of each multi-lab replication; Luna's lines were plainer.
  **1 link in 30 written by Haiku was not one the search returned.** It was a near-copy with one
  character dropped (`…on-anil-seth-the-…` for `…on-anil-seths-the-…`), so it would have been a
  dead link. Luna wrote none in 28. So the tool keeps only lines whose link is one the search
  returned, and takes each title from the search, not from the model.
- **Parallel's extracts are a third of Exa's length**, and one of its five results had none. It is
  cheaper, but the summary is only as good as what it reads, so Exa stays.
- **What it saves the caller.** The `raw` arm's ten thousand characters of extracts, re-sent to
  Sonnet on every later round of the turn, are what a summary replaces with about 1.5k. The
  provider search Chat uses today puts each result into Sonnet's own context: 22,010 prompt tokens
  for two searches in the Candidates probe of 2026-09-01 (`webSearchTool` in
  [`src/converse.ts`](../../src/converse.ts)).

## Chat through the subagent: measured, and not switched

Plan 261012g § Stage 2. `evals/chat-web-reach.ts --kind chat`, one run each, two articles × five
cases, Sonnet 5.5. First as Chat is today (OpenRouter's search inside the reply). Then with a
**temporary local patch**, reverted after the run and never committed, that gave Chat `search_web`
in place of that search. Results:
`evals/results/chat-web-reach-chat-provider-261012g-2026-10-12T15-37-48.json` and
`…-chat-subagent-261012g-2026-10-12T15-40-38.json`.

| | provider search (today) | `search_web` |
|---|---|---|
| targets that searched (`broader`, `since`) | 4 of 4 | 4 of 4 |
| controls that searched | 0 of 6 | 0 of 6 |
| `help` presses that searched | 0 of 2 | 0 of 2 |
| seconds, the four searching turns (mean) | 16.4 | 27.7 |
| seconds, the six others (mean) | 8.5 | 8.1 |
| citation chips on the searching turns | 0, 0, 6, 4 | 0 on all four |
| links in the prose (searching turns, mean) | 3.5 | 4.75 |
| whole run, from the ledger | $0.46, 12 calls | $0.39, 22 calls |

It searched in the same places, and was about 15% cheaper. But it was **eleven seconds slower on
every turn that searched**: it took a whole extra round, and three of the four turns used both
searches the budget allows. It also **lost the citation chips**, which come from the provider's
annotations. The gate in the plan asks for both of those to hold, so Chat keeps OpenRouter's search.
The chips could be fed from `search_web`'s kept results. The extra round is the design itself.

## What it does not show

- Whether the guide, given the tool, then answers from it rather than calling next steps first.
  That is measured in the plan's stage 1 with `evals/chat-web-reach.ts --kind guide`.
- One run per arm and six queries: enough to choose a shape, not to quote a rate. The Chat
  comparison is one run of ten turns per arm: enough to see an eleven-second gap, not a small one.
