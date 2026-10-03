// @vitest-environment jsdom
/**
 * **The command bar's argument rows, pressed** — jump, glossary, tags, the
 * experimental switch, and dictation in the box. Stage 1 of
 * docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md,
 * drawn out of the real `Dock` as tests/command-bar-metadata-rows.test.tsx draws
 * it.
 *
 * Greg, 2026-09-29 (spya-wh2xys): *"the command panel can take a sort of an
 * argument like a search term"*, *"a command to turn on the experimental
 * features or off"*; qi-qkjnkwce, *"add a tag of X to this paper"*.
 *
 * What a happy path would not see:
 *
 *  - **A jump with no match keeps the bar open and says so.**
 *  - **The glossary's rows exist only where there is a glossary read**, and the
 *    paid ask only once it is ready (F1). On the Metadata page, neither.
 *  - **An invalid tag is a row that refuses with the reason**, sending nothing.
 *  - **The experimental row follows the state, and is absent while a save is
 *    out** (F5) — the store drops a second press then, so a row would do
 *    nothing.
 *  - **Nothing is pressed while the microphone is on or its words are on the
 *    way**, and closing the bar stops the microphone.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../src/types.js";
import type { CommandExecutor } from "../src/web/command-proposal.js";
import type { DockExperimental } from "../src/web/Dock.js";
import type { ArchiveControl } from "../src/web/useArchive.js";
import { EXPERIMENTAL_OFF, experimental } from "./helpers/experimental-fixtures.js";

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

/** The microphone, as booleans — the real hook opens a device. */
const mic = { supported: true, armed: false, transcribing: false, toggles: 0 };
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: {
      ...mic,
      toggle: () => {
        mic.toggles += 1;
        mic.armed = false;
      },
    },
    readOnly: mic.transcribing,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => createElement("button", { type: "button", className: "dictation-button" }),
  DictationStrip: () => null,
}));

const { Dock } = await import("../src/web/Dock.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { jumpFirstRunner, glossaryRunners } = await import("../src/web/command-runners.js");

const SLUG = "a-piece";

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});
const BLOCKS: Block[] = [
  block("spya-aaaaaz", "An opening that says nothing much."),
  block("spya-aaabaz", "Here the free energy principle is named."),
];
const TERMS = [
  { id: "spya-adq5wr", name: "Free energy", aliases: ["fe"] },
  { id: "spya-adq6xm", name: "Surprise", aliases: ["fe"] },
];

let host: HTMLDivElement;
let root: Root;
let jumped: string[];
let openedTerms: string[];
let movedToGlossary: number;

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
  jumped = [];
  openedTerms = [];
  movedToGlossary = 0;
  jobEngine.reset();
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/jobs") return Promise.resolve(new Response(JSON.stringify({ jobs: [] })));
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

/** The reading view's executor, built from the same runners Reader builds. */
function executor({ ready = true }: { ready?: boolean } = {}): CommandExecutor {
  return {
    runners: {
      "jump-first": jumpFirstRunner(BLOCKS, (id) => jumped.push(id)),
      ...glossaryRunners({
        slug: SLUG,
        terms: TERMS,
        ready,
        openTerm: (id) => openedTerms.push(id),
        openGlossary: () => {
          movedToGlossary += 1;
        },
      }),
    },
    sources: { glossary: { ready, terms: TERMS } },
  };
}

function archive(): ArchiveControl {
  return { at: null, lost: false, busy: false, error: null, set: async () => ({ kind: "done" }) as const } as ArchiveControl;
}

type Tags = { edit: ReturnType<typeof vi.fn> };
function tags(edit = vi.fn(async () => ["x"])): Tags {
  return { edit };
}

function reading({
  exec,
  shelfRow,
  setting = EXPERIMENTAL_OFF,
}: {
  exec?: CommandExecutor;
  shelfRow?: { archive: ArchiveControl; tags: Tags };
  setting?: DockExperimental;
} = {}): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as tests/command-bar.test.tsx § reading
      createElement(Dock as any, {
        slug: SLUG,
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: setting,
        shelfRow,
        executor: exec,
      }),
    );
  });
}

function metadataPage(shelfRow?: { archive: ArchiveControl; tags: Tags }): void {
  history.replaceState(null, "", `/read/${SLUG}/metadata?at=spya-k3m9qt`);
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the metadata page's Dock has no onMode, on purpose
      createElement(Dock as any, { slug: SLUG, view: "metadata", experimental: EXPERIMENTAL_OFF, shelfRow }),
    );
  });
}

