# The permalink, and sharing, while an article is still importing

Up: [plans.md](../project/plans.md)

Two reports from Greg through the Feedback button, 2026-10-05, both about the minutes an import
takes (seconds for a web page since [261005j](261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md),
still minutes for a PDF).

`spya-h7skj5`:

> While I'm importing a paper, I don't know what the permalink will be, so I have to wait for it to
> be finished to be able to bookmark or send it to someone. Is there a way we could at least include
> a permalink icon for what the link will be eventually?

`spya-e9t58e`:

> While I'm importing an article, make it possible for me to mark it as public/shared as it's
> importing

**Status: being built, 2026-10-05.**

## What is already true (checked in the code, 2026-10-05)

- **The address is known almost at once.** `enqueue` mints the slug, and the job the browser holds
  carries it (`Job.slug`, `src/types.ts`). `/read/<slug>` is the article's address for good. For an
  upload the job, and so the slug, exists only once the file has finished arriving.
- **The server already lets an owner share mid-import.** `PUT /api/article/:slug/visibility`
  (`src/store/pg-visibility.ts`) needs the owner's `articles` row and `processing <> 'minimal'`. It
  does not need a published revision. The row appears when the job's claim opens its draft, a
  moment after the job starts running; before that the route answers 404. This is the same window
  the add page's High-powered AI box already handles (`src/web/add-high-power.ts`).
- **A public article that has not published is invisible everywhere.** Every public read, the
  public shelf, the showcase and the page head inner-join on `articles.current_revision_id`
  (`src/store/public-reader.ts` § `publicCurrentRevisionQuery`, `src/store/public-library.ts` §
  `publicLibraryQuery`). So switching early exposes nothing early; the article becomes readable by
  others at the moment it publishes.
- **The owner opening `/read/<slug>` before publication is told "Not shared".** The owned read
  404s, the client falls through to the public read, that 404s too, and `ArticlePage` draws
  `NotSharedPage`: *"This document isn't shared. If somebody sent you the link, ask them to turn
  sharing on for it."* No retry. That is wrong for the owner's own bookmark, and it is the one
  thing a permalink handed out early would make people meet.

## What we build: browser only, no server change

One stage, three parts. Nothing on the server changes: no route, no column, no defence. GPT Sol
reviewed the first draft ([its answer](261005l-permalink-and-share-plan-review-sol.md)) and asked
for changes; § What the plan review changed lists them, and the design below has them in.

**"An import job"** below means one predicate, written once and used by parts 1 and 2: a job whose
steps start the article (`fetch` among them), not a mode job on an article already there. A mode
job can carry a `url` too, so `url` is not the test.

### 1. A copy-the-link button on the job card

`JobCard` (`src/web/AddArticle.tsx`) is drawn on the add page and in the shelf's job list, so one
control covers both. In the title row, for an import job, a small link-icon button: press it and
`<origin>/read/<job.slug>` is on the clipboard, through `useCopy`. It says *Copied* in words for a
moment, and a failure in words, as `CopyLink` does. Its tip:

> Copy the link this import's article will have. It opens for you once the import has finished,
> and for anyone else only if you share it. If the import fails, the link leads nowhere.

Shown while the job is queued, running, or done. Not on a failed or cancelled job. It reads
`job.slug` each render, so a Retry that comes back under another slug (`slugForRetry` adopting an
article already on the shelf) shows the new one. A link copied before such a retry is not
redirected; that would need the server, and is rare.

### 2. The owner's own early visit shows the import, not "Not shared"

In `ArticlePage`, when access is `not-shared` and the reader is signed in: ask the tab's job
engine for a **fresh** list (`afterFreshList`, `src/web/jobEngine.ts`; a list from before the 404
does not prove there is no import), then look for a queued or running import job with this slug.

- **There is one**: stay on `/read/<slug>` and draw a small page, *Still being added*, holding that
  job's own `JobCard`. When the job ends `done`, re-read the article (the `attempt` bump
  `UnreadPaperPage` already uses). If it ends any other way the card says why and offers Retry, as
  it does everywhere.
- **There is none, or the list could not be read**: `NotSharedPage`, exactly as today.
- **A signed-out visitor**: untouched.

