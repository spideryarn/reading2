// @vitest-environment jsdom
/**
 * **The command bar takes a sentence** — a query that matches no row, Enter,
 * and a model's pick among the bar's own rows. Stage 2 of
 * docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md,
 * drawn out of the real `Dock` as tests/command-bar-arguments.test.tsx draws it,
 * with `fetch` stubbed at `POST /api/command-pick` so each test decides when
 * the answer lands and what it is.
 *
 * Greg, 2026-10-03 (spya-t0dg9u): *"I want to see what's changed on this site
 * since yesterday, and it would know to pick the changelog"*.
 *
 * What a happy path would not see:
 *
 *  - **Only a sure pick of a row that just moves the reader runs at once.** A
 *    row that generates, one that writes, and every argument answer is drawn
 *    and waits for a fresh Enter — whatever the confidence.
 *  - **A held Enter cannot ask and then confirm** (GPT Sol's F4).
 *  - **An answer is for the rows that were there when it was asked** (F5):
 *    Archive turning into *Put back* while it is out leaves no suggestion.
 *  - **Two Enters post once; typing throws the answer away; signed out posts
 *    nothing.**
 *  - **A key the browser sends carries no slug**, so one list on the server
 *    serves every article.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_PICK_PATH,
  COULD_NOT_TELL,
  MAX_SENTENCE,
  type PickAnswer,
  type PickKey,
  type PickRequest,
  RUN_AT_ONCE,
} from "../src/command-pick.js";
import type { Block } from "../src/types.js";
import { setAppearance } from "../src/web/appearance.js";
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

/** The microphone, as booleans — and the box's `onChange`, which is how a dictation's words arrive. */
const mic: { supported: boolean; armed: boolean; transcribing: boolean; say: (text: string) => void } = {
  supported: true,
  armed: false,
  transcribing: false,
  say: () => {},
};
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: (options: { onChange: (text: string) => void }) => {
    mic.say = options.onChange;
    return {
      dictation: { supported: mic.supported, armed: mic.armed, transcribing: mic.transcribing, toggle: () => {} },
      readOnly: mic.transcribing,
      busy: mic.transcribing || mic.armed,
      toggle: () => {},
    };
  },
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => createElement("button", { type: "button", className: "dictation-button" }),
  DictationStrip: () => null,
}));

const { Dock } = await import("../src/web/Dock.js");
const { ASK_AGAIN_LABEL, ASK_LABEL, ASK_OR_ENTER, ASK_TOO_LONG, NO_MATCH } = await import("../src/web/CommandBar.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { jumpFirstRunner, glossaryRunners } = await import("../src/web/command-runners.js");

/** The empty line when the offer is made: the sentence, the button, and the words a desk also gets. */
const OFFER = `${NO_MATCH} ${ASK_LABEL} ${ASK_OR_ENTER}`;

const SLUG = "a-piece";

const GLOSSARY: PickKey = { id: "mode:glossary", label: "Glossary" };
const PLAIN: PickKey = { id: "mode:plain", label: "Plain" };
const CHANGELOG: PickKey = { id: "page:/changelog", label: "What’s new" };
const PROFILE: PickKey = { id: "page:/profile", label: "Profile" };
const ARCHIVE: PickKey = { id: "action:archive", label: "Archive this article" };
const AI_PROCESSING: PickKey = { id: "action:section-ai-processing", label: "AI processing" };

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});
const BLOCKS: Block[] = [block("spya-aaaaaz", "An opening."), block("spya-aaabaz", "Here the free energy principle is named.")];
const TERMS = [
  { id: "spya-adq5wr", name: "Free energy", aliases: ["fe"] },
  { id: "spya-adq6xm", name: "Surprise", aliases: ["fe"] },
];

