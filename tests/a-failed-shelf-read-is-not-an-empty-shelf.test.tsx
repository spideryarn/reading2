// @vitest-environment jsdom
/**
 * **`GET /api/library` failing must not read as "your shelf is empty".**
 *
 * `useLinkFacts` used to answer a failed shelf read by installing an empty map.
 * That was a good answer while the only consequence was a section not being
 * drawn — a card that says nothing about the library is exactly right when we
 * could not find out. It stopped being a good answer the day the card grew a
 * button that spends a metered ingest slot: an empty map says *this page is not
 * on your shelf* to anything that asks, so the card would offer to add an
 * article the reader already owns, for the rest of the session, off one failed
 * request. GPT Sol found it reviewing the built code, 2026-09-05, finding P1-1.
 *
 * So `LinkFacts` now carries `shelfKnown`, and the three things this file pins
 * are the three that have to stay true together:
 *
 *  - a failed read leaves `shelfKnown` false, so nothing offers the button;
 *  - it still stops `loading`, so the reader is not left under a spinner that
 *    has nothing coming — which is what the empty map used to buy, and the only
 *    reason it was there;
 *  - and it is not re-asked on every subsequent hover, which is the other thing
 *    it bought.
 *
 * **Its own file, and that is not tidiness.** The shelf is module-level state
 * loaded once per session, so "the read failed" is a state a test file can
 * reach exactly once — vitest's per-file module registry is the isolation.
 * tests/add-to-shelf-from-the-card.test.tsx covers the *loading* half of
 * `shelfKnown` for the same reason, as its first test.
 *
 * This mounts the hook rather than the card: what is under test is one boolean
 * on `LinkFacts`, and a card around it would only be another way for the
 * assertion to be about something else.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LinkPreview } from "../src/web/link-preview.js";

/* React only flushes inside `act` when it is told it is under test. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every `/api/` path asked for. One entry, however many hovers, is the rule. */
const asked: string[] = [];

vi.mock("../src/web/lib/api.js", () => {
  const api = {
    apiFetch: async (input: string) => {
      asked.push(input);
      /* What a dead network looks like from inside `apiFetch` — the same
         `TypeError` a browser throws, not an HTTP error, because that is the
         case the old empty-map answer was written for. */
      throw new TypeError("Failed to fetch");
    },
    readJson: async (res: Response) => res.json(),
    failure: async (res: Response) => new Error(String(res.status)),
    fetchOk: async (input: string) => api.apiFetch(input),
    statusOf: () => undefined,
  };
  return api;
});

const { useLinkFacts } = await import("../src/web/link-facts.js");

const LINK: LinkPreview = {
  kind: "external",
  host: "example.org",
  sameSite: false,
  trail: [],
  file: null,
  citation: null,
  wiki: null,
  url: "https://example.org/an-essay",
};

/** What the hook answered on the most recent render. */
let seen: { loading: boolean; shelfKnown: boolean; library: unknown } | null = null;

function Probe() {
  const facts = useLinkFacts(LINK, "https://noema.example/the-piece");
  seen = { loading: facts.loading, shelfKnown: facts.shelfKnown, library: facts.library };
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** Mount, and let the failed request settle. */
async function probe(): Promise<void> {
  await act(async () => root.render(<Probe />));
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

it("says the shelf is unknown rather than empty, and stops looking", async () => {
  await probe();

  expect(asked).toEqual(["/api/library"]);
  // Not "we asked and it is not there" — we never found out.
  expect(seen?.shelfKnown).toBe(false);
  expect(seen?.library).toBe(null);
  /* And no spinner. This is the half the empty map existed for, and losing it
     would leave `looking it up…` under every external link in the article for
     the rest of the session. */
  expect(seen?.loading).toBe(false);
});

/* A card that re-asked on every hover of every link in a long article is the
   thing the "not retried this session" rule prevents. A second mount is a
   second hover. */
it("does not ask again for the rest of the session", async () => {
  await probe();
  await act(async () => root.unmount());
  root = createRoot(host);
  await probe();

  expect(asked).toEqual(["/api/library"]);
  expect(seen?.shelfKnown).toBe(false);
  expect(seen?.loading).toBe(false);
});
