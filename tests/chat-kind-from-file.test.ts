/**
 * **A `chat.json` written before a thread kind was renamed reads back as the
 * kind it became, never as a chat.**
 *
 * The database renamed `review` to `remember` (0048, 2026-09-01) and
 * `remember` to `learn` (20261006035355). A file on disk is not migrated: a
 * fixture or a working `data/<slug>/chat.json` written before either keeps the
 * old word. Until this test, `normaliseKind` in src/chat.ts turned any word it
 * did not know into `"chat"`, so a Recall conversation silently became a chat
 * on its way into Postgres — the failure the `kind` field exists to prevent.
 * docs/postmortems/261007a-a-renamed-enum-word-read-by-a-lenient-reader-becomes-its-default.md.
 */
import { describe, expect, it } from "vitest";
import { kindFromFile } from "../src/chat.js";
import { THREAD_KINDS } from "../src/types.js";

describe("kindFromFile", () => {
  it("reads a retired kind as the kind it was renamed to", () => {
    expect(kindFromFile("remember")).toBe("learn");
    expect(kindFromFile("review")).toBe("learn");
  });

  it("reads an absent kind as a chat — a file written before Learn existed", () => {
    expect(kindFromFile(undefined)).toBe("chat");
  });

  it("keeps every current kind as it is", () => {
    for (const kind of THREAD_KINDS) expect(kindFromFile(kind)).toBe(kind);
  });

  it("refuses a kind it has no name for, rather than calling it a chat", () => {
    expect(() => kindFromFile("recall")).toThrow(/unknown thread kind/);
    expect(() => kindFromFile(3)).toThrow(/unknown thread kind/);
  });

  it.each([null, "", false, {}, [], "constructor", "toString", "__proto__"])(
    "refuses malformed and inherited kinds: %j",
    (kind) => {
      expect(() => kindFromFile(kind)).toThrow(/unknown thread kind/);
    },
  );

  it("does not put arbitrary file contents in an error that loadThreads logs", () => {
    const prose = "private conversation accidentally placed in kind";
    try {
      kindFromFile(prose);
      expect.fail("a kind outside the known names must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/unknown thread kind/);
      expect((error as Error).message).not.toContain(prose.slice(0, 20));
    }
  });
});
