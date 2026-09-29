// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Section } from "../src/web/position.js";
import { useColumnContext } from "../src/web/useColumnContext.js";

class NoResizeObserver {
  observe() {}
  disconnect() {}
}

const A = "spya-aaaaaa";
const B = "spya-bbbbbb";
const FIRST = [
  { row: 0, blockId: A, nodeId: "n0001", title: "First" },
  { row: 5, blockId: B, nodeId: "n0002", title: "Second" },
] as Section[];
const REFLOWED = [FIRST[0] as Section];

let host: HTMLDivElement;
let root: Root;

function Harness({ sections, layoutKey }: { sections: Section[]; layoutKey: string }): ReactNode {
  const { focusRow } = useColumnContext({ sections, enabled: true, layoutKey });
  return (
    <>
      <output data-focus-row>{focusRow}</output>
      <table className="zoom">
        <tbody>
          {sections.map((section) => (
            <tr data-block={section.blockId} key={section.blockId}>
              <td>{section.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoResizeObserver);
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this.dataset.block === B ? 50 : 0;
    return { top, bottom: top + 20, height: 20 } as DOMRect;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Structure's current-row measurement", () => {
  it("publishes row zero after a layout change replaces a later current section", () => {
    act(() => root.render(<Harness sections={FIRST} layoutKey="before" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("5");

    act(() => root.render(<Harness sections={REFLOWED} layoutKey="after" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });
});
