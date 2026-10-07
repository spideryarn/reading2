/**
 * **Which of our pages a search engine may list, and the five places that have
 * to agree about it**: the list (src/site-pages.ts), `public/robots.txt`,
 * `vercel.json`'s header rule and rewrites, the heads the build writes, and the
 * sitemap.
 *
 * Greg, 2026-10-05: our own pages, *"yes definitely we want those to be
 * visible"*; a shared article, ever, *"no"*. A mistake in either direction is
 * silent: a page that is allowed in one file and refused in another is simply
 * never listed, and an address that should have stayed out says nothing when it
 * does not. docs/plans/261005f-link-previews-and-seo-for-shared-links.md.
 *
 * `vercel.json`'s `source` patterns are read here as plain regular expressions,
 * anchored. Whether Vercel reads the lookahead the same way is asked of a
 * deployment by scripts/check-public-shell.ts, and by nothing in this file.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buildSitePages } from "../scripts/build-site-pages.js";
import { MANAGED_HEAD_END, MANAGED_HEAD_START, OG_CARD, composeSitePage } from "../src/public/page-head.js";
import {
  CRAWLABLE_NOINDEX_ROBOTS_ALLOWS,
  NOINDEX_HEADER_SOURCE,
  SHELL_FILE,
  SITE_BRAND_FILES,
  SITE_PAGE_ROBOTS_ALLOWS,
  SITE_PAGES,
  sitePageAt,
  sitePageFile,
  sitePageUrl,
  sitemapXml,
} from "../src/site-pages.js";
import { APP_NAME } from "../src/title-text.js";
import { PUBLIC_ORIGIN } from "../src/urls.js";
import { type TitleSpec, pageTitle } from "../src/web/page-title.js";
import { parseRoute } from "../src/web/router.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

/**
 * **The allow list, written out a second time on purpose.** A page added to
 * src/site-pages.ts reddens this until somebody has looked at it here and
 * decided it is ours to list.
 */
const LISTED = [
  "/",
  "/features",
  "/features/public-readable-sharing",
  "/pricing",
  "/changelog",
  "/help",
  "/privacy",
  "/contact",
  "/opensource",
];

/**
 * **Addresses that must never be listed**: a reader's article, shelf and
 * profile, the admin pages, the API, the door, and the near-misses of each
 * listed path. The build's own files are here too, since each is reachable.
 */
const NEVER = [
  "/read/some-article",
  "/read/some-article/about",
  "/read/public",
  "/read/",
  "/profile",
  "/login",
  "/add",
  "/add/https://example.com/a",
  "/design",
  "/admin",
  "/admin/users",
  "/admin/costs",
  "/api/health",
  "/api/public/article/some-article",
  "/api/public/asset/some-article/abc.png",
  "/auth/callback",
  "/pricing/",
  "/pricing/x",
  "/pricingx",
  "/features/",
  "/features/anything-else",
  "/features/public-readable-sharing/",
  "/features/public-readable-sharing/x",
  "/help/reading",
  "/changelog/12",
  "/index.html",
  "/shell.html",
  "/_pages/pricing.html",
  "/sitemap.xml",
  "/robots.txt",
  "/og-card.png",
  "/a-page-nobody-has-written-yet",
];

