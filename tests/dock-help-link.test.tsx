// @vitest-environment jsdom
/**
 * **The Dock's Help link: on a visitor's bar only, and it opens at the part
 * about where you are.** It was on every bar from 2026-10-02
 * (docs/plans/261002b-help-page.md § After GPT Sol's plan review, R5 and R8).
 * Greg, 2026-10-04 (spya-dev7pf): *"We don't need to show the help icon in the
 * bottom bar of reading view … I'm trying to avoid cluttering that bottom bar,
 * but of course we also want to make sure that if people need help, they can
 * get to it."* So it left the bar of anyone who has the command bar, whose
 * Help row opens the same section, and stayed for a visitor, who has none —
 * docs/plans/261004j-bottom-bar-citations-and-glossary-one-left-and-help-leaves-the-bar.md.
 *
 * Four claims, each of which a plausible refactor could break silently:
 *
 *  - **The owner's bar has no Help control, and still has Commands.** The two
 *    are one trade: the link may go only where the command bar is.
 *  - **Every visitor gets it**, signed in or not, on the reading view and on
 *    the Metadata page. The bar has three gates already (visitor, signed in, a
 *    drawer) and a link placed inside the wrong one vanishes for exactly the
 *    reader who most needs it — a stranger on a shared link, who has no
 *    command bar and, in Plain or a mode that is not shared, no (i) either.
 *  - **It follows the band.** The href is computed from `mode`, so a link
 *    computed once, or from somewhere other than the prop, would go on opening
 *    the section for the mode you were in before.
 *  - **It lands.** `navigate()` scrolls to the top after it pushes; the Help
 *    page scrolls to the fragment when it mounts. The second must come after
 *    the first, or the reader arrives at the top of `/help` with the right
 *    fragment in the address and nothing to show for it.
 *
 * The card's shape — two paragraphs, no `title`, not the label said back — is
 * held with the other buttons that are not modes, in
 * tests/dock-mode-tooltips.test.tsx § `NOT_MODES`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Dock } from "../src/web/Dock.js";
import { HelpPage } from "../src/web/help/HelpPage.js";
import { EXPERIMENTAL_ON, EXPERIMENTAL_SIGNED_OUT } from "./helpers/experimental-fixtures.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  history.replaceState(null, "", "/read/a-piece");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  history.replaceState(null, "", "/");
});

function bar(props: Record<string, unknown>): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the bar's arms differ by which props are present, the same cast tests/dock-mode-tooltips.test.tsx makes
      createElement(Dock as any, {
        slug: "a-piece",
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_ON,
        ...props,
      }),
    );
  });
}

/** Every control in the bar with this accessible name. */
function named(label: string): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".dock .dock-btn")].filter(
    (el) => el.getAttribute("aria-label") === label,
  );
}

/** The one control in the bar named Help. */
function helpLink(): HTMLAnchorElement {
  const hits = named("Help");
  expect(hits, "no single bar control named Help").toHaveLength(1);
  const el = hits[0] as HTMLElement;
  expect(el.tagName, "Help is not a link").toBe("A");
  return el as HTMLAnchorElement;
}

/** The bar off the reading view, where there is no band and no `mode`. */
function metadataBar(props: Record<string, unknown>): void {
  history.replaceState(null, "", "/read/a-piece/metadata");
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as above
      createElement(Dock as any, {
        slug: "a-piece",
        view: "metadata",
        experimental: EXPERIMENTAL_ON,
        ...props,
      }),
    );
  });
}

/** The props of a drawer, which is how the real reading view says *visitor*. */
function drawer(visitor: boolean): Record<string, unknown> {
  return {
    comments: [],
    loaded: true,
    loadError: null,
    panel: null,
    onPanel: () => {},
    onOpenComment: () => {},
    visitor,
  };
}

