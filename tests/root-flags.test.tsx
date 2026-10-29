// @vitest-environment jsdom
/**
 * **The attributes on `<html>` that stand in for the `:root:has()` rules**
 * (src/web/root-flags.ts, plan 261029k § 1.2).
 *
 * Each flag is a fact a component knows from its own state — "the bar is
 * drawn", "a side dialog is open" — said once on the document element so the
 * stylesheet can ask `:root[data-…]` instead of walking the article. Two owners
 * can hold the same flag, so it is counted; StrictMode runs every effect twice,
 * so the count must come back to where it was; and the focus-within companion
 * must follow focus however it leaves (GPT Sol's plan review, P1: a null
 * `relatedTarget`, focus to `body`, the focused node removed, the window
 * blurred), which is why it asks `:focus-within` rather than reading the event.
 */
import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireRootFlag, useFocusWithinFlag, useRootFlag, type RootFlag } from "../src/web/root-flags.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const has = (flag: RootFlag) => document.documentElement.hasAttribute(`data-${flag}`);
/** Let the companion's microtask run. */
const settle = () => act(async () => {});

function Holder({ flag, on }: { flag: RootFlag; on: boolean }) {
  useRootFlag(flag, on);
  return null;
}

describe("useRootFlag", () => {
  it("sets the attribute while held and removes it when released", () => {
    act(() => root.render(createElement(Holder, { flag: "side-dialog", on: true })));
    expect(has("side-dialog")).toBe(true);
    expect(document.documentElement.getAttribute("data-side-dialog")).toBe("");
    act(() => root.render(createElement(Holder, { flag: "side-dialog", on: false })));
    expect(has("side-dialog")).toBe(false);
  });

  it("is present before a descendant's layout measurement", () => {
    let seen = false;
    function MeasuringChild() {
      useLayoutEffect(() => {
        seen = has("bar-drawn");
      }, []);
      return null;
    }
    function Shell() {
      useRootFlag("bar-drawn", true);
      return createElement(MeasuringChild);
    }
    act(() => root.render(createElement(Shell)));
    expect(seen, "a child measured the pre-flag CSS in its layout effect").toBe(true);
  });

  it("counts owners: the flag stays until the last one lets go", () => {
    const two = (a: boolean, b: boolean) =>
      createElement("div", null, a && createElement(Holder, { key: "a", flag: "side-dialog", on: true }), b && createElement(Holder, { key: "b", flag: "side-dialog", on: true }));
    act(() => root.render(two(true, true)));
    expect(has("side-dialog")).toBe(true);
    act(() => root.render(two(false, true)));
    expect(has("side-dialog"), "one owner left").toBe(true);
    act(() => root.render(two(false, false)));
    expect(has("side-dialog")).toBe(false);
  });

  it("is cleared on unmount", () => {
    act(() => root.render(createElement(Holder, { flag: "return-chip", on: true })));
    expect(has("return-chip")).toBe(true);
    act(() => root.render(null));
    expect(has("return-chip")).toBe(false);
  });

  it("leaks nothing under StrictMode's double effects", () => {
    act(() => root.render(createElement(StrictMode, null, createElement(Holder, { flag: "install-hint", on: true }))));
    expect(has("install-hint")).toBe(true);
    act(() => root.render(createElement(StrictMode, null, createElement(Holder, { flag: "install-hint", on: false }))));
    expect(has("install-hint"), "a doubled effect left a count behind").toBe(false);
  });

  it("keeps different flags apart", () => {
    act(() => root.render(createElement(Holder, { flag: "dock-drawer", on: true })));
    expect(has("dock-drawer")).toBe(true);
    expect(has("dock-focus")).toBe(false);
  });
});

describe("acquireRootFlag (the imperative lease)", () => {
  it("is released once however often release is called", () => {
    const a = acquireRootFlag("dock-skip-arrived");
    const b = acquireRootFlag("dock-skip-arrived");
    a();
    a();
    expect(has("dock-skip-arrived"), "a second release of the same lease took b's count").toBe(true);
    b();
    expect(has("dock-skip-arrived")).toBe(false);
  });
});

describe("useFocusWithinFlag", () => {
  function Box({ shown = true, inner = true }: { shown?: boolean; inner?: boolean }) {
    const ref = useFocusWithinFlag("dock-focus");
    return shown
      ? createElement(
          "div",
          { ref, className: "box" },
          inner && createElement("button", { id: "in", type: "button" }, "in"),
          createElement("button", { id: "in2", type: "button" }, "in2"),
        )
      : null;
  }
  let outside: HTMLButtonElement;
  beforeEach(() => {
    outside = document.createElement("button");
    outside.id = "out";
    document.body.append(outside);
  });
  afterEach(() => outside.remove());
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;

  it("follows focus in and out", async () => {
    act(() => root.render(createElement(Box)));
    expect(has("dock-focus")).toBe(false);
    act(() => button("in").focus());
    expect(has("dock-focus")).toBe(true);
    act(() => button("in2").focus());
    await settle();
    expect(has("dock-focus"), "moving inside the box is not leaving it").toBe(true);
    act(() => outside.focus());
    await settle();
    expect(has("dock-focus")).toBe(false);
  });

  it("clears when focus goes to body (a null relatedTarget)", async () => {
    act(() => root.render(createElement(Box)));
    act(() => button("in").focus());
    expect(has("dock-focus")).toBe(true);
    act(() => button("in").blur());
    await settle();
    expect(document.activeElement).toBe(document.body);
    expect(has("dock-focus")).toBe(false);
  });

  it("clears when the focused node is removed", async () => {
    act(() => root.render(createElement(Box)));
    act(() => button("in").focus());
    expect(has("dock-focus")).toBe(true);
    act(() => root.render(createElement(Box, { inner: false })));
    await settle();
    expect(has("dock-focus"), "the focused button went and the flag stayed").toBe(false);
  });

  it("clears when the box itself goes, and on unmount", async () => {
    act(() => root.render(createElement(Box)));
    act(() => button("in").focus());
    act(() => root.render(createElement(Box, { shown: false })));
    await settle();
    expect(has("dock-focus")).toBe(false);
    act(() => root.render(createElement(Box)));
    act(() => button("in").focus());
    expect(has("dock-focus")).toBe(true);
    act(() => root.render(null));
    expect(has("dock-focus")).toBe(false);
  });

  it("reconciles on window blur", async () => {
    act(() => root.render(createElement(Box)));
    act(() => button("in").focus());
    expect(has("dock-focus")).toBe(true);
    /* The window loses focus with no focusout reaching the box (focus went to
       another app): the active element stays, the document stops having
       focus, and only the window hears of it. */
    const spy = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    try {
      act(() => window.dispatchEvent(new Event("blur")));
      await settle();
      expect(has("dock-focus")).toBe(false);
      spy.mockReturnValue(true);
      act(() => window.dispatchEvent(new Event("focus")));
      await settle();
      expect(has("dock-focus"), "back in the window, focus is still in the box").toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("is StrictMode-safe: the doubled ref attach leaves one lease, released on leaving", async () => {
    act(() => root.render(createElement(StrictMode, null, createElement(Box))));
    act(() => button("in").focus());
    expect(has("dock-focus")).toBe(true);
    act(() => outside.focus());
    await settle();
    expect(has("dock-focus"), "StrictMode's second attach left a lease behind").toBe(false);
  });
});
