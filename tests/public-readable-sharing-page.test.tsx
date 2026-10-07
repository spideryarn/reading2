/**
 * **`/features/public-readable-sharing` makes nine claims about things that
 * live outside it**, and every one of them can stop being true without anybody
 * opening the page.
 *
 * The page is written to the author of a republished article
 * (docs/project/public-readable-sharing.md). That reader cannot check anything
 * on it — they are relying on us to have — which makes a stale sentence here
 * worse than a stale sentence anywhere else on the site. So each claim is
 * pinned to the file that owns the fact:
 *
 *  1. `robots.txt` disallows crawling.
 *  2. Every response carries `X-Robots-Tag: noindex, nofollow`.
 *  3. A public article's head carries a `<link rel="canonical">`.
 *  4. The no-training commitment carries the same hedge `/privacy` gives it.
 *  5. A shared link carries the sharer's notes — it does **not** keep them private.
 *  6. We store copies of a web article's images and do not yet serve them.
 *  7. The canonical and the source line are hedged on one condition, not one each.
 *  8. `deploy.ts` re-checks `robots.txt` and nothing else.
 *  9. The allowance discount is conditional, and the free allowance is lifetime.
 *
 * **Claims 5 to 9 exist because the first draft got all five wrong**, and a
 * careful read had already passed over them (GPT Sol, 2026-09-06). Number 5 was
 * the reverse of the truth: the page assured an author that publicly visible
 * material was private. That is the argument for a test rather than for reading
 * harder — nothing about deleting a header, or turning on image serving, would
 * make somebody open this page.
 *
 * The same argument tests/privacy-page.test.ts makes about model names.
 *
 * **What this deliberately does not pin is the prose.** Those are words that
 * will be rewritten, and a test quoting them is a test somebody edits to make
 * green — the rule tests/takedown-privacy-section.test.tsx already states. What
 * is pinned is that a claim and the thing it claims about still agree.
 *
 * ## The hole this test was written around
 *
 * Searching the raw file would be silent success
 * (docs/reusable/silent-success.md): this page's own header comment quotes the
 * two claims that turned out to be **false** — zero-data-retention and the SEO
 * framing of the canonical — so a page that had started making them again would
 * pass a naive grep on the strength of the comment warning against them. The
 * comments are stripped first, and `it("is reading the prose rather than the
 * comments")` is what stops the regex quietly matching nothing and handing back
 * the whole file. GPT Sol found that hole in the privacy test; it is copied
 * here because this page has a much larger comment than that one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SHARED_BY_PRIVATE_LINK, SHARED_LINK_CARRIES, UNSHARING_COSTS_ALLOWANCE } from "../src/messages.js";
import { LEAD_IMAGE_ON_CARDS } from "../src/public/page-head.js";
import { CRAWLABLE_NOINDEX_ROBOTS_ALLOWS, NOINDEX_HEADER_SOURCE, SITE_BRAND_FILES, SITE_PAGE_ROBOTS_ALLOWS, sitemapXml } from "../src/site-pages.js";
import { CONTACT_EMAIL } from "../src/site-text.js";
import { adminOnly, parseRoute, PUBLIC_SHARING_HREF } from "../src/web/router.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * The page with its comments removed and its whitespace flattened — the prose a
 * reader actually sees, near enough.
 *
 * **The flattening is not cosmetic and was not in the first version.** JSX prose
 * is wrapped by the formatter at some column nobody chose, so a sentence in the
 * source is split by a newline and a run of indentation at an arbitrary point.
 * Four assertions here quoted a phrase that spanned a wrap and failed against a
 * page that said exactly what they were looking for — and the dangerous version
 * of that is the `not.toMatch` guards, which would have gone **green** on a page
 * that did make the claim they refuse, purely because the line broke in the
 * middle of it. That is silent success of the purest kind
 * (docs/reusable/silent-success.md): the check and the bug share a formatter.
 */
const PAGE = (() => {
  const raw = read("src/web/PublicReadableSharingPage.tsx");
  return raw
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ");
})();

