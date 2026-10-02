# Glossary: add a term the reader looked up

Up: [plans.md](../project/plans.md) · area: [glossary.md](../project/glossary.md)

Report `spya-j5bsp7` (2026-09-04), the half that was deferred. Session
`fbj5bsp7-glossary-add-looked-up-term`, Overseer queue item `qi-43aa3nac`.

> I would like to be able to type into a search box in the glossary for a particular term and for it
> to um uh look for that term and add it to the glossary. And maybe it should be a tiny bit robust in
> the spelling or something if I type it wrong.
>
> — Greg, 2026-09-04 (spya-j5bsp7)

The **Look up a term** box shipped on 2026-09-04 and stores nothing
([260904_1301](../user-feedback/260904_1301-glossary-search-box-for-a-term.md)). That note deferred
"add it" for three reasons. This plan answers each one:

| The 260904 reason | What answers it here |
|---|---|
| The glossary is one JSON document | An added term is **not in the document**. It is a row in a new owner-scoped table, attached at the owner's read seam (`loadGlossary`), the way `lookup` and, since 261002c, `hidden` are. |
| *Find more terms* recomputes and merges | It merges the document, and the added term is not in it, so *Find more* cannot touch it. |
| A shared link publishes the whole glossary blob | The public read (src/store/public-reader.ts) reads `articleRevisions.glossary` and never calls `loadGlossary`, so it never sees the row. **Added terms are the owner's own, like hides.** This keeps the promise as it is; no public projection changes. |

The robustness half ("a tiny bit robust in the spelling") stays as 260904 decided: case, plurals,
possessives and now hyphens (261002c), and no fuzzy matching.

## What the reader sees

1. They type *attention head* into **Look up a term** and press the button, exactly as today.
2. The answer streams in, exactly as today.
3. When it finishes, **the term is in the list**: a new row, marked *added by you*, whose
   explanation is the answer they just read, and whose underlines now appear in the prose. The
   band selects that row (`?term=` the new id), and the separate answer panel under the box closes,
   because the answer now lives in the row.
4. If the term is already in the glossary (it matches an entry's name or alias under the same
   matcher), nothing is added. The answer still shows under the box with *Already in the list* and
   a jump to that entry. If that entry is one the reader hid, the line says it is in **Hidden** and
   offers *Unhide*.
5. To get rid of an added term: the same trash-can **Hide** every row has (261002c). It goes into
   **Hidden (n)**, and *Unhide* brings it back.

The hint under the box changes from *"Not added to the list"* to *"Added to your list. Only you see
it."*

### Adding on every look-up, not a separate *Add* button — the choice, named

**Chosen: every finished look-up adds.** Greg's words are *"look for that term and add it to the
glossary"*, one action. The trash can is the undo.

**Passed over: an *Add to glossary* button under the answer.** The button would have to store an
answer the server has already sent and forgotten. Either the client sends the answer text back,
and the server stores words labelled "the model's answer" that it cannot vouch for, or the server
holds every answer somewhere pending, which is a second store with an expiry. Both are more parts
for one extra click. If readers find the auto-add noisy, the button is the later change, and the
storage below does not change for it.

## Storage

```
spideryarn.glossary_added_entries
  article_id  uuid  → articles(id) on delete cascade
  entry_id    text  check: spya id format          (minted by mintId)
  name        text  not null, 1..80 chars          (MAX_ASKED_TERM, the box's own bound)
  primary key (article_id, entry_id)
  unique (article_id, lower(name))                 (two tabs adding the same term make one row)
```

**The explanation is not in this table.** It goes in the existing `glossary_lookups` under the new
entry id: that table is already "the answer about one entry, from `explain`", with the same four
fields, and `loadGlossary` already attaches it as `entry.lookup`. So the panel draws an added
term's explanation with the component it already uses for *Dig deeper*, and *Dig deeper again*
works on an added term for free (it upserts the same row).

**Why a new table and not the hide table.** The brief says to reuse 261002c's per-reader state
rather than build a second store. What is reused is everything around the table: the owner-only
seam in `loadGlossary`, `articleIdForOwned`, the `GlossaryHiddenStore` shape for the store, the
`hidden` filter, the trash can and the Hidden section, and the export beside reading time.
`glossary_hidden_entries` itself holds only `(article_id, entry_id)`. An added term needs a name,
so it would need a new nullable column whose presence changes what a row means ("hidden" vs
"added"), which is two kinds of row in one table. That is the braided option, so it is not taken.

