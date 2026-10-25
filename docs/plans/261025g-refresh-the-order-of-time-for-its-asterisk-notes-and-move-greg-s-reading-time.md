# Refresh The Order of Time for its asterisk notes, and move Greg's reading time

Greg's answer to [q-yc2fp3](../user-feedback/questions/q-yc2fp3.md), reply `spya-s4qkhh`,
2026-10-25 08:55: **"A"**. Report `spya-hrx8z2`, queue item `qi-jk3xk9zt`.

Option A authorises two production writes and nothing else: **re-extracting Greg's article**
`rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug` from the PDF we hold, so the 11
asterisk notes of [261025a](261025a-asterisk-and-dagger-notes-at-the-back-of-a-book-link-to-their-markers.md)
link; and **moving the reading time** on the paragraphs that Refresh re-mints onto their
successors, as [261024g](261024g-repoint-greg-s-bookmarks-and-reading-time-on-the-re-read-order-of-time.md)
did. The question promised four paragraphs, 11 links, about 400 seconds, under a dollar, and
bookmarks untouched. **If the Refresh would do more than that, or cost far more, stop and ask in a
new question file.** No deploy.

## Is the fix live?

`6a585ac4a` (261025a) is an ancestor of `4b0d4dd3` and of `a9b65cd3`. `a9b65cd3` is production
(`dpl_2UURW4WKxj75JuATQHBbSPMvC6UF`, `origin/main`). This worktree's `src/` is identical to
`a9b65cd3` (only the two changelog files differ), so the scripts below run production's code.

## The dry run, read only

