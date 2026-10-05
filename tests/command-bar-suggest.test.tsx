// @vitest-environment jsdom
/**
 * **The command bar proposes a short list from why you are reading** — Stage 2
 * of docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md,
 * drawn out of the real `Dock` as tests/command-bar-pick.test.tsx draws it,
 * with `fetch` stubbed at `GET /api/reader?slug=` and
 * `POST /api/command-suggest/:slug` so each test decides what the profile says
 * and when the list lands.
 *
 * Greg, 2026-10-03: *"if they fill in the why you're reading this, then
 * somehow that should inform things."*
 *
 * What a happy path would not see:
 *
 *  - **Nothing a model names is run.** A list naming a mode that generates
 *    draws that mode's own row, with its own mark, and opens nothing until it
 *    is pressed.
 *  - **The list is kept for the visit, in state of its own** (GPT Sol's F2):
 *    press a search, the bar shuts, open it again, the list is there and
 *    nothing was posted again; typing hides it and clearing brings it back.
 *  - **A save drops it** (F3): *About you*, or the reason, and a save made
 *    while the request is out means the answer is never drawn.
 *  - **A key that is not a mode is not a row** (F1), whatever comes back.
 *  - **A visitor, the Metadata page and an article with no reason see no row
 *    and post nothing.**
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PickKey } from "../src/command-pick.js";
import {
  LENS_DESCRIPTION,
  SUGGESTING,
  SUGGEST_HEADING,
  SUGGEST_LABEL,
  SUGGEST_NOTHING,
  SUGGEST_NO_REASON,
  type SuggestAnswer,
  type SuggestRequest,
  lensLabel,
  readFromHash,
} from "../src/command-suggest.js";
import { REASON_NOT_READ } from "../src/messages.js";
import type { ActionOutcome } from "../src/web/command-match.js";
import type { CommandExecutor } from "../src/web/command-proposal.js";
import type { DockExperimental } from "../src/web/Dock.js";
import type { ArchiveControl } from "../src/web/useArchive.js";
import { EXPERIMENTAL_OFF, EXPERIMENTAL_SIGNED_OUT } from "./helpers/experimental-fixtures.js";

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
const { jobEngine } = await import("../src/web/jobEngine.js");
const { saveProfile } = await import("../src/web/useProfile.js");
const { savePurpose } = await import("../src/web/purpose.js");

const SLUG = "a-piece";
const SUGGEST_PATH = `/api/command-suggest/${SLUG}`;
const READER_PATH = `/api/reader?slug=${SLUG}`;

const GLOSSARY: PickKey = { id: "mode:glossary", label: "Glossary" };
const PLAIN: PickKey = { id: "mode:plain", label: "Plain" };
const ARCHIVE: PickKey = { id: "action:archive", label: "Archive this article" };

const SEARCH_1 = "handling of missing data";
const SEARCH_2 = "imputation method";
const LENS = "criticism of the imputation";

let host: HTMLDivElement;
let root: Root;
let openedModes: string[];
let searched: string[];
let lensed: string[];
/** What `GET /api/reader?slug=` says now. */
let profile: { profile: string | null; purpose: string | null; purposeFailed?: boolean };
let readerReads: number;
let deferReader: boolean;
let readerStatus: number;
let readerAnswers: (() => void)[];
/** Every post to the suggest route, each with the way to answer it. */
let asked: {
  body: SuggestRequest;
  signal: AbortSignal | null | undefined;
  answer: (json: unknown, status?: number) => void;
}[];
/** Every other request that is not a read: a save, and anything nobody expected. */
let written: string[];

const hashNow = (): string => readFromHash({ profile: profile.profile, purpose: profile.purpose });

