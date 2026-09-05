// @vitest-environment jsdom
/**
 * **An article that stops being public leaves no link behind.**
 *
 * That is the one property the showcase blocks on `/` and `/features` exist to
 * have, and it is the reason those blocks are fetched rather than written down
 * (src/web/PublicShowcase.tsx). Greg flips an article's visibility in the
 * production UI whenever he likes and nobody redeploys afterwards, so a
 * marketing page holding a slug in its source is a page that will one day hand a
 * stranger a 404 about an article that was never theirs to see.
 *
 * **The assertion is about the whole document, not about the block.** *"The
 * showcase no longer lists alpha"* is satisfied by a page that lists it twice
 * somewhere else — and the failure being guarded is precisely somebody adding a
 * second, hand-written link *"to make sure the good one is always there"*. So
 * every case below collects every `/read/<slug>` href on the page and asserts
 * about that set.
 *
 * ## And why the negative case is driven rather than assumed
 *
 * A test that only mounted a listing and found its articles would be green for a
 * hard-coded list too, provided the fixture happened to name the same slugs.
 * These cases therefore mount **twice**, with an article in the listing and then
 * without it, and assert the page's answer changed. That is the difference
 * between proving the links are derived and proving they exist.
 *
 * ## The three silent cases
 *
 * The block draws its heading, its sentence and the link to `/read/public`
 * before the listing is asked for, and the articles appear underneath if they
 * arrive. So a failure, an empty shelf and a 404 all have to leave a page that
 * is one link short rather than a page with an apology on it — asserted here,
 * because *"nothing appeared"* and *"an error appeared"* are indistinguishable
 * in a screenshot and the first is the one this design chose.
 */
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
/* `apiFetch` reaches for IndexedDB (the offline cache in lib/api.ts), which
   jsdom does not have — and the failure is a hang rather than a throw, so the
   symptom is every test in this file timing out with no error. Same import and
   same reason as tests/site-nav-sign-in.test.tsx. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The landing page renders `SignInControls`, which imports this and would build
   a real Supabase client. Nothing here presses anything, so the stub only has
   to exist — same shape as tests/site-nav-sign-in.test.tsx. */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "TOKEN" } } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: async () => true,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { LandingPage } = await import("../src/web/LandingPage.js");
const { FeaturesPage } = await import("../src/web/FeaturesPage.js");
const { PUBLIC_SHELF_BROWSE_LINK, PUBLIC_SHOWCASE_HEADING } = await import("../src/messages.js");
const { PUBLIC_LIBRARY_HREF } = await import("../src/web/router.js");
const { PUBLIC_SHOWCASE_MAX } = await import("../src/web/PublicShowcase.js");

/* Otherwise every `act()` here prints "the current testing environment is not
   configured to support act(...)" and React declines to flush effects inside it. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One row as `GET /api/public/library` sends it. */
function entry(slug: string, extra: Record<string, unknown> = {}) {
  return {
    slug,
    title: `The ${slug} essay`,
    byline: "A Writer",
    gist: null,
    siteName: "example.com",
    words: 1234,
    publicAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  };
}

/** Every URL the page asked for, in order. */
let asked: string[];
/** What the listing answers, swapped between mounts. */
let answer: () => Response;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.unstubAllGlobals();
  asked = [];
  answer = () => json({ entries: [], truncated: false });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    asked.push(url);
    if (url === "/api/public/library") {
      /* The one thing about *how* it is asked that this file checks. The rest of
         the anonymity promise — no header, no refresh, no retry — is
         public-api.ts's and tests/public-shelf-page.test.tsx's; this is here so
         that routing the showcase through `apiFetch` to "reuse the machinery"
         is a red test rather than a discovery a stranger makes. */
      expect(init?.credentials).toBe("omit");
      return answer();
    }
    /* Anything else these pages might do is nothing to do with this file, and a
       500 is what tests/site-nav-sign-in.test.tsx gives them. */
    return new Response("nope", { status: 500 });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  history.replaceState(null, "", "/");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Let React flush, and anything already in flight settle. */
