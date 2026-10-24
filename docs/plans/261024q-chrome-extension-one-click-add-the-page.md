# A Chrome extension: one click adds the page you are reading

Up: [plans.md](../project/plans.md). Report `spya-xsfrsg` (#682, SPIDERYARN-READING2-NE), an admin
suggestion from Greg, 2026-10-23; queue item `qi-64ngfhks`, session `fbxsfrsg-chrome-extension`.
Research: [261024c](../research/261024c-chrome-extension-mv3-store-and-updates.md).
Before it: the bookmarklet
([261017b](261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md)) and the
saved page keeping its address
([261018j](261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md)).

> I think increasingly I would like to have a Chrome extension for Spideryarn that I can install, so
> it will be one click to add an article to Spideryarn. […] maybe the V1 is simpler, and it's just
> add this to Spideryarn. And I guess one advantage of doing that is that there are some articles
> that are behind a kind of captcha that checks I'm a human […] So I'm hoping that if we did it via
> the extension, it would pass the captcha and then hand it off to Spideryarn somehow.
>
> I've never built a Chrome extension before. […] I'm hoping you can do most of it yourself, and
> then just I'll do the final stage. […] And, you know, ideally make it so that we can update
> relatively seamlessly.
>
> — Greg, 2026-10-23 (`spya-xsfrsg`)

**The limit on this run** (the queue item, authorised by Greg): accepting page HTML from a browser
is a new untrusted input and a new auth surface, so **the plan and the auth design go to Greg before
anything server-side is built**; the extension and the research can go ahead. **Never publish to the
store.** The design below needs no server change for its core, which is the reason it was chosen;
the one server addition it would like (a repeat check) is held for Greg (§ Stage 4).

## The shape, in one picture

```
 reader on some site, check passed ── clicks the Spideryarn button in Chrome's toolbar
   └─ extension (service worker): chrome.scripting.executeScript into THAT tab only (activeTab)
        runs capturePage() — the bookmarklet's own function — in the page: the DOM as rendered,
        addresses made absolute, scripts / hidden inputs / CSRF metas removed, saved-from meta added
        ← { html, title, url }                     (no network request from the page at all)
   └─ keeps it in the extension's own IndexedDB, keyed by the new tab's id; opens a tab beside it:
        https://www.spideryarn.com/add/from-extension
 Spideryarn tab (our origin, the reader's own session — signs in first if needed, same tab)
   └─ chrome.runtime.sendMessage(<our extension id>, { type: "take" })
        extension checks: sender.origin is exactly ours, sender.tab.id is the tab it opened → hands
        it over once, then forgets it
   └─ new File([html], "<title>.html") → uploadEngine.send()  — the EXISTING upload path, unchanged
        → /add/upload/<id>: the add page, with its "why are you reading this" box
```

**The extension holds no token, no cookie, no key, nothing of the reader's.** It never talks to our
API. The only thing that authenticates is the Spideryarn tab, with the session it already has, through
the same `apiFetch` every other page uses. That is the whole auth design, and it is why the feedback's
"authenticate without exposing a long-lived secret" is met by not having one.

## Why this shape, and the options passed over

- **The extension calls our API itself, with a token.** The usual way. It needs a credential in the
  extension: either the reader's Supabase session copied out of our page (a refresh token, long-lived,
  sitting in a second place that we do not control and that every update of the extension can read),
  or a new token kind minted for the extension (a new gate in `src/auth.ts`, a new revocation story,
  and a route that takes a large body, which Vercel caps at 4.5 MB). Both are new defences. Passed
  over: the handoff needs neither.
