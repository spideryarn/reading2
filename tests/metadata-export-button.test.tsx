// @vitest-environment jsdom
/**
 * **The Export button on the Metadata page** — Metadata.tsx § `ExportSection`,
 * the last stage of docs/plans/260901h-export-article-data.md.
 *
 * Mounted through `Metadata` rather than by rendering the section directly,
 * which is the same choice `tests/metadata-sharing-card.test.tsx` made and for
 * the same reason: the section is private to the page, and the wiring — which
 * gate it is behind, which slug reaches the URL — is where this kind of control
 * goes wrong. Rendering it with hand-written props asserts the props.
 *
 * Three things here are about the download rather than about React, and none of
 * them is visible in the markup:
 *
 *  - **The filename is on the anchor.** The route sets a `Content-Disposition`
 *    naming `<slug>.zip` and every header is lost through the blob URL, so
 *    without `download="…"` the reader gets an unnamed file. A test that only
 *    checked the request would pass.
 *  - **The anchor is in the document when it is clicked.** Firefox has never
 *    dispatched the default action for a detached anchor.
 *  - **The button is disabled while the zip builds**, so a second press cannot
 *    start a second assembly.
 *
 * `HTMLAnchorElement.prototype.click` is spied on rather than left to run:
 * jsdom answers a real click on a `blob:` href with a "navigation not
 * implemented" error, and the spy is also the only way to see the element
 * before `link.remove()` takes it away again.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
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
        title: "A piece",
      },
    },
  },
};

/** What `GET /api/metadata/:slug` says this article's directory is. */
let dir: string;
/** Whether that request fails outright, which leaves `provenance` null. */
let metadataFails = false;

/** How `GET /api/export/:slug` answers. `null` means "never" — see `hold`. */
let exportAnswer: (() => Response) | null;
/** Resolved by the test when it wants a held export request to finish. */
let release: (() => void) | undefined;

/** Every `/api/export/…` address the page asked for, in order. */
let asked: string[];
/** Every anchor whose `click()` was called, with what mattered about it. */
let clicked: { href: string; download: string; inDocument: boolean }[];
let created: string[];
let revoked: string[];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  dir = `data/${SLUG}`;
  metadataFails = false;
  exportAnswer = () => new Response(new Blob(["PK…"]), { status: 200 });
  release = undefined;
  asked = [];
  clicked = [];
  created = [];
  revoked = [];

  let objectUrls = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => {
      const url = `blob:http://localhost/${++objectUrls}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  });

  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({
      href: this.getAttribute("href") ?? "",
      download: this.getAttribute("download") ?? "",
      /* Read here and not afterwards: the component removes the anchor on the
         next line, so this is the only moment the answer is the real one. */
      inDocument: document.body.contains(this),
    });
  });

  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/metadata/")) {
      if (metadataFails) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "the database went away" }), { status: 500 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            slug: SLUG,
            dir,
            stages: [],
            comments: 0,
            profile: null,
            purpose: null,
            archivedAt: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (url.startsWith("/api/export/")) {
      asked.push(url);
      const answer = exportAnswer;
      if (!answer) {
        return new Promise<Response>((go) => {
          release = () => go(new Response(new Blob(["PK"]), { status: 200 }));
        });
      }
      return Promise.resolve(answer());
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });

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

/** The metadata page, settled, with nothing pressed. */
async function open(): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}/metadata`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(Metadata, {
          slug: SLUG,
          article: ARTICLE,
          onRenamed: () => {},
          onVisibility: () => {},
        }),
      ),
    );
  });
  await settle();
}