/** A list as the server would send it for the profile as it stands. */
function list(over: Partial<Extract<SuggestAnswer, { kind: "suggestions" }>> = {}): SuggestAnswer {
  return {
    kind: "suggestions",
    readFrom: hashNow(),
    searches: [
      { words: SEARCH_1, why: "Finds how gaps in the data were dealt with." },
      { words: SEARCH_2, why: "Shows the method used to fill them." },
    ],
    modes: [{ key: GLOSSARY, why: "Explains the terms you will meet." }],
    lens: { words: LENS, why: "What others made of the method." },
    ...over,
  };
}

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
  openedModes = [];
  searched = [];
  lensed = [];
  asked = [];
  written = [];
  readerReads = 0;
  deferReader = false;
  readerStatus = 200;
  readerAnswers = [];
  profile = { profile: "A statistician.", purpose: "how they handled missing data" };
  jobEngine.reset();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/jobs") return Promise.resolve(new Response(JSON.stringify({ jobs: [] })));
    if (url === READER_PATH && method === "GET") {
      readerReads += 1;
      const body = JSON.stringify(readerStatus === 200 ? { purposeFailed: false, ...profile } : { error: "Temporary read failure. [bar-reason-unread]" });
      if (deferReader) return new Promise<Response>((resolve) => readerAnswers.push(() => resolve(new Response(body, { status: readerStatus }))));
      return Promise.resolve(new Response(body, { status: readerStatus }));
    }
    if (url === SUGGEST_PATH && method === "POST") {
      return new Promise<Response>((resolve) => {
        asked.push({
          body: JSON.parse(String(init?.body)) as SuggestRequest,
          signal: init?.signal,
          answer: (json, status = 200) => resolve(new Response(JSON.stringify(json), { status })),
        });
      });
    }
    if (method !== "GET") {
      written.push(`${method} ${url}`);
      /* The two saves, answered as the server answers them. */
      const body = JSON.parse(String(init?.body ?? "{}")) as { profile?: string | null; purpose?: string | null };
      if (url === "/api/reader") profile = { ...profile, profile: body.profile ?? null };
      if (url === `/api/library/${SLUG}`) profile = { ...profile, purpose: body.purpose ?? null };
      return Promise.resolve(new Response(JSON.stringify(body)));
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

const CLOSE: ActionOutcome = { kind: "close" };

function executor({ lens = true, quick = true }: { lens?: boolean; quick?: boolean } = {}): CommandExecutor {
  return {
    runners: {},
    sources: {},
    ...(quick
      ? {
          quickSearch: (words: string) => {
            searched.push(words);
            return CLOSE;
          },
        }
      : {}),
    ...(lens
      ? {
          askThroughLens: (words: string) => {
            lensed.push(words);
            return CLOSE;
          },
        }
      : {}),
  };
}

const shelfRow = () => ({
  archive: { at: null, lost: false, busy: false, error: null, set: vi.fn() } as unknown as ArchiveControl,
  tags: { edit: vi.fn(async () => []) },
});

async function reading({
  exec = executor(),
  owner = true,
  setting = EXPERIMENTAL_OFF,
  view = "article",
}: {
  /** `null`: the page hands in none, as the Metadata page does. */
  exec?: CommandExecutor | null;
  owner?: boolean;
  setting?: DockExperimental;
  view?: "article" | "metadata";
} = {}): Promise<void> {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as tests/command-bar.test.tsx § reading
      createElement(Dock as any, {
        slug: SLUG,
        view,
        mode: "plain",
        onMode: (mode: string) => openedModes.push(mode),
        experimental: setting,
        shelfRow: owner ? shelfRow() : undefined,
        executor: exec ?? undefined,
      }),
    );
  });
  await settle();
}

const dialog = (): HTMLDialogElement => host.querySelector("dialog.cmdbar") as HTMLDialogElement;
const input = (): HTMLInputElement => dialog().querySelector("input.cmdbar-input") as HTMLInputElement;
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];
const nameOf = (r: HTMLElement): string => r.querySelector(".cmdbar-name")?.textContent ?? "";
const listed = (): string[] => rows().map(nameOf);
const suggested = (): HTMLElement[] => rows().filter((r) => r.classList.contains("cmdbar-row-suggested"));
const status = (): string => dialog().querySelector(".cmdbar-status")?.textContent ?? "";
const waiting = (): string => dialog().querySelector(".cmdbar-suggesting")?.textContent ?? "";
const heading = (): string | null => dialog().querySelector(".cmdbar-from-why")?.textContent ?? null;
const selectedName = (): string => nameOf(rows().find((r) => r.getAttribute("aria-selected") === "true") as HTMLElement);

async function openBar(): Promise<void> {
  act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
  await settle();
}

/** Escape: the dialog shuts itself and tells the Dock. */
async function shutBar(): Promise<void> {
  act(() => dialog().close());
  await settle();
}

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
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function answer(json: unknown, statusCode = 200): Promise<void> {
  asked.at(-1)?.answer(json, statusCode);
  await settle();
}

/** Open the bar, press the row that asks, and land the list. */
async function suggestAndLand(json: unknown = list()): Promise<void> {
  await openBar();
  expect(listed()[0]).toBe(SUGGEST_LABEL);
  press("Enter");
  await settle();
  await answer(json);
}

