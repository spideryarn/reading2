// @vitest-environment jsdom
/**
 * **`useDictationField().busy`: the one answer to "may this box send?"**
 *
 * A box that sends has to refuse while the microphone is on (`armed`) *and*
 * for the two seconds afterwards while the transcript is on its way
 * (`readOnly`). They are different moments, never both true, and guarding one
 * alone is the bug docs/project/dictation.md § "the guard everybody forgets"
 * records twice. Until 2026-10-04 each caller wrote the pair out — eleven
 * times in seven files, in both orders — so the field is here to be the only
 * place it is written.
 *
 * `useDictation` is stubbed: what is under test is the derivation, over each of
 * the phases the real hook can be in. Watched fail before `busy` existed
 * (`undefined` in every row).
 */
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDictationField } from "../src/web/useDictationField.js";

const phase = vi.hoisted(() => ({ armed: false, transcribing: false }));
vi.mock("../src/web/useDictation.js", () => ({
  useDictation: () => ({ armed: phase.armed, transcribing: phase.transcribing, toggle() {} }),
}));

const { useDictationField } = await import("../src/web/useDictationField.js");

let host: HTMLDivElement;
let root: Root;
let seen: UseDictationField | null = null;

function Box() {
  const box = useRef<HTMLTextAreaElement | null>(null);
  seen = useDictationField({
    value: "",
    onChange() {},
    box,
    context: null,
    transcribe: async () => {
      throw new Error("not called");
    },
  });
  return createElement("textarea", { ref: box, readOnly: seen.readOnly });
}

function drawn(armed: boolean, transcribing: boolean): UseDictationField {
  phase.armed = armed;
  phase.transcribing = transcribing;
  act(() => root.render(createElement(Box)));
  if (!seen) throw new Error("the hook did not render");
  return seen;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  seen = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useDictationField().busy", () => {
  it("is false when nothing is being dictated", () => {
    expect(drawn(false, false)).toMatchObject({ busy: false, readOnly: false });
  });

  it("is true while the microphone is on, though the box is not read-only yet", () => {
    expect(drawn(true, false)).toMatchObject({ busy: true, readOnly: false });
  });

  it("is true while the transcript is on its way, though the microphone is off", () => {
    expect(drawn(false, true)).toMatchObject({ busy: true, readOnly: true });
  });

  it("goes back to false when the dictation ends", () => {
    expect(drawn(true, false).busy).toBe(true);
    expect(drawn(false, true).busy).toBe(true);
    expect(drawn(false, false).busy).toBe(false);
  });
});
