---
reports: spya-xsfrsg
ending: shipped
comment: Built on dev: a Chrome extension whose one press adds the page as your browser shows it, walls included. It reaches you once you put it in the Chrome Web Store; the steps, and one choice, are in the question.
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

**Ending: Shipped** to `dev` (not deployed). Plan, reviews and spike:
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
once Greg has created it (`qi-4ma69gtp`); a repeat press on a page already on the shelf opening it
rather than adding it again, which needs a server route and is asked (`qi-mpjegxhn`); select a
passage and arrive in a chat about it (`qi-wqxwwxsx`).

Asked: [q-d5ucbd](questions/q-d5ucbd.md) — do the store step (with exact steps), and whether to
build the repeat check.
