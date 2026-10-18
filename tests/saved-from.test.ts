/**
 * **Reading where an uploaded page says it was saved from** — src/saved-from.ts
 * § `savedFromInHtml` and src/urls.ts § `savedSource`. Plan 261018j § Stage 3.
 *
 * The value is a claim out of a file, so what is pinned here is mostly what is
 * refused: anything not `http(s)`, a credential, an overlong value, a claim
 * outside the head, and two claims at once. The round trip with the real
 * bookmarklet is the positive control: the address it writes is the address
 * the upload path reads.
 */
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import { savedFromInHtml } from "../src/saved-from.js";
import { savedSource } from "../src/urls.js";
import { savePageForSpideryarn } from "../src/web/save-page-bookmarklet.js";

const page = (head: string, body = "<p>Prose.</p>") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>T</title>${head}</head><body>${body}</body></html>`;
const meta = (content: string) => `<meta name="spideryarn-saved-from" content="${content}">`;

describe("savedSource", () => {
  it("keeps an ordinary address, query and all, and drops the fragment", () => {
    expect(savedSource("https://journals.plos.org/plosone/article?id=10.1371/x#s2")).toBe(
      "https://journals.plos.org/plosone/article?id=10.1371/x",
    );
  });

  it.each([
    ["nothing", null],
    ["empty", " "],
    ["javascript:", "javascript:alert(1)"],
    ["file:", "file:///home/someone/paper.html"],
    ["data:", "data:text/html,hi"],
    ["a credential", "https://user:pw@example.com/a"],
    ["a password alone", "https://:pw@example.com/a"],
    ["unparseable", "https://"],
    ["over 2,048 characters", `https://example.com/${"a".repeat(2050)}`],
  ])("refuses %s", (_n, value) => {
    expect(savedSource(value)).toBeNull();
  });
});

describe("savedFromInHtml", () => {
  it("reads the one claim in the head", () => {
    expect(savedFromInHtml(page(meta("https://www.cell.com/fulltext/S1")))).toBe("https://www.cell.com/fulltext/S1");
  });

  it("refuses a claim it would refuse anywhere", () => {
    expect(savedFromInHtml(page(meta("javascript:alert(1)")))).toBeNull();
    expect(savedFromInHtml(page(meta("https://u:p@www.cell.com/x")))).toBeNull();
  });

  it("takes none when there are two, since neither is more believable", () => {
    expect(savedFromInHtml(page(meta("https://a.example.com/") + meta("https://b.example.com/")))).toBeNull();
  });

  it("does not read a claim in the body", () => {
    expect(savedFromInHtml(page("", meta("https://www.cell.com/x")))).toBeNull();
  });

  it("has nothing to say about a file with no head to end", () => {
    expect(savedFromInHtml(`${meta("https://www.cell.com/x")}<p>Prose.</p>`)).toBeNull();
    expect(savedFromInHtml("just prose, no markup at all")).toBeNull();
  });

  /** The positive control: the address the bookmarklet writes is the one read back. */
  it("reads back what the bookmarklet wrote", async () => {
    const url = "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000001#abstract";
    const dom = new JSDOM(page(meta("https://evil.example/")), { url });
    const win = dom.window as unknown as Window & typeof globalThis;
    const blobs: Blob[] = [];
    win.URL.createObjectURL = (blob: Blob) => {
      blobs.push(blob);
      return "blob:x";
    };
    win.URL.revokeObjectURL = () => {};
    win.HTMLAnchorElement.prototype.click = () => {};
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      savePageForSpideryarn(win, 50 * 1024 * 1024);
    } finally {
      vi.useRealTimers();
    }
    const html = new TextDecoder().decode(new Uint8Array(await blobs[0]!.arrayBuffer()));
    expect(savedFromInHtml(html)).toBe("https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000001");
  });
});
