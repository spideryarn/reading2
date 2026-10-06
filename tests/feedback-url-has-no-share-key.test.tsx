// @vitest-environment jsdom
/**
 * **A bug report filed from a private link does not carry the link's key.**
 *
 * The Feedback button records the page's address, and on
 * `/read/<slug>?key=<key>` that address is the credential. A report's URL goes
 * into our table, a Sentry tag and the admin email
 * (docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md,
 * GPT Sol's F1). The server takes the key off again before storing, for an
 * older client; this is the browser's half, so the key never leaves the page.
 *
 * `FeedbackDialog` is replaced by a stand-in that writes down the `where` it
 * was handed, because that prop is the whole of what a report says about the
 * address: the dialog sends `where.url` as it is (FeedbackDialog.tsx).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handed: { url: string; slug: string | null }[] = [];
vi.mock("../src/web/FeedbackDialog.js", () => ({
  FeedbackDialog: ({ where }: { where: { url: string; slug: string | null } }) => {
    handed.push(where);
    return null;
  },
}));

const { FeedbackHost } = await import("../src/web/FeedbackButton.js");

const KEY = "AbCdEfGhIjKlMnOpQrStUv";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  handed.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  history.replaceState(null, "", "/");
});

function reportedFrom(address: string): { url: string; slug: string | null } {
  history.replaceState(null, "", address);
  act(() => root.render(<FeedbackHost readerId="reader-a">{null}</FeedbackHost>));
  const where = handed.at(-1);
  if (!where) throw new Error("the host never drew its dialog");
  return where;
}

describe("the address a bug report records", () => {
  it("is the control: an ordinary address is recorded whole", () => {
    const where = reportedFrom("/read/a-piece?mode=glossary&at=spya-k3m9qt");
    expect(where.url).toBe(`${location.origin}/read/a-piece?mode=glossary&at=spya-k3m9qt`);
    expect(where.slug).toBe("a-piece");
  });

  it("has no key on a private link, and keeps the rest", () => {
    const where = reportedFrom(`/read/a-piece?mode=glossary&key=${KEY}&at=spya-k3m9qt`);
    expect(where.url).not.toContain(KEY);
    expect(where.url).not.toContain("key=");
    expect(where.url).toBe(`${location.origin}/read/a-piece?mode=glossary&at=spya-k3m9qt`);
    expect(where.slug).toBe("a-piece");
  });

  it("has none on the details page either, or when the value is not a whole key", () => {
    for (const address of [
      `/read/a-piece/metadata?key=${KEY}`,
      "/read/a-piece?key=half-a-key",
      `/read/a-piece?key=${KEY}&key=${KEY}`,
    ]) {
      const where = reportedFrom(address);
      expect(where.url, address).not.toContain("key=");
      expect(where.url, address).not.toContain(KEY);
    }
  });
});
