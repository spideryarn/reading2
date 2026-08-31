# Review: one title rule for the server and the client

**This is a re-run.** Your previous pass on this change ran out of its 45-minute budget before
writing a verdict, so no answer file was produced. Its activity log shows you had already found a
real second bug in the last minutes — the slug-fallback divergence described in § 2 below, which I
have now fixed on your finding. Thank you; please spend your budget on what is still open rather
than on re-deriving that one. **Write your verdict early and refine it**, rather than investigating
to the end and running out.

## Background

You reviewed stage 2 slice 1 of Spideryarn's public read-only work. `/read/<slug>` for a public
article is served by a serverless function that composes the `<head>` from the database, so a pasted
link previews. React then mounts and assigns `document.title` over the top of it. **Anything the two
disagree about is a tab that visibly changes in front of the reader**, a second after the page lands.

You found one such disagreement. It was pinned rather than fixed and put to Greg, who replied: *"I
don't have a view re server and client title formatting - use your judgment to pick one and be
consistent."* This change is that judgment, plus the second disagreement you found while reviewing it.

## 1. The whitespace/bidi divergence — the original finding

The server ran the title through `headText` (collapse internal whitespace, controls to a space, drop
bidi overrides); the client only trimmed the ends and clamped.

**Decision: the server's normalising wins, the client's clamp wins.** Each side keeps the rule it had
the better reason for.

- Normalising is not a preference — U+202E reverses display order, and there is no argument for the
  tab being the one place an invisible direction change survives.
- A word-boundary clamp with an `…` is what a reader wants in a tab, a bookmark and a history entry.
  The server only had the hard cut because `headText` also serves `og:title`, which keeps it: an
  ellipsis in published metadata is a claim that the title contained one.

They are one function now: `documentTitle` in the new `src/title-text.ts`, imported by both. It sits
at `src/` rather than under `src/web/` because `page-title.ts` imports React and the public
function's import graph is asserted closed against `src/web/`. `normaliseText` is split out of
`headText` so the clamp is a separate decision from the cleaning.

`og:title` / `twitter:title` keep the hard 120 clamp, no ellipsis, no ` · Spideryarn` suffix. That
divergence is between *a tab* and *a card* — different sinks, different consumers — not between two
copies of one rule.

## 2. The slug-fallback divergence — your second finding, now fixed

Your activity log ended on this:

    publicArticle({slug:'noema', title:null, ...}).meta.title  ->  "noema"
    documentTitle(null)                                        ->  "Untitled · Spideryarn"

Two different fallback chains for the same question:

    loadHead   (src/store/public-reader.ts)   title ?? headingTitle           -> then "Untitled"
    metaFrom   (src/public/dto.ts)            title ?? headingTitle ?? slug

For an article with neither a stored title nor an `<h1>`, the tab said `Untitled · Spideryarn` and
then changed to the slug. `loadHead` now falls back to the slug too.

**Nothing could have caught it**: every fixture in the suite had a title or an `<h1>`, so the
disagreement was unreachable from the corpus. There is now a fixture that has neither
(`a public article with neither a title nor an <h1>` in `tests/public-visibility-pg.test.ts`), and it
was watched failing on the real database before the fix:
`loadHead and metaFrom must agree: expected 'test-public-head-no-title', got null`.

## What I want you to attack

1. **Are there any more of these?** Two fallback chains for one question is the shape of both bugs.
   Where else does the server-composed head and the client-rendered page answer the same question by
   different routes — the description (`root_gist` vs whatever the client shows), the canonical, the
   card title? I care much more about a third instance of this class than about anything else here.
2. **Is the equality in § 1 guaranteed or merely usual?** The client reaches `documentTitle` through
   `pageTitle` → `segments` → `readTitle` → `join`, and `join` trims parts and drops empties. There is
   a seeded fuzz over 20,000 generated titles asserting no divergence, with a control requiring the
   same loop to find >1,000 divergences against the pre-fix client. Is the alphabet missing something
   that would break it in production?
3. **The `<title>` now carries an ellipsis and can be 65 code points**, where it was a hard 64.
   `og:title` is unchanged. Does that cost anything real, given `og:title` is always present? This is
   the half of the decision I am least sure of.
4. **`src/html.ts` and `src/title-text.ts` were added to the client's import allowlist.** Both are
   pure. Any bundling or boundary consequence I have not seen?
