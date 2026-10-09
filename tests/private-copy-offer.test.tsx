// @vitest-environment jsdom
/**
 * **A private copy of somebody else's public article** — option B of plan
 * 261006k, which Greg chose: *"B yes probably it would be nice to be able to
 * add a private copy to your own shelf (perhaps in Metadata)"* (2026-10-06).
 * docs/plans/261007m-a-private-copy-of-a-public-article-on-your-own-shelf.md.
 *
 * What is pinned is who is offered it, where the press goes, and that a reader
 * who already holds the article is taken to their copy rather than to an add.
 * The prose is not pinned.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicSharedBy } from "../src/public-types.js";
import type { LibraryEntry } from "../src/types.js";
import { SharedNotice, VisitorBand, privateCopyOffer } from "../src/web/PublicChrome.js";
import { addHref, readHref } from "../src/web/router.js";
import { SearchPanel } from "../src/web/SearchPanel.js";
import type { ShelfLookup } from "../src/web/link-facts.js";

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (url: string) => {
    asked.push(url);
    return shelfAnswer();
  },
  readJson: async (response: Response) => response.json(),
}));

const { noteReader } = await import("../src/web/lib/reader-change.js");
const { useShelfEntry } = await import("../src/web/link-facts.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let asked: string[] = [];
let shelfAnswer: () => Promise<Response>;
let host: HTMLDivElement;
let root: Root;
let readerNumber = 0;
const jsonShelf = (slug: string) => new Response(JSON.stringify({ articles: [{ slug, url: ADDRESS }] }));

beforeEach(() => {
  // A new reader empties the real module cache between cases.
  noteReader(`reader-${++readerNumber}`);
  asked = [];
  shelfAnswer = async () => jsonShelf("my-copy");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const ADDRESS = "https://www.example.com/2026/the-piece";

const FACTS = {
  signedIn: true,
  sessionUnconfirmed: false,
  sharedBy: "public" as PublicSharedBy,
  copyFrom: ADDRESS as string | null,
};
const ABSENT: ShelfLookup = { kind: "absent" };
const emptyShelf = async () => new Response(JSON.stringify({ articles: [] }));

describe("who is offered a private copy", () => {
  it("a signed-in visitor on a public article with a published address: an add", () => {
    expect(privateCopyOffer({ ...FACTS, shelf: ABSENT })).toEqual({ kind: "add", href: addHref(ADDRESS) });
  });

  it("nobody signed out: they are offered an account instead", () => {
    expect(privateCopyOffer({ ...FACTS, signedIn: false, shelf: ABSENT })).toBeNull();
  });

  /* A session the server would not confirm cannot add anything either. */
  it("nobody whose session could not be confirmed", () => {
    expect(privateCopyOffer({ ...FACTS, sessionUnconfirmed: true, shelf: ABSENT })).toBeNull();
  });

  it("nobody on a private link", () => {
    expect(privateCopyOffer({ ...FACTS, sharedBy: "link", shelf: ABSENT })).toBeNull();
  });

  /* An upload, or an address the public policy withheld: never a guess. */
  it("nobody when the page carries no address", () => {
    expect(privateCopyOffer({ ...FACTS, copyFrom: null, shelf: ABSENT })).toBeNull();
  });

  it("a reader who already has it is taken to their copy, not to an add", () => {
    const entry = { slug: "my-copy", url: ADDRESS } as LibraryEntry;
    expect(privateCopyOffer({ ...FACTS, shelf: { kind: "held", entry } })).toEqual({
      kind: "open",
      href: readHref("my-copy", "", "article"),
    });
  });

  /* The browser check saw *Add* for seconds, then a flip to *Open your copy*. */
  it("nothing at all while the shelf is still being asked", () => {
    expect(privateCopyOffer({ ...FACTS, shelf: { kind: "asking" } })).toBeNull();
  });
});

describe("before the shelf answers", () => {
  it("the banner draws no offer, rather than an add that may be wrong", () => {
    expect(renderToStaticMarkup(createElement(SharedNotice, FACTS))).not.toContain("data-private-copy");
  });
});

/* The three places it is drawn: the banner (which the Metadata page draws too),
   the band a visitor meets on Chat and the other owner's modes, and the
   visitor's search panel. On a phone a covering band hides the banner, so the
   last two are the only places the offer is on screen there. */
