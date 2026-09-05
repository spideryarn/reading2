# Debate mode — what the rest of the web says about this piece

**Status: planned, not built.** Written 2026-09-05. Second draft, after Stage 0's spike
([results](260905f-debate-mode-stage-0-spike-results.md)) and a GPT Sol plan review that refused the
first draft on four established P1s. The ledger is at the bottom.

The fourteenth mode. Everything else in the band is *about the article*, derived from the article.
This one is the first whose content **is not in the article at all**: it goes out to the open web and
comes back with what other people have written — replies to this piece, and the argument around the
claims it makes.

Greg asked for it on 2026-09-05:

> Let's add a new mode (perhaps called Critiques or Critical Reception or something along those
> lines) that gathers from the wider web about the article, e.g. reviews, critiques, etc (ideally
> from authoritative sources). Perhaps as a v1 it can reuse the machinery from the Chat (which can
> already spawn multiple search the web tool calls). It should be marked as an Experimental Feature
> for now. … e.g. cluster the points made, and/or enabling ranking by Chronology/Valence/
> Incisiveness, with a Prioritised default sub-mode that combines them with threshold UI, a bit like
> Glossary etc. Provide citation/linking, with rich tooltips (e.g. with excerpts).
>
> — Greg, 2026-09-05

## The one thing to understand before anything else

**The web search never comes back empty.** Stage 0 asked for pages responding to an invented blog
post — *"Notes on my sourdough starter, week 3"*, at a domain that does not exist. Three searches ran
and **nine annotations came back**, every one a real, correctly-cited page about sourdough starters,
and not one of them a response to anything.

So *"nothing found"* is not a state the wire produces. It is a state **we manufacture, by refusing
rows**. And the raw material for a convincing fabrication is always present and always correctly
cited: a row reading *"gratzioso.net — qualifies — argues day-3 starters need warmer water"* would
pass Referee Candidates' rule 1 unmodified, because that URL genuinely was returned by the search.

**Rule 1 proves the link. It says nothing about the relationship.** Every validation decision below
follows from that sentence.

## The product calls

Fable was asked for ideas first and disagreed with three parts of the brief; Greg settled them the
same day. One further call was mine, and GPT Sol overturned it — see § 4, which now lands closer to
what Greg originally asked for than my version did.

### 1. The name is `debate`

Not `critiques`, not `reception`. Greg's pick, and the reason is that both obvious names promise
something false on most of the shelf: *reception* presumes the piece was noticed, *critiques*
presumes the response was hostile — so it reads wrong over a corroboration or the author's own later
correction, two of the most useful rows this mode can produce.

`responses` was the runner-up and was refused on the code: `Response`, `respond()`, HTTP responses
and chat answers are all over `src/`, and one word meaning two things is the collision this repo paid
a `toc` → `hierarchy` rename to escape ([`src/modes.ts`](../../src/modes.ts)).

### 2. Two groups, two passes

Most articles have **no critical reception at all**. A mode that is empty four times in five reads as
broken rather than honest. Greg:

