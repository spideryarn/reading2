// @vitest-environment jsdom
/**
 * **Opening an archived article puts it back on the shelf — and the page says so.**
 *
 * > I open an archived article. It should unarchive it.
 * >
 * > — Greg, 2026-10-30 (spya-h8cda9)
 *
 * The server half is in tests/store-shelf-pg.test.ts. This is the page's half,
 * `useArchive`'s owner-page open, and the things it has to get right:
 *
 *  1. The payload was read before the open, so it can say *archived* about an
 *     article the open has just put back. After the open, the page says *on
 *     the shelf*.
 *  2. An Archive pressed while the open is still out waits for it. Otherwise
 *     the open's UPDATE could land second and quietly undo the press.
 *  3. A failed open is not proof that nothing was written, so it re-reads —
 *     and says it does not know if even that fails.
 *
 * docs/plans/261030f-opening-an-archived-article-puts-it-back-on-the-shelf.md.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const { useArchive } = await import("../src/web/useArchive.js");
type Control = ReturnType<typeof useArchive>;

const SLUG = "a-piece";
const WHEN = "2026-10-11T09:12:47.673Z";
const OPEN = `/api/library/${SLUG}/open`;

let host: HTMLDivElement;
let root: Root;
let control: Control;

function Harness({ archivedAt, openOnMount }: { archivedAt: string | null; openOnMount: boolean }) {
  control = useArchive(SLUG, archivedAt, true, false, openOnMount);
  return null;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  apiFetch.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(archivedAt: string | null, openOnMount = true, strict = false) {
  const harness = createElement(Harness, { archivedAt, openOnMount });
  await act(async () => root.render(strict ? createElement(StrictMode, null, harness) : harness));
}

describe("useArchive's owner-page open", () => {
  it("says the article is on the shelf once the open has landed, over a payload that said archived", async () => {
    apiFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await mount(WHEN);
    expect(apiFetch).toHaveBeenCalledWith(OPEN, { method: "POST" });
    expect(control.at).toBe(null);
    expect(control.lost).toBe(false);
  });

  it("holds an Archive press until the open has settled, so the press is the last word", async () => {
    let answerOpen!: (r: Response) => void;
    apiFetch.mockReturnValueOnce(new Promise<Response>((resolve) => (answerOpen = resolve)));
    await mount(null);

    const LATER = "2026-10-30T19:30:00.000Z";
    apiFetch.mockResolvedValueOnce(json({ entry: { slug: SLUG, archivedAt: LATER } }));
    let pressed!: Promise<unknown>;
    await act(async () => {
      pressed = control.set(true);
    });
    // The PATCH has not gone: only the open is out.
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(control.busy).toBe(true);

    await act(async () => {
      answerOpen(new Response(null, { status: 204 }));
      await pressed;
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[1]![0]).toBe(`/api/library/${SLUG}`);
    expect(control.at).toBe(LATER);
  });

  it("re-reads after a failed open rather than trusting the payload", async () => {
    apiFetch
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(json({ slug: SLUG, archivedAt: null }));
    await mount(WHEN);
    expect(apiFetch.mock.calls[1]![0]).toBe(`/api/metadata/${SLUG}`);
    expect(control.at).toBe(null);
  });

  it("says it does not know when the re-read fails too", async () => {
    apiFetch.mockRejectedValueOnce(new TypeError("offline")).mockRejectedValueOnce(new TypeError("offline"));
    await mount(WHEN);
    expect(control.at).toBe(undefined);
    expect(control.lost).toBe(true);
  });

  it("records one open under StrictMode's rehearsed mount", async () => {
    apiFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await mount(null, true, true);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(OPEN, { method: "POST" });
  });

  it("does not wait for an open that view-as will never send", async () => {
    const LATER = "2026-10-30T19:30:00.000Z";
    apiFetch.mockResolvedValueOnce(json({ entry: { slug: SLUG, archivedAt: LATER } }));
    await mount(null, false);
    await act(async () => control.set(true));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]![0]).toBe(`/api/library/${SLUG}`);
  });
});
