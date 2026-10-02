// @vitest-environment jsdom
/**
 * **Who can read this, at the top of the page you read it on.**
 *
 * Greg, 2026-09-04:
 *
 * > Make it a bit clearer at the top of an article page with an icon if it's
 * > public or not - actually, make that a clickable button with clear tooltip
 * > that takes you to the profile to change whether the article is
 * > private/public
 *
 * ## What needs a test rather than a look
 *
 * All three of these are invisible on the page anybody building this opens,
 * because that page is an owner's own private article on a store that can
 * answer:
 *
 *  1. **Absent is not `private`.** The filesystem store has no visibility
 *     column and never answers (src/api.ts § `loadArticle`), so a mark that
 *     defaulted to a lock would tell an owner that only they can read an
 *     article nobody was ever asked about — with complete confidence and no way
 *     to be right. It is the sentence `AccessSharing` was rebuilt around, and
 *     it is the class in docs/reusable/silent-success.md.
 *  2. **A visitor gets nothing.** The fact is the owner's, and the destination
 *     is a page a visitor cannot open. `article.visibility` only ever rides on
 *     the owner's payload, so this could only regress by somebody putting it on
 *     the public projection too — at which point nothing else in the suite
 *     would notice.
 *  3. **The view state is carried.** Stepping out to the switch and coming back
 *     has to return the reader to the paragraph they left, which is a `?at=`
 *     riding on the href and is exactly the sort of thing that looks fine on a
 *     page opened at the top.
 *
 * docs/plans/260904b-sharing-mark-on-the-article-masthead.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHARING_MARK_PRESS_PRIVATE,
  SHARING_MARK_PRESS_PUBLIC,
  SHARING_MARK_NAME_PRIVATE,
  SHARING_MARK_NAME_PUBLIC,
  SHARING_MARK_ON_ARCHIVED,
  SHARING_OFF,
  SHARING_ON,
} from "../src/messages.js";
import type { Article, Visibility } from "../src/types.js";
import type { ArchiveControl } from "../src/web/useArchive.js";

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

const SLUG = "a-piece";
const METADATA = `/read/${SLUG}/metadata`;

function article(visibility: Visibility | undefined): Article {
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
    /* Conditional rather than `visibility`, because `exactOptionalPropertyTypes`
       makes an explicit `undefined` a different value from an absent key — and
       the absent one is the state this file is largely about. */
    ...(visibility ? { visibility } : {}),
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // The mark reads `location.search` at render, the way the dock does.
  history.replaceState(null, "", `/read/${SLUG}`);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** The masthead, as the owner sees it (`onRenamed`) or as a visitor does. */
async function mount(visibility: Visibility | undefined, owner: boolean, archivedAt?: string) {
  /* A still controller rather than `useArchive`: this file reads cards, and
     tests/masthead-archive-mark.test.tsx owns the presses. */
  const archive: ArchiveControl = {
    at: archivedAt ?? null,
    lost: false,
    busy: false,
    error: null,
    set: async () => {},
  };
  await act(async () => {
    root.render(
      createElement(Masthead, {
        article: article(visibility),
        slug: SLUG,
        ...(owner ? { onRenamed: () => {}, archive } : {}),
      }),
    );
  });
}

/** Open a masthead control's card by its trigger and return the one card. */
async function cardOf(trigger: Element): Promise<HTMLElement> {
  /* A native `mouseenter` opens it — tooltips.md § Three things about testing
     a card in jsdom. The card is portalled to `<body>`, not into `host`. */
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("mouseenter"));
    await new Promise((r) => setTimeout(r, 400));
  });
  const cards = document.querySelectorAll(".tip-soon");
  expect(cards).toHaveLength(1);
  return cards[0] as HTMLElement;
}

const hrefs = () => [...host.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));

