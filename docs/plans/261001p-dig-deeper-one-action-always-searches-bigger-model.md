# 261001p — *Dig deeper*: one dig-in action, which always searches the web and uses the bigger model

Status: **plan, under review**. Owner: the session in worktree `go-deeper`. Overseer-dispatched from
a question to Greg ([Q-glossary-web]), not a reader report; the glossary half was raised by
`spya-puyb6d` and written up in
[261001_1200](../user-feedback/261001_1200-five-small-tooltips-and-labels.md) as a follow-up.

## What Greg asked

> - Well, if it says "Check the Web", then it always should.
> - That said, there's an argument for saying something like renaming it to investigate further that
>   would use a bigger model and might not check the web. But I'm inclined to say that, yeah,
>   actually, let's rename it to investigate further or go deeper or something like that and say that
>   it always checks the web and always use a bigger model and maybe even uses the tool that we
>   (should) have, I hope, for searching other documents in the library, and perhaps drawing
>   on/referencing them.
> - And let's consider if there are any other places in other modes that have an equivalent to
>   investigate further or go deeper. And in all of those cases, so if somebody's found something and
>   they're like, yeah, I want to know more about this particular thing, that it should use a bigger
>   model.
>
> — Greg, 2026-10-01

## In one paragraph

Three buttons in three modes are the same gesture — *I have seen this one thing, tell me more* — and
today they have three names, all on Sonnet, none of which is guaranteed to search. They become one
action, **Dig deeper**, that (1) always runs a web search, forced by code rather than left to the
model, (2) always answers on the high-power model (Opus) whatever the article's switch says, and
(3) shares one implementation, `src/dig-deeper.ts`. Library search is a follow-up, for the reason in
§ Library search.

## The survey

Every per-item "tell me more" action in the reader, 2026-10-01 (file:line in the worktree at
`43be719bd`):

| Action today | Where | Task / model | Search | Prompt | Streams | Limit |
|---|---|---|---|---|---|---|
| Glossary **Check the web** | `GlossaryPanel.tsx` · `POST /api/glossary/:slug/:id/lookup` → `makeLookUpTerm` (`term-lookup.ts`) → `explainStream` | `explain`, capable: Sonnet, Opus if the article is high-power; effort provider default; `max_tokens` 1500 | server tool `openrouter:web_search`, `max_uses` 8, **model decides** | `explain.ts` `SYSTEM` (encourages searching) | yes | **none** |
| Comment **Search the web** (re-ask a done comment; tooltip *"Search the web properly"*) | `CommentDialog.tsx` · `POST /api/comments/:slug/:id/answer {deep:true}` → `answer()` (`routes.ts`) → `explainStream({deep})` | same as above | same tool, **model decides**; `deep` only adds the `DEEP` instruction after the cache breakpoint | `SYSTEM` + `DEEP` | yes | **none** |
| Citations **Investigate** / **Investigate again** | `CitationInvestigation.tsx` · `POST /api/citations/:slug/:id/investigate` → `makeInvestigateCitation` | `citation-investigate`, capable; `max_tokens` 3000. Step 1 *Look it up* is `citations-find` (Exa, prompt says one search); paper read + passages call | Exa server tool, **model decides** | `INVESTIGATE_SYSTEM` | yes (`stage`, `lookup`, `delta`, `done`) | `INVESTIGATE_RATE_POLICY`: 8/h, 20/day, 1 at a time, 50/day global |
| Glossary **Look up** (type a phrase) | `AskATerm` → `makeAskAboutTerm` → `explainStream` | as Check the web | model decides | `SYSTEM` | yes | none |
| Link hover-card summary | `link-summary.ts` | quick (Luna), effort low | **never** (deliberately: a page must not make us search) | — | yes | `SUMMARY_RATE_POLICY` |

**Not equivalents** (checked): Ideas, Quotes, FAQ, Timeline have no per-item action — their paid
actions are whole-article steps. Debate's *Search the web* is the whole-article Debate run, not a
per-claim follow-up. Referee's runs are whole-paper; Criteria *Try again* is a retry. Search
(`search.ts`) finds passages in this article and has no tools. Chat has the web tool (model decides,
`max_uses` 4) and the library tools, but it is a conversation, not a per-item press; Glossary's and
comments' *Ask in chat* hand over to it.