async function settle(turns = 3): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/**
 * Mount the page **fresh**, the way a browser does on a page load.
 *
 * The root is torn down and rebuilt rather than re-rendered, and that is not
 * ceremony: the block reads the listing once per mount, so `root.render` a
 * second time reconciles the same instance, runs no effect and keeps the
 * entries the first read put there. A negative case written against a
 * re-render is green for a component that never asks again, which is the
 * opposite of what it claims to prove. (Watched, 2026-09-05: the re-render form
 * reported `['alpha','beta']` where `['beta']` was wanted.)
 *
 * The limit it leaves, said out loud rather than found: a tab left open across
 * an unshare keeps the links it already drew until it is reloaded. Every list in
 * this app has that property, `/read/public` included, and closing it would mean
 * polling a marketing page.
 */
async function show(page: ReactElement): Promise<HTMLElement> {
  act(() => root.unmount());
  host.remove();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(page);
  });
  await settle();
  return host;
}

/**
 * **Every article this page links to, anywhere in it** — not every article the
 * showcase drew.
 *
 * `/read/public` is excluded because it is the shelf rather than an article, and
 * it is the one link in the block that is meant to be constant.
 *
 * **Every `href` is resolved against the document's own origin** rather than
 * tested as a string. `startsWith("/read/")` sees a relative path and nothing
 * else, so `https://spideryarn.com/read/a-slug` — the same destination, written
 * the way somebody pasting a production URL would write it — walks past the
 * assertion this whole file exists to make. GPT Sol, 2026-09-05. Anything on
 * another origin is not one of our articles and is dropped.
 */
function articlesLinked(page: HTMLElement): string[] {
  return [...page.querySelectorAll("a")]
    .map((a) => a.getAttribute("href") ?? "")
    .filter(Boolean)
    .map((href) => {
      try {
        return new URL(href, location.origin);
      } catch {
        /* A mailto:, a bare fragment jsdom dislikes, anything unparseable — not
           an article link either way. */
        return null;
      }
    })
    .filter((url): url is URL => url !== null && url.origin === location.origin)
    .map((url) => url.pathname)
    .filter((path) => path.startsWith("/read/") && path !== PUBLIC_LIBRARY_HREF)
    .map((path) => path.slice("/read/".length));
}

/** The two pages that draw the block, mounted the way `App.tsx` mounts them. */
const PAGES: [string, () => ReactElement][] = [
  ["/", () => <LandingPage />],
  ["/features", () => <FeaturesPage signedIn={false} />],
];

describe.each(PAGES)("the showcase on %s", (path, page) => {
  /* **The address the page is actually at**, rather than `/` for both. Nothing
     in these two pages reads `location` today, but `SiteNav` and `SiteFooter`
     both choose links from where they are and could come to — and a suite that
     mounts `/features` while the bar believes it is on `/` is testing a
     combination no reader can be in. GPT Sol, 2026-09-05. */
  beforeEach(() => {
    history.replaceState(null, "", path);
  });

  it("links only to articles the listing is currently returning", async () => {
    answer = () => json({ entries: [entry("alpha"), entry("beta")], truncated: false });
    const first = await show(page());
    /* The positive control. Without it every assertion below is green on a page
       that draws no showcase at all. */
    expect(articlesLinked(first)).toEqual(["alpha", "beta"]);
    expect(first.textContent).toContain("The alpha essay");

    /* **The assertion this file is for.** Greg unshares `alpha` in the
       production UI; nothing is redeployed; the next stranger to load this page
       must not be offered it. Mounted again rather than asserted about the
       first render, because the question is what the page does with a *changed*
       answer — a hard-coded link would survive this and nothing else here would
       notice. */
    answer = () => json({ entries: [entry("beta")], truncated: false });
    const second = await show(page());
    expect(articlesLinked(second)).toEqual(["beta"]);
    expect(second.textContent).not.toContain("The alpha essay");
  });

  it("shows a few rather than the whole shelf, and always the way to the rest", async () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((s) => entry(s));
    answer = () => json({ entries: many, truncated: false });
    const shown = await show(page());
    expect(articlesLinked(shown)).toHaveLength(PUBLIC_SHOWCASE_MAX);
    /* The order is the listing's — most recently shared first — and the block
       takes the front of it rather than choosing. PublicShowcase.tsx § the
       listing cannot pick. */
    expect(articlesLinked(shown)).toEqual(["a", "b", "c"]);
    expect(shelfLink(shown)).toBeTruthy();
  });

  it("says nothing at all when the listing fails, and still points at the shelf", async () => {
    answer = () => new Response("boom", { status: 500 });
    const shown = await show(page());
    expect(articlesLinked(shown)).toEqual([]);
    /* **The failure is silent on purpose**, which is the opposite of what
       `/read/public` does with the same failure and is argued in
       PublicShowcase.tsx: there the list is the page, here it is a garnish.
       Asserted rather than left implicit, because "we couldn't read the list of
       shared articles just now" on a marketing page is exactly the well-meaning
       change this would otherwise invite. */
    expect(shown.textContent).not.toContain("couldn't read");
    expect(shown.textContent).toContain(PUBLIC_SHOWCASE_HEADING);
    expect(shelfLink(shown)?.getAttribute("href")).toBe(PUBLIC_LIBRARY_HREF);
  });

  it("survives a shelf with nothing on it", async () => {
    answer = () => json({ entries: [], truncated: false });
    const shown = await show(page());
    expect(articlesLinked(shown)).toEqual([]);
    expect(shelfLink(shown)).toBeTruthy();
  });

  it("asks the anonymous listing route once, and asks for nothing else of ours", async () => {
    answer = () => json({ entries: [entry("alpha")], truncated: false });
    await show(page());
    /* Not `toEqual(["/api/public/library"])`: these pages may legitimately ask
       for their own assets, and the property that matters is that the *only*
       API they touch is the one in the closed public namespace. A page that had
       started reading `/api/billing/usage` or `/api/library` to enrich itself
       for a signed-in reader would fail here. */
    const ours = asked.filter((url) => url.startsWith("/api/"));
    expect(ours).toEqual(["/api/public/library"]);
  });
});

