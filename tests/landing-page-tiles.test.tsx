// @vitest-environment jsdom
/**
 * **The landing page's "N more ways in" counts its own tiles, and Structure
 * and Skim are among them.**
 *
 * The count half is a regression guard (it was right when written); the
 * Structure and Skim half was red until 261002b Stage 1 swapped Diagrams for
 * Structure and added Skim — Greg, 2026-09-29: *"I'm increasingly thinking of
 * the trajectory mode as one of the main modes"*. Also checks the Experimental
 * tag the same way tests/features-page-modes.test.tsx does.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimental, isMode, modeMentions, mount, unmount } from "./helpers/marketing-page-render.js";

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

const NUMBER_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
];

beforeEach(() => {
  vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

/** The bento under the "N more ways in." heading, and the word it opens with. */
function moreWaysIn(page: HTMLElement): { word: string; tiles: HTMLElement[] } {
  const heading = [...page.querySelectorAll("h2")].find((h) =>
    /more ways in\.$/.test(h.textContent ?? ""),
  );
  expect(heading).toBeDefined();
  const word = (heading?.textContent ?? "").split(" ")[0] ?? "";
  let bento = heading?.parentElement?.nextElementSibling ?? null;
  while (bento && !bento.classList.contains("site-bento")) bento = bento.nextElementSibling;
  expect(bento).not.toBeNull();
  return { word, tiles: [...(bento?.children ?? [])] as HTMLElement[] };
}

describe("the landing page's tiles", () => {
  it("has a Structure tile and a Skim tile, each carrying its mode", async () => {
    const { tiles } = moreWaysIn(await mount(<LandingPage />));
    const byMode = (mode: string) => tiles.filter((t) => t.dataset.mode === mode);
    expect(byMode("structure")).toHaveLength(1);
    expect(byMode("skim")).toHaveLength(1);
  });

  it("says as many more ways in as there are tiles", async () => {
    const { word, tiles } = moreWaysIn(await mount(<LandingPage />));
    expect(tiles.length).toBeGreaterThan(0);
    expect(word).toBe(NUMBER_WORDS[tiles.length]);
  });

  it("draws the Experimental tag exactly on the modes MODE_CATALOG marks", async () => {
    const mentions = modeMentions(await mount(<LandingPage />));
    expect(mentions.length).toBeGreaterThan(0);
    for (const { title, mode, tagged } of mentions) {
      expect(isMode(mode)).toBe(true);
      if (!isMode(mode)) continue;
      expect({ title, tagged }).toEqual({ title, tagged: experimental(mode) });
    }
  });
});
