// @vitest-environment jsdom
/**
 * **A page draws a way home only where there is no corner logo beside it.**
 * Signed out that was a house until 2026-10-07 and is now the site bar (plan
 * 261007h, F4b); the file kept its name.
 *
 * Greg, 2026-10-04 (spya-gqj660):
 *
 * > We don't need a Home icon on /changelog, because we have the logo right next to it. Look for
 * > anywhere else that has a superfluous link back to home at the top and remove that too.
 *
 * Five pages used to carry the house: `/changelog`, `/privacy`, `/contact`,
 * `/opensource` and `/help`. Signed in, `App.tsx` draws `HomeLogo` beside each.
 * Signed out it draws none, and the site bar now provides the way home — which
 * is why this walks both, and why the signed-out half is not a formality:
 * deleting the way home would pass the first and strand a stranger
 * (GPT Sol, plan review F2).
 * docs/plans/261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md.
 *
 * The real router, for tests/dock-corner-controls.test.tsx's reason: which
 * shell a page is in is decided by where `App` mounts it, not by anything in
 * the page. The session mock is that file's, cut down.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readerCssNoComments } from "./helpers/stylesheets.js";

/** Who `useSession` says is here. Re-posed by each case before it renders. */
const session: { user: { id: string; email: string } | null; loading: boolean } = {
  user: null,
  loading: false,
};

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: session.loading, known: !session.loading }),
}));

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });

/* Dynamic, because `lib/api.ts` subscribes to auth at module load and the
   mocks above have to be in place first — tests/dock-corner-controls.test.tsx. */
