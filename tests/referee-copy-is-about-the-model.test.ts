/**
 * A null result in Referee mode is evidence about the model, never about the
 * paper — and the copy has to say so.
 *
 * This is rule 1 of docs/plans/260831an-referee-mode-for-peer-reviewers.md
 * ("no verdict, ever") applied to the place it is easiest to break by accident.
 * When a criterion runs and matches nothing, there are two very different
 * sentences available:
 *
 *   "Nothing in this paper bears on that."      ← a claim about the paper
 *   "The model did not find a passage for this" ← a claim about the model
 *
 * Only the second one is true. A zero-result row can mean the extractor missed
 * a table, a figure or a supplement; that the paper words the thing differently;
 * or that the model simply failed. GPT Sol's review of the plan made this the
 * condition of Claims surviving at all, and the same reasoning binds every
 * sub-mode: the danger is a tired referee reading "nothing bears on that" and
 * treating the passage as cleared.
 *
 * **This is a tripwire, not a proof.** It scans source text for the handful of
 * phrasings that put the paper in the subject position, so it cannot catch a
 * new sentence nobody has thought of. What it does catch is the specific
 * regression — somebody rewriting the empty state into the shorter, more
 * natural, wrong sentence — which is how this one arrived in the first place
 * (found in a browser pass on 2026-09-01, committed and unnoticed by six
 * unit tests over the panel).
 *
 * Deterministic, no network, no model call, like everything under tests/.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { type AstNode, parseSource, walkAst } from "./helpers/ts-ast.js";

import { CLAIMS_UNUSABLE } from "../src/referee-claims-run.js";
import {
  CLAIM_WITHHELD,
  CLAIMS_AT_CAP,
  claimsOmittedNote,
  DOCUMENT_ORDER_NOTE,
  NO_PASSAGE_FOUND,
  OTHER_TEXT_AT_CAP,
  OTHER_TEXT_HEADING,
  OTHER_TEXT_NOTE,
  PASSAGES_CAPPED,
  PASSAGES_UNUSABLE,
  REASONING_WITHHELD,
} from "../src/referee-claims.js";
import { ANSWER_UNUSABLE } from "../src/referee-criteria-run.js";
import { ALL_DROPPED, COI_NOT_CHECKED, NO_NAMES_YET } from "../src/referee-candidates.js";
import { REFEREE_VIEWS } from "../src/web/referee-views.js";

const ROOT = join(import.meta.dirname, "..");

const WEB = join(ROOT, "src", "web");

/**
 * **Every surface that can render a Referee null result — derived, never
 * listed.**
 *
 * This used to be five paths typed out by hand, each added on the day its panel
 * shipped and each with a dated comment saying why. That is the exact shape
 * docs/reusable/silent-success.md warns about — *"never write a 'should I emit
 * this?' condition as a second list beside the data"* — and its failure mode is
 * the quiet one: a sixth panel is scanned only if somebody remembers, and a
 * scanner that is not pointed at a file reports nothing rather than reporting
 * that it looked nowhere. `tests/store-seams-have-two-implementations.test.ts`
 * is the same move for store seams and has the longer version of the argument.
 *
 * Two rules, and the union of them, because either alone has a hole the other
 * closes:
 *
 * - **What the referee band renders.** `RefereeBand` and `RefereeSubMode` in
 *   src/web/modes/referee/RefereeMode.tsx are the only places a referee sub-mode
 *   reaches the screen, and the `never` in that switch means a fifth
 *   `RefereeView` cannot exist without a panel named there. This catches a panel
 *   that imports nothing with "referee" in the name. **The controller itself
 *   seeds the set**, because it holds the band's own copy and satisfies neither
 *   rule: it is not rendered by itself, and nothing it imports is named
 *   `referee-*`.
 * - **What imports the referee domain.** Any `.tsx` **anywhere** under src/web
 *   that imports a `src/referee-*` or `src/injection-scan*` module. This catches
 *   a surface that is not a sub-mode panel at all — a dialog that grows a referee
 *   section, say — which the first rule cannot see.
 *
 * **Both rules walk the tree rather than one directory, and both resolve a
 * specifier from the file that wrote it.** A non-recursive `readdirSync(WEB)`
 * and a `basename`-and-look-in-`src/web` resolver were both correct until
 * 2026-09-06, when the controller moved down two directories; either one alone
 * would have let `RefereeMode.tsx` leave the scanned set in silence while every
 * floor below stayed green, because the panels it renders still satisfy rule one
 * and the root-level referee files still satisfy rule two.
 * docs/reusable/silent-success.md, and GPT Sol's fourth finding on the plan.
 *
 * A parser rather than a regular expression, for the reason
 * tests/helpers/ts-ast.ts gives: both of this repo's earlier source scans were
 * wrong in both directions, and the direction that matters is a scan that
 * quietly stops matching.
 *
 * ## What the five dated comments said, kept because the reasons are not the same
 *
 * **Criteria** is the original, and the branch the scan is aimed at is its
 * zero-result one. **Claims** is the sub-mode this whole file was written for:
 * the cross-family review made *"the model did not find a passage for this"* —
 * never "none", never "unsupported", never "the paper does not address this" —
 * the condition of Claims surviving at all. **Mirror** is the harder case: its
 * null result is not about the paper at all, since it was never given the
 * paper, so *"nothing in this paper bears on that criterion"* is a claim it has
 * no standing whatever to make. **Candidates**' null result is about neither
 * the paper nor the notes but about *people*, which makes the wrong sentence a
 * larger claim — "no suitable reviewers were found" is about the field — and
 * the phrase list below cannot catch that one, so `ALL_DROPPED` and
 * `NO_NAMES_YET` are checked as values in a block of their own. **The source
 * scan** is the one surface whose null result comes from no model at all
 * (src/injection-scan.ts is deterministic); it is in scope because its failure
 * is the same one in a worse place — a referee reading *nothing found* as *this
 * manuscript is clean*, when what was checked was one HTML string with no
 * stylesheet fetched, no script run and a PDF not opened at all.
 */