5. Anything in the moved code that changed behaviour silently — extracting `normaliseText` and
   deleting the duplicated `APP_NAME`/`SEP`/`PAGE_TITLE`/`documentTitle` from `page-head.ts` are the
   risky edits.

## Evidence

Mutations run against the new tests, each red on the assertion it is named for:

- drop `normaliseText` from `articleTitle`, so both sides drift together — caught by the spelled-out
  literals, not by the pair assertion
- put the client back to `clamp(title.trim())` — caught by the labelled client literal
- stop the client's `join()` trimming and have `readTitle` leak a trailing space, breaking only the
  wrapping — caught by the fuzz
- change `CLAMP` 64 → 60 — caught by a `check-public-shell.ts` self-test case that previously built
  its expectation from the function under test and so could not fail

`npm test`: 5941 passed, 2 failed; `npm run typecheck`: clean on all three projects. The failures are
`tests/auth-callback.test.ts` (a supabase mock missing `onAuthStateChange`, which ten other test
files mock), `tests/store-shelf-reads.test.ts` and `tests/store-jobs-parity.test.ts` — all three
verified to fail identically in a worktree at HEAD without this change.

## The diff (code and tests only; the docs changes are prose and are omitted)

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
index 989999d..03f23f4 100644
Binary files a/src/html.ts and b/src/html.ts differ
diff --git a/src/public/page-head.ts b/src/public/page-head.ts
index 5a7b82d..d45829e 100644
--- a/src/public/page-head.ts
+++ b/src/public/page-head.ts
@@ -34,6 +34,7 @@
  * `requireMarkersInHead` below now, and the build check calls the same function.
  */
 import { escapeHtml, headText } from "../html.js";
+import { APP_NAME, documentTitle } from "../title-text.js";
 import { safePublicCanonical } from "../urls.js";
 import type { PublicHead } from "../store/public-reader.js";
 
@@ -56,37 +57,32 @@ import type { PublicHead } from "../store/public-reader.js";
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
 
