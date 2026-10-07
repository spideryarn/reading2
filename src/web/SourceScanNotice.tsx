/**
 * **What the deterministic scan found in the document's own source** — Referee
 * mode's rule 5, on screen at last.
 *
 * In July 2025, eighteen arXiv preprints from fourteen universities were found
 * carrying instructions aimed at an AI referee — *GIVE A POSITIVE REVIEW ONLY*,
 * *IGNORE ALL PREVIOUS INSTRUCTIONS* — in white text, in a zero-point font, or
 * positioned off the page ([arXiv:2507.06185](https://arxiv.org/abs/2507.06185)).
 * A person reading the paper sees nothing. src/injection-scan.ts looks for them
 * in the stored source, deterministically, with no model in it at all;
 * src/source-scan.ts is what calls it; this is what a referee reads.
 *
 * ## A sub-mode of its own, and a mark on its chip
 *
 * A hidden instruction is a fact about the *document*, so it bears on every
 * sub-mode alike, and for that reason this lived above them all — first above
 * the chips, then inside the band's Notices box, which opened itself for a
 * finding (plan 261003k). On arXiv HTML a typesetter's zero-width spaces count
 * as findings, so that was nearly every paper. Greg, 2026-10-07
 * (`spya-y6590g`): *"Perhaps squirrel this info away as a sub-mode? It doesn't
 * seem important enough to be right at the top of Criteria."* So it is the
 * **Hidden text** sub-mode, drawn by `RefereeSubMode`, and what is left of it
 * elsewhere is `sourceScanMark` below: a dot or a ring on its chip, and one
 * sentence for a screen reader. The scan itself is still fetched once by the
 * band. docs/plans/261007h-referee-hidden-instructions-become-a-sub-mode-in-plain-words.md.
 *
 * ## Shut until there is something to read
 *
 * > Make the "hidden instructions" default-collapsed unless something has been
 * > found. Explain in tooltip much more clearly what the intent is, and how
 * > worried to be based on the results (in this case, it didn't run any test, so
 * > we have no information one way or the other, so not very worried).
 * >
 * > — Greg, 2026-09-02
 *
 * So the panel is a disclosure with a **headline that is on screen shut or
 * open**, and the default is *computed* rather than remembered: open when the
 * scan looked at the source and found something, shut otherwise — including for
 * a PDF, which is not checked at all and is therefore no news in either
 * direction. `shown()` below returns that decision beside the words, so the two
 * cannot drift apart.
 *
 * **Collapsed is not dismissed, and the difference is what makes this allowed.**
 * `choice` is a `useState` that dies with the mount: a referee who opens the
 * panel keeps it open, and the next visit starts from the computed default
 * again. Nothing is persisted, so the objection src/web/modes/referee/RefereeMode.tsx
 * makes to a dismissible notice — browser storage is for per-browser bits and
 * used sparingly (docs/project/url-state.md), and a column is a migration for
 * a checkbox — never arises.
 *
 * ## The four rules this component is under, and where each is enforced
 *
 * 1. **Never say "nothing found" when nothing was looked at.** The `switch` on
 *    `scan.examined` is exhaustive with a `never` in the default, and the
 *    `"nothing"` arm has no `findings` to count — see src/injection-scan-types.ts.
 *    A PDF says *not checked*, in the same words whether or not the HTML side
 *    would have found something.
 * 2. **A clean result never travels without its blind spots.** `blindSpots` is
 *    never empty, and `WhatWasNotChecked` below is rendered on the examined arm
 *    unconditionally. Since that list is now behind the disclosure, **the
 *    headline carries the caveat itself** — the words *not a clean bill* are in
 *    the same sentence as *nothing found*, whether this disclosure is open or
 *    shut. A clean result behind a collapse with nothing to
 *    say it is incomplete is what rule 2 forbids; a headline that says so is not that.
 * 3. **A label sorts a finding last; it never removes one.** `ordinary` is read
 *    off class and element names, so `class="sr-only"` on a paragraph of
 *    instructions earns it — docs/project/security.md says any UI over this must
 *    sort rather than filter, and `ordered` below is where that is code. The
 *    scan already returns them in that order; this sorts anyway, because a
 *    rendering rule that depends on the server having done it is a rule with
 *    nothing holding it. A labelled finding also counts as *found*, so a
 *    document with nothing but labelled findings opens the panel and marks
 *    the chip. Identical findings are drawn as one row with a count
 *    (`grouped`), and the label is part of what makes two identical, so a
 *    labelled row is never folded into an unlabelled one.
 * 4. **Hidden text and visible text are not drawn with the same confidence.**
 *    A `"visible-instruction"` carries a required `caveat` — a paper *about*
 *    prompt injection quotes payloads for a living — and the row prints it.
 *    Hidden text has no innocent explanation and gets no such line.
 *
 * **It reports and decides nothing.** No score, no verdict, no refusal, and it
 * blocks no model call. It is a way for a referee to find out that somebody
 * tried. docs/project/referee-mode.md § rule 5, docs/project/security.md
 * § *A fifth: the manuscript addressing the model*.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";

import type {
  BlindSpot,
  FindingKind,
  HtmlSourceScan,
  OrdinaryExplanation,
  ScanFinding,
  SourceScan,
} from "../injection-scan-types.js";
import type { SourceScanState } from "./useSourceScan.js";
import { ControlTip, Tooltip } from "./Tooltip.js";
import { ownLabel, plainWords } from "./lib/own-label.js";

/*
 * The three tables below are read by values the server sent, so each is read
 * through `ownLabel` (lib/own-label.ts): a copy of the app older than the
 * scanner meets kinds it has no words for. A kind or a blind spot then shows
 * as the server's own word. An everyday explanation is left out, because this
 * copy cannot say what it means; the finding itself stays.
 */

