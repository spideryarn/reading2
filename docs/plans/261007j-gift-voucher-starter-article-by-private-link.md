# Gift voucher: a starter article, by private link

**Status as of 2026-10-07: planned, not built.** Queue item `qi-zqkjnadh`, the deferred half of
report `spya-vc6pnm`. The question and its four options are
[261007f § Q-starter](261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md#q-starter-may-the-voucher-email-carry-a-private-link);
this is option A, built.

## What Greg asked for

> I think mostly I want to make the UI easy to generate an article with a shareable link
> (functionality we already have) at the same time as generating the gift voucher. Hopefully this
> is mostly a UI tweak that chains together existing functionality rather than adding anything
> major that's new. If I've misunderstood, hold off on this until we've discussed further.
>
> — Greg, 2026-10-07 (`docs/user-feedback/questions/q-t2vhv6.md`)

The Overseer's reading of it: option A, plus *either pick one of your articles or paste an
address*, built by chaining the import, the private link from 261005e and the voucher email, with
nothing parallel to them. The voucher keeps which article, never the key. Hold off if it needs a
new background mechanism, a new way for the key to travel beyond the kept voucher email and
Resend, or more than about two days.

## Why it is a chain and not something new

Every piece exists, and the form only puts them one after another:

| Step | The existing piece |
|---|---|
| Paste an address, import it | The add page, opened in a new tab at `addHref(url)` (src/web/router.ts). It imports and, in its Sharing section, offers *Create a private link* while the import runs (`AddShareLink`, plan 261005l) with all of its lost-answer handling. |
| Pick one of your articles | `useShelf` (src/web/useShelf.ts): each entry already carries `slug`, `title`, `visibility`, `privateLinkOn` and `processing`, and `reload`. |
| Make the private link for an article already on the shelf | The article's own Access & Sharing card (`PrivateLink.tsx`), opened in a new tab. |
| Read the key to put in the email | `shareLinkStore.read(slug)` (src/store/pg-share-link.ts), the owner's read, scoped by `ownedSlug`. Still the one statement that selects `share_token`. |
| Send the email | `queueGiftEmail` / `giftMessage` (src/store/pg-voucher-emails.ts), one more paragraph. |

**No new background mechanism, and the voucher request never waits for an import.** An import is
advanced by the browser (`jobEngine.ts`, started by `App`, so any open tab of ours drives it); on
Vercel, closing every tab pauses it, as it always has. The add tab says so already
(`KEEP_A_TAB_OPEN`).

### Why the form links out rather than doing the import and the link itself

Sol's F4 and F5 on the plan: making a private link is not idempotent (every `POST` replaces the
key), so its UI treats a lost answer as *unknown* and reads before it will send again, and its
confirmation lists what is shared and warns about personalised artefacts. The import has its own
progress, failure and retry UI. Rebuilding either inside the voucher form is a second copy of the
most delicate client code in sharing. Linking out to the two pages that already do it, and reading
the result back through the shelf, chains them without copying them. The cost is a tab switch,
and the voucher draft survives it because the voucher page is not navigated away from.

## What Greg sees

```
/admin/vouchers — create
  Email address   [ ada@example.com ]          Articles [ 20 ]
  Their name      [ Ada ]
  Note to them    [ I read your piece on… ]
  Starter article [ none                               v ]  [ Refresh ]
                  (your articles, newest first)
     Or import one: [ https://…              ] [ Import in a new tab ]
     — The Bitter Lesson: private link on. The email will carry it.
     — Some Paper: private, no private link yet.  [ Make one on its page ] (new tab)
                   Create voucher waits until it has one.
     — Another: public. The email links to its public page; no key involved.
     — A New One: still being added.  Create voucher waits until it is on your shelf.
  Private note    [ … ]
                                                      [ Create voucher ]
```

- The picker lists his own articles from the shelf, excluding `processing: minimal` papers (a
  private link refuses them, `NOT_READ_YET_SHARE`).
- The shelf reloads when an import moves (`useJobs` already does this) and on *Refresh*, so an
  article imported in the other tab appears, and a link made there shows as on.
- Create voucher is disabled, with the reason, while the chosen starter is private with no link or
  not yet published. The server checks the same and refuses with a sentence if the page was wrong.
- The sketch of the email beside the form gains the starter line (title only, never the key).
- The voucher table shows the starter's title under the address. Not editable after create.
- After a readdress whose new email went without the starter (see below), the saved-change line
  says so.

## What the recipient gets

```
A gift of 20 free articles
Dear Ada,
| I read your piece on…  — Greg

Here is "The Bitter Lesson" in Spideryarn, to start with:     <- new, only with a starter
[ Read it ]  -> https://spideryarn.com/read/<slug>?key=…      (or the public /read/<slug>)

You have been given 20 free articles…                          <- as today
```

