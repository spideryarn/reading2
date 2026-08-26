# Highlighting — semantic criteria, and why overlapping highlights are hard

Two separate things worth taking: a **feature** (highlight by meaning, not by string match) and a
**technical answer** (how to draw overlapping highlights at all). The second one is the more
valuable, because it is the kind of thing you only learn by hitting the wall.

Reference docs: `docs/reference/TOOL_HIGHLIGHT.md`,
`docs/reference/DESIGN_OVERLAPPING_TEXT_HIGHLIGHTS.md`.

## The feature: highlight against a criterion

The reader types a criterion in plain words — *"arguments supporting the main thesis"*, *"statistical
evidence"* — and the model marks the passages that match, each with a **confidence** and a
**reasoning** string. Confidence drives visual intensity: a strong wash for a confident match, a
faint one for a marginal one. Results can be sorted by position in the document or by confidence.

The API (`/api/semantic-search`) returns per hit:

```ts
{ elementId: string, confidence: number, reasoning: string, relevantText: string }
```

Highlight data lives in React state and is threaded down through props from `page-client.tsx`; it is
not written into the DOM as a side effect.

The intensity mapping in the shipped code (`lib/utils/semantic-highlighting.ts`) is **continuous**,
not the five discrete classes their reference doc describes — another doc/code drift
([process-and-docs.md](process-and-docs.md#129-reference-documents-and-what-that-costs)):

```ts
opacity = confidence / 100
backgroundColor: `rgba(219, 138, 69, ${opacity})`
borderLeft: `2px solid rgba(219, 138, 69, ${Math.min(1, opacity * 1.5)})`
```

`rgb(219,138,69)` is `#DB8A45` — the brand orange, which is also our
[`--primary`](../../../styles/tokens.css). Two things follow, and only one of them is good.

The good part: **the left border is scaled harder than the fill** (`opacity * 1.5`, clamped). A wash
faint enough to keep text readable is too faint to notice; the border carries the signal, the fill
carries the extent. That is a neat trick and it transfers directly to any mark we draw over prose.

The bad part: **search, glossary and semantic highlighting all use the same orange**, separated only
by opacity. Three meanings on one hue, at a time when only one set could be shown at once anyway. If
we ever have two kinds of mark on the page together, they need to differ by more than alpha — and on
our dark ground the failure is worse, because a low-alpha orange on near-black is nearly invisible
rather than merely subtle ([web-client.md § Dark mode](../web-client.md#dark-mode)).

Note also a genuine inconsistency they left behind: the API documents `confidence` as 0–1, and the
highlighting code takes it as 0–100. Somewhere between fetch and render there is a conversion. A
unit that changes silently as it crosses a boundary is a bug waiting for someone to move a line of
code.

**This fits our principles well.** It is a lens over prose the reader still reads — the text is not
replaced, summarised or reordered, it is *pointed at*. And it makes the model's judgment
inspectable: a confidence and a reason attached to each mark is exactly the "legible provenance" of
[vision.md § Principles](../vision.md#principles). Compare our
[comments](../comments.md) feature, which already prints how many web searches the model actually
ran, for the same reason.

## The technical wall: highlights can't overlap

`DESIGN_OVERLAPPING_TEXT_HIGHLIGHTS.md` is the standout doc, and it was written because of a real
problem: a search hit, a glossary term and a semantic highlight can all land on the same span, and
**Mark.js cannot express that**. The reason is structural, not a library defect — Mark.js wraps
matches in `<span>`s, HTML elements nest and cannot partially overlap, so two highlights whose ranges
cross each other have no valid markup.

The answer they landed on is the **CSS Custom Highlight API**: `::highlight(name)` styled against
`Range` objects registered in `CSS.highlights`, with no DOM mutation at all. Ranges may overlap
freely because nothing is being nested. Browser support was ~90% when they wrote it (Firefox stable
was the gap), with a documented fallback path.

Known debt they left behind, all listed in their own docs: only one highlight *set* can be active at
a time, highlights don't survive a reload, and a leftover pulse effect still mutates the DOM.

### They considered a richer document model, and said no

`docs/conversations/250620a_conversation_spideryarn_prosemirror_suitability_questions.md` records
them evaluating **ProseMirror** as the document data structure and rejecting it. Part of the reason
was this very problem: genuinely overlapping, non-nesting inline spans need `excludes: ""` plus a
unique id per mark — achievable, but real complexity. They stayed with plain HTML plus stable ids.

Worth knowing, because "adopt a proper rich-text model" is the obvious-looking answer when marks
start colliding, and someone who has tried it concluded that plain HTML plus ids plus the Custom
Highlight API is the lighter path. That is also our
[architecture](../architecture.md#what-a-block-is), so this is confirmation rather than news — but
it is confirmation from someone who did the evaluation.

## What we take from this

**Go straight to the CSS Custom Highlight API, keyed by block id.** We are not there yet, but we are
closer to needing it than it looks:

- [comments.md](../comments.md) already draws a mark on a selected span, and its anchor is the
  quote rather than an offset.
- Two comments on overlapping spans of the same paragraph is not an exotic case; it is the second
  thing a reader does.
- A search feature, a glossary, or this criterion-highlighting tool would each add another layer over
  the same prose.

So the rule for whoever builds the second highlight type: **do not reach for a wrapper-span
library.** Register ranges, resolve them from block ids
([block-ids.md](../block-ids.md) — id first, offset within the block second), and style them by
name. That skips the whole DOM-mutation phase they had to build and then unpick.

Two more things worth carrying over:

1. **Confidence should be visible, not just used.** Their intensity mapping is good design: the
   reader can see which marks the model was sure about. A binary highlight hides the model's
   uncertainty, which is the opposite of what we want.
2. **Persist the highlight set.** Theirs vanished on reload, which quietly makes the feature a toy —
   nothing you produce with it can be returned to. Ours would go in the URL or in a JSON artefact
   beside the article, like `comments.json` already does.

## Built, 2026-08-26 — and how much of this survived contact

[../search.md](../search.md) is the feature. What this file recommended, scored:

| This file said | What happened |
|---|---|
| the feature is worth having | **Built.** A criterion, a confidence, a reason per hit — all of it |
| confidence should be visible, not just used | **Taken.** Printed beside every result as well as drawn as intensity |
| the border scaled harder than the fill | **Taken verbatim.** ×1.5 on the bar, ×0.3 on the wash |
| persist the highlight set | **Taken.** `data/<slug>/searches.json`, and re-opening one costs no model call |
| don't put three meanings on one hue | **Taken.** The search wash is its own colour, not the orange at another alpha |
| **go straight to the CSS Custom Highlight API** | **Not needed** — see below |

That last row is the interesting one, and it is a case of this file being right about the problem
and aimed at a different solution to it. [`annotateHtml`](../../../src/web/annotate.ts) never wraps
a range: it cuts every text node at every mark boundary and labels each piece with whichever marks
cover it. Nothing nests, so nothing can fail to nest, and a comment, a glossary term and a search
hit that only partially overlap come out as a run of well-formed `<mark>`s carrying two classes
each. There is a test for exactly that case. Adding the third kind of mark cost that file one entry
in a union and one `if`.

The unit inconsistency this file spotted — API says 0–1, code reads 0–100 — was inherited as a
*lesson* rather than as a bug: the confidence is 0–100 everywhere, stated on the type and enforced
on the way in, and a value that comes back as a fraction is **counted in the log rather than
rescaled**, because rescaling is a guess. See [../search.md](../search.md#the-confidence-and-the-unit-that-changed-silently).

## See also

- [../search.md](../search.md) — what got built from this
- [overview.md](overview.md) — the map to that codebase
- [../comments.md](../comments.md) — our first marks-on-prose feature, and where a second one would collide
- [../block-ids.md](../block-ids.md) — the contract any highlight must be anchored to
- [glossary.md](glossary.md) — the other feature that wanted to mark up the same text
- [search-and-chat.md](search-and-chat.md) — where the semantic-search endpoint is shared
