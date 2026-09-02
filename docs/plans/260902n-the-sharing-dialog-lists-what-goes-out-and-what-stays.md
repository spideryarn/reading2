# The sharing dialog lists what goes out, and what stays

**Status:** built, 2026-09-02.

The Access & Sharing confirmation says *"the whole extracted text"* and then one line about
what a visitor sees. Greg, 2026-09-02:

> Can we clarify that this will also share all the AI-generated stuff too (e.g. Summary,
> Glossary, Diagrams, etc). Better still, dynamically generate a list of what will be shared
> (with tooltips if needed). And maybe even a list of what *won't* be shared.

The sentence is not wrong, but "the whole extracted text" is the smallest true thing we could
have said. A shared link also carries the tree, the arc, the glossary, the ideas, the quotes
and the tweet thread — every one of them written by a model, several of them possibly shaped
by the owner's reader profile. The owner is being asked to make a rights statement, and they
should be able to see the inventory rather than infer it.

## What is actually shared today

Established by reading [`src/public/dto.ts`](../../src/public/dto.ts) (the allowlist),
[`src/store/public-reader.ts`](../../src/store/public-reader.ts) (the projection) and
[`src/web/visitor.ts`](../../src/web/visitor.ts) (what a visitor may open).

**Goes out:** the article's blocks; the meta (title, byline, site name, language, excerpt, and
the source URL through `publicSourceUrl`); the tree, with every `title`, `gist`, `summary`,
`navLabel` and `treatment` on it; the arc; the assets manifest; and the glossary, ideas,
quotes and tweet thread when they exist. Which means the modes **Plain, Hierarchy, Outline,
Summary, Glossary, Ideas, Quotes** and the **Tweets** page.

**Stays behind:** Chat, Search, Remember (and Quiz under it), Referee, Diagram, Timeline;
Comments and per-block notes; glossary lookups; the reader profile and the article's purpose;
the owner's private rename (`title_override`); the uploaded original file; and every pipeline
fact — `generator`, `version`, `sourceHash`, `profileHash`, timings.

