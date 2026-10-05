// @vitest-environment jsdom
/**
 * **A double press on Stop, in the command bar, presses Enter when the words
 * arrive.** Greg, 2026-10-05, answering the open question in
 * docs/plans/261005a-dictation-double-press-on-stop-also-sends.md: *"yes for
 * the command bar"*.
 *
 * The real `Dock`, `CommandBar`, `useDictationField` and `DictationButton`;
 * only `useDictation` is stubbed, as tests/dictation-double-stop-sends.test.tsx
 * stubs it, so each ending is driven through the options the field gave it —
 * `onTranscript`, then `onEnd`, the real hook's order.
 *
 * What it pins is that the double press is **Enter and nothing more**:
 *
 *  - a phrase that names a row runs that row, once;
 *  - a phrase that names nothing is asked about, and the answer is handled as
 *    Enter's is — a proposal is drawn and waits, never run;
 *  - one press, a failed transcript and a bar shut in the meantime run nothing.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMAND_PICK_PATH, type PickAnswer, type PickKey, type PickRequest } from "../src/command-pick.js";
import type { ArchiveControl } from "../src/web/useArchive.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

interface Options {
  onTranscript(text: string): boolean | undefined;
  onEnd(): void;
}
const mic = vi.hoisted(() => ({
  armed: false,
  transcribing: false,
  toggles: 0,
  options: null as unknown,
}));
vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (options: unknown) => {
    mic.options = options;
    return {
      supported: true,
      armed: mic.armed,
      transcribing: mic.transcribing,
      phase: mic.armed ? "listening" : mic.transcribing ? "transcribing" : "idle",
      error: null,
      toggle() {
        mic.toggles++;
      },
    };
  },
}));

const { Dock } = await import("../src/web/Dock.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { HELP_TOPICS } = await import("../src/web/help/help-topics.js");

const SLUG = "a-piece";
const GLOSSARY: PickKey = { id: "mode:glossary", label: "Glossary" };
const CHANGELOG: PickKey = { id: "page:/changelog", label: "What’s new" };
const SENTENCE = "um show me what is new on the site";

let host: HTMLDivElement;
let root: Root;
let openedModes: string[];
let archiveSet: ReturnType<typeof vi.fn>;
let asked: { body: PickRequest; answer: (json: unknown) => void }[];

function draw(): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as tests/command-bar.test.tsx § reading
      createElement(Dock as any, {
        slug: SLUG,
        view: "article",
        mode: "plain",
        onMode: (mode: string) => openedModes.push(mode),
        experimental: EXPERIMENTAL_OFF,
        shelfRow: {
          archive: { at: null, lost: false, busy: false, error: null, set: archiveSet } as unknown as ArchiveControl,
          tags: { edit: vi.fn(async () => []) },
        },
        executor: { runners: {}, sources: {} },
      }),
    );
  });
}

const dialog = (): HTMLDialogElement => host.querySelector("dialog.cmdbar") as HTMLDialogElement;
const input = (): HTMLInputElement => dialog().querySelector("input.cmdbar-input") as HTMLInputElement;
const micButton = (): HTMLButtonElement => dialog().querySelector("button.prof-mic") as HTMLButtonElement;
const strip = (): string => dialog().querySelector(".prof-listening-what")?.textContent ?? "";
const status = (): string => dialog().querySelector('p.cmdbar-status')?.textContent ?? "";
const heading = (): string | null => dialog().querySelector(".cmdbar-suggested")?.textContent ?? null;
const listed = (): string[] =>
  [...dialog().querySelectorAll<HTMLElement>('[role="option"]')].map(
    (r) => r.querySelector(".cmdbar-name")?.textContent ?? "",
  );
const options = (): Options => mic.options as Options;

function openBar(): void {
  act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
}
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** One press: the microphone is on. */
function start(): void {
  act(() => micButton().click());
  mic.armed = true;
  draw();
}
/** The Stop press: the microphone goes off and the transcript is on its way. */
function stop(): void {
  act(() => micButton().click());
  mic.armed = false;
  mic.transcribing = true;
  draw();
}
/** A second press on the same button, as a finger makes it. A disabled button takes none. */
function pressAgain(): void {
  act(() => micButton().click());
}
/** The hook's ending, in its real order: the words, the phase, then `onEnd`. */
async function end(transcript: string | null): Promise<void> {
  act(() => {
    if (transcript !== null) options().onTranscript(transcript);
    mic.transcribing = false;
    options().onEnd();
  });
  draw();
  await settle();
}
async function answer(json: PickAnswer): Promise<void> {
  asked.at(-1)?.answer(json);
  await settle();
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}?at=spya-k3m9qt`);
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  mic.armed = false;
  mic.transcribing = false;
  mic.toggles = 0;
  openedModes = [];
  archiveSet = vi.fn(async () => ({ kind: "done" }) as const);
  asked = [];
  jobEngine.reset();
  vi.stubGlobal("fetch", (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "/api/jobs") return Promise.resolve(new Response(JSON.stringify({ jobs: [] })));
    if (String(url) === COMMAND_PICK_PATH) {
      return new Promise<Response>((resolve) => {
        asked.push({
          body: JSON.parse(String(init?.body)) as PickRequest,
          answer: (json) => resolve(new Response(JSON.stringify(json))),
        });
      });
    }
    return Promise.resolve(new Response("{}"));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  draw();
  openBar();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a double press on Stop in the command bar", () => {
  it("runs the row the phrase names, once, having said that it will", async () => {
    start();
    stop();
    expect(micButton().disabled, "live for the second press").toBe(false);
    expect(micButton().getAttribute("aria-label")).toBe("Press Enter when the words arrive");
    pressAgain();
    expect(micButton().disabled).toBe(true);
    expect(micButton().getAttribute("aria-label")).toMatch(/then pressing Enter/);
    expect(strip()).toBe("Turning that into text, then pressing Enter…");
    expect(openedModes, "nothing before the words").toEqual([]);
    await end("plain");
    expect(openedModes).toEqual(["plain"]);
    expect(mic.toggles, "the second press never started a dictation").toBe(2);
  });

  it("runs a row that writes, exactly as Enter on that phrase does", async () => {
    start();
    stop();
    pressAgain();
    await end("archive this article");
    expect(archiveSet).toHaveBeenCalledTimes(1);
    expect(archiveSet).toHaveBeenCalledWith(true);
  });

  it("asks about a phrase that names nothing, and draws the answer without running it", async () => {
    start();
    stop();
    pressAgain();
    await end(SENTENCE);
    expect(asked.map((a) => a.body.sentence)).toEqual([SENTENCE]);
    expect(status()).toBe("Working out what you meant…");
    /* Glossary generates on opening: however sure the model, Enter draws it
       and waits for a fresh press, and so does this. */
    await answer({ kind: "row", key: GLOSSARY, confidence: 0.99, others: [] });
    expect(heading()).toBe("Did you mean");
    expect(listed()).toEqual(["Glossary"]);
    expect(openedModes).toEqual([]);
    expect(dialog().open).toBe(true);
  });

  it("goes where a sure pick that only moves the reader points, as Enter's ask does", async () => {
    start();
    stop();
    pressAgain();
    await end(SENTENCE);
    await answer({ kind: "row", key: CHANGELOG, confidence: 0.99, others: [] });
    expect(location.pathname).toBe("/changelog");
  });

  it("does nothing more than today on one press", async () => {
    start();
    stop();
    expect(strip()).toBe("Turning that into text…");
    await end("plain");
    expect(input().value).toBe("plain");
    expect(openedModes).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("runs nothing when no transcript arrived", async () => {
    start();
    stop();
    pressAgain();
    await end(null);
    expect(openedModes).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("runs nothing once the bar has been shut, even if it is opened again before the words", async () => {
    start();
    stop();
    pressAgain();
    act(() => dialog().dispatchEvent(new Event("close")));
    draw();
    openBar();
    expect(strip(), "the promise went with the bar").toBe("Turning that into text…");
    await end("plain");
    expect(openedModes).toEqual([]);
  });
});

describe("the reader's help", () => {
  it("says the command bar takes the double press", () => {
    const keyboard = Object.values(HELP_TOPICS).find((topic) => topic.title === "Keyboard shortcuts");
    act(() => root.render(keyboard?.body));
    expect(host.textContent ?? "").toMatch(/Stop twice/);
  });
});
