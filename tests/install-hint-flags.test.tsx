// @vitest-environment jsdom
/**
 * **The install hint says on `<html>` that it is drawn, and when focus is in
 * it** — `data-install-hint` for its room (`--hint-h`, dock.css) and
 * `data-install-hint-focus` for the narrow guard that brings the bar home
 * (narrow-window.css). They were `:root:has(.install-hint)` and
 * `:root:has(.install-hint:focus-within)` until 2026-10-29 (src/web/root-flags.ts,
 * plan 261029k).
 *
 * The environment check is stubbed to say "an uninstalled iPhone", which is the
 * only machine the strip is drawn on.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/web/install-hint.js", () => ({
  readEnvironment: () => ({ coarsePointer: true, ios: true, standalone: false, dismissed: false }),
  shouldOfferInstall: () => true,
  rememberDismissed: () => {},
}));
const { InstallHint } = await import("../src/web/InstallHint.js");

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

const has = (flag: string) => document.documentElement.hasAttribute(`data-${flag}`);

it("holds install-hint while drawn, install-hint-focus while focus is in it, and lets both go on dismiss", async () => {
  act(() => root.render(createElement(InstallHint)));
  expect(host.querySelector(".install-hint")).not.toBeNull();
  expect(has("install-hint")).toBe(true);
  expect(has("install-hint-focus")).toBe(false);

  const close = host.querySelector<HTMLButtonElement>(".install-hint-close")!;
  act(() => close.focus());
  expect(has("install-hint-focus")).toBe(true);
  act(() => close.blur());
  await act(async () => {});
  expect(has("install-hint-focus")).toBe(false);

  act(() => close.focus());
  expect(has("install-hint-focus")).toBe(true);
  /* Dismiss removes the strip with focus still in it: no focusout to rely on. */
  act(() => close.click());
  await act(async () => {});
  expect(host.querySelector(".install-hint")).toBeNull();
  expect(has("install-hint")).toBe(false);
  expect(has("install-hint-focus"), "the strip went with focus in it and the flag stayed").toBe(false);
});
