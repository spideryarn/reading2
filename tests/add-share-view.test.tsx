// @vitest-environment jsdom
/**
 * **The public control's visible press for every `ShareAtAddState`** —
 * `AddShare` in src/web/AddShare.tsx. The controller's state transitions are
 * covered in tests/add-share.test.ts; this file holds the view-to-controller
 * mapping that replaced the old checkbox (plan 261009i).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHARE_AT_ADD_LABEL } from "../src/messages.js";
import type { ShareAtAdd, ShareAtAddState } from "../src/web/add-share.js";
import { AddShare } from "../src/web/AddShare.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let calls: string[];

beforeEach(() => {
  calls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(state: ShareAtAddState): void {
  const share = {
    slug: "an-article",
    get: () => state,
    subscribe: () => () => undefined,
    open: () => calls.push("open"),
    untick: () => calls.push("untick"),
    cancel: () => calls.push("cancel"),
    tick: vi.fn(),
    share: vi.fn(),
  } as unknown as ShareAtAdd;
  act(() => root.render(<AddShare share={share} offer />));
}

function publicPress(): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>("[data-add-share-press]");
}

function click(button: HTMLButtonElement | null): void {
  if (!button) throw new Error("the public press was not drawn");
  act(() => button.click());
}

describe("the press for every public-sharing state", () => {
  it.each([
    [{ kind: "off" }, "open", SHARE_AT_ADD_LABEL, "open"],
    [{ kind: "refused", message: "No", on: false, attempted: "public" }, "open", SHARE_AT_ADD_LABEL, "open"],
    [{ kind: "waiting" }, "cancel", "Cancel", "untick"],
    [{ kind: "gave-up" }, "cancel", "Cancel", "untick"],
    [{ kind: "on", publicAt: "2026-10-09T08:00:00.000Z" }, "stop", "Stop sharing", "untick"],
    [{ kind: "unknown", because: "write" }, "stop", "Stop sharing", "untick"],
    [{ kind: "unknown", because: "reload" }, "stop", "Stop sharing", "untick"],
    [{ kind: "refused", message: "No", on: true, attempted: "private" }, "stop", "Stop sharing", "untick"],
  ] as const)("maps %o to %s", (state, action, label, method) => {
    render(state);
    expect(publicPress()?.dataset.addSharePress).toBe(action);
    expect(publicPress()?.textContent?.trim()).toBe(label);
    click(publicPress());
    expect(calls).toEqual([method]);
  });

  it.each([
    { kind: "saving", to: "public" },
    { kind: "saving", to: "private" },
  ] as const)("offers no second press while %o is in flight", (state) => {
    render(state);
    expect(publicPress()).toBeNull();
  });

  it("keeps the confirmation's own Cancel mapped to cancel, not untick", () => {
    render({ kind: "confirming", rights: false });
    expect(publicPress()).toBeNull();
    expect(host.textContent).not.toContain("Stop sharing");
    const cancel = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Cancel",
    );
    click(cancel ?? null);
    expect(calls).toEqual(["cancel"]);
  });

  it.each([
    { kind: "probing" },
    { kind: "adopted" },
    { kind: "unavailable" },
  ] as const)("offers no public press for %o", (state) => {
    render(state);
    expect(publicPress()).toBeNull();
  });

  it.each([
    [{ kind: "off" }, false],
    [{ kind: "refused", message: "No", on: false, attempted: "public" }, false],
    [{ kind: "confirming", rights: false }, true],
    [{ kind: "waiting" }, true],
    [{ kind: "gave-up" }, true],
    [{ kind: "saving", to: "public" }, true],
    [{ kind: "saving", to: "private" }, false],
    [{ kind: "on", publicAt: "2026-10-09T08:00:00.000Z" }, true],
    [{ kind: "unknown", because: "write" }, true],
    [{ kind: "refused", message: "No", on: true, attempted: "private" }, true],
  ] as const)("marks whether %o is shared or asked for", (state, on) => {
    render(state);
    expect(host.querySelector<HTMLElement>("[data-add-share]")?.dataset.on).toBe(String(on));
  });
});