const QUICK_1 = `Quick search “${SEARCH_1}”`;
const QUICK_2 = `Quick search “${SEARCH_2}”`;

describe("who is offered the row", () => {
  it("is the owner, on the reading view, of an article with a reason — first, on an empty box", async () => {
    await reading();
    await openBar();
    expect(listed()[0]).toBe(SUGGEST_LABEL);
    expect(listed()[1]).toBe("Plain");
    /* Nothing is asked until it is pressed. */
    expect(asked).toEqual([]);
    /* And no price, and no `generates`: it keeps nothing. */
    expect(rows()[0]?.textContent).not.toMatch(/\$|¢|cent|generates/);
  });

  it("is not typed into view: a word hides it, and it is not a row a sentence can name", async () => {
    await reading();
    await openBar();
    type("suggest");
    expect(listed()).not.toContain(SUGGEST_LABEL);
  });

  it("is nobody with no reason for reading", async () => {
    profile = { profile: "A statistician.", purpose: null };
    await reading();
    await openBar();
    expect(listed()).not.toContain(SUGGEST_LABEL);
    expect(listed()[0]).toBe("Plain");
    press("Enter");
    await settle();
    expect(asked).toEqual([]);
  });

  it("shows a retryable failure when the reason could not be read (F6)", async () => {
    profile = { profile: "A statistician.", purpose: null, purposeFailed: true };
    await reading();
    await openBar();
    expect(status()).toBe(REASON_NOT_READ.message);
    expect(listed()[0]).toBe(SUGGEST_LABEL);
    expect(asked).toEqual([]);
    profile = { ...profile, purpose: "the evidence", purposeFailed: false };
    press("Enter");
    await settle();
    await answer(list());
    expect(suggested()).toHaveLength(4);
    expect(status()).toBe("");
  });

  it("shows a retryable failure when the profile GET itself fails", async () => {
    readerStatus = 503;
    await reading();
    await openBar();
    expect(status()).toBe(REASON_NOT_READ.message);
    expect(listed()[0]).toBe(SUGGEST_LABEL);
    expect(asked).toEqual([]);
  });

  it("is not a visitor, somebody signed out, or the Metadata page — and none of them reads the profile", async () => {
    for (const where of [
      { owner: false },
      { setting: EXPERIMENTAL_SIGNED_OUT },
      /* The Metadata page hands in no executor: no band, so no quick search. */
      { view: "metadata" as const, exec: null },
      { exec: executor({ quick: false }) },
    ]) {
      await reading(where);
      await openBar();
      expect(listed(), JSON.stringify(Object.keys(where))).not.toContain(SUGGEST_LABEL);
      await shutBar();
    }
    expect(readerReads).toBe(0);
    expect(asked).toEqual([]);
  });
});

describe("asking", () => {
  it("keeps the selected command when a slow profile read inserts the suggestion row", async () => {
    deferReader = true;
    await reading();
    await openBar();
    press("ArrowDown");
    expect(selectedName()).toBe("Structure");
    act(() => readerAnswers.at(-1)?.());
    await settle();
    expect(listed()[0]).toBe(SUGGEST_LABEL);
    expect(selectedName()).toBe("Structure");
    press("Enter");
    await settle();
    expect(openedModes).toEqual(["structure"]);
    expect(asked).toEqual([]);
  });
  it("posts the keys of the mode rows and nothing else, once, and waits with the bar open", async () => {
    await reading();
    await openBar();
    press("Enter");
    press("Enter");
    await settle();
    expect(asked).toHaveLength(1);
    const { body } = asked[0] as (typeof asked)[number];
    expect(Object.keys(body)).toEqual(["rows"]);
    expect(body.rows).toContainEqual(GLOSSARY);
    expect(body.rows).toContainEqual(PLAIN);
    for (const key of body.rows) {
      expect(Object.keys(key).sort()).toEqual(["id", "label"]);
      expect(key.id).toMatch(/^(mode|submode):/);
    }
    /* Nothing of the reader's is sent: the server loads the profile itself. */
    expect(JSON.stringify(body)).not.toMatch(/statistician|missing data/);
    expect(waiting()).toBe(SUGGESTING);
    expect(dialog().open).toBe(true);
  });

  it("does not ask on a held Enter, or one that is finishing a word in an input method", async () => {
    await reading();
    await openBar();
    press("Enter", { repeat: true });
    press("Enter", { isComposing: true });
    await settle();
    expect(asked).toEqual([]);
  });

  it("is asked by a finger on the row as well", async () => {
    await reading();
    await openBar();
    act(() => rows()[0]?.click());
    await settle();
    expect(asked).toHaveLength(1);
  });
});