Six of those are blocked for one reason (a model call a visitor must not spend), Comments for
another (they are the owner's own work), Referee only because `visitorGap` falls through
fail-closed, and Timeline because Greg deferred the decision — 260831i § Making a mode
public-readable.

## The design

**Derive the list from `visitorGap`, do not write a second one.** `src/web/visitor.ts` already
answers *what stands between this visitor and this mode* for all thirteen modes, and
`markedModes` already sweeps them. A hand-written inventory beside it would be a second answer
to a question already decided, and the copy in this repo has drifted that way before — the
dock tooltip against the band sentence, 2026-08-28. So `sharedInventory()` walks `MODES`,
calls `visitorGap`, and sorts each mode into a bucket by the answer.

**Three buckets, not two**, because `VisitorGap` already distinguishes them and the third is
the honest one:

- **Shared** — `visitorGap` returns `null`.
- **Not built yet** — `kind: "not-built"`. There is no glossary to share. But the owner must be
  told that building one later, while the article is shared, publishes it without asking again.
  Folding this into "not shared" would be a promise we break the next time they press a button.
- **Never shared** — `kind: "owners-only"` or `"readers-own"`, plus the fixed items that are not
  modes at all (comments, notes, the profile, the rename, the original file).

**`stages[].done` is the wrong signal and this is the trap worth naming.** It is
`status === "done" && isCurrent(step)` (`src/store/pg.ts`), so a glossary that exists but is
stale reports `done: false` — while the public payload carries it, because the projection reads
the column and never asks whether it is current. An inventory built on `done` would tell an
owner "nobody has built a glossary" about an article whose visitors are reading one. That is
[silent-success](../reusable/silent-success.md) exactly: the obvious check agreeing with the
code because it shares an assumption.

So the metadata response carries the presence flags directly. `ArticleSharing` gains
`available: PublicArtefacts` — the same five booleans the visitor's own page is keyed on —
computed in `pg.ts` beside `personalisedSteps`, from the revision row already in hand. It sits
inside the `sharing` block for the reason `personalised` does: absent means *this store cannot
say*, and the filesystem store says nothing at all.

### The simpler option passed over

Reuse `visitorSentence` for the tooltips. It is already one sentence per gap and it is already
tested. Rejected: those sentences are written **for the visitor** — *"Chat is for whoever added
this article"* — and an owner reading them about their own document is being told about
themselves in the third person. The classification is shared; the words are not.

## Slices

1. `ArticleSharing.available`, computed by `shareableArtefacts` in `pg.ts`, read by
   `asPublicArtefacts` in `AccessSharing.tsx`.
2. [`src/web/shared-inventory.ts`](../../src/web/shared-inventory.ts) — the three buckets, derived
   from `MODES` + `visitorGap`.
3. The copy, in `src/messages.ts` as [copy.md](../project/copy.md) requires: three headings, an
   `OWNER_MODE_NOTE` per mode, and the fixed rows.
4. `Inventory` / `InventoryList` in the dialog and on the shared card.
5. [`tests/shared-inventory.test.ts`](../../tests/shared-inventory.test.ts) and four cases in
   `tests/access-sharing.test.tsx`.
6. Docs: [security-map.md § The owner is shown the inventory before they publish](../project/security-map.md).

`PublicArtefacts` moved from `public-types.ts` to `types.ts`, re-exported, because `types.ts` now
needs it and `npm run check` gates on zero import cycles — type-only ones included.

## Two things it got wrong first, both worth keeping

**`available` was required, for an hour.** That made `asArticleSharing` reject a whole metadata body
over one field, so an owner whose `visibility` had arrived perfectly well got *"we could not check
who can read this"* and no switch at all. `tests/metadata-sharing-card.test.tsx` failed, which is
exactly the older shape a bug would produce. The blast radius was wrong: a missing inventory is a
reason to draw no inventory, not a reason to stop somebody unsharing their article. It is optional
now, and the narrow rule survives — **the list is drawn only from five real booleans, never from a
default**, because a `false` invented for a missing key is a specific, checkable, false claim about
what a stranger is about to read.

**`SHARING_WHAT_VISITORS_SEE` was inaccurate by omission**, and had been since slice 1b in August:
*"a visitor sees the article, its table of contents and every zoom level"*, with no mention of the
glossary, ideas, quotes and tweet thread a shared link has carried since. True, and true by leaving
out the four things an owner would most want to have been told. Putting the itemised list directly
under it is what made that visible. Now: *"…and whatever the model has written about it."*

## What was checked, and how it was made to fail

Both guards were watched going red before being trusted:

- Making `shareableArtefacts` report a stale glossary as absent → 2 red. That is the trap the whole
  slice is built around, so it is the one test that must be provably live.
- Making the sweep never file a mode as shared → 16 red.
- Rendering no inventory, and rejecting a body without `available` → the four card cases red.
- Reverting `PublicPages.tsx` to its hand-written four-row list → 2 red.

And one that went red on its own, which is the best kind: `tests/public-visibility-pg.test.ts`
deep-equals the whole `sharing` block from a real Postgres round trip, so `available` arriving broke
it. The fixture plants three artefacts and not the other two, so the assertion is now the
**asymmetry** — the end-to-end evidence that the columns the projection publishes are the columns
this field reports, which no unit test can give.

## What GPT Sol's review changed

The full review is beside this file. It requested changes and was right to; seven of its findings
landed, and each was checked against the source first.

- **`arc` was computed and read by nothing.** Its own row now, bucketed on `available.arc` exactly
  as tweets is. The comment claiming tweets were "the one artefact with no mode of its own" was the
  error stated out loud, which is why it survived.
- **"How it was made … stays with you" was false.** `publicTree` and `publicArc` publish `version`
  and `generator` on purpose. The row now claims only what genuinely never leaves: the money, the
  clock and the reader profile.
- **"Served from our copy" and then "the record of which we hold" were both wrong about images.**
  The `assets` manifest crosses, but nothing under `src/web/` reads it — every `<img>` still points
  at the publisher, for a visitor exactly as for the owner. The row says what a visitor gets and
  makes no claim about which server sends the bytes.
- **"Whatever the model has written about it" was materially false**, because chat answers, search
  results, quizzes, referee findings, the timeline and the diagrams are all model-written and none
  of them goes out. It names the four reading aids instead.
- **The three tree modes promised a gist per section**, which a `provisional` tree does not have —
  and `provisional` crosses precisely so a visitor can be told the structure is still arriving.
- **A missing inventory let an owner publish anyway.** Sol: that "defeats the feature precisely
  during a contract or rolling-version failure". The card now says so and offers no Share button,
  while **unsharing stays available** — taking an article back is never the direction worth
  blocking.
- **The not-built rows lost their description**, because `sharedNotBuilt` replaced it: the
  not-built Glossary chip had no text saying what a glossary is, and lost the clarification that the
  owner's lookups are not part of it. The heading and its note already say "not built yet" once for
  the whole column, so the per-row sentence is gone.

And the import-cycle reasoning was simply wrong: `types.ts` and `messages.ts` already import each
other's types and `npm run cycles` is green over them, so the gate does **not** count type-only
cycles. The move stands on the real reason — `public-types.ts` imports `types.ts` and nothing else,
and the two type modules should keep running one way — and both comments now say that instead.

### Tests Sol showed would have stayed green

All-false against all-true agrees with a function that ignores a flag, cross-wires two of them, or
reads the wrong one. So: **one flag at a time**, on the inventory and on the parser; a
metadata-response → parser → confirmation test with an asymmetric fixture; and assertions about
**which heading each chip sits under**, since a component that rendered every row as shared would
have passed a `textContent` check and been the worst possible version of this.

### One separate bug, found in passing and fixed

The **visitor's** metadata page — *"What has been built for it"* in `src/web/PublicPages.tsx` — had
four rows written out by hand against a `PublicArtefacts` of five, and the one left off was
`quotes`. Nothing was broken: the flag was computed, sent, and consumed by the dock; the list simply
did not mention it, so a visitor reading a shared article with quotes was told nothing about them
under a heading promising what had been built. The same class this whole slice is about — a
hand-written list beside an exhaustive type — so the fix is the same: the page walks `NOUN`
(`src/web/visitor.ts`), which is the table the reading view's own gap sentences come from, and
`tests/public-metadata-artefacts.test.tsx` asserts coverage rather than the one missing name. Watched
red against the old list: 2 failures.

### Left open, deliberately

- **The tooltips are hover-and-screen-reader only.** `title` has no focus or tap disclosure in any
  browser, so a sighted keyboard or touch user gets the label alone. The honest fix is a disclosure
  component this app does not have. The three headings and their notes carry every claim an owner
  has to be able to read; the chips are a skimmable index. Recorded at the component.
- **The `assets` manifest crosses while nothing consumes it**, carrying source URLs, hashes, content
  types, byte counts and failure reasons. Sol would rather it left the public DTO until cached
  delivery exists. That is a decision about `PublicArticle`, not about this dialog, and it is
  260829b's to make.
