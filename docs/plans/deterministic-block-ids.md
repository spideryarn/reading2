# Deterministic block ids

**Status: decided not to, 2026-08-25.** The benefits don't seem to outweigh the complexity.

> ok this is starting to sound complex, so I'm going to defer it […] mark it as "decided not to,
> because the benefits don't seem to outweigh the complexity"
>
> — Greg, 2026-08-25

Kept because the analysis is the useful part. If this comes back — and the trigger is named at the
bottom — start here rather than from scratch. And read
[§ The one thing to carry away](#the-one-thing-to-carry-away) even if you never build this, because
it describes a change somebody could make by accident.

Everything about how ids actually work is in
[block-ids.md](../project/block-ids.md); this document only describes the road not taken.

## The proposal

Greg, 2026-08-25:

> Right now, I think we generate the spya paragraph IDs randomly. Could we generate them with a
> deterministic hash (based on paragraph contents and position (or block contents so far, or
> something like that), say? Or something better than that? I realise it won't be possible to make
> the block ID generation perfectly reproducible, especially in the face of minor tweaks to the doc,
> but perhaps we could try? We'd want to run this after running Mozilla Readability and sanitisation,
> presumably?

Answering the last question first: **yes, and that is already what happens.** Stage 3 calls
`sanitizeInPlace(doc.body)` at [`src/blocks.ts:275`](../../src/blocks.ts), before a single id is
minted, and there is a comment there explaining that sanitising afterwards would stamp ids onto
elements about to be deleted.

## We already have the deterministic function. It just isn't the id.

This is the thing that made the idea look smaller than it is, and then bigger.

[`matchKey`](../../src/blocks.ts) at `src/blocks.ts:232` computes, for every block on every run, a
deterministic and position-free fingerprint: the normalised text, or the image `src` when there is
no text. Stage 3 uses it as a **lookup key** into the previous `blocks.json`, which is how ids
survive a re-extraction today
([block-ids.md § Surviving stage 2](../project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters)).

Hashing would not add a new mechanism. It would make that key **self-describing** — the id becomes
the fingerprint, instead of pointing at a table of them — and drop the table.

So the honest framing is not "random ids versus derived ids". It is "do we still need the previous
`blocks.json` in order to know a paragraph's id?"

## What it would have bought

One real thing, and two small ones.

**The real one:** it deletes this sentence from the spine doc.

> **Carry-over needs the previous `blocks.json`.** Delete it and the ids are gone for good. It is a
> source artefact, not a cache; `data/<slug>/blocks.json` should be treated as precious.
>
> — [block-ids.md](../project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters)

With a hash, ids are recomputable from the extracted text. Lose `blocks.json` and you lose the tree
and the gists, but not the anchors.

**The small ones:** the first ingest of an article becomes reproducible across machines, so fixtures
and `blocks.json` diffs stop being noise; and a paragraph that is edited and then edited *back*
regains its original id, where carry-over loses it permanently at the first edit.

## What stopped it

### Duplicates are not hypothetical here

Identical normalised text must not produce identical ids, and this article already has eleven cases:

> On the test article all 11 pull-quotes are word-for-word repeats of body sentences.
>
> — [block-ids.md § What gets an id](../project/block-ids.md#what-gets-an-id)

Plus `"Yes."`, `"* * *"`, repeated list stubs. The fix is an occurrence ordinal inside the hash
input — `hash(key)`, `hash(key + "#1")`, `hash(key + "#2")` for the second and third copy. That is
the one place document order leaks back in, bounded to the duplicate group: inserting a new copy of
a repeated line renumbers only the later copies of that same line.

Hash collisions between genuinely *different* texts need the same treatment, and it has to be
deterministic — you cannot retry with fresh randomness the way `mintUniqueId` does. Same trick,
a salt bumped until the id is free.

No slug salt is needed: the Postgres plan already settled that ids only have to be unique within an
article, with a composite primary key
([postgres-migration.md § Block ids are only unique within an article](postgres-migration.md#block-ids-are-only-unique-within-an-article)).

### It freezes `normalize` into a public contract

Today [`normalize`](../../src/blocks.ts) at `src/blocks.ts:84` can change freely, because carry-over
recomputes the key on **both** sides — the previous run's blocks and this run's. A change to it is
self-healing.

With a hash, `normalize` and the hash function become frozen. Change either and every id in the
library re-mints on its next re-extraction, which is exactly the orphaning that random ids exist to
prevent. `blocks.json` stops being precious and `normalize` starts being precious instead. That is a
trade, not a win.

### Which is why it could not simply replace what's there

The design that survives that objection keeps carry-over as the outer layer, because carry-over is
what heals a hash-function change: the previous `blocks.json` still matches by text, so ids survive
even when the derivation moves underneath them.

```
  ┌─ 1. id already on the element, and it's ours ─────► keep       (re-run of stage 3)
  │
  ├─ 2. previous blocks.json has this exact text ────► carry over  (re-run of stage 2)
  │                                                                 ← heals a hash change
  └─ 3. no previous, or genuinely new text ─────────► hash it      (was: random)
                                                                    ← the new bit
```

Only step 3 changes: `mintUniqueId(taken)` at `src/blocks.ts:313` becomes `deriveId(key, taken)`.

That is a small diff — ten lines in `blocks.ts`, a new function in
[`src/ids.ts`](../../src/ids.ts), tests for the duplicate and collision paths. But it is a *third*
layer of id resolution, each with its own failure mode, guarding a file we are about to stop keeping
on disk anyway
([postgres-migration.md](postgres-migration.md)). Three mechanisms to explain, for one recovery case.

That is where it stopped.

## The one thing to carry away

**Position must never enter the hash input.** Not the index, not the running content, not "block
contents so far". This is the half of the idea that would actively make things worse, and it is
worth writing down even though we built none of it, because it is an easy thing to reach for.

```
  insert one paragraph at the top
        │
        ▼
  every hash below it changes
        │
        ▼
  every note, highlight and cached gist points at the wrong block — silently
```

That is precisely the sequential-id failure that random ids were chosen to avoid
([block-ids.md § Why random and not sequential](../project/block-ids.md#why-random-and-not-sequential)),
re-imported wearing a different hat, and it would be worse than today because it fires on **every**
re-extraction of a page that gained a sentence — which is the common case, not the edge case. It
fails without an error, which puts it in [silent-success.md](../reusable/silent-success.md)
territory.

If this is ever built: hash the block's own normalised text and nothing else. And hash the *text*,
not the HTML — block HTML shifts when the sanitiser policy is tweaked or Readability is upgraded,
and the text doesn't.

## What it would not have fixed

- **An edited paragraph still gets a new id** and still loses whatever was anchored to it. A hash
  cannot tell a rewrite from a new paragraph any better than text matching can. This is the limit
  people expect a hash to solve, and it does not.
- **The `<hr>` still doesn't survive.** No text, no `src`, nothing to hash. Only position could
  identify it, and position is the thing being refused. Still 138 of 139.

## What would change the mind

**When `blocks.json` stops being the store.** After
[postgres-migration.md](postgres-migration.md), the "lose the file, lose the ids" risk changes shape
— a dropped table, a botched migration, a restore from a backup taken before an id was minted. If
recovering ids from article text ever becomes an operation somebody actually needs, this is how, and
the layering above is the shape to build.

Until then, ids are minted once and preserved, and
[block-ids.md § If this ever changes](../project/block-ids.md#if-this-ever-changes) still applies:
never re-number in place.

## See also

- [block-ids.md](../project/block-ids.md) — how ids actually work; the spine
- [postgres-migration.md](postgres-migration.md) — the composite primary key, and the collision table
- [architecture.md § Pipeline](../project/architecture.md#pipeline) — where stage 3 sits
- [silent-success.md](../reusable/silent-success.md) — the failure mode this document is mostly about