describe("the list", () => {
  it("is drawn under its heading, above the ordinary rows, each with its why", async () => {
    await reading();
    await suggestAndLand();
    expect(waiting()).toBe("");
    expect(heading()).toBe(SUGGEST_HEADING);
    expect(suggested().map(nameOf)).toEqual([QUICK_1, QUICK_2, "Glossary", lensLabel(LENS)]);
    expect(suggested().map((r) => r.querySelector(".cmdbar-why")?.textContent)).toEqual([
      "Finds how gaps in the data were dealt with.",
      "Shows the method used to fill them.",
      "Explains the terms you will meet.",
      "What others made of the method.",
    ]);
    /* The row that asked is gone while there is a list; the ordinary rows follow. */
    expect(listed()).not.toContain(SUGGEST_LABEL);
    expect(listed().slice(4, 6)).toEqual(["Plain", "Structure"]);
    expect(selectedName()).toBe(QUICK_1);
    expect(dialog().open).toBe(true);
  });

  it("sets the model's words in the model's face, and ours in ours", async () => {
    await reading();
    await suggestAndLand();
    const [search, , , lens] = suggested();
    expect(search?.querySelector(".cmdbar-name .voice-ai")?.textContent).toBe(SEARCH_1);
    expect(lens?.querySelector(".cmdbar-name .voice-ai")?.textContent).toBe(LENS);
    expect(search?.querySelector(".cmdbar-why")?.classList.contains("voice-ai")).toBe(true);
    expect(lens?.querySelector(".cmdbar-what")?.textContent).toBe(LENS_DESCRIPTION);
  });

  it("runs nothing when it lands, whatever the model named — a mode that generates is its own row, with its own mark, and waits", async () => {
    await reading();
    await suggestAndLand();
    expect(openedModes).toEqual([]);
    expect(searched).toEqual([]);
    expect(lensed).toEqual([]);
    expect(written).toEqual([]);
    /* The suggested Glossary row is the bar's Glossary row: same kind, same mark. */
    const [suggestedGlossary, ordinaryGlossary] = rows().filter((r) => nameOf(r) === "Glossary");
    expect(suggestedGlossary?.classList.contains("cmdbar-row-suggested")).toBe(true);
    expect(ordinaryGlossary?.classList.contains("cmdbar-row-suggested")).toBe(false);
    expect(suggestedGlossary?.dataset.kind).toBe("mode");
    expect(ordinaryGlossary?.querySelector(".cmdbar-generates")?.textContent).toBe("generates");
    expect(suggestedGlossary?.querySelector(".cmdbar-generates")?.textContent).toBe("generates");
    /* Two rows for one command are two elements a screen reader can tell apart. */
    expect(suggestedGlossary?.id).not.toBe(ordinaryGlossary?.id);
    /* Pressed, it opens exactly as the ordinary row does. */
    act(() => suggestedGlossary?.click());
    await settle();
    expect(openedModes).toEqual(["glossary"]);
  });

  it("drops a key that is not a mode here, and a mode the reader does not have — an Archive key is not a row (F1)", async () => {
    await reading();
    await suggestAndLand(
      list({
        modes: [
          { key: ARCHIVE, why: "Not a mode." },
          /* Behind the Experimental switch, which is off: not a row the bar has now. */
          { key: { id: "mode:referee", label: "Referee" }, why: "Not offered here." },
        ],
      }),
    );
    expect(suggested().map(nameOf)).toEqual([QUICK_1, QUICK_2, lensLabel(LENS)]);
  });

  it("survives a press and a reopening: search, shut, open, the next one — and nothing is asked again (F2)", async () => {
    await reading();
    await suggestAndLand();
    press("Enter");
    await settle();
    expect(searched).toEqual([SEARCH_1]);
    expect(dialog().open).toBe(false);

    await openBar();
    expect(heading()).toBe(SUGGEST_HEADING);
    expect(suggested().map(nameOf)).toEqual([QUICK_1, QUICK_2, "Glossary", lensLabel(LENS)]);
    press("ArrowDown");
    expect(selectedName()).toBe(QUICK_2);
    press("Enter");
    await settle();
    expect(searched).toEqual([SEARCH_1, SEARCH_2]);
    expect(asked).toHaveLength(1);
  });

  it("is hidden while the reader types, and back when they clear the box (F2)", async () => {
    await reading();
    await suggestAndLand();
    type("glos");
    expect(heading()).toBeNull();
    expect(suggested()).toEqual([]);
    expect(listed()).toContain("Glossary");
    type("");
    expect(heading()).toBe(SUGGEST_HEADING);
    expect(suggested()).toHaveLength(4);
    expect(asked).toHaveLength(1);
  });

  it("lets the arrows walk off the list into the ordinary rows", async () => {
    await reading();
    await suggestAndLand();
    for (let i = 0; i < 4; i++) press("ArrowDown");
    expect(selectedName()).toBe("Plain");
    press("Enter");
    await settle();
    expect(openedModes).toEqual(["plain"]);
  });

  it("hands the lens to Chat's box and sends nothing", async () => {
    await reading();
    await suggestAndLand();
    for (let i = 0; i < 3; i++) press("ArrowDown");
    expect(selectedName()).toBe(lensLabel(LENS));
    expect(suggested()[3]?.querySelector(".cmdbar-generates")).toBeNull();
    press("Enter");
    await settle();
    expect(lensed).toEqual([LENS]);
    /* Only the handoff: no chat was posted, no search run, no mode opened by the bar. */
    expect(written).toEqual([]);
    expect(searched).toEqual([]);
    expect(dialog().open).toBe(false);
  });

  it("draws no lens row where the page handed in no way to Chat", async () => {
    await reading({ exec: executor({ lens: false }) });
    await suggestAndLand();
    expect(suggested().map(nameOf)).toEqual([QUICK_1, QUICK_2, "Glossary"]);
  });

  it("is kept even if the bar was shut while it was on its way", async () => {
    await reading();
    await openBar();
    press("Enter");
    await settle();
    await shutBar();
    await answer(list());
    expect(dialog().open).toBe(false);
    expect(searched).toEqual([]);
    await openBar();
    expect(suggested()).toHaveLength(4);
    expect(asked).toHaveLength(1);
  });
});