describe("the mounted offer, with a shelf that does not hold the article", () => {
  beforeEach(() => {
    shelfAnswer = emptyShelf;
  });
  const add = () => host.querySelector('[data-private-copy="add"] a')?.getAttribute("href");

  it("the banner links the add page", async () => {
    await act(async () => root.render(createElement(SharedNotice, FACTS)));
    expect(add()).toBe(addHref(ADDRESS));
  });

  /* **The press is the reader choosing their own copy**, so the add page does
     not ask whether they would rather read this public one (plan 261009j). A
     ⌘-click opens another tab the mark cannot reach, so it marks nothing. */
  it("a plain press marks the address as the reader's own copy; a ⌘-press does not", async () => {
    const { takeOwnCopyIntent } = await import("../src/web/own-copy-intent.js");
    await act(async () => root.render(createElement(SharedNotice, FACTS)));
    const link = host.querySelector<HTMLAnchorElement>('[data-private-copy="add"] a')!;
    const click = (init: MouseEventInit) =>
      act(() => {
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
      });
    click({ metaKey: true });
    expect(takeOwnCopyIntent(ADDRESS)).toBe(false);
    click({});
    expect(takeOwnCopyIntent(ADDRESS)).toBe(true);
    expect(takeOwnCopyIntent(ADDRESS), "answered twice").toBe(false);
  });

  it("so does the visitor's band", async () => {
    await act(async () =>
      root.render(<VisitorBand gap={{ kind: "owners-only", feature: "Chat" }} copy={FACTS} />),
    );
    expect(add()).toBe(addHref(ADDRESS));
  });

  it("and the visitor's search panel", async () => {
    await act(async () =>
      root.render(
        <SearchPanel
          access={{ kind: "visitor", copy: FACTS }}
          matcher="meaning"
          onMatcher={() => {}}
          find={null}
          onFind={() => {}}
          runs={[]}
          active={[]}
          slots={new Map()}
          onToggle={() => {}}
          onSolo={() => {}}
          onToggleAll={() => {}}
          found={[]}
          all={[]}
          order="document"
          onOrder={() => {}}
          gate={0}
          gateMoved={false}
          onGate={() => {}}
          openKey={null}
          onOpen={() => {}}
        />,
      ),
    );
    expect(add()).toBe(addHref(ADDRESS));
  });

  it("but not for a signed-out visitor, who is offered an account", async () => {
    const out = { ...FACTS, signedIn: false };
    await act(async () =>
      root.render(
        <>
          <SharedNotice {...out} />
          <VisitorBand gap={{ kind: "owners-only", feature: "Chat" }} copy={out} />
        </>,
      ),
    );
    expect(host.querySelector("[data-private-copy]")).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe("the mounted private-copy offer", () => {
  async function draw(over: Partial<typeof FACTS> = {}) {
    await act(async () => root.render(createElement(SharedNotice, { ...FACTS, ...over })));
  }

  it("shares one shelf request between the banner and the mode band", async () => {
    await act(async () => root.render(<>
      <SharedNotice {...FACTS} />
      <VisitorBand gap={{ kind: "owners-only", feature: "Chat" }} copy={FACTS} />
    </>));
    expect(asked).toEqual(["/api/library"]);
    expect(host.querySelectorAll('[data-private-copy="open"]')).toHaveLength(2);
  });

  it("never asks the shelf while the offer is ineligible, including across prop changes", async () => {
    for (const over of [
      { signedIn: false }, { sessionUnconfirmed: true }, { sharedBy: "link" as const }, { copyFrom: null },
    ]) await draw(over);
    expect(asked).toEqual([]);
    expect(host.querySelector("[data-private-copy]")).toBeNull();
    await draw();
    expect(asked).toEqual(["/api/library"]);
    expect(host.querySelector('[data-private-copy="open"] a')?.getAttribute("href"))
      .toBe(readHref("my-copy", "", "article"));
    await draw({ signedIn: false });
    expect(host.querySelector("[data-private-copy]")).toBeNull();
    expect(asked).toHaveLength(1);
  });

  /* A shelf that cannot be read is not retried this session, so the offer
     falls back to the add, which the server makes free for a repeat. */
  it("offers the add when the shelf cannot be read", async () => {
    shelfAnswer = async () => {
      throw new Error("offline");
    };
    await draw();
    expect(host.querySelector('[data-private-copy="add"] a')?.getAttribute("href")).toBe(addHref(ADDRESS));
  });

  it("reads the next reader's shelf even if the hook stays mounted at the same address", async () => {
    function Probe() {
      const found = useShelfEntry(ADDRESS);
      return <span>{found.kind === "held" ? found.entry.slug : found.kind}</span>;
    }
    await act(async () => root.render(<Probe />));
    expect(host.textContent).toBe("my-copy");
    shelfAnswer = async () => jsonShelf("next-readers-copy");
    await act(async () => noteReader("next-reader"));
    expect(host.textContent).toBe("next-readers-copy");
    expect(asked).toEqual(["/api/library", "/api/library"]);
  });
});