The repo has no command that re-extracts an article in production; 261023c's driver was deleted
after its run, as database.md says such a script must be. So first a dry run: today's stage 2
(`runPdfExtract`) and stage 3 (`runBlocks`) run in memory against production's stored chunk
checkpoints and current blocks, read inside `begin read only` … `rollback`, with the local copy of
the PDF (sha256 `a0f74232…`, the article's `raw_sha256`). The transcription reader throws if it is
called. The front-matter and authors passes are real calls (tenths of a cent, on the local key),
because their answer can shape the HTML.

Result, run three times (the third with the full hash checked against `raw_sha256` and the stored
filename passed, as the step does), identical every time apart from the random new ids:

- **36 of 36 chunk checkpoints found, no transcription call.** Nothing is read again.
- **1,123 blocks before and after. 4 ids re-minted**: `spya-zras7z` (46.0 s of Greg's reading
  time), `spya-mvnpew` (102.9 s), `spya-adejvw` (252.7 s), `spya-xsqyfm` (none). 401.5 s in all,
  as promised. Each successor has the same words, sits in the same position and cites one or two
  more notes.
- **Note links 125 → 136**, the 11 asterisk notes.
- **23 kept ids change their HTML** and keep their ids: the 6 marker paragraphs that cited no note
  before and now link their `*`; the 11 asterisk notes, which lose their leading `*` and gain a
  back-link; and the 6 numbered notes cited from the 4 re-minted paragraphs, whose back-link now
  points at the new id. Nothing else.
- **Greg's 6 bookmarks** are on blocks that keep their ids. Not one is touched.

The new ids are minted at random, so they are known only after the real run (the two dry runs
gave different ones). That is why the move is a second step, mapped by position and words.

## Step 1: the Refresh

A scratch driver in the session scratchpad, deleted afterwards, started under `env -i` (`HOME`,
`PATH`, `NODE_ENV=production`) with `.env.prod` applied after `src/env.ts` is imported and every
name pinned, as 261023c's was. It queues what the shelf's Refresh button queues for an article
with no web address (`src/web/ShelfEntry.tsx`): `enqueue({ slug, force: ["extract"], pump: false,
profile })`, the route's rendered profile and no slot. `cascadeForce` then forces `blocks`,
`structure` and `assets`; `fetch` skips on the stored source.

It refuses to start unless: the database is production's transaction pooler as
`spideryarn_app.<ref>` and storage is production's; the environment owner and the article's owner
are Greg; the current revision is still `0d152e52`; the article has no web address, its raw source
is the stored PDF and the current revision has a completed `fetch` run; high-powered AI is off;
no job is live on the article; nothing inherited overrides a model, an effort or a concurrency.
**The preflight printed all of that on 2026-10-25 and queued nothing.**

**The gate.** One `advanceJob` walks a whole job, so the driver passes `advanceJobWith` the
production parts with each step wrapped. The `blocks` step's output is compared with the dry
run's **before it is returned to the runner**, and anything else throws, which fails the job before
it publishes. **It is exact, not a count**: the dry run's fresh ids are swapped for this run's by
position, and then the 4 fresh blocks and the 23 changed kept blocks must be byte-identical to the
dry run's HTML, every other block identical to the current revision's, the order unchanged, and the
words of each fresh block the same as the old block's. A self-test, reading only, built the result
of one dry run and checked it against another's (different ids): it passed, and three corruptions
(a link retargeted, an expected change missing, a stray change elsewhere) were each refused.

**Spend.** Before each step, what the jobs have spent (credits, BYOK and computed, from the ledger)
plus a reserve for that step (structure $0.60, labels $0.80, matter $0.30, others $0.10) must fit
under $1.50, and no call may be unpriced (the ledger's own definition, `UNPRICED_CALLS` in
`src/store/ai-calls-spend-pg.ts`). That cannot cut a step off part-way, so it is a guard on starting
the next step, not a hard ceiling. 261023c measured $0.84 for a run that re-read every chunk; this
one reads none, so about $0.70 (structure and labels) is expected.

**Greg's browser.** A visible signed-in tab drives every queued job of his, and it would run the
production steps without the wrapper, past the gate. The driver claims its job the instant it is
queued, and treats any `busy` as a refusal: it cancels and stops, rather than waiting. If the gate
somehow did not run in this process and a revision was published anyway, it checks that revision
against the same gate and says so. Greg cannot be asked to close his tabs while this runs
unattended. At 13:46 UTC his last article open was 12:09 and he had no live jobs.

Afterwards it drives only the successors that publication queued: new jobs, each one `labels` or
`matter` step, in claim order, through the same wrapped steps, cancelling one that fails. Any other
new job is reported and not driven.

## Step 2: the reading time

A second scratch script in the shape of 261024g's: `pg` by absolute path, the committed CA,
`.env.prod` read directly, the same host guard, no `SET`. Preflight (`begin read only`), then
`--rehearse` (every write and every check, rolled back), then `--apply`.

Inside one transaction it locks the article row, Greg's comments and every reading-time row on the
article (`for update`) and asserts that:

1. the article is Greg's and its current revision is the one the Refresh published;
2. the ids gone between `0d152e52` and it are exactly the four, and each one's position in the new
   revision holds a new id with the same words;
3. every comment on the article is Greg's and sits on the 6 known blocks, all current;
4. every reading-time row outside the new revision is on one of the four.

Then, for each stale row, `insert … on conflict do update set seconds = seconds + excluded.seconds`
onto the successor and a delete of the old row by article, exact id and exact seconds, which must
touch one row. Then, still inside it: no row outside the new revision; the row count is what the
arithmetic says; the total seconds are unchanged; **the comments hash the same, whole rows, as
before.** Any failure rolls back.

As in 261024g: a commit that fails in flight is reported as unknown, and the next step is a
preflight. The preflight reads without `for update`, which a read-only transaction refuses. A tab of
Greg's opened before the Refresh can still add seconds under an old id: it flushes every 60 seconds
and on leaving the page (`src/web/useReadingTime.ts`). So the script is re-runnable, looks for a
stale row 75 seconds after the commit, and is preflighted again at the end of the session. The
seconds go to a mode-600 file in the session scratchpad only, a new name each run opened `wx`,
written and fsynced before the commit. The ids-only ledger is a new file each run too. The committed
undo record is ids only: `261025g-undo.json`, beside this plan.

## Verified afterwards, read only

1. The new revision is current; its note links are 136; its 4 re-minted paragraphs have the
   words of the old ones.
2. All 6 of Greg's bookmarks are on current blocks, rows unchanged.
3. No reading-time row on the article is outside the current revision, and the total is what it
   was before step 2.
4. The cost, from the ledger.

## Plan review, and what changed

GPT Sol, **RUN WITH CHANGES** ([plan-review-sol](261025g-plan-review-sol.md)). Every finding taken:

1. **The move's preflight could not run** (blocker): `for update` in a read-only transaction. Locks
   are now taken only when writing.
2. **A browser tab could run the job past the gate** (blocker). `busy` is now a refusal with a
   cancel, and a revision published without the gate is checked after the fact. Sol also asked for
   Greg to close every tab. That cannot be arranged in an unattended run, so it is the residual,
   named above.
3. **The gate checked counts, not the transformation** (blocker), and this plan said 17 changed
   blocks where the dry run had 23. The gate is now exact (above), and the plan says 23.
4. **Spend**: the unpriced test is now the ledger's own, an unpriced call stops the run, and the
   ceiling is a reserve checked before each step. It is described as that, not as a hard ceiling.
5. **15 seconds was too short** for a tab that flushes every 60. It is now 75, plus a final
   preflight.
6. **A re-run could overwrite the seconds needed to undo the first.** Each run now has its own files.
7. **The dry run checked an 8-character hash prefix and passed no filename.** It now checks the full
   hash against `raw_sha256` and passes the stored filename. The title tidier only changes the
   shelf's metadata (`src/pdf-read.ts`, "the rendered page below keeps `title` as it came"), so it
   cannot change a block.

**Re-check: DO NOT RUN** ([plan-recheck-sol](261025g-plan-recheck-sol.md)). Findings 1, 3, 4, 6 and 7
fixed. Three new ones, all taken: the spend is now reconciled against the runner's own count of
calls (`onStepSpend`), so a ledger row that failed to insert stops the next step; the seconds stay
in the scratchpad and the ids-only ledger goes beside this plan, with the directory fsynced before
the commit; and the gate's self-test exits non-zero on a wrong verdict (re-run: all four as
expected).

