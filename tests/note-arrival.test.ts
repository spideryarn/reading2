/**
 * The reading view really *calls* `arrivalTarget` — see src/web/scroll.ts.
 *
 * **A weak test, on purpose, and here is exactly how weak.** The rule that
 * decides where a pasted `?note=` lands is pure and properly tested in
 * scroll.test.ts. The *wiring* — one effect in App.tsx — is React, and this
 * repo has no component runner (docs/plans/260826a-chat-mode.md), so nothing here can
 * say the page actually moves. All this catches is the one regression that
 * would otherwise be silent: the effect being deleted or commented out while
 * everything else stays green, because the pure test would keep passing on a
 * function nobody calls any more.
 *
 * > [!WARNING]
 * > **Comments are stripped before the match, and that is the load-bearing
 * > part.** The effect in App.tsx carries a long explanation that names
 * > `arrivalTarget` three times. A guard that scanned the raw file would be
 * > satisfied by that prose alone, so deleting the call and leaving the comment
 * > would keep this green — which is precisely the failure this repo hit on
 * > 2026-08-26 with a guard on `sanitizeStoredBlocks`. Match a **call**, never a
 * > mention. Proved by deleting the call, keeping the comment, and watching this
 * > go red.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(import.meta.dirname, "..", "src", "web", "App.tsx");

/**
 * Source with every comment removed, so prose cannot satisfy a guard.
 *
 * Line comments are anchored to the start of the line, which leaves `//` inside
 * a string such as an `https://` URL alone — those are not comments and
 * removing the rest of their line would delete real code.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

describe("the ?note= arrival wiring", () => {
  const code = stripComments(readFileSync(APP, "utf8"));

  it("calls arrivalTarget rather than only naming it", () => {
    // The paren is what makes this a call. The import names it too, and an
    // import is not a use.
    expect(code).toMatch(/arrivalTarget\s*\(/);
  });

  it("hands the call something to scroll to", () => {
    // Whatever the effect is called and however it is shaped, the answer has to
    // reach the one function that moves the page.
    const call = code.match(/arrivalTarget\s*\([^)]*\)/);
    expect(call).not.toBeNull();
    const after = code.slice(code.indexOf(call?.[0] ?? "") + (call?.[0].length ?? 0));
    expect(after.slice(0, 400)).toMatch(/scrollToBlock\s*\(/);
  });
});
