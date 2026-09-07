/**
 * **The conflict-marker gate, and the false positives it must not have.**
 *
 * scripts/conflict-markers.ts carries the design and the measurements; this
 * file is the evidence for the half that matters — that the rule can tell a
 * real marker from a quoted one. Every agent on this box runs `npm run check`,
 * so a false positive here breaks other people's gates, and a check that cries
 * wolf gets switched off.
 *
 * **No literal run of seven marker characters appears in this file**, which is
 * not tidiness: `260903b`'s own receipts record that the first fixture for the
 * journal guard built its markers by hand and *"tripped `git diff --check`
 * inside the very test file that guards against markers"*. They are built with
 * `repeat()` here, and this file is itself scanned by the whole-tree assertion
 * at the bottom.
 */
import { describe, expect, it } from "vitest";
import { conflictMarkers, looksBinary, scanRepository, trackedFiles } from "../scripts/conflict-markers.js";

/** A marker of `n` characters, built rather than typed. */
const m = (ch: string, n = 7) => ch.repeat(n);

/** What git actually leaves behind: ours, theirs, and the line between. */
const conflicted = (eol = "\n") =>
  [`${m("<")} HEAD`, '  "a": 1,', m("="), '  "a": 2,', `${m(">")} origin/dev`].join(eol);

describe("what a real conflict looks like", () => {
  it("finds all three markers, and says which lines", () => {
    const found = conflictMarkers(conflicted());
    expect(found.map((f) => f.line)).toEqual([1, 3, 5]);
    expect(found[0]?.text).toContain("HEAD");
  });

  /**
   * `conflict-marker-size` is configurable and this repo's journal guard already
   * handles it — eight `<` used to slip straight past that one.
   */
  it("catches markers longer than the default seven", () => {
    const long = [`${m("<", 9)} HEAD`, m("=", 9), `${m(">", 9)} theirs`].join("\n");
    expect(conflictMarkers(long)).toHaveLength(3);
  });

  /**
   * **The lone diff3 base marker, which an earlier draft of this check let
   * through.** GPT Sol found it: `tests/migration-journal.test.ts` tests exactly
   * this half-finished resolution — the markers either side already deleted —
   * so "a real conflict always brings the opening marker" is false for the class
   * under discussion, which is *interrupted* resolution.
   */
  it("catches a lone diff3 base marker with nothing either side of it", () => {
    expect(conflictMarkers(["{", `${m("|")} base`, "}"].join("\n"))).toHaveLength(1);
  });

  /**
   * A CRLF file would leave `\r` on the end of a bare separator, so a rule
   * anchored with `$` would never match it. Split on `/\r?\n/` instead — the
   * same reason `readJournal` reads real lines.
   */
  it("catches a CRLF conflict, and quotes the marker without the carriage return", () => {
    const found = conflictMarkers(conflicted("\r\n"));
    expect(found).toHaveLength(3);
    expect(found[1]?.text).toBe(m("="));
  });
});

describe("what it must never call a conflict", () => {
  /**
   * **The biggest one, and the reason `=` is conditional.** A Markdown setext
   * heading underlines its title with `=`, and there are over 1,500 tracked
   * Markdown files.
   */
  it("leaves a Markdown setext heading alone", () => {
    expect(conflictMarkers(["A title", m("=", 20), "", "Some prose."].join("\n"))).toEqual([]);
  });

  it("leaves a horizontal divider of equals signs alone", () => {
    expect(conflictMarkers([m("=", 60), "summary", m("=", 60)].join("\n"))).toEqual([]);
  });

  /** How every doc in this repo quotes one today: inline, inside backticks. */
  it("leaves an inline quotation alone", () => {
    const doc = `Resolve by deleting the \`${m("<")}\` / \`${m("=")}\` / \`${m(">")}\` markers as you go.`;
    expect(conflictMarkers(doc)).toEqual([]);
  });

  /** And how the review prompts quote one: a whole diff, every line prefixed. */
  it("leaves a marker inside a quoted diff alone", () => {
    const patch = ["@@ -1,3 +1,5 @@", ` ${m("<")} HEAD`, `+${m("=")}`, `+${m(">")} origin/dev`].join("\n");
    expect(conflictMarkers(patch)).toEqual([]);
  });

  /** An indented marker is a quotation too — a fenced block, or example code. */
  it("leaves an indented marker alone", () => {
    expect(conflictMarkers(`    ${m("<")} HEAD\n    ${m("=")}\n`)).toEqual([]);
  });

  /**
   * `src/link-summary.ts` fences its untrusted-page sections with runs of `===`.
   * Three, not seven — pinned so a future widening of that fencing is noticed
   * here rather than in somebody else's gate.
   */
  it("leaves the link-summary fencing alone", () => {
    expect(conflictMarkers("=== BEGIN UNTRUSTED PAGE ===")).toEqual([]);
  });

  /** Arrows and comparison operators, which are not markers however many. */
  it("leaves ordinary text that starts with the characters alone", () => {
    expect(conflictMarkers(`${m("<")}HEAD`)).toEqual([]);
    expect(conflictMarkers("<<< not a marker >>>")).toEqual([]);
    expect(conflictMarkers("")).toEqual([]);
  });
});

