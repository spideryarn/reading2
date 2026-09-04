// @vitest-environment jsdom
/**
 * **The other half of tests/what-the-enter-key-promises.test.tsx.**
 *
 * That file sweeps the source and asks whether every text box has *decided* what
 * its Enter key says — which is the omission guard, and it is worth having. What
 * it cannot do is press the key. Its "labels no textarea Send unless Enter
 * really sends" case compares one list of names to another, so deleting the
 * handler and keeping the attribute leaves it green, and a keyboard would then
 * say Send over a key that inserts a newline. GPT Sol, 2026-09-04, finding 5.
 *
 * So this file mounts the real components and presses the real key.
 *
 * **What jsdom can and cannot do here**, because the difference decides the
 * shape of every case below. It dispatches key events and React's handlers run,
 * so anything our own `onKeyDown` does — `preventDefault`, moving focus, calling
 * `submit` — is directly observable. It does **not** implement a form's implicit
 * submission, so "Enter in a single-line field submits the form" is the
 * platform's promise and not ours; where a box relies on it, what is asserted is
 * the submit handler itself, and the `enterKeyHint` sweep is what pins the
 * promise on the box. The same honesty the Feedback dialog's `showModal` stub
 * is written with.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientComment } from "../src/web/useComments.js";

/* ------------------------------------------------------------- the mocks -- */

/**
 * **The microphone, as two booleans**, so a test can put the box in each of the
 * states that must refuse to send. The real hook opens a device.
 */
const mic = { supported: true, armed: false, transcribing: false };
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { ...mic, toggle: () => {} },
    readOnly: mic.transcribing,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));

vi.mock("../src/web/router.js", () => ({
  useRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
  parseRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
}));

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async () => new Response("{}", { status: 200 }),
  fetchOk: async () => new Response(null, { status: 200 }),
  readJson: async () => ({}),
  failure: async (res: Response) => new Error(await res.text()),
}));

/** What the sign-in form would call. Recorded rather than run. */
const signIns: { email: string; password: string }[] = [];
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      signInWithPassword: async (creds: { email: string; password: string }) => {
        signIns.push(creds);
        return { data: {}, error: null };
      },
      signInWithOAuth: async () => ({ data: {}, error: null }),
    },
  },
  googleSignInAvailable: false,
  callbackUrl: () => "https://example.com/auth",
}));

const { Composer } = await import("../src/web/ChatPanel.js");
const { CommentDialog } = await import("../src/web/CommentDialog.js");
const { SignInControls } = await import("../src/web/SignInControls.js");

/* ----------------------------------------------------------- the harness -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mic.armed = false;
  mic.transcribing = false;
  signIns.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * Type into a controlled box the way a person does.
 *
 * React tracks the last value it wrote on the node, so assigning `.value`
 * directly is swallowed as a no-op; the setter off the prototype is the standard
 * way round it. Same helper as tests/feedback-dialog.test.tsx.
 */
