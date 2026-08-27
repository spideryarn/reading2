Verdict: do not build the plan unchanged. The tool is useful, but its trust boundary, caps, and selector need tightening first.

1. **High — it makes prompt injection easier, though not higher-bandwidth.**

The new tool exposes attacker-controlled hrefs that are currently invisible to the model, and its proposed description encourages immediately fetching them. An article can therefore hide an innocent-looking link to an attacker page; `article_links` legitimises the destination, then `read_web_page` loads the stronger second-stage injection. It also sends previously undisclosed tracking URLs to OpenRouter. The 256-character cap still bounds later exfiltration, but the attack becomes stealthier and more likely to succeed. The plan is wrong to treat this as neutral. [Plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/chat-follow-links.md:105>), [existing threat](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/chat-tools.md:196>).

Smallest fix: fence the listing with `untrusted("article link metadata", …)`, say explicitly that hrefs and labels were written by the article publisher, and remove the automatic “then `read_web_page`” instruction. Fetch only when the reader actually asked what the destination says. This is mitigation, not the deferred allowlist.

2. **High — 40 rows is not an output cap.**

The file’s rule is a small character cap because tool output is replayed on every later round. Forty valid URLs can already approach 82KB using `read_web_page`’s 2,048-character limit; the listing itself does not even promise that URL-length limit. That can inflate several requests or produce `[ai-too-big]`. The “~6KB” claim is only a corpus sample. [Plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/chat-follow-links.md:73>), [cap rule](</Users/greg/Dropbox/dev/experim/spideryarn2/src/chat-tools.ts:34>).

Smallest fix: enforce both `MAX_URL_CHARS` per URL and a total character budget, stopping only between complete rows. Keep the exact matched/shown counts. Add an adversarial long-URL test.

3. **High — wording cannot prevent fetching the current article.**

`“block …, in this article”` is advice, not enforcement. The model has `meta.url`, so it can construct `meta.url#spya-…`; HTTP then fetches the whole article because fragments are not transmitted. Fully qualified self-links are worse: stage 3 deliberately leaves them untouched, so the plan will classify them as ordinary external URLs. [Plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/chat-follow-links.md:64>), [stage-3 limitation](</Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:641>).

Smallest fix:

- Render resolved anchors as: `already supplied at block spya-…; use that block; do not call read_web_page`.
- Detect fully qualified same-article URLs using `urlKey`.
- Make `read_web_page` refuse the current article server-side.
- Treat unresolved self-fragments as `same article; target unresolved; do not fetch`.
- Decode malformed fragments with the guarded helper pattern already used in `blocks.ts`, not bare `decodeURIComponent`.

4. **Medium — later links can be impossible to retrieve.**

Document order plus 40 rows hides 21 of Noema’s 61 actual parsed links. The model knows the relevant block id and surrounding prose, but `query` searches neither. A late link whose label is merely “found” cannot be discovered from “the link near the metabolism paragraph.” The advertised `washington post` example also fails literal substring matching against `washingtonpost.com`. [Plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/chat-follow-links.md:59>).

Smallest fix: add an exact `blockId` selector and include block id in query matching. Normalize URL matching so spaced and compact host names agree. Document order is then correct within the narrowed result.

Deduplicating globally by href-plus-text also erases later locations. Deduplicate within a block, or group every source block id onto one destination row.

5. **Medium — the description invites the exact overuse the system prompt forbids.**

“Whenever the reader asks about something the article links to” is broader than “explicitly asks about a hyperlink.” A question such as “what does that study say?” may refer to what this article says about it; the proposed wording nevertheless directs two tool calls. The system prompt says not to do that. [Proposed wording](</Users/greg/Dropbox/dev/experim/spideryarn2/src/chat-tools.ts:298>), [system rule](</Users/greg/Dropbox/dev/experim/spideryarn2/src/converse.ts:330>).

Use wording like:

> Use only when the reader explicitly refers to a hyperlink or asks where a linked citation goes, and its URL is not already available. Do not use it for claims answered by this article, general facts, or an existing web-search result. Listing a link does not mean you should fetch it.

The standalone listing tool is not fundamentally wrong, and I would not merge all listing into `read_web_page`: listing should not itself authorize an outbound request. But it needs `blockId`, a narrow default, and no automatic-fetch instruction.

6. **Medium — the corpus evidence does not measure the proposed parser.**

Parsing the current fixtures produces 61 `a[href]` elements for Noema, not 71. The raw file contains 72 `<a` substrings; eleven are markup embedded inside `data-note` attributes, not DOM links. The existing links doc reports that raw 72 count, while the plan reports 71. [Plan table](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/chat-follow-links.md:21>), [links table](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/links.md:24>).

Smallest fix: run the actual extractor over the corpus and record what it returns. Add a fixture containing a `data-note="<a …>"` case and prove it is deliberately included or excluded. Mutate a real href and ensure the corpus assertion fails.

7. **Low — jsdom is safe here, but the performance explanation is inaccurate.**

For installed jsdom 29.1.1, scripts are disabled and subresources are not loaded by default. `innerHTML` assignment did not execute a script or load an iframe in my probe. [jsdom scripts](</Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/jsdom/README.md:72>), [resources](</Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/jsdom/README.md:138>).

However, connected `<base>` elements do change `document.baseURI`; never resolve through `a.href`. Use `getAttribute("href")` plus `new URL(raw, meta.url)`. Better still, reuse an inert `<template>`: on Noema it took roughly 8.2ms per extraction versus 12.9ms for a connected holder. The plan still invokes 141 fragment parses; it avoids 141 jsdom documents, not 141 parsers.

8. **Low — the verification and documentation plan can silently pass.**

The browser check “renders with an icon rather than a blank” cannot fail because `ToolIcon` already falls back to a search glyph. Require the specific link glyph. More importantly, add negative live prompts proving the model does not call the tool for ordinary article questions or fetch internal anchors; the one positive Blake Lemoine prompt tests only triggering.

Also update `docs/project/chat-tools.md`, which still says “the six,” its security section, and `docs/project/links.md`. Otherwise the principal documentation will be false immediately after landing.

Checked and sound: hrefs are absent from `articleWithIds`; reusing `fetchDocument` is correct; relative resolution against `meta.url` is necessary; exact total/shown counts are the right silent-success defence; and separating cheap listing from expensive fetching is defensible.

Read-only review; no files changed.