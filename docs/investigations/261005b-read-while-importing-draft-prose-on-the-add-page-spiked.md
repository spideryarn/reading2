# Read while importing: draft prose on the add page, spiked

Up: [investigations.md](../project/investigations.md) · the question:
[261004e](261004e-open-the-article-before-structure-and-assets-where-the-import-s-time-goes-and-what-deferring-costs.md)
§ What was not looked at, [Q-read-while-importing] · GPT Sol's review of this write-up and the
code: [the answer](261005b-read-while-importing-review-sol.md), to
[this prompt](261005b-read-while-importing-review-prompt.md)

Spiked 2026-10-05 on the box, against the local database. **The spike code is not on `dev`.** It
is three commits on the branch `worktree-read-while-importing-spike` (`009d28407`, `1aabb70ed`,
`c82f2f0d5`), in the worktree `.claude/worktrees/read-while-importing-spike`, and is described
under [What was built](#what-was-built).

**Decided: not landed.** Greg, 2026-10-06:

> open-before-structure is preferable to read-while-importing

[261005j](../plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md)
opens the real reading view about 10 s after Add, which leaves this route under a second to fill
on a web page. The branch is kept as the fallback; the worktree can go.

## What was asked

> yes, this sounds promising, and definitely sounds worth a spike. it's ok to incur some costs
>
> — Greg, 2026-10-05

Three words used below. A **draft** is the article as the import has it so far, stored but not
yet readable by anybody. **Publication** is the moment the finished import makes it an article;
the reading view opens then. The **hand-over** is the add page giving way to the reading view.

The idea: an import cuts the article into blocks early, then spends most of its time on
`structure` (and, for a PDF, on recovering figures) before publication. While that runs, show the
prose on the add page, read from the draft, and open the real reading view at publication.
Nothing is published without a tree, so the reading view learns nothing new.

## The short answer

- **It shows the prose, and it is small.** One read-only route, one component, about 60 lines in
  the add page. No migration, no change to the worker, the job states or the publication gate.
- **How much earlier, on a web page:** on a quiet box, by an estimate from 261004e's step times,
  at about 5 s instead of 31 s. Under today's load the prose could have been fetched 7 to 23 s
  after Add, in imports that took 31 to 83 s.
- **On a PDF it comes after the long wait, not instead of it**, because reading the PDF comes
  before `blocks`. One PDF, from the server's rows only: 2 min 21 s into a 6 min 01 s import.
- **The hand-over lost the reader's place both times it was tried**, and the cause is not known.
- **The prose starts below the fold** of the add page.
- **It covers the same seconds as the plan to open the real reading view early** (261005j, below).
  If that lands, this is worth almost nothing on a web page.

**Recommendation: do not land it now.** See [Recommendation](#recommendation).

### What is and is not verified

The box was overloaded for most of the day (load average 50 to 180). The browser was run once,
on web pages, against the first version of the code.

| | State |
|---|---|
| Prose appears on the add page for web imports | Seen in a browser, four imports |
| No request left for another host before the hand-over | Seen in those runs, on Wikipedia pages, with the first version |
| Server read is owner-only; 404 for everything else | Test written and passing. **Never seen red**: the run with the owner filter removed was refused by the session's permission classifier |
| The stricter stripping of anything that fetches (added after review) | Unit test passing, nine shapes. Not seen in a browser |
| An account switch clears the prose (added after review) | **Not tested at all** |
| The hand-over keeps the reader's place | **Failed twice. The later change meant to help has never been run** |
| A PDF in a browser; a 390 px window | **Not done** |
| Typecheck | Clean |
| Full test suite | Not run, at the Overseer's instruction while the box was loaded |

## 1. How soon the prose can appear

The prose can be fetched once the `blocks` step has committed. The add page polls its job about
once a second, sees the step done, and makes one request for the draft.

**Web pages.** Six imports of Wikipedia articles, from the server's own rows. The middle column is
when the `structure` model call began (`ai_calls.started_at`), used as a stand-in for "blocks are
committed"; it leaves out fetching and drawing the draft. No quiet run was made to compare with.

| Article | Blocks | Add → `structure` call begins | Add → import finished | Difference |
|---|---|---|---|---|
| Analytical engine | 138 | 7.2 s | 37.8 s | 30.6 s |
| Difference engine | 146 | 8.2 s | 64.6 s | 56.4 s |
| Punched card | 251 | 9.1 s | 73.8 s | 64.7 s |
| Herman Hollerith | 78 | 11.8 s | 30.5 s | 18.7 s |
| Charles Babbage | 437 | 18.1 s | 59.1 s | 41.0 s |
| Ada Lovelace | 460 | 23.3 s | 82.8 s | 59.5 s |

In the browser, the prose was on the page 1 to 10 s after the step list showed `blocks` done; the
draft request itself took 1.6 to 10 s and returned 70 to 440 KB. Both under load.

261004e measured `fetch` + `extract` + `blocks` at 4.6 s of a 30.6 s import on a quiet box. From
that, **an estimate, not a measurement of this page: prose at about 5 s, about 25 s earlier.**

**PDF.** One import, `arxiv.org/pdf/1706.03762` (114 blocks), seen only from the server's rows
because the browser run was killed for memory.

| Moment | Time after Add |
|---|---|
| Last `extract` call ended | 2 min 10 s |
| `structure` call began (blocks committed by now) | 2 min 21 s |
| `structure` call ended | 2 min 55 s |
| Import finished | 6 min 01 s |

So the prose would have been available for the last 3 min 40 s of 6 min. What filled the 3 min
after `structure` was not broken down; `assets`, which recovers a PDF's figures, is what runs
there. 261004e's quiet figures put the prose at about 204 s of 300, **96 s earlier**.

## 2. What the reader sees, and what they lose in the gap

Seen in the browser on web pages
([shot 1](261005b-shot-1-web-prose-appears.png), [shot 2](261005b-shot-2-web-scrolled.png)):

- The article's prose in the reading view's own serif and measure, under one line of explanation.
  It reads like the article.
- **No pictures.** Every picture is a blank box until the reading view opens.
- **Nothing that needs a block id or a tree:** no spine, no table of contents, no modes, no
  comments or highlights, no hover cards, no search. Selecting text selects it and nothing else
  happens.
- **The prose is below the fold.** At 1440×900 the job card, two tick-boxes and the purpose box
  fill the window, and the draft's first heading is at 857 px. A reader has to scroll to find out
  it is there.

Not seen, expected from the code: on a PDF, figures are empty frames with captions, and maths
shows as raw TeX, because the reading view draws both in steps this page does not run. Since the
review fix, an embedded video is an empty frame too.

### The hand-over

At publication the add page opens `/read/<slug>`, as it does today. If the reader has scrolled
into the draft, the address is meant to carry `?at=<block id>`, which the reading view already
understands as "open at this block". Block ids in the draft are the published ones.

**Measured: it did not work.** In both scrolled runs (Ada Lovelace, Charles Babbage) the final
address had no `?at=` and the reading view was at the top
([shot 3](261005b-shot-3-web-reading-view-at-place.png)); the reader's block was about 24,000 px
further down. The unscrolled run opened at the top, as it should.

**Why is not known.** Two candidates, neither established:

1. *The place was never handed over.* The prose was unmounted for a moment before the hand-over,
   the page collapsed and the scroll went to the top. I guessed this and wrote a change that keeps
   the prose on the page once shown. GPT Sol read the polling code and found nothing that would
   unmount it on an ordinary completion.
2. *The place was handed over and then dropped.* The router scrolls to the top on arrival; the
   reading view then jumps to the `?at=` block; if that block's row is not drawn yet (a long
   article draws its rows progressively) the jump does nothing, and the position tracker then
   writes the address again without `?at=` (`src/web/position.ts`). Sol's finding, from the code.

The run that tells them apart logs the block sampled, the outgoing address and every later write
to the address. It was not made.

Two more things at the hand-over, both seen:

- **The purpose prompt lands on top.** A reader who never touched the *"Why are you reading
  this?"* box on the add page is asked again by a dialog over the reading view. Fair when they
  were watching a progress card; an interruption when they were reading.
- **The first-open view opens too** (Summary in the band, notes in the margin), so the screen
  changes a good deal around the paragraph even if the place is kept.

## 3. What it costs

### What was built

276 lines added across six files under `src`, comments included, and 220 lines of tests.

| Piece | Where | What |
|---|---|---|
| The read | `src/store/pg-job-draft.ts` (new) | One query: this job, this owner, not dismissed, holding a revision still marked `draft`. Then the same block reader a published article uses (`blocksFor`, now exported from `src/store/pg.ts`). |
| The route | `GET /api/jobs/:id/draft` in `src/routes.ts` | Owner only. One 404 for no job, someone else's job, an ended job, and no blocks yet. Spends nothing, writes nothing. |
| The prose | `src/web/DraftProse.tsx` (new) | Fetches once, cleans each block, strips everything that fetches, draws plain `.prose`. `draftReadingPlace()` finds the block at the top of the window. |
| The add page | `src/web/AddPage.tsx`, about 60 lines; two `key`s in `src/web/App.tsx` | Shows the prose when the `blocks` step is over and the Experimental switch is on; keeps it until the job fails or the address changes; builds the hand-over address. |
| Tests | `tests/draft-prose.test.ts`, `tests/job-draft-read.test.ts`, rows in two registries | Both pass. Neither covers the hand-over, the latch or the account switch. |

Unchanged: the worker, the step order, the job states, what the add page polls, the publication
gate, the reading view, the database schema.

### Where the complexity really is

Not in showing the prose. It is in the add page, which already has a careful completion sequence
(a purpose box that saves as you type, a deferred open while it is focused, a once-only guard, a
Retry that is a new job and sometimes a new slug), and in the hand-over, which crosses from that
page's state into the reading view's own position logic. The one bug the spike found is there,
and it is still open.

### The simplest version worth shipping

1. The prose as built, **moved above the fold**: once it is readable, put it directly under the
   job card and fold the tick-boxes and the purpose box away.
2. **A button, not a jump.** When the import finishes and the reader has scrolled into the prose,
   do not navigate by yourself: show *"Open the reading view"*. The page already has this state,
   for when the purpose box is focused. It removes the surprise, and it makes keeping the place a
   courtesy and not something the reader watches fail.
3. No purpose dialog on a hand-over from the draft.
4. Leave pictures, maths and PDF figures out, and say so in the one line above the prose.

Points 2 and 3 are product choices and are Greg's. With them, the hand-over bug matters much
less; without them it has to be fixed first.

## 4. Security

The draft is a stranger's page, drawn before publication. Read against
[security-map.md](../project/security-map.md).

- **The same sanitising path as the reading view.** The HTML is cleaned when the blocks are cut
  (`src/blocks.ts`), again as the route serves it (`sanitizeStoredBlocks`, the call a published
  article goes through), and again in the browser before it is drawn (`sanitizeBlockHtml`, then
  links aimed at a new tab). In the browser, on four drafts: no `<script>`, no `<iframe>`, no
  `on…` attribute inside the prose. Sol found no filtering the reading view does that the draft
  skips.
- **Reaching the publisher was the real hole, and the first version did not close it.** Before
  `assets` runs, the stored HTML still names the publisher's pictures, and the app has no
  Content-Security-Policy, so drawing it as stored makes the reader's browser ask the publisher
  for them. The first version reused the reading view's image blanking, which only handles an
  `<img>` with an absolute `src`. Sol listed what that misses: an image with only `srcset`,
  `<video>` and `<audio>`, a video's `poster`, an SVG `<image>`, a `background` attribute. The
  Wikipedia runs made no outside request, which shows only that those pages had none of these.
  **The fix:** the draft now removes every attribute and element that fetches, embeds included,
  so a draft is words and nothing else. Unit-tested on nine shapes; not seen in a browser. The
  reading view itself still has the gaps Sol listed; that is not new and not this spike's.
- **Who can read it:** the job's owner and nobody else; a stranger's job id is the same 404 as no
  job. The Experimental switch is not part of this defence and the server does not check it. Sol
  read the query and found no way round. The test passes and has not been seen red.
- **One reader's draft could have stayed on screen for the next** after a change of account in
  the same tab, because the page kept the prose it had fetched (Sol's P0, a consequence of my
  latch). Fixed by giving the add page a `key` of the reader's id, as the shelf has. Not tested.
- **A draft that goes on to fail** is prose the reader saw from an article that never existed.
  Harmless; the prose is taken away when the job fails.

## Spend

19 priced model calls: **$1.28** by `ai_calls` (credits, own-key and computed costs summed;
OpenRouter's 5.5% fee applies to the credits part and was not separated out). They cover six
completed web imports, one PDF, and the paragraph-label jobs and one-sentence-per-part summaries
(`arc`) that the app queues by itself after an import. A seventh web import (Difference engine,
first try) was refused by the provider at `structure`; that call has no recorded price.

The brief to the browser agent allowed three imports. It made eight, because its own script
failed on four of them.

## Recommendation

**Do not land it now. Decide it together with 261005j, and only then finish it.**

261005j is the plan *"Open the article before structure and swap the real tree in live"*, written
the same day in the worktree `open-before-structure` and not on `dev` when this was written. It
makes a first import from the browser publish with a free headings-only tree, so the real reading
view opens about 25 s sooner on a web page, and the real structure arrives afterwards. It keeps
`assets` before publication, so a PDF still waits for its figures.

- **The two cover the same seconds:** after `blocks`, before publication. If 261005j lands, on a
  web page that window shrinks to under a second and this buys nothing. On a PDF it would still
  cover figure recovery (about 49 s on a quiet box), and re-imports, which 261005j leaves alone.
- **If 261005j is stopped** (opening before `structure` has been stopped twice before), this is
  the cheap fallback and worth finishing, in the four-point version above.
- **Either way it is not ready.** Before any of it goes to `dev`: find the hand-over's real cause
  with the logged run, or take the button (point 2) so it stops mattering; test the account
  switch; watch one PDF and one narrow window in a browser; see the ownership test fail once.

## What was not looked at

- A PDF in a browser, and a 390 px window. Both were planned; the box had no room for them.
- The draft request on a quiet box, and whether a 440 KB draft wants trimming.
- Showing a PDF's prose earlier still, page by page as `extract` reads it. That is the only route
  to reading sooner on a PDF, and it is a different and larger piece of work.