- **A content script on our origin that relays with `window.postMessage`.** Works, and needs no
  extension id in our page; but any script in our page (or any other extension's content script)
  sees the message, and the handshake needs a nonce to be safe. `externally_connectable` names
  exactly one origin on one side and one extension id on the other, and Chrome supplies the sender's
  origin and tab, which a page cannot forge. Passed over.
- **The bookmarklet's `window.open` + `postMessage` handoff** — refused in 261017b because the walled
  sites send `Cross-Origin-Opener-Policy: same-origin`, under which the message is silently lost.
  Extension messaging does not go through the publisher's window, so COOP does not apply.
- **The URL instead of the page** (open `/add/<url>` and let our server fetch). Free of all the above,
  and keeps Refresh; but it is exactly what the walls refuse, which is half of why Greg asked. Kept as
  the fallback where the page cannot be read: Chrome's PDF viewer and pages the extension may not
  script (§ Stage 2).
- **The simpler option overall: no extension, the bookmarklet already does this in two steps** (save
  a file, upload it). Passed over because Greg asked for one click, and because the bookmarklet's
  two steps are the part readers will not do.

## What the untrusted HTML meets

Nothing new. The capture arrives as a file the reader uploaded, and a reader's upload is already the
untrusted party "the content" in [security-map.md](../project/security-map.md): sniffed by bytes
(`uploadedDocumentKind`), capped at `MAX_UPLOAD_BYTES`, read by stage 2, sanitised twice, its
saved-from address a *claim* that is shown and matched on the uploader's own shelf and never fetched
(`src/saved-from.ts`). The page's HTML never runs in our origin: it is a string handed to `File`.

What is new, and is checked:

1. **Who may take a capture.** Only a page on an origin in the extension's allowlist
   (`https://www.spideryarn.com`; in the dev build also `http://localhost:*`), and only from the tab
   the extension itself opened for that capture, with the nonce minted for it. A page on another
   site cannot even call the extension: `externally_connectable` refuses it before our code runs. A
   capture not taken in 15 minutes is refused; an untaken copy is removed when the receiving tab
   closes, on the next cleanup after expiry, or when Chrome next starts.
2. **What our page accepts from the extension.** Only from the extension ids it names, only a reply
   of the expected shape (`html` a string within `MAX_UPLOAD_BYTES`, `title` a short string), and the
   reply is only ever made into a `File` and uploaded, which is what a reader can do with any file.
   A hostile extension that knows our id could hand our page a forged capture — and could equally
   type into our page directly; the reader installed it. Not a new risk, said in the register.
3. **What the extension captures.** Only the tab the reader clicked on (`activeTab`), only on the
   click. No host permissions, no content script on any other site, nothing read in the background.
   What it removes before handing over is the bookmarklet's list (261017b § Why B), unchanged.

## Stages

### Stage 0: the spike that decides whether the shape holds

Three things the research could not verify, measured on the box in Playwright's Chromium with an
unpacked throwaway extension before anything else is written: `externally_connectable` reaching an
unpacked build from a `localhost` page, with `sender.origin` and `sender.tab.id` as claimed; a
`executeScript` return and a `sendMessage` reply at 50 MiB; and what the PDF viewer and a
`chrome://` page answer to `executeScript`. If the first fails the design changes, and this plan is
rewritten before Stage 1.

**Done, 2026-10-24** (Playwright's Chromium 1234, headed under xvfb, `--load-extension` with an
unpacked spike carrying `externally_connectable: {matches: ["http://localhost/*"]}`; script kept in
the session scratchpad, its numbers here):

- **The handoff works unpacked.** A `localhost` page's `chrome.runtime.sendMessage(id, …)` reached
  `onMessageExternal`, and Chrome supplied `sender.origin` (`http://localhost:5391`), `sender.url`
  and `sender.tab.id`, the tab id matching the one `chrome.tabs.query` gave the worker.
- **A page on an origin not in `matches` (`127.0.0.1`) has no `chrome.runtime.sendMessage` at
  all**, so it cannot even ask: the positive control for the allowlist.
- **Size**: a 47.4 MB (UTF-8) page came back from `executeScript` in 2.4 s and went to the page
  through `sendMessage` in 1.7 s, whole (23,780,809 UTF-16 units both sides). 1 MB and 21 MB the
  same. So the cap is the upload's 50 MiB, not messaging.
- **Chrome's PDF viewer**: `executeScript` succeeds, in a 159-character wrapper document whose
  `document.contentType` is `application/pdf`. So the capture reports a PDF by `contentType`, and
  the extension falls back to `/add/<url>`. A `chrome://` page and the Web Store could not be
  reached as tabs here (the store redirected to a consent page); Chrome forbids scripting both,
  and the extension treats any `executeScript` rejection as *this page cannot be added from here*.

### Stage 1: the capture, shared

Split `savePageForSpideryarn` in [`src/web/save-page-bookmarklet.ts`](../../src/web/save-page-bookmarklet.ts)
into `capturePage(win, maxBytes)` → `{ kind: "page", html, title, url } | { kind: "too-big", bytes }`
(steps 1–4) and the download (step 5). The bookmarklet becomes `capturePage` then download; the
extension injects `capturePage` with `executeScript({ func, args })`. Still self-contained (it is
stringified into the bookmark *and* serialised by `executeScript`), still ES2019. The existing tests
keep passing unchanged; new ones pin the split.

### Stage 2: the extension

`extension/` at the top of the repo: `manifest.json`, `src/background.ts` (the service worker),
icons, `store/` (listing text, screenshots), built by `scripts/build-extension.ts` into
`extension/dist/<flavour>/` and a zip. Two flavours from one source: **production** (allowlist
`https://www.spideryarn.com/*`) and **dev** (adds `http://localhost/*`, a pinned `key` so the
unpacked id is stable, a "DEV" badge). No remote code, no framework. The action click:

1. On a `chrome://`, Web Store, or other page Chrome forbids, `executeScript` throws: badge `!`,
   and the title says why. On Chrome's PDF viewer (a `.pdf` URL, or an injection that fails with
   the PDF viewer's error): open `/add/<url>` instead, our server fetching the PDF as it does today.
2. Otherwise capture; too big → badge and title say so; otherwise store and open the tab.
3. `onMessageExternal`: the origin, top-frame, tab, path and nonce checks in § What the untrusted
   HTML meets, then reply once and delete.

Tests: the background logic as plain functions (Vitest, with a fake `chrome`), the sender checks red
first (wrong origin, right origin wrong tab, second take, expired); and a real run in Playwright on
the box with the unpacked dev build (Chromium loads unpacked extensions with
`--load-extension`), end to end into the local dev server.

### Stage 3: the receiving page

Route `{ kind: "add-from-extension" }` at `/add-from-extension`, outside the general `/add/` branch
(src/web/router.ts). Signed out: the sign-in page, which
returns to it in the same tab (`auth-return.ts`), so the tab id still matches. Signed in: ask the
extension, build the `File`, `uploadEngine.send`, navigate to `/add/upload/<id>` — the add page
exactly as an upload reaches it. Every other outcome is one plain sentence and a way on: no extension
answering (*"Spideryarn's Chrome extension did not answer. Try the button again."*), nothing waiting,
or a refusal from the upload, which the upload status already words. Help's *Adding articles* gets
a short section; `/privacy` a paragraph on what the extension sends and when.

### Stage 4: held for Greg — a repeat click does not make a second article

An upload never checks the shelf, so clicking the button twice on one page makes two articles and
spends two slots. The fix is a read-only, owner-scoped `GET /api/articles/by-url?url=` over the
existing `slugForUrlKey` (which already matches a saved-from address on the reader's own shelf
only), asked by the receiving page before it uploads: found → open it. Server-side, so asked, not
built. Until then the page says nothing and adds a second copy.

### Stage 5: the store, the updates, and what Greg does

Written from the research, as exact steps, in the question: the developer account, the listing
(drafted here, with screenshots), the first upload, and the update path (a version bump and
`npm run extension:publish`, using the Chrome Web Store API with credentials Greg makes once).

## GPT Sol's plan review, 2026-10-24

[261024q-plan-review-sol.md](261024q-plan-review-sol.md), verdict *REWORK*, nine findings, all
taken. **These override the stages above where they differ.**

- **F1 (P0): the async handoff was not bound to the reader.** The receiving page is an add visit
  (`addAddress` gives it one, so a change of reader stops it as it stops `/add/…`), is keyed on
  the reader, records the reader it mounted for, and sends to the upload engine only if, at the
  moment of sending, it is still mounted and both `uploadEngine.reader()` and the tab's held reader
  are that reader. `send` then reads the engine's reader, which is the same one, and the engine's
  own `stop()` fences anything later — the guarantee the shelf's Add already has. Tested with a
  late reply across A→B and A→signed out.
- **F2 (P1): `executeScript` cannot pass `window`** (its arguments are JSON). The signature is
  `capturePage(maxBytes, messageCap = 0, win = window)`: the extension passes two numbers, the
  bookmarklet and the tests pass a window. Tested by running the built extension in Chromium.
- **F3 (P1): a frame of our page in a hijacked tab.** The extension also requires
  `sender.frameId === 0`, the sender URL's path to be exactly `/add-from-extension`, and the query's
  fresh 128-bit handoff nonce to match. The query survives the sign-in round trip
  (`SendToSignIn` keeps path and query). The later code review added the nonce because persisted tab
  ids can be reused after a browser restart.
- **F4 (P1): no atomic lifecycle.** The tab is opened blank, the capture stored, and only then is
  the tab sent to our page; *take* is one IndexedDB read-write transaction (get and delete);
  expiry is checked on read; `tabs.onRemoved` drops a capture whose tab closed. Tested with two
  simultaneous takes.
- **F5 (P1): a double click makes two articles.** The extension keeps, per source address, the
  receiving tab it opened (for `KEEP_MS`, or until that tab closes); a second press on the same
  address focuses that tab instead of capturing again. The server lookup in Stage 4 stays held for
  Greg, for repeats after the article is made.
- **F6 (P1): the production id is known only once the item exists.** The page names the ids it
  trusts (dev now, production once Greg has created the item — one constant, one deploy), and
  Greg's steps are ordered for it: create the item, which shows the id, submit it for review the
  same sitting, tell us the id. Rejected: reading the id from the address, because any extension
  can list our origin in `externally_connectable` without a warning.
- **F7 (P2): the publish command's credential.** One method: a service-account JSON key Greg
  downloads to a path outside the repo (`CWS_SERVICE_ACCOUNT_KEY` names it), a JWT signed with
  `node:crypto`, exchanged for a one-hour token with the `chromewebstore` scope; publish only when
  the upload response itself says the exact new version succeeded. A later review established that
  `fetchStatus` has no version or operation id, so an asynchronous upload stops for dashboard
  verification rather than treating item-wide status as proof.
- **F8 (P1): the disclosures must be exact.** `extension/store/listing.md` holds the single-purpose
  sentence, each permission's justification, the data categories to tick (website content; web
  browsing activity — the page's address — and every sensitive-content category the arbitrary DOM
  can contain), the 15-minute handoff window and actual cleanup events, the reader's own article
  until they delete it, and the recipients (Spideryarn, and the
  processors `/privacy` already names). `/privacy` gets the same in plain words.
