// @vitest-environment jsdom
/* The Marginalia head's path: the part and the section each on a line of
   their own, never cut to one line — Greg, 7M: "the text is truncated too
   much". jsdom lays nothing out, so this checks the shape that lets each title
   wrap; the browser check in the plan is what saw it wrap.
   docs/plans/261001k-annotations-head-path-wraps-and-the-notes-swap-in-on-a-narrow-window.md */
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MarginaliaHead } from "../src/web/marginalia/MarginaliaColumn.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

function draw(path: string[]): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const nextRoot = createRoot(host);
  root = nextRoot;
  act(() => nextRoot.render(<MarginaliaHead room path={path} arc={null} />));
  return host;
}

describe("the head's path", () => {
  it("draws each title as a step of its own, part first", () => {
    const part = "Smallest Brains and Largest Brains in the Animal Kingdom";
    const section = "What Happens When Brains Get Bigger, and What Changes";
    const steps = [...draw([part, section]).querySelectorAll(".marg-path-step")];
    expect(steps.map((s) => s.getAttribute("data-depth"))).toEqual(["0", "1"]);
    expect(steps[0]?.textContent).toBe(part);
    expect(steps[1]?.textContent).toBe(section);
  });

  it("keeps the join for a screen reader outside the clipped title", () => {
    const path = draw(["Part", "Section"]).querySelector(".marg-path");
    expect(path?.textContent).toBe("Part › Section");
    const join = path?.querySelector(".sr-only");
    expect(join?.textContent).toBe(" › ");
    expect(join?.parentElement).toBe(path);
  });

  it("uses the app's card for a cut title, not a native title tooltip", async () => {
    const title = "A title long enough to need its complete version on hover";
    const step = draw([title]).querySelector<HTMLElement>(".marg-path-step");
    expect(step?.getAttribute("title"), "the path fell back to a native title tooltip").toBeNull();
    expect(step?.tagName).toBe("BUTTON");
    expect(step?.tabIndex, "a keyboard cannot reach the title card").toBe(0);

    step?.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => new Promise((go) => setTimeout(go, 300)));

    const describedBy = step?.getAttribute("aria-describedby");
    expect(describedBy, "the title card did not open").toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(title);
  });

  it("pins the two-line clamp declarations that jsdom cannot lay out", () => {
    const css = readFileSync("src/web/styles/marginalia.css", "utf8");
    const pathRule = css.match(/\.marg-path\s*\{([^}]*)\}/)?.[1] ?? "";
    const rule = css.match(/\.marg-path-step\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(pathRule).toContain("display: grid");
    expect(rule).toContain("display: -webkit-box");
    expect(rule).toContain("-webkit-box-orient: vertical");
    expect(rule).toContain("-webkit-line-clamp: 2");
    expect(rule).toContain("overflow: hidden");
  });
});
