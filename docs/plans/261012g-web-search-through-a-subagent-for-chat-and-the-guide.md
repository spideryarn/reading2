# 261012g — Web search through a subagent, for the guide and then Chat

Owned by [plans.md](../project/plans.md). Queue item `qi-ht2wtjg8` (supersedes `qi-zvsky2aj`),
session `fbvc6uzm-web-search-subagent`.

**Status:** stage 1 being built, 2026-10-12. Spikes done:
[261012b](../investigations/261012b-web-search-subagent-spikes.md). GPT Sol's plan review:
[261012g-plan-review-sol.md](261012g-plan-review-sol.md), *sound with fixes*; every finding was
taken, and the one blocker (page-reading for the guide) became a question to Greg.

Two admin inputs, one piece of work. Both were proven Greg's (`feedback-reporter.ts` exit 0).

> You said 'I gave it search, it went wrong, and I took it out'. Let's try and get it working well.
> / Perhaps the web search tool that we create has an option for web search to run in a subagent
> (which hands back links/summary) for the caller-agent to retrieve if it chooses to? Or is there an
> OpenRouter web search API that would do this well? Run some spikes. / Obviously if it's really
> complicated let's discuss further, but it feels like it should be feasible.
>
> — Greg, reply `spya-q2z37j` to [q-w26r6u](../user-feedback/questions/q-w26r6u.md), 2026-10-12 10:10 UTC

