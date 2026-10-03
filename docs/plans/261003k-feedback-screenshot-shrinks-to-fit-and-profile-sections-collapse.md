# A feedback screenshot shrinks until it fits, and Profile's read-outs start shut

Up: [plans.md](../project/plans.md)

Two small reports from Greg, both filed 2026-10-03 from the Feedback button. One commit each.

## Report 1: the screenshot refused as too big (`spya-wa7wms`, a problem)

> I tried to upload a screenshot to a Feedback report. It wasn't actually very big. I think it was
> like 400KB, but I got an error saying something like the screenshot's too big. This feels like
> something we should be able to address, and I think we should really find a way to allow (if
> necessary auto-resizing) screenshots of at least 5MB?
>
> — Greg, 2026-10-03

### The cause, read from the code

`screenshotFromFile` ([`src/web/feedback-screenshot.ts`](../../src/web/feedback-screenshot.ts))
draws whatever arrives onto a canvas at most 1600px on its long edge, writes it out as a **PNG**,
and refuses the result if it is over `MAX_FEEDBACK_SCREENSHOT_BYTES`, which is 400,000. It tries
once. The dialog's sentence is *"That picture is too big, even after shrinking it."*

So the size of the file the reader picked never mattered. What mattered was how big a 1600px PNG
of those pixels is. A screenshot of flat UI is about 300 KB. A screenshot with a photograph in it
(the Entropy article has a cover image) is one to three megabytes as a PNG, because PNG does not
compress photographs well. A 400 KB JPEG of such a page becomes a multi-megabyte PNG and is
refused. Stage 1 starts by reproducing exactly that in a test.

### What we will do

Two changes, and they need each other.

1. **Shrink until it fits.** After the first encode, if the PNG is over the limit, draw it again
   smaller and encode again, down a short ladder of long edges (1600, 1280, 1024, 800, 640). The
   first that fits is sent. Only if 640 still does not fit is it refused, with the same sentence.
   The target is 90% of the limit, not the limit, because the server's re-encode can come out a
   little bigger than the browser's.
2. **Raise the limit from 400,000 to 2,000,000 decoded bytes.** With the old limit, shrinking
   alone would send a photographic screenshot at about 640px, which cannot be read. With two
   megabytes most screenshots go at 1600 and the rest at 1280 or 1024.

The limit lives in three places that must move together: `MAX_FEEDBACK_SCREENSHOT_BYTES` in
`src/types.ts`; the `feedback_screenshot_size` CHECK in `src/db/schema.ts`, which writes the number
out; and a new migration that drops and re-adds that CHECK. The route's body limit is derived from
the constant and moves by itself: about 2.67 MB of base64 plus under 0.3 MB of everything else,
inside Vercel's 4.5 MB request limit.

**Why 2 MB and not Greg's 5 MB.** His 5 MB is about the file he *picks*, and that already has no
limit: any image the browser can decode is accepted and shrunk. The number here is what we store
and send on. 5 MB decoded is 6.7 MB of base64, which Vercel refuses before our code runs.

The server's pixel limits (`MAX_SCREENSHOT_EDGE` 4096, `MAX_SCREENSHOT_PIXELS` 4,000,000) do not
change: 1600 × 1600 is 2.56 million.

### What it costs

- A stored screenshot may be five times bigger. One row per report that has a picture, and reports
  are a few a day. Not a concern at this size; named so it is a decision.
- The migration relaxes a CHECK. It is additive: every existing row passes the new one.
- A very tall photographic page can still be refused at 640. Accepted; it was every photographic
  page before.

### The simpler option passed over

Raise the limit only. It fixes Greg's case and leaves the same cliff further out, with the same
sentence claiming "even after shrinking it" about a single attempt. The ladder is about fifteen
lines.

Sending a JPEG instead would make the files small without shrinking them, but the server refuses
JPEG on purpose (`src/feedback-image.ts`: it cannot be rebuilt from its raster without a decoder),
and that is a defence. Not touched.

### Done looks like

- A test in `tests/feedback-screenshot.test.ts`, red first: a canvas whose 1600px PNG is over the
  limit and whose 1280px one is under it comes back `ok` at 1280. A second: nothing fits, and the
  outcome is `too-big`.
