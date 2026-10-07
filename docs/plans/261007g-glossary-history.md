# Glossary: the history moved out of the reference doc

Moved verbatim from [docs/project/glossary.md](../project/glossary.md) on 2026-10-07, when the docs sweep
split over-long reference docs (docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § Three
questions, 3). The reference doc keeps what is true now; this keeps how it came to be. Nothing here is
current unless the reference doc says so.

## Where it lives, and why that cost nothing

`fitView`
in [`layout.ts`](../../src/web/layout.ts) already knew about the slot rather than about chat; the
whole change there was one line in `App.tsx` (in
[`reader/Reader.tsx`](../../src/web/reader/Reader.tsx) since 2026-09-06) — `chatting` became
`mode !== "hierarchy"` (`toc` until the mode was renamed on 2026-08-29). That is the evidence that the reframing was right, and it is worth recording
because the reframing looked at the time like extra ceremony for one feature.

## The run row: Find more, or Write a new list

### The owner’s run button before 2026-10-03

It was the band's foot until 2026-10-03, and hidden there on an outdated list.

### Appending across prompt versions before 2026-10-04

Until then
the version had to be the current one, the prompt was bumped five times in eight days, and so on
most of the shelf the one button replaced the list under a label (*Find terms again*) Greg could not
read.

## The underline is always there

### The opening glossary GET and the band’s duplicate GET

For a day there were **two** GETs: this one, and the band fetching the same URL again from
`status: "loading"` when it opened. So the panel said *"Looking for a glossary…"* over a list
that was already on screen, underlined, in the prose behind it — and on the Postgres store that
second request read most of the article out of the database to compute one boolean.

[260827am-glossary-read-latency.md](../plans/260827am-glossary-read-latency.md) has the measurements.

## The hover card

### The false claim that tapping never fires pointerleave

**This paragraph said the opposite until 2026-09-03** — *"a tap … never fires the leaving event"* —
and so did the comment on the handler. It is the false belief itself, written down in two places,
and it is what made a second document-level listener look safe to leave unguarded: `pointerleave`
closed the card 220ms after every tap, for a week, on every touch device.
[260903g](../postmortems/260903g-the-touch-card-closed-itself-on-every-tap.md).

## What we deliberately do not do

What happened instead was Greg's call, 2026-08-25, chosen over a jump-only alternative: **selecting a
term underlines its occurrences, and only while it is selected.** Reader-initiated, so the principle
holds — and it answers the question the list otherwise raises on every entry, which is *where does
this piece actually use that*.

**That half was reversed on 2026-08-26** — see [The underline is always there](../project/glossary.md#the-underline-is-always-there)
above, which says what survived of it and what did not.

## Written for somebody outside the field

The concept-allusion pair was added in round-2 review after
`after-6` still put the ordinary meanings of *Müller-Lyer illusion* and *pareidolia* in `senseHere`;
`after-7` and `after-8` reran it, but ordinary definitions still landed in `senseHere` as often as
under the old prompt.

## Digging deeper into a term

### The filesystem store’s glossary write

Worse, `glossary.json` is written with a bare `writeFile`, and a truncated one reads as `null` — which
the panel reports as *"Nobody has found the terms for this one yet"*, the whole glossary gone and
nothing saying so.

### The lookup’s passage anchor before 2026-09-04

It was `entry.blocks[0]` and nothing else, which
made a term used in five places uncheckable the moment the first of them changed — see
[The two ways it refuses](../project/glossary.md#the-two-ways-it-refuses-and-why-they-used-to-be-one) below.

## The two ways it refuses, and why they used to be one

### Refusals for an unquoted term and a stale list before 2026-09-04

They shared a sentence until 2026-09-04, and that sentence named the term and said
it *"does not appear in this article"* — so a reader met it under a row headed with that term, beside
the entry's own definition, and reported it:

> I tried to use the glossary check the web option, but it said that the phrase in the glossary when
> I was checking didn't exist even though it clearly did, because there was a glossary entry for it
> and I can see it right there on the page.
>
> — a reader, 2026-09-04

## Where the previous list comes from, and the four answers it can give

### Reading the previous glossary before ArtifactStore (2026-08-28)

Until then it was
`readGlossary(dir)` inside the stage, whose every failure is one `null` — and the moment the
pipeline's artefacts leave the filesystem that read fails on every run while looking exactly like a
first pass, so *Find more terms* silently becomes *replace the glossary*, `passes` resets to 1, and
every `?term=` link goes dead ([260827aa-delete-the-importer.md](../plans/260827aa-delete-the-importer.md)).

## The scores the prompt required, and did not get

### Missing and invalid scores before 2026-09-03

Until 2026-09-03 nothing
counted either that or a score `score()` refused for being the wrong type or out of range, so a model
that started answering `"high"` for `0.8` would have quietly stopped the panel offering *prioritised*
order with no log line moving ([silent-success.md](../reusable/silent-success.md)).

## It hides what is below it, since 2026-09-03

### Hiding below-threshold entries reversed the reference-list argument

That reverses an argument this repo had written down and defended, in
[search.md § Prioritised](../project/search.md#prioritised-place-order-with-a-bar-under-it): *a glossary is a
reference list, and a term you cannot find is a term you have lost.* It did not survive contact.

## Staleness, and the force cascade

### The stage’s three freshness comparisons before stamp

Until 2026-08-28 this was a hand-written `glossaryIsCurrent` in `src/glossary.ts` doing the same
three comparisons. `stamp` replaced it, the function kept only its own tests alive, and a comment in
`pipeline.ts` wrongly said the CLI still needed it — so it was deleted.