**`name` is what the reader typed, normalised** (`parseAskedTerm`'s output). It is stored, and so
is the answer: it is the reader's own data, on their own article, readable only through the
owner's seam, and exported with the article. Neither appears in a log line.

## The write

At the end of `makeAskAboutTerm`'s stream, after `refuseUnfinished` and before `done` is yielded,
one store call does both inserts **in one transaction**:

```
addedStore.add(slug, { name, lookup })
  → { added: entryId }                       new row + glossary_lookups row
  | { existing: entryId, hidden: boolean }   a current entry already matches; nothing written
  | { noGlossary: true }                     the article has no glossary yet; nothing written
```

`existing` is decided against the owner's current list: the stored entries **plus** the added
ones, each tested with `anchorIn`'s patterns (`patternsFor` in src/term-lookup.ts) against the
found quote, so "already there" means "the underline the reader sees would already mark these
words". The check runs inside `add`, after the answer, so it sees the list as it is at write time.
A race between two tabs lands on the unique index and the loser returns `existing`.

`done` gains that result: `AskedTermAnswer` gets `added: { entryId } | { existing: entryId, hidden:
boolean } | { notAdded: "no-glossary" }`. A write that **throws** throws the stream, as a failed
explain does today. It does not yield a `done` that says nothing was saved. The client already
treats a stream with no `done` as a failure and shows the error.

## The read

`loadGlossary` (src/store/pg.ts) selects `glossary_added_entries` in the same `Promise.all` as the
lookups and the hides. Each row becomes a `GlossaryEntry`:

```
{ id, name, kind: "term", aliases: [], added: true, blocks: (relocated), lookup?: (attached) }
```

No `senseHere`, no `background`, no scores. Unscored entries always survive the threshold
(`applyThreshold`), so an added term is never gated away. They are appended to the stored entries,
and `relocateEntries` gives them `blocks` against the current text exactly like the rest, then
everything is put in document order with `inDocumentOrder`.

**If a later *Find more* adds the same term**, the model's entry and the reader's would both
underline the same words. On read, an added row whose name is matched by a stored entry's patterns
is **left out of the view** (the row stays in the table, harmless). The model's entry wins
because it has `senseHere` and `background`. If the reader's lookup was the only explanation, it
is not lost from the database, only from view. Moving it onto the model's entry is deferred,
below.

`hide` (src/store/pg-glossary-hidden.ts) refuses ids that are not in the current glossary. Its
`present` check becomes "in the stored entries **or** in `glossary_added_entries` for this
article", so the trash can works on an added term.

## Types and the client

- `GlossaryEntry.added?: true`, documented like `hidden`: attached at the read seam, never stored
  on the blob, never on the public DTO (src/public/dto.ts copies field by field; a test confirms).
- `AskATerm` (src/web/GlossaryPanel.tsx): on `done` with `added`, call the read's `refresh()`,
  then open the new term and clear the asked answer. On `existing`, keep the answer, and show
  *Already in the list*, with a jump or, if hidden, *Unhide*. On `notAdded`, keep today's look.
- The row shows a small *added by you* label where the kind icon's label goes. No new control.

## Who

The owner, on their own article. Same as hide. A visitor on a public article has no box, so
nothing changes for them.

## Not changed

- **The public projection.** The public read never sees an added term, and the hint says *Only
  you see it.*
- **Security.** `askAboutTerm` still settles ownership before anything else, and the new write is
  behind `articleIdForOwned`. What the client can send is still only a term. No defence in
  [security-map.md](../project/security-map.md) moves.
- **Spend.** Same single explain call as today. The missing rate limit that 260904 raised for
  Greg is unchanged, and still Greg's.

## Deferred, by name

- **Publishing an added term with a shared article.** It would need a decision about the public
  projection. Today an added term is private.
- **Moving the reader's explanation onto the model's entry** when *Find more* later finds the same
  term. Today the reader's row is left out of the view.
- **A separate *Add* button**, if auto-add turns out to be noisy (see above).
- **Fuzzy matching / "did you mean"**: still declined, for 260904's reasons.
- **Removing an added term outright**, as opposed to hiding it. Hide plus Unhide covers the undo.

## Stages

1. **Store and read.** Migration, schema, `pgGlossaryAddedStore.add` (the transaction and the
   `existing` check), the `loadGlossary` attach and dedup, the `hide` presence check, export.
   Failing tests first: pg round-trip (add → `loadGlossary` shows it with `added`, `lookup` and
   `blocks`); the public read does not show it; a model entry with the same name hides it; hiding
   an added id works; export includes the table.
2. **The ask writes.** `makeAskAboutTerm` gets the store as a dependency and `done` carries the
   result. Tests with the existing fake `explainStream`: added, existing, existing-and-hidden,
   no glossary, and a write that throws produces no `done`.
3. **Client.** `AskATerm` handles the three results, the row label, the hint text. Browser check
   (Sonnet subagent): add a term, see the row and the underline, hide it, unhide it, add an
   existing term.
4. Docs (glossary.md § Looking a term up), GPT Sol code review, feedback note.

## Reviews

- Plan: GPT Sol, read-only (below once returned).
- Code: GPT Sol, workspace-write.

## Revised after GPT Sol's plan review

[261002f-glossary-add-plan-review-sol.md](261002f-glossary-add-plan-review-sol.md) (exit 0, answer
file fresh, 2026-10-02 18:00). Verdict *revise then build*. Every finding checked against the code;
this list supersedes the plan above where they disagree.

1. **No new table: a nullable `added_name` column on `glossary_lookups`.** Sol's simpler option,
   taken. Every added term has exactly one finished explanation, and that table is already outside
   the blob, untouched by *Find more* (nothing deletes from it; `pg-lookups.ts`'s upsert sets only
   the answer columns, so *Dig deeper again* keeps the name), and absent from the public read. One
   additive column, one insert, no second export file. A row with `added_name` is "the reader
   added this term, and here is its explanation"; a row without one is "the explanation of a
   model entry", as today. Length check 1..80.
2. **Ids and races.** The write runs in one transaction that first locks the article row
   (`select … for update`), then reads the current revision's entry ids and every lookup row,
   decides *existing* against all of them, and mints with `mintUniqueId` over **all** of those ids.
   So two tabs adding *attention head* and *attention heads* serialise, and the second sees the
   first.
3. **What `add` takes:** `{ name, quote, lookup }`. "Already there" means: some entry's name or
   alias (stored, or added) matches **the whole quote** under `termPattern`. That uses the shared
   matcher (src/term-match.ts) rather than `term-lookup.ts`'s private `patternsFor`. A revision
   published during the model call is accepted: the term is relocated on every read anyway.
   `owner_id` is stamped with `currentOwnerId()` as `pg-lookups.ts` does.
4. **Types.** `AskedTermFound` gets its own explicit shape, not `Omit<AskedTermAnswer, …>`, and so
   does the client draft. `AskedTermAnswer` gains a required `added: AddedTerm`, a three-arm union.
   The client validates every arm, and checks ids with `isSpideryarnId`, before using one. The
   selection goes through the panel's existing `onTerm`.
5. **Dedup after a later *Find more*.** When a model entry matches an added term, the added one is
   left out of the view and **its state moves to the winner at the read seam**: if it was hidden, so
   is the model entry; if the model entry has no lookup, it shows the reader's. This is a lookup
   from suppressed id to winning id, in `loadGlossary`. On the client, after `refresh()`, the band
   selects the returned id only if it is in the list; otherwise the answer stays under the box.
6. **Export:** the column rides in the existing `glossary_lookups` export in both projections
   (`export.ts`, `export-bundle.ts`), and the sentinel fixture in
   `tests/store-export-covers-tables.test.ts` gets the column.
7. **Chat's glossary tool** shows the lookup's answer for an entry that has no `senseHere`,
   `background` or `gloss` (an added term). **Skim on a stale list** still drops the whole glossary;
   accepted, since that rule is about the model's list and changing it is a separate decision.
8. **Copy:** the promise is in the button's tooltip now, not a hint line. It becomes *"Finds these
   words in the article, explains the passage they are in, and adds the term to your glossary,
   only for you. One model call."* The no-glossary arm says *Not added: this article has no
   glossary yet* under the answer.
9. **Hide on an added term:** `hide`'s presence check also accepts an id with an `added_name`
   lookup row for this article.

Tests added to the stages: id collision with a blob id; concurrent equivalent adds; each finished
arm and a malformed id on the client; refresh → select → clear; Dig deeper on an added term; hide
after a later model entry matches; the chat tool; both export projections; a non-owner cannot
write; a public read with an added row reveals nothing; the no-glossary arm.

## What landed

Built as revised above, with one more change while building: **a hide does not follow an absorbed
added term** to the model entry that later names it, because *Unhide* on that entry would then
clear the wrong row. Only the explanation follows. Chat sees an added term's name and a note, not
its answer.

- The first concurrency test raced two adds with `Promise.all` and **passed with the lock deleted**,
  three runs in three. It was rewritten to hold the article row in a second transaction; that
  version goes red without the lock. The read seam and the client's refresh and id validation were
  each broken on purpose and seen to go red.
- GPT Sol's code review ([261002f-glossary-add-code-review-sol.md](261002f-glossary-add-code-review-sol.md),
  exit 0, answer fresh, 2026-10-02 18:40): approve with fixes. It fixed a real bug, a rollback
  restore that dropped `addedName`, added the edge-case tests its plan review had asked for, and
  corrected the comments that still said "nothing is stored". Its Postgres tests could not reach the
  database from its sandbox; they were run afterwards and pass.
- Browser check (Sonnet subagent, Playwright on the box, `fowler-phrenology`, three real model
  calls): add, already-there with *Show it*, hide and unhide, reload, and a 390px row all pass. It
  found that the hover card labelled every stored answer *checked on the web*, including the many
  that ran no search, while the band said *no web search*. That mislabel was older than this work,
  but every added term now carries a stored answer. Fixed in `ProseHoverCard.tsx`, with a test seen
  red first.
- **Deferred, found by the browser check:** "already there" is decided after the model has answered,
  so looking up a term the list already has still pays for one call. Checking the list before the
  call would save it, at the cost of a second read in `askAboutTerm`.
