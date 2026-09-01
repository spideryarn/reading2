/**
 * Painting the iTerm tab that is on the box.
 *
 * The failure this guards is quiet in both directions. Get the bytes wrong and
 * the tab simply never changes colour — nothing errors, nothing is logged, and
 * the tab looks exactly like one that was deliberately left alone. Get the
 * guards wrong and `]6;1;bg;red;brightness;167` is printed as text into
 * somebody's terminal, or into a file they were redirecting to.
 *
 * So the sequences here are pinned to bytes that were watched working: written
 * to a live iTerm 3.6.6 session's tty on 2026-08-31 with the tab bar
 * photographed before and after, including a control (bright green, so the
 * change could not be mistaken for the violet several tabs already had). See
 * docs/plans/260831ae-gjd-remote-iterm-tab-colour.md.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REMOTE_TAB_COLOUR,
  TAB_COLOUR_ENV,
  canColourTab,
  colourSequence,
  wantedColour,
} from "../scripts/gjd-remote-tab.js";

/** An iTerm terminal with nothing in the way. */
const ITERM = { TERM_PROGRAM: "iTerm.app" } as NodeJS.ProcessEnv;

describe("colourSequence", () => {
  it("is the exact byte string that coloured a real tab", () => {
    // Verbatim what went down /dev/ttys041 and turned the tab violet.
    expect(colourSequence({ r: 167, g: 139, b: 250 })).toBe(
      "\u001b]6;1;bg;red;brightness;167\u0007" +
        "\u001b]6;1;bg;green;brightness;139\u0007" +
        "\u001b]6;1;bg;blue;brightness;250\u0007",
    );
  });

  it("resets with the wildcard channel, not by painting the profile colour back", () => {
    // There is no way to read a tab's colour, so "put it back" can only ever
    // mean "hand it to the profile". Painting a remembered default would be a
    // second copy of a value we never read.
    expect(colourSequence("default")).toBe("\u001b]6;1;bg;*;default\u0007");
  });

  it("opens with ESC ] and closes every sequence with BEL", () => {
    // Named separately from the equality above: if a future edit loses the
    // control characters, the string still looks plausible in a diff and the
    // feature is dead. This is the assertion that goes red for that.
    const seq = colourSequence({ r: 1, g: 2, b: 3 });
    expect(seq.split("\u0007").length - 1).toBe(3);
    expect(seq.startsWith("\u001b]")).toBe(true);
    expect(seq).not.toContain("\\u001b");
  });

  it("keeps the control characters out of the source as literal bytes", () => {
    // The comment in gjd-remote-tab.ts says to write \u escapes, and an
    // invisible ESC in source is exactly the kind of thing a peer edit or a
    // scripted rewrite drops without leaving a mark in the diff.
    const src = readFileSync(new URL("../scripts/gjd-remote-tab.ts", import.meta.url), "utf8");
    // Character codes rather than a regex: a regex for control characters has to
    // contain control characters, which is the thing being forbidden.
    const control = [...src].filter((c) => {
      const n = c.charCodeAt(0);
      return n < 32 && n !== 9 && n !== 10 && n !== 13;
    });
    expect(control).toEqual([]);
  });
});

describe("wantedColour", () => {
  it("parses the built-in default, which nothing else checks", () => {
    // wantedColour asserts non-null on parsing REMOTE_TAB_COLOUR. A typo in
    // that constant would make it undefined at runtime and the assertion is
    // erased by the compiler, so this is the only thing standing behind it.
    expect(wantedColour({})).toEqual({ kind: "colour", rgb: { r: 167, g: 139, b: 250 } });
    expect(REMOTE_TAB_COLOUR).toBe("#a78bfa");
  });

  it("takes a colour with or without the hash, in either case", () => {
    const rgb = { r: 18, g: 52, b: 86 };
    expect(wantedColour({ [TAB_COLOUR_ENV]: "#123456" })).toEqual({ kind: "colour", rgb });
    expect(wantedColour({ [TAB_COLOUR_ENV]: "123456" })).toEqual({ kind: "colour", rgb });
    expect(wantedColour({ [TAB_COLOUR_ENV]: " #AbCdEf " })).toEqual({
      kind: "colour",
      rgb: { r: 171, g: 205, b: 239 },
    });
  });

  it("switches off on off, none, and empty", () => {
    for (const v of ["off", "OFF", "none", "", "  "]) {
      expect(wantedColour({ [TAB_COLOUR_ENV]: v })).toEqual({ kind: "off" });
    }
  });

  it("calls a value it does not understand bad, rather than falling back", () => {
    // Falling back to violet here would make a mistyped setting indistinguishable
    // from an honoured one — docs/reusable/silent-success.md.
    for (const v of ["purple", "#12345", "#1234567", "#12345g", "167,139,250"]) {
      expect(wantedColour({ [TAB_COLOUR_ENV]: v })).toEqual({ kind: "bad", value: v });
    }
  });
});

describe("canColourTab", () => {
  it("paints an iTerm tty", () => {
    expect(canColourTab(ITERM, true)).toBe(true);
  });

  it("refuses when stdout is not a terminal", () => {
    // `gjd-remote ls | grep foo` must not put escape bytes in the pipe.
    expect(canColourTab(ITERM, false)).toBe(false);
  });

  it("refuses a terminal that is not iTerm, including an unset one", () => {
    expect(canColourTab({ TERM_PROGRAM: "Apple_Terminal" }, true)).toBe(false);
    expect(canColourTab({}, true)).toBe(false);
  });

  it("refuses over ssh, and when CI is set", () => {
    // TERM_PROGRAM is an ordinary inherited variable: on the far side of an ssh
    // it describes the machine you came FROM, exactly as iterm.md says of
    // ITERM_SESSION_ID. And nothing in CI has a tab to colour.
    expect(canColourTab({ ...ITERM, SSH_CONNECTION: "10.0.0.1 52 10.0.0.2 22" }, true)).toBe(false);
    expect(canColourTab({ ...ITERM, SSH_TTY: "/dev/pts/0" }, true)).toBe(false);
    expect(canColourTab({ ...ITERM, CI: "true" }, true)).toBe(false);
  });

  it("refuses inside tmux or screen", () => {
    // iTerm's own docs say its proprietary sequences may not survive a
    // multiplexer, and TERM_PROGRAM is inherited, so it can say iTerm.app
    // inside a tmux whose outer terminal is something else entirely.
    expect(canColourTab({ ...ITERM, TMUX: "/tmp/tmux-501/default,1,0" }, true)).toBe(false);
    expect(canColourTab({ ...ITERM, STY: "1234.pts-0.box" }, true)).toBe(false);
  });
});