In the text part, the same sentence and the address on its own line. The title is the author's
text in a stranger's inbox: cleaned to one line and escaped with `escapeNoteHtml`. Never in the
subject. With no starter, the email is byte for byte what it is today (the golden assertions from
261007f still pass unedited).

## The server

- **Schema.** Two additive, nullable columns on `billing_vouchers`:
  `starter_article_id uuid references articles(id) on delete set null` (for the title in the list)
  and `starter_slug text` (key-free; the starter's identity for a replay, and how a readdress knows
  there *was* a starter after the article is gone — Sol's F2, F3). Never the key.
- **`POST /api/admin/vouchers`** takes an optional `starterSlug`, part of the create's identity.
  1. **Replay first** (F2): if a voucher with this id exists, the create is answered by the existing
     replay comparison, with `starterSlug` compared as given, and nothing about the article's current
     state is looked at. Same body → 200 `replayed`; different → 409.
  2. Otherwise the route resolves the slug **as the signed-in administrator** through the owner's
     existing reads (`ownedSlug`; `serveAuthenticatedApi` sets the owner to the user before the
     admin gate): another owner's article or none is a 400;
  3. refuses (409, a sentence) a starter with nothing published or `minimal`;
  4. public → the plain public address, no key read; private → `shareLinkStore.read(slug)`, and a
     link that is off is a 409 (*make the private link first*). **The route never mints a key.**
  5. hands `{ articleId, slug, title, url }` to `createVoucher`, which stores the id and slug and
     passes `{ title, url }` to `queueGiftEmail` in its transaction. A concurrent create of the same
     id that loses the insert goes down the existing replay path.
- **Readdress** (`PATCH` that really changes the email) queues a new gift email. If the voucher has
  a `starter_slug`, the route resolves it afresh as above, **only when the address actually
  changes**. Established absence (deleted, not this admin's), the link turned off, or no longer
  published → the email goes without the starter paragraph and the answer carries
  `starter: "dropped"`; `useAdminVouchers.update` returns that as a typed result and the page shows
  it (F3). A database failure fails the PATCH, never an email with the paragraph silently missing.
- `PATCH` does not accept `starterSlug` (v1).
- **A failed write cannot carry the key into a log** (F1). Drizzle puts a failed statement's
  parameters in its error message, and the email insert's parameters are the whole email. The
  voucher writes go through the existing `guardDbStore` boundary (src/store/db-errors.ts), which
  scrubs it. Red first: a failed email insert during create and during readdress, with a sentinel
  key, rolls back and the sentinel reaches neither the log, the HTTP answer nor Sentry.
- **Not logged**, the URL above all. The claim notice to Greg does not carry it.
- `GET /api/admin/vouchers` carries `starter: { slug, title } | null`, read by a join on named
  columns, never the key. `latestVoucherEmails` reads status columns only, never the bodies (Sol
  checked); a test pins that.

## Where the key goes, after this

Two new places, both named by the Overseer's brief and nothing else:

1. **`billing_voucher_emails.body_text` / `body_html`**, the kept copy of the email (so a retry
   sends the same bytes). Admin-only table; read by the admin voucher page as status only, never
   the bodies (check this while building, and pin it).
2. **Resend**, which keeps its own log of what it sent; and the recipient's inbox, which is the
   point.

Not in `billing_vouchers`, not in `GET /api/admin/vouchers`, not in a log, not in Sentry. The
`security-map.md` paragraph *Where the key may travel* and `tests/share-link-token-stays-home.test.ts`
change to name these: the route that reads the key for the email is a second caller of
`shareLinkStore.read`, and the test pins the callers of that read so a third is a deliberate
change. `privacy.md` / `/privacy`: a gift email may carry a link to an article; one sentence.

## Stages

1. **Server and email** — schema + migration, `parseNewVoucher` (`starterSlug`), the route's
   resolution, `createVoucher` / `updateVoucher` / `queueGiftEmail` / `giftMessage`, the list's
   `starter`, security-map, the key test, privacy. Red first: a gift email with a starter carries
   the link in text and HTML; without one it matches the goldens; a title with markup arrives as
   text; another owner's slug is refused; a private article with the link off is a 409; the voucher
   row and the list never contain the key; readdress reads the key afresh and drops a starter that
   no longer resolves; replay after the link is turned off, rotated or the article deleted answers
   `replayed` and queues nothing; a different starter under the same id is a 409; a failed email
   insert leaks no sentinel key (F1).
2. **The form** — the picker, its status line and the two links out, *Refresh*, the disabled
   Create with its reason, the sketch, the table's title, the readdress warning;
   `useAdminVouchers`' replay fingerprint includes `starterSlug`. Tests in
   `tests/admin-vouchers-page.test.tsx`: each status, the links' targets, a shelf reload changing
   the status, the fingerprint. Browser check at desktop, iPad and phone widths.

Sol reviews the plan, and the code after each stage.

## Not built, and why

- **The *link no longer opens* note on a sent email** (261007f's option A sketched it). It is a
  nicety, not a defect: a dead link fails closed. A follow-up if Greg wants it.
- **Changing the starter after create.** Changing the name or note sends nothing either; a new
  starter would want a new email, which is a different feature.
- **Minting the link on the server as part of create.** One request instead of two, but it would
  put a second minting path beside the share-link route and its tick-box.
- **Importing and making the link inside the voucher form.** My first draft. Passed over for the
  links out (§ Why the form links out), on Sol's suggestion.

## The simpler option passed over

Option D, Greg sends the link from his own email: nothing built. Passed over because Greg chose A
on 2026-10-07.

## Log

- 2026-10-07: prior-work check. `git log` on `src/store/pg-vouchers.ts`, `pg-voucher-emails.ts`,
  `AdminVouchersPage.tsx`: nothing after the 261007f name stage. No sibling on it.
- 2026-10-07: GPT Sol's plan review ([prompt](261007j-voucher-starter-plan-review-prompt.md),
  [answer](261007j-voucher-starter-plan-review-sol.md)): *build with changes*, no P0. All five
  taken. F1 (P1) a failed email insert could log the key: the guarded boundary. F2 (P1) checking the
  starter before the replay broke replay: replay first, `starter_slug` kept. F3 (P2) a dropped
  starter on readdress needs a typed result to reach the page: done. F4 and F5 (P2) the link and
  import chains would copy delicate client code: taken further than asked, by linking out to the
  add page and the article's card, which is Sol's own simpler version.
- 2026-10-07: **Stage 1 built** by an Opus subagent, not committed. Migration
  `drizzle/20261007110028_billing_voucher_starter_article.sql` (two nullable columns, the FK
  `on delete set null`, and a CHECK `billing_vouchers_starter_has_slug`: an id without its slug
  would make a replay look starter-less). Not applied to the shared local database; the suites
  build their own from this tree's `drizzle/`.
  - **Where it went.** Resolution is a new file, `src/store/voucher-starter.ts` (`resolveStarter`):
    one owner-scoped named-column read of the article, the title from the existing
    `loadArticleIdentity` (the revision's own title, never the owner's rename), the key from
    `pgShareLinkStore.read`, the address from `articleUrl` + `withShareKey`. `createVoucher` runs
    the replay comparison first (`replayOf`, shared with the lost-insert path) and only then
    resolves; `updateVoucher` resolves in its unlocked pre-read when the change will send, and an
    attempt whose locked read disagrees retries rather than send without asking. Both go through
    the injectable `deps.resolveStarter`. The routes call `pgVoucherStore`, a new
    `guardDbStore("vouchers", { listVouchers, createVoucher, updateVoucher })`; the claim stays
    unguarded, since its route already logs the error's name alone. The sketch's line is
    `giftEmailStarterLine` in `src/admin-vouchers.ts`, ready for stage 2; `VoucherUpdated` is the
    PATCH answer's wire type. `useAdminVouchers` is unchanged: its `update` still returns
    `string | null`, and making it return the typed `starter` is stage 2's, with the page.
  - **What the plan did not know.** The new key makes `billing_vouchers` article-scoped by the
    export guard's rule, which drags in `billing_voucher_emails` and `billing_accounts`: all three
    are declared not exported in `src/store/article-rows.ts`. `tests/store-shelf-pg.test.ts` gained
    the voucher as a fifth deliberate `set null` survivor of an article delete. The list shows a
    revision with no stored title by its slug, where the email falls back to the first heading
    (`loadArticleIdentity`); a deleted starter is `{ slug, title: null }`. `LAST_UPDATED` on
    `/privacy` was already 7 October 2026.
  - **Red first.** `tests/voucher-starter.test.ts` (18 cases) went red before any code (400
    *Unexpected field*, missing paragraph). F1 was then watched red for the real reason: with the
    starter built and the routes on the bare functions, both the create and the readdress case
    failed with the sentinel key in the logged Drizzle error (`params: … ?key=SENTINEL…`) and in
    what `captureFailure` was handed; the HTTP body did not carry it. Green after the routes moved
    to `pgVoucherStore`. Five deliberate breaks each failed exactly their test: the replay check
    removed (replay after link off/rotated/deleted), the starter slug out of the replay comparison
    (different starter → 409), the readdress email without the starter (reads the key afresh),
    `sendsGift` always true (unchanged address resolves nothing), `e.body_text` added to
    `latestVoucherEmails` (bodies pin). The privacy clause test was red before the page changed.
    The no-starter goldens in `tests/billing-voucher-emails.test.ts` pass unedited.
  - **Gates.** `npm run typecheck` green; the touched suites green; full `npm test` 1800 of 1806
    files before the export/shelf fixes above, the rest listed in the stage report.
- 2026-10-07: **Stage 2 built** by an Opus subagent, not committed, while Sol reviewed stage 1's
  server files in the same tree (no file in common).
  - **What it is.** `AdminVouchersPage.tsx`: a *Starter article* select after the note (the shelf's
    articles less `minimal`, newest by `addedAt` first, *None* by default) with *Refresh*; *Or import
    one* and an *Import in a new tab* link to `addHref(url)` (Enter in that box follows the link and
    never submits the voucher); a status line per state — linked (*the email will carry it*),
    public (a link to its public page, *no key involved*), no link (*Make one on its page*,
    `readHref(slug, "section=access-sharing", "metadata")`, the bar's own `?section=` address, new
    tab), and, holding Create back, no link, gone from the shelf, abstract-only, or shelf not read.
    Create is disabled with `aria-describedby` on that line, and `submit` refuses too. The sketch
    draws `giftEmailStarterLine(title)`; the table draws *Starter: title* (author's voice) or
    *slug (deleted)*. `useAdminVouchers`: `starterSlug` in `NewVoucherInput` and the fingerprint;
    `update` returns `UpdateAnswer` (`saved` with `starter` or `refused`), and a `dropped` puts
    *Saved. The email to the new address went without the starter article…* in the row.
  - **What the plan did not know.** `useShelf` does not reload on imports by itself: `Library.tsx`
    wires `useJobs("watches-queue", reload)`, and the form does the same, so an import this tab's
    engine sees finish reloads the shelf (one more idle poll while the page is open). A link made in
    the other tab makes no job, so that one is *Refresh*. The shelf never lists an article still
    being imported, so the plan's *still being added* line is the *not on your shelf* state. The
    page reads the reader from `SignedInReader`, which `App` provides around every signed-in page.
    The sketch uses the shelf's title, and the email the revision's own, so a renamed article
    reads differently in the two (said in `EmailSketch`'s comment).
  - **Red first.** 14 new cases in `tests/admin-vouchers-page.test.tsx`, all red before the code
    (no picker, no starter line, no dropped line); the old fixtures gained `starter: null`, the
    wire's real shape. Three deliberate breaks each failed their tests: the slug out of the
    fingerprint (only *mints a new id when only the starter changed*), no-link and the other
    waiting states made ready (the three Create-waits cases), `dropped` not parsed (the readdress
    warning).
  - **Gates.** `npm run typecheck` green; `admin-vouchers-page`, `what-the-enter-key-promises`
    (the import box promises `go`), `doc-links`, `admin-only-routes`, `client-imports`,
    `voices-css` green. Biome on the four files: one info, `VoucherRow`'s complexity 28 (27 at
    HEAD).
- 2026-10-07: GPT Sol's stage 1 code review ([prompt](261007j-stage-1-code-review-prompt.md),
  [answer](261007j-stage-1-code-review-sol.md)): *land with the fixes made*. F6 (P1) a concurrent
  identical create was refused when the starter was not ready; F7 (P1) a readdress could email a
  replacement article imported at a deleted starter's slug, now checked by article id under the
  lock; F8 (P3) a comment. Fixed by the reviewer, red first (`tests/voucher-starter-races.test.ts`),
  gates rerun here: 7 suites, 182 tests. Postmortem `261007n`.
- 2026-10-07: GPT Sol's stage 2 code review ([prompt](261007j-stage-2-code-review-prompt.md),
  [answer](261007j-stage-2-code-review-sol.md)): *land with the fixes made*. Fixed by the reviewer,
  red first: F9 (P1) a lost answer's replay was blocked by the starter's live state; F10 (P1) the
  import box's `type="url"` validation blocked Create; F11 (P1) the sketch drew the author's title
  in the app's font; F12 (P2) a renamed shelf title now says the email uses the original. F13 (P1,
  from before this job) a create's answer cleared a draft typed while it was in flight: reported,
  then fixed here red first (the form clears only the draft it sent). Postmortems `261007o`–`r`.
  Sol on Refresh: enough for the new-tab flow; a reload on focus would be a convenience, not built.
