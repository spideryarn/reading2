// @vitest-environment jsdom
/**
 * **The Metadata page's "Imported as …" line**: the original of a title import
 * tidied, and the button that puts it back.
 * docs/plans/261005g-tidy-an-imported-title-and-keep-the-original.md
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";

const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/lib/api.js")>()),
  /* The sharing card asks for its private link's state on its own route when
     the page opens (src/web/PrivateLink.tsx). Answered here, so the one
     `Response` each case queues for the page's own read is not read twice. */
  apiFetch: (...args: unknown[]) =>
    String(args[0]).endsWith("/share-link")
      ? Promise.resolve(
          new Response('{"on":false}', { status: 200, headers: { "content-type": "application/json" } }),
        )
      : apiFetch(...args),
}));

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
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/Dock.js")>()),
  Dock: () => null,
}));

const { ImportedTitle, Metadata } = await import("../src/web/Metadata.js");
const { PublicMetadataPage } = await import("../src/web/PublicPages.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  apiFetch.mockReset();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

const SLUG = "a-piece";
const ORIGINAL = "THE ORDER OF TIME";
function article(title = "The Order of Time"): Article {
  return {
    highPowerSince: null,
    titleOverridden: title !== "The Order of Time",
    meta: { slug: SLUG, title, titleOriginal: ORIGINAL },
    blocks: [],
    assets: undefined,
    sourceGuess: undefined,
    navLabelStatus: "ready",
    tree: {
      version: "t", generator: "t", slug: SLUG, rootId: "n0",
      nodes: { n0: { id: "n0", depth: 0, parent: null, childIds: [], blockIds: [], gist: "Time." } },
      sourceHash: "x", generatedAt: "2026-10-05T00:00:00.000Z", elapsedMs: 0,
    } as unknown as Article["tree"],
  };
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const provenance = () => response({
  slug: SLUG, dir: SLUG, stages: [], comments: 0, profile: null, purpose: null, archivedAt: null,
});
const owner = (title = "The Order of Time", onRenamed = vi.fn()) => act(async () => {
  root.render(createElement(Metadata, { slug: SLUG, article: article(title), onRenamed, onVisibility: () => {} }));
});
const useOriginal = async () => {
  const button = host.querySelector<HTMLButtonElement>("[data-imported-title] button");
  expect(button).not.toBeNull();
  await act(async () => button!.click());
};

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const mount = (props: { original: string | undefined; showing: string; onUse?: (title: string) => void }) =>
  act(async () => root.render(createElement(ImportedTitle, { onUse: () => {}, ...props })));

describe("the imported title, on the Metadata page", () => {
  it("shows the original beside a tidied title, and hands it back when asked", async () => {
    const used: string[] = [];
    await mount({ original: "THE ORDER OF TIME", showing: "The Order of Time", onUse: (t) => used.push(t) });
    const line = host.querySelector("[data-imported-title]");
    expect(line?.textContent).toContain("Imported as “THE ORDER OF TIME”.");
    await act(async () => line?.querySelector("button")?.click());
    expect(used).toEqual(["THE ORDER OF TIME"]);
  });

  it("draws nothing when import changed nothing", async () => {
    await mount({ original: undefined, showing: "The Order of Time" });
    expect(host.querySelector("[data-imported-title]")).toBeNull();
  });

  it("draws nothing once the original is the title showing", async () => {
    await mount({ original: "THE ORDER OF TIME", showing: "THE ORDER OF TIME" });
    expect(host.querySelector("[data-imported-title]")).toBeNull();
  });
});

describe("the imported title through the page's rename", () => {
  it("waits for the shelf row and stays hidden when that read fails", async () => {
    let answer!: (r: Response) => void;
    apiFetch.mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve; }));
    await owner();
    expect(host.querySelector("[data-imported-title]")).toBeNull();
    await act(async () => answer(response({ error: "No article" }, 404)));
    expect(host.querySelector("[data-imported-title]")).toBeNull();
  });

  it("restores the original through PATCH even after a reader's rename", async () => {
    apiFetch.mockResolvedValue(provenance());
    const renamed = vi.fn();
    await owner("My own title", renamed);
    expect(host.querySelector("h1")?.textContent).toBe("My own title");
    apiFetch.mockResolvedValue(response({ entry: { slug: SLUG, title: ORIGINAL, titleOverridden: true } }));
    await useOriginal();
    expect(apiFetch).toHaveBeenLastCalledWith(`/api/library/${SLUG}`, expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ title: ORIGINAL }),
    }));
    expect(renamed).toHaveBeenCalledWith(SLUG, ORIGINAL, true);
    await owner(ORIGINAL, renamed);
    expect(host.querySelector("[data-imported-title]")).toBeNull();
  });

  it("shows a failed restore beside the unchanged heading", async () => {
    apiFetch.mockResolvedValue(provenance());
    const renamed = vi.fn();
    await owner("My own title", renamed);
    apiFetch.mockResolvedValue(response({ error: "Title is too long" }, 400));
    await useOriginal();
    expect(renamed).not.toHaveBeenCalled();
    expect(host.querySelector("h1")?.textContent).toBe("My own title");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Title is too long");
  });

  it("is absent from the visitor's page even if handed an original", async () => {
    await act(async () => root.render(createElement(PublicMetadataPage, {
      slug: SLUG, article: article(), signedIn: false, sessionUnconfirmed: false, sharedBy: "public",
      available: { arc: false, tweets: false, glossary: false, ideas: false, quotes: false,
        timeline: false, sketch: false, skim: false, faq: false, simpleSummary: false,
        bibliography: false, reception: false },
    })));
    expect(host.querySelector("[data-imported-title]")).toBeNull();
    expect(host.textContent).not.toContain(ORIGINAL);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
