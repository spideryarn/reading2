/**
 * **The shapes `src/injection-scan.ts` answers in, and nothing else.**
 *
 * A module of type declarations only, on the model of
 * [`src/referee-mirror-types.ts`](referee-mirror-types.ts) and for exactly the
 * same reason. The scan itself parses documents with jsdom, so
 * `src/injection-scan.ts` may never be imported from `src/web/` — not even
 * `import type`, which tests/client-imports.test.ts flags anyway, because that
 * file's rule is about the edge existing at all rather than about whether this
 * particular spelling erases.
 *
 * The Referee band has to render a result, and the whole point of the result is
 * that **its shape forces the caller to branch**: `findings` exists only on the
 * examined arm, so a PDF cannot be drawn as a clean bill of health. A second
 * declaration of that union under `src/web/` would be a second answer to *did
 * we look*, and the looser one would be the one on screen. So there is one
 * declaration, here, and both sides import it.
 *
 * `src/injection-scan.ts` re-exports every name, so nothing that used them had
 * to change. Read that file's header for what the scan is, why it runs before
 * the model rather than inside it, and the list of what it cannot see;
 * docs/project/security.md § *A fifth: the manuscript addressing the model* for
 * the same in prose.
 */

/**
 * The trick, named. One per mechanism, because the repair a human would want to
 * look at differs: white-on-white is a colour, a zero font is a size, and a tag
 * character is not CSS at all.
 */
export type HiddenTextKind =
  /** Text painted in (or close to) the colour behind it, `transparent` included. */
  | "colour-on-background"
  /** `font-size` at or near zero on an element that carries its own words. */
  | "tiny-font"
  /** `display:none`, `visibility:hidden`, `opacity:0`, or the `hidden` attribute. */
  | "hidden"
  /** Positioned, transformed, indented or clipped out of sight. */
  | "off-screen"
  /** Characters with no glyph — zero-width, bidi controls, Unicode tag characters. */
  | "invisible-characters";

/** Every kind a finding can carry. `"visible-instruction"` is not a hiding trick. */
export type FindingKind = HiddenTextKind | "visible-instruction";

/**
 * The everyday reason a page does this, when there is a recognised one.
 *
 * Forgeable by construction — see the header. A finding carrying one of these
 * is *still a finding*.
 */
export type OrdinaryExplanation =
  /** Inside a landmark or a component that is chrome rather than the piece. */
  | "navigation"
  /** The `sr-only` / `visually-hidden` idiom: hidden from eyes, read aloud. */
  | "screen-reader-only"
  /** Declared inside `@media print`, or named for it. */
  | "print-only"
  /** A `<noscript>` body or a `no-js` fallback. */
  | "script-fallback"
  /** A closed `<details>`, an accordion, a tab panel — real prose, not shown yet. */
  | "collapsed"
  /** A soft hyphen or a joiner, which ordinary prose in many languages contains. */
  | "typography"
  /**
   * The document appears to be *about* prompt injection, so quoting an attack
   * string is its subject matter. Only ever attached to
   * `"visible-instruction"`, and forgeable like every other label here — an
   * attacker who prints the words "prompt injection" earns it.
   */
  | "subject-matter";

/** Fields every finding carries, whatever question produced it. */
interface FindingBase {
  /**
   * Where it is, as a readable path — `body > div.paper > p.hidden`. Not a
   * selector to be re-run: a hint for a person reading the source. The DOM this
   * came from is thrown away with the function that made it.
   */
  where: string;
  /**
   * The words themselves, whitespace collapsed and capped at
   * `MAX_FINDING_TEXT`. This is the thing a referee actually needs to see, and
   * it is why the scan reports text rather than counts.
   */
  text: string;
  /** The evidence — the declarations, the code points, the phrase. Never a conclusion. */
  detail: string;
  ordinary?: OrdinaryExplanation;
}

/** One piece of text the document hid from the eye. */
export interface HiddenTextFinding extends FindingBase {
  kind: HiddenTextKind;
}

/**
 * One instruction aimed at a model, printed in plain sight.
 *
 * Deliberately a different shape from `HiddenTextFinding`, because it deserves
 * a different reaction and the type is where that belongs. `caveat` is required
 * so that no UI can render one of these with the certainty hidden text earns.
 */
export interface VisibleInstructionFinding extends FindingBase {
  kind: "visible-instruction";
  /** Why this one may be innocent, in words a referee can read. */
  caveat: string;
}

export type ScanFinding = HiddenTextFinding | VisibleInstructionFinding;

/**
 * A mechanism this scan could not see through, named so it can be shown.
 *
 * The point of the list is that it is **never empty**: `"approximated-cascade"`
 * is on every result, so a UI cannot render an empty blind-spot list as "we
 * looked at everything".
 */
export type BlindSpot =
  /** Always. Media queries, `@supports`, variables, `currentColor`, gradients. */
  | "approximated-cascade"
  /** The document links a stylesheet, or `@import`s one. Nothing is fetched. */
  | "external-stylesheets"
  /** The document carries scripts. They were not run, and they can restyle anything. */
  | "scripted-styling"
  /** Images, `<svg>`, `<canvas>` — text drawn as pixels is out of reach of any source scan. */
  | "images-of-text"
  /** At least one selector jsdom would not parse. `unreadableSelectors` counts them. */
  | "unreadable-selectors";

/**
 * **The result, shaped so a caller has to say what it looked at.**
 *
 * `findings` lives only on the arm where something was examined. That is the
 * whole point: `{ examined: "nothing" }` has no `findings` to count, so a UI
 * cannot reach "nothing found" without first branching on `examined` — the
 * objection GPT Sol raised against the first version, where
 * `{ coverage: "none", findings: [] }` rendered as a clean bill of health.
 */
export type SourceScan = NothingExamined | HtmlSourceScan;

/** Nothing was looked at. There is no finding list, because there was no scan. */
export interface NothingExamined {
  examined: "nothing";
  /** Why. A PDF is the case that matters: the July 2025 incident was mostly PDFs. */
  reason: "pdf" | "no-text";
}

/**
 * The HTML source string was parsed and read. **Only that** — the name says so
 * on purpose, and `blindSpots` says what it leaves out.
 */
export interface HtmlSourceScan {
  examined: "html-source-only";
  findings: ScanFinding[];
  /**
   * Findings past `MAX_FINDINGS`, dropped. Counted so a cap is never silent —
   * the same rule `Dropped.truncated` follows in src/search.ts. Findings with
   * an `ordinary` label are dropped first, so a wall of navigation chrome
   * cannot push the one thing worth reading out of the report.
   */
  truncated: number;
  /** Rules whose selector jsdom refused. Each one is a rule this scan did not apply. */
  unreadableSelectors: number;
  /** What this scan could not see. Never empty. */
  blindSpots: BlindSpot[];
}
