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
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isSpideryarnId } from "../src/ids.js";
import { MAX_FEEDBACK_ANSWER_CHARS } from "../src/types.js";

const posts: { input: string; init: RequestInit }[] = [];
let answer: () => Promise<Response>;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string, init: RequestInit) => {
    posts.push({ input, init });
    return answer();
  },
  failure: async (res: Response) => new Error(await res.text()),
}));

vi.mock("../src/web/router.js", () => ({
  useRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
}));

/**
 * **The microphone, as two booleans and a spy.**
 *
 * The real hook opens a device and reads a Floating UI tooltip; neither is what
 * this file is about. What is: that Send refuses while either boolean is true,
 * and that closing the dialog calls `toggle` — the guards GPT Sol's review of
 * the plan asked for, both of which pass by accident if the mock is a constant.
 */
const mic = { supported: true, armed: false, transcribing: false };
const micToggles: string[] = [];
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: {
      ...mic,
      toggle: () => {
        micToggles.push("hook");
      },
    },
    readOnly: mic.transcribing,
    toggle: () => {
      micToggles.push("field");
    },
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => createElement("button", { type: "button" }, "mic"),
  DictationStrip: () => null,
}));

/* Re-encoding an image needs a canvas, which jsdom does not have. What matters
   here is only *when* it finishes, so the stub is a promise this file resolves. */
let finishShot: ((base64: string) => void) | null = null;
vi.mock("../src/web/feedback-screenshot.js", () => ({
  screenshotFromFile: () =>
    new Promise((resolve) => {
      finishShot = (base64: string) =>
        resolve({ ok: true, base64, width: 800, height: 600, bytes: 1000 });
    }),
  imageFileFromPaste: () => null,
  imageFileFromDrop: () => null,
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

let host: HTMLDivElement;
let root: Root;

function ok(status: number): () => Promise<Response> {
  return async () => new Response(JSON.stringify({ id: "x" }), { status });
}

function show(open: boolean) {
  act(() => {
    root.render(
      createElement(FeedbackDialog, {
        open,
        onClose: () => {},
        readerEmail: "reader@example.com",
        where: { url: "https://www.spideryarn.com/read/a-piece?q=footnotes", slug: "a-piece" },
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

/** Shut it the way Escape or the backdrop does, then open it again. */
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
  posts.length = 0;
  answer = ok(201);
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
    expect(host.querySelector(".fb-done")).not.toBeNull();

    /* Close from the thank-you panel — the one exit that starts a new report. */
    const close = host.querySelector<HTMLButtonElement>(".fb-done button");
    act(() => close?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
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
    const close = host.querySelector<HTMLButtonElement>(".fb-done button");
    act(() => close?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    show(false);
    show(true);

    // A third report, half typed, not sent.
    type("A completely different bug.");
    expect(host.querySelector(".fb-done")).toBeNull();

    // Now the abandoned request finally answers.
    await act(async () => {
      settle?.(new Response("{}", { status: 201 }));
    });

    expect(host.querySelector(".fb-done"), "a stale send painted over a live draft").toBeNull();
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
    expect(host.querySelector(".fb-done"), "the retry should have been filed").not.toBeNull();

    /* Only now does the first attempt come back, and it failed. */
    await act(async () => {
      settleFirst?.(new Response("nope", { status: 500 }));
    });
    expect(
      host.querySelector(".fb-done"),
      "an older attempt overwrote a newer success",
    ).not.toBeNull();
    expect(host.querySelector(".fb-failed")).toBeNull();
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
});
