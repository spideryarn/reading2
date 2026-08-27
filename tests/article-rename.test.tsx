// @vitest-environment jsdom
/**
 * **Renaming an article from the page you are reading it on.**
 *
 * Greg asked for the shelf's pencil to appear on the article itself and on its
 * metadata page (2026-08-27), which made a rename three controls rather than
 * one — and a rename has three outcomes that all look identical when the happy
 * path works: cancelled, cleared, and unchanged. Each of those is a request
 * that must NOT be sent, or must be sent with `null` rather than with a string,
 * and none of them shows up in a browser pass unless you happen to try it.
 *
 * So the flow is mounted rather than reasoned about. What is checked here:
 *
 *  - the pencil opens an editor holding the current title;
 *  - Enter writes `PATCH /api/library/:slug { title }`, and the new title comes
 *    back from the **server** rather than from the input — the case that makes
 *    that matter is clearing the field, where what the reader should then see
 *    is the extractor's title, a string this page does not have;
 *  - Escape sends nothing, and Enter on an untouched field sends nothing;
 *  - a failed write leaves the heading alone and says so.
 *
 * The masthead is the mount, because it is the harder of the two — it has the
 * article payload and no shelf entry, so it is the site that cannot know
 * whether the title on screen is the reader's own. `Metadata` uses the same
 * hook and the same editor (TitleEditor.tsx), and the fixture guard on its
 * pencil is checked at the end.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, BlockId } from "../src/types.js";

/* The one seam that leaves the browser. Mocked at the module rather than by
   stubbing `fetch`, because `apiFetch` reaches for a Supabase session on its
   way out and the thing under test is the rename, not the token. `readJson` is
   the real one: what it does with a failing response — see lib/api.ts — is
   exactly what the error case below is asserting about. */
const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

