// @vitest-environment jsdom
/**
 * **The Feedback dialog, and the four claims it makes that are not visual.**
 *
 * The dialog's looks are a browser pass's job. What is pinned here is the part
 * that would fail silently: the shape of the body it posts, that an unticked box
 * collects nothing at all, that two clicks in one frame file one report, and —
 * the one that took a real bug to learn — that a retry after a failed send
 * carries **the same report id**, which is the only thing that makes the
 * server's idempotency worth having.
 *
 * `jsdom` has no `showModal`, so it is stubbed below. That is honest rather than
 * convenient: what `<dialog>` gives us — inert background, focus trapping,
 * Escape, top-layer painting — is the platform's, and a test asserting the
 * platform works would be testing the wrong thing.
 */
import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_EMAIL, ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { isSpideryarnId } from "../src/ids.js";
import { CONTACT_EMAIL } from "../src/site-text.js";
import { EARLIER_FEEDBACK_LIMIT, MAX_FEEDBACK_ANSWER_CHARS } from "../src/types.js";
import { exactly } from "../src/web/relative-time.js";

const posts: { input: string; init: RequestInit }[] = [];
let answer: () => Promise<Response>;
/** Every `GET /api/feedback` — the Earlier tab's reads, kept apart from `posts`. */
const lists: string[] = [];
let listAnswer: (input: string) => Promise<Response>;
/** Whether the dialog is mounted for an admin: the cosmetic flag FeedbackHost passes (261007d). */
let asAdmin = false;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string, init?: RequestInit) => {
    /* The Earlier tab's read has no method, and it is not a report: it goes in
       its own list so that `posts` still means "what was filed". */
    if ((init?.method ?? "GET") === "GET") {
      lists.push(input);
      return listAnswer(input);
    }
    posts.push({ input, init: init ?? {} });
    return answer();
  },
  failure: async (res: Response) => new Error(await res.text()),
}));

vi.mock("../src/web/router.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/web/router.js")>(),
  useRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
  navigate: vi.fn(),
}));

/**
 * **The microphone, as two booleans and a spy.**
 *
 * The real hook opens a device and reads a Floating UI tooltip; neither is what
 * this file is about. What is: that Send refuses while either boolean is true,
 * and that closing the dialog calls `toggle` — the guards GPT Sol's review of
 * the plan asked for, both of which pass by accident if the mock is a constant.
 */
const mic = { supported: true, armed: false, transcribing: false, artifact: 7, recording: null as object | null };
const micToggles: string[] = [];
/** What `dismiss` was handed, in order. Plan 261001k. */
const micDismissals: number[] = [];
/**
 * **The reply box's microphone, a second one** (261007d stage 2). The dialog
 * has two `useDictationField`s once a reply box is open; the mock tells them
 * apart by `doneKey`, which the reply box starts with `reply:`. `replyMicUses`
 * is what each render of that hook was given, so the wiring is a fact.
 */
const replyMic = { supported: true, armed: false, transcribing: false };
const replyMicToggles: string[] = [];
const replyMicUses: { keep: string | null; doneKey: string; context: unknown }[] = [];
let replyMicDone: (() => void) | undefined;
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: (options: { doneKey?: string; keep?: { box: string }; context?: unknown; onDone?: () => void }) => {
    if (String(options.doneKey).startsWith("reply:")) {
      replyMicUses.push({ keep: options.keep?.box ?? null, doneKey: String(options.doneKey), context: options.context });
      replyMicDone = options.onDone;
      return {
        dictation: {
          ...replyMic,
          recording: null,
          toggle: () => {
            replyMicToggles.push("hook");
          },
          artifact: () => 0,
          dismiss: () => {},
        },
        readOnly: replyMic.transcribing,
        busy: replyMic.transcribing || replyMic.armed,
        toggle: () => {
          replyMicToggles.push("field");
        },
        sendingAfter: false,
      };
    }
    return {
      dictation: {
        ...mic,
        toggle: () => {
          micToggles.push("hook");
        },
        artifact: () => mic.artifact,
        dismiss: (n: number) => {
          micDismissals.push(n);
        },
      },
      readOnly: mic.transcribing,
      busy: mic.transcribing || mic.armed,
      toggle: () => {
        micToggles.push("field");
      },
    };
  },
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => createElement("button", { type: "button", className: "mock-mic" }, "mic"),
  DictationStrip: () => null,
}));

/* Re-encoding an image needs a canvas, which jsdom does not have. What matters
   here is only *when* it finishes, so the stub is a promise this file resolves. */
let finishShot: ((base64: string) => void) | null = null;
/** What a paste or a drop carries. `null` everywhere but the tests about the Earlier tab. */
let carried: File | null = null;
vi.mock("../src/web/feedback-screenshot.js", () => ({
  screenshotFromFile: () =>
    new Promise((resolve) => {
      finishShot = (base64: string) =>
        resolve({ ok: true, base64, width: 800, height: 600, bytes: 1000 });
    }),
  imageFileFromPaste: () => carried,
  imageFileFromDrop: () => carried,
}));

/* `showModal`/`close` are not implemented in jsdom, and `open` is a real
   attribute, so the smallest honest stand-in is the pair of methods setting it. */
beforeEach(() => {
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
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { FeedbackDialog } = await import("../src/web/FeedbackDialog.js");
const { FeedbackHost, useFeedbackOpen } = await import("../src/web/FeedbackButton.js");
const { reloadVeto } = await import("../src/web/safe-to-reload.js");
const { navigate } = await import("../src/web/router.js");

let host: HTMLDivElement;
let root: Root;

/** The per-filter counts every Earlier answer carries (261003b). */
const COUNTS = { all: 2, shipped: 1, unshipped: 1 };
/** Counts for an empty answer. */
const NONE = { all: 0, shipped: 0, unshipped: 0 };
/** Counts past the cap, for an answer with `more`. */
const MANY = { all: 345, shipped: 230, unshipped: 115 };

/** An answer to `GET /api/feedback`. */
function page(body: unknown, status = 200): () => Promise<Response> {
  return async () => new Response(JSON.stringify(body), { status });
}

function ok(status: number): () => Promise<Response> {
  return async () => new Response(JSON.stringify({ id: "x" }), { status });
}

function show(open: boolean) {
  act(() => {
    root.render(
      createElement(FeedbackDialog, {
        open,
        onClose: () => {},
        where: { url: "https://www.spideryarn.com/read/a-piece?q=footnotes", slug: "a-piece" },
        admin: asAdmin,
      }),
    );
  });
}

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  show(true);
}

function mountStrict() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(FeedbackDialog, {
          open: true,
          onClose: () => {},
          where: { url: "https://www.spideryarn.com/read/a-piece", slug: "a-piece" },
        }),
      ),
    );
  });
}

/**
 * **Mount it the way `FeedbackButton` does — with `open` in a parent's state.**
 *
 * `mount()` above pins `open` at `true` and hands the dialog an `onClose` that
 * does nothing, which is right for every test about what gets posted and wrong
 * for the one test about *closing*: with the prop nailed open, nothing can shut.
 *
 * Returns the `<dialog>` so a test can read the real `open` attribute the stub
 * at the top of this file maintains.
 */
function mountControlled(): HTMLDialogElement {
  return mountControlledHarness().dialog;
}

/** The controlled fixture plus the reader's ability to reopen it mid-request. */
function mountControlledHarness(): {
  dialog: HTMLDialogElement;
  show(next: boolean): void;
} {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  let setOpen: ((next: boolean) => void) | null = null;
  function Harness() {
    const [open, updateOpen] = useState(true);
    setOpen = updateOpen;
    return createElement(FeedbackDialog, {
      open,
      onClose: () => updateOpen(false),
      where: { url: "https://www.spideryarn.com/read/a-piece", slug: "a-piece" },
    });
  }
  act(() => root.render(createElement(Harness)));
  const dialog = host.querySelector("dialog");
  if (!dialog) throw new Error("no dialog");
  return {
    dialog,
    show(next) {
      act(() => setOpen?.(next));
    },
  };
}

/**
 * Flip `open` off and on again — **which is where every close route ends up, and
 * is not any of them.**
 *
 * This comment used to say "shut it the way Escape or the backdrop does", and
 * that was false: Escape reaches the platform, the backdrop reaches an `onClick`
 * that compares its target, and this reaches neither. It costs nothing *today*,
 * because both routes end at the same `onClose` and therefore at this same prop
 * change — but a fixture whose comment names a route it does not take is exactly
 * the class of
 * docs/postmortems/260907b-a-test-blurred-away-the-condition-it-existed-to-test.md,
 * and it was one divergence away from carrying a real bug.
 *
 * The route itself is now pinned separately, in § *the backdrop* below, which is
 * the countermeasure that postmortem actually recommends: not a truer comment,
 * but a test of the thing the comment was claiming.
 */
function reopen() {
  show(false);
  show(true);
}

function idOf(index: number): string {
  return JSON.parse(String(posts[index]?.init.body)).id as string;
}

function firstBox(): HTMLTextAreaElement {
  const box = host.querySelector<HTMLTextAreaElement>("textarea");
  if (!box) throw new Error("no textarea");
  return box;
}