describe("a save drops the list (F3)", () => {
  for (const laterReadFirst of [true, false]) {
    it(`does not let an old suggestion overwrite a newer opening read (${laterReadFirst ? "GET first" : "suggestion first"})`, async () => {
      await reading();
      await openBar();
      const stale = list();
      press("Enter");
      await settle();
      await shutBar();
      profile = { ...profile, profile: "A clinician." };
      deferReader = !laterReadFirst;
      await openBar();
      await answer(stale);
      if (!laterReadFirst) {
        expect(readerAnswers).toHaveLength(1);
        act(() => readerAnswers[0]?.());
        await settle();
      }
      expect(suggested()).toEqual([]);
      expect(listed()[0]).toBe(SUGGEST_LABEL);
    });
  }

  it("does not display an old no-reason reply over a newer opening read", async () => {
    await reading();
    await openBar();
    press("Enter");
    await settle();
    await shutBar();
    profile = { ...profile, purpose: "the control group" };
    await openBar();
    await answer({ kind: "nothing", why: "no-reason" });
    expect(status()).toBe("");
    expect(listed()[0]).toBe(SUGGEST_LABEL);
  });

  it("drops the list even when a save leaves the stored words identical", async () => {
    await reading();
    await suggestAndLand();
    await act(async () => { await saveProfile(profile.profile ?? ""); });
    await settle();
    expect(suggested()).toEqual([]);
    expect(listed()[0]).toBe(SUGGEST_LABEL);
  });
  it("About you, edited — the row that asks is back, for the profile as it is now", async () => {
    await reading();
    await suggestAndLand();
    await act(async () => {
      await saveProfile("A clinician.");
    });
    await settle();
    expect(heading()).toBeNull();
    expect(suggested()).toEqual([]);
    expect(listed()[0]).toBe(SUGGEST_LABEL);
    press("Enter");
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("resets selection when a save removes the selected suggestion", async () => {
    await reading();
    await suggestAndLand();
    press("ArrowDown");
    expect(selectedName()).toBe(QUICK_2);
    await act(async () => { await saveProfile("A clinician."); });
    await settle();
    expect(selectedName()).toBe(SUGGEST_LABEL);
    press("Enter");
    await settle();
    expect(asked).toHaveLength(2);
    expect(openedModes).toEqual([]);
  });

  it("the reason, edited", async () => {
    await reading();
    await suggestAndLand();
    await act(async () => {
      await savePurpose(SLUG, "what the control group was given");
    });
    await settle();
    expect(suggested()).toEqual([]);
    expect(listed()[0]).toBe(SUGGEST_LABEL);
  });

  it("the reason, cleared — nothing is offered any more", async () => {
    await reading();
    await suggestAndLand();
    await act(async () => {
      await savePurpose(SLUG, null);
    });
    await settle();
    expect(suggested()).toEqual([]);
    expect(listed()).not.toContain(SUGGEST_LABEL);
  });

  it("a save made while the request is out: the answer is never drawn, and the call is stopped", async () => {
    await reading();
    await openBar();
    press("Enter");
    await settle();
    expect(waiting()).toBe(SUGGESTING);
    const out = asked[0];
    /* The list the server was writing was read from the old reason. */
    const stale = list();
    await act(async () => {
      await savePurpose(SLUG, "what the control group was given");
    });
    await settle();
    expect(out?.signal?.aborted).toBe(true);
    expect(waiting()).toBe("");
    await answer(stale);
    expect(heading()).toBeNull();
    expect(suggested()).toEqual([]);
    /* And the reader can ask again at once: the lock went with the request. */
    expect(listed()[0]).toBe(SUGGEST_LABEL);
    press("Enter");
    await settle();
    expect(asked).toHaveLength(2);
  });

  for (const pending of [false, true]) {
    it(`forgets the previous reader's ${pending ? "outstanding request" : "kept list"} on sign-out`, async () => {
      await reading();
      await openBar();
      const old = list();
      press("Enter");
      await settle();
      if (!pending) await answer(old);
      await reading({ setting: EXPERIMENTAL_SIGNED_OUT });
      expect(suggested()).toEqual([]);
      if (pending) {
        expect(asked[0]?.signal?.aborted).toBe(true);
        await answer(old);
      }
      await reading();
      expect(suggested()).toEqual([]);
      expect(listed()[0]).toBe(SUGGEST_LABEL);
    });
  }

  it("a profile changed somewhere else is noticed at the next opening", async () => {
    await reading();
    await suggestAndLand();
    await shutBar();
    /* Another tab, another device: no save was heard here. */
    profile = { ...profile, profile: "A clinician." };
    await openBar();
    expect(suggested()).toEqual([]);
    expect(listed()[0]).toBe(SUGGEST_LABEL);
  });

  it("a list for a profile newer than the bar last read is still drawn", async () => {
    await reading();
    await openBar();
    /* Changed elsewhere after the bar's read; the server reads the new one. */
    profile = { ...profile, profile: "A clinician." };
    press("Enter");
    await settle();
    await answer(list());
    expect(suggested()).toHaveLength(4);
  });
});

describe("when there is no list", () => {
  it("says the server's sentence on a failure, keeps the row, and asks again on the next press", async () => {
    await reading();
    await openBar();
    press("Enter");
    await settle();
    await answer({ error: "The AI service is busy right now. [ai-busy]" }, 502);
    expect(status()).toBe("The AI service is busy right now. [ai-busy]");
    expect(waiting()).toBe("");
    expect(listed()[0]).toBe(SUGGEST_LABEL);
    press("Enter");
    await settle();
    expect(asked).toHaveLength(2);
    await answer(list());
    expect(suggested()).toHaveLength(4);
    expect(status()).toBe("");
  });

  it("says so when nothing came back to suggest", async () => {
    await reading();
    await suggestAndLand({ kind: "nothing", why: "no-list" });
    expect(status()).toBe(SUGGEST_NOTHING);
    expect(heading()).toBeNull();
    expect(listed()[0]).toBe(SUGGEST_LABEL);
  });

  it("says there is no reason to work from when the server found none", async () => {
    await reading();
    await suggestAndLand({ kind: "nothing", why: "no-reason" });
    expect(status()).toBe(SUGGEST_NO_REASON);
    expect(listed()).not.toContain(SUGGEST_LABEL);
  });

  it("treats a reply it cannot read as a failure, not a list", async () => {
    await reading();
    await suggestAndLand({ kind: "suggestions", searches: [{ words: "x", why: "" }] });
    expect(heading()).toBeNull();
    expect(status()).not.toBe("");
    expect(listed()[0]).toBe(SUGGEST_LABEL);
  });
});
