# Re-review: one title rule for the server and the client (round 3)

Round 2 returned **CHANGES REQUESTED** with two blocking findings and a nit. All three are fixed.
Both of your findings were right and neither was something I would have found — the second in
particular was on an axis I had explicitly checked and written off, which is the part I want you to
push on hardest below.

## Your finding 1 — a fifth divergence through the legacy metadata URLs

You were right, and my reasoning was the interesting kind of wrong. I checked `/read/x/metadata`,
found it is two path segments and so never reaches the composer, and concluded the view axis was
covered. `/read/x?about=1` is **one** segment. It reaches the composer, gets the article's title, and
`main.tsx` then rewrites the address to the metadata page before React draws.

New leaf `src/read-address.ts`:

- `redirectsToMetadata(search)` — the predicate, `about=1|panel=about` only. **`main.tsx` now calls
  it** instead of keeping the pattern it used to hold inline, so there is one answer rather than two.
  That was the shape of your other finding, so I applied it here too rather than adding a second
  copy.
- `viewFor(search)`, and `ArticleView` moved here from `src/web/router.ts`, which re-exports it.
- `VIEW_LABEL` moved to `src/title-text.ts` beside `MODE_LABEL`; `documentTitle(title, mode, view)`.

**The view wins over the mode**, mirroring `readTitle`: `?about=1&mode=glossary` composes
`x · Metadata · Spideryarn` with the mode dropped, on both sides. `about=0` is the case that
separates "contains `about=`" from "becomes the metadata page" — it stays on the article, so the
server goes on composing the article's title for it.

## Your finding 2 — `isMode` was not actually the client's predicate

Fixed: `modeParam.parse` calls `isMode`. And the test gap you named is closed — there is now a case
that pairs `readMode` against `modeParam.parse` over a corpus that is **mostly junk on purpose**
(`toc`, `TOC`, `hierarchy ` with a space, `__proto__`, `constructor`, `toString`, `hasOwnProperty`,
`length`, `0.5`, `true`, `""`), with a control requiring more than ten of them to be rejected so that
"they agree" is not the trivial agreement of two functions that accept everything. Loosening
`modeParam` by one value (`|| v === "toc"`) reddens it:
`mode="toc": expected 'hierarchy' to be 'toc'`.

## Your nit — the import claims

Corrected in all three places that made it (`src/title-text.ts`, `tests/client-imports.test.ts`,
`docs/project/page-titles.md`), each of which now names the actual leaves and says the prose had
drifted.

## Your correction about `admin-store`

Taken, and my explanation for the suite flakiness was indeed unconfirmed — thank you for not letting
it stand. I have since tested it directly: `admin-store.test.ts` run together with
`public-visibility-pg.test.ts` alone passes 42/42, so this change's fixtures are not what perturbs
it. Separately, one full-suite run produced **99** failures, which turned out to be a wedged
`queued`/`running` row in `jobs` holding the single running slot — a peer's concurrent run — and it
cleared on its own. That is the same shared-resource condition, in a more destructive form.

## What I want from this round

1. **The same question again, and I would rather you found a sixth than told me there is none.** The
   shape is *two sources answering one question about the tab*. You have now found two of the five,
   and the second was on an axis I had checked. What have I still got wrong about `main.tsx`'s three
   rewrites, about `parseRoute`, or about what the client does between first byte and first paint?
2. **`redirectsToMetadata` vs `main.tsx`.** The rewrite strips `about=` and `panel=about` from the
   query and *then* decides. My predicate reads the original query. Is there an address where the
   strip and the predicate disagree — one where `main.tsx` redirects and `viewFor` says `article`, or
   the reverse?
3. **`articleWaitTitle`.** Its second guard is `composed.title === document.title`. With the view and
   mode now in the composed title, is there a sequence — a mode switch, a back button, a legacy
   address — where that comparison suppresses `Loading…` when it should not, or fails to when it
   should?
4. **`ArticleView` moving out of `router.ts`** and `VIEW_LABEL` out of `page-title.ts`. Anything
   behavioural in those two moves?
5. Whether this is fit to commit.

## Evidence

End to end through the **compiled** `api-dist/vercel.js` against real local Postgres, for a genuinely
public article — nothing in the harness imports `src/`:

| address | `<title>` | `og:title` / `og:url` |
|---|---|---|
| `/read/<slug>` | `The Mythology Of Conscious AI · Spideryarn` | article / mode-free |
| `?mode=glossary` | `… · Glossary · Spideryarn` | unchanged |
| `?mode=hierarchy` | `… · Spideryarn` | unchanged |
| `?mode=toc` (retired) | `… · Spideryarn` | unchanged |
| `?mode=%zz%zz` | `… · Spideryarn` | unchanged |
| `?about=1` | `… · Metadata · Spideryarn` | unchanged |
| `?panel=about` | `… · Metadata · Spideryarn` | unchanged |
| `?about=1&mode=glossary` | `… · Metadata · Spideryarn` | unchanged |
| `?about=0` | `… · Spideryarn` | unchanged |
| a slug nobody has | `Spideryarn`, 404 | no `og:` tags at all |

Mutations run this round, each red on the assertion named for it: `viewFor` always saying `article`;
the predicate widened to `about=[^&]*` so it catches `about=0`; the mode winning over the view; and
`modeParam` given its own predicate again.

`npm run typecheck` clean on all three projects. Both builds pass. Shell self-test 46/46. Biome clean
on every file in this diff. Full suite: 10 failures, one of which is a peer's untracked `src/sketch.ts`
linking to a plan doc that does not exist yet, and the rest pg suites that pass when run in smaller
groups.

## The diff (code and tests; docs omitted)