**Not fixed, and accepted: 2 and 5, Greg's open tabs.** Sol's change for both is that Greg closes
every Spideryarn tab before the Refresh and keeps them closed until the move is checked. That needs
Greg, and this run is unattended on his answer. I decided to go ahead without it, for three reasons:

- **The bypass publishes what Greg's own button would.** A tab that claimed the job would run
  production's code on the same inputs. Three dry runs of that code gave byte-identical results
  apart from the random ids, so the gate is guarding against a divergence nothing has shown. If it
  happened anyway, the driver checks the published revision against the gate and says so, and the
  answer is a question to Greg, not a silent result.
- **The window is small.** The driver claims its job in the same breath it queues it, and with every
  chunk cached the whole job should fit in one claim (`walkClaim`). Greg's last article open was
  1.5 hours before the check, and he had no live jobs.
- **What a late flush from an old tab costs** is the seconds that tab spent on those four paragraphs
  after the move, stranded on an old id: seconds, not the 400 already moved. The final preflight
  would show any such row, and it can be moved by re-running the script.

The reviews name `dryrun.mts`, `refresh.mts`, `refresh.sh` and `move.mts`. Those are scratchpad
scripts, **deliberately not committed and deleted after the run** (database.md § Delete such a
script), with the dry-run output, which holds fragments of the book.

## The simpler option passed over

- **Leave the reading time** (option B). Greg chose A.
- **One script doing both steps.** Step 2 can be rehearsed only against the revision step 1
  publishes, and a mismatch between the two should be read by a person before anything else is
  written. Two scripts, each with its own preflight.
- **A committed `refresh --prod` command.** 261023c declined it, and this is only the second time.
  It is `qi-gw4kwnea`'s question too, keeping ids across a re-extraction, and not this plan's.

## What happened

2026-10-25, all against
`Target: spideryarn_app.alschkahzfagtppxspfq@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`,
storage `alschkahzfagtppxspfq.supabase.co`.

**First attempt, 13:59:57, job `spya-a8hgnq`: failed before any work, nothing published, nothing
spent.** The driver's spend query passed its job ids as a JS array through Drizzle's `sql`, which
sends it as one scalar (`malformed array literal`). That query runs before each step, so it threw
inside `extract` before the step's own code ran. The runner failed the job and its draft
(`813ed689`, `failed`). Read back: current revision still `0d152e52`, no ledger rows. The query now
sends one Postgres array literal, and the preflight runs it, read-only: 0 calls on `spya-a8hgnq`, and
$0.8404 over 111 calls on 23 October's Refresh and successors, which is 261023c's figure exactly.
**The failed job was then dismissed** (`dismissed_at` stamped, as the Dismiss button's `forget`
does; the row is kept), because otherwise Greg's Add page would show an "Extracting the article did
not finish" card with a Retry button for a Refresh that in fact succeeded.

**Second attempt, 14:02:05, job `spya-ee4zdd`: done.** `fetch` skipped (stored source), `extract`
(2 front-matter calls, no chunk read), `blocks` ("1123 blocks, 4 new ids (1119 kept)"),
`structure` (23 sections), `assets` (30 figures recovered). **The gate passed inside the driver**:
`spya-zras7z`→`spya-qqfm5k`, `spya-mvnpew`→`spya-z2w3cm`, `spya-adejvw`→`spya-fdw2ge`,
`spya-xsqyfm`→`spya-zdx06n`; the 23 kept blocks changed exactly as in the dry run; 136 note links.
No `busy`, so no other driver touched it. Successors `spya-j32tze` (`matter`, 1 stretch folded) and
`spya-jkh86s` (`labels`, 938 paragraphs), both done; no other job was queued. Current revision
`efb5fb1d`. **$0.7488 over 54 calls, none unpriced**, and the ledger's rows equalled the calls the
runner reported at every step.

**The move, 14:08:21, committed.** The first rehearsal stopped on its own check: the delete matched
on the exact seconds, and this pooler rounds a double to 15 digits on the way out, so it touched no
row for `spya-adejvw` (rolled back; now in database.md § Connecting to the remote). The script
was changed to copy the value in SQL, check it identical in SQL, and delete by exact id. That
change came after Sol's re-check, so it had only the rehearsal behind it, which passed. Then the
apply: 3 rows moved, 401.500 s (45.978 + 102.853 + 252.669; `spya-xsqyfm` had none), onto new rows.
Still 331 rows and 14,623.972 s in all. Comments hashed the same before and after. 75 seconds after
the commit, no stale row had come back. The ids-only ledger is [261025g-undo.json](261025g-undo.json).
The seconds, with their exact bits, are in the session scratchpad only.

**Verified read-only afterwards**, with a separate script: current revision `efb5fb1d`, 1,123
blocks, 136 note links, no note block still beginning with `*`; each of the 4 new ids holds the old
paragraph's words in the old position. Greg's 6 bookmarks are on current blocks, none created or
updated since 13:59. No reading-time row on the article is outside the current revision. A move
preflight found nothing left to move.

**Not driven in a browser**, for 261024g's reason: no agent can sign in as Greg on production, and
the page draws exactly the rows checked above. Greg opening the book is the confirmation.
