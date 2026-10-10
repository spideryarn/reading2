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

import { cleanLines, paneSurface, parsePane, stripAnsi, undimmedLines, type PaneSurface } from "../tools/fleet/pane.js";

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
   * A decoration-only draft line must not end the scan. The prompt line is
   * occupied here anyway, so this one would pass even with the bug below —
   * which is exactly why it is not enough on its own, and why the next test
   * exists.
   */
  it("does not take a decoration-only draft line for the closing border", () => {
    const surface = paneSurface(boxed("❯ here is a table", "────────", "  and its caption"));
    expect(surface.kind).toBe("occupied-input");
  });

  /**
   * **GPT SOL'S BLOCKER ON THE BUILT CODE, and the reason the closing border is
   * now matched on geometry rather than on "is it a rule".**
   *
   * Claude Code takes multiline input on Ctrl+J, so a person can put an empty
   * first line into the box and paste a table under it. `cleanLines` calls any
   * line holding nothing but decoration a rule — so the FIRST version of this
   * function took that `────────` for the box's closing border, stopped, never
   * read `caption`, and returned `{"kind":"empty-input","promptLine":1}`. Sol
   * ran the construction rather than describing it, which is why this is a
   * blocker and not a note.
   *
   * **The test above passes with that bug present**, because its prompt line is
   * already occupied. That is the shape this whole file is about: a case that
   * passes for a reason other than the one it was written for proves nothing.
   * Here the prompt line is EMPTY, so the only thing that can make it occupied
   * is reading past the decoration.
   *
   * **Reversing the two statements is not the fix**, and that trap is why the
   * code measures instead. The genuine closing border is also a rule with
   * nothing on it, so counting continuations first would count the border as a
   * line of draft and call every empty box occupied. In all seven real captures
   * the closing border has exactly the top border's width and indent, because
   * Claude Code draws the box as a matched pair; a rule typed into a draft does
   * not.
   */
  it("reads past a decoration line into the draft under it, with an EMPTY prompt line", () => {
    const surface = paneSurface(boxed("❯ ", "────────", "  caption"));
    expect(surface.kind).toBe("occupied-input");
    if (surface.kind !== "occupied-input") return;
    expect(surface.lines).toBe(2);
  });

  /**
   * The other side of the same rule, and the reason it is geometry rather than
   * "count everything": the genuine closing border must still end the scan, or
   * every empty box on the fleet reads as occupied and no message goes out
   * again.
   */
  it("still stops at the real closing border, so an empty box stays empty", () => {
    const surface = paneSurface(boxed("❯ "));
    expect(surface.kind).toBe("empty-input");
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

/**
 * **A GHOST SUGGESTION IS NOT INPUT** — 2026-10-10, and
 * docs/postmortems/261010b-ghost-suggestion-read-as-typed-input.md.
 *
 * After a turn Claude Code pre-fills its empty box with a suggested next prompt
 * (`carry on`, `go ahead`), and a never-used session shows a hint (`Try
 * "refactor <filepath>"`). Neither is in the input buffer: the first keystroke
 * replaces it. Both are drawn with SGR 2, dim, and typed text is not — measured
 * on a throwaway Claude Code 2.1.296 under its own tmux server, where typed,
 * multi-line and pasted input (the `[Pasted text #1 +11 lines]` pill included)
 * all came back with no attribute at all after the `❯ `.
 *
 * A plain `capture-pane -p` drops attributes, so `carry on` read as somebody's
 * draft and every message to a session showing one was refused with
 * `input-not-empty`. `none-ghost-suggestion-ansi.txt` is a real `-p -e` capture
 * of a session in exactly that state, taken read-only off the box.
 *
 * The other cases are that capture with its prompt line rewritten, because the
 * only thing that differs between them is the prompt line.
 */
describe("paneSurface reads a dim ghost suggestion as an empty box", () => {
  const ghost = fixture("none-ghost-suggestion-ansi");
  const GHOST = "\u001b[2mcarry on\u001b[0m";
  const withPrompt = (after: string): string => {
    expect(ghost.includes(GHOST), "the fixture's ghost run is what these cases rewrite").toBe(true);
    return ghost.replace(GHOST, after);
  };

  it("calls a box holding only a dim suggestion empty", () => {
    expect(paneSurface(ghost).kind).toBe("empty-input");
  });

  it("calls a box holding typed (undimmed) text occupied", () => {
    expect(paneSurface(withPrompt("keep going please")).kind).toBe("occupied-input");
  });

  it("calls typed text with a dim completion tail occupied", () => {
    expect(paneSurface(withPrompt("/comp\u001b[2mact\u001b[0m")).kind).toBe("occupied-input");
    expect(paneSurface(withPrompt("\u001b[2mcarry\u001b[0m on")).kind).toBe("occupied-input");
  });

  it("does not take a colour parameter of 2 for dim", () => {
    // `38;2;r;g;b` is truecolour and `38;5;2` palette green: a `2` that is a
    // sub-parameter is not the dim attribute.
    expect(paneSurface(withPrompt("\u001b[38;2;2;2;2mcarry on\u001b[0m")).kind).toBe("occupied-input");
    expect(paneSurface(withPrompt("\u001b[38;5;2mcarry on\u001b[0m")).kind).toBe("occupied-input");
    expect(paneSurface(withPrompt("\u001b[38:2::2:2:2mcarry on\u001b[0m")).kind).toBe("occupied-input");
  });

  it("follows dim being switched off again", () => {
    expect(paneSurface(withPrompt("\u001b[2;22mcarry on\u001b[0m")).kind).toBe("occupied-input");
    expect(paneSurface(withPrompt("\u001b[2mcarry\u001b[mon\u001b[0m")).kind).toBe("occupied-input");
  });

  it("carries dim across a line break, as tmux's -e output does", () => {
    // tmux emits attribute CHANGES, so a long suggestion wrapped onto a second
    // line may carry its dim without re-emitting it. The genuine closing border
    // re-emits its own colour, which does not cancel dim, and is still found.
    const wrapped = withPrompt("\u001b[2mcarry on with the rest of the plan\n  and then report\u001b[0m");
    expect(paneSurface(wrapped).kind).toBe("empty-input");
  });

  it("still sees a typed continuation line under a dim prompt line", () => {
    const mixed = withPrompt("\u001b[2mcarry on\u001b[0m\n  typed underneath");
    const surface = paneSurface(mixed);
    expect(surface.kind).toBe("occupied-input");
  });

  it("does not mistake a typed ❯ for a dim structural prompt marker", () => {
    for (const draft of ["❯", "DRAFT❯", "■❯", "────❯"]) {
      expect(paneSurface(boxed(`\u001b[2m❯ \u001b[0m${draft}`)).kind, draft).toBe("occupied-input");
    }
  });

  it("preserves geometry when -e emits colon-form underline and coloured padding", () => {
    const capture = boxed("❯ \u001b[2mcarry on\u001b[0m")
      .split("\n")
      .map((line) => `\u001b[4:3m${line}\u001b[0m\u001b[48;5;2m   \u001b[49m`)
      .join("\n");
    expect(stripAnsi(capture)).toBe(boxed("❯ carry on").split("\n").map((line) => `${line}   `).join("\n"));
    expect(paneSurface(capture).kind).toBe("empty-input");
  });

  it("keeps attributed and plain dialog readings identical", () => {
    const plain = fixture("dialog-ask-user-question");
    expect(parsePane(plain).kind).toBe("question");
    const attributed = plain.split("\n").map((line) => `\u001b[4:3m${line}\u001b[0m\u001b[48;5;2m   \u001b[49m`).join("\n");
    expect(parsePane(attributed)).toEqual(parsePane(plain));
    expect(paneSurface(attributed)).toEqual(paneSurface(plain));
  });

  it.each(["38;5;2", "48;5;2", "58;5;2", "38;2;2;2;2", "48;2;2;2;2", "58;2;2;2;2",
    "38:5:2", "48:2::2:2:2", "58:2:2:2:2"])("does not read %s colour components as dim", (params) => {
    expect(paneSurface(withPrompt(`\u001b[${params}mDRAFT\u001b[0m`)).kind).toBe("occupied-input");
  });

  it.each(["22", "0", "", ";", "38;5;2;22", "48;2;2;2;2;22", "58:2::2:2:2;22"])(
    "sees typed text after a dim run is reset by SGR %s", (params) => {
      expect(paneSurface(withPrompt(`\u001b[2mghost\u001b[${params}mDRAFT\u001b[0m`)).kind).toBe("occupied-input");
    },
  );

  it.each(["999", "2:0", "38;2;22", "48;5", "58;2;0;0", "?2"])(
    "keeps text after uncertain SGR %s rather than trusting dim", (params) => {
      expect(paneSurface(withPrompt(`\u001b[2mghost\u001b[${params}mDRAFT\u001b[0m`)).kind).toBe("occupied-input");
    },
  );

  it.each(["\u0007", "\u001b\\"])("ignores OSC 8 payloads and keeps linked draft text (%j terminator)", (end) => {
    const link = (text: string) => `\u001b]8;;https://example.test/${end}${text}\u001b]8;;${end}`;
    expect(paneSurface(withPrompt(link("DRAFT"))).kind).toBe("occupied-input");
    expect(paneSurface(withPrompt(`\u001b[2m${link("ghost")}\u001b[0m`)).kind).toBe("empty-input");
    // A newline in metadata must not shift the occupancy rows relative to geometry.
    const capture = withPrompt(`\u001b[2mghost\u001b[0m\n  \u001b]8;;https://example.test/\n${end}DRAFT\u001b]8;;${end}`);
    expect(undimmedLines(capture)).toHaveLength(cleanLines(capture).length);
    expect(paneSurface(capture).kind).toBe("occupied-input");
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
    "none-ghost-suggestion-ansi": "empty-input",
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
    expect(counts).toEqual({ dialog: 16, "empty-input": 6, "occupied-input": 2, unrecognised: 2 });
  });
});
