// @vitest-environment jsdom
/**
 * **The cards/table switch is one-of-two, and says so to a keyboard.**
 *
 * Greg, 2026-09-06: *"improve the UI/UX of the toggle above that toggles
 * between cards and table (e.g. a rich tooltip, perhaps icons instead of
 * toggle, etc."*
 *
 * It was two `aria-pressed` buttons in a `<fieldset>` until then. That is the
 * toggle-button pattern, which models an *independent* binary control — "is
 * bold on" — and has no way to say that exactly one of these two is always
 * chosen. The APG's radio pattern is the one for "a set of checkable buttons
 * where no more than one can be checked at a time", and it explicitly endorses
 * styling radios to look like toggle buttons, which is what this control is.
 *
 * Tabs is the other wrong answer and the more tempting one: the APG defines
 * tabs as switching between *layered sections of content*, and these two switch
 * the painting of **one** list — same rows, same order, same sort state.
 *
 * ## What this pins
 *
 * Not the wording, and not the icons — that is copy and it will be edited, and
 * a test spelling it out is a second copy to keep in step (the argument
 * tests/shelf-action-tooltips.test.tsx makes at length). What has to hold is
 * the part a screenshot cannot show and a mouse never exercises:
 *
 *  - **Radio semantics**: a `radiogroup` with a name, two `radio`s, exactly one
 *    checked. `aria-pressed` must not come back.
 *  - **Arrow keys move the selection.** This is the whole reason the control is
 *    a `RadioGroup` rather than hand-rolled, and the first browser pass on it
 *    found ArrowLeft doing nothing — so it is asserted rather than assumed.
 *  - **One tab stop**, on the checked item, which is what a roving tabindex is
 *    for. Two tab stops is the bug that makes a segmented control tedious to
 *    walk past, and it is invisible to everyone using a mouse.
 *  - **No `title` attribute.** A native `title` is unstyleable, slow, and
 *    absent on touch; these carry a real card instead. The regression is
 *    invisible on a laptop, because a `title` still shows *something*.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfControls } from "../src/web/ShelfControls.js";
import type { LibraryEntry } from "../src/types.js";
import type { Table } from "@tanstack/react-table";

/**
 * Enough of a TanStack table for the chips to render nothing.
 *
 * `SortChips` asks for the leaf columns and the sorting state and does not care
 * that there are none; this file is about the control beside it.
 */
function stubTable(): Table<LibraryEntry> {
  return {
    getState: () => ({ sorting: [] }),
    getAllLeafColumns: () => [],
  } as unknown as Table<LibraryEntry>;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(view: "cards" | "table", onView = vi.fn()) {
  act(() => {
    root.render(
      createElement(ShelfControls, {
        table: stubTable(),
        chipOrder: [],
        view,
        onView,
        filter: "all" as const,
        onFilter: vi.fn(),
      }),
    );
  });
  return onView;
}

const radios = () => Array.from(host.querySelectorAll('[role="radio"]')) as HTMLElement[];

describe("the cards/table switch", () => {
  it("is a named radiogroup with exactly one checked radio", () => {
    render("table");

    const group = host.querySelector('[role="radiogroup"]');
    expect(group, "the switch should be a radiogroup, not two toggle buttons").not.toBeNull();
    expect(group?.getAttribute("aria-label")).toBeTruthy();

    const items = radios();
    expect(items).toHaveLength(2);
    expect(items.map((el) => el.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  });

  it("carries no aria-pressed and no title attribute", () => {
    render("table");
    for (const el of radios()) {
      expect(el.hasAttribute("aria-pressed")).toBe(false);
      expect(el.hasAttribute("title")).toBe(false);
    }
  });

  /**
   * **The tab stop is on the group, not on the checked item**, and this test
   * asserted the opposite first time and failed.
   *
   * Radix's roving model keeps `currentTabStopId` null until something inside
   * has been focused, so at rest *both* items are `tabIndex: -1` and the root
   * carries the 0. Tab therefore lands on the group, which delegates to the
   * checked item on focus. Either arrangement gives the one tab stop a radio
   * group is supposed to have; this is the one Radix implements, and writing
   * down which it is stops the next person "fixing" the items.
   */
  it("has exactly one tab stop, and it is the group", () => {
    render("table");
    const group = host.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group.tabIndex).toBe(0);
    expect(
      radios().map((el) => el.tabIndex),
      "an item carrying its own tab stop would make this two stops to walk past",
    ).toEqual([-1, -1]);
  });

  /**
   * **Radix moves the focus in a `setTimeout`, and the focus is what selects.**
   *
   * So a synchronous assertion right after the keydown sees nothing and reads
   * exactly like a control with no arrow-key support — which is what the first
   * version of this test reported, and what sent a browser pass looking for a
   * bug that was not there. The flush below is the whole difference.
   */
  it("moves the selection with an arrow key, not just the focus", async () => {
    const onView = render("table");
    const [, table] = radios();

    act(() => table?.focus());
    await act(async () => {
      table?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(onView, "ArrowLeft from Table should select Cards").toHaveBeenCalledWith("cards");
  });

  it("does not fire when the already-selected view is chosen again", () => {
    const onView = render("table");
    const [, table] = radios();

    act(() => table?.click());

    /* `view` is a `push` parameter, so re-selecting the current view would put
       an identical entry on the history stack and cost the reader an extra
       press of Back. */
    expect(onView).not.toHaveBeenCalled();
  });
});