const dialog = (): HTMLDialogElement => host.querySelector("dialog.cmdbar") as HTMLDialogElement;
const input = (): HTMLInputElement => dialog().querySelector("input.cmdbar-input") as HTMLInputElement;
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];
const listed = (): string[] => rows().map((r) => r.querySelector(".cmdbar-name")?.textContent ?? "");
const rowNamed = (name: string) => rows().find((r) => r.querySelector(".cmdbar-name")?.textContent === name);
const status = (): string => dialog().querySelector('[role="status"]')?.textContent ?? "";

function openBar(): void {
  act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
}

function type(text: string): void {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

describe("jump to the first place it says X", () => {
  it("jumps through the reading view's jump, and closes", async () => {
    reading({ exec: executor() });
    openBar();
    type("jump to first free energy");
    expect(listed()).toEqual(["Jump to the first “free energy”"]);
    press("Enter");
    await settle();
    expect(jumped).toEqual(["spya-aaabaz"]);
    expect(dialog().open).toBe(false);
  });

  it("keeps the bar open, and says so, when the article does not say it", async () => {
    reading({ exec: executor() });
    openBar();
    type("first mention of dopamine");
    press("Enter");
    await settle();
    expect(jumped).toEqual([]);
    expect(dialog().open).toBe(true);
    expect(status()).toBe("“dopamine” isn't in this article.");
  });

  it("is not offered where there is no prose to jump in", () => {
    metadataPage({ archive: archive(), tags: tags() });
    openBar();
    type("jump to first free energy");
    expect(listed()).toEqual([]);
  });
});

describe("the glossary", () => {
  it("offers each entry the words name, name first, and opens the one pressed", async () => {
    reading({ exec: executor() });
    openBar();
    type("define fe");
    expect(listed()).toEqual(["Glossary: “Free energy”", "Glossary: “Surprise”"]);
    press("ArrowDown");
    press("Enter");
    await settle();
    expect(openedTerms).toEqual(["spya-adq6xm"]);
    expect(dialog().open).toBe(false);
  });

  it("offers the ask, marked as generating, when nothing matches and the glossary is ready", async () => {
    reading({ exec: executor() });
    openBar();
    type("what does attention head mean?");
    expect(listed()).toEqual(["Look up “attention head” in this article"]);
    expect(rows()[0]?.querySelector(".cmdbar-generates")).not.toBeNull();
    press("Enter");
    await settle();
    expect(movedToGlossary).toBe(1);
    expect(dialog().open).toBe(false);
  });

  it("offers no ask until the glossary read is ready", () => {
    reading({ exec: executor({ ready: false }) });
    openBar();
    type("look up attention head");
    expect(listed()).toEqual([]);
  });

  it("offers neither on the Metadata page, which has no glossary read", () => {
    metadataPage({ archive: archive(), tags: tags() });
    openBar();
    type("look up free energy");
    expect(listed()).toEqual([]);
    type("look up attention head");
    expect(listed()).toEqual([]);
  });
});

describe("tags", () => {
  it("adds the tag, as it will be stored, through the shelf row's controller", async () => {
    const edit = vi.fn(async () => ["reading group"]);
    reading({ exec: executor(), shelfRow: { archive: archive(), tags: tags(edit) } });
    openBar();
    type("add a tag of Reading  Group to this paper");
    expect(listed()).toEqual(["Add the tag “reading group”"]);
    expect(rows()[0]?.querySelector(".cmdbar-generates")).toBeNull();
    press("Enter");
    press("Enter");
    await settle();
    expect(edit.mock.calls).toEqual([[{ add: ["reading group"] }]]);
    expect(dialog().open).toBe(false);
  });

  it("removes one", async () => {
    const edit = vi.fn(async () => []);
    reading({ shelfRow: { archive: archive(), tags: tags(edit) } });
    openBar();
    type("untag to read");
    expect(listed()).toEqual(["Remove the tag “to read”"]);
    press("Enter");
    await settle();
    expect(edit.mock.calls).toEqual([[{ remove: ["to read"] }]]);
  });

  it("keeps an invalid tag as a row that says why, and sends nothing", async () => {
    const edit = vi.fn(async () => []);
    reading({ shelfRow: { archive: archive(), tags: tags(edit) } });
    openBar();
    type("tag a, b");
    expect(listed()).toEqual(["Add the tag “a, b”"]);
    press("Enter");
    await settle();
    expect(edit).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
    expect(status()).toBe("A tag cannot contain a comma.");
  });

  it("keeps a refused save in the bar with the server's sentence", async () => {
    const edit = vi.fn(async () => {
      throw new Error("An article can carry at most 30 tags.");
    });
    reading({ shelfRow: { archive: archive(), tags: tags(edit) } });
    openBar();
    type("tag one more");
    press("Enter");
    await settle();
    expect(dialog().open).toBe(true);
    expect(status()).toContain("An article can carry at most 30 tags.");
  });

  it("is offered on the Metadata page through the page's own controller", async () => {
    const edit = vi.fn(async () => ["x"]);
    metadataPage({ archive: archive(), tags: tags(edit) });
    openBar();
    type("tag x");
    press("Enter");
    await settle();
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("is absent without a shelf row to act on", () => {
    reading({ exec: executor() });
    openBar();
    type("tag x");
    expect(listed()).toEqual([]);
  });
});

describe("the experimental switch", () => {
  it("offers to turn it on while it is off, and closes once it is saved", async () => {
    const set = vi.fn(async () => ({ kind: "saved" }) as const);
    reading({ setting: experimental({ on: false, set }) });
    openBar();
    expect(listed(), "typed-only: not in the list the bar opens on").not.toContain("Turn experimental features on");
    type("experimental");
    expect(listed()).toContain("Turn experimental features on");
    expect(listed()).not.toContain("Turn experimental features off");
    rowNamed("Turn experimental features on")?.click();
    await settle();
    expect(set).toHaveBeenCalledWith(true);
    expect(dialog().open).toBe(false);
  });

  it("follows the state: off while it is on, found by `labs`", async () => {
    const set = vi.fn(async () => ({ kind: "saved" }) as const);
    reading({ setting: experimental({ on: true, set }) });
    openBar();
    type("labs");
    expect(listed()[0]).toBe("Turn experimental features off");
    press("Enter");
    await settle();
    expect(set).toHaveBeenCalledWith(false);
  });

  it("is absent while a save is out, before the answer is in, and for nobody signed in", () => {
    for (const setting of [
      experimental({ saving: true }),
      experimental({ loaded: false }),
      experimental({ signedIn: false }),
    ]) {
      reading({ setting });
      openBar();
      type("experimental");
      expect(listed()).not.toContain("Turn experimental features on");
      act(() => dialog().close());
    }
  });

  it("stays open with the reason when the save is refused", async () => {
    const set = vi.fn(async () => ({ kind: "failed", message: "Network down." }) as const);
    reading({ setting: experimental({ set }) });
    openBar();
    type("experimental");
    press("Enter");
    await settle();
    expect(dialog().open).toBe(true);
    expect(status()).toContain("Network down.");
  });
});

describe("dictation in the box", () => {
  it("draws the microphone beside the box", () => {
    reading();
    openBar();
    expect(dialog().querySelector(".dictation-button")).not.toBeNull();
  });

  it("presses nothing while the microphone is on", async () => {
    const set = vi.fn(async () => ({ kind: "saved" }) as const);
    reading({ setting: experimental({ set }) });
    openBar();
    type("experimental");
    mic.armed = true;
    type("experimental ");
    expect(rows().every((row) => row.getAttribute("aria-disabled") === "true")).toBe(true);
    press("Enter");
    rowNamed("Turn experimental features on")?.click();
    await settle();
    expect(set).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
  });

  it("presses nothing while the words are on their way", async () => {
    const set = vi.fn(async () => ({ kind: "saved" }) as const);
    reading({ setting: experimental({ set }) });
    openBar();
    type("experimental");
    mic.transcribing = true;
    type("experimental ");
    expect(input().readOnly).toBe(true);
    press("Enter");
    rowNamed("Turn experimental features on")?.click();
    await settle();
    expect(set).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
  });

  it("stops the microphone when the bar closes", async () => {
    reading();
    openBar();
    mic.armed = true;
    type("x");
    act(() => dialog().close());
    await settle();
    expect(mic.toggles).toBe(1);
  });
});
