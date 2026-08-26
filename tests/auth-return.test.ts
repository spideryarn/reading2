/**
 * Where the reader goes back to after signing in.
 *
 * Small surface, and every test here is a **refusal** — which is the shape of
 * this problem: the failure mode of a return-path store is not "loses your
 * place", it is "sends you somewhere else".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isSafeReturn, rememberReturn, takeReturn } from "../src/web/auth-return.js";

const CALLBACK = "/auth/callback";

/** Enough `window` and `location` for the module, with nothing else pretending. */
function stubBrowser(origin = "https://spideryarn.test") {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  vi.stubGlobal("location", { origin });
  return store;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isSafeReturn", () => {
  beforeEach(() => stubBrowser());

  it("accepts an ordinary path on our own site", () => {
    expect(isSafeReturn("/read/an-essay?at=spya-k3m9qt", CALLBACK)).toBe(true);
    expect(isSafeReturn("/", CALLBACK)).toBe(true);
  });

  /**
   * **The one that matters.** `value.startsWith("/")` reads correctly and is an
   * open redirect: `//evil.example` starts with a slash and is a
   * protocol-relative URL, which the browser resolves as `https://evil.example`.
   * GPT Sol, 2026-08-26.
   */
  it("refuses a protocol-relative URL", () => {
    expect(isSafeReturn("//evil.example", CALLBACK)).toBe(false);
    expect(isSafeReturn("//evil.example/read/x", CALLBACK)).toBe(false);
  });

  it("refuses anything that is not a path on this origin", () => {
    for (const value of [
      "https://evil.example/read/x",
      "http://spideryarn.test.evil.example/",
      "read/x",
      "",
    ]) {
      expect(isSafeReturn(value, CALLBACK), value).toBe(false);
    }
  });

  /* Landing back on the callback is a loop, and a loop with a spent code in it. */
  it("refuses the callback itself", () => {
    expect(isSafeReturn("/auth/callback", CALLBACK)).toBe(false);
    expect(isSafeReturn("/auth/callback/", CALLBACK)).toBe(false);
  });
});

describe("remember and take", () => {
  it("gives the path back once, and only once", () => {
    stubBrowser();
    rememberReturn("/read/an-essay");
    expect(takeReturn(CALLBACK)).toBe("/read/an-essay");
    /* Read-and-delete. A value that survives a failed sign-in is a value that
       redirects the *next* one somewhere stale. */
    expect(takeReturn(CALLBACK)).toBeNull();
  });

  it("forgets a sign-in that started too long ago", () => {
    stubBrowser();
    vi.useFakeTimers();
    rememberReturn("/read/an-essay");
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(takeReturn(CALLBACK)).toBeNull();
  });

  it("refuses a stored value that is not safe, however it got there", () => {
    const store = stubBrowser();
    store.set(
      "spideryarn:auth-return",
      JSON.stringify({ path: "//evil.example", createdAt: Date.now() }),
    );
    expect(takeReturn(CALLBACK)).toBeNull();
  });

  it("survives storage that is missing or broken", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked in this browsing mode");
      },
    });
    vi.stubGlobal("location", { origin: "https://spideryarn.test" });
    expect(() => rememberReturn("/read/x")).not.toThrow();
    expect(takeReturn(CALLBACK)).toBeNull();
  });

  it("refuses a stored value that is not the shape we wrote", () => {
    const store = stubBrowser();
    for (const raw of ["not json", "{}", '{"path":"/x"}', '{"createdAt":1}']) {
      store.set("spideryarn:auth-return", raw);
      expect(takeReturn(CALLBACK), raw).toBeNull();
    }
  });
});