const ROBOTS = read("public/robots.txt");
const VERCEL = read("vercel.json");
const PAGE_HEAD = read("src/public/page-head.ts");
const PRIVACY = read("src/web/PrivacyPage.tsx");

describe("the public-readable-sharing page", () => {
  it("is reading the prose rather than the comments", () => {
    /* The header comment names both false claims. If stripping ever stops
       working, these two are the words that would sneak back in — so their
       absence is the proof the stripper ran, and the assertion below is the
       proof it did not simply eat the file. */
    expect(PAGE).not.toMatch(/zero-data-retention/i);
    /* A phrase that exists only inside a comment. If stripping ever stops
       working this is what appears, and it appears *before* anything subtler
       does. A length comparison used to stand here and no longer means
       anything, because flattening whitespace shortens the file by itself —
       so it would have passed with every comment still in place. */
    expect(PAGE).not.toMatch(/GPT Sol/);
    expect(PAGE).not.toMatch(/docs\/plans/);
    /* And the stripper did not eat the prose along with them. */
    expect(PAGE).toMatch(/If a piece here is yours/);
    expect(PAGE.length).toBeGreaterThan(2000);
  });

  it("lives at an address built from /features", () => {
    expect(PUBLIC_SHARING_HREF).toBe("/features/public-readable-sharing");
  });

  /**
   * **The app's only nested pair, and nothing pinned it.** GPT Sol checked the
   * routing by hand and found it correct, then pointed out that "correct and
   * untested" is a property with a short life — and the point was made
   * immediately, because adding this route took `parseRoute` over Biome's
   * complexity ceiling and the fix was to rewrite its eight exact-match `if`s
   * as one ordered table (`STATIC_ROUTES`). A refactor of the route parser is
   * exactly when you want these four assertions to already exist.
   *
   * The one that matters is the third: `/features` must not swallow its child,
   * and the child must not swallow a suffix.
   */
  describe("the nested address", () => {
    it("resolves, with or without a trailing slash", () => {
      expect(parseRoute(PUBLIC_SHARING_HREF)).toEqual({ kind: "public-sharing" });
      expect(parseRoute(`${PUBLIC_SHARING_HREF}/`)).toEqual({ kind: "public-sharing" });
    });

    it("does not shadow its parent, and its parent does not shadow it", () => {
      expect(parseRoute("/features")).toEqual({ kind: "features" });
      expect(parseRoute("/features/")).toEqual({ kind: "features" });
    });

    it("claims nothing below itself", () => {
      expect(parseRoute(`${PUBLIC_SHARING_HREF}/anything`)).toEqual({ kind: "not-found" });
      expect(parseRoute("/features/something-else")).toEqual({ kind: "not-found" });
    });

    it("is not an administrator's page", () => {
      /* A page written for people with no account, so this is the one entry in
         ADMIN_ONLY where `true` would be silently catastrophic rather than
         merely wrong — it would 404 the address for exactly its audience. */
      expect(adminOnly({ kind: "public-sharing" })).toBe(false);
    });

    it("is drawn on both of App.tsx's arms", () => {
      /* Signed out for the rights-holder, signed in for the owner weighing up
         the sharing switch. A page mounted on one arm only is the failure that
         looks fine to whoever tested it. */
      const app = read("src/web/App.tsx");
      const arms = app.match(/route\.kind === "public-sharing"/g) ?? [];
      expect(arms).toHaveLength(2);
    });
  });

  it("offers the one address we publish, and no other", () => {
    expect(PAGE).toContain("CONTACT_EMAIL");
    /* A hard-coded address beside the constant is the drift this catches — the
       feedback dialog shipped exactly that once (docs/project/website-text.md). */
    expect(PAGE).not.toMatch(/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(CONTACT_EMAIL).toMatch(/@/);
  });

  /* ── the four claims about things outside the page ────────────────────── */

  /** `robots.txt` as groups of `Allow`/`Disallow` lines, comments gone. */
  const robotsGroups = (() => {
    const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
    let open: (typeof groups)[number] | null = null;
    let ruled = false;
    for (const raw of ROBOTS.split("\n")) {
      const line = raw.replace(/#.*$/, "").trim();
      const m = /^(User-agent|Allow|Disallow):\s*(.+)$/i.exec(line);
      if (!m) continue;
      const [, key = "", value = ""] = m;
      if (key.toLowerCase() === "user-agent") {
        if (open === null || ruled) {
          open = { agents: [], allow: [], disallow: [] };
          groups.push(open);
          ruled = false;
        }
        open.agents.push(value.toLowerCase());
      } else if (open !== null) {
        ruled = true;
        open[key.toLowerCase() as "allow" | "disallow"].push(value);
      }
    }
    return groups;
  })();
  const everyone = robotsGroups.find((g) => g.agents.includes("*"));
  const previews = robotsGroups.find((g) => !g.agents.includes("*"));

  /**
   * **What the page tells an author about crawlers, held to `robots.txt`.**
   *
   * Until 2026-10-05 the claim was "disallows crawling of the whole site". It
   * is now three smaller ones, and each can go stale without anybody opening
   * the page: crawlers are let in at `/read/` (so the page must say so, and say
   * why); the article's text is at an address that is still shut; and the file
   * still carries the `Disallow: /` the deploy looks for.
   */
  it("says crawlers may fetch /read/ and not the article's text, and robots.txt agrees", () => {
    expect(everyone, "robots.txt has no `*` group").toBeDefined();
    expect(everyone?.disallow).toEqual(["/"]);
    expect(everyone?.allow).toContain("/read/");
    expect(PAGE).toMatch(/lets a crawler fetch a page under.*\/read\//);
    expect(PAGE).toMatch(/to read the noindex/);
    expect(PAGE).toMatch(/a short description when we have one/);
    expect(PAGE).toMatch(/a link to your original when we can safely republish its address/);
    expect(PAGE).toMatch(/can show the title and any description we have/);
    /* The text is served under /api/public/, and nothing in the `*` group
       opens any part of /api/. */
    expect(everyone?.allow.filter((p) => p.startsWith("/api"))).toEqual([]);
    expect(PAGE).toMatch(/fetched separately, from an address.*robots\.txt.*disallows/);
    /* The claim this replaced, refused by name: it is no longer true. */
    expect(PAGE).not.toMatch(/disallows crawling of the whole site/);
    expect(PAGE).not.toMatch(/We publish no sitemap/);
  });

  /* Every `Allow` for every crawler is one of our own pages, what draws them,
     the sitemap, or `/read/`. A line that opened anything else would be a
     thing this page does not tell an author. */
  it("describes which pages we permit engines to list, without promising their indexing decisions", () => {
    expect(PAGE).toMatch(/We let search engines list our own pages, and ask them not to list shared articles/);
    expect(PAGE).not.toMatch(/Search engines may list our own pages, and only those/);
    /* Our pages, the script and stylesheet that draw them, our own icons and
       card picture, the sitemap, and `/read/`. */
    expect(everyone?.allow.slice().sort()).toEqual(
      [...SITE_PAGE_ROBOTS_ALLOWS, "/assets/", ...SITE_BRAND_FILES, "/sitemap.xml", "/read/", ...CRAWLABLE_NOINDEX_ROBOTS_ALLOWS].sort(),
    );
    expect(PAGE).toMatch(/sitemap names our own pages/);
    expect(sitemapXml()).not.toMatch(/\/read\//);
  });

  /**
   * **The page names the preview robots to authors, robot by robot and path by
   * path**, and the file can grow a name or a path without anybody opening the
   * page. Red when it does. The map is spelled out, so a robot nobody has put
   * a platform's name to fails too.
   */
  it("names every platform robots.txt lets in, and every path it lets them reach", () => {
    const PLATFORM: Record<string, string> = {
      facebookexternalhit: "Facebook",
      twitterbot: "X,",
      linkedinbot: "LinkedIn",
      whatsapp: "WhatsApp",
      telegrambot: "Telegram",
      discordbot: "Discord",
      slackbot: "Slack",
    };
    expect(previews, "robots.txt has no named group").toBeDefined();
    expect(robotsGroups).toHaveLength(2);
    for (const agent of previews?.agents ?? []) {
      const platform = PLATFORM[agent];
      expect(platform, `robots.txt names ${agent}, and this test has no platform for it`).toBeDefined();
      /* `X,` and not `X`: the page also says `X-Robots-Tag`. */
      expect(PAGE).toContain(platform);
    }
    const SAYS: Record<string, RegExp> = {
      "/read/": /are allowed at.*\/read\//,
      "/og-card.png": /picture of our own logo/,
      "/api/public/asset/": /first suitable picture in the article that we hold our own copy of, fetched from us/,
    };
    for (const allow of SITE_PAGE_ROBOTS_ALLOWS) SAYS[allow] = /and at our own pages/;
    expect(previews?.allow.length).toBeGreaterThan(0);
    for (const allowPath of previews?.allow ?? []) {
      const says = SAYS[allowPath];
      expect(says, `robots.txt allows ${allowPath} to the preview robots, and the page does not say so`).toBeDefined();
      expect(PAGE).toMatch(says as RegExp);
    }
  });

  /* The picture claim, against the code: a card's picture is ours or a copy we
     host, and the switch is still on. Turn it off and the sentence goes. */
  it("claims the preview's picture is our copy or our logo, and page-head agrees", () => {
    expect(LEAD_IMAGE_ON_CARDS).toBe(true);
    expect(PAGE).toMatch(/not from your servers/);
    expect(PAGE_HEAD).toMatch(/publicAssetPath\(head\.slug, sha256, ext\)/);
  });

  it("qualifies the picture filters and limits the preview robots' noindex to shared articles", () => {
    expect(PAGE).toMatch(/a PNG or JPEG between 20 KB and 5 MB/);
    expect(PAGE).toMatch(/Figures recovered from a PDF are not used on the card/);
    expect(PAGE).toMatch(/On shared article pages, all of them still receive the noindex header/);
    expect(PAGE).not.toMatch(/and all of them still receive the noindex header/);
  });

  it("claims a noindex header on every shared article, and vercel.json sets one", () => {
    expect(PAGE).toMatch(/Every shared article Spideryarn serves carries an.*X-Robots-Tag/);
    expect(PAGE).toMatch(/noindex/);
    /* The claim this replaced: "every response". Our own pages no longer
       carry it, so the page must not go on saying they do. */
    expect(PAGE).not.toMatch(/Every response Spideryarn serves/);
    const json = JSON.parse(VERCEL) as {
      headers?: { source: string; headers: { key: string; value: string }[] }[];
    };
    const rule = json.headers?.find((h) => h.headers.some((k) => k.key === "X-Robots-Tag"));
    expect(rule, "vercel.json no longer has a noindex header rule").toBeDefined();
    expect(rule?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex, nofollow" });
    expect(rule?.source).toBe(NOINDEX_HEADER_SOURCE);
    for (const address of ["/read/an-article", "/read/an-article/metadata", "/read/public"]) {
      expect(new RegExp(`^${rule?.source}$`).test(address), address).toBe(true);
    }
    /* And the page says the *pages* carry the matching meta, which is the half
       that survives somebody serving the app from somewhere other than Vercel. */
    expect(PAGE_HEAD).toMatch(/meta\(\s*"name",\s*"robots",\s*"noindex, nofollow"\s*\)/);
  });

  it("claims a canonical link, and page-head emits one", () => {
    expect(PAGE).toMatch(/rel="canonical"/);
    expect(PAGE_HEAD).toMatch(/rel="canonical"/);
  });

  /**
   * **The hedge is load-bearing, and the first draft only had half of it.**
   *
   * `safePublicCanonical` refuses a source URL with a query string, so both the
   * canonical tag *and* the visitor's source line are absent for exactly the
   * sites that use `?id=` addresses. The page hedged the canonical and stated
   * the source link unconditionally — the same fact hedged in one place and
   * asserted in another, which is how a page ends up half-true. GPT Sol,
   * 2026-09-06, finding 3.
   *
   * So this couples the two: if `safePublicCanonical` still refuses a query
   * string, the page has to still say so about both.
   */
  it("hedges both the canonical and the source link on the same condition", () => {
    expect(read("src/urls.ts")).toMatch(/url\.search !== ""/);
    const hedges = PAGE.match(/one we can safely republish|is one we can safely republish/g) ?? [];
    expect(hedges.length).toBeGreaterThanOrEqual(2);
    expect(PAGE).toMatch(/without a query string/);
    /* And the failure mode named, because "no line at all" is friendlier than a
       wrong one and a reader should not have to guess which they got. */
    expect(PAGE).toMatch(/no source line at all/);
    /* An upload is the separate case added by plan 261002g: there was no
       recorded address to refuse, and the public projection may carry the
       matched page as an explicit guess. */
    expect(PAGE).toMatch(/uploaded file[^.]*clearly marked guess[^.]*page that matches it/i);
  });

  /**
   * **The sentence that was the wrong way round.** The page said a sharer's
   * notes and comments "stay private to them"; `SHARED_LINK_CARRIES` says they
   * travel with the link and only conversations do not, and the public reader
   * really does select them. A page written to be trusted telling an author
   * that publicly visible material is private is the worst failure available to
   * it, so the claim is pinned to the constant that owns the fact.
   */
  /* The gist columns, and the zoom between them, were removed on 2026-09-29.
     Both sentences went on promising them (plan 261007a § K3). */
  it("promises no zoom levels, which a shared article no longer has", () => {
    expect(SHARED_LINK_CARRIES).not.toMatch(/zoom/i);
    expect(SHARED_LINK_CARRIES).toMatch(/the article, its table of contents, and the reading aids/);
    expect(PAGE).not.toMatch(/zoom/i);
    expect(PAGE).toMatch(/never a model's version of it/);
  });

  it("says a shared link carries the sharer's notes, and does not claim they are private", () => {
    expect(SHARED_LINK_CARRIES).toMatch(/marks, notes and searches/);
    expect(SHARED_LINK_CARRIES).toMatch(/conversations with the model are not part of it/i);
    expect(PAGE).toMatch(/highlights and notes/);
    expect(PAGE).toMatch(/conversations with the model are not part of it/i);
    /* The exact shape of the old mistake, refused by name. */
    expect(PAGE).not.toMatch(/notes[^.]*stay private/i);
    /* And the public reader still really does serialise them — if this stops
       being true the page becomes over-cautious rather than false, but it
       should still be re-read. */
    expect(read("src/store/public-reader.ts")).toMatch(/comments: commentRows\.map/);
  });

  /**
   * **The image sentence is the claim most likely to go stale, and it went
   * stale exactly as predicted.** Written 2026-09-06 pinning *we do not serve
   * those copies* and saying in its own comment that the assertion failing would
   * mean stage E had landed and the paragraph had to be rewritten. Stage E
   * landed on 2026-09-07 and it did fail. The tripwire worked, so it is kept —
   * re-aimed rather than deleted.
   *
   * **What it pins now is the shape of the truth rather than the state**, which
   * is what stops it going stale a second time. Three things have to agree:
   *
   *  - `rehost.ts` walks **both** collections, so the page may say the traffic
   *    has moved;
   *  - the fallback to the publisher still exists — `IMAGE_WAIT_MS` and the
   *    second draw rebuilt from the original html are what implement it — so the
   *    page **must** hedge;
   *  - the page does both: it claims the move and it names the exceptions.
   *
   * The last assertion is the one that matters most, and it is negative: the
   * page must not promise that a reader never reaches the author's servers. That
   * is the "notes stay private" mistake in a different paragraph — a sentence
   * this page's own reader cannot check, written from what feels like the point
   * of the feature rather than from what the code does.
   */
  it("describes the image state that rehost.ts is actually in", () => {
    const rehost = read("src/web/rehost.ts");
    /* Both halves are on. If this fails, somebody turned web images back off and
       the page's paragraph is now over-claiming. */
    expect(rehost).toMatch(/holds two collections and this walks both/);
    /* And the fallback is still real, which is why the page hedges. Pinned on
       the mechanism rather than the prose: the second draw is rebuilt from the
       original html, so *leave it alone* is the whole implementation. */
    expect(rehost).toMatch(/IMAGE_WAIT_MS/);
    expect(PAGE).toMatch(/serves it from us/);
    expect(PAGE).toMatch(/falls back to your URL/);
    /* The over-claim, refused by name — the shape of the older mistake. */
    expect(PAGE).not.toMatch(/never (?:asks|reaches|touches) your servers/i);
    /* And we *do* store them, which the first draft denied outright. */
    expect(PAGE).toMatch(/store its own copy/);
    expect(read("src/collect-assets.ts")).toMatch(/maxImageBytes/);
  });

  /**
   * **The deploy claim, narrowed to what the script actually does.** The first
   * draft said it checked the robots file *and* the `X-Robots-Tag` header on
   * the live site; `scripts/deploy.ts` never invokes the shell checker that
   * does the header, so only `verifyRobots` runs. GPT Sol, 2026-09-06.
   */
  it("claims only the deploy check that deploy.ts actually runs", () => {
    const deploy = read("scripts/deploy.ts");
    expect(deploy).toMatch(/async function verifyRobots/);
    expect(deploy).toMatch(/await verifyRobots\(\)/);
    /* The header check exists, in another script, and deploy does not call it —
       so the page must not credit the deploy with it. */
    expect(deploy).not.toMatch(/check-public-shell/);
    expect(PAGE).not.toMatch(/first and the last/);
    expect(PAGE).toMatch(/reports the deploy as failed/);
    expect(PAGE).toMatch(/answered successfully as plain text/);
    expect(PAGE).not.toMatch(/still carries a disallow rule/);
  });

  /**
   * **The allowance sentence repeats a mistake this repo already made once.**
   * `UNSHARING_COSTS_ALLOWANCE` was made conditional on 2026-09-05 because for
   * two owners the unconditional version was simply false — an article added
   * before billing has no ledger row. The page said it unconditionally, and
   * said *monthly* of an allowance that is a lifetime one.
   */
  it("states the allowance discount conditionally, the way the owner's copy does", () => {
    expect(UNSHARING_COSTS_ALLOWANCE).toMatch(/^If this article counts against your allowance/);
    expect(PAGE).toMatch(/[Ww]here an article counts against a reader's allowance at all/);
    expect(PAGE).not.toMatch(/monthly allowance/);
  });

  it("makes the no-training claim with the same hedge /privacy gives it", () => {
    expect(PAGE).toMatch(/nobody trains a model on it/);
    expect(PRIVACY).toMatch(/nobody trains a model on it/);
    /* The hedge, in both places and in the same words on neither — what has to
       match is that each one *has* one, because the promise rests on an account
       setting rather than on a line of code. A page that dropped it would be
       claiming more than the code can support. */
    expect(PAGE).toMatch(/commitment we hold ourselves to/);
    expect(PRIVACY).toMatch(/commitment we hold ourselves to/);
  });

  /* ── the two admissions, which are the point of the page ──────────────── */

  it("says the rights tick-box is a promise rather than a check", () => {
    expect(PAGE).toMatch(/a promise they make, not a check we run/);
    expect(PAGE).toMatch(/[Nn]obody at Spideryarn reads an article before it appears/);
  });

  it("separates what the models write from the author's quotes they choose", () => {
    expect(PAGE).toMatch(/written by a language model reading your text/);
    expect(PAGE).toMatch(/They are not your words/);
    expect(PAGE).toMatch(/The quotes are the exception: those are your own words, picked\s+out by a model/);
    /* Written as an admission that nothing beside them says so. **If a label
       ever lands in the visitor's view, this sentence has to change with it** —
       an admission left standing after the fix is a lie the other way round.
       docs/project/public-readable-sharing.md § the three awkward facts. */
    expect(PAGE).toMatch(/nothing printed beside them says so/);
  });

  it("names the two things a rights-holder would otherwise have to discover", () => {
    /* Greg, 2026-09-06, chose to name all three and asked us not to make a meal
       of it — so this checks they are present, not how much room they get. */
    expect(PAGE).toMatch(/home and features pages/);
    expect(PAGE).toMatch(/making it public halves that charge/);
  });

  it("does not claim to behave legally and ethically", () => {
    /* Nobody who is behaving legally says so; it invites "so are you?" and it
       is the sentence somebody would quote back. The facts and the offer say it
       instead. docs/plans/260906g-…§ Two of the five claims were not true. */
    expect(PAGE).not.toMatch(/legally and ethically/i);
  });

  /* ── the private link ─────────────────────────────────────────────────── */

  /**
   * **A private link is the same republishing to fewer people**, so the page
   * has to say it exists and that the offer covers it
   * (docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md).
   * Each claim is held to the code that makes it true, as the claims above are.
   */
  describe("what it says about a private link", () => {
    it("says what one is: anyone who has it can read, and can pass it on", () => {
      expect(PAGE).toMatch(/private link/);
      expect(PAGE).toMatch(/[Aa]nyone who has (that|the) link can read/);
      expect(PAGE).toMatch(/pass (it|the link) on/);
      /* And the server really does let a key in on the article route. */
      expect(read("src/store/public-access.ts")).toMatch(/or\(publicSlug\(slug\), linkSharedSlug\(slug, access\.key\)\)/);
    });

    it("says it is not listed, and the listing cannot see one", () => {
      expect(PAGE).toMatch(/not on our shelf of shared articles/);
      /* The shelf's query is built on `publicSlug`'s meaning of public and
         never on the access value a key rides in. */
      const library = read("src/store/public-library.ts");
      expect(library).not.toMatch(/from "\.\/public-access\.js"|from "\.\/link-shared-slug\.js"/);
    });

    it("says the page tells its reader it is a private link, and the notice does", () => {
      expect(PAGE).toMatch(/tells whoever opens it that it is a private link/);
      expect(SHARED_BY_PRIVATE_LINK).toMatch(/private link/i);
      expect(read("src/web/PublicChrome.tsx")).toMatch(/SHARED_BY_PRIVATE_LINK/);
    });

    it("says a pasted private link shows no preview of the piece, and the page handler sends none", () => {
      expect(PAGE).toMatch(/Pasting a link to an article shared only this way into a chat shows no title or description/);
      /* A link share is its own arm in the page handler, with no head. */
      expect(read("src/public/page.ts")).toMatch(/found\.sharedBy === "public" \? \{ kind: "found", head: found\.head \} : \{ kind: "link" \}/);
    });

    it("says it can be turned off, and the owner's route can", () => {
      expect(PAGE).toMatch(/turn (it|the link) off/);
      expect(read("src/store/pg-share-link.ts")).toMatch(/turnOff/);
    });

    it("says the same tick-box and the same record stand behind it", () => {
      expect(PAGE).toMatch(/same tick-box/);
      expect(PAGE).toMatch(/who made it and when/);
      expect(read("src/routes.ts")).toMatch(/rightsConfirmed !== true\) throw httpError\(400, "A private link needs rightsConfirmed: true"\)/);
      expect(read("src/db/schema.ts")).toContain('"article_share_link_events"');
    });

    it("extends the takedown offer to it", () => {
      expect(PAGE).toMatch(/behind (one|a private link)[^.]*write to/i);
    });

    it("does not call a private link secret or secure", () => {
      /* It is a link, and a link can be forwarded. */
      expect(PAGE).not.toMatch(/private link[^.]*\b(secret|secure|only you)\b/i);
    });
  });
});

it("qualifies Help's listing promise for an article that is only link-shared", () => {
  expect(read("src/web/help/help-topics.tsx")).toMatch(/An article shared only this way is not listed anywhere/);
});