- `tests/feedback-route.test.ts` and `tests/feedback-image.test.ts` still pass with the new number,
  and the largest-valid-body test still posts through.
- `docs/project/feedback.md` § The screenshot says the picture is shrunk until it fits, and the
  number. The comments that say "400 KB" or "~300 KB" are corrected where they are now wrong.
- The migration applied locally, its `Target:` line read.

## Report 2: Profile's sections, shut by default (`spya-ka3cau`, a suggestion)

> In the meta data page, we have a nice table of contents on the left-hand side, I think with a
> search bar as well. And most of the sections are default collapsed, except for the important
> ones. Let's consider doing the same thing for the profile page. So the important ones that we
> should keep open are probably account, plan, and about you. And then I think the others could
> perhaps be default collapsed.
>
> — Greg, 2026-10-03

### What we will do

Profile has six sections. **Account, Plan and About you stay open and are not collapsible.
Settings, Recently read and What's running become collapsible and start shut.** Each shut heading
is a button with a chevron, exactly as on Metadata.

**One `Section`, not two.** Metadata's `Section` (in `src/web/Metadata.tsx`) already does this, and
carries a fix for a latch bug with its own postmortem (260903d). ProfilePage has a private
`Section` that is the same heading with an icon and no folding. So:

- Move Metadata's `Section` and `sectionId` to a new `src/web/PageSection.tsx`, unchanged except
  for one new optional prop, `icon`, drawn in place of the highlight bar when given. Metadata
  imports it from there. `tests/metadata-section-param.test.tsx` imports `Section` from
  `Metadata.js`, so Metadata re-exports it or the test's import moves; the mover picks whichever
  is the smaller diff.
- ProfilePage's own `Section` is deleted and the page uses the shared one, with `keywords` for
  each (the prop is required).
- **Settings is `keepMounted`**: its controls save themselves, and unmounting one mid-save is the
  hazard the prop exists for. The other two are read-outs fed by fetches the page itself owns, so
  they can unmount.

### What is left out, as a question for Greg

**The contents list and search box in the left margin.** The report describes them and then asks
for the folding. On Metadata they earn their place because there are about fifteen sections and
the page is several screens long. Profile will be six headings, three of them shut, on about one
screen. Because the sections will carry `data-section`, adding the list later is one line and a
margin class. It goes in the debrief as `[Q-profile-contents-list]` with a recommendation to leave
it off.

### Done looks like

- A test, red first, that renders `ProfilePage`: Account, Plan and About you have no
  `aria-expanded` button and show their bodies; Settings, Recently read and What's running each
  have a heading button with `aria-expanded="false"`, and pressing it shows the body.
- The existing Metadata tests pass unchanged in what they assert.
- A browser check at desktop, iPad and phone widths, by a Sonnet subagent.
- `docs/project/reader-profile.md` (or whichever doc owns the `/profile` page) says which sections
  start shut, and `web-client.md` § Shared code names `PageSection.tsx`.

## Stages

1. The screenshot. Commit.
2. The Profile sections. Commit.

Each gets `npm test` on the files touched, `npm run typecheck`, and one GPT Sol code review
covering both, since both are small. Then the two feedback notes.

## GPT Sol's plan review, 2026-10-03: build with changes

It confirmed the diagnosis and the arithmetic (request body at most 2,921,458 bytes against
Vercel's 4.5 MB; Sentry's envelope at most about 17.9 MB against 20 MB). Five findings, all taken:

- **F1 (P1): the server's re-encode would block for seconds.** `reencodeScreenshot` deflates at
  level 9, synchronously. Sol built a 1280 × 1280 PNG of 1.3 MB and measured 15 seconds at level 9,
  1.3 seconds at level 6 (the same size to within 0.1%), 0.4 seconds at level 3 (20% bigger). The
  old limit never let a picture that large in. **So stage 1 also drops the level to 6**, and
  measures it again on a near-ceiling picture before settling.
- **F2 (P2): the "largest report" test would stop testing the ceiling**, because its picture is
  about 380 KB. Stage 1 adds a real PNG near the new ceiling through the route. And three existing
  Profile tests read a section body that will now be shut; stage 2 opens it first.
