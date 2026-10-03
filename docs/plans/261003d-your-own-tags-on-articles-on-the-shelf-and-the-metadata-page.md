# 261003d — Your own tags on articles, on the shelf and the Metadata page

Report `spya-qmev0s` (Greg, admin, 2026-10-01), Overseer queue item `qi-aq9x8k9h`. Session
`fbqmev0s-your-own-tags`.

> In non-logged-in homepage shelf, add a way for me to easily add/edit my own tags to an article
> (with a nice combo-dropdown that enables me to type and/or select).
>
> These tags should be part of the topics-pill faceted-filtering interface for the Library shelf so
> I can filter by one or more etc.
>
> Also add this near the top of the article's Metadata page, reusing machinery.
>
> If you have ideas for how to improve/build on this, go for it. But avoid introducing too much
> complexity for the v1.
>
> — Greg, 2026-10-01

And, 2026-10-02, on the command bar ([chat-llm-help-commands-vision.md](../project/chat-llm-help-commands-vision.md)):

> Yeah, okay, we definitely do want to be able to add tags, but it can wait till tomorrow's session

"Non-logged-in homepage shelf" is read as **the homepage shelf** (`/`, Library.tsx): tags are a
reader's own data, and a signed-out visitor has no shelf to tag. The public shelf never shows tags.

## What a tag is

A short label a reader puts on one of **their own** articles. Private: only the owner sees them,
never the public shelf, never a stranger reading a public article. One article, many tags; one tag,
many articles.

- **Spelling.** Trimmed, inner whitespace collapsed to one space, NFC, 1–40 characters, no comma
  (the `?topics=` URL list is comma-separated), no control characters. Case is kept as typed.
- **Case-insensitive identity.** `AI` and `ai` are one tag. Adding a tag the reader already uses
  elsewhere under a different case takes **their existing spelling**, so the shelf never shows two
  pills for one idea. Adding one the article already has is a no-op.
- **At most 30 per article** — a ceiling against a script, not a design limit.

## Storage — one table

```sql
article_tags (
  article_id uuid not null references articles(id) on delete cascade,
  tag        text not null check (<the spelling rules above>),
  created_at timestamptz not null default now()
)
unique index on (article_id, lower(tag))
```

No `owner_id`: ownership comes through the article, as everywhere under `articles` (src/owner.ts).
The reader's vocabulary is `select tag, count(*) … join articles … where owner_id = $me group by`.

**Passed over: a `text[]` column on `articles`.** Fewer parts (it would ride on `listArticlesQuery`
for free), but a per-element check and per-article case-insensitive uniqueness are awkward or
impossible as constraints on an array, and "the reader's tags with counts" becomes an `unnest`.
sql.md: keys and constraints over good intentions. **Also passed over: a separate `reader_tags`
vocabulary table** with article_tags pointing at it — that is what rename-a-tag-everywhere wants,
and it is deferred; with one table, a rename is one `update … where lower(tag) = …` scoped by owner.

## API — two routes, one store module

