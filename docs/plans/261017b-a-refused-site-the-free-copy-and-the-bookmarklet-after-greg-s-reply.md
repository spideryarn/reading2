# A refused site: the free copy and the bookmarklet, after Greg's reply

Up: [plans.md](../project/plans.md). Queue item `qi-q62g96s9`. Greg's reply `spya-wm83gt`,
2026-10-17, to [q-fp8tqr](../user-feedback/questions/q-fp8tqr.md) (reports `spya-x5e966`,
`spya-tqsw3u`):

> A and/or B as you see fit. Look for a way that's clean and good for the user.

Follows [261015a](261015a-a-site-that-refuses-the-app-a-better-way-round-and-the-bigger-options-for-greg.md),
which built the better sentence and the Upload button on the failed add page, and asked the
question. Research: [261015a](../research/261015a-getting-a-page-behind-a-bot-check-extensions-bookmarklets-open-access-copies.md).
Measurement for this plan:
[investigations/261017a](../investigations/261017a-which-refused-paper-links-have-a-free-copy-the-server-can-read.md).

**The limit on this run**: anything that edits a defence listed in
[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
is written up for Greg, not built. `src/fetch.ts`, the upload path and the API's refusal of
cross-site requests are on that list.

## What the measurement said

Of 37 real article links from 20 walled publishers, **29 are refused** (23 with a 403, 6 with a
small challenge page). **Europe PMC's fixed XML endpoint recovered 6 of the 29**; 8 are open access
with a copy elsewhere that was not fetched; 15 had no open-access location known to OpenAlex. The
sample was built, about half open access, so 6 of 29 is not a reader success rate, and A's wider
coverage is unknown. What is certain: A does nothing for a news site or a blog. And building it edits
`src/fetch.ts` (Europe PMC as a fixed host, and XML read at all). **A is written up for Greg, not
built** (§ Stage 3).

The measurement found something cheaper on the way: **six of the refusals do not say they are
refusals.** IEEE answers with an AWS WAF challenge page (a 202 carrying 2 KB, when the request
accepts HTML as ours does) and Springer and JSTOR with a 3 KB "Client Challenge" page. Neither is
in the bot-check registry ([`src/challenge-page.ts`](../../src/challenge-page.ts)), so stage 2
refuses them as *too little text* or *no article*, which tells the reader to look at an address
that is fine and draws no Upload button. That is Stage 1.

## Why B is a file the bookmarklet saves, not a page it hands across

The design in 261015a was a handoff: the bookmarklet opens a Spideryarn window and `postMessage`s
the page into it. A browser spike from the box
([evidence below](#the-spike)) never got past Cloudflare to an article page, so it could not
answer whether articles carry `Cross-Origin-Opener-Policy: same-origin`. What it did show is that
Cloudflare's own pages on all six sites do, and that under it `window.open` returns a handle that
goes `closed` within two seconds, the popup's `opener` is `null`, and `postMessage` is lost without
an error. The handoff would fail silently on exactly the sites this is for, if the article pages
inherit that header, and nothing here can tell us whether they do.

**So v1 is the version that cannot fail that way: the bookmarklet saves the page as an `.html`
file, and the reader uploads it with the Upload button that is already on the failed add page.**

```
 reader on cell.com (check passed) ── clicks "Save for Spideryarn" in the bookmarks bar
     └─ the bookmarklet, running in the page: outerHTML of the page as rendered, its image and link
        addresses made absolute (in-page # links left alone), saved as "<title>.html"
 reader on Spideryarn's failed add page ── Upload a file ── Add
     └─ the existing upload path, unchanged: stage 1 sniffs it as HTML, stage 2 reads it
```

What it gives over "save the page as a PDF", which is today's advice:

- **No browser offers a plain HTML file of the page as rendered** (Chrome's default is MHTML,
  Safari's a Web Archive, and neither is accepted). This one is the DOM after the site's scripts
  ran, which is the article the reader is looking at.
- **It is free and keeps the structure.** A web page is read by Readability, not a model; a PDF
  costs a model call (about ten cents) and comes back as a transcription.
- **Nothing new on the server.** No route, no new way in, no token anywhere near the publisher's
  page. The file goes through the existing upload path, unchanged.

What it gives up, said now:

- **Two steps rather than one** (save, then upload).
- **The article has no source address**, as every upload has none
  ([content-extraction.md § Stage 2 and the document with no address](../project/content-extraction.md#stage-2-and-the-document-with-no-address)):
  no source link, no Refresh. Recording the page's address with an upload is a change to the
  upload path, so it goes in the question (§ Stage 3), with the one-click handoff, which would
  need the `postMessage` window tried by hand on Greg's laptop first.
- **The images may not come.** Their addresses are made absolute, but stage 4.5 fetches
  them from our server, which is the party the wall refuses; on failure the reading view falls back
  to the publisher's address ([article-images.md](../project/article-images.md)), which may fail
  even for the owner (publishers block hotlinking by referrer, and a cross-site image load need not
  carry their cookies). **Unverified on a real walled page**: the box cannot get past the walls to
  save one. Accepted for v1 and said in Help (Sol, R2-5).
- **The whole rendered page is uploaded and kept** as the article's source, for its owner only
  (`GET /api/source/:slug` is behind the gate; nothing in `src/public/` reads a raw source). A
  signed-in page can carry account chrome and form values, which is Raindrop's privacy objection
  in [the research](../research/261015a-getting-a-page-behind-a-bot-check-extensions-bookmarklets-open-access-copies.md).
  So the bookmarklet removes what can carry a credential and cannot carry the article:
  executable `<script>`s, `input[type=hidden]` and `input[type=password]`, the `value` of other
  text inputs, and `<meta>` named `csrf-token`, `csrf-param`, `csrf_token`, `_csrf`, `xsrf-token`
  or `x-csrf-token`. **It keeps everything that can be content** (Sol, R2-1): iframes (the
  sanitiser's video allowlist keeps some), `<noscript>` (lazy-image fallbacks), checkbox and radio
  inputs (Tufte sidenotes are built on them), `<textarea>` and `<select>` (visible text), and data
  scripts (`math/tex`, which the maths import reads, and `application/ld+json`). It does not try to
  find a name or an email address in the page's chrome; Help says plainly that the page as shown is
  what is saved. Sanitising the extracted article is not data minimisation, and the plan does not
  call it that (Sol, F6).

**The simpler option passed over: nothing for B, and let the PDF advice stand.** It costs nothing,
but leaves the reader with a model-transcribed PDF of a web page when a clean HTML copy was one
click away, and leaves every non-paper site (where there is no Download PDF button) with "print to
PDF" as the only route.

## Stages

### Stage 1: the two challenge pages are recognised as bot checks

The same process as [261006f](261006f-other-bot-check-walls-that-clear-the-floor.md): an entry per
provider, reading the markup the challenge writes for its own script (never wording), with the
captured page as a fixture and tests red first. Raw `src`/`href` attributes are parsed against a
fixed made-up base, so an uploaded copy with no address is recognised too.

- **AWS WAF** (IEEE): a `<script src>` whose host ends `.token.awswaf.com` and whose path ends
  `/challenge.js`, and a `div#challenge-container`. Both required. (The page's
  `window.gokuProps = …` is script text, so not used.)
- **The "Client Challenge"** (Springer and JSTOR serve it byte-identical bar a token, so one
  fixture): a stylesheet `link` whose path is `/_fs-ch-<token>/assets/styles.css`, and
  `div#loading-error[role=alert]`. Both required.
- **Built** (Opus subagent, 2026-10-17), as `"aws-waf"` and `"client-challenge"` in
  `src/challenge-page.ts`: an HTML `<script>` whose `src` host ends `.token.awswaf.com` and path
  ends `/challenge.js`, with a `div#challenge-container` (the script alone is not a challenge: a
  site using the WAF's SDK loads it on real pages); a `<link>` with `rel` including `stylesheet`
  and an `href` whose whole path matches `^/_fs-ch-[A-Za-z0-9]+/assets/styles\.css$`, with a
  `div#loading-error` whose `role` is `alert`. URL attributes are read through one shared
  `attributeUrl`, against `https://challenge.invalid/`, which Anubis's solver check now uses too.
  Fixtures `ieee_aws_waf.html` and `springer_client_challenge.html` (JSTOR's is byte-identical).
  Red first: 11 of 139 failing before the recogniser, 140 of 140 after; removing either second
  element turns 8 red. Over every fixture, only the four bot checks are refused, with an address
  and without. `evals/results/extraction-score.json` re-recorded locally (no network, no model):
  26 new rows, and four `aaronson` rows on non-shipping arms that had drifted under earlier
  commits; `challengeIn` does not fire on aaronson.
- **Tests**: each fixture refused as `ChallengePage` through both read paths and `runExtract`,
  with an address and with `url: null`, and **winning over** the generic refusal it gets today
  (`TooLittleTextToRead`, `ReadabilityRefused`); with either half removed, `challengeIn` is
  `null` (the page is still refused generically: it does not become an article); in a substantial
  real article, each half alone is not refused and both are; the markup quoted in a `<pre>` is not
  refused (Sol, F5).
- Provider names in `ChallengeProvider`; the reader's sentence is unchanged (`[jb-bot-check]`,
  already in `SUGGESTS_UPLOAD`, so the Upload button appears).
- IEEE's answer is a **202 carrying the 2 KB page** when the request accepts HTML, as
  `fetchDocument`'s does (three of three, 2026-10-17); stage 1 takes a 2xx, so stage 2 sees the
  page. An empty 202 (seen only without an `Accept` header) would stop in stage 1 and never reach
  this entry (Sol, F9).

### Stage 2: the "Save for Spideryarn" bookmarklet

- **`src/web/save-page-bookmarklet.ts`**: the bookmarklet's source, built from a readable function
  (`savePageForSpideryarn`), and a pure `bookmarkletHref()` that turns it into the `javascript:`
  URL. The function:
  1. clone `document.documentElement`, **remove every `<base>` from the clone, and write each
     `src`, `href`, `poster` and `srcset` address back resolved against the live page's
     `document.baseURI`** (which is absolute whatever the page's own `<base>` says), **except an
     `href` beginning `#`**, left as written, and anything `new URL` refuses or that is not a web
     address. Sol's F3 was that a kept relative `<base>` leaves an upload's images relative; the
     first fix, one absolute `<base>`, turned every in-page footnote link into a link to the
     publisher's page, because Readability resolves `#fn1` against a base when the document has
     no address of its own (found by the Stage 2 builder, 2026-10-17). Rewriting the addresses
     themselves has neither problem;
  2. remove what the list above removes, and nothing else;
  3. **declare the encoding** (Sol, R2-2): remove every `<meta charset>` and
     `<meta http-equiv=content-type>` from the clone and put `<meta charset="utf-8">` first in
     `<head>`. A `Blob` from a string is UTF-8, and an uploaded page with no declared charset is
     decoded as Windows-1252, so without this every accented letter arrives garbled;
  4. serialise with `<!doctype html>`; if the result is over the upload cap (50 MiB,
     `MAX_UPLOAD_BYTES`; the bookmarklet carries the number as a constant, tested against the
     real one), `alert` that the page is too big to add and stop;
  5. build a `Blob` of type `text/html`, click a temporary `<a download="<title>.html">` on its
     blob URL, revoke the URL afterwards. The filename from `document.title`, stripped of
     characters filesystems refuse, capped, falling back to `page.html`.

  No network request of any kind, so no CSP `connect-src` or `form-action` can stop it, and no COOP
  applies.
- **Tests** (Vitest, jsdom): the function on a fixture document produces one download of a `.html`
  whose bytes `uploadedDocumentKind` calls HTML; the page's own base — none, absolute, relative
  (`/assets/`), several — leaves **no `<base>` in the file and absolute image addresses through
  `readArticle(html, null)`** in each, and a `#fn1` link stays in-page; the removed elements are gone;
  iframe embeds, Tufte sidenotes, MathJax scripts and a textarea code sample come through
  `readArticle` as they do without the pass; no charset, a conflicting legacy charset, non-Latin
  prose and a multibyte title, through the real Blob bytes; the filename and its fallbacks; the size
  refusal exactly at the limit, one byte over, and with multibyte text; and `bookmarkletHref()` round-trips (the
  decoded body, evaluated, is the same function).
- **Where the reader finds it**: under the Upload control on a failed add page
  (`UploadInstead.tsx`), one line and the draggable link: *"Next time, drag Save for Spideryarn to
  your bookmarks bar. On a page that turns us away, click it, then upload the file it saves."* And
  a short section in Help's *Adding articles* (`src/web/help/pages/adding-articles.md`), beside the
  existing `/add/<url>` bookmarklet line, saying what it saves and what it does not. **Drawn only
  where the primary pointer is fine** (`(pointer: fine)`): a touchscreen laptop's primary pointer is
  its trackpad, so it keeps the link (Sol, F8), and a phone or an iPad without a trackpad, where a
  link cannot be dragged into the browser's bookmarks, does not get a drag instruction it cannot
  follow (Sol, R2-6). Help says how to add a bookmarklet by hand for those.
- **The link installs; it does not run here** (Sol, F4). React 19 refuses a `javascript:` href, so
  the link sets its `href` through a ref after mount, built from our own constant, never from data.
  A click or Enter on it would run the bookmarklet on Spideryarn's own page, so `onClick`
  prevents the default and says, in a short line beside it, *drag it to your bookmarks bar*. Drag
  keeps the `href`. Tested: a click creates no Blob and no download; the element's `href` is the
  `javascript:` URL.
- **Proven end to end, not just in jsdom**: in Playwright on the box, the function run on pages
  that load (a Nature and a PLOS article) and on a constructed "walled" page whose images are on a
  host that refuses us; each file uploaded through a local dev server's add page and read. The
  walled one checks what happens to its images (Sol, F7). What the box cannot prove: a real
  bookmarklet click on a CSP-strict page (Chrome and Firefox run bookmarklets despite page CSP, by
  their own carve-outs; Safari untested), which Greg is asked to try once.

### Stage 3: the write-up and the bookkeeping

- **A new question for Greg**, since what is left is a different question from q-fp8tqr: (1) build
  option A, which needs a fixed-host Europe PMC door in `fetch.ts` and a JATS→HTML converter, for
  6 of 29 in this sample, potentially more pending a guarded fetch of the repository copies and a
  licence and version check; (2) let an upload carry
  the address it was saved from (source link, Refresh); (3) try the bookmarklet, and the one-click
  handoff, on his laptop on cell.com.
- q-fp8tqr: the reply quoted, `acted: spya-wm83gt`, `status: answered`. The note's ending and
  comment updated; `scripts/feedback-endings.ts`.

## GPT Sol's plan review, 2026-10-17

[261017b-plan-review-sol.md](261017b-plan-review-sol.md), verdict *REWORK*, nine findings, all
taken; each is marked above where it changed the plan. F1 (the counts were wrong by hand: 29
refused, not 31) and F2 (the conclusion about A was wider than the evidence) changed the
investigation. F3, F4, F6, F7, F8 changed Stage 2; F5 and F9 Stage 1. Sol's summary of the
design: *"The file handoff itself is a sound COOP-independent v1: there is no comparably simple
full-document `postMessage` replacement that preserves the unchanged cross-site/authentication
defence."*

**Round 2** ([261017b-plan-review-2-sol.md](261017b-plan-review-2-sol.md), verdict *REWORK*), six
findings, all taken. R2-1 (removing every iframe, input and script deletes real content: video
embeds, Tufte sidenotes, MathJax) narrowed what the bookmarklet removes; R2-2 (an undeclared UTF-8
file is read as Windows-1252) added the charset step; R2-3 narrowed the wording on the 15 closed
papers; R2-4 made the IEEE status reproducible ([`ieee-status.txt`](../investigations/261017a-evidence/ieee-status.txt));
R2-5 says image retention on a real walled page is unverified, and that the fallback can fail even
for the owner; R2-6 replaced `isPhone` with the primary pointer. Two rounds are done, so discovery
on the plan is closed; the code review is next.

## The spike

A Sonnet subagent, 2026-10-17: system Chrome, headed under xvfb, Playwright, no stealth plugin, no
checkbox clicked. All six sites (cell.com, PNAS, SAGE, Wiley, BMJ, ScienceDirect) answered with
Cloudflare's or ScienceDirect's challenge, so no article page's headers were read. On the challenge
pages: COOP `same-origin` on the five Cloudflare ones; `window.open` handle non-null, `closed`
false at once and true after 2 s; `postMessage` did not throw; the popup's `opener` was `null`;
a `javascript:` URL set from script was blocked by the challenge page's nonce-only `script-src`
(which says nothing about a real bookmarklet, which browsers exempt).

## Done means

The two challenge pages refused as bot checks, red first; the bookmarklet built, tested and seen
working end to end through the upload; the question written; `npm test` and `npm run typecheck`
green; GPT Sol has reviewed this plan and the code.
