# Archiving leaves a public article on the public list

Greg's reply `spya-zyh56c` (2026-10-31) to [q-d4586t](../user-feedback/questions/q-d4586t.md), about
report `spya-h8cda9` ([the note](../user-feedback/261030_1923-opening-an-archived-article-puts-it-back.md)).
Overseer queue item qi-8bk39fwe.

> Oh wait, this is an important point. If I archive an article, to me that just signals it's not
> something I'm actively reading right now. It doesn't mean I'm deleting it.
>
> And so archiving it shouldn't take it off the public list. You know, if the article's public, it
> stays public the whole time.
>
> Archiving just means it's not top of my mind. And that's why if I open it, I think implicitly I'm
> saying, well, maybe this is now relevant to me, or it's become, you know, something that I'm
> thinking about. And I might want to open it again soon, and therefore I want it to be readily
> available.
>
> — Greg, 2026-10-31

## What changes

**Archiving is a property of one person's shelf and nothing else.** Whether strangers can find a
shared article is sharing's alone: share puts it on `/read/public`, un-share takes it off, archive
and Put back (and an open, which un-archives — plan
[261030f](261030f-opening-an-archived-article-puts-it-back-on-the-shelf.md), kept) leave the public
side untouched.

1. **The listing** — `publicLibraryQuery` (`src/store/public-library.ts`) drops
   `archived_at is null`. Its header and the clause's comment change with it.
2. **The other two places a stranger's public article is found by anonymous-shaped reads** —
   `citedCandidatesQuery` (`src/store/pg-cited-in-spideryarn.ts`), which feeds Bibliography's
   "in Spideryarn" links and the import-time public-copy offer (`src/public-copy.ts`), excludes a
   stranger's archived public article for the same reason (plan 261001i). "Public the whole time"
   means the same on every surface, so the stranger branch drops `isNull(archivedAt)` too. **Its
   `archived` output must then stay owner-only**: today it is "only ever true for the reader's own"
   because the `where` admits no stranger's archived row; after the change it becomes
   `mine and archived_at is not null`, so a stranger's archive state is never read out.
3. **Topic pills stop refreshing on archive, Put back and open.** They no longer move anything on
   or off `/read/public`, so `PATCH /api/library/:slug` (rename, purpose, archive) no longer
   refreshes them, and `POST /api/library/:slug/open` no longer calls
   `refreshPublicShelfTopics`. `recordOpen`'s `{ restored }` return exists only for that call, so it
   goes back to `void`. Share, un-share and delete keep their refresh.
4. **Words that promise the old rule** — the masthead sharing mark's two archive-aware states
   (`SHARING_MARK_ON_ARCHIVED`, `SHARING_MARK_ON_ARCHIVE_UNKNOWN`) go: a shared article is "listed
   publicly" whether or not it is archived, so the mark is `SHARING_ON` whenever sharing is on, and
   the masthead no longer needs the archive state for the mark. The masthead Archive button's
   "how" line for a shared article, the shelf card's Archive tooltips (`ShelfEntry.tsx`), PaperCard,
   and the privacy page line that says archiving stops public listing are rewritten to say it stays
   listed while shared.
5. **Docs** — library.md § archived/public (the "one place the shelf rule bends" paragraph is
   replaced with Greg's quote and the new rule), public-shelf.md (the "shared and absent" list and
   the topic-refresh triggers), security-map.md line on the coordinator's triggers, privacy.md if it
   restates it, and the h8cda9 note's second consequence.

## Does this touch a defence?

Checked against [security-map.md](../project/security-map.md#the-unauthenticated-namespace-and-the-tripwire-under-it).
The listing's defence is that **only what an owner explicitly shared is listed** (`visibility =
'public'`, the readability bar, the closed query with no owner in its import graph, the row/byte/work
ceilings). None of that moves. The archive clause was a product choice — GPT Sol's 2026-09-04
argument that an owner should not lose sight of a piece strangers still find — and Greg has now
decided the other way, accepting exactly that consequence: archived articles are still yours, and
still on the shelf behind Include archived. The direct link already ignored `archived_at`
(`publicSlug`), so no new reader can reach anything they could not already read. The one real
privacy edge is item 2's `archived` column, handled there. So: not a weakening of a defence; built
rather than left for Greg.

## What it gives up, and the simpler option passed over

- **There is no longer a way to keep reading a public article while hiding it from the public
  list**, short of un-sharing it. That is what option B in q-d4586t offered and Greg declined.
- **Simpler option passed over: change only the listing query** and leave Bibliography and the
  public-copy offer excluding strangers' archived articles. Smaller diff, but "public" would then
  mean two things depending on the surface — listed on `/read/public` and yet invisible to the
  import offer — which is the inconsistency Greg's "stays public the whole time" rules out.
- **Existing rows**: articles that are public and archived today reappear on `/read/public` on
  deploy. That is the rule as Greg stated it; the count goes in the report (read-only query).

## Tests (written first, watched red)

- `tests/public-visibility-pg.test.ts` or the nearest listing test: a public, archived article is
  listed. `tests/owner-isolation.test.ts` § the archived case flips; its SQL pin loses the clause.
- `tests/cited-in-spideryarn-pg.test.ts`: the stranger's public archived row is a candidate, with
  `archived: false`; SQL pins in it and `cited-in-spideryarn-sql.test.ts` updated.
- `tests/public-shelf-topics-pg.test.ts`: archive and Put back no longer trigger a rebuild; delete
  still does.
- `tests/masthead-sharing-mark.test.tsx`, `tests/paper-card.test.ts`: shared + archived reads
  `SHARING_ON`.
- `tests/store-shelf-pg.test.ts`: `recordOpen` still un-archives (return value gone).

## Reviews

GPT Sol on this plan (read-only), then on the code before pushing.

## After the plan review (GPT Sol, verdict "proceed with changes")

[The review](261031c-archiving-leaves-a-public-article-on-the-public-list-plan-review-sol.md). Each
finding checked:

1. **Include public would call your own archived shared article somebody else's** — right, and the
   biggest catch. `ownSlugs` held the archive only once it was loaded, which happened only with
   Include archived on. Now the shelf loads the archive whenever the public listing is wanted
   (Include public, or the count beside a search), reads the listing only once both the live shelf
   and the archive are in (`ownKnown`, `src/web/Library.tsx`), and if the archive fails the section
   says why with a Try again rather than guessing (`ShelfPublicSection.tsx`). Tests in
   `tests/shelf-include-public.test.tsx`, watched red with the gate removed.
2. **The public topic pills need one rebuild after deploy** — right. Production, read-only on
   2026-10-31: **17 articles are public and archived (all readable), against 2 listed now**, so the
   list goes from 2 to 19 on deploy. All 17 are one owner's: the owner of `nagel-bat`, Greg. Nothing
   triggers a rebuild once archive stops doing so, and pills start at 8 cards, so **after the
   deploy press Rebuild on `/admin`** (about 0.1 of a cent at 19 cards). Written into the deploy
   notes rather than code: a one-off, and the listing request must never spend.
3. **`tests/masthead-archive-mark.test.tsx` pinned the old words** — fixed, including its
   "unknown sharing" case: archiving changes nothing public either way, so the plain line is true.
4. **The cost eval's copy of the listing predicate, a stale test title and a comment** — fixed.
5. **`recordOpen` can be one UPDATE** — done: no locked read, `updated_at` moves via a `case` on the
   old row, returns nothing.
6. **Security reasoning holds** — agreed; the `archived` flag on cited candidates is owner-only.
