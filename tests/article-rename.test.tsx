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
    /* Absent, and that is the third state: this article has never been through the
       `assets` step, so the reader hot-links exactly as before. src/assets.ts. */
    assets: undefined,
    navLabelStatus: "ready",
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
let renamed: ReturnType<typeof vi.fn<(slug: string, title: string) => void>>;

/**
 * `slug` defaults to the article's own, and is passed separately on purpose:
 * the two come apart on any address with no article of its own, which is the
 * bug the third test below is about.
 */
function mount(title = "The Barn Owl", slug = SLUG) {
  renamed = vi.fn<(slug: string, title: string) => void>();
  act(() => {
    root.render(<Masthead article={article(title)} slug={slug} onRenamed={renamed} />);
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
    // must show, and a clear is the case where the two differ entirely. And the
    // slug goes with it, because this resolves after the page that asked may
    // have gone.
    expect(renamed).toHaveBeenCalledWith(SLUG, "Saved By The Server");
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
    expect(renamed).toHaveBeenCalledWith(SLUG, "What The Site Called It");
  });

  it("renames the address, not whatever meta.json happens to say", async () => {
    /* **The bug this file exists for.** An address with no article of its own
       is answered with the committed fixture — meta.json and all — so
       `/read/anything` gets a `meta.slug` of `noema-mythology-of-conscious-ai`
       (src/api.ts § loadArticle, example/meta.json). Renaming through that
       PATCHed the *real* Noema article's shelf row while appearing to rename
       the thing on screen, and reverted on reload. GPT Sol, 2026-08-27. */
    renamed = vi.fn<(slug: string, title: string) => void>();
    act(() => {
      root.render(
        <Masthead
          article={{
            ...article("The Mythology Of Conscious AI"),
            meta: { ...article("The Mythology Of Conscious AI").meta, slug: "somebody-elses-slug" },
          }}
          slug="the-address-in-the-bar"
          onRenamed={renamed}
        />,
      );
    });
    act(() => pencil().click());
    type("Mine now");
    submit();

    expect((apiFetch.mock.calls[0] as [string, RequestInit])[0]).toBe(
      "/api/library/the-address-in-the-bar",
    );
    await act(async () => {});
    expect(renamed).toHaveBeenCalledWith("the-address-in-the-bar", "Saved By The Server");
  });

  it("lets the newer of two overlapping writes win", async () => {
    /* Submit, reopen, submit again — and nothing makes the first answer arrive
       before the second. Applied in arrival order, the reader watches their
       newer title turn back into their older one with both writes having
       succeeded. GPT Sol, 2026-08-27. */
    const answers: Array<(r: Response) => void> = [];
    apiFetch.mockImplementation(
      () => new Promise<Response>((resolve) => answers.push(resolve)),
    );
    mount("The Barn Owl");

    act(() => pencil().click());
    type("First");
    submit();
    act(() => pencil().click());
    type("Second");
    submit();
    expect(answers).toHaveLength(2);

    // The second answer lands, then the first — the order that breaks it.
    await act(async () => {
      answers[1]?.(patched("Second", true));
    });
    await act(async () => {
      answers[0]?.(patched("First", true));
    });

    expect(renamed).toHaveBeenCalledTimes(1);
    expect(renamed).toHaveBeenCalledWith(SLUG, "Second");
  });

  it("puts focus back on the pencil rather than on the body", () => {
    mount("The Barn Owl");
    act(() => pencil().click());
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    // React unmounts the element the reader is standing on, so without the
    // rescue in EditableTitle the next Tab starts from the top of the document.
    expect(document.activeElement).toBe(pencil());
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
    // The server's own sentence, not ours: the prose around it is not pinned
    // here, per docs/project/copy.md.
    expect(find('[role="alert"]').textContent).toContain("No such article");
  });
});

