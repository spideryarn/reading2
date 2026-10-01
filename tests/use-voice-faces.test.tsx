// @vitest-environment jsdom
/**
 * **`data-voices` on `<html>` follows the Experimental switch, and leaves with
 * the reading view.** src/web/useVoiceFaces.ts.
 *
 * The attribute is the only thing voices.css matches on, so this is the whole
 * of "the v1 is on for the readers who asked for experiments, and nobody else".
 * The unmount case matters as much as the toggle: an attribute left behind
 * would keep the shelf in the article's faces after the reader navigates away.
 */
import { act, createElement, Fragment, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useVoiceFaces, VOICES_ATTRIBUTE } from "../src/web/useVoiceFaces.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ on }: { on: boolean }) {
  useVoiceFaces(on);
  return null;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.removeAttribute(VOICES_ATTRIBUTE);
});

const has = () => document.documentElement.hasAttribute(VOICES_ATTRIBUTE);

describe("useVoiceFaces", () => {
  it("sets nothing while the switch is off", () => {
    act(() => root.render(createElement(Probe, { on: false })));
    expect(has()).toBe(false);
  });

  it("sets the attribute when on, and takes it away when turned off", () => {
    act(() => root.render(createElement(Probe, { on: true })));
    expect(has()).toBe(true);
    act(() => root.render(createElement(Probe, { on: false })));
    expect(has()).toBe(false);
  });

  it("takes it away when the reading view unmounts", () => {
    act(() => root.render(createElement(Probe, { on: true })));
    expect(has()).toBe(true);
    act(() => root.render(createElement("div")));
    expect(has()).toBe(false);
  });

  it("keeps it while any enabled reading view remains mounted", () => {
    const pair = (first: boolean, second: boolean) =>
      createElement(
        Fragment,
        null,
        first && createElement(Probe, { key: "first", on: true }),
        second && createElement(Probe, { key: "second", on: true }),
      );

    act(() => root.render(pair(true, true)));
    expect(has()).toBe(true);
    act(() => root.render(pair(false, true)));
    expect(has()).toBe(true);
    act(() => root.render(pair(false, false)));
    expect(has()).toBe(false);
  });

  it("survives StrictMode's effect rehearsal and cleans up afterwards", () => {
    act(() => root.render(createElement(StrictMode, null, createElement(Probe, { on: true }))));
    expect(has()).toBe(true);
    act(() => root.render(createElement("div")));
    expect(has()).toBe(false);
  });
});
