# Debate mode — what the rest of the web says about this piece

**Status: Stages 0–3 built, 2026-09-05; Stage 4 not started, and no live run has happened.** The
next step is Stage 3½ — run it once — and the reasoning for putting that before Stage 4 is there.
Written 2026-09-05. Second draft, after Stage 0's spike
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
  **fails the pass**.
- **Pass B — the argument around the claims.** Prompted with the article's claims. Runs only if pass
  A succeeded, so a failure costs one call rather than two.

**Two passes are one atomic step** (Sol's F16). The first draft said a failed pass A "writes no
conclusion" and stopped there, which left three bad options for whoever built it: show the empty
sentence over a failure, throw pass B away silently, or invent a half-artefact nobody designed. So:
**a failure of either pass — zero or unreadable search accounting, malformed JSON,
`finish_reason: "length"`, timeout, provider refusal — fails the whole step and writes no artefact**,
and the panel shows the job-failure and retry state every other stage already has. Only a *successful*
pass A that kept no direct rows may say the search found nothing.

**Three empty states, and they are different sentences.** Collapsing them is the silent-success
failure ([silent-success.md](../reusable/silent-success.md)):

| what happened | what the panel says |
|---|---|
| pass A succeeded, no candidate pages | *"This search did not find any responses to this piece."* |
| candidates returned, every direct row lost to `unverifiedSource` (F18) | *"The search returned possible responses, but the excerpts provided were not enough to verify them."* |
| either pass failed | the ordinary job-failure state, with retry |

Never *"No one has written about it."* We cannot see the query, so what we have is evidence of a
bounded search, not a claim about the web. **Cost: up to ~$0.27 a run**, typically $0.13–0.20 — see
§ The spend ceiling, where Stage 0b's numbers replaced the $0.13 the first draft quoted.

**What makes a group-one row admissible — the check the first draft never made.** Sol's F15, and it
is the finding that matters most in this round: two separately metered passes prove *a search ran*,
they do not prove that anything it returned is a **response to this piece**. Stage 0 is the exact
counterexample — a direct-reception search for an invented post returned nine real, unrelated pages,
and any one of them could supply a genuine quotation and survive every defence the plan had. So:

- `articleReferenceQuote` — words **from the source's own extract**, located by the spaced matcher,
  in which that page names *this* article: its exact title, its URL, or its title together with the
  byline. Without that witness the row is counted as `directnessUnverified` and **may not appear in
  group one at all**; it may appear in group two only if it independently meets that group's contract
  below.

That is a strict rule and it will cost real rows — a review that says only *"Seth's recent essay"*
fails it. That is the right direction to fail in: **group one's whole claim is that these pages are
about this piece**, and an unproved claim there is worse than a short list. It also makes the honest
empty state, which Greg asked for by name, the common case rather than an embarrassment.

**What makes a group-two row admissible** is the second half of Greg's instruction, and it is the
only thing standing between this mode and nine sourdough blogs presented as critical reception:

- `claimQuote` — the article's own words for the claim being answered, **located in `blockId` by
  [`findQuote`](../../src/quote-match.ts) in its `"spaced"` mode** (§ Attribution rule 2), not merely
  asserted;
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

### 4. Two orthogonal fields — my call overturned, then half of the overturn overturned

The first draft made the icon a *derived* property of a single `relation` field, on the grounds that
two overlapping vocabularies drift and the one that drifts is the one the colour comes from. **Sol
refused it and is correct**, so it is recorded here as a reversal rather than quietly fixed:

- **`follow-up` is provenance, not relation.** An author's own later post can dispute, qualify,
  extend or corroborate their earlier piece — and *"the author later corrected this"* is among the
  most valuable rows the mode can produce. Deriving valence from relation makes it **neutral by
  construction**, which throws the useful part away.
- **A `qualifies` row can be broadly supportive or broadly hostile**, and collapsing that loses
  exactly the at-a-glance distinction Greg asked for.

So **two** closed fields, each doing one job:

| field | values |
|---|---|
| `relation` | `disputes` · `qualifies` · `extends` · `corroborates` · `unclear` — **groups the list** |
| `valence` | `positive` · `negative` · `neutral` · `unknown` — **draws the icon and colour**, from a total `VALENCE_APPEARANCE` record |

**`sourceRole` was the third, and Sol's F19 cut it in round two.** The reasoning is the one this plan
already used to cut the source-kind classifier three sections down, and it applies here with equal
force: *"by the article's own author"* is a **fact-shaped claim**, drawn as a badge, that nothing in
the returned evidence verifies — a repost, a quotation or a namesake earns the badge just as easily.
Having cut one unverifiable classifier and kept another of the same kind, the line was arbitrary; it
is now principled.

**The obvious repair is the wrong one**, and it should be refused explicitly, because the next reader
will reach for it: do **not** move `follow-up` into `relation` as a sixth value. That is precisely the
mixing F9 refused — provenance and relation are orthogonal, and an author's later post can dispute,
qualify, extend or corroborate their earlier piece. A single field would force a choice between
saying *who wrote it* and saying *what it does*, and lose whichever it did not pick.

**So what F9 required survives, and what F19 removed is only the badge.** F9's objection was that
*deriving* valence from relation makes "the author later corrected this" **neutral by construction**.
Valence remains its own independent field, so it does not: an author's self-correction still appears,
still as `disputes` or `qualifies`, still with a negative icon. What v1 does not do is *assert* the
authorship — the host and title sit at the top of every row, so a reader looking at the same byline
on the same site can see it for themselves, which is the free version.

**Where it comes back, and why then rather than now.** Authorship is partly *verifiable*: the source's
host matching the article's host, or the article's byline located in the source's own extract by the
same matcher every other quote goes through. That is a badge we could stand behind. It is also a
second search-time contract for a field nothing else depends on, so it is Deliberately not in v1 —
listed there rather than left as an idea in a review.

**`valence` needs a stated target or it means three things** (F19's second half): it is the model's
estimate of *the cited passage's stance toward the row's target* — the article itself in group one,
the `claimQuote` in group two. Not the passage's tone, and not its stance toward some third subject.
Without that, "positive" could mean a friendly register, agreement with one claim, or praise for the
whole piece.

`relation`, `valence` and `applies` are visibly grouped on screen under **"AI interpretation"**, and
no numeric valence is computed or stored, in keeping with § 3. `unclear` and `unknown` are **not
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
2. **A citation whose request target is the article's own `meta.url` is inadmissible in either
   group**, and is counted as `selfSource`. Stage 0 already saw the article itself come back among
   its own annotations, and such a row passes every other defence here — real URL, real quote from
   that URL, real claim quote — while presenting the piece as a response to itself. Compare with the
   **same request identity chat already uses**, [`sameTarget`](../../src/urls.ts) — same scheme,
   host, port, path and query, fragments ignored, path decoded where it can be — which exists for the
   neighbouring case of the model fetching the open article by appending a block fragment. Do not
   reach for `urlKey`: the shelf's notion of sameness folds `http` into `https` and `www.` into the
   bare host, which is generous in the wrong direction here. Tests cover the exact spelling, a
   fragment-bearing one, and a percent-encoded path.
3. **Every row carries a `sourceQuote` that `findQuote` locates in that URL's own extract.** Failure
   **drops the whole row** and increments `unverifiedSource` — it does not merely drop the quote. The
   first draft let a row survive as "a paraphrase, labelled as one", and Sol's F2 is right that this
   is precisely the hole: a model can attach an invented critique to an unrelated but real annotation
   URL, and a label saying "paraphrase" does not stop it being read as evidence. **No row survives as
   an unchecked paraphrase.** The stored substring is the matched source characters, not the model's
   spelling of them.
4. **Every quote check calls `findQuote(haystack, quote, undefined, "spaced")`, never the default.**
   Sol's F14, and it is the plan walking into a trap the codebase had already marked: `findQuote`'s
   default is `"forgiving"`, whose second pass **deletes whitespace entirely** and therefore accepts
   *fall a part* as a quotation of *fall apart*. Its own docblock
   ([`src/quote-match.ts`](../../src/quote-match.ts)) says the forgiving pass exists for the
   **browser**, comparing against rendered text, and that on the **server** it "buys nothing and costs
   the guarantee" — the exact guarantee this mode is built on. The rule applies to all three checks —
   `sourceQuote`, `claimQuote`, `articleReferenceQuote` — and each **persists the matched slice of the
   haystack it was checked against, never the model's spelling**. A mutation test proves the default
   matcher would accept a split token and that Debate rejects it. (That docblock also records
   `validateHits` and `validateOccurrences` still passing the default as a *known gap*; Debate must
   not become the third.)
5. **`relation`, `valence` and `applies` are labelled on screen as the model's reading of that source
   passage** — not as facts about the page.

What this still cannot prove, said plainly because the panel must say it too: that the source passage
means what the model says it means. The excerpt in the tooltip is the reader's one-action check —
[vision.md](../project/vision.md#principles) principle 4, legible provenance, pointed outside the
article.

**The extract is incomplete evidence, not the page** (Sol's F18), and every rule above inherits that.
Exa returned 236–4,945 characters per annotation, of pages that may run to tens of thousands, and
[`MAX_EVIDENCE_EXCERPT`](../../src/openrouter-stream.ts) bounds it again at 8,000. So a real, apt
quotation that simply falls outside the slice the search engine chose gets its row dropped. That is
the right direction to fail in — we lose a true row rather than admit an unchecked one — but it has
two consequences the plan must own rather than discover:

- **it biases what survives** toward passages a search engine surfaced, which is not the same as the
  passages that matter, and the panel discloses that v1 verifies against search extracts rather than
  full pages;
- **it makes a third empty state real**, the middle row of the table in § 2: candidates returned and
  none verifiable is not the same fact as no candidates, and must not be shown with the same sentence.

Fetching the full page to widen the haystack is deliberately deferred — it is a second network
budget, a second injection surface, and § Deliberately not in v1 is where it is recorded.

### The engine is a cost decision, not an evidence decision

The first draft said `engine: "exa"` was *"load-bearing, not a preference"*, following the
measurement in [`src/converse.ts`](../../src/converse.ts) § `webSearchTool` (default engine → **0**
annotations). Stage 0 found the default engine returning **20** annotations on the non-streaming
path, every one carrying `content`.

**This does not make the 2026-09-01 measurement wrong**, and nothing here should be read as saying so.
But the first draft then went too far the other way, and Sol's F20 is right to catch it: it said the
two code paths were *"plainly behaving differently"*, which asserts a **cause** from two observations
taken on different days, with different prompts, tool parameters and routing. Streaming is a
*plausible* explanation, not an established one; provider changes, sampling and provider policy are
all unexcluded confounders.

What is established is narrow and worth stating as exactly itself: **the current non-streaming
default-engine call returned annotations, and the earlier streaming default-engine probe did not.**
Neither result explains the other.

So **Exa is provisional, and chosen on cost** — $0.066 against $0.115 in one matched non-streaming
comparison — and the comment in the code must say *cost*, so nobody later "fixes" it to say something
untrue. Two things keep that honest:

- **"adequate annotations" was never measured as the thing that matters.** The default engine returned
  twice as many annotations with longer extracts, and under rule 3's quote check *both* of those raise
  the number of rows that survive. The comparison that would settle the engine is **kept verified rows
  per dollar**, not annotations per dollar, and it has not been run.
- so the engine choice is **reversible by one parameter** and is written down as a provisional call
  rather than a finding. If Debate's kept-row rate turns out poor in practice, re-probe before
  re-designing: same model, provider policy, prompt, caps and day, a 2×2 of default/Exa ×
  streaming/non-streaming, keeping raw frames, usage, provider and generation id. That is a
  measurement worth doing when there is a rate to compare, and premature before Stage 2 exists.

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

**Stage 0b ran, and it half-refuted this section's first draft.** `max_total_results` *is* enforced,
to the row — asked for 4, got 4; asked for 20, got 19. But it caps **what comes back, not what we pay
for**, and searches are what cost money:

| `max_total_results` | searches actually run | annotations returned | cost |
|---|---|---|---|
| 4 | **36** | 4 — capped | $0.1008 |
| 20 | **24** | 19 — under cap | $0.1352 |

So `max_uses` is **not a budget** — a probe asking for 2 got 6
([`src/converse.ts`](../../src/converse.ts)) — and `max_total_results` is **not a spend ceiling**
either. Both are result caps; the search count is unbounded. `STEP_BUDGET_MS` only decides whether a
step may start ([`src/jobs.ts`](../../src/jobs.ts)), and a requeue buys the call again.

**The counter-intuitive consequence, which is the one to carry into the prompt:** what drove 36
searches was the instruction to *be thorough*. The well-behaved Stage 0 call ran 7 searches for
$0.066; ordering exhaustiveness tripled the search count and bought **no extra evidence**, because
the results were capped regardless. So Debate's prompt is written for **restraint**, not
thoroughness, and the cap does the limiting.

The ceiling is therefore made of three things, none of them a parameter:

1. **a prompt written for restraint** rather than exhaustiveness;
2. **the claim-wide abort, which is the only deadline that fires** — and it is much later than it
   looks. This said "an abort deadline that actually fires" and meant `STEP_BUDGET_MS.debate`, 120 s,
   which is **not a runtime bound at all** (Sol's F31): that table is consulted only *between* steps,
   to decide whether the claimant hands the job back before starting the next one, and the walk runs
   its first runnable step unconditionally. A debate-only job — which is how a reader asks for this
   mode — therefore starts whatever is left and runs to `LEASE_MS - DEADLINE_MARGIN_MS` = **740 s**
   ([`src/jobs.ts`](../../src/jobs.ts)). So the honest sentence is that a run is bounded at 740 s, and
   740 s of an unbounded search count is not a spend ceiling;
3. **`webSearches` on the `ai_calls` ledger row as the alarm** — recorded on this wire since
   2026-09-02 ([`src/ai-call.ts`](../../src/ai-call.ts)), and a run showing 36 searches will show up
   nowhere else. It is an alarm rather than a ceiling: it fires *after* the money is spent.

**So only the first of the three actually restrains the spend**, and that is worth saying plainly
rather than leaving it to be inferred from a list of three. If a live run shows the search count
running away, the lever is the prompt or a step-level timeout that really does fire — not this
table.

**Quote the mode's cost as up to ~$0.27 for a two-pass run**, typically $0.13–0.20 — not the $0.13 the
first draft quoted from Stage 0's well-behaved call. That is near the illustrated diagram, which
[experimental-features.md](../project/experimental-features.md) calls the dearest and slowest thing in
the app, and it is a number Greg should see rather than inherit. Two mitigations are already in the
design: the passes are **sequential**, so a failed pass A costs one call rather than two (§ 2), and
the step is behind the experimental switch.

**Four caps, and their scope is stated because it is otherwise ambiguous** (Sol's F22 — implemented
naively inside each pass, one `MAX_DEBATE_ROWS = 30` silently permits sixty stored rows):

| constant | scope | v1 value |
|---|---|---|
| `MAX_DIRECT_SEARCH_RESULTS` | provider results, pass A | 12 |
| `MAX_CLAIM_SEARCH_RESULTS` | provider results, pass B | 12 |
| `MAX_DIRECT_ROWS` | stored rows, group one | 12 |
| `MAX_CLAIM_ROWS` | stored rows, group two | 12 |

The artefact maximum is the sum of the two row caps. **Counts and loss reasons are stored per group**,
never only summed, or a foot line cannot say which of the two searches lost rows; a total may be
derived for telemetry.

## What is counted, and what is shown

"Drop counts" is not a specification. A model can produce 42 rows, a cap can stop the loop at 30, and
every validation counter can still read zero — which is why Candidates keeps a separate `omitted`
([`src/referee-candidates.ts`](../../src/referee-candidates.ts)). The artefact stores:

**`returnedSources`** · `reportedRows` · `keptRows` · `omittedOverCap` · and **every validation loss by
reason** (`uncited`, `selfSource`, `unverifiedSource`, `directnessUnverified`, `claimNotInBlock`,
`unknownBlockId`), **each stored per group**.

**`returnedSources` is new in round two and it closes a real hole** (Sol's F13). Annotations arrive
**independently of what the model says** — Stage 0's probe answered with the single word `DONE` and
Exa still returned ten source annotations. So a model can be handed evidence from ten pages, report
three rows, have all three validate, and every counter above reads clean: `reportedRows === keptRows
=== 3`, no loss sentence, and seven pages the search returned never entered the answer at all.
`reportedRows` counts *the model's output* and must never be allowed to stand in for *what the search
found*. So each pass stores `returnedSources` — the number of unique **admissible** annotation URLs,
after the `isWebUrl` and `selfSource` refusals — and the foot line says *"The search returned evidence
from N pages; M contribute to the rows shown"* whenever the count of distinct row URLs differs from
it. A mutation drops one valid annotation URL from otherwise-valid JSON and asserts the sentence.

Rows beyond a group's row cap are **counted before iteration stops**. A malformed answer, or
`finish_reason: "length"`, **fails the step and writes no artefact** rather than storing a truncated
list that looks complete.

**Generation-time losses and public-boundary losses are counted separately** (Sol's F17). The first
draft put `sourceNotPublishable` in the stored artefact and then had the foot line fire on
`reportedRows !== keptRows` — but that loss is *created later*, when the public DTO re-judges URLs, so
the stored counts stay equal and **the visitor sees a shorter list with no sentence at all**, which is
precisely the failure this section exists to prevent. So:

- **the stored artefact holds generation-time losses only**, and `sourceNotPublishable` is not among
  them;
- **public projection computes `publicKeptRows` and `sourceNotPublishable`** at the boundary;
- **the owner's foot compares `reportedRows` with stored `keptRows`; the visitor's compares
  `reportedRows` with `publicKeptRows`.**

A public-only URL mutation must leave the owner's counts unchanged *and* make the visitor's foot say
exactly one row was omitted — that pair of assertions is the test, not either half alone. Tests mutate
each filter and each cap and assert the exact on-screen sentence — the ✧ line Quotes already draws,
for the same reason ([silent-success.md](../reusable/silent-success.md)).

## `searchedAt`, and why it is not staleness

Debate is time-sensitive research and a shared link outlives it. `searchedAt` is stored as an ISO
timestamp, crosses **both** the owner and public DTOs deliberately, and the panel says *"Searched on
…"*. The precedent is the web-backed glossary shape, which already records that its answer is about
the web *on the day it was asked* ([`src/types.ts`](../../src/types.ts)).

**`stale` continues to mean the article changed.** Age is displayed provenance, not automatic
staleness — a visitor opening a year-old shared article must be able to see how old the search is
without the artefact declaring itself invalid.

## Security

**The first draft claimed chat's fence and cannot have it** (Sol's F21), and this is the correction
that matters most in this section. In chat, *our own code* fetches the page and then wraps the text
with `untrusted()` — delimiter-broken — before the **next** model request
([`src/chat-tools.ts`](../../src/chat-tools.ts)). Debate's `openrouter:web_search` runs **inside the
provider**: the model consumes the page extract during the call, and our process first sees those
characters in the response. There is no point at which we could fence them. Saying "everything in
chat-tools.md § Security holds" would hand the next reader a defence that is not there.

Stated correctly:

- **Prompt injection from a searched page is a residual risk of this mode**, not a mitigated one. A
  hostile page can try to steer which sources are selected and how they are labelled.
- **What bounds the consequence** is that this step has **no write-capable tools** — it searches and
  returns JSON, nothing else — and that every claim it makes is re-checked by us afterwards against a
  URL the search itself returned and a quote located in that URL's own extract (§ Attribution). An
  injected instruction cannot manufacture a source; at worst it influences which real sources appear
  and how they are characterised, and the characterisation is already labelled as the model's reading.
- **Rendering is text and never markup**, which does still hold, and is ours.

Two more things are specific to this stage:

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

**Stage 0b — done, 2026-09-05.** The adversarial cap probe. `max_total_results` is enforced to the row
but is not a spend ceiling: with the cap at 4 the provider ran 36 searches for $0.10. Numbers, and the
three things the ceiling is actually made of, under § The spend ceiling; raw output in the spike
results doc.

### Stage 1 — `SearchEvidence`, kept away from `Citation` — **done, 2026-09-05**

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

**As built.** `SearchEvidence` in [`src/types.ts`](../../src/types.ts); `content` added to the
`Annotation` wire interface, and `collectSearchEvidence` beside `collectCitations`, in
[`src/openrouter-stream.ts`](../../src/openrouter-stream.ts). The two collectors are two lines each
over one private `collectAnnotated`, so the `isWebUrl` refusal, the discriminator and the dedupe have
a single implementation and cannot drift — the exact failure that made this file the home of those
rules in the first place. `MAX_EVIDENCE_EXCERPT` is **8,000 characters**: above every Exa extract
Stage 0 measured (max 4,945), so it does not bite on the engine we use, but a bound on the engine
nobody measured — the default engine returned 9,858 on the same probe and OpenRouter publishes no
ceiling. Truncation is silent and fails in the safe direction: a `sourceQuote` living past the cap is
not found, and § Attribution then **drops the row and counts it** rather than keeping one whose
evidence was never read. Nothing is wired to the new collector yet; that is Stage 2's job.
`tests/collect-citations.test.ts` gained a `collectSearchEvidence` block whose frames carry all five
live keys.

### Stage 2 — the stage and the artefact — **done, 2026-09-05**

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

#### As built — 2026-09-05, server side only, no live run yet

Every table above landed as written. **One number in this plan is now known to be low**, and it is
the one Greg was asked to look at:

> **§ The spend ceiling's $0.13–0.27 is for two calls that carry no article.** Every figure in Stage 0
> and 0b came from a bare probe — an identity, a system prompt, no article, no schema. Pass A is
> still that. **Pass B sends the whole article** (`articleWithIds`), because a `claimQuote` has to be
> locatable in a block the model was actually shown and a `blockId` has to be one the model was
> offered. On a 4,000-word piece that is roughly 8–10k extra prompt tokens; on a long one, several
> times that. So the real per-run cost is above the quoted range and rises with article length, which
> none of the measured numbers did. **The first live runs are what should replace this paragraph.**

Six further things the plan did not settle, decided here:

- **The answer is a fenced JSON block, not `response_format: {type: "json_schema"}`.**
  `AI_JOB_ROUTE.debate` sends `require_parameters: true`, which turns a parameter an upstream does
  not support from a silent no-op into a **404 with no endpoints left** — what a `temperature: 0` did
  to `env-proposal` ([research](../research/260902b-env-key-proposal-spike.md)). Neither Stage 0 nor
  0b sent a schema alongside `openrouter:web_search`, so one here would be an unmeasured field in a
  body whose failure mode the feature reports as *"the search did not run"*. `referee-candidates` is
  the one existing caller that does web search *and* structured output, and it uses a fence.
- **A seventh loss reason, `malformed`.** § What is counted names six *validation* losses, and a
  *malformed answer* — the whole JSON document — fails the step. Neither covers one unreadable row
  inside an otherwise readable list. `DroppedCandidates.malformed` keeps that separate for the same
  reason and this follows it. It counts a row that is not an object, and a row with no `applies` —
  which is required in **both** groups: § 2 makes it a group-two field and § 4 draws it on every row,
  and a row with no sentence saying what the page does is a host and a quotation with nothing said
  about either.
- **Rows are not deduplicated by URL**, and `distinctSources` is what the foot line counts. One
  review can answer two different claims, so two rows about one page is a real answer; the sentence
  the plan specifies (*"N pages, M contribute"*) needs the distinct count either way.
- **The stamp's `model` is `modelFor("debate")`, not `CAPABLE_MODEL`.** This is the only stamped
  stage whose model an environment variable can override, and every neighbouring stage's stamp names
  the constant — so copying one in is the obvious mistake, and it would report every run stale on a
  machine with the override set and on no other.
- **`sourceHash` is `articleWithIdsFingerprint`** — the blocks, the tree and the *cited* head, the
  same question `ideas`, `sketch` and `quiz` are judged on. The plan said `sourceHash` without saying
  which. The cited set because pass B sends `articleWithIds`, and because the `URL:` line does more
  work here than in any of those three: it is what pass A asks the web about, and what every returned
  citation is compared against. **Not** the dated set — no date appears in either prompt, so hashing
  one would buy the search again every time a publisher re-dated a post.
- **`searchedAt` is the artefact's only clock.** Its neighbours carry `generatedAt` beside it; here
  the two would be one instant written twice, and two spellings of one fact is what these artefacts
  keep getting wrong. `elapsedMs` stays, because it is a different fact.

**`sameTarget` and `requestTarget` moved from `src/chat-tools.ts` to [`src/urls.ts`](../../src/urls.ts),
unchanged.** § Attribution rule 2 names that function rather than describing one, and a second copy
of a URL-identity rule is what `urls.ts` exists to prevent.

`src/web/` was touched in exactly two places, both forced by a total table rather than by the mode:
`STAGE_ICONS` in `Metadata.tsx` (a `Record<StepName, …>`) and `CACHEABLE` in `lib/api.ts`, which
`tests/cacheable-covers-artefact-routes.test.ts` derives from the routes.

Three test files: `tests/debate.test.ts` (the refusals and the counts, including the sourdough
fixture), `tests/debate-passes.test.ts` (the wire, and the ten ways a pass fails the whole step), and
`tests/debate-step-registration.test.ts` (the stamp, the skip, and that the step buys two searches
rather than one). **`STEP_BUDGET_MS` is still the 120 s guess** — the re-measurement wants a live run,
which has not happened. Its comment now says what that number is and is not: a scheduling figure,
consulted between steps, and **not** the deadline this step runs under (§ The spend ceiling).

### Stage 3 — the band — **done, 2026-09-05**

**The owner band only** — the visitor half moves to Stage 4, and that split is Sol's F23. The first
draft built the owner/visitor pair here while `PUBLIC_PROJECTIONS`, the public DTO, the URL filtering
and the public loss counts all arrived a stage later, which means a "green" Stage 3 would have
implemented the visitor side against a type and a sanitisation boundary that did not exist yet. The
visitor branch is written **after** the thing it must not bypass.

`MODES` and the five client tables; the band branch, owner path only; `DebatePanel.tsx`; the two
groups; the `VALENCE_APPEARANCE` icons; the "AI interpretation" grouping of `relation`/`valence`/
`applies` (§ 4); the ⓘ excerpt card (`ProseHoverCard`, which already takes pointer events and carries
a link out); the owner foot line, comparing `reportedRows` with stored `keptRows`. `useDebate` on
`useOrderedRead` and `useStepJob`, with `useAutoRun` so **only an owner pressing an empty mode** starts
the job — arrival never POSTs. `CACHEABLE`. Behind the experimental switch, `experimental: true` in
`MODES_UI`, reason in the table there.

### Stage 3½ — run it once, before Stage 4 — **the next thing to do**

Added at the 2026-09-05 debrief, and it is a **reordering of the plan** rather than an extra step.

**Nothing here has ever run against a live model.** Every screenshot, every fixture and every test in
Stages 1–3 is synthetic. So four things this plan asserts are still unmeasured, and all four are
cheaper to learn now than after Stage 4:

- **whether the restrained prompt finds reviews that exist.** § The spend ceiling made restraint a
  cost control on Stage 0b's evidence. Nobody has checked what it costs in *recall*.
- **how often `articleReferenceQuote` empties group one.** The rule is strict on purpose, and the
  plan argues an honest empty state is the right failure. If group one is empty on articles that
  genuinely were reviewed, the argument stands and the mode is thinner than it reads.
- **what a run actually costs.** Both probes carried **no article**; pass B sends the whole thing. The
  true figure is above the quoted ~$0.27 and rises with length, and is currently unknown.
- **whether `STEP_BUDGET_MS = 120_000` is anywhere near right.** It is an unmeasured guess, and Sol's
  F31 established it is not a running deadline anyway.

**Why before Stage 4 rather than after.** Stage 4 is the *sharing* half — the public contract, the
visitor branch, the export chain. It is worth building for a mode that produces something worth
sharing, and that is exactly the proposition no evidence yet supports. If a live run shows the output
is thin on a typical article, the response is a prompt change or a product rethink, and Stage 4 built
first would be work done on top of an unproved thing.

Run it against two or three real articles on the shelf — one with known reception, one without —
record `webSearches` and cost from the `ai_calls` ledger rows, and write the result into
[the spike results doc](260905f-debate-mode-stage-0-spike-results.md). Then re-measure
`STEP_BUDGET_MS` and decide about Stage 4 with numbers.

### Stage 4 — the shared link, and the docs

The public contract first, then the visitor: `PublicDebate`; `PUBLIC_PROJECTIONS` (a missing line here
is the one silent failure in the whole public path); the public DTO with `publicCitationUrl` per row,
dropping the row on refusal; `publicKeptRows` and `sourceNotPublishable` computed **at the boundary**,
not read from the artefact (§ What is counted).

**`tests/public-projection-columns.test.ts` does not exist and Stage 4 creates it.** The first draft
cited it as an existing protection; it is not one of the sixteen `tests/public-*` files in the tree,
and a plan that names a guard which is not there is worse than one that names none. Sol's F23.

Then the visitor branch and its foot line, the export put-chain, `docs/project/debate.md`, its line
under [reading-view-overview.md](../project/reading-view-overview.md), and its row in
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
- **A *verified* author badge.** `sourceRole` was cut as a model guess (§ 4), but authorship is partly
  checkable: the source's host matching the article's host, or the article's byline located in the
  source's own extract by the same spaced matcher. That is a badge we could stand behind. Out of v1
  because it is a second search-time contract for a field nothing else depends on — and if it comes
  back it comes back as a *check*, never as a value the model reports.
- **Fetching the source page to widen the haystack.** Every quote is checked against the search
  engine's extract, so a real quotation outside that slice loses its row (§ Attribution). Fetching the
  page would recover those, at the price of a second network budget and a second injection surface,
  and chat's `read_web_page` already has the machinery. Worth doing if `unverifiedSource` turns out to
  be the dominant loss in practice — which the counts will say.

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

## Review ledger — GPT Sol, round 2, 2026-09-05

Verdict: **refused again**, on F13, F14, F15, F17. All twelve findings accepted, one of them partly.
Four of Sol's code citations were checked against the tree before acting and **all four held** —
`findQuote`'s default is `"forgiving"` and its own docblock says the server must not use it;
`sameTarget`/`requestTarget` exist in `chat-tools.ts` and already refuse the open article; `untrusted()`
is applied by our code *after* our own fetch; and `tests/public-projection-columns.test.ts` is not one
of the sixteen `tests/public-*` files in the tree.

Sol's closing line is the fair summary of round one's design: *"the source-relationship proof still
stops one step too early: it proves that two passages exist, not that one answers the other."*

| ID | Finding | Disposition |
|---|---|---|
| F12 | P1 rea. The article can cite itself as part of its own debate | **Fixed** — `selfSource` refusal on `sameTarget` identity, § Attribution rule 2 |
| F13 | P1 est. `reportedRows` does not count the sources the search returned | **Fixed** — `returnedSources` per pass, and a foot line when it differs from the rows shown |
| F14 | P1 est. The plan invokes `findQuote` in its documented-unsafe default mode | **Fixed** — all three checks use `"spaced"` and persist the matched slice; § Attribution rule 4 |
| F15 | P1 est. Two passes prove a search ran, not that any group-one page is a response | **Fixed** — `articleReferenceQuote` required for group one; failure counts `directnessUnverified` and demotes to group two at best |
| F16 | P1 rea. A failed pass is indistinguishable from an empty result | **Fixed** — the two passes are one atomic step; three distinct empty states tabulated in § 2 |
| F17 | P1 est. A public-only drop evades the loss line the plan advertises | **Fixed** — generation-time and boundary losses counted separately; owner and visitor feet compare different pairs |
| F18 | P1 rea. An incomplete extract is treated as evidence the search found nothing | **Fixed** — its own empty sentence, the survivor bias disclosed, full-page fetch listed as deferred |
| F19 | P1 rea. `sourceRole` is the same unverifiable classifier v1 claims to have cut | **Fixed** — `sourceRole` cut; `valence`'s target defined; "AI interpretation" grouping. **Not** by folding `follow-up` into `relation`, which would reinstate F9 |
| F20 | P2 rea. Streaming is a plausible explanation, not an established cause | **Fixed in part** — the causal claim withdrawn and Exa made provisional-on-cost. The demanded 2×2 re-probe is **deferred, not accepted as a gate**: the comparison that would settle it is kept verified rows per dollar, and there is no kept-row rate to compare until Stage 2 exists |
| F21 | P2 est. Debate cannot apply chat's `untrusted()` fence to server-side search input | **Fixed** — § Security rewritten; injection named as residual, with what actually bounds it |
| F22 | P2 est. Neither cap's scope is specified across the two passes | **Fixed** — four named caps with values and per-group scope; counts stored per group |
| F23 | P2 est. Stage 3's visitor implementation precedes its public contract | **Fixed** — Stage 3 is owner-only; Stage 4 builds the contract, creates the missing test, then the visitor |

**Two rounds is the limit** ([engineering-manager.md](../reusable/engineering-manager.md)), so this
plan now goes to build. Stage-end reviews continue against code, which is where they are worth more.

## Review ledger — GPT Sol, round 3, 2026-09-05 — **the code, after Stages 2 and 3**

The first review of what was *built* rather than of what was planned, and it is the one that found
the worst bug in the mode: **the plan's own group-one rule was documented in `readDirectGroup`'s
docblock and not implemented under it**. Sol reproduced F24, F25, F26 and F27 with adversarial
inputs; Greg checked F24 and F27 against the tree himself before any of this was fixed.

Every fix below has a test that was watched go red first, and where a fix could not be red-first —
F31 is a comment and a paragraph — the disposition says so.

| ID | Finding | Disposition |
|---|---|---|
| F24 | P1. `articleReferenceQuote` was located in the extract and never compared with the article, so a genuine quotation from an unrelated page proved directness | **Fixed** — `GroupInput.article` carries url, title and byline; `namesArticle` requires the located slice to name the piece by address (`sameTarget`), by a substantial title, or by a short title with the byline. Failure stays `directnessUnverified` and still drops the row |
| F25 | P1. `locate` accepted any non-empty substring, so a one-character quote passed both evidence checks | **Fixed** — `MIN_QUOTE_WORDS` = 3 and `MIN_QUOTE_CHARS` = 16, applied inside `locate` so all three checks get them. Counted under the reason each check already had, deliberately: the reader's sentence is the same |
| F26 | P1. The fence regex matched a ``` anywhere, so truncation was accepted as `[]` and valid JSON carrying a literal fence was rejected | **Fixed** — a line scan; opener and closer each occupy their own line; a later unmatched opener fails the pass. The comment claiming JSON escapes backticks is gone, because it was untrue |
| F27 | P1. `finish_reason` was a blocklist, so `"error"` was stored as a successful empty artefact | **Fixed** — an allowlist of `"stop"`. `length` and `content_filter` keep their own reader-facing sentences; everything else is an unreadable pass, and the provider's own word for it never reaches the reader |
| F28 | P2. A missing URL was counted as `malformed`, against the contract in `DebateLosses` | **Fixed** — the two fields tested separately; absent, non-string or blank URL is `uncited` |
| F29 | P2. `SHAPE.debate` accepted `{direct:{}}` while the fs reader required both groups and Postgres checked nothing | **Fixed** — one predicate, `isDebateDocument` (src/types.ts), asked by `SHAPE`, `readDebate` and `loadDebate` |
| F30 | P2. `requestTarget` decoded the whole pathname, so `/a%2Fb` and `/a/b` were one target | **Fixed** — only RFC 3986 unreserved escapes are folded, and a retained escape is upper-cased so `%2f` and `%2F` stay one target. Chat's two `sameTarget` callers still refuse what they refused |
| F31 | P2. `STEP_BUDGET_MS.debate` is not a running-step deadline, and both the comment and § The spend ceiling presented it as one | **Fixed, comment-only by design** — no new timeout mechanism. Both places now say what bounds a run: the claim-wide abort at 740 s, and that only the restrained prompt bounds the *spend*. Not red-first: there is no behaviour to test |
| F32 | P3. Two tests were weaker than their names | **Fixed** — the search-count case is deleted (both sides of it were the test's own literal, and the wire-level assertion already exists in `tests/debate-passes.test.ts`); the model case sets `SPIDERYARN_DEBATE_MODEL` so the resolver and `CAPABLE_MODEL` differ, proven by mutating the stage to the constant and watching it go red |
| F33 | P3. The plan was stale | **Fixed** — status line, Stages 2 and 3 marked built, and "Five further things" was six |

---

Up: [reading-view-overview.md](../project/reading-view-overview.md)
