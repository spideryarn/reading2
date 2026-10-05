// @vitest-environment jsdom
/**
 * **A page draws the house only where there is no corner logo beside it.**
 *
 * Greg, 2026-10-04 (spya-gqj660):
 *
 * > We don't need a Home icon on /changelog, because we have the logo right next to it. Look for
 * > anywhere else that has a superfluous link back to home at the top and remove that too.
 *
 * Five pages carry the house: `/changelog`, `/privacy`, `/contact`,
 * `/opensource` and `/help`. Signed in, `App.tsx` draws `HomeLogo` beside each,
 * so the house is a second link to the same place. Signed out it draws none,
 * and the house is the only way home — which is why this walks both, and why
 * the signed-out half is not a formality: a version that simply deleted the
 * links would pass the first and strand a stranger (GPT Sol, plan review F2).
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

/** Who `useSession` says is here. Re-posed by each case before it renders. */
const session: { user: { id: string; email: string } | null } = { user: null };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: false }),
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

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.user = null;
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

const HOUSE_PAGES = ["/changelog", "/privacy", "/contact", "/opensource", "/help"];
const houses = () => document.querySelectorAll('main a[aria-label="Home"]');

describe("the five pages that carry the house", () => {
  it.each(HOUSE_PAGES)("signed in at %s: the corner logo, and no house", async (path) => {
    session.user = { id: "reader-1", email: "reader@example.com" };
    await show(path);
    /* The control: without the logo, "no house" would be a page with no way
       home at all, and this case would call that a pass. */
    expect(document.querySelector(".logo-home"), `${path} lost its corner logo`).not.toBeNull();
    expect(houses(), `${path} drew a house beside the logo`).toHaveLength(0);
  });

  it.each(HOUSE_PAGES)("signed out at %s: no corner logo, so the house", async (path) => {
    await show(path);
    expect(document.querySelector(".logo-home")).toBeNull();
    expect(houses(), `${path} left a stranger no way home`).toHaveLength(1);
    expect(houses()[0]?.getAttribute("href")).toBe("/");
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
