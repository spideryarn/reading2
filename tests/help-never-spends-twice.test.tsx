// @vitest-environment jsdom
/**
 * **The two ways a "?" press could quietly buy a second answer.**
 *
 * `tests/help-sends-once.test.tsx` covers one press rendering twice. This file
 * covers the two GPT Sol found by reading the *rest* of the system, both of
 * which were commit blockers on stage 3 and neither of which is in the button's
 * own code:
 *
 * 1. **The arriving summary list wipes the optimistic one.** `useChatAnchors`
 *    fetches once on mount and replaced its whole array with the answer. A press
 *    while that GET is in the air inserts a summary the snapshot cannot contain,
 *    so the arrival deletes it — and the *next* press finds nothing anchored to
 *    the paragraph and buys another answer. The hook's own header had described
 *    this race for ten days as a reason never to re-fetch, without noticing that
 *    its first fetch is a fetch.
 *
 * The second one he found — a summary that names nothing going on being
 * consulted, so the "?" is permanently dead on that paragraph — is fixed in
 * `ChatDialog` and tested in `tests/help-sends-once.test.tsx` § the way out of a
 * first answer, not here. This file is only the hook.
 *
 * It is tested against the real hook with the network held open on purpose,
 * because the whole point of it is an ordering that exists only while something
 * is in flight.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThreadSummary } from "../src/types.js";

const BLOCK = "spya-k3m9qt";

/** Resolve the summary GET by hand, so the in-flight window is ours. */
let releaseFetch: (threads: ThreadSummary[]) => void;
let fetched: Promise<ThreadSummary[]>;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: () => fetched.then((threads) => ({ ok: true, json: async () => ({ threads }) })),
  readJson: (r: { json: () => Promise<unknown> }) => r.json(),
}));

const { useChatAnchors, helpThreadFor } = await import("../src/web/useChatAnchors.js");

const summary = (id: string, blockId: string, updatedAt: string): ThreadSummary =>
  ({
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    kind: "chat",
    turns: 1,
    anchor: { blockId },
    // biome-ignore lint/suspicious/noExplicitAny: a summary shaped for this test
  }) as any;

let host: HTMLDivElement;
let root: Root;
/** The live hook, captured from a probe component. */
let api: ReturnType<typeof useChatAnchors>;

function Probe() {
  api = useChatAnchors("an-article");
  return null;
}

beforeEach(() => {
  fetched = new Promise((r) => {
    releaseFetch = r;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a press while the summary list is still in the air", () => {
  it("keeps the conversation it just bought, so the next press does not buy another", async () => {
    const { createElement } = await import("react");
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(api.loaded, "the GET must still be in flight").toBe(false);

    /* The press: one POST, and the optimistic summary goes in. */
    act(() => api.add(summary("spya-mine11", BLOCK, "2026-09-05T10:00:00.000Z")));
    expect(helpThreadFor(api.summaries, BLOCK)?.id).toBe("spya-mine11");

    /* The GET, taken before any of that, now lands. */
    await act(async () => {
      releaseFetch([summary("spya-older1", "spya-other1", "2026-09-04T10:00:00.000Z")]);
      await fetched;
    });

    expect(api.loaded).toBe(true);
    /* **The assertion the blocker is about.** Without the fold, this is
       `undefined` and the reader's next press spends again on a paragraph they
       have already asked about. */
    expect(helpThreadFor(api.summaries, BLOCK)?.id).toBe("spya-mine11");
    /* And the server's own rows are still there — a fix that kept the local
       write by throwing the arrival away would pass the line above. */
    expect(api.summaries.map((s) => s.id).sort()).toEqual(["spya-mine11", "spya-older1"]);
  });

  it("does not resurrect a conversation deleted while the list was in the air", async () => {
    /* The other half, and it needs its own record: a deletion leaves nothing
       behind for the arrival to be compared against, so the snapshot brings it
       back and the reader watches something they deleted reappear. */
    const { createElement } = await import("react");
    await act(async () => {
      root.render(createElement(Probe));
    });
    act(() => api.drop("spya-doomed"));
    await act(async () => {
      releaseFetch([summary("spya-doomed", BLOCK, "2026-09-04T10:00:00.000Z")]);
      await fetched;
    });
    expect(api.summaries.map((s) => s.id)).toEqual([]);
    expect(helpThreadFor(api.summaries, BLOCK)).toBeUndefined();
  });

  it("takes the server's version of anything it did not touch", async () => {
    /* The fold must not become "local always wins" — that would freeze the
       reading view on whatever it happened to have when the page loaded. */
    const { createElement } = await import("react");
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      releaseFetch([summary("spya-server1", BLOCK, "2026-09-04T10:00:00.000Z")]);
      await fetched;
    });
    expect(api.summaries.map((s) => s.id)).toEqual(["spya-server1"]);
  });

  it("stops remembering deletions once the list has landed", async () => {
    /* The `Set` is cleared on arrival. Left growing it would be a leak in the
       shape of a fix — and worse, a deletion remembered forever would fight a
       future arrival that legitimately had the row back. */
    const { createElement } = await import("react");
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      releaseFetch([summary("spya-server1", BLOCK, "2026-09-04T10:00:00.000Z")]);
      await fetched;
    });
    act(() => api.drop("spya-server1"));
    expect(api.summaries).toEqual([]);
    /* Nothing re-fetches after this, so the only observable is that dropping
       still works and nothing threw. The leak itself is not reachable from a
       test; the assertion that matters is the one above it. */
    act(() => api.add(summary("spya-later1", BLOCK, "2026-09-05T11:00:00.000Z")));
    expect(api.summaries.map((s) => s.id)).toEqual(["spya-later1"]);
  });
});