- **F9 (P2): JSON can double a page.** Messages are JSON, capped at 64 MiB, and a quote or
  backslash serialises to two characters. `capturePage` also refuses a page whose JSON
  serialisation is over `messageCap` (60 MiB from the extension, 0 meaning no check in the
  bookmarklet), measured as UTF-8 bytes; tested with a page of quotes.

## What landed, 2026-10-24

Stages 1–3 and 5 as revised above; Stage 4 asked. The doc is
[chrome-extension.md](../project/chrome-extension.md).

- **Stage 1**: `capturePage(maxBytes, messageCap = 0, win = window)` and the bookmarklet as
  `savePageForSpideryarn(win, maxBytes, capture)`, the capture passed in because a minifier would
  rename an imported name inside the stringified function. Its tests unchanged bar the argument;
  new ones for the three answers and the JSON cap.
- **Stage 2**: `extension/` — `manifest.ts` (two flavours; dev pinned by a public key to
  `mgaelddegjfaooojhjaijcnkambbcaea`; production trusts no dev id), `src/handoff.ts`,
  `src/store.ts`, `src/background.ts`; `npm run extension:build` (esbuild, unminified, ES2020)
  and `npm run extension:publish` (store API v2, service account). The changes from the plan:
  **the page names the ids it trusts**, rather than reading one from the address (any extension
  can name our origin in `externally_connectable`); the dev build talks to one local server only.
