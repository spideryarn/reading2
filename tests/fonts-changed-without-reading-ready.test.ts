// @vitest-environment jsdom
/**
 * Re-measuring after a font swap must not read `document.fonts.ready`.
 *
 * That getter was **21.5% of all script time** on a 2,046-block article — the
 * largest entry in the profile once the per-section row scan was fixed — and
 * three effects re-read it on every mode switch. Sentry
 * `SPIDERYARN-READING2-1M`;
 * docs/plans/260905d-mode-switching-is-sluggish-on-a-very-long-article.md.
 *
 * The assertion that matters is the **negative** one: `ready` is never touched.
 * A test that only checked "the callback fires" passes just as well against the
 * promise version, which is the whole point of what was wrong — so it would
 * prove nothing. docs/reusable/silent-success.md.
 *
 * Watched red against `document.fonts.ready.then(run)`: `ready` read 1 time,
 * wanted 0, and the unsubscribe assertion fails because there is nothing to
 * remove.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { onFontsChanged } from "../src/web/fonts.js";

/**
 * A stand-in for `FontFaceSet`, because jsdom has none — and it counts reads of
 * `ready` rather than merely providing one, since counting them is the test.
 */
function installFonts(): { readyReads: () => number; fire: () => void; listeners: () => number } {
  let readyReads = 0;
  const listeners = new Map<string, Set<() => void>>();
  const fonts = {
    get ready() {
      readyReads += 1;
      return Promise.resolve();
    },
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
  };
  Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
  return {
    readyReads: () => readyReads,
    fire: () => {
      for (const fn of listeners.get("loadingdone") ?? []) fn();
    },
    listeners: () => listeners.get("loadingdone")?.size ?? 0,
  };
}

describe("onFontsChanged", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "fonts");
    vi.restoreAllMocks();
  });

  it("never reads document.fonts.ready", () => {
    const f = installFonts();
    const run = vi.fn();

    const off = onFontsChanged(run);
    f.fire();
    off();

    /* The whole reason this file exists. */
    expect(f.readyReads()).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fires on every batch, not just the first", () => {
    /* The promise it replaces covers only the batch in flight when it is read,
       so a font that starts loading after a mode mounts is missed. */
    const f = installFonts();
    const run = vi.fn();

    const off = onFontsChanged(run);
    f.fire();
    f.fire();
    f.fire();
    off();

    expect(run).toHaveBeenCalledTimes(3);
  });

  it("unsubscribes, so an unmounted panel stops measuring", () => {
    const f = installFonts();
    const run = vi.fn();

    const off = onFontsChanged(run);
    expect(f.listeners()).toBe(1);
    off();

    expect(f.listeners()).toBe(0);
    f.fire();
    expect(run).not.toHaveBeenCalled();
  });

  it("is a no-op where document.fonts does not exist, and still returns a cleanup", () => {
    /* jsdom and older engines. The callers guarded with `?.` and must not have
       to keep doing so. */
    Reflect.deleteProperty(document, "fonts");
    const run = vi.fn();

    const off = onFontsChanged(run);

    expect(off).toBeTypeOf("function");
    expect(() => off()).not.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