@@ -209,10 +205,12 @@ function requireOnce(shell: string, marker: string, at: number): void {
  * becomes markup. src/html.ts explains why those are two jobs.
  */
 function tags(head: PublicHead): string[] {
-  /* "Untitled" rather than an empty tag, matching `readTitle()` in
-     src/web/page-title.ts, so a link to an article with no title of its own
-     previews as the app does. `||` and not `??`: a title of `"   "` normalises
-     to `""`, which is as titleless as `null`. */
+  /* "Untitled" rather than an empty tag, matching `articleTitle()` in
+     src/title-text.ts. **Effectively unreachable from `loadHead`**, which falls
+     back to the slug and so always hands over a string — it is the defence for
+     the paths that compose a head without one, and for a title that normalises
+     to nothing. `||` and not `??`: a title of `"   "` normalises to `""`, which
+     is as titleless as `null`. */
   const cardTitle = headText(head.title ?? "", CARD_TITLE) || "Untitled";
   /* `head.gist` is already `root_gist` — itself the gist → summary → excerpt
      fallback from src/library-scalars.ts. When there is none, all three
@@ -266,17 +264,3 @@ function tags(head: PublicHead): string[] {
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
diff --git a/src/web/page-title.ts b/src/web/page-title.ts
index d397c8d..1c33ce8 100644
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
@@ -47,51 +58,21 @@
  * docs/project/url-state.md for the state these titles are drawn from.
  */
 import { useEffect } from "react";
+import { APP_NAME, SEP, TAGLINE, articleTitle, clamp } from "../title-text.js";
 import { DEFAULT_MODE, type Mode } from "./params.js";
 import type { AdminPage, ArticleView } from "./router.js";
 
-/** The product. `spideryarn2` is the working directory; this is the name. */
-export const APP_NAME = "Spideryarn";
-
 /**
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
+ * **The rules themselves live in src/title-text.ts**, and are re-exported here
+ * so that every existing caller of this module — nine components and
+ * tests/page-title.test.ts — keeps importing them from the place it always did.
+ *
+ * They moved because the server composes the same title before this file's
+ * React ever runs (src/public/page-head.ts), and two copies of one rule is one
+ * place for them to disagree. They did disagree, visibly, in the tab. The whole
+ * argument is in the header of src/title-text.ts.
  */
-export const SEP = " · ";
-
-/**
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
- */
-export const CLAMP = 64;
+export { APP_NAME, CLAMP, SEP, TAGLINE, clamp } from "../title-text.js";
 
 /** Which of an article's nine middle-band modes, by the name the Dock uses. */
 const MODE_LABEL: Record<Mode, string> = {
@@ -246,7 +227,7 @@ function segments(spec: TitleSpec): string[] {
  * a reader who learns the rule in one place has learned it in both.
  */
 function readTitle(spec: Extract<TitleSpec, { kind: "read" }>): string[] {
-  const title = clamp(spec.title.trim()) || "Untitled";
+  const title = articleTitle(spec.title);
   if (spec.view !== "article") return [title, VIEW_LABEL[spec.view]];
   const mode = spec.mode ?? DEFAULT_MODE;
   return mode === DEFAULT_MODE ? [title] : [title, MODE_LABEL[mode]];
@@ -257,36 +238,6 @@ function join(parts: string[]): string {
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
diff --git a/tests/client-imports.test.ts b/tests/client-imports.test.ts
index ae8017a..b6192df 100644
--- a/tests/client-imports.test.ts
+++ b/tests/client-imports.test.ts
@@ -135,6 +135,21 @@ const SHARED = new Set([
      URL left in place. One module, both callers.
      See src/assets.ts and docs/plans/260829b-hosting-the-articles-images.md. */
   "assets.js",
+  /* Escaping text into markup, and composing an article's page title. On the
+     list because they qualify — `html.js` imports nothing at all and
+     `title-text.js` imports only `html.js` — and because being on it is the
+     whole point rather than a convenience.
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
 ]);
 
 /** Every `.ts`/`.tsx` file under a directory, recursively. */
diff --git a/tests/page-head.test.ts b/tests/page-head.test.ts
index 97c8055..460f075 100644
--- a/tests/page-head.test.ts
+++ b/tests/page-head.test.ts
@@ -40,11 +40,15 @@ import { describe, expect, it } from "vitest";
 
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
+import { clamp, documentTitle } from "../src/title-text.js";
 import type { PublicHead } from "../src/store/public-reader.js";
 import { pageTitle } from "../src/web/page-title.js";
 
@@ -317,7 +321,13 @@ describe("text from a stranger, on its way into a document head", () => {
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
@@ -340,71 +350,164 @@ describe("text from a stranger, on its way into a document head", () => {
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
+    }
+  });
+
+  it("says Untitled on both sides for a title that is nothing", () => {
+    for (const title of [null, "", "   ", "\u202e", "\n\t"]) {
+      expect(documentTitle(title), `server: ${JSON.stringify(title)}`).toBe("Untitled · Spideryarn");
+      expect(
+        pageTitle({ kind: "read", title: title ?? "", view: "article" }),
+        `client: ${JSON.stringify(title)}`,
+      ).toBe("Untitled · Spideryarn");
     }
-    expect(documentTitle(null)).toBe(pageTitle({ kind: "read", title: "", view: "article" }));
-    /* And the one place they deliberately differ, written down so it is a
-       decision rather than a surprise: over 64 code points the client cuts at a
-       word boundary and adds an ellipsis, and the head does neither, because an
-       `…` in an `og:title` is a claim that the title contained one. */
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
+      "\u00a0", "\u200b", "\ufeff", "\u3000", // whitespace outside the CONTROLS class
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
+    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
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
diff --git a/tests/public-visibility-pg.test.ts b/tests/public-visibility-pg.test.ts
index 2d454eb..8e982c2 100644
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
@@ -1468,6 +1469,151 @@ when("a public article whose revision has no blocks", { timeout: 60_000 }, () =>
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
+ * that imports almost nothing, which is what this is: src/html.js and no more.
+ * tests/client-imports.test.ts lists it and checks that claim rather than
+ * trusting it.
+ *
+ * See docs/project/page-titles.md for the rules behind the composition, and
+ * docs/plans/260827ai-public-read-only-access.md § Stage 2 for the server half.
+ */
+import { normaliseText } from "./html.js";
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
+ * Not the card title: `og:title` drops the ` · Spideryarn` suffix, because a
+ * card already carries `og:site_name` and repeating it spends the visible half
+ * of the card saying one word twice.
+ */
+export function documentTitle(title: string | null): string {
+  return `${articleTitle(title)}${SEP}${APP_NAME}`;
+}
```
