## Verdict: GO WITH CHANGES

1. **High — The debrief contradicts the “only one change” requirement.**

   Evidence: the plan promises one-line activation at [plan:18](/var/tmp/spideryarn-worktrees/extension-findable/docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md:18), but later requires recording the literal ID in the project doc at [plan:95](/var/tmp/spideryarn-worktrees/extension-findable/docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md:95). The existing doc already says the ID must live in both places at [chrome-extension.md:151](/var/tmp/spideryarn-worktrees/extension-findable/docs/project/chrome-extension.md:151).

   Concrete fix: make `PRODUCTION_EXTENSION_ID` the sole literal. Update `chrome-extension.md` during this implementation to point to that constant without promising to copy the value into the doc. The later procedure must be exactly: change the constant, deploy. A conditional test should also accept `null` or require a 32-letter `[a-p]` ID, so a typo cannot activate dead links.

2. **High — `SUGGESTS_EXTENSION` omits failures the extension can genuinely bypass.**

   Evidence: the proposed set excludes `fetch-private`, `fetch-certificate`, and `fetch-redirects` at [plan:44](/var/tmp/spideryarn-worktrees/extension-findable/docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md:44). Yet all three sentences explicitly say the page may open in the reader’s browser: [messages.ts:2469](/var/tmp/spideryarn-worktrees/extension-findable/src/messages.ts:2469), [messages.ts:2489](/var/tmp/spideryarn-worktrees/extension-findable/src/messages.ts:2489), [messages.ts:2503](/var/tmp/spideryarn-worktrees/extension-findable/src/messages.ts:2503). The extension accepts any HTTP(S) tab and captures its rendered DOM through `activeTab`: [handoff.ts:154](/var/tmp/spideryarn-worktrees/extension-findable/extension/src/handoff.ts:154), [manifest.ts:13](/var/tmp/spideryarn-worktrees/extension-findable/extension/manifest.ts:13), [save-page-bookmarklet.ts:99](/var/tmp/spideryarn-worktrees/extension-findable/src/web/save-page-bookmarklet.ts:99). In particular, a private intranet or localhost page is exactly something the browser can see while the server correctly refuses to fetch it.

   Concrete fix: include at least:

   - `fetch-private`
   - `fetch-certificate`
   - `fetch-redirects`
   - `fetch-login`
   - `fetch-refused`
   - `fetch-empty`
   - `fetch-declined`
   - `fetch-incomplete`
   - `jb-bot-check`

   Continue excluding `fetch-scheme` and `fetch-type`: the extension refuses non-HTTP(S) tabs, and a PDF tab is sent back through server fetching rather than captured. Keep `fetch-address` and `fetch-paper-missing` out unless a separate product case is made. Add a table-driven test stating the decision for every `SUGGESTS_UPLOAD` code.

3. **Medium — Making the Help corpus permanently empty is the wrong trade-off.**

   Evidence: the plan intentionally removes the extension from the chatbot forever at [plan:52](/var/tmp/spideryarn-worktrees/extension-findable/docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md:52). That breaks Help’s documented promise that every page is copied into the corpus at [help-page.md:130](/var/tmp/spideryarn-worktrees/extension-findable/docs/project/help-page.md:130). It also adds static extension keywords while the visible and searchable block is empty under `null` ([plan:65](/var/tmp/spideryarn-worktrees/extension-findable/docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md:65)); Help searches keywords and body text at [help-content.tsx:38](/var/tmp/spideryarn-worktrees/extension-findable/src/web/help/help-content.tsx:38). Thus, while null, “extension” can return a page containing no extension information.

   Concrete fix: use the alternative the brief expressly permits—Help text without a broken link. Keep one stable explanatory sentence visible and in `plainBlock`/`expandHelpTokens` in both states; render only the Web Store link when the URL is non-null. The generated corpus then remains stable when the ID changes, search remains honest, and the chatbot can point readers to `/help/adding-articles` once the link is live.

4. **Medium — The command-bar row needs the same device gate and a pinned insertion point.**

   Evidence: `ExtensionOffer` is deliberately hidden without a fine pointer at [plan:30](/var/tmp/spideryarn-worktrees/extension-findable/docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md:30), but the command row is conditioned only on the URL at [plan:66](/var/tmp/spideryarn-worktrees/extension-findable/docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md:66). The command bar explicitly exists on phones via its button at [CommandBar.tsx:52](/var/tmp/spideryarn-worktrees/extension-findable/src/web/CommandBar.tsx:52). Once activated, a phone would therefore get a “Chrome extension” command leading to a Help page whose install offer is hidden.

   The row’s exact placement also matters: the existing test requires Changelog to remain the last page immediately before Feedback at [command-bar.test.tsx:387](/var/tmp/spideryarn-worktrees/extension-findable/tests/command-bar.test.tsx:387). Tests that pass a fake store URL into the catalogue do not protect that runtime order.

   Concrete fix: at runtime pass `null` to `besideTheModes` unless `(pointer: fine)` matches, following `SavePageBookmarklet`. Insert the extension row before `APP_PAGES`, preserving Changelog’s position. Add a direct `besideTheModes` test proving null/coarse absence, fine/non-null presence, destination, and ordering.

The proposed Web Store URL is correct: Chromium itself constructs item URLs as `https://chromewebstore.google.com/detail/` plus the extension ID. The fixed-origin URL and `target="_blank" rel="noopener noreferrer"` are also the right security shape, and keeping arbitrary external URLs out of `targetOf` is sound. [Chromium source](https://chromium.googlesource.com/chromium/src/+/refs/tags/135.0.7049.120/extensions/common/extension_urls.cc)