# The Chrome extension

Up: [architecture.md](architecture.md). One click adds the page in the current tab to Spideryarn,
**as the reader's browser shows it**, so a site that turns our server away but lets the reader in
still comes through. Built 2026-10-24 for Greg's report `spya-xsfrsg`; the plan, its reviews and
the spike are [261024q](../plans/261024q-chrome-extension-one-click-add-the-page.md), the research
(Manifest V3, the store, updates) is
[261024c](../research/261024c-chrome-extension-mv3-store-and-updates.md).

> I think increasingly I would like to have a Chrome extension for Spideryarn that I can install, so
> it will be one click to add an article to Spideryarn.
>
> — Greg, 2026-10-23 (`spya-xsfrsg`)

## In this doc

- [§ How it works](#how-it-works) — the handoff, and why the extension holds no secret
- [§ Where the code is](#where-the-code-is)
- [§ Checking it](#checking-it) — the tests, and a real Chromium on the box
- [§ Publishing](#publishing) — the one-time store setup (Greg's), and every update after it
- [§ What it does not do yet](#what-it-does-not-do-yet)

## How it works

```
 the reader presses the button on a tab
   └─ capturePage() runs in that tab only (activeTab): the bookmarklet's own function
        (src/web/save-page-bookmarklet.ts) — the DOM as rendered, addresses made absolute,
        scripts / hidden and password fields / CSRF metas removed, a saved-from meta added
   └─ a blank tab opens beside it; the page is stored in the extension's IndexedDB under that
        tab's id; only then is the tab sent to /add-from-extension
 /add-from-extension (src/web/AddFromExtension.tsx), the reader's own session
   └─ chrome.runtime.sendMessage(<an id it trusts>, { type: "spideryarn.take" })
        the extension answers only the top frame of that very tab, at that path, on our origin,
        once, within 15 minutes
   └─ a File → uploadEngine.send() → /add/upload/<id>, the add page with its purpose box
```

**The extension holds nothing of the reader's**: no token, no cookie, no key, and it never calls
our API. The receiving page uploads with the session it already has, through the upload every
file takes ([ingest-queue.md § Uploading a PDF](ingest-queue.md#uploading-a-pdf)). So the new
untrusted input, the page's HTML, arrives where an uploaded file already arrives, and is treated as
one ([security-map.md](security-map.md), party 1).

The checks, each held by `tests/extension-handoff.test.ts` with a positive control beside it:

- **Who may ask.** Chrome refuses any page not on an origin in the manifest's
  `externally_connectable` (measured: such a page has no `sendMessage` at all) and every other
  extension. The extension then wants the top frame (`frameId` 0) of the tab it opened, at exactly
  `/add-from-extension`, on exactly one of its origins.
- **Whom the page asks.** Only the ids compiled into it (`trustedExtensionIds` in
  [`src/web/extension-handoff.ts`](../../src/web/extension-handoff.ts)), never one from the
  address: any extension can name our origin in `externally_connectable` without a warning. The
  production build never trusts the dev id, whose key is public.
- **For whom it uploads.** The page is an add visit (a change of reader stops it), keyed on the
  reader, and sends only if it is still mounted and the upload engine and the tab both still hold
  the reader it mounted for (`receive` in AddFromExtension.tsx). A reply that arrives after a change
  of reader uploads nothing.
- **Twice.** A second press on the same page focuses the tab the first one opened, for 15 minutes
  or until that tab closes. Back to `/add-from-extension` in the same tab sends nothing again.
- **Size.** The upload's 50 MiB, and 60 MiB of JSON, because Chrome carries messages as JSON
  capped at 64 MiB and a quote is two characters of it. A 47 MB page took about 4 s end to end.

What Chrome's PDF viewer captures is a 159-character wrapper, so a PDF tab (`contentType`
`application/pdf`) goes to `/add/<its address>` instead, for our server to fetch. A page Chrome
forbids (`chrome://`, the Web Store) puts `!` on the button and says why in its tooltip.

## Where the code is

| | |
|---|---|
| [`extension/manifest.ts`](../../extension/manifest.ts) | the manifest for each flavour, the version, the dev key and id. **Permissions are `activeTab` and `scripting`, nothing else**; a test fails on any other |
| [`extension/src/handoff.ts`](../../extension/src/handoff.ts) | every decision: what a press does, who may take a page |
| [`extension/src/store.ts`](../../extension/src/store.ts) | IndexedDB, one transaction per call |
| [`extension/src/background.ts`](../../extension/src/background.ts) | the service worker: Chrome's events wired to the two above |
| [`extension/store/listing.md`](../../extension/store/listing.md) | the words for the store dashboard, field by field |
| [`scripts/build-extension.ts`](../../scripts/build-extension.ts) | `npm run extension:build`: `extension/dist/{production,dev}/` and the production zip |
| [`scripts/publish-extension.ts`](../../scripts/publish-extension.ts) | `npm run extension:publish`: upload and submit, through the store's API |
| [`src/web/AddFromExtension.tsx`](../../src/web/AddFromExtension.tsx), [`src/web/extension-handoff.ts`](../../src/web/extension-handoff.ts) | the page that receives |

**Two flavours from one source.** *Production* talks to `https://www.spideryarn.com` and carries no
`key` (the store assigns the id). *Dev* talks to one local dev server
(`npm run extension:build -- --dev-origin=http://localhost:5275` when yours is not on 5273) and
carries a public key that pins its id to `mgaelddegjfaooojhjaijcnkambbcaea`, which a dev build of the
web app trusts. Load it in Chrome at `chrome://extensions` → Developer mode → Load unpacked →
`extension/dist/dev`.

## Checking it

`npx vitest run tests/extension-handoff.test.ts tests/save-page-bookmarklet.test.ts`. And in a real
browser, on the box: branded Chrome no longer loads unpacked extensions from the command line, so
use Playwright's Chromium with `--load-extension`. **A button press can be made without a mouse**:
connect over CDP and send `Extensions.triggerAction {id, targetId}` with the *tab* target's id
(`Target.getTargets` with `filter: [{type: "tab"}]`), and with `--enable-unsafe-extension-debugging`
on the command line. It grants `activeTab` exactly as a click does. The plan's § Stage 0 has the
spike and its numbers.

## Publishing

### Once, by Greg

1. **A developer account**: https://chrome.google.com/webstore/devconsole, signed in as the Google
   account that should own it, with 2-step verification on. Pay the one-time fee, verify the
   contact email.
2. **The item**: *New item*, upload `extension/dist/spideryarn-extension-<version>.zip`. Fill the
   *Store listing* and *Privacy practices* tabs from
   [`extension/store/listing.md`](../../extension/store/listing.md), *Distribution* → Unlisted, and
   press *Submit for review*.
3. **Tell an agent the item id** (the 32 letters in the dashboard's address and on the item's
   page). It goes into `PRODUCTION_EXTENSION_ID` in `src/web/extension-handoff.ts`, and the web app
   is deployed, so that production asks the published extension. Until then the extension
   installs but the Spideryarn tab says it did not answer.
4. **For updates without the dashboard** (optional): in Google Cloud, a project with the *Chrome
   Web Store API* enabled and a service account with no roles; its email added under *Account* in
   the store dashboard; a JSON key for it downloaded to a path outside the repo, `chmod 600`. Then
   `CWS_SERVICE_ACCOUNT_KEY=<that path>` and `CWS_PUBLISHER_ID=<the dashboard's publisher id>` in
   the shell that publishes. Not in `.env.local`, which agents read.

### Every update

Bump `EXTENSION_VERSION` in `extension/manifest.ts`, `npm run extension:build`, then
`npm run extension:publish` (it refuses unless the version is above the store's, and submits only
an upload the store says succeeded). Or upload the zip in the dashboard by hand. Each update is
reviewed, usually within days; Chrome then installs it for every reader by itself within hours.
**An update that adds a permission disables the extension until each reader accepts it**, so a
new permission is a product decision, not a line in the manifest.

## What it does not do yet

- **Repeat after the article exists.** A press on a page already on the shelf uploads it again
  (a second article, a second slot) unless the first tab is still open. The fix is a read-only,
  owner-scoped lookup before uploading, which is a server change and was asked of Greg.
- **A passage selected, then a chat about it**, and **why you are reading it, asked on the
  publisher's page**: Greg's later ideas. The add page the extension lands on already has the
  purpose box.
- **Firefox, Safari, Edge.** Edge takes the Chrome package from its own store; Firefox needs small
  changes; Safari needs Xcode.
