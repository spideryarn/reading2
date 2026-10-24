# Move Greg's bookmarks and reading time onto the re-read Order of Time

Greg's answer to [q-xns4gt](../user-feedback/questions/q-xns4gt.md), reply `spya-zhgwnd`,
2026-10-23:

> A Yes, update if possible. Fix anything that you can if it's not too complicated. But if stuff
> breaks, then just remove it. I'm not super fussed about preserving everything.

The one production write it authorises: Greg's own `comments` and `reading_time` rows on
`rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug`, moved from block ids the re-read
of [261023c](261023c-re-read-the-order-of-time-from-its-pdf-in-production.md) re-minted to the
ids that now hold the same words. Report `spya-rg5kk6`. Nothing else in production. The general
fix, keeping ids across a re-read, is `qi-gw4kwnea` and is not built here.

## What is there now

Read-only, production, 2026-10-24. The article is Greg's (`owner_id` 001bb7a0…), current
revision `0d152e52` (the matter and labels successors of 23 October, same 1,123 ids as
`ad453985`). The last revision before the re-read is `d8c04869`, 1,046 blocks.

- **Bookmarks**: 7, all Greg's, all whole-block (`quote`, `start`, `body` null, `status` `none`,
  no criterion, no thread). 5 point at ids not in the current revision.
- **Reading time**: 401 rows, up from 319, because Greg has read the book since the re-read.
  85 point at ids not in the current revision, the same 85 as on 23 October. Every one of the 5
  bookmarks' blocks is among them.
- Nothing references `comments.id`, so deleting a bookmark orphans nothing. `comments` and
  `reading_time` both have a foreign key to `block_identities`, which holds every new id.

## The mapping

Each stale id's text in `d8c04869` is cut into word trigrams (NFKC, lower case, letters and
digits only), and each block of the current revision is scored by the share of those trigrams it
holds. The stale id goes to the block with the highest share. **Where several blocks tie** (within
0.05 of the best), it goes to the one nearest where it should be: the new position of the nearest
earlier old block whose id was kept, plus the distance from it. Without that, a chapter heading went
to its own line in the contents list (`spya-r87888`, "THE CRUMBLING OF TIME", 43 seconds), which
GPT Sol caught. Of the 85:

- **70** have one successor holding at least 0.85 of their words (65 of them hold all of them),
  and one more holds 0.849.
- **7** were split in two. The whole row goes to the larger part. That is what the question
  promised, and splitting seconds between two parts is precision nobody asked for.
- **8** have no successor and are **deleted**, 33.5 seconds between them: the stray note-number
  stubs "12", "13", "14", "16", "55", "56", "57", and a stray "10 PERSPECTIVE" heading in the middle
  of chapter 9 (0.06 seconds), whose only matches are the contents line and the real chapter
  heading 190 blocks on. The question said the stubs would be left. Greg's reply says to remove
  what cannot be moved, and leaving them keeps seconds in the admin's total that no page can show.

The question counted 74 movable and 11 not. Its script was deleted with the 23 October driver,
so the two cannot be compared line by line. Every split, every tie and every single match under
1.00 was read by eye.

**Where two old rows land on one block, their seconds are added**, and added to any time Greg
has spent on that block since the re-read: 53 targets, 38 of them already holding time, so 15 new
rows. This is what `pgReadingTimeStore.add` itself does with a second visit.

**The bookmarks**, each read against both texts:

| bookmark | old block | new block | why |
|---|---|---|---|
| `spya-r2nqf8` | `spya-czxrvh` | `spya-j0s6sp` | all of it, inside a longer paragraph |
| `spya-h6zpyn` | `spya-mytsk7` | `spya-npajkz` | all of it; joined with the next |
| `spya-g70j46` | `spya-sxz07u` | — | **deleted**: its words are in `spya-npajkz` too, so it would be a second bookmark on the paragraph `spya-h6zpyn` now marks. The later of the two (23:26:55 against 23:25:28) goes. |
| `spya-f8q9nt` | `spya-b9txfv` | `spya-j5qt3r` | all of it, a few words more |
| `spya-rqqtdh` | `spya-jdh5bm` | `spya-b2gbsv` | split around a figure, see below |

