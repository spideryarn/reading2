// @vitest-environment jsdom
/**
 * **The two caps, said before the reader picks a file.**
 *
 * Reported as *"couldn't upload PDF"* (Sentry `SPIDERYARN-READING2-V`,
 * 2026-09-03). The file was a 142-page paper against a 100-page cap, and the
 * refusal that reached the reader named nothing —
 * docs/postmortems/260904b-a-sentence-written-for-the-reader-was-thrown-away-at-the-seam.md.
 * That half is fixed: the cap is 250 and the refusal names both numbers.
 *
 * This is the other half, and it is a different claim: **a reader should be
 * able to know the limits without hitting one.** A page cap in particular is
 * not something anybody can guess, and until 2026-09-04 the only place it could
 * be discovered was a refusal at the end of an upload.
 *
 * Asserted against the constants rather than against English, because the copy
 * is allowed to change and the numbers are not allowed to drift —
 * docs/project/copy.md. `MAX_PAGES` moved to src/uploads.ts so that this
 * assertion can be about the same constant the pipeline enforces; while it
 * lived in src/pdf-read.ts the browser could not name it at all.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADDING_SENDS_TEXT_AWAY } from "../src/messages.js";
import { formatBytes, MAX_PAGES, MAX_UPLOAD_BYTES } from "../src/uploads.js";
import type { UseJobs } from "../src/web/useJobs.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const queue: UseJobs = {
  jobs: [],
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => null,
  addUpload: async () => null,
  run: async () => null,
  reset: async () => null,
  cancel: async () => {},
  retry: async () => null,
  forget: async () => {},
};
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue, useJobSession: () => {} }));

const { AddArticle } = await import("../src/web/AddArticle.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(createElement(AddArticle, { queue }));
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * The description element itself, found the way the markup ties it to the button.
 *
 * Named `#upload-limits` here rather than imported, because the assertion below
 * is precisely that the button's `aria-describedby` and the element's `id`
 * are the same string — importing the constant would make that true by
 * construction and prove nothing.
 */
const description = (): HTMLElement => {
  const el = host.querySelector<HTMLElement>("#upload-limits");
  if (!el) throw new Error("the add box drew no limits description");
  return el;
};

/** The control that opens the file dialog. */
const pdfButton = (): HTMLButtonElement => {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "File");
  if (!button) throw new Error("no File button on the add box");
  return button;
};

/** The (i) beside it: upload limits, then where the article's text goes. */
const limitsInfo = (): HTMLButtonElement => {
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="What you can add and where its text goes"]');
  if (!button) throw new Error("no (i) beside the File button");
  return button;
};

/** The one submit button, whose words say whether Add will use the URL or file. */
const addButton = (): HTMLButtonElement => {
  const button = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error("no Add button on the add box");
  return button;
};

/** Choose one valid file through the hidden native picker. */
function chooseFile(): void {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input on the add box");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["words"], "paper.txt", { type: "text/plain" })],
  });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}