So the dig-in actions are the first three rows. **Look up** is a first question about a typed phrase
rather than a second look at an answer already given, so it stays as it is (the scope note says
don't change what else a mode produces). The link card stays search-free on purpose.

**"Capable tier, not the cheap one" is already true of all three** — every one is on Sonnet. So
"a bigger model" can only mean Opus, the high-power model ([high-powered-ai.md](../project/high-powered-ai.md)).
That is how this plan reads Greg, and it is the one interpretation that changes anything.

## The name

**Dig deeper** — busy label **Digging deeper…**, and on an item that already has a dug answer,
**Dig deeper again**. Opus's view, asked for the wording: ten characters fits an 18rem band and a
phone; it says the action is about *this one thing* and goes past what is on screen. *Investigate
further* is the runner-up and loses on width and because "Investigate" is already Citations' word,
so unifying on it would read as the other two borrowing it. *Go deeper* describes motion rather than
doing. No two-word label can also say "web" and "stronger model", so the tooltip does:

> Searches the web and asks a stronger model about this one thing. It takes longer than the first
> answer.

The answer's own label already says *from a web search* (261001j § 4); it will now always say that,
and the model line names Opus.

## How the search is forced — measured, not assumed

Probed live on 2026-10-01 (scripts in the session scratchpad; figures below are OpenRouter's own
`usage`):

| Request | Result |
|---|---|
| Sonnet 5, server tool, no `tool_choice`, "What is 2 + 2?" | no search |
| Sonnet 5, same + `tool_choice: "required"` (or naming the tool) | **1 search**, every time |
| Opus 5.5, same + `tool_choice: "required"` / named | **400** `Server tool "openrouter:web_search" failed: invalid request` after ~6 s — Opus 5.5's reasoning is mandatory ("Reasoning is mandatory for this endpoint and cannot be disabled") and a forced tool choice does not survive the follow-up hop |
| Opus 5.5, `plugins: [{id:"web"}]` (default engine) | no search — native engine, model decides |
| Opus 5.5, `plugins: [{id:"web", engine:"exa"}]` | 1 search, 5 relevant sources, but **no search count in `usage`**, and **`cached_tokens: 0` on a repeat call** with a 17k-token article — the injected results sit ahead of the cache breakpoint, so every press re-writes the whole article at 1.25× |
| Opus 5.5, server tool only, same article twice | caches (16k then 32k tokens read) |
| Luna, Exa server tool, `tool_choice: "required"`, a 3-line prompt | **1 search, 5 sources with their text (255–4,878 chars each), $0.007, 4 s** |
| Sonnet 5, the same | 1 search, 5 sources, $0.023, 4.7 s |

So Opus cannot be made to search, and the plugin that can force it costs the cache. **The design is
two calls:**

1. **The search** — `searchFirst()` in `src/dig-deeper.ts`: one `openRouterJson` call on the quick
   tier (a new task, `dig-deeper-search`, quick: Luna today), `tool_choice: "required"`, the Exa
   server tool (`max_total_results: 5`). Its prompt is short and article-free: the thing being dug
   into, the article's title, author and date, and the sentence it sits in. The model writes the
   query; we keep the **annotations** (url, title, page text clipped to ~1,500 chars) and the search
   count from `usage`. **A response with no search in `usage` throws** — a forced search that did not
   happen is the silent success this file exists to remove, so it fails loudly rather than letting
   Opus answer from memory under a *from a web search* label.
2. **The answer** — the mode's existing streamed call, unchanged in shape, with `power: "high"`
   instead of the article's power, and the sources in **the last user part, after the cache
   breakpoint**, fenced as untrusted page text (the same rule `investigatePart` uses for a paper).
   The model keeps its own server tool and may search more. Searches reported = the search step's
   count + the answer's own; citations = the search step's sources plus any the answer added, deduped
   by URL, through each mode's existing `safeUrl` filter.

Why the quick tier writes the query: it only writes a search query and reads nothing back; the
answer that the reader reads is Opus's. Luna is a third of Sonnet's price for the same five sources.
Why not Sonnet do the whole answer with a forced tool: Greg asked for the bigger model.

**Cache:** dig-deeper answers share the Opus prefix (system + article, tool byte-identical) with a
high-power article's ordinary calls. On a standard article the first dig press writes an Opus copy
of the prefix; later presses within the cache window read it.

**Token ceiling:** Opus 5.5 reasons by default, and the plugin probe above stopped on `length` at
1,500. Each dig call gets its own `max_tokens` (not part of the cached prefix), set from the measured
presses in stage 1.

## Stages

### Stage 1 — the shared action, on Glossary and comments

- `src/dig-deeper.ts`: `searchFirst`, the `DigFindings` type, `findingsPart` (the text block),
  `mergeCitations`, `DIG_DEEPER_POWER = "high"`, the shared copy constants for the client.
- `src/models.ts` / `src/ai-call.ts` / `src/cost-categories.ts`: the `dig-deeper-search` task (quick),
  its `CHAT_REASONING` row and cost category, so the ledger records it with no other work
  ([cost-tracking.md](../project/cost-tracking.md)).
- `src/explain.ts`: `deep?: boolean` becomes `dig?: boolean`. When set: run `searchFirst`, force
  `power` to high, append `findingsPart` + the `DEEP` instruction (reworded: the search has been run
  for you; use it, search again if it does not settle it) in the last part, raise `max_tokens`. The
  tool definition and `SYSTEM` stay byte-identical.
- `term-lookup.ts` `makeLookUpTerm` passes `dig: true`; `routes.ts` `answer()` maps the wire's
  `deep: true` (unchanged wire field) to `dig: true`.
- Client: Glossary button → **Dig deeper** / **Digging deeper…** / tooltip; comment button
  **Search the web** → **Dig deeper**, tooltip likewise. Glossary's wait line keeps *you can carry on
  reading*.
- **Tests, red first:**
  - `tests/dig-deeper.test.ts`: the search request carries `tool_choice: "required"` and the Exa tool
    (**the one that fails if the search is not forced**); a response with zero searches throws; the
    findings land after the cache breakpoint and the cached part is byte-identical to a plain explain.
  - explain with `dig`: model is the high-power model on a standard article; searches = sum;
    citations merged.
  - the request snapshot's `deep` case becomes `dig` (hash re-pinned deliberately).
  - the glossary and comment button copy.

### Stage 2 — Citations' *Investigate* becomes *Dig deeper*

- `makeInvestigateCitation`: `searchFirst` before the answer (query: the work's title, authors, year
  and the citing sentence), findings into `investigatePart`, answer on `power: "high"`. *Look it up*
  and the paper read are unchanged — they identify and read the work; the forced search is the
  dig-in's.
- `INVESTIGATE_PRESS_BUDGET_USD` and the global fuse re-derived from measured Opus presses.
- Copy: **Investigate** → **Dig deeper**, **Investigate again** → **Dig deeper again**, the footer
  *Investigated <date> · Investigate again* → *Dug deeper <date> · Dig deeper again*. The tooltip's
  existing *what* text gains the sentence above.

### Stage 3 — an allowance for the glossary and comment presses

They have **no limit at all** today (glossary.md § *No rate limit, no quota*, raised by Sol on
2026-09-04 and left as a decision). Moving them to Opus plus a forced search roughly doubles the
worst case per press, so this is the point to close it with the machinery that already exists:
a `dig-deeper` `RateBucket` (one additive migration widening `rate_limit_events`' bucket check), a
`DIG_DEEPER_RATE_POLICY` sized from stage 1's measured cost, taken after the free refusals and
before the search, as Investigate does. Generous enough that a reader working through a glossary
never meets it (proposed: 30 an hour, 100 a day, 2 at a time; global fuse from the budget). Comment
*first* answers (the tick-box) stay outside it; only *Dig deeper* presses spend it.

### Stage 4 — docs, the browser check, the feedback note

`tooltips.md`, `glossary.md` (§ Checking a term on the web, the mock), `comments.md`,
`citations.md`, `copy.md`, `high-powered-ai.md` (dig-deeper is always Opus), `cost-tracking.md` if
the new job needs a line; a browser check of each changed button; the line in
261001_1200's follow-ups.

## Library search — a follow-up, not this plan

The tool exists: `search_library` in `src/chat-tools.ts` over `librarySearch.searchLibrary`
(`pgLibrarySearch`, a `tsvector` index, free). It could be called from here. It is left out because
**it is literal**: [chat-tools.md](../project/chat-tools.md) records it finding 0 of ~85 relevant
passages over 18 reader-phrased queries, and semantic search over the embeddings is the planned fix.
Wiring it in now means a prompt section, a way to render a link to a passage in another article in
three different answer components, and a query per mode — for passages it mostly will not find.
**Proposed follow-up:** once library search is semantic, `searchFirst` gains a second, free half
that puts the reader's own best passages beside the web's, named by article title (chat's rule).

## The cost line

To be measured in stage 1 and 2 on real presses (`spideryarn.ai_calls`, local), and stated here:
per press, before → after, for a short and a long article, cache cold and warm. Expected from the
probes: the search step ~$0.007; the answer at Opus prices (about twice Sonnet's per token).

## Simpler options passed over

- **Rename only, keep the model deciding.** Cheapest; Greg said "if it says Check the Web, then it
  always should" and asked for the rename *with* always-search and a bigger model.
- **Sonnet with a forced tool.** One call, works today — but not the bigger model.
- **Opus with the `web` plugin.** One call, forced — but no search count to show and no cache, so a
  long paper costs its whole length at 1.25× on every press.
- **Prompting Opus to always search.** Not forced; the probe shows models skip it on easy questions.

## Risks

- A forced search on something the article defines precisely may bring irrelevant pages. The answer
  prompt says to prefer the article where the web adds nothing.
- Page text in the prompt is untrusted (security-map.md): fenced and labelled as evidence, never
  instructions, as `investigatePart` already does for a paper.
- Latency: +~4 s before the first word. The busy label covers it.
