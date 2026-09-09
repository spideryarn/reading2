// @vitest-environment jsdom
/**
 * **`StatCard`, and the four ways a number can be missing.**
 *
 * The primitive exists because `HealthPanel`'s tile was the only place on the
 * whole dashboard where the number the reader came for is the biggest thing in
 * its box. Spreading that shape is most of what "we need a design system"
 * turned out to mean — docs/plans/260909c-dashboard-design-system-….md.
 *
 * ## What these tests are actually guarding
 *
 * Not the styling. A component that draws a number large is not worth a suite.
 * What is worth guarding is the thing the first draft got wrong and GPT Sol
 * caught: **a bare em dash for every absence conflates unknown, withheld and
 * unavailable**, and a reader who meets one dash for three different pieces of
 * news learns to read it as "nothing to see". So the assertions here are about
 * *distinguishability* —
 *
 *  - an absence says a word, not a dash;
 *  - the three absences say three different words;
 *  - a source failure is louder than a gap;
 *  - an absence never inherits the caller's calm tone;
 *  - a stale reading keeps its number AND wears its age.
 *
 * Every one of them fails if the union is collapsed back into one arm, which is
 * the mutation this file exists to notice.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StatCard, type StatValue } from "../tools/fleet/web/src/ui";
import type { Tone } from "../tools/fleet/web/src/view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function draw(value: StatValue, tone: Tone = "work", evidence?: string): void {
  act(() =>
    root.render(<StatCard label="Headroom" value={value} evidence={evidence} tone={tone} />),
  );
}

/** The card's text, whitespace flattened, so an assertion reads like a sentence. */
function screen(): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

function slot(name: string): HTMLElement | null {
  return container.querySelector(`[data-slot="${name}"]`);
}

describe("a value", () => {
  it("is the biggest thing in the box, and carries tabular figures", () => {
    draw({ kind: "value", text: "58%" }, "work", "of the seven-day window");
    const value = slot("stat-value");
    expect(value?.textContent).toBe("58%");
    /* Tabular figures are what makes a COLUMN of these scannable; without them
       a 1 and a 7 take different widths and the numbers stop lining up. */
    expect(value?.className).toContain("tabular-nums");
    expect(value?.className).toContain("text-answer");
    /* The evidence is what makes "58%" mean anything, and it is smaller. */
    expect(slot("stat-evidence")?.textContent).toContain("of the seven-day window");
    expect(slot("stat-evidence")?.className).toContain("text-note");
  });

  it("does not draw an absence slot", () => {
    draw({ kind: "value", text: "58%" });
    expect(slot("stat-absent")).toBeNull();
  });
});

describe("an absence says which absence it is", () => {
  /**
   * **The regression this whole file exists for.** The first draft drew `—`
   * here. A dash is not an answer: it reads the same for "nobody looked",
   * "we looked and it isn't yours" and "the thing that looks is broken".
   */
  it.each([
    ["unknown", "Unknown"],
    ["withheld", "Withheld"],
    ["unavailable", "Unavailable"],
  ] as const)("%s says %s rather than a dash", (state, word) => {
    draw({ kind: "absent", state, why: "the window has reset" });
    expect(slot("stat-absent")?.textContent).toBe(word);
    expect(screen()).not.toContain("—");
  });

  it("says three different words, so the three states are distinguishable", () => {
    const words = new Set<string>();
    for (const state of ["unknown", "withheld", "unavailable"] as const) {
      draw({ kind: "absent", state, why: "why" });
      words.add(slot("stat-absent")?.textContent ?? "");
    }
    expect(words.size).toBe(3);
  });

  it("always prints the reason, because the state word alone is not an explanation", () => {
    draw({ kind: "absent", state: "withheld", why: "this cache may belong to another account" });
    expect(screen()).toContain("this cache may belong to another account");
  });

  /**
   * **An absence must not inherit the calm of the tone it would have had.**
   * `tone` describes the VALUE; a caller passing `work` for a healthy stat must
   * not get a green card when the reading could not be taken. This is the
   * "unknown rendered as a healthy zero" failure, in the one place the whole
   * dashboard now routes its numbers through.
   */
  it("overrides a calm caller tone", () => {
    draw({ kind: "value", text: "58%" }, "work");
    const healthy = slot("stat-value")?.className ?? "";
    draw({ kind: "absent", state: "unknown", why: "nobody has looked" }, "work");
    const absent = slot("stat-absent")?.className ?? "";
    expect(absent).not.toBe(healthy);
    expect(healthy).toContain("work-ink");
    expect(absent).not.toContain("work-ink");
  });

  /** A fault is not a gap, and reads louder than one. */
  it("draws a failed source differently from a missing one", () => {
    draw({ kind: "absent", state: "unknown", why: "why" });
    const gap = slot("stat-absent")?.className ?? "";
    draw({ kind: "absent", state: "unavailable", why: "why" });
    const fault = slot("stat-absent")?.className ?? "";
    expect(fault).not.toBe(gap);
    expect(fault).toContain("alarm");
  });
});

describe("a stale reading", () => {
  /**
   * Blanking an old-but-valid number throws away the best information there
   * is. Keeping it without its age is worse: it reads exactly like a fresh one,
   * which is the entire hazard.
   */
  it("keeps its number and wears its age", () => {
    draw({ kind: "stale", text: "58%", age: "read 6h ago" }, "work", "of the seven-day window");
    expect(slot("stat-value")?.textContent).toBe("58%");
    expect(slot("stat-stale")?.textContent).toContain("read 6h ago");
  });

  it("puts the age outside the tone of a healthy value, so it is not read as part of the evidence", () => {
    draw({ kind: "stale", text: "58%", age: "read 6h ago" }, "work");
    expect(slot("stat-stale")?.className).toContain("unknown-ink");
  });
});