/**
 * **The limits, pinned as tests rather than left in prose.**
 *
 * Each of these is a case this gate deliberately does not handle. A blind spot
 * nothing asserts is indistinguishable from one nobody noticed, and the next
 * author to "fix" one of these should have to delete a test that says why.
 */
describe("what it deliberately does not catch", () => {
  /**
   * `conflict-marker-size` is configurable **downwards**, so a four-character
   * marker passes. This is the identical limit `readJournal` has, named in
   * docs/project/database.md as *"a good first line rather than a fence"*, and
   * it is matched on purpose: lowering the floor on a gate every agent runs
   * would start reporting `====` dividers and `<<<<` in prose as conflicts.
   */
  it("misses a marker shorter than git's default seven", () => {
    const short = [`${m("<", 4)} HEAD`, m("=", 4), `${m(">", 4)} theirs`].join("\n");
    expect(conflictMarkers(short)).toEqual([]);
  });

  /**
   * The price of making `=` conditional, and it is not the incident's shape —
   * the journal that caused all this contained `<<<<<<< HEAD`.
   */
  it("misses a lone separator with no opening marker anywhere in the file", () => {
    expect(conflictMarkers(["{", m("="), "}"].join("\n"))).toEqual([]);
  });

  /**
   * **A fenced quotation IS reported**, and once it has been, a legitimate
   * setext underline in the same file is reported alongside it. Telling a fence
   * from a conflict needs a Markdown parser and this gate is not going to grow
   * one. Asserted so the behaviour is known rather than discovered by whoever
   * writes the next postmortem.
   */
  it("reports a marker fenced in Markdown, and the setext heading beside it", () => {
    const doc = ["# A doc", "", "```", `${m("<")} HEAD`, "```", "", "A heading", m("=", 9), ""].join(
      "\n",
    );
    expect(conflictMarkers(doc).map((f) => f.line)).toEqual([4, 8]);
  });
});

describe("binary files", () => {
  /**
   * `git grep -I` does **not** skip `evals/pdf/much-harder/source.pdf` — it
   * reads it as text and reports 69 lines beginning `<<`. None reaches seven
   * today, so the gate is green; a future ASCII-heavy PDF would fail it for
   * everybody. So the NUL check is ours, not git's.
   */
  it("skips a file with a NUL byte anywhere in it", () => {
    expect(looksBinary(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x41]))).toBe(true);
    expect(looksBinary(Buffer.from("plain text\n", "utf8"))).toBe(false);
  });

  /**
   * **Git's window is the first 8 KB and two tracked PDFs pass it**, which is
   * why the whole buffer is scanned instead. The file is already in memory by
   * then, so it costs nothing.
   */
  it("looks past the first 8 KB, where git's own heuristic stops", () => {
    const late = Buffer.concat([Buffer.from("A".repeat(9000), "utf8"), Buffer.from([0x00])]);
    expect(looksBinary(late)).toBe(true);
    expect(late.subarray(0, 8000).includes(0), "the case git's heuristic misses").toBe(false);
  });
});

describe("this repository", () => {
  it("has no unresolved conflict markers in any tracked file", () => {
    /* The positive control. `git ls-files` returning nothing — a moved root, a
       changed flag — would make the assertion below vacuously true over an
       empty list, which is the exact bug this whole tier of work is about. */
    expect(trackedFiles().length, "no tracked files were scanned at all").toBeGreaterThan(1000);

    const findings = scanRepository();
    expect(
      findings.map((f) => `${f.file}:${f.markers[0]?.line}`),
      "finish the merge in these files — scripts/conflict-markers.ts says how",
    ).toEqual([]);
  });
});