- `PATCH /api/library/:slug/tags` body `{ add?: string[], remove?: string[] }` → `{ tags: string[] }`
  (the article's tags after, sorted case-insensitively). Owner-only through `ownedSlug` → 404 for a
  stranger. Add and remove are idempotent and commute, so two tabs cannot clobber each other the
  way a replace-the-set PUT would — and **"add a tag of X" from the command bar later is exactly
  `{ add: ["X"] }`**, validated by the same function. A bad spelling is a 400 naming the rule.
- `GET /api/library/tags` → `{ tags: { tag, count }[] }`: every tag the reader uses, archived
  articles included, for the combobox's suggestions.
- `LibraryEntry.tags: string[]` on the owner's shelf listing (active and archived), and
  `ArticleMetadata.tags` on `/api/metadata/:slug`. Neither the public DTO nor any `/api/public/`
  route gets them.
- Store: `src/store/pg-tags.ts` (`editTags`, `readerTags`, `tagsFor(articleIds)`), transactions
  pinned to `READ_COMMITTED`. Spelling rules in one pure module `src/tags.ts` (`normaliseTag`,
  `TAG_MAX_LENGTH`, `TAGS_PER_ARTICLE`) shared by server and client, so the client refuses the same
  thing the server would before sending.
- Export: `exportArticle` includes the tags, if the export test's table list demands it (it should).

## UI

**One component, `TagEditor`** (src/web/TagEditor.tsx), used in both places: the article's tags as
removable chips, then an input. Typing filters the reader's vocabulary into a listbox under it
(hand-rolled `role="combobox"` like CommandBar.tsx's; no new dependency). Enter or comma adds the
highlighted suggestion, or the typed text if nothing is highlighted ("Add “foo”" row first when
the text is new). Backspace in an empty input removes the last chip. Escape closes the list. Writes
go through one hook `useArticleTags(slug, initial)` → the PATCH, optimistic, settled by the answer.

```
 Tags  [ai ×] [consciousness ×] [ type a tag…        ]
                                 ┌──────────────────────┐
                                 │ Add “con”            │
                                 │ consciousness   12   │
                                 │ computational   4    │
                                 └──────────────────────┘
```

- **Shelf card and table row:** a **Tags** action beside Archive in the shared `Actions`, opening a
  Popover (radix-ui, already a dependency) holding the `TagEditor`. The card shows its tags as
  small chips in the existing chips row; the table shows them under the title. The shelf entry is
  updated in place from the PATCH answer, like `rename` does.
- **Metadata page:** the `TagEditor` inline under the facts line, near the top, only when
  `hasShelfRow`.
- **Pills:** tags join the topic row as their own chips, **first**, marked with a tag icon and a
  neutral colour so they read as the reader's rather than the program's. Key `tag:<lower(tag)>`, in
  the same `?topics=` list, so one selection, AND across tags and topics alike, one Clear. Their
  membership is built on the client from the loaded entries' `tags` (no server round trip: the
  entries already carry them), merged in front of the server's terms before `chosenTopics`,
  `topicMembers` and the counts — so every rule in shelf-narrow.ts holds for tags unchanged. Tags
  show even when the topics are still loading or too few. Zero-count tags drop from the row like
  topics do. `useChosenTopics` must not prune a `tag:` key before the lists carrying it have loaded.

## Stages

1. **Schema, store, routes, tests.** Migration via `npm run db:generate` (schema.ts first), the
   pure `src/tags.ts`, `pg-tags.ts`, both routes, `LibraryEntry.tags`, `ArticleMetadata.tags`,
   export. Tests: normalisation (pure), store (add/remove/idempotence/case reuse/cap/cascade),
   routes (400s, 404 for a stranger in owner-isolation), and that no public response carries tags.
2. **`TagEditor` + Metadata page + shelf action + chips on cards/rows.**
3. **Tags in the topic pills.** Pure merge in shelf-narrow.ts with tests; ShelfTerms renders them.
4. **Docs, browser check, Sol code review, feedback note.** library.md / shelf-terms.md sections;
   a line in chat-llm-help-commands-vision.md that tags exist and what the command would call.

## Deferred (named, not built)

- **The command bar's "add a tag of X"** — the PATCH `{ add: [X] }` and `normaliseTag` are its
  whole server side; it needs a `tags` controller on `ShelfRow` and a proposed-row command.
- Renaming or deleting a tag across every article; merging two tags.
- Clicking a tag chip on a card to filter by it.
- Tags in search (`filterEntries`), in the export to other formats, on the public shelf.
- Model-suggested tags.

## After GPT Sol's plan review (decisions)

Review: [261003d-tags-plan-review-sol.md](261003d-tags-plan-review-sol.md). No P0; not approved as
written. Sol's own "cleanest smaller v1" is taken, except for the URL. **These override the sections
above wherever they disagree.**

1. **Tags are stored lowercase** (Sol 1, 8). Case-preserving identity needs a vocabulary table to be
   correct under concurrency (two first adds of `AI` and `ai` on two articles); lowercase makes the
   tag *its own* key, so `(article_id, tag)` is the primary key and there is nothing to race. The
   topic pills are lowercase already, so tags look like them. `normaliseTag` lowercases (JS), and the
   CHECK requires `tag = lower(tag)`; a CHECK violation the JS missed is a 400, not a 500. Exact CHECK:
   `char_length(tag) between 1 and 40 and tag = btrim(tag) and tag = lower(tag) and tag !~ '[,[:cntrl:]]' and tag !~ '\s\s'`.
   Passed over, named: `reader_tags` with ids — keeps `AI`, enables rename; deferred.
2. **The cap holds under concurrency** (Sol 2): the edit locks the owned `articles` row
   `FOR UPDATE` (it exists, so the lock is real), removes, adds, then counts inside the transaction
   and refuses past 30. Arrays over `TAGS_PER_EDIT` are refused before the transaction. A key in
   both `add` and `remove` is a 400. Remove runs before add.
3. **A separate Tags row above Topics** (Sol 4), with its own `?tags=` param. Not a discriminated
   facet inside ShelfTerms: tags take no part in hues, More detail, paper cards or the topic copy.
   Both rows' member sets feed the one AND narrowing and the counts; Clear clears both.
4. **No automatic pruning of `?tags=`** (Sol 3): an unknown key is ignored (it narrows nothing and
   draws no chip), and the URL is rewritten only when the reader toggles or clears — so an in-flight
   or failed edit, or a stale cached shelf, can never eat a filter. **No optimistic update**: the
   server's answer is applied, so there is nothing to roll back.
5. **Overruled: tag names in the URL** (Sol 5). The shelf already puts the reader's search words
   (`?q=`) and topic keys (phrases from their private articles) in the URL; a tag is the same class
   of text, in the reader's own address bar. `GET /api/library/tags` sends
   `Cache-Control: private, no-store`, as the terms route does.
6. **Export is in scope** (Sol 6): `ARTICLE_TABLE_COVERAGE`, `readArticleRows`, the bundle, the
   rollback export or a written omission, export.md.
7. **The shelf owns the write** (Sol 7): a `setTags` on `useShelf` applies the answer to both arrays
   (and archived overlays, like `rename`); a successful tag write invalidates the cached `/api/library`
   and `/api/metadata/:slug`; `cached-shelf.ts` treats a missing `tags` as `[]`.
8. **One client function, `editArticleTags(slug, change)`** (Sol 9), which the editor and the later
   confirmed command both call. The command stays a proposed write.

## Progress

**Stage 1 (server) — done.** `article_tags` (migration `20261003035927_article_tags`), `src/tags.ts`,
`src/store/pg-tags.ts` (+ the leaf `tag-rows.ts`, so pg.ts and pg-tags.ts do not import each other),
both routes, `LibraryEntry.tags`, `ArticleMetadata.tags`, both exports. What was learnt:

- **The first two versions of the cap race test stayed green with `for update` deleted.** Firing two
  edits with `Promise.all` let them run one after the other. Holding the row `for update` in the
  test did not discriminate either: the edit's own insert takes the foreign key's key-share lock on
  the article, which waits on `for update` with or without the edit's lock. The version that goes red
  without the lock has the competitor *insert* a tag and hold its transaction open — only a key-share
  lock, which an unlocked edit passes straight through. Watched red, then green.
- `store-shelf-pg`'s delete test enumerates every foreign key to `articles` and needed a seed row; the
  export coverage test's types refused to compile until `article_tags` had a fixture. Both are guards
  that did their job.
- JS `\s` does not include U+0085 (NEL); it is refused as a C1 control rather than collapsed.

**Stage 2 (editor) — done.** `TagEditor.tsx` (one combobox for both places), `ShelfTags.tsx` (chips +
a popover on the card and at the end of the table row's sub-line), `useShelf.editTags`, Metadata's
inline editor, `article-tags.ts` as the one client write. Changed from the plan:

- **The Tags control sits beside the chips, not in the action row.** The action row has
  reveal-then-commit tips and a narrow-screen menu; a sixth button there costs all of that. With no
  tags it shows on hover/focus (always on touch), as the action row does.
- **In the table, tags go at the end of the always-present sub-line**, not a new line, so untagged
  rows keep their height.
- **No highlight until the reader types or uses the arrows**, so Enter in a freshly focused empty
  box does not add the first suggestion — found writing the "empty Enter" test.

**Stage 3 (filter) — done.** `ShelfTagFilter.tsx` above Topics, `?tags=`, `tagFacets` in
shelf-narrow.ts feeding the same `topicMembers` / `withTopics` / `topicCountsForVisible`, so a tag and
a topic narrow by one AND and every chip in both rows counts the same visible set. Changed from the
plan: **each row has its own Clear** rather than one Clear for both — it is the row the reader is
looking at, and it needs nothing shared between two components. The "nothing left" sentence names
tags when they did it.

