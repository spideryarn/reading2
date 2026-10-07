# The library: the history moved out of the reference doc

Moved verbatim from [docs/project/library.md](../project/library.md) on 2026-10-07, when the docs sweep
split over-long reference docs (docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § Three
questions, 3). The reference doc keeps what is true now; this keeps how it came to be. Nothing here is
current unless the reference doc says so.

Three other pieces went to the plans they came from:
[260904d § History moved from library.md](260904d-archive-articles-centre-the-text-and-a-done-key.md#history-moved-from-librarymd-2026-10-07)
(the unchanged storage vocabulary and the earlier deferral of permanent deletion),
[260828c § History moved from library.md](260828c-library-read-latency.md#history-moved-from-librarymd-2026-10-07)
(what deriving the card's numbers per request cost) and
[260825f § History moved from library.md](260825f-postgres-migration.md#history-moved-from-librarymd-2026-10-07)
(the filesystem store against Postgres, row by row).

## The routes

### The reference doc's route count

**This said "the two routes" until 2026-08-25.**

### An address nobody minted

**It was the shelf until 2026-09-03**, and this paragraph said so: *"There is no 404 page on
purpose: a mistyped address lands you on the shelf, which is both a useful place to be and
self-explanatory."* Greg went to `/asdf`, got the homepage and asked where the 404 was, which
answers the second half.

### Fifty lines of router, not React Router

#### The missing enableHistorySync call

Caught by a cross-model review on 2026-08-25, and written up in
[260825e-metadata-page.md § What the plan got wrong](../plans/260825e-metadata-page.md#found-by-the-cross-model-review).

## What you can do to a card

### Archive, and Undo is the confirmation

#### The archived list before Include archived joined the main shelf on 2026-09-29

Until then it was a **Show archived** disclosure at the foot of the shelf with a second, plainer
list, which neither the sort nor the row cap reached.

#### Excluding archived articles from the public listing

The clause went in on 2026-09-04, when GPT Sol asked which way the asymmetry ran.

### Include public, and an empty shelf that says where to go

#### The no-results message with counts for archived and public matches

It replaced the sentence
*"Archived articles aren't searched — turn on Include archived"*.

### Shelf state: a fourth kind of reader state

The filesystem half — `data/<slug>/shelf.json`, and the writes in `src/shelf.ts` — was deleted on
2026-09-05.

## Finding an article, and finding a passage in one

### The shelf search box

It sat at the very top of the page until 2026-09-03, above the box for *adding* an article and
separated from the list it filters by everything in between.

### The search box's clear cross

There had been one since August, a 14px grey glyph, with the browser's own bolder cross beside it
whenever the box had the focus.

## Sorting the shelf

### The shelf's resting state

#### The chip row leads with the default sort

That rule did not
change; the default did.

### The card says when the piece was published

#### Before the publication date appeared on every card on 2026-10-04

Until then a card said it only while the shelf was sorted by Published.

#### The separator dot between card facts

It was in front of each fact until 2026-10-05, and a wrapped line started with
a dot.

## Adding an article: the box submits now

**This section used to describe a stub.** It said the box printed four commands for you to run
yourself, and that *"running the pipeline from a request handler means background jobs, progress,
partial failure and a retry path — real work, and not what the experiment is about yet"*. That was
true and it was the right call for a day. Greg asked for the real thing on 2026-08-25, and it kept
the shape the stub promised: the input stayed, and the command list became the progress list.

`pipelineCommands` is gone. It existed to print those four commands, and a list of shell commands
that nothing executes drifts from the pipeline silently.

## `meta.json`, and the article's identity

### How the pipeline's output filenames determined the slug

Stage 3 named its blocks
  file after the HTML file and stage 4 named the data directory after *that*, so the basename was
  what the rest of the pipeline would call this article — and deriving it from the URL a second time
  would have been right for `npm run extract <url>` and wrong the moment anyone passed an explicit
  filename, with an article that had no byline as the only symptom.

## The fixture was always on the shelf

Until 2026-09-05, `example/` was listed under the slug `example`, flagged, and sorted below the real
articles, on every clone unconditionally — a fresh clone had no `data/` at all, and an empty homepage
reads as a broken app rather than an empty shelf. It was listed under its **directory name** and not
under the slug inside its own `meta.json` — that one names the full Noema article the fixture is an
excerpt of, and listing it there would collide with the real thing. `loadArticle("example")` resolved
by falling through (`src/api.ts`, the filesystem reader, deleted that day with the store it read
from).