describe("the Help link in the Dock", () => {
  /* The trade, both halves in one case: no Help control, and the Commands
     button whose Help row replaces it. */
  it("is not drawn for the owner, who has the command bar instead", () => {
    for (const mode of ["plain", "chat"]) {
      bar({ mode });
      expect(named("Help"), `an owner's bar in ${mode} draws Help`).toHaveLength(0);
      expect(named("Commands"), "the owner's bar has no Commands button").toHaveLength(1);
    }
    bar({ mode: "chat", drawer: drawer(false) });
    expect(named("Help")).toHaveLength(0);
    expect(named("Commands")).toHaveLength(1);
    metadataBar({});
    expect(named("Help"), "an owner's Metadata bar draws Help").toHaveLength(0);
    expect(named("Commands")).toHaveLength(1);
  });

  it("opens at the section for the mode the band is in", () => {
    bar({ mode: "chat", visitor: true });
    expect(helpLink().getAttribute("href")).toBe("/help#mode-chat");
  });

  it("follows the band when the mode changes", () => {
    bar({ mode: "glossary", visitor: true });
    expect(helpLink().getAttribute("href")).toBe("/help#mode-glossary");
    bar({ mode: "structure", visitor: true });
    expect(helpLink().getAttribute("href")).toBe("/help#mode-structure");
  });

  /* Plain is a mode with a section of its own, but in Plain there is nothing
     on screen except the reading view itself, so that is what Help is about.
     The same with Marginalia's column on and no band: it is a column beside
     the prose, not a mode the band is in. */
  it("opens at the reading view in Plain, with or without the margin column", () => {
    bar({ mode: "plain", visitor: true });
    expect(helpLink().getAttribute("href")).toBe("/help#the-reading-view");
    bar({ mode: "plain", margin: true, visitor: true });
    expect(helpLink().getAttribute("href")).toBe("/help#the-reading-view");
  });

  it("is drawn for a signed-out visitor", () => {
    bar({ mode: "summary", visitor: true, experimental: EXPERIMENTAL_SIGNED_OUT });
    expect(helpLink().getAttribute("href")).toBe("/help#mode-summary");
    expect(named("Commands")).toHaveLength(0);
  });

  /* Somebody signed in, reading another person's shared article: still a
     visitor, so no command bar, though their bar has the switch and Feedback.
     Said through the drawer, which is how the real reading view says it. */
  it("is drawn for a signed-in visitor, who has no command bar either", () => {
    bar({ mode: "summary", drawer: drawer(true), experimental: EXPERIMENTAL_ON });
    expect(helpLink().getAttribute("href")).toBe("/help#mode-summary");
    expect(named("Commands"), "a visitor's bar draws Commands").toHaveLength(0);
  });

  /* No `mode` reaches the bar there, so it is the reading view's section
     whatever `?mode=` the address carries. */
  it("is drawn for a visitor off the reading view, where there is no band", () => {
    for (const experimental of [EXPERIMENTAL_ON, EXPERIMENTAL_SIGNED_OUT]) {
      metadataBar({ visitor: true, experimental });
      expect(helpLink().getAttribute("href")).toBe("/help#the-reading-view");
      expect(named("Commands"), "a visitor's Metadata bar draws Commands").toHaveLength(0);
    }
  });

  /**
   * **A press lands on the section, not at the top of the page.** `Link`
   * calls `navigate()`, which pushes `/help#mode-chat` and then scrolls the
   * window to the top — synchronously, inside the click. The Help page is a
   * lazy route, so it mounts later, and its mount effect is what scrolls to the
   * fragment. This pins that order with the real `Link` and the real page.
   * App's router is not mounted here, so the route change is stood in for by
   * rendering `HelpPage` after the click, which is the one step App adds.
   */
  it("lands on the section after a press, because the page scrolls after navigate does", () => {
    const events: string[] = [];
    const scrollTo = window.scrollTo;
    window.scrollTo = (() => events.push("top")) as typeof window.scrollTo;
    Element.prototype.scrollIntoView = function (this: Element) {
      events.push(`section:${this.id}`);
    };
    try {
      bar({ mode: "chat", visitor: true });
      act(() => {
        helpLink().dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
        );
      });
      expect(location.pathname + location.hash).toBe("/help#mode-chat");
      act(() => root.render(createElement(HelpPage)));
      expect(events).toEqual(["top", "section:mode-chat"]);
    } finally {
      window.scrollTo = scrollTo;
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
