# Open the article before structure and assets: where the import's time goes, and what deferring costs

Up: [investigations.md](../project/investigations.md) · the question:
[261004h](../plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md) § Stage 2
· what it led to:
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

## In between: defer only a PDF's figure recovery. Built as 261004l

- **It is already a separate half.** `recoverPdfFigures` (`src/pipeline.ts`) does nothing unless the
  blocks carry PDF figure markers, and only the PDF reader mints those.
- **No block is added or renumbered.** The figure blocks and their captions exist before recovery;
  the picture is drawn into an empty `<figure>`. The cost is a layout shift under someone reading.
- **261004h was wrong that the modes must wait for it.** `assets` writes one artefact, and the only
  step that reads it is Illustrated, which is not queued automatically and whose stamp is built to
  read stale when figures arrive. Checked by grepping every read of the artefact in `src`.
- **Saves** 49 s of 300 locally and 92 s of 250 on production's paper. Nothing on a web page.
- **Costs** about eight files: the step writes a manifest that says figures are still to come, the
  publication queues an `assets` successor as it queues `labels`, and the open page re-reads itself.
  A visitor to a shared paper cannot run jobs, so they see captions until the owner's browser has.
- **It brings the re-read**, which `labels` can use on the same day (paragraph labels arriving in an
  open Structure with no reload), and which any later attempt at A needs first.

## What was not looked at

- `extract` on a PDF, the 198 s. It is the largest number on the page and nothing here touches it.
- A third route for the web page, which is a product question rather than an engineering one: show
  the prose on the **add page** while the import finishes, read from the job's draft, and open the
  real reading view when it publishes. Nothing is published without a tree, so nothing has to learn
  *no tree yet*. Not priced. [Q-read-while-importing] for Greg.