/** Every accessible name in the masthead — this mark is a glyph, so it has no text. */
const names = () =>
  [...host.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label"));

/**
 * **The name and the tooltip are different strings, and that is the assertion.**
 *
 * Floating UI hands the tooltip to the link as `aria-describedby`, so a name
 * holding the same sentence is read out twice. Checking the tooltip *sentence*
 * is absent from the accessible names is how a later tidy-up that collapses the
 * two back into one gets caught. src/messages.ts § `SHARING_MARK_NAME_PUBLIC`.
 */
function marked(name: string, tip: string): void {
  expect(names()).toContain(name);
  expect(names()).not.toContain(tip);
  /* The failure this guards is somebody passing the sentence as both. It was a
     length check — *shorter, as a name should be* — until 2026-10-02, when the
     state sentence lost its appended action and became shorter than the name
     (*"Only you can read this."*), so the length no longer says anything. */
  expect(name).not.toBe(tip);
}

describe("the sharing mark beside the title", () => {
  it("says an article is out in the world, and links to the switch", async () => {
    await mount("public", true);

    marked(SHARING_MARK_NAME_PUBLIC, SHARING_ON);
    expect(names()).not.toContain(SHARING_MARK_NAME_PRIVATE);
    expect(hrefs()).toContain(METADATA);
  });

  it("says a private article is private, rather than saying nothing", async () => {
    await mount("private", true);

    /* **The half the shelf deliberately does not have.** `SharedBadge` draws
       only on a shared article, because a chip on every card is decoration;
       here the question — *would the link I am about to paste work?* — is asked
       exactly as often about a private article, and answering it by absence is
       indistinguishable from a mark that has not loaded. */
    marked(SHARING_MARK_NAME_PRIVATE, SHARING_OFF);
    expect(hrefs()).toContain(METADATA);
  });

  /**
   * **The one this file exists for.** A store with no visibility column answers
   * nothing, and nothing is what must be drawn — not the lock, which is a claim.
   */
  it("draws nothing at all when the store could not say", async () => {
    await mount(undefined, true);

    expect(names()).not.toContain(SHARING_MARK_NAME_PRIVATE);
    expect(names()).not.toContain(SHARING_MARK_NAME_PUBLIC);
    expect(hrefs()).not.toContain(METADATA);
  });

  /**
   * A visitor's payload carries no `visibility` at all, so this is the case
   * above with a second reason. Asserted with the field *present* precisely
   * because the absence would pass on its own and prove nothing: it is the
   * owner gate that has to hold if the public projection ever grows the field.
   */
  it("tells a visitor nothing, even handed the fact", async () => {
    await mount("public", false);

    expect(names()).not.toContain(SHARING_MARK_NAME_PUBLIC);
    expect(hrefs()).not.toContain(METADATA);
  });

  /**
   * **Where the reader had got to, carried across** — the same
   * `carriedSearch(location.search)` the dock's Metadata button uses, so
   * leaving the article to change who can read it and pressing Back returns to
   * the paragraph rather than to the top. `?panel=` is dropped on the way
   * (router.ts § `carriedSearch`): a drawer is not a place you were.
   */
  it("carries the reading position to the metadata page, and drops the panel", async () => {
    history.replaceState(null, "", `/read/${SLUG}?at=spya-aaaaaa&cols=0,1&panel=about`);
    await mount("private", true);

    expect(hrefs()).toContain(`${METADATA}?at=spya-aaaaaa&cols=0,1`);
  });

  /**
   * **The state is a statement, and the press is its own line.** Greg,
   * 2026-10-02 (spya-d886ah), of *"Only you can read this. Share it with
   * anyone."*: *"One sentence is a statement of the current state. The other is
   * a potential action … [with no] UI differentiation between these two kinds
   * of sentence."* So the `what` is the shared state sentence and nothing else,
   * and where pressing goes is `ControlTip`'s `go` line.
   * docs/plans/261002e-sharing-mark-tooltip-separates-state-from-action.md.
   */
  it.each([
    ["private", "Private", SHARING_OFF, SHARING_MARK_PRESS_PRIVATE],
    ["public", "Shared", SHARING_ON, SHARING_MARK_PRESS_PUBLIC],
  ] as const)("keeps the %s state and the press apart in its card", async (visibility, head, what, go) => {
    await mount(visibility, true);
    const link = host.querySelector<HTMLAnchorElement>(`a[href^="${METADATA}"]`);
    if (!link) throw new Error("no sharing mark");
    const card = await cardOf(link);
    expect(card.querySelector(".tip-soon-head")?.textContent).toBe(head);
    expect(card.querySelector(".tip-soon-what")?.textContent).toBe(what);
    expect(card.querySelector(".tip-soon-press")?.textContent).toBe(go);
  });

  /**
   * **Shared and archived is not "listed publicly".** Archiving takes a public
   * article off the public list while its link keeps working
   * (src/store/public-library.ts § the `archivedAt` clause), so both marks have
   * to say so. GPT Sol, plan review of 261002e, finding 1.
   */
  it("does not promise a public listing for a shared article that is archived", async () => {
    await mount("public", true, "2026-09-30T10:00:00Z");
    const link = host.querySelector<HTMLAnchorElement>(`a[href^="${METADATA}"]`);
    if (!link) throw new Error("no sharing mark");
    const sharing = await cardOf(link);
    expect(sharing.querySelector(".tip-soon-what")?.textContent).toBe(SHARING_MARK_ON_ARCHIVED);
    expect(sharing.textContent).not.toContain("it's listed publicly");
  });

  it("says archiving a shared article takes it off the public list", async () => {
    await mount("public", true);
    const button = host.querySelector('[data-testid="masthead-archive"]');
    if (!button) throw new Error("no archive mark");
    const card = await cardOf(button);
    expect(card.querySelector(".tip-soon-how")?.textContent).toMatch(/off the public list/);
  });
});
