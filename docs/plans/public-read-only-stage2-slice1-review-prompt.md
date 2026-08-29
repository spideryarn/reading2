# Review the built code for stage 2, slice 1 — the shared link that previews

You designed this slice. `docs/plans/public-read-only-stage2-input-sol.md` is your own input document
and it was adopted almost whole. **This is the second pass, on the code rather than the plan**, and
it is weighted higher than the first for the reason the house rules give: a plan-stage review cannot
find a handler that writes one field and then rejects the request.

Repository: `/Users/greg/Dropbox/dev/experim/spideryarn2`. Read whatever you need from it. The scoped
diff is below; new files are included whole.

## What the slice is for

`/read/:slug` was rewritten to a static `index.html` whose `<title>` is the bare word *Spideryarn*,
with the real title set by React after mount. No unfurler runs our JavaScript, so **every link
anybody shared previewed as nothing**. A serverless function now serves the same built bundle with
its `<head>` filled in from the database, for public articles only.

**Crawler exposure does not change in this slice.** The site-wide `X-Robots-Tag: noindex, nofollow`
in `vercel.json` is untouched, `public/robots.txt` still says `Disallow: /`, and the function sets no
robots header of its own. Your § 3 is a later slice. Do not review this against it.

## The two places the implementation departs from your design, deliberately

Both are mine, both are argued in the code, and I want you to attack the arguments rather than the
divergence.

**1. An unexpected reader failure answers 200 with the default shell, where your § 5 says 500.**
The reasoning is in the header of `src/public/page.ts`. In short: the design was written about a
*preview*, but this route serves the reading view itself. A 500 replaces our application with
Vercel's error page, so a transient database fault on this one head query would take down a page the
client could otherwise have loaded on its own — the bundle fetches its own data through
`/api/public/article/:slug` and does not need this query to have succeeded. So it degrades to *no
preview* rather than *no page*, and logs and captures so the degradation is never silent.

Tell me if that is wrong. The specific thing I want tested is whether there is a case where answering
200 with a default head is worse than answering 500 — a cache, a crawler, a monitor, an unfurler that
caches a bad card, something I have not thought of.

**2. `src/web/router.ts`'s `parseRoute` now rejects a malformed slug**, which is your § 5 correction,
and it required editing two existing cases in `tests/router.test.ts` whose fixtures (`/read/a b`,
`/read/a/b`) describe slugs `isSlug` can never accept. Check that the replacements test what the
originals were for, and that nothing else in the client builds a `/read/` address from something that
is not a slug.

## What I have already checked, so you can spend your effort elsewhere

- `npm run typecheck` (all three projects) and `npm test` are green — 5,874 tests, after I fixed one
  failure of my own that this work exposed: a fixture uuid claimed by two test files that run in
  parallel against one database.
- Both builds run: `npm run build && npx vite build --config vite.api.config.ts`.
- **The stale-shell refusal fires.** I put a wrong commit in `dist/build.json` and the API build
  failed, naming both values. Restored, it builds.
- **The compiled shell is the built shell.** SHA-256 of `dist/index.html` appears in `api-dist/vercel.js`,
  as does the hashed `/assets/index-*.js` reference.
- **I drove the compiled bundle against a real Postgres**, with a genuinely public article, and got:
  200 with the article's own title and `og:title` for the public slug; 404 with a bare `Spideryarn`
  for an absent one; 400 for a malformed one; `HEAD` giving status 200, `Content-Length: 7574` and a
  zero-byte body identical to the GET's length; `POST` giving 405 with `Allow: GET, HEAD`; both
  captures together giving 400; and no `X-Robots-Tag` from the function on any of them.

## What I most want from you

1. **Anything that leaks.** The private/absent/malformed responses must be indistinguishable, and no
   private article's title may reach any byte of any response. Is there a path where it does?
2. **The escaping boundary.** `escapeHtml` and `headText` are applied in `src/public/page-head.ts`.
   Is every untrusted value escaped exactly once, and is there a value that reaches the document
   without passing through both?
3. **`originalUrl` in `src/vercel.ts`**, which now decodes two mutually exclusive captures. Is there
   an input that produces a path it should not — an encoded slash, a repeated parameter, a `%25`, a
   capture that decodes into a query string, an empty capture?
4. **Whether `composeShell` can be made to touch the body.** The claim is that it replaces only the
   region between two sentinels and that everything from `<body` onward is byte-identical. Is there
   a shell for which that is false?
5. **The three-way `HeadLoad`.** `not-shared` and `failed` are deliberately distinct. Is the
   classification in `loadHead` right — specifically, is `status === 404` the correct and complete
   test for "the reader chose this refusal", and can a genuine fault be misread as a 404?
6. **Anything in the tests that cannot fail.** Every assertion here is supposed to have a mutation
   that reddens it, and the agents that wrote them report 17 of 17 and 12 of 12 going red. Assume at
   least one of those reports is wrong and find which.

Be specific, cite files and lines, and say which findings are blockers and which are not. Where you
think I am wrong, say so plainly — several of your findings on the earlier passes changed the design,
and two were themselves wrong and I want to be able to tell the difference.

## The scoped diff

```diff
diff --git a/index.html b/index.html
index 17c20c5..e25ec5c 100644
--- a/index.html
+++ b/index.html
@@ -14,8 +14,42 @@
          Every page sets its own from src/web/page-title.ts — see
          docs/project/page-titles.md — so this is deliberately the bare name
          rather than a guess at which page is about to render. -->
+    <!-- **The two `managed-head` comments below are a boundary, not decoration.**
+
+         `composeShell()` in src/public/page-head.ts replaces everything between
+         them — the two comments included — and **nothing else**, when the stage
+         2 serverless function serves a shared `/read/<slug>` link. That is what
+         turns a pasted address into a card with the article's own title and
+         gist on it, instead of the bare product name below. See
+         docs/plans/public-read-only-access.md § Stage 2.
+
+         Two consequences, both easy to get wrong later:
+
+          - **Anything put between them is gone on a shared link.** Tags that
+            must survive — the referrer policy, the icons, the manifest, the
+            viewport — belong outside, where they are.
+          - **Each comment must appear exactly once in this file.** The function
+            asserts it and refuses to compose otherwise, and so does the build
+            check in scripts/client-shell.ts, so a duplicate is a failed build
+            rather than a head assembled from the wrong halves. That is also why
+            neither marker's full text is written out in this prose.
+
+         The build compiles `dist/index.html` into the function, so a change here
+         reaches production only through `npm run build`; the API build refuses a
+         stale one. `npm run dev` never loads that config, so locally the head
+         below is simply what you get. -->
+    <!-- spideryarn:managed-head:start -->
     <title>Spideryarn</title>
     <meta name="description" content="AI-assisted reading: an article at whatever level of detail you need." />
+    <!-- Belt and braces, and it changes nothing today: the `X-Robots-Tag`
+         header Vercel sets already says exactly this for every path, and
+         public/robots.txt still says `Disallow: /`. It is here for the day the
+         header is narrowed so that shared articles can be indexed — at which
+         point a `/read/` URL that somehow missed the rewrite would otherwise be
+         indexable by accident. Fail closed: a document that says nothing about
+         robots is a document that may be indexed. -->
+    <meta name="robots" content="noindex, nofollow" />
+    <!-- spideryarn:managed-head:end -->
     <!-- **No referrer, from any page of this app, to anywhere.**
 
          Settled in docs/plans/public-read-only-access.md § Stage 1 and then not
diff --git a/src/vercel.ts b/src/vercel.ts
index e9805c8..bca0d49 100644
--- a/src/vercel.ts
+++ b/src/vercel.ts
@@ -46,6 +46,7 @@ import {
   withMonitoringScope,
 } from "./monitoring.js";
 import { UNEXPECTED_FAILURE } from "./messages.js";
+import { builtShell, servePublicReadPage } from "./public/page.js";
 import { handleApi } from "./routes.js";
 import { health } from "./vercel-health.js";
 
@@ -70,6 +71,27 @@ export const config = { runtime: "nodejs" };
  */
 initMonitoring();
 
+/**
+ * **The two rewrites this function is the destination of**, and the prefix each
+ * one puts back.
+ *
+ * They are separate parameters rather than one, and that is the whole of it: a
+ * single `__spy_path` always reconstructs `/api/${capture}`, so reusing it for
+ * the reading page would either manufacture `/api/read/:slug` — a path nothing
+ * routes — or create a second, public HTML alias underneath `/api/`, which is
+ * exactly the "second way to read an article" src/public/routes.ts exists to
+ * refuse. GPT Sol's stage 2 design, § 2.
+ *
+ * `/read/:slug` is the **base** reading URL only. `/read/:slug/metadata` and
+ * `/read/:slug/tweets` are separate live client routes and keep falling through
+ * to the SPA catch-all; `tests/vercel-routing.test.ts` pins that, and says why
+ * `/read/:path*` would have been the wrong reach.
+ */
+const REWRITE_CAPTURES = [
+  { parameter: "__spy_path=", prefix: "/api/" },
+  { parameter: "__spy_read=", prefix: "/read/" },
+] as const;
+
 /**
  * The path the browser actually asked for, recovered from the rewrite.
  *
@@ -81,6 +103,9 @@ initMonitoring();
  * routes on `req.url`, and in several places on its query string too — would
  * 404 the lot.
  *
+ * Since stage 2 of the public reading feature it also serves `/read/:slug`, via
+ * a second and deliberately distinct parameter — see `REWRITE_CAPTURES`.
+ *
  * The captured value **must** be decoded exactly once, because Vercel encodes it
  * exactly once when it substitutes `$1` into a query value. `/api/jobs/abc/retry`
  * arrives as `__spy_path=jobs%2Fabc%2Fretry`, and an earlier version of this
@@ -96,40 +121,50 @@ initMonitoring();
  *
  * Two `__spy_path` parameters means one of them came from the client, who is
  * then choosing which route runs. That is refused rather than resolved: picking
- * either one is a guess, and the guess is a routing bypass.
+ * either one is a guess, and the guess is a routing bypass. **Both kinds
+ * together is the same fault wearing a new coat** — a caller who can put
+ * `?__spy_read=…` on an `/api/` request is choosing between two handlers with
+ * two quite different authorization stories, and there is no answer to that
+ * which is not a guess. Refusing is the only one that is not.
  */
 export function originalUrl(raw: string): string | null {
   const cut = raw.indexOf("?");
   if (cut === -1) return raw;
 
-  const PREFIX = "__spy_path=";
   const rest: string[] = [];
-  let captured: string | null = null;
-  let seen = 0;
+  /* Counted per parameter and collected across both, so the two failures are
+     distinguishable in the code even though they share an answer: `seen` is
+     "the client repeated one", `found.size` is "the client mixed them". */
+  const seen = new Map<string, number>();
+  const found = new Map<string, string>();
 
   for (const part of raw.slice(cut + 1).split("&")) {
-    if (part.startsWith(PREFIX)) {
-      seen += 1;
-      captured = part.slice(PREFIX.length);
+    const capture = REWRITE_CAPTURES.find((c) => part.startsWith(c.parameter));
+    if (capture) {
+      seen.set(capture.parameter, (seen.get(capture.parameter) ?? 0) + 1);
+      found.set(capture.parameter, part.slice(capture.parameter.length));
     } else if (part) {
       rest.push(part);
     }
   }
 
-  if (seen > 1) return null;
+  if (found.size > 1) return null;
+  const parameter = [...found.keys()][0];
   /* Not rewritten at all — which is the normal case in development, where this
      same handler is never used, and would also be the case if the rewrite in
      vercel.json were ever removed. Leaving the URL alone is right in both. */
-  if (captured === null) return raw;
+  if (parameter === undefined) return raw;
+  if ((seen.get(parameter) ?? 0) > 1) return null;
 
   let path: string;
   try {
-    path = decodeURIComponent(captured);
+    path = decodeURIComponent(found.get(parameter) ?? "");
   } catch {
     return null;
   }
 
-  return `/api/${path}${rest.length ? `?${rest.join("&")}` : ""}`;
+  const prefix = REWRITE_CAPTURES.find((c) => c.parameter === parameter)?.prefix ?? "/api/";
+  return `${prefix}${path}${rest.length ? `?${rest.join("&")}` : ""}`;
 }
 
 /**
@@ -195,7 +230,49 @@ async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
     return;
   }
 
+  /**
+   * **The reading page, served as HTML with its head filled in.**
+   *
+   * One regex, one call, and every decision on the other side of it. The head,
+   * the database read, the statuses and the escaping all live in
+   * src/public/page.ts — this file's own header says it must stay
+   * transport-free, and a `<title>` is not transport.
+   *
+   * `[^/]+` is the base reading URL and nothing under it: `/read/x/metadata`
+   * does not match here and does not match the rewrite in vercel.json either,
+   * so it reaches the SPA catch-all and the client renders it, exactly as
+   * before.
+   *
+   * **`builtShell()` returning null means there is no compiled shell**, which
+   * is every context except a production API build — vite.api.config.ts is the
+   * only thing that defines the constant, and `npm run dev` never loads it. The
+   * request then falls through to `handleApi`, which does not claim `/read/`
+   * and answers the 404 below. That is the honest answer: without the shell
+   * there is nothing to serve, and inventing one would be a second reading view.
+   */
+  const read = /^\/read\/([^/]+)\/?$/.exec(path);
+  const shell = read ? builtShell() : null;
+
   try {
+    /* **Inside the try**, and that is not filing. `composeShell` throws when the
+       compiled shell has no managed-head sentinel or has two — a broken build,
+       and it throws on the default-head path too, so it can happen on any of
+       the five cases below it. Outside this try that throw would escape
+       `handler`'s `finally` and become a platform FUNCTION_INVOCATION_FAILED
+       with the reason nowhere a person can reach it, which is the exact failure
+       api/index.js exists to have stopped happening. */
+    if (read && shell) {
+      await servePublicReadPage({
+        res,
+        method: req.method ?? "GET",
+        /* Already decoded exactly once, by `originalUrl` above. Decoding it a
+           second time is how `%252F` becomes a path separator. */
+        slug: read[1] ?? "",
+        shell,
+      });
+      return;
+    }
+
     const handled = await handleApi(req, res);
     if (handled) return;
     /* handleApi only claims `/api/*`. Anything else reaching this function means
diff --git a/src/web/router.ts b/src/web/router.ts
index 3236cc9..de4fb25 100644
--- a/src/web/router.ts
+++ b/src/web/router.ts
@@ -62,6 +62,8 @@
  */
 import { useMemo, useSyncExternalStore } from "react";
 
