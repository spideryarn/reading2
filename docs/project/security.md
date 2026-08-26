# Security

**Two untrusted parties, and neither is another user.**

**The content**, which is what most of this document is about. Spideryarn is a local, single-user
tool, which normally shrinks a security problem to nothing. It doesn't help here, because the single
user is precisely who is targeted — every time they point the app at somebody else's article. And
pointing it at arbitrary URLs is the entire product, so "don't open untrusted articles" was never
available as a mitigation.

**The URL**, which is a second one and was missed for a day —
[§ The URL is the second untrusted party](#the-url-is-the-second-untrusted-party). Every `/api/…`
path segment is attacker-controllable the moment anything at all can make the browser issue a
request, and three of them were being joined onto a filesystem path unchecked.

Everything in the first half below follows from the first of those.

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

### Sanitised twice, on purpose <a id="sanitised-twice-on-purpose"></a>

Stage 3 is not the last line of defence, and treating it as one was the original mistake. The
article is sanitised **twice**, and the two passes have different jobs:

| | where | job |
|---|---|---|
| server | [`src/sanitize.ts`](../../src/sanitize.ts), stage 3 | make the *stored artefact* clean, so `blocks.json` on disk isn't a loaded gun and every later consumer inherits a sane starting point |
| browser | [`src/web/sanitize.ts`](../../src/web/sanitize.ts), at article ingress | **guard the actual render** |

The reason is the parser. The server pass runs under **jsdom's** HTML parser; the page runs
**Chrome's**. Two parsers disagreeing about the same bytes is the entire mechanism of mutation XSS,
and the disagreements are documented rather than hypothetical — DOMPurify's own README names attack
vectors in specific jsdom versions and treats the server DOM as part of your trusted computing base.
Sanitising in the engine that will render the result removes the differential instead of hoping
about it. It also means an article stored *before* the sanitiser existed renders safely, since old
`blocks.json` files are never retroactively cleaned on disk.

**One policy, two bindings.** The config, the embed allowlist and the hook live in
[`src/sanitize-policy.ts`](../../src/sanitize-policy.ts), which imports nothing Node-specific — it is
in the browser bundle's module graph. Two passes that disagree would be *worse* than one, because
the arrangement looks like defence in depth and is really two half-policies; `tests/sanitize-client.test.ts`
runs a shared corpus through both bindings and asserts the outputs are byte-identical.

**Why ingress and not the render sink.** React is not the first browser parser to see the string.
[`annotate.ts`](../../src/web/annotate.ts) gets there first, twice: `renderedText` does
`div.innerHTML = html` on every block to measure the offset space comments are anchored in, and
`annotateHtml` does it again to draw the marks — and `annotateHtml` has a fast path that returns the
string **unparsed** when a block has no comments, so a sanitiser bolted onto its tail would skip
almost every block. Sanitising at the doorway covers all three parses.

Sanitising *before* annotation also keeps the policy single. Annotation legitimately adds the
`data-comment` / `data-mark-end` / `data-open` attributes and the `cmt` class that the policy forbids
in source markup; a pass placed after it would need a second, laxer config, and drift between two
configs would be a worse bug than the one it fixed. Verified in Chrome: with the payload below
neutralised, all ten of the sample article's real comment marks still render.

Both the ordering and the ingress placement came from GPT-5's design review, 2026-08-25. The first
draft of this document recommended sanitising at the sink, which would have missed both earlier
parses.

**Verified in a browser, with a positive control.** A hostile payload was written into a stored
`blocks.json` — the realistic "artefact from before the fix" case — and the page opened in Chrome.
Every handler was gone from the rendered DOM, the lookalike embed was removed, and the forged
`<mark class="cmt" data-comment>` came out as a plain `<mark>`. The control is what makes that
meaningful: the surviving `<img>` really did fail to load (`naturalWidth === 0`), and an `onerror`
handler attached to an identical failing src on the same page *did* fire — so the handler was
**removed**, not merely never triggered. Without that control the test would have shared an
assumption with the code, which is the [silent-success](../reusable/silent-success.md) shape.

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
- **the annotation attributes the client owns** — `data-comment`, `data-mark-end`, `data-open`,
  `data-term`, and the `cmt` and `term` classes. [`annotateHtml`](../../src/web/annotate.ts) adds
  these *after* sanitising and the reading view treats them as its own, so an article shipping
  `<mark class="cmt" data-comment="…">` in its source would draw a fake comment in someone else's
  document. `term` joined the list when the glossary landed
  ([glossary.md](glossary.md)) and is the less obvious of the two: a comment mark is visibly the
  reader's, whereas a forged term underline reads as *the app having decided* those words matter.
  See [comments.md](comments.md).

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

## The URL is the second untrusted party <a id="the-url-is-the-second-untrusted-party"></a>

**Found and fixed 2026-08-25.** A confirmed path traversal in the read API, demonstrated rather than
argued: a `blocks.json` and `tree.json` planted in a directory under `/tmp`, then requested through
`GET /api/article/` with a slug of twelve `..%2F` followed by that path. HTTP 200, with the planted
text in the response body.

The chain, and every link of it looked reasonable on its own:

```
/api/article/..%2F..%2F…             the route pattern is [\w.%-]+ — `%` and `.` both allowed
  → part(m, 1)                        percent-decodes  →  "../../…"
  → loadArticle(slug)                 no validation
  → path.join(ROOT, "data", slug)     `..` is NORMALISED, not refused
  → outside the repo
```

**`path.join` does not defend anything.** It resolves `..` segments as an ordinary part of its job;
refusing them is not among its responsibilities. Anywhere a value that came from outside meets
`path.join`, the validation has to have happened already.

### Why it survived being looked at

The disguise is the fixture fallback. `loadArticle` tries `data/<slug>/` and then `example/`, so a
*shallow* traversal — `../../etc`, the thing you would naturally try — finds no `blocks.json`, falls
through, and serves the example article. That reads exactly like a refusal. You have to climb all the
way out and land on a directory you control before the behaviour differs at all, so a probe that
stops short reports the endpoint safe. Another [silent success](../reusable/silent-success.md): the
check you would naturally run returns the answer you were hoping for, because it shares an
assumption with the code.

The tests in [`tests/routes.test.ts`](../../tests/routes.test.ts) therefore use a deliberately deep
escape, and say why — a short one would pass against the vulnerable code.

**The fallback now says when it fires.** `loadArticle` logs a `warn` — *"article served from the
fixture, not from its own directory"* — whenever a slug other than `example` is answered out of
`example/`. It does not make the disguise less convincing in the *response*, which is still an
indistinguishable HTTP 200; it means the server says out loud what the response cannot. See
[logging.md § The fixture alarm](logging.md#the-fixture-alarm-and-what-it-can-never-fire-for), which
also records the thing that surprised us: an *absent* `blocks.json` falls through to the fixture, but
a *malformed* one throws a 500 and never reaches it.

### The write side, which was already guarded

`POST /api/comments/:slug` would have been worse than a leak: `save()` in
[`src/comments.ts`](../../src/comments.ts) does `mkdir(..., { recursive: true })` before writing, so
an unchecked slug there is arbitrary directory creation plus an arbitrary write of a file called
`comments.json`. It was not exploitable, because that module has always validated at its own door —
`assertSlug`, with the right instinct written beside it: *"anything that isn't [a path segment] is
refused outright rather than sanitised, because sanitising invites arguing about whether it
worked."* It surfaced as a 500 rather than a 400, which is now fixed at the route.

### What the fix is

`slugPart()` in [`src/routes.ts`](../../src/routes.ts), beside `part()`, and the file states the rule
rather than leaving it to be inferred: **`part` for identifiers that are only ever looked up in a
list; `slugPart` for every capture that becomes a directory name.** The next person adding a route
will copy whichever line they read first, so which is which has to be written down.

Behind it, `requireSlug()` in [`src/api.ts`](../../src/api.ts) checks again at the point of the
`path.join`. That is not redundancy for its own sake: the route is what turns a bad slug into a 400,
and the store-level check is what stops the hole reopening the next time one of these functions is
called from somewhere that is not a route — which already happens, in `answer()`.

Affected and now closed: `/api/article/:slug`, `/api/metadata/:slug`, `/api/comments/:slug` (GET,
POST, DELETE). `/api/tweets/:slug` was guarded when it was written.

### The knowledge was already in the codebase

This is the part worth sitting with. `parseJobRequest` in the *same file* validates its slug and says
exactly why: *"it is joined onto `data/` and `output/`, so an unchecked one is a path traversal."*
`src/comments.ts` validates at its own door. Both were written by people who had the whole thought.
It simply never reached the three read routes, because nobody was looking at them at the time.

A rule stated in one function is not a rule the codebase follows. The two things that make it one
are a shared helper the wrong choice is visibly absent from, and a test that fails when it is.

### Still open here

- **`isSlug` and `assertSlug` are two different definitions of a slug.** (`assertSlug` now lives in
  [`src/slug.ts`](../../src/slug.ts) — it had been copied into five reader-state modules, which is
  what this warning predicted; the two *rules* are still two.)
  [`src/ingest.ts`](../../src/ingest.ts) says `^[a-z0-9][a-z0-9-]*$`;
  [`src/comments.ts`](../../src/comments.ts) says `^[\w.-]+$`. Neither admits a `/`, so neither is a
  traversal, but a codebase with two answers to "what is a slug" will eventually be asked the
  question by something that only checks one of them.
- **Nothing rate-limits or authenticates any of this**, which is fine for one process on a laptop and
  is not fine on the public internet — see
  [deploy-and-repo-move.md](../plans/deploy-and-repo-move.md), which has this going online.

## A third untrusted party: what the model returns

The two above are the content and the URL. There is now a third, and it is quieter because it does
not feel like input: **strings a language model produced, rendered as markup.**

Everything the model writes in this app is rendered as **text**, deliberately — chat answers, gists,
arc sentences, tweet posts, glossary entries. No `dangerouslySetInnerHTML` anywhere near any of them,
and the prompts say plain prose partly for that reason. There are **two** exceptions, and they are
the ones to watch.

This paragraph used to say "exactly one", and it was wrong for a day: chat quietly made it two when
the web-search citations landed, and the sentence sat here reassuring anyone who read it. That is
the failure mode a security doc has — it does not get compared against the code unless somebody
thinks to.

**`Citation.url` becomes an `href`** — the web pages a chat answer cites, rendered as a source list
under the answer ([`ChatPanel.tsx`](../../src/web/ChatPanel.tsx)). Allowlisted by `isWebUrl` in
[`src/urls.ts`](../../src/urls.ts), and allowlisted **twice**: once in
[`src/converse.ts`](../../src/converse.ts) before the URL is stored, and again in the panel before it
is rendered. The repetition is deliberate — `chat.json` is a file on disk that predates the check and
can be hand-edited, and the render is the boundary that actually matters.

`isWebUrl` also has to *parse*, not only allow, and that is the second half of its job: the panel
calls `new URL()` again to show a hostname when a citation has no title, and `new URL()` **throws**
rather than returning null. One malformed citation used to take the whole chat panel down mid-render.

`src/urls.ts` is a module of its own with no imports at all, because both halves of the app need it
and neither may import the other — see [`tests/client-imports.test.ts`](../../tests/client-imports.test.ts).

**`GlossaryEntry.url` becomes an `href`.** A model may return `javascript:alert(1)` there — not
maliciously, but because a page it half-remembers had one, or because the article it just read
contained one. `safeUrl` in [`src/glossary.ts`](../../src/glossary.ts) parses it and allows `http:`
and `https:` and nothing else, and it does so **server-side, at build time**, so a bad scheme never
reaches the artefact rather than being filtered on the way out.

This is worth a paragraph because of how the original version got it wrong: their record validated
the same field with Zod's `.url()`, which checks that the string *parses* as a URL — and
`javascript:alert(1)` parses fine. A validator that looks like a security check and is not is worse
than none, because it stops anyone looking again. Tested in
[`tests/glossary.test.ts`](../../tests/glossary.test.ts).

**The rule to carry forward:** any model output that becomes an attribute — an `href`, a `src`, a
`style`, an `id` — is untrusted input and needs an allowlist, not a parse. Model output that becomes
a text node does not.

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
- ~~**We sanitise with jsdom's parser and render with Chrome's.**~~ **Closed 2026-08-25** — see
  [Sanitised twice, on purpose](#sanitised-twice-on-purpose) above. What remains is that the client
  test runs under vitest's jsdom environment, so it pins that the policy is wired up and identical,
  not that the two engines agree. A real Chromium mXSS corpus still belongs with
  [browser-testing.md](browser-testing.md). The end-to-end check described above *was* run in Chrome,
  with a positive control, but by hand rather than in CI.

- **The ingress call is guarded by reading source, not by mounting the app.** Deleting
  `sanitizeArticle(...)` from [`App.tsx`](../../src/web/App.tsx) would otherwise leave every
  sanitiser test green while reopening the original hole, so `tests/sanitize-client.test.ts` asserts
  that every `setArticle` argument is either `null` or wrapped — and that no client file imports the
  jsdom-bound module. Both were mutation-tested. A mount test driving the real fetch → state →
  annotate → render chain would be stronger; it needs a React testing library this project doesn't
  have, and picking one is its own decision
  ([third-party-library-selection.md](../reusable/third-party-library-selection.md)).

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

Related: [auth.md](auth.md) for the beta gate — the third untrusted party this doc does not cover,
which is a stranger with your API keys,
[architecture.md](architecture.md) for where stage 3 sits,
[block-ids.md](block-ids.md) for the contract the `id` attribute carries,
[content-extraction.md](content-extraction.md) for what stage 2 does and does not promise,
[web-client.md](web-client.md) for the render path.
