# Open the article before structure and assets: where the import's time goes, and what deferring costs

Up: [investigations.md](../project/investigations.md) · the question:
[261004h](../plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md) § Stage 2
· the plan it led to, which was stopped:
[261004l](../plans/261004l-figures-arrive-after-a-paper-opens-and-an-open-article-re-reads-itself.md)

Spiked 2026-10-04 on the box, against the local database. No product code was written.

## What was asked

> see if you can find a way to get to the article loading faster by deferring stuff, as long as the
> article will update automatically (without requiring a page refresh), and as long as it's not
> going to introduce too much complexity. use your judgment
>
> — Greg, 2026-10-04

An import runs `fetch`, `extract`, `blocks`, `structure`, `assets` and only then publishes, which is
when the reading view opens. The reading view needs only the blocks. Two cuts were on the table:
**A**, publish after `blocks` and run `structure` and `assets` afterwards; **B**, move only `assets`
behind the publication.

## Where the time goes (measured)

Three local imports, each with `--force` so every step ran. Seconds are the job runner's own
per-step timer (the `ms` on each `step done` log line). The logs are `logs/tmux-jobs/timing-*.log`
in the worktree that ran them, which is gitignored and gone with the worktree; the numbers below are
the record.

| Step | Web page (Wikipedia, *Jacquard machine*: 78 blocks, 7 images) | PDF (arxiv.org/pdf/2010.11929: 22 pages, 157 blocks, 14 figure markers) |
|---|---|---|
| fetch | 0.3 | 2.7 |
| extract | 3.5 | 198.0 |
| blocks | 0.8 | 3.1 |
| structure | 25.1 | 47.2 |
| assets | 0.8 | 48.7 |
| **total** | **30.6** | **about 300** |

- **On a web page, `structure` is 82% of the wait** (one model call). `assets` is under a second.
- **On a PDF, `extract` is two thirds of the wait** (16 model calls reading the pages). `structure`
  and `assets` are about 16% each.
- **Inside `assets` on the PDF, 48.3 of 48.7 s is figure recovery** (`figuresMs`), and ordinary image
  fetching is 0.08 s because a PDF-made article has no `<img>`. Recovery made 8 locator model calls,
  which is its cap, and stored 5 of 14 figures. Nobody timed the calls against the page rendering
  between them.
- Production agrees in shape: structure 12 to 26 s on a web page and 55 s on a paper, assets under
  1 s and 92 s (261004h § Stage 2). One local paper and one production paper is the whole sample for
  the PDF column.

An arXiv *abstract* address imports the landing page only (8 blocks, 9.6 s). It is not a paper.

## What an open page does today when later work lands: nothing

This is the finding that prices everything else. **No open reading view ever re-reads its article.**

- The article is fetched once per slug and reader (`src/web/article/access.ts` § `useArticleAccess`).
  The only way to ask again is `attempt`, which blanks the page first (`setAnswer(null)`), and only
  the not-yet-read paper page uses it.
- `labels`, deferred on 2026-09-06, shipped as reload-only on purpose
  ([260906a](../plans/260906a-labels-leave-the-blocking-hierarchy-step.md)). Nothing in `src/web`
  listens for it.
- Rebuild and Start again show *"Article reset. Reload the page"*.
- The reader holds no revision id to compare.

What does exist is the signal. The jobs poll numbers every job that newly ends `done`
(`src/web/jobEngine.ts` § `recordCompletions`), and `useStepFinished(slug, step, fn)`
(`src/web/useStepJob.ts`) is how Glossary, Quotes, Citations and the marginalia already hear it and
re-read their own narrow endpoint. So Greg's first condition needs **one new thing in either
option**: a re-read of the article that does not blank the page, hung on that existing signal. No
new channel.

## Option A, open after `blocks`: too much, and it has been stopped twice

Saves 25 of 31 s on a web page and about 96 of 300 s on a PDF. It is where most of the value is,
and it is the expensive one.

- **A publication refuses a draft with no tree** (`reasonsNotToPublish`, `src/store/pg-revisions.ts`),
  and then checks the tree against a finished `structure` run.
- **`Article.tree` is not nullable**, and 25 server callers of `loadArticle` plus a client geometry
  seam used in about 30 files stand on that. Making it nullable is 45 or more files, with a crash as
  the failure. GPT Sol said not to, in an earlier review.
- **A heading-only tree that costs nothing already exists** (`src/heading-tree.ts` §
  `buildHeadingTree`, marked `provisional`), left over from two earlier attempts at exactly this:
  260830am and [260831ah](../plans/260831ah-toc-on-request-and-the-tree-that-costs-nothing.md), the
  second stopped with ten P0s. Publishing with it keeps every reader working, and leaves about 10 to
  14 files and these, none of them small:
  - a new arm in the publication gate for a provisional tree with no `structure` run;
  - the `labels` successor and the main-mode jobs (261004h stage 1) both fire at the first
    publication, so both move to the second;
  - a gate so that no paid mode runs against the provisional tree, including when the `structure`
    successor fails;
  - a failed-successor state, since the import is charged at the first publication;
  - a re-import, where the draft carries the old tree and the old finished run, `structure` has no
    freshness stamp, and the successor would skip: the real tree never arrives and nothing says so;
  - the swap itself: tree node ids are positional and renumber, so anything open or collapsed is lost.

