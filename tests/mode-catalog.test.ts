/**
 * **The rules the catalog's data has to obey, none of which the compiler can
 * see.**
 *
 * `Record<Mode, ModeCatalogEntry>` gets us totality and the three fields for
 * free — a fifteenth mode is red in src/mode-catalog.ts until it has an entry,
 * and an entry without a `description` does not compile. What the type cannot
 * say is anything about the **values**, and the values are where this table can
 * go quietly wrong: an alias claimed by two modes, an alias that is another
 * mode's name, an alias with a capital letter in it that will never match
 * anything the reader types.
 *
 * Every one of those is invisible at the point somebody writes it. Nothing goes
 * red, nothing looks odd in review, and the symptom arrives later as a command
 * bar that opens the wrong mode — or a word sitting in the table doing nothing
 * at all, which is the worse of the two because it never even misbehaves.
 * docs/reusable/silent-success.md.
 *
 * ## What is deliberately NOT asserted here
 *
 *  - **That the catalog agrees with `MODES_UI`.** After 2026-09-07 the Dock
 *    rows no longer carry a description or an experimental flag, so a
 *    comparison would be a check that cannot fail.
 *  - **Which modes are experimental.** That is
 *    tests/dock-experimental-modes.test.tsx § `BEHIND_THE_SWITCH`, an
 *    independently written list whose whole job is to be a second opinion. A
 *    copy of it here — or worse, a derivation from this table — would assert
 *    that the catalog says what the catalog says, and would take the canary
 *    with it. docs/project/new-mode.md § Moving a mode in or out of the switch.
 *
 * So this file checks the shape of the data and never its membership.
 *
 * See docs/plans/260906h-mode-catalog-and-a-command-bar.md § Stage 1.
 */
import { describe, expect, it } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES, type Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
/* The command bar's own normaliser — see § the one form these are compared in,
   below, for why this is imported rather than written out again here. */
import { canonical } from "../src/web/command-match.js";

/**
 * **The one form these are all compared in**, and the shape the command bar's
 * matcher normalises a reader's typing into: lowercase, trimmed, and internal
 * runs of whitespace collapsed to one space.
 *
 * The collapse is the part that is easy to leave out, and leaving it out opens
 * a hole GPT Sol reproduced on 2026-09-07: `"peer review"` and `"peer  review"`
 * are different strings, so they pass a uniqueness test that compares raw text,
 * and identical queries, so they collide the moment anybody types either. Every
 * assertion below therefore compares canonical forms, and the last one asserts
 * the table is *stored* canonical.
 *
 * **Imported from the matcher rather than written here**, since 2026-09-07.
 * This was a local `const` while the bar did not exist yet, and the note on it
 * said the point was to make the two agree "by construction rather than by a
 * second normaliser somebody has to remember to point at it" — which a copy in
 * this file could not deliver. Now there is one function: this file checks the
 * table under exactly the rule the bar will apply to it.
 *
 * The import itself is at the top of this file with the others; this is where
 * the reasoning about it lives, because this is where the reasoning was written.
 */

/** Every alias in the table, with the mode that claims it. */
const claims: readonly { mode: Mode; alias: string }[] = MODES.flatMap((mode) =>
  MODE_CATALOG[mode].aliases.map((alias) => ({ mode, alias })),
);

describe("the aliases", () => {
  /**
   * **One word, one destination.**
   *
   * The failure this prevents is not a missed match — it is the *wrong* mode
   * opening for somebody who typed exactly the right thing, decided by which
   * entry the matcher happened to reach first. The message names the word and
   * both claimants, because "aliases are not unique" over fourteen entries is a
   * hunt rather than a fix.
   */
  it("are claimed by exactly one mode each", () => {
    const owners = new Map<string, Mode[]>();
    for (const { mode, alias } of claims) {
      const key = canonical(alias);
      owners.set(key, [...(owners.get(key) ?? []), mode]);
    }
    const shared = [...owners].filter(([, modes]) => modes.length > 1);
    expect(shared.map(([alias, modes]) => `${alias}: ${modes.join(", ")}`)).toEqual([]);
  });

  /**
   * **And never a mode's own name.**
   *
   * Typing `search` must open Search. An alias that is another mode's label
   * makes the bar ambiguous exactly where a reader is most confident, and an
   * ambiguous bar is worse than a bare one. Compared lowercased because that is
   * what the matcher will compare — `MODE_LABEL` is title-cased for a person.
   */
  it("are never another mode's label", () => {
    const labels = new Map(MODES.map((m) => [canonical(MODE_LABEL[m]), m]));
    const collisions = claims
      .filter(({ alias }) => labels.has(canonical(alias)))
      .map(
        ({ mode, alias }) =>
          `${mode} claims "${alias}", which is ${labels.get(canonical(alias))}'s name`,
      );
    expect(collisions).toEqual([]);
  });

  /**
   * **Already in the form the matcher will compare.**
   *
   * The command bar normalises what a reader types and then compares. It does
   * not normalise the table, and it should not have to: an alias stored as
   * `"TOC"`, `" toc"` or `"peer  review"` would sit here looking perfectly
   * correct and match nothing anybody could ever type. Asserting the stored
   * form is already `canonical` is what makes the two sides agree by
   * construction rather than by a second pass somebody could forget to write.
   */
  it("are stored in canonical form and non-empty", () => {
    const wrong = claims
      .filter(({ alias }) => alias !== canonical(alias) || alias.length === 0)
      .map(({ mode, alias }) => `${mode}: ${JSON.stringify(alias)}`);
    expect(wrong).toEqual([]);
  });

  /** And a mode does not list the same word twice — sloppy rather than broken, but still wrong. */
  it("are not repeated within one mode", () => {
    const repeated = MODES.filter(
      (m) => new Set(MODE_CATALOG[m].aliases).size !== MODE_CATALOG[m].aliases.length,
    );
    expect(repeated).toEqual([]);
  });
});

describe("the descriptions", () => {
  it("say something", () => {
    const empty = MODES.filter((m) => MODE_CATALOG[m].description.trim().length === 0);
    expect(empty).toEqual([]);
  });

  /**
   * **No trailing full stop**, which is the convention all fourteen already
   * follow and is worth pinning rather than leaving to whoever writes the
   * fifteenth. These are fragments in furniture — a tooltip, a row in a list —
   * not sentences in prose, and one stop among fourteen bare lines is the kind
   * of inconsistency that is only ever noticed on screen.
   *
   * Only the full stop is refused. Punctuation *inside* the line is nobody's
   * business here — `referee`'s opens with a question mark and `diagram`'s
   * turns on a colon — and a rule about those would be a style guide rather
   * than a check.
   */
  it("do not end in a full stop", () => {
    const stopped = MODES.filter((m) => MODE_CATALOG[m].description.trimEnd().endsWith("."));
    expect(stopped).toEqual([]);
  });
});