`spya-jdh5bm` was "The structure of the cones can even be such that … like this: In this way, a
continuous trajectory … streets of Princeton." The re-read put the figure it was describing
between the two halves: `spya-b2gbsv` (ord 199) "…like this:", the figure (200), then
`spya-a9bjwa` (201) "In this way… Princeton". The question said the bookmark would go "to the
first part, which holds about two thirds of it". The first part holds about a third. The
bookmark goes to the **first part**, `spya-b2gbsv`, because a whole-paragraph bookmark is drawn
at the paragraph's start, which is where Greg put it. The reading time on `spya-jdh5bm` goes to
the larger part, by the rule above, and the two need not agree.

## How it runs

One script in the session scratchpad, deleted afterwards (database.md § Delete such a script),
in the same shape as the read-only ones there: `pg` by absolute path, the committed CA, `.env.prod`
read directly. It prints `Target: user@host:port/db` first, and refuses unless that is the
transaction pooler, port 6543, database `postgres`, with a user ending in the project ref of
`.env.prod`'s `SUPABASE_URL`. That guard was seen to refuse once, when it expected the user
`postgres.<ref>` and production's is `spideryarn_app.<ref>`. No `SET` anywhere, because this is the
transaction pooler (database.md § Never `SET` anything).

- **no flag**: preflight, inside `begin read only` … `rollback`. It prints what would change.
- **`--rehearse`**: every write and every after-check, in a write transaction that is then
  rolled back.
- **`--apply`**: the same, committed.

Inside the transaction, before any write, it locks the article row, Greg's comments on it and every
reading-time row on it (`for update`), and asserts the following, rolling back if any fails:

1. The article's owner is Greg's id and its current revision is `0d152e52`.
2. Every comment on the article is Greg's. Each of the 5 bookmarks is either exactly as read on
   2026-10-24 (block id, null quote, start and body, `none` status, no criterion), or already
   moved by an earlier run.
3. Every reading-time row outside the current revision is one of the 85 mapped ids, and every
   target is in the current revision.

Then the writes, each scoped by `article_id`, the comment's id, the exact old block id and Greg's
`owner_id`:

- `update comments set block_id = new …` for 4 bookmarks; `delete …` for `spya-g70j46`. Each must
  touch exactly one row.
- For each target: `insert into reading_time … on conflict do update set seconds =
  reading_time.seconds + excluded.seconds`, with the summed old seconds; then delete the stale
  rows, which must be exactly as many as were read.

And after them, still inside the transaction: 6 bookmarks, each on a different block of the
current revision; no reading-time row outside it; the row count is the old count minus the stale
rows plus the new ones; the total seconds are the old total minus the 33.5 deleted. Any failure
rolls back. A failure while `commit` is in flight reports the outcome as unknown, not rolled back,
and the next step is a preflight.

**Greg reading during the run** (GPT Sol). His browser adds seconds with an additive upsert keyed
by block id. A tab opened before the re-read still holds the old ids. The row locks make such a
flush wait rather than be lost, but once the old row is deleted, the waiting insert puts a new one
back. So the script is **re-runnable**: a second run finds the bookmarks already moved, and moves
only the stale rows that are still there. A preflight after the apply is the check that nothing
came back.

**The undo record**, written inside the apply transaction from the locked values, before the
commit, so that a failed write aborts it:

- `261024g-undo.json`, beside this plan and committed: for each bookmark its old and new block, and
  the whole row of the one deleted (no prose, since it is a bare bookmark); for reading time, each
  old id and the id it went to, or `null`. **Ids only.** These are the "old ids kept" the question
  promised, since the rows themselves no longer carry them.