> In a previous Feedback report, I suggested being able to @-mention another article from my shelf
> in a Chat. We'd equally like to be able to drop in urls or request web searches (perhaps these
> would be carried out by a smaller (e.g. Haiku) subagent), and then one or more of the results
> could be loaded into the Chat's context, so that I could ask stuff like 'where is this article
> situated in the wider literature?' etc.
>
> — Greg, report `spya-vc6uzm` (#579, `SPIDERYARN-READING2-HY`), 2026-10-12 10:07 UTC

## What the spikes settled

- **There is no OpenRouter search endpoint.** Search exists only inside a model call. A forced
  search on a cheap model is the nearest thing.
- **A subagent works and is cheap.** In one forced-search call (which searched twice on 2 of 6
  queries), GPT Luna writes up to five
  lines of a title, a link and one sentence. That took 8.8 s and $0.007 at the median, 5 results every
  time. Haiku 5.5 was the same price, and 1 link in 30 was mistyped.
- **GPT Sol's in-loop design would also work.** Annotations arrive even when the model writes
  nothing, 6 of 6. **It is the simpler-looking option passed over**: it is a special case in the
  loop every conversation runs through, keyed on one exact failure shape. The subagent removes the
  failure instead. Its results are an ordinary `tool` message, and a `tool` message is still there
  in the next round whatever the guide called alongside it.

## The tool

```
 guide / Chat (Sonnet)                       search_web (ours)                  OpenRouter
 ─────────────────────                       ─────────────────                  ──────────
 calls search_web({query}) ───────────────▶  forced Exa search,  ────────────▶  Luna + Exa
                                             ≤5 results                        (one call, ~9 s)
                                             ◀──────── lines + annotations ────
                                             keep a line only if its URL came
                                             back from the search; title from
                                             the search; fence it
 ◀──── tool message: title · link · sentence ×≤5, fenced as untrusted ─────
 may read_web_page(url) one of them (where the kind has it)
 writes the answer, with the links
```

- **`search_web(query)`, a function tool in `src/chat-tools.ts`**, dispatched by `runTool` like the
  others. The work is in a new module, `src/web-search-subagent.ts`, so the tool file stays about
  dispatch.
- **The call.** A new job, `web-search-subagent`, on the chat wire, **quick tier**. Quick resolves
  to GPT Luna today: no mistyped links in 28, and the house rule is a tier rather than a hardcoded
  model (`modelFor`). The report's "e.g. Haiku" was an example, and Haiku measured the same price
  with one dead link. It sends `openrouter:web_search` with
  `engine: "exa", max_total_results: 5, max_results: 5` and `tool_choice: "required"`, the same as
  Dig deeper's search (`digSearchRequest`, [`src/dig-deeper.ts`](../../src/dig-deeper.ts)), for
  the same reason: the annotations are what the call is for.
  - Route: `provider: { require_parameters: true }`, `dig-deeper-search`'s row and reason.
  - Effort `low`.
  - Registered in the seven places a job is: `AiJob`, the tier, `AI_JOB_WIRE`, the route table,
    effort, the cost category (*interactive request work*), and the model env override.
- **What comes back to the caller**, built by us and not passed through from the model:
  - each summary line is parsed. **It is kept only if its URL is one `collectSearchEvidence` kept**
    (http(s) only, deduped). The title is the search's, not the model's. A line that fails is
    dropped. If none survive, the result falls back to the annotations: title and URL only, with
    no sentence.
  - The whole result is wrapped in `untrusted("web search results", …)`. The sentences are a
    model's paraphrase of strangers' pages, so they are a stranger's words for this purpose.
  - It ends with one line outside the fence. For a kind that has `read_web_page`, it says to call
    that to read a result in full (Greg's "for the caller-agent to retrieve if it chooses to"). For
    every kind, it says to link what the answer uses.
  - Bounded by its parts: five results, each sentence at most 400 characters. That is checked
    provenance: the link came back from the search. **The sentence itself is not checked**; it is
    still a model's account of a page.
- **Failures are results, not throws**, as `read_web_page`'s are: no search ran (the
  `whereSearchCountCameFrom` witness), a timeout of 25 s, the provider refused. Each returns a short
  "the search did not run / found nothing; say so, do not answer from memory as if you had
  searched". The reader's stop (`ctx.signal`) aborts the call.
- **Logging** (`src/log.ts`): host count, result count, ms, searches, model. **Never the query**,
  the [chat-tools.ts](../../src/chat-tools.ts) rule.
- **Label** for the run strip: `searched the web`. Detail: `N results`.
- **Cost**: the call is made inside the chat route's `handleApi` collector, with the slug in the
  route path, so it is recorded and attributed with nothing extra
  ([cost-tracking.md](../project/cost-tracking.md)).

## Stages

### Stage 1 — the guide searches through the subagent

- `search_web` goes into `GUIDE_TYPED_TOOLS` (typed guide only). **Not `GUIDE_TOOLS`**, which Live
  is offered, and Live is its own item (`qi-vcza3y2f`). The guide's provider search stays `null`
  (`webSearchTool`), so there is one way for it to search.
- **No page-reading for the guide.** GPT Sol's plan review (F2, a blocker) did not agree that
  "for the caller-agent to retrieve if it chooses to" plainly chooses page-reading. The words can
  mean receiving the links and sentences, and q-w26r6u had offered "search only, no page-reading"
  as its own option. Each conversation's tool list is one of the defences
  ([security-map.md](../project/security-map.md)), so the question goes to Greg (§ Stage 3's
  question file). Until he answers, the result tells the guide only to link what it uses.
- **A hard budget: two `search_web` calls a turn** (`SEARCH_WEB_PER_TURN`), and a 300-character
  query cap. Sol's F3: a query is text leaving for Exa. A hostile article can ask for several in one
  batch, and `MAX_TOOL_ROUNDS` bounds rounds, not calls. Chat's provider search has the same broad
  exposure; what is new is that the guide now has an outbound channel at all, and this one is ours
  to bound. A third call is refused, not run.
- **The prompt**, written on top of 261012f's wording once that lands (session
  `fbes283p-guide-hands-off-to-chat`, agreed by message 2026-10-12). It goes in that plan's
  section on content questions, and the line it draws:
  - **Search when the question bears on how to read this piece**: is it well regarded,
    contested, superseded; what to read before or alongside it; who the author is. Answer inside the
    guide's length rule (under 60 words): one sentence and the links.
  - **Do not search a question about what the world says on the piece's subject.** That is a
    content question, and 261012f's `chat` next step takes it to Chat, which searches.
  - Replace the "Chat can do what you cannot: search the web…" paragraph, and update
    `tests/web-reach-every-kind.test.ts`'s assertion on it.
