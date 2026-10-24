# A Chrome extension: Manifest V3, the Web Store, and updates

Up: [research.md](../project/research.md). For plan
[261024q](../plans/261024q-chrome-extension-one-click-add-the-page.md), Greg's report `spya-xsfrsg`
(2026-10-23): *"You may want to do some web searching to see the best practices on how to do this.
And, you know, ideally make it so that we can update relatively seamlessly."*

The web search was a Sonnet subagent's, 2026-10-24, against developer.chrome.com. **Verified** below
means a primary source says so; **unverified** means memory or a third party, and the ones that
matter to the design are measured in the plan's Stage 2 rather than trusted. The earlier survey of
how other read-later tools get past walls is
[261015a](261015a-getting-a-page-behind-a-bot-check-extensions-bookmarklets-open-access-copies.md):
the ones that work take the page from the reader's own browser.

## Permissions and the service worker

- **`activeTab` + `scripting`, no host permissions**, is enough to run a function in the tab the
  reader clicked on, until they navigate to another site
  ([activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)). Neither,
  nor `storage`, shows an install warning
  ([permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list),
  [warnings](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings)).
  `tabs` would ("Read your browsing history"), and is not needed: `activeTab` gives the clicked tab's
  URL.
- **The service worker is stopped after 30 s idle** and its globals go
  ([lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
  A capture waiting for a reader to sign in must be stored. `chrome.storage.session` is the usual
  place, but its quota is small (10 MB by memory, unverified) and a page can be 50 MB, so the plan
  uses the extension's own IndexedDB.

## Handing a page to our own tab

- **Message size: 64 MiB**, verified
  ([messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)). Our cap is
  50 MiB of bytes; a string of that many UTF-16 units is more once serialised, so the round trip is
  measured at the cap, not assumed.
- **`externally_connectable`** with `matches: ["https://www.spideryarn.com/*"]` lets exactly that
  origin call `chrome.runtime.sendMessage(EXTENSION_ID, …)`; no other page can, and leaving `ids`
  out stops other extensions
  ([manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)).
  **The extension cannot push to a page; the page must ask** (same messaging page), which is why our
  page asks on load. `sender.url` and `sender.tab` are supplied by Chrome; `sender.origin`
  is unverified from the page and checked in the spike.
- **A stable id for development**: the manifest's `key` field; once the item exists in the
  dashboard, its public key makes an unpacked build carry the store id
  ([key](https://developer.chrome.com/docs/extensions/reference/manifest/key)). Before that, a
  locally generated key gives a stable dev-only id.
- **Unverified, measured in the spike**: whether `externally_connectable` works for an unpacked
  build; the largest `executeScript` return; what Chrome's PDF viewer and the Web Store answer.

## Remote code

All code must ship in the package; remotely hosted JavaScript is against policy. Calling a web
service and a function passed to `executeScript` are fine
([improve security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)).
Extension pages' CSP allows only `self` scripts. The plan's extension has no pages at all.

## The Web Store

- **Account**: a one-time fee (the amount is shown at sign-up; $5 by memory), a verified contact
  email ([set up](https://developer.chrome.com/docs/webstore/set-up-account)), **2-step
  verification on the Google account** to publish or update
  ([using the API](https://developer.chrome.com/docs/webstore/using-api)). New publishers get two
  item slots ([2026 review updates](https://developer.chrome.com/blog/cws-review-updates-2026)).
- **Listing**: a 128×128 icon, at least one 1280×800 screenshot, a description and category; an
  optional 440×280 tile ([listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)).
- **Privacy tab**: a single-purpose sentence, a justification for every permission, data-use
  disclosures that match a privacy-policy URL, and "No, I am not using remote code"
  ([privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)). Reading a whole page
  is sensitive and is disclosed plainly.
- **Visibility**: public, unlisted (anyone with the link), or private (named testers); the same
  review for all ([distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)).
  Unlisted suits a beta.
- **Review**: usually a few days, up to a few weeks; longer for new developers, broad host
  permissions, and large or minified code; obfuscation refused
  ([review](https://developer.chrome.com/docs/webstore/review-process)). Asking for nothing but
  `activeTab` is the shortest path through it.

## Updating

- Chrome checks on start and every few hours, and installs a published update without asking
  ([lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle)).
  Every update is reviewed; one that adds a permission disables the extension until the reader
  accepts it ([update](https://developer.chrome.com/docs/webstore/update)) — so v1 asks for what
  it will need, and no more.
- **The Chrome Web Store API v2** uploads and publishes (`…/items/ID:upload`, `:publish`,
  `:fetchStatus`), and **accepts a service account**: one per publisher, added under Account in
  the dashboard, with no Cloud roles
  ([API](https://developer.chrome.com/docs/webstore/api),
  [service accounts](https://developer.chrome.com/docs/webstore/service-accounts)). The first
  version is uploaded by hand; the version must go up each time.
- `chrome-webstore-upload` (npm) speaks v2 but takes an OAuth refresh token, not a service account
  ([repo](https://github.com/fregante/chrome-webstore-upload)). Three `fetch` calls with a
  service-account token need no dependency, so the plan writes those.

## Portability

Edge installs Chrome extensions largely unchanged; Firefox supports MV3 with differences
(unverified). Not in v1.