- **The seconds are not committed** (GPT Sol). Which passages Greg lingered on, and for how long,
  is his reading behaviour, and a copy in the repository would outlive the article, against what
  privacy.md says. They go to a file in the session scratchpad, mode 600, deleted with the session.
  Undoing the reading-time half after that would mean splitting summed totals back apart without
  the numbers. Greg said he is not fussed, so that is accepted.

## Verified afterwards, read-only

1. All 6 of Greg's bookmarks on the article point at blocks of the current revision.
2. No reading-time row points outside the current revision.

**Not driven in a browser.** No agent can sign in as Greg on production, and the page reads
exactly the rows checked in 1 and 2: the gutter draws a bookmark on the block whose id it holds,
and the spine shades a block whose id has seconds (`ReadingTimeStore.read`, keyed by block id).
The read-only check is the evidence, and Greg opening the book is the confirmation.

## The simpler option passed over

- **Leave the old reading-time rows and only add new ones.** Nothing would be deleted and undo is
  a delete. But the admin's reading-time total (`pg-admin.ts`) sums every row, so it would count
  4,000 seconds twice.
- **Ask Greg to re-bookmark the five himself.** He asked for it to be done for him.
- **A committed `repoint` command.** That is `qi-gw4kwnea`'s decision, not this one.

## Plan review, and what changed

GPT Sol, **RUN WITH CHANGES**. Three blockers, all real, all taken:

- **Two headings were sent to the wrong block**, an earlier block with the same words: the contents
  list. The tie-break by position above fixes it. The stray one is now deleted.
- **A flush from an old tab could be lost or put back.** The rows are now locked, and the script is
  re-runnable for the put-back case.
- **The undo record came from the dry run**, not from the values the apply moved. It is now written
  inside the apply transaction.

And the rest: the seconds are kept out of the repository; the dry run became a real rehearsal of
every write; a commit in flight that fails is reported as unknown; the host guard checks port,
database and project; the 0.849 count.

The reviews name `261024g-apply.mjs.txt`, `-map.mjs.txt` and `-map.json.txt`. Those were review
copies of the scratchpad scripts and their output, **deliberately not committed and deleted after
the run**, with the scripts and the dump (database.md § Delete such a script). The map held
fragments of the book's text.

## Code review, and what changed

GPT Sol on the revised script ([code-review-sol](261024g-code-review-sol.md)), **RUN WITH
CHANGES**. It found no further mapping problem: the only ties are the three exact ones, and each
now goes to the right block or is deleted on purpose. Taken:

- **The undo record and the commit were not atomic.** Now a pending bundle (ids and seconds, mode
  600, fsynced) is written before the commit and kept whatever happens. The committed ledger is
  written only after the commit is confirmed, through a temporary file and a rename. A malformed
  ledger stops the run before anything is committed.
- **Nothing looked for a stale row put back after the commit.** It now waits 15 seconds, reads
  again, and exits non-zero if any came back.
- **The guard took the project ref from the same file as the credential.** It now checks the
  production ref, hard-coded, and the exact user `spideryarn_app.<ref>`.

## What happened

Run 2026-10-24 at 02:59 UTC, after a preflight and two rehearsals, each with the same counts.
`Target: spideryarn_app.alschkahzfagtppxspfq@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`.

- **Bookmarks**: 4 moved, 1 deleted (`spya-g70j46`, the second of two now on `spya-npajkz`).
  Greg has 6 on the book, each on a different block of the current revision.
- **Reading time**: 85 stale rows went to 53 blocks of the current revision (15 new rows, 38
  added to), and 8 were deleted (33.5 seconds). There were 401 rows and now there are 331. The total
  fell by exactly the 33.5 seconds deleted.
- **15 seconds after the commit**, no stale row had come back.
- **Verified read-only afterwards**, with a separate read script rather than the apply script's own
  checks: 0 of Greg's comments and 0 reading-time rows on the article point outside the current
  revision. A further preflight found the 5 bookmarks already done and nothing stale.

The undo ledger is [261024g-undo.json](261024g-undo.json). The seconds stay in the session
scratchpad only, as above.
