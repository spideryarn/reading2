// @vitest-environment jsdom
/**
 * **The top bar's *Sign in* link goes somewhere, on every page that draws it and
 * for every reader who might be looking at it.**
 *
 * `SiteNav` (src/web/SiteBits.tsx) chose the destination from `here` alone —
 * `#sign-in` on `/` and `/pricing`, `/#sign-in` from `/features`. That is right
 * for a stranger and wrong for everybody else, because two of those three pages
 * are mounted signed in as well (App.tsx):
 *
 * - signed-in `/pricing` drew `#sign-in`, and that anchor lives inside
 *   `PlansForAStranger`, which is exactly the half that is not rendered;
 * - signed-in `/features` drew `/#sign-in`, and `/` is the shelf once you are
 *   signed in, which has no such panel. **That half predates the stage that
 *   surfaced it** — it has been dead since `/features` was written.
 *
 * GPT Sol reproduced the first of those in a mounted test
 * (docs/plans/260904b-stage2-code-review-sol.md, finding 1) and this file is
 * that reproduction kept. It went red on both signed-in cases before the fix.
 *
 * ## Why it mounts the pages rather than `SiteNav`
 *
 * A test of the component alone would pass with `signedIn` hard-coded `false`
 * in every caller, which is the whole bug. What has to hold is that each page
 * *tells* the bar which reader it is drawing for, and only mounting the page
 * asks that question.
 *
 * ## And why the assertion is about the anchor, not about the word
 *
 * The positive cases resolve the fragment against the document. "There is a
 * link saying Sign in" is satisfied by a link to nothing, which is the failure
 * being guarded — this repo has shipped a link that visibly does nothing twice
 * on these pages, and both times every visible assertion stayed green.
 */
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
/* `apiFetch` reaches for IndexedDB (lib/api.ts's offline cache), which jsdom
   does not have, and the failure is a hang rather than a throw — so without
   this the signed-in pricing case times out with no error. Same import and same
   reason as tests/pricing-page-current-plan.test.tsx. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The auth module is replaced wholesale: `SignInControls` imports it, and the
   real one would build a Supabase client. Nothing here presses anything, so the
   stub only has to exist. */
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

const { PricingPage } = await import("../src/web/PricingPage.js");
const { FeaturesPage } = await import("../src/web/FeaturesPage.js");
const { PublicLibraryPage } = await import("../src/web/PublicLibraryPage.js");

/* Otherwise every `act()` here prints "the current testing environment is not
   configured to support act(...)" and React declines to flush effects inside
   it — the same line a dozen other component suites here carry. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A real reader id, so the signed-in pages take the branch they take live. */
const ALICE = "aaaaaaaa-2222-4000-8000-000000000001";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.unstubAllGlobals();
  /* The signed-in pricing page reads `/api/billing/usage` on mount. What it
     gets back does not matter here — the bar is drawn from the prop, not from
     the summary — but an unstubbed `fetch` in jsdom is a real request. */
  vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* `useBilling` reads `?checkout=` on mount and rewrites the address; a query
     string left behind by another test would send it down a different path. */
  history.replaceState(null, "", "/pricing");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Let React flush, and anything already in flight settle. */
async function settle(turns = 3): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function show(page: ReactElement): Promise<HTMLElement> {
  await act(async () => {
    root.render(page);
  });
  await settle();
  return host;
}

/** The bar's own *Sign in* control, or `null` where there is none. */
function signIn(page: HTMLElement): HTMLAnchorElement | null {
  return [...page.querySelectorAll("a")].find((a) => a.textContent === "Sign in") ?? null;
}

/**
 * Every `href="#…"` on the page whose target is not in the document.
 *
 * The general form of the defect, so a *different* dead fragment introduced
 * later is caught by the same assertion rather than needing its own.
 */
function deadFragments(page: HTMLElement): string[] {
  /* Collected rather than looked up with a selector: jsdom here has no
     `CSS.escape`, and an unescaped `#…` selector would throw on the first id
     with a dot in it rather than answering the question. */
  const present = new Set([...page.querySelectorAll("[id]")].map((el) => el.id));
  return [...page.querySelectorAll("a")]
    .map((a) => a.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("#") && href.length > 1)
    .filter((href) => !present.has(href.slice(1)));
}

describe("/pricing", () => {
  it("offers a stranger a sign-in link that lands on this page's own panel", async () => {
    const page = await show(<PricingPage readerId={null} />);
    /* The positive control. Without it the signed-in assertion below is green
       on a page that never draws the link at all, for any reader — which would
       break the buy path and look like a pass. */
    expect(signIn(page)?.getAttribute("href")).toBe("#sign-in");
    expect(deadFragments(page)).toEqual([]);
  });

  it("draws no sign-in link for a reader who is already signed in", async () => {
    const page = await show(<PricingPage readerId={ALICE} />);
    /* The reproduction. Before the fix this was an `<a href="#sign-in">` whose
       target lives in `PlansForAStranger` — the half this page does not
       render — so `deadFragments` returned `["#sign-in"]`. */
    expect(deadFragments(page)).toEqual([]);
    expect(signIn(page)).toBeNull();
  });
});

describe("/features", () => {
  it("sends a stranger to the landing page's panel, path and all", async () => {
    const page = await show(<FeaturesPage signedIn={false} />);
    /* `/#sign-in`, not a bare `#sign-in`: the panel is on `/`, and this page has
       none of its own. SiteBits.tsx says why it is a plain `<a>`. */
    expect(signIn(page)?.getAttribute("href")).toBe("/#sign-in");
  });

  it("draws no sign-in link for a reader who is already signed in", async () => {
    const page = await show(<FeaturesPage signedIn />);
    /* The older half of the same defect: `/` is the shelf for this reader, and
       the shelf has no sign-in panel. Asserted by absence rather than by
       resolving the fragment, because the target is on another page and this
       document cannot be asked about it. */
    expect(signIn(page)).toBeNull();
    expect(deadFragments(page)).toEqual([]);
  });
});

/**
 * **The fourth page to draw this bar, and the reason the condition inside it
 * changed shape** — src/web/SiteBits.tsx § `signedIn`.
 *
 * The destination used to be chosen by naming the pages that *lack* a panel
 * (`here === "features" ? "/#sign-in" : "#sign-in"`), which is a list that has
 * to be extended every time a page joins the bar and fails silently when it is
 * not: `/read/public` has no panel, so under the old form it would have drawn a
 * bare `#sign-in` naming nothing on the page. It is now chosen by naming the two
 * that *have* one. Watched failing on the first case here, 2026-09-04.
 */
describe("/read/public", () => {
  it("sends a stranger to the landing page's panel, path and all", async () => {
    const page = await show(<PublicLibraryPage signedIn={false} />);
    expect(signIn(page)?.getAttribute("href")).toBe("/#sign-in");
    expect(deadFragments(page)).toEqual([]);
  });

  it("draws no sign-in link for a reader who is already signed in", async () => {
    const page = await show(<PublicLibraryPage signedIn />);
    expect(signIn(page)).toBeNull();
    expect(deadFragments(page)).toEqual([]);
  });
});
