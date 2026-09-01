// @vitest-environment jsdom
/**
 * **A shelf we could not reach is not an empty shelf.**
 *
 * The profile page's "Recently read" card had three states written into two.
 * `null` meant "not asked yet" and got a `Loading…`; anything else was treated
 * as the shelf, and a failed `GET /api/library` was turned into `[]` on the way
 * in — so a reader whose request timed out was told *"Nothing on the shelf
 * yet."* about a shelf with fifty articles on it, and the footer under it added
 * *"0 on the shelf"* for good measure.
 *
 * The fix was already written out ten lines below, on the `/api/models` fetch,
 * whose own comment says why: *"`[]` would render an empty card that looks
 * exactly like a server with nothing configured, which is the one answer this
 * section must never give by accident."* Same rule, same page, one fetch
 * missing it.
 *
 * The class is the one Greg reported in chat mode on 2026-08-27 —
 * docs/project/web-client.md § Empty is not the same as not asked yet.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "../src/types.js";

/** What each URL answers with, posed per test. */
const answers = new Map<string, () => Promise<unknown>>();

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (url: string) => Promise.resolve(new Response(null, { status: 200, headers: { "x-url": url } })),
  readJson: (r: Response) => {
    const url = r.headers.get("x-url") ?? "";
    const answer = answers.get(url);
    if (!answer) throw new Error(`nothing posed for ${url}`);
    return answer();
  },
}));

/* The profile box is a textarea with a hook of its own behind it, and this test
   is about the card below it. */
vi.mock("../src/web/useProfile.js", () => ({
  useProfile: () => ({ profile: "", saving: false, save: () => {}, error: null }),
  useHasProfile: () => false,
}));
vi.mock("../src/web/ProfileBox.js", () => ({ ProfileBox: () => null }));
vi.mock("../src/web/AccountSection.js", () => ({ AccountSection: () => null }));

const { ProfilePage } = await import("../src/web/ProfilePage.js");

const ARTICLE: LibraryEntry = {
  slug: "a-piece",
  title: "Something he read last week",
  addedAt: "2026-08-20T10:00:00.000Z",
  words: 2400,
  minutes: 11,
  blocks: 60,
  parts: 3,
  sections: 9,
  comments: 0,
  opens: 2,
  has: { arc: false, tweets: false, glossary: false },
};

let host: HTMLDivElement;
let root: Root;

function paint(): void {
  act(() => {
    root.render(createElement(ProfilePage));
  });
}

/** Let the two fetches settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  answers.clear();
  answers.set("/api/models", () => Promise.resolve({ tasks: [] }));
  /* The Settings card asks who is reading, for the experimental switch. Posed
     rather than mocked away: this page has three fetches now, and a test that
     silently answered only two would report a `readJson` throw as an ordinary
     card state. docs/project/experimental-features.md. */
  answers.set("/api/reader", () => Promise.resolve({ experimentalSince: null }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the recently-read card", () => {
  it("does not call a failed fetch an empty shelf", async () => {
    answers.set("/api/library", () => Promise.reject(new Error("network down")));
    paint();
    await settle();
    expect(host.textContent).not.toContain("Nothing on the shelf yet");
    expect(host.textContent).toContain("Couldn't load your shelf");
  });

  /* The footer counts from the same value, and "0 on the shelf" under "could
     not reach it" is the same false claim in smaller type. */
  it("does not count the articles it could not fetch", async () => {
    answers.set("/api/library", () => Promise.reject(new Error("network down")));
    paint();
    await settle();
    /* Positive first, so a settlement that silently stopped working could not
       pass this by rendering nothing at all. GPT Sol, 2026-08-27. */
    expect(host.textContent).toContain("Couldn't load your shelf");
    expect(host.textContent).not.toContain("0 on the shelf");
  });

  /* And the two real answers, so the fix cannot be "never say anything". */
  it("still says a genuinely empty shelf is empty", async () => {
    answers.set("/api/library", () => Promise.resolve({ articles: [] }));
    paint();
    await settle();
    expect(host.textContent).toContain("Nothing on the shelf yet");
    expect(host.textContent).toContain("0 on the shelf");
  });

  it("lists what came back", async () => {
    answers.set("/api/library", () => Promise.resolve({ articles: [ARTICLE] }));
    paint();
    await settle();
    expect(host.textContent).toContain("Something he read last week");
    expect(host.textContent).toContain("1 on the shelf");
  });
});