/* The metadata page's two neighbours, stubbed. `nuqs` needs an adapter above
   the tree and the only parameter this page reads is where the reader had got
   to; the dock is a fixed bar with its own fetches. Neither is what the pencil
   below is about. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { Masthead } = await import("../src/web/Masthead.js");
const { Metadata } = await import("../src/web/Metadata.js");

const SLUG = "a-piece-about-owls";

function article(title: string): Article {
  const id = "spya-owl001" as BlockId;
  return {
    meta: { slug: SLUG, title, byline: "A Writer", siteName: "Somewhere" },
    blocks: [
      { id, tag: "p", kind: "text", text: "Owls are quiet.", words: 3, html: "<p>Owls are quiet.</p>", gistable: true },
    ],
    tree: {
      version: "1",
      generator: "test",
      slug: SLUG,
      sourceHash: "x",
      rootId: "n0",
      nodes: {
        n0: { id: "n0", depth: 0, blockIds: [id], childIds: [], gist: "About owls." },
      },
      generatedAt: "2026-08-27T00:00:00.000Z",
      elapsedMs: 1,
    } as unknown as Article["tree"],
  };
}

/** The server's answer to a PATCH: the entry, as `describeArticle` builds it. */
function patched(title: string, overridden: boolean): Response {
  return new Response(
    JSON.stringify({
      entry: { slug: SLUG, title, minutes: 1, blocks: 1, ...(overridden ? { titleOverridden: true } : {}) },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

let host: HTMLDivElement;
let root: Root;
let renamed: ReturnType<typeof vi.fn<(title: string) => void>>;

function mount(title = "The Barn Owl") {
  renamed = vi.fn<(title: string) => void>();
  act(() => {
    root.render(<Masthead article={article(title)} onRenamed={renamed} />);
  });
}

function find<T extends Element>(selector: string): T {
  const el = host.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matched ${selector}`);
  return el;
}

/** The pencil, by the name a screen reader would read out. */
const pencil = () => find<HTMLButtonElement>('button[aria-label="Edit title"]');
const input = () => find<HTMLInputElement>('input[aria-label="Title"]');

function type(value: string) {
  const el = input();
  act(() => {
    // React listens for `input`, not `change`, and reads the value off its own
    // descriptor — hence the setter rather than a plain assignment.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submit() {
  act(() => {
    find<HTMLFormElement>("form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(patched("Saved By The Server", true));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("renaming from the masthead", () => {
  it("opens an editor holding the title that is on screen", () => {
    mount("The Barn Owl");
    expect(host.querySelector('input[aria-label="Title"]')).toBeNull();
    act(() => pencil().click());
    expect(input().value).toBe("The Barn Owl");
    // The heading is replaced, not duplicated — two titles on screen is the
    // shape where one of them goes stale.
    expect(host.querySelector("h1")).toBeNull();
  });

  it("writes the typed title, and takes the answer from the server", async () => {
    mount("The Barn Owl");
    act(() => pencil().click());
    type("  Owls, revisited  ");
    submit();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/library/${SLUG}`);
    expect(init.method).toBe("PATCH");
    // Trimmed on the way out, as the shelf's editor has always done.
    expect(JSON.parse(String(init.body))).toEqual({ title: "Owls, revisited" });

    await act(async () => {});
    // NOT "Owls, revisited": the store's answer is what the rest of the app
    // must show, and a clear is the case where the two differ entirely.
    expect(renamed).toHaveBeenCalledWith("Saved By The Server");
  });

  it("clears the override with null rather than with an empty string", async () => {
    apiFetch.mockResolvedValue(patched("What The Site Called It", false));
    mount("A Title The Reader Chose");
    act(() => pencil().click());
    type("   ");
    submit();

    expect(JSON.parse(String((apiFetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      title: null,
    });
    await act(async () => {});
    expect(renamed).toHaveBeenCalledWith("What The Site Called It");
  });

  it("sends nothing when the reader escapes", () => {
    mount("The Barn Owl");
    act(() => pencil().click());
    type("Half a thought");
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(host.querySelector('input[aria-label="Title"]')).toBeNull();
    expect(find("h1").textContent).toBe("The Barn Owl");
  });

  it("sends nothing when the title has not changed", () => {
    mount("The Barn Owl");
    act(() => pencil().click());
    submit();
    // An unchanged Enter that wrote would mark the extractor's own title as the
    // reader's, which is a lie the shelf tooltip then repeats.
    expect(apiFetch).not.toHaveBeenCalled();
    expect(renamed).not.toHaveBeenCalled();
  });

  it("says so when the write fails, and leaves the heading alone", async () => {
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "No such article" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    mount("The Barn Owl");
    act(() => pencil().click());
    type("Owls, revisited");
    submit();
    await act(async () => {});

    expect(renamed).not.toHaveBeenCalled();
    expect(find("h1").textContent).toBe("The Barn Owl");
    const alert = find('[role="alert"]');
    expect(alert.textContent).toContain("Couldn't rename it");
    expect(alert.textContent).toContain("No such article");
  });
});

/**
 * The other half of the same feature.
 *
 * Only two things here are the metadata page's own — that the pencil is on it
 * at all, and that it is **withheld on the fixture**, which is the same refusal
 * Delete makes a few sections further down: an unknown address has no shelf row,
 * so the PATCH behind the button would 404 and pressing it is how you would
 * find out. Everything else about the rename is the block above, because it is
 * literally the same hook and the same editor.
 */
describe("renaming from the metadata page", () => {
  /** What `GET /api/metadata/:slug` answers, with the artefacts wherever we say. */
  function provenance(dir: string): Response {
    return new Response(
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
    );
  }

  async function page(dir: string) {
    apiFetch.mockResolvedValue(provenance(dir));
    await act(async () => {
      root.render(<Metadata slug={SLUG} article={article("The Barn Owl")} onRenamed={vi.fn<(title: string) => void>()} />);
    });
  }

  it("offers the pencil beside the heading", async () => {
    await page(SLUG);
    expect(find("h1").textContent).toBe("The Barn Owl");
    act(() => pencil().click());
    expect(input().value).toBe("The Barn Owl");
  });

  it("withholds it when the address has no article of its own", async () => {
    // `dir: "example"` under some other slug is how `loadArticle` says "there is
    // nothing here, you are looking at the committed fixture" — src/api.ts.
    await page("example");
    expect(host.querySelector('button[aria-label="Edit title"]')).toBeNull();
    expect(find("h1").textContent).toBe("The Barn Owl");
  });
});
