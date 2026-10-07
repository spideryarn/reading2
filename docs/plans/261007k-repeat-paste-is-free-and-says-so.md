# A repeat paste of an article you already have is free, and says so

Queue item `qi-yxr67qkz`, from Q-repeat-paste-slot (raised by plan
[261006i](261006i-an-article-is-found-by-the-address-it-was-asked-for-and-a-redirect-that-ends-on-a-paper-source-imports-the-paper.md)
as its K2).

> yes repeat pastes should be free (and signal they're a repeat in the UI)
>
> — Greg, 2026-10-06

## What happens today

`POST /api/jobs { url }` always goes through `withIngestSlot`
([src/routes.ts](../../src/routes.ts)). When the address finds one of the reader's own published
articles (`slugForUrlKey`, [src/store/find-article.ts](../../src/store/find-article.ts)),
`freeSlug` adopts that article's slug, the job runs `DEFAULT_INGEST_STEPS`, every step skips on its
cache, and the publication charges the reservation. So the reader spends one import slot on a job
that "publishes nothing" ([ingest-queue.md](../project/ingest-queue.md)) and the add page then opens
the article as though it had just been imported. [billing.md](../project/billing.md) records this
as *"a re-added URL adopts the shelf's article and charges again … Defensible"*.

## The change

**Server.** In the `POST /api/jobs` handler, before `withIngestSlot`, a plain add — a `url` with no
`steps` and no `force` — asks `slugForUrlKey(urlKey(url))`. If the reader already has the article,
the route answers **200 `{ article: <slug>, repeat: true }`**: no reservation, no job, no work. This
is the same shape the upload path already answers when a file turns out to be an article
(`queueAnUpload`), so the add page already treats it as a completion.

- `{ url, force }` / `{ url, steps }` keep today's path. No client sends them, but they ask for
  work, and short-circuiting them would silently drop it.
- An address with a **live job** (not yet on the shelf) is unchanged: `enqueueOrGet` already hands
  back that job, and `withIngestSlot` releases the second reservation.
- Archived articles are found too (the lookup has never filtered them), and are readable by their
  link with *Put back* on the masthead, so taking the reader there is right.
- The lookup is a read outside the billing lock. That is safe in both directions: a hit spends
  nothing and does nothing, so there is nothing to race for; a miss falls through to the existing
  locked admission. An article that publishes in between is charged exactly as today.
- The admin path is unaffected (it never reserved).

**Add page** ([src/web/AddPage.tsx](../../src/web/AddPage.tsx)). The `{article}` answer is already
recorded as `articleAnswer` and becomes a completion. For a repeat, the page **stops at its `ready`
phase** instead of opening the article by itself, with one sentence above the existing **Open the
article** button: *"This article is already on your shelf, so adding it again cost nothing."*
Stopping is the signal; opening at once would show the reader nothing they could notice. One press
takes them there.

**Hover card** ([src/web/ProseHoverCard.tsx](../../src/web/ProseHoverCard.tsx)). Its *add to
Spideryarn* would today read `started.id` off the `{article}` answer and sit on "Adding" for ever.
It gets a fourth `Asked` kind, `already`, drawn as the existing `added` state, and refreshes the
shelf so the card turns into "read it here".

**MCP** ([src/mcp/tools.ts](../../src/mcp/tools.ts)). `import_article` adds the article link when the
answer is `{ article }` as well as when it is a job.

**Docs.** billing.md's "charges again" line gets Greg's decision; the "N ingest rows" line under
High-powered becomes historical; ingest-queue.md's "a re-add … publishes nothing" names the free
answer. Check billing.md § *The quota, and the one thing it has to survive* still holds: it does,
because a repeat answer reserves nothing and starts nothing.

## Tests, red first

1. `tests/billing-admission.test.ts`: a published article on the shelf at `HOST/repeat`; at the
   ceiling (`alreadySpent(FREE_LIMIT)`), `POST { url: HOST/repeat }` answers 200
   `{ article, repeat: true }`, the ledger is unchanged, and no job row exists for the owner. Red
   today (402 at the ceiling; 202 and a slot below it). A second case: `{ url, force: ["fetch"] }`
   still reserves.
2. An AddPage test: a `{ article, repeat: true }` answer shows the repeat sentence and the Open
   button and does not navigate; a plain `{ article }` (the upload retention path) still opens by
   itself.
3. `describeAdd` / hover card: an `{article}` answer does not leave the card on "Adding".

## The simpler option passed over

**Keep the job, just don't charge it** — reserve nothing for an adopted-from-shelf allocation inside
`enqueue`. Fewer client changes, since every caller still gets a job. Passed over because the job
does nothing (every step skips), the decision would move inside `enqueue`, which billing.md § *Which
requests spend a slot* says is the wrong place for it, and the reader would still see an import
"run" for an article they already had, which is the opposite of the signal Greg asked for.

## Plan review (GPT Sol, `261007k-plan-review-sol.md`)

The route short-circuit was judged safe after parsing, with no new way to get free model work. Four
P2s, all taken:

1. *"Queueing it…" stays up over an `{article}` answer, and the import boxes are still offered.*
   The line now waits for no completion, and a repeat offers no boxes (auto-modes, High-powered,
   purpose, the sharing row's offer).
2. *"Every step skips" is not always true*: a repeat paste could rebuild a stand-in tree, or re-run
   a step whose stamp had gone stale. Accepted as a loss and written down in ingest-queue.md: the
   reading view has **Build it** for a tree that never arrived, and step re-runs are free. Keeping a
   free job for the repeat would keep this, but the route's look is outside the billing lock, so an
   article deleted between the look and `enqueue` would make it a free full ingest.
3. *`useJobs.add` must carry the union.* It now answers `Job | AlreadyAnArticle | null`, with
   `repeat?: true` on `AlreadyAnArticle`, so the compiler found the hover card's `started.id`.
4. *A shelf refresh cannot be relied on to turn the hover card into "read it here"*: the card's
   shelf misses papers found by the asked-for link, and archived articles. The card keeps the slug
   from the answer instead (`Asked` kind `have`) and links to it.

## Code review (GPT Sol, `261007k-code-review-sol.md`, write-capable)

No finding on the route. Sol fixed four things in place, each with a test it saw fail first:

1. The hover card's URL-keyed `asked` map outlived a change of reader, so reader B could be shown
   reader A's repeat article. It is now cleared on a reader change, and a late answer is
   discarded by generation. Postmortem `261007n`.
2. A slow repeat answer hid a purpose the reader had already typed, and any save failure with it.
   A touched or unsaved purpose now stops at `ready`, which says the repeat sentence and keeps the
   save-and-open flow. Postmortem `261007o`.
3. A High-powered tick made before the answer still sent its PUT, but the control vanished. It
   stays up over a repeat when it is not off, with a line that fits a repeat.
4. website-text.md and reader-profile.md still described a re-add as charged or as opening by
   itself; corrected, with the test names that said the same.

## Browser check (Sonnet, the box, Playwright)

`/add/https://paulgraham.com/desres.html` for an article already on the dev reader's shelf, at
1440, 820 and 390 wide (`261007k-shot-*.png`): the sentence and **Open the article**, nothing else;
no overflow; the button opens the reading view. It found one fault, fixed and tested: the
*"text has been sent to a third-party model provider"* line still showed over a repeat, which sent
nothing.

## Status

- [x] Plan reviewed by GPT Sol
- [x] Server change + test (red: 402 at the ceiling)
- [x] Add page, hover card, MCP + tests (each watched red with its branch switched off)
- [x] Docs
- [ ] Code review by GPT Sol
- [ ] Browser check at desktop, iPad, phone
