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
  cancel: async () => {},
  retry: async () => {},
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

/** Everything the add box has on screen, with the whitespace flattened. */
const onScreen = (): string => (host.textContent ?? "").replace(/\s+/g, " ");

/**
 * The caption element itself, found the way the markup ties it to the button.
 *
 * Named `#upload-limits` here rather than imported, because the assertion below
 * is precisely that the button's `aria-describedby` and the paragraph's `id`
 * are the same string — importing the constant would make that true by
 * construction and prove nothing.
 */
const caption = (): HTMLElement => {
  const el = host.querySelector<HTMLElement>("#upload-limits");
  if (!el) throw new Error("the add box drew no limits caption");
  return el;
};

/** The control that opens the file dialog: the one button that is not Add. */
const pdfButton = (): HTMLButtonElement => {
  const buttons = [...host.querySelectorAll("button")] as HTMLButtonElement[];
  const button = buttons.find((b) => b.type !== "submit");
  if (!button) throw new Error("no PDF button on the add box");
  return button;
};

describe("the add box, before a file is chosen", () => {
  it("says how large a PDF may be", () => {
    expect(onScreen()).toContain(formatBytes(MAX_UPLOAD_BYTES));
  });

  it("says how many pages a PDF may have", () => {
    /* The one a reader cannot guess and cannot check for themselves before
       uploading — and the one the reported failure was about. */
    expect(onScreen()).toContain(String(MAX_PAGES));
  });

  it("does not draw the caption hidden", () => {
    /* **`textContent` is blind to visibility**, so the two assertions above stay
       green under `hidden`, `aria-hidden`, `display:none`, `tw:hidden` or
       `sr-only` — a line nobody sees passing a test about a line everybody
       should. jsdom cannot resolve a stylesheet or lay anything out, so this
       checks the hiding mechanisms this codebase actually uses rather than
       claiming to prove visibility. The rest is the browser's job, and that run
       is recorded in the plan. GPT Sol, 2026-09-04. */
    const el = caption();
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
      expect(node.hidden, `${node.tagName} is hidden`).toBe(false);
      expect(node.getAttribute("aria-hidden")).not.toBe("true");
      expect(node.style.display).not.toBe("none");
      expect(node.style.visibility).not.toBe("hidden");
      expect(node.className).not.toMatch(/(^|:|\s)(hidden|sr-only)(\s|$)/);
    }
  });

  it("is what the PDF button tells a screen reader to read", () => {
    /* The caption is a paragraph under a row; without this it is announced, if
       at all, as unrelated prose somewhere after the control it is about. */
    expect(pdfButton().getAttribute("aria-describedby")).toBe(caption().id);
  });
});
