/**
 * **The query string the dock writes when you switch modes.**
 *
 * `withMode` used to `set("mode", …)` unconditionally, default included, so every
 * navigation through the bottom bar stamped `?mode=<default>` into a URL a reader
 * could copy and share. That went unnoticed until the mode was renamed from `toc`
 * to `hierarchy` on 2026-08-29 and the rename's first draft argued — from
 * `MODES`' own docstring — that the default "never appears in a URL" and so no
 * link could break. Links carrying it existed all along. GPT Sol found it.
 *
 * They still work, because an unrecognised mode falls back to the default
 * (tests/url-state.test.ts). This file pins the other half: that new URLs stop
 * carrying the redundant parameter, so the next rename does not inherit the same
 * problem.
 *
 * docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 3.2.
 */
import { describe, expect, it } from "vitest";
import { withMode } from "../src/web/Dock.js";
import { DEFAULT_MODE } from "../src/web/params.js";

/** What the parameter is after `withMode`, or `null` when it is absent. */
function modeIn(search: string): string | null {
  return new URLSearchParams(search).get("mode");
}

describe("withMode", () => {
  it("writes the parameter for a mode that is not the default", () => {
    expect(modeIn(withMode("", "chat"))).toBe("chat");
    expect(modeIn(withMode("at=spya-k3m9qt", "glossary"))).toBe("glossary");
  });

  it("omits the parameter for the default, rather than writing it", () => {
    expect(modeIn(withMode("", DEFAULT_MODE))).toBeNull();
    expect(withMode("", DEFAULT_MODE)).toBe("");
  });

  it("REMOVES a mode already in the carried string when returning to the default", () => {
    /* The half that would be a real bug rather than an untidy URL: `carriedSearch`
       hands this whatever the reader had, so leaving `?mode=chat` in place would
       navigate to the hierarchy and land in chat. Deleting is not the same as
       declining to write. */
    expect(modeIn(withMode("mode=chat", DEFAULT_MODE))).toBeNull();
    expect(modeIn(withMode("at=spya-k3m9qt&mode=search", DEFAULT_MODE))).toBeNull();
  });

  it("overwrites rather than appends, so one mode never becomes two", () => {
    /* `mode=a&mode=b` is a URL whose meaning depends on which one the parser reads
       first — the reason this function exists instead of a string concatenation. */
    const out = withMode("mode=chat", "glossary");
    expect(new URLSearchParams(out).getAll("mode")).toEqual(["glossary"]);
  });

  it("keeps the other parameters either way", () => {
    expect(new URLSearchParams(withMode("at=spya-k3m9qt", "chat")).get("at")).toBe("spya-k3m9qt");
    expect(new URLSearchParams(withMode("at=spya-k3m9qt&mode=chat", DEFAULT_MODE)).get("at")).toBe(
      "spya-k3m9qt",
    );
  });
});
