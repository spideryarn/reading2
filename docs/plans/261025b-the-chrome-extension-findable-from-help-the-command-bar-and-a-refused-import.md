# The Chrome extension, findable from Help, the command bar and a refused import

Report `spya-xsfrsg` (Greg, admin), open question
[q-d5ucbd](../user-feedback/questions/q-d5ucbd.md); the ask is
[chrome-extension.md § What it does not do yet → Being found](../project/chrome-extension.md#what-it-does-not-do-yet)
(commit f6d968c29). Greg submitted the extension to the store on 2026-10-25, Unlisted; the item id
has not arrived.

> I don't think we want to push it because it's only worth them using the extension if they need it
> rather than something that will really help them that much if they don't.
>
> — Greg, 2026-10-25

## What it must do

- Point readers at the extension from `/help`, the command bar and, above all, the add page when a
  pasted address failed because the site turned us away. Signal it, do not push it.
- **One constant decides everything.** `PRODUCTION_EXTENSION_ID` in
  `src/web/extension-handoff.ts` is `null` today. Every place takes the store link from it, and
  while it is `null` every place draws **nothing**. When the Overseer sets it, that one line is the
  whole change: no regenerated file, no test to update.

## The design

1. **`EXTENSION_STORE_URL`**, in `extension-handoff.ts` beside the id:
   `PRODUCTION_EXTENSION_ID === null ? null : \`https://chromewebstore.google.com/detail/${id}\``.
   The store's address for an item is `chromewebstore.google.com/detail/<id>` (a slug before the id
   is optional, and the bare id redirects). Exported as a function of the id too
   (`extensionStoreUrl(id)`) so a test can draw both states without changing the constant.
2. **`ExtensionOffer`** (`src/web/ExtensionOffer.tsx`), the one component that draws the link:
   takes `url: string | null` (default `EXTENSION_STORE_URL`) and returns `null` when it is null.
   The link opens in a new tab (`target="_blank" rel="noopener noreferrer"`): it leaves our site,
   and on the add page the reader's failed import is what they are standing on. Shown only where
   the primary pointer is fine, as `SavePageBookmarklet` is: a phone or a bare iPad cannot install a
   Chrome extension. Not narrowed to Chrome by user agent: Edge and Brave install from the Chrome
   Web Store too, a UA sniff is the kind of guess that goes stale, and the sentence says "Chrome".
3. **The add page, after a refusal** (`UploadInstead.tsx`). The extension line goes **above** the
   bookmarklet, because it is the better way round (one press, nothing to upload), and the
   bookmarklet stays for the browsers it does not reach. One sentence, quiet text, a link:

   > In Chrome on a computer, the Spideryarn extension adds a page like this in one press, as your
   > browser shows it. **Get it from the Chrome Web Store**

   `UploadInstead` draws under every `SUGGESTS_UPLOAD` code. That includes codes where the
   extension does not help (`fetch-address`, `fetch-scheme`, `fetch-private`: an address that is
   wrong or not public). Narrowing to the refusals (`fetch-refused`, `fetch-declined`,
   `fetch-login`, `jb-bot-check`, `fetch-empty`, `fetch-incomplete`) is the "need it" in Greg's
   words: the offer is made only where the extension is the answer. So `UploadInstead` takes the
   failure code and a new `SUGGESTS_EXTENSION` set in `src/messages.ts`, a subset of
   `SUGGESTS_UPLOAD`, decides.
   **Is the bookmarklet line also narrowed?** No: not this plan's call.
4. **Help** (`src/web/help/pages/adding-articles.md`). Help's links must be site paths
   (`targetOf` throws on a full URL, "how it opens is a decision to make then"), and the page is
   Markdown, which cannot ask a constant. So a new **block token**, `{{chrome-extension}}`, alone in
   its paragraph like `{{modes-table}}`, placed before the *Save for Spideryarn* paragraph:
   - **drawn** (`drawBlock`): `<ExtensionOffer variant="help">`, a paragraph with the link, or
     nothing while null;
   - **search text** (`plainBlock`): the paragraph's words when set, nothing when null;
   - **the chatbot's corpus** (`expandHelpTokens`): **the empty string, always**. The corpus is a
     committed file that `tests/help-corpus.test.ts` compares; if it depended on the id, setting the
     id would turn that test red until someone regenerates, which is not a one-line change. The cost
     is that the Help chatbot will not volunteer the extension; it can still answer from the
     *Save for Spideryarn* paragraph, and a reader who asks about refused sites is pointed at
     *Adding an article*, which draws the link. Weighed below.
   - keywords gain `extension chrome plugin add-on`, harmless either way.