/** Type through the native setter so React's value tracker sees the change. */
function typeUrl(value: string): void {
  const input = host.querySelector<HTMLInputElement>("#add-url");
  if (!input) throw new Error("no URL input on the add box");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * **Behind an (i), since 2026-10-25.** Greg (spya-kx8z6d): *"Move this to an
 * (i) tooltip."* Until then the limits were a visible caption and this file
 * asserted that it was not hidden. The claim that survives is the one the
 * file was written for — a reader can learn the caps without hitting one — so
 * it is asserted as a press that shows them, which is the finger's way in
 * (the pointer's and the keyboard's are hover and focus, `Tooltip`'s own).
 */
describe("the add box, before a file is chosen", () => {
  it("does not spend a visible line on the limits", () => {
    /* The only closed-state copy is the File button's screen-reader text. A
       second, visible copy would make this count two; losing `sr-only` would
       fail the class assertion. This checks the mechanisms this codebase uses
       instead of asking jsdom to calculate visibility. */
    expect(description().className).toMatch(/(^|:|\s)sr-only(\s|$)/);
    expect((host.textContent?.match(new RegExp(`${MAX_PAGES} pages`, "g")) ?? [])).toHaveLength(1);
  });

  it("says how large a PDF may be, and how many pages, when the (i) is pressed", () => {
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => limitsInfo().click());
    expect(limitsInfo().getAttribute("aria-expanded")).toBe("true");
    const card = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(card, "pressing the (i) opened no house tooltip").not.toBeNull();
    expect(card?.textContent).toContain(formatBytes(MAX_UPLOAD_BYTES));
    /* The one a reader cannot guess and cannot check for themselves before
       uploading — and the one the reported failure was about. */
    expect(card?.textContent).toContain(String(MAX_PAGES));
    expect(limitsInfo().getAttribute("aria-describedby")?.split(/\s+/)).toContain(card?.id);
    act(() => limitsInfo().click());
    expect(limitsInfo().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the same limits card from the keyboard", async () => {
    await act(async () => limitsInfo().focus());
    const card = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(card, "focusing the (i) opened no house tooltip").not.toBeNull();
    expect(card?.textContent).toContain(formatBytes(MAX_UPLOAD_BYTES));
    expect(card?.textContent).toContain(String(MAX_PAGES));
    /* The keyboard's way to the provider sentence too, and so a screen
       reader's: the open card describes the (i) (Tooltip.tsx). */
    expect(card?.textContent).toContain(ADDING_SENDS_TEXT_AWAY);
    expect(limitsInfo().getAttribute("aria-describedby")?.split(/\s+/)).toContain(card?.id);
  });

  it("keeps File and its tappable (i) in one non-wrapping group", () => {
    const group = pdfButton().parentElement;
    expect(group).toBe(limitsInfo().parentElement);
    expect(group?.className).toContain("tw:inline-flex");
    expect(group?.className).toContain("tw:shrink-0");
    expect(group?.className).toContain("tw:gap-1");
    expect(limitsInfo().classList).toContain("tap-target");
  });

  it("does not make an old file the latest choice when the limits (i) is pressed", () => {
    chooseFile();
    expect(addButton().textContent).toContain("Add file");
    typeUrl("example.com/newer-article");
    expect(addButton().textContent).toBe("Add");

    act(() => limitsInfo().click());
    expect(addButton().textContent).toBe("Add");
  });

  it("is what the File button tells a screen reader to read", () => {
    /* The card exists only while open, so the button is described by a
       screen-reader copy that is always there. */
    expect(pdfButton().getAttribute("aria-describedby")).toBe(description().id);
    expect(description().textContent).toContain(formatBytes(MAX_UPLOAD_BYTES));
    expect(description().textContent).toContain(String(MAX_PAGES));
  });
});

/**
 * **And the sentence about where the text goes, since 2026-10-26.** It was the
 * add box's last visible line of small print, kept back from 261026b because
 * 260831an made it a promise made before adding. Greg (reply `spya-dqhrvy` to
 * q-p6fvep): *"B I think it's pretty obvious that we're sending stuff to AI.
 * I mean, the whole thing is AI powered, and it's all in the privacy policy."*
 * So it is in the same card as the limits, and asserted the same two ways:
 * no visible line at rest, and there on a press. Plan 261026h.
 */
describe("the add box says where the text goes only in the (i)", () => {
  it("does not spend a visible line on it", () => {
    expect(host.textContent).not.toContain(ADDING_SENDS_TEXT_AWAY);
  });

  it("says it in the card, after the limits, when the (i) is pressed", () => {
    act(() => limitsInfo().click());
    const card = document.querySelector<HTMLElement>('[role="tooltip"]');
    const text = card?.textContent ?? "";
    expect(text).toContain(ADDING_SENDS_TEXT_AWAY);
    expect(text.indexOf(String(MAX_PAGES))).toBeLessThan(text.indexOf(ADDING_SENDS_TEXT_AWAY));
  });
});