No navigation to the add page: arriving there posts a new import, which is the wrong thing to do
on behalf of a 404 (Sol's P2-3 and its closing suggestion).

### 3. "Make it public" on the add page

A third box on the add page under High-powered AI, off by default and never remembered:
`AddShare.tsx` drawing a `ShareAtAdd` (`src/web/add-share.ts`), framework-free with its requests
injected, as `HighPowerIntent` is.

**One `ShareAtAdd` per slug, for life.** It is made when the job's slug is known and never
retargeted. If the slug changes (a Retry onto another article), the old one is disposed and a new
one starts from nothing, confirmation included. Disposing one that is `on` or `unknown` sends its
own slug `{ visibility: "private" }`, so nothing the reader shared under the old name is left
public behind a box that now reads off. An answer that arrives for a disposed one changes no state.

**It first finds out whether there is already an article here.** An import can adopt an article
already on the shelf (`freeSlug`), and that one may have a glossary, notes and comments that would
go public the moment the switch is pressed. So before offering anything it reads the owner's
metadata for the slug (whatever `Metadata.tsx` reads for its sharing card):

- **404**: nothing published yet. The box is offered, with the inventory for an article nothing
  has been built on.
- **200**: already an article. No box; one line: *This article is already on your shelf. Share it
  from Access & sharing on its Metadata page.*
- **anything else**: no box and no line. Not knowing is not a reason to offer the switch.

Ticking the box opens the **same confirmation** the Metadata card uses, inline, built from the
same exported pieces: `SHARING_CONFIRM_TITLE`, `sharingConfirmBody`, `Inventory` over
`sharedInventory` with nothing built (everything a model makes is listed under *would be shared if
built*, which is true: the import builds them), `Personalisation`, `SHARING_CANNOT_UNRING`, the
`SHARING_RIGHTS_CONFIRM` tick-box, and a *Share it* button disabled until the box is ticked. Only
that press sets the intent, and the request carries `rightsConfirmed: true` because the owner
ticked it for this slug. `sharingConfirmBody` learns to take no title (*"of this article"*), since
an import may not have one yet.

After the press, one line of state:

| State | Line |
|---|---|
| waiting | Will be made public as soon as the import is ready for it. |
| saving | Sharing this article… (`sharingInFlight`) |
| on | Public. Other people can read it at this link once the import has finished. + `CopyLink`, and `UNSHARING_COSTS_ALLOWANCE` as on Metadata |
| refused | the server's sentence |
| gave up | Not shared: the import had not started after five minutes. It will be tried again when the import finishes. |
| unknown | That did not come back, so we cannot say whether it took effect. Check Access & sharing on the article's Metadata page. |

A 404 while the job is alive means the row is not there yet and is retried each second, for five
minutes; then *gave up*. **`settle(slug)` at completion sends from `waiting` and from `gave up`**,
so a job that sat queued for longer than that is still shared when it lands. Unticking before
anything was sent cancels the retry and sends nothing. Unticking while on or unknown sends
`{ visibility: "private" }`, with no second confirmation.

**The page does not leave by itself while sharing is unsettled.** Today the add page opens the
article the moment the import completes, unless the purpose box is focused or unsaved. A third
reason not to: the confirmation is open, or the share is waiting, saving, refused, gave up or
unknown. Then the page shows *Ready* and its *Open the article* button, as it does for the purpose
box, and the reader leaves when they have read the answer. A share that is `on`, or a box never
touched, holds nothing up.

## What the plan review changed

GPT Sol, 2026-10-05, nine findings, all taken: state bound to one slug (P1); the adopted-article
probe (P2-2); the import predicate (P2-3); a fresh job list, and no redirect to a page that posts
(P2-4 and its simpler Part 2); the page waits while sharing is unsettled (P2-5); the tip no longer
promises the address for good (P2-6); `settle` revives a share that gave up (P2-7); unsharing is
not called free, and `UNSHARING_COSTS_ALLOWANCE` is shown (P2-8); the status line (P3-9). It also
checked that an unpublished public article is invisible on every public surface, that billing is
unaffected (a reservation counts in full whatever the visibility), and that a provisional first
publication is safe for a visitor to read.

## The simpler options passed over, and the larger ones

- **Only the permalink, and tell Greg to share from Metadata after it opens.** Simpler, but it is
  the wait the second report is about, and on a PDF it is minutes.
- **A server-side "share when published" flag.** Would survive every tab closing between the press
  and the row existing. That window is a second or two, the intent retries through it, and a flag
  is a new column on the sharing path. Not built.
- **A slug before an upload has finished arriving.** Would need the slug minted at the grant
  instead of at `enqueue`. Not built: during the transfer the add page's own address,
  `/add/upload/<id>`, already survives a reload and ends at the article.
- **A private link at import**, and **a "still being added" page for a visitor** who arrives before
  publication. Both are real and both are questions for Greg, below.

## Done looks like

- `tests/add-share.test.ts` drives every answer of the intent, as `tests/add-high-power.test.ts`
  does; a component test holds that no request goes out without the rights tick and the press.
- A test on the job card: an import job has the button and copies `/read/<slug>`; a mode job and a
  failed job do not have it.
- A test on `ArticlePage`: signed in, 404, a live import job for the slug ⇒ *Still being added*
  with its card, and the article once the job is done; a live **mode** job ⇒ `NotSharedPage`; no
  job ⇒ `NotSharedPage`; signed out ⇒ as before. Seen red first.
- Tests for a slug change after a share succeeded and during an unanswered request; for the
  adopted-article probe's three answers; for the page not leaving while sharing is unsettled.
- `npm test`, `npm run typecheck`; a browser check at desktop, iPad and phone widths.
- Docs: `ingest-queue.md` § The add page, `public-readable-sharing.md`, `help-page.md` if `/help`
  describes the add page's boxes.

## Questions for Greg (not blocking)

- **[Q-private-link-at-import]** Should the add page also offer *Create a private link*?
- **[Q-visitor-before-publication]** Should a visitor who opens a shared article's link before the
  import has finished see "still being added" instead of the landing page?

## What landed

(filled in at the end)
