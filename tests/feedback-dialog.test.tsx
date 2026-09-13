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
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_EMAIL } from "../src/admin.js";
import { isSpideryarnId } from "../src/ids.js";
import { CONTACT_EMAIL } from "../src/site-text.js";
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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  function Harness() {
    const [open, setOpen] = useState(true);
    return createElement(FeedbackDialog, {
      open,
      onClose: () => setOpen(false),
      where: { url: "https://www.spideryarn.com/read/a-piece", slug: "a-piece" },
    });
  }
  act(() => root.render(createElement(Harness)));
  const dialog = host.querySelector("dialog");
  if (!dialog) throw new Error("no dialog");
  return dialog;
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
    expect(words).toContain("may also send the file the article was made from");
    expect(words).toContain("within a size limit");
    expect(words).toContain("what you've told us about yourself");
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
  /** The sentence in the `.fb-done` panel, whitespace-collapsed. */
  function thanks(): string {
    const panel = host.querySelector(".fb-done p");
    if (!panel) throw new Error("no thank-you panel");
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

  /**
   * **Close is instant, and this is what "instant" turned out to mean.**
   *
   * Greg, 2026-09-05: *"when I click close on the thank you that is filed, there
   * shouldn't be a delay, it should happen instantly."*
   *
   * Nothing was slow. The button called `discard()` and `onClose()` together, so
   * one commit emptied the form *and* asked for the dialog to shut — and the
   * emptied form is what the browser painted, because the shutting was a passive
   * effect and those run after the paint. The reader saw a blank feedback form
   * flash up in place of the thank-you they were dismissing.
   *
   * **jsdom cannot see a paint**, so a test that waited a microtask and read
   * `dialog.open` was green before the fix as well as after — it was written,
   * watched pass against the bug, and thrown away. docs/reusable/silent-success.md.
   * What *is* observable is the order the DOM changes in, so that is what this
   * pins: at the moment `close()` is called, the thank-you must still be on
   * screen. Under the old arrangement the form had already replaced it.
   */
  it("shuts before it empties the panel, so nothing is drawn on the way out", async () => {
    mountControlled();
    type("Something happened.");
    send();
    await act(async () => {});

    const proto = window.HTMLDialogElement.prototype;
    const real = proto.close;
    const onScreenWhenItShut: boolean[] = [];
    proto.close = function close(this: HTMLDialogElement) {
      onScreenWhenItShut.push(host.querySelector(".fb-done") !== null);
      real.call(this);
    };
    try {
      const button = host.querySelector<HTMLButtonElement>(".fb-done button");
      if (!button) throw new Error("no Close");
      act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    } finally {
      proto.close = real;
    }

    expect(onScreenWhenItShut).toEqual([true]);
    /* And it did empty afterwards — otherwise the assertion above is satisfied
       by a Close button that does nothing at all. */
    expect(firstBox().value).toBe("");
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

    const button = host.querySelector<HTMLButtonElement>(".fb-done button");
    if (!button) throw new Error("no Close");
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(firstBox().value).toBe("The first thing. And another.");
    /* And it is a new report, not a second send of the one already filed. */
    answer = ok(201);
    send();
    await act(async () => {});
    expect(idOf(1)).not.toBe(idOf(0));
    expect(body().body).toBe("The first thing. And another.");
  });

  /**
   * **A report filed while nobody was looking is not dismissed.**
   *
   * Close the dialog mid-flight and the request goes on; when it lands, `stage`
   * becomes `sent` with `open` already false. Without the `thanksSeen` guard the
   * reset effect fires there, and the reader reopens onto an empty box with no
   * way to tell whether their report went.
   */
  it("shows the thank-you next time when the send landed after they left", async () => {
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

    expect(host.querySelector(".fb-done")).not.toBeNull();
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

    /* The report lands and the reader dismisses the thank-you, all while the
       picture is still being re-encoded. */
    act(() => release?.());
    await act(async () => {});
    const button = host.querySelector<HTMLButtonElement>(".fb-done button");
    if (!button) throw new Error("no Close");
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    /* Only now does the conversion finish. It belongs to a report that is filed
       and gone, so it must not land on the one that replaced it. */
    await act(async () => {
      finishShot?.("bGF0ZQ==");
    });

    expect(host.querySelector(".fb-shot-have")).toBeNull();
  });

  /**
   * **Every way out of the thank-you starts the next report**, not only the
   * button — Escape, the ✕ and the backdrop all merely flip `open`.
   *
   * Before the reordering above, those three left `stage` at `sent`: the next
   * press of Feedback opened on a stale thank-you for a report filed some time
   * ago, with the old draft still behind it.
   */
  it("does not come back showing the last report's thank-you", async () => {
    mount();
    type("Something happened.");
    send();
    await act(async () => {});
    expect(host.querySelector(".fb-done")).not.toBeNull();

    reopen();

    expect(host.querySelector(".fb-done")).toBeNull();
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
