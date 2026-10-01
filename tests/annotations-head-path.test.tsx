// @vitest-environment jsdom
/* The Annotations head's path: the part and the section each on a line of
   their own, never cut to one line — Greg, 7M: "the text is truncated too
   much". jsdom lays nothing out, so this checks the shape that lets each title
   wrap; the browser check in the plan is what saw it wrap.
   docs/plans/261001k-annotations-head-path-wraps-and-the-notes-swap-in-on-a-narrow-window.md */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AnnotationsHead } from "../src/web/annotations/AnnotationsColumn.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

function draw(path: string[]): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<AnnotationsHead room path={path} arc={null} />));
  return host;
}

describe("the head's path", () => {
  it("draws each title as a step of its own, part first", () => {
    const part = "Smallest Brains and Largest Brains in the Animal Kingdom";
    const section = "What Happens When Brains Get Bigger, and What Changes";
    const steps = [...draw([part, section]).querySelectorAll(".marg-path-step")];
    expect(steps.map((s) => s.getAttribute("data-depth"))).toEqual(["0", "1"]);
    expect(steps[0]?.textContent).toBe(part);
    expect(steps[1]?.textContent).toBe(` › ${section}`);
  });

  it("keeps the join for a screen reader only", () => {
    const path = draw(["Part", "Section"]).querySelector(".marg-path");
    expect(path?.textContent).toBe("Part › Section");
    expect(path?.querySelector(".sr-only")?.textContent).toBe(" › ");
  });
});
