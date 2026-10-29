# Explanations — the places a reader would get stuck, explained beside the words

Up: [reading-view-overview.md](reading-view-overview.md).

A list of the few passages a reader is likely to find confusing, each with a short explanation of
**the missing piece**: the skipped step, the point of a move, the background the author assumes,
or the claim a tangled sentence hides. It lives in the margin first and in a mode of its own under
*More* second, because that is how Greg expects it to be used. Asked for by Greg (admin) through
the Feedback button, report spya-nkq6rj, 2026-10-28:

> if you can tell that a user is going to be confused by a paragraph, then perhaps you could flag
> it with an explanation, or at least have a button that makes it easy. I suppose it's already
> fairly easy to ask for an explanation. So actually what I'd love is if it did it proactively, in
> much the same way that the glossary is proactive. There's just a little underlying waiting for
> me.
>
> … And if Opus is unsure itself, it should say so. And there should be an option to sort of, you
> know, ask in chat for more information. I suppose it should be allowed to search the web if that
> will help, but it should be clear if some of its responses are based on stuff that came from out
> the article.
>
> … Model the UI for it on the glossary mode, and perhaps put it as a mode within the more three
> dots. Because I don't think users are going to want to use that mode directly. They're mostly
> going to benefit from it in the, in the marginalia, and probably that explanation mode should run
> automatically on for all new articles. And I guess you should take into account readers'
> backgrounds, etc.

The plan, with GPT Sol's review that reshaped it, is
[261028c](../plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md).
It is step 7 of [explain-this-vision.md](explain-this-vision.md), built smaller than that sketch.

The next day Greg looked at the band and asked for what "model the UI on the glossary" had meant
(report spya-ay3u4w, 2026-10-28):

> For the explanations mode, I suggested that you borrow from the glossary UI. So I was expecting
> different orderings and a prioritized default with thresholding and an option to find more. And
> also, it's not using the full width of the sidebar, so it's wasting a bunch of space on the
> right-hand side. Take screenshots and you'll see.

