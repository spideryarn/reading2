# Summaries — multi-granularity, already shipped once

They built the compression axis before we did, in two versions, and left behind two things we should
take: **a named length ladder arrived at by use**, and **the finding that pre-generating the whole
grid is what makes the interaction feel immediate**.

Reference doc: `docs/reference/TOOL_SUMMARISE.md`. Planning:
`docs/planning/finished/250608b_multiple_summary_granularities.md`. UI:
`components/dual-summary-sliders.tsx`. Prompt: `lib/prompts/templates/summarise.njk` +
`summarise.ts` (its Zod schema).

## The length ladder

Nine named rungs, each with a token budget:

| Rung | Max tokens |
|---|---|
| `short phrase of just a few words` | 10 |
| `short title` | 15 |
| `short sentence` | 25 |
| `sentence` | 30 |
| `sentence or two` | 50 |
| `few sentences` | 100 |
| `single short paragraph` | 200 |
| `couple of paragraphs` | 400 |
| `page` | 800 |

When no rung is specified the prompt falls back to an adaptive instruction, which is a nice piece of
writing in its own right:

> Adjust the length of your summary appropriately, based on the length and complexity of the text.
> For example, if the text is a paragraph, write a sentence or two. If it's a page, write a
> paragraph or so. If it's a book, write a page.