/**
 * The other half of the same feature.
 *
 * Only two things here are the metadata page's own — that the pencil is on it
 * at all, and that it is **withheld on the fixture**, which is the same refusal
 * Archive makes a few sections further down: an unknown address has no shelf row,
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
      root.render(<Metadata
          slug={SLUG}
          article={article("The Barn Owl")}
          onRenamed={vi.fn<(slug: string, title: string) => void>()}
          onVisibility={() => {}}
        />);
    });
  }

  it("offers the pencil beside the heading", async () => {
    await page(SLUG);
    expect(find("h1").textContent).toBe("The Barn Owl");
    act(() => pencil().click());
    expect(input().value).toBe("The Barn Owl");
  });

  it("withholds it until it knows which address this is", async () => {
    /* `provenance` is null both before the request lands and after it fails,
       and `showingFixture` is therefore false in a state that is really "not
       yet told". The first version drew the pencil for that moment on every
       address, including the ones where pressing it PATCHes a row that does not
       exist. GPT Sol, 2026-08-27. */
    let answer: ((r: Response) => void) | null = null;
    apiFetch.mockImplementation(() => new Promise<Response>((r) => (answer = r)));
    await act(async () => {
      root.render(
        <Metadata
          slug={SLUG}
          article={article("The Barn Owl")}
          onRenamed={vi.fn<(slug: string, title: string) => void>()}
          onVisibility={() => {}}
        />,
      );
    });
    expect(host.querySelector('button[aria-label="Edit title"]')).toBeNull();

    await act(async () => {
      (answer as unknown as (r: Response) => void)(provenance(SLUG));
    });
    expect(host.querySelector('button[aria-label="Edit title"]')).not.toBeNull();
  });

  it("withholds it when the address has no article of its own", async () => {
    // `dir: "example"` under some other slug is how `loadArticle` says "there is
    // nothing here, you are looking at the committed fixture" — src/api.ts.
    await page("example");
    expect(host.querySelector('button[aria-label="Edit title"]')).toBeNull();
    expect(find("h1").textContent).toBe("The Barn Owl");
  });
});

/**
 * **That the rename hook is mounted only for an owner.**
 *
 * `useArticleRename` holds an authenticated `PATCH /api/library/:slug`. Until
 * 2026-08-28 `Masthead` called it unconditionally — for visitors too — with a
 * no-op callback and `offer={false}` under it. Nothing structural stopped the
 * trigger being reachable; only a boolean somebody could flip while thinking
 * about something else. GPT Sol called it a convention rather than a seam.
 *
 * A source-level assertion, and labelled honestly as one, exactly like
 * `tests/glossary-band-wiring.test.ts`: the hook makes no request on mount, so
 * the network trace cannot see it, and the property that matters is *where the
 * call is written*. It reads text and cannot tell a call in dead code from one
 * that runs — but it catches the specific regression, which is the hook
 * climbing back up into the shared component.
 */
describe("the masthead's rename seam", () => {
  it("calls useArticleRename once, inside the owner-only component", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await readFile(
      path.resolve(import.meta.dirname, "..", "src/web/Masthead.tsx"),
      "utf8",
    );

    expect(src.match(/useArticleRename\(/g) ?? []).toHaveLength(1);

    /* And it is inside `RenameableTitle`, which `Masthead` renders only when it
       was given an `onRenamed` — i.e. only for the owner. Sliced from that
       function's declaration to the end of the file, which is where it sits. */
    const owned = src.slice(src.indexOf("function RenameableTitle("));
    expect(owned).toContain("useArticleRename(");

    /* The no-op that used to stand in for a visitor's callback is gone with the
       arrangement that needed it. Its survival would mean the unconditional
       call had come back. */
    expect(src).not.toContain("noRename");
  });
});

/**
 * ## The editor takes the keyboard when it opens
 *
 * **This is a proxy, and saying so is the point.** `TitleEditor` focuses the
 * rename input with `ref.current?.select()`, and what a reader gets from that
 * is *focus* — click the pencil, start typing. But focus is exactly the half
 * jsdom will not show:
 *
 * | | jsdom | real Chrome |
 * | --- | --- | --- |
 * | `input.select()` moves focus | **no** | **yes** |
 * | it sets `selectionStart`/`selectionEnd` | yes | yes |
 *
 * Measured on this box, 2026-09-07, in system Chrome via Playwright and in
 * jsdom side by side. So under test the call visibly does *something* while the
 * one thing it does not do is the thing the component wants, and an assertion
 * about `document.activeElement` here would be asking about a world the reader
 * is not in — which is the class
 * docs/postmortems/260907b-a-test-blurred-away-the-condition-it-existed-to-test.md
 * names, arriving from the harness rather than from a helper.
 *
 * **What is unguarded without this**, established by mutation rather than
 * suspected: replacing that `select()` with a no-op leaves every other test in
 * this file green. The feature can be deleted in silence, and a reader would
 * have to click the pencil and then click again before they could type.
 *
 * So this pins the *mechanism* — the call happens, on the right element, on
 * mount — and the browser fact above is what carries it the rest of the way.
 * The chain is stated rather than implied, because a proxy nobody labels is how
 * a test starts meaning less than it appears to.
 */
describe("the editor takes the keyboard when it opens", () => {
  it("selects the whole title on mount, which is what focuses it for a reader", () => {
    const select = vi.spyOn(HTMLInputElement.prototype, "select");
    try {
      mount("The Barn Owl");
      expect(select).not.toHaveBeenCalled();

      act(() => pencil().click());

      expect(select).toHaveBeenCalledTimes(1);
      /* On the title box, not on some other input that happened to mount. */
      expect(select.mock.instances[0]).toBe(input());
    } finally {
      select.mockRestore();
    }
  });
});
