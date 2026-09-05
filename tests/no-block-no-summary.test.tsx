// @vitest-environment jsdom
/**
 * **A link that sits in no paragraph does not get a paragraph's summary.**
 *
 * The summary answers *how does this destination stand to the passage you are
 * standing in*, and some links are in no passage: one in a chat answer, one in
 * the sources listed under it, one in a figure's lightbox. The server still
 * takes a request with no block and answers about the article's **first**
 * mention — deliberately, for a client from before `?block=` existed — so if
 * such a URL also appears somewhere in the prose, a card over the chat link
 * would carry a fluent paragraph about a passage the reader is nowhere near.
 *
 * That is the failure this whole feature is built against: a wrong answer is
 * worse than saying nothing (docs/project/links.md). So the client does not ask
 * when it has no block, and **that is what this file pins**, because the symptom
 * of losing it is a card that looks completely right.
 *
 * GPT Sol, 2026-09-05, reviewing the fix that added the block.
 *
 * Two probes, two URLs — the module-level caches in link-facts.ts outlive a
 * test, so sharing an address would make one case depend on the other having
 * run. The assertion is the **request list**, because a card drawn without a
 * summary and a card whose summary was never asked for look identical.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LinkPreview } from "../src/web/link-preview.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every `/api/` path the render asked for, in order. */
const asked: string[] = [];

vi.mock("../src/web/lib/api.js", () => {
  /* A whole-module mock, so anything link-facts.ts reaches for and this omits is
     `undefined` when it is called rather than the real thing talking to a server
     that is not there — tests/add-to-shelf-from-the-card.tsx explains it. */
  const api = {
    apiFetch: async (input: string) => {
      asked.push(input);
      if (input.startsWith("/api/library")) {
        return new Response(JSON.stringify({ articles: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input.startsWith("/api/link-preview")) {
        /* A destination the server *could* read, which is the precondition for
           asking for a summary at all — without it the client would decline for
           the wrong reason and this file would pass while proving nothing. */
        return new Response(
          JSON.stringify({
            state: "ready",
            page: { title: "A paper", description: "What the paper says, at length." },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      /* A one-frame stream, which is what a cache hit looks like on the wire. */
      return new Response('event: ready\ndata: {"summary":"How it stands."}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
    readJson: async (res: Response) => res.json(),
    failure: async (res: Response) => new Error(String(res.status)),
    fetchOk: async (input: string) => api.apiFetch(input),
    statusOf: () => undefined,
  };
  return api;
});

const { useLinkFacts } = await import("../src/web/link-facts.js");

function aLink(url: string): LinkPreview {
  return {
    kind: "external",
    host: "destination.example",
    sameSite: false,
    trail: [],
    file: null,
    citation: null,
    wiki: null,
    url,
  };
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

/** Mount the hook for one link and let both lookups settle. */
async function hover(url: string, inBlock: string | null): Promise<void> {
  function Probe() {
    useLinkFacts(aLink(url), "https://noema.example/the-piece", "a-slug", inBlock);
    return null;
  }
  await act(async () => root.render(<Probe />));
  /* The summary is *chained* to the preview rather than fired beside it, so one
     microtask drain is not enough: the preview has to land first. */
  await act(async () => {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
  });
}

it("asks for a summary for a link in a paragraph", async () => {
  await hover("https://destination.example/in-the-prose", "spya-aaaaaa");
  const summaries = asked.filter((path) => path.startsWith("/api/link-summary"));
  expect(summaries).toHaveLength(1);
  /* And it says which mention, which is the other half of the same rule. */
  expect(summaries[0]).toContain("block=spya-aaaaaa");
});

it("does not ask for one for a link that is in no paragraph", async () => {
  asked.length = 0;
  await hover("https://destination.example/in-a-chat-answer", null);
  /* The free card and the fetched preview still land — this is not a card that
     went quiet, it is one section withheld. */
  expect(asked.some((path) => path.startsWith("/api/link-preview"))).toBe(true);
  expect(asked.filter((path) => path.startsWith("/api/link-summary"))).toEqual([]);
});
