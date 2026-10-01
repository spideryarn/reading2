# 261001p — *Dig deeper*: one dig-in action, which always searches the web and uses the bigger model

Status: **built** — stages 1–3 landed; Sol reviewed the plan and each code stage (F1–F18 below and in the review files). Owner: the session in worktree `go-deeper`. Overseer-dispatched from
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
model, (2) always answers on the high-power model (Opus) whatever the article's switch says,
(3) puts the reader's own best-matching passages from their other articles beside the web's, through
the library search that already exists, and (4) shares one implementation, `src/dig-deeper.ts`.

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
   count from `usage`. **Success requires `searches !== null && searches > 0`** — an explicit zero,
   missing usage, or usage with neither field spelling all throw, logging which field was read (Sol
   F7). A forced search that did not happen is the silent success this file exists to remove, so it
   fails loudly rather than letting Opus answer from memory under a *from a web search* label. It
   has its own deadline (an abort signal; `openRouterJson` has none of its own — Sol F8).
   Its final text is one more thing: **a short keyword query for the reader's library** (quoted
   phrases, `OR` between alternatives — `websearch_to_tsquery`'s syntax). That query goes to
   `librarySearch.searchLibrary` with `excludeSlug` (owner-scoped, free, injected so `explain.ts` does
   not import the store), top 4 passages, each clipped. Best-effort: none found, or an empty query,
   is fine (Sol F1).