describe("the list of our own pages", () => {
  it("is exactly the nine we decided on", () => {
    expect(SITE_PAGES.map((p) => p.path)).toEqual(LISTED);
  });

  it("holds no address a reader's data is drawn at", () => {
    for (const page of SITE_PAGES) {
      expect(page.path).not.toMatch(/^\/(read|api|admin|profile|add|login|design)(\/|$)/);
    }
  });

  it("names each page once, by a name that is safe in a file name", () => {
    const names = SITE_PAGES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z-]*$/);
  });

  /* The tab must not change a second after the page arrives: the server's
     `<title>` and React's are two answers to one question
     (docs/project/page-titles.md). */
  const SPEC: Record<string, TitleSpec> = {
    "/": { kind: "landing" },
    "/features": { kind: "features" },
    "/features/public-readable-sharing": { kind: "public-sharing" },
    "/pricing": { kind: "pricing" },
    "/changelog": { kind: "changelog" },
    "/help": { kind: "help" },
    "/privacy": { kind: "privacy" },
    "/contact": { kind: "contact" },
    "/opensource": { kind: "opensource" },
  };

  it.each(SITE_PAGES.map((p) => [p.path, p] as const))("%s has the title React will set", (pagePath, page) => {
    const spec = SPEC[pagePath];
    expect(spec, `no title spec for ${pagePath} in this test`).toBeDefined();
    expect(page.title).toBe(pageTitle(spec as TitleSpec));
  });

  it.each(SITE_PAGES.map((p) => p.path))("%s is a page the client draws", (pagePath) => {
    expect(parseRoute(pagePath).kind).not.toBe("not-found");
  });

  it("gives every page a description a card and a result can show whole", () => {
    for (const page of SITE_PAGES) {
      expect(page.description.length).toBeGreaterThan(40);
      expect(page.description.length).toBeLessThanOrEqual(160);
      expect(page.description).not.toMatch(/[<>"&]/);
    }
  });

  it("finds a page by its exact path and by nothing near it", () => {
    expect(sitePageAt("/pricing")?.name).toBe("pricing");
    expect(sitePageAt("/pricing/")).toBeUndefined();
    expect(sitePageAt("/read/public")).toBeUndefined();
    expect(sitePageUrl(sitePageAt("/") as never)).toBe("https://www.spideryarn.com/");
    expect(sitePageUrl(sitePageAt("/help") as never)).toBe("https://www.spideryarn.com/help");
  });
});

/* ── vercel.json ──────────────────────────────────────────────────────── */

interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
  rewrites: { source: string; destination: string }[];
}
const vercel = JSON.parse(read("vercel.json")) as VercelConfig;
const whole = (source: string): RegExp => new RegExp(`^${source}$`);

