// @vitest-environment jsdom
/**
 * **The Dock's Help link: on every bar, and it opens at the part about where
 * you are.** It was on every bar from 2026-10-02
 * (docs/plans/261002b-help-page.md § After GPT Sol's plan review, R5 and R8).
 * Greg, 2026-10-04 (spya-dev7pf): *"We don't need to show the help icon in the
 * bottom bar of reading view … I'm trying to avoid cluttering that bottom bar,
 * but of course we also want to make sure that if people need help, they can
 * get to it."* So for three days it was on a visitor's bar only, the one bar
 * with no command bar
 * (docs/plans/261004j-bottom-bar-citations-and-glossary-one-left-and-help-leaves-the-bar.md).
 * Then Greg, 2026-10-06 (spya-ucftjt): *"I think in a previous message I
 * suggested that you hide the help icon from the bottom bar. I'm second
 * guessing that. Maybe it does make sense to keep it down there towards the
 * bottom right."* So it is on every bar again from 2026-10-07 —
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md.
 *
 * Four claims, each of which a plausible refactor could break silently:
 *
 *  - **The owner's bar has exactly one Help control, and still has
 *    Commands.** The link came back beside the command bar's Help row, not
 *    in place of it; a gate left behind, or the link drawn in two arms, is
 *    what this would notice.
 *  - **Every visitor gets it**, signed in or not, on the reading view and on
 *    the Metadata page. The bar has three gates already (visitor, signed in, a
 *    drawer) and a link placed inside the wrong one vanishes for exactly the
 *    reader who most needs it — a stranger on a shared link, who has no
 *    command bar and, in Plain or a mode that is not shared, no (i) either.
 *  - **It follows the band.** The href is computed from `mode`, so a link
 *    computed once, or from somewhere other than the prop, would go on opening
 *    the section for the mode you were in before.
 *  - **It lands.** A press opens the page of Help for that mode, at its top,
 *    with the real `Link` and the real page. Until 2026-10-07 the mode was a
 *    fragment of one long page and this pinned that the page's own scroll
 *    came after `navigate()`'s scroll to the top; a mode has a page of its
 *    own now, so the top is where it should be, and what is left to pin is
 *    that the address the bar builds is one Help draws a page at.
 *
 * The card's shape — two paragraphs, no `title`, not the label said back — is
 * held with the other buttons that are not modes, in
 * tests/dock-mode-tooltips.test.tsx § `NOT_MODES`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MODES } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import { Dock } from "../src/web/Dock.js";
import { resolveHelpPage } from "../src/web/help/help-anchors.js";
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
  /* Both doors, on every bar the owner has: one Help link (`helpLink()`
     insists on exactly one) and the Commands button whose Help row opens the
     same section. */
  it("is drawn once for the owner, beside the command bar, on every bar", () => {
    for (const mode of ["plain", "chat"]) {
      bar({ mode });
      helpLink();
      expect(named("Commands"), "the owner's bar has no Commands button").toHaveLength(1);
    }
    bar({ mode: "chat", drawer: drawer(false) });
    helpLink();
    expect(named("Commands")).toHaveLength(1);
    metadataBar({});
    expect(helpLink().getAttribute("href")).toBe("/help/the-reading-view");
    expect(named("Commands")).toHaveLength(1);
  });

  /* The owner's link is the visitor's link: one rule for which section,
     whoever is reading. */
  it("follows the band on the owner's bar just as it does on a visitor's", () => {
    bar({ mode: "plain" });
    expect(helpLink().getAttribute("href")).toBe("/help/the-reading-view");
    bar({ mode: "chat" });
    expect(helpLink().getAttribute("href")).toBe("/help/mode-chat");
    bar({ mode: "glossary", drawer: drawer(false) });
    expect(helpLink().getAttribute("href")).toBe("/help/mode-glossary");
  });

  it("opens at the section for the mode the band is in", () => {
    bar({ mode: "chat", visitor: true });
    expect(helpLink().getAttribute("href")).toBe("/help/mode-chat");
  });

  it("follows the band when the mode changes", () => {
    bar({ mode: "glossary", visitor: true });
    expect(helpLink().getAttribute("href")).toBe("/help/mode-glossary");
    bar({ mode: "structure", visitor: true });
    expect(helpLink().getAttribute("href")).toBe("/help/mode-structure");
  });

  /* Plain is a mode with a section of its own, but in Plain there is nothing
     on screen except the reading view itself, so that is what Help is about.
     The same with Marginalia's column on and no band: it is a column beside
     the prose, not a mode the band is in. */
  it("opens at the reading view in Plain, with or without the margin column", () => {
    bar({ mode: "plain", visitor: true });
    expect(helpLink().getAttribute("href")).toBe("/help/the-reading-view");
    bar({ mode: "plain", margin: true, visitor: true });
    expect(helpLink().getAttribute("href")).toBe("/help/the-reading-view");
  });

  it("is drawn for a signed-out visitor", () => {
    bar({ mode: "summary", visitor: true, experimental: EXPERIMENTAL_SIGNED_OUT });
    expect(helpLink().getAttribute("href")).toBe("/help/mode-summary");
    expect(named("Commands")).toHaveLength(0);
  });

  /* Somebody signed in, reading another person's shared article: still a
     visitor, so no command bar, though their bar has the switch and Feedback.
     Said through the drawer, which is how the real reading view says it. */
  it("is drawn for a signed-in visitor, who has no command bar either", () => {
    bar({ mode: "summary", drawer: drawer(true), experimental: EXPERIMENTAL_ON });
    expect(helpLink().getAttribute("href")).toBe("/help/mode-summary");
    expect(named("Commands"), "a visitor's bar draws Commands").toHaveLength(0);
  });

  /* No `mode` reaches the bar there, so it is the reading view's section
     whatever `?mode=` the address carries. */
  it("is drawn for a visitor off the reading view, where there is no band", () => {
    for (const experimental of [EXPERIMENTAL_ON, EXPERIMENTAL_SIGNED_OUT]) {
      metadataBar({ visitor: true, experimental });
      expect(helpLink().getAttribute("href")).toBe("/help/the-reading-view");
      expect(named("Commands"), "a visitor's Metadata bar draws Commands").toHaveLength(0);
    }
  });

  /**
   * **A press opens that mode's page of Help, at its top.** `Link` calls
   * `navigate()`, which pushes `/help/mode-chat` and scrolls the window to
   * the top; the page then draws Chat's page and scrolls nowhere else. With
   * the real `Link` and the real page. App's router is not mounted here, so
   * the route change is stood in for by rendering `HelpPage` after the click,
   * which is the one step App adds.
   */
  it("opens the mode's page of Help after a press, at the top", () => {
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
      expect(location.pathname + location.hash).toBe("/help/mode-chat");
      act(() => root.render(createElement(HelpPage)));
      expect(events).toEqual(["top"]);
      expect(host.querySelector("h1 > span")?.textContent).toBe(MODE_LABEL.chat);
      expect(host.querySelector('[role="alert"]'), "Help says there is no such page").toBeNull();
      expect(location.pathname + location.hash).toBe("/help/mode-chat");
    } finally {
      window.scrollTo = scrollTo;
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  /* Every address the bar can build is a page Help has: the reading view's,
     and each mode's that a band can be in. */
  it("builds, for every mode, an address Help draws a page at", () => {
    for (const mode of MODES) {
      bar({ mode, visitor: true });
      const href = helpLink().getAttribute("href") ?? "";
      expect(resolveHelpPage(href.slice("/help/".length)).kind, `${mode}: ${href}`).toBe("page");
    }
  });
});