```diff
diff --git a/scripts/check-public-shell.ts b/scripts/check-public-shell.ts
index 0d2574f..777eb90 100644
--- a/scripts/check-public-shell.ts
+++ b/scripts/check-public-shell.ts
@@ -58,6 +58,7 @@ import path from "node:path";
 
 import { sameCommit } from "./build-stamp.js";
 import { headText } from "../src/html.js";
+import { documentTitle } from "../src/title-text.js";
 
 /* ------------------------------------------------------------------ */
 /* Facts about the feature, fixed rather than guessed                  */
@@ -327,12 +328,12 @@ export function judgeTitleAgainstMetadata(body: string, metadataTitle: string):
 
   const problems: string[] = [];
   const expectedOgTitle = headText(metadataTitle, 120);
-  const expectedTitle = `${headText(metadataTitle, 64)} · Spideryarn`;
+  const expectedTitle = documentTitle(metadataTitle);
 
   const decodedTitle = title === null ? null : unescapeHead(title);
   if (decodedTitle === null) problems.push("title: no <title> tag found");
   else if (decodedTitle !== expectedTitle)
-    problems.push(`title: expected '${expectedTitle}' (from /api/public/metadata's title, clamped to 64), got '${decodedTitle}'`);
+    problems.push(`title: expected '${expectedTitle}' (from /api/public/metadata's title, through documentTitle()), got '${decodedTitle}'`);
 
   const rawOgTitle = metaContent(body, "og:title");
   const ogTitle = rawOgTitle === null ? null : unescapeHead(rawOgTitle);
@@ -677,9 +678,14 @@ function runSelfTest(): void {
     wrongArticleVerdict,
   );
   check(
-    "judgeTitleAgainstMetadata: clamps the metadata title the same way the server does (64 / 120)",
+    "judgeTitleAgainstMetadata: clamps the metadata title the same way the server does (documentTitle / 120)",
     judgeTitleAgainstMetadata(
-      `<title>${headText("A".repeat(200), 64)} · Spideryarn</title><meta property="og:title" content="${headText("A".repeat(200), 120)}">`,
+      /* Spelled out, not built from `documentTitle`/`headText` — the judge
+         calls those, so a body composed with them would agree with any
+         behaviour they had, which is a positive case that cannot fail. 200 A's
+         with no space to cut at: 64 then an ellipsis for the tab, a hard 120
+         for the card. */
+      `<title>${"A".repeat(64)}… · Spideryarn</title><meta property="og:title" content="${"A".repeat(120)}">`,
       "A".repeat(200),
     ).problems.length === 0,
   );
diff --git a/src/html.ts b/src/html.ts
index 989999d..959359d 100644
Binary files a/src/html.ts and b/src/html.ts differ
diff --git a/src/public/page-head.ts b/src/public/page-head.ts
index 5a7b82d..a657a28 100644
--- a/src/public/page-head.ts
+++ b/src/public/page-head.ts
@@ -34,6 +34,9 @@
  * `requireMarkersInHead` below now, and the build check calls the same function.
  */
 import { escapeHtml, headText } from "../html.js";
+import { DEFAULT_MODE, type Mode } from "../modes.js";
+import type { ArticleView } from "../read-address.js";
+import { APP_NAME, documentTitle } from "../title-text.js";
 import { safePublicCanonical } from "../urls.js";
 import type { PublicHead } from "../store/public-reader.js";
 
@@ -56,37 +59,32 @@ import type { PublicHead } from "../store/public-reader.js";
 export const PUBLIC_ORIGIN = "https://www.spideryarn.com";
 
 /**
- * The product name, and the separator between title segments.
+ * **The `<title>` and the `og:title` are two different strings, on purpose.**
  *
- * **Duplicated from src/web/page-title.ts on purpose**, and it is a real
- * duplication rather than an oversight: that module imports React, and this one
- * is reached by `src/public/routes.ts`, whose whole import graph is asserted
- * closed against the client and the writers (tests/public-imports.test.ts). Two
- * three-character constants are the cheaper of the two evils, and
- * tests/page-head.test.ts asserts that the title this file composes is
- * character-for-character the one `pageTitle()` composes, so the copies cannot
- * drift without a test going red.
+ * `documentTitle` — imported, not restated — is the tab: the article's title,
+ * normalised, clamped at a word boundary with an ellipsis, then ` · Spideryarn`.
+ * src/web/page-title.ts assigns that exact string when React mounts a moment
+ * later, so the tab does not change under the reader; src/title-text.ts is where
+ * both halves come from and why each rule went the way it did.
+ *
+ * `og:title` below is composed here instead, with `headText` at a larger limit
+ * and no suffix. A card is a different sink from a tab: it already carries
+ * `og:site_name`, so repeating the app's name spends the visible half of it
+ * saying one word twice, and an `…` in published metadata is a claim that the
+ * title contained one.
  */
-const APP_NAME = "Spideryarn";
-const SEP = " · ";
 
 /**
- * The three clamps, in code points, from the design § 6.
+ * The two clamps this file owns, in code points, from the design § 6.
  *
- * They differ because the sinks differ: a tab and a bookmark show the page
- * title, a link card shows the `og:` pair, and a card's description gets a
- * paragraph's worth. `headText` does the clamping — see src/html.ts for why it
- * is by code point rather than by `.length`.
+ * They differ because the sinks differ: a link card shows the `og:` pair, and a
+ * card's description gets a paragraph's worth. `headText` does the clamping —
+ * see src/html.ts for why it is by code point rather than by `.length`.
  *
- * `PAGE_TITLE` is 64 because that is `CLAMP` in src/web/page-title.ts, so the
- * server's title and the one React sets a moment later agree. **One deliberate
- * difference**: the client's `clamp()` cuts at a word boundary and appends an
- * ellipsis, and `headText` does neither. A title over 64 code points therefore
- * gains an `…` when React mounts. Metadata is the reason — an ellipsis in an
- * `og:title` is a claim that the title contained one — and the tab is the only
- * place the two are ever visible together, for the moment before mount.
+ * The page title's clamp is not here: it is `CLAMP` in src/title-text.ts,
+ * applied by the `documentTitle` this file calls, because the client applies the
+ * same one to the same string.
  */
-const PAGE_TITLE = 64;
 const CARD_TITLE = 120;
 const DESCRIPTION = 240;
 
@@ -120,7 +118,12 @@ export const MANAGED_HEAD_END = "<!-- spideryarn:managed-head:end -->";
  * function cannot understand is a broken build in every case, not only when
  * somebody happens to share a link.
  */
-export function composeShell(shell: string, head: PublicHead | null): string {
+export function composeShell(
+  shell: string,
+  head: PublicHead | null,
+  mode: Mode = DEFAULT_MODE,
+  view: ArticleView = "article",
+): string {
   const start = shell.indexOf(MANAGED_HEAD_START);
   const end = shell.indexOf(MANAGED_HEAD_END);
   requireOnce(shell, MANAGED_HEAD_START, start);
@@ -143,7 +146,9 @@ export function composeShell(shell: string, head: PublicHead | null): string {
   const indent = shell.slice(lineStart, start);
   const gap = /^[ \t]*$/.test(indent) ? `\n${indent}` : "\n";
 
-  return shell.slice(0, start) + tags(head).join(gap) + shell.slice(end + MANAGED_HEAD_END.length);
+  return (
+    shell.slice(0, start) + tags(head, mode, view).join(gap) + shell.slice(end + MANAGED_HEAD_END.length)
+  );
 }
 
 /**
@@ -208,11 +213,13 @@ function requireOnce(shell: string, marker: string, at: number): void {
  * in that order and exactly once each — normalise, then escape at the moment it
  * becomes markup. src/html.ts explains why those are two jobs.
  */
-function tags(head: PublicHead): string[] {
-  /* "Untitled" rather than an empty tag, matching `readTitle()` in
-     src/web/page-title.ts, so a link to an article with no title of its own
-     previews as the app does. `||` and not `??`: a title of `"   "` normalises
-     to `""`, which is as titleless as `null`. */
+function tags(head: PublicHead, mode: Mode, view: ArticleView): string[] {
+  /* "Untitled" rather than an empty tag, matching `articleTitle()` in
+     src/title-text.ts. **Effectively unreachable from `loadHead`**, which falls
+     back to the slug and so always hands over a string — it is the defence for
+     the paths that compose a head without one, and for a title that normalises
+     to nothing. `||` and not `??`: a title of `"   "` normalises to `""`, which
+     is as titleless as `null`. */
   const cardTitle = headText(head.title ?? "", CARD_TITLE) || "Untitled";
   /* `head.gist` is already `root_gist` — itself the gist → summary → excerpt
      fallback from src/library-scalars.ts. When there is none, all three
@@ -221,7 +228,7 @@ function tags(head: PublicHead): string[] {
      wrong thing is worse than none. */
   const description = head.gist === null ? "" : headText(head.gist, DESCRIPTION);
 
-  const out = [MANAGED_HEAD_START, `<title>${escapeHtml(documentTitle(head.title))}</title>`];
+  const out = [MANAGED_HEAD_START, `<title>${escapeHtml(documentTitle(head.title, mode, view))}</title>`];
   if (description) out.push(meta("name", "description", description));
   /* **Unconditional, and it stays that way in this slice.** Composing a head
      changes what a card looks like; it changes crawler exposure not at all. The
@@ -266,17 +273,3 @@ function tags(head: PublicHead): string[] {
 function meta(key: "name" | "property", id: string, content: string): string {
   return `<meta ${key}="${id}" content="${escapeHtml(content)}" />`;
 }
-
-/**
- * **The `<title>` text**, before escaping — the article's own title, clamped,
- * then the app's name.
- *
- * Exported and then called by `tags()` above rather than being a comment about
- * what `tags()` does inline, so that the value tests/page-head.test.ts compares
- * against `pageTitle()` from src/web/page-title.ts is *the same value that
- * reaches the document*. A helper the tests use and the code does not is a
- * helper that can be right while the code is wrong.
- */
-export function documentTitle(title: string | null): string {
-  return `${headText(title ?? "", PAGE_TITLE) || "Untitled"}${SEP}${APP_NAME}`;
-}
diff --git a/src/public/page.ts b/src/public/page.ts
index 80a9239..bce05b7 100644
--- a/src/public/page.ts
+++ b/src/public/page.ts
@@ -93,6 +93,8 @@ import { errorFields, log } from "../log.js";
 import { captureFailure } from "../monitoring.js";
 import type { PublicHead } from "../store/public-reader.js";
 import { pgPublicReader } from "../store/public-reader.js";
+import { DEFAULT_MODE, type Mode } from "../modes.js";
+import type { ArticleView } from "../read-address.js";
 import { composeShell } from "./page-head.js";
 
 /**
@@ -274,16 +276,37 @@ export async function servePublicReadPage(args: {
   /** Already decoded exactly once, by `originalUrl`. Do not decode it again. */
   slug: string;
   shell: BuiltShell;
+  /**
+   * Which middle-band mode the address asked for, **already resolved to a real
+   * one by the caller** — `isMode` in src/modes.ts, exactly as `modeParam` does
+   * on the client, so that an unrecognised `?mode=` lands on the default rather
+   * than on an error. It reaches only the `<title>`; `og:title` and the
+   * canonical are about the article and carry no mode.
+   */
+  mode?: Mode;
+  /**
+   * Which view the address settles on — `viewFor` in src/read-address.ts, the
+   * same predicate `src/web/main.tsx` uses to rewrite the legacy spellings.
+   * `/read/x?about=1` is one path segment, so it arrives here and is then turned
+   * into the metadata page by the client before it draws; composing the
+   * article's title for it would be a tab that changes.
+   *
+   * Like `mode`, it reaches the `<title>` and nothing else. The `og:` tags and
+   * the canonical are about the article whichever of its pages you asked for.
+   */
+  view?: ArticleView;
   read?: (slug: string) => Promise<PublicHead>;
 }): Promise<void> {
   const { res, method, slug, shell } = args;
+  const mode = args.mode ?? DEFAULT_MODE;
+  const view = args.view ?? "article";
   const read = args.read ?? ((s: string) => pgPublicReader.loadHead(s));
 
   const wanted = READ_METHODS.includes(method) && isSlug(slug);
   const load = wanted ? await loadHead(slug, read) : null;
   const decision = decidePublicPage(method, slug, load, shell.sha256);
 
-  const body = composeShell(shell.html, decision.head);
+  const body = composeShell(shell.html, decision.head, mode, view);
   res.statusCode = decision.status;
   for (const [key, value] of Object.entries(decision.headers)) res.setHeader(key, value);
   res.setHeader("Content-Length", String(Buffer.byteLength(body, "utf8")));
diff --git a/src/store/public-reader.ts b/src/store/public-reader.ts
index d0c6457..c81aa5f 100644
--- a/src/store/public-reader.ts
+++ b/src/store/public-reader.ts
@@ -83,7 +83,17 @@ import { publicArticle, publicMetadata } from "../public/dto.js";
  */
 export interface PublicHead {
   slug: string;
-  /** The article's title, or its first `<h1>` when it has no title of its own. */
+  /**
+   * The article's title, its first `<h1>`, or its slug — the same three-step
+   * fallback `metaFrom` uses in src/public/dto.ts, because the client sets
+   * `document.title` from that one a second after this head is served, and any
+   * difference is a tab that changes in front of the reader.
+   *
+   * Still `string | null` rather than `string`: the type is the shape of a head,
+   * and src/public/page-head.ts composes a default one for the 404, 400 and 503
+   * paths where there is no article to have a title. `loadHead` itself now
+   * always has one.
+   */
   title: string | null;
   /** The description, from `root_gist` — already the gist/summary/excerpt fallback. */
   gist: string | null;
@@ -525,12 +535,23 @@ export const pgPublicReader: PublicArticleReader = {
 
       return {
         slug: found.slug,
-        /* `??` and not `||`: an empty-string title is not a title, but neither
+        /* **The slug is the last resort, and it is not optional.** `metaFrom`
+           in src/public/dto.ts is `title ?? headingTitle ?? slug`, and that is
+           the value React assigns to `document.title` a second after this head
+           was served. Without the third link the two chains disagree for an
+           article with neither a title nor an `<h1>`: the tab said
+           `Untitled · Spideryarn` and then changed to the slug in front of the
+           reader. GPT Sol found it, 2026-08-30; the fixture that can reach it is
+           `a public article with neither a title nor an <h1>` in
+           tests/public-visibility-pg.test.ts, and there was none before, which
+           is why nothing caught it.
+
+           `??` and not `||`: an empty-string title is not a title, but neither
            is it the *absence* of one, and the heading fallback is already `null`
            when there is no `<h1>` — so `||` would turn "" into null twice over
            and hide which of the two the row actually has. The composer clamps
            and escapes; deciding what is missing is this file's job. */
-        title: found.revision.title ?? found.revision.headingTitle,
+        title: found.revision.title ?? found.revision.headingTitle ?? found.slug,
         gist: found.revision.rootGist,
         canonical: found.revision.finalUrl,
       };
diff --git a/src/vercel.ts b/src/vercel.ts
index 1609193..3128660 100644
--- a/src/vercel.ts
+++ b/src/vercel.ts
@@ -46,6 +46,8 @@ import {
   withMonitoringScope,
 } from "./monitoring.js";
 import { UNEXPECTED_FAILURE } from "./messages.js";
+import { DEFAULT_MODE, isMode, type Mode } from "./modes.js";
+import { viewFor } from "./read-address.js";
 import { builtShell, servePublicReadPage } from "./public/page.js";
 import { handleApi } from "./routes.js";
 import { health } from "./vercel-health.js";
@@ -200,6 +202,38 @@ export function originalUrl(raw: string): string | null {
  * reading URL and is left alone; `/read/` is one with an empty slug, which is a
  * 400 like any other malformed one.
  */
+/**
+ * **Which middle-band mode a `/read/` address asked for**, or the default.
+ *
+ * The rewrite in vercel.json preserves the original query alongside the
+ * `__spy_read` capture, so `?mode=glossary` survives to here — and it has to be
+ * read, because the client puts the mode in the tab. Without this the server
+ * served `Article · Spideryarn` and React replaced it with
+ * `Article · Glossary · Spideryarn` a second later, which is the fault
+ * src/title-text.ts exists to close. GPT Sol, 2026-08-30.
+ *
+ * **Unknown values land on the default rather than failing**, which is the rule
+ * `modeParam` in src/web/params.ts already keeps: a link from a future version
+ * with a mode this one has not got, or a pre-2026-08-29 `?mode=toc` link,
+ * degrades to the article. `isMode` is the one place that decides, so the two
+ * cannot answer differently.
+ *
+ * Deliberately tolerant of a malformed URL. This runs on a string a stranger
+ * controls, and a throw here would be a 500 on an address that only wanted a
+ * tab title.
+ */
+export function readMode(url: string): Mode {
+  const query = url.indexOf("?");
+  if (query === -1) return DEFAULT_MODE;
+  let asked: string | null = null;
+  try {
+    asked = new URLSearchParams(url.slice(query + 1)).get("mode");
+  } catch {
+    return DEFAULT_MODE;
+  }
+  return isMode(asked) ? asked : DEFAULT_MODE;
+}
+
 export function readSlug(path: string): string | null {
   const read = /^\/read\/(.*)$/.exec(path);
   if (read === null) return null;
@@ -301,6 +335,10 @@ async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
         method: req.method ?? "GET",
         slug,
         shell,
+        mode: readMode(restored),
+        /* The address may be a legacy spelling of the metadata page, which the
+           client rewrites before it draws — src/read-address.ts. */
+        view: viewFor(restored),
       });
       return;
     }
diff --git a/src/web/App.tsx b/src/web/App.tsx
index 07210bd..653010d 100644
--- a/src/web/App.tsx
+++ b/src/web/App.tsx
@@ -134,7 +134,7 @@ import { useComments } from "./useComments.js";
 import { ChatDialog, type ChatTarget } from "./ChatDialog.js";
 import { anchored, countByBlock, useChatAnchors } from "./useChatAnchors.js";
 import { PILL } from "./pill.js";
-import { pageTitle, useDocumentTitle } from "./page-title.js";
+import { articleWaitTitle, pageTitle, useDocumentTitle } from "./page-title.js";
 import { apiFetch, readJson } from "./lib/api.js";
 import { loadPublicArticle } from "./public-api.js";
 import type {
@@ -592,13 +592,22 @@ function ArticlePage({
    * than that here: the title is announced to a screen reader, so a flicker
    * nobody sees is an interruption somebody hears. Until then the previous
    * title stands, which is exactly what a browser does during a real page load.
+   *
+   * **And on a shared link it does not say `Loading…` at all**, because the
+   * server already put the article's real title in the tab and replacing it
+   * would be a step backwards. That decision is `articleWaitTitle` in
+   * page-title.ts, which is where the two guards it needs are explained; this
+   * component's job is to say which of the three states it is in.
    */
   useDocumentTitle(
-    access.kind === "error"
-      ? pageTitle({ kind: "error" })
-      : access.kind === "loading" && slow
-        ? pageTitle({ kind: "loading" })
-        : "",
+    articleWaitTitle(
+      access.kind === "error" ? "error" : access.kind === "loading" && slow ? "loading" : "ready",
+      slug,
+      /* Read at call time rather than captured: the question `articleWaitTitle`
+         asks is whether the tab *still* shows what the server put there, and a
+         value captured earlier could not answer it. */
+      typeof document === "undefined" ? "" : document.title,
+    ),
   );
 
   /* **The one branch with no corner wordmark**, and the reason is that
diff --git a/src/web/main.tsx b/src/web/main.tsx
index 8d761bf..4376cd4 100644
--- a/src/web/main.tsx
+++ b/src/web/main.tsx
@@ -5,6 +5,7 @@ import { LucideProvider } from "lucide-react";
 import { App } from "./App.js";
 import { CALLBACK_HREF, canonicalAddHref, parseRoute, readHref } from "./router.js";
 import { isSpideryarnId } from "../ids.js";
+import { redirectsToMetadata } from "../read-address.js";
 import { startPerf } from "./perf.js";
 import { watchConnection } from "./offline.js";
 import { OfflineStrip } from "./OfflineStrip.js";
@@ -238,8 +239,12 @@ if (!onCallback && aboutish) {
     .split("&")
     .filter((pair) => pair !== "" && !/^about=/.test(pair) && pair !== "panel=about")
     .join("&");
-  // Only the two spellings that meant "open", never `about=0`.
-  const wantsPage = /(^|[?&])(about=1|panel=about)($|&)/.test(location.search);
+  /* Only the two spellings that meant "open", never `about=0` — and asked of
+     `redirectsToMetadata` rather than of a copy of the pattern kept here. The
+     serverless head composer has to know the same answer, because `/read/x` with
+     a query is one path segment and so reaches it; a second copy of this rule is
+     a second answer. src/read-address.ts. */
+  const wantsPage = redirectsToMetadata(location.search);
   const route = parseRoute(location.pathname);
   const href =
     wantsPage && route.kind === "read"
diff --git a/src/web/page-title.ts b/src/web/page-title.ts
index d397c8d..f4636c5 100644
--- a/src/web/page-title.ts
+++ b/src/web/page-title.ts
@@ -11,8 +11,9 @@
  * nothing.
  *
  * Not the link preview, though — a pasted address unfurls from `og:` tags a
- * server rendered, which we have not got. See docs/project/page-titles.md
- * § Still open.
+ * server rendered. Since 2026-08-29 there is one, for public articles only:
+ * src/public/page-head.ts. That changes this file's job, and the next section
+ * is where.
  *
  * ## The one rule: what is different about this tab goes first
  *
@@ -25,16 +26,26 @@
  * That is also why the default mode is *absent* rather than spelled out; see
  * `readTitle` below.
  *
- * ## No server rendering, so this is the only place a title is set
+ * ## The server writes a title first now, and this one has to match it
  *
  * The app is one HTML file and a router that never reloads (router.ts), so
- * `document.title` is a thing each page assigns on mount and on change. The
- * `<title>` in `index.html` is what the tab says until some page's effect
- * replaces it — which is longer than it sounds: effects run after paint, and
- * the whole app waits on a session check and then on an article fetch, so a
- * cold load into `/read/<slug>` sits on it for as long as those take. That is
- * why it is deliberately just the app's name. A page-specific title guessed
- * before the fetch would be a wrong one shown for a noticeable while.
+ * `document.title` is a thing each page assigns on mount and on change. What
+ * the tab says until then depends on how you arrived:
+ *
+ *  - **Any page but a shared article**: the `<title>` in `index.html`, which is
+ *    deliberately just the app's name. Effects run after paint and the app waits
+ *    on a session check and then on a fetch, so a cold load sits on it for a
+ *    noticeable while — and a page-specific title guessed before the fetch would
+ *    be a wrong one, shown for exactly that long.
+ *  - **`/read/<slug>` for a public article**: a real title, composed on the
+ *    server before the bundle loads (src/public/page-head.ts), so that a pasted
+ *    link previews as something.
+ *
+ * In the second case this file's assignment **overwrites a title that was
+ * already right**, in front of the reader. So the two have to produce the same
+ * string, and the way that is guaranteed is that both call `documentTitle` in
+ * src/title-text.ts — read its header for the two rules and which side won
+ * each. `readTitle` below is the client's half of it.
  *
  * ## Why the composition is a pure function
  *
@@ -47,74 +58,23 @@
  * docs/project/url-state.md for the state these titles are drawn from.
  */
 import { useEffect } from "react";
+import { APP_NAME, MODE_LABEL, SEP, TAGLINE, VIEW_LABEL, articleTitle, clamp } from "../title-text.js";
 import { DEFAULT_MODE, type Mode } from "./params.js";
 import type { AdminPage, ArticleView } from "./router.js";
 
-/** The product. `spideryarn2` is the working directory; this is the name. */
-export const APP_NAME = "Spideryarn";
-
-/**
- * The strapline. It appears on the two homepages and nowhere else — the shelf
- * with nothing chosen on it, and the landing page a signed-out reader gets
- * instead. See `pageTitle` for why it is on no other.
- */
-export const TAGLINE = "AI-assisted reading";
-
-/**
- * Between segments.
- *
- * A middot rather than an em dash or a pipe: it is already this app's
- * separator (the fact lines on the library card and the metadata page use it),
- * it is the narrowest of the three so it spends the fewest of a tab's very few
- * pixels, and unlike `-` it can never be confused with a hyphen inside a title
- * that has one. No evidence anywhere says one separator is more legible than
- * another; consistency with the rest of the app is the whole argument.
- */
-export const SEP = " · ";
-
 /**
- * How much of a leading title we keep.
- *
- * Nothing forces this. No browser has a character limit, and every place that
- * truncates does it by **pixels** rather than characters — Firefox caps a tab
- * at 225px, Chrome shrinks tabs until only the favicon is left, Google cuts a
- * search result at about 600px. The familiar "50-60 characters" is SEO folklore
- * converged on by blogs, not a vendor number, and it is the wrong *unit*
- * besides. So a clamp cannot make a title fit a tab, and this one does not try.
- *
- * It is for the places that do *not* truncate: the history list, a bookmark,
- * the window switcher, and the text somebody gets when they paste a link into a
- * chat. A 180-character academic paper title there pushes everything after it
- * off the end of the useful world.
- *
- * 64 is therefore a judgment call rather than a measurement, and it is
- * deliberately generous — comfortably more than any tab shows, so clamping
- * never costs a reader something the tab would have shown them.
+ * **The rules themselves live in src/title-text.ts**, and are re-exported here
+ * so that every existing caller of this module — nine components and
+ * tests/page-title.test.ts — keeps importing them from the place it always did.
+ *
+ * They moved because the server composes the same title before this file's
+ * React ever runs (src/public/page-head.ts), and two copies of one rule is one
+ * place for them to disagree. They did disagree, visibly, in the tab. The whole
+ * argument is in the header of src/title-text.ts.
  */
-export const CLAMP = 64;
+export { APP_NAME, CLAMP, SEP, TAGLINE, clamp } from "../title-text.js";
 
-/** Which of an article's nine middle-band modes, by the name the Dock uses. */
-const MODE_LABEL: Record<Mode, string> = {
-  hierarchy: "Hierarchy",
-  outline: "Outline",
-  summary: "Summary",
-  glossary: "Glossary",
-  ideas: "Ideas",
-  search: "Search",
-  diagram: "Diagram",
-  chat: "Chat",
-  review: "Review",
-};
 
-/**
- * The two of an article's three views that are pages beside the article rather
- * than the article itself. Named as the Dock names them, so the tab and the
- * button you pressed to get there agree.
- */
-const VIEW_LABEL: Record<Exclude<ArticleView, "article">, string> = {
-  metadata: "Metadata",
-  tweets: "Tweets",
-};
 
 /**
  * Everything a page can tell us about itself.
@@ -230,6 +190,93 @@ function segments(spec: TitleSpec): string[] {
   }
 }
 
+/**
+ * **What the server already put in this tab, read once before React can change
+ * it.**
+ *
+ * A shared `/read/<slug>` arrives with a real `<title>` and a full `og:` head,
+ * composed from the database (src/public/page-head.ts). Nothing else in the app
+ * does — an ordinary SPA navigation, a private article, and every other route
+ * get the bare shell — so the presence of an `og:url` naming a slug is exactly
+ * the signal "the server composed a head for *this* article".
+ *
+ * `og:url` rather than a marker of its own: it is already there, already
+ * asserted in tests/page-head.test.ts, and adding a second element that means
+ * the same thing is a second place for the two to disagree. Its value is
+ * `PUBLIC_ORIGIN + "/read/" + encodeURIComponent(slug)`, so the slug is the last
+ * segment, decoded.
+ *
+ * Read at module load and never again. The server writes this once, into the
+ * document that arrived; React never updates it, so a value read later would be
+ * stale in a way that is invisible. `title` is captured alongside it for the
+ * reason `articleWaitTitle` gives.
+ */
+export function serverComposedHead(doc: Document): { slug: string; title: string } | null {
+  const url = doc.querySelector('meta[property="og:url"]')?.getAttribute("content");
+  if (!url) return null;
+  const match = /\/read\/([^/?#]+)$/.exec(url);
+  if (!match?.[1]) return null;
+  try {
+    return { slug: decodeURIComponent(match[1]), title: doc.title };
+  } catch {
+    /* A malformed percent-escape. `decodeURIComponent` throws, and a thrown
+       exception at module load would take the whole bundle down over a tab
+       title. There is simply no composed head as far as we are concerned. */
+    return null;
+  }
+}
+
+/** Captured at module load — see `serverComposedHead` for why not later. */
+const COMPOSED: { slug: string; title: string } | null =
+  typeof document === "undefined" ? null : serverComposedHead(document);
+
+/**
+ * **What `ArticlePage` puts in the tab while it waits**, and the one case where
+ * the answer is to say nothing.
+ *
+ * Before the server composed heads, a cold load of `/read/<slug>` started at the
+ * bare app name, so replacing it with `Loading…` after 600ms was strictly an
+ * improvement. It is not any more. A shared link now arrives with **the article's
+ * real title already in the tab**, and a fetch slower than `SLOW_AFTER_MS` — a
+ * cold serverless start against Postgres, routinely — would replace it with
+ * `Loading…` and then put it back. The reader watches a correct title turn into
+ * a worse one and back again, and a screen reader announces both.
+ *
+ * That is the same fault as the two this file's `documentTitle` fixes: two
+ * sources answering "what should the tab say", disagreeing. So the rule is the
+ * one this component already follows for a *fast* fetch, extended to the case
+ * the server made possible: **do not replace a title that is already right.**
+ *
+ * The two guards are both necessary:
+ *
+ *  - **`slug === COMPOSED.slug`** — the composed head is about one article. Once
+ *    the reader navigates to a different one the server's title is a lie, and
+ *    `Loading…` is the honest thing to say.
+ *  - **`currentTitle === COMPOSED.title`** — the tab must still be showing it.
+ *    A reader who goes `/read/a` → `/read/b` → back to `/read/a` has an `og:url`
+ *    that still names `a`, and suppressing here would leave *b's* title standing
+ *    over a's loading page. Comparing the string self-expires the moment
+ *    anything writes a different one, which is exactly when the guarantee stops
+ *    holding.
+ *
+ * **An error still replaces it**, deliberately. `Loading…` is a claim that the
+ * right title is coming; `Couldn't open` is a claim that it is not, and a broken
+ * page must not go on advertising the article it failed to show.
+ */
+export function articleWaitTitle(
+  state: "loading" | "error" | "ready",
+  slug: string,
+  currentTitle: string,
+  composed: { slug: string; title: string } | null = COMPOSED,
+): string {
+  if (state === "error") return pageTitle({ kind: "error" });
+  /* "" is `useDocumentTitle`'s "not mine to set" — see the hook, and see
+     `ArticlePage`, which uses the same value to hand over to its children. */
+  if (state === "ready") return "";
+  if (composed !== null && composed.slug === slug && composed.title === currentTitle) return "";
+  return pageTitle({ kind: "loading" });
+}
+
 /**
  * The segments before the app name, for one of an article's three views.
  *
@@ -246,7 +293,7 @@ function segments(spec: TitleSpec): string[] {
  * a reader who learns the rule in one place has learned it in both.
  */
 function readTitle(spec: Extract<TitleSpec, { kind: "read" }>): string[] {
-  const title = clamp(spec.title.trim()) || "Untitled";
+  const title = articleTitle(spec.title);
   if (spec.view !== "article") return [title, VIEW_LABEL[spec.view]];
   const mode = spec.mode ?? DEFAULT_MODE;
   return mode === DEFAULT_MODE ? [title] : [title, MODE_LABEL[mode]];
@@ -257,36 +304,6 @@ function join(parts: string[]): string {
   return parts.map((p) => p.trim()).filter(Boolean).join(SEP);
 }
 
-/**
- * Cut at a word boundary, with an ellipsis, or return the text unchanged.
- *
- * Word boundary rather than mid-word because the cut is doing the reader a
- * favour and a truncation that lands inside a word looks like corruption. If
- * there is no space to cut at in the last third of the budget — one very long
- * word, or a language that does not space its words — it cuts where it must,
- * which is still better than not clamping.
- *
- * **Counted in code points, not in UTF-16 units**, which is why the text is
- * split into an array first rather than sliced. `"…".slice(0, 64)` will happily
- * cut an emoji in half and leave a lone surrogate, which renders as `�` — a
- * clamp whose whole job is to look deliberate, producing the one character that
- * looks like corruption. GPT Sol found it, 2026-08-27.
- *
- * Code points, not graphemes: a combining accent or a flag can still be split,
- * and doing better needs `Intl.Segmenter`. Not worth a segmenter for a title
- * that is already being cut with an ellipsis on it — but that is the next step
- * if this ever matters.
- */
-export function clamp(text: string, max = CLAMP): string {
-  const points = [...text];
-  if (points.length <= max) return text;
-  const cut = points.slice(0, max).join("");
-  const space = cut.lastIndexOf(" ");
-  // Only honour a space in the last third; otherwise a title whose first word
-  // is long would be clamped down to that one word.
-  const at = space > cut.length * 0.66 ? cut.slice(0, space) : cut;
-  return `${at.trimEnd()}…`;
-}
 
 /**
  * The host of a URL, without its `www.`, or the text unchanged if it is not a
diff --git a/src/web/params.ts b/src/web/params.ts
index efa319f..ad2074f 100644
--- a/src/web/params.ts
+++ b/src/web/params.ts
@@ -238,55 +238,25 @@ export const panelParam = createParser<Panel>({
  * (docs/project/summaries.md). Diagram is the fifth
  * (docs/project/diagram.md), and it cost this list one word as well.
  */
-export const MODES = [
-  /* Renamed from `toc` on 2026-08-29, at Greg's request: the reader sees
-     "Hierarchy" and the code now says the same word. It also ends a collision
-     that had lasted as long as the list — `toc` was simultaneously this mode and
-     the *pipeline step* that builds tree.json (src/pipeline.ts § STEP_ORDER), so
-     one word meant two things in one repo. The step keeps the name; the mode
-     gives it up. docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 3. */
-  "hierarchy",
-  "chat",
-  "glossary",
-  "search",
-  "summary",
-  "diagram",
-  "ideas",
-  /* Review is the seventh, 2026-08-27, and the first mode whose content comes
-     from the reader rather than from the article: they say what they took from
-     it and the model helps them find where that comes apart. It cost this list
-     one word, like the five before it. docs/plans/260827ah-review-mode.md.
-
-     There is deliberately no `?stance=` beside `?thread=` below. The stance
-     governs the next answer and changes nothing on screen, which is the rule
-     this file keeps — the closest existing thing is chat's profile checkbox,
-     which is component state for the same reason. */
-  "review",
-  /* The eighth, 2026-08-28: the whole document as one nested list that never
-     scrolls and expands around where the reader is. It costs this list one
-     word like the six before it, and it is the first mode that is a second
-     answer to a question an existing surface already answers — the gist
-     columns' context panels — rather than a new question. That is deliberate
-     and temporary: Greg asked for it as an eighth mode "for now, so that it
-     doesn't mess with what we have, and so that I can go back and forth to
-     compare". docs/plans/260828aw-outline-mode.md § Where it sits, and what happens if
-     it wins. */
-  "outline",
-] as const;
-export type Mode = (typeof MODES)[number];
-
-/**
- * The mode a reader lands in, named once.
- *
- * Two places need it — `modeParam`'s fallback below, and `withMode` in
- * src/web/Dock.tsx, which omits the parameter when it is writing this value. A
- * literal in both would be two copies of one decision, and the copy that drifts
- * is the one that puts a redundant `?mode=` back into every URL.
- */
-export const DEFAULT_MODE: Mode = "hierarchy";
+/* **Moved to src/modes.ts on 2026-08-30**, and re-exported here so that every
+   importer of this file is unchanged. The server composes the same titles now
+   and cannot import anything under `src/web/`; the reasoning and the history of
+   the list are in that file's header. */
+import { isMode } from "../modes.js";
+export { isMode };
+/* Imported as well as re-exported: `export … from` creates no local binding, and
+   `modeParam` below uses all three. */
+import { DEFAULT_MODE, MODES, type Mode } from "../modes.js";
+export { DEFAULT_MODE, MODES, type Mode };
 
 export const modeParam = createParser<Mode>({
-  parse: (v) => (MODES.includes(v as Mode) ? (v as Mode) : null),
+  /* `isMode` and not a second `MODES.includes` here. The serverless function
+     that composes a shared article's `<title>` asks the same question of the
+     same query string (`readMode` in src/vercel.ts), and this file used to
+     answer it independently — so "one place decides what a mode is" was a claim
+     rather than a fact, and no test paired the two on an invalid input. GPT Sol,
+     2026-08-30. */
+  parse: (v) => (isMode(v) ? v : null),
   serialize: (v) => v,
 })
   .withDefault(DEFAULT_MODE)
diff --git a/src/web/router.ts b/src/web/router.ts
index de4fb25..38769fa 100644
--- a/src/web/router.ts
+++ b/src/web/router.ts
@@ -65,7 +65,12 @@ import { useMemo, useSyncExternalStore } from "react";
 import { isSlug } from "../ingest.js";
 
 /** Which of an article's three pages. `article` is the reading view itself. */
-export type ArticleView = "article" | "metadata" | "tweets";
+/* **Moved to src/read-address.ts on 2026-08-30** and re-exported, so nothing
+   that used this name knows. The serverless function that composes a shared
+   article's head has to know which view an address settles on, and it may not
+   import anything under src/web/. */
+import type { ArticleView } from "../read-address.js";
+export type { ArticleView };
 
 /** Which admin page. `home` is `/admin` itself — the index of the others. */
 export type AdminPage = "home" | "users";
diff --git a/tests/client-imports.test.ts b/tests/client-imports.test.ts
index ae8017a..bca4316 100644
--- a/tests/client-imports.test.ts
+++ b/tests/client-imports.test.ts
@@ -135,6 +135,38 @@ const SHARED = new Set([
      URL left in place. One module, both callers.
      See src/assets.ts and docs/plans/260829b-hosting-the-articles-images.md. */
   "assets.js",
+  /* Escaping text into markup, and composing an article's page title. On the
+     list because they qualify — `html.js` imports nothing at all, and
+     `title-text.js` imports only the other leaves below it — and because being
+     on it is the whole point rather than a convenience. (This comment said
+     "only `html.js`" until `modes.js` and `read-address.js` arrived; the test
+     underneath checks purity, so the drift was in the prose alone.)
+
+     From 2026-08-29 a serverless function composes the `<title>` for a shared
+     `/read/<slug>` before the bundle loads (src/public/page-head.ts), and React
+     then assigns `document.title` over the top of it. Anything the two disagree
+     about is a tab that visibly changes in front of the reader, and they did
+     disagree: the server normalised whitespace, control characters and bidi
+     overrides and the client did not. A second copy of a title rule is one
+     place for it to drift, and this is the drift.
+     See src/title-text.ts and docs/project/page-titles.md. */
+  "html.js",
+  "title-text.js",
+  /* The nine middle-band modes. It lived in `src/web/params.ts` until
+     2026-08-30 and moved for the reason the two above are on this list: the
+     serverless function that composes a shared article's `<title>` has to know
+     which mode the address asked for, or the tab says one thing and React says
+     another a second later. It imports nothing at all, and `params.ts`
+     re-exports every name so no component knows it moved. See src/modes.ts. */
+  "modes.js",
+  /* What a `/read/…` address asks for — the view, and whether the client is
+     about to rewrite a legacy spelling into the metadata page. On the list
+     because it imports nothing at all, and because being on it is the point:
+     `main.tsx` does the rewrite and the serverless head composer has to predict
+     it, since `/read/x?about=1` is one path segment and so reaches the composer
+     while `/read/x/metadata` is two and never does. Two copies of that
+     predicate is a tab that changes at mount. See src/read-address.ts. */
+  "read-address.js",
 ]);
 
 /** Every `.ts`/`.tsx` file under a directory, recursively. */
diff --git a/tests/page-head.test.ts b/tests/page-head.test.ts
index 97c8055..89f17dd 100644
--- a/tests/page-head.test.ts
+++ b/tests/page-head.test.ts
@@ -40,11 +40,16 @@ import { describe, expect, it } from "vitest";
 
 import {
   composeShell,
-  documentTitle,
   MANAGED_HEAD_END,
   MANAGED_HEAD_START,
   PUBLIC_ORIGIN,
 } from "../src/public/page-head.js";
+/* From the shared leaf rather than from page-head.js, because the leaf is the
+   only definition there now is — see src/title-text.ts. `composeShell` calls
+   this same function, so comparing it against `pageTitle()` below is a
+   statement about what actually reaches the document. */
+import { MODES } from "../src/modes.js";
+import { clamp, documentTitle } from "../src/title-text.js";
 import type { PublicHead } from "../src/store/public-reader.js";
 import { pageTitle } from "../src/web/page-title.js";
 
@@ -317,7 +322,13 @@ describe("text from a stranger, on its way into a document head", () => {
        slicing at a UTF-16 offset can cut an astral character in half and leave a
        lone surrogate, which is not valid text. */
     const d = doc(composeShell(SHELL, head({ title: "x".repeat(10_000) })));
-    expect([...d.title]).toHaveLength(64 + " · Spideryarn".length);
+    /* **64 plus one.** The tab's clamp appends an ellipsis rather than counting
+       it, so a title with no space to cut at comes out one code point over
+       budget — see `clamp` in src/title-text.ts, which says so. That is the
+       client's rule, and since 2026-08-30 the tab is composed by the client's
+       rule on both sides. `og:title` keeps `headText`'s hard 120, because
+       metadata is a promise about a length. */
+    expect([...d.title]).toHaveLength(64 + 1 + " · Spideryarn".length);
     expect([...(metaContent(d, 'meta[property="og:title"]') ?? "")]).toHaveLength(120);
 
     const astral = doc(composeShell(SHELL, head({ title: "\u{1D54F}".repeat(200) })));
@@ -340,71 +351,235 @@ describe("text from a stranger, on its way into a document head", () => {
   });
 });
 
-describe("the two copies of the title rule", () => {
-  it("composes character for character what the client composes on mount", () => {
-    /* `src/web/page-title.ts` imports React, so a module reached by
-       `src/public/routes.ts` cannot import it (tests/public-imports.test.ts).
-       `APP_NAME` and the separator are therefore duplicated in
-       src/public/page-head.ts, and this is what stops the copies drifting: the
-       tab a reader sees before React mounts and the one it sets afterwards are
-       the same string.
-
-       `documentTitle` is the function the composer itself calls, not a
-       restatement of it — a helper the tests use and the code does not can be
-       right while the code is wrong. */
-    for (const title of ["The hard problem is a distraction", "A · B", "  spaced  "]) {
-      expect(documentTitle(title), title).toBe(
-        pageTitle({ kind: "read", title: title.trim(), view: "article" }),
-      );
+describe("the one title rule, applied by both sides", () => {
+  /**
+   * **The tab must not change when React mounts**, and until 2026-08-30 it did.
+   *
+   * A shared `/read/<slug>` is served with a `<title>` this file's
+   * `composeShell` composed; React then assigns `document.title` from
+   * `pageTitle()` in src/web/page-title.ts, over the top of it. The server ran
+   * the title through `headText` (src/html.ts) and the client did not, so for
+   * any title with a double space, a newline, a tab or a bidi override in it the
+   * reader watched the title they were given turn into a worse one. GPT Sol
+   * found it reviewing slice 1; it was pinned as a divergence nobody had chosen
+   * and put to Greg, who left the call here.
+   *
+   * **The call: the server's normalising wins and the client's clamp wins**, and
+   * they are one function now — `documentTitle` in src/title-text.ts, which both
+   * sides import. That header has the argument for each half.
+   *
+   * The expected strings below are **spelled out** rather than computed from
+   * either side. An expectation written as `documentTitle(t)` would agree with
+   * every possible behaviour of `documentTitle`, which is the way a test about
+   * two things that must agree quietly becomes a test about nothing.
+   */
+  it("normalises whitespace, controls and bidi identically on both sides", () => {
+    const cases: [string, string][] = [
+      /* [ the article's title, what BOTH sides must put in the tab ] */
+      ["A  B", "A B · Spideryarn"],
+      ["A\nB", "A B · Spideryarn"],
+      ["A\r\nB", "A B · Spideryarn"],
+      ["A\tB", "A B · Spideryarn"],
+      /* U+202E RIGHT-TO-LEFT OVERRIDE: invisible, and it reverses what follows
+         it. The client used to keep it. */
+      ["A\u202eB", "AB · Spideryarn"],
+      ["  spaced  ", "spaced · Spideryarn"],
+      /* The separator inside a title, which must survive being one. */
+      ["A · B", "A · B · Spideryarn"],
+      ["The hard problem is a distraction", "The hard problem is a distraction · Spideryarn"],
+      /* Arabic keeps every character it had — the strip is of invisible
+         instructions, not of right-to-left text. */
+      ["مرحبا بالعالم", "مرحبا بالعالم · Spideryarn"],
+    ];
+    for (const [title, expected] of cases) {
+      const client = pageTitle({ kind: "read", title, view: "article" });
+      expect(documentTitle(title), `server: ${JSON.stringify(title)}`).toBe(expected);
+      expect(client, `client: ${JSON.stringify(title)}`).toBe(expected);
+      /* Said as a comparison too, so this is about the pair and not about two
+         independent constants that happen to be written on one line. */
+      expect(documentTitle(title), `pair: ${JSON.stringify(title)}`).toBe(client);
     }
-    expect(documentTitle(null)).toBe(pageTitle({ kind: "read", title: "", view: "article" }));
-    /* And the one place they deliberately differ, written down so it is a
-       decision rather than a surprise: over 64 code points the client cuts at a
-       word boundary and adds an ellipsis, and the head does neither, because an
-       `…` in an `og:title` is a claim that the title contained one. */
+  });
+
+  it("says Untitled on both sides for a title that is nothing", () => {
+    for (const title of [null, "", "   ", "\u202e", "\n\t"]) {
+      expect(documentTitle(title), `server: ${JSON.stringify(title)}`).toBe("Untitled · Spideryarn");
+      expect(
+        pageTitle({ kind: "read", title: title ?? "", view: "article" }),
+        `client: ${JSON.stringify(title)}`,
+      ).toBe("Untitled · Spideryarn");
+    }
+  });
+
+  it("clamps long titles to the same string, ellipsis and all", () => {
+    /* 40 words of five characters. The clamp cuts at the last word boundary
+       inside 64 code points, which is after the twelfth. Written out rather
+       than derived: `clamp(x)` as the expectation would pass for any clamp. */
     const long = "word ".repeat(40);
-    expect(documentTitle(long)).not.toContain("…");
-    expect(pageTitle({ kind: "read", title: long, view: "article" })).toContain("…");
+    const expected = `${Array(12).fill("word").join(" ")}… · Spideryarn`;
+    expect(documentTitle(long)).toBe(expected);
+    expect(pageTitle({ kind: "read", title: long, view: "article" })).toBe(expected);
   });
 
   /**
-   * **And the second place they differ, which nobody decided** — pinned here as
-   * it is, not papered over.
+   * **The plumbing, not the rule** — and this is the case that answers "is the
+   * equality guaranteed, or only usually?"
    *
-   * The case above passes `title.trim()` to the client, which hides this: the
-   * server's title goes through `headText` (src/html.ts), so internal runs of
-   * whitespace collapse, control characters become a space, and bidi overrides
-   * are dropped. The client's `clamp()` only trims the ends and cuts to length.
-   * So for a title with a double space, a newline or an RLO in it, **the tab
-   * changes the moment React mounts** — the normalised title is replaced by the
-   * less normalised one. GPT Sol's review of slice 1 found it.
+   * The three cases above are about `documentTitle`, which both sides call. This
+   * one is about everything the *client* wraps around it: `pageTitle` reaches it
+   * through `segments` → `readTitle` → `join`, and `join` trims every part and
+   * drops the empty ones. Reasoning says that is a no-op — `articleTitle`
+   * normalises, so its result cannot begin or end in whitespace, and it falls
+   * back to `Untitled` rather than returning `""`. Reasoning is exactly what was
+   * wrong last time, so this looks instead.
    *
-   * This is a product decision and it is Greg's, so nothing is changed here. The
-   * value of the assertion is that the divergence is now a fact somebody wrote
-   * down: if either side is ever brought into line with the other, this test
-   * goes red and asks whether that was on purpose.
+   * Seeded, so a failure is reproducible from the number rather than from luck,
+   * and the alphabet is built out of the things that broke the two sides apart
+   * before: bidi controls, the C0/C1 range, whitespace the `CONTROLS` class does
+   * **not** cover (NBSP, zero-width space, ideographic space) which only the
+   * `\s` collapse can touch, surrogate pairs either side of the clamp, and the
+   * separator itself inside a title.
    *
-   * **Mutation: make `documentTitle` skip `headText` and only trim.** Red on
-   * every `not.toBe` below — which is the point, because that is precisely the
-   * "fix" that would look like tidying.
+   * **`oldClient` is the control.** A fuzz that finds nothing is worthless until
+   * it has been shown to find something, and "no divergence" is precisely the
+   * output an inert loop produces. So the same loop runs against the client
+   * behaviour as it was before 2026-08-30, and is required to fail.
    */
-  it("but diverges from the client on internal whitespace, controls and bidi — pinned, not fixed", () => {
-    const cases: [string, string, string][] = [
-      /* [ the title, what the server writes, what React writes over it ] */
-      ["A  B", "A B · Spideryarn", "A  B · Spideryarn"],
-      ["A\nB", "A B · Spideryarn", "A\nB · Spideryarn"],
-      ["A\tB", "A B · Spideryarn", "A\tB · Spideryarn"],
-      ["A‮B", "AB · Spideryarn", "A‮B · Spideryarn"],
+  it("finds no divergence the client's own wrapping could introduce — and can find one", () => {
+    /* The client before the fix: trim the ends, clamp, fall back. Nothing calls
+       this; it exists so that the loop below can be seen failing. */
+    const oldClient = (t: string) => `${clamp(t.trim()) || "Untitled"} · Spideryarn`;
+
+    const ALPHABET = [
+      " ", "  ", "\t", "\n", "\r\n", "\v", "\f", "\u0000", "\u001f", "\u007f", "\u009f",
+      "\u202e", "\u202a", "\u2066", "\u2069", "\u061c", // RLO, LRE, LRI, PDI, ALM
+      /* NBSP and the ideographic space are outside the CONTROLS class but are
+         `\s`, so the collapse reaches them. U+200B and U+FEFF are neither, and
+         survive normalising untouched — which is fine, and is why src/html.ts no
+         longer claims to remove "nothing invisible". */
+      "\u00a0", "\u3000", "\u200b", "\ufeff",
+      "a", "word", "the", "·", " · ", "…", "&", "<", "'", '"',
+      "\u{1D54F}", "\u{1F1EC}\u{1F1E7}", "é", "e\u0301", "\u0645\u0631\u062d\u0628\u0627",
     ];
-    for (const [title, server, client] of cases) {
-      expect(documentTitle(title), title).toBe(server);
-      expect(pageTitle({ kind: "read", title, view: "article" }), title).toBe(client);
-      /* Said as a comparison too, so this test is about the pair rather than
-         about two independent constants that happen to be written here. */
-      expect(documentTitle(title), title).not.toBe(
-        pageTitle({ kind: "read", title, view: "article" }),
-      );
+
+    /* A linear congruential generator — deterministic, and no dependency. */
+    let seed = 20260830;
+    const rnd = () => {
+      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
+      return seed / 0x7fffffff;
+    };
+    const titles: string[] = [];
+    for (let i = 0; i < 20_000; i++) {
+      let t = "";
+      const n = Math.floor(rnd() * 40);
+      for (let j = 0; j < n; j++) t += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
+      titles.push(t);
     }
+
+    const diverged = titles.filter(
+      (t) => documentTitle(t) !== pageTitle({ kind: "read", title: t, view: "article" }),
+    );
+    expect(diverged.slice(0, 3).map((t) => JSON.stringify(t))).toEqual([]);
+
+    /* The control. If this ever comes back empty the corpus has stopped
+       exercising anything and the assertion above means nothing. */
+    const wouldHaveDiverged = titles.filter((t) => documentTitle(t) !== oldClient(t));
+    expect(wouldHaveDiverged.length).toBeGreaterThan(1_000);
+  });
+
+  /**
+   * **Every mode, through the served page** — the dimension the fuzz could not
+   * see.
+   *
+   * The fuzz varies the title's *characters* and leaves `mode` absent on both
+   * sides, so it fixes the one axis this case is about. `/read/x?mode=glossary`
+   * was served as `Article · Spideryarn` and then replaced by React with
+   * `Article · Glossary · Spideryarn`: a fourth instance of the same fault, and
+   * invisible to a corpus that only ever asked about the default mode. GPT Sol
+   * found it, 2026-08-30, and the phrase worth keeping is his — **the missing
+   * dimension was title state, not title characters.**
+   *
+   * `MODES` is read from src/modes.ts rather than listed here, so a tenth mode
+   * arrives in this loop without anybody remembering to add it.
+   */
+  it("agrees with the client in every one of the nine modes", () => {
+    expect(MODES.length, "a mode was added or removed; check this still covers them").toBe(9);
+    for (const mode of MODES) {
+      const d = doc(composeShell(SHELL, head({ title: "A shared piece" }), mode));
+      const client = pageTitle({ kind: "read", title: "A shared piece", view: "article", mode });
+      expect(d.title, mode).toBe(client);
+    }
+  });
+
+  it("and spells the two ends of that out, so the loop is not comparing two bugs", () => {
+    /* The default mode is left out of the title entirely — the rule in
+       `readTitle`, and the reason the loop above cannot be satisfied by a
+       function that simply appends every mode. */
+    expect(doc(composeShell(SHELL, head({ title: "A shared piece" }), "hierarchy")).title).toBe(
+      "A shared piece · Spideryarn",
+    );
+    expect(doc(composeShell(SHELL, head({ title: "A shared piece" }), "glossary")).title).toBe(
+      "A shared piece · Glossary · Spideryarn",
+    );
+  });
+
+  it("says Metadata where the client will, and drops the mode as the client does", () => {
+    /* The composed head for `/read/x?about=1&mode=glossary`. `readTitle` gives a
+       non-article view its own label and ignores the mode entirely, so the
+       server must too — otherwise the tab reads `· Glossary ·` for a second and
+       then `· Metadata ·`. Spelled out on both sides. */
+    const d = doc(composeShell(SHELL, head({ title: "A shared piece" }), "glossary", "metadata"));
+    expect(d.title).toBe("A shared piece · Metadata · Spideryarn");
+    expect(d.title).toBe(
+      pageTitle({ kind: "read", title: "A shared piece", view: "metadata", mode: "glossary" }),
+    );
+    /* And the card is still about the article, not about which of its pages the
+       address named. */
+    expect(metaContent(d, 'meta[property="og:title"]')).toBe("A shared piece");
+    expect(metaContent(d, 'meta[property="og:url"]')).toBe(
+      "https://www.spideryarn.com/read/the-hard-problem",
+    );
+  });
+
+  it("but keeps the mode out of the card, which is about the article", () => {
+    /* A shared link is about the article, not about which panel the person who
+       shared it happened to have open — and `og:url` is the mode-free address
+       for the same reason. */
+    const d = doc(composeShell(SHELL, head({ title: "A shared piece" }), "glossary"));
+    expect(metaContent(d, 'meta[property="og:title"]')).toBe("A shared piece");
+    expect(metaContent(d, 'meta[name="twitter:title"]')).toBe("A shared piece");
+    expect(metaContent(d, 'meta[property="og:url"]')).not.toContain("mode");
+  });
+
+  /**
+   * **The difference that remains, which is a decision rather than a drift.**
+   *
+   * `<title>` and `og:title` are different sinks read by different things, so
+   * they are allowed to differ — and the divergence this test is about is
+   * between a tab and a card, not between two copies of one rule.
+   *
+   * The card drops the ` · Spideryarn` suffix, because the card already carries
+   * `og:site_name` and repeating it spends the visible half of the card saying
+   * one word twice. And it clamps hard at 120 with no ellipsis, because an `…`
+   * in published metadata is a claim that the title contained one.
+   */
+  it("but the card title is not the tab title, on purpose", () => {
+    const long = "word ".repeat(40);
+    const d = doc(composeShell(SHELL, head({ title: long })));
+    const card = metaContent(d, 'meta[property="og:title"]');
+
+    expect(card).not.toContain("…");
+    expect(card).not.toContain("Spideryarn");
+    /* 24 words, not 25: `headText` cuts at 120 code points — which lands on the
+       space after the twenty-fourth — and trims the end, because a metadata
+       string ending in a space is one that will not compare equal to the obvious
+       expectation of it. Written out for the reason the case above is. */
+    expect(card).toBe(Array(24).fill("word").join(" "));
+    expect(card).not.toBe(d.title);
+    /* And the tab, from the same document, is the client's string — so this
+       case is also a check that `composeShell` uses `documentTitle` rather than
+       composing a third title of its own. */
+    expect(d.title).toBe(pageTitle({ kind: "read", title: long, view: "article" }));
   });
 
   it("puts the composed head between the sentinels and leaves them in place", () => {
diff --git a/tests/page-title.test.ts b/tests/page-title.test.ts
index c3c1bd2..02bc43f 100644
--- a/tests/page-title.test.ts
+++ b/tests/page-title.test.ts
@@ -21,9 +21,20 @@
  */
 import { readFileSync, readdirSync } from "node:fs";
 import path from "node:path";
+import { JSDOM } from "jsdom";
 import { describe, expect, it } from "vitest";
 import { MODES } from "../src/web/params.js";
-import { APP_NAME, CLAMP, SEP, TAGLINE, clamp, host, pageTitle } from "../src/web/page-title.js";
+import {
+  APP_NAME,
+  articleWaitTitle,
+  CLAMP,
+  SEP,
+  serverComposedHead,
+  TAGLINE,
+  clamp,
+  host,
+  pageTitle,
+} from "../src/web/page-title.js";
 
 describe("the shelf", () => {
   it("is the one page that leads with the app's name, and the one with the strapline", () => {
@@ -238,6 +249,92 @@ describe("host", () => {
   });
 });
 
+/**
+ * **The tab a shared link arrives with, and the rule that stops us wrecking it.**
+ *
+ * Since 2026-08-29 a public `/read/<slug>` is served with the article's real
+ * title already in the tab. `ArticlePage` used to replace that with `Loading…`
+ * whenever the fetch ran past 600ms — a cold serverless start against Postgres,
+ * routinely — and then put it back. A correct title turning into a worse one and
+ * back, announced to a screen reader both times.
+ *
+ * `articleWaitTitle` is the decision. Its two guards are both load-bearing and
+ * each has a case below that fails without it.
+ */
+describe("what the tab says while a shared article loads", () => {
+  const HERE = { slug: "a-shared-piece", title: "A shared piece · Spideryarn" };
+  const LOADING = `Loading…${SEP}${APP_NAME}`;
+  const ERROR = `Couldn’t open${SEP}${APP_NAME}`;
+
+  it("says nothing, leaving the title the server composed", () => {
+    /* The assertion this case is named for and the reason the function exists:
+       "" is `useDocumentTitle`'s "not mine to set". */
+    expect(articleWaitTitle("loading", HERE.slug, HERE.title, HERE)).toBe("");
+  });
+
+  it("but says Loading… once the reader is waiting for a different article", () => {
+    /* Guard one. The composed head describes one article; after a navigation
+       the server's title is about the page the reader has left, and keeping it
+       would be a lie rather than a courtesy. Delete `composed.slug === slug`
+       and this is the case that goes red. */
+    expect(articleWaitTitle("loading", "some-other-piece", HERE.title, HERE)).toBe(LOADING);
+  });
+
+  it("and once something else has already changed the tab", () => {
+    /* Guard two, and the case that is easy to miss: a reader who goes
+       /read/a → /read/b → back to /read/a still has an `og:url` naming a, so
+       the slug check alone passes and b's title would be left standing over a's
+       loading page. Comparing the string self-expires the moment anything
+       writes a different one. */
+    expect(articleWaitTitle("loading", HERE.slug, "Another piece · Spideryarn", HERE)).toBe(LOADING);
+  });
+
+  it("and on every page the server did not compose a head for", () => {
+    /* An ordinary SPA navigation, a private article, a signed-in reader's own
+       shelf — the overwhelming majority of loads, and the behaviour this
+       function must leave exactly as it was. */
+    expect(articleWaitTitle("loading", HERE.slug, "Spideryarn", null)).toBe(LOADING);
+  });
+
+  it("replaces it when the fetch failed, which Loading… deliberately does not", () => {
+    /* `Loading…` is a claim that the right title is coming. `Couldn’t open` is a
+       claim that it is not, and a broken page must not go on advertising the
+       article it could not show. */
+    expect(articleWaitTitle("error", HERE.slug, HERE.title, HERE)).toBe(ERROR);
+  });
+
+  it("and hands over to the view as soon as the article is here", () => {
+    expect(articleWaitTitle("ready", HERE.slug, HERE.title, HERE)).toBe("");
+  });
+});
+
+describe("reading what the server composed out of the document", () => {
+  const docWith = (head: string): Document =>
+    new JSDOM(`<!doctype html><html><head>${head}<title>A shared piece · Spideryarn</title></head><body></body></html>`).window.document;
+
+  it("takes the slug from og:url, which is the only thing that carries it", () => {
+    const d = docWith('<meta property="og:url" content="https://www.spideryarn.com/read/a-shared-piece" />');
+    expect(serverComposedHead(d)).toEqual({
+      slug: "a-shared-piece",
+      title: "A shared piece · Spideryarn",
+    });
+  });
+
+  it("decodes it, because the server percent-encodes what it writes there", () => {
+    const d = docWith('<meta property="og:url" content="https://www.spideryarn.com/read/a%20b" />');
+    expect(serverComposedHead(d)?.slug).toBe("a b");
+  });
+
+  it("and says there is none for every page the server did not compose", () => {
+    /* The bare shell — every route but a shared article. */
+    expect(serverComposedHead(docWith(""))).toBeNull();
+    /* A malformed percent-escape makes `decodeURIComponent` throw, and a throw
+       at module load would take the whole bundle down over a tab title. */
+    const bad = docWith('<meta property="og:url" content="https://www.spideryarn.com/read/a%zz" />');
+    expect(serverComposedHead(bad)).toBeNull();
+  });
+});
+
 /**
  * **A page wired to a route but not to a title is the silent failure here** —
  * it simply inherits whatever the last page set, and a stale title on a new
@@ -271,6 +368,27 @@ describe("every kind of page is actually wired up", () => {
     expect(missing).toEqual([]);
   });
 
+  /**
+   * **`articleWaitTitle` is only worth anything if `ArticlePage` calls it.**
+   *
+   * Earlier in this same body of work a guard was written, documented, called by
+   * a build check and referred to in its file's header as being in force — and
+   * never called from the function it was guarding. The rule against a rule that
+   * is documented but not enforced was itself documented and not enforced.
+   *
+   * This is a **static** check and it says so: it proves the call is written, not
+   * that it runs. The dynamic half would mean mounting `ArticlePage`, which
+   * drags the whole app in; the six cases above cover the decision itself, and
+   * this covers the one failure they cannot see.
+   */
+  it("and ArticlePage actually asks articleWaitTitle what to say", () => {
+    const app = readFileSync(path.join(WEB, "App.tsx"), "utf8");
+    expect(app).toContain("articleWaitTitle(");
+    /* And has stopped composing the answer itself, which is the shape the call
+       replaced — leaving both would put the old behaviour back on some path. */
+    expect(app).not.toContain('pageTitle({ kind: "loading" })');
+  });
+
   it("can tell — the union really was read, and it is not empty", () => {
     expect(kinds().length).toBeGreaterThanOrEqual(9);
     expect(kinds()).toContain("library");
diff --git a/tests/public-read-rewrite.test.ts b/tests/public-read-rewrite.test.ts
index b2425ed..f6b886e 100644
--- a/tests/public-read-rewrite.test.ts
+++ b/tests/public-read-rewrite.test.ts
@@ -33,7 +33,10 @@ import path from "node:path";
 import { describe, expect, it } from "vitest";
 
 import { decidePublicPage } from "../src/public/page.js";
-import { originalUrl, readSlug } from "../src/vercel.js";
+import { DEFAULT_MODE, MODES } from "../src/modes.js";
+import { redirectsToMetadata, viewFor } from "../src/read-address.js";
+import { modeParam } from "../src/web/params.js";
+import { originalUrl, readMode, readSlug } from "../src/vercel.js";
 import { parseRoute } from "../src/web/router.js";
 
 const ROOT = path.resolve(import.meta.dirname, "..");
@@ -313,6 +316,165 @@ describe("readSlug, and what a malformed capture is answered with", () => {
   });
 });
 
+/**
+ * **The mode has to survive the rewrite, because the tab carries it.**
+ *
+ * `/read/x?mode=glossary` was served as `x · Spideryarn` and then rewritten by
+ * React to `x · Glossary · Spideryarn` — the same fault as the whitespace one,
+ * on the axis nothing was varying. GPT Sol found it, 2026-08-30.
+ *
+ * The rewrite preserves the original query beside the `__spy_read` capture
+ * (§ *originalUrl and the second capture* above), so the value is here to be
+ * read; `readMode` is what reads it.
+ */
+describe("readMode, and the mode a shared address asked for", () => {
+  it("takes it off the restored URL, for every mode there is", () => {
+    for (const mode of MODES) {
+      expect(readMode(`/read/some-article?mode=${mode}`), mode).toBe(mode);
+    }
+  });
+
+  it("lands an unknown one on the default rather than failing", () => {
+    /* The rule `modeParam` already keeps on the client: a link from a future
+       version, or a pre-2026-08-29 `?mode=toc` link, degrades to the article
+       rather than to an error. `toc` is the real case — it named this very
+       view until the rename. */
+    for (const asked of ["toc", "", "HIERARCHY", "glossary ", "../../etc/passwd", "%zz"]) {
+      expect(readMode(`/read/some-article?mode=${asked}`), asked).toBe("hierarchy");
+    }
+  });
+
+  it("and on the default when the address says nothing about it", () => {
+    expect(readMode("/read/some-article")).toBe("hierarchy");
+    expect(readMode("/read/some-article?at=spya-k3m9qt")).toBe("hierarchy");
+    /* A stranger controls this string, and a throw here would be a 500 on an
+       address that only wanted a tab title. */
+    expect(readMode("/read/some-article?%")).toBe("hierarchy");
+    expect(readMode("")).toBe("hierarchy");
+  });
+
+  /**
+   * **The two predicates, paired on the inputs that are not modes.**
+   *
+   * `readMode` calls `isMode`; `modeParam.parse` used to call `MODES.includes`
+   * separately, so "one place decides what a mode is" was a claim rather than a
+   * fact — and every test compared each side against literals instead of
+   * against the other. They agreed, but nothing would have noticed if they
+   * stopped. GPT Sol, 2026-08-30.
+   *
+   * The corpus is mostly **junk on purpose**: the nine good values are the case
+   * that already passes, and the interesting question is whether two
+   * implementations of "not a mode" reject identically.
+   */
+  it("agrees with the client's own parser about what is not a mode", () => {
+    const asked = [
+      ...MODES,
+      "toc",
+      "TOC",
+      "Hierarchy",
+      "hierarchy ",
+      " hierarchy",
+      "hierarchy,chat",
+      "",
+      "0",
+      "null",
+      "undefined",
+      "__proto__",
+      "constructor",
+      "toString",
+      "hasOwnProperty",
+      "length",
+      "0.5",
+      "-1",
+      "true",
+    ];
+    for (const value of asked) {
+      const client = modeParam.parse(value) ?? DEFAULT_MODE;
+      const server = readMode(`/read/some-article?mode=${encodeURIComponent(value)}`);
+      expect(server, `mode=${JSON.stringify(value)}`).toBe(client);
+    }
+    /* And the control: the corpus really does contain things that are rejected,
+       so "they agree" is not the trivial agreement of two functions that accept
+       everything. */
+    expect(asked.filter((v) => modeParam.parse(v) === null).length).toBeGreaterThan(10);
+  });
+
+  it("survives the round trip through the rewrite, which is the only path it has", () => {
+    /* Not `readMode` on a URL written by hand: the value has to come through
+       `originalUrl`, because that is where a rewrite that dropped the query
+       would show up — and a hand-written URL would pass with the query
+       discarded. */
+    const restored = originalUrl("/api/index?__spy_read=some-article&mode=glossary");
+    expect(restored, "the rewrite must preserve the query").toContain("mode=glossary");
+    expect(readMode(restored ?? "")).toBe("glossary");
+  });
+});
+
+/**
+ * **The legacy metadata spellings, which reach the composer while the real
+ * metadata address never does.**
+ *
+ * `/read/x/metadata` is two path segments, so vercel.json's `/read/:slug` does
+ * not match it and it falls to the SPA catch-all — pinned above. I checked that
+ * and concluded the view axis was safe. It is not: `/read/x?about=1` is **one**
+ * segment, so it matches, the server composed the *article's* title for it, and
+ * `main.tsx` then rewrote the address to `/read/x/metadata` before React drew
+ * anything. The tab went `Article · Spideryarn` → `Article · Metadata ·
+ * Spideryarn`; with `?mode=glossary` on it, `Article · Glossary · Spideryarn` →
+ * `Article · Metadata · Spideryarn`. GPT Sol, 2026-08-30 — the fifth of these,
+ * and the second it found after I had reasoned my way past the axis.
+ */
+describe("viewFor, and the legacy spellings of the metadata page", () => {
+  it("recognises the two that redirect", () => {
+    for (const query of [
+      "?about=1",
+      "?panel=about",
+      "?mode=glossary&about=1",
+      "?about=1&mode=glossary",
+      "?at=spya-k3m9qt&panel=about&cols=0,1",
+    ]) {
+      expect(viewFor(query), query).toBe("metadata");
+      expect(redirectsToMetadata(query), query).toBe(true);
+    }
+  });
+
+  it("and leaves the article alone for everything else, `about=0` included", () => {
+    /* `about=0` meant the panel was shut. It is stripped from the URL and the
+       reader stays on the article, so the server must go on composing the
+       article's title for it — the one case where "contains about=" and
+       "becomes the metadata page" are different answers. */
+    for (const query of [
+      "",
+      "?",
+      "?about=0",
+      "?mode=glossary",
+      "?about=2",
+      "?aboutx=1",
+      "?xabout=1",
+      "?panel=notes",
+      "?panel=aboutish",
+      "?notabout=1",
+    ]) {
+      expect(viewFor(query), query).toBe("article");
+      expect(redirectsToMetadata(query), query).toBe(false);
+    }
+  });
+
+  it("agrees with main.tsx, which is the code that actually does the rewrite", () => {
+    /* `main.tsx` calls `redirectsToMetadata` rather than keeping the pattern —
+       this is the assertion that says so, and it is the failure that was live:
+       the rule was written twice and the two spellings drifted apart in what
+       they were asked about. Static, and it says so; the cases above are the
+       behaviour. */
+    const main = readFileSync(
+      path.join(path.resolve(import.meta.dirname, ".."), "src", "web", "main.tsx"),
+      "utf8",
+    );
+    expect(main).toContain("redirectsToMetadata(location.search)");
+    expect(main).not.toContain("/(^|[?&])(about=1|panel=about)($|&)/");
+  });
+});
+
 describe("parseRoute and a malformed slug", () => {
   /**
    * **`/read/Upper` is the shelf, not an error page.**
diff --git a/tests/public-visibility-pg.test.ts b/tests/public-visibility-pg.test.ts
index 2d454eb..350ef1e 100644
--- a/tests/public-visibility-pg.test.ts
+++ b/tests/public-visibility-pg.test.ts
@@ -47,6 +47,7 @@ import {
 } from "../src/db/schema.js";
 import { loadEnvLocal } from "../src/env.js";
 import { pgPublicReader } from "../src/store/public-reader.js";
+import { documentTitle } from "../src/title-text.js";
 import { safePublicCanonical } from "../src/urls.js";
 import { currentOwnerId, type OwnerId, runInRequest } from "../src/owner.js";
 import type { Glossary, Ideas, Summaries, TweetThread } from "../src/types.js";
@@ -1468,6 +1469,312 @@ when("a public article whose revision has no blocks", { timeout: 60_000 }, () =>
   });
 });
 
+/**
+ * **An article with no title of its own, which is where the two sides said
+ * different things.**
+ *
+ * `/read/<slug>` is served with a `<title>` composed from `loadHead`, and React
+ * then sets `document.title` from the article payload's `meta.title`. Those come
+ * from two different fallback chains:
+ *
+ *   loadHead   `title ?? headingTitle`               → then `Untitled`
+ *   metaFrom   `title ?? headingTitle ?? slug`       (src/public/dto.ts)
+ *
+ * They agree for every article that has a title or an `<h1>`, which is nearly
+ * all of them, and that is exactly why nothing caught it: **the corpus could not
+ * reach the disagreement.** For an article with neither, the tab said
+ * `Untitled · Spideryarn` and then changed to the slug a second later. GPT Sol
+ * found it while reviewing the fix for the *other* divergence between these two
+ * (whitespace and bidi normalising, src/title-text.ts), minutes before its
+ * 45-minute budget ran out.
+ *
+ * It needs its own fixture for the reason the boneless one above does: the main
+ * fixture has both a title and an `<h1>`, so the bug is unreachable from it and
+ * every assertion in this file stays green with the fault in place.
+ *
+ * Blocks, so `hasBlocks` passes and the head is served at all — but not one of
+ * them is a level-1 heading, which is what `PUBLIC_HEADING_TITLE` looks for.
+ */
+const TITLELESS_ID = "00000000-0000-4000-8000-0000000b04f0";
+const TITLELESS_REVISION = "00000000-0000-4000-8000-0000000b04f1";
+const TITLELESS_SLUG = "test-public-head-no-title";
+/* The id alphabet excludes i, l, o and 1 (src/ids.ts), and `block_identities`
+   has a check constraint on it — "notitl" is refused for three of those four. */
+const TITLELESS_BLOCK = "spya-ntxhqz";
+
+when("a public article with neither a title nor an <h1>", { timeout: 60_000 }, () => {
+  beforeAll(async () => {
+    const db = getDb();
+    await cleanTitleless();
+    await db.insert(articles).values({
+      id: TITLELESS_ID,
+      ownerId: OWNER,
+      slug: TITLELESS_SLUG,
+      visibility: "public",
+    });
+    await db.insert(articleRevisions).values({
+      id: TITLELESS_REVISION,
+      articleId: TITLELESS_ID,
+      status: "published",
+      /* The whole point of the fixture. */
+      title: null,
+      wordCount: 7,
+      blockCount: 1,
+      tree: {
+        version: "test",
+        generator: "test",
+        slug: TITLELESS_SLUG,
+        rootId: "n0",
+        nodes: {
+          n0: { id: "n0", depth: 0, parent: null, children: [], range: [TITLELESS_BLOCK, TITLELESS_BLOCK], title: "Root", gist: "Prose with no heading above it." },
+        },
+      },
+    });
+    /* `revision_blocks` has a foreign key into `block_identities` — an id is
+       minted once for an article and every later revision points at it
+       (docs/project/block-ids.md). Without this row the insert below fails with
+       `revision_blocks_identity_fk`, and vitest reports the whole suite's tests
+       as **skipped** rather than failed, which is how a broken fixture reads as
+       green in a filtered summary. */
+    await db.insert(blockIdentities).values({ articleId: TITLELESS_ID, blockId: TITLELESS_BLOCK });
+    await db.insert(revisionBlocks).values([
+      {
+        articleId: TITLELESS_ID,
+        revisionId: TITLELESS_REVISION,
+        blockId: TITLELESS_BLOCK,
+        ordinal: 0,
+        /* `p`, not `h1`. A heading here would give the fallback something to
+           find and the fixture would stop being able to show the bug. */
+        tag: "p",
+        kind: "text",
+        text: "Prose with no heading above it.",
+        words: 6,
+        html: "<p>Prose with no heading above it.</p>",
+        gistable: true,
+      },
+    ]);
+    await db
+      .update(articles)
+      .set({ currentRevisionId: TITLELESS_REVISION })
+      .where(eq(articles.id, TITLELESS_ID));
+  });
+
+  afterAll(cleanTitleless);
+
+  it("gives the head the same title the client is about to set", async () => {
+    const head = await pgPublicReader.loadHead(TITLELESS_SLUG);
+    const r = await call("GET", `/api/public/article/${TITLELESS_SLUG}`);
+    /* A precondition rather than a claim: without a payload there is no client
+       title to disagree with, and the failure below would be about the wrong
+       thing. */
+    expect(r.status, "the fixture must be served at all").toBe(200);
+    const client = (r.body as { meta: { title: string | null } }).meta.title;
+
+    /* **The assertion this test is named for, and it goes first.** Everything
+       above an assertion is a lid on it — a failing `expect` ends the case, so a
+       fault caught by a later line proves nothing about this one. */
+    expect(head.title, "loadHead and metaFrom must agree").toBe(client);
+
+    /* And what they agree *on*, spelled out, because two sides agreeing on the
+       wrong answer is the other way this passes while broken. The slug is the
+       fallback the owner's side has always used; `Untitled` was only ever the
+       head's. */
+    expect(head.title).toBe(TITLELESS_SLUG);
+    expect(documentTitle(head.title)).toBe(`${TITLELESS_SLUG} · Spideryarn`);
+    expect(documentTitle(head.title)).not.toContain("Untitled");
+  });
+
+  /**
+   * The control on the fixture: it really does have neither of the two things
+   * the fallback prefers. If a later edit gave it a title or an `<h1>`, the case
+   * above would pass with the bug back in place, and nothing would say so.
+   */
+  it("and the fixture really is titleless — no stored title, no level-1 heading", async () => {
+    const db = getDb();
+    const [rev] = await db
+      .select({ title: articleRevisions.title })
+      .from(articleRevisions)
+      .where(eq(articleRevisions.id, TITLELESS_REVISION));
+    expect(rev?.title).toBeNull();
+
+    const headings = await db
+      .select({ blockId: revisionBlocks.blockId })
+      .from(revisionBlocks)
+      .where(and(eq(revisionBlocks.revisionId, TITLELESS_REVISION), eq(revisionBlocks.kind, "heading")));
+    expect(headings).toEqual([]);
+  });
+});
+
+/**
+ * **The `<h1>` rung of the same fallback, which has two implementations.**
+ *
+ * `loadHead` finds the first level-1 heading **in SQL** (`PUBLIC_HEADING_TITLE`,
+ * src/store/public-reader.ts); the article payload finds it **in TypeScript**
+ * (`headingTitleOf`, src/library-scalars.ts, over the blocks it already has in
+ * memory). Two implementations of one rule, and the tab is composed from the
+ * first and then overwritten from the second.
+ *
+ * The fixture above covers only the last rung, the slug. This one covers the
+ * rung above it, and it is built to be **awkward on the two axes each
+ * implementation could get wrong on its own**:
+ *
+ *  - an `h2` sits before the first `h1`, so anything that takes the first
+ *    *heading* rather than the first level-1 heading picks the wrong one;
+ *  - there are two `h1`s, and the rows are **inserted in the wrong order**, so
+ *    an implementation that leans on insertion order rather than `ordinal`
+ *    picks the second.
+ *
+ * GPT Sol asked for this, 2026-08-30: the two agree today, but nothing paired
+ * them, so a mutation like `level = 2` or a reversed `order by` in the SQL would
+ * have survived every test in the repo.
+ */
+const HEADED_ID = "00000000-0000-4000-8000-0000000b0500";
+const HEADED_REVISION = "00000000-0000-4000-8000-0000000b0501";
+const HEADED_SLUG = "test-public-head-h1-fallback";
+/** What both implementations must find: the first `h1` *by ordinal*. */
+const HEADED_H1 = "The first level-one heading";
+
+when("a public article whose only title is its first <h1>", { timeout: 60_000 }, () => {
+  beforeAll(async () => {
+    const db = getDb();
+    await cleanHeaded();
+    await db.insert(articles).values({
+      id: HEADED_ID,
+      ownerId: OWNER,
+      slug: HEADED_SLUG,
+      visibility: "public",
+    });
+    await db.insert(articleRevisions).values({
+      id: HEADED_REVISION,
+      articleId: HEADED_ID,
+      status: "published",
+      title: null,
+      wordCount: 12,
+      blockCount: 3,
+      tree: {
+        version: "test",
+        generator: "test",
+        slug: HEADED_SLUG,
+        rootId: "n0",
+        nodes: {
+          n0: {
+            id: "n0",
+            depth: 0,
+            parent: null,
+            children: [],
+            range: ["spya-hdgaaa", "spya-hdgccc"],
+            title: "Root",
+            gist: "A piece whose title is its heading.",
+          },
+        },
+      },
+    });
+    for (const id of ["spya-hdgaaa", "spya-hdgbbb", "spya-hdgccc"]) {
+      await db.insert(blockIdentities).values({ articleId: HEADED_ID, blockId: id });
+    }
+    /* **Deliberately not in ordinal order.** An implementation that takes the
+       first row it is handed rather than the lowest `ordinal` gets the second
+       `h1`, and that is the whole point of writing them this way round. */
+    await db.insert(revisionBlocks).values([
+      {
+        articleId: HEADED_ID,
+        revisionId: HEADED_REVISION,
+        blockId: "spya-hdgccc",
+        ordinal: 2,
+        tag: "h1",
+        kind: "heading",
+        level: 1,
+        text: "A second level-one heading, later in the document",
+        words: 8,
+        html: "<h1>A second level-one heading, later in the document</h1>",
+        gistable: true,
+      },
+      {
+        articleId: HEADED_ID,
+        revisionId: HEADED_REVISION,
+        blockId: "spya-hdgaaa",
+        ordinal: 0,
+        /* An `h2` above the first `h1`, so "first heading" and "first level-1
+           heading" are different answers. */
+        tag: "h2",
+        kind: "heading",
+        level: 2,
+        text: "A subheading that comes first",
+        words: 5,
+        html: "<h2>A subheading that comes first</h2>",
+        gistable: true,
+      },
+      {
+        articleId: HEADED_ID,
+        revisionId: HEADED_REVISION,
+        blockId: "spya-hdgbbb",
+        ordinal: 1,
+        tag: "h1",
+        kind: "heading",
+        level: 1,
+        text: HEADED_H1,
+        words: 4,
+        html: `<h1>${HEADED_H1}</h1>`,
+        gistable: true,
+      },
+    ]);
+    await db
+      .update(articles)
+      .set({ currentRevisionId: HEADED_REVISION })
+      .where(eq(articles.id, HEADED_ID));
+  });
+
+  afterAll(cleanHeaded);
+
+  it("finds the same <h1> in SQL that the payload finds in TypeScript", async () => {
+    const head = await pgPublicReader.loadHead(HEADED_SLUG);
+    const r = await call("GET", `/api/public/article/${HEADED_SLUG}`);
+    expect(r.status, "the fixture must be served at all").toBe(200);
+    const client = (r.body as { meta: { title: string | null } }).meta.title;
+
+    /* The assertion this case is named for, first. */
+    expect(head.title, "PUBLIC_HEADING_TITLE and headingTitleOf must agree").toBe(client);
+
+    /* And what they agree on, spelled out — not derived from either, or the
+       pair could agree on the subheading, on the second `h1`, or on the slug
+       and this would still pass. */
+    expect(head.title).toBe(HEADED_H1);
+    expect(head.title).not.toBe(HEADED_SLUG);
+    expect(documentTitle(head.title)).toBe(`${HEADED_H1} · Spideryarn`);
+  });
+
+  it("and the fixture really is awkward — an h2 first, and two h1s out of order", async () => {
+    /* The control on the control. If a later edit tidied these rows into
+       ordinal order or dropped the `h2`, the case above would pass with either
+       implementation broken and nothing would say so. */
+    const rows = await getDb()
+      .select({ ordinal: revisionBlocks.ordinal, level: revisionBlocks.level })
+      .from(revisionBlocks)
+      .where(eq(revisionBlocks.revisionId, HEADED_REVISION));
+    expect(rows.filter((r) => r.level === 1)).toHaveLength(2);
+    const first = rows.find((r) => r.ordinal === 0);
+    expect(first?.level, "an h2 must come before the first h1").toBe(2);
+  });
+});
+
+async function cleanHeaded() {
+  const db = getDb();
+  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, HEADED_ID));
+  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, HEADED_ID));
+  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, HEADED_ID));
+  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, HEADED_ID));
+  await db.delete(articles).where(eq(articles.id, HEADED_ID));
+}
+
+async function cleanTitleless() {
+  const db = getDb();
+  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, TITLELESS_ID));
+  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, TITLELESS_ID));
+  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, TITLELESS_ID));
+  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, TITLELESS_ID));
+  await db.delete(articles).where(eq(articles.id, TITLELESS_ID));
+}
+
 async function cleanBoneless() {
   const db = getDb();
   await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, BONELESS_ID));
diff --git a/src/title-text.ts b/src/title-text.ts
new file mode 100644
--- /dev/null
+++ b/src/title-text.ts
+/**
+ * **The article title in a tab, composed once for both the sides that write
+ * it.**
+ *
+ * Two things put a title into `<title>`, half a second apart. The server
+ * composes a head for `/read/<slug>` before the bundle has loaded, so that a
+ * pasted link previews as something (src/public/page-head.ts); React then
+ * mounts and assigns `document.title` from `pageTitle()`
+ * (src/web/page-title.ts). Whatever these two disagree about is a **visible
+ * change in the tab at mount** — the reader watches the title they were given
+ * turn into a different one.
+ *
+ * They did disagree, and nobody had decided that they should. The server ran
+ * the title through `headText` (src/html.ts): internal runs of whitespace
+ * collapsed, control characters became a space, bidi overrides were dropped.
+ * The client only trimmed the ends and cut to length. So an article titled
+ * `Two  spaces` was served as `Two spaces` and then rewritten to `Two  spaces`
+ * in front of the reader. GPT Sol's review of stage 2 slice 1 found it; it was
+ * pinned as a known divergence and put to Greg, who left the choice here
+ * (2026-08-30).
+ *
+ * **The choice: the server's normalisation wins, and the client's clamp wins.**
+ * Each side keeps the rule it had the better reason for.
+ *
+ *  - *Normalising* is not a preference. An RLO in a title reverses display
+ *    order (`A‮gnp.exe` shows as `A exe.png`) and a newline in a `<title>`
+ *    renders differently in every consumer of it. The server had to do it
+ *    because its output is published into caches we cannot clear, and there is
+ *    no argument for the tab being the one place a bidi override survives.
+ *  - *Clamping with a word-boundary ellipsis* is what a reader wants in a tab,
+ *    a bookmark and a history entry: `…` says "there was more". The server had
+ *    the hard cut because `headText` serves `og:title` as well, and an ellipsis
+ *    in metadata is a claim that the title contained one.
+ *
+ * So this file composes with `normaliseText` and with `clamp`, and both callers
+ * import the result rather than restating it. The `og:` and `twitter:` tags
+ * keep the hard `headText` clamp at their own limits — that difference is
+ * between *a tab* and *a card*, which are different sinks read by different
+ * things, and not between two copies of one rule.
+ *
+ * ## Why it is here rather than in src/web/
+ *
+ * src/web/page-title.ts imports React, and a module reached by
+ * src/public/routes.ts may not import anything under src/web/ — the public
+ * import graph is asserted closed (tests/public-imports.test.ts). The standing
+ * answer in this repo for a thing two sides need is to move it into a module
+ * that imports almost nothing, which is what this is: src/html.js for the
+ * normaliser, and src/modes.js and src/read-address.js for the two vocabularies
+ * a title is built from. All three are themselves leaves.
+ * tests/client-imports.test.ts lists every one of them and **checks** that they
+ * are pure rather than trusting the claim — which matters, because this
+ * paragraph said "src/html.js and no more" for half a day after `modes.js`
+ * arrived. GPT Sol, 2026-08-30.
+ *
+ * See docs/project/page-titles.md for the rules behind the composition, and
+ * docs/plans/260827ai-public-read-only-access.md § Stage 2 for the server half.
+ */
+import { normaliseText } from "./html.js";
+import { DEFAULT_MODE, type Mode } from "./modes.js";
+import type { ArticleView } from "./read-address.js";
+
+/** The product. `spideryarn2` is the working directory; this is the name. */
+export const APP_NAME = "Spideryarn";
+
+/**
+ * The strapline. It appears on the two homepages and nowhere else — the shelf
+ * with nothing chosen on it, and the landing page a signed-out reader gets
+ * instead. See `segments` in src/web/page-title.ts for why it is on no other.
+ */
+export const TAGLINE = "AI-assisted reading";
+
+/**
+ * Between segments.
+ *
+ * A middot rather than an em dash or a pipe: it is already this app's
+ * separator (the fact lines on the library card and the metadata page use it),
+ * it is the narrowest of the three so it spends the fewest of a tab's very few
+ * pixels, and unlike `-` it can never be confused with a hyphen inside a title
+ * that has one. No evidence anywhere says one separator is more legible than
+ * another; consistency with the rest of the app is the whole argument.
+ */
+export const SEP = " · ";
+
+/**
+ * How much of a leading title we keep.
+ *
+ * Nothing forces this. No browser has a character limit, and every place that
+ * truncates does it by **pixels** rather than characters — Firefox caps a tab
+ * at 225px, Chrome shrinks tabs until only the favicon is left, Google cuts a
+ * search result at about 600px. The familiar "50-60 characters" is SEO folklore
+ * converged on by blogs, not a vendor number, and it is the wrong *unit*
+ * besides. So a clamp cannot make a title fit a tab, and this one does not try.
+ *
+ * It is for the places that do *not* truncate: the history list, a bookmark,
+ * the window switcher, and the text somebody gets when they paste a link into a
+ * chat. A 180-character academic paper title there pushes everything after it
+ * off the end of the useful world.
+ *
+ * 64 is therefore a judgment call rather than a measurement, and it is
+ * deliberately generous — comfortably more than any tab shows, so clamping
+ * never costs a reader something the tab would have shown them.
+ */
+export const CLAMP = 64;
+
+/**
+ * Cut at a word boundary, with an ellipsis, or return the text unchanged.
+ *
+ * Word boundary rather than mid-word because the cut is doing the reader a
+ * favour and a truncation that lands inside a word looks like corruption. If
+ * there is no space to cut at in the last third of the budget — one very long
+ * word, or a language that does not space its words — it cuts where it must,
+ * which is still better than not clamping.
+ *
+ * **Counted in code points, not in UTF-16 units**, which is why the text is
+ * split into an array first rather than sliced. `"…".slice(0, 64)` will happily
+ * cut an emoji in half and leave a lone surrogate, which renders as `�` — a
+ * clamp whose whole job is to look deliberate, producing the one character that
+ * looks like corruption. GPT Sol found it, 2026-08-27.
+ *
+ * Code points, not graphemes: a combining accent or a flag can still be split,
+ * and doing better needs `Intl.Segmenter`. Not worth a segmenter for a title
+ * that is already being cut with an ellipsis on it — but that is the next step
+ * if this ever matters.
+ *
+ * **The result can be one code point longer than `max`**, because the ellipsis
+ * is appended rather than counted. That is deliberate and it is why the two
+ * clamps are not interchangeable: `headText(t, 64)` is a promise about a
+ * length, and this is a promise about legibility.
+ */
+export function clamp(text: string, max = CLAMP): string {
+  const points = [...text];
+  if (points.length <= max) return text;
+  const cut = points.slice(0, max).join("");
+  const space = cut.lastIndexOf(" ");
+  // Only honour a space in the last third; otherwise a title whose first word
+  // is long would be clamped down to that one word.
+  const at = space > cut.length * 0.66 ? cut.slice(0, space) : cut;
+  return `${at.trimEnd()}…`;
+}
+
+/**
+ * **An article's own title, as the leading segment of a page title.**
+ *
+ * Normalise, then clamp — in that order, and the order is not cosmetic. A
+ * clamp before normalising would count invisible bidi characters and collapsing
+ * whitespace against the budget, so two titles that display identically would
+ * be cut in different places.
+ *
+ * `||` and not `??`: a title of `"   "` normalises to `""`, which is as
+ * titleless as `null`, and `Untitled · Spideryarn` is a better tab than a
+ * stranded separator. src/public/page-head.ts says `Untitled` in `og:title`
+ * for the same reason.
+ */
+export function articleTitle(title: string | null): string {
+  return clamp(normaliseText(title ?? "")) || "Untitled";
+}
+
+/**
+ * **The whole of what `<title>` says for one article** — its own title, then
+ * the app's name.
+ *
+ * This exact string is what src/public/page-head.ts writes into the served
+ * document and what src/web/page-title.ts assigns to `document.title` a moment
+ * later, so the tab does not change at mount. tests/page-head.test.ts asserts
+ * the two are character for character equal over a corpus built to break them;
+ * that test is only worth anything because both sides call *this* function
+ * rather than each restating it. A helper the tests use and the code does not
+ * is a helper that can be right while the code is wrong.
+ *
+ * **The mode is part of it**, and the default one is left out — the rule
+ * `readTitle` in src/web/page-title.ts has always followed, now applied on both
+ * sides. A reader with the same article open in three modes gets three tabs they
+ * can tell apart, and `Hierarchy` in nearly every tab would distinguish nearly
+ * nothing while costing eleven characters of a string that is already being cut.
+ * An unrecognised `?mode=` is not this function's problem: the caller resolves
+ * it to the default first, with `isMode` in src/modes.ts, exactly as `modeParam`
+ * does on the client.
+ *
+ * Not the card title: `og:title` drops the ` · Spideryarn` suffix and the mode
+ * with it. A card already carries `og:site_name`, so repeating the app name
+ * spends the visible half of the card saying one word twice — and a shared link
+ * is about the article, not about which panel the person who shared it happened
+ * to have open.
+ */
+export function documentTitle(
+  title: string | null,
+  mode: Mode = DEFAULT_MODE,
+  view: ArticleView = "article",
+): string {
+  /* **The view wins over the mode, and that is `readTitle`'s rule rather than a
+     new one**: the metadata and tweets pages are pages beside the article, and
+     the mode is a band inside the reading view that neither of them has. A
+     `/read/x?about=1&mode=glossary` becomes `x · Metadata · Spideryarn` on both
+     sides, with the mode dropped. */
+  const label =
+    view !== "article"
+      ? `${VIEW_LABEL[view]}${SEP}`
+      : mode === DEFAULT_MODE
+        ? ""
+        : `${MODE_LABEL[mode]}${SEP}`;
+  return `${articleTitle(title)}${SEP}${label}${APP_NAME}`;
+}
+
+/**
+ * The two of an article's three views that are pages beside the article rather
+ * than the article itself. Named as the Dock names them, so the tab and the
+ * button you pressed to get there agree.
+ *
+ * Beside `MODE_LABEL` and for the same reason: the server composes this title
+ * too. `/read/x?about=1` is one path segment, so it reaches the composer, and
+ * `main.tsx` then rewrites it to the metadata page — see
+ * `redirectsToMetadata` in src/read-address.ts.
+ */
+export const VIEW_LABEL: Record<Exclude<ArticleView, "article">, string> = {
+  metadata: "Metadata",
+  tweets: "Tweets",
+};
+
+/**
+ * **Which of the nine middle-band modes, by the name the Dock uses**, so that
+ * the tab and the button the reader pressed to get there say the same word.
+ *
+ * Here rather than in src/web/page-title.ts because the server composes this
+ * title too — `/read/<slug>?mode=glossary` is served with `· Glossary` already
+ * in it, and without that the tab said one thing and React said another a second
+ * later, which is the fault this whole file exists to close. GPT Sol found that
+ * one on review, 2026-08-30: the fuzz could not see it because every generated
+ * case left `mode` absent, and the missing dimension was title *state* rather
+ * than title *characters*.
+ */
+export const MODE_LABEL: Record<Mode, string> = {
+  hierarchy: "Hierarchy",
+  outline: "Outline",
+  summary: "Summary",
+  glossary: "Glossary",
+  ideas: "Ideas",
+  search: "Search",
+  diagram: "Diagram",
+  chat: "Chat",
+  review: "Review",
+};
diff --git a/src/modes.ts b/src/modes.ts
new file mode 100644
--- /dev/null
+++ b/src/modes.ts
+/**
+ * **The reader's nine middle-band modes, named once, in a module that imports
+ * nothing.**
+ *
+ * This vocabulary was in src/web/params.ts, which is where it is used and where
+ * its history is. It moved here on 2026-08-30 because a **second** reader of it
+ * appeared on the far side of the client/server line: a shared `/read/<slug>`
+ * is served by a serverless function that composes the `<title>`, and that title
+ * carries the mode. Nothing that function reaches may import anything under
+ * `src/web/` (tests/public-imports.test.ts), so the list had to come out.
+ *
+ * `params.ts` re-exports all three names, so every existing importer is
+ * unchanged and this file is not something a component needs to know about.
+ *
+ * See src/title-text.ts for the labels these get in a title, and
+ * docs/project/reading-view-overview.md for what each mode is.
+ */
+
+export const MODES = [
+  /* Renamed from `toc` on 2026-08-29, at Greg's request: the reader sees
+     "Hierarchy" and the code now says the same word. It also ends a collision
+     that had lasted as long as the list — `toc` was simultaneously this mode and
+     the *pipeline step* that builds tree.json (src/pipeline.ts § STEP_ORDER), so
+     one word meant two things in one repo. The step keeps the name; the mode
+     gives it up. docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 3. */
+  "hierarchy",
+  "chat",
+  "glossary",
+  "search",
+  "summary",
+  "diagram",
+  "ideas",
+  /* Review is the seventh, 2026-08-27, and the first mode whose content comes
+     from the reader rather than from the article: they say what they took from
+     it and the model helps them find where that comes apart. It cost this list
+     one word, like the five before it. docs/plans/260827ah-review-mode.md.
+
+     There is deliberately no `?stance=` beside `?thread=` below. The stance
+     governs the next answer and changes nothing on screen, which is the rule
+     this file keeps — the closest existing thing is chat's profile checkbox,
+     which is component state for the same reason. */
+  "review",
+  /* The eighth, 2026-08-28: the whole document as one nested list that never
+     scrolls and expands around where the reader is. It costs this list one
+     word like the six before it, and it is the first mode that is a second
+     answer to a question an existing surface already answers — the gist
+     columns' context panels — rather than a new question. That is deliberate
+     and temporary: Greg asked for it as an eighth mode "for now, so that it
+     doesn't mess with what we have, and so that I can go back and forth to
+     compare". docs/plans/260828aw-outline-mode.md § Where it sits, and what happens if
+     it wins. */
+  "outline",
+] as const;
+export type Mode = (typeof MODES)[number];
+
+/**
+ * The mode a reader lands in, named once.
+ *
+ * Two places need it — `modeParam`'s fallback below, and `withMode` in
+ * src/web/Dock.tsx, which omits the parameter when it is writing this value. A
+ * literal in both would be two copies of one decision, and the copy that drifts
+ * is the one that puts a redundant `?mode=` back into every URL.
+ */
+export const DEFAULT_MODE: Mode = "hierarchy";
+
+/**
+ * **Is this string one of the modes?** — the guard the server needs and the
+ * client already had inside `modeParam`.
+ *
+ * An unrecognised value is not an error anywhere: `modeParam` parses it to the
+ * default so that a link from a future version, or a pre-2026-08-29 `?mode=toc`
+ * link, degrades to the article rather than to an error page. The server does
+ * the same with this, which is the point of it being one function — a second
+ * spelling of "is this a mode" on the server would be a second answer, and the
+ * looser one would be the one nobody read.
+ */
+export function isMode(value: string | null | undefined): value is Mode {
+  return value !== null && value !== undefined && (MODES as readonly string[]).includes(value);
+}
diff --git a/src/read-address.ts b/src/read-address.ts
new file mode 100644
--- /dev/null
+++ b/src/read-address.ts
+/**
+ * **What a `/read/…` address asks for, decided once for both sides.**
+ *
+ * Two things read these addresses now. `src/web/main.tsx` rewrites the legacy
+ * spellings before React mounts, and the serverless function that composes a
+ * shared article's `<head>` has to know what the client is about to do — because
+ * whatever the two disagree about is a tab that changes in front of the reader,
+ * a second after the page lands. docs/project/page-titles.md has the four ways
+ * that had already happened.
+ *
+ * No imports, so the public function's closed import graph
+ * (tests/public-imports.test.ts) and the client's allowlist
+ * (tests/client-imports.test.ts) both accept it.
+ */
+
+/**
+ * The three things a `/read/<slug>` address can be showing.
+ *
+ * Defined here rather than in src/web/router.ts, which owns the routes but
+ * imports React's world. `router.ts` re-exports this name, so nothing that used
+ * it knows it moved.
+ */
+export const ARTICLE_VIEWS = ["article", "metadata", "tweets"] as const;
+export type ArticleView = (typeof ARTICLE_VIEWS)[number];
+
+/**
+ * **Will the client turn this address into the metadata page before it draws
+ * anything?**
+ *
+ * The article's details have been in three places: `?about=1` in the masthead,
+ * then `?panel=about` as a drawer, and now `/read/<slug>/metadata`. `main.tsx`
+ * rewrites either old spelling on the way in, with `history.replaceState`, so
+ * the reader never sees them.
+ *
+ * The server has to ask the same question, and the reason is exact. `/read/x`
+ * with a query is **one path segment**, so it matches vercel.json's
+ * `/read/:slug` rewrite and reaches the head composer — while `/read/x/metadata`
+ * is two segments and falls to the SPA catch-all, never composed. So
+ * `/read/x?about=1` was served with the *article's* title and then rewritten by
+ * React to `Article · Metadata · Spideryarn`. With `?mode=glossary` on it as
+ * well, the tab went from `Article · Glossary · Spideryarn` to
+ * `Article · Metadata · Spideryarn`. GPT Sol found it, 2026-08-30, after I had
+ * checked `/read/x/metadata` and concluded the view axis was safe: the direct
+ * route is safe and this legacy route into the same view is not.
+ *
+ * **`about=1` and `panel=about` only, never `about=0`.** A shut panel is not a
+ * reason to send anybody to a different page — it is stripped from the URL but
+ * it stays on the article, so the server must go on composing the article's
+ * title for it. `main.tsx` calls this function rather than keeping its own copy
+ * of the pattern, which is the whole point: a second spelling of "does this
+ * become the metadata page" is a second answer, and the looser one would be the
+ * one nobody read.
+ *
+ * Text rather than `URLSearchParams`, matching `main.tsx`: a round trip
+ * re-encodes `?cols=0,1` into something still correct and no longer readable,
+ * and this predicate must agree with the rewrite that reads the same string.
+ *
+ * @param search the query, with or without its leading `?`.
+ */
+export function redirectsToMetadata(search: string): boolean {
+  return /(^|[?&])(about=1|panel=about)($|&)/.test(search);
+}
+
+/**
+ * Which view a `/read/<slug>` address with this query will settle on.
+ *
+ * Only two of the three are reachable here. `tweets` has no query spelling and
+ * lives at `/read/<slug>/tweets`, which is two segments and so never reaches the
+ * composer at all.
+ */
+export function viewFor(search: string): ArticleView {
+  return redirectsToMetadata(search) ? "metadata" : "article";
+}
```
