// @vitest-environment jsdom
/**
 * **What `/` and `/features` say a public article shares agrees with
 * `/privacy`.**
 *
 * Both pages said a reader's comments and searches (or notes) "stay yours"
 * while src/public/dto.ts shipped comments and searches to every visitor of a
 * public article, and PrivacyPage.tsx said so. The privacy page is the one
 * checked against the code, so these two follow it: comments and searches go
 * with a public article; chats and the profile do not.
 * docs/plans/261002b-…, Stage 1 (Sol #8).
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "./helpers/marketing-page-render.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
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

beforeEach(() => {
  vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

/** The tile or showcase whose heading is `title`, as text. */
function block(page: HTMLElement, title: string): string {
  const heading = [...page.querySelectorAll("h2, h3")].find(
    (h) => h.textContent?.trim() === title,
  );
  expect(heading).toBeDefined();
  return heading?.parentElement?.textContent ?? "";
}

const PAGES = [
  {
    name: "/",
    draw: () => mount(<LandingPage />),
    title: "Public articles share their AI annotations.",
  },
  {
    name: "/features",
    draw: () => mount(<FeaturesPage signedIn={false} />, "/features"),
    title: "The library.",
  },
];

describe.each(PAGES)("$name on public articles", ({ draw, title }) => {
  it("names comments and searches as going with a public article, and chats as not", async () => {
    const text = block(await draw(), title);
    expect(text).toMatch(/comments/);
    expect(text).toMatch(/searches/);
    expect(text).toMatch(/chats[^.]*not/i);
  });

  it("nowhere says anything stays yours", async () => {
    const text = (await draw()).textContent ?? "";
    expect(text).not.toMatch(/stays? yours/i);
  });

  it("no longer lists gists among what is shared", async () => {
    expect(block(await draw(), title)).not.toMatch(/gists/);
  });
});
