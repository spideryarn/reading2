Two factual corrections first:

- The current public API exposes only `article` and `metadata`; [`PUBLIC_ROUTE_NAMES`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/route-names.ts:77) and [`PublicArticleReader`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/public-reader.ts:68) do not yet include glossary, summaries, ideas, or tweets.
- Changing `X-Robots-Tag` cannot by itself enable indexing. [`public/robots.txt`](/Users/greg/Dropbox/dev/experim/spideryarn2/public/robots.txt:16) still says `Disallow: /`, so compliant crawlers never reach the dynamic header.

## 1. How the function gets the built shell

Confirm the compile-in proposal, with one qualification: it is safe only if the API build proves that `dist/` came from the current client build.

The current worktree demonstrates the gap: HEAD was `608fed0`, while `dist/build.json` named `9134796`. Running the API build alone now would compile a stale shell.

In [`vite.api.config.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/vite.api.config.ts:69):

1. Read `dist/index.html`.
2. Read `dist/build.json`.
3. Resolve the API build stamp.
4. Refuse the build unless the client stamp and API stamp name the same non-`unknown` commit.
5. Assert the shell contains exactly one managed-head sentinel and a built `/assets/...js` script, and does not contain `/src/web/boot.tsx`.
6. Compute SHA-256 of the untouched shell.
7. Compile both into constants:

```ts
define: {
  __SPIDERYARN_BUILT_SHELL__: JSON.stringify(shell),
  __SPIDERYARN_BUILT_SHELL_SHA256__: JSON.stringify(shellSha256),
  // existing stamp constants…
}
```

Put bounded markers around the replaceable block in `index.html`:

```html
<!-- spideryarn:managed-head:start -->
<title>Spideryarn</title>
<meta name="description" content="…" />
<meta name="robots" content="noindex, nofollow" />
<!-- spideryarn:managed-head:end -->
```

The default robots meta is a fail-closed backstop if a malformed `/read/` URL ever misses the function rewrite.

Do not supply an empty or source-shell fallback. A production API build without a fresh client shell should fail.

Local development needs no constant: `npm run dev` never loads `vite.api.config.ts` or `src/vercel.ts`; Vite serves its transformed shell and React sets the title after mounting. `/read/:slug` therefore keeps the ordinary default head in development. Test the head builder directly, or run the full two-build command for production parity.

Expose the base-shell digest as `X-Spideryarn-Shell-SHA256` on function-served pages. The deployed check compares it with the SHA-256 of `GET /index.html`.

## 2. Where the route hooks in

Add this as the first rewrite, before both existing entries:

```json
{
  "source": "/read/:slug",
  "destination": "/api/index?__spy_read=:slug"
}
```

So the final order is:

```json
"rewrites": [
  {
    "source": "/read/:slug",
    "destination": "/api/index?__spy_read=:slug"
  },
  {
    "source": "/api/(.*)",
    "destination": "/api/index?__spy_path=$1"
  },
  {
    "source": "/((?!api/).*)",
    "destination": "/index.html"
  }
]
```

Do not reuse `__spy_path` directly: [`originalUrl()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:91) always reconstructs `/api/${capture}`. Overloading it would either manufacture `/api/read/:slug` or add a public HTML alias below `/api/`.

Extend the same restoration function to understand two mutually exclusive captures:

- `__spy_path=x` → `/api/x`
- `__spy_read=x` → `/read/x`
- repeated parameters, or both kinds together → `null`
- each platform capture decoded exactly once
- the request’s remaining query parameters retained unchanged

Then, after the health exception and before `handleApi`, branch on the restored path:

```ts
const read = /^\/read\/([^/]+)\/?$/.exec(path);

if (read) {
  await servePublicReadPage({
    res,
    method: req.method ?? "GET",
    encodedSlug: read[1]!,
    shell: builtShell(),
  });
  return;
}
```

Keep the database/head logic in a new narrow module such as `src/public/page.ts`; `src/vercel.ts` should retain only transport knowledge.

