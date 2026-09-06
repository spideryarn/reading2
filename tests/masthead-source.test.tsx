// @vitest-environment jsdom
/**
 * **The way to the original PDF is offered to the owner and to nobody else.**
 *
 * `SourceLink` fetches authenticated `GET /api/source/:slug`, and stage 1
 * deliberately does not serve it publicly: *"Serving somebody's uploaded bytes
 * to the world is a separate decision from serving the extracted text. Hide the
 * link rather than 404 it."* docs/plans/260827ai-public-read-only-access.md.
 *
 * ## Why this is its own file rather than a line in the network trace
 *
 * Because the trace **cannot see it**, and the reason is worth being exact
 * about. GPT Sol reported this as a live leak — every visitor to a shared PDF
 * mounting a private control — and it is not one *today*: `PublicMeta` carries
 * no `source`, so the masthead's `meta.source === "pdf"` branch is false for a
 * visitor and the control never renders. The finding is right about the code
 * and wrong about the consequence.
 *
 * What it is right about is that the protection was **entirely accidental**. It
 * lived in a projection two modules away (src/public/dto.ts), not at the
 * control, and nothing said the two were related. Slice 1b or stage 2 adding
 * `source` to the public shape — which is a reasonable thing to want, since
 * "this was transcribed from a scan" is a fact about the article rather than
 * about us — would have handed every visitor a button that opens a blank tab,
 * makes a private request, is refused, and leaves them looking at nothing.
 *
 * So the gate is now local and explicit, and this tests **the gate** rather
 * than the projection: the masthead is handed a PDF meta directly, which is the
 * shape it would receive the day somebody projects one.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";

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

const { Masthead } = await import("../src/web/Masthead.js");

/** Every request the masthead made. There should never be one on mount. */
const calls: string[] = [];

const SLUG = "a-scanned-piece";

/** An article extracted from a PDF, which is the only kind with a source note. */
const ARTICLE: Article = {
  meta: {
    slug: SLUG,
    title: "A scanned piece",
    source: "pdf",
    pages: 12,
    pagesChecked: 12,
    unverified: false,
  },
  blocks: [
    {
      id: "spya-aaaaaa",
      tag: "p",
      kind: "text",
      text: "A paragraph.",
      words: 2,
      html: "<p>A paragraph.</p>",
      gistable: true,
    },
  ],
  /* Absent, and that is the third state: this article has never been through the
     `assets` step, so the reader hot-links exactly as before. src/assets.ts. */
  assets: undefined,
  navLabelStatus: "ready",
  tree: {
    version: "t",
    generator: "t",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: [],
        range: ["spya-aaaaaa", "spya-aaaaaa"],
        title: "A scanned piece",
      },
    },
  },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  vi.stubGlobal("open", () => null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** The masthead, as the owner sees it or as a visitor does. */
async function mount(onRenamed: ((slug: string, title: string) => void) | undefined) {
  await act(async () => {
    root.render(
      createElement(Masthead, {
        article: ARTICLE,
        slug: SLUG,
        ...(onRenamed ? { onRenamed } : {}),
      }),
    );
  });
}

/** Anything in the provenance note a person could activate. */
const controls = () => [
  ...(host.querySelector(".source-note")?.querySelectorAll("button, a[href]") ?? []),
];

describe("the PDF provenance note", () => {
  it("tells a visitor how far the transcription was checked", async () => {
    await mount(undefined);

    /* The sentence stays. How much of a scanned document was verified is a fact
       about how far to trust what you are reading, and it is the whole reason
       the note exists. docs/plans/260826c-pdf-ingestion.md § A scan with no text layer. */
    expect(host.textContent).toContain("Transcribed by a machine from a PDF");
    expect(host.textContent).toContain("12 of 12 pages");
  });

  it("offers a visitor nothing to press", async () => {
    await mount(undefined);

    /* In the markup, not merely dimmed: there is nothing here an account would
       unlock, so a marked control would be advertising a door that does not
       exist. */
    expect(controls()).toEqual([]);
    expect(host.textContent).not.toContain("View the original");
  });

  /**
   * **Both activations, because they are two listeners.**
   *
   * A fix that removed the pointer path and left the element focusable would
   * still fire on Enter — the half that is easy to forget and invisible in a
   * screenshot. "Nothing to press" is the only shape that covers both, and this
   * asserts it by trying to activate whatever is left.
   */
  it("makes no request when a visitor clicks or presses Enter in the note", async () => {
    await mount(undefined);

    for (const el of controls()) {
      await act(async () => {
        (el as HTMLElement).click();
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
    }
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });

    expect(calls).toEqual([]);
  });

  /**
   * **The positive control**, and without it every assertion above passes on a
   * masthead that renders no note at all — which is precisely how this could
   * have been "fixed" while removing the sentence the reader is entitled to.
   */
  it("still offers the owner the original file", async () => {
    await mount(() => {});

    expect(host.textContent).toContain("View the original");
    expect(controls().length).toBeGreaterThan(0);
  });
});
