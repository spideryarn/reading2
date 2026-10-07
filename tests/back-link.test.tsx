// @vitest-environment jsdom
/**
 * **The way back is an arrow, named for a screen reader and described on
 * hover.** Greg, 2026-09-29 (SPIDERYARN-READING2-50): *"change the back button
 * text labels at the top of some pages … to icons with tooltips (because
 * there's already so much text on the page)"*. docs/plans/260929c-….
 *
 * Three things are pinned, each a way the obvious version fails silently:
 *
 *  - the link has an accessible **name** (`aria-label`) — the tooltip is only
 *    its description (docs/project/tooltips.md § Five things, 4), so an
 *    icon-only link without one is anonymous to a screen reader;
 *  - the card **opens on a real hover** — a trigger that swallows the ref
 *    opens nothing and looks exactly the same (§ Five things, 5);
 *  - **no header still spells it out**: a source sweep for an `ArrowLeft`
 *    followed by words, with the pages the plan leaves as words named.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackLink } from "../src/web/BackLink.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BackLink", () => {
  it("is an arrow with a name and no visible words", () => {
    act(() => root.render(<BackLink href="/" label="Back to your library" />));
    const a = host.querySelector("a");
    expect(a?.getAttribute("aria-label")).toBe("Back to your library");
    expect(a?.getAttribute("href")).toBe("/");
    expect(a?.querySelector("svg")).not.toBeNull();
    expect(a?.textContent?.trim()).toBe("");
  });

  it("opens its card on a real hover, saying where it goes", async () => {
    act(() => root.render(<BackLink href="/" label="Back to your library" />));
    expect(document.querySelector(".tooltip")).toBeNull();
    host.querySelector("a")?.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(document.querySelector(".tooltip")?.textContent).toContain("Back to your library");
  });
});

/**
 * **No header left spelling it out.** An `<ArrowLeft …/>` whose next JSX
 * child is words is the shape the report asked to change. The ones left as
 * words are named, each with the plan's reason: another session owns
 * Metadata's buttons today, and the sharing page's link names a place rather
 * than a way back.
 */
describe("the sweep", () => {
  const WEB = path.join(import.meta.dirname, "..", "src", "web");
  const LEFT_AS_WORDS = new Set(["Metadata.tsx", "PublicReadableSharingPage.tsx"]);
  const files = readdirSync(WEB).filter((f) => f.endsWith(".tsx"));
  const worded = files.filter((f) =>
    /<ArrowLeft\b[^>]*\/>\s*\n?\s*[{A-Za-z]/.test(readFileSync(path.join(WEB, f), "utf8")),
  );

  it("finds the pages it is about", () => {
    // Guard against a pattern that matches nothing: the two left as words
    // must still be seen by it.
    for (const f of LEFT_AS_WORDS) expect(worded).toContain(f);
  });

  it("leaves no other arrow-and-words back link", () => {
    expect(worded.filter((f) => !LEFT_AS_WORDS.has(f))).toEqual([]);
  });
});
