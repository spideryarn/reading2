---
reports: spya-xsfrsg
ending: shipped
comment: In the Chrome Web Store (Unlisted) and wired into production. Help, the command bar and a refused import now point to it. Still to come: select a passage and arrive in a chat about it.
---
# A Chrome extension: one click adds the page you are reading

`spya-xsfrsg` (#682, SPIDERYARN-READING2-NE), a suggestion from Greg (admin;
`feedback-reporter.ts` exit 0 on the production row; no addenda when re-read before this note),
filed 2026-10-23 22:31 UTC from an article's Learn mode. Queue item `qi-64ngfhks`, session
`fbxsfrsg-chrome-extension`.

> I think increasingly I would like to have a Chrome extension for Spideryarn that I can install, so
> it will be one click to add an article to Spideryarn. […] maybe the V1 is simpler, and it's just
> add this to Spideryarn. And I guess one advantage of doing that is that there are some articles
> that are behind a kind of captcha that checks I'm a human […] So I'm hoping that if we did it via
> the extension, it would pass the captcha and then hand it off to Spideryarn somehow.
>
> I've never built a Chrome extension before. […] I'm hoping you can do most of it yourself, and
> then just I'll do the final stage. […] ideally make it so that we can update relatively
> seamlessly.

**Ending: Shipped** (2026-10-25; it was Awaiting Greg for the store step until then — see the
replies below). Plan, reviews and spike:
[261024q](../plans/261024q-chrome-extension-one-click-add-the-page.md); research:
[261024c](../research/261024c-chrome-extension-mv3-store-and-updates.md); the doc:
[chrome-extension.md](../project/chrome-extension.md).

What was done:

- **The extension** (`extension/`): one press runs the bookmarklet's own capture in that tab
  (`activeTab` and `scripting` only, no install warning), opens a Spideryarn tab beside it, and
  that tab uploads the page with the reader's own session through the ordinary upload, landing on
  the add page with its purpose box. The extension holds no secret and never calls our API.
- **Reviewed and hardened**: GPT Sol's plan review (*REWORK*, nine findings, all taken) — the
  handoff bound to the reader it was opened for, a frame or another tab cannot take a page, the
  store write is atomic, a second press focuses the first tab, a page whose JSON exceeds Chrome's
  message cap is refused. Then the code review (see the plan).
- **Seen working** in Playwright's Chromium on the box against a local server, the button pressed
  through Chrome's `Extensions.triggerAction`: article in about 7 s with *Saved from*; a second press
  makes no second article; signed out, through sign-in and on; `chrome://` refused with a badge.
- **For the store**: the listing and privacy wording (`extension/store/listing.md`), a paragraph on
  `/privacy`, a build that makes the zip, and `npm run extension:publish` for updates through the
  store's API with a service account.

Left, each with its own queue entry: wiring production to the store item's id and a Help section
once Greg has created it (`qi-4ma69gtp`); select a passage and arrive in a chat about it
(`qi-wqxwwxsx`).

Asked: [q-d5ucbd](questions/q-d5ucbd.md) — do the store step (with exact steps), and whether to
build the repeat check.

**2026-10-24, Greg's reply `spya-fs5wyy`:** *"Yes let's do 1A when I'm back in front of my
computer. Keep this report open. 2A"*. So:

- **2A built** on `dev`: a press on a page the reader already has offers that article (*already on
  your shelf, so adding it again cost nothing*, and *Open the article*) and uploads nothing. A
  read-only, owner-scoped `GET /api/library/by-url` over `slugForUrlKey`, asked by the receiving
  page with the address the capture carries. Plan and reviews:
  [261024y](../plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md). This took
  queue item `qi-mpjegxhn`, dropped in its favour.
- **The ending is now Awaiting Greg**, at his word: the report stays open until he has done the
  store step (1A) and sent the item id, which `qi-4ma69gtp` then wires in. q-d5ucbd stays open and
  now asks only that.

**2026-10-25, the store step done.** Greg submitted the item (Unlisted; id
`eeedpogihlbbjghpanopajebiencekak`) and sent the id. Reply `spya-bk5etj` to q-d5ucbd: *"I think
you should have received it right now."* So:

- **Wired**: `PRODUCTION_EXTENSION_ID` set in f4d796440 and 59000f581, deployed in 4b0d4dd3.
- **Findable, not pushed** (`qi-4ma69gtp`'s Help half, and more), at Greg's word: *"I don't think
  we want to push it because it's only worth them using the extension if they need it"*. Three
  places, each taking its link from that one constant: a block in Help's *Adding an article*; a
  typed-only *Chrome extension* row in the command bar that opens it; and a sentence on the add
  page, above the bookmarklet, only when a site turned our server away in a way the extension gets
  round. Plan and reviews:
  [261025b](../plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md).
  On `dev`; the next deploy makes it live.
- **Ending: Shipped.** q-d5ucbd answered. The one half not built, a passage to a chat, keeps its
  own queue entry (`qi-wqxwwxsx`).
