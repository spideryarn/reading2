/**
 * What a pane is SHOWING — tools/fleet/pane.ts § `paneSurface`.
 *
 * Its own file rather than more of `fleet-pane.test.ts`, which is 900 lines
 * about what a dialog says. This is about the other question that file's
 * parser now answers: whether there is an input box, and whether anybody's
 * text is already in it.
 *
 * **THE FAILURE THESE TESTS ARE WRITTEN AGAINST** was proved live on
 * 2026-09-08 against a throwaway session rather than argued from a capture. A
 * box holding `DRAFT-ALPHA` took `OMEGA-SENT-BY-DASHBOARD` onto the end of it,
 * the Enter submitted the concatenation, and the agent answered a user turn
 * neither half of which anybody wrote — while the dashboard returned `ok: true`
 * with a full `verified` block. See
 * docs/plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cleanLines, paneSurface, type PaneSurface } from "../tools/fleet/pane.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/fleet-panes");
const fixture = (name: string): string => readFileSync(path.join(FIXTURES, `${name}.txt`), "utf8");

/**
 * A minimal pane with one line in its box, in the shape every real capture has:
 * transcript, border, prompt, border, status bar.
 *
 * Hand-built rather than a fixture because the point of most of these is a
 * character nobody has yet typed into a real pane, and a fixture per character
 * would be twenty files documenting one rule.
 */
const boxed = (prompt: string, ...extra: string[]): string =>
  [
    "● something the agent said a moment ago",
    "────────────────────────────────────────",
    prompt,
    ...extra,
    "────────────────────────────────────────",
    "  [Opus 5 (1M context)] scratchpad/somewhere",
  ].join("\n");

describe("paneSurface tells an empty input box from an occupied one", () => {
  it("calls a bare box empty and a box with a word in it occupied", () => {
    expect(paneSurface(boxed("❯ ")).kind).toBe("empty-input");
    expect(paneSurface(boxed("❯ keep going")).kind).toBe("occupied-input");
  });

  /**
   * **GPT SOL'S BLOCKER ON THE PLAN, AND THE REASON THIS READS `raw`.**
   *
   * `cleanLines` replaces every character in `DECORATION` — box drawing, block
   * elements, the geometric shapes used as bullets — with a space. That is
   * right for finding geometry and catastrophic for judging emptiness: a box
   * holding `■` or `────` cleans to a line that trims to nothing, so a rule
   * written against `text` calls it empty and the send appends to it.
   *
   * The first assertion is the trap itself, kept in the test so nobody has to
   * take the comment's word for it: cleaned, all of these are indistinguishable
   * from an empty box.
   */
  it("does not mistake a box full of decoration for an empty one", () => {
    for (const typed of ["■", "────", "▓▓▓", "◆◆◆", "└─┘"]) {
      const cleaned = cleanLines(boxed(`❯ ${typed}`))[2]?.text ?? "";
      expect(cleaned.trim(), `${typed} is supposed to demonstrate the trap`).toBe("❯");

      expect(paneSurface(boxed(`❯ ${typed}`)).kind, `a box holding ${typed} must not read as empty`).toBe(
        "occupied-input",
      );
    }
  });

  /**
   * The other direction, and it is the one that would kill the feature rather
   * than the safety. An empty Claude Code box is `❯` followed by a single
   * U+00A0. `String.prototype.trim` folds that; a hand-rolled `/^ *$/` would
   * not, and every empty box on the fleet would read as occupied, no message
   * would go out again, and nothing would go red.
   */
  it("treats the NBSP a real empty box contains as whitespace", () => {
    expect(" ".trim()).toBe("");
    expect(paneSurface(boxed("❯ ")).kind).toBe("empty-input");
    expect(paneSurface(boxed("❯   ")).kind).toBe("empty-input");
  });

  /** A wrapped or multi-line draft, counted rather than merely detected. */
  it("counts the lines of a draft that has grown past one", () => {
    const surface = paneSurface(boxed("❯ 1. read the plan", "  2. write the test", "  3. stop and report"));
    expect(surface.kind).toBe("occupied-input");
    if (surface.kind !== "occupied-input") return;
    expect(surface.lines).toBe(3);
  });

  /**
   * Sol's second half of the same finding: a draft line made only of decoration
   * is classified a `rule` by `cleanLines`, so a scan that stopped at the first
   * rule would take it for the box's closing border and never look at the lines
   * below it. The prompt line is occupied here anyway, which is why this is a
   * belt rather than the braces — but the scan must not end early either.
   */
  it("does not take a decoration-only draft line for the closing border", () => {
    const surface = paneSurface(boxed("❯ here is a table", "────────", "  and its caption"));
    expect(surface.kind).toBe("occupied-input");
  });

  /**
   * **WHAT IT CANNOT SEE, ASSERTED SO THE LIMIT IS ON THE RECORD** rather than
   * only in a comment. A box holding nothing but spaces renders exactly like an
   * empty one and the capture carries no cursor, so this returns `empty-input`
   * and a send would append to whitespace nobody meant. That is the residue of
   * reading a rendering instead of an editor's state, and it is not closable
   * here. If it ever is, this test is what should change.
   */
  it("cannot see a box holding only spaces, and that is a known limit", () => {
    expect(paneSurface(boxed("❯      ")).kind).toBe("empty-input");
  });
});