/** Type into the one box. There were three, each with its own label. */
function type(text: string) {
  const box = host.querySelector<HTMLTextAreaElement>("textarea.fb-body");
  if (!box) throw new Error("no textarea");
  act(() => {
    /* React tracks the last value it wrote on the node, so setting `.value`
       directly is swallowed as a no-op. The setter off the prototype is the
       standard way round it. */
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Press one of the two kind toggles, by the words on it. */
function pick(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button.fb-kind-button")].find(
    (b) => (b.textContent ?? "").includes(label),
  );
  if (!button) throw new Error(`no kind button called ${label}`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function send() {
  const button = host.querySelector<HTMLButtonElement>("button.fb-send");
  if (!button) throw new Error("no Send");
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function body(): Record<string, unknown> {
  const last = posts.at(-1);
  if (!last) throw new Error("nothing was posted");
  return JSON.parse(String(last.init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.mocked(navigate).mockClear();
  posts.length = 0;
  answer = ok(201);
  lists.length = 0;
  listAnswer = page({ reports: [], more: false, counts: NONE });
  asAdmin = false;
  carried = null;
  finishShot = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the feedback dialog", () => {
  it("posts one body, no kind, a minted report id, and no diagnostics", async () => {
    mount();
    type("Pressed the button.");
    send();
    await act(async () => {});

    expect(posts).toHaveLength(1);
    expect(posts[0]?.input).toBe("/api/feedback");
    const sent = body();
    expect(sent.body).toBe("Pressed the button.");
    /* **Null, not "problem".** Greg: "don't default to Problem. Default to
       null/unknown" — so a reader who says nothing about the kind has said
       nothing, and this is what proves the toggle starts unpressed. */
    expect(sent.kind).toBeNull();
    expect(sent.consented).toBe(false);
    expect(sent.url).toBe("https://www.spideryarn.com/read/a-piece?q=footnotes");
    expect(sent.slug).toBe("a-piece");
    expect(isSpideryarnId(String(sent.id))).toBe(true);
    /* **The whole point of the default-off box.** Not an empty object, not a
       stripped one — the collector is never called at all. */
    expect(sent.diagnostics).toBeNull();
  });

  /* **The one piece of wording worth a test.** Greg, 2026-09-03: the dialog must
     "explicitly ask users for: Steps to reproduce; What you expected to see; and
     What you saw instead". These three spent a day inside the "Not sure what to
     write?" disclosure, where a reader who never clicks never sees them — so
     what is pinned is not the phrasing but that they are on screen before
     anybody clicks anything. */
  it("asks for the three things without the reader opening anything", () => {
    mount();
    const shown = host.textContent ?? "";
    expect(shown).toMatch(/steps to reproduce/i);
    expect(shown).toMatch(/what you expected/i);
    expect(shown).toMatch(/what you saw instead/i);
    expect(host.querySelector(".fb-help")).toBeNull();
  });

  /* **The guidance follows the toggle**, Greg 2026-09-04: a reader who says
     "a problem" should be shown what makes a good bug report *prominently*,
     rather than the same one-liner everybody else gets. What is pinned is the
     behaviour — that picking a kind changes the guidance, and that the
     bug-report asks are broken out as separate lines once Problem is picked —
     not the phrasing, which is FeedbackDialog.tsx § KindHint's. */
  it("breaks the bug-report asks out into lines once Problem is picked", () => {
    mount();
    expect(host.querySelectorAll(".fb-ask")).toHaveLength(0);
    pick("A problem");
    const asks = [...host.querySelectorAll(".fb-ask")].map((el) => el.textContent ?? "");
    expect(asks).toHaveLength(3);
    expect(asks[0]).toMatch(/steps to reproduce/i);
    expect(asks[1]).toMatch(/what you expected/i);
    expect(asks[2]).toMatch(/what you saw instead/i);
  });

  it("asks a suggestion what it is for, and does not ask it to reproduce anything", () => {
    mount();
    pick("A suggestion");
    const shown = host.textContent ?? "";
    expect(shown).toMatch(/what it would let you do/i);
    expect(shown).not.toMatch(/steps to reproduce/i);
    expect(host.querySelectorAll(".fb-ask")).toHaveLength(0);
  });

  /* Un-picking puts the general sentence back, which is the same code path as a
     dialog nobody has touched — and the one a reader reaches by pressing the
     pressed button, which is why the toggle is two buttons rather than radios. */
  it("goes back to the general sentence when the kind is un-picked", () => {
    mount();
    pick("A problem");
    pick("A problem");
    expect(host.querySelectorAll(".fb-ask")).toHaveLength(0);
    expect(host.textContent ?? "").toMatch(/if something went wrong/i);
  });

  /* Greg, 2026-09-04: *"we can get rid of not sure what to write because no one
     will click that."* Guidance behind a click is guidance nobody reads, and
     the point of the change above is that there is nothing left to click. */
  it("has no disclosure to open", () => {
    mount();
    expect(host.textContent ?? "").not.toMatch(/not sure what to write/i);
    expect(host.querySelector(".fb-help-toggle")).toBeNull();
    expect(host.querySelector(".fb-help")).toBeNull();
  });

  it("refuses to send when the box is blank", () => {
    mount();
    const button = host.querySelector<HTMLButtonElement>("button.fb-send");
    expect(button?.disabled).toBe(true);
    send();
    expect(posts).toHaveLength(0);
  });

  it("collects diagnostics only once the box is ticked", async () => {
    mount();
    type("Pressed the button.");
    const box = host.querySelector<HTMLInputElement>(".fb-consent input");
    if (!box) throw new Error("no tick-box");
    expect(box.checked).toBe(false);
    act(() => {
      box.click();
    });
    send();
    await act(async () => {});

    const sent = body();
    expect(sent.consented).toBe(true);
    expect(sent.diagnostics).not.toBeNull();
  });

  it("says the tick-box may send the reader's own article, and never their profile", () => {
    /* Plan 260913a: ticked, on one of the reader's own articles, the Sentry
       copy may carry the source file and `article.json`. The sentence beside
       the box is the consent for that, so it has to say so — and the old
       promise, "Never the article's text", has to be gone rather than sitting
       beside the new one. Whitespace is collapsed because JSX wraps lines. */
    mount();
    const words = (host.querySelector(".fb-consent")?.textContent ?? "").replace(/\s+/g, " ");
    expect(words).toContain("Send extra diagnostics.");
    expect(words).toContain("On one of your own articles");
    expect(words).toContain("may also send the file the article was made from");
    expect(words).toContain("within a size limit");
    expect(words).toContain("what you've told us about yourself");
    /* "Never" is about the diagnostics, not the whole report: the reader can type
       anything, and a screenshot can show anything. GPT Sol, S2-1. */
    expect(words).toContain("extra diagnostics never include your notes");
    expect(words).not.toContain("the article's text, your notes");
    expect(words).not.toContain("typed into a search box");
  });

  it("files one report for two clicks in the same frame", async () => {
    mount();
    type("Pressed the button twice.");
    /* Both clicks inside one `act`, so neither has seen the other's render.
       `disabled` alone does not survive this — the ref latch does. */
    const button = host.querySelector<HTMLButtonElement>("button.fb-send");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(posts).toHaveLength(1);
  });

  it("keeps the reader's words and the same id when the send fails", async () => {
    mount();
    type("It broke.");
    answer = async () => {
      throw new Error("offline");
    };
    send();
    await act(async () => {});

    /* The words are still on screen — this is the only copy of them. */
    const first = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(first?.value).toBe("It broke.");
    expect(host.querySelector(".fb-failed")).not.toBeNull();
    expect(host.querySelector(".fb-copy")).not.toBeNull();

    answer = ok(200);
    send();
    await act(async () => {});

    expect(posts).toHaveLength(2);
    /* **The same id, so the server answers `duplicate` rather than filing a
       second report.** Mint per click instead of per opening and this is the
       assertion that goes red. */
    expect(idOf(1)).toBe(idOf(0));
  });

  /* ---- what closing the dialog must not destroy ------------------------- */

  it("keeps the draft when the reader shuts it and opens it again", () => {
    mount();
    type("Half a sentence so f");
    /* Escape, the backdrop, Cancel and the × all reach the same place: `open`
       goes false. Until 2026-09-01 reopening cleared every box, so a reader who
       shut it by accident lost the only copy of what they had written. */
    reopen();
    expect(firstBox().value).toBe("Half a sentence so f");
  });

  it("keeps the same report id across a close and reopen, so a retry is still a retry", async () => {
    mount();
    type("It broke.");
    answer = async () => {
      throw new Error("offline");
    };
    send();
    await act(async () => {});

    reopen();
    answer = ok(200);
    send();
    await act(async () => {});

    expect(posts).toHaveLength(2);
    /* Mint per opening and this is red: the retry would file a *second* report
       of the same bug, because the server dedupes on the id and nothing else. */
    expect(idOf(1)).toBe(idOf(0));
  });

  it("mints a fresh id for the next report, but only after one is filed", async () => {
    mount();
    type("The first thing.");
    send();
    await act(async () => {});
    /* A successful send is the one thing that starts a new report. */
    expect(host.querySelector(".toast")).not.toBeNull();
    show(false);
    show(true);

    expect(firstBox().value).toBe("");
    type("A different thing.");
    send();
    await act(async () => {});
    expect(idOf(1)).not.toBe(idOf(0));
  });

  it("ignores a request that resolves after the reader has moved on", async () => {
    /**
     * **The sequence matters, and my first version of this test had it wrong.**
     *
     * A held request whose report is still the one on screen is *not* stale —
     * the id survives a close and reopen on purpose, so its completion landing
     * is correct. Removing the guard left that version green, which made it
     * evidence of nothing. GPT Sol warned about exactly this class.
     *
     * The damaging sequence needs the id to have moved on, and only one thing
     * moves it: a report that was actually filed. So — a send is abandoned
     * mid-flight, a *different* report is then filed and closed (which mints the
     * next id), the reader starts a third, and only then does the abandoned
     * request come back a success. Without the guard it paints "Thank you" over
     * a report that was never sent, and the Close button underneath it then
     * throws those words away.
     */
    mount();
    type("The abandoned one.");
    let settle: ((res: Response) => void) | null = null;
    answer = () => new Promise<Response>((resolve) => (settle = resolve));
    send();
    await act(async () => {});

    // Give up on it, come back, and file this report for real.
    reopen();
    answer = ok(201);
    send();
    await act(async () => {});
    /* Filed: the reader waves the thank-you away and opens the box again. */
    const dismiss = host.querySelector<HTMLButtonElement>(".toast-close");
    if (!dismiss) throw new Error("no toast");
    act(() => dismiss.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    show(false);
    show(true);

    // A third report, half typed, not sent.
    type("A completely different bug.");
    expect(host.querySelector(".toast")).toBeNull();

    // Now the abandoned request finally answers.
    await act(async () => {
      settle?.(new Response("{}", { status: 201 }));
    });

    /* Without the guard it would thank the reader for the draft on screen, and
       empty it as though it had been sent. */
    expect(host.querySelector(".toast"), "a stale send thanked a live draft").toBeNull();
    expect(firstBox().value).toBe("A completely different bug.");
  });

  it("will not send while a pasted screenshot is still being re-encoded", async () => {
    /**
     * Paste a big screenshot and hit ⌘+Enter in the same second, and the POST
     * used to be built from `shot === null`: the report left without the picture
     * and the thumbnail appeared afterwards as though it had gone with it.
     * Nothing failed, nothing was logged, and the reader had no way to know.
     * GPT Sol, 2026-09-01.
     */
    mount();
    type("Look at the picture.");

    const input = host.querySelector<HTMLInputElement>('.fb-shot-pick input[type="file"]');
    if (!input) throw new Error("no file input");
    const file = new File(["x"], "shot.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));

    const button = host.querySelector<HTMLButtonElement>("button.fb-send");
    expect(button?.disabled, "Send stayed live while the picture was decoding").toBe(true);
    /* And the keyboard path, which does not go through `disabled` at all. */
    send();
    await act(async () => {});
    expect(posts).toHaveLength(0);

    await act(async () => {
      finishShot?.("aGVsbG8=");
    });
    send();
    await act(async () => {});
    expect(posts).toHaveLength(1);
    expect(body().screenshot).toBe("aGVsbG8=");
  });

  it("sends the kind the reader picked, and lets them un-pick it", async () => {
    mount();
    type("The margin could hold the gist.");
    const [problem, suggestion] = [...host.querySelectorAll<HTMLButtonElement>(".fb-kind-button")];
    if (!problem || !suggestion) throw new Error("no kind buttons");
    expect(problem.getAttribute("aria-pressed")).toBe("false");

    act(() => suggestion.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(suggestion.getAttribute("aria-pressed")).toBe("true");

    /* **Pressing the pressed one clears it**, which is the whole reason these
       are `aria-pressed` buttons rather than a radio group: a reader who picks
       the wrong one can put it back. GPT Sol, 2026-09-02. Before the send rather
       than after, because a filed report replaces the form with the thank-you
       and these buttons are no longer in the document. */
    act(() => suggestion.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(suggestion.getAttribute("aria-pressed")).toBe("false");

    act(() => suggestion.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    send();
    await act(async () => {});
    expect(body().kind).toBe("suggestion");
  });

  it("will not send while the microphone is still listening", async () => {
    /* **`armed`, not `transcribing`.** `readOnly` is only the two seconds after
       the reader presses stop; a guard on that alone lets Cmd+Enter file the
       rough live guesses while they are still talking — or nothing at all on a
       browser with no live recogniser. Two positive failures rather than one,
       because the second passes while the first bug is still there. */
    mic.armed = true;
    mount();
    type("Half a sentence, still speaking");
    expect(host.querySelector<HTMLButtonElement>("button.fb-send")?.disabled).toBe(true);
    send();
    await act(async () => {});
    expect(posts).toHaveLength(0);
    mic.armed = false;
  });

  it("will not send while the transcript is still on its way", async () => {
    mic.transcribing = true;
    mount();
    type("Said out loud, being written down");
    expect(host.querySelector<HTMLButtonElement>("button.fb-send")?.disabled).toBe(true);
    send();
    await act(async () => {});
    expect(posts).toHaveLength(0);
    mic.transcribing = false;
  });

  it("stops the microphone when the dialog is shut", () => {
    /* This component is mounted for the life of the page — FeedbackButton
       renders it open or shut — so nothing unmounts on Escape and
       `useDictation`'s own cleanup never runs. Without the effect this pins, the
       recorder goes on running behind a closed dialog. GPT Sol, 2026-09-02. */
    mic.armed = true;
    mount();
    micToggles.length = 0;
    show(false);
    expect(micToggles).toEqual(["hook"]);
    mic.armed = false;
  });

  it("will not send a report past the character limit", async () => {
    /* The counter under the box was a statement and not a rule: Send stayed
       enabled at one character over, so the reader was told the limit, allowed
       to press the button, and answered with a server-side `[fb-long]`. Both
       paths, because `disabled` does not stop the keyboard chord. GPT Sol's code
       review, 2026-09-02. */
    mount();
    type("x".repeat(MAX_FEEDBACK_ANSWER_CHARS + 1));
    expect(host.querySelector<HTMLButtonElement>("button.fb-send")?.disabled).toBe(true);
    send();
    await act(async () => {});
    expect(posts).toHaveLength(0);

    type("x".repeat(MAX_FEEDBACK_ANSWER_CHARS));
    expect(host.querySelector<HTMLButtonElement>("button.fb-send")?.disabled).toBe(false);
  });

  it("lets the newest attempt have the last word, whatever order they settle in", async () => {
    /**
     * **Two requests, one report id.** The id survives a close and reopen on
     * purpose, and reopening releases the send latch — so a reader who gives up
     * on a slow send, comes back and presses Send again has two in flight, and
     * they can answer in either order. Guarding on the id alone let the *older*
     * one write to the screen: here it fails after the retry has succeeded, and
     * without an attempt counter it paints the failure panel over "Thank you".
     * GPT Sol's code review, 2026-09-02.
     */
    mount();
    type("Said once, sent twice.");
    let settleFirst: ((res: Response) => void) | null = null;
    answer = () => new Promise<Response>((resolve) => (settleFirst = resolve));
    send();
    await act(async () => {});

    /* Give up on it and try again — same report, same id, second attempt. */
    reopen();
    answer = ok(201);
    send();
    await act(async () => {});
    expect(host.querySelector(".toast"), "the retry should have been filed").not.toBeNull();

    /* Only now does the first attempt come back, and it failed. */
    await act(async () => {
      settleFirst?.(new Response("nope", { status: 500 }));
    });
    expect(
      host.querySelector(".fb-failed"),
      "an older attempt painted a failure over a newer success",
    ).toBeNull();
  });

  it("says so when the browser refuses the clipboard", async () => {
    mount();
    type("It broke.");
    answer = async () => {
      throw new Error("offline");
    };
    send();
    await act(async () => {});

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error("denied")) },
    });
    const copyButton = host.querySelector<HTMLButtonElement>(".fb-copy");
    act(() => copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => {});

    /* A reader who believes they have copied their words and has not is one
       Escape away from losing them, so silence is the wrong answer here. */
    expect(host.textContent).toContain("would not let us reach the clipboard");
    /* And the address is on screen, because the message beside it says to send
       the report by email. */
    expect(host.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')).not.toBeNull();
  });

  /**
   * **"Copy the report" reports the newest press, and only for the report on
   * screen.** `writeText` is a promise, so an older press can settle last, and
   * it can settle after the report it belonged to was filed and the form
   * emptied. Each case was red against the two booleans this button had until
   * 2026-10-04; it is `useCopy` now (src/web/useCopy.ts).
   * docs/plans/261004e-fifth-sweep-cluster-20-one-copy-hook-for-the-nine-clipboard-writers.md.
   */
  describe("copying the report, more than once", () => {
    type Write = { resolve(): void; reject(reason: unknown): void };
    const REFUSED = "would not let us reach the clipboard";

    /** A clipboard whose every write this test settles by hand, in any order. */
    function clipboard(): Write[] {
      const writes: Write[] = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            new Promise<void>((resolve, reject) => {
              writes.push({ resolve, reject });
            }),
        },
      });
      return writes;
    }
    afterEach(() => {
      Reflect.deleteProperty(navigator as object, "clipboard");
    });

    /** Type a report and have its send fail: the one screen with a Copy button. */
    async function failToSend(text: string): Promise<void> {
      type(text);
      answer = async () => {
        throw new Error("offline");
      };
      send();
      await act(async () => {});
      expect(host.querySelector(".fb-failed")).not.toBeNull();
    }
    const copyButton = () => {
      const button = host.querySelector<HTMLButtonElement>("button.fb-copy");
      if (!button) throw new Error("no Copy button");
      return button;
    };
    const pressCopy = () =>
      act(() => {
        copyButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    async function settle(how: () => void): Promise<void> {
      await act(async () => {
        how();
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    it("does not say the copy failed when a newer press has succeeded", async () => {
      mount();
      await failToSend("It broke.");
      const writes = clipboard();
      pressCopy();
      pressCopy();
      await settle(() => writes[1]?.resolve());
      await settle(() => writes[0]?.reject(new Error("denied")));
      /* The clipboard holds the report. Telling the reader to copy it by hand
         is false, and it is the older press talking. */
      expect(copyButton().textContent).toBe("Copied");
      expect(host.textContent).not.toContain(REFUSED);
    });

    it("does not tick the next report for a copy of the last one", async () => {
      mount();
      await failToSend("The first report.");
      const writes = clipboard();
      pressCopy();
      /* The retry goes through while the write is still out: the report is
         filed and the form starts again, empty. */
      answer = ok(201);
      send();
      await act(async () => {});
      expect(firstBox().value).toBe("");
      await settle(() => writes[0]?.resolve());

      /* A second report, whose send also fails. Nobody has copied this one. */
      await failToSend("A different report.");
      expect(copyButton().textContent).toBe("Copy the report");
    });

    it("stops saying Copied when a later copy is refused", async () => {
      mount();
      await failToSend("It broke.");
      const writes = clipboard();
      pressCopy();
      await settle(() => writes[0]?.resolve());
      expect(copyButton().textContent).toBe("Copied");

      pressCopy();
      await settle(() => writes[1]?.reject(new Error("denied")));
      /* One state, not two: "Copied" beside "could not reach the clipboard"
         told the reader both things at once. */
      expect(host.textContent).toContain(REFUSED);
      expect(copyButton().textContent).toBe("Copy the report");
    });

    it.each(["copied", "refused"] as const)("keeps %s feedback without timing out", async (outcome) => {
      mount();
      await failToSend("It broke.");
      const writes = clipboard();
      vi.useFakeTimers();
      try {
        pressCopy();
        expect(writes).toHaveLength(1);
        await settle(() => outcome === "copied" ? writes[0]?.resolve() : writes[0]?.reject(new Error("denied")));
        const label = outcome === "copied" ? "Copied" : "Copy the report";
        expect(copyButton().textContent).toBe(label);
        expect(host.textContent?.includes(REFUSED)).toBe(outcome === "refused");

        /* Unlike the short ticks elsewhere, this panel keeps the outcome
           until a later copy settles or the report is reset. A migration
           using the hook's usual 1.6 seconds would lose it. */
        act(() => vi.advanceTimersByTime(60_000));
        expect(copyButton().textContent).toBe(label);
        expect(host.textContent?.includes(REFUSED)).toBe(outcome === "refused");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  /* ---- one address on the site, and it is not a person's ---------------- */

  /**
   * **The dialog no longer reads the reader their own address back.**
   *
   * Greg, 2026-09-05, having filed the report from inside this dialog:
   *
   * > In the feedback box, it has the following: "It is sent as
   * > greg@gregdetre.com, so we can reply.". Remove that sentence, and remove
   * > any other mentions in the UI of my personal email address … The only
   * > email address we should include on the site is hello@spideryarn.com.
   *
   * The sentence interpolated whoever was signed in, so on his screen it was his
   * own address staring back. Nothing is lost by it going: the report still
   * travels with the account's address — the *server* attaches it from the
   * verified session, never the browser (src/feedback.ts) — and the hover card
   * on the Feedback button is where a reader is told so
   * (src/web/FeedbackButton.tsx, tests/feedback-button-tooltip.test.tsx).
   */
  it("does not read the reader their own address back", () => {
    mount();
    expect(host.textContent).not.toContain("so we can reply");
    expect(host.querySelector(".fb-email")).toBeNull();
  });

  /**
   * **The failed-send fallback points at the site's inbox.**
   *
   * It was `ADMIN_EMAIL` — the constant that decides who sees `/admin` — so the
   * one screen in the app that asks a reader to send us an email named a person
   * rather than the product. `hello@spideryarn.com` is the site's one address
   * (src/site-text.ts, docs/project/website-text.md § The contact address), and
   * `ADMIN_EMAIL` goes on meaning what it always meant: an identity for logs and
   * for the seed, never something a reader is shown.
   */
  it("offers the site's address when a send fails, not a personal one", async () => {
    mount();
    type("It broke.");
    answer = async () => {
      throw new Error("offline");
    };
    send();
    await act(async () => {});

    const link = host.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    expect(link?.getAttribute("href")).toContain(`mailto:${CONTACT_EMAIL}`);
    expect(host.textContent).toContain(CONTACT_EMAIL);
    expect(host.textContent).not.toContain(ADMIN_EMAIL);
  });

  /* ---- the button says it is working ------------------------------------ */

  /**
   * **Send spins while the report is in flight, and cannot be pressed again.**
   *
   * Greg, 2026-09-05: *"When I click the send button in the feedback dialog,
   * show a loading spinner while it's sending."* It already did — `.cmt-spinner`
   * has been on this button since 2026-09-01 — and nothing pinned it, so a
   * refactor of the four-way label below could have dropped it with every test
   * in this file still green. That is what this is here for.
   *
   * The answer is held open deliberately: a `Promise` that has not settled is
   * the only way to stand inside the `sending` stage and look at it.
   */
  it("spins on Send while the report is in flight", async () => {
    mount();
    type("It broke.");
    const flight: { land: (() => void) | null } = { land: null };
    answer = () =>
      new Promise<Response>((resolve) => {
        flight.land = () => resolve(new Response(JSON.stringify({ id: "x" }), { status: 201 }));
      });
    send();
    await act(async () => {});

    const button = host.querySelector<HTMLButtonElement>("button.fb-send");
    expect(button?.textContent).toContain("Sending");
    /* The app's one spinner — docs/project/icons.md#the-loading-spinner. */
    expect(button?.querySelector(".cmt-spinner")).not.toBeNull();
    /* And it is not pressable meanwhile. The ref latch is what stops two clicks
       in one frame (above); this is the half a reader can see. */
    expect(button?.disabled).toBe(true);

    await act(async () => {
      flight.land?.();
    });
    expect(host.querySelector("button.fb-send")?.textContent).not.toContain("Sending");
  });
});

/**
 * **The panel with the keyboard up.**
 *
 * Greg, from an installed iOS app, 2026-09-04: the soft keyboard covered Send
 * and there was no way to reach it. Two things put it back, and only one of
 * them is testable here.
 *
 * The untestable half is CSS and a viewport meta. `interactive-widget=
 * resizes-content` in index.html *asks* the keyboard to shrink the layout
 * viewport, which Chromium does and **WebKit does not reliably**
 * (bugs.webkit.org/show_bug.cgi?id=259770) — so the sizing that follows from it
 * is a Chromium fix, unverified on any phone. The engine-independent half is
 * `window.visualViewport`, which the dialog reads for its own top and height;
 * that one *is* testable and tests/visual-viewport-dialogs.test.tsx holds it.
 *
 * The half a test can hold is the shape that makes the sizing worth anything:
 * the buttons are a **sibling** of the scrolling middle rather than content
 * inside it. Put them inside and a short panel scrolls them out of reach again,
 * with a stylesheet that still looks right — `.cmt-dialog` learnt this once
 * already, with its ✕.
 */
/**
 * ## § the backdrop
 *
 * **Five native `<dialog>`s in this app close on a press outside them, all five
 * by the same three lines** — `onClick` on the dialog, `if (e.target ===
 * ref.current) onClose()`. Until 2026-09-07 not one test anywhere dispatched a
 * click whose target was the dialog — Lightbox, this, Illustrated full, Sketch
 * full and the CommandBar.
 *
 * **How much of it was actually unpinned, measured rather than asserted.**
 * Deleting the comparison here reddens three tests, not one: this file's
 * *"stays open when the press lands on something inside it"* below, plus
 * *"shuts before it empties the panel"* and *"keeps a sentence added after
 * Send"*, both of which click controls inside the dialog and would now be
 * dismissing it. So the *inside* half had incidental cover and the claim that
 * the guard was wholly unprotected was too strong. What had **no** cover in any
 * of the five, and has it in the first test below, is the half that says a press
 * on the backdrop closes the dialog at all: with `onClose()` deleted and the
 * comparison left in place, **the whole suite — 15,137 tests — went red on
 * exactly one of them, the first test below.** Measured 2026-09-07, not assumed;
 * the sentence before it was written from a single file's run and was too
 * strong twice over.
 *
 * **Why the target comparison is the whole of it.** A modal `<dialog>`'s
 * `::backdrop` is not a separate element — a press on it is delivered with the
 * dialog itself as the target, while a press on anything the dialog contains
 * arrives with that child as the target and bubbles up through the same handler.
 * So one equality test tells "outside" from "inside", and dropping it turns
 * every click in the panel into a dismissal: for this dialog that discards a
 * half-written report, and for the CommandBar the query.
 *
 * jsdom has no `showModal` and no `::backdrop`, and neither is needed here —
 * the handler compares targets and nothing else. What jsdom cannot show is that
 * a real backdrop press *does* target the dialog; that is the platform's
 * contract, and it is why the assertion is written against the target rather
 * than against a pixel.
 */
describe("the backdrop", () => {
  it("closes on a press whose target is the dialog itself", () => {
    const dialog = mountControlled();
    expect(dialog.open).toBe(true);
    act(() => {
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialog.open).toBe(false);
  });

  it("stays open when the press lands on something inside it", () => {
    const dialog = mountControlled();
    const box = firstBox();
    act(() => {
      box.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* The half-written report is the thing being protected: without the target
       comparison this press would shut the panel and take the words with it. */
    expect(dialog.open).toBe(true);
  });
});

describe("the thank-you, and getting out of it", () => {
  /** The sentence in the toast, whitespace-collapsed. */
  function thanks(): string {
    const panel = host.querySelector(".toast .toast-text");
    if (!panel) throw new Error("no thank-you toast");
    return (panel.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  /** File a report, having optionally pressed one of the two kind toggles. */
  async function fileOne(label?: string) {
    if (label) pick(label);
    type("Something happened.");
    send();
    await act(async () => {});
  }

  /* **Matched loosely, on one distinguishing word each.** copy.md's rule is that
     tests match the code and not the prose, precisely so copy stays rewritable;
     there is no bracketed code here to match on, because a thank-you is not a
     failure. So each assertion names the one thing that must survive a rewrite —
     that a problem is answered with sympathy, a suggestion with thanks for the
     suggestion — and leaves the rest of the sentence free. */
  it("is sorry about a problem, and says it will look into it", async () => {
    mount();
    await fileOne("A problem");
    expect(thanks().toLowerCase()).toContain("sorry");
    expect(thanks().toLowerCase()).toContain("look into it");
  });

  it("thanks a suggestion for the suggestion", async () => {
    mount();
    await fileOne("A suggestion");
    expect(thanks().toLowerCase()).toContain("suggestion");
    expect(thanks().toLowerCase()).not.toContain("sorry");
  });

  it("still thanks a report whose reader picked neither", async () => {
    mount();
    await fileOne();
    expect(thanks().toLowerCase()).toContain("thank you");
    expect(thanks().toLowerCase()).not.toContain("sorry");
  });

  /* Greg, 2026-09-29: *"Remove 'It is filed' from the post-Feedback message."*
     All three, since which one the reader sees depends on the toggle. */
  it.each([["A problem"], ["A suggestion"], [undefined]])(
    "does not say it is filed (%s)",
    async (label) => {
      mount();
      await fileOne(label);
      expect(thanks().toLowerCase()).not.toContain("filed");
    },
  );

  /**
   * **A successful send shuts the dialog and says thank you in a toast** —
   * Greg, 2026-09-29: *"that post-Feedback message should be a toast in the
   * corner that disappears after a few seconds, rather than a blocking modal."*
   *
   * The toast has to live outside the `<dialog>`: a shut dialog paints nothing,
   * so a thank-you inside it would be in the document and seen by nobody.
   */
  it("shuts on success, empties the form, and thanks the reader outside the dialog", async () => {
    const dialog = mountControlled();
    type("Something happened.");
    send();
    await act(async () => {});

    expect(dialog.open, "the dialog stayed up over the thank-you").toBe(false);
    const toast = host.querySelector(".toast");
    expect(toast, "no toast").not.toBeNull();
    expect(dialog.contains(toast), "the toast is inside a shut dialog").toBe(false);
    expect(thanks().toLowerCase()).toContain("thank you");
    expect(host.querySelector(".fb-done"), "the old panel is still here").toBeNull();
    /* And the next opening is a fresh report. */
    expect(firstBox().value).toBe("");
  });

  it("stays open, keeps the words and shows no toast when the send fails", async () => {
    const dialog = mountControlled();
    type("Something happened.");
    answer = async () => new Response("nope", { status: 500 });
    send();
    await act(async () => {});

    expect(dialog.open).toBe(true);
    expect(host.querySelector(".toast")).toBeNull();
    expect(host.querySelector(".fb-failed")).not.toBeNull();
    expect(firstBox().value).toBe("Something happened.");
  });

  /**
   * **A filed report takes its dictation's message with it.** Feedback report
   * SPIDERYARN-READING2-7Z, Greg, 2026-10-01: a `[mic-silent]` from a
   * dictation that caught nothing was still there on every later opening, after
   * the report had been sent by typing. The dialog is mounted for the life of
   * the page, and so is its dictation. What is dismissed is the artifact that
   * was on the strip **when Send was pressed**, not whatever is there when the
   * answer lands. Plan 261001k.
   */
  it("dismisses the dictation's message when the report is filed, as it stood at Send", async () => {
    micDismissals.length = 0;
    mic.artifact = 7;
    mountControlled();
    type("Typed instead.");
    let release: (() => void) | null = null;
    answer = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ id: "x" }), { status: 201 }));
      });
    send();
    /* Something new on the strip while the send is away. */
    mic.artifact = 8;
    act(() => release?.());
    await act(async () => {});
    expect(micDismissals).toEqual([7]);
    mic.artifact = 7;
  });

  it("leaves the dictation's message alone when the send fails", async () => {
    micDismissals.length = 0;
    mountControlled();
    type("Typed instead.");
    answer = async () => new Response("nope", { status: 500 });
    send();
    await act(async () => {});
    expect(micDismissals).toEqual([]);
  });

  /**
   * **Words typed after Send are not the report that was filed**, so dismissing
   * the thank-you must not delete them.
   *
   * The box stays editable while the request is in the air, so a reader can add
   * a sentence between pressing Send and the answer arriving — and that sentence
   * was never in the POST. GPT Sol established this as a P0 on 2026-09-05 and
   * reproduced it in a harness of its own: the POST carried `A`, and after the
   * dismissal the box was empty rather than holding `A+B`.
   *
   * It predates this change — the old Close button called the same `discard()` —
   * but this change would have widened it from the button to every dismissal, so
   * it is closed here rather than inherited.
   */
  it("keeps a sentence added after Send, and starts a new report for it", async () => {
    micDismissals.length = 0;
    mountControlled();
    type("The first thing.");
    /* Send, and answer it only after the reader has typed more. */
    let release: (() => void) | null = null;
    answer = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ id: "x" }), { status: 201 }));
      });
    send();
    type("The first thing. And another.");
    act(() => release?.());
    await act(async () => {});

    /* What went is what was in the box when Send was pressed. */
    expect(body().body).toBe("The first thing.");

    /* The send landed, so the dialog is shut and the form would have been
       emptied — but not of words that were never in the POST. */
    expect(host.querySelector(".toast")).not.toBeNull();
    expect(firstBox().value).toBe("The first thing. And another.");
    /* The box is a new draft, so what the strip says belongs to it. */
    expect(micDismissals, "dismissed the dictation of a draft that was not sent").toEqual([]);
    /* And it is a new report, not a second send of the one already filed. */
    answer = ok(201);
    send();
    await act(async () => {});
    expect(idOf(1)).not.toBe(idOf(0));
    expect(body().body).toBe("The first thing. And another.");
  });

  /**
   * **A report filed while nobody was looking still says so.**
   *
   * Close the dialog mid-flight and the request goes on. When it lands, the
   * toast is how the reader learns it went — the dialog they left is shut, and
   * reopening it onto an empty box would otherwise say nothing either way.
   * (Until 2026-09-29 this was the `thanksSeen` guard, which kept the thank-you
   * panel for the next opening.)
   */
  it("thanks the reader when the send lands after they left", async () => {
    mountControlled();
    type("Something happened.");
    let release: (() => void) | null = null;
    answer = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ id: "x" }), { status: 201 }));
      });
    send();
    /* Out of the dialog before the answer comes back. */
    const shut = host.querySelector<HTMLButtonElement>(".fb-close");
    if (!shut) throw new Error("no ✕");
    act(() => shut.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => release?.());
    await act(async () => {});

    expect(host.querySelector(".toast")).not.toBeNull();
    expect(firstBox().value).toBe("");
  });

  it("does not shut a dialog the reader reopened while the send was in flight", async () => {
    const controlled = mountControlledHarness();
    type("The first thing.");
    let release: (() => void) | null = null;
    answer = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ id: "x" }), { status: 201 }));
      });
    send();

    controlled.show(false);
    controlled.show(true);
    type("The first thing. And another.");
    act(() => release?.());
    await act(async () => {});

    expect(controlled.dialog.open, "a completion from the previous opening shut this one").toBe(true);
    expect(firstBox().value, "words added after Send were lost").toBe(
      "The first thing. And another.",
    );
    const toast = host.querySelector(".toast");
    expect(toast, "the successful report was not acknowledged").not.toBeNull();
    expect(
      controlled.dialog.contains(toast),
      "the toast was painted underneath the native dialog's top layer",
    ).toBe(true);

    answer = ok(201);
    send();
    await act(async () => {});
    expect(idOf(1), "the kept draft reused the filed report's id").not.toBe(idOf(0));
  });

  /**
   * **A picture still being re-encoded when the report is dismissed does not
   * turn up attached to the next one.**
   *
   * `discard()` cleared `shot` but left `shotGeneration` alone, so the late
   * conversion still passed its own currency check and wrote the old report's
   * image into a freshly minted one. GPT Sol established it as a P1 on
   * 2026-09-05 and reproduced it; it predates this change.
   */
  it("does not attach a late picture to the report after it", async () => {
    mountControlled();
    type("Something happened.");

    /* Send, and hold the request open — the form is still on screen and still
       accepts a picture while `stage` is `sending`. */
    let release: (() => void) | null = null;
    answer = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ id: "x" }), { status: 201 }));
      });
    send();

    const input = host.querySelector<HTMLInputElement>('.fb-shot-pick input[type="file"]');
    if (!input) throw new Error("no file input");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["x"], "shot.png", { type: "image/png" })],
    });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));

    /* The report lands — which shuts the dialog and starts the next report —
       while the picture is still being re-encoded. */
    act(() => release?.());
    await act(async () => {});
    expect(host.querySelector(".toast")).not.toBeNull();

    /* Only now does the conversion finish. It belongs to a report that is filed
       and gone, so it must not land on the one that replaced it. */
    await act(async () => {
      finishShot?.("bGF0ZQ==");
    });

    expect(host.querySelector(".fb-shot-have")).toBeNull();
  });

  /**
   * **The next opening is the form, not the last report's thank-you.** The
   * thank-you is not in the dialog any more, so there is nothing stale for the
   * next press of Feedback to open onto.
   */
  it("comes back to an empty form after a report is filed", async () => {
    mount();
    type("Something happened.");
    send();
    await act(async () => {});

    reopen();

    expect(host.querySelector(".fb-done")).toBeNull();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(firstBox().value).toBe("");
  });
});

