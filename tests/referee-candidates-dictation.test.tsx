// @vitest-environment jsdom
/**
 * **Referee's criterion box and Candidates' scope box take dictation**, and
 * neither sends while the microphone is involved — plan
 * docs/plans/261021e-microphone-on-the-five-remaining-prose-boxes.md § Stage 2,
 * items 2 and 3, and § After GPT Sol's plan review (F4, F7).
 *
 * "Involved" is two moments, `armed` (recording) and `transcribing` (the
 * words on their way), and each box is pressed in both, by every way it has
 * of sending: Run (a form submit) for a criterion, Enter and Ask for a scope.
 * A starter criterion replaces the box, so it refuses too.
 *
 * `useDictation` is stubbed, keyed on the keeper's name, the way
 * tests/add-page-dictation.test.tsx does it; `useDictationField`, the button
 * and the strip are the real ones, so "the microphone is there" is the real
 * button drawn by the real wiring.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, ChatThread } from "../src/types.js";

/* ------------------------------------------------------------- the mocks -- */

const mic = vi.hoisted(() => ({
  state: new Map<string, { armed: boolean; transcribing: boolean }>(),
  supported: true,
}));
vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (options: { keep?: { box: string } }) => {
    const name = options.keep?.box ?? "(no keeper)";
    const s = mic.state.get(name) ?? { armed: false, transcribing: false };
    return {
      supported: mic.supported,
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

let answer: (url: string, init: RequestInit) => Promise<Response> = () =>
  Promise.resolve(json({ criteria: [] }));
const calls: { url: string; method: string }[] = [];
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: (init.method ?? "GET").toUpperCase() });
    return answer(url, init);
  };
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { CriteriaBand } = await import("../src/web/CriteriaPanel.js");
const { CandidatesPanel } = await import("../src/web/CandidatesPanel.js");

/* ----------------------------------------------------------- the harness -- */

