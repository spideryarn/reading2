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

**Status: built, 2026-10-05.** § What landed says where the build differs from the design below.

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

2026-10-05. The three parts, browser only. Where the build differs from § What we build above,
this section is the truth.

- **Part 1** as planned: `isImportJob` (`src/job-state.ts`), the button in `JobCard`. The copy
  failure prints the address, since the card has no box to select it from.
- **Part 2** as planned: `OwnerNotShared` (`src/web/article/StillBeingAdded.tsx`). It follows the
  job by id once found; a Retry under another slug moves to `/read/<new slug>`; if no fresh list
  arrives in eight seconds it draws `NotSharedPage`. The code review added one re-read when the
  import finished between the 404 and the first list (F14).
- **Part 3, changed by the code review.** GPT Sol's
  [code review](261005l-permalink-and-share-code-review-sol.md) fixed two bugs itself (F13: retries
  that went on after the page left; F14) and left three (F10 to F12), all in how the plan's
  take-back and per-address controller behaved. They were closed by removing parts:
  - **no automatic take-back**: `private` is sent only when the reader unticks. So the plan's
    *"disposing one that is `on` or `unknown` sends `private`"* is not what the code does;
  - **one controller per slug per tab** (`shareAtAddFor`), not one per add address;
  - **after a reload** the page cannot read the switch back before publication. A
    `sessionStorage` mark makes it say so and offer the untick. A second tab has no mark.
  - a [fix check](261005l-permalink-and-share-fix-check-sol.md) by Sol then found three more in
    that shape (F10's gap, F16, F17) and a sentence that claimed too much (F18). Closed: the mark
    is written before the request is sent; a controller re-reads on every return to the add page
    and gives way to Metadata once the article has published; the sentence says *asked*.
  - Once the page has waited at *Ready* for sharing it stays until *Open the article*, so the
    link and the result can be read.
  The postmortem is
  [261005r](../postmortems/261005r-a-publication-404-does-not-establish-sharing-state.md).
- **Left as found:** `HighPowerIntent.dispose()` is called during render in `AddPage.tsx`
  (Sol's F15, older than this change).

**Checked in a browser, 2026-10-06**, by a Sonnet subagent with Playwright, once the local
database had been brought up to `dev` (the first attempt could not sign in: it was 16 columns
behind). Desktop 1440, iPad 820, phone 390; nine screenshots in [261005l-shots/](261005l-shots/).

- **The link button**: in the title row between the title and Stop at all three widths, nothing
  clipped; the clipboard held `/read/<slug>`; *Copied* shown.
- **The confirmation**: no sideways scroll at 390 or 820, the chips wrap, *Share it* is disabled
  until the rights box is ticked. After the press: *Sharing this article…*, then *Public.* with
  the link and the allowance sentence. Metadata then said public, and a signed-out browser read
  the article. Tick then untick, with no press, shared nothing.
- **The owner's early visit** (desktop, one PDF import): *Still being added* with the card, then
  the article with no reload. A nonsense slug still says *Not shared*.
- **A reload after sharing** (desktop, the PDF): the *You asked to make this public…* line with the
  box ticked, and the page waited at *Open the article*.
- **Not seen**: the early visit and the reload at iPad and phone widths (they need a slow import,
  and one PDF was the budget); the *Will be made public…* waiting line (the row always existed by
  the press); the *already on your shelf* line.
- **Found: on a fast web import the card often never appears.** The add page says *Queueing it…*
  until the job list next arrives, about eight seconds after the POST, and a web import now takes
  about ten. At 390 two imports showed no card at all, so no link button and no sharing box. The
  first list request races the POST and misses the job. This is older than this change, but it
  takes most of the value away for web pages. Fixed in stage 2, below.

A third question for Greg came out of the review:

- **[Q-read-the-switch-before-publication]** Add a small owner-only read of an article's
  visibility that works before publication, so a reloaded or second tab shows the box as it
  really is?

## Greg's answers, 2026-10-06

- **[Q-private-link-at-import]** — yes, and tidy it: *"yeah ok, might as well include that. perhaps
  bundle all sharing-related stuff in a default-collapsed section, because most people won't want
  to use it"*. So the add page gets "Create a private link" beside "Make it public", and both sit
  in one sharing section that starts collapsed.
- **[Q-visitor-before-publication]** — a "still being added" page: *"if it's not too complex, a
  "still being added" page sounds good. i'm not too worried about the security tradeoff"*. The
  trade-off he accepted: the server tells a stranger who holds the link that an unpublished
  article exists at that address.
- **[Q-read-the-switch-before-publication]** — no: *"eh, it sounds like more hassle than it's worth"*.
  The owner-only visibility read is not built, and the second-tab limit stays as documented.
## Stage 2: one sharing section with both controls, a visitor's "still being added", and the card that never appears

**Status: built, 2026-10-06.** § What landed in stage 2, at the end, says what differs. From
Greg's answers above and the browser check's finding.
Stage 1's design sections above stay as the record of stage 1.

### 2a. The job card appears at once

`queue.add` and `queue.addUpload` already hand back the `Job` the POST created
(`src/web/useJobs.ts`). The add page looks its job up only in the polled list, so it draws
*Queueing it…* until the next list, about eight seconds later. It will hold the returned job and
draw that until the list has one with the same id; from then on the list's copy wins. Everything
keyed on the job's slug (the link button, the sharing section, High-powered AI, the purpose box)
then starts with the POST's answer. The upload engine's path (`mine`, where `uploadEngine` posts
and not the page) keeps the list as its only source; a PDF import is long enough not to need it.

The simpler option, a faster first poll, was passed over: it is still a race, only shorter.

### 2b. One sharing section, collapsed, with two controls

Greg: *"bundle all sharing-related stuff in a default-collapsed section, because most people
won't want to use it"*. Under High-powered AI the add page gets one row, **Sharing**, closed by
default, which opens to two controls:

- **Make it public**, stage 1's box, unchanged in behaviour.
- **Create a private link**, new. The same confirmation the Metadata card's private link uses
  (`PRIVATE_LINK_CONFIRM_TITLE`, `privateLinkConfirmBody`, the inventory, `Personalisation`,
  `PRIVATE_LINK_CANNOT_UNRING`, the rights tick-box, *Create the link*). It sends the Metadata
  card's own requests: `POST /api/article/:slug/share-link` with `{ rightsConfirmed: true }`, and
  the route that turns a link off. Once on it shows the whole link with *Copy*, *Turn off*, and a
  line saying it opens for whoever has it once the import has finished.

The private link is easier than the public switch in one way that matters:
**`GET /api/article/:slug/share-link` reads the owner's row and needs no published revision**
(`src/store/pg-share-link.ts` § `read`). So its controller reads the truth whenever it is attached
(first mount, a reload, a second tab) and needs no `sessionStorage` mark: 404 is *no row yet*, and
otherwise the answer is the state. It is still one controller per slug per tab, still gives way to
the *already on your shelf* line once the article has published, and a 404 on the create while the
job is alive is still *not yet*.

**How the two share code**: the implementer generalises what `ShareAtAdd` already has (the
per-slug registry, pause and resume, revalidation on attachment, the not-yet retry, `settle`,
`unsettled`) rather than copying the class, if that comes out smaller than two classes; the
public switch keeps its mark, the link has none.

**The section opens itself when it has something to say**: a control that is on, waiting, refused
or unknown, including the reload warning. Closed, its one row says what is on (*Sharing: public*,
*Sharing: private link*), so a reader is never public behind a closed row. The page still does
not leave by itself while either control is unsettled.

`PRIVATE_LINK_ALSO_PUBLIC` is shown when both are on, as on Metadata.

### 2c. A visitor before publication: "still being added"

Greg accepted the trade-off: a person holding the address learns that an unpublished article
exists there.

**Server, one place.** `pgPublicReader.loadArticle` (`src/store/public-reader.ts`), when its
current-revision read finds nothing, asks one more question before answering 404: is there an
`articles` row for this slug that this request may read (`publicAccessWhere(slug, access)`: public,
or the request's key is its private link's) **and** a queued or running job for that article?
If so it throws a new `StillBeingAdded` error, which the route answers as **409 with
`{ error, code: "still-being-added" }`**, the way `NotProcessed` answers `not-processed`. Otherwise
the same 404 as today.

- **Only the article read.** The page head, assets, comments, searches, the source guess, the
  public shelf and the showcase are untouched, so the document is still a 404 with the default
  head and no title is given out.
- **The body carries nothing about the article**: no title, no owner, no progress.
- **A live job is required**, so a failed or abandoned import is an ordinary 404 and the page never
  says *still being added* about something that is not.
- **A private article with no key, or a wrong key, is still a 404**: the row does not match
  `publicAccessWhere`.

**Client.** `loadPublicArticle` (`src/web/public-api.ts`) gains a third answer,
`{ kind: "still-being-added" }`; `findArticle` (`src/web/article/access.ts`) passes it through; and
`ArticlePage` draws a small page for a visitor, signed in or not: *This article is still being
added. This page will open it when it is ready.* It asks again every ten seconds while the tab is
visible, and has a *Check now* button. The owner never reaches it: stage 1's `OwnerNotShared` is
asked first, and when the public read says *still being added* for the owner it is the same
import their own job list shows.

What this does not do: tell a visitor about an import that has not been shared yet, or one that
failed.

### What stage 2 changes on the server, and what it does not

One new arm in one public read, and its error code. No new route, no column, no change to who may
read what once published. The private link at import uses routes that exist. This is an edit
inside a listed defence (the public read), made on Greg's instruction of 2026-10-06, and it goes
to GPT Sol with the question *does anything else leak*.

### Done looks like

- 2a: a test through `AddPage` that the card, the link button and the sharing row are drawn from
  the POST's answer before any list has it, and that the list's copy replaces it. Red first.
- 2b: controller tests for the link (every answer, not-yet, revalidation, the read on attachment);
  page tests that nothing is sent without the rights tick and the press, that the section starts
  closed, opens itself when a control has something to say, and names what is on when closed.
- 2c: database tests through the real public route for each row of this table, red first:

  | Article | Job | Request | Answer |
  |---|---|---|---|
  | public, unpublished | running | no key | 409 `still-being-added` |
  | link on, unpublished | queued | right key | 409 `still-being-added` |
  | link on, unpublished | running | wrong key / no key | 404 |
  | private, unpublished | running | no key | 404 |
  | public, unpublished | none, or failed | no key | 404 |
  | public, published | any | no key | 200, as today |

  and that the page head, an asset and the comments read still answer 404 for the first row.
  Client tests for the visitor page and its re-asking.
- `npm test`, `npm run typecheck`, GPT Sol on this plan and on the code, a browser check at three
  widths.

### What the stage 2 plan review changed

GPT Sol, 2026-10-06 ([its answer](261005l-stage-2-plan-review-sol.md)): the 2c access design is
sound, six findings, all taken. **Where these differ from 2a to 2c above, these are the design.**

- **F1 (P1): controllers and the held job belong to one reader.** A private link's key is now in
  a controller's state, and an account change can leave the add page mounted. So the registry is
  keyed by reader and slug, is emptied when the session changes (where `useJobSession` already
  fences the upload engine and the batch), and an answer that arrives for a retired controller
  changes nothing and is shown to nobody. The same goes for stage 1's public controller and for
  2a's held job. Tests: a direct switch from reader A to reader B, and A's answer arriving after it.
- **F2: the error's code has to be declared.** `StillBeingAdded` is a leaf error class with
  `status = 409` and a fixed message that names nothing; `declaredFields` in `src/routes.ts` gets
  a branch for it, or the body has no `code`. Test the exact JSON through `handleApi`, and that
  another 409 does not become this one.
- **F3: the owner is not asked first today**, so 2c's last paragraph was wrong. `findArticle`
  falls through to the public read, which will now say *still being added* for the owner of a
  shared import. So a signed-in reader with that answer goes through `OwnerNotShared`'s job
  detection (fresh list, the completed-job re-read), and the visitor page is what it falls back
  to where it falls back to `NotSharedPage` today. Tests for owner, signed-in non-owner, signed
  out.
- **F4: the held job follows Retry.** It lives in the existing source-tagged `started` record,
  written from the add POST and from Retry's answer, and is used only while its source and job
  id are the current ones. The upload engine's own snapshot (`mine.phase.job`) is the same
  fallback for an upload, so 2a has no upload exception.
- **F5: *pending* means queued, or running with a lease that has not expired.** A dead claimant
  stays `running` until an owner's request settles it, and a visitor's poll settles nothing. The
  read uses the existing lease predicate and never the sweep that writes. A queued job may still
  wait on its owner's browser, so the page promises nothing about when.
- **F6: there is no public comments route to assert a 404 on.** Comments, searches and the source
  guess ride inside the article payload. The test asserts the 409 body has exactly `error` and
  `code`; the head and asset 404s each get a published control that answers 200.

**The query for 2c**, from the review: one ownerless existence read from `articles` with
`publicAccessWhere(slug, access)` and `current_revision_id is null`, and a correlated `exists` on
`jobs` by `jobs.slug = articles.slug and jobs.owner_id = articles.owner_id` and the pending
predicate. It selects a constant. Jobs have no article id column. `tests/public-imports.test.ts`
excludes the `jobs` table from public code today; it gets the one narrow permission, with SQL
tests for the access predicate, the owner and slug correlation and the null revision.

**Added to Done looks like**: a turned-off and a rotated key; a cancelled and a failed job; an
expired lease; another owner's job on the same slug; an archived row (409, as a published
archived article is readable by link); `openEarly`'s first publication (200); an uncertain answer
to the link's create does not create again by itself (a second create would rotate the key); the
visitor page stops asking when hidden, unmounted, or its slug or key changes; and what it does
when the article publishes, the import fails, or sharing is turned off while it waits.

## What landed in stage 2

2026-10-06. 2a, 2b and 2c as amended by the plan review.

- **Server**: `StillBeingAdded` (`src/still-being-added.ts`), `publicPendingImportQuery` and one
  arm in `loadArticle`, one `declaredFields` branch. Pending is `queued`, or `running` with
  `lease_expires_at > clock_timestamp()` (`leaseIsLive`, `src/store/job-fence.ts`).
  `tests/public-imports.test.ts` lets `public-reader.ts` and `job-fence.ts`, and nothing else
  public, name the `jobs` table. A running job being cancelled still counts while its lease
  lives.
- **Browser**: two controller classes and not one. The link's rules differ where the risk is (it
  reads the truth, never re-sends an unanswered create, never draws a key it could not re-read),
  and a shared base made both harder to read. Reader identity reaches `AddPage` as a prop.