/** What each trick is, in words a referee reads rather than a property name. */
const KIND_LABEL: Record<FindingKind, string> = {
  "colour-on-background": "Text painted the colour of what is behind it",
  "tiny-font": "Text at a size nobody reads",
  hidden: "Text taken out of the page",
  "off-screen": "Text moved or clipped out of sight",
  "invisible-characters": "Characters that render as nothing",
  "visible-instruction": "An instruction aimed at a model, in plain sight",
};

/**
 * The everyday reason a page does this, when one was recognised.
 *
 * Written as *why a page might* rather than as *this is fine*: the label is
 * forgeable, and the sentence under the group says so.
 */
const ORDINARY_LABEL: Record<OrdinaryExplanation, string> = {
  navigation: "sits in navigation or page chrome",
  "screen-reader-only": "the screen-reader-only idiom",
  "print-only": "declared for print",
  "script-fallback": "a fallback for no JavaScript",
  collapsed: "collapsed, or not opened yet",
  typography: "ordinary typography",
  "subject-matter": "this document appears to be about prompt injection",
};

/**
 * **What each trick is, and what it would look like if it mattered**, in a
 * sentence a referee reads under the row.
 *
 * Greg, 2026-10-07 (`spya-y6590g`), on a row that read *"Characters that render
 * as nothing / math#footnote1.m1.ltx_Math > semantics > mrow > mo / 1×
 * zero-width space U+200B"*: *"this is uninterpretable gibberish to the user,
 * and secondly it looks innocuous."* So each kind says what it is in plain
 * words. It is the same sentence whatever the document says, so it explains
 * the mechanism and passes no judgement on this finding: the document cannot
 * reach it. docs/plans/261007h-referee-hidden-instructions-become-a-sub-mode-in-plain-words.md.
 */
