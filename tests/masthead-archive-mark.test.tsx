// @vitest-environment jsdom
/**
 * **Archive, beside the sharing mark on the reading view's masthead.**
 *
 * > Add a button at the top of the reading view to archive the article, next
 * > to the button to share it publicly.
 * >
 * > — Greg, 2026-10-01 (spya-br27ef)
 *
 * What a look at the owner's own page would not show:
 *
 *  1. **It starts the right way round.** An article opened while archived
 *     offers Put back, not Archive — which needs `Article.archivedAt` on the
 *     payload, the half of this change a click-through on a fresh article
 *     never exercises.
 *  2. **The press is the Metadata page's**, the same `PATCH` through the same
 *     `useArchive`, and the button shows what the *server* said.
 *  3. **Nobody else gets it** — a visitor, or a payload that could not say.
 *
 * docs/plans/261002a-horizontal-scrollbar-wider-band-on-wide-windows-archive-button-on-the-masthead.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHARING_MARK_ON_ARCHIVED, SHARING_ON } from "../src/messages.js";
import type { Article, Visibility } from "../src/types.js";

/* The one seam that leaves the browser, mocked at the module for
   article-rename.test.tsx's reason. */
const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const { Masthead } = await import("../src/web/Masthead.js");
const { useArchive } = await import("../src/web/useArchive.js");

const SLUG = "a-piece";
const WHEN = "2026-10-01T12:00:00.000Z";

function article(archivedAt: string | null | undefined, visibility: Visibility | undefined): Article {
  return {
    highPowerSince: null,
    meta: { slug: SLUG, title: "A piece", url: "https://example.com/the-piece" },
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
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
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
    ...(visibility === undefined ? {} : { visibility }),
    /* Conditional: under `exactOptionalPropertyTypes` an absent key and an
       explicit `undefined` differ, and absent is the state case 3 is about. */
    ...(archivedAt === undefined ? {} : { archivedAt }),
  };
}

/** The PATCH answer both stores give: the shelf entry, `archivedAt` absent when on the shelf. */
function patched(archivedAt: string | null): Response {
  const entry = { slug: SLUG, title: "A piece", ...(archivedAt ? { archivedAt } : {}) };
  return new Response(JSON.stringify({ entry }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  history.replaceState(null, "", `/read/${SLUG}`);
  apiFetch.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(archivedAt: string | null | undefined, owner: boolean) {
  await act(async () => {
    root.render(createElement(MastheadHarness, { archivedAt, owner }));
  });
}

function MastheadHarness({
  archivedAt,
  owner,
  visibility = "private",
}: {
  archivedAt: string | null | undefined;
  owner: boolean;
  visibility?: Visibility | "unknown";
}) {
  const archive = useArchive(SLUG, archivedAt, archivedAt !== undefined, false);
  return createElement(Masthead, {
    article: article(archivedAt, visibility === "unknown" ? undefined : visibility),
    slug: SLUG,
    ...(owner ? { onRenamed: () => {}, archive } : {}),
  });
}

const button = () => host.querySelector<HTMLButtonElement>('[data-testid="masthead-archive"]');

async function openCard(trigger: Element): Promise<HTMLElement> {
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("mouseenter"));
    await new Promise((r) => setTimeout(r, 400));
  });
  const card = document.querySelector<HTMLElement>(".tip-soon");
  if (!card) throw new Error("no card");
  return card;
}

async function openSharingCard(): Promise<HTMLElement> {
  const mark = host.querySelector<HTMLAnchorElement>(`a[href^="/read/${SLUG}/metadata"]`);
  if (!mark) throw new Error("no sharing mark");
  return openCard(mark);
}

function ViewSwitchHarness({ showMasthead }: { showMasthead: boolean }) {
  const archive = useArchive(SLUG, null, true, false);
  return showMasthead
    ? createElement(Masthead, {
        article: article(null, "private"),
        slug: SLUG,
        onRenamed: () => {},
        archive,
      })
    : createElement("div", { "data-testid": "metadata-view" });
}

