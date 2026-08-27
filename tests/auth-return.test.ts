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

/**
 * **The guard in `main.tsx`, which nothing was checking.**
 *
 * GPT Sol's review of the built code, 2026-08-27, item 8:
 *
 * > The weakness is test coverage: `router.test.ts` tests pure helpers and
 * > explicitly leaves the `main.tsx` side effect untested. Removing or
 * > reordering the actual guard could leave the suite green.
 *
 * What the guard prevents is worth restating, because it is not obvious from
 * the code. `main.tsx` rewrites the address bar three times on boot, to
 * canonicalise old spellings of an article URL. One of those rewrites builds an
 * `/add/<a whole URL>` address, and `canonicalAddHref` reads `location.search`
 * **as part of the article's address** — that is its job. So a sign-in return
 * landing on any `/add/…` spelling folds our live authorisation code into a
 * stranger's URL, which the ingest pipeline then goes and fetches, putting the
 * code in somebody else's access log. It works, and it leaks.
 *
 * ## Why this is a grep rather than a rendered page
 *
 * The thing under test is a **module-scope side effect that runs on import**,
 * before React exists. Importing `main.tsx` in a test runs it — against
 * whatever `location` happens to be, mounting the app into a DOM that is not
 * there. A structural assertion is a weaker test than driving it, and it is the
 * one that can actually be written: it fails if somebody deletes the guard,
 * reorders it below a rewrite, or adds a fourth rewrite without one, which is
 * the whole list of ways this comes back.
 */
describe("the address-bar rewrites on boot", () => {
  it("are every one of them behind the callback guard", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const source = await readFile(
      fileURLToPath(new URL("../src/web/main.tsx", import.meta.url)),
      "utf8",
    );
    /* Comments first: this file explains the rule at length, quoting the very
       expressions being counted, and a guard that trips over its own
       documentation is one somebody weakens rather than satisfies. */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const rewrites = code.match(/history\.replaceState\(/g) ?? [];
    expect(rewrites.length).toBeGreaterThan(0);

    /* **One guard per rewrite, and every guard before the rewrite it covers.**
     *
       Two earlier versions of this check were wrong about the honest code
       before this one was right, which is worth recording because both were
       wrong in the same direction — too clever about structure they could not
       actually see.

       Walking back to the nearest `if (` failed on the first rewrite: the guard
       is an OUTER `if (!onCallback) { … if (canonicalAdd) replaceState(…) }`
       and the nearest `if` is the inner one. Widening it to "the preceding 400
       characters mention onCallback" then failed on the fourth, whose guarded
       block is simply longer than that — and the answer to that one is not a
       bigger number, because a big enough window passes everything.

       So: running counts. Walk the file in order, and at each rewrite require
       that at least as many `!onCallback` guards have been seen as rewrites,
       this one included. Exact rather than fuzzy, and it fails on all three
       ways this comes back — a guard deleted, a guard moved below its rewrite,
       or a fifth rewrite added with none. What it cannot see is whether a guard
       really encloses the rewrite it is counted against; that needs a parser,
       and a parser here would be more machinery than the thing it protects. */
    const events = [...code.matchAll(/if\s*\(\s*!onCallback|history\.replaceState\(/g)];
    let guards = 0;
    let seen = 0;
    const unguarded: string[] = [];
    for (const event of events) {
      if (event[0].startsWith("if")) {
        guards += 1;
        continue;
      }
      seen += 1;
      if (guards < seen) {
        unguarded.push(code.slice(event.index, (event.index ?? 0) + 60).split("\n")[0] ?? "");
      }
    }
    expect(unguarded).toEqual([]);
    /* And no spare guards either — one that guards nothing is one somebody
       moved a rewrite out from under. */
    expect(guards).toBe(seen);
  });

  /** And the guard is computed from the router's constant, not a second spelling. */
  it("decide what a callback is from one shared constant", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const source = await readFile(
      fileURLToPath(new URL("../src/web/main.tsx", import.meta.url)),
      "utf8",
    );
    const line = source.split("\n").find((l) => l.includes("const onCallback")) ?? "";
    expect(line).toContain("CALLBACK_HREF");
    expect(line).not.toMatch(/["']\/auth/);
  });
});
