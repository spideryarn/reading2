// @vitest-environment jsdom
/**
 * **Every text box in the client has decided what its Enter key says.**
 *
 * Greg, from a phone, 2026-09-04:
 *
 * > The keyboard on mobile devices should have a Done/Send button where
 * > appropriate, including this Feedback dialog box.
 *
 * `enterKeyHint` is the attribute that labels the soft keyboard's Enter key.
 * The decision it encodes is a product one and it is made per box, in three
 * kinds — the rule and the reasoning are in
 * docs/project/touch.md § What the Enter key promises:
 *
 *  - **The key does the thing.** A single-line box whose Enter runs a search,
 *    submits a form, or commits an edit: `search`, `go`, `done`, `send`.
 *  - **Enter writes a newline.** Every multi-line box in this app bar the two
 *    chat composers. These carry **no hint at all**: the default is already
 *    Return, and iOS inserts a newline whatever the key is labelled, so a
 *    textarea wearing `send` is a key that lies. AnnotateDialog.tsx has held the
 *    same decision since it was written.
 *  - **Neither applies** — a read-only field, a checkbox, a slider, a file
 *    picker. Left alone, and skipped below.
 *
 * ## Why a source sweep and not twenty render tests
 *
 * Because the failure this guards against is *omission*: somebody adds a
 * twenty-second box and never asks the question. Mounting the components would
 * check the ones we remembered to mount. Reading the source checks the ones we
 * did not — a new box that is neither in `PROMISES` nor a slider fails this
 * file, and the fix is to add a line saying which of the three it is.
 *
 * What a sweep cannot tell you is that React ships the attribute under the name
 * the platform reads (`enterKeyHint` in JSX, `enterkeyhint` in HTML), so the
 * last test here renders a real component and reads the DOM back.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TitleEditor } from "../src/web/TitleEditor.js";

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "web");

/**
 * **Every text box, and what its Enter key promises.**
 *
 * `newline` means the box deliberately carries no `enterKeyHint`. The key is
 * the file, then the box's `id`, `aria-label` or `className` — whichever it
 * has, in that order, since not every box has all three.
 */
const PROMISES: Record<string, string> = {
  /* Enter submits the add form. `inputMode="url"` is beside it. */
  "AddArticle.tsx › add-url": "go",
  /* Enter sends, per each composer's own handler. The two exceptions among the
     textareas, and the only two boxes in the app where Enter posts something. */
  "CandidatesPanel.tsx › cnd-box": "send",
  "ChatPanel.tsx › chat-edit-box": "send",
  "ChatPanel.tsx › chat-input": "send",
  /* Enter commits an edit in place. */
  "ChatPanel.tsx › chat-rename": "done",
  "TitleEditor.tsx › Title": "done",
  /* Enter posts a question into chat. */
  "CommentDialog.tsx › Ask a follow-up question about this passage": "send",
  /* Fields of the criterion form, whose submit button runs it. Not steps in a
     wizard, so `next` would be a lie about where the key goes. */
  "CriteriaPanel.tsx › crit-against": "go",
  "CriteriaPanel.tsx › crit-favour": "go",
  /* Enter searches — and in the two boxes that filter as you type it dismisses
     the keyboard, so the promise has something behind it. */
  "GlossaryPanel.tsx › Look up a term in this article": "search",
  "Library.tsx › Search the library": "search",
  "SearchPanel.tsx › srch-input": "search",
  /* The sign-in form: the first field moves to the second, the second signs in.
     `next` really moves — SignInControls.tsx says why it has to. */
  "SignInControls.tsx › signin-email": "next",
  "SignInControls.tsx › signin-password": "go",
  /* And the boxes where Enter is a newline and must stay one. The Feedback
     dialog is the one Greg reported from: what he needed there was the Send
     button out from under the keyboard, which is a sizing fix
     (docs/project/feedback.md), not a key that would have inserted a newline
     while claiming to send. */
  "AnnotateDialog.tsx › Your comment on this passage": "newline",
  "CommentDialog.tsx › Your comment on this passage": "newline",
  "CriteriaPanel.tsx › crit-text": "newline",
  "FeedbackDialog.tsx › fb-input fb-body": "newline",
  "ProfileBox.tsx › prof-box-input": "newline",
  "QuizPanel.tsx › Your answer": "newline",
};

/** Types that take no typing, so no Enter key of ours is involved. */
const NOT_TYPING = ["checkbox", "radio", "range", "file", "hidden", "submit", "button"];

/** Every `.tsx` under src/web, bar the `preview-*` harnesses, which no reader reaches. */
function clientFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...clientFiles(p));
    else if (name.endsWith(".tsx") && !name.startsWith("preview-")) out.push(p);
  }
  return out;
}

/**
 * Comments first, or the sweep finds the `<input type="range">` that four
 * stylesheets' worth of prose talks *about* and demands a decision on it.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The text of every `<input>` and `<textarea>` opening tag.
 *
 * A `>` inside `{…}` is an arrow function, not the end of the tag, and a `>`
 * inside quotes is a class name — so this tracks brace depth and quoting rather
 * than looking for the next angle bracket, which would cut half the tags short
 * and pass them for want of anything to read.
 */
function endOfTag(src: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c ?? null;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return src.length - 1;
}