/**
 * **The other half of the property, asked of the source rather than of the DOM.**
 *
 * Everything above is a rendered-DOM test, and a rendered-DOM test can only ever
 * say *this listing produced these links*. It cannot say *no slug is written down
 * anywhere*, which is the rule — and the two come apart in exactly the case
 * somebody would introduce: a hand-written link to the one good article, added
 * beside the derived list *"so that there is always something there"*, would be
 * caught above only because the fixture happens not to name that slug. GPT Sol,
 * 2026-09-05.
 *
 * So this reads the three files and refuses a literal read address in an `href`.
 * The shelf's own link is spelled `PUBLIC_LIBRARY_HREF` and the article links are
 * spelled `readHref(entry.slug)`, so neither is written as a string here today.
 *
 * **What it does not catch, said out loud:** a slug assembled at runtime —
 * `href={PREFIX + FAVOURITE}` — which is a string this pattern never sees. That
 * is what the DOM cases above are for, and the two together are the guard: one
 * refuses the literal, the other refuses anything the listing did not supply.
 */
describe("no page names an article in its source", () => {
  const FILES = [
    "src/web/PublicShowcase.tsx",
    "src/web/LandingPage.tsx",
    "src/web/FeaturesPage.tsx",
  ];

  /* A plain loop rather than `it.each`, which handed the callback `undefined`
     for a flat array of strings here and read `tests/undefined` — a case that
     fails loudly, but for the wrong reason, and would have been read as the
     guard working. */
  for (const file of FILES) {
    it(`${file} spells article destinations through readHref`, async () => {
      const { readFile } = await import("node:fs/promises");
      /* From the working directory rather than from `import.meta.url`: under the
         jsdom environment the latter resolved to `tests/undefined` here, which
         is an ENOENT that looks like a missing file rather than a broken test.
         Vitest runs with the repo root as its cwd. */
      const src = await readFile(`${process.cwd()}/${file}`, "utf8");
      /* Deliberately anchored on `href=` rather than on any occurrence of the
         path: the prose in these files talks about the read addresses
         constantly, and a guard that went red on a comment would be turned off
         within the week. */
      const literals = [...src.matchAll(/href\s*=\s*["'`]\/read\/[^"'`]*/g)].map((m) => m[0]);
      expect(literals).toEqual([]);
    });
  }
});

/** The constant link out of the block, by its own words. */
function shelfLink(page: HTMLElement): HTMLAnchorElement | null {
  return (
    [...page.querySelectorAll("a")].find((a) => a.textContent === PUBLIC_SHELF_BROWSE_LINK) ?? null
  );
}
