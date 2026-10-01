// @vitest-environment jsdom
/**
 * **What a *Check the web* answer says about where it came from**, in plain
 * words. Greg, 2026-09-05 (`spya-puyb6d`): *"it added some section called asked
 * not checked. I didn't understand what asked not checked means."*
 * docs/plans/261001j-five-small-feedback-tooltips-and-labels.md § 4.
 *
 * Two answers, one with a search and one without, and the label each gets —
 * and the old wording on neither.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GlossaryLookup } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* src/web/lib/api.ts reaches supabase at module scope — the same stub
   tests/glossary-compact-header.test.tsx installs. */
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

const { LookupAnswer } = await import("../src/web/GlossaryPanel.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function label(lookup: GlossaryLookup): string {
  act(() => root.render(createElement(LookupAnswer, { lookup })));
  return host.querySelector(".gloss-part-label")?.textContent ?? "";
}

const BASE: GlossaryLookup = {
  answer: "An answer.",
  citations: [{ url: "https://example.org/a", title: "A page" }],
  searches: 2,
  model: "a-model",
  at: "2026-09-10T00:00:00.000Z",
};

it("says an answer that searched came from a web search", () => {
  const text = label(BASE);
  expect(text).toBe("from a web search");
  // The sources it cited, as links that open in a new tab.
  const a = host.querySelector<HTMLAnchorElement>(".gloss-sources a");
  expect(a?.getAttribute("href")).toBe("https://example.org/a");
  expect(a?.getAttribute("target")).toBe("_blank");
});

it("does not promise a source list when a searched answer cited nothing", async () => {
  expect(label({ ...BASE, citations: [] })).toBe("from a web search");
  const globe = host.querySelector<HTMLElement>(".gloss-globe");
  await act(async () => globe?.focus());
  const card = document.querySelector<HTMLElement>('[role="tooltip"]');
  expect(card?.textContent).toContain("It cited no sources, so there are none to link to.");
  expect(card?.textContent).not.toContain("sources below");
  expect(host.querySelector(".gloss-sources")).toBeNull();
});

it("says an answer that did not search is the model's own knowledge", () => {
  const text = label({ ...BASE, searches: 0, citations: [] });
  expect(text).toBe("no web search — from the model's own knowledge");
  expect(text).not.toContain("asked");
});
