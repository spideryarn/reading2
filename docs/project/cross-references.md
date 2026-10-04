# Cross-references: the article linked to itself

A phrase in the prose that sums up something the piece shows in detail elsewhere is underlined as a
link. Two examples:

- the abstract's "reduced recall by 38%" links to the results paragraph that reports it;
- "Figure 4C" links to the figure.

Hovering or focusing the phrase shows the same card every block link has: the target's section and
the start of its paragraph. Clicking jumps there, which flashes the target and offers the back chip.
The links are drawn in every mode. Cross-references are not a mode and have no band. Part of
[reading-view-overview.md](reading-view-overview.md).

> it annotated things by adding, you know, anchor links or whatever to relevant other parts of the
> article. So, for example, if it describes a result, then it would create an anchor link to the
> block that actually, you know, the results in detail that underlie that statement or conclusion.
> So you can always jump around the paper to get to the thing being described. And maybe this would
> be a preprocessing step that always happens. And you'd have a cool tooltip, a rich tooltip that
> you could hover over that would preview that linked-to block.
>
> — Greg, 2026-09-30

The plan, the reviews and the measured runs are in
[260930f](../plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md).

## What is stored

The `crossrefs` step ([`src/crossrefs.ts`](../../src/crossrefs.ts)) makes one Sonnet call over the
article with its [block ids](block-ids.md). The call returns `{ from, phrase, to }` triples. A
link addresses both ends by id and nothing else. The phrase is a slice of `from`'s own rendered
text, and the model's own string is not kept.

**Every rule the prompt states is enforced by validation**, and each rule has a `dropped` counter:

- `from` and `to` are known ids;
- a link is never to the same block or the one next to it;
- the phrase is 2–12 words;
- the phrase occurs exactly once in `from`'s rendered text;
- no two links overlap;
- there is a cap on the number of links.

"Exactly once in the rendered text" is the rule the whole feature rests on. The client can mark
only an occurrence it can find unambiguously, in the text the reader actually sees. That means
after maths has become MathML. So the server checks with the same finder, over the same text,
before it stores anything.

Freshness is a hash of exactly the request's article and skeleton. **A stale artefact is not
drawn.** A link can outlive an edit with both ids and its phrase intact and still no longer be
true, and the prose has nowhere to say "out of date".

## When it runs

- **After an import**, queued by its publication unless the reader has switched *generate the main
  modes* off ([ingest-queue.md § The add page](ingest-queue.md#the-add-page)). It is added to that
  list by hand, because the list is derived from modes and this is not one. It reads nothing, so
  its job is one step and is stamped ahead of Skim's.
- **On demand**, from Metadata's *AI processing* (`METADATA_RERUN_STEPS`).

Not in the import itself, which stays as fast as it can be. The prose picks the links up as soon as
the job finishes, with no reload (`useCrossrefs` refreshes on the job's completion).

**Cost, measured**: $0.05–0.17 an article on the local corpus. The plan has the token counts.

## In the prose

`"xref"` is the sixth `MarkKind` in [`annotate.ts`](../../src/web/annotate.ts). Each mark carries
`data-xref="<nonce>-<i>"`:

- the **nonce** is random per page load and held in memory only
  ([`xref.ts`](../../src/web/xref.ts));
- `i` indexes the validated artefact.

Every handler — the click, Enter, the card, and the mouse-up that would otherwise open a comment —
resolves a mark only through `xrefTarget`. That function checks the nonce and then takes `to` from
the artefact, **never from the DOM**. So an article's own HTML cannot make a working
cross-reference: it cannot know the nonce.

- **How it looks**: a thin solid grey underline, turning the link colour on hover. Quieter than a
  glossary term's dotted orange rule on purpose, and a different shape from it:

  > it's a little bit difficult to tell the difference between them and the glossary. Maybe because
  > they both kind of look like dotted lines […] those internal links are probably less important
  > than the glossary. So visually the glossary links should be a bit more prominent.
  >
  > — Greg, 2026-10-01 (spya-sxvq2j)

  It was a 2px dotted line in the link colour until then. `mark.xref` in
  [`annotations.css`](../../src/web/styles/annotations.css),
  [261001r](../plans/261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md).
- **Precedence**: an xref wins over a glossary term, a citation mark, a comment and a search hit on
  the same words. The one exception is an author's own `<a>`: an xref crossing one is dropped,
  and the author's link keeps its card and its click.
- **Keyboard**: one Tab stop per link, on the first piece of a phrase that marking split. Enter
  jumps.
- **Modified clicks**: nothing special. There is no `href`, so ⌘-click is not "open in a new tab"
  here.
- **Touch**: a tap goes straight there.

## Who sees it

**The owner, and since 2026-10-01 a visitor to a public article.** The owner's route is
`GET /api/crossrefs/:slug`, owner-authenticated. A visitor makes no request: the links arrive inside
the public article payload as `crossrefs: { links: [{from, phrase, to}] }`, and **only when they are
fresh**. The public reader asks `isStale` (`src/crossrefs-fingerprint.ts`) of the same inputs the
owner's read uses, so a visitor never sees a link the owner's view would hide. Greg approved both
defence edits:

1. **The mark is reserved at ingress.** The sanitiser keeps only the `data-*` names and classes an
   article may carry, so an article cannot forge `xref` or `data-block-*` markup
   ([261001a](../plans/261001a-article-markup-keeps-only-what-we-allow-of-data-attributes-and-classes.md)).
2. **Visitors see the links** ([261001b](../plans/261001b-public-article-visitors-see-debate-threads-relevance-citation-entry-and-cross-references.md)).

## Deferred

- Several targets per link.
- A reader switch to hide the underlines.
- Back-references on the target.
- Generating automatically for older articles on open.
