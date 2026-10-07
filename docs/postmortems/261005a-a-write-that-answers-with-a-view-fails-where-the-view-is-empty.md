# A write that answers with a view fails where the view is empty

Parent: [postmortems.md](../project/postmortems.md). Found 2026-10-05 by the browser check of
[plan 261004l](../plans/261004l-the-add-page-purpose-box-saves-as-you-type.md), before it reached
`dev`. Nobody outside the worktree saw it.

## What happened

The add page began saving *why you are reading this* while the import runs. On four of four fresh
imports the first `PATCH /api/library/<slug> { purpose }` wrote `articles.purpose` and then answered

```
404 {"error":"No shelf entry for <slug> after writing — is it a complete article?"}
```

The box said *Not saved* over words that were in the column. It did not retry (a refusal is not
retried), so the page sat at *Ready* with an error. A reader who then cleared the box sent nothing,
because the page believed nothing was stored, and the first modes were written for a sentence the
box no longer showed.

## The real cause

`ShelfStore.patch` does its `UPDATE` and then builds its return value, the shelf card, by calling
`listArticles` and finding the slug in it (`entryFor`, `src/store/pg-shelf.ts`). `listArticles` lists
articles with a published revision. An article mid-import has a row and no published revision, so
the write succeeded and the answer could not be built, and `entryFor` threw.

That throw was reasonable when it was written: every caller then patched an article the reader was
looking at on the shelf, so "no card after a write" really was a broken article. The purpose box on
the add page is the first caller to write to an article before it is published. The route did not
change. The state it was called in did.

Every test of the new page mocked `apiFetch`, with a `PATCH` that answers 200. So the page's tests,
the class's tests, typecheck and two rounds of cross-family review of the page all agreed, and all
shared the assumption that the route answers 200 when it has written.

## The class

**A write whose answer is read back through a view narrower than the write.** The write accepts
every row; the answer exists only for rows the view shows. In the gap between them the request
changes the data and reports failure, which is the combination `patchShelf`'s own comment calls the
worst available. It stays invisible for as long as every caller happens to live inside the view.

Its near relation, which is how it got through: **a new caller reaching an old route in a state it
was never called in**, tested against a stand-in for the route.

## Introduced by

`f862af5e8`, 2026-08-26, *Give the shelf hands, and one box to search every article*: `entryFor`
and its throw. Latent until 57fa1e553 (2026-10-05) added a caller for an unpublished article.

## The fix

Shipped, and the one that is right: `ShelfStore.patch` returns `LibraryEntry | null`. `null` means
*written, and not on the shelf yet*. The type makes each caller say what it does with no card; the
route passes it through, and the purpose's callers read only `purpose`. A slug with no row still
rejects with not-found, from the `UPDATE` matching nothing. Red first:
`tests/store-shelf-pg.test.ts`, *stores a purpose on an article that is still being imported*.

Not done: a separate purpose-only route. One route for the shelf record is the existing design and
the null answer is enough.

## What would have caught it, ranked by ease against value

1. **When a change calls an existing route in a state it has not been called in before, run the
   real route in that state once.** Here: one Postgres test with a bare `articles` row. Ten lines,
   and it is what the fix's test now is. A habit, and the plan for 261004l said outright that the
   page would write "before the row is published" without anyone asking what the route does then.
2. **The browser check on a real stack.** It is what caught this. It is already the house rule for
   anything with a UI; this is a case for not skipping it when the unit tests are thorough.
3. **Ask the reviewer about the far side of the seam.** The code review was pointed at the page and
   the session class. One line in the prompt, "the page now PATCHes an article that is not
   published; read the route and the store for that state", costs nothing. Done from now on for a
   new caller of an old route.
4. A lint or type rule that a store write may not build its answer from a list query: rejected.
   There are a handful of such writes, the rule would be hard to state mechanically, and the
   nullable return type already says it where it matters.