/** Let every pending microtask and zero-delay timer run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

const exportButton = (): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("Export this article"),
  );

describe("the Export button", () => {
  it("is offered once we know the article has a shelf row", async () => {
    await open();
    expect(exportButton()).toBeTruthy();
    /* And it says what the reader gets, which is the half of this card that is
       not a button. */
    expect(host.textContent).toContain("A zip of everything we hold for this article");
  });

  /**
   * **No row, no button.** The reading view answers an unknown address with the
   * example fixture, so this page can be showing an article that has no row of
   * its own — and `GET /api/export/:slug` is owner-scoped, so the button's only
   * possible outcome there is a 404. The same rule Archive and the sharing
   * switch keep.
   */
  it("is withheld when the page is showing the example fixture", async () => {
    dir = "example";
    await open();
    expect(exportButton()).toBeUndefined();
    expect(host.textContent).not.toContain("A zip of everything we hold");
  });

  /**
   * The other half of the same gate, and the one with a cost: `hasShelfRow` is
   * false when the metadata request fails, so a failed check takes the button
   * away rather than dimming it. Deliberate — see `ExportSection`'s header.
   */
  it("is withheld when we could not check whether there is a row", async () => {
    metadataFails = true;
    await open();
    expect(exportButton()).toBeUndefined();
  });

  it("asks the export route for this slug and hands the browser a named file", async () => {
    await open();
    await act(async () => exportButton()?.click());
    await settle();

    expect(asked).toEqual([`/api/export/${SLUG}`]);
    /* The filename lives on the anchor because the response header does not
       survive the blob URL. This is the assertion that would go red if somebody
       "simplified" the anchor away. */
    expect(clicked).toEqual([
      { href: created[0] ?? "", download: `${SLUG}.zip`, inDocument: true },
    ]);
    /* Revoked afterwards, and the anchor is gone from the page again. */
    expect(revoked).toEqual(created);
    expect(host.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("disables the button while the zip is being built", async () => {
    /* Held open, so the pending state is a state and not a frame. */
    exportAnswer = null;

    await open();
    await act(async () => exportButton()?.click());

    const pending = [...host.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Building the zip…"),
    );
    expect(pending).toBeTruthy();
    expect(pending?.disabled).toBe(true);
    /* A second press must not start a second assembly — which is what the
       disabled attribute is for, and this is the assertion that says so. */
    await act(async () => pending?.click());
    expect(asked).toHaveLength(1);

    await act(async () => release?.());
    await settle();
    expect(exportButton()?.disabled).toBe(false);
    expect(clicked).toHaveLength(1);
  });

  it("says so in words when the server refuses, rather than throwing", async () => {
    exportAnswer = () =>
      new Response(JSON.stringify({ error: "No such article." }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });

    await open();
    await act(async () => exportButton()?.click());
    await settle();

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't build the download.");
    expect(alert?.textContent).toContain("No such article.");
    expect(alert?.textContent).toContain("[export-failed]");
    /* No file, and the button is pressable again. */
    expect(clicked).toEqual([]);
    expect(exportButton()?.disabled).toBe(false);
  });

  /**
   * **The 413 keeps the server's own sentence, unwrapped.** It is already
   * written for the reader — it says what happened and that trying again will
   * not help (docs/project/copy.md) — so a "Couldn't build the download" in
   * front of it would be a lead the sentence does not need.
   */
  it("passes the too-big refusal through in the server's words", async () => {
    exportAnswer = () =>
      new Response(
        JSON.stringify({
          error:
            "This article is too big to download in one file. That is a limit on our side, " +
            "not something you did, and trying again will not help — tell us about it and " +
            "we will raise it.",
        }),
        { status: 413, headers: { "content-type": "application/json" } },
      );

    await open();
    await act(async () => exportButton()?.click());
    await settle();

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("This article is too big to download in one file.");
    expect(alert?.textContent).toContain("[export-too-big]");
    expect(alert?.textContent).not.toContain("Couldn't build the download");
  });

  it("survives the fetch dying on the way out", async () => {
    exportAnswer = () => {
      throw new TypeError("Failed to fetch");
    };

    await open();
    await act(async () => exportButton()?.click());
    await settle();

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't build the download.");
    expect(alert?.textContent).toContain("[export-failed]");
    expect(exportButton()?.disabled).toBe(false);
  });
});