- **Measured** with `evals/chat-web-reach.ts --kind guide`, which needs a case set for the
  how-to-read searches. Done when:
  - those target cases search and answer with links, in at least 5 of 6 tries;
  - no answer says it has not looked something up after a search ran (the 261011t failure);
  - the controls stay unsearched.
- **Tests** (unit, no network, a stubbed `openRouterJson`):
  - the request shape: Exa, `tool_choice: "required"`, the job name;
  - a stray link is dropped, and the title comes from the search;
  - the no-search witness returns the failure content;
  - the fence is applied;
  - the query is never logged;
  - `toolsFor("guide")` has `search_web` and Live's list does not;
  - `runTool` refuses `search_web` for a kind that does not list it;
  - the budget: a third call in a turn is refused, and a new turn starts again (seen red with the
    check disabled);
  - **the 261011t shape, through `converse`** (Sol F1): a round with no words that calls
    `search_web` and `offer_next_steps`; both results reach round two by their ids, and round two's
    words are the answer.
- **Docs**: [chat-tools.md](../project/chat-tools.md) said web search is OpenRouter's only, that the
  guide has none, and that its tools never leave the article (Sol F6). It gets `search_web`, the
  guide's new outbound channel, and its bounds in the security section.

### Stage 2 — Chat: measure before switching

**Done 2026-10-12: not switched.** It searched in the same places and cost about 15% less. But it
was 11 s slower on every turn that searched (27.7 s against 16.4 s), and it lost the citation chips.
Numbers in [261012b § Chat through the subagent](../investigations/261012b-web-search-subagent-spikes.md#chat-through-the-subagent-measured-and-not-switched).
Learn, Tutorial and Explore keep provider search with it. Nothing in Chat's code changed.

Chat already searches, with OpenRouter's search inside Sonnet's reply. That brings two things the
subagent would have to match: **the citation chips** under an answer, which come from the search
annotations (`collectCitations`), and the search happening **inside the stream** with no extra
round. The subagent costs a round and about 9 s, and gives back about 1.5k characters where the
provider search gives ~10k per search to every later round.

- Run `evals/chat-web-reach.ts --kind chat` twice, as today and with `search_web` in place of the
  provider search. Compare the targets that search, links per answer, time to the first word, and
  cost per turn (from the ledger).
- **Switch only if all of these hold** (Sol F4):
  - the targets and controls behave no worse;
  - the answers, read side by side, are no worse;
  - the citation chips survive, with the kept results feeding `citations` the way annotations do,
    not just links in the prose;
  - a whole turn costs less;
  - the time to the first useful words is not materially worse.

  Otherwise Chat keeps provider search, and the note says why, with the numbers.
- **Learn, Tutorial and Explore are each measured before they change** (Sol F5). Their prompts make
  different search decisions, which 261011t showed. `search_web` goes into each typed kind's own
  list in `toolsFor`, never into `CHAT_TOOLS`, which Live and Candidates share.

### Stage 3 — "load one of the results into the conversation": a question, not a build

What exists after stage 1: a pasted URL is read for that turn (`read_web_page`). An answer's links
stay in the conversation's history, so "tell me more about the second one" can open it again. What
does not exist is **a page kept in the conversation, whole, for later turns**.

The @-mention work (`fba63vmt`, plan 261012d) is how a whole text enters a conversation: one of
the reader's own articles, chosen by the reader, fenced, with block ids, citable. By design no tool
or model can add one. The agreed seam is a reader-pressed button that imports the page to the shelf
through the ingest queue, then puts it in the composer as a pending mention.

That costs the reader **one article slot per page** (admins exempt), and an import takes seconds
for a web page and minutes for a PDF. That is a product call, so it goes to Greg as a question.
Recommended: the button, on each link in a search result and on a pasted URL. Against it: keeping
the page in this conversation only, a second storage path with no block ids, which
[261011v](261011v-chat-attachments.md) declined as shape B.

## Not doing

- GPT Sol's in-loop recovery round. The subagent makes it unnecessary.
- Search in Live (`qi-vcza3y2f`). The tool could serve it later, since it runs on our server.
- Other people's public articles or pages entering a conversation without the reader pressing
  anything.
