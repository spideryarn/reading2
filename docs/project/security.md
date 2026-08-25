# Security

One threat matters here, and it isn't the usual one.

**The untrusted party is the content, not another user.** Spideryarn is a local, single-user tool,
which normally shrinks a security problem to nothing. It doesn't help here, because the single user
is precisely who is targeted — every time they point the app at somebody else's article. And
pointing it at arbitrary URLs is the entire product, so "don't open untrusted articles" was never
available as a mitigation.

Everything below follows from that.

- The gate: [`src/sanitize.ts`](../../src/sanitize.ts), called from stage 3 in
  [`src/blocks.ts`](../../src/blocks.ts)
- The tests: [`tests/sanitize.test.ts`](../../tests/sanitize.test.ts), plus the end-to-end cases at
  the bottom of [`tests/blocks.test.ts`](../../tests/blocks.test.ts)
- Decided 2026-08-25, closing [open-questions.md § Q9](open-questions.md#q9)

## What was wrong

The chain, before the fix:

```
any URL the reader gives us
  → fetch → JSDOM → Readability            (src/extract.ts)
  → output/<slug>.html
  → content.outerHTML  →  block.html       (src/blocks.ts)
  → annotateHtml(...)  →  dangerouslySetInnerHTML   (src/web/TableView.tsx)
```

Nothing in that chain sanitised anything. **Readability is a content extractor, not a sanitiser**,
and Mozilla is unusually direct about it in
[its SECURITY.md](https://github.com/mozilla/readability/blob/main/SECURITY.md):

> `readability` itself does not intend to do security-related input sanitization … it is expected
> that some interactive/scripting input may remain after `readability` processes input. If you can
> bypass appropriate sanitization measures like DOMPurify you should report that using their
> procedures, not Mozilla's.

So "Readability cleaned it" was never a defence, and Mozilla will not even take the bug report.

Measured by running a hostile page through the real pipeline, rather than assumed:

| Payload | Survives Readability? |
|---|---|
| `<script>` | stripped |
| `<form>` | stripped |
| `javascript:` href | stripped (the whole `<a>` is unwrapped) |
| `onmouseover=` on an `<a>` | stripped, because the `<a>` goes |
| **`onmouseover=` on a `<span>`** | **survives** |
| **`<img onerror=…>`** | **survives** |
| **`<svg onload=…>`** | **survives** |
| **`<video onerror=…>`** | **survives** |
| **`<iframe>` from a video host** | **survives, by design** |

The last four rows are the ones that mattered. `<script>` inserted via `innerHTML` never executes,
which is presumably why this went unnoticed for months. `onerror` and `onload` are not so lucky:
both fire, and a surviving `<img src="…/x" onerror="…">` runs on load failure — which is
*guaranteed*, because the src is bogus. No click required; opening the article was enough.

> Three of those rows correct the table originally written in Q9, which had `onmouseover` and
> `<iframe>` as stripped. Both are stripped in the case Q9 happened to test and survive in cases it
> didn't. Worth stating plainly: **the first table was written from a spot check and was wrong in a
> reassuring direction**, which is the [silent-success](../reusable/silent-success.md) pattern
> applied to a security note.

**What it got.** Not much on the open web — no other site's cookies, since we are our own origin.
Locally it was worse than it looks. `npm run dev` is a Vite dev server, so same-origin `fetch`
reaches the dev middleware and whatever Vite will serve off disk, and the result can be POSTed
anywhere. It also reaches our own API, which is not a passive store: `/api/comments/:slug` runs the
explain-this-passage call in [`src/explain.ts`](../../src/explain.ts), so injected script could spend
the reader's API budget silently and read back every article and every question they had asked.

## The fix, and where it lives

**Sanitise at stage 3, in [`src/blocks.ts`](../../src/blocks.ts), not in the client.** The stored
`blocks.json` is then clean, every later consumer inherits that instead of having to remember, and
the client stays a renderer. It runs *before* ids are minted, so ids are only ever stamped onto
elements that are staying.

This is also the answer to a documentation failure. [content-extraction.md](content-extraction.md)
claimed for months that stage 2 owed stage 3 "sanitized HTML". It didn't, and nothing did. A doc
asserting the problem was handled is how this survived unexamined — a reader checking whether
extraction was safe would have found that line and stopped looking.

### The library: DOMPurify

Chosen against [third-party-library-selection.md](../reusable/third-party-library-selection.md),
2026-08-25. Version 3.4.14.

| | DOMPurify | sanitize-html | xss (js-xss) |
|---|---|---|---|
| weekly npm downloads | **~62M** | ~10.6M | ~5.7M |
| TypeScript types | bundled | `@types/…` (DefinitelyTyped) | bundled |
| maintainer | Cure53 (a browser-security firm) | **repo archived 2026-02-27** | leizongmin |
| approach | real DOM traversal | htmlparser2 | regex / string |

DOMPurify wins on the criterion this repo cares most about — *long-lived, heavily documented, lots
of pretraining data* — by roughly six to one, and it is what Mozilla's own security policy points at.

The other two disqualify themselves on closer look. **`sanitize-html`'s upstream repo was archived
(read-only) on 2026-02-27**; development moved inside the ApostropheCMS monorepo and the standalone
package has no clear owner for the next bypass. `xss` is maintained but is string- and regex-based
rather than DOM-based, so it cannot see the mutation-XSS class of bug at all — the class this
document is most worried about.

DOMPurify needs a DOM, which under Node means jsdom; we already depend on jsdom, so that costs
nothing, and `isomorphic-dompurify` would be a dependency for a problem we don't have (it bundles
its own jsdom and pins the version, which is a footgun, not a feature, when you already have one).

### What survives, and what doesn't

Kept, because the reading view needs them: `id` (see below), ordinary `data-*`, prose markup, the
structures the block splitter looks for (`figure`, `figcaption`, `blockquote`, `pre`, `li`, `table`),
and inline `<svg>`.

Removed:

- every event-handler attribute, every scripting URL, `<script>`, `<iframe>` (except below)
- **form controls.** DOMPurify allows them by default. They are never prose, and a
  `<form action="https://evil.test">` rendered inside our own origin is a phishing surface for
  nothing in return.
- **all author CSS**, both `style="…"` and `<style>`. DOMPurify deliberately does not sanitise CSS —
  it is outside its
  [threat model](https://github.com/cure53/DOMPurify/wiki/Security-Goals-&-Threat-Model) — and
  article CSS is powerful enough to matter: a retained
  `<svg style="position:fixed;inset:0;width:100vw;height:100vh">` covers the whole reading view and
  takes the clicks. Prose gets its looks from our own stylesheets
  ([design-css-overview.md](design-css-overview.md)), so nothing of value is lost.
- **the annotation attributes the client owns** — `data-comment`, `data-mark-end`, `data-open`, and
  the `cmt` class. [`annotateHtml`](../../src/web/annotate.ts) adds these *after* sanitising and the
  reading view treats them as its own, so an article shipping
  `<mark class="cmt" data-comment="…">` in its source would draw a fake comment in someone else's
  document. See [comments.md](comments.md).

### Video embeds are kept, behind an origin allowlist

Greg's call, 2026-08-25. Readability deliberately preserves embeds from video hosts, so dropping
every `<iframe>` would silently delete real content — a YouTube player vanished from the Noema sample
article the first time this ran. Allowed: `https://www.youtube.com/embed/`,
`https://www.youtube-nocookie.com/embed/`, `https://player.vimeo.com/video/`. Everything else goes.

**The host check compares `url.origin` exactly.** Not `includes`, not `endsWith`, not an unanchored
regex — `"https://www.youtube.com.evil.test/embed/x".includes("youtube.com")` is true, and so is
`endsWith` against a crafted subdomain on the attacker's own domain. A sloppy host test here reopens
the whole hole in the one place nobody would think to look again. The lookalikes are pinned as tests.

Each surviving embed is then re-clothed rather than trusted: we replace the author's `allow`
attribute (Noema's asked for `accelerometer`, `autoplay`, `clipboard-write`, `encrypted-media`,
`gyroscope` and `web-share`) and set `sandbox` ourselves.

`sandbox="allow-scripts allow-same-origin"` looks alarming, because together those two normally
defeat a sandbox: a frame same-origin with its parent can reach up and delete its own `sandbox`
attribute. It is safe **here, and only here**, because every allowlisted origin is a third party —
the frame keeps YouTube's origin, not ours, so "same-origin" buys it nothing against us. Both flags
are required; drop `allow-same-origin` and the player gets an opaque origin and breaks. That whole
argument depends on the frame's document really being third-party, which is why `srcdoc` is
forbidden: a `srcdoc` frame runs in *our* origin and the reasoning would be exactly backwards.

## Four ways to break this silently

Each of these leaves an article that still renders, so nothing draws attention to it.

1. **Turning on `SANITIZE_NAMED_PROPS`.** It is DOM-clobbering protection, it is off by default, and
   it rewrites every `id` to `user-content-<id>`. That renames all 139 block ids on the sample
   article, orphans every comment and every `#spya-…` link, and breaks
   [the one contract the project rests on](block-ids.md). Nothing throws. The ToC just quietly stops
   resolving.
2. **Narrowing `ALLOWED_ATTR` by hand.** `id` survives because it is in DOMPurify's *default*
   allowlist. A hand-written list that forgets it takes the spine with it.
3. **Adding an attribute in the embed hook without adding it to `ADD_ATTR`.** DOMPurify strips it on
   the next pass and the hook re-appends it in a different position, so the output only converges
   after two runs and every re-run rewrites `blocks.json` for no reason. `referrerpolicy` did
   exactly this.
4. **Checking the embed host with anything other than an exact origin comparison.** As above.

Idempotence is a *requirement*, not a nicety: `npm run blocks` writes its HTML output back over its
own input file and is re-run routinely, so a second pass must be a no-op. Pinned by tests in both
files.

## Why the string path, not `IN_PLACE`

The first version of `sanitize.ts` passed live nodes from stage 3's own JSDOM document with
`IN_PLACE: true`, to save one parse. It worked, and it was a bad trade. That single line combined
three of DOMPurify's sharpest edges, and each has shipped a CVE in the three months to August 2026:

| Advisory | What | Fixed in |
|---|---|---|
| [CVE-2026-49458](https://github.com/advisories/GHSA-hpcv-96wg-7vj8) | an instance bound to one realm sanitising a node from **another realm** with `IN_PLACE` — realm-bound `instanceof` checks silently skip sanitisation steps | 3.4.6 |
| [GHSA-55q2-fjhq-7xh7](https://github.com/advisories/GHSA-55q2-fjhq-7xh7) | a **hook removing an element** leaves a detached subtree executable | 3.4.13 |
| CVE-2026-49459, CVE-2026-65901 | `IN_PLACE` trusting clobbered root attributes / attacker-controlled `nodeName` | 3.4.x |

Our pinned 3.4.14 has all of them, and 3.4.14 itself fixed "possible bypasses when risky tags are
allow-listed" — which is us, allowlisting `iframe`. That is not the point. Our code did all three
things at once: cross-realm, `IN_PLACE`, and a hook that removes elements. Being patched today is a
weaker position than not needing the patch, so the module now hands DOMPurify **strings only**:
`el.innerHTML = DOMPurify.sanitize(dirty)`, its canonical usage and the path that gets the scrutiny.
The cost is one extra parse of a 78KB document, which is nothing.

Because sanitising `innerHTML` says nothing about the node it was read from, `sanitizeInPlace` also
strips risky attributes from the root element itself — `<body onload>` is the obvious gap otherwise.

### Never wrap sanitised output in a raw-text element

[CVE-2026-65914](https://github.com/cure53/DOMPurify/security/advisories/GHSA-h8r8-wccr-v5f2)
("mXSS via re-contextualization", affected 3.1.3–3.3.1, fixed 3.3.2) is worth knowing even though our
3.4.14 is past it, because the *shape* of it is a rule about how callers use the output:

```js
wrapper.innerHTML = "<xmp>" + DOMPurify.sanitize(x) + "</xmp>";   // ← the bug
```

Concatenating sanitised HTML into a **raw-text or RCDATA element** — `<xmp>`, `<script>`, `<iframe>`,
`<noembed>`, `<noframes>`, `<noscript>` — and re-parsing lets a `</xmp>` sequence inside a sanitised
attribute regain structural meaning on the second parse and break out. We are safe because
[`annotateHtml`](../../src/web/annotate.ts) parses into a plain `<div>` and React renders into a
normal element, and that is a property to preserve deliberately, not a coincidence. Plain
`dangerouslySetInnerHTML` of an already-sanitised fragment is not the vulnerable pattern.

### The cost

Sanitising adds one HTML parse per article. Worth knowing precisely, because the
[ingest queue](ingest-queue.md) runs stage 3 inside the long-lived server process: measured on the
78KB Noema article, each `sanitizeHtml` call retains about **1.7MB** that survives a forced GC.

That is not a sanitiser bug, and re-architecting this module will not fix it — **plain jsdom retains
about 4.5MB per parse on its own**, with no DOMPurify involved, and `window.close()` does not release
it. Stage 3 already parsed a JSDOM per article before this change, and so does stage 2. Sanitising
makes an existing cost roughly a third worse; it does not introduce it. If the server process ever
needs to ingest many articles without restarting, the fix belongs to the queue — see
[ingest-queue.md](ingest-queue.md) — not here.

## Known gaps

Honest list. None is a reason to delay the fix above; all are worth knowing.

- **Stage 2's debug page is not sanitised.** [`src/extract.ts`](../../src/extract.ts) writes
  `output/<slug>.html` straight from Readability, and opening that file directly in a browser runs
  whatever survived. Stage 3 rewrites the same file with clean HTML, so the window is between the
  two commands — but "run extract, then eyeball the HTML" is a real debugging workflow. Left alone
  deliberately: stage 2 belongs to the extraction agent
  ([architecture.md § Stage ownership](architecture.md#stage-ownership)) and the file had another
  agent's edits in it. The fix is two lines — import `sanitizeInPlace` and call it on the document
  before writing. **Worth doing.**
- **We sanitise with jsdom's parser and render with Chrome's — and only sanitise once.** This is the
  biggest open item, and it is a design gap rather than a missing test.
  [`annotateHtml`](../../src/web/annotate.ts) takes the stored string, re-parses it in the browser
  with `div.innerHTML`, walks it, and serialises it back, and React parses it once more. So the
  string crosses between two different HTML parsers, which is precisely the mechanism mutation-XSS
  exploits — and it is *not* hypothetical that jsdom and browsers disagree: DOMPurify's own README
  names known attack vectors in specific jsdom versions and treats the server DOM as part of your
  trusted computing base.

  Sonar's [mXSS cheatsheet](https://sonarsource.github.io/mxss-cheatsheet/remediation/) is blunt
  that client-side sanitisation is the one that avoids parser differentials, and that server-side
  HTML parsers introduce them. **The recommended fix is a second DOMPurify pass in the browser,
  immediately before `dangerouslySetInnerHTML`** — belt and braces, not a replacement: sanitising at
  stage 3 is what keeps `blocks.json` itself clean, and a stored artefact full of live handlers
  would be its own problem. Two things to get right if we do it: it must run *after* the
  `<mark>`-wrapping (so it also covers bugs in our own annotation code), which means the client
  config has to **allow** `data-comment` / `data-mark-end` / `data-open` and the `cmt` class that
  the server config forbids — the two policies are deliberately not the same. Touching
  [`src/web/TableView.tsx`](../../src/web/TableView.tsx) is stage 6's call.

  Keeping inline SVG (Greg, 2026-08-25) is what makes this matter most: foreign content is where
  namespace confusion lives, and an HTML-only profile would close that class outright. The
  annotation code itself is sound — constants, `setAttribute`, `textContent`, no string
  interpolation — and a same-engine mXSS corpus round-trips cleanly. A real Chromium test belongs
  with [browser-testing.md](browser-testing.md).

- **No Trusted Types.** Newly practical: it reached all major browsers during 2025–26 (Safari 26,
  Firefox Feb 2026). `require-trusted-types-for 'script'` plus one policy whose `createHTML` calls
  `DOMPurify.sanitize(…, { RETURN_TRUSTED_TYPE: true })` would make it structurally impossible to
  write a raw string into the DOM *anywhere in the app, including code nobody has written yet*. That
  is a stronger guarantee than any amount of care at the call site, and it pairs with the client-side
  pass above.
- **No Content-Security-Policy.** Worth more than first assumed: most mXSS payloads execute through
  inline event handlers (`onerror=`, `onload=`) rather than `<script>` tags, and a `script-src`
  without `unsafe-inline` blocks inline handlers too — so it bites the actual payload shape. The
  friction is real though: Vite's dev client and React Fast Refresh inject inline scripts, so a
  strict policy breaks HMR unless it goes through Vite's `html.cspNonce` plumbing. Lower priority
  than the two items above, which protect the specific sink rather than execution in general.
- **Old artefacts are not re-sanitised on read.** `blocks.json` files written before this change are
  trusted as-is. Re-run stage 3 to clean them. The one checked-out article was already clean.
- **Remote content still loads.** Images, and an allowlisted embed, fetch from third parties on
  render, which tells them you are reading the piece. Inherent to displaying an article's images.

## If you are changing any of this

Read [`src/sanitize.ts`](../../src/sanitize.ts) top to bottom first — it is one screen of policy and
four screens of why. Then run `npm test`. The tests are the specification: every payload in
`tests/sanitize.test.ts` was verified to survive Readability first, so none of them is hypothetical.

Related: [architecture.md](architecture.md) for where stage 3 sits,
[block-ids.md](block-ids.md) for the contract the `id` attribute carries,
[content-extraction.md](content-extraction.md) for what stage 2 does and does not promise,
[web-client.md](web-client.md) for the render path.