That is [261029e](../plans/261029e-explanations-borrow-glossary-controls-full-width-and-a-calmer-reader-face.md),
§ 2 and § 3, and it is what [The band](#the-band-glossarys-controls) below describes.

## Where it stands (2026-10-29)

**Behind the [experimental switch](experimental-features.md), owner only, and run only when the
owner presses into the mode** — not on import, not when the margin opens. Two things move it:
Greg's answer to **q-gkrkf5** (on import, at about 10–15 cents an article, or later), and one live
run read by a person. Model calls could not be made when it was built (the key was over its monthly
limit until 1 November), so **nothing here has met a real answer yet**; the tests run on canned
ones. What waits for that is in each plan's § What waits for 1 November, and on the
[Overseer's queue](overseer-queue.md). For the scores and *Find more* that is: whether a real
`explanations/2` run returns both scores and spreads them enough for the bar to do anything (when
they do not, the order row simply is not offered, so a failure is invisible to the reader and has
to be looked for in the step's log — `difficultyAbsent` and the rest); calibrating the bar's
`0.10`; and whether a second pass finds places worth having or pads.

## What it is, and what it is not

- **One capable call** (Sonnet, or Opus under [high-powered AI](high-powered-ai.md)) reads the
  article as the reader in [their profile](reader-profile.md) — or as a curious reader new to the
  field — picks the places and writes each explanation, at most 60 words. Greg suggested a Haiku
  pass to find the places and Opus to write; that shape has to beat the one call on real articles
  before it is built.
- **Not a lone term's meaning.** That is [Glossary](glossary.md)'s job, and the prompt says so.
- **Not a paraphrase.** The reader has the passage; the explanation says what is missing from it.
- **Two labels the model sets**, because nothing in code can check them: *Not sure* (and the text
  says what it is unsure of) and *Draws on AI memory, unchecked* (it used something not in the
  article — the margin's Origin notes' wording).
- **No web search** in the explanation itself; *Ask in chat* searches. Greg allowed search; it is
  left out until the live runs show whether the `outside` items need it, and q-gkrkf5 says so.
- **Ask in chat** opens the ordinary chat about a passage ([chat-from-a-mode.md](chat-from-a-mode.md)
  has the alternatives), with the quote and the explanation in its first question.

## The rules the code keeps

In `src/explanations.ts`, each tested in `tests/explanations.test.ts`:

- **Every quote is checked against its block** (`findQuote`, spaced, as [faq.md](faq.md)'s
  passages), the article's own characters stored, and **dropped if the words occur twice in the
  block**, so the underline still to come can always find the one meant. Overlong is dropped,
  never cut.
- **One per block; at most `clamp(ceil(paragraphs / 6), 3, 15)` a pass**, applied after every
  other rule. One per block holds across passes: a *Find more* is told the places already
  explained, and a second place in a used block is dropped (`repeated`). The cap is what keeps a
  mark beside a passage worth trusting — explain-this-vision.md's worry about marking too much.
- **Two scores on every explanation** since `explanations/2`: `difficulty` (how likely this reader
  is to get stuck here) and `centrality` (how much of the argument depends on getting past it),
  0–1, Glossary's names and range. A score that is missing or out of range drops the field, not
  the explanation, and is counted in the log only (`ExplanationScoreDrops`). Every
  `explanations/1` list has none, and still reads.
- **The scores are in the system block and the schema only.** The first pass's user message is in
  the fingerprint, so it has not changed by a byte (a test pins it): an `explanations/1` list reads
  as *outdated*, which is true, not *stale*, which would say the article moved.
- **An empty list is an answer**; on a first pass, a non-empty one that the checks empty is a
  failure, as FAQ's. **A *Find more* that adds nothing is an answer too** (`lastAdded: 0`), as
  Quotes': the band says *No more places found*.
- **Freshness is the ordinary stamp** (article fingerprint, prompt version, model, profile hash):
  *stale* is not drawn in the margin; *outdated* stays quietly visible. As with Ideas and Glossary,
  an older prompt alone is not worth bugging the reader about (Greg, 2026-09-29). **Only an older
  prompt is outdated**, Quotes' rule: a version a newer build wrote is current, so a rollback never
  rewrites it.
- **A forced run appends or rewrites, and one predicate decides** — `existingFor`: it appends
  (*Find more*) to a list from the same article, not outdated, written for exactly the profile the
  run uses; anything else is rewritten. The step reads the previous list from the store
  (`previousExplanationsFrom`, which fails rather than read an unreadable list as none). The GET
  response's `panelRun` comes from the same predicate with the reader's current profile, so the
  button cannot say *Find more* over a run that rewrites — the client's own flags could not tell a
  cleared profile from an unchanged one.
- **On an append**, old items keep their ids, scores and `addedAt`; new ones are stamped once; the
  list is re-sorted into reading order; `passes` counts up; the stored `dropped` is cumulative,
  and this pass's counts go to the log.
- **Owner only**: never in the public read, never in a visitor's margin.

## The band: Glossary's controls

Top to bottom, each Glossary's own piece
([controls.md § Controls that do the same job look the same](controls.md#controls-that-do-the-same-job-look-the-same)):

- **The run row**, the band's one run button, on a finished list: *Find more* when `panelRun` is
  `append`, *Write a new list* when it is `rewrite`. Find more runs in the list's own profile
  setting, as Glossary's does. Not on an empty list that would append (an empty answer is a real
  one); on an empty list that no longer fits, *Write a new list*. The stale notice explains and
  carries no second button. The profile badge's panel keeps its Regenerate, as Glossary's does.
- **The order row**: *prioritised* (the default), *reading order*, *hardest*, *most central* —
  `?explby=`. Prioritised is Glossary's rule, not the FAQ's: `difficulty × centrality` decides
  shown or hidden, and reading order orders what is shown. Offered only when the bar could hide
  something; a score order only when some explanation has that score. So an `explanations/1` list
  has no order row and looks as it did.
- **The threshold** in the prioritised order — `?explbar=`, starting at Glossary's `0.10`,
  borrowed rather than measured. An unscored explanation survives every position, and the line
  under it says how many are hidden. The rule is
  [`explanations-order.ts`](../../src/web/explanations-order.ts).
- **Each row draws the scores it was placed by** as bars (`ScoreBars`, numbers in the tooltip):
  both under prioritised, one under a score order, none in reading order. Never the product.
- **The margin's *Open in Explanations*** lowers the bar just enough to draw a row it was hiding,
  then lands on it. The margin itself shows every fresh explanation whatever the bar says; whether
  it should follow the threshold waits for the live runs.
- **The list uses the band's full width.** The corner (i)'s clearance is on the top row, not on
  every row of a list that scrolls.

Not in this change: the command bar's *Explanations › Find more* (`FIND_MORE_MODES`,
[find-more.ts](../../src/web/find-more.ts)) — the mode is experimental and owner-only.

In the margin, a block with a fresh Explanation does not also draw the relations call's `explain`
note ([marginalia.md](marginalia.md)); whether those notes are now redundant is one of the things
the live runs decide.

## The underline in the prose

> New Explanations mode: Can we indicate when, in the text, when something's being explained,
> perhaps using something, an underline quite similar to the glossary.
>
> — Greg, 2026-10-29 (spya-njkskc)

Since 2026-10-29 every explanation in a fresh list is underlined where its quoted words are, **in
every mode**, for the owner with the experimental switch on: Glossary's 2px dotted rule, in a teal
(`--explained`) so it can be told from a term's orange. Resting on it opens the prose card's
*explained* section — the explanation, its labels, *Ask in chat · Open in Explanations* — and a
finger's first tap does, its second opening the band on that row. Plan
[261029j](../plans/261029j-explained-passages-underlined-in-the-prose.md); the survey of every mark
and its card is [tooltips.md § Every card on a mode's mark](tooltips.md#every-card-on-a-modes-mark-has-a-way-into-its-mode).

- **Placed as a citation is** (`explainedMarks`, which shares `citeMarks`' finder in
  [annotate.ts](../../src/web/annotate.ts)): the only occurrence of the quote in the block's
  rendered text, or no mark — never the whole block.
- **Who keeps the line where marks share words.** A glossary term inside the passage keeps its
  orange rule on its own words and the teal runs either side; the card draws the term, then the
  explanation. A comment or chat keeps its solid line, and a tap on it still opens it — for a term
  or a citation over a comment too, since this change (a finger could not open the comment there
  before; the postmortem is linked from the plan). A citation, a cross-reference (both
  `text-decoration`), a quote's fill and a search's outline all show alongside. **A
  cross-reference wins the hover on its own words**, as it does over a term: the teal still draws
  there, and the explanation's card is on the rest of the passage (seen in the browser check). The CSS rule is in `:where()`, weighing nothing, so every other mark wins the border
  without a pairwise override ([annotations.css](../../src/web/styles/annotations.css) § an
  explained passage).
- **One read for the prose and the margin**: `ExplanationsFeed`
  ([MarginaliaColumn.tsx](../../src/web/marginalia/MarginaliaColumn.tsx)), mounted by Reader for an
  owner with the switch on, in every mode. When the band opens, its own revalidation publishes into
  that same state rather than racing a second feed GET; while open, its job-completion refresh does
  the same. A stale list draws neither.
- **Not built**: a pressed state when a row is chosen in the band, a keyboard letter like
  Glossary's G, and whether the underline should follow the band's threshold (the margin does not
  either). How a dozen clause-long underlines reads on a real article waits for the first live run.

## Not built yet

- A copy for visitors to a shared article; a chat thread of its own per explanation.
