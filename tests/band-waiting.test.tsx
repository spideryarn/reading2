// @vitest-environment jsdom
/**
 * **A band's wait: nothing for 600ms, then a spinner and the sentence.**
 *
 * `BandWaiting` is the one loading line every band draws while it waits for
 * something it has asked for (docs/project/loading-spinner.md). Three things
 * have to be true at once, and each was once false somewhere:
 *
 * - Nothing shows before the threshold, so a fast read does not flash.
 * - The `role="status"` container is mounted from the start, so the words
 *   arriving later are announced — a live region mounted already filled
 *   announces nothing — and it holds the caller's padding so the band does
 *   not jump when the line lands.
 * - A wait that ends before the threshold never shows at all.
 */
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLOW_AFTER_MS } from "../src/web/useSlow.js";

const { BandWaiting } = await import("../src/web/BandWaiting.js");

let host: HTMLDivElement;
let root: Root;

function paint(node: ReactNode): void {
  act(() => root.render(node));
}
function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const line = () => host.querySelector('[role="status"]');

describe("BandWaiting", () => {
  it("answers a press immediately, without waiting for even a zero-delay timer", () => {
    paint(<BandWaiting delayMs={0}>Reading the paper…</BandWaiting>);
    expect(line()?.textContent).toBe("Reading the paper…");
    expect(host.querySelector("svg.cmt-spinner")).not.toBeNull();
  });

  it("mounts its status container at once, empty, with the caller's class", () => {
    paint(<BandWaiting className="gloss-quiet">Looking for a glossary…</BandWaiting>);
    const box = line();
    expect(box, "the live region is there from the first paint").not.toBeNull();
    expect(box?.classList.contains("gloss-quiet")).toBe(true);
    expect(box?.classList.contains("band-waiting")).toBe(true);
    expect(box?.textContent).toBe("");
    /* Only the unseen footprint is there (E1): every child hidden from sight
       and from assistive technology, the sentence a CSS `content`. */
    expect(host.querySelector("svg:not(.band-waiting-ghost)")).toBeNull();
    const ghosts = [...(box?.children ?? [])];
    expect(ghosts.length).toBe(2);
    for (const g of ghosts) {
      expect(g.classList.contains("band-waiting-ghost")).toBe(true);
      expect(g.getAttribute("aria-hidden")).toBe("true");
    }
    expect(box?.querySelector("[data-words]")?.getAttribute("data-words")).toBe("Looking for a glossary…");
  });

  it("says nothing just before the threshold, and the sentence with a spinner after it", () => {
    paint(<BandWaiting className="gloss-quiet">Looking for a glossary…</BandWaiting>);
    const initialRegion = line();
    wait(SLOW_AFTER_MS - 1);
    expect(host.textContent).not.toContain("Looking for a glossary");
    wait(2);
    expect(line(), "fill the existing live region rather than replacing it").toBe(initialRegion);
    expect(line()?.textContent).toContain("Looking for a glossary…");
    const spinner = host.querySelector("svg.cmt-spinner");
    expect(spinner, "the house spinner").not.toBeNull();
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
  });

  it("never shows a wait that ended before the threshold", () => {
    function Panel({ loading }: { loading: boolean }) {
      return loading
        ? <BandWaiting className="gloss-quiet">Looking for a glossary…</BandWaiting>
        : createElement("p", null, "The glossary.");
    }
    paint(createElement(Panel, { loading: true }));
    wait(SLOW_AFTER_MS / 2);
    paint(createElement(Panel, { loading: false }));
    wait(SLOW_AFTER_MS * 2);
    expect(host.textContent).toBe("The glossary.");
    expect(line()).toBeNull();
  });

  it("takes a caller's own spinner class, and a div where the caller needs one", () => {
    paint(
      <BandWaiting as="div" className="sk-wait" spinnerClassName="srch-spin">
        Looking for a picture…
      </BandWaiting>,
    );
    wait(SLOW_AFTER_MS + 1);
    expect(line()?.tagName).toBe("DIV");
    expect(host.querySelector("svg.srch-spin")).not.toBeNull();
    expect(host.querySelector("svg.cmt-spinner")).toBeNull();
  });

  it("starts a fresh wait after ready content, including StrictMode's double effect", () => {
    function Panel({ loading }: { loading: boolean }) {
      return <StrictMode>{loading ? <BandWaiting>Looking for a glossary…</BandWaiting> : <p>The glossary.</p>}</StrictMode>;
    }
    paint(<Panel loading />);
    wait(SLOW_AFTER_MS);
    expect(line()?.textContent).toBe("Looking for a glossary…");
    paint(<Panel loading={false} />);
    expect(line()).toBeNull();
    paint(<Panel loading />);
    wait(SLOW_AFTER_MS - 1);
    expect(line()?.textContent).toBe("");
    wait(1);
    expect(line()?.textContent).toBe("Looking for a glossary…");
  });

  it("starts a fresh timer when the wait's key changes", () => {
    paint(<BandWaiting key="first">Fetching the picture…</BandWaiting>);
    wait(SLOW_AFTER_MS);
    expect(line()?.textContent).toBe("Fetching the picture…");
    paint(<BandWaiting key="second">Fetching the picture…</BandWaiting>);
    wait(SLOW_AFTER_MS - 1);
    expect(line()?.textContent).toBe("");
    wait(1);
    expect(line()?.textContent).toBe("Fetching the picture…");
  });
});
