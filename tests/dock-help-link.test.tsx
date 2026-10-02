// @vitest-environment jsdom
/**
 * **The Dock's Help link: on every bar, and it opens at the part about where
 * you are.** docs/plans/261002b-help-page.md § After GPT Sol's plan review, R5
 * and R8 — one labelled link in the Dock, for owners and visitors, contextual:
 * the current mode's section, or the reading view's in Plain.
 *
 * Three claims, each of which a plausible refactor could break silently:
 *
 *  - **Everybody gets it.** The bar has three gates already (visitor, signed
 *    in, a drawer) and a link placed inside the wrong one vanishes for exactly
 *    the reader who most needs it — a stranger on a shared link.
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

/** The one control in the bar named Help. */
function helpLink(): HTMLAnchorElement {
  const hits = [...host.querySelectorAll<HTMLElement>(".dock .dock-btn")].filter(
    (el) => el.getAttribute("aria-label") === "Help",
  );
  expect(hits, "no single bar control named Help").toHaveLength(1);
  const el = hits[0] as HTMLElement;
  expect(el.tagName, "Help is not a link").toBe("A");
  return el as HTMLAnchorElement;
}

describe("the Help link in the Dock", () => {
  it("opens at the section for the mode the band is in", () => {
    bar({ mode: "chat" });
    expect(helpLink().getAttribute("href")).toBe("/help#mode-chat");
  });

  it("follows the band when the mode changes", () => {
    bar({ mode: "glossary" });
    expect(helpLink().getAttribute("href")).toBe("/help#mode-glossary");
    bar({ mode: "structure" });
    expect(helpLink().getAttribute("href")).toBe("/help#mode-structure");
  });

  /* Plain is a mode with a section of its own, but in Plain there is nothing
     on screen except the reading view itself, so that is what Help is about.
     The same with Marginalia's column on and no band: it is a column beside
     the prose, not a mode the band is in. */
  it("opens at the reading view in Plain, with or without the margin column", () => {
    bar({ mode: "plain" });
    expect(helpLink().getAttribute("href")).toBe("/help#the-reading-view");
    bar({ mode: "plain", margin: true });
    expect(helpLink().getAttribute("href")).toBe("/help#the-reading-view");
  });

  it("is drawn for a signed-out visitor too, pointing at the same section", () => {
    bar({ mode: "summary", visitor: true, experimental: EXPERIMENTAL_SIGNED_OUT });
    expect(helpLink().getAttribute("href")).toBe("/help#mode-summary");
  });

  it("is drawn off the reading view, where there is no band", () => {
    history.replaceState(null, "", "/read/a-piece/metadata");
    act(() => {
      root.render(
        // biome-ignore lint/suspicious/noExplicitAny: as above
        createElement(Dock as any, {
          slug: "a-piece",
          view: "metadata",
          experimental: EXPERIMENTAL_ON,
        }),
      );
    });
    expect(helpLink().getAttribute("href")).toBe("/help#the-reading-view");
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
      bar({ mode: "chat" });
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
