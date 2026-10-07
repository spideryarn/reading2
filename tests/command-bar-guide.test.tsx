// @vitest-environment jsdom
/**
 * **The command bar's door to the guide** — plan 261007j § After the plan
 * review, F6. A sentence that matches no row still goes to the fast pick
 * first; only when the pick could not tell does the bar offer *Ask the guide:
 * “…”*, and a fresh press of that row hands the sentence to the guide, sent.
 *
 * What a happy path would not see:
 *
 *  - **the first Enter is the pick's**, never the guide's: no row before the
 *    answer, and a pick that found rows offers no guide;
 *  - **exactly one handoff per press**: two clicks, or a click and an Enter,
 *    before the bar has shut send once;
 *  - **a held Enter cannot press it** (postmortem 261005o): the repeat of the
 *    Enter that asked must not confirm a paid send;
 *  - **a changed sentence drops the row**, which was about the old words;
 *  - **no row where the page cannot hand over** (no `askGuide`: a visitor, the
 *    Metadata page).
 *
 * Harness after tests/command-bar-pick.test.tsx: the real `Dock`, `fetch`
 * stubbed at the pick route.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMAND_PICK_PATH, COULD_NOT_TELL, type PickAnswer, type PickRequest } from "../src/command-pick.js";
import type { ActionOutcome } from "../src/web/command-match.js";
import type { CommandExecutor } from "../src/web/command-proposal.js";
import { EXPERIMENTAL_OFF, EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

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
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: false, armed: false, transcribing: false, toggle: () => {} },
    readOnly: false,
    busy: false,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));

const { Dock } = await import("../src/web/Dock.js");
const { ASK_AGAIN_LABEL, GENERATES_MARKER, NO_MATCH, guideLabel } = await import("../src/web/CommandBar.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

const SLUG = "a-piece";
const SENTENCE = "what should I be careful about when I read this";

let host: HTMLDivElement;
let root: Root;
let asked: { body: PickRequest; answer: (json: unknown, status?: number) => void }[];
let handed: string[];

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}`);
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
  asked = [];
  handed = [];
  jobEngine.reset();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/jobs") return Promise.resolve(new Response(JSON.stringify({ jobs: [] })));
    if (url === COMMAND_PICK_PATH) {
      return new Promise<Response>((resolve) => {
        asked.push({
          body: JSON.parse(String(init?.body)) as PickRequest,
          answer: (json, status = 200) => resolve(new Response(JSON.stringify(json), { status })),
        });
      });
    }
    return Promise.resolve(new Response("{}"));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function executor(withGuide = true): CommandExecutor {
  return {
    runners: {},
    sources: {},
    ...(withGuide
      ? {
          askGuide: (sentence: string): ActionOutcome => {
            handed.push(sentence);
            return { kind: "close" };
          },
        }
      : {}),
  };
}

function reading(exec: CommandExecutor = executor(), experimental = EXPERIMENTAL_OFF): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as tests/command-bar.test.tsx § reading
      createElement(Dock as any, {
        slug: SLUG,
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental,
        executor: exec,
      }),
    );
  });
}

const dialog = (): HTMLDialogElement => host.querySelector("dialog.cmdbar") as HTMLDialogElement;
const input = (): HTMLInputElement => dialog().querySelector("input.cmdbar-input") as HTMLInputElement;
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];
const listed = (): string[] => rows().map((r) => r.querySelector(".cmdbar-name")?.textContent ?? "");
const status = (): string => dialog().querySelector('[role="status"]')?.textContent ?? "";
const empty = (): string | null => dialog().querySelector(".cmdbar-empty")?.textContent ?? null;

const openBar = (): void => act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
function type(text: string): void {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function press(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}
async function askAndHear(json: PickAnswer | Record<string, unknown>, code = 200): Promise<void> {
  type(SENTENCE);
  press("Enter");
  await settle();
  asked.at(-1)?.answer(json, code);
  await settle();
}

const GUIDE_ROW = `Ask the guide: “${SENTENCE}”`;

describe("the bar's door to the guide", () => {
  it("is not offered before the pick has answered: the first Enter asks the pick", async () => {
    reading();
    openBar();
    type(SENTENCE);
    expect(listed()).toEqual([]);
    press("Enter");
    await settle();
    expect(asked).toHaveLength(1);
    expect(listed()).toEqual([]);
    expect(handed).toEqual([]);
  });

  it("is offered when the pick could not tell, and a fresh Enter sends the sentence to the guide once, and shuts the bar", async () => {
    reading();
    openBar();
    await askAndHear({ kind: "none" });
    expect(status()).toBe(COULD_NOT_TELL);
    expect(listed()).toEqual([GUIDE_ROW]);
    expect(guideLabel(SENTENCE)).toBe(GUIDE_ROW);
    expect(rows()[0]?.querySelector(".cmdbar-generates")?.textContent).toBe(GENERATES_MARKER);
    press("Enter");
    expect(handed).toEqual([SENTENCE]);
    expect(dialog().open).toBe(false);
    expect(asked, "the press asked the pick again").toHaveLength(1);
  });

  it("is not offered after a failed pick, which keeps the one-press retry", async () => {
    reading();
    openBar();
    await askAndHear({ error: "slow" }, 504);
    expect(listed()).toEqual([]);
    expect(empty()).toBe(`${NO_MATCH} ${ASK_AGAIN_LABEL}`);
  });

  it("is not offered when the pick found rows", async () => {
    reading();
    openBar();
    await askAndHear({ kind: "row", key: { id: "page:/profile", label: "Profile" }, confidence: 0.5, others: [] });
    expect(listed()).not.toContain(GUIDE_ROW);
    expect(handed).toEqual([]);
  });

  it("is not pressed by a held Enter's repeat", async () => {
    reading();
    openBar();
    await askAndHear({ kind: "none" });
    press("Enter", { repeat: true });
    expect(handed).toEqual([]);
    expect(dialog().open).toBe(true);
  });

  it("hands over once for two clicks before the bar has shut", async () => {
    reading();
    openBar();
    await askAndHear({ kind: "none" });
    const [row] = rows();
    act(() => {
      row?.click();
      row?.click();
    });
    expect(handed).toEqual([SENTENCE]);
  });

  it("goes when the sentence changes", async () => {
    reading();
    openBar();
    await askAndHear({ kind: "none" });
    type(`${SENTENCE}, please`);
    expect(listed()).toEqual([]);
    press("Enter");
    await settle();
    expect(handed).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  it("goes when the command catalogue changes after the answer", async () => {
    reading();
    openBar();
    await askAndHear({ kind: "none" });
    expect(listed()).toEqual([GUIDE_ROW]);
    reading(executor(), EXPERIMENTAL_ON);
    expect(listed()).not.toContain(GUIDE_ROW);
    press("Enter");
    await settle();
    expect(handed).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  it("is not offered where the page cannot hand over: Try again, as before", async () => {
    reading(executor(false));
    openBar();
    await askAndHear({ kind: "none" });
    expect(listed()).toEqual([]);
    expect(empty()).toBe(`${NO_MATCH} ${ASK_AGAIN_LABEL}`);
  });
});