- **Stage 3**: `/add-from-extension` (`AddFromExtension.tsx`, `extension-handoff.ts`), an add
  visit keyed on the reader, sent to sign-in and back when signed out, one ask per page load (Strict
  Mode's double mount would otherwise spend the one-shot capture on the discarded mount), sent at
  most once (Back must not upload it again). `/privacy` has a bullet; Help waits for the store id,
  because a sentence about an extension nobody can install would be false.
- **Tests**: `tests/extension-handoff.test.ts`, 37, each refusal with its positive control;
  removing the frame and path checks turned two red, removing the reader check two more.
- **Seen end to end** (Sonnet subagent, Playwright's Chromium on the box, local dev server, the
  button pressed through CDP `Extensions.triggerAction`, which grants `activeTab` as a click does):
  one press imported a 130-paragraph fixture in about 7 s with *Saved from 127.0.0.1*; a second
  press with the first tab open opened nothing and uploaded nothing; signed out, the tab went to
  `/login?next=%2Fadd-from-extension` and after signing in carried on to the article;
  `chrome://version` got badge `!` and no tab.

## Code review fixes, 2026-10-24

The review of commit `9966db02df90` found and fixed the gaps that the plan-stage review could not
see in the implementation:

- Concurrent action events crossed the check-before-record gap and could create two imports. A
  per-store promise tail now serialises them; a barrier test was red with two captures first.
- IndexedDB outlived Chrome's session-scoped tab ids. Each capture now has a fresh nonce, `take` is
  atomic on tab plus nonce, and browser startup clears old tab mappings.
- The add-visit reader fence was erased by `/login` and by OAuth's full-page reload. The validated
  login return counts as the same visit, and the first signed-in reader is held in that receiver
  tab's session storage. The red test loses the in-memory ref before A→B.
- An existing upload could make the receiver consume and then refuse the only capture. It now waits
  before asking; if another upload wins while the reply is in flight, the cached file is unspent and
  retried when the engine settles.
- `fetchStatus.lastAsyncUploadState` was treated as this process's upload and supplied the expected
  version locally. The API provides neither version nor operation id there, so the publisher now
  fails closed on asynchronous completion and rejects unknown CLI options before any network call.
- The privacy and store text treated a 15-minute delivery deadline as timed deletion and denied
  sensitive categories an arbitrary DOM can contain. The disclosures now name the actual cleanup,
  retention and recipients; the shared capture also removes event handlers and `javascript:` URLs
  while retaining the MathJax and structured-data scripts the pipeline reads.

The reusable classes and countermeasures are in postmortems `261024f`–`261024k`.

Verdict *SHIP AFTER FIXES (MADE)*, ten findings, two P0 (C1, C2); the full review is
[261024q-code-review-sol.md](261024q-code-review-sol.md). Read, gates re-run here, committed as
`2623efaa4`. **Seen end to end again on the final code** (the same Sonnet subagent and scripts,
rebuilt dev extension): one press → `/add-from-extension?handoff=<nonce>` → `/add/upload/<id>` →
the article in about 8 s; a second press with the first tab open did nothing; signed out, the
nonce survived `/login?next=…` and the import carried on in the same tab; `chrome://version` got
`!`; a made-up nonce, signed in, said nothing was waiting and uploaded nothing. Not exercised in a
browser: the store cleared on restart, two presses at once, the attribute stripping (each is
held by unit tests instead).

## Later, not in v1

- **Select a passage, then arrive in a chat about it.** The capture can carry the selection's text;
  the receiving page would need to find it in the article once it has blocks and open chat at that
  block, which is after the import, possibly minutes. A queue entry, not this plan.
- **Say why you are reading it, on the publisher's page.** The add page already has that box, and
  the extension lands there, so v1 has it one tab over.
- **Firefox and Safari.** Firefox takes the same MV3 code with small changes; Safari needs Xcode.

## Done means

Stages 1–3 built, tested red first where there is a check, `npm test` and `npm run typecheck` green,
seen working end to end in a real browser with the unpacked extension against the local server;
Stage 4 and the store steps asked of Greg in one question file; GPT Sol has reviewed this plan and
the code.
