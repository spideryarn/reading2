# Opening an archived article puts it back on the shelf

Report spya-h8cda9 (#743, SPIDERYARN-READING2-QD), from Greg, an admin:

> I open an archived article. It should unarchive it. I just opened What Is It Like to Be a Bat, but
> I'm still not seeing it at the top of my shelf, so I'm assuming that that's the problem. But I
> don't know, maybe it's something else.
>
> — Greg, 2026-10-30

## What was actually wrong

It was the archive, not the sort. Read-only, in production, 2026-10-30:

- `nagel-bat`: `archived_at` 2026-10-11T09:12:47Z, `last_opened_at` 2026-10-30T19:23:19Z (the
  minute of the report), `opens` 36.
- Greg's most recently opened *unarchived* article was opened at 08:37 that morning, so on the
  default **Last opened** sort nagel-bat would have been first had it been on the shelf.

So the open was recorded and the article stayed archived, which is what the code did by design:
`recordOpen` (src/store/pg-shelf.ts) bumps `opens` and `last_opened_at` and nothing else, and
docs/project/library.md said *"An archived article is still readable by direct link. Only the shelf
filters."* Greg is the admin and says opening should unarchive it.

## The change

**Server, the one rule.** `recordOpen`'s existing UPDATE also sets `archived_at = null`, and moves
`updated_at` (`clock_timestamp()`) only when `archived_at` was set — the same "a reader-settings
change moves it, a re-statement does not" rule `patch` keeps (schema.ts § `updatedAt`). One
statement, so the open and the un-archive cannot disagree.

**Server, and the public shelf.** `recordOpen` now returns `{ restored }` — it locks and reads the
row first, because RETURNING sees only the new one — and the open route calls
`refreshPublicShelfTopics` when it is true, as share, archive and delete already do: putting a
shared article back lists it on `/read/public` again.

**Client: the open goes through `useArchive`.** `OwnedArticle` mounts once the owner's
`GET /api/article/:slug` has answered, and only then sends `POST …/open`, so the payload it was drawn
from can say *archived* about an article the open has just put back. It tells `useArchive` whether
this owner-page mount should send the open (not in *view as*); the hook starts it in a layout effect,
before an Archive button can be pressed, and:

- on 2xx, records *on the shelf*;
- on a failure, re-reads `/api/metadata/:slug`, and says it does not know if that fails too — a lost
  response is not proof nothing was written, the rule `set` already keeps;
- makes `set` **wait for the open to settle** before sending its PATCH, so an Archive pressed while a
  slow open is out cannot have the open's UPDATE land second and undo it. Starting it in the layout
  effect also closes the smaller window before an ordinary passive effect would have run; in *view
  as* no open is expected and `set` has no nonexistent request to wait for. No `busy` during the
  open, so the masthead button does not dim on every page load; a press during it shows busy and waits.

### Revised after GPT Sol's plan review

The first draft had the open stay a bare `apiFetch` in `OwnedArticle` with an `opened()` hint into the
hook. Sol found two real races in that (Archive vs a slow open; a failed open that had in fact
committed) and the missed public-topics refresh — all three fixed above. It also called consequence
2 below a product decision rather than a note. Kept as is, because the masthead's own tooltip
already tells the owner *"Putting it back lists it publicly again"*, and opening is now a way of
putting it back; flagged to Greg in the feedback note.

### Who it applies to — each case from the brief

| Opened by | What happens | Why |
| --- | --- | --- |
| The owner, from the shelf | unarchived | the case reported |
| The owner, from the **Include archived** list | unarchived; the card loses its *Archived* mark when the shelf is next read | opening is the act; the list is just how they found it |
| The owner, by a public or private link to their own article | unarchived | the owner's page is `OwnedArticle` whichever URL got them there, and it is still them opening it |
| Anyone who is not the owner (a visitor on a public or private link, signed in or not) | nothing | `recordOpen` is not called for them (the POST is only in `OwnedArticle`), and if it were it is scoped by `ownedSlug` and 404s |
| An admin using *view as* | nothing | `viewAsNonce()` already skips the open POST |
| An MCP agent or chat reading the article | nothing | neither records an open |

### Consequences worth knowing, accepted rather than missed

1. **Archive from the masthead, then reload, and it is back.** The masthead's Archive leaves you on
   the page; a reload is a fresh open. That follows from the rule as Greg stated it, and the shelf's
   Archive (where nearly all archiving happens) leaves the page, so it does not arise there.
2. **A public article archived to take it off `/read/public` goes back on when its owner opens it**,
   since `publicLibraryQuery` filters on `archived_at is null` (library.md § Archive). Same rule;
   noted in library.md so it is not a surprise.
3. The shelf's IndexedDB head-start paint can show the card archived for the moment the live read
   takes. Already the accepted price of that cache (cached-shelf.ts).

## Simpler options passed over

- **Client-only: if the payload says archived, call `archive.set(false)` on mount.** Two requests
  instead of one statement, a visible *Archived* flash, and the rule would live in one page rather than
  in the act of opening. Rejected.
- **Un-archive inside `GET /api/article/:slug`.** A GET that writes is exactly what the open POST was
  split out to avoid (prefetches, retries). Rejected.
- **Server only, ignore the stale masthead.** Smaller, but leaves the page offering *Put back* on an
  article that is not archived, which useArchive's own comments call the thing to get right.

## Tests

- tests/store-shelf-pg.test.ts: an archived article opened is unarchived, `updated_at` moves then and
  not on a second open. Written first and watched red (`expected '2026-10-30T…' to be undefined`).
- tests/open-unarchives.test.tsx: after the open the page says *on the shelf* over an archived
  payload; an Archive pressed during the open waits for it; a failed open re-reads; a failed re-read
  is unknown; StrictMode sends one open; *view as* waits for none.
- tests/public-shelf-topics-pg.test.ts: the open route puts a shared archived article back into the
  public topics. Watched red with the refresh call disabled.

## Docs

library.md § Archive: replace "still readable by direct link. Only the shelf filters" with the new
rule, quoting Greg, and the `updated_at` sentence; schema.ts § `updatedAt`; contracts.ts's
`recordOpen`; the open route.
