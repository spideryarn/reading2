# A second press on a page already on the shelf opens it

Report `spya-xsfrsg` (#682, SPIDERYARN-READING2-NE), Greg's reply `spya-fs5wyy` to
[q-d5ucbd](../user-feedback/questions/q-d5ucbd.md), 2026-10-24:

> Yes let's do 1A when I'm back in front of my computer. Keep this report open.
>
> 2A

2A is the held [261024q § Stage 4](261024q-chrome-extension-one-click-add-the-page.md#stage-4-held-for-greg-a-repeat-click-does-not-make-a-second-article):
pressing the Chrome extension's button on a page the reader already has adds a second article and
spends a slot, unless the first Spideryarn tab is still open. 1A (the Web Store step) is Greg's, on
his laptop, and is not attempted here. Supersedes queue item `qi-mpjegxhn`.

## The shape

```
 button ─▶ capturePage() in the publisher's tab: { html, filename, savedFrom }   ← savedFrom is new:
                                                 the address it wrote into the saved-from meta, or null
 extension keeps it, hands it to /add-from-extension once: { kind, html, filename, savedFrom }
 /add-from-extension
   savedFrom checked again (savedSource) ── null ──────────────────────────────▶ upload, as today
   an address ─▶ GET /api/library/by-url?url=<address>   made for the mounted reader (apiFetch madeFor)
                   server: savedSource(url) or 400; slugForUrlKey(urlKey(url)), this reader's shelf only
                   ◀─ { slug: string | null }
       null ──────────────────────────────────────────────────────────────────▶ upload, as today
       a slug ─▶ "This article is already on your shelf, so adding it again cost nothing."
                 [Open the article] → /read/<slug>      nothing uploaded, nothing spent; the ask spent
       failed ─▶ "couldn't check … so it hasn't been added yet."  [Try again]  capture kept, unspent
```

**It stops and says so rather than opening by itself**, as a repeat paste does (Greg, 2026-10-06:
*"yes repeat pastes should be free (and signal they're a repeat in the UI)"*, plan
[261007k](261007k-repeat-paste-is-free-and-says-so.md)), with the paste's own sentence,
`REPEAT_PASTE_ON_THE_SHELF`, so the two cannot drift.

## Pieces

1. **Route** `GET /api/library/by-url?url=` in `src/routes.ts`, an exact row with the other library
   reads, answering `LibraryByUrlResponse = { slug: string | null }` (`src/types.ts`),
   `Cache-Control: private, no-store`. The address must pass `savedSource` or it is a 400. No
   `viewAs`: an administrator viewing as a reader never adds, and the row fails closed without it.
2. **The address travels beside the HTML.** `capturePage` (`src/web/save-page-bookmarklet.ts`)
   returns `savedFrom`, the very string it wrote into the meta; the extension stores it with the
   capture and puts it in its `TAKE` reply (`extension/src/handoff.ts`); the page's `asTaken`
   (`src/web/extension-handoff.ts`) holds it to `savedSource` again. An entry kept by an older
   build has none, and uploads as before. The extension is not in the store yet, so this costs no
   review round.
3. **The page** (`src/web/AddFromExtension.tsx`): `receive` gets one more edge, `have(savedFrom)`,
   asked after `take` and before `send`, with `stillFor` checked again after it. Found → a
   `Receiving` kind `have`; a throw → `unchecked`, with Try again re-running the effect over the
   capture still cached in `asked`. A find spends the ask, so a remount or Back cannot upload it.

## What the security map says

[security-map.md](../project/security-map.md)'s saved-from row: the address is a claim out of a
file, *matched only on the uploader's own shelf (`slugForUrlKey`)* and never fetched. The route is a
new caller of that same lookup, not a change to it:

- **Owner-scoped by the lookup itself** (`ownedByReader()` in `db.articleUrls`), behind
  `requireUser`, which sets the request's owner from the token, like every `/api/` row.
- **It reveals nothing new.** `POST /api/jobs { url }` already answers this question for any
  address a reader types (`{ article, repeat: true }`), and goes on to fetch it on a miss. This one
  never fetches, never queues, never spends.
- **The claim decides only which of the reader's own articles to offer**, and the reader presses.
- **The page parses no HTML.** The capture stays a string made into a `File`, as before.

No defence is edited, so it is built rather than asked. The row gains the route's name.

## Passed over

- **The page reads the meta from the HTML itself** (`DOMParser` over the head, the server's rule
  moved to a shared Node-free module). The first draft of this plan. GPT Sol's plan review: a
  `DOMParser` document is not guaranteed inert to resource loads, so the publisher's markup would
  be parsed in our origin for the first time, and a browser parser that found a claim the server's
  did not would offer an article the server would not have matched. The capture already knows the
  address.
- **Have the upload check the shelf itself** (stage 1 reads the meta, answers `{ article, repeat }`).
  One fewer route and it would cover the bookmarklet; but the bytes are sent first (up to 50 MB),
  and stage 1 runs after a slot is reserved, so undoing the charge goes through billing. Bigger, and
  it touches a defence.
- **A failed lookup uploads anyway** (fail open). The first draft. Sol F3: that is the very
  duplicate this exists to stop, on any transient failure.
- **Open the article by itself.** Simpler, but a repeat paste deliberately stops and says so.
- **`POST` with the address in the body**, to keep it out of access logs. Our own request log writes
  the path without its query (`routes.ts`, `url.split("?")`), and `/add/<url>` already puts an
  address in a path. GET is the honest verb for a read.

## Plan review

GPT Sol, read-only, *REWORK*, four findings, all taken
([261024y-plan-review-sol.md](261024y-plan-review-sol.md)): F1 the address from the capture rather
than a parse in the page; F2 the lookup made for the mounted reader, since `apiFetch` otherwise binds
to whoever the tab holds when it is called; F3 a failed lookup uploads nothing; F4 tests at the
wiring, not only at `receive`.

## Code review, and seen working

GPT Sol on commit `ef7185d81`, workspace-write, *SHIP AFTER FIXES (MADE)*
([261024y-code-review-sol.md](261024y-code-review-sol.md)): F1–F3 met. It fixed a lost wakeup
older than this change (from `2623efaa4`): a `ONE_UPLOAD_AT_A_TIME` refusal whose competing upload
had already settled left `ready` true before and after, so the effect never re-ran and the page
waited for ever; the refusal now bumps `attempt` too, with a regression test, red without it. It
also corrected the route-contract canaries and made the Strict Mode test count lookups exactly.
The class is written up under `docs/postmortems/`.

Seen end to end (Sonnet subagent, Playwright's Chromium on the box, dev extension, local server):
first press on a fresh address uploaded and imported it; with that tab closed, a second press
showed *This article is already on your shelf, so adding it again cost nothing.* and *Open the
article*, with no upload request and the shelf count unchanged; the button opened the same slug; a
new address still uploaded.

## Tests

- `tests/saved-from-url-pg.test.ts`: the route over HTTP as the owner (found, through an `http:`
  spelling and a fragment), as a stranger (`null`), and a `javascript:` address (400).
- `tests/save-page-bookmarklet.test.ts`: `capturePage.savedFrom` is exactly the meta it wrote, and
  `null` for the addresses it writes none for.
- `tests/extension-handoff.test.ts`: the extension's reply carries it; `asTaken` checks it;
  `receive` found / missing / no address / failed / reader changed; `alreadyOnShelf` passes the
  reader as `madeFor`.
- `tests/add-from-extension-already-have.test.tsx`: rendered in Strict Mode: one take, the lookup
  made for the reader, found never uploads even after a remount, a failure uploads nothing and Try
  again finds it over the same capture, a miss uploads once. Red with the check switched off.
- Seen in Playwright with the dev extension: press, add; close that tab; press again on the same
  page → *already on your shelf*, one article.

## Stages

1. This plan, GPT Sol plan review (read-only). Done.
2. Build, gates, the extension seen end to end, GPT Sol code review (fixes in place), push to `dev`.
3. Bookkeeping: chrome-extension.md, security-map row, the feedback note (*awaiting* Greg's store
   step), q-d5ucbd rewritten to question 1 alone and published, `qi-mpjegxhn` dropped, the
   production zip rebuilt.