describe("the masthead's Archive button", () => {
  it("offers Archive on the shelf, and shows the server's answer after the press", async () => {
    await mount(null, true);
    expect(button()?.getAttribute("aria-label")).toBe("Archive this article");
    expect(button()?.dataset.archived).toBe("false");

    apiFetch.mockResolvedValueOnce(patched(WHEN));
    await act(async () => button()!.click());

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/library/${SLUG}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ archived: true });
    expect(button()?.dataset.archived).toBe("true");
    expect(button()?.getAttribute("aria-label")).toBe("Archived — put back on the shelf");
  });

  it("opens an archived article the right way round, and puts it back", async () => {
    await mount(WHEN, true);
    expect(button()?.dataset.archived).toBe("true");

    apiFetch.mockResolvedValueOnce(patched(null));
    await act(async () => button()!.click());
    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ archived: false });
    expect(button()?.dataset.archived).toBe("false");
  });

  it("updates the sharing card from the same controller after archive and put-back presses", async () => {
    await act(async () =>
      root.render(
        createElement(MastheadHarness, { archivedAt: null, owner: true, visibility: "public" }),
      ),
    );
    const sharing = await openSharingCard();
    expect(sharing.querySelector(".tip-soon-what")?.textContent).toBe(SHARING_ON);

    apiFetch.mockResolvedValueOnce(patched(WHEN));
    await act(async () => button()!.click());
    expect(sharing.querySelector(".tip-soon-what")?.textContent).toBe(SHARING_MARK_ON_ARCHIVED);

    apiFetch.mockResolvedValueOnce(patched(null));
    await act(async () => button()!.click());
    expect(sharing.querySelector(".tip-soon-what")?.textContent).toBe(SHARING_ON);
  });

  it.each([
    [
      null,
      "private",
      "On your shelf",
      "Archiving takes it off your shelf, and can be undone.",
      "Nothing else changes — you stay here and can carry on reading.",
      "Press to archive it.",
    ],
    [
      WHEN,
      "private",
      "Archived",
      "Off your shelf, and still readable here.",
      "Nothing else changes — you stay here and can carry on reading.",
      "Press to put it back on your shelf.",
    ],
    [
      null,
      "public",
      "On your shelf",
      "Archiving takes it off your shelf, and can be undone.",
      "It comes off the public list too, though its public link keeps working. You stay here and can carry on reading.",
      "Press to archive it.",
    ],
    [
      WHEN,
      "public",
      "Archived",
      "Off your shelf, and still readable here.",
      "Putting it back lists it publicly again. Its public link works either way, and you stay here.",
      "Press to put it back on your shelf.",
    ],
  ] as const)(
    "keeps the %s/%s archive card's state, consequences and press apart",
    async (archivedAt, visibility, head, what, how, press) => {
      await act(async () =>
        root.render(createElement(MastheadHarness, { archivedAt, owner: true, visibility })),
      );
      const archive = button();
      if (!archive) throw new Error("no archive mark");
      const card = await openCard(archive);
      expect(card.querySelector(".tip-soon-head")?.textContent).toBe(head);
      expect(card.querySelector(".tip-soon-what")?.textContent).toBe(what);
      expect(card.querySelector(".tip-soon-how")?.textContent).toBe(how);
      expect(card.querySelector(".tip-soon-press")?.textContent).toBe(press);
    },
  );

  it.each([null, WHEN])(
    "does not claim archiving has no other effect when visibility is unknown (%s)",
    async (archivedAt) => {
      await act(async () =>
        root.render(
          createElement(MastheadHarness, { archivedAt, owner: true, visibility: "unknown" }),
        ),
      );
      const archive = button();
      if (!archive) throw new Error("no archive mark");
      const card = await openCard(archive);
      expect(card.querySelector(".tip-soon-how")?.textContent).toMatch(/couldn't be confirmed/i);
      expect(card.querySelector(".tip-soon-how")?.textContent).not.toContain("Nothing else changes");
    },
  );

  it("is not drawn for a visitor", async () => {
    await mount(null, false);
    expect(button()).toBeNull();
  });

  it("is not drawn when the payload could not say", async () => {
    await mount(undefined, true);
    expect(button()).toBeNull();
  });

  it("keeps an answer that settles while the masthead view is unmounted", async () => {
    let answer!: (response: Response) => void;
    apiFetch.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
    await act(async () => root.render(createElement(ViewSwitchHarness, { showMasthead: true })));

    act(() => button()!.click());
    await act(async () => root.render(createElement(ViewSwitchHarness, { showMasthead: false })));
    await act(async () => answer(patched(WHEN)));
    await act(async () => root.render(createElement(ViewSwitchHarness, { showMasthead: true })));

    expect(button()?.dataset.archived).toBe("true");
  });

  it("keeps an unknown result hidden across a view switch", async () => {
    apiFetch.mockRejectedValueOnce(new Error("The response was lost"));
    apiFetch.mockRejectedValueOnce(new Error("The fresh read failed too"));
    await act(async () => root.render(createElement(ViewSwitchHarness, { showMasthead: true })));

    await act(async () => button()!.click());
    expect(button()).toBeNull();
    await act(async () => root.render(createElement(ViewSwitchHarness, { showMasthead: false })));
    await act(async () => root.render(createElement(ViewSwitchHarness, { showMasthead: true })));

    expect(button()).toBeNull();
  });
});
