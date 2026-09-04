# Let me archive an article, and maybe delete one

**[SPIDERYARN-READING2-19](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-19)** · reported
2026-09-04 17:22 UTC · resolved 2026-09-04 · *archive was already there and the label lied; delete
deferred with a plan*

## What the reader said

> I want to be able to "archive" an article, from Homepage shelf and article Metadata. This should be
> easy to reverse, and by default the Homepage shelf shouldn't show archived articles. Maybe there
> should also be a way to permanently delete an article in Metadata with confirmation UI that also
> offers to just archive instead.

## The finding

**Every word of the first three sentences already worked.** `articles.archived_at`, a PATCH route, a
shelf that hides archived articles by default, a library search that excludes them, a 9-second Undo
strip, a "Show deleted" disclosure, and a never-expiring "Put back" on the metadata page. It was
**Greg's own decision on 2026-08-26**, and `library.md` quotes him making it.

He could not tell, because the button said **Delete**:

```
<IconButton label="Delete" onClick={() => void shelf.archive(entry.slug)} destructive>
```

So he asked for a feature he already had. **The bug was the word**, and that is the whole lesson —
`library.md`'s section used to be called "Delete means archive", which is a doc explaining away an
interface that lies rather than a note about one that tells the truth.

## What shipped

The word, everywhere a reader meets it: the shelf button and its Undo strip, the metadata section and
its status line, "Show deleted" → "Show archived", "Nothing deleted." → "Nothing archived.", and the
`DeleteArticle` component renamed with it.

Three changes beyond the literal rename, all deliberate:

- **The bin icon went.** A trash can says "delete" as loudly as the word does; both buttons now use
  lucide `Archive`.
- **The destructive red went**, because red in this app means *this cannot be undone* and
  `AccessSharing.tsx` explicitly reserves it that way.
- **`IconButton`'s `destructive` prop went with it**, having lost its only caller — and the comment
  in `AccessSharing.tsx` claiming the red belonged to "the one control here that loses work" was
  corrected. A cross-family review confirmed this was right rather than over-eager: the app-wide
  shadcn `Button` still has its destructive variant, so no design capability was lost.

**And one behaviour change the review asked for**: an archived article now **leaves the public
listing**. `publicLibraryQuery` filtered on visibility and readability but not `archived_at`, so an
owner could lose sight of an article on their own shelf while strangers could still discover it —
a poor privacy asymmetry. `publicSlug` is deliberately untouched, which draws the line cleanly:
**visibility controls whether the link works; archiving controls listings.**

`PrivacyPage.tsx` is a published page and said *"The Delete button on your shelf is really an
archive… under 'show deleted'"* — circular after the rename. Rewritten, checked sentence by sentence
against the code, and it now says what happens to an already-shared article.

## Permanent deletion: deferred, and here is the shape it should take

It would be **the first irreversible act on a reader's own data in this product**. The store is
built the other way round — `schema.ts` says *"Never a delete; Greg chose archive + Undo"* — so this
needs its own plan and its own review, not a rider on a rename.

Four failure modes that actually exist here:

- **A mis-tap.** The shelf's buttons are hover-revealed and adjacent, and on a phone they are all tap
  targets. Archive-with-Undo tolerates that; delete does not.
- **A public link dies.** Sharing is `visibility = public`; archive deliberately keeps such a link
  working, and delete would not.
- **An in-flight job.** Every FK to `articles` declares an `onDelete`, so the database will *not*
  refuse a delete mid-job — the job's next write lands on a null article or a cascaded-away revision.
  That needs a "refuse while a job is active" query, which is not a constraint.
- **Storage objects.** Raw sources are content-addressed and referenced by hash, **possibly by other
  articles and other owners**, so bucket objects must not be deleted with the article. Orphans are
  the safe failure; cross-owner deletion is the unsafe one.

**The recommended shape is better than what was asked for.** Delete lives *only* on the metadata
page, and *only* for an article that is already archived — so "offer to just archive instead" becomes
structural rather than a second button in a modal: the gentler path has already been taken, and a
shelf mis-tap can never reach it. The confirmation names what goes and what does not (the billing
slot is not refunded), and carries a link to `GET /api/export/:slug` — turning an irreversible act
into a recoverable one.

Two questions in it are Greg's, not ours: **hard-delete, or `deleted_at` with a 30-day purge** (the
boring option, and the same shape as `archived_at`); and **what a public link to a deleted article
should do**.