- **GPT Sol's [code review](261005l-stage-2-code-review-sol.md)** found the server predicate
  sound and fixed three things: a private link's key printed to the browser console by the
  failure logger, an older read overwriting a newer link write, and the held job outliving a
  stopped import. Postmortems 261006a, b and c.
- **Left open, older than this work, and reported to the Overseer**: after a direct switch from
  one account to another with an add page still mounted, the purpose session, the High-powered
  AI intent and the remembered answer are not scoped to the reader (Sol's P1). The sharing
  controllers and the held job are.

**Checked in a browser, 2026-10-06**, by the same Sonnet subagent with Playwright, at desktop
1440, iPad 820 and phone 390, on a freshly started dev server. Eight screenshots, `s2-*` in
[261005l-shots/](261005l-shots/).

- **The card**: on six web imports it appeared with the link button and the Sharing row when the
  POST answered, 2.9 to 7.4 seconds after navigation, with no need to slow the import down. Not
  instant: the wait is now the POST itself, which was slow on a loaded box.
- **The Sharing section**: shut by default at all three widths; both controls inside; no
  sideways scroll; *Create the link* disabled until the rights box is ticked; the link box does
  not widen a 390 page; all four summaries of the shut row seen; no way to shut it while a link
  was being made. Not seen: what it does on a refusal or an unknown.
- **A private link end to end** (desktop and phone): made during the import, Metadata then showed
  the same link, a signed-out browser read the article through it with the private-link notice,
  and the address without the key gave the landing page. Turned off from the add page, Metadata
  showed no link.
- **A visitor before publication** (one PDF import): signed out, the public address and the
  private link each showed *Still being added*; the link without its key and an unshared import
  showed the landing page. The public visitor's tab became the article by itself when the import
  finished. The 409 body was the fixed sentence and the code, and the document's title was
  `Spideryarn`. Not seen: the private-link visitor's tab turning into the article (it was read
  in the moment the import ended), and a visitor arriving during a web import, which is too
  fast to catch.
- **No console line held `key=`.**
- **Not rechecked this round**: the reload warning inside the new section.
- **Seen and not explained, on Metadata and not in this change's code**: for some minutes after
  an import finished, Access & sharing said *We could not check who can read this…*, and later
  read correctly on reload. Seen on four articles while the box was also running the full suite.
  Reported to the Overseer.