const SLUG = "a-paper";
const BLOCK = "spya-k3m9qt" as BlockId;
const BLOCKS: Block[] = [
  {
    id: BLOCK,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
];
/** A criterion of the referee's own, so the starters are drawn. */
const OWN = {
  id: "spya-crt2aa",
  criterion: "Is the exposure measured the same way in both arms?",
  config: { kind: "single" },
  createdAt: "2026-10-11T09:00:00.000Z",
  status: "done",
  results: [],
};

let host: HTMLDivElement;
let root: Root;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function type(el: HTMLTextAreaElement, text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mic.state.clear();
  mic.supported = true;
  answer = () => Promise.resolve(json({ criteria: [OWN] }));
  calls.length = 0;
  sessionStorage.clear();
  history.replaceState(null, "", `/read/${SLUG}`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const PHASES = [
  ["recording", { armed: true, transcribing: false }],
  ["transcribing", { armed: false, transcribing: true }],
] as const;

/* ------------------------------------------------ the criterion box -- */

describe("Referee's criterion box", () => {
  const KEEPER = `referee:criterion:${SLUG}`;

  function paint(): void {
    act(() => {
      root.render(
        createElement(
          NuqsAdapter,
          null,
          createElement(CriteriaBand, {
            slug: SLUG,
            blocks: BLOCKS,
            comments: [],
            onJump: () => {},
            onFound: () => {},
            openKey: null,
            onOpenKey: () => {},
          }),
        ),
      );
    });
  }

  const box = () => {
    const b = host.querySelector<HTMLTextAreaElement>("#crit-text");
    if (!b) throw new Error("criterion box did not render");
    return b;
  };
  const run = () => {
    const b = host.querySelector<HTMLButtonElement>(".crit-run");
    if (!b) throw new Error("no Run button");
    return b;
  };
  const writes = () => calls.filter((c) => c.method !== "GET");

  /** Typed while idle, then the microphone goes into `phase`. */
  async function typedThen(phase: { armed: boolean; transcribing: boolean } | null): Promise<void> {
    paint();
    await flush();
    type(box(), "Are the arms comparable at baseline?");
    if (phase) {
      mic.state.set(KEEPER, phase);
      paint();
    }
  }

  it("has a microphone, beside the box and not on the poles", async () => {
    paint();
    await flush();
    const form = host.querySelector(".crit-new");
    expect(form?.querySelectorAll("button.prof-mic")).toHaveLength(1);
  });

  it("does not draw a dead microphone when the browser cannot open one", async () => {
    mic.supported = false;
    paint();
    await flush();
    expect(host.querySelectorAll(".crit-new button.prof-mic")).toHaveLength(0);
  });

  it("runs when idle (the control the refusals below are measured against)", async () => {
    await typedThen(null);
    expect(run().getAttribute("aria-disabled")).toBe("false");
    act(() => run().click());
    await flush();
    expect(writes()).toHaveLength(1);
  });

  it("is read-only while the words are on its way", async () => {
    await typedThen({ armed: false, transcribing: true });
    expect(box().readOnly).toBe(true);
  });

  for (const [name, phase] of PHASES) {
    it(`does not run while ${name}, and Run says so`, async () => {
      await typedThen(phase);
      expect(run().getAttribute("aria-disabled")).toBe("true");
      act(() => run().click());
      await flush();
      expect(writes(), `a criterion ran while ${name}`).toEqual([]);
      expect(box().value).toBe("Are the arms comparable at baseline?");
    });

    it(`does not run from a form submit while ${name}`, async () => {
      await typedThen(phase);
      const form = host.querySelector<HTMLFormElement>(".crit-new");
      act(() => form?.requestSubmit());
      await flush();
      expect(writes()).toEqual([]);
    });

    it(`a starter does not replace the words while ${name}`, async () => {
      await typedThen(phase);
      const starter = host.querySelector<HTMLButtonElement>(".crit-preset");
      expect(starter, "no starter drawn").not.toBeNull();
      expect(starter?.disabled).toBe(true);
      act(() => starter?.click());
      expect(box().value).toBe("Are the arms comparable at baseline?");
    });
  }
});

/* ------------------------------------------------ the Candidates scope box -- */

describe("Candidates' scope box", () => {
  const KEEPER = `candidates:${SLUG}`;
  const asked: string[] = [];
  const THREAD: ChatThread = {
    id: "spya-thr3bb",
    title: "Candidates",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    kind: "candidates",
    messages: [],
  };

  function paint(): void {
    act(() => {
      root.render(
        createElement(CandidatesPanel, {
          slug: SLUG,
          thread: THREAD,
          loaded: true,
          loadFailed: false,
          onReload: () => {},
          blocks: BLOCKS,
          error: null,
          onAsk: (q: string) => asked.push(q),
          onStop: () => {},
          onStart: () => {},
          onJump: () => {},
        }),
      );
    });
  }

  const box = () => {
    const b = host.querySelector<HTMLTextAreaElement>("textarea.cnd-box");
    if (!b) throw new Error("no Candidates box");
    return b;
  };
  const ask = () => {
    const b = host.querySelector<HTMLButtonElement>(".cnd-send");
    if (!b) throw new Error("no Ask button");
    return b;
  };

  function typedThen(phase: { armed: boolean; transcribing: boolean } | null): void {
    asked.length = 0;
    paint();
    type(box(), "Leave out the authors' own lab");
    if (phase) {
      mic.state.set(KEEPER, phase);
      paint();
    }
  }

  it("has a microphone", () => {
    paint();
    expect(host.querySelectorAll(".cnd-composer button.prof-mic")).toHaveLength(1);
  });

  it("does not draw a dead microphone when the browser cannot open one", () => {
    mic.supported = false;
    paint();
    expect(host.querySelectorAll(".cnd-composer button.prof-mic")).toHaveLength(0);
  });

  it("asks on Enter when idle (the control)", () => {
    typedThen(null);
    press(box(), "Enter");
    expect(asked).toEqual(["Leave out the authors' own lab"]);
  });

  it("is read-only while the words are on their way", () => {
    typedThen({ armed: false, transcribing: true });
    expect(box().readOnly).toBe(true);
  });

  for (const [name, phase] of PHASES) {
    it(`does not ask on Enter while ${name}`, () => {
      typedThen(phase);
      press(box(), "Enter");
      expect(asked, `a scope was sent while ${name}`).toEqual([]);
      expect(box().value).toBe("Leave out the authors' own lab");
    });

    it(`disables Ask while ${name}`, () => {
      typedThen(phase);
      expect(ask().disabled).toBe(true);
      act(() => ask().click());
      expect(asked).toEqual([]);
    });
  }
});
