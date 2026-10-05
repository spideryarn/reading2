/**
 * **Spideryarn's own pages: the ones a search engine may list**, and the whole
 * of the allow list.
 *
 * Greg, 2026-10-05, on letting search engines list our own pages: *"yes
 * definitely we want those to be visible"*. And on a shared article ever being
 * listed: *"no"*. So this is a list of pages we wrote, and nobody's article, shelf,
 * profile, admin page or API path is on it.
 * docs/plans/261005f-link-previews-and-seo-for-shared-links.md § Stage 2.
 *
 * ## Everything else follows this list
 *
 * - `scripts/build-site-pages.ts` writes one head per page into the build, and
 *   the sitemap.
 * - `vercel.json` puts `X-Robots-Tag: noindex` on every path that is **not**
 *   here (`NOINDEX_HEADER_SOURCE`), and rewrites each path that is to its file.
 * - `public/robots.txt` allows each path, to search engines and to the preview
 *   robots.
 * - `scripts/check-public-shell.ts` asks a deployment about each one.
 *
 * `vercel.json` and `robots.txt` cannot import, so tests/site-pages.test.ts
 * holds both to this file. A page added here and nowhere else is a red test,
 * not a page that is listed in one place and refused in another.
 *
 * ## Adding a page
 *
 * A line here, an `Allow:` in each group of `robots.txt`, a rewrite in
 * `vercel.json` and the new `NOINDEX_HEADER_SOURCE` there. The test names each
 * one you missed. **Never an address a reader's data is drawn at.**
 *
 * Pure: no I/O, no `process.env`. The build script, the deploy check and the
 * tests all import it.
 */
import { APP_NAME, SEP, TAGLINE } from "./title-text.js";
import { PUBLIC_ORIGIN } from "./urls.js";

export interface SitePage {
  /** The address, exactly: no trailing slash, no query. `/` is the homepage. */
  path: string;
  /** The built file is `/_pages/<name>.html`; the homepage's is `/index.html`. */
  name: string;
  /**
   * The tab's title, which is **the string React sets a moment later**
   * (`pageTitle` in src/web/page-title.ts). tests/site-pages.test.ts holds the
   * two equal, page by page, so the tab does not change under the reader.
   */
  title: string;
  /**
   * One or two sentences, **taken from the page's own opening** and not
   * written for a search engine: docs/project/marketing-pages.md § The copy is
   * not yours to write.
   */
  description: string;
}

const named = (what: string): string => `${what}${SEP}${APP_NAME}`;

export const SITE_PAGES: readonly SitePage[] = [
  {
    path: "/",
    name: "home",
    title: `${APP_NAME}${SEP}${TAGLINE}`,
    /* LandingPage.tsx's lede, Greg's, 2026-09-03. */
    description:
      "A companion, not a replacement: it highlights, annotates, orients and explains, but keeps you in the text itself.",
  },
  {
    path: "/features",
    name: "features",
    title: named("Features"),
    /* FeaturesPage.tsx's heading and lede. */
    description:
      "What Spideryarn Reading does: it highlights, annotates, orients and explains, but keeps you in the text itself.",
  },
  {
    path: "/features/public-readable-sharing",
    name: "public-readable-sharing",
    title: named("Sharing an article publicly"),
    /* PublicReadableSharingPage.tsx's lede. */
    description:
      "What happens when somebody makes an article public here, and what to do if the article is yours.",
  },
  {
    path: "/pricing",
    name: "pricing",
    title: named("Pricing"),
    /* PricingPage.tsx's lede. */
    description:
      "A plan is a fixed price each month, and what differs is how many articles you can add. Everything you then do with one is included.",
  },
  {
    path: "/changelog",
    name: "changelog",
    title: named("What’s new"),
    /* ChangelogPage.tsx's opening line. */
    description: "Every update to Spideryarn since it launched, newest first.",
  },
  {
    path: "/help",
    name: "help",
    title: named("Help"),
    /* help/HelpPage.tsx's opening line. */
    description: "How to get the most out of Spideryarn, and how to read what it shows you.",
  },
  {
    path: "/privacy",
    name: "privacy",
    title: named("Privacy"),
    /* PrivacyPage.tsx's summary box, its first sentence. */
    description:
      "We keep your account, the articles you add and everything you write about them, so that we can show it back to you.",
  },
  {
    path: "/contact",
    name: "contact",
    title: named("Contact"),
    /* ContactPage.tsx's first sentence. */
    description: "Spideryarn is in beta, and we would really love your feedback or suggestions.",
  },
  {
    path: "/opensource",
    name: "opensource",
    title: named("Open source"),
    /* OpenSourcePage.tsx's first sentence. */
    description: "Spideryarn is built in the open. All of the code behind this site is public.",
  },
];