- **F3 (P2): the 90% target applies to every attempt, the first included**, as
  `<= floor(limit × 0.9)`. It is measured headroom, not a guarantee; the server still checks.
- **F4 (P3): Settings does not need `keepMounted`.** Its saves live in an external store
  (`experimental-store.ts`) and Appearance saves on the device, so unmounting cancels nothing.
  Dropped; this supersedes the bullet above.
- **F5 (P3): the move needs a wider sweep.** `sectionId` is called outside `Section` in
  Metadata.tsx and has to be exported; comments in PageContents.tsx, params.ts, the CSS and
  RefereeMode name "Metadata.tsx § Section" and move with it.

## What landed

### Stage 1, the screenshot

Built as planned, with Sol's changes. The tests were red first, five of them.

- `screenshotFromFile` walks 1600, 1280, 1024, 800, 640 and sends the first PNG at or under 90% of
  the limit. A picture that arrives smaller than 1600 starts at its own size.
- The limit is 2,000,000 in `src/types.ts`, the schema's CHECK, and migration
  `20261003160244_feedback_screenshot_size_two_megabytes.sql`. Applied to the local database only.
- The server's deflate went from level 9 to 6. Measured on the box, on the worst raster found
  (1600 × 1600, two values a channel): 46.7 s at level 9, 2.1 s at 6 and 12% bigger, 0.6 s at 3 and
  46% bigger. Photographic rasters took about a quarter of a second at every level.

**One thing the plan said that is false.** "A very tall photographic page can still be refused at
640" cannot happen: 640 × 640 × 4 is 1.64 MB of raw pixels, under the 1.8 MB target, so anything
fits at the bottom rung. The refusal is now a backstop only, and a test sends a 3200 × 3200 square
of pure noise through at 640 to show it.

**Known and left**: level 6 still blocks the request for about two seconds on that worst raster. No
real screenshot looks like it, but a signed-in caller could build one. Moving the deflate off the
thread is the fix if it is ever seen.

### Stage 2, Profile's sections

Built as planned. `Section` and `sectionId` live in `src/web/PageSection.tsx`; Metadata and Profile
both import them. The collapse test was red first on the three shut sections.

The browser check (Playwright, 1280, 820 and 390 wide) passed: three open, three shut, each opens
and shuts by click, Enter and Space, a changed setting survives shutting, nothing overflows, and
Metadata's contents list still opens and scrolls to a shut section. It did not confirm the flash,
which had finished by the time it looked.

**A bug it tripped over, fixed in this stage.** Every row of What's running read
*"claude-sonnet-5 · OpenRouter (undefined)"*. The page printed a `wire` field that
`GET /api/models` had never sent. The route now sends it for the rows that have one, and the page
prints the parenthesis only when it is there. Red first, in the same test file. This is why
`src/routes.ts` is in the stage 2 commit, and its one comment fix for stage 1 rides with it.

**Seen and left**: the shut headings are 14px tall, which is small under a thumb. It is the
Metadata page's heading exactly, so changing it is a change to both pages.

### GPT Sol's code review, 2026-10-03: ship with its fixes

It reviewed `40f7a082b` and `0becf8dc7` and found no P0 or P1. Its three fixes are in the commit
after them:

- **C1 (P2)**: the "(undefined)" test supplied `wire` itself, so deleting the server's half left
  every test green. It added an assertion on the real `GET /api/models` reply, seen red with the
  assignment removed, and wrote
  [the postmortem](../postmortems/261003d-a-consumer-fixture-asserts-a-field-its-producer-never-emits.md).
- **C2 (P2)**: the near-ceiling route test checked header and size but not pixels. Now it compares
  the pixels, and there is an offline test of the same in `tests/feedback-image.test.ts`.
- **C3 (P3)**: a comment called the raster bound the request's total memory.
- **C4 (P2), reported and left**: the synchronous deflate, already named above.

It confirmed the moved `Section` behaves as the original, and that a picture the client passes and
the server refuses still gets the server's sentence with the draft kept. I re-ran the Postgres
suites it could not: 8 files, 565 tests, and typecheck, all passing.