That is a **ratio** rather than a length, and it is arguably the more useful instruction — it is
roughly what our tree needs at every node, where a chapter's gist and a paragraph's gist should not
be the same size ([table-of-contents.md § Entry length grows with depth](../table-of-contents.md#granularity)).

Two things about this are worth more than the numbers.

**They are named, not numbered.** "Sentence or two" is a thing a writer can aim at and a reader can
recognise; "level 4" is not. Our prompts should ask for a *kind of line*, not a token count — and
[table-of-contents.md § Entry length grows with depth](../table-of-contents.md#granularity) already
does this, with 2–6 words for a `title` and 6–20 for a `navLabel`.

**The steps are not uniform.** 10, 15, 25, 30, 50, 100, 200, 400, 800 — roughly geometric at the
top, much finer at the bottom. That is a real finding about where the useful distinctions are: the
difference between 10 and 25 tokens changes what a line can *do*, while the difference between 400
and 800 is just more of the same. It is direct evidence for [Q4](../open-questions.md#q4): discrete
levels, unevenly spaced, chosen by what they can express.

## What the prompt says, and the one thing it doesn't

The whole summarise template is twelve lines. The instructions that matter:

> You are a research assistant providing careful document summaries.
>
> Be as concise, concrete, and easy to understand as you can. Prefer British English.
>
> Provide only the summary itself, in Markdown format, without any superfluous conversation or
> commentary.

plus formatting guidance ending in **"do not include headings"** — repeated verbatim in the
multi-summary prompt, which suggests the model kept adding them.

**"Provide only the summary itself, without any superfluous conversation or commentary"** is worth
stealing outright. It is the same problem our arc prompt hit and solved differently — sentences that
spent a clause announcing that a summary was coming
([granularity-zoom.md § The arc](../granularity-zoom.md#the-arc)). Two prompts, two projects, same
failure; the model wants to introduce itself.

**And here is the absence.** Nothing in that prompt asks the model to reuse the author's own terms
or framing. Nothing tells it what *not* to do beyond formatting. So it produces good, fluent,
generic summary prose — the "the author argues that…" voice that
[vision.md § Principles](../vision.md#principles) names as principle 2 and forbids.

That absence is the single clearest difference between their summariser and what we are building.
Theirs makes a good summary; ours has to make **a door into the passage**. The prompt rules at
[granularity-zoom.md § Generation](../granularity-zoom.md#generation) exist precisely because a
prompt that only asks for brevity gets you something satisfying to read instead of something that
sends you to the text.

## The second version: two dimensions

`250608b_multiple_summary_granularities.md` added a second axis — **expertise**
(beginner / intermediate / expert) crossed with three lengths — driven by two sliders
(`components/dual-summary-sliders.tsx`, plain `<input type="range">` with mirrored click targets).

The expertise wording is concrete enough to actually produce different output, which is rarer than
it sounds:

> **Beginner** — Use minimal jargon, provide background explanations, use language appropriate for a
> 12-year old (without being too colloquial)
>
> **Intermediate** — Some semi-technical terms might be okay, balanced explanations, use language
> appropriate for a high-school student
>
> **Expert** — Technical language appropriate, assume domain knowledge

Naming an audience — "a 12-year-old", "a high-school student" — gives the model something to aim at.
"Write for a beginner" does not.

The interesting decision is how the nine cells were produced. The obvious approach is nine calls in
parallel with prompt caching. They did the cost arithmetic and instead asked for **all nine in one
call**, returned as one JSON object, with `maxTokens: 3500`:

```json
{
  "beginner":     { "sentence_or_two": "…", "single_short_paragraph": "…", "page": "…" },
  "intermediate": { "sentence_or_two": "…", "single_short_paragraph": "…", "page": "…" },
  "expert":       { "sentence_or_two": "…", "single_short_paragraph": "…", "page": "…" }
}
```

Their own budget, from the template's header comment — the one directly comparable number to a
per-node budget in our tree:

```
- sentence_or_two:        ~50 tokens each  (150 total)
- single_short_paragraph: ~200 tokens each (600 total)
- page:                   ~800 tokens each (2400 total)
- Total output: ~3150 tokens for all 9 summaries
```

Roughly **89% cheaper** than nine separate calls, with no caching machinery to coordinate.

## What went wrong: all-or-nothing

`app/api/tools/[toolId]/handlers/summary.ts` parses that JSON blob and validates it with Zod. On any
parse or validation failure the whole call is marked failed and the handler throws. **There is no
retry and no partial salvage** — eight good summaries are discarded because the ninth was
malformed. There is no retry loop anywhere in that codebase for LLM output; the only retries are for
file uploads.

They also never used the AI SDK's `generateObject`, despite it being the SDK's own answer to this —
see [llm-plumbing.md § Structured output](llm-plumbing.md#structured-output-hand-rolled-and-fragile).

And document-level summaries were **never cached persistently**, so they were regenerated on every
view. Their own doc lists this as a limitation.

One more detail worth noticing: the heading tooltip's rung is **hardcoded** —
`const TOOLTIP_GRANULARITY = 'single short paragraph'`. Nine granularities generated, one shown
where it mattered most. Nobody ever wired the ladder to the place a reader actually meets it.

## What we take from this

Our tree is the same idea, generalised: instead of nine summaries of the whole article, we generate
one gist per node at every depth ([granularity-zoom.md § Generation](../granularity-zoom.md#generation)).
So the borrowings are specific:

1. **Batch siblings into one call.** Their 89% figure is for one document at nine granularities;
   ours would be *one call per parent, returning gists for all its children*. Same shape, same
   saving, and it has a second benefit theirs didn't need: siblings generated together can be made
   to distinguish themselves from each other, which is exactly what
   [table-of-contents.md](../table-of-contents.md#granularity) says a row's job is. Sibling gists
   written in isolation have no way to honour that rule.
2. **But cap the batch and salvage partials.** Their failure mode is the cost of batching, and it
   compounds with the output-token ceiling that caused the glossary's 504s
   ([glossary.md](glossary.md#bug-one-output-tokens-not-input-tokens-caused-the-timeouts)). A parent
   with 40 children is too big a batch. Bound it, and on a parse failure retry once with the error
   fed back before failing the node — not the whole tree.
3. **Pre-generate everything, ahead of time.** This is the one their doc is clearest about and the
   one our interaction depends on: switching granularity has to be instant, which means nothing may
   be generated on demand. Our pipeline already does this — gists live in `tree.json`
   ([architecture.md § Pipeline](../architecture.md#pipeline)) — and it is worth naming as a
   requirement rather than an implementation detail, because the moment a hover triggers a call, the
   feature stops feeling like zoom and starts feeling like waiting.
4. **Cache on a content hash and never regenerate a document you've already done.** They didn't, and
   paid for it on every page view. Ours is already the rule in
   [CLAUDE.md](../../../AGENTS.md); this is what it looks like when it's skipped.

## The second axis: probably not

Expertise (beginner/intermediate/expert) is a real dimension and we should be slow to add it. There
is no evidence in their repo that anyone used it — no telemetry, no follow-up doc, no critique. Two
sliders is a lot of interface for a thing nobody measured.

If reading level ever matters here, the cheaper form is a **single global setting**, not a
per-summary control: the reader says once what they know, and it conditions generation. That keeps
the zoom axis meaning one thing. Our horizontal axis is already carrying the whole idea of "how much
detail", and doubling it up is how a clean gesture becomes a control panel.

## Built, 2026-08-26

All four borrowings above landed as **stage 5e** and a mode in the reading band —
[../summaries.md](../summaries.md) has the feature and
[`src/summarise.ts`](../../../src/summarise.ts) has the stage. What actually shipped, against the
four numbered points:

1. **Batching by parent** — one call per parent covering all its children at both rungs. Done.
2. **Cap the batch and salvage partials** — capped at eight, one bounded retry with the parse error
   fed back, a failed batch loses only its own sections, and the count of what did not survive is
   written into the artefact so a half-written file cannot read as a whole one.
3. **Pre-generated** — nothing is written when the reader moves the Length control.
4. **Cached on a content hash** — plus the prompt version and the model id.

And the absence this page names — the ladder generated nine ways and shown one hardcoded way — is
the thing the build is shaped around: the same three rungs hang on the article, every part and every
section, and one control moves all of them.

Two things here were **not** taken, both on this page's own advice: the expertise axis, and their
all-or-nothing parse.

## See also

- [../summaries.md](../summaries.md) — what we built from this page
- [overview.md](overview.md) — the map to that codebase
- [../granularity-zoom.md](../granularity-zoom.md) — our version: a gist per node, at every depth
- [../table-of-contents.md#granularity](../table-of-contents.md#granularity) — our length rules, and why a row's job is to distinguish itself
- [../open-questions.md#q4](../open-questions.md#q4) — discrete levels or continuous zoom
- [prompt-caching.md](prompt-caching.md) — the alternative to batching, which they designed and never built
- [llm-plumbing.md](llm-plumbing.md) — structured output, retries, and what they logged