const { App } = await import("../src/web/App.js");
const { Shell } = await import("../src/web/AdminPage.js");
const { navigate } = await import("../src/web/router.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.user = null;
  session.loading = false;
  /* `/profile` reads into the shape of these two; everything else here treats
     `{}` as "nothing yet". */
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const body = url === "/api/models" ? { tasks: [] } : url.startsWith("/api/library") ? [] : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** The whole app at one address, waited on until the page's heading is drawn —
 *  two of the five are lazy (LazyPage.tsx), so a fixed number of ticks is a guess. */
async function show(path: string): Promise<void> {
  history.replaceState(null, "", path);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  await vi.waitFor(
    async () => {
      await act(async () => {
        await new Promise((go) => setTimeout(go, 0));
      });
      expect(document.querySelector("main h1")).not.toBeNull();
    },
    { timeout: 10_000 },
  );
}

const DOCUMENT_PAGES = ["/changelog", "/privacy", "/contact", "/opensource", "/help"];
const houses = () => document.querySelectorAll('a[aria-label="Home"]');
const navs = () => document.querySelectorAll("nav.site-nav");

describe("the five document pages: the corner logo signed in, the site bar signed out", () => {
  it.each(DOCUMENT_PAGES)("at %s, draws no stranger's bar while the initial session is loading", async (path) => {
    session.loading = true;
    history.replaceState(null, "", path);
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, createElement(App, null)));
    });
    expect(navs()).toHaveLength(0);
    expect(document.querySelector("main")).toBeNull();
    session.loading = false;
    session.user = { id: "reader-1", email: "reader@example.com" };
    await show(path);
    expect(document.querySelector(".logo-home")).not.toBeNull();
    expect(navs()).toHaveLength(0);
  });

  it.each([false, true])("client-side moves across all five pages preserve the shell (signed in: %s)", async (signedIn) => {
    if (signedIn) session.user = { id: "reader-1", email: "reader@example.com" };
    await show("/contact");
    for (const path of DOCUMENT_PAGES) {
      const previousTitle = document.querySelector("main h1")?.textContent;
      await act(async () => navigate(path));
      await vi.waitFor(async () => {
        await act(async () => { await new Promise((go) => setTimeout(go, 0)); });
        const title = document.querySelector("main h1")?.textContent;
        expect(title).toBeTruthy();
        expect(title).not.toBe(previousTitle);
      });
      expect(location.pathname).toBe(path);
      expect(navs()).toHaveLength(signedIn ? 0 : 1);
      expect(document.querySelector(".logo-home") !== null).toBe(signedIn);
      if (!signedIn) expect(navs()[0]!.querySelector('a[href="/"]')).not.toBeNull();
    }
  });

  it.each(["/privacy", "/changelog"])("signed out at %s, keeps the notch in the bar, floor height and anchor clearance", async (path) => {
    await show(path);
    const nav = navs()[0]!;
    const scope = nav.closest(".site")!;
    /* Source/markup contract: jsdom cannot resolve env() or lay out a notch.
       Also check that the inset rule actually selects this rendered bar. */
    const css = readerCssNoComments();
    const insetRule = css.match(/([^{}]+)\{\s*padding-top:\s*var\(--safe-top\);\s*\}/g)
      ?.find((rule) => nav.matches(rule.slice(0, rule.indexOf("{")).trim()));
    expect(insetRule, "the rendered bar does not reserve the safe top inset").toBeDefined();
    expect(scope.classList.contains("tw:contents")).toBe(true);
    const main = document.querySelector("main")!;
    const height = Array.from(main.classList).find((c) => c.startsWith("tw:min-h-"));
    expect(height, "floor height must subtract the inset carried by the bar").toContain("_-_var(--safe-top)");
    const target = main.querySelector(path === "/privacy" ? "section[id]" : "details[id]");
    expect(target, "the actual page anchor must be present").not.toBeNull();
    const anchors = Array.from(main.classList).find((c) => {
      const variant = c.match(/^tw:\[(.+)\]:scroll-mt-/)?.[1];
      return variant && target!.matches(variant.replaceAll("&", "main").replaceAll("_", " "));
    });
    expect(anchors, "the actual anchor target must receive the clearance rule").toBeDefined();
    expect(anchors).toContain("_+_var(--safe-top)");
  });

  it.each(DOCUMENT_PAGES)("signed in at %s: the corner logo, and no house or site bar", async (path) => {
    session.user = { id: "reader-1", email: "reader@example.com" };
    await show(path);
    /* The control: without the logo, "no house" would be a page with no way
       home at all, and this case would call that a pass. */
    expect(document.querySelector(".logo-home"), `${path} lost its corner logo`).not.toBeNull();
    expect(houses(), `${path} drew a house beside the logo`).toHaveLength(0);
    expect(navs(), `${path} drew the site bar inside the signed-in shell`).toHaveLength(0);
  });

  /* Since 2026-10-07 (plan 261007h, F4b): signed out, these pages wear the
     bar Home, Features, Pricing and Sign-in wear, rather than a lone house.
     The bar's wordmark is the way home, so the house went with it. */
  it.each(DOCUMENT_PAGES)("signed out at %s: no corner logo, the site bar, no house", async (path) => {
    await show(path);
    expect(document.querySelector(".logo-home")).toBeNull();
    expect(navs(), `${path} left a stranger without the site bar`).toHaveLength(1);
    const nav = navs()[0]!;
    expect(nav.querySelector('a[href="/"]'), `${path}'s bar has no way home`).not.toBeNull();
    /* Outside the narrow document column, inside a `.site` token scope —
       SiteNav's colours come from `--site-*`. */
    expect(nav.closest("main"), `${path} put the bar inside <main>`).toBeNull();
    expect(nav.closest(".site"), `${path}'s bar has no .site scope`).not.toBeNull();
    expect(houses(), `${path} kept the house under the bar`).toHaveLength(0);
    /* The page under the reader's feet is not offered as somewhere else. */
    expect(nav.querySelector(`a[href="${path}"]`), `${path}'s bar links to itself`).toBeNull();
  });
});

describe("the two arrows that went to the library under the same logo", () => {
  it("signed in at /profile: the corner logo, and no arrow to the library", async () => {
    session.user = { id: "reader-1", email: "reader@example.com" };
    await show("/profile");
    expect(document.querySelector(".logo-home")).not.toBeNull();
    expect(document.querySelector('main a[aria-label="Back to your library"]')).toBeNull();
  });

  it("an admin page given no way back draws none", async () => {
    await act(async () => root.render(<Shell title="Admin">{null}</Shell>));
    expect(host.querySelector("h1")?.textContent).toBe("Admin");
    expect(host.querySelector("header a")).toBeNull();
  });

  it("an admin page given its own way back keeps it", async () => {
    await act(async () =>
      root.render(
        <Shell title="Users" back={{ href: "/admin", label: "Back to Admin" }}>
          {null}
        </Shell>,
      ),
    );
    expect(host.querySelector("header a")?.getAttribute("aria-label")).toBe("Back to Admin");
    expect(host.querySelector("header a")?.getAttribute("href")).toBe("/admin");
  });
});
