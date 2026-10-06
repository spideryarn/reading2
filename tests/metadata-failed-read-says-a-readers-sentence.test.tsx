// @vitest-environment jsdom
/**
 * **The Metadata page's failed read says a sentence written for a reader.**
 *
 * Its provenance read (`GET /api/metadata/:slug`) stored `(e as Error).message`
 * and drew it at the top of *AI processing* until 2026-10-06 — the browser's
 * own "Load failed" for a dropped connection, or whatever an unexpected
 * exception happened to say. Fourteen hooks had moved to `describeFetchFailure`
 * (plan 261004c); this file was another cluster's and was left
 * (tests/read-error-matrix.test.tsx § `NOT_A_ROW`).
 *
 * The third case is the other half of the same finding: the page asked "did
 * the read fail" as `Boolean(provenanceError)` in four places and as
 * `provenanceError === null` in one, which disagree about an empty message —
 * a failure that four consumers called "not failed" and the fifth called "not
 * still asking". The predicate is `!== null` everywhere now, and a failure can
 * no longer have an empty sentence to begin with.
 *
 * The harness is tests/metadata-sharing-card.test.tsx's, cut down.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";
import { PAGE_FAULT } from "../src/messages.js";
import { couldNotReach } from "../src/web/lib/reader-facing.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});

const { Metadata } = await import("../src/web/Metadata.js");

const SLUG = "a-piece";

const ARTICLE: Article = {
  highPowerSince: null,
  titleOverridden: false,
  meta: { slug: SLUG, title: "A piece" },
  blocks: [
    {
      id: "spya-aaaaaa",
      tag: "p",
      kind: "text",
      text: "The first paragraph.",
      words: 3,
      html: "<p>The first paragraph.</p>",
      gistable: true,
    },
  ],
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  tree: {
    version: "t",
    generator: "t",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "A piece" },
    },
  },
};

/** What the metadata request does. Everything else answers `{}`. */
let metadataRead: () => Promise<Response>;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/metadata/")) return metadataRead();
    if (url.endsWith("/share-link")) {
      return new Response('{"on":false}', { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  });
  /* `describeFetchFailure` reports an exception nobody wrote for a reader. */
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open(): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}/metadata`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(Metadata, { slug: SLUG, article: ARTICLE, onRenamed: () => {}, onVisibility: () => {} }),
      ),
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** The sentence at the top of *AI processing*, or null when none is drawn. */
function failureSentence(): string | null {
  const drawn = [...host.querySelectorAll("p")].filter((p) => p.className.includes("border-destructive"));
  expect(drawn.length, "at most one failure sentence for the metadata read").toBeLessThanOrEqual(1);
  return drawn[0]?.textContent ?? null;
}

describe("the Metadata page's failed read", () => {
  it("a dropped connection is said in our words, not the browser's", async () => {
    metadataRead = () => Promise.reject(new TypeError("Load failed"));
    await open();
    /* The development build keeps the browser's words in brackets; a built
       page does not (`couldNotReach`). Either way it is that function's
       sentence and never the bare message. */
    expect(failureSentence()).toBe(couldNotReach("Load failed"));
    expect(failureSentence()).not.toBe("Load failed");
  });

  it("an exception nobody wrote for a reader is the page's own sentence", async () => {
    metadataRead = () => Promise.reject(new Error("ECONNRESET at socket 0x1f"));
    await open();
    expect(failureSentence()).toBe(PAGE_FAULT.message);
    expect(host.textContent).not.toContain("ECONNRESET");
  });

  it("a failure with nothing in its message is still a failure, and still says so", async () => {
    metadataRead = () => Promise.reject(new TypeError(""));
    await open();
    expect(failureSentence()).toBe(couldNotReach(""));
    /* And the stage list does not go on saying it is still checking. */
    expect(host.textContent).not.toContain("Checking which files");
  });

  it("the server's own sentence is still shown as it is", async () => {
    metadataRead = async () => new Response(JSON.stringify({ error: "The database went away. [db-lost]" }), { status: 500 });
    await open();
    expect(failureSentence()).toBe("The database went away. [db-lost]");
  });
});