describe("the keyboard, and the button under it", () => {
  it("keeps Send out of the part that scrolls", () => {
    mount();
    const scroll = host.querySelector(".fb-scroll");
    const actions = host.querySelector(".fb-actions");
    expect(scroll, "no scrolling middle").not.toBeNull();
    expect(actions, "no buttons").not.toBeNull();
    expect(scroll?.contains(actions ?? null), "Send is inside the scroller").toBe(false);
    /* And both hang off the panel itself, which is what the flex rules key on. */
    expect(actions?.parentElement?.classList.contains("fb-panel")).toBe(true);
    expect(scroll?.parentElement?.classList.contains("fb-panel")).toBe(true);
    /* The ✕ stays put for the same reason. */
    expect(scroll?.contains(host.querySelector(".fb-close"))).toBe(false);
  });

  /**
   * **The Enter key is not the answer here, and must not claim to be.**
   *
   * `enterKeyHint="send"` on this box would be a lie twice over: ⌘/Ctrl+Enter is
   * what sends, and iOS inserts a newline whatever the key is labelled. See
   * AnnotateDialog.tsx, which records the same decision, and
   * docs/project/touch.md § What the Enter key promises.
   */
  it("promises nothing on Enter, because Enter writes a newline", () => {
    mount();
    expect(firstBox().getAttribute("enterkeyhint")).toBeNull();
  });
});