const KIND_MEANS: Record<FindingKind, string> = {
  "colour-on-background":
    "Text coloured to match what is behind it, so a reader sees a blank and a model reads the words. " +
    "A manuscript rarely has a reason to do this, so read what it says.",
  "tiny-font":
    "Text set too small for anybody to read. A model reads it at full size, so read what it says.",
  hidden:
    "Text the page tells the browser not to show at all. Menus and pop-ups do this as a matter of " +
    "course; in the body of a paper, read what it says.",
  "off-screen":
    "Text pushed outside the visible page or clipped to nothing, where a reader never scrolls and a " +
    "model reads it all the same.",
  "invisible-characters":
    "Characters that take up no space on screen: zero-width spaces, joiners, direction marks. Tools " +
    "that typeset maths and web addresses put single ones in routinely, and one on its own holds no " +
    "words. What can carry a whole hidden sentence is a run of Unicode tag characters, and when there " +
    "are any, what they spell is quoted here.",
  "visible-instruction":
    "A sentence addressed to a model rather than to a reader, such as one telling it how to review " +
    "the paper. It is printed where anyone can see it, so it may simply be quoted.",
};

/**
 * **Where it is, in words**, when the source path says so plainly — and
 * nothing otherwise, rather than a guess. The path is `pathOf`'s in
 * src/injection-scan.ts: at most four `tag#id.class` steps, innermost last.
 * MathML first, because it is where a typesetter's invisible operators live.
 *
 * **Said as markup, never as meaning** — *marked up as maths*, not *inside a
 * maths formula* — because the tag names are the document's own, and a
 * hostile one can wrap a payload in `<mo>` as easily as a typesetter does.
 * GPT Sol's review of plan 261007h, finding 3. Element names only, never a
 * class or an id, which are freer still.
 */
const MATHML = new Set([
  "math", "semantics", "annotation", "annotation-xml", "mrow", "mo", "mi", "mn", "ms", "mtext",
  "mspace", "msub", "msup", "msubsup", "mfrac", "msqrt", "mroot", "mstyle", "mtable", "mtr", "mtd",
  "munder", "mover", "munderover", "mpadded", "mphantom", "menclose", "merror", "mmultiscripts",
]);
const PLACES: readonly { words: string; tags: readonly string[] }[] = [
  { words: "marked up as maths", tags: [...MATHML] },
  { words: "marked up as a figure", tags: ["figure", "figcaption"] },
  { words: "marked up as a table", tags: ["table", "thead", "tbody", "tr", "td", "th", "caption"] },
  { words: "marked up as a link", tags: ["a"] },
  { words: "marked up as a heading", tags: ["h1", "h2", "h3", "h4", "h5", "h6"] },
];

