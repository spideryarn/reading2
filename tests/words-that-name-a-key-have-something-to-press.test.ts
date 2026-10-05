/**
 * **Product-control strings that tell the reader to press Enter have been
 * looked at by somebody who asked what a phone presses instead.**
 *
 * Greg, on an iPhone, 2026-10-05 (spya-qem46c):
 *
 * > it said, Nothing matches. Press enter to something something. But there
 * > was no way to kick off that action on an iPhone because I don't have an
 * > enter key.
 *
 * The command bar's offer to ask what a sentence meant was a sentence and a
 * key handler, and nothing a finger could press. The class and why it recurs
 * are in
 * docs/postmortems/261005f-an-action-offered-in-words-that-only-a-key-can-take.md.
 *
 * ## A source sweep, for the reason tests/what-the-enter-key-promises.test.tsx gives
 *
 * The failure is *omission*: the next hint is written by somebody at a desk
 * who never opens it on a phone. So this reads every client source file outside
 * `help/` for a contiguous string that says *press Enter*, outside comments,
 * and fails on one that is not listed below with what a finger presses instead.
 * It cannot know whether the button named is really there; the listed string
 * says which test does.
 *
 * `help/` is left out: the Help page is where keys are documented, and it
 * says so in a section a phone reader can skip.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSource, walkAst } from "./helpers/ts-ast.js";

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "web");

/** Each string that says it, and what a finger presses instead. */
const LOOKED_AT: Record<string, string> = {
  /* Beside the *Ask what you meant* button, and hidden under `pointer: coarse`
     — tests/command-bar-pick.test.tsx § the button that asks. */
  'CommandBar.tsx › "or press Enter"': "the button beside it",
  /* The tooltip on the Dock's own command button. Every row the bar then
     draws is pressed with a finger (tests/command-bar.test.tsx). */
  'Dock.tsx › "Type the name of a mode, a page or a thing to do, and press Enter — or ⌘K / Ctrl-K, which opens the same box"':
    "the bar's rows",
};

const SAYS_PRESS_ENTER = /\bpress(?:es|ing)?\s+(?:the\s+)?(?:enter|return)\b/i;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "help" ? [] : sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * Every source string that says it. Parsed rather than stripped by hand: a
 * comment may close before real code on the same line, and `/*` may itself be
 * ordinary string content. Both made the line scanner quietly miss code.
 */
function hitsInSource(source: string, relative: string): string[] {
  const found: string[] = [];
  walkAst(parseSource(source).program, (node) => {
    let value: string | undefined;
    if ((node.type === "StringLiteral" || node.type === "JSXText") && typeof node.value === "string") {
      value = node.value;
    } else if (node.type === "TemplateElement") {
      const cooked = (node.value as { cooked?: unknown } | undefined)?.cooked;
      if (typeof cooked === "string") value = cooked;
    }
    if (value === undefined || !SAYS_PRESS_ENTER.test(value)) return;
    found.push(`${relative} › ${JSON.stringify(value.replace(/\s+/g, " ").trim())}`);
  });
  return found;
}

function hits(): string[] {
  const found: string[] = [];
  for (const file of sources(CLIENT)) {
    found.push(...hitsInSource(readFileSync(file, "utf8"), path.relative(CLIENT, file)));
  }
  return found.sort();
}

describe("product-control strings that tell the reader to press Enter", () => {
  it("are each listed with what a finger presses instead", () => {
    expect(hits()).toEqual(Object.keys(LOOKED_AT).sort());
  });

  it("would see the sentence the command bar used to say", () => {
    expect(hitsInSource('export const ASK_HINT = "Press Enter to ask what you meant.";', "fixture.ts")).toEqual([
      'fixture.ts › "Press Enter to ask what you meant."',
    ]);
  });

  it("does not swallow code after a comment or a comment-shaped string", () => {
    expect(hitsInSource('/* why */ export const HINT = "Press Enter";', "fixture.ts")).toEqual([
      'fixture.ts › "Press Enter"',
    ]);
    expect(hitsInSource('const marker = "/*";\nexport const HINT = "Press Enter";', "fixture.ts")).toContain(
      'fixture.ts › "Press Enter"',
    );
  });
});