let host: HTMLDivElement;
let root: Root;
let openedModes: string[];
let openedTerms: string[];
/** Every post to the pick route, each with the way to answer it. */
let asked: { body: PickRequest; signal: AbortSignal | null | undefined; answer: (json: unknown, status?: number) => void }[];

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
  openedModes = [];
  openedTerms = [];
  asked = [];
  jobEngine.reset();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/jobs") return Promise.resolve(new Response(JSON.stringify({ jobs: [] })));
    if (url === COMMAND_PICK_PATH) {
      return new Promise<Response>((resolve) => {
        asked.push({
          body: JSON.parse(String(init?.body)) as PickRequest,
          signal: init?.signal,
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

function executor(): CommandExecutor {
  return {
    runners: {
      "jump-first": jumpFirstRunner(BLOCKS, () => {}),
      ...glossaryRunners({
        slug: SLUG,
        terms: TERMS,
        ready: true,
        openTerm: (id) => openedTerms.push(id),
        openGlossary: () => {},
      }),
    },
    sources: { glossary: { ready: true, terms: TERMS } },
  };
}

type Archive = { at: string | null; set: ReturnType<typeof vi.fn> };
function archive(at: string | null = null, set = vi.fn(async () => ({ kind: "done" }) as const)): Archive & ArchiveControl {
  return { at, lost: false, busy: false, error: null, set } as unknown as Archive & ArchiveControl;
}
type Tags = { edit: ReturnType<typeof vi.fn> };

function reading({
  exec = executor(),
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
        onMode: (mode: string) => openedModes.push(mode),
        experimental: setting,
        shelfRow,
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
const heading = (): string | null => dialog().querySelector(".cmdbar-suggested")?.textContent ?? null;

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

const SENTENCE = "I want to see what's changed on this site since yesterday";

/** Type a sentence no row matches, press Enter, and wait for the post to go out. */
async function ask(sentence = SENTENCE): Promise<void> {
  type(sentence);
  expect(listed()).toEqual([]);
  press("Enter");
  await settle();
}

/** Answer the one outstanding post. */
async function answer(json: PickAnswer | Record<string, unknown>, statusCode = 200): Promise<void> {
  asked.at(-1)?.answer(json, statusCode);
  await settle();
}

const row = (key: PickKey, confidence: number, others: PickKey[] = []): PickAnswer => ({ kind: "row", key, confidence, others });

describe("the empty line", () => {
  it("says Enter asks, once there is something typed and a reader to ask for", () => {
    reading();
    openBar();
    type("zzzz no such thing");
    expect(empty()).toBe(OFFER);
  });

  it("is today's sentence and nothing more when nobody is signed in, and Enter posts nothing", async () => {
    reading({ setting: EXPERIMENTAL_SIGNED_OUT });
    openBar();
    type(SENTENCE);
    expect(empty()).toBe(NO_MATCH);
    press("Enter");
    await settle();
    expect(asked).toEqual([]);
    expect(status()).toBe("");
  });
});

describe("asking", () => {
  it("posts the sentence, the rows as slug-free keys, and the argument commands this page can run — once", async () => {
    reading({ shelfRow: { archive: archive(), tags: { edit: vi.fn(async () => []) } } });
    openBar();
    await ask();
    expect(asked).toHaveLength(1);
    const { body } = asked[0] as (typeof asked)[number];
    expect(Object.keys(body).sort()).toEqual(["argumentKinds", "rows", "sentence"]);
    expect(body.sentence).toBe(SENTENCE);
    expect(body.argumentKinds).toEqual(["find", "jump-first", "glossary", "tag-add", "tag-remove"]);
    expect(body.rows).toContainEqual(GLOSSARY);
    expect(body.rows).toContainEqual(CHANGELOG);
    expect(body.rows).toContainEqual(ARCHIVE);
    /* The Metadata row's address is this article's, with the place in it; its
       key is neither. */
    expect(body.rows).toContainEqual({ id: "page:/read/:slug/metadata", label: "Metadata" });
    expect(body.rows).toContainEqual({ id: "page:/help", label: "Help" });
    expect(JSON.stringify(body.rows)).not.toContain(SLUG);
    expect(JSON.stringify(body.rows)).not.toContain("spya-");
    for (const key of body.rows) expect(Object.keys(key).sort()).toEqual(["id", "label"]);
    expect(status()).toBe("Working out what you meant…");
  });

  it("offers only the argument commands the page has a runner for", async () => {
    reading({ exec: { runners: {}, sources: {} } });
    openBar();
    await ask();
    expect(asked[0]?.body.argumentKinds).toEqual(["find"]);
  });

  it("posts once for two Enters", async () => {
    reading();
    openBar();
    type(SENTENCE);
    press("Enter");
    press("Enter");
    await settle();
    press("Enter");
    await settle();
    expect(asked).toHaveLength(1);
  });

  it("does not ask when a row matches — Enter takes the row, as it always did", async () => {
    reading();
    openBar();
    type("plain");
    press("Enter");
    await settle();
    expect(asked).toEqual([]);
    expect(openedModes).toEqual(["plain"]);
  });

  it("takes a dictated sentence down the same path", async () => {
    reading();
    openBar();
    act(() => mic.say("um show me what is new on the site"));
    expect(empty()).toBe(OFFER);
    press("Enter");
    await settle();
    expect(asked.map((a) => a.body.sentence)).toEqual(["um show me what is new on the site"]);
  });

  it("asks nothing while the microphone is still on", async () => {
    mic.armed = true;
    reading();
    openBar();
    type(SENTENCE);
    press("Enter");
    await settle();
    expect(asked).toEqual([]);
  });
});

describe("a sure pick of a row that only moves the reader", () => {
  it("runs once, and closes the bar", async () => {
    reading();
    openBar();
    await ask();
    await answer(row(CHANGELOG, RUN_AT_ONCE));
    expect(location.pathname).toBe("/changelog");
    expect(dialog().open).toBe(false);
    expect(asked).toHaveLength(1);
  });

  it("runs a mode that generates nothing", async () => {
    reading();
    openBar();
    await ask("just the article please nothing else");
    await answer(row(PLAIN, 0.99));
    expect(openedModes).toEqual(["plain"]);
    expect(dialog().open).toBe(false);
  });

  it("runs an action that says it only opens something", async () => {
    reading();
    openBar();
    await ask("where do I rerun things for this piece");
    await answer(row(AI_PROCESSING, 0.97));
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(location.search).toContain("section=ai-processing");
    expect(dialog().open).toBe(false);
  });

  it("is drawn, not run, a hair under the cut", async () => {
    reading();
    openBar();
    await ask();
    await answer(row(CHANGELOG, RUN_AT_ONCE - 0.01));
    expect(location.pathname).toBe(`/read/${SLUG}`);
    expect(dialog().open).toBe(true);
    expect(listed()).toEqual(["What’s new"]);
  });
});

describe("an unsure pick", () => {
  it("draws the model's top three as the bar's own rows, first selected, and Enter runs the one picked", async () => {
    reading();
    openBar();
    await ask();
    await answer(row(PROFILE, 0.5, [CHANGELOG, PLAIN]));
    expect(heading()).toBe("Did you mean");
    expect(listed()).toEqual(["Profile", "What’s new", "Plain"]);
    expect(rows()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(status()).toBe("");
    expect(location.pathname).toBe(`/read/${SLUG}`);
    press("ArrowDown");
    press("Enter");
    await settle();
    expect(location.pathname).toBe("/changelog");
    expect(dialog().open).toBe(false);
  });

  it("draws no heading over rows the reader's own typing found", () => {
    reading();
    openBar();
    type("plain");
    expect(listed()).toContain("Plain");
    expect(heading()).toBeNull();
    /* And nothing but elements in the panel: the list sits in a fragment
       beside the heading, where a source comment without braces is drawn as
       words — which it was, for an hour, with every other test green. */
    const loose = [...(dialog().querySelector(".cmdbar-panel")?.childNodes ?? [])].filter(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
    );
    expect(loose.map((node) => node.textContent)).toEqual([]);
  });
});

describe("a pick that generates, writes or takes words never runs without a second, fresh Enter", () => {
  it("draws a mode that generates, however sure the model was", async () => {
    reading();
    openBar();
    await ask("what do these terms mean");
    await answer(row(GLOSSARY, 1));
    expect(openedModes).toEqual([]);
    expect(dialog().open).toBe(true);
    expect(listed()).toEqual(["Glossary"]);
    expect(rows()[0]?.querySelector(".cmdbar-generates")).not.toBeNull();
    press("Enter");
    await settle();
    expect(openedModes).toEqual(["glossary"]);
  });

  it("draws Archive, however sure the model was", async () => {
    const shelf = archive();
    reading({ shelfRow: { archive: shelf, tags: { edit: vi.fn(async () => []) } } });
    openBar();
    await ask("archive everything on my shelf");
    await answer(row(ARCHIVE, 0.99));
    expect(shelf.set).not.toHaveBeenCalled();
    expect(listed()).toEqual(["Archive this article"]);
    press("Enter");
    await settle();
    expect(shelf.set.mock.calls).toEqual([[true]]);
  });

  it("draws an appearance row, however sure the model was (plan 261005d, F3)", async () => {
    reading();
    openBar();
    await ask("I would rather the page were white");
    const before = document.documentElement.dataset.theme;
    await answer(row({ id: "action:appearance-light", label: "Appearance: Light" }, 1));
    expect(document.documentElement.dataset.theme).toBe(before);
    expect(listed()).toEqual(["Appearance: Light"]);
    press("Enter");
    await settle();
    expect(document.documentElement.dataset.theme).toBe("light");
    setAppearance("dark");
    delete document.documentElement.dataset.theme;
  });

  it("draws an argument answer as the row its verb would have made", async () => {
    const edit = vi.fn(async () => ["neuroscience"]);
    reading({ shelfRow: { archive: archive(), tags: { edit } } });
    openBar();
    await ask("could you file this one under neuroscience for me");
    await answer({ kind: "argument", argument: "tag-add", words: "neuroscience" });
    expect(edit).not.toHaveBeenCalled();
    expect(heading()).toBe("Did you mean");
    expect(listed()).toEqual(["Add the tag “neuroscience”"]);
    press("Enter");
    await settle();
    expect(edit.mock.calls).toEqual([[{ add: ["neuroscience"] }]]);
  });

  it("draws a find answer, which is only an address, and still waits", async () => {
    reading();
    openBar();
    await ask("is consciousness mentioned anywhere");
    await answer({ kind: "argument", argument: "find", words: "consciousness" });
    expect(listed()).toEqual(["Find “consciousness” in this article"]);
    expect(location.search).not.toContain("find=");
    press("Enter");
    await settle();
    expect(location.search).toContain("find=consciousness");
  });

  /* Plan 261005i: a model's `find` is the same two rows a typed verb draws,
     and neither runs from the answer — a quick search spends, so it is
     proposed and pressed. */
  it("draws a find answer as a quick search and the exact words, and runs neither until Enter", async () => {
    const searched: string[] = [];
    const quickSearch = (words: string) => {
      searched.push(words);
      return { kind: "close" } as const;
    };
    reading({ exec: { ...executor(), quickSearch } });
    openBar();
    await ask("is consciousness mentioned anywhere");
    await answer({ kind: "argument", argument: "find", words: "consciousness" });
    expect(listed()).toEqual(["Quick search “consciousness”", "Find “consciousness” in this article"]);
    expect(searched).toEqual([]);
    expect(location.search).not.toContain("find=");
    press("Enter");
    await settle();
    expect(searched).toEqual(["consciousness"]);
    expect(location.search).not.toContain("find=");
  });

  it("keeps an alias two glossary entries share as two rows, and opens neither (F3)", async () => {
    reading();
    openBar();
    await ask("remind me what fe stands for here");
    await answer({ kind: "argument", argument: "glossary", words: "fe" });
    expect(listed()).toEqual(["Glossary: “Free energy”", "Glossary: “Surprise”"]);
    expect(openedTerms).toEqual([]);
  });

  it("runs nothing for an Enter held across the answer, or one still composing (F4)", async () => {
    reading();
    openBar();
    type("what do these terms mean");
    press("Enter");
    press("Enter", { repeat: true });
    await settle();
    await answer(row(GLOSSARY, 1));
    expect(listed()).toEqual(["Glossary"]);
    for (let i = 0; i < 5; i++) press("Enter", { repeat: true });
    press("Enter", { isComposing: true });
    await settle();
    expect(openedModes).toEqual([]);
    expect(dialog().open).toBe(true);
    /* And the key let go and pressed again is a press. */
    press("Enter");
    await settle();
    expect(openedModes).toEqual(["glossary"]);
  });

  /* Plan 261007a-ui-sweep-k2: the older spelling of "composing" (`keyCode`
     229, no flag) is refused too, and a composing key is left wholly to the
     input method: not cancelled, and the arrows that walk its candidate list
     do not also walk ours. */
  it("leaves a composing Enter and the arrows to the input method", async () => {
    reading();
    openBar();
    type("o");
    await settle();
    const before = input().getAttribute("aria-activedescendant");
    const sent: KeyboardEvent[] = [];
    for (const init of [{ isComposing: true }, { keyCode: 229 } as KeyboardEventInit]) {
      for (const key of ["ArrowDown", "Enter"]) {
        const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
        act(() => {
          input().dispatchEvent(e);
        });
        sent.push(e);
      }
    }
    await settle();
    expect(sent.map((e) => e.defaultPrevented)).toEqual([false, false, false, false]);
    expect(input().getAttribute("aria-activedescendant")).toBe(before);
    expect(openedModes).toEqual([]);
    expect(dialog().open).toBe(true);
  });

  it("does not ask for a held Enter either", async () => {
    reading();
    openBar();
    type(SENTENCE);
    press("Enter", { repeat: true });
    await settle();
    expect(asked).toEqual([]);
  });
});

describe("an answer is for the bar that asked", () => {
  it("cannot navigate after its bar unmounted, and aborts the abandoned request", async () => {
    reading();
    openBar();
    await ask();
    const pending = asked[0];
    await act(async () => root.unmount());
    root = createRoot(host);
    await answer(row(CHANGELOG, 1));
    expect(location.pathname).toBe(`/read/${SLUG}`);
    expect(pending?.signal?.aborted).toBe(true);
  });

  it("drops the drawn choices when a disappearing row would shift Enter to a different command", async () => {
    const tags = { edit: vi.fn(async () => []) };
    reading({ shelfRow: { archive: archive(), tags } });
    openBar();
    await ask("show me something useful here");
    await answer(row(PROFILE, 0.5, [ARCHIVE, GLOSSARY]));
    press("ArrowDown");
    expect(rows()[1]?.getAttribute("aria-selected")).toBe("true");
    reading({ shelfRow: { archive: { ...archive(), at: undefined }, tags } });
    press("Enter");
    await settle();
    expect(openedModes).toEqual([]);
    expect(listed()).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  it("leaves no suggestion when Archive became Put back while it was out (F5)", async () => {
    const tags = { edit: vi.fn(async () => []) };
    reading({ shelfRow: { archive: archive(), tags } });
    openBar();
    await ask("put this one away");
    const later = archive("2026-10-03T10:00:00.000Z");
    reading({ shelfRow: { archive: later, tags } });
    await answer(row(ARCHIVE, 0.99));
    expect(listed()).toEqual([]);
    expect(heading()).toBeNull();
    expect(later.set).not.toHaveBeenCalled();
    expect(status()).not.toBe("Working out what you meant…");
  });

  it("throws away an answer chosen among rows the bar no longer has, even if its row is still there", async () => {
    const tags = { edit: vi.fn(async () => []) };
    reading();
    openBar();
    await ask();
    /* A shelf row arrives: Archive and Export join the list. The model chose
       without them. */
    reading({ shelfRow: { archive: archive(), tags } });
    await answer(row(CHANGELOG, 1));
    expect(location.pathname).toBe(`/read/${SLUG}`);
    expect(listed()).toEqual([]);
    expect(status()).toBe("");
    /* Not a failure, and the reader can ask again over today's rows. */
    press("Enter");
    await settle();
    expect(asked).toHaveLength(2);
    expect(asked[1]?.body.rows).toContainEqual(ARCHIVE);
  });

  it("drops a suggestion already drawn when the row it names changes face", async () => {
    const tags = { edit: vi.fn(async () => []) };
    reading({ shelfRow: { archive: archive(), tags } });
    openBar();
    await ask("put this one away");
    await answer(row(ARCHIVE, 0.99));
    expect(listed()).toEqual(["Archive this article"]);
    const later = archive("2026-10-03T10:00:00.000Z");
    reading({ shelfRow: { archive: later, tags } });
    expect(listed()).toEqual([]);
    press("Enter");
    await settle();
    expect(later.set).not.toHaveBeenCalled();
  });

  it("drops argument choices when a refreshed glossary would move the selection to a different term", async () => {
    reading();
    openBar();
    await ask("remind me what fe stands for here");
    await answer({ kind: "argument", argument: "glossary", words: "fe" });
    press("ArrowDown");
    reading({ exec: { ...executor(), sources: { glossary: { ready: true, terms: TERMS.slice(0, 1) } } } });
    press("Enter");
    await settle();
    expect(openedTerms).toEqual([]);
    expect(listed()).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  it("throws the answer away when the reader typed during the call", async () => {
    reading();
    openBar();
    await ask();
    const first = asked[0];
    type(`${SENTENCE} please`);
    expect(status()).toBe("");
    first?.answer(row(CHANGELOG, 1));
    await settle();
    expect(location.pathname).toBe(`/read/${SLUG}`);
    expect(dialog().open).toBe(true);
    expect(listed()).toEqual([]);
    /* And the new sentence can be asked at once: the old call holds nothing. */
    press("Enter");
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("throws the answer away when the bar was shut and opened again", async () => {
    reading();
    openBar();
    await ask();
    act(() => dialog().close());
    openBar();
    await answer(row(CHANGELOG, 1));
    expect(location.pathname).toBe(`/read/${SLUG}`);
    expect(listed().length).toBeGreaterThan(5);
    expect(status()).toBe("");
  });

  it("clears a drawn suggestion on the next keystroke", async () => {
    reading();
    openBar();
    await ask();
    await answer(row(PROFILE, 0.5));
    expect(listed()).toEqual(["Profile"]);
    type("zzzz");
    expect(listed()).toEqual([]);
    expect(heading()).toBeNull();
  });
});

describe("no answer", () => {
  it("says it could not tell, and stays open, for none", async () => {
    reading();
    openBar();
    await ask("what's the weather tomorrow");
    await answer({ kind: "none" });
    expect(status()).toBe(COULD_NOT_TELL);
    expect(COULD_NOT_TELL).toBe("Couldn't tell what you meant.");
    expect(dialog().open).toBe(true);
    expect(listed()).toEqual([]);
  });

  it("does not offer to ask again about the sentence it just could not read", async () => {
    reading();
    openBar();
    await ask("what's the weather tomorrow");
    await answer({ kind: "none" });
    /* Found in the browser check: the hint sat straight under the refusal.
       Since 2026-10-05 the same button is there as *Try again*. */
    expect(empty()).toBe(`No command matches. ${ASK_AGAIN_LABEL}`);
    /* A changed sentence is a new question. */
    type("what's the weather tomorrow in London");
    expect(empty()).toBe(OFFER);
  });

  it("says the same for a failure, and never the server's sentence", async () => {
    reading();
    openBar();
    await ask();
    await answer({ error: "The AI service did not finish within 5 seconds [ai-slow]" }, 504);
    expect(status()).toBe(COULD_NOT_TELL);
    expect(dialog().open).toBe(true);
  });

  it("says the same for a row the bar never sent, and runs nothing", async () => {
    reading();
    openBar();
    await ask();
    await answer(row({ id: "action:archive", label: "Archive this article" }, 1));
    expect(status()).toBe(COULD_NOT_TELL);
    await ask(`${SENTENCE} again`);
    await answer(row({ id: "page:/admin", label: "Admin" }, 1));
    expect(status()).toBe(COULD_NOT_TELL);
    expect(location.pathname).toBe(`/read/${SLUG}`);
  });

  it("can be asked again", async () => {
    reading();
    openBar();
    await ask();
    await answer({ kind: "none" });
    press("Enter");
    await settle();
    expect(asked).toHaveLength(2);
  });
});

/**
 * **The same ask, for a finger** (spya-qem46c, plan 261005f). Greg, on an
 * iPhone, 2026-10-05: *"there was no way to kick off that action on an iPhone
 * because I don't have an enter key."* A dictated sentence never raises the
 * keyboard, so the offer has to be something that can be pressed.
 */
describe("the button that asks", () => {
  const button = (): HTMLButtonElement | null => dialog().querySelector<HTMLButtonElement>("button.cmdbar-ask");
  const tap = (): void => act(() => button()?.click());
  /** `aria-disabled`, not `disabled`: CommandBar.tsx says why the button still takes the press. */
  const refused = (): boolean => button()?.getAttribute("aria-disabled") === "true";

  it("posts a dictated sentence once, with no key pressed, and the answer is handled as Enter's is", async () => {
    reading();
    openBar();
    act(() => mic.say("um show me what is new on the site"));
    expect(button()?.textContent).toBe(ASK_LABEL);
    expect(ASK_LABEL).toBe("Ask what you meant");
    tap();
    await settle();
    expect(asked.map((a) => a.body.sentence)).toEqual(["um show me what is new on the site"]);
    expect(status()).toBe("Working out what you meant…");
    await answer(row(GLOSSARY, 0.5));
    expect(heading()).toBe("Did you mean");
    expect(listed()).toEqual(["Glossary"]);
  });

  it("is disabled while the sentence is out, and a second press posts nothing more", async () => {
    reading();
    openBar();
    type(SENTENCE);
    act(() => {
      /* The ref, not the next render's aria-disabled, has to lock this pair. */
      button()?.click();
      button()?.click();
    });
    await settle();
    expect(refused()).toBe(true);
    tap();
    await settle();
    expect(asked).toHaveLength(1);
  });

  it("is ready to press before anything is out", () => {
    reading();
    openBar();
    type(SENTENCE);
    expect(refused()).toBe(false);
    expect(button()?.disabled).toBe(false);
    expect(button()?.tabIndex).toBe(0);
  });

  it.each(["armed", "transcribing"] as const)("says it is refused while the microphone is %s, and posts nothing", async (state) => {
    mic[state] = true;
    reading();
    openBar();
    type(SENTENCE);
    expect(refused()).toBe(true);
    /* `aria-disabled`, deliberately: it stays in the Tab order and its
       mousedown can still preserve the box's focus. */
    expect(button()?.disabled).toBe(false);
    expect(button()?.tabIndex).toBe(0);
    tap();
    await settle();
    expect(asked).toEqual([]);
  });

  it("says it is refused while another row's run is starting, and posts nothing", async () => {
    const never = vi.fn(() => new Promise<never>(() => {}));
    reading({ shelfRow: { archive: archive(null, never as never), tags: { edit: vi.fn(async () => []) } } });
    openBar();
    type("archive this article");
    press("Enter");
    await settle();
    expect(never).toHaveBeenCalledTimes(1);
    expect(status()).toBe("Starting…");
    type(SENTENCE);
    expect(refused()).toBe(true);
    tap();
    await settle();
    expect(asked).toEqual([]);
  });

  it("says so, rather than nothing, for a sentence too long to send", async () => {
    reading();
    openBar();
    type("z".repeat(MAX_SENTENCE + 1));
    tap();
    await settle();
    expect(asked).toEqual([]);
    expect(status()).toBe(ASK_TOO_LONG);
    expect(ASK_TOO_LONG).toBe("That sentence is too long. Shorten it and try again.");
    expect(button(), "trying the unchanged sentence again cannot help").toBeNull();
  });

  it("carries the finger's size and hides the desk's words from a finger", () => {
    reading();
    openBar();
    type(SENTENCE);
    expect(button()?.className).toContain("tw:pointer-coarse:min-h-11");
    const words = dialog().querySelector(".cmdbar-or-enter");
    expect(words?.textContent?.trim()).toBe(ASK_OR_ENTER);
    expect(words?.className).toContain("tw:pointer-coarse:hidden");
  });

  it("does not take the focus out of the box", () => {
    reading();
    openBar();
    type(SENTENCE);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      button()?.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
  });

  it("returns keyboard activation to the box, ready for the rows that may replace the button", async () => {
    reading();
    openBar();
    type(SENTENCE);
    button()?.focus();
    expect(document.activeElement).toBe(button());
    act(() => {
      /* Enter and Space activate a focused button with a click whose detail is
         zero. A pointer's click has a non-zero detail. */
      button()?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    await settle();
    expect(asked).toHaveLength(1);
    expect(document.activeElement).toBe(input());
  });

  it("is not drawn when nobody is signed in", () => {
    reading({ setting: EXPERIMENTAL_SIGNED_OUT });
    openBar();
    type(SENTENCE);
    expect(button()).toBeNull();
  });

  it("says Try again under the sentence it could not read, and a press asks again", async () => {
    reading();
    openBar();
    await ask();
    await answer({ error: "The AI service did not finish within 5 seconds [ai-slow]" }, 504);
    expect(button()?.textContent).toBe(ASK_AGAIN_LABEL);
    expect(ASK_AGAIN_LABEL).toBe("Try again");
    expect(dialog().querySelector(".cmdbar-or-enter")).toBeNull();
    tap();
    await settle();
    expect(asked).toHaveLength(2);
    expect(status()).toBe("Working out what you meant…");
  });
});
