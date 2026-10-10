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
import { MAX_FEEDBACK_QUESTION_BODY_CHARS } from "../src/feedback-question-values.js";
import { EARLIER_FEEDBACK_LIMIT, MAX_FEEDBACK_ANSWER_CHARS } from "../src/types.js";
import { exactly } from "../src/web/relative-time.js";

const posts: { input: string; init: RequestInit }[] = [];
/** Handed the request's init, so an answer can watch its `signal` (plan 261010f). */
let answer: (init: RequestInit) => Promise<Response>;
/** Every `GET /api/feedback` — the Earlier tab's reads, kept apart from `posts`. */
const lists: string[] = [];
let listAnswer: (input: string) => Promise<Response>;
/** Whether the dialog is mounted for an admin: the cosmetic flag FeedbackHost passes (261007d). */
let asAdmin = false;
/** The reader `show` mounts for, which turns on the draft kept for a reload (261010f). */
let readerForMount: string | undefined;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string, init?: RequestInit) => {
    /* The Earlier tab's read has no method, and it is not a report: it goes in
       its own list so that `posts` still means "what was filed". */
    if ((init?.method ?? "GET") === "GET") {
      lists.push(input);
      return listAnswer(input);
    }
    posts.push({ input, init: init ?? {} });
    return answer(init ?? {});
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
/** Each time the dialog asked the field to stop and send once the words land (261010f). */
let micFinishes = 0;
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
      finishThenDone: () => {
        micFinishes += 1;
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
        ...(readerForMount === undefined ? {} : { readerId: readerForMount }),
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
  readerForMount = undefined;
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

  it("sends nothing while the microphone is still listening, and asks for it to stop and send", async () => {
    /* **`armed`, not `transcribing`.** `readOnly` is only the two seconds after
       the reader presses stop; a guard on that alone lets Cmd+Enter file the
       rough live guesses while they are still talking — or nothing at all on a
       browser with no live recogniser. Two positive failures rather than one,
       because the second passes while the first bug is still there.

       **And pressing Send is not ignored** (plan 261010f, reports spya-t9qu3v
       and spya-exhqqr). It used to be disabled here, greyed and still reading
       "Send", and on an iPad that was a dead button. Now it stops the
       microphone and sends once the real words are in the box — the double
       press on Stop, reached from Send. Live even with the box empty: on a
       browser with no live recogniser the words are not in it yet. */
    mic.armed = true;
    micFinishes = 0;
    mount();
    expect(host.querySelector<HTMLButtonElement>("button.fb-send")?.disabled).toBe(false);
    type("Half a sentence, still speaking");
    send();
    await act(async () => {});
    expect(posts).toHaveLength(0);
    expect(micFinishes).toBe(1);
    mic.armed = false;
  });

  it("sends nothing while the transcript is still on its way, and asks to send once it lands", async () => {
    mic.transcribing = true;
    micFinishes = 0;
    mount();
    type("Said out loud, being written down");
    expect(host.querySelector<HTMLButtonElement>("button.fb-send")?.disabled).toBe(false);
    send();
    await act(async () => {});
    expect(posts).toHaveLength(0);
    expect(micFinishes).toBe(1);
    mic.transcribing = false;
  });

  it("still refuses an over-long report while the microphone is on, without asking it to send", async () => {
    mic.armed = true;
    micFinishes = 0;
    mount();
    type("x".repeat(MAX_FEEDBACK_ANSWER_CHARS + 1));
    expect(host.querySelector<HTMLButtonElement>("button.fb-send")?.disabled).toBe(true);
    send();
    await act(async () => {});
    expect(posts).toHaveLength(0);
    expect(micFinishes).toBe(0);
    mic.armed = false;
  });

  it("gives up on a send that never answers after a minute, and a retry is the same report", async () => {
    /* A request suspended with the app on an iPad can stay unsettled for good,
       and the latch then refused every later press. Plan 261010f. */
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mount();
      type("It hung.");
      answer = (init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        });
      send();
      await act(async () => {});
      expect(host.querySelector(".fb-failed")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(59_000);
      });
      expect(host.querySelector(".fb-failed"), "not before the minute is up").toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(host.querySelector(".fb-failed")).not.toBeNull();
      expect(firstBox().value).toBe("It hung.");

      answer = ok(200);
      send();
      await act(async () => {});
      expect(posts).toHaveLength(2);
      expect(idOf(1), "the latch is released and the id kept").toBe(idOf(0));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let an older attempt's timeout overwrite a newer success", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mount();
      type("It hung.");
      answer = (init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        });
      send();
      await act(async () => {});

      /* Reopening abandons the visible latch while the first request remains in
         flight, so the same report may be retried. */
      reopen();
      answer = ok(200);
      send();
      await act(async () => {});
      expect(host.querySelector(".toast"), "the retry should have succeeded").not.toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(host.querySelector(".fb-failed"), "the old timeout spoke for the newer attempt").toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("files an edited retry as a new report, so the edit is not dropped as a duplicate", async () => {
    /* The server answers a reused id with the row it already has, so after a
       send whose answer was lost, an edit and a retry under the same id would
       be thanked and thrown away. A changed draft is a new report. */
    mount();
    type("It broke.");
    answer = async () => {
      throw new Error("offline");
    };
    send();
    await act(async () => {});
    type("It broke. And here is what I was doing.");
    answer = ok(201);
    send();
    await act(async () => {});
    expect(posts).toHaveLength(2);
    expect(idOf(1)).not.toBe(idOf(0));
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
describe("the draft kept for a reload", () => {
  /* Greg, spya-exhqqr: the page hung with a report half written. The words and
     the kind are copied to this browser a second after they last change, and
     come back when the page loads again. Plan 261010f, stage 2. */
  const KEY = "spya.feedbackDraft.reader-a";
  /* jsdom's storage is shadowed by Node's own global here, so a map stands in
     (tests/last-view-app-reader-change.test.tsx does the same). `refuse` makes
     every verb throw, as a blocked or full storage does. */
  const kept = new Map<string, string>();
  let refuse = false;
  const no = () => {
    if (refuse) throw new Error("SecurityError");
  };
  const storage = {
    getItem: (key: string) => (no(), kept.get(key) ?? null),
    setItem: (key: string, value: string) => (no(), void kept.set(key, value)),
    removeItem: (key: string) => (no(), void kept.delete(key)),
    clear: () => kept.clear(),
  };
  const saved = () => JSON.parse(kept.get(KEY) ?? "null") as { body: string; kind: string | null; id: string } | null;
  const later = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };
  /** A reload: the page goes and a new one mounts the dialog afresh. */
  const reload = () => {
    act(() => root.unmount());
    host.remove();
    mount();
  };

  beforeEach(() => {
    kept.clear();
    refuse = false;
    vi.stubGlobal("localStorage", storage);
    readerForMount = "reader-a";
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("saves the words and the kind a second after they last changed, and not before", async () => {
    mount();
    type("Half a report");
    pick("A problem");
    await later(900);
    expect(saved()).toBeNull();
    await later(100);
    expect(saved()).toMatchObject({ body: "Half a report", kind: "problem" });
  });

  it("keeps the chosen kind even before the reader has written words", async () => {
    mount();
    pick("A suggestion");
    await later(1000);
    expect(saved()).toMatchObject({ body: "", kind: "suggestion" });
    reload();
    const suggestion = [...host.querySelectorAll<HTMLButtonElement>("button.fb-kind-button")].find(
      (button) => (button.textContent ?? "").includes("A suggestion"),
    );
    expect(suggestion?.getAttribute("aria-pressed")).toBe("true");
  });

  it("brings them back after a reload, as a new report", async () => {
    mount();
    type("Half a report");
    pick("A suggestion");
    await later(1000);
    const before = saved()?.id;
    reload();
    expect(firstBox().value).toBe("Half a report");
    send();
    await act(async () => {});
    expect(body()).toMatchObject({ body: "Half a report", kind: "suggestion" });
    /* A fresh id, so two tabs that restore one draft cannot share one and have
       the second answered as a duplicate. */
    expect(idOf(0)).not.toBe(before);
    reload();
    expect(firstBox().value, "the filed restored draft was removed").toBe("");
  });

  it("keeps words added after Send durable when that send succeeds", async () => {
    mount();
    type("The first thing.");
    await later(1000);
    let release: (() => void) | null = null;
    answer = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ id: "x" }), { status: 201 }));
      });
    send();
    type("The first thing. And another.");
    await later(1000);
    expect(saved()?.body).toBe("The first thing. And another.");

    act(() => release?.());
    await act(async () => {});
    reload();
    expect(firstBox().value, "the unsent addition survived the successful request").toBe(
      "The first thing. And another.",
    );
  });

  it("forgets the draft once it is filed, even with a save still pending", async () => {
    mount();
    type("Filed");
    await later(1000);
    expect(saved()?.body).toBe("Filed");
    /* A last sentence, and Send before its save is due. */
    type("Filed straight away");
    send();
    await act(async () => {});
    await later(2000);
    expect(saved(), "the pending save did not put it back").toBeNull();
    reload();
    expect(firstBox().value).toBe("");
  });

  it("leaves another tab's draft alone when this one files", async () => {
    mount();
    type("This tab's words");
    await later(1000);
    kept.set(KEY, JSON.stringify({ body: "the other tab's", kind: null, id: "spya-other1", at: Date.now() }));
    send();
    await act(async () => {});
    expect(saved()?.body).toBe("the other tab's");
  });

  it("does not erase newer words another tab saved under a restored id", async () => {
    kept.set(
      KEY,
      JSON.stringify({ body: "The shared old draft", kind: null, id: "spya-firsttab", at: Date.now() }),
    );
    mount();
    expect(firstBox().value).toBe("The shared old draft");
    /* The originating tab goes on writing after this tab restored its snapshot.
       The id still matches, but the contents no longer belong to this send. */
    kept.set(
      KEY,
      JSON.stringify({ body: "The other tab's newer words", kind: null, id: "spya-firsttab", at: Date.now() }),
    );
    send();
    await act(async () => {});
    expect(saved()?.body).toBe("The other tab's newer words");
  });

  it("removes the old saved id after an edited retry succeeds under a new one", async () => {
    mount();
    type("The first attempt.");
    await later(1000);
    const oldId = saved()?.id;
    answer = async () => {
      throw new Error("offline");
    };
    send();
    await act(async () => {});

    type("The edited retry.");
    answer = ok(201);
    send();
    await act(async () => {});
    expect(idOf(1)).not.toBe(oldId);
    reload();
    expect(firstBox().value, "the filed attempt survived under its old saved id").toBe("");
  });

  it("removes its own record when the box is emptied, and only its own", async () => {
    mount();
    type("Something");
    await later(1000);
    type("");
    await later(1000);
    expect(saved()).toBeNull();
    kept.set(KEY, JSON.stringify({ body: "the other tab's", kind: null, id: "spya-other1", at: Date.now() }));
    type("x");
    type("");
    await later(1000);
    expect(saved()?.body).toBe("the other tab's");
  });

  it("removes a restored record when its box is emptied before the fresh id is saved", async () => {
    kept.set(
      KEY,
      JSON.stringify({ body: "Restored words", kind: null, id: "spya-oldtab1", at: Date.now() }),
    );
    mount();
    expect(firstBox().value).toBe("Restored words");
    type("");
    await later(1000);
    expect(saved()).toBeNull();
    reload();
    expect(firstBox().value).toBe("");
  });

  it("does not bring back a draft more than a week old", () => {
    kept.set(
      KEY,
      JSON.stringify({ body: "old words", kind: null, id: "spya-old111", at: Date.now() - 8 * 24 * 60 * 60 * 1000 }),
    );
    mount();
    expect(firstBox().value).toBe("");
    expect(saved()).toBeNull();
  });

  it("removes malformed storage instead of reparsing it on every mount", () => {
    kept.set(KEY, "{broken");
    mount();
    expect(firstBox().value).toBe("");
    expect(kept.has(KEY)).toBe(false);
  });

  it("is another reader's business, not this one's", () => {
    kept.set(
      "spya.feedbackDraft.reader-b",
      JSON.stringify({ body: "b's words", kind: null, id: "spya-bbbbbb", at: Date.now() }),
    );
    mount();
    expect(firstBox().value).toBe("");
  });

  it("still opens when the browser refuses storage", async () => {
    refuse = true;
    mount();
    type("Words");
    await later(1000);
    send();
    await act(async () => {});
    expect(posts).toHaveLength(1);
  });

  it("keeps nothing for a dialog with no reader", async () => {
    readerForMount = undefined;
    mount();
    type("Words");
    await later(1000);
    expect(kept.size).toBe(0);
  });
});

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

  it("keeps a kind chosen after Send as part of the next report", async () => {
    mountControlled();
    type("The words stay the same.");
    pick("A problem");
    let release: (() => void) | null = null;
    answer = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ id: "x" }), { status: 201 }));
      });
    send();
    pick("A suggestion");
    act(() => release?.());
    await act(async () => {});

    expect(body().kind, "the filed report kept its original kind").toBe("problem");
    expect(firstBox().value, "the unchanged words belong to the unsent kind change").toBe(
      "The words stay the same.",
    );
    const suggestion = [...host.querySelectorAll<HTMLButtonElement>("button.fb-kind-button")].find(
      (button) => (button.textContent ?? "").includes("A suggestion"),
    );
    expect(suggestion?.getAttribute("aria-pressed")).toBe("true");
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
     numbers them, and carries the note's one-line comment. Reshaped by
     docs/plans/261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md:
     the read asks for threads (`questions=3`), an admin's dialog reads Needs a
     decision as soon as it opens, and Earlier opens there when a thread waits. */
  describe("for an admin", () => {
    const ADMIN_PATH = "/api/admin/feedback/earlier";
    /** The admin route for one filter, as the client asks it: `show` first, then `questions=3` (F3, 261010g). */
    const url = (which?: string) =>
      which === undefined ? `${ADMIN_PATH}?questions=3` : `${ADMIN_PATH}?show=${which}&questions=3`;
    const ALL_URL = url();
    const WAITING_URL = url("waiting");
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
    /** That answer cut to one filter's rows, the way the server would send it. */
    function only<T extends { reports: readonly { status: string }[] }>(body: T, status: string): T {
      return { ...body, reports: body.reports.filter((report) => report.status === status) };
    }
    /** Answer each read by the filter in its address; a read nobody planned for throws. */
    function answerBy(bodies: Record<string, unknown>): (input: string) => Promise<Response> {
      return (input) => {
        const which = new URL(input, "https://www.spideryarn.com").searchParams.get("show") ?? "all";
        if (!(which in bodies)) throw new Error(`no answer for ${input}`);
        return page(bodies[which])();
      };
    }
    /** A server whose every filter is this one answer, cut to that filter's rows. */
    function serve<T extends { reports: readonly { status: string }[] }>(all: T, overrides: Record<string, unknown> = {}) {
      return answerBy({
        all,
        open: only(all, "open"),
        waiting: only(all, "waiting"),
        aside: only(all, "aside"),
        shipped: only(all, "shipped"),
        ...overrides,
      });
    }
    /** Every read in the air, landed, and whatever it set off landed too. */
    async function settle() {
      for (let i = 0; i < 4; i += 1) await act(async () => {});
    }
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
    const shortcut = () => host.querySelector<HTMLButtonElement>("button.fb-tab-shortcut");
    async function openEarlier() {
      mount();
      click(tab("Earlier"));
      await settle();
    }

    it("gets the admin list through the production FeedbackHost's reader-id check", async () => {
      function OpenFeedback() {
        const open = useFeedbackOpen();
        return <button type="button" onClick={() => open?.()}>Open feedback</button>;
      }
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      listAnswer = serve(ADMIN_REPORTS);
      act(() => {
        root.render(
          <FeedbackHost readerId={ADMIN_USER_ID_LOCAL}>
            <OpenFeedback />
          </FeedbackHost>,
        );
      });
      click([...host.querySelectorAll("button")].find((button) => button.textContent === "Open feedback"));
      click(tab("Earlier"));
      await settle();

      expect(lists).toEqual([WAITING_URL, ALL_URL]);
      expect(pills()).toEqual(["All 5", "Open 1", "Needs a decision 1", "Set aside 2", "Shipped 1"]);
    });

    /* Plan 261008i, decision 8: the count on the shortcut is needed before
       Earlier is opened, so an admin's dialog reads Needs a decision when it
       opens, on Write, once per opening. */
    it("reads Needs a decision as soon as the dialog opens, on Write, and again on the next opening", async () => {
      asAdmin = true;
      listAnswer = serve(ADMIN_REPORTS);
      mount();
      await settle();
      expect(lists).toEqual([WAITING_URL]);
      expect(tab("Write").getAttribute("aria-selected")).toBe("true");
      reopen();
      await settle();
      expect(lists).toEqual([WAITING_URL, WAITING_URL]);
    });

    /* Decision 9: Earlier opens on Needs a decision only when a thread waits.
       Here none does, and the reader has chosen nothing, so it moves to All. */
    it("reads the admin route, and shows five pills with report counts, on All when no thread waits", async () => {
      asAdmin = true;
      listAnswer = serve(ADMIN_REPORTS);
      await openEarlier();
      expect(lists).toEqual([WAITING_URL, ALL_URL]);
      expect(pills()).toEqual(["All 5", "Open 1", "Needs a decision 1", "Set aside 2", "Shipped 1"]);
      expect(pill("All").getAttribute("aria-pressed")).toBe("true");
    });

    it("gives each row its number, its status word and its comment", async () => {
      asAdmin = true;
      listAnswer = serve(ADMIN_REPORTS);
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
      listAnswer = serve(ADMIN_REPORTS, {
        aside: { reports: [], more: false, counts: { all: 1, open: 0, waiting: 1, aside: 0, shipped: 0 }, questions: [] },
      });
      await openEarlier();
      click(pill("Needs a decision"));
      await settle();
      /* Read once per opening, per filter: the opening's read is this filter's. */
      expect(lists).toEqual([WAITING_URL, ALL_URL]);
      expect(pill("Needs a decision").getAttribute("aria-pressed")).toBe("true");
      expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(1);

      click(pill("Set aside"));
      await settle();
      expect(lists.at(-1)).toBe(url("aside"));
      expect(panelOf("Earlier").textContent).toContain("None of your reports has been set aside.");
    });

    it("falls back to the plain list and three pills when the server has no such route (a 404)", async () => {
      /* New client, old server: after a rollback, or in the minutes of a deploy. */
      asAdmin = true;
      listAnswer = (input) => (input.startsWith(ADMIN_PATH) ? page({ error: "Not found" }, 404)() : page(REPORTS)());
      await openEarlier();
      expect(lists).toEqual([WAITING_URL, "/api/feedback"]);
      expect(pills()).toEqual(["All 2", "Shipped 1", "Not shipped 1"]);
      expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(2);
      expect(panelOf("Earlier").querySelector(".fb-earlier-number")).toBeNull();
      expect(shortcut()).toBeNull();
      /* And it stays on the plain route for the rest of this opening. */
      click(showButton("Shipped"));
      await settle();
      expect(lists.at(-1)).toBe("/api/feedback?show=shipped");
      /* The next opening asks the admin route again: the deploy may have finished. */
      const before = lists.length;
      reopen();
      click(tab("Earlier"));
      await settle();
      expect(lists.slice(before)).toEqual([WAITING_URL, "/api/feedback"]);
    });

    it.each([403, 500])("does not fall back on a %s: it says the list would not load", async (status) => {
      asAdmin = true;
      listAnswer = page({ error: "no" }, status);
      await openEarlier();
      expect(lists).toEqual([WAITING_URL]);
      expect(panelOf("Earlier").textContent).toContain("[fb-list]");
      expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(0);
    });

    /* Each is the All answer; the opening's Needs a decision read is a good
       one with no thread waiting, so Earlier moves to All and reads it. */
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
      listAnswer = answerBy({ waiting: only(ADMIN_REPORTS, "waiting"), all: body });
      await openEarlier();
      expect(lists).toEqual([WAITING_URL, ALL_URL]);
      expect(panelOf("Earlier").textContent).toContain("[fb-list]");
      expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(0);
      expect([...panelOf("Earlier").querySelectorAll("button")].map((b) => b.textContent)).toContain("Try again");
    });

    it("refuses a row of another status in a filtered answer", async () => {
      asAdmin = true;
      listAnswer = serve(ADMIN_REPORTS, {
        open: { reports: [ADMIN_REPORTS.reports[0]], more: false, counts: ADMIN_COUNTS, questions: [] },
      });
      await openEarlier();
      click(pill("Open"));
      await settle();
      expect(lists.at(-1)).toBe(url("open"));
      expect(panelOf("Earlier").textContent).toContain("[fb-list]");
    });

    /* Stage 2 of 261007d: an agent's questions, in Needs a decision, each with
       a box to reply in. 261008i made them threads: a contents, one thread at
       a time, three groups, and Defer for now. */
    describe("questions an agent has asked", () => {
      const ANSWERS_PATH = "/api/admin/feedback/answers";
      const DEFERRALS_PATH = "/api/admin/feedback/deferrals";
      /** A question as the server sends it when asked `questions=3` (src/types.ts § AdminFeedbackQuestion). */
      const Q1 = {
        id: "q-aaaaaa",
        title: "One switch or two?",
        body: "Background first.\n\nA. One <b>switch</b>.\nB. Two.",
        asked: "2026-10-05",
        report: { id: "spya-a2b2c3", number: 214, firstLine: "One switch or two?", body: "One switch or two?\nI keep <b>pressing</b> both." },
        answers: [] as unknown[],
        olderAnswers: 0,
        actedAnswers: [] as unknown[],
        olderActedAnswers: 0,
        state: "waiting",
        deferredAt: null as string | null,
      };
      const Q2 = {
        id: "q-bbbbbb",
        title: "A question about nothing filed",
        body: "It stands alone.",
        asked: "2026-10-06",
        report: null,
        answers: [] as unknown[],
        olderAnswers: 0,
        actedAnswers: [] as unknown[],
        olderActedAnswers: 0,
        state: "waiting",
        deferredAt: null as string | null,
      };
      const REPLIED = { id: "spya-a9b2c3", body: "<i>Two</i>, please.\nBoth.", createdAt: "2026-10-06T18:30:00.000Z" };
      /** Greg has replied and no agent has acted on it yet: being considered. */
      const Q3 = {
        ...Q2,
        id: "q-cccccc",
        title: "Should Citations become part of Debate?",
        asked: "2026-10-07",
        answers: [REPLIED],
        state: "responded",
      };
      /** Greg said not now. */
      const Q4 = {
        ...Q2,
        id: "q-dddddd",
        title: "Is waiting for the next deploy OK?",
        asked: "2026-10-08",
        state: "deferred",
        deferredAt: "2026-10-08T07:00:00.000Z",
      };
      const WITH_QUESTIONS = { ...ADMIN_REPORTS, questions: [Q1, Q2] };
      const WAITING = { reports: [ADMIN_REPORTS.reports[1]], more: false, counts: ADMIN_COUNTS, questions: [Q1, Q2] };
      const questionsBox = () => panelOf("Earlier").querySelector<HTMLElement>(".fb-questions");
      /** The contents' rows, by question id, in the order drawn. */
      const rows = () =>
        [...panelOf("Earlier").querySelectorAll<HTMLButtonElement>("button.fb-thread-row")].map((b) => b.dataset.question);
      const row = (id: string) => {
        const found = panelOf("Earlier").querySelector<HTMLButtonElement>(`button.fb-thread-row[data-question="${id}"]`);
        if (!found) throw new Error(`no row for ${id}`);
        return found;
      };
      const group = (state: string) => panelOf("Earlier").querySelector<HTMLElement>(`.fb-threads [data-group="${state}"]`);
      const inGroup = (state: string) =>
        [...(group(state)?.querySelectorAll<HTMLButtonElement>("button.fb-thread-row") ?? [])].map((b) => b.dataset.question);
      /** The one thread showing on its own. */
      const thread = () => {
        const found = panelOf("Earlier").querySelector<HTMLElement>(".fb-thread");
        if (!found) throw new Error("no thread showing");
        return found;
      };
      const button = (within: Element, name: string) => {
        const found = [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === name);
        if (!found) throw new Error(`no ${name} button`);
        return found;
      };
      /** `aria-disabled`, not `disabled`: an unavailable pager button keeps its hint (261009m § 4). */
      const unavailable = (b: HTMLButtonElement) => b.getAttribute("aria-disabled") === "true" && !b.disabled;
      const place = () => thread().querySelector(".fb-thread-place")?.textContent;
      const showing = () => thread().querySelector<HTMLElement>(".fb-question")?.dataset.question;
      const hasButton = (within: Element, name: string) =>
        [...within.querySelectorAll("button")].some((b) => (b.textContent ?? "").trim() === name);
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
      /** The deferrals route's receipt for the last POST: the time it was deferred, or null for brought back. */
      const deferral = (deferredAt = "2026-10-08T09:30:00.000Z") => async () => {
        const last = JSON.parse(String(posts.at(-1)?.init.body)) as { question: string; deferred: boolean };
        return new Response(JSON.stringify({ question: last.question, deferredAt: last.deferred ? deferredAt : null }), {
          status: 200,
        });
      };
      /** Open the dialog, then Earlier, which opens on Needs a decision because a thread waits. */
      async function openWaiting(body: unknown = WITH_QUESTIONS, waiting: unknown = WAITING) {
        asAdmin = true;
        listAnswer = answerBy({ all: body, waiting });
        await openEarlier();
      }
      /** …and open one thread. */
      async function openThread(id = "q-aaaaaa", body: unknown = WITH_QUESTIONS, waiting: unknown = WAITING) {
        await openWaiting(body, waiting);
        click(row(id));
      }
      beforeEach(() => {
        replyMic.armed = false;
        replyMic.transcribing = false;
        replyMicToggles.length = 0;
        replyMicUses.length = 0;
        replyMicDone = undefined;
      });

      /* Decision 9 (spya-bzwzfw): Earlier opens on Needs a decision when a
         thread is waiting, and the opening's read is that filter's. */
      it("opens Earlier on Needs a decision when a thread waits, from the read made on opening", async () => {
        await openWaiting();
        expect(lists).toEqual([WAITING_URL]);
        expect(pill("Needs a decision").getAttribute("aria-pressed")).toBe("true");
        expect(questionsBox()?.hidden).toBe(false);
        expect(rows()).toEqual(["q-aaaaaa", "q-bbbbbb"]);
      });

      it("says how many are open beside the pill in every view, and draws them only in Needs a decision", async () => {
        await openWaiting();
        /* The report count on the pill is still the report count; the questions are beside it. */
        expect(pills()).toContain("Needs a decision 1 · 2 to decide");
        /* The one waiting report is Q1's, so it is inside that thread and not listed. */
        expect(panelOf("Earlier").querySelectorAll(".fb-earlier-list > li")).toHaveLength(0);

        /* In All: counted on the pill, after its report count, and not drawn. */
        click(pill("All"));
        await settle();
        expect(lists).toEqual([WAITING_URL, ALL_URL]);
        expect(pills()).toContain("Needs a decision 1 · 2 to decide");
        expect(questionsBox()?.hidden ?? true).toBe(true);
        expect(panelOf("Earlier").querySelectorAll(".fb-earlier-list > li")).toHaveLength(5);
      });

      /* spya-u6h6q8 (Greg, 2026-10-08): "There seems to be a few that are listed
         there, but there doesn't appear to be a reply button or input box".
         Waiting report rows were drawn under the question cards as a list of
         their own, with nothing to press: one repeating a question above it,
         one with no question at all. Plan 261008i § The bug. */
      it("draws no report under Needs a decision that cannot be answered: it is inside its thread, or under the no-question heading", async () => {
        const orphan = { ...base, id: "spya-a6b2c3", number: 210, status: "waiting", body: "Fewer modes, please." };
        await openWaiting(WITH_QUESTIONS, {
          reports: [ADMIN_REPORTS.reports[1], orphan],
          more: false,
          counts: { ...ADMIN_COUNTS, all: 6, waiting: 2 },
          questions: [Q1, Q2],
        });
        const visible = (el: Element) => !el.closest("[hidden]");
        const rows = [...panelOf("Earlier").querySelectorAll<HTMLElement>(".fb-earlier-list > li")].filter(visible);
        /* Every report row left in the view is under the heading that says no
           question has been written for it, and the one with a question is not
           repeated outside its thread. */
        expect(rows.map((li) => li.querySelector(".fb-earlier-number")?.textContent)).toEqual(["#210"]);
        expect(rows.every((li) => li.closest(".fb-orphans") !== null)).toBe(true);
        expect(panelOf("Earlier").querySelector(".fb-orphans")?.textContent).toMatch(/no question/i);
      });

      it("draws the threads before the reports no question is about, and no report at all while a thread is open", async () => {
        const orphan = { ...base, id: "spya-a6b2c3", number: 210, status: "waiting", body: "Fewer modes, please." };
        await openThread("q-aaaaaa", WITH_QUESTIONS, {
          reports: [ADMIN_REPORTS.reports[1], orphan],
          more: false,
          counts: { ...ADMIN_COUNTS, all: 6, waiting: 2 },
          questions: [Q1, Q2],
        });
        expect(panelOf("Earlier").querySelectorAll(".fb-earlier-list > li")).toHaveLength(0);
        expect(panelOf("Earlier").querySelector(".fb-orphans")).toBeNull();
        click(button(thread(), "‹ All threads"));
        const orphans = panelOf("Earlier").querySelector(".fb-orphans");
        expect(orphans).not.toBeNull();
        expect(questionsBox()?.compareDocumentPosition(orphans as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      });

      it("says one question in the singular, and nothing on the pill when there are none", async () => {
        await openWaiting({ ...ADMIN_REPORTS, questions: [Q2] }, { ...WAITING, questions: [Q2] });
        expect(pills()).toContain("Needs a decision 1 · 1 to decide");
        listAnswer = serve(ADMIN_REPORTS);
        reopen();
        click(tab("Earlier"));
        await settle();
        expect(pills()).toContain("Needs a decision 1");
        expect(pills().join(" ")).not.toContain("to decide");
        expect(rows()).toHaveLength(0);
      });

      /* Decision 4 (spya-t6nmxt, spya-bbe74w): the contents, three groups in
         that order, Deferred shut; decision 6 (spya-krvuc9): each row's q- id. */
      it("draws a contents of three groups, Deferred shut, each row its title, its q- id and its report", async () => {
        const all = [Q4, Q3, Q2, Q1];
        await openWaiting({ ...ADMIN_REPORTS, questions: all }, { ...WAITING, questions: all });
        expect(panelOf("Earlier").querySelector(".fb-threads")).not.toBeNull();
        expect([...panelOf("Earlier").querySelectorAll<HTMLElement>(".fb-threads [data-group]")].map((g) => g.dataset.group)).toEqual([
          "waiting",
          "responded",
          "deferred",
        ]);
        expect(inGroup("waiting")).toEqual(["q-bbbbbb", "q-aaaaaa"]);
        expect(inGroup("responded")).toEqual(["q-cccccc"]);
        expect(inGroup("deferred")).toEqual(["q-dddddd"]);
        const deferred = group("deferred");
        expect(deferred?.tagName).toBe("DETAILS");
        expect((deferred as HTMLDetailsElement | null)?.open).toBe(false);
        expect(group("waiting")?.tagName).not.toBe("DETAILS");

        const first = row("q-aaaaaa");
        expect(first.textContent).toContain("One switch or two?");
        expect([...first.querySelectorAll("code.fb-question-id")].map((c) => c.textContent)).toEqual([
          "q-aaaaaa",
          "(spya-a2b2c3)",
        ]);
        expect(first.querySelector(".fb-earlier-number")?.textContent).toBe("#214");
        expect(first.type).toBe("button");
        const alone = row("q-bbbbbb");
        expect([...alone.querySelectorAll("code.fb-question-id")].map((c) => c.textContent)).toEqual(["q-bbbbbb"]);
        expect(alone.querySelector(".fb-earlier-number")).toBeNull();
        /* The contents is not a thread: no reply box until one is opened. */
        expect(replyBoxes()).toHaveLength(0);
      });

      /* Decisions 4, 5 and 7: one thread alone, the pills gone, the box simply
         there, the report shut under "Your report #N". */
      it("shows a thread alone when its row is pressed: the pager, its ids, its words, its report shut, and the box", async () => {
        await openThread();
        expect(panelOf("Earlier").querySelector(".fb-threads")).toBeNull();
        /* The pills go while one thread shows: on a phone they cost three lines. */
        expect(panelOf("Earlier").querySelectorAll(".fb-show-button")).toHaveLength(0);
        expect(place()).toBe("1 of 2 needing a decision");
        expect(unavailable(button(thread(), "‹ Previous"))).toBe(true);
        expect(unavailable(button(thread(), "Next ›"))).toBe(false);
        expect([...thread().querySelectorAll("button")].every((b) => b.type === "button")).toBe(true);

        const article = thread().querySelector<HTMLElement>(".fb-question");
        expect(article?.dataset.question).toBe("q-aaaaaa");
        expect(article?.querySelector(".fb-question-title")?.textContent).toBe("One switch or two?");
        expect(article?.querySelector(".fb-earlier-meta")?.textContent).toContain("q-aaaaaa · about #214 (spya-a2b2c3)");
        /* Text, never markup, with the lines kept by CSS: the tag is characters. */
        expect(article?.querySelector(".fb-question-text")?.textContent).toBe(Q1.body);
        expect(article?.querySelector(".fb-question-text b")).toBeNull();

        const report = [...thread().querySelectorAll<HTMLDetailsElement>("details.fb-question-more")].find(
          (d) => d.querySelector("summary")?.textContent === "Your report #214",
        );
        expect(report).toBeDefined();
        expect(report?.open).toBe(false);
        expect(report?.textContent).toContain("I keep <b>pressing</b> both.");
        expect(report?.querySelector("b")).toBeNull();

        /* The reply box is simply there: no Reply to press, nothing to cancel. */
        expect(replyBoxes()).toHaveLength(1);
        expect(hasButton(thread(), "Reply")).toBe(false);
        expect(hasButton(thread(), "Cancel")).toBe(false);
        expect(hasButton(thread(), "Send reply")).toBe(true);
        expect(hasButton(thread(), "Defer for now")).toBe(true);

        /* A thread with no report has no Your report. */
        click(button(thread(), "Next ›"));
        expect(thread().querySelector<HTMLElement>(".fb-question")?.dataset.question).toBe("q-bbbbbb");
        expect(place()).toBe("2 of 2 needing a decision");
        expect(unavailable(button(thread(), "Next ›"))).toBe(true);
        expect(thread().querySelector("details.fb-question-more")).toBeNull();

        /* And the way back: the contents, and the pills. */
        click(button(thread(), "‹ All threads"));
        expect(panelOf("Earlier").querySelector(".fb-thread")).toBeNull();
        expect(rows()).toEqual(["q-aaaaaa", "q-bbbbbb"]);
        expect(pills()).toContain("Needs a decision 1 · 2 to decide");
      });

      /* spya-nmt06n (Greg, 2026-10-09): "I only want them to cycle through the
         next and previous that need a decision, rather than anything else. And
         they should, I guess, be disabled with a tooltip or something if there's
         no more." Plan 261009m. */
      it("steps only through the threads that need a decision, skipping replied and deferred ones", async () => {
        const later = { ...Q2, id: "q-eeeeee", asked: "2026-10-09" };
        const all = [Q1, Q3, Q4, later];
        await openThread("q-aaaaaa", { ...ADMIN_REPORTS, questions: all }, { ...WAITING, questions: all });
        expect(place()).toBe("1 of 2 needing a decision");
        click(button(thread(), "Next ›"));
        expect(showing()).toBe("q-eeeeee");
        expect(place()).toBe("2 of 2 needing a decision");
        click(button(thread(), "‹ Previous"));
        expect(showing()).toBe("q-aaaaaa");
      });

      it("makes an end unavailable with a hint, and says the hint on the row when it is pressed anyway", async () => {
        const all = [Q4, Q3, Q1];
        await openThread("q-aaaaaa", { ...ADMIN_REPORTS, questions: all }, { ...WAITING, questions: all });
        expect(place()).toBe("1 of 1 needing a decision");
        const previous = button(thread(), "‹ Previous");
        const next = button(thread(), "Next ›");
        expect(unavailable(previous)).toBe(true);
        expect(unavailable(next)).toBe(true);
        expect(previous.title).toBe("No earlier thread needs a decision");
        expect(next.title).toBe("No later thread needs a decision");
        /* The live region is there, empty, before anything is said in it (P2). */
        const said = () => thread().querySelector(".fb-thread-end");
        expect(said()?.getAttribute("role")).toBe("status");
        expect(said()?.textContent).toBe("");
        expect(said()?.matches(":empty")).toBe(true);

        click(next);
        expect(showing()).toBe("q-aaaaaa");
        expect(said()?.textContent).toBe("No later thread needs a decision");
        const firstSaying = said()?.firstElementChild;
        click(next);
        expect(said()?.firstElementChild).not.toBe(firstSaying);
        expect(said()?.textContent).toBe("No later thread needs a decision");
        click(previous);
        expect(said()?.textContent).toBe("No earlier thread needs a decision");
      });

      it("does not revive an old end sentence after paging away and back", async () => {
        await openThread();
        const said = () => thread().querySelector(".fb-thread-end")?.textContent;
        click(button(thread(), "‹ Previous"));
        expect(said()).toBe("No earlier thread needs a decision");

        click(button(thread(), "Next ›"));
        expect(showing()).toBe("q-bbbbbb");
        expect(said()).toBe("");
        click(button(thread(), "‹ Previous"));
        expect(showing()).toBe("q-aaaaaa");
        expect(said()).toBe("");
      });

      it("takes an end sentence away when the showing thread stops needing a decision", async () => {
        await openThread();
        click(button(thread(), "‹ Previous"));
        expect(thread().querySelector(".fb-thread-end")?.textContent).toBe("No earlier thread needs a decision");

        typeReply("decided");
        answer = stored(201);
        click(button(thread(), "Send reply"));
        await settle();
        expect(place()).toBe("1 needs a decision");
        expect(thread().querySelector(".fb-thread-end")?.textContent).toBe("");
      });

      it("steps from a replied or deferred thread opened from the contents to the waiting ones beside it", async () => {
        const all = [Q1, Q3, Q4];
        await openThread("q-cccccc", { ...ADMIN_REPORTS, questions: all }, { ...WAITING, questions: all });
        /* Not one of them, so no position: only how many there are. */
        expect(place()).toBe("1 needs a decision");
        expect(button(thread(), "‹ Previous").title).toBe("Previous thread that needs a decision");
        expect(unavailable(button(thread(), "Next ›"))).toBe(true);
        click(button(thread(), "‹ Previous"));
        expect(showing()).toBe("q-aaaaaa");
        /* And from there, nothing waits after it: the deferred one is skipped. */
        expect(unavailable(button(thread(), "Next ›"))).toBe(true);

        click(button(thread(), "‹ All threads"));
        const deferred = group("deferred") as HTMLDetailsElement;
        deferred.open = true;
        click(row("q-dddddd"));
        expect(place()).toBe("1 needs a decision");
        click(button(thread(), "‹ Previous"));
        expect(showing()).toBe("q-aaaaaa");
      });

      it("says none are left when the thread showing is not waiting and nothing else is", async () => {
        const all = [Q3, Q4];
        await openThread("q-cccccc", { ...ADMIN_REPORTS, questions: all }, { ...WAITING, questions: all });
        expect(place()).toBe("No threads need a decision now");
        expect(unavailable(button(thread(), "‹ Previous"))).toBe(true);
        expect(unavailable(button(thread(), "Next ›"))).toBe(true);
      });

      /* Decision 11 (spya-za2tse): TL;DR first; everything after a line that is
         exactly "Details" is shut. F15: compared exactly, untrimmed. */
      it("shuts everything after a line that is exactly Details, and splits on nothing else", async () => {
        const split = { ...Q1, body: "Which one? Recommended: A.\nDetails\nWhat the report asked, at length." };
        const unsplit = { ...Q2, body: "Short.\nDetails \nNot split: the line is not exactly the word." };
        await openThread("q-aaaaaa", { ...ADMIN_REPORTS, questions: [split, unsplit] }, { ...WAITING, questions: [split, unsplit] });
        const article = thread().querySelector(".fb-question");
        expect(article?.querySelector(".fb-question-text")?.textContent).toBe("Which one? Recommended: A.");
        const more = [...thread().querySelectorAll<HTMLDetailsElement>("details.fb-question-more")].find(
          (d) => d.querySelector("summary")?.textContent === "Details",
        );
        expect(more?.open).toBe(false);
        expect(more?.textContent).toContain("What the report asked, at length.");
        expect(article?.querySelector(".fb-question-text")?.textContent).not.toContain("at length");

        click(button(thread(), "Next ›"));
        expect(thread().querySelector(".fb-question-text")?.textContent).toBe(unsplit.body);
        expect(
          [...thread().querySelectorAll("details.fb-question-more summary")].map((s) => s.textContent),
        ).not.toContain("Details");
      });

      /* Decision 2: every reply no agent has acted on, oldest first, and how
         many older ones were not sent (F12). */
      it("shows every reply not yet acted on as You replied, oldest first, and says how many earlier ones are not shown", async () => {
        const later = { id: "spya-b9b2c3", body: "And one more.", createdAt: "2026-10-07T08:00:00.000Z" };
        const replied = { ...Q1, answers: [REPLIED, later], olderAnswers: 2, state: "responded" };
        await openThread("q-aaaaaa", { ...ADMIN_REPORTS, questions: [replied, Q2] }, { ...WAITING, questions: [replied, Q2] });
        const shown = thread().querySelector(".fb-question-answer");
        expect([...(shown?.querySelectorAll(".fb-question-answer-body") ?? [])].map((p) => p.textContent)).toEqual([
          "<i>Two</i>, please.\nBoth.",
          "And one more.",
        ]);
        expect(shown?.querySelector("i")).toBeNull();
        expect([...(shown?.querySelectorAll("time") ?? [])].map((t) => t.getAttribute("datetime"))).toEqual([
          REPLIED.createdAt,
          later.createdAt,
        ]);
        expect(shown?.textContent).toContain("You replied · ");
        expect(shown?.textContent).toContain("And 2 earlier replies, not shown here.");
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("responded");
        /* The box is still there: Greg can add to what he said. */
        expect(replyBoxes()).toHaveLength(1);
      });

      /* 261010g (spya-j4sg9g): replies an agent has acted on are listed too,
         and a waiting thread that has them does not look never answered. */
      describe("replies an agent has acted on", () => {
        const FIRST = { id: "spya-ac7edz", body: "A, with the risk written down.", createdAt: "2026-10-09T10:00:00.000Z" };
        const SECOND = { id: "spya-ac7ed3", body: "A. I think it's fine.", createdAt: "2026-10-09T19:38:00.000Z" };
        const askedAgain = {
          ...Q1,
          body: "Background first.\n\nDetails\nWhat happened to your replies.",
          actedAnswers: [FIRST, SECOND],
          olderActedAnswers: 1,
        };

        it("lists them as acted on, says Needs a decision again, and counts them on the contents row", async () => {
          await openWaiting({ ...ADMIN_REPORTS, questions: [askedAgain, Q2] }, { ...WAITING, questions: [askedAgain, Q2] });
          expect(inGroup("waiting")).toEqual(["q-aaaaaa", "q-bbbbbb"]);
          expect(row("q-aaaaaa").textContent).toContain("you've replied 3×");
          expect(row("q-bbbbbb").textContent).not.toContain("replied");
          click(row("q-aaaaaa"));
          const shown = thread().querySelector('.fb-question-answer[data-acted="true"]');
          expect([...(shown?.querySelectorAll(".fb-question-answer-body") ?? [])].map((p) => p.textContent)).toEqual([
            FIRST.body,
            SECOND.body,
          ]);
          expect(shown?.textContent).toContain("You replied · ");
          expect(shown?.textContent).toContain(" · acted on");
          expect(shown?.textContent).toContain("And 1 earlier reply acted on, not shown here.");
          expect(shown?.textContent).toContain("kept this open, so it is asking something more.");
          expect(shown?.textContent).toContain("What happened next is written in the question, under Details.");
          expect(thread().querySelector(".fb-earlier-meta")?.textContent).toContain("Needs a decision again");
          /* Still a thread that needs a decision: the state and the pager are unchanged. */
          expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("waiting");
          expect(place()).toBe("1 of 2 needing a decision");
          expect(replyBoxes()).toHaveLength(1);
        });

        it("does not point at Details when the question has none", async () => {
          const plain = { ...askedAgain, body: "It stands alone.", olderActedAnswers: 0 };
          await openThread("q-aaaaaa", { ...ADMIN_REPORTS, questions: [plain, Q2] }, { ...WAITING, questions: [plain, Q2] });
          const shown = thread().querySelector('.fb-question-answer[data-acted="true"]');
          expect(shown?.textContent).toContain("What happened next is written in the question.");
          expect(shown?.textContent).not.toContain("earlier reply");
        });

        it("counts acted and unacted replies, including the older ones not sent", async () => {
          const mixed = {
            ...askedAgain,
            answers: [REPLIED],
            olderAnswers: 2,
            state: "responded" as const,
          };
          await openWaiting({ ...ADMIN_REPORTS, questions: [mixed, Q2] }, { ...WAITING, questions: [mixed, Q2] });
          expect(row("q-aaaaaa").textContent).toContain("you've replied 6×");
        });

        it("reads a server from before 261010g, whose threads have no acted replies", async () => {
          const { actedAnswers: _a, olderActedAnswers: _o, ...v2 } = Q1;
          const { actedAnswers: _b, olderActedAnswers: _p, ...v2b } = Q2;
          await openWaiting({ ...ADMIN_REPORTS, questions: [v2, v2b] }, { ...WAITING, questions: [v2, v2b] });
          expect(panelOf("Earlier").textContent).not.toContain("[fb-list]");
          expect(rows()).toEqual(["q-aaaaaa", "q-bbbbbb"]);
          click(row("q-aaaaaa"));
          expect(thread().querySelector('[data-acted="true"]')).toBeNull();
          expect(thread().querySelector(".fb-earlier-meta")?.textContent).not.toContain("again");
        });

        it("refuses a reply listed as both acted on and not", async () => {
          const both = { ...Q1, answers: [FIRST], actedAnswers: [FIRST], state: "responded" };
          await openWaiting({ ...ADMIN_REPORTS, questions: [both, Q2] }, { ...WAITING, questions: [both, Q2] });
          expect(panelOf("Earlier").textContent).toContain("[fb-list]");
        });
      });

      /* F3, the other direction: a server from before 261008i ignores
         `questions=2` and answers in the six-key shape, which the client maps. */
      it("reads an older server's six-key questions: its reply as the one reply, being considered, and no report text", async () => {
        const legacy = (question: typeof Q1 | typeof Q2, answer: unknown) => ({
          id: question.id,
          title: question.title,
          body: question.body,
          asked: question.asked,
          report: question.report === null ? null : { id: question.report.id, number: question.report.number, firstLine: question.report.firstLine },
          answer,
        });
        const old1 = legacy(Q1, REPLIED);
        const old2 = legacy(Q2, null);
        await openWaiting({ ...ADMIN_REPORTS, questions: [old1, old2] }, { ...WAITING, questions: [old1, old2] });
        expect(panelOf("Earlier").textContent).not.toContain("[fb-list]");
        expect(inGroup("waiting")).toEqual(["q-bbbbbb"]);
        expect(inGroup("responded")).toEqual(["q-aaaaaa"]);
        click(row("q-aaaaaa"));
        expect(thread().querySelector(".fb-question-answer-body")?.textContent).toBe(REPLIED.body);
        expect(thread().querySelector(".fb-earlier-meta")?.textContent).toContain("#214");
        /* It had no report text to send, so there is no Your report. */
        expect(
          [...thread().querySelectorAll("details.fb-question-more summary")].map((s) => s.textContent),
        ).not.toContain("Your report #214");
      });

      it("posts a reply with a minted id, then keeps the thread open, empties the box, and shows You replied", async () => {
        await openThread();
        typeReply("  1A, and do B later  ");
        answer = stored(201);
        click(button(thread(), "Send reply"));
        await settle();

        expect(posts).toHaveLength(1);
        expect(posts[0]?.input).toBe(ANSWERS_PATH);
        expect(posts[0]?.init.method).toBe("POST");
        expect(Object.keys(sent(0)).sort()).toEqual(["body", "id", "question"]);
        expect(sent(0)).toMatchObject({ question: "q-aaaaaa", body: "1A, and do B later" });
        expect(isSpideryarnId(sent(0).id as string)).toBe(true);

        /* Still this thread, an empty box under it, and the reply above it. */
        expect(thread().querySelector<HTMLElement>(".fb-question")?.dataset.question).toBe("q-aaaaaa");
        expect(replyBoxes()).toHaveLength(1);
        expect(replyBoxes()[0]?.value).toBe("");
        const answered = thread().querySelector(".fb-question-answer");
        expect(answered?.textContent).toContain("You replied");
        expect(answered?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-07T09:00:00.000Z");
        expect(answered?.querySelector(".fb-question-answer-body")?.textContent).toBe("1A, and do B later");
        /* Being considered at once: no longer one to decide, but still a stop,
           so Next goes on to the one that is (261009m § 2). */
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("responded");
        expect(place()).toBe("1 needs a decision");
        expect(unavailable(button(thread(), "‹ Previous"))).toBe(true);
        expect(unavailable(button(thread(), "Next ›"))).toBe(false);

        /* A second reply: a new id, and both shown, oldest first. */
        typeReply("one more thing");
        click(button(thread(), "Send reply"));
        await settle();
        expect(posts).toHaveLength(2);
        expect(sent(1).id).not.toBe(sent(0).id);
        expect([...thread().querySelectorAll(".fb-question-answer-body")].map((p) => p.textContent)).toEqual([
          "1A, and do B later",
          "one more thing",
        ]);

        /* And the contents has it under You've replied; the other is untouched. */
        click(button(thread(), "‹ All threads"));
        expect(inGroup("waiting")).toEqual(["q-bbbbbb"]);
        expect(inGroup("responded")).toEqual(["q-aaaaaa"]);
        expect(shortcut()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Needs a decision 1");
      });

      /* F4: a reply just sent stands until a read started after it lands. A
         read that began before the receipt and lands after it must not put
         the thread back in Needs a decision. */
      it("keeps a reply just sent when a read that started before it lands afterwards", async () => {
        const gate: { release?: () => void } = {};
        asAdmin = true;
        const allAnswer = { ...WITH_QUESTIONS };
        listAnswer = (input) =>
          input === ALL_URL
            ? new Promise((resolve) => {
                gate.release = () => resolve(new Response(JSON.stringify(allAnswer), { status: 200 }));
              })
            : page(WAITING)();
        await openEarlier();
        /* All is asked for and has not answered; back to Needs a decision. */
        click(pill("All"));
        await settle();
        expect(lists).toEqual([WAITING_URL, ALL_URL]);
        click(pill("Needs a decision"));
        click(row("q-aaaaaa"));
        typeReply("1A");
        answer = stored(201);
        click(button(thread(), "Send reply"));
        await settle();
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("responded");

        /* The older read lands, saying q-aaaaaa still waits with no reply. */
        await act(async () => gate.release?.());
        await settle();
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("responded");
        click(button(thread(), "‹ All threads"));
        click(pill("All"));
        /* Under All, whose answer is that older read: still one waiting, not two. */
        expect(panelOf("Earlier").querySelectorAll(".fb-earlier-list > li")).toHaveLength(5);
        expect(shortcut()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Needs a decision 1");
        click(pill("Needs a decision"));
        expect(inGroup("responded")).toEqual(["q-aaaaaa"]);
      });

      /* F4, the other half: a read started after the receipt is the server's
         word, so a reply an agent has already acted on is not drawn twice. */
      it("takes a read started after the reply as the server's word: after reopening, and on a filter chosen after the send", async () => {
        await openThread();
        typeReply("1A");
        answer = stored(201);
        click(button(thread(), "Send reply"));
        await settle();
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("responded");

        /* A filter first read after the send: the server says q-aaaaaa waits again (acted on, left open). */
        listAnswer = serve(ADMIN_REPORTS, {
          aside: { ...only(ADMIN_REPORTS, "aside"), questions: [Q1, Q2] },
        });
        click(button(thread(), "‹ All threads"));
        click(pill("Set aside"));
        await settle();
        expect(lists.at(-1)).toBe(url("aside"));
        expect(shortcut()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Needs a decision 2");

        /* And the next opening's read, which started after the send. */
        listAnswer = answerBy({ waiting: WAITING, all: WITH_QUESTIONS });
        reopen();
        click(tab("Earlier"));
        await settle();
        expect(pill("Needs a decision").getAttribute("aria-pressed")).toBe("true");
        expect(inGroup("waiting")).toEqual(["q-aaaaaa", "q-bbbbbb"]);
        expect(group("responded")).toBeNull();
        click(row("q-aaaaaa"));
        expect(thread().querySelector(".fb-question-answer")).toBeNull();
      });

      it("keeps the words when the send fails, and a retry of the same words carries the same id", async () => {
        await openThread();
        typeReply("1A");
        answer = ok(500);
        click(button(thread(), "Send reply"));
        await settle();
        expect(replyBoxes()[0]?.value).toBe("1A");
        expect(thread().textContent).toContain("[fb-reply]");
        expect(thread().querySelector(".fb-question-answer")).toBeNull();
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("waiting");

        answer = stored(200);
        click(button(thread(), "Send reply"));
        await settle();
        expect(posts).toHaveLength(2);
        expect(sent(1).id).toBe(sent(0).id);
        /* A 200 is the stored row of the first try: answered, like a 201. */
        expect(thread().querySelector(".fb-question-answer-body")?.textContent).toBe("1A");
        expect(thread().textContent).not.toContain("[fb-reply]");
      });

      it("gives edited words a new id after a failed send, so the server never sees one id with two bodies", async () => {
        await openThread();
        typeReply("1A");
        answer = async () => {
          throw new Error("offline");
        };
        click(button(thread(), "Send reply"));
        await settle();
        expect(thread().textContent).toContain("[fb-reply]");
        typeReply("1B, on reflection");
        answer = stored(201);
        click(button(thread(), "Send reply"));
        await settle();
        expect(sent(1).id).not.toBe(sent(0).id);
      });

      it("says to reload when the server has no such route (a 404), and keeps the words", async () => {
        await openThread();
        typeReply("1A, typed at length");
        answer = ok(404);
        click(button(thread(), "Send reply"));
        await settle();
        expect(replyBoxes()[0]?.value).toBe("1A, typed at length");
        expect(thread().textContent).toContain("[fb-reply-stale]");
        expect(thread().textContent).toMatch(/reload/i);
      });

      it("treats a 2xx without a well-formed reply in it as not sent", async () => {
        await openThread();
        typeReply("1A");
        answer = ok(201);
        click(button(thread(), "Send reply"));
        await settle();
        expect(thread().textContent).toContain("[fb-reply]");
        expect(replyBoxes()[0]?.value).toBe("1A");
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("waiting");
      });

      it("treats a reply receipt with a field more as not sent", async () => {
        await openThread();
        typeReply("1A");
        answer = async () => {
          const request = sent(0);
          return new Response(
            JSON.stringify({
              answer: { id: request.id, body: request.body, createdAt: "2026-10-07T09:00:00.000Z" },
              environment: "production",
            }),
            { status: 201 },
          );
        };
        click(button(thread(), "Send reply"));
        await settle();
        expect(thread().textContent).toContain("[fb-reply]");
        expect(replyBoxes()[0]?.value).toBe("1A");
      });

      it("treats a well-formed receipt for different words as not sent", async () => {
        await openThread();
        typeReply("1A");
        answer = async () => {
          const request = sent(0);
          return new Response(
            JSON.stringify({ answer: { id: request.id, body: "different words", createdAt: "2026-10-07T09:00:00.000Z" } }),
            { status: 201 },
          );
        };
        click(button(thread(), "Send reply"));
        await settle();
        expect(thread().textContent).toContain("[fb-reply]");
        expect(replyBoxes()[0]?.value).toBe("1A");
        expect(thread().querySelector(".fb-question-answer")).toBeNull();
      });

      it("sends nothing empty, nothing over the cap, and one reply for two presses", async () => {
        await openThread();
        expect(button(thread(), "Send reply").disabled).toBe(true);
        typeReply("   ");
        expect(button(thread(), "Send reply").disabled).toBe(true);
        typeReply("x".repeat(MAX_FEEDBACK_ANSWER_CHARS + 1));
        expect(button(thread(), "Send reply").disabled).toBe(true);
        expect(thread().textContent).toContain(`the limit is ${MAX_FEEDBACK_ANSWER_CHARS}`);
        typeReply("1A");
        const gate: { release?: () => void } = {};
        answer = () =>
          new Promise((resolve) => {
            gate.release = () =>
              resolve(new Response(JSON.stringify({ answer: { id: sent(0).id, body: "1A", createdAt: "2026-10-07T09:00:00.000Z" } }), { status: 201 }));
          });
        const sendButton = button(thread(), "Send reply");
        click(sendButton);
        click(sendButton);
        expect(posts).toHaveLength(1);
        await act(async () => gate.release?.());
        await settle();
        expect(thread().querySelector(".fb-question-answer")).not.toBeNull();
      });

      /* Decision 3 (spya-t6nmxt): "not now", reversible, a timestamp. */
      it("defers a thread, and brings it back, with exactly the question and whether", async () => {
        await openThread();
        answer = deferral();
        click(button(thread(), "Defer for now"));
        await settle();
        expect(posts).toHaveLength(1);
        expect(posts[0]?.input).toBe(DEFERRALS_PATH);
        expect(posts[0]?.init.method).toBe("POST");
        expect(sent(0)).toEqual({ question: "q-aaaaaa", deferred: true });
        /* Deferred at once: the word, the line under it, and the way back. */
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("deferred");
        expect(thread().textContent).toMatch(/Deferred .*No agent will chase it/);
        expect(hasButton(thread(), "Bring back")).toBe(true);
        expect(hasButton(thread(), "Defer for now")).toBe(false);
        click(button(thread(), "‹ All threads"));
        expect(inGroup("deferred")).toEqual(["q-aaaaaa"]);
        expect(inGroup("waiting")).toEqual(["q-bbbbbb"]);
        expect(shortcut()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Needs a decision 1");

        click(row("q-aaaaaa"));
        click(button(thread(), "Bring back"));
        await settle();
        expect(sent(1)).toEqual({ question: "q-aaaaaa", deferred: false });
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("waiting");
        expect(hasButton(thread(), "Defer for now")).toBe(true);
        click(button(thread(), "‹ All threads"));
        expect(inGroup("waiting")).toEqual(["q-aaaaaa", "q-bbbbbb"]);
        expect(group("deferred")).toBeNull();
      });

      it("brings a deferred thread back to being considered when it has a reply not yet acted on", async () => {
        const deferred = { ...Q1, answers: [REPLIED], state: "deferred", deferredAt: "2026-10-08T07:00:00.000Z" };
        await openThread("q-aaaaaa", { ...ADMIN_REPORTS, questions: [deferred, Q2] }, { ...WAITING, questions: [deferred, Q2] });
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("deferred");
        answer = deferral();
        click(button(thread(), "Bring back"));
        await settle();
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("responded");
      });

      /* F2: the latest action wins, so a reply sent from a deferred thread moves it to being considered. */
      it("moves a deferred thread to being considered when a reply is sent from it", async () => {
        await openThread();
        answer = deferral();
        click(button(thread(), "Defer for now"));
        await settle();
        typeReply("Actually, A.");
        answer = stored(201);
        click(button(thread(), "Send reply"));
        await settle();
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("responded");
      });

      it("does not start a reply while a deferral is still in flight through the keyboard path", async () => {
        await openThread();
        typeReply("Actually, A.");
        const gate: { release?: () => void } = {};
        answer = () => {
          const last = posts.at(-1);
          if (last?.input === DEFERRALS_PATH) {
            return new Promise((resolve) => {
              gate.release = () =>
                resolve(
                  new Response(
                    JSON.stringify({ question: "q-aaaaaa", deferredAt: "2026-10-08T09:30:00.000Z" }),
                    { status: 200 },
                  ),
                );
            });
          }
          const posted = JSON.parse(String(last?.init.body)) as { id: string; body: string };
          return Promise.resolve(
            new Response(
              JSON.stringify({ answer: { id: posted.id, body: posted.body, createdAt: "2026-10-08T09:31:00.000Z" } }),
              { status: 201 },
            ),
          );
        };
        click(button(thread(), "Defer for now"));
        act(() => {
          replyBoxes()[0]?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
          );
        });
        expect(posts).toHaveLength(1);
        await act(async () => gate.release?.());
        await settle();
      });

      it("accepts the deferral state now stored when another request superseded this one", async () => {
        await openThread();
        answer = async () =>
          new Response(JSON.stringify({ question: "q-aaaaaa", deferredAt: null }), { status: 200 });
        click(button(thread(), "Defer for now"));
        await settle();
        expect(thread().textContent).not.toContain("[fb-defer]");
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("waiting");
      });

      it("says a settled question is settled on a 409, and that it did not get through otherwise; nothing changes", async () => {
        await openThread();
        answer = ok(409);
        click(button(thread(), "Defer for now"));
        await settle();
        expect(thread().textContent).toContain("[fb-defer-settled]");
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("waiting");

        answer = ok(500);
        click(button(thread(), "Defer for now"));
        await settle();
        expect(thread().textContent).toContain("[fb-defer]");
        expect(thread().textContent).not.toContain("[fb-defer-settled]");
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("waiting");

        answer = async () => {
          throw new Error("offline");
        };
        click(button(thread(), "Defer for now"));
        await settle();
        expect(thread().textContent).toContain("[fb-defer]");
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("waiting");
      });

      it.each([
        ["no deferredAt field", { question: "q-aaaaaa" }],
        ["a time that is not one", { question: "q-aaaaaa", deferredAt: "soon" }],
        ["another question", { question: "q-bbbbbb", deferredAt: "2026-10-08T09:30:00.000Z" }],
        ["a field more", { question: "q-aaaaaa", deferredAt: "2026-10-08T09:30:00.000Z", state: "deferred" }],
        ["nothing at all", null],
      ])("treats a deferral receipt with %s as not done", async (_case, receipt) => {
        await openThread();
        answer = async () => new Response(JSON.stringify(receipt), { status: 200 });
        click(button(thread(), "Defer for now"));
        await settle();
        expect(thread().textContent).toContain("[fb-defer]");
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("waiting");
        expect(hasButton(thread(), "Defer for now")).toBe(true);
      });

      /* F11: a deferral stands like a reply, until a read started after it. */
      it("keeps a deferral just made when a read that started before it lands afterwards", async () => {
        const gate: { release?: () => void } = {};
        asAdmin = true;
        listAnswer = (input) =>
          input === ALL_URL
            ? new Promise((resolve) => {
                gate.release = () => resolve(new Response(JSON.stringify(WITH_QUESTIONS), { status: 200 }));
              })
            : page(WAITING)();
        await openEarlier();
        click(pill("All"));
        await settle();
        click(pill("Needs a decision"));
        click(row("q-aaaaaa"));
        answer = deferral();
        click(button(thread(), "Defer for now"));
        await settle();
        await act(async () => gate.release?.());
        await settle();
        expect(thread().querySelector(".fb-question")?.getAttribute("data-state")).toBe("deferred");
        click(button(thread(), "‹ All threads"));
        click(pill("All"));
        expect(shortcut()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Needs a decision 1");
      });

      /* Decision 8 and F7 (spya-t6nmxt): a button beside the two tabs, not a third tab. */
      it("puts a Needs a decision shortcut beside the tabs, with the waiting count and a title that says the rest", async () => {
        asAdmin = true;
        const all = [Q1, Q2, Q3, Q4];
        listAnswer = answerBy({ waiting: { ...WAITING, questions: all }, all: { ...ADMIN_REPORTS, questions: all } });
        mount();
        await settle();
        const found = shortcut();
        expect(found).not.toBeNull();
        expect(found?.getAttribute("role")).toBeNull();
        expect(found?.type).toBe("button");
        expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
        expect(found?.closest('[role="tablist"]')).not.toBeNull();
        expect(found?.textContent?.replace(/\s+/g, " ").trim()).toBe("Needs a decision 2");
        expect(found?.getAttribute("title")).toBe(
          "2 need a decision · newest asked 8 Oct 2026 · 1 you've replied to · 1 deferred",
        );
        /* On Write it is not pressed. */
        expect(found?.getAttribute("aria-pressed")).toBe("false");
      });

      it("does not restore the shortcut from a retained draft before the next opening read lands", async () => {
        await openThread();
        typeReply("a decision in progress");
        show(false);

        const gate: { release?: () => void } = {};
        listAnswer = (input) =>
          input === WAITING_URL
            ? new Promise((resolve) => {
                gate.release = () => resolve(new Response(JSON.stringify({ ...WAITING, questions: [Q2] }), { status: 200 }));
              })
            : serve({ ...WITH_QUESTIONS, questions: [Q2] })(input);
        show(true);

        expect(gate.release).toBeTypeOf("function");
        expect(shortcut()).toBeNull();
        await act(async () => gate.release?.());
        await settle();
        expect(shortcut()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Needs a decision 1");
      });

      it("takes the reader from Write straight to Needs a decision's contents, even from inside a thread", async () => {
        await openThread();
        click(tab("Write"));
        expect(shortcut()?.getAttribute("aria-pressed")).toBe("false");
        click(shortcut());
        expect(tab("Earlier").getAttribute("aria-selected")).toBe("true");
        expect(panelOf("Earlier").hidden).toBe(false);
        expect(shortcut()?.getAttribute("aria-pressed")).toBe("true");
        expect(panelOf("Earlier").querySelector(".fb-thread")).toBeNull();
        expect(rows()).toEqual(["q-aaaaaa", "q-bbbbbb"]);
        expect(pill("Needs a decision").getAttribute("aria-pressed")).toBe("true");
        /* From All too; and pressed only while that filter shows. */
        click(pill("All"));
        await settle();
        expect(shortcut()?.getAttribute("aria-pressed")).toBe("false");
        click(shortcut());
        expect(pill("Needs a decision").getAttribute("aria-pressed")).toBe("true");
      });

      it("shows the shortcut to nobody who is not an admin", async () => {
        asAdmin = false;
        listAnswer = page({ ...REPORTS, questions: [Q1] });
        await openEarlier();
        expect(shortcut()).toBeNull();
        expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
      });

      /* F8: the reader's choice wins over the opening's move to All. */
      it("leaves a filter the reader chose before the opening's read landed where it is, even when nothing waits", async () => {
        asAdmin = true;
        const gate: { release?: () => void } = {};
        listAnswer = (input) =>
          input === WAITING_URL
            ? new Promise((resolve) => {
                gate.release = () => resolve(new Response(JSON.stringify(only(ADMIN_REPORTS, "waiting")), { status: 200 }));
              })
            : serve(ADMIN_REPORTS)(input);
        mount();
        click(tab("Earlier"));
        expect(pill("Needs a decision").getAttribute("aria-pressed")).toBe("true");
        /* The same filter, chosen: still a choice. */
        click(pill("Needs a decision"));
        await act(async () => gate.release?.());
        await settle();
        expect(pill("Needs a decision").getAttribute("aria-pressed")).toBe("true");
        expect(lists).toEqual([WAITING_URL]);
        /* No thread at all: what is left is the report no question is about. */
        expect(rows()).toHaveLength(0);
        expect(
          [...panelOf("Earlier").querySelectorAll(".fb-orphans .fb-earlier-list > li .fb-earlier-number")].map((n) => n.textContent),
        ).toEqual(["#214"]);
      });

      it("leaves another pill chosen before the opening's read landed where it is", async () => {
        asAdmin = true;
        const gate: { release?: () => void } = {};
        listAnswer = (input) =>
          input === WAITING_URL
            ? new Promise((resolve) => {
                gate.release = () => resolve(new Response(JSON.stringify(only(ADMIN_REPORTS, "waiting")), { status: 200 }));
              })
            : serve(ADMIN_REPORTS)(input);
        mount();
        click(tab("Earlier"));
        click(pill("Set aside"));
        await settle();
        await act(async () => gate.release?.());
        await settle();
        expect(pill("Set aside").getAttribute("aria-pressed")).toBe("true");
        expect(lists).toEqual([WAITING_URL, url("aside")]);
      });

      it("goes back to the opening default when shut: Needs a decision when a thread waits, whatever was chosen", async () => {
        asAdmin = true;
        listAnswer = serve(ADMIN_REPORTS);
        await openEarlier();
        expect(pill("All").getAttribute("aria-pressed")).toBe("true");
        click(pill("Shipped"));
        await settle();
        listAnswer = answerBy({ waiting: WAITING, all: WITH_QUESTIONS });
        reopen();
        click(tab("Earlier"));
        await settle();
        expect(pill("Needs a decision").getAttribute("aria-pressed")).toBe("true");
        expect(rows()).toEqual(["q-aaaaaa", "q-bbbbbb"]);
      });

      /* Decision 5: one box, one microphone, at a time; each thread keeps its own draft. */
      it("has one reply box at a time, and keeps each thread's draft when moving between them", async () => {
        await openThread();
        expect(replyBoxes()).toHaveLength(1);
        typeReply("half a thought");
        click(button(thread(), "Next ›"));
        expect(replyBoxes()).toHaveLength(1);
        expect(replyBoxes()[0]?.value).toBe("");
        typeReply("another");
        click(button(thread(), "‹ Previous"));
        expect(replyBoxes()[0]?.value).toBe("half a thought");
        click(button(thread(), "‹ All threads"));
        expect(replyBoxes()).toHaveLength(0);
        click(row("q-bbbbbb"));
        expect(replyBoxes()[0]?.value).toBe("another");
      });

      it("gives the reply box its own microphone: its own keeper, off the article, and Send off while it is busy", async () => {
        await openThread();
        expect(thread().querySelector(".mock-mic")).not.toBeNull();
        expect(replyMicUses.at(-1)).toEqual({ keep: "feedback-reply:q-aaaaaa", doneKey: "reply:q-aaaaaa", context: { kind: "profile" } });
        typeReply("said out loud");
        expect(button(thread(), "Send reply").disabled).toBe(false);

        replyMic.armed = true;
        typeReply("said out loud.");
        expect(button(thread(), "Send reply").disabled).toBe(true);
        /* And the guard is the function's too: a double press on Stop asks it directly. */
        act(() => replyMicDone?.());
        await settle();
        expect(posts).toHaveLength(0);

        replyMic.armed = false;
        replyMic.transcribing = true;
        typeReply("said out loud");
        expect(button(thread(), "Send reply").disabled).toBe(true);
        expect(replyBoxes()[0]?.readOnly).toBe(true);

        /* Not busy: a double press on Stop sends, as the button would. */
        replyMic.transcribing = false;
        typeReply("said out loud, done");
        answer = stored(201);
        act(() => replyMicDone?.());
        await settle();
        expect(posts).toHaveLength(1);
        expect(sent(0).body).toBe("said out loud, done");
      });

      it("stops the reply box's microphone on the way to Write, and when the dialog is shut", async () => {
        await openThread();
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
        await openThread();
        replyMic.armed = true;
        typeReply("talking");
        click(button(thread(), "Next ›"));
        click(button(thread(), "‹ Previous"));
        expect(replyMicToggles).toEqual([]);
      });

      it("holds the page against a reload while a reply is half-written", async () => {
        await openThread();
        expect(reloadVeto()).toBeNull();
        typeReply("half a reply");
        expect(reloadVeto()).not.toBeNull();
        /* Out of sight in another thread, still held. */
        click(button(thread(), "‹ All threads"));
        expect(reloadVeto()).not.toBeNull();
        click(row("q-aaaaaa"));
        answer = stored(201);
        click(button(thread(), "Send reply"));
        await settle();
        expect(reloadVeto()).toBeNull();
      });

      it("keeps a draft reachable when a refreshed question list no longer contains it", async () => {
        await openThread();
        typeReply("a decision in progress");

        show(false);
        listAnswer = answerBy({ waiting: { ...WAITING, questions: [Q2] }, all: { ...WITH_QUESTIONS, questions: [Q2] } });
        show(true);
        click(tab("Earlier"));
        await settle();

        /* The server's count is the server's: one thread waiting on a decision. */
        if (panelOf("Earlier").querySelector(".fb-thread")) click(button(thread(), "‹ All threads"));
        expect(pills()).toContain("Needs a decision 1 · 1 to decide");
        expect(rows()).toContain("q-aaaaaa");
        expect(rows()).toContain("q-bbbbbb");
        expect(inGroup("waiting")).toEqual(["q-bbbbbb"]);
        expect(inGroup("retained")).toEqual(["q-aaaaaa"]);
        expect(shortcut()?.getAttribute("title")).toMatch(/^1 needs a decision/);
        expect(
          [...panelOf("Earlier").querySelectorAll(".fb-orphans .fb-earlier-number")].map((number) => number.textContent),
        ).toEqual(["#214"]);
        click(row("q-aaaaaa"));
        expect(replyBoxes()[0]?.value).toBe("a decision in progress");
        /* Kept only for its draft, so not one to decide although its stale state
           says waiting, and it sits after every live thread (261009m § 2). */
        expect(place()).toBe("1 needs a decision");
        expect(unavailable(button(thread(), "Next ›"))).toBe(true);
        click(button(thread(), "‹ Previous"));
        expect(showing()).toBe("q-bbbbbb");
        expect(place()).toBe("1 of 1 needing a decision");
      });

      it("keeps the reply box mounted while closing during transcription", async () => {
        await openThread();
        replyMic.transcribing = true;
        show(true);
        expect(replyBoxes()[0]?.readOnly).toBe(true);

        show(false);

        expect(replyBoxes()).toHaveLength(1);
        expect(questionsBox()?.hidden).toBe(true);
      });

      /* Each is the opening's Needs a decision answer; an answer that fails is
         the failure sentence, never some of the threads. */
      it.each([
        ["no questions key at all", (({ questions: _dropped, ...rest }) => rest)(WAITING)],
        ["questions that are not a list", { ...WAITING, questions: {} }],
        ["a question id of the wrong shape", { ...WAITING, questions: [{ ...Q1, id: "spya-a2b2c3" }] }],
        ["the same question twice", { ...WAITING, questions: [Q1, Q1] }],
        ["a title that is not text", { ...WAITING, questions: [{ ...Q1, title: { html: "x" } }] }],
        ["a title over the cap", { ...WAITING, questions: [{ ...Q1, title: "x".repeat(121) }] }],
        ["a body over the cap", { ...WAITING, questions: [{ ...Q1, body: "x".repeat(MAX_FEEDBACK_QUESTION_BODY_CHARS + 1) }] }],
        ["a date that is not one", { ...WAITING, questions: [{ ...Q1, asked: "last week" }] }],
        ["a linked report without a number", { ...WAITING, questions: [{ ...Q1, report: { id: "spya-a2b2c3", firstLine: "x", body: "x" } }] }],
        ["a linked report with no body key", { ...WAITING, questions: [{ ...Q1, report: { id: "spya-a2b2c3", number: 214, firstLine: "x" } }] }],
        ["a reply that is not text", { ...WAITING, questions: [{ ...Q1, answers: [{ id: "spya-a9b2c3", body: 7, createdAt: "2026-10-06T18:30:00.000Z" }] }] }],
        ["a reply with no time", { ...WAITING, questions: [{ ...Q1, answers: [{ id: "spya-a9b2c3", body: "x", createdAt: "soon" }] }] }],
        ["a reply with a field more", { ...WAITING, questions: [{ ...Q1, answers: [{ ...REPLIED, environment: "production" }] }] }],
        ["answers that are not a list", { ...WAITING, questions: [{ ...Q1, answers: REPLIED }] }],
        ["older replies that are not a count", { ...WAITING, questions: [{ ...Q1, olderAnswers: -1 }] }],
        ["an acted reply that is not valid", { ...WAITING, questions: [{ ...Q1, actedAnswers: [{ ...REPLIED, createdAt: "soon" }] }] }],
        ["the same acted reply twice", { ...WAITING, questions: [{ ...Q1, actedAnswers: [REPLIED, REPLIED] }] }],
        ["older acted replies that are not a count", { ...WAITING, questions: [{ ...Q1, olderActedAnswers: -1 }] }],
        ["a state it does not know", { ...WAITING, questions: [{ ...Q1, state: "answered" }] }],
        ["deferred without a time", { ...WAITING, questions: [{ ...Q1, state: "deferred", deferredAt: null }] }],
        ["a deferral time on a waiting question", { ...WAITING, questions: [{ ...Q1, deferredAt: "2026-10-08T07:00:00.000Z" }] }],
        ["an agent-only field on a question", { ...WAITING, questions: [{ ...Q1, refs: "qi-8qvg5gwv" }] }],
        [
          "a server before 261010g's question with a field more",
          {
            ...WAITING,
            questions: [{
              ...((({ actedAnswers: _a, olderActedAnswers: _o, ...v2 }) => v2)(Q2)),
              refs: "qi-8qvg5gwv",
            }],
          },
        ],
        [
          "an older server's question with a field more",
          {
            ...WAITING,
            questions: [{ id: Q2.id, title: Q2.title, body: Q2.body, asked: Q2.asked, report: null, answer: null, refs: "qi-8qvg5gwv" }],
          },
        ],
        [
          "an older server's reply with a field more",
          {
            ...WAITING,
            questions: [{
              id: Q2.id,
              title: Q2.title,
              body: Q2.body,
              asked: Q2.asked,
              report: null,
              answer: { ...REPLIED, environment: "production" },
            }],
          },
        ],
      ])("refuses an admin answer with %s: the failure sentence, no rows and no threads", async (_case, body) => {
        asAdmin = true;
        listAnswer = page(body);
        await openEarlier();
        expect(lists).toEqual([WAITING_URL]);
        expect(panelOf("Earlier").textContent).toContain("[fb-list]");
        expect(panelOf("Earlier").querySelectorAll("li")).toHaveLength(0);
        expect(rows()).toHaveLength(0);
        expect(shortcut()).toBeNull();
        expect(pills().join(" ")).not.toContain("to decide");
      });

      it("shows no questions to a reader who is not an admin, whatever the answer carries", async () => {
        asAdmin = false;
        listAnswer = page({ ...REPORTS, questions: [Q1] });
        await openEarlier();
        expect(lists).toEqual(["/api/feedback"]);
        expect(rows()).toHaveLength(0);
        expect(panelOf("Earlier").querySelector(".fb-question")).toBeNull();
        expect(pills().join(" ")).not.toContain("to decide");
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
