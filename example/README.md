# `example/` — placeholder artefacts

A **hand-authored stand-in** for the pipeline's output, so the reading view
(pipeline stage 6) can be built and judged before stages 4–5 exist. Greg,
2026-08-24:

> For now, why don't you create a simple version of things? It could be
> hard-coded if necessary. … create placeholder that is in the format that
> you're expecting. And then other agents can always update that placeholder as
> needed.

| File | How real is it? |
|---|---|
| `blocks.json` | **Real.** Genuine stage-3 output from [`src/blocks.ts`](../src/blocks.ts), with real `spya-` ids. Just sliced. |
| `meta.json` | Real, hand-transcribed. |
| `tree.json` | **Placeholder.** Hand-authored to the documented [Node shape](../docs/project/granularity-zoom.md#node-shape). Replace with stage 4+5 output. |
| `labels.json` | **Derived, not generated.** Stage 4 splits into a structure call plus batched nav-label calls ([260826h-toc-scaling.md](../docs/plans/260826h-toc-scaling.md)) and writes this beside the tree; this fixture predates that, so it was rebuilt from the `navLabel`s already in `tree.json`. Its `batches` is `null` and honestly so — `null` says no call produced these, where `[]` would have claimed a run that made zero calls — which is why the eval skips its seam test rather than inventing boundaries. The manifest (`sourceHash`, `outlineHash`, `structureVersion`) *was* backfilled, because those are computed from the two files sitting next to it and are true statements about them. |

## What it covers

The opening of the test article (Anil Seth, *The Mythology Of Conscious AI*) —
the first 34 blocks, `spya-tgnssb` … `spya-gxdsbh`. That runs from the `<h1>`
through the whole of "The Temptations Of Conscious AI" and stops immediately
before the next `<h2>`. Deliberately a clean seam: a self-contained argument with
real heading structure, rather than an arbitrary cut.

It is ~25% of the 139-block article. Small enough to hand-author well, big enough
that the left-right axis has something to say.

## Replacing it

**Nothing reads this directory at request time any more.** Until 2026-09-05 `src/api.ts`
looked in `data/<slug>/` first and fell back here for the slug `example`, so a
fresh clone had something to open before the pipeline had ever run. That file was
the filesystem article reader and went with the store it read from
([260903f](../docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) § G).

The fixture is not retired — it reaches a reader the way every other article
does. `npm run setup` runs `db:seed-dev`, which loads this corpus into Postgres.
What has gone is the *fallback*, and losing it is the point rather than a
casualty: a fallback that served this text under a slug the reader had asked for
is exactly the bug the old note below described, and the last of it is now
structurally impossible rather than narrowed to one slug.

The historical note, kept because it explains the shape: the fallback used to
fire for *any* slug, so an article with no tree yet — or no article at all — was
served this text under the reader's own address. Narrowing it to the fixture's
own slug was the fix at the time.

Whatever writes a tree must satisfy the invariants in
[granularity-zoom.md § The tree](../docs/project/granularity-zoom.md#the-tree).
They are checkable:

```
npm run validate-tree -- example
```

That verifies contiguous ranges, children exactly partitioning their parent,
depth/parent agreement, every block covered by exactly one leaf, and that leaves
carry no `gist`. The client renders the tree as an HTML table with `rowSpan`, so
a tree that violates them doesn't crash — it silently draws a **wrong article**.
Run the validator.
