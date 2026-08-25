# What to borrow, in priority order

The summary of this whole folder. Everything here is argued for on its own page; this is the ranking
and the reasoning behind the ranking.

The ordering principle is **cheapness times regret**: how little work it is, multiplied by how much
it would cost to retrofit. Things that are nearly free now and expensive later come first, whatever
their size.

## Do these now, while they are still free

Each of these is under an hour, and each gets dramatically more expensive once there are more call
sites, more prompts, or more marks on the page.

| Do | Why now | Page |
|---|---|---|
| **Settle one document wrapper tag** for every prompt, and put the article **first** in every prompt | Their caching work died on a retrofit of exactly this. We have five prompts; they had five and it was already too many | [prompt-caching.md](prompt-caching.md#the-prerequisite-that-killed-it) |
| **One helper that builds the article prompt block** | "Similar" prefixes don't cache, only identical ones do; three hand-written copies will drift | [prompt-caching.md](prompt-caching.md#what-wed-do-concretely) |
| **Throw on an undefined template variable** | Otherwise a renamed variable silently sends the model a prompt with a hole in it | [llm-plumbing.md](llm-plumbing.md#good-prompts-as-files-with-a-validated-input-type) |
| **Time every model call from the outside** | The SDK's own timestamp fields were empty in production, and read as zero rather than as missing | [llm-plumbing.md](llm-plumbing.md#one-real-gotcha-worth-stealing-outright) |
| **A global `prefers-reduced-motion` rule** | Ours is a view built on motion. Retrofitting per-component is how theirs ended up covering almost nothing | [design-system.md](design-system.md#accessibility-and-motion) |
| **The two-sided extraction ratio check** | Catches the extraction failure that errors nothing: a page that extracted *something*, but not the article | [extraction.md](extraction.md#quality-measurement-real-and-worth-rebuilding) |
| **Adopt 238 wpm with its citation** | Ours uses an uncited 230. One number, one reference, one module already built for it | [difficulty-and-reading-time.md](difficulty-and-reading-time.md#reading-time-the-good-one) |
| **A fatal error on any id collision** | Their guard is the thing that would have caught their real "headings vanish after reload" bug early | [ids.md](ids.md#three-more-things-they-learned-the-hard-way) |
| ~~**Size cap, timeout and browser-like headers on the fetch**~~ — **done**, 2026-08-25 | Taken, with none of their numbers: their 4 MB cap would have refused one of Greg's own example PDFs, and their SSL-root-CA fix depends on a package dead since 2019 | [../fetching.md](../fetching.md), [extraction.md](extraction.md#the-fetch-and-one-hard-won-fix) |

## Build these next

Real features or subsystems, worth doing properly, in this order.

### 1. Prompt caching, and a cost number

The single largest lever, and the one they researched and never pulled. Our shape — one long
article, dozens of short varying instructions — is the textbook case. Break-even is about two reuses;
we do dozens. Finish by printing a total at the end of `npm run toc` and writing it into
[Q7](../open-questions.md#q7), because their logging existed for a year and still couldn't answer
"what does this cost".
→ [prompt-caching.md](prompt-caching.md)

### 2. Batch sibling gists into one call — **done for the summaries, 2026-08-26**

One call per parent, returning gists for all its children. About 89% cheaper than one call each in
their measurement — and it has a second benefit they didn't need: siblings written together can be
made to distinguish themselves from each other, which is
[what a row is for](../table-of-contents.md#granularity). Siblings written in isolation cannot honour
that rule at all.

Cap the batch and salvage partials. Their version discarded eight good summaries because the ninth
was malformed, and their glossary's timeouts were caused by output length, not input length.
→ [summaries.md](summaries.md), [glossary.md](glossary.md#bug-one-output-tokens-not-input-tokens-caused-the-timeouts)

**Landed in stage 5e** — one call per parent, capped at eight, with the retry-with-repair from item 3
below and a `missing` count so a partly-written artefact cannot read as a whole one. The gists in
stage 4 are still one call for the whole tree; this is the same shape proved next door, and moving
stage 4 onto it is now a port rather than a design. → [../summaries.md](../summaries.md)

### 3. Retry-with-repair on structured output

One bounded retry with the parse error fed back, before failing the node rather than the tree. They
had no retry anywhere for model output.
→ [llm-plumbing.md](llm-plumbing.md#structured-output-hand-rolled-and-fragile)

### 4. A cost/latency sidecar per generation

Their `AiCallMetrics` shape, as JSON beside each artefact, plus cached-read tokens.
→ [llm-plumbing.md](llm-plumbing.md#logging-right-shape-wrong-storage-for-us)

### 5. "How much is under this" on a gist cell — **done in the summary panel, 2026-08-26**

Their "+N hidden" badge, adapted. A section holding 40 paragraphs and one holding 3 look identical
in our L2 column today, and that is a real gap in what the view tells you.
→ [structure-panel.md](structure-panel.md#what-we-take-from-this)

**Landed in the summary panel** — a paragraph count on every row and a "+N sections" badge on a
closed one. **Still open in the L2 column itself**, which is where this item was originally aimed and
where the gap is sharpest, since that column is what a reader is looking at while reading.
→ [../summaries.md](../summaries.md)

### 6. Resume where you left off

Neither app does this. We are most of the way there — `?at=` already holds a section's block id and
survives re-extraction — and a library page makes it the obvious next thing to want.
→ [cross-pane-sync.md](cross-pane-sync.md#the-gap-neither-of-us-has-filled)

### 7. Iterative structure generation, if the trees disappoint

Not a borrowing so much as a known next move. Their one-shot structuring of flat articles wasn't good
enough, and they ended on iterate-with-a-cap plus a human deciding when to stop — with the model
narrating what it changed and what it would do next, which is what makes "continue or finish?" a
question a reader can actually answer. Our stage 4 is a single pass today. If boundaries feel
arbitrary on flat articles, this is the direction, and it is charted.
→ [ai-headings.md](ai-headings.md)

### 8. A live design reference route

One page rendering our primitives against the dark ground. Cheap, and it catches the token-change
regression that nothing else can see.
→ [design-system.md](design-system.md#the-live-design-reference-page)

## Rules to adopt, not code

These cost nothing and prevent specific, documented failures.

- **Own reader position in one place, above everything that reads it.** Their pane sync broke twice
  and was only fixed by moving state up. A `setTimeout` used to coordinate two components is a bug
  report. → [cross-pane-sync.md](cross-pane-sync.md)
- **One always-visible pane beats tabs at this scale.** A tab that isn't mounted can't be kept in
  sync, which is what broke theirs. → [reading-view-ui.md](reading-view-ui.md)
- **Don't mutate the article.** Everything they had to build to make headings reversible — the
  mutations framework, the id churn, the accumulation bug — followed from editing the stored
  document. Our tree is a separate artefact over immutable blocks, and that is why none of it applies
  here. → [ai-headings.md](ai-headings.md#where-our-architecture-is-already-ahead)
- **A rail that follows the reader must not scroll.** Their auto-scrolling ToC worked correctly and
  was deleted for being disorienting. Ours is safe only because the rail is fixed-height.
  → [cross-pane-sync.md](cross-pane-sync.md#episode-one-auto-scroll-worked-and-they-killed-it-anyway)
- **Never generate text for something the reader can't see.** Their tooltips fetched summaries for
  filtered-out headings. Our gists are pre-generated, which makes this impossible — keep it that way.
  → [structure-panel.md](structure-panel.md#what-they-knew-was-wrong-with-it)
- **Validate server-side even when the prompt already forbids it.** A prompt instruction is a
  request; a validator is a guarantee. → [glossary.md](glossary.md#bug-two-dedup-deleted-the-more-specific-term)
- **Never fold a timestamp into a content-derived id**, and never run two id schemes at once.
  → [ids.md](ids.md#three-more-things-they-learned-the-hard-way)
- **Fail with an error naming the alternative, rather than falling back silently.**
  → [extraction.md](extraction.md#the-correction-the-escalation-ladder-was-never-built)
- **Name the step in a loading message**, and show nothing at all under a second.
  → [design-system.md](design-system.md#loading-states)
- **Get one critique of a plan from a different model before building, and keep it beside the plan.**
  Five real defects for one round, repeatedly. → [process-and-docs.md](process-and-docs.md#the-critique-habit-worth-stealing)
- **Check the code before believing a doc** — theirs or ours. Four of their reference docs describe
  features in the present tense that were never built.
  → [process-and-docs.md](process-and-docs.md#129-reference-documents-and-what-that-costs)

## Prompt lines worth stealing verbatim

- *"Provide only the summary itself … without any superfluous conversation or commentary."* The
  model wants to introduce itself; our arc prompt fought the same instinct.
  → [summaries.md](summaries.md#what-the-prompt-says-and-the-one-thing-it-doesnt)
- *"If you need to draw on knowledge from outside the text, be very explicit about it, e.g.
  '_Although the text doesn't mention it, ..._'"* Hallucination made visible instead of silent.
  Belongs in [`src/explain.ts`](../../../src/explain.ts). → [glossary.md](glossary.md#the-prompt-which-is-the-best-written-one-over-there)
- *"Adjust the length of your summary … if the text is a paragraph, write a sentence or two. If it's
  a page, write a paragraph or so."* A ratio rather than a length, which is what a tree needs.
  → [summaries.md](summaries.md#the-length-ladder)
- Their expertise definitions name an audience — "a 12-year-old", "a high-school student" — rather
  than an abstraction. → [summaries.md](summaries.md#the-second-version-two-dimensions)

## Deliberately not borrowing

- **The tool registry and executor framework.** Two independent critiques found it over-engineered
  and still buggy. → [tool-framework.md](tool-framework.md)
- **Chat.** Our named anti-goal, built well over there, with no evidence it helped anyone read.
  → [search-and-chat.md](search-and-chat.md#chat-the-one-to-be-suspicious-of)
- **A document-level difficulty badge.** A verdict the reader accepts rather than a tool they use.
  → [difficulty-and-reading-time.md](difficulty-and-reading-time.md#reading-difficulty-an-llm-instead-of-a-formula)
- **Inline auto-injected glossary marks.** Marks on prose the author didn't write, on the model's
  initiative. Make it on-demand instead, reusing [comments](../comments.md).
  → [glossary.md](glossary.md#what-wed-do-differently)
- **A second expertise axis on the zoom.** No evidence anyone used theirs, and it doubles a control
  that currently means one thing. → [summaries.md](summaries.md#the-second-axis-probably-not)
- **A command palette**, until there is more than one mode to reach.
  → [url-state-and-keyboard.md](url-state-and-keyboard.md#the-command-palette)
- **Mark.js, or any wrapper-span highlighter.** Not copied — but the recommended replacement was not
  needed either. `annotateHtml` cuts text nodes at mark boundaries rather than wrapping ranges, so
  three partially-overlapping marks are already expressible without the CSS Custom Highlight API.
  → [highlighting.md § Built](highlighting.md#built-2026-08-26-and-how-much-of-this-survived-contact),
  [../search.md](../search.md#drawing-the-marks-and-the-wall-that-wasnt-there)
- **A logo animation registry and playground**, a reader settings UI, skeleton screens, and
  eye-tracking. All specified there; the first was built at ~4,700 lines and the rest never were.
  → [design-system.md](design-system.md#the-logo-playground), [typography.md](typography.md#what-they-wanted-and-never-built)
- **Multi-provider abstraction**, until there is a second provider.
  → [llm-plumbing.md](llm-plumbing.md#good-enough-model-tiers)

## The one thing they'd tell us

Read the four rows of the drift table in
[process-and-docs.md](process-and-docs.md#129-reference-documents-and-what-that-costs). A year of
good work produced 129 reference documents, and the most valuable half-hour spent on this
investigation was running `grep` against four of their claims and finding that the feature wasn't
there.

## See also

- [overview.md](overview.md) — the map to that codebase, and every doc in this folder
- [../open-questions.md](../open-questions.md) — where several of these decisions land
- [../vision.md](../vision.md) — the tiebreak for anything in the "not borrowing" list