2. **The answer** — the mode's existing streamed call, unchanged in shape, on **`DIG_DEEPER_MODEL`**:
   the high-power model's wire id from `src/high-power-model.ts`, used directly rather than through
   `modelFor(task, "high")`, because a task's environment override wins over power there and would
   quietly put a Dig deeper answer back on Sonnet (Sol F2). The web results and the library passages
   go in **the last user part, after the cache breakpoint**, each set inside one `untrusted(...)`
   region — URL, title and excerpt all, since a page controls its own title (Sol F9) — with the
   instructions outside it. The model keeps its own server tool and may search more. Searches
   reported = the search step's count + the answer's own. The library passages are named in the
   answer by article title (chat's rule); linking to them needs a stored shape and is a follow-up.

**What the sources list means (Sol F4).** The answers are plain text, so we cannot tell which of the
five results Opus leaned on. Rather than claim it cited all five, the list stays one list — the
search step's results plus the answer's own annotations, deduped by URL, through each mode's
`safeUrl` — and its wording changes from *cited N sources* to ***found* N sources** everywhere it
appears (glossary tooltip, comment badge). That is true of old answers, whose annotations are what
the model's own search surfaced, and of new ones, with no schema change. Sol proposed two stored
sets; overruled because the honest wording costs one string and two sets cost a column per mode for
a distinction a plain-text answer cannot support.

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

Sol's review moved the allowance into the stage that first exposes a route (F5): each stage below is
a safe stopping point with its own limit.

### Stage 1 — the shared action, the allowance, on Glossary and comments

- `src/dig-deeper.ts`: `searchFirst` (the forced search + the library query, deadline, witness),
  `DigFindings`, `findingsPart` (fenced), `DIG_DEEPER_MODEL`, `DIG_DEEPER_RATE_POLICY`, and the copy.
- `src/models.ts` / `src/ai-call.ts` / `src/cost-categories.ts`: the `dig-deeper-search` task (quick),
  its route, `CHAT_REASONING` row and cost category, so the ledger records it with no other work
  ([cost-tracking.md](../project/cost-tracking.md)).
- `src/explain.ts`: `deep?: boolean` becomes `dig?: DigFindings`-driven: the caller runs `searchFirst`
  and passes the findings; explain uses `DIG_DEEPER_MODEL`, appends `findingsPart` + the reworded
  `DEEP` instruction in the last part, and raises `max_tokens` (Opus reasons). The tool definition
  and `SYSTEM` stay byte-identical.
- **The allowance (Sol F5):** a `dig-deeper` `RateBucket` (one additive migration widening
  `rate_limit_events`' bucket check), taken after ownership and input checks, before any mutation,
  SSE or model call, freed in `finally`; its lease covers the search deadline plus explain's.
  20 an hour, 60 a day, 2 at a time, a global fuse of 100 a day — § The cost line. Comment
  *first* answers (the tick-box) stay outside it; only Dig deeper presses spend it.
- `term-lookup.ts` `makeLookUpTerm` and `routes.ts` `answer()` (wire field `deep: true` unchanged)
  go through it.
- Client: Glossary button → **Dig deeper** / **Digging deeper…** / tooltip, and **Dig deeper again**
  under an existing answer, replacing it on success and keeping it on failure (Sol F10). Comment
  **Search the web** → **Dig deeper**. *cited* → *found* in both tooltips.
- **Tests, red first:** the search request carries `tool_choice: "required"` and the Exa tool (the
  one that fails if the search is not forced); zero, missing and unrecognised search counts throw;
  findings land after the cache breakpoint with the cached part byte-identical to a plain explain;
  a delimiter in a title stays inside the fence; the model is `DIG_DEEPER_MODEL` on a standard
  article **with `SPIDERYARN_EXPLAIN_MODEL` set**; the allowance refuses before any call; the
  request-snapshot `deep` case is re-pinned deliberately; the button copy.

**Landed** (stage 1 commit `2c7a61a8e`, then the review fixes). Sol's code review
([261001p-dig-deeper-stage1-review-sol.md](261001p-dig-deeper-stage1-review-sol.md)): *land after
fixes*. Kept: **F11** (P1) the library lookup now shares the search step's deadline, so it cannot
outlive the allowance lease; **F13** the refusal sentences no longer promise an earlier answer a
first glossary press does not have; **F14** a search with no sources no longer says they are listed.
**F12 (P1) overruled:** Sol had a comment press claim its row before the search, so a double press
could not buy two searches — with a snapshot comparison in SQL, a new store method, and a new row
state (pending but still carrying the old answer) for the sweep and the client to understand. The
race it closes costs at most one ~$0.008 search, bounded by the allowance's two-at-once, and the
committed order (search, then claim) never touches the stored answer on a failure. Sol's second test
(the old answer survives a failed search) is kept, as a pin on that.

### Stage 2 — Citations' *Investigate* becomes *Dig deeper*

- `makeInvestigateCitation`: `searchFirst` before the answer (its query: the work's title, authors,
  year and the citing sentence), findings into `investigatePart`. **Every model call in the press
  that writes something the reader sees moves to `DIG_DEEPER_MODEL`** — the answer, the paper
  passages and *Look it up*'s verdict (Sol F3); only the Luna search step is not, and it writes
  nothing the reader reads.
- `CITATION_INVESTIGATE_VERSION` bumped, with a test that an old-version row no longer attaches
  (Sol F6); the context hash takes `DIG_DEEPER_MODEL` on both write and read (Sol F2).
- The existing `citation-investigate` bucket stays (no double charge); its lease adds the search
  deadline (Sol F8); `INVESTIGATE_PRESS_BUDGET_USD` and the global fuse re-derived from measured Opus
  presses.
- Copy: **Investigate** → **Dig deeper**, **Investigate again** → **Dig deeper again**, the footer
  *Investigated <date> · Investigate again* → *Researched <date> · Dig deeper again* (Sol's wording).

**Landed** (commit `5aeb86b17`, then the review fixes). Sol's code review
([261001p-dig-deeper-stage2-review-sol.md](261001p-dig-deeper-stage2-review-sol.md)): *land after
fixes*, all taken — **F15** (P1) a lookup made inside a press now reattaches even with a Find model
override set; **F16** the answer's ceiling is `DIG_ANSWER_TOKENS` (4,000), since Opus reasons out of
it; **F17** export and provenance wording; **F18** (the cost comment's Opus price) made moot by
replacing the estimate with measured presses. The implementer ran the search before *Look it up*
rather than after, since the lookup is on Opus too and a failed search should waste nothing; and
added a `searching` stage frame, which an older client ignores.

### Stage 3 — docs, the browser check, the feedback note

`tooltips.md`, `glossary.md` (§ Checking a term on the web, the mock, § No rate limit — now one),
`comments.md`, `citations.md`, `copy.md`, `high-powered-ai.md` (Dig deeper is always Opus, and is not
charged as the switch is), `cost-tracking.md` if the new job needs a line; a browser check of each
changed button; the line in 261001_1200's follow-ups.

## Library search — in, best-effort; links are the follow-up

Sol F1: the search exists (`librarySearch.searchLibrary` → `pgLibrarySearch`, a `tsvector` index,
owner-scoped, free), so it is used, even though it is literal —
[chat-tools.md](../project/chat-tools.md) records 0 of ~85 relevant passages over 18 reader-phrased
queries. A glossary term or a cited work's title is the kind of query literal search does find. When
library search becomes semantic, this seam improves with it. **Not in this plan:** rendering a link
to the passage in the other article, which needs a stored shape in three places; until then the
answer names the article by title.

## The cost line

Measured 2026-10-01 with `npm run eval:cost:interactions -- --slug
evalcost-41wlze3j-long-html-1-spya-dw4wx4 --task explain --task glossary-lookup` — a local article of
186 blocks, 16,855 words, ~42k prompt tokens; results in
`evals/results/cost/2026-10-01-17-43-07-interactions-…/run.json`. *Before* is the explain row: the
same call the old *Check the web* and comment buttons made (Sonnet, the model choosing whether to
search — it chose not to, both times). *After* is the glossary row, now a dig.

| per press | first on the article (cold) | prefix cached (warm) | wall clock |
|---|---|---|---|
| before — Sonnet, model decides | $0.108 | $0.012 | ~5 s |
| after — forced search (Luna) + Opus | **$0.256** | **$0.047** | 20–27 s |

The search step alone is ~$0.008 and ~4.7 s (two live calls). Opus spent ~800–1,100 reasoning
tokens and ~1,350–1,750 output tokens in all, under the 4,000 ceiling. The eval exits 1 because its
warm round's cache read was written by its own cold round; the 41,731 cached tokens read are what
matter here. **So a dig costs about 2.4× a first explain and 4× a warm one**, and a cold press
scales with the article: a 100k-token paper is about $0.60.

**What covers it:** the ledger records both calls with no extra work (`dig-deeper-search` and
`dig-deeper`, both "interactive request work", attributed to the article by the route), and
`DIG_DEEPER_RATE_POLICY` bounds it — 20 an hour, 60 a day per reader, two at once, and a global fuse
of 100 presses a day (~$60 at the very worst, $5–25 mostly warm). The glossary and comment presses
had no limit at all before this.

### Citations' Dig deeper (stage 2)

Measured 2026-10-01 with `npx tsx scripts/probes/261001p-investigate-cost.ts`, the production
`investigateCitation` under `collectSpend`, provider-reported cost, on `scaling-hypothesis` (~42k
tokens):

| cited work | search | *Look it up* (Opus) | answer (Opus) | press | wall clock |
|---|---|---|---|---|---|
| spya-cxq887 | $0.007 | $0.049 | $0.258 | **$0.314** | 40 s |
| spya-x70954 | $0.007 | $0.050 | $0.235 | **$0.292** | 34 s |

Before, on Sonnet: $0.120 average, $0.153 worst (plan 260930a's probe). So about **2–2.5×**.
`INVESTIGATE_PRESS_BUDGET_USD` is $0.80 and the fuse 25 a day ($20), inside the existing
`citation-investigate` allowance (20 a day per reader).

**An observation, not fixed here:** the second press, a minute after the first on the same article,
read **nothing** from the cache (42,460 written, 0 read), although the route is pinned to Anthropic
and the article part is byte-identical. Explain's dig presses do read across presses (41.7k in the
eval above), so the difference is likely Investigate's Exa server-tool parameters
(`max_characters`) or OpenRouter's tool loop. Whether it predates this plan was not checked. Worth
about $0.18 a press on a long article — a follow-up.

## Follow-ups

- **Investigate's cross-press cache miss** — above.
- **Library passages as links**: the answer names another article by title; a link to the passage
  needs a stored shape in three places.
- **`SPIDERYARN_CITATION_INVESTIGATE_MODEL` no longer moves any reader-triggered call** (every
  reader-visible call in a press is `DIG_DEEPER_MODEL`); it stays in the inventory, documented as
  such in setup-dev.md. Retire it, or keep it for evals.
- **The $20/day Investigate fuse against 20 a day per reader** — two busy readers can use it up; the
  ceiling is Greg's.
- **Search quality**: one browser press on *charisma* returned some odd hosts (an audio-AI site, a
  conference upload). The search step's prompt is one line of aim; worth an eval if readers notice.

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
