// @vitest-environment jsdom
/**
 * **"↩ back to ⟨mode⟩" wears `.return-chip`, so it holds `data-return-chip`
 * too** — the strip above the Dock keeps the same room for either chip
 * (dock.css § `--return-chip-h`, src/web/root-flags.ts). GPT Sol's plan
 * review of 261029k, P1: the plan had only one of the two holding it. The
 * other half is in tests/return-chip.test.tsx; both are counted, so the one
 * that stays keeps the room.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BandBackChip } from "../src/web/BandBackChip.js";

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

it("holds data-return-chip while drawn, and lets it go when it goes", () => {
  const flag = () => document.documentElement.hasAttribute("data-return-chip");
  expect(flag()).toBe(false);
  act(() => root.render(createElement(BandBackChip, { label: "Glossary", takeFocus: false, onBack: () => {} })));
  expect(host.querySelector(".return-chip")).not.toBeNull();
  expect(flag()).toBe(true);
  act(() => root.render(null));
  expect(flag()).toBe(false);
});
