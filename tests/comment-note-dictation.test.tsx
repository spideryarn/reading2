// @vitest-environment jsdom
/**
 * **A comment's note box takes dictation** — plan
 * docs/plans/261021e-microphone-on-the-five-remaining-prose-boxes.md, Stage 2
 * item 5 and § After GPT Sol's plan review, "Comment note".
 *
 * The note commits on blur, and pressing Stop moves the focus out of it, so a
 * blur-commit while busy would save Chromium's rough live words and race the
 * transcript. What is pinned:
 *
 *  - the note has a microphone of its own;
 *  - a blur while armed, or while the words are on their way, saves nothing;
 *  - the end of a dictation saves the final words, once;
 *  - Escape while busy neither puts the stored words back nor closes the
 *    dialog, from the box or from its microphone;
 *  - a dictated change counts as typing (`onTyped`).
 *
 * `useDictation` is stubbed per box, keyed by the keeper's box name, as
 * tests/add-page-dictation.test.tsx does: the follow-up box calls it too.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientComment } from "../src/web/useComments.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MicOptions {
  onText(text: string): void;
  onTranscript(text: string): boolean | undefined;
  onEnd(): void;
}
const mic = vi.hoisted(() => ({
  state: new Map<string, { armed: boolean; transcribing: boolean }>(),
  options: new Map<string, unknown>(),
}));
vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (options: { keep?: { box: string } }) => {
    const name = options.keep?.box ?? "(no keeper)";
    mic.options.set(name, options);
    const s = mic.state.get(name) ?? { armed: false, transcribing: false };
    return {
      supported: true,
      phase: s.armed ? "listening" : s.transcribing ? "transcribing" : "idle",
      armed: s.armed,
      transcribing: s.transcribing,
      liveText: true,
      interim: "",
      level: { current: 0 },
      meter: "none",
      quiet: false,
      error: null,
      startedAt: null,
      endsAt: null,
      deviceLabel: null,
      deviceId: null,
      deviceUnavailable: false,
      recording: null,
      keptOnDevice: false,
      canRetry: false,
      toggle() {
        mic.state.set(name, { armed: !s.armed, transcribing: false });
        return undefined;
      },
      dismiss() {},
      chooseDevice() {},
      clearRecording() {},
      retry() {},
    };
  },
}));
vi.mock("../src/web/dictation-upload.js", () => ({
  useReaderTranscriber: () => async () => {
    throw new Error("not called");
  },
}));

const { CommentDialog } = await import("../src/web/CommentDialog.js");

const COMMENT: ClientComment = {
  id: "spya-p7w2dn",
  blockId: "spya-k3m9qt",
  quote: "a science of bumps",
  start: 0,
  createdAt: "2026-09-05T10:00:00.000Z",
  body: "stored words",
  status: "none",
};
const NOTE = `comment-note:${COMMENT.id}`;

let container: HTMLDivElement;
let root: Root;
let edits: Array<string | null>;
let closes: number;
let touches: number;

beforeEach(() => {
  mic.state.clear();
  mic.options.clear();
  edits = [];
  closes = 0;
  touches = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function draw(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(CommentDialog, {
        comment: COMMENT,
        position: 1,
        total: 1,
        hasPrev: false,
        hasNext: false,
        onPrev: () => {},
        onNext: () => {},
        onClose: () => {
          closes += 1;
        },
        access: {
          kind: "owner" as const,
          placing: false,
          pending: 0,
          onDelete: () => {},
          onRetry: () => {},
          onDiscuss: () => {},
          onEdit: (next: string | null) => {
            edits.push(next);
          },
          onPlace: () => {},
          onRecolour: () => {},
          onTouched: () => {
            touches += 1;
          },
          error: null,
        },
      }),
    );
  });
}

const note = () => container.querySelector<HTMLTextAreaElement>("textarea.cmt-note")!;
const noteMic = () => container.querySelector<HTMLButtonElement>(".cmt-note-field button")!;
const options = () => mic.options.get(NOTE) as MicOptions;

/** Put the note's microphone in a phase, and redraw. */
async function phase(armed: boolean, transcribing: boolean): Promise<void> {
  mic.state.set(NOTE, { armed, transcribing });
  await draw();
}

/** The reader puts the caret at the end of the note and presses the microphone. */
async function start(): Promise<void> {
  await act(async () => {
    const el = note();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  await act(async () => noteMic().click());
  await draw();
  expect(mic.state.get(NOTE)?.armed).toBe(true);
}

async function key(el: Element, k: string, extra: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }));
  });
}

describe("the comment note's microphone (261021e)", () => {
  it("has a microphone of its own, kept per comment", async () => {
    await draw();
    expect(noteMic()).not.toBeNull();
    expect(mic.options.has(NOTE)).toBe(true);
  });

  it("does not save on a blur while armed, nor while the words are on their way", async () => {
    await draw();
    await start();
    await act(async () => options().onText("rough live guess"));
    expect(note().value).toBe("stored words rough live guess");
    await act(async () => note().blur());
    expect(edits).toEqual([]);

    await phase(false, true);
    await act(async () => note().focus());
    await act(async () => note().blur());
    expect(edits).toEqual([]);
  });

  it("saves the final words once, when the dictation ends", async () => {
    await draw();
    await start();
    await act(async () => options().onText("rough live guess"));
    await phase(false, true);
    /* The transcript and the ending in one turn, as the hook delivers them:
       no render in between, so the commit must read the words that just
       landed rather than its render's draft. */
    mic.state.set(NOTE, { armed: false, transcribing: false });
    await act(async () => {
      options().onTranscript("the final words");
      options().onEnd();
    });
    await draw();
    expect(edits).toEqual(["stored words the final words"]);
    /* A later blur has nothing new to save. */
    await act(async () => note().focus());
    await act(async () => note().blur());
    expect(edits).toEqual(["stored words the final words"]);
  });

  it("refuses ⌘/Ctrl+Enter while busy", async () => {
    await draw();
    await start();
    await act(async () => options().onText("rough"));
    await key(note(), "Enter", { metaKey: true });
    expect(edits).toEqual([]);
  });

  it("contains Escape while busy: no restore, no close — from the box or its microphone", async () => {
    await draw();
    await start();
    await act(async () => options().onText("rough"));
    await key(note(), "Escape");
    expect(note().value).toBe("stored words rough");
    expect(closes).toBe(0);
    await key(noteMic(), "Escape");
    expect(closes).toBe(0);

    await phase(false, true);
    await key(note(), "Escape");
    await key(noteMic(), "Escape");
    expect(note().value).toBe("stored words rough");
    expect(closes).toBe(0);
  });

  it("still closes on Escape from an idle microphone", async () => {
    await draw();
    await key(noteMic(), "Escape");
    expect(closes).toBe(1);
  });

  it("counts a dictated change as typing", async () => {
    await draw();
    await start();
    const before = touches;
    await act(async () => options().onText("spoken"));
    expect(touches).toBeGreaterThan(before);
  });
});
