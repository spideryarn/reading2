// @vitest-environment jsdom
/**
 * **Send is the primary control in the composer's row**, and it is sized from
 * the token rather than from a number of its own.
 *
 * Greg, 2026-09-12, report 3E: *"it sort of should be bigger and maybe have some
 * kind of outline to indicate that it's probably the most important button in
 * that little area."* docs/plans/260912c-send-button-icon-and-primary-style.md.
 *
 * jsdom does not lay anything out, so the two halves are asserted where each one
 * lives: the icon's size on the mounted component, and the geometry and fill in
 * the stylesheet the button is drawn by. The browser screenshots in the plan
 * are what show it looks right; this is what stops it drifting back.
 *
 * Nothing here is about the icon going MISSING on an iPad — that was not
 * reproduced off the device, and the plan says what was ruled out.
 */
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: false, armed: false, transcribing: false, toggle: () => {} },
    readOnly: false,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));
vi.mock("../src/web/router.js", () => ({
  useRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
  parseRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
}));
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async () => new Response("{}", { status: 200 }),
  fetchOk: async () => new Response(null, { status: 200 }),
  readJson: async () => ({}),
  failure: async (res: Response) => new Error(await res.text()),
}));

const { Composer } = await import("../src/web/ChatPanel.js");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!m?.[1]) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe("the send button", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("draws its icon at 18px, up from 14", () => {
    act(() => {
      root.render(
        createElement(Composer, {
          slug: "a-piece",
          onSend: () => {},
          busy: false,
          focusNonce: 0,
          focused: { current: 0 },
          draft: "a question",
          onDraft: () => {},
        }),
      );
    });
    const icon = host.querySelector("button.chat-send svg.lucide-send-horizontal");
    expect(icon, "the send button carries its icon").not.toBeNull();
    expect(icon?.getAttribute("width")).toBe("18");
  });

  it("takes its square from --control-h, owns its padding, and cannot be squeezed", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    expect(tokens).toMatch(/--control-h:\s*2\.25rem/);

    const css = readFileSync("src/web/styles/mode-band.css", "utf8");
    const base = rule(css, ".chat-send");
    expect(base).toMatch(/width:\s*var\(--control-h\)/);
    expect(base).toMatch(/height:\s*var\(--control-h\)/);
    expect(base).toMatch(/padding:\s*0/);
    expect(base).toMatch(/flex:\s*none/);
  });

  /* **Send only, and not Stop.** Stop is an enabled `type="button"` carrying the
     same class, so `.chat-send:not(:disabled)` would have filled it orange too —
     GPT Sol's plan review, P1. */
  it("fills with the primary colour only when Send can be pressed, and never fills Stop", () => {
    const css = readFileSync("src/web/styles/mode-band.css", "utf8");
    const pressable = rule(css, '.chat-send[type="submit"]:not(:disabled)');
    expect(pressable).toMatch(/background:\s*var\(--primary\)/);
    expect(pressable).toMatch(/color:\s*var\(--primary-foreground\)/);

    const stop = rule(readFileSync("src/web/styles/chat-actions.css", "utf8"), ".chat-send.stop");
    expect(stop).toMatch(/background:\s*transparent/);
  });

  /* The disabled look is said with colour, not `opacity`. Sol's leading iOS
     suspect for the missing icon is a disabled button drawn at opacity < 1; this
     does not prove that was the cause, but the new state has no need of it. */
  it("says 'not yet' with colour rather than opacity", () => {
    const disabled = rule(readFileSync("src/web/styles/mode-band.css", "utf8"), ".chat-send:disabled");
    expect(disabled).not.toMatch(/opacity/);
    expect(disabled).toMatch(/background:\s*transparent/);
  });
});