function type(el: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Press a key, and hand back the event so a case can ask what became of it. */
function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

/* ------------------------------------------------- the chat composer box -- */

/**
 * `chat-input` — the box the whole app's Enter-sends convention is named after,
 * and the one Greg's report reached through the Feedback dialog.
 */
describe("the chat composer", () => {
  const sent: string[] = [];

  function mount(busy: boolean): HTMLTextAreaElement {
    sent.length = 0;
    act(() => {
      root.render(
        createElement(Composer, {
          slug: "a-piece",
          onSend: (question: string) => sent.push(question),
          busy,
          focusNonce: 0,
          focused: { current: 0 },
          draft: "",
          onDraft: () => {},
        }),
      );
    });
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    if (!box) throw new Error("no composer");
    return box;
  }

  const sendButton = () => host.querySelector<HTMLButtonElement>("button.chat-send");

  it("sends on Enter, which is what its keyboard says it will do", () => {
    const box = mount(false);
    type(box, "Why does the hippocampus care?");
    const e = press(box, "Enter");

    expect(sent).toEqual(["Why does the hippocampus care?"]);
    /* And the newline is prevented, or the question is sent *and* a blank line
       is left in a box the reader thinks is empty. */
    expect(e.defaultPrevented).toBe(true);
  });

  it("writes a newline on Shift+Enter, and sends nothing", () => {
    const box = mount(false);
    type(box, "Two paragraphs");
    const e = press(box, "Enter", { shiftKey: true });

    expect(sent).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });

  it("sends nothing from an empty box", () => {
    const box = mount(false);
    press(box, "Enter");

    expect(sent).toEqual([]);
  });

  /**
   * **Busy is the answer still arriving.** Enter then would queue a second
   * question against a conversation that already has one in flight.
   */
  it("sends nothing while an answer is arriving", () => {
    const box = mount(true);
    type(box, "And another thing");
    press(box, "Enter");

    expect(sent).toEqual([]);
  });

  /**
   * **The two microphone states, which is the race Enter created.**
   *
   * `transcribing` is the two seconds after the reader presses stop — sending
   * then posts the recogniser's rough guess a moment before the good words land.
   * `armed` is the microphone still on, and it is the one the sweep's decision
   * table could never have found: pressing a key labelled Send mid-sentence
   * posted Chrome's live guesses and left the microphone running. GPT Sol,
   * 2026-09-04, finding 3. docs/project/dictation.md § Adding it to a box.
   */
  it("sends nothing while the microphone is on, and does not offer to", () => {
    mic.armed = true;
    const box = mount(false);
    type(box, "half a sentence");
    press(box, "Enter");

    expect(sent).toEqual([]);
    expect(sendButton()?.disabled, "Send looks pressable while recording").toBe(true);
  });

  it("sends nothing while the transcript is on its way", () => {
    mic.transcribing = true;
    const box = mount(false);
    type(box, "half a sentence");
    press(box, "Enter");

    expect(sent).toEqual([]);
    expect(sendButton()?.disabled).toBe(true);
  });
});

/* ------------------------------------------ the comment follow-up field -- */

function comment(): ClientComment {
  return {
    id: "c1",
    blockId: "spya-aaaaaa" as ClientComment["blockId"],
    quote: "some words",
    start: 0,
    createdAt: "2026-09-04T10:00:00.000Z",
    status: "done",
    answer: "Because it does.",
  };
}

/**
 * `Ask a follow-up question about this passage` — a single-line `<input>` in a
 * form, so the browser's implicit submission is what Enter reaches. What is ours
 * is the submit handler and what the button offers, and both are asserted.
 */
describe("the comment follow-up box", () => {
  const asked: string[] = [];

  function mount(): { box: HTMLInputElement; form: HTMLFormElement } {
    asked.length = 0;
    act(() => {
      root.render(
        createElement(CommentDialog, {
          comment: comment(),
          access: {
            kind: "owner",
            pending: 0,
            onDelete: () => {},
            onRetry: () => {},
            onDeepen: () => {},
            onDiscuss: (q: string) => asked.push(q),
            onEdit: () => {},
            placing: false,
            onPlace: () => {},
            error: null,
          },
          position: 1,
          total: 1,
          onPrev: () => {},
          onNext: () => {},
          hasPrev: false,
          hasNext: false,
          onClose: () => {},
        }),
      );
    });
    const box = host.querySelector<HTMLInputElement>("input[aria-label^='Ask a follow-up']");
    const form = host.querySelector<HTMLFormElement>("form.cmt-followup");
    if (!box || !form) throw new Error("no follow-up box");
    return { box, form };
  }

  const askButton = () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === "Ask in chat",
    );

  function submit(form: HTMLFormElement): void {
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  it("puts the question into chat", () => {
    const { box, form } = mount();
    type(box, "What about the other study?");
    submit(form);

    expect(asked).toEqual(["What about the other study?"]);
  });

  /**
   * **The guard was right and the button was lit**, which is the worse half of
   * the two: pressing it did nothing and said nothing. GPT Sol, 2026-09-04.
   */
  it("refuses while the microphone is on, and says so by going flat", () => {
    mic.armed = true;
    const { box, form } = mount();
    type(box, "half a sentence");
    submit(form);

    expect(asked).toEqual([]);
    expect(askButton()?.disabled, "Ask in chat looks pressable while recording").toBe(true);
  });

  it("refuses while the transcript is on its way", () => {
    mic.transcribing = true;
    const { box, form } = mount();
    type(box, "half a sentence");
    submit(form);

    expect(asked).toEqual([]);
    expect(askButton()?.disabled).toBe(true);
  });
});

/* ---------------------------------------------------------- the sign-in -- */

/**
 * **"Next" has to mean next.**
 *
 * The email field wears `enterKeyHint="next"`, and until 2026-09-04 the handler
 * behind it moved the focus *only when the password was empty* — so with a
 * password manager's fill, which is the ordinary case, a key labelled Next
 * signed in. The label was a lie exactly where it was read. GPT Sol, finding 4.
 */
describe("the sign-in form", () => {
  function mount(): { email: HTMLInputElement; password: HTMLInputElement } {
    act(() => {
      root.render(createElement(SignInControls));
    });
    /* The email form is behind a link — signing in with a password is the second
       offer on this screen, not the first. */
    const opener = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes("email address"),
    );
    act(() => opener?.click());
    const email = host.querySelector<HTMLInputElement>("#signin-email");
    const password = host.querySelector<HTMLInputElement>("#signin-password");
    if (!email || !password) throw new Error("no sign-in form");
    return { email, password };
  }

  it("moves to the password box when the password is empty", () => {
    const { email, password } = mount();
    type(email, "reader@example.com");
    const e = press(email, "Enter");

    expect(document.activeElement).toBe(password);
    expect(e.defaultPrevented, "the form was left to submit").toBe(true);
    expect(signIns).toEqual([]);
  });

  /**
   * **The case that was wrong**, and the only one a password manager produces.
   */
  it("still moves — and does not sign in — when the password is already filled", () => {
    const { email, password } = mount();
    type(password, "a-manager-filled-this");
    type(email, "reader@example.com");
    const e = press(email, "Enter");

    expect(document.activeElement).toBe(password);
    expect(e.defaultPrevented).toBe(true);
    expect(signIns, "Enter in a box labelled Next signed in").toEqual([]);
  });

  /**
   * And the second field really is where signing in happens — `enterKeyHint="go"`
   * over a form whose submit does it. jsdom does not do implicit submission, so
   * the submit itself is what is exercised; the key's label is the sweep's job.
   */
  it("signs in from the password field, which is where 'go' points", async () => {
    const { email, password } = mount();
    type(email, "reader@example.com");
    type(password, "a-good-long-password");
    /* No handler of ours on this box, so Enter is left entirely to the form. */
    expect(press(password, "Enter").defaultPrevented).toBe(false);

    const form = host.querySelector<HTMLFormElement>("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(signIns).toEqual([
      { email: "reader@example.com", password: "a-good-long-password" },
    ]);
  });
});