> If no one (or few people) have written about this piece, let's just say so. Perhaps also include
> searches for people who have written about these or very similar ideas, even if they haven't read
> this exact piece, and suggest how they might apply here (and be clear about how they don't apply),
> if they do apply directly?
>
> — Greg, 2026-09-05

So: **About this piece** and **About what it claims**.

**They are two separately metered model calls, not one call producing two lists.** This is Sol's F1
and it is the difference between a true sentence and a false one. OpenRouter reports a search
*count* and never the *queries* ([chat-tools.md](../project/chat-tools.md)), so from one blended call
we cannot tell "nobody responded to this piece" from "the model only ever searched for the topic".
The repo has already observed the search tool being offered and simply not taken
([chat-tools.md § Asking whether a claim holds up](../project/chat-tools.md)). Group one being empty
is the mode's most common output; it must not be an inference.

- **Pass A — direct reception.** Prompted with the article's exact URL, title and byline, and nothing
  else to search for. Must report a positive web-search count; zero, or unreadable search accounting,
  **fails the pass and writes no conclusion** rather than writing an empty one.
- **Pass B — the argument around the claims.** Prompted with the article's claims.

**The empty state says what is true**: *"This search did not find any responses to this piece."*
Never *"No one has written about it."* We cannot see the query, so what we have is evidence of a
bounded search, not a claim about the web. Two passes cost about **$0.13 a run** at Exa (Stage 0
measured $0.066 each); that is named here so it is a decision rather than a surprise.

**What makes a group-two row admissible** is the second half of Greg's instruction, and it is the
only thing standing between this mode and nine sourdough blogs presented as critical reception:

- `claimQuote` — the article's own words for the claim being answered, **located in `blockId` by
  [`findQuote`](../../src/quote-match.ts)**, not merely asserted;
- `blockId` — where the article makes it;
- `sourceQuote` — see § Attribution below;
- `applies` — how the outside piece bears on that claim;
- `limits` — where it does *not* bear on it, **optional and only where there is a real mismatch**.

Requiring `limits` on every row was the first draft's rule and Sol was right to cut it: a mandatory
caveat field manufactures caveats. The prompt is told to **omit a row rather than invent a
limitation**.

### 3. Valence is a direction with an icon, never a score

Greg:

> Maybe we could also apply a positive/negative icon and red/green colour scheme, but without a
> score, but it is useful to be able to see at a glance where the critiques vs praise are, for
> example.
>
> — Greg, 2026-09-05

> We could perhaps choose to calculate a Valence score but deliberately not show it. Or we could just
> have valence be (+1, -1, neutral, unknown), and include it?
>
> — Greg, 2026-09-05

The second note names the shape: **a small closed set with an explicit unknown**, not a number. No
`−100…+100`, and no percentage anywhere. Fable's argument for that is worth keeping on the record,
because the tempting version is the one we are not building:

> A taxonomy is a map; a valence is a scoreboard.

A "62% negative" line hands the reader a verdict on a piece they are in the middle of reading, which
is the summary-shaped failure [vision.md](../project/vision.md#anti-goals) exists to refuse.

**Referee mode's signed valence is not a precedent**, and the difference should stop anyone
reconciling them later: `Comment.valence` is **the referee's own placement** of a passage on their own
criterion ([`src/types.ts`](../../src/types.ts)) — a person's judgment, stored as such. This would be
the model grading strangers' articles: same shape, different instrument.

### 4. Three orthogonal fields — my call, overturned, and Greg was right

The first draft made the icon a *derived* property of a single `relation` field, on the grounds that
two overlapping vocabularies drift and the one that drifts is the one the colour comes from. **Sol
refused it and is correct**, so it is recorded here as a reversal rather than quietly fixed:

- **`follow-up` is provenance, not relation.** An author's own later post can dispute, qualify,
  extend or corroborate their earlier piece — and *"the author later corrected this"* is among the
  most valuable rows the mode can produce. Deriving valence from relation makes it **neutral by
  construction**, which throws the useful part away.
- **A `qualifies` row can be broadly supportive or broadly hostile**, and collapsing that loses
  exactly the at-a-glance distinction Greg asked for.

So three closed fields, each doing one job:

| field | values |
|---|---|
| `relation` | `disputes` · `qualifies` · `extends` · `corroborates` · `unclear` — **groups the list** |
| `sourceRole` | `independent` · `author-follow-up` — **draws a badge** |
| `valence` | `positive` · `negative` · `neutral` · `unknown` — **draws the icon and colour**, from a total `VALENCE_APPEARANCE` record |

No numeric valence is computed or stored, in keeping with § 3. `unclear` and `unknown` are **not
failure states and must be drawn as calmly as the rest** — [timeline.md](../project/timeline.md)'s
rule about undated rows is the closest thing in the app to this problem: *ten of twenty-six rows carry
no date, and drawing an undated row like a dated one throws away what the article actually said.* A
model that cannot tell whether a page agrees should say so and be believed.

## The shape: an artefact, not a thread

Greg's *"reuse the machinery from the Chat"* is right about the **wire** and wrong about the
**container**. A technical fork, so it is settled here rather than asked.

Reused, and it is most of the work: the `openrouter:web_search` server tool, the Exa branch,
citation collection, and Candidates' validation discipline. Not reused: the thread. `debate` is a
jsonb artefact on `article_revisions` like Glossary, Ideas, Quotes and Timeline.

1. **The reader is scanning a list, not holding a conversation.** Candidates wrote this down after
   finding it ([`src/referee-candidates.ts`](../../src/referee-candidates.ts)): people *like* chat and
   *perform worse* with it on comparison tasks. Candidates keeps its thread because an editor must
   steer the search with their own criteria; a reader asking *"did anyone answer this?"* need not.
2. **A transcript cannot be shared and a list can.**
   [chat-tools.md § A transcript cannot be published by column allowlist](../project/chat-tools.md)
   settles that chat stays off public links because the disclosure is in the prose. An artefact with
   named fields crosses the existing DTO allowlist.
3. **Everything downstream — ranking, threshold, grouping — reads off a stored list**, not a fenced
   block parsed out of the newest assistant turn.

### The wire, stated correctly

The first draft called this *"the first pipeline stage on the chat wire"* and that was wrong twice
over — Stage 0 found one counter-example and Sol found another:

- [`src/pdf-read.ts`](../../src/pdf-read.ts) is pipeline stage 2 for a PDF and calls `openRouterJson`
  non-streaming with a top-level `plugins` array OpenRouter acts on server-side;
- the `extract` path invokes `openRouterFrontMatterReader`
  ([`src/pipeline.ts`](../../src/pipeline.ts)), which is a metered `openRouterJson("pdf-frontmatter", …)`
  chat-wire subcall inside pipeline work.

**The accurate claim:** every existing *artefact-producing* `StepName` uses the Messages wire; Debate
is the first top-level artefact step whose own task is on chat/completions, and the first call
anywhere in the pipeline to require `openrouter:web_search`. So reuse the front-matter call's
accounting and abort lifecycle, and treat only the web-search and annotation differences as new.

**Debate is deliberately not an `ArticleStage`.** `STAGE_EFFORT` and `ARTICLE_RENDERER`
([`src/models.ts`](../../src/models.ts)) are `Record<ArticleStage, …>`, and `ArticleStage` is a
*subset* of `StepName` covering the Messages-wire stages that share a byte-exact cached article
prefix. Debate shares no such prefix, so it takes no row in either, and none in
`cacheArticleForStep`. That exception is documented rather than discovered, because
[new-mode.md](../project/new-mode.md) lists both tables among the ones the compiler asks for and a
reader will otherwise go looking for the missing rows.

## Attribution: every row shows words that actually came from the page

Ported from Candidates' rule 1 and then **strengthened**, because Stage 0 showed rule 1 alone is not
enough here:

1. **A row's identity is a URL the search returned in this run** — from OpenRouter's own
   `url_citation` annotations, not "a URL that parses". `isWebUrl` is necessary and nowhere near
   sufficient: a plausible title beside a real-looking address is exactly what a model produces well.
   The **title** comes from the search result, never from the model.
2. **Every row carries a `sourceQuote` that `findQuote` locates in that URL's own extract.** Failure
   **drops the whole row** and increments `unverifiedSource` — it does not merely drop the quote. The
   first draft let a row survive as "a paraphrase, labelled as one", and Sol's F2 is right that this
   is precisely the hole: a model can attach an invented critique to an unrelated but real annotation
   URL, and a label saying "paraphrase" does not stop it being read as evidence. **No row survives as
   an unchecked paraphrase.** The stored substring is the matched source characters, not the model's
   spelling of them.
3. **`relation`, `valence` and `applies` are labelled on screen as the model's reading of that source
   passage** — not as facts about the page.

What this still cannot prove, said plainly because the panel must say it too: that the source passage
means what the model says it means. The excerpt in the tooltip is the reader's one-action check —
[vision.md](../project/vision.md#principles) principle 4, legible provenance, pointed outside the
article.

### The engine is a cost decision, not an evidence decision

The first draft said `engine: "exa"` was *"load-bearing, not a preference"*, following the
measurement in [`src/converse.ts`](../../src/converse.ts) § `webSearchTool` (default engine → **0**
annotations). Stage 0 found the default engine returning **20** annotations on the non-streaming
path, every one carrying `content`.

**This does not make the 2026-09-01 measurement wrong**, and nothing here should be read as saying so:
that probe was on the **streaming** path, where annotations arrive as deltas as the answer is
composed; this one is non-streaming, where the finished message arrives with annotations attached.
Different code paths at OpenRouter, plainly behaving differently. The narrow established claim is:
**for a non-streaming call, both engines supply the evidence rule 1 needs.**

So Exa is chosen on cost — $0.066 against $0.115, for adequate annotations — and the comment in the
code must say *cost*, so nobody later "fixes" it to say something untrue.

**One thing to hand to whoever owns Referee**, not acted on here because it is another stage's code
([architecture.md § Stage ownership](../project/architecture.md#stage-ownership)): Candidates'
Exa branch is justified in-code by that zero-annotation result, which is a streaming measurement.
Still standing, still plausible, and untested by this probe — worth one re-probe on their own path
before anyone treats "default gives no annotations" as a general fact about OpenRouter.

### "Authoritative sources" is a wish

Greg asked for *"ideally from authoritative sources"*. There is no honest way to rank authority: any
list we maintain is wrong per domain, and on an ML paper the sharpest critique is routinely a
pseudonymous blog. So:

- **the host is the most prominent thing on the row** — the authority signal a reader can judge, free;
- the prompt prefers named authors and established venues;
- **the panel says no ranking by prominence is applied**, or the reader will assume the order means
  something.

**The source-kind classifier is cut from v1** (Sol's closing note). *"journal / established
publication / personal site"* is a model guess wearing the clothes of a fact, and the hostname
already carries it for a reader who can judge. Revisit with a label that says whose guess it is.

## The spend ceiling

`max_uses` is **not a budget** and must never be described as one: a probe asking for 2 got 6
([`src/converse.ts`](../../src/converse.ts)). `max_total_results` is the cap that was honoured to the
row, and `STEP_BUDGET_MS` only decides whether a step may start ([`src/jobs.ts`](../../src/jobs.ts)) —
it is not a cost limit, and a job requeue buys the call again.

So: one metered request per pass, with `engine: "exa"`, an explicit `max_total_results`, `max_results`,
a completion ceiling and an abort deadline. **Stage 0b proves the cap** with an adversarial prompt
asking for far more searches than allowed, checking returned annotations against ledger
`webSearches`; if the cap is not demonstrably enforced, stop and re-plan. The per-attempt ceiling and
the worst case across the queue's requeue allowance both go in this doc.

## What is counted, and what is shown

"Drop counts" is not a specification. A model can produce 42 rows, a cap can stop the loop at 30, and
every validation counter can still read zero — which is why Candidates keeps a separate `omitted`
([`src/referee-candidates.ts`](../../src/referee-candidates.ts)). The artefact stores:

`reportedRows` · `keptRows` · `omittedOverCap` · and **every validation loss by reason**
(`uncited`, `unverifiedSource`, `claimNotInBlock`, `unknownBlockId`, `sourceNotPublishable`).

Rows beyond `MAX_DEBATE_ROWS` are **counted before iteration stops**. A malformed answer, or
`finish_reason: "length"`, **fails the step and writes no artefact** rather than storing a truncated
list that looks complete. The panel and the public DTO show a loss sentence whenever
`reportedRows !== keptRows`. Tests mutate each filter and the cap and assert the exact on-screen
sentence — the ✧ line Quotes already draws, for the same reason
([silent-success.md](../reusable/silent-success.md)).

## `searchedAt`, and why it is not staleness

Debate is time-sensitive research and a shared link outlives it. `searchedAt` is stored as an ISO
timestamp, crosses **both** the owner and public DTOs deliberately, and the panel says *"Searched on
…"*. The precedent is the web-backed glossary shape, which already records that its answer is about
the web *on the day it was asked* ([`src/types.ts`](../../src/types.ts)).

**`stale` continues to mean the article changed.** Age is displayed provenance, not automatic
staleness — a visitor opening a year-old shared article must be able to see how old the search is
without the artefact declaring itself invalid.

## Security

Everything in [chat-tools.md § Security](../project/chat-tools.md) holds: `untrusted()` fencing with
delimiter breaking, our words outside the fence, extracts rendered as **text and never as markup**.
Two things are specific to this stage:

- **The excerpt is stored and later shown to a signed-out visitor**, which chat's fetched pages never
  were. Every row's URL is re-judged at the boundary by
  [`publicCitationUrl`](../../src/urls.ts) — which refuses credentials and non-public hosts, and is
  already what `publicComments` uses. **A refusal drops the whole row**, not just its URL, and
  increments `sourceNotPublishable` in the visitor's foot line: a row with no source violates this
  mode's own invariant, so there can be no public `DebateRow` type without a URL. Mutation tests
  substitute a credentialled URL and a private-host URL and assert the row disappears, the loss is
  disclosed, and the address is never emitted.
- **Logging**: host, counts, elapsed, statuses. Never a full URL, never an extract — the same rule as
  [logging.md](../project/logging.md), and the reason `collectCitations`'s `onDropped` deliberately
  takes no argument.

## Stages

Each ends green and commit-worthy. Sol reviews at the end of every stage.

### Stage 0 — done

[Results](260905f-debate-mode-stage-0-spike-results.md). Non-streaming chat-wire web search works;
`url_citation` carries `content` (236–4,945 chars under Exa); Exa costs $0.066 and ~10 s a call; and
an article with no reception yields nine plausible, correctly-cited, entirely irrelevant pages.

**Stage 0b, still to run**: the adversarial cap probe under § The spend ceiling.

### Stage 1 — `SearchEvidence`, kept away from `Citation`

The first draft grew `Citation` itself and claimed "existing callers unaffected". **That was false**
(Sol's F5): `collectCitations` is shared by Chat, Explain and Referee Criteria; chat citations are
written wholesale into `chat_messages` ([`src/store/pg-chat.ts`](../../src/store/pg-chat.ts)) and
explanations persist on comments. Widening it would silently start storing third-party page extracts
for three unrelated features.

So `Citation` stays `{ url, title? }`. A separate `SearchEvidence` — `{ url, title?, excerpt? }` —
and an **opt-in** evidence collector are used only by Debate (and available to Candidates, whose own
doc already names this as its first follow-up). Tests prove the excerpt is retained on the opted-in
path and **absent** from ordinary chat and comment persistence. Frames copied from a live response,
not imagined ones.

### Stage 2 — the stage and the artefact

`ArtifactKind` / `ArtifactMap` / `SHAPE` / `STAMP_SOURCE`; the filesystem decoder; `StepName`,
`STEP_ORDER`, `STEPS`, `STEP_BUDGET_MS`; `TASK_TIER`, `TASK_WIRE`, `MODEL_ENV_VAR`, `AI_JOB_ROUTE`
(with `provider.require_parameters: true`, for the reason `referee-candidates` gives: a fallback that
silently drops the search tool leaves a model answering from memory, which is a *full* panel of
uncitable rows); the SQL CHECK migration; `REVISION_CARRY_POLICY` (`debate: "carry"`);
`ArticleReader.loadDebate` and **both** adapters; and the per-kind GET route.

`DebateFound` carries `{ debate, stale, outdated }`; `sourceHash`, `PROMPT_VERSION` and `isStale` are
defined and compared **by both adapters**. Debate takes no `ArticleStage` row — see § The wire.

`src/debate.ts` holds the two passes, the validation and the counting. Runnable on its own against a
slug. **Red-before-green test built from the Stage 0 sourdough probe**: an article with no reception
yields an empty group one, a group two in which every row carries `claimQuote` + `blockId` +
`sourceQuote` + `applies`, and a visible drop count. `STEP_BUDGET_MS` starts at 120 s and is
re-measured at the end of this stage rather than left a guess.

### Stage 3 — the band

`MODES` and the five client tables; the band branch and its owner/visitor pair; `DebatePanel.tsx`;
the two groups; the `VALENCE_APPEARANCE` icons and the `sourceRole` badge; the ⓘ excerpt card
(`ProseHoverCard`, which already takes pointer events and carries a link out); the foot line.
`useDebate` on `useOrderedRead` and `useStepJob`, with `useAutoRun` so **only an owner pressing an
empty mode** starts the job — arrival and visitor rendering never POST. `CACHEABLE`. Behind the
experimental switch, `experimental: true` in `MODES_UI`, reason in the table there.

### Stage 4 — the shared link, and the docs

`PUBLIC_PROJECTIONS` (a missing line here is the one silent failure in the whole public path —
`tests/public-projection-columns.test.ts`), the public DTO with `publicCitationUrl` per row and the
`sourceNotPublishable` count, the export put-chain. `docs/project/debate.md`, its line under
[reading-view-overview.md](../project/reading-view-overview.md), and its row in
[experimental-features.md](../project/experimental-features.md).

## Deliberately not in v1

- **Add a response to the shelf** — one button; the ingest queue exists. Fable ranked this top and is
  right: it turns a snippet into something you read deeply *here*. Out only because it is a second
  feature wearing this one's clothes.
- **Marks in the prose and the spine** — one resolver into `search-hits.ts`'s `Found` currency, as
  Ideas did. The first thing to add; it is what makes this a reading mode rather than a results list.
- **`?rank=` and the threshold bar.** Cheap, because [`src/web/threshold.ts`](../../src/web/threshold.ts)
  is already shared by Glossary, Quotes and Search. Out because a gate over six rows invents a
  ranking (Ideas' argument), and nobody yet knows how long a real list is.
- **A combined `prioritised` default.** Refused rather than deferred — the one place the brief is not
  followed. Chronology is not a score, relation is not signed, and after removing both there is
  nothing to combine but incisiveness alone. Quotes' precedent governs: a composite the reader can
  neither interpret nor check is our arithmetic dressed as the model's judgment
  ([quotes.md](../project/quotes.md)). `document` order stays the default.
- **Clustering the points made** — what a reader wants at fifteen-plus rows, and two removes from any
  source, so the least verifiable thing on the list. Build it when lists are regularly long, and make
  each cluster's evidence the rows underneath it.
- **Find more** — an append pass with the URLs already found as a forbidden list, the way the glossary
  appends.
- **The upstream piece** — what *this* article is responding to. Reception in reverse, often the best
  critique available, and it may belong in group one.
- **The source-kind classifier** — see § "Authoritative sources".

## The simpler option passed over

**A chat thread, exactly like Candidates** — a fourth `ThreadKind`, no artefact, no step, no
migration, and Greg's *"reuse the machinery from the Chat"* read literally. Genuinely less work, and
refused for the three reasons under [§ The shape](#the-shape-an-artefact-not-a-thread), of which the
sharing one is decisive.

## Review ledger — GPT Sol, round 1, 2026-09-05

Verdict: **refused as written**, on F1, F2, F4, F6. All eleven findings accepted; two were checked
against the tree first and both held (`STAGE_EFFORT` is keyed on `ArticleStage`, not `StepName`;
`publicCitationUrl` refuses credentials and non-public hosts as described).

| ID | Finding | Disposition |
|---|---|---|
| F1 | P1 est. A search count does not prove a direct-reception search ran | **Fixed** — two separately metered passes; pass A fails rather than concluding; empty-state copy rewritten |
| F2 | P1 est. A row surviving as an unchecked paraphrase can attach an invented critique to a real URL | **Fixed** — `sourceQuote` required, verified in the extract, row dropped on failure |
| F3 | P1 rea. The three group-two fields are only a shape check | **Fixed** — `claimQuote` verified in its block; `limits` made optional so caveats are not manufactured |
| F4 | P1 est. `isWebUrl` is not enough at the public boundary | **Fixed** — `publicCitationUrl` per row, refusal drops the row and is counted |
| F5 | P2 est. Widening `Citation` silently stores extracts for Chat, Explain and Referee Criteria | **Fixed** — separate `SearchEvidence` and an opt-in collector |
| F6 | P1 est. The stage inventories omit the residue nothing checks | **Fixed** — Stages 2 and 3 rewritten in full, including the `ArticleStage` exception |
| F7 | P1 rea. No stated spend ceiling; `max_uses` is not a budget | **Fixed** — § The spend ceiling, plus Stage 0b to prove the cap |
| F8 | P1 rea. "Drop counts" unspecified; a cap can hide unvalidated rows | **Fixed** — § What is counted; malformed or truncated answers fail the step |
| F9 | P2 rea. Deriving valence from `relation` loses the author-correction case | **Fixed** — three orthogonal fields; my § 4 reversed |
| F10 | P1 rea. Nothing carries the search date to a visitor | **Fixed** — `searchedAt` in both DTOs and on screen; distinct from `stale` |
| F11 | P2 est. "First pipeline stage on the chat wire" is false | **Fixed** — § The wire, stated correctly |
| — | Closing note: drop the source-kind classifier from v1 | **Accepted** |

---

Up: [reading-view-overview.md](../project/reading-view-overview.md)
