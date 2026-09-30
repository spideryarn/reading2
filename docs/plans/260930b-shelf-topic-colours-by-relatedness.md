# Shelf topic colours by relatedness

Report [SPIDERYARN-READING2-5N](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-5N), from an
admin (Greg), kind: suggestion. Owner doc: [shelf-terms.md](../project/shelf-terms.md).

> It strikes me that it would actually be great if they were coloured semantically somehow. […]
> Then you would naturally find that similar topics would get similar colours, and it would be
> easier to see which topics are related and which stand out. […] Use your judgment. Try to avoid
> something too, too complicated or expensive. It's not worth it.
>
> Follow-up thought. It just occurred to me we have an obvious clue. We could look at the
> correlations. So you can imagine a pairwise correlation or distance matrix between all of the
> different topics in terms of which articles they occur frequently in somehow […] If it doesn't
> wrap round, you could imagine doing something like, you know, MDS or whatever to project down to
> one-dimensional. […] if we can do this without resorting to calling AI providers for something as
> trivial as this, it would be nice.
>
> — Greg, 2026-09-29

## What is there now

A topic's colour is its **rank** mapped onto the categorical palette (`src/web/topic-colour.ts`):
the first seven topics get the seven Okabe–Ito hues, and so on. Greg guessed it was random. It is
deterministic but it means nothing, so two AI topics can be sky blue and vermilion.

## What we will do

**All of it runs in the browser, from data the client already has.** `GET /api/library/terms` already
returns every topic's full member list (`terms[].articles`, every member slug). So the relatedness
matrix costs nothing to fetch, needs no server change and no stored state, and makes no model call.

1. **Similarity.** Binary cosine between two topics' member-slug sets, `|A∩B| / √(|A|·|B|)`, and
   distance is 1 minus that. It is computed over the topics' **full** member lists, not the live
   narrowed counts, so a colour does not move when you choose a topic or type in search.
2. **A line.** Average-link clustering of the ~30 topics, merging the closest pair each time. At
   every merge the half holding the better server rank goes first, and exact ties go to the pair
   with the better ranks. The leaves come out in an order where related topics sit side by side, and
   the server's top topic is always first. This is deterministic, and needs no eigensolver.
3. **Spacing.** The gap between two neighbours on the line is `0.1 + height²`, where height is the
   average-link distance at which they were joined. A tight cluster packs into a few neighbouring
   stops ("they might all be shades of pink"). Topics that share nothing are a full step apart, so
   outliers spread over the rest of the arc rather than piling up on one hue.
4. **Colour: a new scale, `--hue-0 … --hue-31`**, in `styles/colourscales.css`. It is an open arc
   of 32 stops at OKLCH L 0.76, from red (25°) to violet (290°), with the most chroma sRGB holds at
   each step, capped at 0.16. It is printed by `scripts/generate-hue-ring.ts`. The cumulative
   positions are normalised to 0…1 and rounded to the nearest stop. Components still set a palette
   *reference* (`--topic: var(--hue-N)`), never a colour value.
5. **Degenerate shelves.** With no overlap at all, every join is at height 1, so the topics are
   evenly spaced in rank order. That is distinct colours, just unrelated ones.

**What was built:**

- The projection: `src/web/topic-colour.ts`.
- Where it is wired in: `ShelfTerms.tsx`, computed each render and not memoised. It is under a
  millisecond, and a hook there would sit after an early return (Sol R4).
- The ring and its measurement: `tests/colour-scales.test.ts` checks one lightness, chroma above
  0.11, and hue climbing without wrapping.
- The ring on `/design`.
- A unit test, `tests/topic-colour.test.ts`. It covers:
  - Sol's 9-topic cluster plus 21 loners (the cluster within 4 stops, and all 21 loners distinct);
  - two clusters in two bands;
  - an interleaved cluster held together;
  - the top topic at stop 0;
  - determinism;
  - no overlap giving even spacing;
  - tiny inputs.

  Two mutations were each seen to go red: spacing made even, and the rank tie-break removed. Each
  turned three tests red.
- The existing detail test now expects the ring. `data-topic-slot` is kept (Sol R7).

### What changed after the plan review (GPT Sol, read-only)

The first plan was classical MDS to one dimension, then a 50/50 blend of coordinate and even
spacing. Sol's R1 was right, with a worked example. With 9 related topics and 21 that share nothing,
1-D MDS puts all 21 at one coordinate, the blend gives them only nine colours between them, and half
the arc goes unused. R2: when nothing overlaps, the top eigenvalue is repeated, so the MDS answer is
arbitrary, and power iteration has a sign problem and a seed problem on top. R3 proposed the
dendrogram order this plan now uses. The spacing by join height is ours, and it keeps what the blend
was for. Also taken:

- binary cosine rather than Jaccard (Jaccard's union makes the chooser's modest overlaps vanish);
- 32 stops rather than 24, since up to ~30 topics;
- no `useMemo` (R4);
- `/design` and all the rank-colour prose updated (R7);
- the accessibility wording corrected (R6);
- the duplicate-copy mismatch named (R8).

## Trade-offs to name

- **The rainbow arc is not colour-blind safe**, unlike the categorical seven the first topics wore.
  Each topic's identity is still carried by its label, but **relatedness is carried by hue alone**,
  so a reader who cannot see the hue differences loses that signal (Sol R6). It is a supplementary
  cue, and every topic works without it.
- **Colours move when the shelf changes**, as they do today when the rank changes. Adding one
  article can shift the axis. This is accepted, the same as today.
- **Similarity over physical slugs**: copies of one work count as two articles. The counts do the
  same, but the chooser collapses exact copies, so duplicates can strengthen an overlap the chooser
  treated as one work (Sol R8). Fixing it needs a work id in the response, and is deferred.

## Deferred

- A wrapping 2-D layout (a hue *wheel*), which would use the whole circle.
- Work-level similarity (needs a stable work id on each member).
- Weighting membership by how often an article uses the phrase (`articles[].count`), rather than by
  set membership alone.
- Any reader control over colours.

## Status

- [x] Sol plan review (no P0; four P1s, all taken, see above)
- [x] Build: the projection and its tests; the `--hue-*` ring and its measurement; wired into the
  pill, the row swatch and the bar; `/design`; docs (shelf-terms.md § Colour, colour-scales.md
  § Hue ring)
- [ ] Sol code review; gates; push; note in docs/user-feedback/
