/**
 * **What a shared link looks like when somebody pastes it** — one pure
 * function that swaps a document's managed head for one about this article.
 *
 * Until this landed, every `/read/<slug>` was rewritten to the same static
 * `index.html`, whose `<title>` is the bare word *Spideryarn*, and every page
 * title in the app was set by React after mount (src/web/page-title.ts). No
 * unfurler runs our JavaScript, so **every link anybody shared previewed as
 * nothing**. docs/plans/260827ai-public-read-only-access.md § Stage 2, and the design is
 * docs/plans/260828ao-public-read-only-stage2-input-sol.md § 4.
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
 *
 * That last sentence used to be the *only* thing standing between this function
 * and the body, which GPT Sol found on review: uniqueness and order were
 * checked, position was not, so a shell whose end sentinel had drifted below
 * `<body>` would have had its body silently deleted by the replacement. It is
 * `requireMarkersInHead` below now, and the build check calls the same function.
 */
import { escapeHtml, headText } from "../html.js";
import { DEFAULT_MODE, type Mode } from "../modes.js";
import type { ArticleView } from "../read-address.js";
import { APP_NAME, documentTitle } from "../title-text.js";
import { articleUrl, safePublicCanonical } from "../urls.js";
import type { PublicHead } from "../store/public-reader.js";

/* `PUBLIC_ORIGIN` was defined here, with the argument for why it is a constant
   rather than a `Host` header. Both are in src/urls.ts since 2026-09-02, when
   the export bundle became the second caller and a store file had no business
   importing a page renderer to get an address. `articleUrl` composes it. */


/**
 * **The `<title>` and the `og:title` are two different strings, on purpose.**
 *
 * `documentTitle` — imported, not restated — is the tab: the article's title,
 * normalised, clamped at a word boundary with an ellipsis, then ` · Spideryarn`.
 * src/web/page-title.ts assigns that exact string when React mounts a moment
 * later, so the tab does not change under the reader; src/title-text.ts is where
 * both halves come from and why each rule went the way it did.
 *
 * `og:title` below is composed here instead, with `headText` at a larger limit
 * and no suffix. A card is a different sink from a tab: it already carries
 * `og:site_name`, so repeating the app's name spends the visible half of it
 * saying one word twice, and an `…` in published metadata is a claim that the
 * title contained one.
 */

/**
 * The two clamps this file owns, in code points, from the design § 6.
 *
 * They differ because the sinks differ: a link card shows the `og:` pair, and a
 * card's description gets a paragraph's worth. `headText` does the clamping —
 * see src/html.ts for why it is by code point rather than by `.length`.
 *
 * The page title's clamp is not here: it is `CLAMP` in src/title-text.ts,
 * applied by the `documentTitle` this file calls, because the client applies the
 * same one to the same string.
 */
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
export function composeShell(
  shell: string,
  head: PublicHead | null,
  mode: Mode = DEFAULT_MODE,
  view: ArticleView = "article",
): string {
  const start = shell.indexOf(MANAGED_HEAD_START);
  const end = shell.indexOf(MANAGED_HEAD_END);
  requireOnce(shell, MANAGED_HEAD_START, start);
  requireOnce(shell, MANAGED_HEAD_END, end);
  if (start > end) {
    throw new Error("Client shell: the managed-head end sentinel comes before the start.");
  }
  /* **Before the `head === null` return, not after it.** A shell whose markers
     straddle the body is a broken build, and it is broken whether or not this
     particular request happens to have an article to compose. Returning it
     untouched for the default-head cases would leave the one caller that most
     needs the alarm — every 404, 400 and 503 — silently accepting it. */
  requireMarkersInHead(shell, start, end);
  if (head === null) return shell;

  /* Purely cosmetic: match whatever this shell indents its head tags by, so the
     served HTML reads like the file it came from. Falls back to a bare newline
     if the sentinel is not the first thing on its line. */
  const lineStart = shell.lastIndexOf("\n", start) + 1;
  const indent = shell.slice(lineStart, start);
  const gap = /^[ \t]*$/.test(indent) ? `\n${indent}` : "\n";

  return (
    shell.slice(0, start) + tags(head, mode, view).join(gap) + shell.slice(end + MANAGED_HEAD_END.length)
  );
}

/**
 * **Both sentinels are in the `<head>`**, which is the invariant this file's
 * header claims and which uniqueness and ordering do not give you.
 *
 * `composeShell` replaces everything from the first byte of the start marker to
 * the last byte of the end marker. Uniqueness says there is one of each and the
 * order check says they are the right way round, and a shell whose end marker
 * had drifted to `<body><!-- …:end -->` satisfies both while the replacement
 * eats the opening of the body. The claim being made is about *position*, so
 * position is what has to be checked.
 *
 * `<body` rather than `<body>`, because `<body class="…">` is the same body.
 * A shell with no body tag at all is refused too: this function's guarantee is
 * "everything from `<body` onward is untouched", and there is no way to keep a
 * promise about a landmark that is not there — a document with no body is not a
 * client shell, whatever else it is.
 *
 * Exported so scripts/client-shell.ts can make the same assertion at build
 * time, over the same string, from the same code. Two copies of a positional
 * rule is how one of them ends up checking something slightly different, which
 * is the argument `MANAGED_HEAD_START` above already makes about the markers.
 */
export function requireMarkersInHead(shell: string, start: number, end: number): void {
  const body = shell.indexOf("<body");
  if (body === -1) {
    throw new Error(
      "Client shell: no <body tag, so there is no head/body boundary to keep the managed head " +
        "above. src/public/page-head.ts replaces the region between the sentinels and promises to " +
        "touch nothing from <body onward.",
    );
  }
  for (const [name, at] of [
    ["start", start],
    ["end", end],
  ] as const) {
    if (at > body) {
      throw new Error(
        `Client shell: the managed-head ${name} sentinel is at ${at}, below the <body at ${body}. ` +
          "Both sentinels must be inside the <head>, or replacing between them deletes body bytes.",
      );
    }
  }
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
function tags(head: PublicHead, mode: Mode, view: ArticleView): string[] {
  /* "Untitled" rather than an empty tag, matching `articleTitle()` in
     src/title-text.ts. **Effectively unreachable from `loadHead`**, which falls
     back to the slug and so always hands over a string — it is the defence for
     the paths that compose a head without one, and for a title that normalises
     to nothing. `||` and not `??`: a title of `"   "` normalises to `""`, which
     is as titleless as `null`. */
  const cardTitle = headText(head.title ?? "", CARD_TITLE) || "Untitled";
  /* `head.gist` is already `root_gist` — itself the gist → summary → excerpt
     fallback from src/library-scalars.ts. When there is none, all three
     description tags are omitted rather than filled with the app's strapline: a
     strapline is not a description of this article, and three tags saying the
     wrong thing is worse than none. */
  const description = head.gist === null ? "" : headText(head.gist, DESCRIPTION);

  const out = [MANAGED_HEAD_START, `<title>${escapeHtml(documentTitle(head.title, mode, view))}</title>`];
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
  out.push(meta("property", "og:url", articleUrl(head.slug)));
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
