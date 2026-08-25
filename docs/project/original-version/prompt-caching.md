# Prompt caching — researched thoroughly, never built

**This is the one to actually implement.** They wrote a careful design for exactly our problem —
many model calls over the same article — and then filed it under `later/` and never shipped it.
Their doc is a usable spec; the point of this page is that we should cash it rather than admire it.

Reference doc: `docs/reference/LLM_PROMPT_CACHING.md`. Plan:
`docs/planning/later/250608a_prompt_caching_implementation.md`.

## How we know it was never built

`grep -r "cache_control\|cacheControl\|providerOptions"` across their `lib/` and `app/` returns
**zero hits** in any AI-calling code. The only matches are unrelated Supabase storage cache headers.
A well-researched design document, a full implementation plan, and no implementation.

Worth sitting with for a second, because it is a pattern rather than an accident: the design work
was the enjoyable part, the doc made it *feel* done, and the plan lived in a directory named
`later/`. Our equivalent risk is this very folder. See
[process-and-docs.md § 129 reference documents](process-and-docs.md#129-reference-documents-and-what-that-costs).

## Why it matters here specifically

Our shape is the worst case for uncached prompting and the best case for cached prompting:

- One article, sent **many times** — once per node for gists, again for the arc
  ([`src/arc.ts`](../../../src/arc.ts)), again for each comment
  ([`src/explain.ts`](../../../src/explain.ts)).
- The article is **the long part** of every one of those prompts, and it is **byte-identical** every
  time.
- The instructions are the short part and they differ per call.

That is precisely the layout caching is designed for: a long stable prefix, a short varying suffix.
[Q7](../open-questions.md#q7) — "which model, and how much does a tree cost" — is unanswered, and
this is most of the answer.

## The design, as they specified it

Their stated goal: *"Enable prompt caching across all document-processing Nunjucks templates
(excluding chat) to reduce costs by up to 90% and latency by up to 85% when processing documents
with multiple AI operations."*

The design decisions, quoted:

> **Common prefix approach**: All document-processing prompts will start with identical cached
> section containing role and document
>
> **Static-then-dynamic ordering**: Place all static content (role, document) before dynamic
> instructions
>
> **Document-level caching**: Single cache per document (not tool-specific) for simplicity and
> effectiveness
>
> **Page load cache timing**: Cache document prefix synchronously on page load before tools are
> available
>
> **Developer-driven cache annotation**: Tools must be explicitly annotated with cache behavior
> rather than automatic detection
>
> **Standardized document format**: All tools use `<document_html>{{ html_content }}</document_html>`
> wrapper
>
> **Automatic cache invalidation**: Tools marked with `requiresCacheRefresh: true` automatically
> trigger cache updates

The prefix itself is one shared partial, `{% include %}`d at the top of every template, with the
breakpoint immediately after it:

```
System: You are a smart, thoughtful, careful expert who assists with reading & research.

<document>
{{ document_content }}
</document>

[Dynamic instructions follow here...]
```

Also specified: a minimum of 1,024 tokens for the cached prefix (Anthropic's floor at the time), a
cache created once per document on page load and keyed `document-{id}-prefix`, a registry flag
(`mutatesDocument` / `requiresCacheRefresh`) so the one mutating tool refreshes it, and *"caching
failures gracefully degrade to full-price calls."*

### The prerequisite that killed it

Before any of that could work they had to **standardise how the document is wrapped**, because every
template did it differently. Their own finding:

> Found: Mixed wrapper tags (`<document>`, `<text>`, `<html_content>`, `<content>`,
> `<document_context>`)

Verified in the live code: `summarise.njk` uses `<text>`, `multi-summarise.njk` uses `<document>`,
`headings.njk` uses `<html_content>`. Three tools, three tags, for the same article.

**That is the whole lesson of this page.** Caching needs a byte-identical prefix, so the retrofit is
not "add a flag" — it is "go and make five prompts agree about something nobody was tracking". The
work was big enough and boring enough that it never started, and the 90% saving went with it.

**We have five prompts, not five hundred, and we can settle this in an afternoon.** Doing it now
costs nothing; doing it later costs what it cost them.

### Their cost arithmetic, 2025-era

| Provider | Min tokens | Saving on reads | Cache duration |
|---|---|---|---|
| Anthropic | 1,024–2,048 | 90% | 5 min, refreshed on access |
| Google Gemini | 1,024+ | 75% | 1 hour |
| OpenAI | 1,024 | 50% | 5–10 min |

Anthropic detail as they recorded it: cache **writes** cost 125% of base input, cache **hits** cost
10% — so break-even is **two reads of the same content**. Up to four breakpoints per prompt.

Their worked example: 10,000 requests a month over 5,000-token documents at an 80% hit rate came to
$42/month against $150 uncached.

> **These numbers are from 2025 and should not be trusted.** Load the `claude-api` skill for current
> pricing, minimums and TTLs. The *shape* of the argument — writes cost more, reads cost far less,
> break-even at two — is what transfers.

## What we'd do, concretely

1. **Put the article first, always.** Order every prompt as: article → instructions → the specific
   node or passage. This costs nothing today and is the whole precondition for caching later. It is
   worth doing *now*, before there are a dozen call sites to reorder.
2. **One place that builds the article block.** A single helper that returns the article's prompt
   block, used by [`src/toc.ts`](../../../src/toc.ts), [`src/arc.ts`](../../../src/arc.ts) and
   [`src/explain.ts`](../../../src/explain.ts) alike — because "similar" prefixes don't cache, only
   identical ones do, and three hand-written near-copies will drift. This is the same argument that
   put [`src/reading-time.ts`](../../../src/reading-time.ts) in a module of its own.
3. **Settle the document wrapper now.** One tag, one shape, used by every prompt — the thing they
   had to do first and never did. Ours would be `<document>…</document>`, chosen once and written
   into [table-of-contents.md § The generation prompt](../table-of-contents.md#the-generation-prompt).
4. **Mark the breakpoint explicitly** on that block, and **log whether the cache was read or
   written** on every call. A cache that silently stops hitting looks exactly like a cache that is
   working, which is [silent-success.md](../../reusable/silent-success.md) again — the only
   defence is reporting the cache-read token count and noticing when it goes to zero.
5. **Measure before and after on the Noema article**, and write the number into
   [Q7](../open-questions.md#q7). A cost claim nobody checked is worth nothing; that is already the
   standard [comments.md](../comments.md#decision-web-research) holds itself to.

## The alternative they took instead

For the nine-summary grid they skipped caching entirely and asked for all nine in **one call**,
which was ~89% cheaper than nine calls and needed no machinery
([summaries.md](summaries.md#the-second-version-two-dimensions)).

Both moves are available to us and they compose: **batch siblings into one call, and cache the
article prefix across parents.** Batching cuts the number of calls; caching cuts the cost of the
ones that remain. Do the batching first — it is simpler, it needs no provider-specific features, and
it has the side benefit of letting sibling gists distinguish themselves from one another.

## See also

- [overview.md](overview.md) — the map to that codebase
- [llm-plumbing.md](llm-plumbing.md) — the call layer this would sit inside, and what to log
- [summaries.md](summaries.md) — the batching alternative, and its all-or-nothing failure mode
- [../open-questions.md#q7](../open-questions.md#q7) — what a tree costs, still unanswered
- [../architecture.md](../architecture.md) — stages, artefacts, and caching on a content hash