export function placeInWords(where: string): string | undefined {
  const tags = where.split(" > ").map((step) => step.split(/[#.]/)[0]?.toLowerCase() ?? "");
  return PLACES.find((place) => tags.some((tag) => place.tags.includes(tag)))?.words;
}

/**
 * Characters that draw nothing, and whitespace: what is left of a finding's
 * quoted text once they are gone is what a reader would actually see.
 */
const DRAWS_NOTHING = /[\s­​-‏‪-‮⁠-⁤⁦-⁩﻿\u{E0000}-\u{E007F}]/gu;

/**
 * **Findings that read the same are one row, with a count.**
 *
 * The key is every field a referee reads except `where`: the kind, the words,
 * the evidence, the label and the caveat. So a payload is never folded into a
 * pile of copies — its words differ from theirs, and it is a row of its own —
 * and a labelled finding is never merged with an unlabelled one, which keeps
 * rule 3's order. On the arXiv paper Greg was reading, 39 rows of one
 * zero-width space each became one. Order is first appearance, over rows
 * already `ordered`, so the unexplained still come first.
 *
 * **Two findings in one row may be two different things in the source** —
 * `text` is capped, and `where` is a four-step hint with no sibling index —
 * so a row never claims they are the same place: it says how many findings it
 * stands for, and lists every distinct source path in full.
 */
interface Group {
  key: string;
  finding: ScanFinding;
  /** How many findings this row stands for. */
  count: number;
  /** Every distinct `where`, in order, all of them shown. */
  paths: string[];
}

export function grouped(rows: ScanFinding[]): Group[] {
  const groups = new Map<string, Group>();
  for (const finding of rows) {
    const key = JSON.stringify([
      finding.kind,
      finding.text,
      finding.detail,
      finding.ordinary ?? null,
      finding.kind === "visible-instruction" ? finding.caveat : null,
    ]);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { key, finding, count: 1, paths: [finding.where] });
    } else {
      group.count++;
      if (!group.paths.includes(finding.where)) group.paths.push(finding.where);
    }
  }
  return [...groups.values()];
}

/** Each gap, said as the thing that was not looked at. */
const BLIND_SPOT_LABEL: Record<BlindSpot, string> = {
  "approximated-cascade": "the real CSS cascade — media queries, variables, gradients",
  "external-stylesheets": "stylesheets this document links to, which are never fetched",
  "scripted-styling": "anything the document's scripts do, because none were run",
  "images-of-text": "text drawn as a picture",
  "unreadable-selectors": "CSS rules whose selectors could not be read",
};

/**
 * **What this panel is for, in one paragraph, in two places.**
 *
 * It is the tooltip's first paragraph *and* the last line inside the open
 * panel, from one constant. Both, because a tooltip does not exist on a touch
 * device — `title` and hover are the same nothing there — and this is the
 * sentence that stops the panel reading as a security verdict.
 */
const WHAT_THIS_IS =
  "Some documents hide text from the reader and show it to a model — white on white, at a size " +
  "nobody can read, or pushed off the page — telling it what to say about the paper. Eighteen " +
  "arXiv preprints were caught doing that in July 2025. This reads the document's own source and " +
  "looks for those tricks, before any model call and with no model in it. It reports what it " +
  "found. It decides nothing and blocks nothing.";

/**
 * Unexplained first, labelled last, stable within each half.
 *
 * Rule 3 above. `sort` is not used: it would need a comparator that is stable
 * across engines to keep two runs of the same paper in the same order, and two
 * filters are both stable and obviously so.
 */
function ordered(findings: ScanFinding[]): ScanFinding[] {
  return [
    ...findings.filter((f) => f.ordinary === undefined),
    ...findings.filter((f) => f.ordinary !== undefined),
  ];
}

/**
 * **One state of the panel: what it says shut, what it hides, and how worried a
 * referee should be.**
 *
 * All four together in one returned object rather than three functions
 * switching over the same union, because the failure that matters is them
 * disagreeing — a headline saying *nothing was checked* over a tooltip saying
 * *nothing was found* is worse than either sentence alone.
 */
interface Shown {
  /** The one line on screen whether the panel is open or shut. */
  line: string;
  /** Full `--ink` rather than `--ink-soft`. Read this one — it is not a finding. */
  warn: boolean;
  /** Open before the referee has touched it. True only when something was found. */
  open: boolean;
  /** How much to worry, given this result. The tooltip's second paragraph. */
  worry: string;
  /** Everything else, behind the disclosure. */
  detail: ReactNode;
}

function shown(state: SourceScanState): Shown {
  switch (state.state) {
    case "loading":
      return {
        line: "Checking the document this article was made from…",
        warn: false,
        open: false,
        worry: "Still looking. Nothing here means anything yet.",
        detail: null,
      };
    case "failed":
      return {
        line: "The source could not be checked.",
        warn: true,
        open: false,
        worry:
          "The check did not run, so you have no information either way. That is not a warning " +
          "and not a clean bill: it says nothing about this document at all.",
        detail: (
          <p className="ref-scan-line">
            Nothing here says anything about the document. {state.error}
          </p>
        ),
      };
    case "no-source":
      /* Not a clean result and not an error. The article exists and its original
         document does not, so there was nothing to look at — which a referee has
         to be told, because the absence of findings would otherwise read as an
         absence of hidden text. */
      return {
        line: "Not checked — the original document was not kept.",
        warn: true,
        open: false,
        worry:
          "There was nothing to look at, so you have no information either way. Not a reason to " +
          "worry, and not a reason to relax.",
        detail: (
          <p className="ref-scan-line">
            The original document was not kept for this article, so its source was not checked.
          </p>
        ),
      };
    case "ready":
      return forScan(state.scan);
    default: {
      const unknown: never = state;
      throw new Error(`unknown source scan state: ${JSON.stringify(unknown)}`);
    }
  }
}

/**
 * The branch the whole result type exists to force.
 *
 * `scan.findings` cannot be reached from here without narrowing, because it is
 * not on the `"nothing"` arm at all. That is rule 1, and it is the type doing
 * it rather than this file remembering to.
 */
function forScan(scan: SourceScan): Shown {
  switch (scan.examined) {
    case "nothing":
      return scan.reason === "pdf"
        ? {
            line: "Not checked — this article came from a PDF.",
            warn: true,
            open: false,
            worry:
              "No check ran, so you have no information either way — which is not, in itself, " +
              "much to worry about. Worth knowing: the July 2025 preprints were mostly PDFs. If " +
              "this manuscript matters, open the PDF and select all of its text; hidden text " +
              "shows up once it is highlighted.",
            detail: (
              <p className="ref-scan-line">
                A PDF is not checked at all — finding white text in one means reading its content
                streams, which this app does not do. The hidden instructions found in preprints in
                July 2025 were mostly in PDFs.
              </p>
            ),
          }
        : {
            line: "Not checked — the stored document held no text.",
            warn: true,
            open: false,
            worry:
              "There was no text to look at, so no check ran and you have no information either " +
              "way.",
            detail: <p className="ref-scan-line">The stored document held no text to check.</p>,
          };
    case "html-source-only": {
      const rows = ordered(scan.findings);
      const unexplained = rows.filter((f) => f.ordinary === undefined).length;
      const labelled = rows.length - unexplained;
      return {
        /* Rule 2 lives in this string. "Nothing found" on its own, over a
           collapsed list of everything that was not looked at, is precisely the
           reading the blind-spot list exists to prevent — so the caveat is in
           the headline rather than behind the disclosure with the list. */
        line:
          rows.length === 0
            ? "Nothing found in the HTML source — which is not a clean bill; open it for what was not checked."
            : unexplained > 0
              ? `${unexplained} to look at${labelled > 0 ? `, and ${labelled} with an everyday explanation` : ""}.`
              : `${labelled} found, each with an everyday explanation.`,
        warn: unexplained > 0,
        /* Rule 3 again: a labelled finding is still a finding, so a document
           with nothing but labelled ones opens rather than staying shut. */
        open: rows.length > 0,
        worry:
          rows.length === 0
            ? "Nothing turned up. Mild reassurance rather than a clean bill: only the HTML was " +
              "read, no linked stylesheet was fetched and no script was run. What was missed is " +
              "listed inside."
            : unexplained > 0
              ? "Worth your eyes. Hidden text in a manuscript has no innocent explanation, so " +
                "read the words, then go and look at the source yourself."
              : "Probably ordinary page furniture — each of these carries an everyday " +
                "explanation. The explanation is read off class names and can be faked, so read " +
                "the words rather than trusting the label.",
        detail: <Examined scan={scan} rows={rows} labelled={labelled} />,
      };
    }
    default: {
      const unknown: never = scan;
      throw new Error(`unknown scan arm: ${JSON.stringify(unknown)}`);
    }
  }
}

/**
 * **What the Hidden text chip carries**: nothing, a ring, or a dot.
 *
 * - `"found"` — something with no everyday label: a filled dot.
 * - `"labelled"` — findings, every one wearing an everyday label: a ring.
 * - `"none"` — nothing found, nothing checked, or no answer yet.
 *
 * **Any finding leaves a mark, because a label is forgeable.** A payload in
 * `class="sr-only"` earns `screen-reader-only`, so a mark for unlabelled
 * findings alone would let a document silence it by wearing a class name —
 * GPT Sol's review of plan 261007h, finding 1. The two marks differ because
 * arXiv's own page furniture carries two `navigation`-labelled findings on
 * nearly every paper, and a dot lit on every article would say nothing. Both
 * are `shown(state).open`, the rule that opens the panel, split by `warn`.
 *
 * Until 2026-10-07 this was `sourceScanOpens`, and it opened the band's
 * Notices box above every sub-mode; plan 261007h moved the scan into a
 * sub-mode of its own and left this mark as all of it that shows elsewhere.
 */
export type SourceScanMark = "none" | "labelled" | "found";

export function sourceScanMark(state: SourceScanState): SourceScanMark {
  const view = shown(state);
  if (!view.open) return "none";
  return view.warn ? "found" : "labelled";
}

export function SourceScanNotice({ state }: { state: SourceScanState }) {
  const view = shown(state);
  /**
   * `null` until the referee presses the header, and then theirs.
   *
   * Derived rather than an effect: the scan arrives seconds after the band
   * opens, and a `useState(view.open)` would have been seeded from the
   * *loading* state and stayed shut over a document with findings in it. This
   * way the computed default follows the answer, and a press overrides it from
   * then on.
   */
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? view.open;

  return (
    <section className="ref-scan" aria-label="Hidden text in the source">
      <h3 className="ref-scan-head">
        <Tooltip
          className="tip-soon"
          content={<ControlTip head="Hidden text" what={WHAT_THIS_IS} how={view.worry} />}
        >
          <button
            type="button"
            className="ref-scan-toggle"
            aria-expanded={open}
            onClick={() => setChoice(!open)}
          >
            <ShieldAlert size={13} aria-hidden="true" />
            <span>Hidden text</span>
            {open ? (
              <ChevronDown size={12} aria-hidden="true" />
            ) : (
              <ChevronRight size={12} aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      </h3>
      {/* Polite rather than assertive: the answer arrives seconds after the band
          opens, and a referee who is already typing a criterion should be told
          without being interrupted. */}
      <div aria-live="polite">
        <p className={`ref-scan-line${view.warn ? " ref-scan-warn" : ""}`}>{view.line}</p>
        {open && (
          <>
            {view.detail}
            {/* Last, and in every state: the tooltip above says this too, and a
                touch device has no hover to say it with. */}
            <p className="ref-scan-line ref-scan-note">{WHAT_THIS_IS}</p>
          </>
        )}
      </div>
    </section>
  );
}

function Examined({
  scan,
  rows,
  labelled,
}: {
  scan: HtmlSourceScan;
  /** Already `ordered`, and counted, by `forScan` — the headline needs the same numbers. */
  rows: ScanFinding[];
  labelled: number;
}) {
  return (
    <>
      {rows.length > 0 && (
        <ul className="ref-scan-list">
          {grouped(rows).map((group) => (
            <Finding key={group.key} group={group} />
          ))}
        </ul>
      )}

      {/* The cap is never silent — the same rule `Dropped.truncated` follows in
          search. Explained findings are dropped first, so what is missing is the
          chrome rather than the thing worth reading. */}
      {scan.truncated > 0 && (
        <p className="ref-scan-line ref-scan-note">
          {scan.truncated} more were found and not listed.
        </p>
      )}

      {labelled > 0 && (
        <p className="ref-scan-line ref-scan-note">
          An everyday explanation is read off class and element names, so a document can wear one
          on purpose. It sorts a finding last. It never removes one.
        </p>
      )}

      <WhatWasNotChecked scan={scan} />
    </>
  );
}

/**
 * The list of what this scan could not see, on every examined result.
 *
 * `blindSpots` is never empty by construction — `"approximated-cascade"` is on
 * it whatever the document says — so this paragraph always has something in it,
 * which is the point: the reason it exists is that an empty list would render as
 * *we looked at everything*.
 *
 * **A blind spot this copy has no sentence for is still named**, in the
 * server's own word. Dropping it would shorten the list, which is the same
 * false claim in a smaller size.
 */
function WhatWasNotChecked({ scan }: { scan: HtmlSourceScan }) {
  return (
    <p className="ref-scan-line ref-scan-blind">
      <strong>Not checked:</strong>{" "}
      {scan.blindSpots.map((spot) => ownLabel(BLIND_SPOT_LABEL, spot) ?? plainWords(spot)).join("; ")}
      {scan.unreadableSelectors > 0 ? ` (${scan.unreadableSelectors} of them)` : ""}. Nor layering,
      masks, or anything a browser would have to draw to decide.
    </p>
  );
}

/**
 * **One row: what was found, where in words, the words themselves, what the
 * trick is, and then the evidence for somebody who will go and look.**
 *
 * Plan 261007h put the plain words first and the CSS path and code points
 * last and smaller, under *In the source*. Both stay: the rules say evidence
 * is shown, and a referee who wants to check needs it.
 */
function Finding({ group }: { group: Group }) {
  const { finding, count, paths } = group;
  const ordinary = finding.ordinary === undefined ? undefined : ownLabel(ORDINARY_LABEL, finding.ordinary);
  const means = ownLabel(KIND_MEANS, finding.kind);
  /* Said only when every path agrees, so a row never claims a place for
     copies that are somewhere else. */
  const placeWords = paths.map(placeInWords);
  const place = placeWords.every((p) => p === placeWords[0]) ? placeWords[0] : undefined;
  const visible = finding.text.replace(DRAWS_NOTHING, "") !== "";
  return (
    /* `data-` attributes so tests/source-scan-notice.test.tsx can assert the
       *order* of the rows rather than only their presence — rule 3 is about
       where a labelled finding sits, and a test that could only count them
       would pass on a UI that hid them. */
    <li
      className={`ref-scan-item${finding.ordinary === undefined ? "" : " explained"}`}
      data-kind={finding.kind}
      data-ordinary={finding.ordinary ?? "none"}
      data-count={count}
    >
      <span className="ref-scan-kind">{ownLabel(KIND_LABEL, finding.kind) ?? plainWords(finding.kind)}</span>
      {(count > 1 || place !== undefined) && (
        <span className="ref-scan-count">
          {[count > 1 ? `${count} times` : undefined, place]
            .filter((part) => part !== undefined)
            .join(", ")}
        </span>
      )}
      {ordinary !== undefined && <span className="ref-scan-tag">{ordinary}</span>}
      {visible ? (
        <q className="ref-scan-text">{finding.text}</q>
      ) : (
        /* An empty pair of quote marks reads as a rendering bug. */
        <span className="ref-scan-text ref-scan-empty">No visible words beside it.</span>
      )}
      {means !== undefined && <span className="ref-scan-means">{means}</span>}
      {/* Required on the type, so it cannot be dropped by an edit here: a
          plainly-printed instruction has ordinary explanations that hidden text
          does not, and the two must not be drawn with the same confidence. */}
      {finding.kind === "visible-instruction" && (
        <span className="ref-scan-caveat">{finding.caveat}</span>
      )}
      <span className="ref-scan-source">
        In the source:{" "}
        {paths.map((path, i) => (
          <span key={path}>
            {i > 0 ? "; " : ""}
            <span className="ref-scan-where">{path}</span>
          </span>
        ))}{" "}
        · <span className="ref-scan-detail">{finding.detail}</span>
      </span>
    </li>
  );
}
