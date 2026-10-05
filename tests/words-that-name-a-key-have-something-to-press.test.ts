/**
 * **Words on screen that tell the reader to press Enter have been looked at
 * by somebody who asked what a phone presses instead.**
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
 * who never opens it on a phone. So this reads every client source file for a
 * string that says *press Enter*, outside comments, and fails on one that is
 * not listed below with what a finger presses instead. It cannot know whether
 * the button named is really there; the listed line says which test does.
 *
 * `help/` is left out: the Help page is where keys are documented, and it
 * says so in a section a phone reader can skip.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "web");

/** Each line that says it, and what a finger presses instead. */
const LOOKED_AT: Record<string, string> = {
  /* Beside the *Ask what you meant* button, and hidden under `pointer: coarse`
     — tests/command-bar-pick.test.tsx § the button that asks. */
  'CommandBar.tsx › export const ASK_OR_ENTER = "or press Enter";': "the button beside it",
  /* The tooltip on the Dock's own command button. Every row the bar then
     draws is pressed with a finger (tests/command-bar.test.tsx). */
  "Dock.tsx › what=\"Type the name of a mode, a page or a thing to do, and press Enter — or ⌘K / Ctrl-K, which opens the same box\"":
    "the bar's rows",
};

const SAYS_PRESS_ENTER = /\bpress(?:es|ing)?\s+(?:the\s+)?(?:enter|return)\b/i;
/** A line that is only comment: a block comment's body, its opening, a `//`, or a JSX comment. */
const COMMENT = /^\s*(?:\*|\/\*|\/\/|\{\/\*)/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "help" ? [] : sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * Every non-comment line that says it. A `/* … *\/` body whose lines do not
 * start with `*` is tracked by its opening and closing, since JSX attribute
 * comments in this codebase are written that way.
 */
function hits(): string[] {
  const found: string[] = [];
  for (const file of sources(CLIENT)) {
    let inBlock = false;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const wasInBlock = inBlock;
      if (line.includes("/*") && !line.includes("*/")) inBlock = true;
      else if (line.includes("*/")) inBlock = false;
      if (wasInBlock || COMMENT.test(line)) continue;
      if (SAYS_PRESS_ENTER.test(line)) found.push(`${path.relative(CLIENT, file)} › ${line.trim()}`);
    }
  }
  return found.sort();
}

describe("words that tell the reader to press Enter", () => {
  it("are each listed with what a finger presses instead", () => {
    expect(hits()).toEqual(Object.keys(LOOKED_AT).sort());
  });

  it("would see the sentence the command bar used to say", () => {
    expect(SAYS_PRESS_ENTER.test('export const ASK_HINT = "Press Enter to ask what you meant.";')).toBe(true);
    expect(COMMENT.test('export const ASK_HINT = "Press Enter to ask what you meant.";')).toBe(false);
  });
});