+import { isSlug } from "../ingest.js";
+
 /** Which of an article's three pages. `article` is the reading view itself. */
 export type ArticleView = "article" | "metadata" | "tweets";
 
@@ -245,7 +247,16 @@ export function parseRoute(pathname: string): Route {
   } catch {
     return { kind: "library" };
   }
-  if (!slug) return { kind: "library" };
+  /* **The same `isSlug` the server uses**, and not merely "is it non-empty".
+     `/read/Upper` used to become an article route: the client would ask for it,
+     the API would refuse it with the 400 it gives every malformed slug, and the
+     reader would get an error page instead of the shelf. A mistyped address is
+     supposed to land you on the shelf — see this function's header — and an
+     address the server can never answer is a mistyped address. GPT Sol's stage 2
+     design § 5. `src/ingest.ts` is an approved shared import
+     (tests/client-imports.test.ts), so both sides ask one function rather than
+     two regexes drifting apart. */
+  if (!isSlug(slug)) return { kind: "library" };
   // The alternation in the regex is the validation: anything that reached here
   // is a known segment or nothing at all.
   const view = (m[2] ?? "article") as ArticleView;
diff --git a/tests/public-imports.test.ts b/tests/public-imports.test.ts
index fc3fdf4..61f22e6 100644
--- a/tests/public-imports.test.ts
+++ b/tests/public-imports.test.ts
@@ -145,13 +145,44 @@ const WRITERS = [
 
 const FORBIDDEN = [...OWNER_READS, ...THE_OWNER, ...SPENDS, ...WRITERS];
 
+/**
+ * **Every door a stranger can come through**, and there are two of them now.
+ *
+ * `src/public/routes.ts` is the JSON namespace. `src/public/page.ts` is the
+ * HTML one — stage 2 serves `/read/:slug` from the same function, off the same
+ * hardwired reader, to somebody who has not signed in and never will. It is the
+ * same closed room with a second door, so it gets the same guard rather than a
+ * new one: a walk that started only at `routes.ts` would have said nothing at
+ * all about the page, and the page is the surface we invite strangers to.
+ *
+ * Listed rather than globbed over `src/public/`, so adding a third entry point
+ * is a decision somebody makes here on purpose. `dto.ts` and `route-names.ts`
+ * are leaves reached from these two, not doors of their own.
+ */
+const PUBLIC_ENTRIES = ["src/public/routes.ts", "src/public/page.ts"];
+
+/** Everything reachable from either door, deduplicated. */
+function publicFiles(): string[] {
+  return [...new Set(PUBLIC_ENTRIES.flatMap((entry) => graphFrom(entry)))].sort();
+}
+
 describe("the public API's import graph", () => {
-  const publicGraph = graphFrom("src/public/routes.ts");
+  const publicGraph = publicFiles();
 
   it("cannot reach the owner's reads, the owner, a writer or the gateway", () => {
     expect(publicGraph.filter((f) => FORBIDDEN.includes(f))).toEqual([]);
   });
 
+  /**
+   * And each door on its own, so a failure names the one that opened.
+   *
+   * The case above would go red for either, and then somebody would have to
+   * work out which — these two make the answer the test name.
+   */
+  it.each(PUBLIC_ENTRIES)("and neither does %s on its own", (entry) => {
+    expect(graphFrom(entry).filter((f) => FORBIDDEN.includes(f))).toEqual([]);
+  });
+
   /**
    * And the reader itself, checked separately — because somebody adding a
    * public endpoint would edit `public/routes.ts`, and somebody adding a public
@@ -339,7 +370,7 @@ describe("the public API's tables", () => {
     const forbidden = tables.filter((t) => !ALLOWED.includes(t));
 
     const offenders: string[] = [];
-    for (const file of graphFrom("src/public/routes.ts")) {
+    for (const file of publicFiles()) {
       if (file === SCHEMA) continue;
       const source = readFileSync(path.join(ROOT, file), "utf8");
       const full = path.join(ROOT, file);
@@ -405,7 +436,7 @@ describe("the public API's tables", () => {
     expect(forbidden).toContain("glossaryLookups");
 
     const offenders: string[] = [];
-    for (const file of graphFrom("src/public/routes.ts")) {
+    for (const file of publicFiles()) {
       if (file === SCHEMA) continue;
       /* Comments stripped — this file and the public reader both discuss these
          tables by name while explaining the rule, and a guard that fires on its
diff --git a/tests/public-visibility-pg.test.ts b/tests/public-visibility-pg.test.ts
index 21a98b7..2d454eb 100644
--- a/tests/public-visibility-pg.test.ts
+++ b/tests/public-visibility-pg.test.ts
@@ -1407,8 +1407,14 @@ when("sharing one article", { timeout: 60_000 }, () => {
  * this file green: the bar is unreachable from the corpus that exists. A guard
  * no fixture can redden is a comment. docs/reusable/silent-success.md.
  */
-const BONELESS_ID = "00000000-0000-4000-8000-0000000000ec";
-const BONELESS_REVISION = "00000000-0000-4000-8000-0000000000ed";
+/* **Not the ...00ec/...00ed pair this fixture was first written with.**
+   `tests/public-dispatch.test.ts` already declares ...00ed as a user id, and
+   `tests/fixture-ids.test.ts` refuses a uuid claimed by two test files — vitest
+   runs them in parallel against one database, so whichever tears down first can
+   delete the other's row while both pass when run alone. The two ids here are
+   in a block nothing else touches. */
+const BONELESS_ID = "00000000-0000-4000-8000-0000000b04e0";
+const BONELESS_REVISION = "00000000-0000-4000-8000-0000000b04e1";
 const BONELESS_SLUG = "test-public-head-no-blocks";
 
 when("a public article whose revision has no blocks", { timeout: 60_000 }, () => {
diff --git a/tests/router.test.ts b/tests/router.test.ts
index 96f2e96..7667071 100644
--- a/tests/router.test.ts
+++ b/tests/router.test.ts
@@ -37,8 +37,47 @@ describe("parseRoute", () => {
     });
   });
 
+  /**
+   * The decode still happens — the fixture changed, because the old one could
+   * not exist.
+   *
+   * This case read `/read/a%20b` → `slug: "a b"` until `parseRoute` grew an
+   * `isSlug` guard. `isSlug` is `^[a-z0-9][a-z0-9-]*$` with a 60-character cap
+   * (src/ingest.ts), and its own comment calls it a path-traversal guard rather
+   * than a tidiness check, because a slug is joined onto `data/` and `output/`.
+   * So no article has ever had a space in its slug and none ever can, and the
+   * server 400s the address. `%2D` is a percent-encoded hyphen: a legal slug,
+   * spelled in a way that still has to be decoded to be recognised.
+   */
   it("decodes an escaped slug", () => {
-    expect(parseRoute("/read/a%20b")).toEqual({ kind: "read", slug: "a b", view: "article" });
+    expect(parseRoute("/read/a%2Db")).toEqual({ kind: "read", slug: "a-b", view: "article" });
+  });
+
+  /**
+   * **An address the server could never answer is a mistyped address**, and a
+   * mistyped address lands on the shelf — which is what this file's own opening
+   * paragraph says the degradation is for.
+   *
+   * Before the guard, `/read/Upper` became an article route: the client asked
+   * for it, the API refused it with the 400 it gives every malformed slug, and
+   * the reader got an error page. GPT Sol's stage 2 design § 5.
+   *
+   * The three shapes are chosen to be different failures rather than three of
+   * one: a capital letter, a leading hyphen (the path-traversal shape `../` is
+   * a leading punctuation mark too), and a slug past the 60-character cap — the
+   * one an alphabet-only check would wave straight through.
+   */
+  it("sends an address that is not a slug to the library instead of rendering an error", () => {
+    expect(parseRoute("/read/Upper")).toEqual({ kind: "library" });
+    expect(parseRoute("/read/-leading")).toEqual({ kind: "library" });
+    expect(parseRoute(`/read/${"a".repeat(61)}`)).toEqual({ kind: "library" });
+    /* And the control: one character shorter is a slug, and still reads. If the
+       cap moved, the case above would pass for the wrong reason. */
+    expect(parseRoute(`/read/${"a".repeat(60)}`)).toEqual({
+      kind: "read",
+      slug: "a".repeat(60),
+      view: "article",
+    });
   });
 
   it("reads the third segment as the view", () => {
@@ -121,9 +160,25 @@ describe("readHref", () => {
     expect(parseRoute(readHref(slug))).toEqual({ kind: "read", slug, view: "article" });
   });
 
+  /**
+   * **The escaping stays defensive; what changed is the far end.**
+   *
+   * `readHref` still refuses to let a slash out into the path unescaped, and
+   * that half of this case is unchanged — it is the assertion that stops a
+   * `/`-carrying value silently becoming two path segments.
+   *
+   * The round trip no longer comes back as an article, and that is the point
+   * rather than a weakening: `parseRoute` now applies `isSlug`, which no value
+   * containing a slash can pass, so an encoded slash is refused at **both**
+   * ends instead of being handed on to a server that would 400 it. Nothing that
+   * calls `readHref` in the app can produce one — every caller passes a slug
+   * the server minted, and `kebab()` in src/ingest.ts strips everything outside
+   * `[a-z0-9-]` and trims to 60 characters — so this is a guard against a value
+   * that should not exist, kept because it should not exist quietly.
+   */
   it("escapes a slug that would otherwise change the shape of the path", () => {
     expect(readHref("a/b")).toBe("/read/a%2Fb");
-    expect(parseRoute(readHref("a/b"))).toEqual({ kind: "read", slug: "a/b", view: "article" });
+    expect(parseRoute(readHref("a/b"))).toEqual({ kind: "library" });
   });
 
   it("carries view state across, with or without the leading question mark", () => {
diff --git a/vercel.json b/vercel.json
index 821c1b2..edd9d9c 100644
--- a/vercel.json
+++ b/vercel.json
@@ -24,6 +24,10 @@
   ],
 
   "rewrites": [
+    {
+      "source": "/read/:slug",
+      "destination": "/api/index?__spy_read=:slug"
+    },
     {
       "source": "/api/(.*)",
       "destination": "/api/index?__spy_path=$1"
diff --git a/vite.api.config.ts b/vite.api.config.ts
index 26b4cde..2c23095 100644
--- a/vite.api.config.ts
+++ b/vite.api.config.ts
@@ -35,9 +35,12 @@
  * it is good at.
  */
 
+import { fileURLToPath } from "node:url";
+
 import { defineConfig } from "vite";
 
 import { resolveBuildStamp } from "./scripts/build-stamp.js";
+import { readClientShell } from "./scripts/client-shell.js";
 import { sentrySourceMaps, sentryUploadEnabled } from "./scripts/sentry-build.js";
 
 /**
@@ -73,6 +76,34 @@ const BUNDLE_ANYWAY = ["html-encoding-sniffer", "@exodus/bytes"];
  */
 const stamp = resolveBuildStamp();
 
+/**
+ * **The built client `index.html`, compiled in — or no build at all.**
+ *
+ * `/read/<slug>` is served by this function so the `<head>` can be about the
+ * article rather than about the app (src/public/page-head.ts), and to do that it
+ * needs the real shell: the one with hashed `/assets/….js` in it, not the source
+ * `index.html` whose `/src/web/boot.tsx` only Vite's dev server understands.
+ *
+ * Resolved here, at config evaluation, so that **a stale or missing shell fails
+ * the build** rather than being discovered by a reader whose shared link renders
+ * a blank page. scripts/client-shell.ts holds the four checks and the reason
+ * there is no fallback of any kind; the short version is that the worktree this
+ * design came out of had HEAD at one commit and `dist/build.json` at another, so
+ * an API build on its own would have compiled a shell from a different version
+ * of the client and said nothing.
+ *
+ * `vercel.json` runs `vite build` before this, so `dist/` is fresh by
+ * construction on a deployment. Locally the two are two commands and the order
+ * is yours to get right — which is what the commit comparison is for.
+ *
+ * **There is no such constant in development.** `npm run dev` never loads this
+ * config, so `typeof __SPIDERYARN_BUILT_SHELL__` is `"undefined"` there, the
+ * function that reads it takes its other branch, and `/read/:slug` keeps the
+ * ordinary default head. Same shape as the build stamp above, and the same
+ * `typeof` guard on the reading side.
+ */
+const shell = readClientShell(fileURLToPath(new URL("./dist", import.meta.url)), stamp.commit);
+
 export default defineConfig({
   /* The server half of the source-map upload, and the half that is easy to
      forget. `vercel.json` builds the client first and this second, so a plugin
@@ -88,6 +119,14 @@ export default defineConfig({
     __SPIDERYARN_BUILD_TIME__: JSON.stringify(stamp.builtAt),
     __SPIDERYARN_BUILD_SOURCE__: JSON.stringify(stamp.source),
     __SPIDERYARN_BUILD_DEPLOYMENT__: JSON.stringify(stamp.deploymentId),
+    __SPIDERYARN_BUILT_SHELL__: JSON.stringify(shell.html),
+    /* The digest of the shell **as it was read**, before any head was composed
+       into it. Served as `X-Spideryarn-Shell-SHA256`, so the deployed check can
+       compare it against the SHA-256 of `GET /index.html` and prove the function
+       and the CDN are serving the same build. Hashing the composed output
+       instead would make that comparison always fail, and hashing nothing would
+       make it always pass. */
+    __SPIDERYARN_BUILT_SHELL_SHA256__: JSON.stringify(shell.sha256),
   },
   /* `ssr.noExternal`, not just `rollupOptions.external` below. Vite decides what
      an SSR build externalises before Rollup's own `external` hook is consulted,
=== NEW FILE: src/public/page.ts ===
/**
 * **`GET /read/:slug`, served as HTML with its head filled in** — the transport
 * half of stage 2 of docs/plans/public-read-only-access.md.
 *
 * Until now every `/read/` address was rewritten to a static `index.html` whose
 * `<title>` is the bare word *Spideryarn*, and the real title was set by React
 * after mount. No unfurler runs our JavaScript, so **every link anybody shared
 * previewed as nothing**. This module is what a Vercel function calls instead:
 * it reads six values out of the public reader, hands them to `composeShell`,
 * and writes the same built bundle back out with a real head on it.
 *
 * ## What it deliberately is not
 *
 * **It is not a second renderer.** It cannot become one, structurally: the head
 * projection in src/store/public-reader.ts does not select the blocks, so there
 * is no prose here to render even if somebody wanted to. The moment this
 * function produces body HTML we own two reading views.
 *
 * **It knows no transport.** src/vercel.ts owns the URL, the rewrite and the
 * regex; this module owns the head, the database and the statuses. The seam is
 * `servePublicReadPage`, and it takes a method and a decoded slug rather than
 * an `IncomingMessage` — the same shape and the same reason as `PublicRequest`
 * in routes.ts: there is no header to read, no body to parse and no cookie in
 * scope, so "the public page ignores `Authorization` completely" stops being a
 * thing to remember and becomes a thing there is no way to break.
 *
 * ## The decision is pure, and the I/O is four lines
 *
 * `decidePublicPage` is a function of `(method, slug, load, sha256)` with no
 * database, no clock and no response object in it, which is what makes the
 * table below testable without Postgres. `servePublicReadPage` does the read,
 * calls it, and writes what it says.
 *
 * ## What each case answers
 *
 * | Case | Status | Head |
 * |---|---|---|
 * | Public and readable | 200 | Enhanced |
 * | Private, absent, or an unreadable revision | 404 | Unmodified default |
 * | Malformed slug | 400 | Unmodified default |
 * | Method other than GET or HEAD | 405 + `Allow: GET, HEAD` | Unmodified default |
 * | **Anything else the reader throws** | **200** | **Unmodified default** |
 *
 * ### That last row is a considered disagreement with the reviewed design
 *
 * GPT Sol's stage 2 design § 5 says 500 there, and it is wrong for a reason the
 * design could not see from where it was standing: it was written about a
 * *preview*, and this route serves **the reading view itself**. A 500 replaces
 * our application with Vercel's error page, so a transient database hiccup on
 * this one head query would take down a page the client could otherwise have
 * loaded entirely on its own — the bundle fetches its own data through
 * `/api/public/article/:slug` and does not need this query to have succeeded
 * for anything. The preview is the nice-to-have; the page is the product.
 *
 * So an unexpected failure degrades to *no preview*, not to *no page*. It is
 * logged and captured so it stays visible to us rather than becoming a silent
 * downgrade — which is the only thing that would make this the wrong call.
 *
 * A 404 is **not** in that category and stays a 404: "this article is not
 * shared" is an answer, not a failure, and it is the same answer a private
 * slug, an absent slug and a broken revision all get everywhere else in this
 * feature. src/store/public-reader.ts § `notShared`.
 *
 * ## Robots
 *
 * **This module sets no `X-Robots-Tag`.** The site-wide `noindex, nofollow` in
 * vercel.json still owns it in this slice, and a second one would collide —
 * duplicate headers are a real deployed failure mode and the whole point of
 * slice 1 is that crawler exposure does not change at all. Slice 2 splits the
 * static rule and moves the header here; see the plan.
 */

import type { ServerResponse } from "node:http";

import { isSlug } from "../ingest.js";
import { errorFields, log } from "../log.js";
import { captureFailure } from "../monitoring.js";
import type { PublicHead } from "../store/public-reader.js";
import { pgPublicReader } from "../store/public-reader.js";
import { composeShell } from "./page-head.js";

/**
 * The built client, compiled into this bundle by vite.api.config.ts, with the
 * digest of the untouched original beside it.
 *
 * Not `process.env` and not a file read: a serverless function has no `dist/`
 * next to it, and the whole value of a stamp is that the running environment
 * cannot change it after the fact — the same argument src/vercel-health.ts
 * makes for the build stamp.
 */
declare const __SPIDERYARN_BUILT_SHELL__: string;
declare const __SPIDERYARN_BUILT_SHELL_SHA256__: string;

/** The shell as built, and the SHA-256 of it before anything was substituted. */
export interface BuiltShell {
  html: string;
  sha256: string;
}

/**
 * The compiled shell, or `null` where there isn't one.
 *
 * `typeof` rather than a bare read, exactly as src/vercel-health.ts guards the
 * build stamp: a `define` that never ran leaves the identifier undeclared, and
 * touching it throws a `ReferenceError` rather than giving `undefined`. Neither
 * constant exists in development or under vitest, because `npm run dev` never
 * loads vite.api.config.ts.
 *
 * Returning `null` rather than a fallback is the point. A source `index.html`
 * substituted in here would reference `/src/web/boot.tsx`, which does not exist
 * on a deployment — a page that looks right to `curl` and is blank in a browser.
 * The caller declines the request instead.
 */
export function builtShell(): BuiltShell | null {
  if (typeof __SPIDERYARN_BUILT_SHELL__ !== "string") return null;
  if (typeof __SPIDERYARN_BUILT_SHELL_SHA256__ !== "string") return null;
  return { html: __SPIDERYARN_BUILT_SHELL__, sha256: __SPIDERYARN_BUILT_SHELL_SHA256__ };
}

/**
 * What the head read came back as — **three outcomes, not two.**
 *
 * `not-shared` and `failed` are different answers with different statuses, and
 * collapsing them is the mistake this type exists to prevent: an empty result
 * means *we know, and the answer is no*, while a thrown driver error means *we
 * do not know*. docs/reusable/silent-success.md, and the memory note that an
 * empty list is not the same as never having asked.
 */
export type HeadLoad =
  | { kind: "found"; head: PublicHead }
  | { kind: "not-shared" }
  | { kind: "failed" };

/** What to write, decided before anything is written. */
export interface PageDecision {
  status: number;
  headers: Record<string, string>;
  /** `null` means the shell goes out exactly as it was built. */
  head: PublicHead | null;
}

/** Read methods, and the `Allow` value that has to agree with them. */
const READ_METHODS = ["GET", "HEAD"];
const ALLOW = READ_METHODS.join(", ");

/**
 * **Every status this route can answer, as a function of three values.**
 *
 * Pure on purpose — the table in this file's header is checked against this
 * function with no database anywhere near it, which is the difference between
 * a table that is documentation and a table that is a test.
 *
 * `load` is `null` when no read was attempted, which is the case for a refused
 * method or a malformed slug; those are decided here before anything is loaded,
 * so the ordering is visible rather than implied by the caller.
 *
 * The digest is a parameter rather than read from the compiled constant, so
 * that this function stays a function. It goes on **every** response, including
 * the refusals: the deployed check compares it against the SHA-256 of
 * `GET /index.html`, and a check that only runs on the happy path would not
 * notice a stale shell being served to the case that matters.
 */
export function decidePublicPage(
  method: string,
  slug: string,
  load: HeadLoad | null,
  sha256: string,
): PageDecision {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    /* No caching, at all. The visibility switch is a single `update`, and an
       article unshared a minute ago must stop being served now — an edge cache
       would keep answering with the enhanced head for however long it was told
       to. Slack's own card cache is beyond our reach and the sharing copy says
       so; ours is not, so we do not have one. */
    "Cache-Control": "no-store",
    "X-Spideryarn-Shell-SHA256": sha256,
  };

  /* Method first, because a POST to a private slug must not cause a database
     read — the check that costs nothing goes before the one that does. */
  if (!READ_METHODS.includes(method)) {
    return { status: 405, headers: { ...headers, Allow: ALLOW }, head: null };
  }

  /* And the slug before the store, so a malformed address is a 400 whatever
     this deployment is configured with — the same ordering, and the same
     reason, as `servePublicApi` in routes.ts. */
  if (!isSlug(slug)) return { status: 400, headers, head: null };

  if (load?.kind === "found") return { status: 200, headers, head: load.head };
  if (load?.kind === "not-shared") return { status: 404, headers, head: null };
  /* `failed`, or a `null` that should not have got here. Both mean the head is
     unknown and the page is still perfectly serveable — see the header. */
  return { status: 200, headers, head: null };
}

/**
 * The head, or which kind of no.
 *
 * The reader marks its own refusals with a `status`, which is this codebase's
 * mark for *I chose this failure and I chose its wording*. 404 is the only one
 * reachable here — `requireSlug`'s 400 cannot fire, because `decidePublicPage`
 * has already run the same `isSlug` — so everything else is by definition
 * unexpected, including the 500 `scrubbed` raises for a database error.
 */
async function loadHead(slug: string, read: (slug: string) => Promise<PublicHead>): Promise<HeadLoad> {
  try {
    return { kind: "found", head: await read(slug) };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return { kind: "not-shared" };
    /* **Visible rather than swallowed.** Degrading to the default shell is the
       right answer for the reader and the wrong one for us to find out about
       from a bug report, so the whole error goes to the log and to Sentry. The
       slug is in the line because it is in the URL of the request that raised
       it and nothing else identifies which article lost its preview; no message
       from the reader is — `scrubbed` has already replaced it with a fixed
       sentence, and this catch does not undo that. */
    log("http").error(
      { ...errorFields(err), slug, path: "/read/:slug", status: 200 },
      "the public head read failed; serving the page with the default head",
    );
    captureFailure(err, { slug, path: "/read/:slug", status: 200 });
    return { kind: "failed" };
  }
}

/**
 * Answer one `/read/:slug`.
 *
 * `read` is injectable so the whole table above can be exercised against a fake
 * — including the failure row, which is the one that cannot be produced by any
 * real database you would want to have. It defaults to the hardwired public
 * reader, which is the only reader this module knows about: there is no
 * argument here that could make it return a private article.
 *
 * ## HEAD
 *
 * Same status, same headers, **including a truthful `Content-Length` in UTF-8
 * bytes**, and no body. `Buffer.byteLength` rather than `.length`, because the
 * enhanced head carries an article title and titles have non-ASCII characters
 * in them — a `.length` on `"Café · Spideryarn"` is one byte short, and one
 * byte short is a truncated response to any client that believes it.
 *
 * Set explicitly on the GET too, rather than left to Node. The reason is the
 * one routes.ts gives about its own `send`: a `res` that is not Node's — the
 * hand-built one every route test in this repo uses — has no automatic length
 * and no body suppression at all, so a version that leaned on either would look
 * correct in every unit test while the truth lived somewhere no test reached.
 */
export async function servePublicReadPage(args: {
  res: ServerResponse;
  method: string;
  /** Already decoded exactly once, by `originalUrl`. Do not decode it again. */
  slug: string;
  shell: BuiltShell;
  read?: (slug: string) => Promise<PublicHead>;
}): Promise<void> {
  const { res, method, slug, shell } = args;
  const read = args.read ?? ((s: string) => pgPublicReader.loadHead(s));

  const wanted = READ_METHODS.includes(method) && isSlug(slug);
  const load = wanted ? await loadHead(slug, read) : null;
  const decision = decidePublicPage(method, slug, load, shell.sha256);

  const body = composeShell(shell.html, decision.head);
  res.statusCode = decision.status;
  for (const [key, value] of Object.entries(decision.headers)) res.setHeader(key, value);
  res.setHeader("Content-Length", String(Buffer.byteLength(body, "utf8")));
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

=== NEW FILE: src/public/page-head.ts ===
/**
 * **What a shared link looks like when somebody pastes it** — one pure
 * function that swaps a document's managed head for one about this article.
 *
 * Until this landed, every `/read/<slug>` was rewritten to the same static
 * `index.html`, whose `<title>` is the bare word *Spideryarn*, and every page
 * title in the app was set by React after mount (src/web/page-title.ts). No
 * unfurler runs our JavaScript, so **every link anybody shared previewed as
 * nothing**. docs/plans/public-read-only-access.md § Stage 2, and the design is
 * docs/plans/public-read-only-stage2-input-sol.md § 4.
 *
 * ## Pure, and the purity is load-bearing
 *
 * No I/O, no database, no `process.env`, no request. It takes the built client
 * shell (a string, compiled into the function at build time by
 * scripts/client-shell.ts) and a `PublicHead` (read from Postgres by the public
 * reader), and returns a string. That is testable without a build, without a
 * deployment and without a database, which is why the head assertions in
 * tests/page-head.test.ts can be run against mutations of the escaper.
 *
 * ## What it is not
 *
 * **Not a renderer.** It replaces the region between two sentinel comments in
 * the `<head>` and nothing else; everything from `<body` onward is passed
 * through byte for byte, and there is a test that says so. The plan says
 * explicitly that this must not grow into server-side rendering — React still
 * mounts and still draws the page. If you find yourself wanting to reach past
 * the sentinels, that is the moment to stop and ask for a different design.
 */
import { escapeHtml, headText } from "../html.js";
import { safePublicCanonical } from "../urls.js";
import type { PublicHead } from "../store/public-reader.js";

/**
 * **The production origin, written down rather than taken from the request.**
 *
 * `og:url` is published metadata: whatever goes in it is what a link preview,
 * a scraper and a search engine record as this article's address. Building it
 * from the `Host` header — or from `X-Forwarded-Host`, which is the version
 * that looks more careful — hands that choice to whoever sent the request. A
 * stranger can send any `Host` they like to an edge function, and the reply
 * would then contain their domain, attributed to us, in a tag whose entire
 * purpose is to be believed.
 *
 * So it is a constant. This is exactly the kind of line somebody later
 * "improves" into a header read so that preview deployments unfurl with their
 * own hostname; the cost of that convenience is above, and a preview
 * deployment's link previews are not worth it.
 */
export const PUBLIC_ORIGIN = "https://www.spideryarn.com";

/**
 * The product name, and the separator between title segments.
 *
 * **Duplicated from src/web/page-title.ts on purpose**, and it is a real
 * duplication rather than an oversight: that module imports React, and this one
 * is reached by `src/public/routes.ts`, whose whole import graph is asserted
 * closed against the client and the writers (tests/public-imports.test.ts). Two
 * three-character constants are the cheaper of the two evils, and
 * tests/page-head.test.ts asserts that the title this file composes is
 * character-for-character the one `pageTitle()` composes, so the copies cannot
 * drift without a test going red.
 */
const APP_NAME = "Spideryarn";
const SEP = " · ";

/**
 * The three clamps, in code points, from the design § 6.
 *
 * They differ because the sinks differ: a tab and a bookmark show the page
 * title, a link card shows the `og:` pair, and a card's description gets a
 * paragraph's worth. `headText` does the clamping — see src/html.ts for why it
 * is by code point rather than by `.length`.
 *
 * `PAGE_TITLE` is 64 because that is `CLAMP` in src/web/page-title.ts, so the
 * server's title and the one React sets a moment later agree. **One deliberate
 * difference**: the client's `clamp()` cuts at a word boundary and appends an
 * ellipsis, and `headText` does neither. A title over 64 code points therefore
 * gains an `…` when React mounts. Metadata is the reason — an ellipsis in an
 * `og:title` is a claim that the title contained one — and the tab is the only
 * place the two are ever visible together, for the moment before mount.
 */
const PAGE_TITLE = 64;
const CARD_TITLE = 120;
const DESCRIPTION = 240;

/**
 * The boundary markers in index.html. The function replaces everything from the
 * first byte of the start marker to the last byte of the end marker, inclusive,
 * and touches nothing outside that span.
 *
 * Exported because scripts/client-shell.ts asserts the same two strings appear
 * exactly once, at build time, over the same shell. One definition rather than
 * two: a build check looking for a marker the composer has stopped using is a
 * check that passes while the composer throws in production.
 */
export const MANAGED_HEAD_START = "<!-- spideryarn:managed-head:start -->";
export const MANAGED_HEAD_END = "<!-- spideryarn:managed-head:end -->";

/**
 * **The shell with its managed head replaced by one about this article.**
 *
 * `head === null` returns the shell byte for byte — that is the answer for
 * every case that is not a public article: a private slug, an absent one, a
 * malformed one, a storage failure. Those responses carry their own status
 * code and the app's ordinary head, which already says `noindex, nofollow`.
 *
 * Throws if either sentinel is missing or appears twice. That cannot happen in
 * production, because scripts/client-shell.ts asserts the same thing at build
 * time over the same string — but a check that only exists at build time is one
 * refactor away from not existing, and a head assembled from the wrong halves
 * of a duplicated marker is the sort of failure that produces a valid-looking
 * page. It throws on the `null` path too, for the same reason: a shell this
 * function cannot understand is a broken build in every case, not only when
 * somebody happens to share a link.
 */
export function composeShell(shell: string, head: PublicHead | null): string {
  const start = shell.indexOf(MANAGED_HEAD_START);
  const end = shell.indexOf(MANAGED_HEAD_END);
  requireOnce(shell, MANAGED_HEAD_START, start);
  requireOnce(shell, MANAGED_HEAD_END, end);
  if (start > end) {
    throw new Error("Client shell: the managed-head end sentinel comes before the start.");
  }
  if (head === null) return shell;

  /* Purely cosmetic: match whatever this shell indents its head tags by, so the
     served HTML reads like the file it came from. Falls back to a bare newline
     if the sentinel is not the first thing on its line. */
  const lineStart = shell.lastIndexOf("\n", start) + 1;
  const indent = shell.slice(lineStart, start);
  const gap = /^[ \t]*$/.test(indent) ? `\n${indent}` : "\n";

  return shell.slice(0, start) + tags(head).join(gap) + shell.slice(end + MANAGED_HEAD_END.length);
}

/** One sentinel, exactly once. `at` is the first index, or -1. */
function requireOnce(shell: string, marker: string, at: number): void {
  if (at === -1) throw new Error(`Client shell: no ${marker} sentinel.`);
  const again = shell.indexOf(marker, at + marker.length);
  if (again !== -1) {
    throw new Error(
      `Client shell: the ${marker} sentinel appears more than once (at ${at} and ${again}).`,
    );
  }
}

/**
 * The tags themselves.
 *
 * Every piece of text goes through `headText` and then through `escapeHtml`,
 * in that order and exactly once each — normalise, then escape at the moment it
 * becomes markup. src/html.ts explains why those are two jobs.
 */
function tags(head: PublicHead): string[] {
  /* "Untitled" rather than an empty tag, matching `readTitle()` in
     src/web/page-title.ts, so a link to an article with no title of its own
     previews as the app does. `||` and not `??`: a title of `"   "` normalises
     to `""`, which is as titleless as `null`. */
  const cardTitle = headText(head.title ?? "", CARD_TITLE) || "Untitled";
  /* `head.gist` is already `root_gist` — itself the gist → summary → excerpt
     fallback from src/library-scalars.ts. When there is none, all three
     description tags are omitted rather than filled with the app's strapline: a
     strapline is not a description of this article, and three tags saying the
     wrong thing is worse than none. */
  const description = head.gist === null ? "" : headText(head.gist, DESCRIPTION);

  const out = [MANAGED_HEAD_START, `<title>${escapeHtml(documentTitle(head.title))}</title>`];
  if (description) out.push(meta("name", "description", description));
  /* **Unconditional, and it stays that way in this slice.** Composing a head
     changes what a card looks like; it changes crawler exposure not at all. The
     slice that narrows `X-Robots-Tag` and edits public/robots.txt is where this
     becomes conditional on the article being shared — until then, its constancy
     is the decision rather than an oversight. */
  out.push(meta("name", "robots", "noindex, nofollow"));
  out.push(meta("property", "og:type", "article"));
  out.push(meta("property", "og:site_name", APP_NAME));
  /* Without the ` · Spideryarn` suffix: a card already carries `og:site_name`,
     so repeating it in the title spends the visible half of the card saying the
     same word twice. */
  out.push(meta("property", "og:title", cardTitle));
  if (description) out.push(meta("property", "og:description", description));
  out.push(meta("property", "og:url", `${PUBLIC_ORIGIN}/read/${encodeURIComponent(head.slug)}`));
  /* `summary`, not `summary_large_image`. There is no image in this slice —
     a third-party lead image would be an endorsement, a privacy contact and
     another untrusted `src` sink — and `summary_large_image` without one
     renders as a broken card rather than a small one. */
  out.push(meta("name", "twitter:card", "summary"));
  out.push(meta("name", "twitter:title", cardTitle));
  if (description) out.push(meta("name", "twitter:description", description));

  /* A canonical is a public statement about a URL we did not write, so
     `safePublicCanonical` gets the last word and its `null` means no tag at
     all — see src/urls.ts for the four things it refuses and why refusing beats
     publishing a guess. */
  const canonical = head.canonical === null ? null : safePublicCanonical(head.canonical);
  if (canonical !== null) out.push(`<link rel="canonical" href="${escapeHtml(canonical)}" />`);

  out.push(MANAGED_HEAD_END);
  return out;
}

/**
 * One `<meta>`. `property` for Open Graph, `name` for everything else — that is
 * what the two specifications say, and a `name="og:title"` is ignored by
 * Facebook while looking perfectly reasonable in the source.
 *
 * The attribute *values* are escaped; the key and the tag name are ours.
 */
function meta(key: "name" | "property", id: string, content: string): string {
  return `<meta ${key}="${id}" content="${escapeHtml(content)}" />`;
}

/**
 * **The `<title>` text**, before escaping — the article's own title, clamped,
 * then the app's name.
 *
 * Exported and then called by `tags()` above rather than being a comment about
 * what `tags()` does inline, so that the value tests/page-head.test.ts compares
 * against `pageTitle()` from src/web/page-title.ts is *the same value that
 * reaches the document*. A helper the tests use and the code does not is a
 * helper that can be right while the code is wrong.
 */
export function documentTitle(title: string | null): string {
  return `${headText(title ?? "", PAGE_TITLE) || "Untitled"}${SEP}${APP_NAME}`;
}

=== NEW FILE: scripts/client-shell.ts ===
/**
 * **The built client `index.html`, compiled into the serverless function** —
 * and the four checks that stop a stale one getting there.
 *
 * Stage 2 of the public-link work serves `/read/<slug>` from a function so the
 * `<head>` can be about the article (src/public/page-head.ts). The function
 * therefore needs the shell — the real one, with hashed `/assets/…js` in it,
 * not the source `index.html` with its `/src/web/boot.tsx` that only Vite's dev
 * server understands. `vite.api.config.ts` calls this and compiles the result
 * in as a constant.
 *
 * ## Why it refuses rather than falling back
 *
 * There is no empty-shell fallback, no source-shell fallback, no
 * warn-and-continue. Every one of those produces a deployment that boots, that
 * answers, and that serves the wrong page — the thing docs/reusable/silent-success.md
 * is about.
 *
 * The stale case is not hypothetical: the worktree that produced this design
 * had HEAD at one commit and `dist/build.json` at another, so an API build on
 * its own would have compiled a shell from a different version of the client
 * and said nothing at all. That is what check 2 exists for.
 *
 * ## Why it is here and not inside the vite config
 *
 * A config file only runs during a build, so a check that lives in one can only
 * be shown to fail by doing a build — and a guard nobody has watched fire is
 * not yet a guard. As a module it has tests (tests/client-shell.test.ts) that
 * feed it a mismatched stamp, a duplicated sentinel and the repo's own source
 * `index.html`, in milliseconds and without writing anything.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { MANAGED_HEAD_END, MANAGED_HEAD_START } from "../src/public/page-head.js";
import { sameCommit } from "./build-stamp.js";

/** The built shell, and the digest of exactly the bytes that were read. */
export interface ClientShell {
  html: string;
  /** Lower-case hex SHA-256 of the file as it sits on disk. */
  sha256: string;
}

/**
 * The sentinels, imported from the composer rather than written out again.
 *
 * The two must be the same string or this check is theatre: a build check
 * looking for a marker `composeShell()` no longer uses passes happily, and the
 * function then throws on the first shared link. src/public/page-head.ts is
 * pure — `escapeHtml`, `safePublicCanonical` and nothing else — so a build
 * config can import it without pulling a server graph into itself.
 */
const START = MANAGED_HEAD_START;
const END = MANAGED_HEAD_END;

/** A built script reference: `<script … src="/assets/index-CIBahh0D.js">`. */
const BUILT_ASSET = /src="\/assets\/[^"]+\.js"/;

/**
 * The source entry point. Present in `index.html`, absent from `dist/index.html`
 * — Vite replaces the tag with the hashed bundle above.
 *
 * Matched **with its `src="` attribute**, not as a bare path. `index.html` also
 * mentions `src/web/boot.tsx` in a comment, and that comment survives into the
 * built file; a looser needle would reject every real shell.
 */
const SOURCE_ENTRY = 'src="/src/web/boot.tsx"';

/**
 * **Every structural thing we need to be true of a shell**, as assertions with
 * their own messages.
 *
 * Separated from the reading and the stamp comparison so a test can hand it a
 * string — including the repo's own source `index.html`, which must be
 * rejected, and which is the positive control for the whole check.
 */
export function assertShellShape(html: string): void {
  once(html, START);
  once(html, END);
  if (html.indexOf(START) > html.indexOf(END)) {
    throw new Error("Client shell: the managed-head end sentinel comes before the start.");
  }
  /* The source-entry check comes first because it names the mistake somebody
     actually made — "you read index.html instead of dist/index.html" — where
     the asset check below would only say what was missing. The source file
     fails both, and the more specific diagnosis is the one worth printing. */
  if (html.includes(SOURCE_ENTRY)) {
    throw new Error(
      `Client shell: contains ${SOURCE_ENTRY}, so this is the *source* index.html rather than ` +
        "dist/index.html. Only Vite's dev server can serve that entry point; in production it 404s " +
        "and the page is blank.",
    );
  }
  if (!BUILT_ASSET.test(html)) {
    throw new Error(
      'Client shell: no built script reference (expected a src="/assets/….js"). ' +
        "This is what a shell taken from somewhere other than a finished `vite build` looks like.",
    );
  }
}

function once(html: string, marker: string): void {
  const first = html.indexOf(marker);
  if (first === -1) throw new Error(`Client shell: no ${marker} sentinel.`);
  const again = html.indexOf(marker, first + marker.length);
  if (again !== -1) {
    throw new Error(
      `Client shell: the ${marker} sentinel appears ${count(html, marker)} times; it must appear once. ` +
        "src/public/page-head.ts replaces the region between the two sentinels, and there is no " +
        "right answer about which pair to use.",
    );
  }
}

function count(html: string, marker: string): number {
  return html.split(marker).length - 1;
}

/**
 * Read `dist/index.html`, prove it belongs to this build, and hash it.
 *
 * @param distDir the client build output, normally `<repo>/dist`.
 * @param apiCommit the commit this API build is stamping itself with —
 *   `resolveBuildStamp().commit`.
 *
 * Throws on every problem, and every message names which check failed and what
 * the two values were. A build that fails without saying why costs an hour of
 * somebody's day, and this one fails on a machine that is not yours.
 */
export function readClientShell(distDir: string, apiCommit: string): ClientShell {
  const shellPath = path.join(distDir, "index.html");
  const stampPath = path.join(distDir, "build.json");

  /* Read as bytes, then decode. The digest must be of the file as served —
     `X-Spideryarn-Shell-SHA256` is compared against the SHA-256 of
     `GET /index.html` by the deployed check — and hashing a re-encoded string
     would be a different number the day the file is not clean UTF-8. */
  const bytes = read(shellPath, "the built client shell");
  const html = bytes.toString("utf8");
  const clientCommit = commitFrom(read(stampPath, "the client build stamp").toString("utf8"), stampPath);

  /* `sameCommit` rather than `===`, and it is not just tidiness: it is where
     the rule that **`"unknown"` never matches, not even itself** lives. Two
     builds that both failed to work out what they were would otherwise compare
     equal, and this check would pass over a pair of artefacts with no idea
     between them. scripts/build-stamp.ts § sameCommit. */
  if (!sameCommit(clientCommit, apiCommit)) {
    throw new Error(
      `Client shell is not from this build: ${stampPath} says commit "${clientCommit || "(missing)"}" ` +
        `and this API build says "${apiCommit}". Run \`npm run build\` first — the API build compiles ` +
        "dist/index.html into the function, so a stale one ships a stale page with no other symptom. " +
        '(Note that "unknown" never matches, including itself.)',
    );
  }

  assertShellShape(html);

  return { html, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * The commit out of `dist/build.json`, or `""`.
 *
 * `""` rather than a throw for a stamp with no `commit` string in it, because
 * the comparison below already has the right message for that case and names
 * both values. A `JSON.parse` failure *is* a throw, though: an unparseable
 * stamp is a different problem from a mismatched one and deserves to say so.
 */
function commitFrom(json: string, file: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Cannot parse the client build stamp at ${file}: ${(err as Error).message}`);
  }
  const commit = (parsed as { commit?: unknown })?.commit;
  return typeof commit === "string" ? commit : "";
}

/** Read a file, or say which one and what it was for. */
function read(file: string, what: string): Buffer {
  try {
    return readFileSync(file);
  } catch (err) {
    throw new Error(
      `Cannot read ${what} at ${file}: ${(err as Error).message}. Run \`npm run build\` before the API build.`,
    );
  }
}

=== NEW FILE: tests/page-head.test.ts ===
// @vitest-environment jsdom
/**
 * **What a pasted link turns into**, asserted against the repo's real
 * `index.html` rather than a fixture of one.
 *
 * `composeShell()` (src/public/page-head.ts) swaps the managed-head region of
 * the built client shell for a head about one article, so that a shared
 * `/read/<slug>` previews as the article instead of as the bare word
 * *Spideryarn*. Everything else in the document — the referrer policy, the
 * icons, the manifest, the whole `<body>` — has to come through untouched, and
 * the text that goes in comes from two of the four untrusted parties in
 * docs/project/security-map.md: the article's own page, and the model.
 *
 * ## Two kinds of assertion, on purpose
 *
 * **Structural**, through jsdom, wherever a browser's parse is the thing that
 * matters: an element count, an attribute list. A string comparison updated to
 * match a bug is green forever; a second `<meta>` where one was written is
 * visible in the DOM and invisible in the string.
 *
 * **Raw markup**, on the composed bytes, for the escapes a parse cannot see.
 * tests/head-text.test.ts worked this out and measured it: `<title>` is RCDATA,
 * so escaping `>` alone already stops `</title>` breaking out, and every reader
 * of the parsed result normalises the difference away — `doc.title` decodes
 * entities, `innerHTML` re-serialises with correct escaping, and the escaped
 * and unescaped inputs come back byte-identical. So the one assertion that dies
 * when `<` stops being escaped has to look at what we emitted, not at what a
 * parser made of it.
 *
 * ## The mutations, all run
 *
 * Each row of the plan's table was applied, watched go red, and put back. The
 * per-test comments say which mutation belongs to which assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  composeShell,
  documentTitle,
  MANAGED_HEAD_END,
  MANAGED_HEAD_START,
  PUBLIC_ORIGIN,
} from "../src/public/page-head.js";
import type { PublicHead } from "../src/store/public-reader.js";
import { pageTitle } from "../src/web/page-title.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * **The real `index.html`**, not a fixture.
 *
 * A fixture would pass while the file the build actually compiles in had lost
 * its sentinels, or its robots meta, or had gained a second copy of either. The
 * built `dist/index.html` differs from this only in the script tag, which is
 * below the region this function touches.
 */
const SHELL = readFileSync(path.join(ROOT, "index.html"), "utf8");

/** An ordinary public article. Fields are overridden per test. */
function head(over: Partial<PublicHead> = {}): PublicHead {
  return {
    slug: "the-hard-problem",
    title: "The hard problem is a distraction",
    gist: "Consciousness research keeps circling one question that may not be the useful one.",
    canonical: "https://aeon.co/essays/the-hard-problem-is-a-distraction",
    ...over,
  };
}

function doc(markup: string): Document {
  return new JSDOM(markup).window.document;
}

/** The `content` of one meta, by whichever attribute names it, or null. */
function metaContent(d: Document, selector: string): string | null {
  return d.querySelector(selector)?.getAttribute("content") ?? null;
}

describe("the shell that is not touched", () => {
  it("returns the shell byte for byte when there is no article", () => {
    /* The answer for a private slug, an absent one, a malformed one and a
       storage failure. Those responses carry their own status code and the
       app's ordinary head — which is why the next test matters. */
    expect(composeShell(SHELL, null)).toBe(SHELL);
  });

  it("keeps everything above the managed head, and the whole body, byte for byte", () => {
    /* **Mutation: insert one character after `<body>` in `composeShell`.** Red,
       as it must be — this is the assertion that stops this function quietly
       becoming a second renderer. The plan says server-side rendering is not
       what this is; React still mounts and still draws the page. */
    const composed = composeShell(SHELL, head());
    const body = (s: string) => s.slice(s.indexOf("<body"));
    expect(body(composed)).toBe(body(SHELL));

    const above = (s: string) => s.slice(0, s.indexOf(MANAGED_HEAD_START));
    expect(above(composed)).toBe(above(SHELL));
    /* Named individually as well, because "the prefix is unchanged" is true of
       a prefix that got shorter too. The referrer policy is the one that would
       actually hurt: docs/plans/public-read-only-access.md § Stage 1. */
    expect(metaContent(doc(composed), 'meta[name="referrer"]')).toBe("no-referrer");
    expect(composed).toContain('<script type="module" src="/src/web/boot.tsx"></script>');
  });

  it("refuses a shell whose sentinel appears twice", () => {
    /* Which pair of markers would the composer use? There is no right answer,
       so it refuses rather than guessing — and it refuses on the `head === null`
       path too, because a shell it cannot understand is a broken build whether
       or not anybody happens to be sharing a link that second.

       **Mutation: delete the `requireOnce` calls.** Both cases went green (no
       throw), which is the failure this test exists to catch. */
    const twice = SHELL.replace(MANAGED_HEAD_START, `${MANAGED_HEAD_START}\n${MANAGED_HEAD_START}`);
    expect(() => composeShell(twice, head())).toThrow(/appears more than once/);
    expect(() => composeShell(twice, null)).toThrow(/appears more than once/);

    const none = SHELL.replace(MANAGED_HEAD_END, "");
    expect(() => composeShell(none, head())).toThrow(/no <!-- spideryarn:managed-head:end/);
  });
});

describe("what a link preview is told", () => {
  it("names the article, the site, and nothing about the reader", () => {
    const d = doc(composeShell(SHELL, head()));
    expect(d.title).toBe("The hard problem is a distraction · Spideryarn");
    expect(metaContent(d, 'meta[property="og:type"]')).toBe("article");
    expect(metaContent(d, 'meta[property="og:site_name"]')).toBe("Spideryarn");
    /* Without the app suffix: the card already carries `og:site_name`, so
       repeating it spends the visible half of the card on the same word twice. */
    expect(metaContent(d, 'meta[property="og:title"]')).toBe(
      "The hard problem is a distraction",
    );
    expect(metaContent(d, 'meta[name="twitter:card"]')).toBe("summary");
    expect(metaContent(d, 'meta[name="twitter:title"]')).toBe(
      "The hard problem is a distraction",
    );
    /* One head, not two: the shell's own `<title>` was inside the sentinels and
       has been replaced rather than joined. */
    expect(d.querySelectorAll("title")).toHaveLength(1);
    /* No image in this slice. A third-party lead image would be an endorsement,
       a privacy contact and another untrusted `src` sink — and
       `summary_large_image` without one renders as a broken card. */
    expect(d.querySelector('meta[property="og:image"]')).toBeNull();
    expect(d.querySelector('meta[name="twitter:image"]')).toBeNull();
  });

  it("gives the same description to all three, and omits all three when there is none", () => {
    const one = "Consciousness research keeps circling one question that may not be the useful one.";
    const withGist = doc(composeShell(SHELL, head()));
    expect(metaContent(withGist, 'meta[name="description"]')).toBe(one);
    expect(metaContent(withGist, 'meta[property="og:description"]')).toBe(one);
    expect(metaContent(withGist, 'meta[name="twitter:description"]')).toBe(one);

    /* **Mutation: emit the strapline ("AI-assisted reading: …") instead of
       omitting.** Red on all three. `root_gist` is already the
       gist → summary → excerpt fallback (src/library-scalars.ts), so a null here
       means we genuinely have nothing to say about this article, and three tags
       saying the wrong thing is worse than none. */
    const without = doc(composeShell(SHELL, head({ gist: null })));
    expect(without.querySelector('meta[name="description"]')).toBeNull();
    expect(without.querySelector('meta[property="og:description"]')).toBeNull();
    expect(without.querySelector('meta[name="twitter:description"]')).toBeNull();
    /* And it is not the *shell's* description surviving either — that tag was
       inside the sentinels and is gone with the rest of the region. */
    expect(composeShell(SHELL, head({ gist: null }))).not.toContain("AI-assisted reading");
  });

  it("tells crawlers to stay away, before and after enhancement", () => {
    /* **Mutation: delete the robots meta from index.html.** Red on the default
       and on the enhanced case, which is the pair that matters: this slice
       changes what a card looks like and changes crawler exposure not at all.
       The header Vercel sets says the same thing today; this is the fail-closed
       backstop for the slice that narrows it. */
    for (const markup of [composeShell(SHELL, null), composeShell(SHELL, head())]) {
      const d = doc(markup);
      expect(d.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
      expect(metaContent(d, 'meta[name="robots"]')).toBe("noindex, nofollow");
    }
  });
});

describe("the address we publish for this page", () => {
  it("is built from the fixed origin, never from anything a request carried", () => {
    /* **Mutation: build it from a `host` argument instead** — the "improvement"
       somebody makes later so preview deployments unfurl under their own
       hostname. Red. A stranger can send any `Host` (or `X-Forwarded-Host`) to
       an edge function, and `og:url` is a tag whose entire purpose is to be
       believed: their domain would go out attributed to us. */
    const d = doc(composeShell(SHELL, head()));
    expect(metaContent(d, 'meta[property="og:url"]')).toBe(
      "https://www.spideryarn.com/read/the-hard-problem",
    );
    expect(PUBLIC_ORIGIN).toBe("https://www.spideryarn.com");
  });

  it("percent-encodes the slug rather than trusting it to be tame", () => {
    const d = doc(composeShell(SHELL, head({ slug: 'a"b/c' })));
    expect(metaContent(d, 'meta[property="og:url"]')).toBe(
      "https://www.spideryarn.com/read/a%22b%2Fc",
    );
  });

  it("publishes a clean canonical and refuses one carrying a query", () => {
    /* **Mutation: delete the `search !== ""` refusal in src/urls.ts.** Red — the
       query URL gains a canonical. Both directions of that judgement are in
       src/urls.ts: `?utm_source=` is unsafe to publish and `?id=123` *is* the
       article on many sites, so the stripped URL names a different page. */
    const clean = doc(composeShell(SHELL, head()));
    expect(clean.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://aeon.co/essays/the-hard-problem-is-a-distraction",
    );

    for (const canonical of [
      "https://example.com/a?id=123",
      "https://user:pw@example.com/a",
      "javascript:alert(1)",
      null,
    ]) {
      const d = doc(composeShell(SHELL, head({ canonical })));
      expect(d.querySelector('link[rel="canonical"]'), String(canonical)).toBeNull();
    }
  });
});

describe("text from a stranger, on its way into a document head", () => {
  it("escapes the characters a parse cannot tell you about", () => {
    /* **Mutations: map `<` to itself; separately map `>`; separately map `&`.**
       Each one red here, and *only* here — this is a raw-markup assertion for
       the reason the file header gives: inside `<title>` RCDATA the escaping of
       `<` changes the bytes and changes nothing about the parse, and every way
       of reading the parsed result normalises the difference away. Measured in
       tests/head-text.test.ts, 2026-08-29. */
    const composed = composeShell(SHELL, head({ title: "A<B>C&D" }));
    expect(composed).toContain("<title>A&lt;B&gt;C&amp;D · Spideryarn</title>");
    expect(composed).toContain('content="A&lt;B&gt;C&amp;D"');
  });

  it("cannot smuggle an attribute into the tag it is already inside", () => {
    /* **Mutation: map `"` to itself.** Red. This is the payload that needs `"`
       and *nothing else*: it opens no tag, so no other entry in the escape table
       can save it, and the assertion is therefore the attribute list rather than
       an element count. The obvious payload — close the attribute, close the
       tag, open a new `<meta>` — needs `<` and `>` as well and stays green under
       this mutation; tests/head-text.test.ts has the whole story. */
    const d = doc(composeShell(SHELL, head({ gist: '" onload="alert(1)' })));
    for (const selector of [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]) {
      const tag = d.querySelector(selector);
      expect(tag, selector).not.toBeNull();
      expect([...(tag as Element).attributes].map((a) => a.name).sort(), selector).toEqual(
        selector.startsWith("meta[property") ? ["content", "property"] : ["content", "name"],
      );
    }
  });

  it("clamps by code point, so a title that is really a paragraph cannot fill the tab", () => {
    /* **Mutation: remove the clamp (pass `Infinity`).** Red — 10,000 characters
       arrive intact. Code points rather than `.length` is the second half:
       slicing at a UTF-16 offset can cut an astral character in half and leave a
       lone surrogate, which is not valid text. */
    const d = doc(composeShell(SHELL, head({ title: "x".repeat(10_000) })));
    expect([...d.title]).toHaveLength(64 + " · Spideryarn".length);
    expect([...(metaContent(d, 'meta[property="og:title"]') ?? "")]).toHaveLength(120);

    const astral = doc(composeShell(SHELL, head({ title: "\u{1D54F}".repeat(200) })));
    const title = metaContent(astral, 'meta[property="og:title"]') ?? "";
    expect([...title]).toHaveLength(120);
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("makes a line break a space and drops the invisible direction changes", () => {
    const d = doc(composeShell(SHELL, head({ title: "A\r\nB‮evil" })));
    expect(metaContent(d, 'meta[property="og:title"]')).toBe("A Bevil");
  });

  it("says Untitled rather than nothing, as the client does", () => {
    for (const title of [null, "   "]) {
      const d = doc(composeShell(SHELL, head({ title })));
      expect(d.title, String(title)).toBe("Untitled · Spideryarn");
      expect(metaContent(d, 'meta[property="og:title"]'), String(title)).toBe("Untitled");
    }
  });
});

describe("the two copies of the title rule", () => {
  it("composes character for character what the client composes on mount", () => {
    /* `src/web/page-title.ts` imports React, so a module reached by
       `src/public/routes.ts` cannot import it (tests/public-imports.test.ts).
       `APP_NAME` and the separator are therefore duplicated in
       src/public/page-head.ts, and this is what stops the copies drifting: the
       tab a reader sees before React mounts and the one it sets afterwards are
       the same string.

       `documentTitle` is the function the composer itself calls, not a
       restatement of it — a helper the tests use and the code does not can be
       right while the code is wrong. */
    for (const title of ["The hard problem is a distraction", "A · B", "  spaced  "]) {
      expect(documentTitle(title), title).toBe(
        pageTitle({ kind: "read", title: title.trim(), view: "article" }),
      );
    }
    expect(documentTitle(null)).toBe(pageTitle({ kind: "read", title: "", view: "article" }));
    /* And the one place they deliberately differ, written down so it is a
       decision rather than a surprise: over 64 code points the client cuts at a
       word boundary and adds an ellipsis, and the head does neither, because an
       `…` in an `og:title` is a claim that the title contained one. */
    const long = "word ".repeat(40);
    expect(documentTitle(long)).not.toContain("…");
    expect(pageTitle({ kind: "read", title: long, view: "article" })).toContain("…");
  });

  it("puts the composed head between the sentinels and leaves them in place", () => {
    /* The next composition has to be able to find the region again — this
       function's output is not served twice, but the assertion is what makes
       "replace between the markers" true rather than "delete the markers and
       hope". */
    const composed = composeShell(SHELL, head());
    expect(composed.split(MANAGED_HEAD_START)).toHaveLength(2);
    expect(composed.split(MANAGED_HEAD_END)).toHaveLength(2);
    expect(composeShell(composed, head())).toBe(composed);
  });
});

=== NEW FILE: tests/client-shell.test.ts ===
/**
 * **The four checks that stop a stale client shell being compiled into the
 * serverless function**, exercised without running a build.
 *
 * `vite.api.config.ts` compiles `dist/index.html` into the function so that
 * `/read/<slug>` can be served with a head about the article
 * (src/public/page-head.ts). Nothing about that is visible at runtime if the
 * shell is wrong: the function boots, answers 200, and serves a page from a
 * different version of the client, or one whose only script tag points at
 * `/src/web/boot.tsx` and 404s. docs/reusable/silent-success.md.
 *
 * The stale case is on the record rather than imagined — the worktree this
 * design came out of had HEAD at one commit and `dist/build.json` at another.
 *
 * **The point of this file is that the guard can be watched failing.** A check
 * that lives inside a vite config can only be shown to fire by doing a build,
 * which is why the logic is in scripts/client-shell.ts instead. Every case here
 * is a refusal, and the positive controls are the two that must *not* refuse.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { assertShellShape, readClientShell } from "../scripts/client-shell.js";
import { composeShell, MANAGED_HEAD_START } from "../src/public/page-head.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/** The repo's own `index.html`. The thing that must be refused. */
const SOURCE = readFileSync(path.join(ROOT, "index.html"), "utf8");

/**
 * What `vite build` makes of it: the source entry point replaced by the hashed
 * bundle, and everything else — comments included — carried through.
 *
 * Derived from the real file rather than hand-written, so this fixture cannot
 * quietly stop resembling what the build emits.
 */
const BUILT = SOURCE.replace(
  '<script type="module" src="/src/web/boot.tsx"></script>',
  '<script type="module" crossorigin src="/assets/index-CIBahh0D.js"></script>',
);

const COMMIT = "7e3d98ef12e5647bce1e2002eb2ce2873b48869f";
const OTHER = "0f52886a1b2c3d4e5f60718293a4b5c6d7e8f901";

const dirs: string[] = [];

/** A throwaway `dist/`, with whatever shell and stamp the case needs. */
function dist(html: string, stamp: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "spya-shell-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "index.html"), html);
  writeFileSync(path.join(dir, "build.json"), typeof stamp === "string" ? stamp : JSON.stringify(stamp));
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("what a shell has to look like", () => {
  it("accepts the built shell", () => {
    /* The positive control, and it is not a formality: it is what proves the
       three refusals below are refusing something specific rather than
       everything. */
    expect(() => assertShellShape(BUILT)).not.toThrow();
  });

  it("refuses the source index.html, which is the mistake somebody will make", () => {
    /* Reading `index.html` instead of `dist/index.html` produces a function
       that serves a page whose only script is `/src/web/boot.tsx` — a path only
       Vite's dev server can answer. In production it 404s and the page is
       blank, with nothing in any log. */
    expect(() => assertShellShape(SOURCE)).toThrow(/[*]source[*] index\.html/);
  });

  it("is not fooled by the word boot.tsx in a comment", () => {
    /* **The needle is `src="/src/web/boot.tsx"`, not the bare path**, because
       `index.html` explains in a comment why the entry point is `boot.tsx`
       rather than `main.tsx` — and that comment survives into the built file. A
       looser check would reject every real shell there is, which is the kind of
       guard that gets deleted rather than fixed. */
    expect(BUILT).toContain("boot.tsx");
    expect(() => assertShellShape(BUILT)).not.toThrow();
  });

  it("refuses a shell with no built script in it", () => {
    const stripped = BUILT.replace(/<script[^>]*><\/script>/g, "");
    expect(() => assertShellShape(stripped)).toThrow(/no built script reference/);
  });

  it("refuses a duplicated sentinel, and a missing one", () => {
    /* There is no right answer about which pair of markers `composeShell()`
       should replace between, so the build refuses rather than picking one. */
    const twice = BUILT.replace(MANAGED_HEAD_START, `${MANAGED_HEAD_START}${MANAGED_HEAD_START}`);
    expect(() => assertShellShape(twice)).toThrow(/appears 2 times/);
    expect(() => assertShellShape(BUILT.replace(MANAGED_HEAD_START, ""))).toThrow(/sentinel/);
  });
});

describe("proving the shell came from this build", () => {
  it("accepts a dist that names the same commit", () => {
    const shell = readClientShell(dist(BUILT, { commit: COMMIT, artefact: "client" }), COMMIT);
    expect(shell.html).toBe(BUILT);
  });

  it("refuses a dist from a different commit", () => {
    /* The failure that has actually happened: an API build run on its own, with
       a `dist/` left over from an earlier one. Everything succeeds and the
       deployed page is from the wrong version of the client. */
    expect(() => readClientShell(dist(BUILT, { commit: OTHER }), COMMIT)).toThrow(
      /not from this build/,
    );
  });

  it('refuses two builds that both say "unknown"', () => {
    /* **`"unknown"` never matches, not even itself** — the rule lives in
       `sameCommit` (scripts/build-stamp.ts) and this is the case it exists for.
       A plain `===` would pass here, over a pair of artefacts with no idea what
       they are, and the check that exists to prove they came from one commit
       would be reporting success on the commonest way of not knowing. */
    expect(() => readClientShell(dist(BUILT, { commit: "unknown" }), "unknown")).toThrow(
      /not from this build/,
    );
  });

  it("names both values when it refuses", () => {
    /* A build that fails without saying why costs an hour of somebody's day,
       and it fails on a machine that is not theirs. */
    let message = "";
    try {
      readClientShell(dist(BUILT, { commit: OTHER }), COMMIT);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(OTHER);
    expect(message).toContain(COMMIT);
    expect(message).toContain("npm run build");
  });

  it("refuses a missing dist, and an unparseable stamp", () => {
    expect(() => readClientShell(path.join(ROOT, "no-such-dist"), COMMIT)).toThrow(
      /Cannot read the built client shell/,
    );
    expect(() => readClientShell(dist(BUILT, "{ not json"), COMMIT)).toThrow(/Cannot parse/);
  });

  it("still applies the shape checks to a shell whose commit matches", () => {
    /* A stamp is about *which* build, and the shape checks are about *what was
       built*. A fresh commit with the source shell beside it is a real
       combination — it is what a `cp index.html dist/` would leave — and the
       commit check has nothing to say about it. */
    expect(() => readClientShell(dist(SOURCE, { commit: COMMIT }), COMMIT)).toThrow(
      /[*]source[*] index\.html/,
    );
  });
});

describe("the digest that is served to the deployed check", () => {
  it("is of the untouched shell, not of anything composed from it", () => {
    /* `X-Spideryarn-Shell-SHA256` is compared against the SHA-256 of
       `GET /index.html`, so it has to be the base shell's digest. **Mutation:
       hash `composeShell(html, head)` instead.** Red — the two differ, which is
       the whole point of asserting they do. */
    const shell = readClientShell(dist(BUILT, { commit: COMMIT }), COMMIT);
    expect(shell.sha256).toMatch(/^[0-9a-f]{64}$/);
    /* Computed by a different route than the one under test: read the bytes,
       hash them. */
    expect(shell.sha256).toBe(createHash("sha256").update(Buffer.from(BUILT, "utf8")).digest("hex"));

    const composed = composeShell(BUILT, {
      slug: "s",
      title: "T",
      gist: null,
      canonical: null,
    });
    expect(composed).not.toBe(BUILT);
    expect(createHash("sha256").update(Buffer.from(composed, "utf8")).digest("hex")).not.toBe(
      shell.sha256,
    );
  });
});

=== NEW FILE: tests/public-read-page.test.ts ===
/**
 * **What `/read/:slug` answers, case by case** — src/public/page.ts.
 *
 * Two halves, deliberately. `decidePublicPage` is pure, so the whole status
 * table is checked with no database, no response object and no shell anywhere
 * near it. `servePublicReadPage` is the four lines of I/O around it, and the
 * cases below drive it with a fake reader — including the failure row, which is
 * the one that cannot be produced on demand by any database you would want to
 * have.
 *
 * The row worth reading twice is the last one: **an unexpected reader failure
 * still serves the page, with a 200 and the default head.** That is a
 * considered disagreement with the reviewed design, which says 500; the
 * reasoning is in src/public/page.ts's header and the short version is that
 * this route serves the reading view itself rather than a preview, so a
 * transient database fault must cost the preview and not the page.
 *
 * ## What this file does not prove
 *
 * It does not prove Vercel routes `/read/:slug` here at all — that is
 * tests/public-read-rewrite.test.ts for the config and a deployed check for the
 * platform. It does not prove the *contents* of an enhanced head are safe;
 * escaping, clamping and the body-unchanged guarantee belong to
 * `composeShell` and are tested beside it.
 */

import type { ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

/**
 * **Monitoring, stubbed so the degradation is provably visible.**
 *
 * Serving 200 on an unexpected failure is only the right call if we find out
 * about it, so "it was captured" is part of the behaviour rather than a detail
 * — a version that swallowed the error would pass every other case in this file.
 */
const monitoring = vi.hoisted(() => ({ captured: [] as unknown[] }));
vi.mock("../src/monitoring.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/monitoring.js")>();
  return {
    ...actual,
    captureFailure: (err: unknown) => {
      monitoring.captured.push(err);
    },
  };
});

const { builtShell, decidePublicPage, servePublicReadPage } = await import("../src/public/page.js");
const { composeShell } = await import("../src/public/page-head.js");
type PublicHead = import("../src/store/public-reader.js").PublicHead;

/**
 * A stand-in for the built client — the managed-head block between its
 * sentinels, a hashed script reference, and a body with something in it.
 *
 * Hand-built rather than read from `dist/`, because `dist/` is a build artefact
 * that may not exist and would make this file's result depend on when somebody
 * last ran `npm run build`. What it has to be is *shaped* like the real one:
 * one sentinel pair, so `composeShell` has somewhere to put a head.
 */
const SHELL = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8" />',
  "<!-- spideryarn:managed-head:start -->",
  "<title>Spideryarn</title>",
  '<meta name="robots" content="noindex, nofollow" />',
  "<!-- spideryarn:managed-head:end -->",
  '<script type="module" crossorigin src="/assets/index-abc123.js"></script>',
  "</head>",
  '<body><div id="root"></div></body>',
  "</html>",
].join("\n");

const SHA256 = "e".repeat(64);
const shell = { html: SHELL, sha256: SHA256 };

/**
 * A title with characters outside ASCII, which is not decoration.
 *
 * `Content-Length` is a count of **bytes**, and `"…é…"`.length is a count of
 * UTF-16 units. A fixture whose every character was ASCII would let
 * `.length` and `Buffer.byteLength` agree, and the assertion below would be
 * green over the bug it exists to catch.
 */
const HEAD: PublicHead = {
  slug: "a-public-article",
  title: "Café Society — naïveté, dénouement, 日本語",
  gist: "A short description with an em dash — and a curly quote's apostrophe.",
  canonical: "https://example.com/a-public-article",
};

/** The title of an article that is **not** shared. It must appear nowhere. */
const PRIVATE_TITLE = "Zylquarn Redacted Draft, Do Not Share";

/** A reader that answers for exactly one slug and 404s everything else. */
function reader(head: PublicHead): (slug: string) => Promise<PublicHead> {
  return async (slug: string) => {
    if (slug === head.slug) return head;
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  };
}

/** A reader that fails the way a database does: unexpectedly, and not with a 404. */
const brokenReader = async (): Promise<PublicHead> => {
  throw Object.assign(new Error("Storage is unavailable"), { status: 500 });
};

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Whether `end` was called with anything at all — a HEAD must not be. */
  wroteBody: boolean;
}

async function serve(
  method: string,
  slug: string,
  read: (slug: string) => Promise<PublicHead>,
): Promise<Answer> {
  const headers: Record<string, string> = {};
  let status = 0;
  let body = "";
  let wroteBody = false;
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(chunk?: string) {
      if (chunk !== undefined) {
        wroteBody = true;
        body = chunk;
      }
    },
  } as unknown as ServerResponse;

  await servePublicReadPage({ res, method, slug, shell, read });
  return { status, headers, body, wroteBody };
}

describe("builtShell, where there is no compiled shell", () => {
  /**
   * **`typeof`, not a bare read.**
   *
   * `vite.api.config.ts` is the only thing that defines
   * `__SPIDERYARN_BUILT_SHELL__`, and `npm run dev` and vitest never load it. An
   * undeclared identifier is not `undefined` — touching it throws a
   * `ReferenceError`, which here would take the whole request down rather than
   * declining it. So this case is not "does it return null": it is "does it
   * return at all", and it would go red on `!== "string"` becoming
   * `!== undefined`. src/vercel-health.ts guards the build stamp the same way,
   * and this is the same trap.
   */
  it("returns null rather than throwing, which is what the fallthrough depends on", () => {
    expect(builtShell()).toBeNull();
  });
});

describe("decidePublicPage — the table, with no I/O in it", () => {
  it("200 and the head, for a public readable article", () => {
    const d = decidePublicPage("GET", HEAD.slug, { kind: "found", head: HEAD }, SHA256);
    expect(d.status).toBe(200);
    expect(d.head).toEqual(HEAD);
  });

  it("404 and no head, for private, absent, and an unreadable revision alike", () => {
    const d = decidePublicPage("GET", "not-shared", { kind: "not-shared" }, SHA256);
    expect(d.status).toBe(404);
    expect(d.head).toBeNull();
  });

  it("400 and no head, for a slug the server could never answer", () => {
    for (const bad of ["Upper", "has space", "-leading", "a_b", "a%2Fb", ""]) {
      const d = decidePublicPage("GET", bad, null, SHA256);
      expect(d.status, bad).toBe(400);
      expect(d.head, bad).toBeNull();
    }
  });

  it("405 with Allow, for anything that is not a read", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "get"]) {
      const d = decidePublicPage(method, HEAD.slug, null, SHA256);
      expect(d.status, method).toBe(405);
      expect(d.headers.Allow, method).toBe("GET, HEAD");
    }
  });

  /**
   * **The departure from the reviewed design, asserted rather than described.**
   *
   * 200 with the default head. A 500 here would replace our application with
   * Vercel's error page over a query the client does not need to have
   * succeeded.
   */
  it("200 and no head, when the reader failed unexpectedly", () => {
    const d = decidePublicPage("GET", HEAD.slug, { kind: "failed" }, SHA256);
    expect(d.status).toBe(200);
    expect(d.head).toBeNull();
  });

  /**
   * **Method before slug before store.** A POST to a malformed slug is a 405,
   * not a 400 — and more to the point, neither of them reads the database.
   */
  it("checks the method first, so a write to a bad slug never reaches a store", () => {
    expect(decidePublicPage("POST", "Upper", null, SHA256).status).toBe(405);
  });

  it("puts the same three headers on every answer, refusals included", () => {
    const cases: Parameters<typeof decidePublicPage>[] = [
      ["GET", HEAD.slug, { kind: "found", head: HEAD }, SHA256],
      ["GET", "nope", { kind: "not-shared" }, SHA256],
      ["GET", "Upper", null, SHA256],
      ["POST", HEAD.slug, null, SHA256],
      ["GET", HEAD.slug, { kind: "failed" }, SHA256],
    ];
    for (const args of cases) {
      const d = decidePublicPage(...args);
      expect(d.headers["Content-Type"]).toBe("text/html; charset=utf-8");
      expect(d.headers["Cache-Control"]).toBe("no-store");
      expect(d.headers["X-Spideryarn-Shell-SHA256"]).toBe(SHA256);
    }
  });

  /**
   * **No `X-Robots-Tag`, from here, at all.**
   *
   * The site-wide rule in vercel.json still owns it in slice 1, and a second
   * source for one header is a duplicate on the wire. Matched case-insensitively
   * because HTTP header names are, and a `x-robots-tag` set in lower case would
   * collide exactly as loudly.
   */
  it("sets no robots header of its own", () => {
    const every = [
      decidePublicPage("GET", HEAD.slug, { kind: "found", head: HEAD }, SHA256),
      decidePublicPage("GET", "nope", { kind: "not-shared" }, SHA256),
      decidePublicPage("POST", HEAD.slug, null, SHA256),
    ];
    for (const d of every) {
      expect(Object.keys(d.headers).map((k) => k.toLowerCase())).not.toContain("x-robots-tag");
    }
  });
});

describe("servePublicReadPage — what actually goes on the wire", () => {
  it("serves the enhanced shell for a public article", async () => {
    const answer = await serve("GET", HEAD.slug, reader(HEAD));
    expect(answer.status).toBe(200);
    expect(answer.body).not.toBe(SHELL);
    expect(answer.body).toContain("Café Society");
  });

  /**
   * **A private slug gets the shell back byte-for-byte**, and its title appears
   * nowhere in the response.
   *
   * Two assertions rather than one, because they die to different mutations. A
   * `toBe(SHELL)` catches "returned the enhanced head instead" even when the
   * head happens to be empty; the `not.toContain` catches a head that leaked one
   * field while looking unmodified. The 404-not-403 rule that makes a private
   * article indistinguishable from an absent one is worth exactly nothing if the
   * `<title>` of the 404 gives the game away.
   */
  it("serves the untouched shell, with no trace of the title, for a slug that is not shared", async () => {
    const answer = await serve("GET", "someone-elses-article", reader({
      ...HEAD,
      slug: "a-public-article",
      title: PRIVATE_TITLE,
    }));
    expect(answer.status).toBe(404);
    expect(answer.body).toBe(SHELL);
    expect(answer.body).not.toContain(PRIVATE_TITLE);
    expect(answer.body).not.toContain("Zylquarn");
    expect(JSON.stringify(answer.headers)).not.toContain("Zylquarn");
  });

  it("400s a malformed slug without asking the reader anything", async () => {
    let asked = 0;
    const answer = await serve("GET", "Upper", async (slug) => {
      asked += 1;
      return { ...HEAD, slug };
    });
    expect(answer.status).toBe(400);
    expect(answer.body).toBe(SHELL);
    expect(asked).toBe(0);
  });

  it("405s a write, with Allow, without asking the reader anything", async () => {
    let asked = 0;
    const answer = await serve("POST", HEAD.slug, async (slug) => {
      asked += 1;
      return { ...HEAD, slug };
    });
    expect(answer.status).toBe(405);
    expect(answer.headers.Allow).toBe("GET, HEAD");
    expect(answer.body).toBe(SHELL);
    expect(asked).toBe(0);
  });

  /**
   * **HEAD is a GET without a body**, and everything else about it is identical
   * — status, headers, and a `Content-Length` that tells the truth about the
   * GET's body.
   */
  it("answers HEAD with the same status and headers, and no body", async () => {
    const get = await serve("GET", HEAD.slug, reader(HEAD));
    const head = await serve("HEAD", HEAD.slug, reader(HEAD));
    expect(head.status).toBe(get.status);
    expect(head.headers).toEqual(get.headers);
    expect(head.wroteBody).toBe(false);
    expect(head.body).toBe("");
  });

  /**
   * **`Content-Length` counts bytes, and the fixture makes that visible.**
   *
   * The first assertion is the check. The second is the check on the check: if
   * the enhanced body were pure ASCII, `.length` and `Buffer.byteLength` would
   * agree and the first assertion would pass over a `.length` bug. `HEAD.title`
   * carries é, ï and 日本語 precisely so they cannot.
   */
  it("reports a truthful Content-Length in UTF-8 bytes, on both methods", async () => {
    const get = await serve("GET", HEAD.slug, reader(HEAD));
    const bytes = Buffer.byteLength(get.body, "utf8");
    expect(bytes).toBeGreaterThan(get.body.length);
    expect(get.headers["Content-Length"]).toBe(String(bytes));

    const head = await serve("HEAD", HEAD.slug, reader(HEAD));
    expect(head.headers["Content-Length"]).toBe(String(bytes));
  });

  /**
   * **The whole point of the departure, on the wire.**
   *
   * The reader throws something that is not a 404; the visitor still gets a
   * page, with a 200 and the default head, and the client goes and fetches its
   * own data. And the failure is captured, because a degradation nobody hears
   * about is the only thing that would make this the wrong trade.
   */
  it("still serves the page when the reader fails unexpectedly, and tells us it did", async () => {
    monitoring.captured.length = 0;
    const answer = await serve("GET", HEAD.slug, brokenReader);
    expect(answer.status).toBe(200);
    expect(answer.body).toBe(SHELL);
    expect(monitoring.captured).toHaveLength(1);
    expect((monitoring.captured[0] as Error).message).toBe("Storage is unavailable");
  });

  /** And a `not-shared` is an answer rather than a failure, so nothing is captured. */
  it("captures nothing for an ordinary 404", async () => {
    monitoring.captured.length = 0;
    const answer = await serve("GET", "not-shared-at-all", reader(HEAD));
    expect(answer.status).toBe(404);
    expect(monitoring.captured).toEqual([]);
  });

  it("carries the compiled shell digest on every answer", async () => {
    const answers = await Promise.all([
      serve("GET", HEAD.slug, reader(HEAD)),
      serve("GET", "not-shared-at-all", reader(HEAD)),
      serve("GET", "Upper", reader(HEAD)),
      serve("POST", HEAD.slug, reader(HEAD)),
      serve("GET", HEAD.slug, brokenReader),
    ]);
    for (const answer of answers) {
      expect(answer.headers["X-Spideryarn-Shell-SHA256"]).toBe(SHA256);
      expect(answer.headers["Cache-Control"]).toBe("no-store");
      expect(answer.headers["Content-Type"]).toBe("text/html; charset=utf-8");
      expect(Object.keys(answer.headers).map((k) => k.toLowerCase())).not.toContain("x-robots-tag");
    }
  });

  /**
   * **The default answer really is the shell**, which is the control under every
   * `toBe(SHELL)` above. If `composeShell(shell, null)` ever stopped being the
   * identity, those assertions would start being about something else.
   */
  it("and composeShell with no head is the identity, which is what those assertions assume", () => {
    expect(composeShell(SHELL, null)).toBe(SHELL);
  });
});

=== NEW FILE: tests/public-read-rewrite.test.ts ===
/**
 * **How a `/read/:slug` request reaches the function, and what it must not
 * drag in with it** — stage 2 slice 1 of docs/plans/public-read-only-access.md.
 *
 * Three separate things, in the order a request meets them:
 *
 * 1. **`vercel.json`.** The rewrite has to be *above* the SPA catch-all, and it
 *    has to match the base reading URL only. Ordering in that array is the
 *    whole behaviour and there is no way to see it from inside the code.
 * 2. **`originalUrl`.** It now understands two captures rather than one, and the
 *    interesting cases are the refusals — a caller who can choose which of two
 *    handlers runs is a routing bypass.
 * 3. **`parseRoute`.** The client half of the same address, which used to accept
 *    `/read/Upper` and render an error page.
 *
 * ## Why the config is asserted here rather than commented in the file
 *
 * `vercel.json` is parsed as strict JSON by the platform and cannot carry a
 * comment. So the reasoning lives in a test, which is the better half of the
 * bargain anyway: a comment saying "do not reach for `/read/:path*`" is advice,
 * and the case below that pins `/read/x/metadata` to the catch-all is a
 * consequence somebody has to break on purpose.
 *
 * Deterministic — no network, no deployment. What this file **cannot** prove is
 * that Vercel matches these rules the way the documentation says it does; that
 * is a deployed check, and docs/plans/public-read-only-stage2-input-sol.md § 7
 * lists it as one of the three genuinely platform-composition claims.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { originalUrl } from "../src/vercel.js";
import { parseRoute } from "../src/web/router.js";

const ROOT = path.resolve(import.meta.dirname, "..");

interface VercelConfig {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const config = JSON.parse(
  readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
) as VercelConfig;

describe("vercel.json's rewrites", () => {
  const sources = () => config.rewrites.map((r) => r.source);

  /**
   * **The read rewrite is first, and the SPA catch-all is last.**
   *
   * Vercel takes the first matching rewrite, and `/((?!api/).*)` matches
   * `/read/anything`. Below it, the new rule is dead — and dead in the way that
   * is hardest to notice, because the page still loads, still renders, and
   * still has the bare word *Spideryarn* in its `<title>` exactly as it did
   * before the feature was built.
   */
  it("sends /read/:slug to the function, ahead of the SPA catch-all", () => {
    const read = config.rewrites.findIndex((r) => r.source === "/read/:slug");
    const spa = config.rewrites.findIndex((r) => r.source === "/((?!api/).*)");
    expect(read, "the /read/:slug rewrite is missing").toBeGreaterThanOrEqual(0);
    expect(spa, "the SPA catch-all is missing").toBeGreaterThanOrEqual(0);
    expect(read).toBeLessThan(spa);
    expect(config.rewrites[read]?.destination).toBe("/api/index?__spy_read=:slug");
  });

  /**
   * **And the API catch-all keeps its own parameter**, which is the other half
   * of why there are two: `__spy_path` always rebuilds `/api/${capture}`.
   */
  it("leaves the /api/ rewrite on its own parameter", () => {
    const api = config.rewrites.find((r) => r.source === "/api/(.*)");
    expect(api?.destination).toBe("/api/index?__spy_path=$1");
  });

  /**
   * **`/read/:slug` and not `/read/:path*`.**
   *
   * The base reading URL only. `/read/:slug/metadata` and `/read/:slug/tweets`
   * are live client routes with their own pages, and a `:path*` source would
   * capture both by accident — the function would then answer them with a shell
   * whose head describes the reading view, or 404 them outright, and nobody
   * would have decided that. GPT Sol's § 10, and this is the assertion that
   * makes the warning bite.
   */
  it("matches the base reading URL only, so the nested views still fall through", () => {
    for (const source of sources()) {
      expect(source, `${source} would capture more than one segment`).not.toMatch(/^\/read\/.*\*/);
    }
    /* Said positively too: nothing in the array claims a nested read path. */
    const nested = config.rewrites.filter(
      (r) => r.source.startsWith("/read/") && r.source !== "/read/:slug",
    );
    expect(nested).toEqual([]);
    /* And the catch-all is still able to answer them, which is what "falls
       through" means: its negative lookahead excludes `/api/` and nothing else. */
    expect(sources()).toContain("/((?!api/).*)");
    expect(/^\/\(\(\?!api\/\)\.\*\)$/.test("/((?!api/).*)")).toBe(true);
  });
});

describe("vercel.json's headers", () => {
  /**
   * **Slice 1 changes crawler exposure by exactly nothing.**
   *
   * The site-wide `noindex, nofollow` stays where it is and stays the only one:
   * `src/public/page.ts` sets no `X-Robots-Tag` of its own, and two sources for
   * one header is a duplicate on the wire. Slice 2 splits this rule and moves
   * the decision into the function; until then, this case is what says the
   * feature did not quietly do it early.
   */
  it("still carries one site-wide noindex, which slice 1 must not touch", () => {
    const robots = config.headers.flatMap((h) =>
      h.headers.filter((k) => k.key.toLowerCase() === "x-robots-tag").map((k) => ({
        source: h.source,
        value: k.value,
      })),
    );
    expect(robots).toEqual([{ source: "/(.*)", value: "noindex, nofollow" }]);
  });

  it("and the referrer policy beside it", () => {
    const referrer = config.headers.flatMap((h) =>
      h.headers.filter((k) => k.key.toLowerCase() === "referrer-policy"),
    );
    expect(referrer).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
  });
});

describe("originalUrl and the second capture", () => {
  it("puts a /read/ path back together", () => {
    expect(originalUrl("/api/index?__spy_read=some-article")).toBe("/read/some-article");
  });

  /**
   * The reading view's own state lives in the query string — `?at=`, `?cols=`,
   * `?mode=` — and the client reads all of it. Losing it would land every
   * shared link at the top of the article with the default panel open.
   */
  it("keeps the reader's own query parameters, in order", () => {
    expect(originalUrl("/api/index?__spy_read=some-article&at=spya-k3m9qt&mode=chat")).toBe(
      "/read/some-article?at=spya-k3m9qt&mode=chat",
    );
  });

  /**
   * **Exactly one decode**, for the reason the existing `__spy_path` cases give
   * at length: Vercel encodes the capture once when it substitutes it into a
   * query value, so decoding is the inverse of the platform's own encoding.
   *
   * A second decode is how `%252F` becomes a path separator, so the assertion
   * is written on a value where one decode and two decodes differ visibly.
   */
  it("decodes the capture exactly once", () => {
    expect(originalUrl("/api/index?__spy_read=a%252Fb")).toBe("/read/a%2Fb");
    expect(originalUrl("/api/index?__spy_read=a%25b")).toBe("/read/a%b");
  });

  it("refuses a capture that cannot have come from that encoder", () => {
    expect(originalUrl("/api/index?__spy_read=a%zzb")).toBeNull();
  });

  /**
   * **A repeated parameter is the client choosing**, and it is refused for the
   * `/read/` capture exactly as it always has been for the API one. Both
   * orderings, because which arrives first is Vercel's business.
   */
  it("refuses two __spy_read parameters instead of picking one", () => {
    expect(originalUrl("/api/index?__spy_read=mine&__spy_read=yours")).toBeNull();
    expect(originalUrl("/api/index?__spy_read=yours&__spy_read=mine")).toBeNull();
  });

  /**
   * **And both kinds together, which is the new one.**
   *
   * This is the fault the second parameter creates: a caller who appends
   * `?__spy_read=…` to an `/api/` request — or `?__spy_path=…` to a reading URL
   * — is choosing between two handlers with two entirely different
   * authorization stories. There is no resolution here that is not a guess, and
   * the guess is a routing bypass, so both orderings are `null`.
   */
  it("refuses a __spy_path and a __spy_read together, either way round", () => {
    expect(originalUrl("/api/index?__spy_path=library&__spy_read=some-article")).toBeNull();
    expect(originalUrl("/api/index?__spy_read=some-article&__spy_path=library")).toBeNull();
  });

  /** The old behaviour, unchanged — a control, so the rewrite above is not a rewrite. */
  it("still restores an /api/ path and still leaves an unrewritten URL alone", () => {
    expect(originalUrl("/api/index?__spy_path=jobs%2Fabc%2Fretry")).toBe("/api/jobs/abc/retry");
    expect(originalUrl("/api/index?__spy_path=library&archived=1")).toBe("/api/library?archived=1");
    expect(originalUrl("/api/health")).toBe("/api/health");
  });
});

describe("parseRoute and a malformed slug", () => {
  /**
   * **`/read/Upper` is the shelf, not an error page.**
   *
   * It used to be an article route: the client asked the API for `Upper`, the
   * API refused it with the 400 it gives every malformed slug, and the reader
   * saw a failure rather than the shelf. This function's own header says a
   * mistyped path lands you on the shelf, and an address the server can never
   * answer is a mistyped path.
   */
  it("sends anything that is not a slug to the library", () => {
    for (const bad of ["/read/Upper", "/read/has space", "/read/-leading", "/read/a_b", "/read/%20"]) {
      expect(parseRoute(bad), bad).toEqual({ kind: "library" });
    }
  });

  /**
   * **And a real slug still reads**, which is the control: an `isSlug` that
   * refused everything would pass the case above and break the whole app.
   */
  it("but a real slug still reads, at all three views", () => {
    expect(parseRoute("/read/noema-mythology-of-conscious-ai")).toEqual({
      kind: "read",
      slug: "noema-mythology-of-conscious-ai",
      view: "article",
    });
    expect(parseRoute("/read/a-slug/metadata")).toEqual({
      kind: "read",
      slug: "a-slug",
      view: "metadata",
    });
    expect(parseRoute("/read/a-slug/tweets")).toEqual({
      kind: "read",
      slug: "a-slug",
      view: "tweets",
    });
  });
});

```
