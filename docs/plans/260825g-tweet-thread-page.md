# The tweet thread page

**Planned 2026-08-25.** The article as a numbered thread of short posts, at
`/read/<slug>/tweets`. Generated on demand, cached on disk, copyable.

> - The Tweet Thread view (which also needs its own `/read/[slug]/tweets/` url)
>
> — Greg, 2026-08-25

The routing change this needs is written up once, in
[260825e-metadata-page.md § The routing change](260825e-metadata-page.md#the-routing-change-a-shared-prerequisite).
It should land first. Everything below assumes it has.

## Say the awkward thing first

A tweet thread sits close to two of [vision.md](../project/vision.md)'s
[anti-goals](../project/vision.md#anti-goals): *"Read this in 2 minutes"* and *"auto-generated
confident claims with no path back to the source"*. `Dock.tsx` currently carries a comment saying
tweet threads are "simply not what this is", written a few hours before Greg asked for them. That
comment goes.

That is not a reason to refuse the work — it is a reason to build the version that does not deserve
the objection. Three things do most of it:

- **The thread carries the source with it.** The copy format includes the article's own URL, so a
  thread that escapes onto the internet still points at what it summarises. This is what the
  original did, and it is the cheapest possible answer to "no path back to the source".
- **The prompt is written against hype, not for it.** Their prompt already says *"Prioritize
  comprehension over engagement metrics"* — which is the right instinct, sitting inside a prompt
  that also asks for a *"compelling hook"* and opens its own example with `🧵 THREAD:`. We keep the
  instinct and drop the hook.
- **It is not on the reading path.** It is a page you go to, not a thing that appears above the
  article offering to save you the trouble.

What it is *for*, from Greg, 2026-08-25 — **both**, knowingly:

> Built as a reading aid (so: accurate, anchored, no hype), and each post has a `[copy]` button
> because why not.

That option was offered with its own risk printed on it — that "accurate and anchored" and "good on
X" pull in opposite directions — and chosen anyway. So: **build it as the reading aid, and let
copying be a side effect.** When the two pull apart, accuracy wins.

## What the original had, and the fact worth knowing

`/read/[slug]/tweets` — Greg's proposed URL is the one the old app already used, exactly.

- `app/read/[slug]/tweets/page.tsx` — the page
- `components/tweet-thread-view.tsx` — the thread
- `components/tweet-card.tsx` — one post
- `app/api/tweet-thread/route.ts` — GET returns the cached thread or 404; POST generates
- `lib/prompts/templates/tweet-thread.njk` — the prompt
- `lib/prompts/templates/tweet-thread.ts` — the schema and the model settings

**And then they removed it.** `docs/reference/TOOL_TWEET_THREAD_VIEW.md` opens:

> **⚠️ DEPRECATED**: This tool has been removed from the application. The Tweet Thread button has
> been removed from the Document Header, and this feature is no longer available in the unified tool
> system.

The deprecation notice gives no reason. The commit history and a conversation doc do, and it is not
the one you would guess.

### Why it died, and why that argues *for* this page

`docs/conversations/250629a_conversation_tweet_thread_tool_architecture.md` records them trying to
fit the tweet thread into their unified left-pane tool framework — the one with the icon rail, the
command palette and the model-callable tool registry — and never resolving it. The feature
*"doesn't actually display the document pane, it displays its own stuff"*: a full-page alternate
representation of the article, being pushed into a component system built for panels that sit
beside the article and coordinate with it. The conversation reaches no decision. The next commit
(`debcea1c`) strips the button from the document header, and the full deprecation follows.

**It was not killed by bad output. It was killed by being the wrong shape for where it was put.**

That is a strong argument for exactly what Greg asked for here. A tweet thread is not a panel and
never was; it is a whole-page view of the article at a different compression. Giving it its own URL
is not a convenience, it is the thing their architecture could not express. Same for the metadata
page — a full screen of facts that spent its life as tab number eight.

It is recorded at length because a plan that quietly omitted the deprecation would be hiding the
single most relevant fact about the thing it is borrowing — and because the reason turns out to
support the design rather than undermine it.

### Their prompt, verbatim

`lib/prompts/templates/tweet-thread.njk`, in full, because it is the most useful thing in that
directory and because a paraphrase would lose exactly the details worth arguing with:

```
You are a skilled academic communicator who specializes in creating engaging tweet threads about
academic papers and complex documents. Your goal is to help academics and researchers quickly grasp
key concepts and findings from academic content.

Create a tweet thread that transforms the following academic content into a digestible, engaging
format while maintaining academic rigor. Follow these guidelines:

**Thread Structure:**
- Start with a compelling hook that announces the main finding or insight
- Provide essential context for why this research matters
- Present key findings, one idea per tweet
- Include implications and significance
- End with appropriate credits and acknowledgments

**Tweet Format:**
- Each tweet should be 270 characters or less
- Always count characters carefully - staying well under 280 is crucial
- Use clear, accessible language while avoiding oversimplification
- Include visual breaks (line breaks, bullet points) for readability
- Number each tweet clearly (1/n format)
- Each tweet should stand alone but contribute to the overall narrative

**Academic Focus:**
- Prioritize comprehension over engagement metrics
- Maintain scientific accuracy and nuance
- Avoid sensationalism while being compelling
- Include appropriate caveats about limitations when relevant

**Target Audience:** Academic researchers and educated general readers who want to understand this
work efficiently.

**Target Length:** {{ target_length }} tweets (this is a suggestion - adjust based on content
complexity)

Return your response as a JSON object with an array of tweets. …

<content>
{{ content }}
</content>
```

Its settings, from `tweet-thread.ts`:

| | |
|---|---|
| model | `anthropic-balanced-thinking` — an alias resolving to a Sonnet-4-class model with thinking on, *"for better tweet thread structure and narrative flow"* |
| temperature | `0.4` — *"Balanced creativity and consistency"* |
| max tokens | `4000` |
| target length | `12`, clamped to 3–20, *"Based on research: 10-15 tweets optimal for academic content"* |
| per-tweet cap | 280 characters, enforced in a Zod schema; the prompt asks for 270 |
| minimum input | 100 characters, or it refuses |

Response shape: `{ tweets: [{ number, text }], thread_summary, metadata }`.

### The three product decisions we inherit

Asked whether each post should link back into the article, Greg, 2026-08-25:

> For now, follow the product decisions from the original version.

Theirs were:

1. **Freestanding posts.** No anchor, no block id, no per-post link into the article. So: none here
   either, for now. The block-id spine means anchoring can be added later without changing the page
   or the artefact — a `blockId` is one more optional field.
2. **One thread per article, cached until the document changes.** Generated on first view, kept.
3. **Copy the whole thread as Markdown**, with an attribution line and the document's URL at the
   top, and no per-post copy button.

Point 3 is worth flagging against Greg's "each post has a `[copy]` button" — that is *not* what the
original did, and the two answers pull slightly apart. Both are cheap. Build both: a per-post copy
and a copy-the-lot.

### What we rewrite

The prompt. "Follow the product decisions" is about what the feature *is*, not about the wording
that produces it — and that wording is aimed at a different audience than ours. Ours are not
"academic papers" (the pipeline eats magazine essays and blog posts), and this project has a house
voice for prompts already: read [`src/arc.ts`](../../src/arc.ts)'s system prompt first. It shows
what a prompt here looks like — what the column is *for*, a worked example of right versus wrong,
then the rules — and the tweet prompt should look like its sibling, not like an import.

Three specific changes to argue for in the new prompt:

- **Cut the hook.** "Start with a compelling hook" is the instruction that produces `🧵 THREAD: New
  research reveals…`. Replace it with: the first post says what the piece claims.
- **Keep the caveats rule.** *"Include appropriate caveats about limitations when relevant"* is
  the one line in their prompt that pushes against overclaiming, and it is the line ours needs most.
- **Say who is talking.** Their prompt never settles whether the thread is the author's voice or a
  reader's. Ours should: it is a reader reporting what the piece says, so "the author argues" rather
  than "I argue". This is the difference between a summary and a misattribution, and it is invisible
  until someone posts one.

## Generation: on demand, through the queue we already have

Greg, 2026-08-25, chose **on demand, then cached**: the page is empty until you press a button, the
first press costs one model call, and it never happens again for that article.

The temptation is `POST /api/tweets/:slug` running the model inline. **Don't** — it is a
thirty-second request with no progress and no cancel, and this repo already has the thing that
solves that. [ingest-queue.md](../project/ingest-queue.md) built a job queue whose whole design is
*the pipeline is a list, not a function*, with live progress, cancel, retry and force. Pressing
"Write the thread" should be:

```
  POST /api/jobs { slug, steps: ["tweets"] }   ->  job id
  GET  /api/jobs/<id>                          ->  poll, exactly as the add box does
```

`src/web/useJobs.ts` already does the polling half.

### The one real snag, stated precisely

`tweets` has to become a `StepName`, and that means it lands in
[`src/pipeline.ts`](../../src/pipeline.ts)'s `STEP_ORDER`:

```ts
export const STEP_ORDER: StepName[] = ["fetch", "extract", "blocks", "toc", "arc"];
```

That one constant is doing **three** jobs, and they pull apart here for the first time:

| Read at | What it means there | Does `tweets` belong? |
|---|---|---|
| [`jobs.ts:181`](../../src/jobs.ts) — `orderSteps` sorts by `STEP_ORDER.indexOf(a)` | the chain's order | **yes** — a name that is missing gets `-1` and sorts to the **front**, so `tweets` would run before `fetch` |
| [`pipeline.ts:267`](../../src/pipeline.ts) — `isStepName` is `STEP_ORDER.includes(value)` | which names the API will accept | **yes** — otherwise `POST /api/jobs { steps: ["tweets"] }` is rejected as a bad name, and the button never works |
| [`jobs.ts:370`](../../src/jobs.ts) — `orderSteps(request.steps ?? STEP_ORDER)` | what a bare "add this URL" runs | **no** — this is the one Greg said no to |

So the change is smaller than it first looks: **`tweets` joins `STEP_ORDER`** (which gets it sorted
and accepted), and `enqueue`'s default becomes a separate `DEFAULT_INGEST_STEPS` — the same five,
named for what they are.

> **Corrected in build.** This section said "exactly one line", and it was four — see
> [As built](#as-built-where-this-plan-met-the-code). It also missed the third thing `STEP_ORDER`
> was doing, which is standing in for a **dependency** model that `tweets` breaks: the thread is not
> downstream of the arc, so being appended after it made `force: ["arc"]` cost a second model call
> for nothing.

Two supporting facts:

- `STEPS` must gain a `tweets` entry in the same position, because
  [`tests/jobs.test.ts:41`](../../tests/jobs.test.ts) asserts
  `expect(STEP_ORDER).toEqual(Object.keys(STEPS))`. That test is the guard that keeps this honest;
  do not weaken it.
- `cascadeForce` needs no change. `tweets` sits last, so forcing an earlier step correctly forces it
  too — regenerate the tree and the thread that described the old one is invalidated with it, which
  is the behaviour you want and would otherwise have had to remember.

That file belongs to the ingest-queue agent under
[stage ownership](../project/architecture.md#stage-ownership). The generator itself is ours and goes
in `src/tweets.ts`, exported as one function, exactly as `src/arc.ts` exports `generateArc` and
`pipeline.ts` imports it. The addition to `pipeline.ts` is a ten-line registration entry of the same
shape as the five already there — but it is still their file, so tell them.

### The artefact

`data/<slug>/tweets.json`, beside `arc.json`, following the pattern
[architecture.md § Storage](../project/architecture.md#storage) sets out:

```jsonc
{
  "generator": "claude-…",       // model id, as tree.json and arc.json carry
  "version": "tweets/1",         // prompt version, so a prompt change invalidates
  "sourceHash": "…",             // hash of blocks.json — regenerate when the article changes
  "summary": "…",                // their thread_summary
  "tweets": [{ "number": 1, "text": "…" }]
}
```

`sourceHash` is the part worth insisting on. Their cache was "until the document changes", enforced
by a database row nobody re-checked. Ours should be able to *say on the page* that the thread
describes an older version of the article — the same staleness problem
[260825e-metadata-page.md](260825e-metadata-page.md) has to solve for the tree and the arc, and the same answer.

**Before writing any SDK code, load the `claude-api` skill** for current model ids and parameters —
`AGENTS.md` requires it, and a model id typed from memory is the sort of thing that works until it
doesn't.

## The page

```
  +-----------------------------------------------------+
  |  <- The Mythology of Conscious AI                   |
  |  A thread, 8 posts        [copy all]  [rewrite]     |
  +-----------------------------------------------------+
  |  This piece argues that the question of machine     |
  |  consciousness is malformed: we keep asking it of   |
  |  the wrong thing.                                   |
  |                                 1/8   183/280  [c]  |
  +-----------------------------------------------------+
  |  ...                                                |
  |                                 2/8   241/280  [c]  |
  +-----------------------------------------------------+
```

Worth taking from theirs:

- **A per-post character count against 280.** It sounds like decoration and isn't: the model is
  being asked to count characters, which models are bad at, and this is the reader seeing whether it
  managed. **Flag only an actual violation** — a bar shading from green through amber was in an
  earlier draft of this plan and is decoration: a 190-character post is not a warning about
  anything, and a page that cries wolf at 190 teaches the reader to ignore the flag at 281.
- **`n/total` on each post**, not just `n`.
- **The thread summary above the thread**, when there is one.
- **No avatars, no handles, no timestamps, no like counts.** Theirs was deliberately
  Twitter-*inspired* rather than a fake-tweet mockup, and that was the right call: a mocked-up
  timeline invites you to read it as something someone posted. Ours is a numbered list of short
  paragraphs, and should look like one.

Not worth taking: the blue-purple gradient header, the threading line drawn between cards with two
absolutely positioned pseudo-elements, the hover scale transforms, and the emoji pills
(*"📊 N tweets"*, *"🏁 End of thread"*). This app is dark, quiet and
[typographic](../project/design-css-overview.md).

One difference from theirs worth stating out loud: **theirs generated automatically when the page
opened.** Ours does not — Greg asked for a button. That is a deliberate divergence from "follow the
product decisions from the original version", made because he answered that question directly and
separately, and it happens to remove the retry bug above.

### The character limit, which they fought about twice

This is the part of their history most worth reading before writing a line of it, because they
changed their minds and the second answer is not obviously the right one either.

**The model routinely blew the budget.** Asked for 280 characters, it produced 281. Their Zod
schema rejected the *whole thread* when one post overran — the same all-or-nothing failure their
glossary had, where eight good summaries were discarded because the ninth was malformed.

1. Commit `1e672cb9`, *"implement graceful degradation for tweet character limit violations"* — the
   prompt's stated limit dropped 280 → 270, and overlong posts were **silently truncated** to 267
   characters plus an ellipsis.
2. Commit `e685a0d9`, six days later, *"remove silent content truncation from tweet thread API"* —
   reverted, explicitly on principle: *"Removes graceful degradation logic that was silently
   modifying LLM output… raise errors early, clearly & fatally… never implement silent data
   modifications."*

They were right to revert. Silently editing model output so it satisfies your own schema is a
textbook [silent success](../reusable/silent-success.md): the validator passes, the page renders,
and the thing the model actually said is gone with nothing anywhere saying so. That is the same
class of bug this repo has a whole document about.

But fail-fast is not the only alternative, and it is a bad one here — it throws away eleven good
posts because of one. **There is a third option and it is the one to build: accept the thread as
written, count the characters ourselves, and show the overrun.** Let a 281-character post render as
over; let a 190-character one render as nothing in particular. Nothing is hidden, nothing is
silently altered, and nothing good is discarded to punish one bad post. The reader can see exactly what happened, which is the property
both of their answers were reaching for.

(Note the residue of that fight, still in their files: the prompt says 270, the Zod schema says 280,
and the tooltip says 280. Ours should say one number in one place.)

### Two more of their bugs, both relevant to on-demand generation

- **An infinite retry loop.** Their page auto-generated when it became visible, and the `useEffect`
  that did it re-fired on every failure — generating, failing, generating again. Fixed by setting
  `hasGenerated = true` on *every* error path. We are less exposed, because Greg chose a button
  rather than auto-generation, but the shape of the bug survives any "generate if absent" effect.
  Running generation through the job queue rather than a `useEffect` avoids it structurally.
- **A dead button.** *"Post to Bluesky"* shipped fully styled, next to a working copy button, wired
  to `alert('Coming soon!…')`. Don't. A control that looks live and isn't is worse than an absent
  one — which is why this repo's unbuilt ideas are dimmed and say *"not built yet"* in their
  tooltips. That convention started in the bottom bar and lives on the metadata page now, the bar
  having run out of unbuilt ideas ([260825c-bottom-bar.md](260825c-bottom-bar.md#the-dimmed-placeholders-are-gone)).

## What it costs

- **One model call per article, ~4,000 output tokens**, only for articles someone opens this page
  for. Time it from the outside and record it — the
  [borrow list](../project/original-version/borrow-list.md) asks for that on every model call, for
  the good reason that their own SDK timestamps came back empty and read as zero rather than as
  missing.
- **A sixth pipeline step**, and the `STEP_ORDER` split above.
- **A prompt to maintain**, which is the real cost. It is the fifth in the repo and the first whose
  output is meant to be read *instead of* something rather than alongside it.

## As built: where this plan met the code <a id="as-built-where-this-plan-met-the-code"></a>

Landed 2026-08-25 as [`src/tweets.ts`](../../src/tweets.ts) (write), `loadTweets` in
`src/api.ts` and `GET /api/tweets/:slug` in
[`src/routes.ts`](../../src/routes.ts) (read), with tests in
[`tests/tweets.test.ts`](../../tests/tweets.test.ts), [`tests/jobs.test.ts`](../../tests/jobs.test.ts)
and [`tests/routes.test.ts`](../../tests/routes.test.ts).

Six things came out differently from the plan above. The first two are the plan being **wrong**
rather than imprecise, and both were caught by a cross-model review of this document against the
code rather than by building it.

### 1. The plan described a write with no read

It specified `tweets.json`, the step, the queue, the prompt and the page — and no way to get the
artefact back out. There was no tweets endpoint, and `Article` has no thread on it. Written exactly
as planned, the button would have queued a job, the job would have written a file, and the page
would have had nothing to fetch.

So there is a read half: `loadTweets(slug)` in `src/api.ts`, behind `GET /api/tweets/:slug`. It
resolves the directory through the same `articleDir` the metadata page uses, so the thread and the
article can never come from different places — `stale` computed against somebody else's
`blocks.json` would be meaningless. Its own endpoint rather than a field on the article payload, for
a sharper reason than the metadata page's: most articles have no thread, so putting it there would
make every reader of every article download a `null`.

It is **GET only**. Writing a thread stays a job, because it is half a minute of model time and this
repo has [a queue for exactly that](../project/ingest-queue.md).

### 2. `sourceHash` was write-only, so the "cache" was not one

The plan insisted on a `sourceHash` and was right to. What it missed is that **nothing would ever
have read it**: the queue's skip check is `stepIsDone`, which asks only whether the file exists. A
`tweets.json` describing last week's text is present, so the step would skip, report *"already
done"* with a green tick, and the page would serve a thread about an article that has since
changed. Precisely the [silent success](../reusable/silent-success.md) this repo has a document
about, reintroduced by the plan that quotes it.

`PipelineStep` therefore gained an optional `isDone(ctx)`. Existence still runs first and the
override can only narrow the answer, so a freshness check cannot declare a missing file fine.
`tweets` is the first step to supply one: `threadIsCurrent` compares the stored `sourceHash` against
the blocks on disk, plus the prompt version and the model id — which is what
[architecture.md § Storage](../project/architecture.md#storage) has always specified for a cached
artefact and what nothing had implemented. Anything unreadable answers *not current*: being wrong
that way costs one model call, and the other way round serves a wrong thread for ever.

### 3. The pipeline is not one chain, and appending to `STEP_ORDER` pretended it was

`cascadeForce` encodes *"invalidating a step invalidates everything after it"*. **`tweets` is not a
link in that chain** — it reads `blocks.json` and `tree.json`, the same inputs the arc reads, and
nothing reads what it writes. Appending it after `arc` and leaving the cascade alone would mean
`force: ["arc"]` spends a second model call rewriting a thread whose inputs never moved.

`FORCE_ONLY_WHEN_NAMED` in [`src/pipeline.ts`](../../src/pipeline.ts) holds the steps position may
not speak for. A dependency map was the other option and is the more general answer; it was not
built, because one exempt step does not justify one, and the honest rule is not about branching
anyway:

> **A step may leave the positional cascade exactly when it can tell for itself whether it is
> current.** `tweets` can, so it does. `arc` cannot, so it stays in — its position is the only
> signal it has that its tree moved. Give the arc a freshness check and it belongs in the set too.

That is why (2) and (3) have to be read together, and why neither is safe alone. Both are pinned by
tests in `tests/jobs.test.ts`, including the one asserting `arc` is *not* exempt.

### 4. "Exactly one line" was four

`tweets` joined `STEP_ORDER`, `DEFAULT_INGEST_STEPS` appeared beside it, `STEPS` gained its entry,
and — the one the plan's table missed — `StepName` in [`src/types.ts`](../../src/types.ts) is a
hand-written union, not derived from `STEP_ORDER`, so the name has to be added there too or nothing
compiles. Small, but it is a shared file rather than the pipeline's own.

### 5. Two numbers, not one — and no colour bands

`LIMIT` is 280, what a post is counted against. `TARGET` is 260, what the prompt asks for; the gap
is the `12/14 ` prefix, which is chrome the page draws and so is not in the post's own text, but
which counts on X. Their three numbers were three disagreeing claims about *the same thing*; these
are two different things, both exported constants, and the prompt interpolates the target rather
than restating it.

Characters are counted as **code points**, not UTF-16 units — `"𝕏".length` is 2, which is a fact
about JavaScript and not about the post. Deliberately not X's own weighted algorithm (which counts
CJK and emoji double): our articles are English prose and the prompt forbids emoji, so the two agree
on everything we actually produce, and this one can be explained to a reader.

**Only a real violation is flagged.** See the note in the page section above.

### 6. Two fields the plan specified are gone

- **No stored post `number`.** Position is the array's job and the array already does it. A stored
  number is a second copy of one fact, and two copies can only disagree — which is how a page
  renders "3/12" twice. Render `index + 1`.
- **No `thread_summary`.** Theirs had one; it is a sentence summarising a thread that is itself a
  summary of an article, and the tree root's gist already says the whole piece in one sentence
  ([library.md](../project/library.md) already uses it for the card blurb). Cut from the type, the
  artefact and the prompt. Add it back only if a built page proves it needs one.

### And one thing the plan got right that is worth keeping

**The target length scales with the article.** Theirs asked for a flat 12, tuned on academic papers
of roughly one length; this pipeline eats a 500-word blog post and a 13,000-word essay through the
same stage. `suggestedLength` is one post per ~700 words, clamped 4–15. The Noema essay (8,275
words) lands on 12 — a sanity check on the divisor rather than a coincidence worth claiming.

The prompt is given the **byline**, because the voice rule ("Seth argues") cannot be followed
without a name; with no byline it is told to write "the author" rather than guess.

### The prompt, and the three changes this plan asked for

It is `SYSTEM` in [`src/tweets.ts`](../../src/tweets.ts) — read it there rather than in a copy here,
which would rot. All three were made:

- **The hook is gone.** In its place, a section saying the first post states what the piece
  *claims*, with two bad examples (`"A fascinating new essay asks the question nobody wants to
  answer"`, `"What if everything you know about X is wrong?"`) against one good one. `🧵`, hashtags,
  emoji and all-caps emphasis are each named and forbidden.
- **The caveats rule is kept and strengthened** — *"Where the piece limits its own claim, hedges, or
  says what it has not shown, say so too. A thread that drops an argument's limits has changed the
  argument."*
- **The voice is settled**: a reader reporting what the piece says, never the author, with the
  misattribution shown as a worked pair.

### It has been run, and the endpoint exercised

Twice against `data/writes` (Paul Graham, 561 words), the second time after the shape changed:
2,337 input and 365 output tokens, 6.1 seconds, five posts, none over 280. Two things only a real
run showed. That article has no byline, and the thread says "the author" throughout rather than
inventing a name. And its last post ends *"The piece doesn't say how anyone chooses, or what makes
the choice stick"* — the caveats rule doing exactly its job, prompted by nothing in the article's
own closing.

The read half and the job path were then exercised without spending anything: `GET
/api/tweets/writes` returns 200 with `stale: false`; an article with no thread returns 404 carrying
the `POST /api/jobs` body that would write one; a percent-encoded `../../` slug returns 400; `POST`
to the same path falls through unhandled. And `enqueue({ slug: "writes", steps: ["tweets"] })`
finished as **skipped — "already done"**, which is `threadIsCurrent` agreeing with itself and the
only way to see that the cache predicate is stable rather than merely strict.

## As built: the page

Landed 2026-08-25 as [`src/web/Tweets.tsx`](../../src/web/Tweets.tsx), wired into
[`src/web/App.tsx`](../../src/web/App.tsx) in place of the placeholder that was holding the route,
with a `Thread` button in [`src/web/Dock.tsx`](../../src/web/Dock.tsx) — relabelled `Tweets` on
2026-08-26, after this page's own name and route ([260825c-bottom-bar.md](260825c-bottom-bar.md#what-is-in-it)) — and tests in
[`tests/tweets-page.test.ts`](../../tests/tweets-page.test.ts). No CSS: it is chrome, so it is
Tailwind utilities, exactly as [`Metadata.tsx`](../../src/web/Metadata.tsx) is
([web-client.md § Tailwind and shadcn](../project/web-client.md#tailwind-and-shadcn-components)).

Everything the page section above asks for is there — `n/total`, the count against `thread.limit`
with only a real violation flagged, no avatars or handles or gradient, the staleness line, a copy
button per post and one for the thread. Four things are worth writing down.

### The hook could not submit this job, and `add` was the wrong place to fix it

`useJobs` had one way in: `add(url)`. It posts `{ url }` — which means *the default ingest steps* —
and throws the response away. The thread button needs the other shape, `{ slug, steps: ["tweets"] }`,
and it needs the id that comes back. Neither is reachable through `add`, and a flag on `add` would
have made one function mean two different things.

So `run({ slug, steps, force? })` sits beside it and returns the `Job`. `act` now returns what the
action returned instead of nothing, which is the only change to existing behaviour; the three
callers that wanted the side effect only (`cancel`, `retry`, `forget`) say `await` and keep their
`Promise<void>`. `AddArticle.tsx` is untouched.

Extending it rather than writing a private poller has a payoff beyond not duplicating code: the page
finds its job **in the polled list**, not in what it remembers clicking. A `tweets` run started in
another tab, or from the CLI, therefore shows up here as progress rather than as a button that looks
dead. The cost is that `useJobs` polls the whole job list and never stops, so a finished thread page
makes one small request every eight seconds for something it has no further use for. If that ever
matters the fix is an idle switch in the hook, not a second poller.

Two failures, deliberately told apart. The POST never landing means no job exists and nothing will
ever arrive to explain the silence. A job that *fails* leaves the running set, so without holding on
to its id the button would just reappear as though nothing had happened — the model call failed and
the page shrugged. The id is scoped to the run this page started, so an old failure from another day
is not dug up and shown as news.

### `{ slug, steps }` was a shape nothing tested

Every other caller in the app sends `{ url }`. The `{ slug, steps }` branch of `parseJobRequest` was
exercised by no test, and it is the whole request the button makes — a 400 there reads to the reader
as "the button doesn't work". Pinned now in `tests/tweets-page.test.ts`, along with the fact that
sending a `url` **as well** is refused: a page that helpfully added `article.meta.url` to the body
would break its own button, and the refusal is the guard described in
[`src/routes.ts`](../../src/routes.ts).

### A stale thread gets a button; a current one does not

[What is still open](#what-is-still-open) asked whether the thread should be regenerable, and worried
that `[rewrite]` puts a model call one click away. The page splits that question rather than
answering it:

- **Current thread: no button at all.** There is nothing to fix, and pressing it would queue a job
  that reports "already done".
- **Stale thread: "Write it again", and it needs no `force`.** The step's own freshness check
  (`threadIsCurrent`) already knows this thread describes blocks that have moved, so an ordinary
  `{ steps: ["tweets"] }` really does rewrite it. That is not "spend money on a whim" — it is the
  repair for a thread the page has just told you is wrong.

`[rewrite]` on a perfectly good thread is still not built, and is still open.

### The copy button, and the failure it cannot report

Per-post copy is the post's text alone. The `n/total` prefix goes only into the whole-thread copy,
which is the form you actually post: a single post's character count describes its own text, and
putting something else on the clipboard would make the count a small lie.

`navigator.clipboard.writeText` is checked for existence before it is called, because `?.` on a
missing clipboard throws nothing and leaves the button sitting on "Copy" for ever — the exact
[silent success](../reusable/silent-success.md) the button exists to avoid. One state it still
cannot report, found under browser automation: `writeText` can return a promise that **never
settles**, when the permission prompt has nowhere to appear. Neither handler runs. A timeout would
turn that into a "Couldn't copy" that might be false, so it is left alone and written down here.

### Seen working

Against `data/writes` at `/read/writes/tweets`: five posts, counts `156`, `230`, `241`, `274`, `230`
against 280, none flagged, the bar's button for this page (`Thread` then, `Tweets` now) carrying `aria-current="page"`, and the
last line clear of the fixed bar by about 32px. `/read/noema/tweets` shows the empty state and its
button. No console errors, no failed requests. The empty state's button was deliberately **not**
pressed — that is a model call, and the two states that matter were both already on disk.

## A second pass over theirs, 2026-08-25

Greg, after the page was built:

> Have a look at the Tweet Thread functionality. See if there's anything from the version we had in
> `docs/project/original-version/` that we should borrow, e.g. the new version seems to be missing
> some of the design polish and other functionality.

So `components/tweet-thread-view.tsx`, `components/tweet-card.tsx` and their page were read again,
this time looking for what *ours* had left behind rather than for what to avoid. Most of the
difference is the part we turned down on purpose and would turn down again: the blue-purple gradient
masthead, the `✨ AI POWERED 🧵` pill, the animated bouncing dots, the three blurred background
circles, the card hover-scale, the threading line drawn between cards with two absolutely positioned
elements, the `🏁 End of thread` badge, and the fully styled *"Post to Bluesky"* button wired to
`alert('Coming soon!')`. Their page is light, loud and Twitter-flavoured; ours is dark, quiet and
typographic, and that gap is the design, not a shortfall in it.

Three things did come across.

### 1. A thread that is fine can now be rewritten

This is the open question below, closed. Theirs had a **Reset** button beside the title at all
times; ours had a button only when the thread had gone stale. The reason for leaving it out was
real — *"a model call one click away, and nothing else in the app spends money that easily"* — but
the gap turned into its own problem, because the only way to replace a thread you simply did not
like was to change the article underneath it.

The answer is not to accept the click, it is to make it **two clicks and put it out of the way**:

- At the **foot of the page**, under a hairline rule, not beside the title. That is also where the
  thought occurs — you have just read the last post.
- **A confirm step in place, not a dialog.** Pressing "Write it again" replaces the button with
  *"Another model call, and this one is not out of date."* and a **Rewrite** / **Cancel** pair.
  Nothing is blocked and nothing is modal; the cost is simply stated before it is spent.
- **`force: ["tweets"]`, and it is load-bearing.** Without it the request is accepted, queued and
  *skipped* — `threadIsCurrent` says the artefact on disk is current, because it is — so the job
  goes green, the page refetches, and the reader gets back the very thread they asked to replace
  with nothing anywhere saying why. Textbook [silent success](../reusable/silent-success.md), and
  now pinned in `tests/tweets-page.test.ts` at both ends: the request parses with its `force`, and
  `cascadeForce` really does mark the step.
- **Only when the thread is current.** A stale thread already has a button, at the top, inside the
  paragraph that explains why it needs pressing. Two of them would be one too many, and the wrong
  one is the one further from the reason.

**A bug found on the way, worth writing down.** `write()` grew an argument — `write(force = false)`
— and `Progress` was passing it straight to `onClick`. React hands a click handler a `MouseEvent`,
so every ordinary press would have arrived as `force = <MouseEvent>`, which is an object, which is
truthy: every press forced. It typechecks, it works, and it is invisible until you wonder why the
bill is high. The default parameter is what makes the `onClick={onWrite}` shorthand dangerous;
`onClick={() => void onWrite()}` is the fix.

### 2. The thread's own numbers

Theirs had a row of pills — `📊 12 tweets`, `✏️ 2,610 chars in thread`, `📄 41,238 chars in
document`. The pills are not worth having; the three facts are. Ours says them as a line of prose:

```
A thread, 5 posts · 1,131 characters from 3,182 words
```

The document's word count is the one that earns its place. On its own "1,131 characters" is a fact
about nothing; beside the article's length it is the compression the reader is being asked to
trust — which is the honest thing to put at the top of a summary that sits next to
[vision.md](../project/vision.md)'s anti-goals.

The footer gained the other number the artefact already held: **how long the model took**.
`elapsedMs` has been written into `tweets.json` since the first run and nothing has ever shown it,
and a number nobody looks at is a number nobody notices going wrong — which is precisely how their
`0ms` timings survived ([borrow-list.md](../project/original-version/borrow-list.md)). `howLong` is
exported and tested, including the case that matters: an unusable value says *"in an unknown time"*
rather than `0.0s`, because "instant" and "we never measured it" must not render the same.

### 3. The copy button can be heard

The one accessibility detail theirs had and ours did not. Their button changed its `aria-label` with
its state; ours changed only its visible text, inside a `Button` whose accessible name came from
`title` — so a screen reader announced "Copy the thread" whatever had happened, including
**"Couldn't copy"**, the state the whole component exists to report. Now the `aria-label` tracks the
state and the label sits in an `aria-live="polite"` region, so the outcome is announced rather than
merely displayed.

### What was looked at and left there

- **The thread summary.** Cut on purpose in [§6](#6-two-fields-the-plan-specified-are-gone) and
  still cut: a sentence summarising a thread that is itself a summary, when the tree root's gist
  already says the whole piece in one sentence.
- **The green → amber → red character bar.** Rejected in the page section above for the reason that
  still holds — it cries wolf at 190 and teaches you to ignore it at 281.
- **Auto-generation on page open**, and the retry loop it came with. Greg asked for a button.
- **Bluesky.** Still no.

## What is still open

- **Per-post anchoring.** Turned down for now by "follow the product decisions from the original
  version", and the shape to add later is one optional `blockId` per post. If it is ever added, the
  page becomes a way *into* the article rather than a substitute for it, which is the version that
  answers the anti-goal outright.
- **Bluesky and X posting.** Theirs planned it and never built it. Neither should we.
- **Whether this belongs in the library card.** A thread is a decent blurb. It is also a generated
  claim on a page full of other articles, which is a different risk.

## See also

- [260825e-metadata-page.md](260825e-metadata-page.md) — the other page, and the routing change both need
- [260825c-bottom-bar.md](260825c-bottom-bar.md) — the bar this page's button lives in
- [../project/ingest-queue.md](../project/ingest-queue.md) — the queue this generation runs through,
  and why the pipeline is a list
- [../project/architecture.md](../project/architecture.md) — storage layout and stage ownership
- [../project/vision.md](../project/vision.md) — the anti-goals this feature has to answer to
- [../project/original-version/borrow-list.md](../project/original-version/borrow-list.md) — what
  else that codebase is worth taking, in priority order