/* ------------------------------------------------------ the Earlier tab -- */

/**
 * **The reader's own earlier reports, in a second tab** —
 * docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md.
 *
 * Most of what is pinned here is what GPT Sol's plan review found: **hiding a
 * panel is not switching it off.** The Write panel stays mounted while Earlier
 * shows, so its microphone, the paste and drop handlers on the whole `<dialog>`,
 * and the form's submit all still reach a draft the reader cannot see — unless
 * each is guarded. A test per guard.
 */
describe("the Earlier tab", () => {
  function tab(name: "Write" | "Earlier"): HTMLButtonElement {
    const found = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (b) => (b.textContent ?? "").trim() === name,
    );
    if (!found) throw new Error(`no ${name} tab`);
    return found;
  }

  function click(el: Element | null | undefined) {
    if (!el) throw new Error("nothing to click");
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function panelOf(name: "Write" | "Earlier"): HTMLElement {
    const id = tab(name).getAttribute("aria-controls");
    const panel = id ? document.getElementById(id) : null;
    if (!panel) throw new Error(`the ${name} tab controls nothing`);
    return panel;
  }

  function commandEnter() {
    act(() => {
      host
        .querySelector("dialog")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    });
  }

  const REPORTS = {
    reports: [
      {
        id: "spya-k3m9qt",
        createdAt: "2026-09-12T10:45:00.000Z",
        kind: "suggestion",
        body: "A tab of what I sent before.\nJust a list.",
        page: "/read/why-trees-spya-k3m9qt",
        /* The paragraph it was filed at (261006b). */
        at: "spya-tgnssb",
        shipped: true,
      },
      {
        id: "spya-a1b2c3",
        createdAt: "2026-09-09T08:00:00.000Z",
        kind: null,
        body: "The shelf is slow.",
        /* A report older than 2026-09-02, or one whose address did not parse. */
        page: null,
        at: null,
        shipped: false,
      },
    ],
    more: false,
    counts: COUNTS,
  };

  function showButton(name: "All" | "Shipped" | "Not shipped"): HTMLButtonElement {
    /* The label is the first text node; a count may follow it in its own span. */
    const found = [...panelOf("Earlier").querySelectorAll<HTMLButtonElement>(".fb-show-button")].find(
      (b) => (b.firstChild?.textContent ?? "").trim() === name,
    );
    if (!found) throw new Error(`no ${name} filter`);
    return found;
  }

  /* docs/plans/261007d-…: for an admin the tab says what became of each report,
     numbers them, and carries the note's one-line comment. */
  describe("for an admin", () => {
    const ADMIN_PATH = "/api/admin/feedback/earlier";
    const ADMIN_COUNTS = { all: 5, open: 1, waiting: 1, aside: 2, shipped: 1 };
    const base = { createdAt: "2026-09-12T10:45:00.000Z", kind: null, page: null, at: null, comment: null, ignoredAt: null };
    const ADMIN_REPORTS = {
      reports: [
        { ...base, id: "spya-k3m9qt", number: 215, status: "shipped", body: "A tab of what I sent before." },
        {
          ...base,
          id: "spya-a2b2c3",
          number: 214,
          status: "waiting",
          body: "One switch or two?",
          comment: "Waiting on you: <b>one</b> switch for both, or one each?",
        },
        {
          ...base,
          id: "spya-a3b2c3",
          number: 213,
          status: "aside",
          body: "Could it read my mind?",
          comment: "Set aside: the browser gives us no way to do this.",
        },
        { ...base, id: "spya-a4b2c3", number: 212, status: "aside", body: "Ignore me.", ignoredAt: "2026-10-05T09:00:00.000Z" },
        { ...base, id: "spya-a5b2c3", number: 211, status: "open", body: "The shelf is slow." },
      ],
      more: false,
      counts: ADMIN_COUNTS,
      questions: [] as unknown[],
    };
    const pills = () =>
      [...panelOf("Earlier").querySelectorAll<HTMLButtonElement>(".fb-show-button")].map((b) =>
        (b.textContent ?? "").replace(/\s+/g, " ").trim(),
      );
    const pill = (name: string) => {
      const found = [...panelOf("Earlier").querySelectorAll<HTMLButtonElement>(".fb-show-button")].find(
        (b) => (b.firstChild?.textContent ?? "").trim() === name,
      );
      if (!found) throw new Error(`no ${name} filter`);
      return found;
    };
    async function openEarlier() {
      mount();
      click(tab("Earlier"));
      await act(async () => {});
    }

    it("gets the admin list through the production FeedbackHost's reader-id check", async () => {
      function OpenFeedback() {
        const open = useFeedbackOpen();
        return <button type="button" onClick={() => open?.()}>Open feedback</button>;
      }
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      listAnswer = page(ADMIN_REPORTS);
      act(() => {
        root.render(
          <FeedbackHost readerId={ADMIN_USER_ID_LOCAL}>
            <OpenFeedback />
          </FeedbackHost>,
        );
      });
      click([...host.querySelectorAll("button")].find((button) => button.textContent === "Open feedback"));
      click(tab("Earlier"));
      await act(async () => {});

      expect(lists).toEqual([ADMIN_PATH]);
      expect(pills()).toEqual(["All 5", "Open 1", "Needs a decision 1", "Set aside 2", "Shipped 1"]);
    });

    it("reads the admin route, and shows five pills with report counts", async () => {
      asAdmin = true;
      listAnswer = page(ADMIN_REPORTS);
      await openEarlier();
      expect(lists).toEqual([ADMIN_PATH]);
      expect(pills()).toEqual(["All 5", "Open 1", "Needs a decision 1", "Set aside 2", "Shipped 1"]);
      expect(pill("All").getAttribute("aria-pressed")).toBe("true");
    });

    it("gives each row its number, its status word and its comment", async () => {
      asAdmin = true;
      listAnswer = page(ADMIN_REPORTS);
      await openEarlier();
      const items = [...panelOf("Earlier").querySelectorAll("li")];
      expect(items.map((li) => li.querySelector(".fb-earlier-number")?.textContent)).toEqual([
        "#215",
        "#214",
        "#213",
        "#212",
        "#211",
      ]);
      /* The number starts the meta line, so it is the first thing said. */
      expect(items[0]?.querySelector(".fb-earlier-meta")?.textContent?.startsWith("#215 · ")).toBe(true);
      expect(items.map((li) => li.querySelector("[data-status]")?.textContent)).toEqual([
        "Shipped",
        "Needs a decision",
        "Set aside",
        "Set aside",
        "Open",
      ]);
      expect(items.map((li) => li.querySelector("[data-status]")?.getAttribute("data-status"))).toEqual([
        "shipped",
        "waiting",
        "aside",
        "aside",
        "open",
      ]);
      expect(items.map((li) => li.querySelector(".fb-earlier-comment")?.textContent ?? null)).toEqual([
        null,
        "Waiting on you: <b>one</b> switch for both, or one each?",
        "Set aside: the browser gives us no way to do this.",
        null,
        null,
      ]);
      /* Text, never markup: the angle brackets are characters on the page. */
      expect(panelOf("Earlier").querySelector(".fb-earlier-comment b")).toBeNull();
      /* An ignored report with no comment says where it was set aside, and when: ours, not the model's. */
      expect(items[3]?.querySelector(".fb-earlier-note")?.textContent).toMatch(/^Set aside on \/admin\/feedback, .*2026/);
      expect(items[2]?.querySelector(".fb-earlier-note")).toBeNull();
      expect(items[4]?.querySelector(".fb-earlier-note")).toBeNull();
    });

    it("asks the server for a status, and lists only what it answered", async () => {
      asAdmin = true;
      listAnswer = page(ADMIN_REPORTS);
      await openEarlier();
      listAnswer = page({ reports: [ADMIN_REPORTS.reports[1]], more: false, counts: ADMIN_COUNTS, questions: [] });
      click(pill("Needs a decision"));
      await act(async () => {});
      expect(lists).toEqual([ADMIN_PATH, `${ADMIN_PATH}?show=waiting`]);
      expect(pill("Needs a decision").getAttribute("aria-pressed")).toBe("true");
      expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(1);

      listAnswer = page({ reports: [], more: false, counts: { all: 1, open: 0, waiting: 1, aside: 0, shipped: 0 }, questions: [] });
      click(pill("Set aside"));
      await act(async () => {});
      expect(lists.at(-1)).toBe(`${ADMIN_PATH}?show=aside`);
      expect(panelOf("Earlier").textContent).toContain("None of your reports has been set aside.");
    });

    it("falls back to the plain list and three pills when the server has no such route (a 404)", async () => {
      /* New client, old server: after a rollback, or in the minutes of a deploy. */
      asAdmin = true;
      listAnswer = (input) => (input.startsWith(ADMIN_PATH) ? page({ error: "Not found" }, 404)() : page(REPORTS)());
      await openEarlier();
      await act(async () => {});
      expect(lists).toEqual([ADMIN_PATH, "/api/feedback"]);
      expect(pills()).toEqual(["All 2", "Shipped 1", "Not shipped 1"]);
      expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(2);
      expect(panelOf("Earlier").querySelector(".fb-earlier-number")).toBeNull();
      /* And it stays on the plain route for the rest of this opening. */
      click(showButton("Shipped"));
      await act(async () => {});
      expect(lists.at(-1)).toBe("/api/feedback?show=shipped");
      /* The next opening asks the admin route again: the deploy may have finished. */
      const before = lists.length;
      reopen();
      click(tab("Earlier"));
      await act(async () => {});
      await act(async () => {});
      expect(lists.slice(before)).toEqual([ADMIN_PATH, "/api/feedback"]);
    });

    it.each([403, 500])("does not fall back on a %s: it says the list would not load", async (status) => {
      asAdmin = true;
      listAnswer = page({ error: "no" }, status);
      await openEarlier();
      await act(async () => {});
      expect(lists).toEqual([ADMIN_PATH]);
      expect(panelOf("Earlier").textContent).toContain("[fb-list]");
      expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(0);
    });

    it.each([
      ["the plain route's shape", REPORTS],
      ["counts that do not sum to All", { ...ADMIN_REPORTS, counts: { ...ADMIN_COUNTS, all: 6 } }],
      ["a status it does not know", { ...ADMIN_REPORTS, reports: [{ ...ADMIN_REPORTS.reports[0], status: "deferred" }, ...ADMIN_REPORTS.reports.slice(1)] }],
      ["a number that is not a positive integer", { ...ADMIN_REPORTS, reports: [{ ...ADMIN_REPORTS.reports[0], number: 0 }, ...ADMIN_REPORTS.reports.slice(1)] }],
      ["the same number twice", { ...ADMIN_REPORTS, reports: [{ ...ADMIN_REPORTS.reports[0], number: 214 }, ...ADMIN_REPORTS.reports.slice(1)] }],
      ["a comment that is not text", { ...ADMIN_REPORTS, reports: [{ ...ADMIN_REPORTS.reports[0], comment: { html: "x" } }, ...ADMIN_REPORTS.reports.slice(1)] }],
      ["a comment over the cap", { ...ADMIN_REPORTS, reports: [{ ...ADMIN_REPORTS.reports[0], comment: "x".repeat(241) }, ...ADMIN_REPORTS.reports.slice(1)] }],
      ["more rows of a status than its count", { ...ADMIN_REPORTS, counts: { all: 5, open: 2, waiting: 1, aside: 1, shipped: 1 } }],
      ["a mark that is not a time", { ...ADMIN_REPORTS, reports: [{ ...ADMIN_REPORTS.reports[0], ignoredAt: "yesterday" }, ...ADMIN_REPORTS.reports.slice(1)] }],
    ])("refuses an admin answer with %s: the failure sentence and Try again, no rows", async (_case, body) => {
      asAdmin = true;
      listAnswer = page(body);
      await openEarlier();
      expect(panelOf("Earlier").textContent).toContain("[fb-list]");
      expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(0);
      expect([...panelOf("Earlier").querySelectorAll("button")].map((b) => b.textContent)).toContain("Try again");
    });

    it("refuses a row of another status in a filtered answer", async () => {
      asAdmin = true;
      listAnswer = page(ADMIN_REPORTS);
      await openEarlier();
      listAnswer = page({ reports: [ADMIN_REPORTS.reports[0]], more: false, counts: ADMIN_COUNTS, questions: [] });
      click(pill("Open"));
      await act(async () => {});
      expect(panelOf("Earlier").textContent).toContain("[fb-list]");
    });

    /* Stage 2 of 261007d: an agent's questions, at the top of Needs a decision,
       each with a box to reply in. */
    describe("questions an agent has asked", () => {
      const ANSWERS_PATH = "/api/admin/feedback/answers";
      const Q1 = {
        id: "q-aaaaaa",
        title: "One switch or two?",
        body: "Background first.\n\nA. One <b>switch</b>.\nB. Two.",
        asked: "2026-10-05",
        report: { id: "spya-a2b2c3", number: 214, firstLine: "One switch or two?" },
        answer: null,
      };
      const Q2 = {
        id: "q-bbbbbb",
        title: "A question about nothing filed",
        body: "It stands alone.",
        asked: "2026-10-06",
        report: null,
        answer: null,
      };
      const WITH_QUESTIONS = { ...ADMIN_REPORTS, questions: [Q1, Q2] };
      const WAITING = { reports: [ADMIN_REPORTS.reports[1]], more: false, counts: ADMIN_COUNTS, questions: [Q1, Q2] };
      const questionsBox = () => panelOf("Earlier").querySelector<HTMLElement>(".fb-questions");
      const cards = () => [...panelOf("Earlier").querySelectorAll<HTMLElement>(".fb-question")];
      const card = (id: string) => {
        const found = cards().find((one) => one.dataset.question === id);
        if (!found) throw new Error(`no question ${id}`);
        return found;
      };
      const button = (within: Element, name: string) => {
        const found = [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === name);
        if (!found) throw new Error(`no ${name} button`);
        return found;
      };
      const replyBoxes = () => [...panelOf("Earlier").querySelectorAll<HTMLTextAreaElement>("textarea.fb-reply-input")];
      function typeReply(text: string) {
        const box = replyBoxes()[0];
        if (!box) throw new Error("no reply box");
        act(() => {
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
          box.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      const sent = (index: number) => JSON.parse(String(posts[index]?.init.body)) as Record<string, unknown>;
      const stored = (status: number, createdAt = "2026-10-07T09:00:00.000Z") => async () => {
        const last = JSON.parse(String(posts.at(-1)?.init.body)) as { id: string; body: string };
        return new Response(JSON.stringify({ answer: { id: last.id, body: last.body, createdAt } }), { status });
      };
      async function openWaiting(body: unknown = WITH_QUESTIONS, waiting: unknown = WAITING) {
        asAdmin = true;
        listAnswer = page(body);
        await openEarlier();
        listAnswer = page(waiting);
        click(pill("Needs a decision"));
        await act(async () => {});
      }
      beforeEach(() => {
        replyMic.armed = false;
        replyMic.transcribing = false;
        replyMicToggles.length = 0;
        replyMicUses.length = 0;
        replyMicDone = undefined;
      });

      it("says how many are open beside the pill in every view, and draws them only in Needs a decision", async () => {
        asAdmin = true;
        listAnswer = page(WITH_QUESTIONS);
        await openEarlier();
        /* In All: counted on the pill, after its report count, and not drawn. */
        expect(pills()).toContain("Needs a decision 1 · 2 open questions");
        expect(questionsBox()?.hidden ?? true).toBe(true);
        expect(panelOf("Earlier").querySelectorAll(".fb-earlier-list > li")).toHaveLength(5);

        listAnswer = page(WAITING);
        click(pill("Needs a decision"));
        await act(async () => {});
        expect(questionsBox()?.hidden).toBe(false);
        expect(cards().map((one) => one.dataset.question)).toEqual(["q-aaaaaa", "q-bbbbbb"]);
        /* First: the questions come before the list of reports in the panel. */
        const list = panelOf("Earlier").querySelector(".fb-earlier-list");
        expect(questionsBox()?.compareDocumentPosition(list as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        /* The report count on the pill is still the report count. */
        expect(pills()).toContain("Needs a decision 1 · 2 open questions");
        expect(panelOf("Earlier").querySelectorAll(".fb-earlier-list > li")).toHaveLength(1);
      });

      it("says one question in the singular, and nothing on the pill when there are none", async () => {
        asAdmin = true;
        listAnswer = page({ ...ADMIN_REPORTS, questions: [Q2] });
        await openEarlier();
        expect(pills()).toContain("Needs a decision 1 · 1 open question");
        reopen();
        listAnswer = page(ADMIN_REPORTS);
        click(tab("Earlier"));
        await act(async () => {});
        expect(pills()).toContain("Needs a decision 1");
        expect(cards()).toHaveLength(0);
      });

      it("shows each under its title, with the linked report's number and first line when it has one", async () => {
        await openWaiting();
        expect(card("q-aaaaaa").querySelector(".fb-question-title")?.textContent).toBe("One switch or two?");
        expect(card("q-aaaaaa").querySelector(".fb-earlier-number")?.textContent).toBe("#214");
        expect(card("q-aaaaaa").querySelector(".fb-question-report-line")?.textContent).toBe("One switch or two?");
        expect(card("q-bbbbbb").querySelector(".fb-earlier-number")).toBeNull();
        /* Text, never markup, with the lines kept by CSS: the tag is characters. */
        expect(card("q-aaaaaa").querySelector(".fb-question-text")?.textContent).toBe(Q1.body);
        expect(card("q-aaaaaa").querySelector(".fb-question-text b")).toBeNull();
      });

      it("shows questions even when no report needs a decision", async () => {
        await openWaiting(WITH_QUESTIONS, {
          reports: [],
          more: false,
          counts: { all: 4, open: 1, waiting: 0, aside: 2, shipped: 1 },
          questions: [Q1, Q2],
        });
        expect(cards()).toHaveLength(2);
        expect(panelOf("Earlier").textContent).toContain("None of your reports needs a decision.");
      });

      it("opens one reply box at a time: the others show Reply", async () => {
        await openWaiting();
        expect(replyBoxes()).toHaveLength(0);
        click(button(card("q-aaaaaa"), "Reply"));
        expect(replyBoxes()).toHaveLength(1);
        expect(card("q-aaaaaa").querySelector("textarea.fb-reply-input")).not.toBeNull();
        typeReply("half a thought");
        click(button(card("q-bbbbbb"), "Reply"));
        expect(replyBoxes()).toHaveLength(1);
        expect(card("q-bbbbbb").querySelector("textarea.fb-reply-input")).not.toBeNull();
        expect(button(card("q-aaaaaa"), "Reply")).toBeTruthy();
        /* And the first box's words were kept for when it is opened again. */
        click(button(card("q-aaaaaa"), "Reply"));
        expect(replyBoxes()[0]?.value).toBe("half a thought");
      });

      it("posts a reply with a minted id, then shows Answered, the words, and Reply again", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        typeReply("  1A, and do B later  ");
        answer = stored(201);
        click(button(card("q-aaaaaa"), "Send reply"));
        await act(async () => {});

        expect(posts).toHaveLength(1);
        expect(posts[0]?.input).toBe(ANSWERS_PATH);
        expect(posts[0]?.init.method).toBe("POST");
        expect(Object.keys(sent(0)).sort()).toEqual(["body", "id", "question"]);
        expect(sent(0)).toMatchObject({ question: "q-aaaaaa", body: "1A, and do B later" });
        expect(isSpideryarnId(sent(0).id as string)).toBe(true);

        expect(replyBoxes()).toHaveLength(0);
        const answered = card("q-aaaaaa").querySelector(".fb-question-answer");
        expect(answered?.textContent).toContain("Answered");
        expect(answered?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-07T09:00:00.000Z");
        expect(answered?.querySelector(".fb-question-answer-body")?.textContent).toBe("1A, and do B later");
        expect(button(card("q-aaaaaa"), "Reply again")).toBeTruthy();
        /* The other question is untouched. */
        expect(card("q-bbbbbb").querySelector(".fb-question-answer")).toBeNull();

        /* Reply again: an empty box, and a second reply under a new id. */
        click(button(card("q-aaaaaa"), "Reply again"));
        expect(replyBoxes()[0]?.value).toBe("");
        typeReply("one more thing");
        click(button(card("q-aaaaaa"), "Send reply"));
        await act(async () => {});
        expect(posts).toHaveLength(2);
        expect(sent(1).id).not.toBe(sent(0).id);
        expect(card("q-aaaaaa").querySelector(".fb-question-answer-body")?.textContent).toBe("one more thing");
      });

      it("shows the server's stored reply as Answered when the tab is opened later", async () => {
        const answered = { ...Q1, answer: { id: "spya-a9b2c3", body: "<i>Two</i>, please.\nBoth.", createdAt: "2026-10-06T18:30:00.000Z" } };
        await openWaiting({ ...ADMIN_REPORTS, questions: [answered, Q2] }, { ...WAITING, questions: [answered, Q2] });
        const shown = card("q-aaaaaa").querySelector(".fb-question-answer");
        expect(shown?.querySelector(".fb-question-answer-body")?.textContent).toBe("<i>Two</i>, please.\nBoth.");
        expect(shown?.querySelector("i")).toBeNull();
        expect(button(card("q-aaaaaa"), "Reply again")).toBeTruthy();
        expect(button(card("q-bbbbbb"), "Reply")).toBeTruthy();
      });

      it("keeps the words when the send fails, and a retry of the same words carries the same id", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        typeReply("1A");
        answer = ok(500);
        click(button(card("q-aaaaaa"), "Send reply"));
        await act(async () => {});
        expect(replyBoxes()[0]?.value).toBe("1A");
        expect(card("q-aaaaaa").textContent).toContain("[fb-reply]");
        expect(card("q-aaaaaa").querySelector(".fb-question-answer")).toBeNull();

        answer = stored(200);
        click(button(card("q-aaaaaa"), "Send reply"));
        await act(async () => {});
        expect(posts).toHaveLength(2);
        expect(sent(1).id).toBe(sent(0).id);
        /* A 200 is the stored row of the first try: answered, like a 201. */
        expect(card("q-aaaaaa").querySelector(".fb-question-answer-body")?.textContent).toBe("1A");
        expect(card("q-aaaaaa").textContent).not.toContain("[fb-reply]");
      });

      it("gives edited words a new id after a failed send, so the server never sees one id with two bodies", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        typeReply("1A");
        answer = async () => {
          throw new Error("offline");
        };
        click(button(card("q-aaaaaa"), "Send reply"));
        await act(async () => {});
        expect(card("q-aaaaaa").textContent).toContain("[fb-reply]");
        typeReply("1B, on reflection");
        answer = stored(201);
        click(button(card("q-aaaaaa"), "Send reply"));
        await act(async () => {});
        expect(sent(1).id).not.toBe(sent(0).id);
      });

      it("says to reload when the server has no such route (a 404), and keeps the words", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        typeReply("1A, typed at length");
        answer = ok(404);
        click(button(card("q-aaaaaa"), "Send reply"));
        await act(async () => {});
        expect(replyBoxes()[0]?.value).toBe("1A, typed at length");
        expect(card("q-aaaaaa").textContent).toContain("[fb-reply-stale]");
        expect(card("q-aaaaaa").textContent).toMatch(/reload/i);
      });

      it("treats a 2xx without a well-formed reply in it as not sent", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        typeReply("1A");
        answer = ok(201);
        click(button(card("q-aaaaaa"), "Send reply"));
        await act(async () => {});
        expect(card("q-aaaaaa").textContent).toContain("[fb-reply]");
        expect(replyBoxes()[0]?.value).toBe("1A");
      });

      it("treats a well-formed receipt for different words as not sent", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        typeReply("1A");
        answer = async () => {
          const request = sent(0);
          return new Response(
            JSON.stringify({ answer: { id: request.id, body: "different words", createdAt: "2026-10-07T09:00:00.000Z" } }),
            { status: 201 },
          );
        };
        click(button(card("q-aaaaaa"), "Send reply"));
        await act(async () => {});
        expect(card("q-aaaaaa").textContent).toContain("[fb-reply]");
        expect(replyBoxes()[0]?.value).toBe("1A");
        expect(card("q-aaaaaa").querySelector(".fb-question-answer")).toBeNull();
      });

      it("sends nothing empty, nothing over the cap, and one reply for two presses", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        expect(button(card("q-aaaaaa"), "Send reply").disabled).toBe(true);
        typeReply("   ");
        expect(button(card("q-aaaaaa"), "Send reply").disabled).toBe(true);
        typeReply("x".repeat(MAX_FEEDBACK_ANSWER_CHARS + 1));
        expect(button(card("q-aaaaaa"), "Send reply").disabled).toBe(true);
        expect(card("q-aaaaaa").textContent).toContain(`the limit is ${MAX_FEEDBACK_ANSWER_CHARS}`);
        typeReply("1A");
        let release: (() => void) | null = null;
        answer = () =>
          new Promise((resolve) => {
            release = () => resolve(new Response(JSON.stringify({ answer: { id: sent(0).id, body: "1A", createdAt: "2026-10-07T09:00:00.000Z" } }), { status: 201 }));
          });
        const sendButton = button(card("q-aaaaaa"), "Send reply");
        click(sendButton);
        click(sendButton);
        expect(posts).toHaveLength(1);
        await act(async () => release?.());
        expect(card("q-aaaaaa").querySelector(".fb-question-answer")).not.toBeNull();
      });

      it("gives the reply box its own microphone: its own keeper, off the article, and Send off while it is busy", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        expect(card("q-aaaaaa").querySelector(".mock-mic")).not.toBeNull();
        expect(replyMicUses.at(-1)).toEqual({ keep: "feedback-reply", doneKey: "reply:q-aaaaaa", context: { kind: "profile" } });
        typeReply("said out loud");
        expect(button(card("q-aaaaaa"), "Send reply").disabled).toBe(false);

        replyMic.armed = true;
        typeReply("said out loud.");
        expect(button(card("q-aaaaaa"), "Send reply").disabled).toBe(true);
        /* And the guard is the function's too: a double press on Stop asks it directly. */
        act(() => replyMicDone?.());
        await act(async () => {});
        expect(posts).toHaveLength(0);

        replyMic.armed = false;
        replyMic.transcribing = true;
        typeReply("said out loud");
        expect(button(card("q-aaaaaa"), "Send reply").disabled).toBe(true);
        expect(replyBoxes()[0]?.readOnly).toBe(true);

        /* Not busy: a double press on Stop sends, as the button would. */
        replyMic.transcribing = false;
        typeReply("said out loud, done");
        answer = stored(201);
        act(() => replyMicDone?.());
        await act(async () => {});
        expect(posts).toHaveLength(1);
        expect(sent(0).body).toBe("said out loud, done");
      });

      it("stops the reply box's microphone on the way to Write, and when the dialog is shut", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        replyMic.armed = true;
        typeReply("talking");
        replyMicToggles.length = 0;
        micToggles.length = 0;
        click(tab("Write"));
        /* The hook's own toggle (a stop that keeps the words), never the field's, which would refocus a hidden box. */
        expect(replyMicToggles).toEqual(["hook"]);
        expect(micToggles, "the Write box's microphone is a different one").toEqual([]);
        /* Hidden, it no longer offers a kept recording or takes a double press. */
        expect(replyMicUses.at(-1)).toMatchObject({ keep: null, doneKey: "reply:hidden" });

        click(tab("Earlier"));
        replyMicToggles.length = 0;
        show(false);
        expect(replyMicToggles).toEqual(["hook"]);
      });

      it("leaves the reply box's microphone alone while the box is showing", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        replyMic.armed = true;
        typeReply("talking");
        expect(replyMicToggles).toEqual([]);
      });

      it("holds the page against a reload while a reply is half-written", async () => {
        await openWaiting();
        expect(reloadVeto()).toBeNull();
        click(button(card("q-aaaaaa"), "Reply"));
        typeReply("half a reply");
        expect(reloadVeto()).not.toBeNull();
        answer = stored(201);
        click(button(card("q-aaaaaa"), "Send reply"));
        await act(async () => {});
        expect(reloadVeto()).toBeNull();
      });

      it("keeps a draft reachable when a refreshed question list no longer contains it", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        typeReply("a decision in progress");

        show(false);
        listAnswer = page({ ...WITH_QUESTIONS, questions: [Q2] });
        show(true);
        click(tab("Earlier"));
        await act(async () => {});
        listAnswer = page({ ...WAITING, questions: [Q2] });
        click(pill("Needs a decision"));
        await act(async () => {});

        expect(card("q-aaaaaa").querySelector<HTMLTextAreaElement>("textarea.fb-reply-input")?.value).toBe(
          "a decision in progress",
        );
        expect(pills()).toContain("Needs a decision 1 · 1 open question");
        expect(questionsBox()?.querySelector(".fb-questions-heading")?.textContent).toBe("2 questions for you");
      });

      it("keeps the reply box mounted while closing during transcription", async () => {
        await openWaiting();
        click(button(card("q-aaaaaa"), "Reply"));
        replyMic.transcribing = true;
        show(true);
        expect(replyBoxes()[0]?.readOnly).toBe(true);

        show(false);

        expect(replyBoxes()).toHaveLength(1);
        expect(questionsBox()?.hidden).toBe(true);
      });

      it.each([
        ["no questions key at all", (({ questions: _dropped, ...rest }) => rest)(WITH_QUESTIONS)],
        ["questions that are not a list", { ...WITH_QUESTIONS, questions: {} }],
        ["a question id of the wrong shape", { ...WITH_QUESTIONS, questions: [{ ...Q1, id: "spya-a2b2c3" }] }],
        ["the same question twice", { ...WITH_QUESTIONS, questions: [Q1, Q1] }],
        ["a title that is not text", { ...WITH_QUESTIONS, questions: [{ ...Q1, title: { html: "x" } }] }],
        ["a title over the cap", { ...WITH_QUESTIONS, questions: [{ ...Q1, title: "x".repeat(121) }] }],
        ["a body over the cap", { ...WITH_QUESTIONS, questions: [{ ...Q1, body: "x".repeat(4001) }] }],
        ["a date that is not one", { ...WITH_QUESTIONS, questions: [{ ...Q1, asked: "last week" }] }],
        ["a linked report without a number", { ...WITH_QUESTIONS, questions: [{ ...Q1, report: { id: "spya-a2b2c3", firstLine: "x" } }] }],
        ["a reply that is not text", { ...WITH_QUESTIONS, questions: [{ ...Q1, answer: { id: "spya-a9b2c3", body: 7, createdAt: "2026-10-06T18:30:00.000Z" } }] }],
        ["a reply with no time", { ...WITH_QUESTIONS, questions: [{ ...Q1, answer: { id: "spya-a9b2c3", body: "x", createdAt: "soon" } }] }],
        ["an agent-only field on a question", { ...WITH_QUESTIONS, questions: [{ ...Q1, refs: "qi-8qvg5gwv" }] }],
      ])("refuses an admin answer with %s: the failure sentence, no rows and no questions", async (_case, body) => {
        asAdmin = true;
        listAnswer = page(body);
        await openEarlier();
        expect(panelOf("Earlier").textContent).toContain("[fb-list]");
        expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(0);
        expect(pills().join(" ")).not.toContain("open question");
      });

      it("shows no questions to a reader who is not an admin, whatever the answer carries", async () => {
        asAdmin = false;
        listAnswer = page({ ...REPORTS, questions: [Q1] });
        await openEarlier();
        expect(lists).toEqual(["/api/feedback"]);
        expect(cards()).toHaveLength(0);
        expect(pills().join(" ")).not.toContain("open question");
      });
    });

    it("changes nothing for a reader who is not an admin: the plain route, three pills, no number", async () => {
      asAdmin = false;
      listAnswer = page(REPORTS);
      await openEarlier();
      expect(lists).toEqual(["/api/feedback"]);
      expect(pills()).toEqual(["All 2", "Shipped 1", "Not shipped 1"]);
      expect(panelOf("Earlier").querySelector(".fb-earlier-number")).toBeNull();
      expect(panelOf("Earlier").querySelector(".fb-earlier-comment")).toBeNull();
      expect(panelOf("Earlier").querySelector("[data-status]")).toBeNull();
      /* And a 404 there is a failure, as it always was: there is nothing to fall back to. */
    });
  });

  it("marks a shipped report, and only that one", async () => {
    listAnswer = page(REPORTS);
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    const items = [...panelOf("Earlier").querySelectorAll("li")];
    expect(items[0]?.querySelector(".fb-earlier-shipped")?.textContent).toBe("Shipped");
    expect(items[0]?.querySelector(".fb-earlier-shipped")?.getAttribute("title")).toContain(
      "in the version of Spideryarn you're using",
    );
    expect(items[1]?.querySelector(".fb-earlier-shipped")).toBeNull();
  });

  /* spya-yvwpek, Greg 2026-09-30: "remove the text that says 'A rough note is
     worth far more than nothing'". Here because the Write panel is mounted. */
  it("no longer says a rough note is worth more than nothing", async () => {
    mount();
    await act(async () => {});
    expect(panelOf("Write").textContent).toContain("Thank you");
    expect(host.textContent).not.toContain("rough note");
  });

  /* spya-d9xdhs, Greg 2026-09-30: "can we include the exact timestamp and maybe
     a human-readable `3d ago` or `3h ago`?" Past relative-time.ts's 30-day
     threshold the relative half goes and the exact time stands alone. */
  it("dates each report exactly, and says how long ago while that is still relative", async () => {
    const now = Date.parse("2026-09-15T10:45:00.000Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      listAnswer = page({
        reports: [
          { ...REPORTS.reports[0], createdAt: "2026-09-12T10:45:00.000Z" },
          { ...REPORTS.reports[1], createdAt: "2026-07-01T08:00:00.000Z" },
        ],
        more: false,
        counts: COUNTS,
      });
      mount();
      click(tab("Earlier"));
      await act(async () => {});
      const times = [...panelOf("Earlier").querySelectorAll("li time")];
      expect(times[0]?.textContent).toBe(`${exactly("2026-09-12T10:45:00.000Z")} · 3d ago`);
      /* Not only "whatever `exactly` says": a time of day, which the date
         alone this replaced did not have. */
      expect(times[0]?.textContent).toMatch(/\d{1,2}:\d{2}/);
      expect(times[0]?.getAttribute("dateTime")).toBe("2026-09-12T10:45:00.000Z");
      expect(times[1]?.textContent).toBe(exactly("2026-07-01T08:00:00.000Z"));
    } finally {
      clock.mockRestore();
    }
  });

  /* SPIDERYARN-READING2-7D: "In Feedback / Earlier / All, add the indicator
     for whether each suggestion has shipped or not." An absence is not an
     indicator, so in All a not-shipped row says so. */
  it("in All, says Not shipped on every row that has not shipped", async () => {
    listAnswer = page(REPORTS);
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    const items = [...panelOf("Earlier").querySelectorAll("li")];
    expect(items[0]?.querySelector(".fb-earlier-unshipped")).toBeNull();
    const unshipped = items[1]?.querySelector(".fb-earlier-unshipped");
    expect(unshipped?.textContent).toBe("Not shipped");
    expect(unshipped?.getAttribute("title")).toContain("isn't marked as shipped");
    expect(items[1]?.querySelector(".fb-earlier-meta")?.textContent).toContain(" · Not shipped");
  });

  it("does not repeat Not shipped on every row of the Not shipped filter", async () => {
    listAnswer = page(REPORTS);
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    listAnswer = page({ reports: [REPORTS.reports[1]], more: false, counts: COUNTS });
    click(showButton("Not shipped"));
    await act(async () => {});
    const items = [...panelOf("Earlier").querySelectorAll("li")];
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("The shelf is slow.");
    expect(items[0]?.querySelector(".fb-earlier-unshipped")).toBeNull();
  });

  it("refuses a report without a shipped flag as the wrong shape", async () => {
    const { shipped: _dropped, ...withoutFlag } = REPORTS.reports[0] ?? { shipped: true };
    listAnswer = page({ reports: [withoutFlag], more: false, counts: COUNTS });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("[fb-list]");
  });

  /* spya-y4upzw: the address always went with a report; this is where the
     reader can see that it did.
     docs/plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md. */
  it("says which page each report was filed from, and nothing for a report with none", async () => {
    listAnswer = page(REPORTS);
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    const items = [...panelOf("Earlier").querySelectorAll("li")];
    expect(items[0]?.querySelector(".fb-earlier-page")?.textContent).toBe("/read/why-trees-spya-k3m9qt");
    expect(items[0]?.querySelector(".fb-earlier-meta")?.textContent).toContain(
      " · Suggestion · on /read/why-trees-spya-k3m9qt · Shipped",
    );
    /* A link since spya-tqk7au ("Make it a link"): to the page, and to the
       paragraph the report was filed at (261006b), which the text leaves out. */
    const link = items[0]?.querySelector("a.fb-earlier-page");
    expect(link?.getAttribute("href")).toBe("/read/why-trees-spya-k3m9qt?at=spya-tgnssb");
    expect(items[1]?.querySelector(".fb-earlier-meta a")).toBeNull();
    expect(items[1]?.querySelector(".fb-earlier-page")).toBeNull();
    expect(items[1]?.querySelector(".fb-earlier-meta")?.textContent).not.toContain(" on ");
  });

  it("reads an old server's row without page as a report with no page label", async () => {
    const report = REPORTS.reports[0];
    if (!report) throw new Error("the fixture has no report");
    /* A server that old has no `at` either (261006b). */
    const { page: _dropped, at: _alsoDropped, ...withoutPage } = report;
    listAnswer = page({ reports: [withoutPage], more: false, counts: { all: 1, shipped: 1, unshipped: 0 } });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain(withoutPage.body);
    expect(panelOf("Earlier").querySelector(".fb-earlier-page")).toBeNull();
    expect(panelOf("Earlier").textContent).not.toContain("[fb-list]");
  });

  /* docs/plans/261006b-earlier-link-carries-the-paragraph.md. */
  it("links to the bare page when the report has no paragraph", async () => {
    listAnswer = page({
      reports: [{ ...REPORTS.reports[0], at: null }],
      more: false,
      counts: { all: 1, shipped: 1, unshipped: 0 },
    });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").querySelector("a.fb-earlier-page")?.getAttribute("href")).toBe(
      "/read/why-trees-spya-k3m9qt",
    );
  });

  it("reads an old server's row without at as a report with no paragraph", async () => {
    const report = REPORTS.reports[0];
    if (!report) throw new Error("the fixture has no report");
    const { at: _dropped, ...withoutAt } = report;
    listAnswer = page({ reports: [withoutAt], more: false, counts: { all: 1, shipped: 1, unshipped: 0 } });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).not.toContain("[fb-list]");
    expect(panelOf("Earlier").querySelector("a.fb-earlier-page")?.getAttribute("href")).toBe(
      "/read/why-trees-spya-k3m9qt",
    );
  });

  /* The second line, as for the path: the server sends a block id or null
     (src/feedback-page.ts), and anything else fails the answer instead of
     becoming part of a link. */
  it.each([
    "spya-tgnssb&mode=search",
    "spya-tgnssb#x",
    "spya-tgnssb0",
    "SPYA-TGNSSB",
    "private words",
    "",
    7,
    { id: "spya-tgnssb" },
  ])("refuses an at that is not a block id: %j", async (bad) => {
    listAnswer = page({
      reports: [{ ...REPORTS.reports[0], at: bad }],
      more: false,
      counts: { all: 1, shipped: 1, unshipped: 0 },
    });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("[fb-list]");
    expect(panelOf("Earlier").querySelector("a.fb-earlier-page")).toBeNull();
  });

  it("refuses a paragraph on a report with no page to be at", async () => {
    listAnswer = page({
      reports: [{ ...REPORTS.reports[0], page: null }],
      more: false,
      counts: { all: 1, shipped: 1, unshipped: 0 },
    });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("[fb-list]");
  });

  it("still refuses a present malformed page", async () => {
    listAnswer = page({
      reports: [{ ...REPORTS.reports[0], page: { path: "/read/not-text" } }],
      more: false,
      counts: { all: 1, shipped: 1, unshipped: 0 },
    });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("[fb-list]");
  });

  /* The label is an href now, so only a path on this origin may be one. The
     server sends nothing else (src/feedback-page.ts); this is the second line. */
  it.each([
    "https://elsewhere.example/read/x",
    "//elsewhere.example/read/x",
    "/\\elsewhere.example/read/x",
    /* A browser drops a tab or a newline before resolving, so these are `//host` too. */
    "/\t/elsewhere.example/read/x",
    "/\n/elsewhere.example/read/x",
    "/read/x\\..\\y",
    "/read/x?mode=search",
    "/read/x#spya-tgnssb",
    "javascript:alert(1)",
    "read/x",
    "",
  ])("refuses a page that is not a path on this site: %j", async (bad) => {
    listAnswer = page({
      reports: [{ ...REPORTS.reports[0], page: bad }],
      more: false,
      counts: { all: 1, shipped: 1, unshipped: 0 },
    });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("[fb-list]");
    expect(panelOf("Earlier").querySelector("a.fb-earlier-page")).toBeNull();
  });

  it("follows a page in the app, closes the dialog, and keeps an unsent Write draft", async () => {
    listAnswer = page(REPORTS);
    const harness = mountControlledHarness();
    type("Still writing this report.");
    click(tab("Earlier"));
    await act(async () => {});
    const link = panelOf("Earlier").querySelector("a.fb-earlier-page");
    if (!link) throw new Error("no page link");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => link.dispatchEvent(event));
    expect(event.defaultPrevented, "a document navigation would discard the draft").toBe(true);
    expect(navigate).toHaveBeenCalledWith("/read/why-trees-spya-k3m9qt?at=spya-tgnssb");
    expect(harness.dialog.open).toBe(false);
    harness.show(true);
    expect(firstBox().value).toBe("Still writing this report.");
    expect(posts).toHaveLength(0);
  });

  /* GPT Sol's plan review of 261006b, P1-F1: `navigate` scrolls to the top, and
     the reading view only moves to `?at=` when it *changes*. So following a
     link to the paragraph the reader is already at, with anything else in the
     address different, landed them at the top of the article. */
  describe("when the reader is already on that page at that paragraph", () => {
    const before = location.pathname + location.search;
    afterEach(() => history.replaceState(null, "", before));

    it.each([
      "/read/why-trees-spya-k3m9qt",
      "/read/why-trees-spya-k3m9qt/",
      "/read/%77hy-trees-spya-k3m9qt",
    ])("closes the dialog and leaves the page where it is at %s", async (path) => {
      history.replaceState(null, "", `${path}?mode=glossary&at=spya-tgnssb`);
      listAnswer = page(REPORTS);
      const harness = mountControlledHarness();
      click(tab("Earlier"));
      await act(async () => {});
      const link = panelOf("Earlier").querySelector("a.fb-earlier-page");
      if (!link) throw new Error("no page link");
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      act(() => link.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
      expect(harness.dialog.open).toBe(false);
    });

    it.each([
      ["another paragraph", "/read/why-trees-spya-k3m9qt?at=spya-k3m9qt"],
      ["no paragraph", "/read/why-trees-spya-k3m9qt"],
      ["another article", "/read/another-piece?at=spya-tgnssb"],
      ["the article's metadata page", "/read/why-trees-spya-k3m9qt/metadata?at=spya-tgnssb"],
    ])("still follows the link from %s", async (_name, here) => {
      history.replaceState(null, "", here);
      listAnswer = page(REPORTS);
      mountControlledHarness();
      click(tab("Earlier"));
      await act(async () => {});
      const link = panelOf("Earlier").querySelector("a.fb-earlier-page");
      if (!link) throw new Error("no page link");
      act(() => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
      expect(navigate).toHaveBeenCalledWith("/read/why-trees-spya-k3m9qt?at=spya-tgnssb");
    });
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"])("leaves a %s page activation to the browser and keeps the dialog open", async (modifier) => {
    listAnswer = page(REPORTS);
    const dialog = mountControlled();
    click(tab("Earlier"));
    await act(async () => {});
    const link = panelOf("Earlier").querySelector("a.fb-earlier-page");
    if (!link) throw new Error("no page link");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true });
    // Suppress jsdom's unimplemented navigation after observing the handler.
    let prevented = true;
    document.addEventListener("click", (e) => {
      prevented = e.defaultPrevented;
      e.preventDefault();
    }, { once: true });
    act(() => link.dispatchEvent(event));
    expect(prevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it("filters on the server, one read per filter per opening, and starts on All", async () => {
    listAnswer = page(REPORTS);
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(showButton("All").getAttribute("aria-pressed")).toBe("true");
    for (const b of panelOf("Earlier").querySelectorAll(".fb-show-button")) {
      expect(b.getAttribute("type")).toBe("button");
    }

    listAnswer = page({ reports: [], more: false, counts: NONE });
    click(showButton("Shipped"));
    await act(async () => {});
    expect(lists).toEqual(["/api/feedback", "/api/feedback?show=shipped"]);
    expect(showButton("Shipped").getAttribute("aria-pressed")).toBe("true");
    expect(panelOf("Earlier").textContent).toContain("None of your reports has a shipped change yet.");

    click(showButton("Not shipped"));
    await act(async () => {});
    expect(lists.at(-1)).toBe("/api/feedback?show=unshipped");
    expect(panelOf("Earlier").textContent).toContain("Every report you've sent has a shipped change.");

    /* Back to All: the answer already held, not a fourth read. */
    click(showButton("All"));
    await act(async () => {});
    expect(lists).toHaveLength(3);
    expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(2);

    reopen();
    listAnswer = page(REPORTS);
    click(tab("Earlier"));
    await act(async () => {});
    expect(showButton("All").getAttribute("aria-pressed"), "a new opening is back on All").toBe("true");
    expect(lists.at(-1)).toBe("/api/feedback");
  });

  it("files a late answer under the filter that asked, never over the one showing", async () => {
    listAnswer = page(REPORTS);
    mount();
    click(tab("Earlier"));
    await act(async () => {});

    let settleShipped: ((res: Response) => void) | null = null;
    listAnswer = () => new Promise<Response>((resolve) => (settleShipped = resolve));
    click(showButton("Shipped"));
    await act(async () => {});

    listAnswer = page({ reports: [], more: false, counts: NONE });
    click(showButton("Not shipped"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("Every report you've sent has a shipped change.");

    const onlyShipped = { reports: [REPORTS.reports[0]], more: false, counts: COUNTS };
    await act(async () => {
      settleShipped?.(new Response(JSON.stringify(onlyShipped), { status: 200 }));
    });
    expect(panelOf("Earlier").textContent, "Not shipped is still what shows").toContain(
      "Every report you've sent has a shipped change.",
    );
    expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(0);

    click(showButton("Shipped"));
    await act(async () => {});
    expect(lists, "Shipped's late answer was kept, so no second read").toHaveLength(3);
    expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(1);
  });

  it("drops an answer that lands after the dialog shut", async () => {
    let settle: ((res: Response) => void) | null = null;
    listAnswer = () => new Promise<Response>((resolve) => (settle = resolve));
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    reopen();
    await act(async () => {
      settle?.(new Response(JSON.stringify(REPORTS), { status: 200 }));
    });
    listAnswer = page({ reports: [], more: false, counts: NONE });
    click(tab("Earlier"));
    await act(async () => {});
    expect(lists, "the new opening read afresh").toHaveLength(2);
    expect(panelOf("Earlier").textContent).toContain("You haven't sent us any feedback yet.");
  });

  it("starts on Write, and lists the reader's own reports when Earlier is chosen", async () => {
    listAnswer = page(REPORTS);
    mount();
    expect(tab("Write").getAttribute("aria-selected")).toBe("true");
    expect(lists, "nothing is read until the tab is chosen").toEqual([]);

    click(tab("Earlier"));
    await act(async () => {});

    expect(lists).toEqual(["/api/feedback"]);
    expect(tab("Earlier").getAttribute("aria-selected")).toBe("true");
    const items = [...panelOf("Earlier").querySelectorAll("li")];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("A tab of what I sent before.");
    expect(items[0]?.textContent).toContain("Suggestion");
    expect(items[1]?.textContent).toContain("The shelf is slow.");
    /* Neither kind, and it says nothing about one rather than inventing it. */
    expect(items[1]?.textContent).not.toMatch(/Problem|Suggestion/);
    expect(items[0]?.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-12T10:45:00.000Z");
    expect(panelOf("Earlier").hidden).toBe(false);
    expect(panelOf("Write").hidden, "the Write panel is still showing").toBe(true);
  });

  it("says so when there is nothing yet", async () => {
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("You haven't sent us any feedback yet.");
  });

  /* SPIDERYARN-READING2-95: "Is that true? Are there >50 not shipped?" The
     line names the total for the filter showing. */
  it("says the list is cut short when there were more, and of how many", async () => {
    const fullPage = Array.from({ length: EARLIER_FEEDBACK_LIMIT }, (_, i) => ({
      ...(REPORTS.reports[i % REPORTS.reports.length] ?? REPORTS.reports[0]),
      id: `spya-page-${i}`,
    }));
    listAnswer = page({ reports: fullPage, more: true, counts: MANY });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("Showing the 50 most recent of your 345 reports.");

    const fullUnshippedPage = Array.from({ length: EARLIER_FEEDBACK_LIMIT }, (_, i) => ({
      ...REPORTS.reports[1],
      id: `spya-unshipped-page-${i}`,
    }));
    listAnswer = page({ reports: fullUnshippedPage, more: true, counts: MANY });
    click(showButton("Not shipped"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain(
      "Showing the 50 most recent of your 115 not-shipped reports.",
    );
  });

  /* A page the server cut short to fit a response (long reports, plan 261007j)
     is a real answer, and the line counts what it holds rather than the cap. */
  it("says how many it is showing when the server sent fewer than the cap", async () => {
    listAnswer = page({ ...REPORTS, more: true, counts: MANY });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain(
      `Showing the ${REPORTS.reports.length} most recent of your 345 reports.`,
    );
  });

  /* SPIDERYARN-READING2-95: "Perhaps include a number/badge in the tab-pills
     for Shipped and Not shipped?" */
  it("puts each filter's count on its pill once an answer lands, and none before", async () => {
    let settle: ((res: Response) => void) | null = null;
    listAnswer = () => new Promise<Response>((resolve) => (settle = resolve));
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").querySelectorAll(".fb-show-count"), "no number is a guess").toHaveLength(0);

    await act(async () => {
      settle?.(new Response(JSON.stringify(REPORTS), { status: 200 }));
    });
    expect(showButton("All").querySelector(".fb-show-count")?.textContent).toBe("2");
    expect(showButton("Shipped").querySelector(".fb-show-count")?.textContent).toBe("1");
    expect(showButton("Not shipped").querySelector(".fb-show-count")?.textContent).toBe("1");
    expect(showButton("Not shipped").textContent).toBe("Not shipped 1");
  });

  /* GPT Sol's plan review: the showing filter's own answer labels the pills,
     so a later answer that differs (a deploy in between) is never outvoted by
     an older one. */
  it("labels the pills from the showing filter's answer when answers differ", async () => {
    listAnswer = page(REPORTS);
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(showButton("Not shipped").querySelector(".fb-show-count")?.textContent).toBe("1");

    listAnswer = page({ reports: [], more: false, counts: { all: 2, shipped: 2, unshipped: 0 } });
    click(showButton("Not shipped"));
    await act(async () => {});
    expect(showButton("Not shipped").querySelector(".fb-show-count")?.textContent).toBe("0");
    expect(showButton("Shipped").querySelector(".fb-show-count")?.textContent).toBe("2");

    click(showButton("All"));
    await act(async () => {});
    expect(showButton("Not shipped").querySelector(".fb-show-count")?.textContent, "All's own answer").toBe("1");
  });

  it.each([
    ["no counts", { reports: REPORTS.reports, more: false }],
    ["counts that do not add up", { ...REPORTS, counts: { all: 3, shipped: 1, unshipped: 1 } }],
    [
      "more with a count the list already holds",
      {
        reports: Array.from({ length: EARLIER_FEEDBACK_LIMIT }, (_, i) => ({
          ...REPORTS.reports[0],
          id: `spya-full-but-not-more-${i}`,
        })),
        more: true,
        counts: { all: EARLIER_FEEDBACK_LIMIT, shipped: EARLIER_FEEDBACK_LIMIT, unshipped: 0 },
      },
    ],
    ["more with no reports at all", { reports: [], more: true, counts: MANY }],
    ["no more but a count past the list", { ...REPORTS, counts: { all: 3, shipped: 1, unshipped: 2 } }],
    ["a negative count", { ...REPORTS, counts: { all: 2, shipped: 3, unshipped: -1 } }],
    ["a shipped row above a zero shipped count", { ...REPORTS, counts: { all: 2, shipped: 0, unshipped: 2 } }],
    [
      "duplicate report ids",
      { reports: [REPORTS.reports[0], REPORTS.reports[0]], more: false, counts: { all: 2, shipped: 2, unshipped: 0 } },
    ],
  ])("refuses an answer with %s as the wrong shape", async (_case, body) => {
    listAnswer = page(body);
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("[fb-list]");
  });

  it.each([false, true])("refuses more than the report cap when more=%s", async (more) => {
    const count = EARLIER_FEEDBACK_LIMIT + 1 + Number(more);
    listAnswer = page({
      reports: Array.from({ length: EARLIER_FEEDBACK_LIMIT + 1 }, (_, i) => ({
        ...REPORTS.reports[0],
        id: `spya-over-cap-${i}`,
      })),
      more,
      counts: { all: count, shipped: count, unshipped: 0 },
    });
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("[fb-list]");
  });

  it("refuses a shipped row in the Not shipped answer", async () => {
    listAnswer = page(REPORTS);
    mount();
    click(tab("Earlier"));
    await act(async () => {});

    listAnswer = page({ reports: [REPORTS.reports[0]], more: false, counts: COUNTS });
    click(showButton("Not shipped"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("[fb-list]");
  });

  it("says so when the list cannot be loaded, and tries again on request", async () => {
    listAnswer = page({ error: "nope" }, 500);
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    expect(panelOf("Earlier").textContent).toContain("[fb-list]");

    listAnswer = page(REPORTS);
    click(
      [...panelOf("Earlier").querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Try again"),
      ),
    );
    await act(async () => {});
    expect(lists).toHaveLength(2);
    expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(2);
  });

  it("treats a wrong-shaped successful response as a load failure", async () => {
    listAnswer = page({ reports: "not a list", more: false, counts: COUNTS });
    mount();
    click(tab("Earlier"));
    await act(async () => {});

    expect(panelOf("Earlier").textContent).toContain("[fb-list]");
    expect(panelOf("Earlier").getAttribute("hidden")).toBeNull();
  });

  it.each([
    ["a non-JSON 200", async () => new Response("not JSON", { status: 200 })],
    ["a 401", page({ error: "sign in again" }, 401)],
  ])("treats %s as a load failure", async (_case, response) => {
    listAnswer = response;
    mount();
    click(tab("Earlier"));
    await act(async () => {});

    expect(panelOf("Earlier").textContent).toContain("[fb-list]");
  });

  it("reads once per opening, however often the reader flips between tabs", async () => {
    listAnswer = page(REPORTS);
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    click(tab("Write"));
    click(tab("Earlier"));
    await act(async () => {});
    expect(lists).toHaveLength(1);

    reopen();
    click(tab("Earlier"));
    await act(async () => {});
    expect(lists, "a new opening reads afresh").toHaveLength(2);
  });

  it("starts one read when Earlier is chosen under StrictMode", async () => {
    mountStrict();
    click(tab("Earlier"));
    await act(async () => {});

    expect(lists).toEqual(["/api/feedback"]);
  });

  it("keeps the draft through a trip to Earlier and back", async () => {
    mount();
    type("Half of what went wrong");
    pick("suggestion");
    click(tab("Earlier"));
    await act(async () => {});
    click(tab("Write"));
    expect(firstBox().value).toBe("Half of what went wrong");
    expect(panelOf("Write").hidden).toBe(false);
    expect(host.querySelector('button.fb-kind-button[aria-pressed="true"]')?.textContent).toContain(
      "suggestion",
    );
  });

  it("files nothing from Earlier — not by keyboard, not by submit, not by any button on it", async () => {
    listAnswer = page({ error: "nope" }, 500);
    mount();
    type("A draft the reader cannot see from Earlier.");
    click(tab("Earlier"));
    await act(async () => {});

    commandEnter();
    act(() => {
      host
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    /* Every control Earlier shows, bar the tabs and the ✕ — Try again is on
       screen because the read failed, which is why this test makes it fail. */
    const controls = [
      ...panelOf("Earlier").querySelectorAll("button"),
      ...host.querySelectorAll<HTMLElement>(".fb-actions:not([hidden]) button"),
    ];
    expect(controls.length, "the failed read should have offered Try again").toBeGreaterThan(1);
    for (const control of controls) {
      expect(control.getAttribute("type")).toBe("button");
      click(control);
    }
    await act(async () => {});
    expect(posts).toEqual([]);

    /* The positive control: back on Write, the same keystroke files it. */
    reopen();
    commandEnter();
    await act(async () => {});
    expect(posts).toHaveLength(1);
  });

  it("brings a failed in-flight send back into view after the reader switches to Earlier", async () => {
    let settle: ((res: Response) => void) | null = null;
    answer = () => new Promise<Response>((resolve) => (settle = resolve));
    mount();
    type("A report whose failure must not be hidden.");
    send();
    click(tab("Earlier"));

    await act(async () => {
      settle?.(new Response("nope", { status: 500 }));
    });

    expect(tab("Write").getAttribute("aria-selected")).toBe("true");
    expect(panelOf("Write").hidden).toBe(false);
    expect(panelOf("Write").querySelector(".fb-failed")?.textContent).toContain("nope");
    expect(document.activeElement).toBe(tab("Write"));
  });

  it("shows the thank-you when an in-flight send lands after the reader switches to Earlier", async () => {
    let settle: ((res: Response) => void) | null = null;
    answer = () => new Promise<Response>((resolve) => (settle = resolve));
    mount();
    type("A report that did arrive.");
    send();
    click(tab("Earlier"));

    await act(async () => {
      settle?.(new Response("{}", { status: 201 }));
    });

    expect(host.querySelector(".toast")).not.toBeNull();
    /* And the report behind the Earlier tab is the next, empty one. */
    expect(firstBox().value).toBe("");
  });

  it("stops the microphone on the way to Earlier, without pulling focus back to the box", () => {
    mic.armed = true;
    try {
      mount();
      micToggles.length = 0;
      click(tab("Earlier"));
      expect(micToggles).toEqual(["hook"]);
    } finally {
      mic.armed = false;
    }
  });

  it("attaches nothing pasted or dropped while Earlier is showing", async () => {
    mount();
    click(tab("Earlier"));
    carried = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
    act(() => {
      host.querySelector("dialog")?.dispatchEvent(new Event("paste", { bubbles: true }));
    });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    act(() => {
      host.querySelector("dialog")?.dispatchEvent(drop);
    });
    expect(finishShot, "a picture was taken into the hidden draft").toBeNull();
    /* Still refused as a navigation, so the browser does not open the file. */
    expect(drop.defaultPrevented).toBe(true);

    /* The positive control: the same paste on Write is taken. */
    click(tab("Write"));
    act(() => {
      host.querySelector("dialog")?.dispatchEvent(new Event("paste", { bubbles: true }));
    });
    expect(finishShot).not.toBeNull();
  });

  it("puts focus on the chosen tab, by pointer and by arrow, and only it is in the tab order", async () => {
    mount();
    click(tab("Earlier"));
    expect(document.activeElement).toBe(tab("Earlier"));
    expect(tab("Earlier").tabIndex).toBe(0);
    expect(tab("Write").tabIndex).toBe(-1);
    expect(panelOf("Earlier").tabIndex, "the scrollable list is skipped by Tab").toBe(0);

    act(() => {
      tab("Earlier").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(document.activeElement).toBe(tab("Write"));
    expect(tab("Write").getAttribute("aria-selected")).toBe("true");
    expect(tab("Write").tabIndex).toBe(0);

    act(() => {
      tab("Write").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(tab("Earlier").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Earlier"));
    await act(async () => {});
  });

  it("opens on Write again, whichever tab it was shut on", async () => {
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    reopen();
    expect(tab("Write").getAttribute("aria-selected")).toBe("true");
    expect(panelOf("Write").hidden).toBe(false);
  });

  it("drops a list that arrives after the dialog was shut", async () => {
    let settle: ((res: Response) => void) | null = null;
    listAnswer = () => new Promise<Response>((resolve) => (settle = resolve));
    mount();
    click(tab("Earlier"));
    await act(async () => {});
    show(false);
    await act(async () => {
      settle?.(new Response(JSON.stringify(REPORTS), { status: 200 }));
    });

    /* Reopened, the next read is still in the air — and the old answer must not
       be standing in for it. */
    listAnswer = () => new Promise<Response>(() => {});
    show(true);
    click(tab("Earlier"));
    await act(async () => {});
    expect(lists).toHaveLength(2);
    expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(0);
  });
});

/**
 * **The address a report carries is the page the reader is on when they open
 * the box** — spya-y4upzw, and the property every later use of `url` rests on
 * (the row, the Sentry tag, the admin's mail, the Earlier tab's label).
 *
 * The host is mounted once for the life of the signed-in app, so an address
 * read when it mounted would be the first page of the session on every report.
 * It is read at render, and opening is a render. Seen red on 2026-10-03 by
 * holding the address in a `useState` initialiser instead.
 * docs/plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md.
 */
describe("where a report says it was filed", () => {
  const before = location.href;
  afterEach(() => history.replaceState(null, "", before));

  it("is the address in force when the dialog is opened, not when the host mounted", async () => {
    function Open() {
      const openFeedback = useFeedbackOpen();
      return createElement("button", { type: "button", onClick: () => openFeedback?.() }, "Open feedback");
    }
    history.replaceState(null, "", "/read/a-piece?mode=quotes");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root.render(<FeedbackHost readerId="reader-a"><Open /></FeedbackHost>);
    });
    /* An in-app navigation that re-renders nothing here: the router is mocked
       to one constant route, which is the worst case for a stale address. */
    history.pushState(null, "", "/admin/vouchers?tab=unused");
    const trigger = [...host.querySelectorAll("button")].find((b) => b.textContent === "Open feedback");
    act(() => trigger?.click());
    type("Does this carry the page I am on?");
    send();
    await act(async () => {});
    expect(posts).toHaveLength(1);
    expect(body().url).toBe(location.href);
    expect(String(body().url)).toMatch(/\/admin\/vouchers\?tab=unused$/);
  });
});

/**
 * **A request to fill the box**, from a failed import's *Report this*.
 * Plan 261001s, stage 1, as GPT Sol's review item 7 shaped it: each id once,
 * and never over the reader's own words.
 */
describe("a prefill", () => {
  const REPORT = { id: "req-1", kind: "problem" as const, body: "This import failed.\n\nJob: spya-jobaaa" };

  it("travels through the host opener into the one mounted dialog", () => {
    function ReportThis() {
      const openFeedback = useFeedbackOpen();
      return createElement(
        "button",
        { type: "button", onClick: () => openFeedback?.(REPORT) },
        "Report this",
      );
    }
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root.render(<FeedbackHost readerId="reader-a"><ReportThis /></FeedbackHost>);
    });
    const trigger = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Report this",
    );
    act(() => trigger?.click());
    expect(host.querySelector("dialog")?.open).toBe(true);
    expect(firstBox().value).toBe(REPORT.body);
    expect(host.querySelector('.fb-kind-button[aria-pressed="true"]')?.textContent).toContain(
      "A problem",
    );
  });

  function showWith(prefill: { id: string; kind: "problem" | "suggestion"; body: string } | null, open = true) {
    act(() => {
      root.render(
        createElement(FeedbackDialog, {
          open,
          onClose: () => {},
          where: { url: "https://www.spideryarn.com/", slug: null },
          prefill,
        }),
      );
    });
  }

  function mountWith(prefill: Parameters<typeof showWith>[0]) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    showWith(prefill);
  }

  function kindPressed(): string | null {
    const pressed = host.querySelector<HTMLButtonElement>('.fb-kind-button[aria-pressed="true"]');
    return pressed === null ? null : (pressed.textContent ?? "");
  }

  it("into an empty draft, puts the body in and chooses the kind", () => {
    mountWith(REPORT);
    expect(firstBox().value).toBe(REPORT.body);
    expect(kindPressed()).toContain("A problem");
  });

  it("into a draft, goes after the reader's words and keeps the kind they chose", () => {
    mountWith(null);
    type("The shelf looked odd.");
    pick("A suggestion");
    showWith(REPORT);
    expect(firstBox().value).toBe(`The shelf looked odd.\n\n${REPORT.body}`);
    expect(kindPressed()).toContain("A suggestion");
  });

  it("is applied once per id — not again on a re-render, or a close and reopen", () => {
    mountWith(REPORT);
    /* The reader replaces it with their own words, so a second application
       would show — the guard against appending text already in the box would
       otherwise hide one. */
    type("My own words instead.");
    showWith({ ...REPORT });
    showWith(REPORT, false);
    showWith(REPORT, true);
    expect(firstBox().value).toBe("My own words instead.");
  });

  it("is applied once more for a new id — a second press of the button", () => {
    mountWith(REPORT);
    type("My own words instead.");
    showWith({ ...REPORT, id: "req-2" });
    expect(firstBox().value).toBe(`My own words instead.\n\n${REPORT.body}`);
  });

  /* A smoke test rather than a proof: StrictMode's second run of a mount effect
     sees the same empty draft, so a double application would write the same
     text twice over rather than twice in a row. The test above is the one that
     can see the ref missing. */
  it("is applied once under StrictMode", () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(FeedbackDialog, {
            open: true,
            onClose: () => {},
            where: { url: "https://www.spideryarn.com/", slug: null },
            prefill: REPORT,
          }),
        ),
      );
    });
    expect(firstBox().value).toBe(REPORT.body);
  });

  it("does not push a draft past the length cap", () => {
    mountWith(null);
    const long = "x".repeat(MAX_FEEDBACK_ANSWER_CHARS - 5);
    type(long);
    showWith(REPORT);
    expect(firstBox().value).toBe(long);
  });
});

/**
 * **The draft lives in this component's state and nowhere else**, mounted once
 * so that it survives navigation and being dismissed — so a page that reloads
 * itself (`/changelog`, for a new build) has to be told it is there, or the
 * reload deletes it. safe-to-reload.ts; GPT Sol's F1 on plan 261005d.
 */
describe("saying it holds a draft, to anything about to reload the page", () => {
  it("holds a failed recording awaiting retry, even with an empty text box", () => {
    mic.recording = {};
    try {
      mount();
      expect(firstBox().value).toBe("");
      expect(reloadVeto()).toBe("feedback-draft");
      mic.recording = null;
      show(true);
      expect(reloadVeto()).toBeNull();
    } finally {
      mic.recording = null;
    }
  });

  it.each(["armed", "transcribing"] as const)("holds while dictation is %s before any transcript exists", (phase) => {
    mic[phase] = true;
    try {
      mount();
      expect(firstBox().value).toBe("");
      expect(reloadVeto()).toBe("feedback-draft");
      mic[phase] = false;
      show(true);
      expect(reloadVeto()).toBeNull();
    } finally {
      mic[phase] = false;
    }
  });

  it("says nothing is held while the form is empty", () => {
    mount();
    expect(reloadVeto()).toBeNull();
  });

  it("holds once there are words, and goes on holding when the dialog is dismissed", () => {
    mount();
    type("Half a sentence so f");
    expect(reloadVeto()).toBe("feedback-draft");
    /* The dismissed draft is the one a reload would take without anybody
       seeing it go. */
    show(false);
    expect(reloadVeto()).toBe("feedback-draft");
  });

  it("does not count spaces as words", () => {
    mount();
    type("   ");
    expect(reloadVeto()).toBeNull();
  });

  it("holds for a screenshot with no words, from the moment it is being prepared", async () => {
    mount();
    const input = host.querySelector<HTMLInputElement>('.fb-shot-pick input[type="file"]');
    if (!input) throw new Error("no file input");
    const file = new File(["x"], "shot.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(reloadVeto(), "while it is being re-encoded").toBe("feedback-draft");
    await act(async () => {
      finishShot?.("aGVsbG8=");
    });
    expect(reloadVeto()).toBe("feedback-draft");
  });

  it("lets go once the report is filed", async () => {
    mount();
    type("Something happened.");
    send();
    await act(async () => {});
    expect(posts).toHaveLength(1);
    expect(reloadVeto()).toBeNull();
  });

  it("lets go when the dialog is unmounted — signing out takes the draft with it", () => {
    mount();
    type("Half a sentence so f");
    act(() => root.unmount());
    expect(reloadVeto()).toBeNull();
    /* `afterEach` unmounts again; give it something to unmount. */
    root = createRoot(host);
  });
});

/**
 * **A half-written report does not stay in the box for the next reader.**
 * The host is above every signed-in page and is not remounted when another
 * tab signs in as somebody else, so the dialog, open or closed, kept reader
 * A's words, and Send would have filed them as reader B. Seen red on
 * 2026-10-06 against a host that did not know who it was holding a draft for.
 * docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2.
 */
describe("a half-written report, when the tab's reader changes", () => {
  const REPORT = { id: "req-9", kind: "problem" as const, body: "A's import failed.\n\nJob: spya-jobaaa" };
  let pages = 0;
  function Page() {
    const openFeedback = useFeedbackOpen();
    useState(() => (pages += 1));
    return createElement(
      "div",
      null,
      createElement("button", { type: "button", onClick: () => openFeedback?.() }, "Open feedback"),
      createElement("button", { type: "button", onClick: () => openFeedback?.(REPORT) }, "Report this"),
    );
  }
  const draw = (readerId: string) =>
    act(() => {
      root.render(<FeedbackHost readerId={readerId}><Page /></FeedbackHost>);
    });
  const press = (name: string) => {
    const trigger = [...host.querySelectorAll("button")].find((b) => b.textContent === name);
    act(() => trigger?.click());
  };
  beforeEach(() => {
    pages = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  it("closes the box and empties it, without remounting the page under it", () => {
    draw("reader-a");
    press("Open feedback");
    type("A's private complaint, half writ");
    expect(reloadVeto()).toBe("feedback-draft");

    draw("reader-b");
    expect(host.querySelector("dialog")?.open ?? false).toBe(false);
    expect(reloadVeto(), "the next reader is not asked about a draft that was never theirs").toBeNull();
    press("Open feedback");
    expect(firstBox().value).toBe("");
    expect(pages, "the page under the host was kept").toBe(1);
  });

  it("forgets a prefill that was asked for by the last reader", () => {
    draw("reader-a");
    press("Report this");
    expect(firstBox().value).toBe(REPORT.body);

    draw("reader-b");
    press("Open feedback");
    expect(firstBox().value).toBe("");
  });

  it("keeps the draft while the reader is the same one", () => {
    draw("reader-a");
    press("Open feedback");
    type("Still mine.");
    draw("reader-a");
    expect(host.querySelector("dialog")?.open).toBe(true);
    expect(firstBox().value).toBe("Still mine.");
  });
});