5. **The command bar**: a page row *Chrome extension* → `helpHref("adding-articles")`, description
   "Add the page you are reading in one press, from Chrome.", aliases `extension`, `chrome`,
   `plugin`, `add-on`, `browser extension`; present only while `EXTENSION_STORE_URL` is set. It goes
   to Help rather than straight to the store, because a row that leaves the site is a new kind of
   row for the bar (it navigates in-app), and Help says what the extension does before the reader
   installs it. **The bar's row catalogue is a committed, compared file**
   (`src/command-pick-catalogue.generated.json`, built from `besideTheModes` by
   `tests/command-pick-catalogue.test.ts`), so a row that appears with the id would turn it red.
   `besideTheModes` takes `extensionStore?: string | null` (default `EXTENSION_STORE_URL`), and the
   tests that mean *every row the bar can draw* (the catalogue, the argument collision matrix, the
   mode-alias test) pass a store address, so the catalogue holds the row in both states and the
   collision matrix checks its aliases now. The server only ever answers for keys the browser
   shows, so a catalogue entry the bar is not drawing yet costs nothing.
6. **Not added**: `/features`, the footer, the shelf's add box, the landing page. Each is a push to
   somebody who has not needed it. `/add-from-extension`'s *didn't answer* already presumes it is
   installed. `/privacy` already describes it.

## Options passed over

- **Help text present while null, without a link.** The brief allows it, but the extension cannot
  be got while the id is null (production trusts no id, and the Unlisted listing has no public
  address), so a paragraph about it would describe something a reader cannot have.
- **The corpus following the id**, with `src/web/extension-handoff.ts` added to the commit hook's
  sources so the corpus regenerates in the Overseer's commit. Truer for the chatbot, but the change
  is then two files and depends on the hook running.
- **A Help topic page of its own** (`/help/chrome-extension`). An anchor is a promise forever, and
  a page that draws nothing while null is a dead page in the contents. A paragraph in *Adding an
  article*, where the problem it solves is already described, is enough.

## The one-line change, for the debrief

`export const PRODUCTION_EXTENSION_ID: string | null = "<the 32 letters>";` in
`src/web/extension-handoff.ts`, then record the id in `chrome-extension.md` (a doc line, not code)
and deploy. A test asserts that with an id every place draws the link and with `null` none does,
using `extensionStoreUrl` and the component's `url` prop rather than the constant.

## Stages

1. The constant, `ExtensionOffer`, `SUGGESTS_EXTENSION`, the add page, the Help token, the command
   bar row, tests for both states. Docs: chrome-extension.md, help-page.md (the token), ingest-queue
   if it describes `UploadInstead`.
2. Browser check (Sonnet subagent) of the add page after a refusal and of `/help/adding-articles`
   with the dev id temporarily set locally, not committed.
3. GPT Sol code review, gates, push to `dev`.

## After GPT Sol's plan review (GO WITH CHANGES, four findings, all taken)

[Review](261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import-review-sol.md).

1. **The id has one home**: `chrome-extension.md` points at the constant rather than holding a
   copy, so setting it is the whole change. A test refuses an id that is not 32 letters `a`–`p`, so
   a typo cannot switch on a link to nowhere.
2. **`SUGGESTS_EXTENSION` is wider**: `fetch-private`, `fetch-certificate` and `fetch-redirects`
   join the refusals, since each sentence says the page may still open in the reader's browser, and
   the extension captures whatever the tab shows (an intranet page included). Still out:
   `fetch-address`, `fetch-scheme`, `fetch-type`, `fetch-paper-missing`. A table names the decision
   for every `SUGGESTS_UPLOAD` code.
3. **Help keeps its sentence in both states**, so search and the chatbot's corpus stay honest and
   stable: one sentence on what the extension does, in the corpus and the search text always; drawn
   with *Get it from the Chrome Web Store* when the id is set, and with *It is not in the Chrome Web
   Store yet.* while it is null. The corpus carries only the stable sentence, so it does not move.
4. **The command-bar row has the same fine-pointer gate** (the bar is on phones too), and goes
   just before `APP_PAGES`, so Changelog stays the last page above Feedback.