That is over Greg's second limit. **Not built.**

## Option B, move all of `assets`: saves nothing more, and reopens a leak

On a web page `assets` is 0.8 s, and until it runs every image hot-links the publisher, which is the
thing the step exists to stop. **Not built.**

## In between: defer only a PDF's figure recovery. Planned as 261004l, and stopped

This looked like the answer, was written up as a plan, and did not survive GPT Sol's review of it:
nine P1s, almost all in the half that makes the open page update by itself. The plan's review
record has them. The first four bullets below still hold; the price in the fifth was wrong by about
half.

- **It is already a separate half.** `recoverPdfFigures` (`src/pipeline.ts`) does nothing unless the
  blocks carry PDF figure markers, and only the PDF reader mints those.
- **No block is added or renumbered.** The figure blocks and their captions exist before recovery;
  the picture is drawn into an empty `<figure>`. The cost is a layout shift under someone reading.
- **261004h was wrong that the modes must wait for it.** `assets` writes one artefact, and the only
  step that reads it is Illustrated, which is not queued automatically and whose stamp is built to
  read stale when figures arrive. Checked by grepping every read of the artefact in `src`.
- **Saves** 49 s of 300 locally and 92 s of 250 on production's paper. Nothing on a web page.
- **Costs**, as first priced, about eight files. After review, about a dozen, with a step that
  defers under three or four conditions, an ordering rule across three kinds of successor, and a
  re-read that has to be right about a job ending mid-load, a lightbox holding an old image, a
  Rebuild that already has figures, the CLI, and an open Illustrated band. A visitor to a shared
  paper cannot run jobs, so they would never see the update without loading again.

## Making figure recovery faster instead (measured, not built)

If the 49 s cannot cheaply move behind the open, can it shrink? Timed on the same paper by wrapping
the model call the step is handed, with no change to the code: 41.9 s that run, 8 calls.

| Where | Seconds |
|---|---|
| Before the first model call (the bitmap and drawn routes) | 8.9 |
| The 8 model calls, 1.4 to 2.5 s each | 15.3 |
| Between the calls: reading and drawing a three-page window each time, and compositing | 16.8 |
| After the last | 0.9 |

Three of the eight windows were the same three pages, read and drawn from nothing each time. Eight
windows visit 24 pages, of which 12 are distinct.

| Change | This paper | What it risks |
|---|---|---|
| Keep pages already read (a sliding cache; markers are in page order) | about 9 s saved | least: memory stays bounded |
| Ask the model four at a time | about 14 s saved (demonstrated: 16.5 s against 29.5 for the loop) | holds four to eight windows in memory where the code holds one on purpose; results must be put back in marker order; the page cutter may not be called concurrently |
| Both | about 21 s saved (demonstrated: 8.0 s for the loop) | both |

So 3 to 7% of a 300 s import. Worth knowing, not worth building now.

## The decision

**Stop.** Nothing is built.

| Option | Saves | Why not |
|---|---|---|
| A, open after `blocks` | 25 of 31 s (web), 96 of 300 s (PDF) | 10 to 14 files at best, stopped twice before |
| B, move all of `assets` | under 1 s more than the next row | hot-links every new web article |
| Defer a PDF's figures | 49 of 300 s; nothing on a web page | nine P1s at plan review; about a dozen files |
| Make figure recovery faster | 9 to 21 of 300 s | too small |

Every option that saves a meaningful share needs the same missing piece, an open article that
re-reads itself without blanking, and that piece is where the difficulty is. It has value of its
own (Rebuild says *"Reload the page"*; paragraph labels need a reload), so it is the thing to
build first if any of this is picked up again, as its own plan.

## What was not looked at

- **`extract` on a PDF, the 198 s, and it is the largest lead here.** Its four chunks do start
  together (`src/pdf-read.ts`, a queue as wide as the chunk count). Read off the local `ai_calls`
  rows: each chunk then made a second call, and after that six calls ran strictly one after another
  for 88 s. Inferred, not confirmed: content-check retries, then one chunk sent to `recover`, which
  re-reads it page by page in sequence by design. The log keeps the retry count and not the
  reasons. 88 s of serial work in one step is more than everything else on this page put together.
- A third route for the web page, which is a product question rather than an engineering one: show
  the prose on the **add page** while the import finishes, read from the job's draft, and open the
  real reading view when it publishes. Nothing is published without a tree, so nothing has to learn
  *no tree yet*. Not priced. [Q-read-while-importing] for Greg.