Vercel matches rewrite sources against the incoming pathname without its query string, so `?at=…` and other reader state do not affect route matching. This and the negative-lookahead syntax are documented in [Vercel’s project configuration reference](https://vercel.com/docs/project-configuration/vercel-json).

## 3. Dynamic `X-Robots-Tag`

Ultimately split the current site-wide header rule:

```json
"headers": [
  {
    "source": "/((?!read(?:/|$)).*)",
    "headers": [
      { "key": "X-Robots-Tag", "value": "noindex, nofollow" }
    ]
  },
  {
    "source": "/(.*)",
    "headers": [
      { "key": "Referrer-Policy", "value": "no-referrer" }
    ]
  }
]
```

The function then owns exactly one robots header for every `/read/:slug` response:

- public, readable article: `index, follow`
- private, absent, malformed, unreadable, or failed: `noindex, nofollow`

Set the fail-closed value before validation or database access; replace it with `index, follow` only after the `publicSlug` query succeeds and establishes that the article is readable.

For indexing to work, also change `robots.txt` to:

```text
User-agent: *
Allow: /read/
Disallow: /
```

The longer `Allow` match wins under the Robots Exclusion Protocol. More importantly, a crawler blocked by `robots.txt` cannot see an `X-Robots-Tag` at all. [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html), [Google Search documentation](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).

On deployment, use HTTP/1.1 and inspect raw response headers:

```sh
curl --http1.1 --path-as-is \
  -H 'Accept-Encoding: identity' \
  -sS -D public.headers -o public.html \
  "$HOST/read/$PUBLIC_SLUG"
```

Count header lines case-insensitively. Require exactly one, with the exact expected value. Repeat against a known private slug and a random nonexistent valid slug.

## 4. What goes in the head

Do not load the article and its blocks. Add an internal `head` projection to the hardwired public reader, still through `publicCurrentRevisionQuery()` and `publicSlug()`:

- extracted title
- first-H1 title fallback
- `root_gist`
- `final_url`
- `hasTree`
- an `exists` check for at least one block

That last check matters: `loadArticle()` refuses a tree with no blocks, while today `loadMetadata()` only checks the tree. The head must not return 200 for a page React cannot render.

| Tag | Value |
|---|---|
| `<title>` | Existing page-title rule: cleaned/clamped article title, then ` · Spideryarn` |
| `meta description` | Cleaned `root_gist`, if present |
| `og:type` | `article` |
| `og:site_name` | `Spideryarn` |
| `og:title` | Article title without the app suffix |
| `og:description` | Exactly the same description |
| `og:url` | `https://www.spideryarn.com/read/${encodeURIComponent(slug)}` |
| `twitter:card` | `summary` |
| `twitter:title` | Same as `og:title` |
| `twitter:description` | Same description |
| canonical | Sanitised original article URL, when one can be emitted safely |

### Description

Use `article_revisions.root_gist`, not `excerpt` directly.

That column already encodes the intended fallback in [`deriveLibraryScalars()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/library-scalars.ts:83):

```ts
root?.gist ?? root?.summary ?? excerpt ?? null
```

Its own comment says this is what a card wants. It gives the planned root gist when one exists and Readability’s excerpt when it does not. Use the same value for ordinary, Open Graph, and Twitter descriptions. Different descriptions create three policies with no reader benefit.

If it is null, omit all three description tags. Do not substitute the app strapline for a description of the article.

### Canonical

Add one composed function to [`src/urls.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/urls.ts:27), rather than exporting `hasCredentials`:

```ts
safePublicCanonical(value: string): string | null
```

Policy:

1. Parse once with `new URL`.
2. Allow only `http:` and `https:`.
3. Require empty username and password.
4. If any query string exists, omit the canonical entirely.
5. Remove the fragment.
6. Refuse a serialised result longer than 2,048 characters.
7. Escape the resulting URL as an HTML attribute.

Do not strip a query and then pretend the remaining URL is the same document. On many sites `?id=123` is the article identity. Publishing a signed query is unsafe; silently deleting a semantic query is false. Refusal is the honest answer.

Keep this value internal to the head query. Do not add `meta.url` or a canonical field to `PublicMeta`. If the client later gets a visible “read the original” link, that should be a separate product decision and a separately named sanitised DTO field.

### Image

No `og:image` or `twitter:image` in Stage 2. Use `twitter:card=summary`, not `summary_large_image`. A third-party lead-image URL would be an endorsement, a privacy contact, and another untrusted `src` sink.

## 5. Private, missing, and malformed slugs

Return the real shell, not JSON and not a bespoke error page:

| Case | Status | Head | Robots |
|---|---:|---|---|
| Public and readable | 200 | Enhanced | `index, follow` |
| Valid but private | 404 | Unmodified default | `noindex, nofollow` |
| Valid but nonexistent | 404 | Unmodified default | `noindex, nofollow` |
| Revision not readable | 404 | Unmodified default | `noindex, nofollow` |
| Malformed slug | 400 | Unmodified default | `noindex, nofollow` |
| Unsupported method | 405 + `Allow: GET, HEAD` | Unmodified or empty | `noindex, nofollow` |
| Unexpected storage failure | 500 | Unmodified default | `noindex, nofollow` |

Every response gets:

```text
Content-Type: text/html; charset=utf-8
Cache-Control: no-store
```

`HEAD` returns the same status and headers as `GET`, including truthful UTF-8 `Content-Length`, but no body.

One current-code correction: [`parseRoute()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/router.ts:243) accepts any nonempty decoded segment. `Upper` therefore becomes an article route, hits a 400 API response, and renders an error—not `LandingPage`. Add `isSlug(slug)` there so malformed article addresses fall back to the existing library/Landing behavior. `ingest.ts` is already an approved pure client import.

A 404 HTML document still executes its scripts, so a private or absent valid slug can mount React and render `LandingPage`. Verify that in a browser; do not infer it from curl.

## 6. Escaping and text hygiene

Yes: extract a shared `escapeHtml()` into a dependency-free module such as `src/html.ts`, and replace both private copies.

Escape all five:

```ts
/[&<>"']/g
```

with `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;`.

Before escaping, run all title and description text through one head-text normaliser:

1. Remove Unicode bidirectional control characters, including RLO/LRO and isolate controls. Do not remove ordinary Arabic or Hebrew characters.
2. Replace C0/C1 controls, CR, LF, and tabs with spaces.
3. Collapse whitespace and trim.
4. Clamp by Unicode code points:
   - page title portion: existing 64-character rule
   - Open Graph/Twitter title: 120
   - description: 240
5. Escape exactly once at the final HTML boundary.

Escaping alone handles `</title>` safely, but it does not make newlines, invisible direction changes, or a 50,000-character title suitable metadata.

Also assert that the managed-head sentinel occurs exactly once and that everything from `<body` onward is byte-for-byte unchanged. That is the guard against the function becoming a renderer.

Required red mutations:

- Map `<` to itself: `</title><meta name="robots" …>` must create a second element and fail.
- Map `"` to itself: a description beginning `" /><meta …>` must fail the DOM-shape test.
- Remove whitespace normalisation: `A\r\nB` must stop equalling `A B`.
- Remove bidi stripping: `A\u202Eevil` must retain the control and fail.
- Remove the clamp: a 10,000-character title must exceed the asserted bound.
- Insert one character after `<body>`: the “body unchanged” check must fail.

## 7. Testing without a deployment

Most of this is local. Three platform-composition claims genuinely require Vercel.

| Check | Local or deploy? | Mutation that must make it red |
|---|---|---|
| Head tags and escaping | Local pure test using jsdom | Stop escaping `<` or `"` |
| Body and asset references unchanged | Local pure test | Append one byte inside `<body>` |
| Private title never enters output | Local Postgres/reader test | Replace `publicSlug(slug)` with an unfiltered slug predicate |
| `root_gist` fallback behavior | Local | Select `excerpt` directly instead |
| Canonical query refusal | Local | Delete the `search !== ""` refusal |
| Fresh client shell required | Local build helper | Put a different commit in `dist/build.json` |
| API bundle contains built assets | Local full build | Read source `index.html` instead of `dist/index.html` |
| Rewrite ordering as written | Local config-structure test | Move the read rewrite below the SPA catch-all |
| Actual Vercel rewrite matching | Deploy | Deploy that reordered mutation; public URL must return the default title |
| Header collision/merging | Deploy | Restore the global robots header while the function also sets one |
| Embedded shell equals served shell | Deploy | Add a byte to the compiled shell after calculating its digest |
| Browser still boots | Deployed browser | Change the embedded script URL to `/assets/missing.js` |
| `robots.txt` admits `/read/` | Deploy | Remove its `Allow: /read/` line |
| Encoded slash stays harmless | Deploy with `curl --path-as-is` | Decode the slug twice; the expected 400/default-head assertion must change or fail |

The minimal deployed checks are:

1. Public slug: 200, enhanced title, exactly one `index, follow`, no source title sentinel, `Cache-Control: no-store`.
2. Known private slug: 404, bare `Spideryarn` title, exactly one `noindex, nofollow`, no private title anywhere.
3. Random valid slug: same as private.
4. Malformed and `%2F`/`%252F` paths with `--path-as-is`: never enhanced, never `index`.
5. `GET /index.html` hash equals the dynamic response’s `X-Spideryarn-Shell-SHA256`.
6. `/build.json` and `/api/health` still name the expected commit/deployment.
7. `robots.txt` is text/plain and contains the exact Allow/Disallow pair.
8. A signed-out real browser reaches visible article prose, with no console error, every referenced asset 200, and no private request or POST.

The browser mutation is the important one: corrupt the compiled script URL. Curl still returns 200 with the right title; the browser check must show a blank page.

## 8. Anonymous `localStorage` reader state

Separate slice. It shares no server logic and should not hold up previews or indexing.

Also, there is no single “zoom depth” in the current client. Zoom is represented by `cols`, plus `text`; the active band is `mode`, and the drawer is `panel`.

Keep the URL authoritative. `localStorage` only seeds fields absent from the incoming URL:

```ts
interface PublicResumeV1 {
  at?: string;
  cols?: number[];
  text?: boolean;
  mode?: Mode;
  panel?: Panel;
}
```

Rules:

- Key: `spya.public-resume.v1:${slug}`.
- Mount only inside `VisitorArticle`, never the owner path.
- Explicit URL values win field by field.
- Validate stored values through the same parsers as URL input.
- After hydration, write the allowlisted state when it changes.
- Never store article prose, titles, selected comments, chat threads, searches, terms, ideas, or owner information.
- A throwing, unavailable, or malformed store means “no saved state”; it must not break reading.
- Update `url-state.md`, whose present claim that nothing lives in `localStorage` becomes false. The accurate rule is that the URL remains the live/shareable state; storage remembers a visitor’s last URL state.

The positive control for the jsdom trap:

1. Give `window.localStorage` a working in-memory `Storage`.
2. Make the bare/global `localStorage` unavailable.
3. Mount a public article, change position/columns/mode, unmount.
4. Start at a bare `/read/:slug`, remount, and assert the URL and visible UI restore.
5. Mutate the implementation from `window.localStorage` to bare `localStorage`; the test must fail because nothing is restored.

Also test a throwing store. That test only proves graceful failure; it is not the positive persistence test.

## 9. Cut lines

Stage 2 is three vertical slices:

1. **Unfurls, still noindex — first independently shippable slice.** Compile the real shell, add the read rewrite and function branch, public head query, safe tags, 404 default shell, no-store, HEAD support, shell digest, and deployed browser check. Leave the current global `noindex` and `robots.txt` intact.
2. **Public pages may be crawled.** Split the static headers, make the function own robots dynamically, and change `robots.txt` to allow `/read/`. Deploy-check public, private, and missing responses together.
3. **Anonymous resume.** Add the visitor-only localStorage layer and its positive-control browser/component test.

This cut makes link previews useful before changing crawler exposure. The first slice is a complete user-visible result, not build infrastructure sitting unused.

## 10. What will bite

- **`robots.txt` currently defeats indexing.** This is the largest missing item in the Stage 2 plan.
- **The prompt overstates Stage 1.** The checked-in public route inventory still has only two endpoints.
- **`/read/:slug/metadata` and `/read/:slug/tweets` are separate live client routes.** The proposed rewrite enhances only the base reading URL. Either state that intentionally or add equivalent function handling later; do not use `/read/:path*` accidentally and capture every nested route without deciding.
- **Never build `og:url` from `Host` or forwarded headers.** Use the fixed production origin; otherwise an attacker-controlled host becomes public metadata.
- **Support HEAD.** The public JSON namespace already learned that unfurlers use it.
- **`Referrer-Policy: no-referrer` does not interfere with unfurling.** The unfurler already possesses and requests the shared URL; the policy controls referers sent by the resulting document’s browser requests.
- **No `Vary` is needed.** The response does not vary by cookie, authorization, user agent, or accept language. Adding `Vary: Cookie` would falsely suggest sessions matter.
- **Slack and similar services cache cards themselves.** Unsharing makes the next request 404/default-head immediately, but it cannot retract a card Slack already stored. The sharing confirmation should say that plainly.
- **Search removal is also not immediate.** A later 404/noindex is the correct response, not an instant purge.
- **Bots executing JavaScript are safe only if the Stage 1 network trace remains true.** The new HTML path does not replace that acceptance test.
- **Indexing invites database traffic.** With no caching and no public index, ordinary unfurl traffic is small; permitting crawlers changes that assumption. Rate limiting/database timeouts remain an explicit later decision.
- **Canonical-to-original means search engines will usually prefer the publisher’s page.** That is the adopted decision, but it means Stage 2’s reliable marketing value remains unfurls and direct reading, not search ranking.