/**
 * Which repo file an import specifier points at, if it is one of ours.
 *
 * **Resolved against the importing file's own directory**, not against
 * `src/web`: a controller under `src/web/modes/referee/` reaches its panels as
 * `../../ClaimsPanel.js`, and a resolver that took the basename and looked in
 * `src/web` would agree for the wrong reason today and be wrong outright the
 * first time two directories hold the same file name.
 */
function localTarget(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const stem = resolve(dirname(fromFile), specifier.replace(/\.js$/, ""));
  for (const ext of [".tsx", ".ts"]) {
    if (existsSync(stem + ext)) return relative(ROOT, stem + ext);
  }
  return null;
}

/** Every `.tsx` under `src/web`, at any depth — the mode controllers included. */
function clientComponents(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...clientComponents(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Every name this module **declares**, as opposed to imports.
 *
 * A `const` in the file and an `import` of the same name read identically at
 * every use site, and only one of the two is text this scan can see — which is
 * the hole `the band's own copy stays in the band's own file` below closes.
 */
function declaredNames(ast: AstNode): Set<string> {
  const names = new Set<string>();
  walkAst(ast, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const name = (node.id as { name?: string } | undefined)?.name;
    if (typeof name === "string") names.add(name);
  });
  return names;
}

/** `localName` → specifier, for every `import` in one module. */
function importedNames(ast: AstNode): Map<string, string> {
  const found = new Map<string, string>();
  walkAst(ast, (node) => {
    if (node.type !== "ImportDeclaration") return;
    const from = (node.source as { value?: string } | undefined)?.value;
    if (typeof from !== "string") return;
    for (const spec of (node.specifiers ?? []) as AstNode[]) {
      const local = (spec.local as { name?: string } | undefined)?.name;
      if (typeof local === "string") found.set(local, from);
    }
  });
  return found;
}

/** Every `<Component>` written inside one named function declaration. */
function componentsRenderedBy(ast: AstNode, fnName: string): string[] | null {
  let body: AstNode | null = null;
  walkAst(ast, (node) => {
    if (node.type !== "FunctionDeclaration") return;
    if ((node.id as { name?: string } | undefined)?.name !== fnName) return;
    body = node;
  });
  if (body === null) return null;
  const names = new Set<string>();
  walkAst(body, (node, parent, key) => {
    if (node.type !== "JSXIdentifier" || key !== "name") return;
    if (parent?.type !== "JSXOpeningElement" && parent?.type !== "JSXClosingElement") return;
    const name = node.name as string;
    // Lower-case is an HTML tag; upper-case is a component.
    if (/^[A-Z]/.test(name)) names.add(name);
  });
  return [...names];
}

/** The mode controller: the band, the chips, and the switch over the sub-modes. */
const CONTROLLER = join(WEB, "modes", "referee", "RefereeMode.tsx");
const BAND = parseSource(readFileSync(CONTROLLER, "utf8")) as unknown as AstNode;
const BAND_IMPORTS = importedNames(BAND);

/** Rule one: the controller itself, and the panels the referee band puts on screen. */
const RENDERED_BY_THE_BAND: string[] = (() => {
  /* **Seeded with the controller**, which neither rule would otherwise reach:
     it is not rendered by itself, and nothing it imports is named `referee-*`.
     It carries the band's own copy — the confidentiality notice's wiring and
     `REFEREE_VIEW_TIP`, four sentences a referee reads on hover — so a scan
     that skipped it would be checking the panels and not the band. */
  const out = new Set<string>([relative(ROOT, CONTROLLER)]);
  for (const fn of ["RefereeBand", "RefereeSubMode"]) {
    const names = componentsRenderedBy(BAND, fn);
    if (names === null) {
      throw new Error(
        `src/web/modes/referee/RefereeMode.tsx has no function called ${fn}. This ` +
          `derivation is anchored on it, and a rename or a move that went unnoticed ` +
          `here would silently stop scanning every referee panel — so it is an error ` +
          `rather than an empty list.`,
      );
    }
    for (const name of names) {
      const target = localTarget(CONTROLLER, BAND_IMPORTS.get(name) ?? "");
      if (target?.endsWith(".tsx")) out.add(target);
    }
  }
  return [...out];
})();

/** Rule two: anything under src/web, at any depth, that speaks the referee domain. */
const IMPORTS_THE_DOMAIN: string[] = clientComponents(WEB)
  .filter((full) => {
    const ast = parseSource(readFileSync(full, "utf8")) as unknown as AstNode;
    for (const specifier of importedNames(ast).values()) {
      if (/^(referee-|injection-scan)/.test(basename(specifier))) return true;
    }
    return false;
  })
  .map((full) => relative(ROOT, full));

const REFEREE_SURFACES = [...new Set([...RENDERED_BY_THE_BAND, ...IMPORTS_THE_DOMAIN])].sort();

/**
 * **The scanner that scans nothing passes**, so the derivation is checked
 * before anything derived from it is believed. Floors rather than exact counts:
 * a sixth panel must not turn this file red for the wrong reason.
 */
describe("the list of surfaces is derived, and the derivation found something", () => {
  it("finds panels by both rules, and neither rule comes back empty", () => {
    expect(RENDERED_BY_THE_BAND.length, "nothing is rendered by the referee band").toBeGreaterThan(
      3,
    );
    expect(IMPORTS_THE_DOMAIN.length, "nothing imports the referee domain").toBeGreaterThan(2);
    expect(REFEREE_SURFACES.length).toBeGreaterThan(4);
  });

  it("scans the controller itself, which neither rule reaches on its own", () => {
    /* The seed, asserted rather than assumed. `RefereeMode.tsx` renders the
       panels; nothing renders it, and none of its imports is named `referee-*`,
       so both rules pass it by. It holds the band's own copy, and a scan that
       covered every panel and not the band would be green and blind — the
       failure docs/reusable/silent-success.md is about. */
    expect(REFEREE_SURFACES).toContain("src/web/modes/referee/RefereeMode.tsx");
  });

  it("walks below src/web, so a controller in a subdirectory is still a file it can see", () => {
    /* Rule two used to be a flat `readdirSync`. The assertion is about the
       walker rather than about this one file: at least one scanned surface is
       nested, so a walk that stopped at the top level goes red here instead of
       going quiet. */
    expect(REFEREE_SURFACES.filter((p) => p.split("/").length > 3).length).toBeGreaterThan(0);
  });

  it("the walker itself reaches the controller, and not merely something that renders it", () => {
    /* **The assertion above is not mutation-sensitive on its own** — GPT Sol,
       2026-09-06, F17. `REFEREE_SURFACES` already carries the seeded controller,
       so swapping `clientComponents` back for the old flat `readdirSync` left
       every structural floor here green: the nested path it counts was put
       there by the seed, not found by the walk. This asks the walker the
       question directly, with the seed out of the way. */
    expect(clientComponents(WEB).map((full) => relative(ROOT, full))).toContain(
      "src/web/modes/referee/RefereeMode.tsx",
    );
  });

  it("resolves a specifier against the file that wrote it, not against src/web", () => {
    /* The other half of the same finding, and it needs a specifier the old
       resolver **cannot** answer. Every panel the band renders still sits at the
       top of `src/web` under a unique basename, so basename-and-look-in-`src/web`
       agreed with `localTarget` on all of them and swapping it back changed
       nothing. `./RefereeMode.js` written from the controller is the case that
       separates them: there is no `src/web/RefereeMode.tsx` for a basename to
       find, as the second assertion says out loud — so the old resolver returns
       null here and this one returns the controller. */
    expect(localTarget(CONTROLLER, "./RefereeMode.js")).toBe(
      "src/web/modes/referee/RefereeMode.tsx",
    );
    expect(
      existsSync(join(WEB, "RefereeMode.tsx")),
      "the calibration above is only a calibration while this file does not exist",
    ).toBe(false);
  });

  /**
   * **The band's own copy stays in the band's own file**, so that moving it out
   * fails loudly rather than quietly.
   *
   * GPT Sol, 2026-09-06, F18. Both rules above discover `.tsx` and follow JSX
   * components; neither follows an imported *value*. So `REFEREE_VIEW_TIP`
   * moved into a `modes/referee/RefereeCopy.ts` and imported back would take
   * four sentences a referee reads on hover out of the scan below with every
   * count in this describe still green — a scan reporting clean about text it
   * no longer reads (docs/reusable/silent-success.md).
   *
   * The cheap half of the fix, deliberately: pinning the two reader-visible
   * `Record`s to the scanned file, rather than teaching the walk to follow
   * local `.ts` copy modules. If a third one is ever wanted, it goes here — and
   * if somebody genuinely wants the copy in a module of its own, that is a
   * decision to make with the scan extended in the same commit.
   */
  it("keeps the band's reader-visible copy declared in the file that is scanned", () => {
    const declared = declaredNames(BAND);
    for (const record of ["REFEREE_VIEW_TIP", "REFEREE_VIEW_LABEL"]) {
      expect(
        declared.has(record),
        `${record} is no longer declared in src/web/modes/referee/RefereeMode.tsx. It is ` +
          `reader-visible copy, and importing it from a .ts module takes it out of the ` +
          `null-result scan below without turning anything red. Keep it here, or extend the ` +
          `scan to follow the module it moved to.`,
      ).toBe(true);
    }
  });

  it("finds files that exist and have something in them after the comments come off", () => {
    /* A path that does not resolve, or a file that is all comment, scans
       clean — which is indistinguishable from a file with nothing wrong. */
    for (const rel of REFEREE_SURFACES) {
      const source = withoutComments(readFileSync(join(ROOT, rel), "utf8"));
      expect(source.length, `${rel} has no code left to scan`).toBeGreaterThan(500);
    }
  });

  it("finds at least one panel per sub-mode, and that floor moves on its own", () => {
    /* Not the list back again, and not a naming convention either: `RefereeView`
       is the vocabulary the switch is exhaustive over, so a fifth sub-mode
       raises this floor by itself. The band also renders the source-scan notice
       above the chips, so the real number is one higher — the inequality is
       what makes that harmless. */
    expect(
      RENDERED_BY_THE_BAND.length,
      `${REFEREE_VIEWS.length} referee sub-modes exist and only ` +
        `${RENDERED_BY_THE_BAND.length} panels could be resolved from RefereeMode.tsx — ` +
        `one of them is being scanned by nothing.`,
    ).toBeGreaterThanOrEqual(REFEREE_VIEWS.length);
  });
});

/**
 * Comments are stripped before the scan, because the rule is about what a
 * reader sees. A comment explaining *why* a sentence is banned has to be able
 * to quote it — the first version of this test failed on its own fix, which is
 * a tripwire doing something close to the right thing for the wrong reason.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * Sentences that make the *paper* the subject of a null result. Each is here
 * because it reads as a finding rather than as a failure to find.
 */
const ABOUT_THE_PAPER = [
  "nothing in this paper",
  "nothing in the paper",
  "this paper does not",
  "the paper does not address",
  "is unsupported",
  "no passage supports",
  "nothing bears on",
];

/**
 * **The third state, added 2026-09-01.** There are three, not two: the model
 * found passages, the model found nothing, and the model found something and
 * could not produce a usable answer about it. The third used to render as the
 * second — a criterion stored `done` with no results, and the panel printing
 * "the model did not find a passage for this", which was false. GPT Sol's
 * finding 4.
 *
 * Its sentence does not live in a panel file, so the scan below cannot see it:
 * it is the stored `error` on the criterion, raised in
 * src/referee-criteria-run.ts, and it has to keep the same rule. Checked as a
 * value rather than as source text, which is the stronger check of the two.
 */
describe("what Referee says when the answer it got was unusable", () => {
  it("makes the model the subject, not the paper", () => {
    expect(ANSWER_UNUSABLE.toLowerCase()).toMatch(/^the model /);
    for (const phrase of ABOUT_THE_PAPER) {
      expect(ANSWER_UNUSABLE.toLowerCase(), phrase).not.toContain(phrase);
    }
  });

  it("says the model gave an answer, so it cannot be read as having found nothing", () => {
    /* The whole point of the sentence: "found nothing" and "found something
       and could not say anything usable about it" call for different actions,
       so they must not be one sentence. */
    expect(ANSWER_UNUSABLE).not.toMatch(/did not find/i);
  });

  it("carries a bracketed code, so a referee can quote four characters", () => {
    // docs/project/copy.md § The bracketed code.
    expect(ANSWER_UNUSABLE).toMatch(/\[[a-z0-9-]+\]$/);
  });
});

/**
 * **Claims' own copy, checked as values.**
 *
 * Four sentences, and each is a rule rather than a phrasing:
 *
 * - `NO_PASSAGE_FOUND` is the second outcome — the model looked and named
 *   nothing — and it has to put the model in the subject position, because a
 *   zero-passage row is evidence about a search rather than about a paper.
 * - `PASSAGES_UNUSABLE` is the **third** outcome, which Criteria did not have a
 *   sentence for until GPT Sol's finding 4: the model named passages and none of
 *   them could be found in the paper. It must not be readable as "did not find",
 *   because those two call for different actions.
 * - `CLAIMS_UNUSABLE` is the same distinction at the level of the whole run.
 * - `DOCUMENT_ORDER_NOTE` is the other half of the review's finding: the list is
 *   in the paper's order and is not a ranking, and a reader who assumes
 *   best-first reads the top and stops.
 */
describe("what Claims says about an empty answer", () => {
  it("makes the model the subject of both empty states", () => {
    for (const sentence of [NO_PASSAGE_FOUND, PASSAGES_UNUSABLE, CLAIMS_UNUSABLE]) {
      expect(sentence.toLowerCase()).toMatch(/^the model /);
      for (const phrase of ABOUT_THE_PAPER) {
        expect(sentence.toLowerCase(), phrase).not.toContain(phrase);
      }
    }
  });

  it("keeps 'found nothing' and 'found things I could not use' apart", () => {
    /* The whole reason there are three sentences and not two. Both of these
       would be false about the other's state, and the panel picks between them
       on `Claim.discarded`. */
    expect(NO_PASSAGE_FOUND).toMatch(/did not find/i);
    expect(PASSAGES_UNUSABLE).not.toMatch(/did not find/i);
    expect(CLAIMS_UNUSABLE).not.toMatch(/did not find/i);
  });

  it("carries a bracketed code on the run-level failure", () => {
    // docs/project/copy.md § The bracketed code.
    expect(CLAIMS_UNUSABLE).toMatch(/\[[a-z0-9-]+\]$/);
  });

  it("says the order is not a ranking, which is the other half of the finding", () => {
    expect(DOCUMENT_ORDER_NOTE.toLowerCase()).toContain("ranked");
    // And says nothing that could be read as one claim being weaker than another.
    expect(DOCUMENT_ORDER_NOTE.toLowerCase()).not.toMatch(/weakest|strongest|least supported/);
  });
});

/**
 * **Candidates' own copy, checked as values.**
 *
 * Three sentences, and each is a rule rather than a phrasing:
 *
 * - `NO_NAMES_YET` and `ALL_DROPPED` are two of the three states, kept apart for
 *   the reason Claims keeps its three apart: *nobody was named* and *people were
 *   named and none survived the rules* call for different actions from the
 *   editor.
 * - `COI_NOT_CHECKED` is the one that has to say what did **not** happen. Half
 *   of what publishers call a conflict is mechanically checkable from public
 *   data and this app checks none of it; the other half is not automatable by
 *   anybody. Any sentence that could be read as "we checked and it is clear" is
 *   the specific move the editor research says editors already distrust, and it
 *   is worse here than an ordinary null result: an editor who believes a
 *   conflict filter ran will not run one.
 */
describe("what Candidates says about an empty shortlist, and about conflicts", () => {
  it("makes the model the subject when names were dropped", () => {
    expect(ALL_DROPPED.toLowerCase()).toMatch(/^the model /);
    for (const phrase of ABOUT_THE_PAPER) {
      expect(ALL_DROPPED.toLowerCase(), phrase).not.toContain(phrase);
    }
  });

  it("never says the field has no suitable reviewers", () => {
    /* The larger wrong claim, and the one the phrase list above cannot see. */
    for (const sentence of [ALL_DROPPED, NO_NAMES_YET]) {
      expect(sentence.toLowerCase()).not.toMatch(/no (suitable|qualified|good) (reviewers|candidates)/);
      expect(sentence.toLowerCase()).not.toMatch(/nobody (is|would be) suitable/);
    }
  });

  it("keeps 'nobody named' and 'named and none shown' apart", () => {
    expect(NO_NAMES_YET).not.toMatch(/none of them could be shown/i);
    expect(ALL_DROPPED).toMatch(/none of them could be shown/i);
  });

  it("says the conflict check did not run, and never that it came back clear", () => {
    expect(COI_NOT_CHECKED.toLowerCase()).toMatch(/no conflict-of-interest check has run/);
    for (const claim of [
      /no conflicts? (were )?found/,
      /no conflicts? of interest(?! check)/,
      /clear of/,
      /independent of the authors/,
    ]) {
      expect(COI_NOT_CHECKED.toLowerCase(), String(claim)).not.toMatch(claim);
    }
  });

  it("names both halves, so it cannot be read as a partial filter having run", () => {
    /* Saying only "we did not check co-authorship" would imply the rest was
       handled. Saying only "some things cannot be checked by anyone" would imply
       the checkable half was. Both halves, or neither is honest. */
    expect(COI_NOT_CHECKED.toLowerCase()).toContain("co-authorship");
    expect(COI_NOT_CHECKED.toLowerCase()).toContain("advisor");
  });
});

describe("what Referee says when it found nothing", () => {
  it("never puts the paper in the subject position", () => {
    const offenders: string[] = [];
    for (const rel of REFEREE_SURFACES) {
      const text = withoutComments(readFileSync(join(ROOT, rel), "utf8")).toLowerCase();
      for (const phrase of ABOUT_THE_PAPER) {
        if (text.includes(phrase)) offenders.push(`${rel}: "${phrase}"`);
      }
    }
    expect(
      offenders,
      offenders.length
        ? `A null result is only ever evidence about the model. Rewrite so the ` +
          `model is the subject — "the model did not find …" — rather than the paper.`
        : "",
    ).toEqual([]);
  });

  it("says the model is the one that did not find it", () => {
    const panel = withoutComments(
      readFileSync(join(ROOT, "src/web/CriteriaPanel.tsx"), "utf8"),
    );
    expect(
      panel,
      `The zero-result branch has to name the model as the thing that came up ` +
        `empty, or the reader has no way to tell a failure to find from a finding.`,
    ).toMatch(/did not find/i);
  });
});

/**
 * **The two sentences added on 2026-09-01, and they are the ones most likely to
 * drift into being about the paper.**
 *
 * An eval found that Claims could drop a claim from a paper's own abstract and
 * leave a panel that looked perfectly tidy — the sub-mode's whole defence,
 * `NO_PASSAGE_FOUND`, cannot fire for a claim that never got a row. The answer
 * is a list of the sentences no claim above is anchored in, and **the wording is
 * the entire value of it**. One word in the wrong direction and it becomes
 * *here are the claims the model missed*, which is a judgement about the paper
 * made with worse evidence than the judgement this sub-mode already refuses to
 * make: a block a claim came from carries background, citation and setup as
 * well as claims.
 *
 * `REASONING_WITHHELD` has the same shape of danger one field over. A line was
 * taken out because it read as a verdict; the sentence in its place must say
 * that about the *model's line*, and must not become *this passage does not
 * carry the claim*, which is the verdict itself wearing our clothes.
 */
describe("what Claims says about the rest of the text its quotes covered", () => {
  it("never puts the paper in the subject position", () => {
    for (const sentence of [
      OTHER_TEXT_HEADING,
      OTHER_TEXT_NOTE,
      OTHER_TEXT_AT_CAP,
      REASONING_WITHHELD,
      CLAIM_WITHHELD,
    ]) {
      for (const phrase of ABOUT_THE_PAPER) {
        expect(sentence.toLowerCase(), phrase).not.toContain(phrase);
      }
    }
  });

  it("never calls them claims the model missed, which is the same judgement in reverse", () => {
    const note = `${OTHER_TEXT_HEADING} ${OTHER_TEXT_NOTE}`.toLowerCase();
    for (const phrase of [
      "missed",
      "missing",
      "omitted",
      "left out",
      "overlooked",
      "should have",
      "failed to",
      "unlisted claim",
    ]) {
      expect(note, phrase).not.toContain(phrase);
    }
  });

  it("says out loud that some of them will not be claims, and hands the judgement over", () => {
    /* Without this the list reads as an accusation, and a referee who reads it
       that way will either dismiss it or over-trust it. Both are worse than
       reading three sentences of the paper, which is what it is for. */
    expect(OTHER_TEXT_NOTE.toLowerCase()).toContain("background");
    expect(OTHER_TEXT_NOTE.toLowerCase()).toMatch(/decide for yourself/);
  });

  it("makes the model's line the thing that was withheld, not the passage", () => {
    expect(REASONING_WITHHELD.toLowerCase()).toMatch(/^the model's line/);
    // And says the passage is still there, or a referee wonders what else went.
    expect(REASONING_WITHHELD.toLowerCase()).toContain("untouched");
  });

  it("makes the model's line the thing that was withheld on a claim, too", () => {
    /* **The headline joined the fail-safe on 2026-09-01**, and it is the more
       dangerous of the two sentences: the thing that vanishes is the row's own
       label, so a referee who is not told what happened will read the paper's
       sentence as the model having had nothing to say. The subject has to be the
       model's line, and it has to say what stands in its place. */
    expect(CLAIM_WITHHELD.toLowerCase()).toMatch(/^the model's one-line/);
    expect(CLAIM_WITHHELD.toLowerCase()).toContain("the paper's own words");
    // Never the verdict itself wearing our clothes.
    expect(CLAIM_WITHHELD.toLowerCase()).not.toMatch(/does not carry|is unsupported|was wrong/);
  });
});

/**
 * **What Claims says when one of its own caps cut something.**
 *
 * GPT Sol's second review, finding 5: the caps were silent, and silence is a
 * ranking — a referee reads an apparently complete list in which the claims the
 * paper makes last were dropped for being last. These three sentences are the
 * fix, and each has a rule of its own.
 *
 * The trap they share is the opposite of the null-result one. A cap is a fact
 * about **this app**, so the wrong sentence here does not put the paper in the
 * subject position, it puts the *model* there — "the model returned too many
 * claims" is an accusation about an answer that did nothing wrong.
 */
describe("what Claims says when one of its own caps cut something", () => {
  it("never blames the paper or the model for a cap that is ours", () => {
    for (const sentence of [PASSAGES_CAPPED, CLAIMS_AT_CAP, claimsOmittedNote(3), OTHER_TEXT_AT_CAP]) {
      for (const phrase of ABOUT_THE_PAPER) {
        expect(sentence.toLowerCase(), phrase).not.toContain(phrase);
      }
      expect(sentence.toLowerCase(), sentence).not.toMatch(/too many|should have|failed to/);
    }
  });

  it("says which way the cut went, so the missing rows are findable", () => {
    /* The cut is positional. A referee who is told only that something is
       missing learns nothing they can act on; one who is told it is the end of
       the paper can go and look at the end of the paper. */
    expect(PASSAGES_CAPPED.toLowerCase()).toContain("latest in the paper");
    expect(CLAIMS_AT_CAP.toLowerCase()).toContain("end of the paper");
    expect(claimsOmittedNote(3).toLowerCase()).toContain("end of the paper");
    expect(OTHER_TEXT_AT_CAP.toLowerCase()).toContain("latest in the paper");
  });

  it("keeps the number off a claim row and allows it under the list", () => {
    /* The no-digit rule is about a claim row, where a count of passages is one
       glance from a ranking. Under the list there is nothing to rank, so the
       count of cut claims is allowed and is worth more than a hedge. */
    expect(PASSAGES_CAPPED).not.toMatch(/\d/);
    expect(claimsOmittedNote(3)).toMatch(/3 further claims/);
  });
});