/** The page at exactly this path, or `undefined`. No normalising: `/pricing/` is not `/pricing`. */
export function sitePageAt(path: string): SitePage | undefined {
  return SITE_PAGES.find((p) => p.path === path);
}

/** The address we publish for a page: its canonical, its `og:url`, its line in the sitemap. */
export function sitePageUrl(page: SitePage): string {
  return `${PUBLIC_ORIGIN}${page.path}`;
}

/**
 * Where the build writes a page's HTML, as a path under `dist/`.
 *
 * **The homepage is `index.html`** because `/` is answered from the file system
 * before any rewrite is consulted, so its head has to be in that file. Every
 * other page is reached by a rewrite in `vercel.json`.
 */
export function sitePageFile(page: SitePage): string {
  return page.path === "/" ? "/index.html" : `/_pages/${page.name}.html`;
}

/**
 * **The default shell's address in the build**: the head that says
 * `noindex, nofollow`, served at every path that is not on the list and
 * compiled into the function that answers `/read/<slug>`.
 *
 * It was `/index.html` until 2026-10-05, when that file became the homepage's.
 */
export const SHELL_FILE = "/shell.html";

/**
 * **The `source` of the one `vercel.json` header rule that says `noindex`**:
 * every path except the ones on the list.
 *
 * A negative lookahead, in the wrapped form Vercel documents for a `source`.
 * Each path is matched whole (`$`), so `/pricing/x` and `/pricingx` are not
 * `/pricing` and keep the header. **A new address is `noindex` until somebody
 * lists it**, which is the direction this has to fail in.
 *
 * Generated so that tests/site-pages.test.ts can hold `vercel.json` to the
 * exact string as well as to what it matches.
 */
export const NOINDEX_HEADER_SOURCE = `/((?!(?:${SITE_PAGES.map((p) => p.path.slice(1))
  .filter((p) => p !== "")
  .join("|")})?$).*)`;

/**
 * **The `Allow:` lines `robots.txt` carries for our own pages**, two per page:
 * the address itself, and the address with a query string.
 *
 * `$` ends a match in `robots.txt`, so `/pricing$` is that page and nothing
 * under it. But the match is against the path **and the query**, so
 * `/pricing$` alone refuses `/pricing?utm_source=x`, which is the form a link
 * to us from a newsletter takes. `/pricing?` lets those in and still nothing
 * under the page. The canonical in each head names the address without the
 * query, so a search engine files both under one. GPT Sol, plan review,
 * 2026-10-05.
 *
 * A trailing slash (`/pricing/`) is let in by neither, and is served the
 * default shell, which says `noindex`.
 */
export const SITE_PAGE_ROBOTS_ALLOWS: readonly string[] = SITE_PAGES.flatMap((p) => [`${p.path}$`, `${p.path}?`]);

/**
 * **Pages a crawler may fetch and must not list**: `Allow:` lines in
 * `robots.txt` for addresses that are **not** on the list above.
 *
 * A `Disallow` stops a crawler fetching a page; it does not stop the address
 * being listed, as a bare URL, once something links to it. What stops that is
 * the `noindex` on the page, and a crawler has to be let in to read it. Our
 * own pages link to `/login` from every header, so it is let in for the same
 * reason `/read/` is. It is served the default shell, and `vercel.json` puts
 * the `noindex` header on it. GPT Sol, code review, 2026-10-05.
 *
 * `/profile`, the admin pages and the API are linked from no page a crawler
 * can reach, and stay shut.
 */
export const CRAWLABLE_NOINDEX_ROBOTS_ALLOWS: readonly string[] = ["/login$", "/login?"];

/**
 * **Our own pictures a search result may show beside one of our pages**: the
 * icons the shell's head names, and the card image. Allowed to every crawler
 * in `robots.txt`, because a search engine fetches a favicon like any other
 * file and shows none for a site that refuses it.
 */
export const SITE_BRAND_FILES: readonly string[] = [
  "/favicon.ico",
  "/favicon-32x32.png",
  "/favicon-16x16.png",
  "/apple-touch-icon.png",
  "/og-card.png",
];

/** `sitemap.xml`: the list, and nothing else. No `lastmod`: we have no honest one. */
export function sitemapXml(): string {
  const urls = SITE_PAGES.map((p) => `  <url><loc>${sitePageUrl(p)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