describe("vercel.json's noindex header", () => {
  const rules = vercel.headers.filter((h) => h.headers.some((k) => k.key.toLowerCase() === "x-robots-tag"));

  it("is one rule, and it says noindex, nofollow", () => {
    expect(rules).toHaveLength(1);
    expect(rules[0]?.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
  });

  it("is the rule the list generates, character for character", () => {
    expect(rules[0]?.source).toBe(NOINDEX_HEADER_SOURCE);
  });

  it.each(LISTED)("leaves %s without it", (pagePath) => {
    expect(whole(rules[0]?.source ?? "").test(pagePath)).toBe(false);
  });

  it.each(NEVER)("puts it on %s", (pagePath) => {
    expect(whole(rules[0]?.source ?? "").test(pagePath)).toBe(true);
  });

  /* It shared a rule with the robots header until 2026-10-05. Narrowing one
     must not narrow the other: a shared article's images and links must not
     learn its address from any page. tests/referrer-policy.test.ts has the
     rest. */
  it("leaves the referrer policy on every path", () => {
    const all = vercel.headers.find((h) => h.source === "/(.*)");
    expect(all?.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
  });
});

describe("vercel.json's rewrites for our own pages", () => {
  const catchAll = vercel.rewrites.findIndex((r) => r.source === "/((?!api/).*)");

  it("sends every other path to the default shell, which says noindex", () => {
    expect(catchAll).toBe(vercel.rewrites.length - 1);
    expect(vercel.rewrites[catchAll]?.destination).toBe(SHELL_FILE);
    expect(SHELL_FILE).toBe("/shell.html");
  });

  it.each(SITE_PAGES.filter((p) => p.path !== "/").map((p) => [p.path, p] as const))(
    "sends %s to its own file, ahead of the catch-all",
    (pagePath, page) => {
      const at = vercel.rewrites.findIndex((r) => r.source === pagePath);
      expect(at, `no rewrite for ${pagePath}`).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(catchAll);
      expect(vercel.rewrites[at]?.destination).toBe(sitePageFile(page));
      expect(sitePageFile(page)).toBe(`/_pages/${page.name}.html`);
      /* First match wins: nothing above it may claim the path. */
      const first = vercel.rewrites.findIndex((r) => whole(r.source.replace(/:[a-z]+/g, "[^/]+")).test(pagePath));
      expect(first).toBe(at);
    },
  );

  /* `/` is answered from the file system before a rewrite is consulted, so a
     rewrite for it would be a line that does nothing and reads as if it did. */
  it("has none for the homepage, whose head is index.html itself", () => {
    expect(vercel.rewrites.some((r) => r.source === "/")).toBe(false);
    expect(sitePageFile(sitePageAt("/") as never)).toBe("/index.html");
  });

  it("rewrites nothing to a page's file except that page's own path", () => {
    const toPages = vercel.rewrites.filter((r) => r.destination.startsWith("/_pages/"));
    expect(toPages.map((r) => r.source).sort()).toEqual(LISTED.filter((p) => p !== "/").sort());
  });
});

/* ── public/robots.txt ────────────────────────────────────────────────── */

describe("public/robots.txt", () => {
  type Group = { agents: string[]; rules: { rule: string; path: string }[] };
  const text = read("public/robots.txt");
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  {
    let open: Group | null = null;
    for (const raw of text.split("\n")) {
      const line = raw.replace(/#.*$/, "").trim();
      if (line === "") continue;
      const [key = "", ...rest] = line.split(":");
      const value = rest.join(":").trim();
      const name = key.trim().toLowerCase();
      if (name === "sitemap") {
        sitemaps.push(value);
      } else if (name === "user-agent") {
        /* Consecutive user-agent lines share one group; a rule closes it. */
        if (open === null || open.rules.length > 0) {
          open = { agents: [], rules: [] };
          groups.push(open);
        }
        open.agents.push(value);
      } else if (open !== null) {
        open.rules.push({ rule: name, path: value });
      }
    }
  }
  const groupFor = (agent: string): Group | undefined =>
    groups.find((g) => g.agents.some((a) => a.toLowerCase() === agent.toLowerCase()));

  /**
   * Two `Allow`s per listed page: the address itself (`$` ends the match, so
   * nothing under it is let in), and the address with a query string, which is
   * how a link from a newsletter arrives. `$` alone refuses that one.
   */
  const PAGE_ALLOWS = LISTED.flatMap((p) => [
    { rule: "allow", path: `${p}$` },
    { rule: "allow", path: `${p}?` },
  ]);

  it("carries the lines the list generates for our own pages", () => {
    expect(PAGE_ALLOWS.map((a) => a.path)).toEqual([...SITE_PAGE_ROBOTS_ALLOWS]);
  });

  /**
   * How Google documents a match: the longest matching rule wins, and `Allow`
   * wins a tie. `$` ends the match; there is no `*` in this file.
   */
  const mayFetch = (group: Group, target: string): boolean => {
    let best: { rule: string; length: number } | null = null;
    for (const { rule, path: pattern } of group.rules) {
      const exact = pattern.endsWith("$");
      const stem = exact ? pattern.slice(0, -1) : pattern;
      const hit = exact ? target === stem : target.startsWith(stem);
      if (!hit) continue;
      if (best === null || stem.length > best.length || (stem.length === best.length && rule === "allow")) {
        best = { rule, length: stem.length };
      }
    }
    return best === null || best.rule === "allow";
  };

  it("has no wildcard in any path, which the matcher above does not read", () => {
    for (const g of groups) for (const r of g.rules) expect(r.path).not.toContain("*");
  });

  describe("for every crawler", () => {
    const everyone = groupFor("*") as Group;

    it("allows our own pages, what draws them, the sitemap and /read/, then shuts the rest", () => {
      expect(everyone.rules).toEqual([
        ...PAGE_ALLOWS,
        { rule: "allow", path: "/assets/" },
        ...SITE_BRAND_FILES.map((file) => ({ rule: "allow", path: file })),
        { rule: "allow", path: "/sitemap.xml" },
        { rule: "allow", path: "/read/" },
        ...CRAWLABLE_NOINDEX_ROBOTS_ALLOWS.map((allow) => ({ rule: "allow", path: allow })),
        { rule: "disallow", path: "/" },
      ]);
    });

    it.each(LISTED)("lets %s be fetched, with a query string or without", (pagePath) => {
      expect(mayFetch(everyone, pagePath)).toBe(true);
      expect(mayFetch(everyone, `${pagePath}?utm_source=newsletter`)).toBe(true);
    });

    /**
     * **Let in so that its `noindex` can be read, and for no other reason.**
     * Every one of our pages links to `/login`, and a linked address a crawler
     * may not fetch can be listed as a bare URL. It is not one of our listed
     * pages: `vercel.json` puts the header on it (above, in `NEVER`), and it is
     * served the default shell, which says `noindex` too. Written out here, so
     * a second address added to that constant reddens this until somebody has
     * decided it.
     */
    it("lets /login be fetched, which is not listed and says noindex", () => {
      expect([...CRAWLABLE_NOINDEX_ROBOTS_ALLOWS]).toEqual(["/login$", "/login?", "/help/"]);
      expect(mayFetch(everyone, "/login")).toBe(true);
      expect(mayFetch(everyone, "/login?next=%2Fread%2Fx")).toBe(true);
      expect(mayFetch(everyone, "/login/x")).toBe(false);
      expect(SITE_PAGES.some((p) => p.path === "/login")).toBe(false);
      expect(NEVER).toContain("/login");
    });

    /* A search result shows a site's icon, and shows none for a site that
       refuses the fetch. Each is a real file of ours. */
    it.each([...SITE_BRAND_FILES])("lets our own %s be fetched, and it is there", (file) => {
      expect(mayFetch(everyone, file)).toBe(true);
      expect(existsSync(path.join(ROOT, "public", file.slice(1)))).toBe(true);
    });

    /* `/read/` is let in so that the `noindex` on it can be read: a Disallow
       stops the fetch and not the listing (the plan, § robots.txt). */
    /**
     * **The pages of Help, decided 2026-10-07, for `/login`'s reason.** `/help`
     * is the contents of Help and links to every page under it, so a crawler
     * finds each address; it is let in to read the `noindex` they are served
     * with (`NEVER` holds `/help/reading`, and `vercel.json`'s header covers
     * it, above). A prefix, so a page of Help added later needs no line here.
     * It lets in nothing but what is under `/help/`, and `/help` itself is let
     * in by its own two lines as a listed page. GPT Sol, plan review of
     * 261007e, R6.
     */
    it("lets a page of Help be fetched, which is not listed and says noindex", () => {
      for (const page of ["/help/spine", "/help/mode-glossary", "/help/questions", "/help/reading", "/help/spine?x=1"]) {
        expect(mayFetch(everyone, page), page).toBe(true);
      }
      expect(mayFetch(everyone, "/helpful")).toBe(false);
      expect(mayFetch(everyone, "/help")).toBe(true);
      expect(SITE_PAGES.some((p) => p.path.startsWith("/help/"))).toBe(false);
      expect(NEVER).toContain("/help/reading");
    });

    it.each(
      NEVER.filter(
        (p) => !p.startsWith("/read/") && !p.startsWith("/help/") && !["/sitemap.xml", "/og-card.png", "/login"].includes(p),
      ),
    )(
      "does not let %s be fetched",
      (pagePath) => {
        expect(mayFetch(everyone, pagePath)).toBe(false);
        expect(mayFetch(everyone, `${pagePath}?x=1`)).toBe(false);
      },
    );

    /* The shelf of shared articles is under `/read/` and is let in with it,
       for the same reason; `vercel.json` puts the noindex on it (above). */
    it("lets the shared articles' pages be fetched, the shelf of them included", () => {
      expect(mayFetch(everyone, "/read/some-article")).toBe(true);
      expect(mayFetch(everyone, "/read/public")).toBe(true);
    });

    it("keeps every API path shut, the public ones included", () => {
      expect(mayFetch(everyone, "/api/public/article/x")).toBe(false);
      expect(mayFetch(everyone, "/api/public/asset/x/abc.png")).toBe(false);
      expect(mayFetch(everyone, "/api/public/library")).toBe(false);
    });
  });

  /* None of these is a search engine, and a search engine's name here is what
     this must refuse: a named group inherits nothing from `*`. */
  const PREVIEW_BOTS = [
    "facebookexternalhit",
    "Twitterbot",
    "LinkedInBot",
    "WhatsApp",
    "TelegramBot",
    "Discordbot",
    "Slackbot",
  ];

  it("names exactly the preview bots and no others", () => {
    const namedAgents = groups.flatMap((g) => g.agents).filter((a) => a !== "*");
    expect(namedAgents.sort()).toEqual([...PREVIEW_BOTS].sort());
  });

  it.each(PREVIEW_BOTS)("lets %s reach a card's page and a card's picture, and nothing else", (agent) => {
    const group = groupFor(agent);
    expect(group?.rules).toEqual([
      ...PAGE_ALLOWS,
      { rule: "allow", path: "/read/" },
      { rule: "allow", path: OG_CARD.path },
      { rule: "allow", path: "/api/public/asset/" },
      { rule: "disallow", path: "/" },
    ]);
    expect(mayFetch(group as Group, "/api/public/article/x")).toBe(false);
    expect(mayFetch(group as Group, "/profile")).toBe(false);
  });

  it("points at the sitemap, by its whole address", () => {
    expect(sitemaps).toEqual([`${PUBLIC_ORIGIN}/sitemap.xml`]);
  });
});

/* ── the heads ────────────────────────────────────────────────────────── */

const SHELL = read("index.html");
const dom = (html: string): Document => new JSDOM(html).window.document;
const content = (doc: Document, selector: string): string | null =>
  doc.querySelector(selector)?.getAttribute("content") ?? null;

describe("a page's own head", () => {
  it.each(SITE_PAGES.map((p) => [p.path, p] as const))("%s says what it is and where it is", (_path, page) => {
    const doc = dom(composeSitePage(SHELL, page));
    const url = sitePageUrl(page);
    expect(doc.title).toBe(page.title);
    expect(content(doc, 'meta[name="description"]')).toBe(page.description);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(url);
    expect(content(doc, 'meta[property="og:url"]')).toBe(url);
    expect(content(doc, 'meta[property="og:title"]')).toBe(page.title);
    expect(content(doc, 'meta[name="twitter:title"]')).toBe(page.title);
    expect(content(doc, 'meta[property="og:description"]')).toBe(page.description);
    expect(content(doc, 'meta[name="twitter:description"]')).toBe(page.description);
    expect(content(doc, 'meta[property="og:type"]')).toBe("website");
    expect(content(doc, 'meta[property="og:site_name"]')).toBe(APP_NAME);
    expect(content(doc, 'meta[property="og:image"]')).toBe(OG_CARD.url);
    expect(content(doc, 'meta[name="twitter:image"]')).toBe(OG_CARD.url);
    expect(content(doc, 'meta[name="twitter:card"]')).toBe("summary_large_image");
  });

  /* The whole point: the default head's `noindex` is the one tag that must not
     come along. One of each of the rest, or a card draws from the wrong one. */
  it.each(SITE_PAGES.map((p) => [p.path, p] as const))("%s carries no robots tag, and one of each other", (_path, page) => {
    const html = composeSitePage(SHELL, page);
    const doc = dom(html);
    expect(doc.querySelector('meta[name="robots"]')).toBeNull();
    /* An attribute, not the word: the shell's comments say it several times. */
    expect(html).not.toMatch(/content="[^"]*noindex/i);
    for (const selector of [
      "title",
      'meta[name="description"]',
      'link[rel="canonical"]',
      'meta[property="og:url"]',
      'meta[property="og:title"]',
      'meta[property="og:image"]',
      'meta[name="twitter:card"]',
    ]) {
      expect(doc.querySelectorAll(selector), selector).toHaveLength(1);
    }
  });

  it("changes nothing outside the managed region", () => {
    const page = sitePageAt("/pricing") as never;
    const html = composeSitePage(SHELL, page);
    const before = SHELL.indexOf(MANAGED_HEAD_START);
    const after = SHELL.indexOf(MANAGED_HEAD_END) + MANAGED_HEAD_END.length;
    expect(html.startsWith(SHELL.slice(0, before))).toBe(true);
    expect(html.endsWith(SHELL.slice(after))).toBe(true);
    /* And the result is a shell `composeShell` can still read: both sentinels,
       once each. */
    expect(html.split(MANAGED_HEAD_START)).toHaveLength(2);
    expect(html.split(MANAGED_HEAD_END)).toHaveLength(2);
  });

  /* `serverComposedHead` (src/web/page-title.ts) takes an `og:url` ending
     `/read/<slug>` to mean the server composed a head for that article. */
  it("has an og:url the client cannot mistake for an article's", () => {
    for (const page of SITE_PAGES) expect(sitePageUrl(page)).not.toMatch(/\/read\//);
  });

  it("escapes what it writes", () => {
    const html = composeSitePage(SHELL, {
      path: "/x",
      name: "x",
      title: 'A "title" <b>&',
      description: "A <script> & a \"quote\"",
    });
    expect(html).toContain("<title>A &quot;title&quot; &lt;b&gt;&amp;</title>");
    expect(html).not.toContain("<script> &");
  });
});

describe("the default head, which every other path is served", () => {
  it("still tells crawlers to stay away, and names no address", () => {
    const doc = dom(SHELL);
    expect(content(doc, 'meta[name="robots"]')).toBe("noindex, nofollow");
    expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
    expect(doc.querySelector('meta[property="og:url"]')).toBeNull();
  });
});

/* ── the sitemap ──────────────────────────────────────────────────────── */

describe("sitemap.xml", () => {
  it("lists exactly our own pages, by their whole addresses", () => {
    const locs = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(LISTED.map((p) => `https://www.spideryarn.com${p}`));
  });

  it("is a sitemap and names no article", () => {
    const xml = sitemapXml();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(xml).not.toMatch(/\/read\/|\/api\//);
  });

  it("is not a file in public/, where a second copy could drift", () => {
    expect(existsSync(path.join(ROOT, "public", "sitemap.xml"))).toBe(false);
  });
});

/* ── the build step ───────────────────────────────────────────────────── */

describe("build-site-pages, over a built shell", () => {
  /** A stand-in for what Vite writes: the source shell with a built entry point. */
  const BUILT = SHELL.replace('src="/src/web/boot.tsx"', 'src="/assets/boot-abc123.js"');

  const build = (): string => {
    const dist = mkdtempSync(path.join(tmpdir(), "site-pages-"));
    writeFileSync(path.join(dist, "index.html"), BUILT);
    buildSitePages(dist);
    return dist;
  };

  it("keeps the shell Vite built, byte for byte, as shell.html", () => {
    const dist = build();
    expect(readFileSync(path.join(dist, "shell.html"), "utf8")).toBe(BUILT);
  });

  it("writes the homepage's head into index.html", () => {
    const dist = build();
    const doc = dom(readFileSync(path.join(dist, "index.html"), "utf8"));
    expect(doc.title).toBe(sitePageAt("/")?.title);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://www.spideryarn.com/");
    expect(doc.querySelector('meta[name="robots"]')).toBeNull();
    expect(doc.querySelector('script[src="/assets/boot-abc123.js"]')).not.toBeNull();
  });

  it("writes one file per other page, and no more", () => {
    const dist = build();
    const files = readdirSync(path.join(dist, "_pages")).sort();
    expect(files).toEqual(
      SITE_PAGES.filter((p) => p.path !== "/")
        .map((p) => `${p.name}.html`)
        .sort(),
    );
    for (const page of SITE_PAGES.filter((p) => p.path !== "/")) {
      const html = readFileSync(path.join(dist, sitePageFile(page)), "utf8");
      expect(dom(html).title).toBe(page.title);
      expect(html).toBe(composeSitePage(BUILT, page));
    }
  });

  it("writes the sitemap", () => {
    const dist = build();
    expect(readFileSync(path.join(dist, "sitemap.xml"), "utf8")).toBe(sitemapXml());
  });

  /* Run twice, the second run would read the homepage's head as "the shell"
     and write it to shell.html: every app path would lose its noindex, with
     nothing red. */
  it("refuses to run twice over one build", () => {
    const dist = build();
    expect(() => buildSitePages(dist)).toThrow(/already/i);
  });

  it("refuses a shell whose default head has lost its noindex", () => {
    const dist = mkdtempSync(path.join(tmpdir(), "site-pages-"));
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, "index.html"), BUILT.replace('<meta name="robots" content="noindex, nofollow" />', ""));
    expect(() => buildSitePages(dist)).toThrow(/noindex/);
  });
});