describe("paneSurface refuses everything that is not one of the two boxes", () => {
  it("says unrecognised, with a reason, for a screen that has no box at all", () => {
    for (const capture of ["", fixture("none-blank-pane"), fixture("none-bare-shell")]) {
      const surface = paneSurface(capture);
      expect(surface.kind).toBe("unrecognised");
      if (surface.kind !== "unrecognised") return;
      expect(surface.why.length).toBeGreaterThan(10);
    }
  });

  it("hands back the dialog it parsed, rather than re-parsing it downstream", () => {
    const surface = paneSurface(fixture("dialog-bash-permission"));
    expect(surface.kind).toBe("dialog");
    if (surface.kind !== "dialog") return;
    expect(surface.question.options.length).toBeGreaterThan(1);
  });
});

/**
 * **THE WHOLE CORPUS, CLASSIFIED, WITH A COUNT PER ARM.**
 *
 * Written as counts as well as a table because a change that silently moves one
 * capture between arms is exactly the failure this is for, and a per-file
 * assertion alone would let a NEW fixture arrive in the wrong arm unnoticed.
 *
 * **The two occupied ones are not called `drafted`**, and that is Sol's point
 * rather than pedantry: `❯ do all three` in `none-working-with-prose-decisions-list`
 * may be somebody's half-typed reply, a suggestion the harness offered, or the
 * greyed hint a never-used session draws. A capture renders all three the same
 * way. What is true of all of them is that the box is not empty.
 */
describe("every capture in the corpus lands in a known arm", () => {
  const EXPECTED: Record<string, PaneSurface["kind"]> = {
    "dialog-ask-user-question": "dialog",
    "dialog-ask-user-question-colour": "dialog",
    "dialog-ask-user-question-two-column": "dialog",
    "dialog-bash-permission": "dialog",
    "dialog-bash-permission-ansi": "dialog",
    "dialog-bash-permission-git-log": "dialog",
    // Constructed rather than captured — see fleet-pane.test.ts § materialAbove.
    // It is still a DIALOG here, and the two questions are worth keeping apart:
    // `paneSurface` says what is on the screen, and a clipped dialog is a dialog.
    // Whether its body can be trusted is `PaneMaterial`'s question, and there it
    // answers `unreadable`.
    "dialog-clipped-at-a-solid-separator": "dialog",
    "dialog-edit-diff": "dialog",
    "dialog-file-write": "dialog",
    "dialog-file-write-goodbye": "dialog",
    "dialog-file-write-hello": "dialog",
    "dialog-folder-trust": "dialog",
    "dialog-folder-trust-ansi": "dialog",
    "dialog-loop-cloud-schedule": "dialog",
    "dialog-model-selector": "dialog",
    "dialog-model-selector-ansi": "dialog",
    "none-bare-shell": "unrecognised",
    "none-blank-pane": "unrecognised",
    "none-dialog-just-answered": "empty-input",
    "none-idle-with-prose-numbered-list": "empty-input",
    "none-slash-command-autocomplete": "empty-input",
    "none-typed-numbered-message-in-input-box": "occupied-input",
    "none-working-empty-prompt": "empty-input",
    "none-working-with-lettered-table": "empty-input",
    "none-working-with-prose-decisions-list": "occupied-input",
  };

  it("classifies each one as expected, and the corpus has not grown unnoticed", () => {
    const names = readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => f.replace(/\.txt$/, ""))
      .sort();

    // A NEW FIXTURE MUST BE CLASSIFIED DELIBERATELY. Without this, somebody
    // adds a capture, this file keeps passing, and the one arm nobody checked
    // is the one it landed in.
    expect(names).toEqual(Object.keys(EXPECTED).sort());

    const got: Record<string, PaneSurface["kind"]> = {};
    for (const name of names) got[name] = paneSurface(fixture(name)).kind;
    expect(got).toEqual(EXPECTED);
  });

  it("holds the count in each arm, so a fixture cannot drift between them quietly", () => {
    const counts: Record<string, number> = {};
    for (const name of Object.keys(EXPECTED)) {
      const kind = paneSurface(fixture(name)).kind;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    expect(counts).toEqual({ dialog: 16, "empty-input": 5, "occupied-input": 2, unrecognised: 2 });
  });
});
