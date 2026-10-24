# "Does it say that?": what one chat turn costs and how long it takes

Owned by [investigations.md](../project/investigations.md). Informs
[261024m](../plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md),
which would start this chat by itself when a reader rests on a citation and stream the answer into
the hover card. That plan's estimate, 2p–10p and 15–60 s a turn, had never been measured; the only
production turn (2026-10-15) cost $0.229 and took 19 s. This measured nine turns on seven real cited
works in the local database, 2026-10-24: **median $0.17 (range $0.07–$0.43) and 21 s (15–32 s)**, and
**no words reach the reader until the answer is complete**.

## How it was run

`scripts/spikes/261024q-does-it-say-that-cost.ts` sends exactly what Reader.tsx §
`checkCitedWorkInChat` sends — `askAboutBlock({ blockId, question: askDoesItSayThat(work) })`, on a
chat anchored to the citing block — straight into `converse` with the production tools (job `chat`,
Opus 5.5, high effort), the way `evals/cost/interactions.ts` drives it. Every call is in the local
`ai_calls` under scope `eval`, with the article attributed. It writes no thread or message.

Left out compared with the real route: the reader's profile, the reading-so-far line and the
other-conversations section (all small, after the cache breakpoint), and the `chat-gist` call after
the answer (~$0.0003 on production). Raw answers, per-call tokens and timelines:
`output/261024q-does-it-say-that/` (gitignored, since the answers quote the papers).

Turns ran back to back in the order below, so each article's first turn writes the article's cache
(cold) and the turns after it read it (warm). #3b and #7b are the same turns re-run four minutes
later, still warm.

## Results

| # | Article | Cited work | Cache | Cost | First words | Done | Calls | What `read_cited_work` got | Web searches | Answer | Useful? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | scaling-hypothesis | GPT-3 paper (arXiv) | cold | $0.302 | 21.4 s | 21.6 s | 2 | read 2,000 of 34,169 words | 0 | 355 w, 2,052 ch | Yes: quotes the paper; finds "several orders" should be two |
| 2 | scaling-hypothesis | Hendrycks 2020, MMLU (arXiv) | warm, then a miss | $0.305 | 19.9 s | 20.0 s | 4 | could not confirm it is the work; fell back to the abstract page | 0 | 311 w, 1,921 ch | Partly: abstract supports the pointer, says so |
| 3 | spider-silk | Sponner 2007 (DOI, open PLOS ONE) | cold | $0.270 | 19.7 s | 19.7 s | 2 | read 2,000 of 6,327 words | 0 | 316 w, 1,869 ch | Yes: confirms, adds the paper found five layers |
| 4 | spider-silk | Termonia 1994 (DOI, paywalled ACS) | warm | $0.122 | 19.4 s | 20.6 s | 2 | could not read pubs.acs.org | 1 | 339 w, 2,297 ch | Partly: abstract via Semantic Scholar; flags "introduced" as overstated |
| 5 | antikythera | Iversen 2017 (DOI, paywalled Hesperia) | cold | $0.431 | 26.8 s | 29.4 s | 3 | muse.jhu.edu is not a PDF | 1 | 393 w, 2,594 ch | Partly: abstract backs half the claim, says which half is unchecked |
| 6 | antikythera | Jones 2017, *A Portable Cosmos* (book, no identifier) | warm | $0.167 | 30.7 s | 31.9 s | 3 | no address to read | 1 | 352 w, 2,299 ch | Partly: publisher's blurb only; catches a wrong "why" on the row |
| 7 | antikythera | Voulgaris 2022 (arXiv) | warm | $0.078 | 16.4 s | 17.6 s | 2 | read 2,000 of 9,498 words | 0 | 403 w, 2,341 ch | Yes: quotes date and reasoning; spots the misspelt author |
| 3b | spider-silk | as #3 | warm | $0.072 | 22.5 s | 22.6 s | 2 | as #3 | 0 | 335 w, 2,001 ch | as #3 |
| 7b | antikythera | as #7 | warm | $0.073 | 14.8 s | 14.9 s | 2 | as #7 | 0 | 339 w, 1,990 ch | as #7 |

All nine: **median $0.167, range $0.072–$0.431; done in a median 20.6 s, range 14.9–31.9 s.** Total
spend $1.82.

**Cold against warm.** The cold turns (#1, #3, #5) cost $0.27–$0.43, median $0.30. The clean warm
turns (#4, #6, #7, #3b, #7b) cost $0.07–$0.17, median $0.08. The difference is one call: the
first call of a cold turn writes the article (42–55k tokens) to the cache for $0.22–$0.28, where a
warm one reads it for $0.014–$0.019. So **a reader's first citation on an article costs about $0.30
and later ones about $0.08–$0.17**, the upper end when the model also searches the web.

The first sentence is a verdict in every turn ("Mostly yes, with one overstatement.", "Yes, broadly.",
"I couldn't read the paper itself, so I can only partly answer."), which is what a card wants. The
first ~300 characters are in the raw results.

## What was surprising

1. **Nothing streams.** In every turn the first word arrived within 0.1–2.6 s of the last. The
   timeline of #3b: the tool ran from 5.4 s to 9.0 s, then nothing until 22.46 s, then all 134
   deltas (2,001 characters) in 80 ms. `converse` yields each delta as it parses it
   (src/converse.ts, the `yield { type: "delta" … }` in the round loop) and
   `src/openrouter-stream.ts` splits on newlines as they arrive, so the bunching looks upstream of
   our code, in OpenRouter or the provider for this model and effort. **Followed up the same day**:
   the burst happens on any round after a tool result, on Opus and Sonnet at any effort, and a first
   round streams normally ([chat-tools.md § Still open](../project/chat-tools.md), the probes in
   `scripts/spikes/261024q-chat-stream-*`). **For the card it means 15–30 s of an activity line,
   then the whole answer at once**, whenever the chat used a tool.
2. **The fourth round loses the cache.** #2 used all three tool rounds (`article_citations`,
   `read_cited_work`, `read_web_page`), so `converse` ran a fourth with chat's tool definitions
   removed (`MAX_TOOL_ROUNDS`). The tools are part of the cached prefix, so that call read no cache
   and wrote 45,559 tokens for $0.256 — on a turn that was otherwise warm and cost $0.05. Any
   capped chat turn pays this, not only this one. (Guide keeps its definitions and sends
   `tool_choice: "none"`, which would keep the prefix.)
3. **`read_cited_work` read the paper in three of seven works**: both arXiv papers that matched and
   the open PLOS ONE paper. It failed on the other arXiv paper (#2, identity not confirmed; the
   Bibliography row's title is "Hendrycks et al 2020"), both paywalled DOIs (bot check, not a PDF),
   and the book (no address). Every failure was said plainly in the answer's first sentence.
4. **Too long for a card.** 311–403 words, 1,870–2,600 characters, with bold headings and bullets.
   The verdict sentence fits a card; the rest needs the chat panel or a much shorter prompt.

## What this does not show

- Production latency or provider routing: this ran from the Hetzner box against OpenRouter, like
  production, but on one afternoon.
- A turn with the reader's profile, reading-so-far and other conversations in the prompt. They sit
  after the breakpoint, so they would change the answer and barely the cost.
- More than seven works on three articles. Cold costs scale with article length: these were 42–55k
  tokens of prompt.
- Whether a shorter, card-shaped prompt would be cheaper or faster. Output was 1.3–2.7k tokens a
  turn including reasoning, a small share of the cost next to the 42–55k-token prompt.
- Why the stream bunches. That needs its own look before the plan can promise streaming.