function openingTags(src: string): { tag: string; text: string }[] {
  const found: { tag: string; text: string }[] = [];
  const re = /<(input|textarea)[\s/>]/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const end = endOfTag(src, m.index + m[0].length - 1);
    found.push({ tag: m[1] ?? "", text: src.slice(m.index, end + 1) });
  }
  return found;
}

const attr = (text: string, name: string): string | null =>
  new RegExp(`${name}="([^"]*)"`).exec(text)?.[1] ?? null;

/** Every box in the client: what it is, what it promises, and its own JSX. */
interface Box {
  key: string;
  /** `input` or `textarea` — and the difference is the point of the second case. */
  tag: string;
  hint: string;
  /** The opening tag, comments already stripped. */
  text: string;
}

function boxes(): Box[] {
  const found: Box[] = [];
  for (const file of clientFiles(CLIENT)) {
    for (const { tag, text } of openingTags(withoutComments(readFileSync(file, "utf8")))) {
      if (NOT_TYPING.includes(attr(text, "type") ?? "")) continue;
      /* A field that shows a value and takes none — the share link. */
      if (/\breadOnly\b/.test(text) && !/onChange/.test(text)) continue;
      const key = attr(text, "id") ?? attr(text, "aria-label") ?? attr(text, "className") ?? "?";
      found.push({
        key: `${path.basename(file)} › ${key}`,
        tag,
        hint: attr(text, "enterKeyHint") ?? "newline",
        text,
      });
    }
  }
  return found;
}

/** What every box in the client promises today, in `PROMISES`' shape. */
function sweep(): Record<string, string> {
  return Object.fromEntries(boxes().map((b) => [b.key, b.hint]));
}

describe("what the Enter key promises", () => {
  it("is decided, box by box, for every text box in the client", () => {
    expect(sweep()).toEqual(PROMISES);
  });

  /**
   * **A textarea's Enter cannot send by itself.** A form submits on Enter from a
   * single-line `<input>` and never from a `<textarea>`, where the key's whole
   * default is a newline — so `enterKeyHint="send"` over a textarea is a promise
   * that only a handler in that same tag can keep.
   *
   * This asks for the handler, which the case it replaced did not: it compared
   * one list of names to another, so deleting `onKeyDown` and keeping the
   * attribute left it green, and it lumped `CommentDialog`'s `<input>` in with
   * the textareas although the two make the promise in different ways. GPT Sol,
   * 2026-09-04, finding 5.
   *
   * A regex is a weak reading of a handler and it is not the whole guard: the
   * boxes that can be mounted are pressed for real in
   * tests/the-enter-key-really-sends.test.tsx. This is the part that also covers
   * the two that are not exported — `chat-edit-box` and `cnd-box`.
   *
   * **Red first:** deleting the `if (e.key === "Enter" …)` branch from
   * `.chat-input`'s `onKeyDown` failed this on 2026-09-04.
   */
  it("labels a textarea Send only where that tag's own handler sends on Enter", () => {
    const sending = boxes().filter((b) => b.hint === "send" && b.tag === "textarea");

    /* The three, named, so a fourth textarea claiming Send has to be decided
       rather than inherited. */
    expect(sending.map((b) => b.key).sort()).toEqual([
      "CandidatesPanel.tsx › cnd-box",
      "ChatPanel.tsx › chat-edit-box",
      "ChatPanel.tsx › chat-input",
    ]);

    for (const box of sending) {
      expect(box.text, `${box.key} says Send with no onKeyDown`).toMatch(/onKeyDown=\{/);
      expect(box.text, `${box.key} has a handler that never looks for Enter`).toMatch(
        /["']Enter["']/,
      );
    }
  });

  /**
   * The one `<input>` that says Send is `CommentDialog`'s follow-up, and it keeps
   * the promise the way a single-line field does — the browser submits its form.
   * So what has to exist is the form and its handler, and that is exercised for
   * real in tests/the-enter-key-really-sends.test.tsx.
   */
  it("labels an input Send only where a form is there to be submitted", () => {
    const sending = boxes().filter((b) => b.hint === "send" && b.tag === "input");
    expect(sending.map((b) => b.key)).toEqual([
      "CommentDialog.tsx › Ask a follow-up question about this passage",
    ]);

    const src = withoutComments(readFileSync(path.join(CLIENT, "CommentDialog.tsx"), "utf8"));
    expect(src, "the follow-up box's form lost its submit handler").toMatch(
      /<form[^>]*className="cmt-followup"[\s\S]{0,400}?onSubmit=\{/,
    );
  });
});

/**
 * **The name the platform actually reads.**
 *
 * React spells the prop `enterKeyHint` and the attribute `enterkeyhint`, and a
 * prop React does not recognise is passed through *verbatim* with a console
 * warning rather than an error — so a typo would sweep clean above and ship a
 * keyboard that says nothing. One real component, mounted, read back off the
 * DOM.
 */
describe("the attribute that ships", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("is lower-case in the HTML, whatever the JSX called it", () => {
    act(() => {
      root.render(createElement(TitleEditor, { title: "A piece", onDone: () => {} }));
    });
    const box = host.querySelector("input");
    expect(box?.getAttribute("enterkeyhint")).toBe("done");
    /* The attribute and not the reflected `enterKeyHint` property, which jsdom
       does not implement — reading it here would assert `undefined === undefined`
       on a broken build. The property is checked in a real browser instead; see
       docs/project/touch.md § What the Enter key promises. */
  });
});
