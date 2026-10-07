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
 * ## The five rules this component is under, and where each is enforced
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
 * 5. **The panel is shut unless something was found.** `shown()` returns the
 *    computed default beside the words, and only a non-empty finding list sets
 *    `open`; a labelled finding still counts.
 *
 * **It reports and decides nothing.** No score, no verdict, no refusal, and it
 * blocks no model call. It is a way for a referee to find out that somebody
 * tried. docs/project/referee-mode.md § rule 5, docs/project/security.md
 * § *A fifth: the manuscript addressing the model*.
 *
 * ## Ask Opus about these: an opinion beside a row, never a filter
 *
 * Since plan 261007l a referee can press **Ask Opus about these**, and each row
 * gets one line under it — *probably harmless* or *worth a look*, and why. The
 * text Opus judges was written by whoever hid it, so **the answer reaches
 * nothing but those lines**: it travels in `CheckContext`, which only
 * `Examined` and `Finding` read, and `shown()` — the headline, the counts, the
 * open default, the chip's mark — never sees it. The rows come from
 * `grouped(ordered(findings))` (src/scan-groups.ts) and nothing else.
 * tests/hidden-check-panel.test.tsx renders a hostile "harmless" answer and
 * checks all of those are unchanged. The verdict words are ours
 * (`VERDICT_WORDS`); the reason is the model's, drawn so it cannot disguise
 * anything (`visibleReason`, `.ref-scan-opinion` in referee.css).
 * docs/plans/261007l-hidden-text-an-opus-check-the-reader-asks-for-over-the-flagged-fragments-only.md.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

import type {
  BlindSpot,
  FindingKind,
  HtmlSourceScan,
  OrdinaryExplanation,
  ScanFinding,
  SourceScan,
} from "../injection-scan-types.js";
import type { HiddenJudgment, HiddenVerdict } from "../referee-hidden-check-types.js";
import { type ScanGroup, checkedInputs, grouped, ordered, sameInputs } from "../scan-groups.js";
import type { HiddenCheckApi } from "./useHiddenCheck.js";
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
 * Characters that draw nothing, and whitespace: what is left of a finding's
 * quoted text once they are gone is what a reader would actually see.
 */
const DRAWS_NOTHING = /[\s­​-‏‪-‮⁠-⁤⁦-⁩﻿\u{E0000}-\u{E007F}]/gu;

/**
 * Direction controls in returned document strings can also make the browser
 * visually reorder the evidence that names them. Show the code point instead. The
 * source path and finding text are both document-written, so both pass through
 * this boundary; React escaping alone does not neutralise Unicode bidi.
 */
const BIDI_CONTROL = /\p{Bidi_Control}/gu;

/** Keep an attacker-written id, class or CSS value from becoming the whole panel. */
const MAX_EVIDENCE_TEXT = 500;

function visibleEvidence(value: string, cap = Number.POSITIVE_INFINITY): string {
  const visible = value.length > cap ? `${value.slice(0, cap)}… [shortened]` : value;
  return visible.replace(BIDI_CONTROL, (control) => {
    const codePoint = control.codePointAt(0);
    return codePoint === undefined ? "" : `⟦U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}⟧`;
  });
}

/* `grouped` and `ordered` — identical findings as one row, the unexplained
   first — are in src/scan-groups.ts since plan 261007l, because the Opus check
   on the server has to number the rows exactly as this panel draws them. Their
   reasoning moved with them. */

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
 * **One state of the panel: what it says shut, what it hides, and how worried a
 * referee should be.**
 *
 * All five together in one returned object rather than separate functions
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

/**
 * **The Opus check, for the two components that may read it** — `Examined`
 * and `Finding`. A context rather than a parameter of `shown()`, so the
 * headline, the counts, the open default and the chip's mark are computed by
 * code that cannot reach the answer at all.
 */
const CheckContext = createContext<HiddenCheckApi | undefined>(undefined);

export function SourceScanNotice({
  state,
  check,
}: {
  state: SourceScanState;
  /**
   * The Opus check, held by `RefereeBand` beside the scan so a chip change
   * keeps its answer. Optional: without it there is no button, which is how
   * the tests that are about the scan alone render the panel.
   */
  check?: HiddenCheckApi;
}) {
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
            <CheckContext.Provider value={check}>{view.detail}</CheckContext.Provider>
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
  const check = useContext(CheckContext);
  const groups = grouped(rows);
  return (
    <>
      {check !== undefined && groups.length > 0 && <AskOpus check={check} groups={groups} />}
      {groups.length > 0 && (
        <ul className="ref-scan-list">
          {groups.map((group) => (
            <Finding
              key={group.key}
              group={group}
              opinion={check?.status === "done" && check.result ? opinionFor(group, check.result.judgments) : undefined}
            />
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
 * **One row: what was found, the words themselves, what the trick is, and then
 * the evidence for somebody who will go and look.**
 *
 * Plan 261007h put the plain words first and the CSS path and code points
 * last and smaller, under *In the source*. Both stay: the rules say evidence
 * is shown, and a referee who wants to check needs it.
 */
function Finding({
  group,
  opinion,
}: {
  group: ScanGroup;
  /** Opus's line for this row: absent before a check has finished, `null` when it did not check this row. */
  opinion?: HiddenJudgment | null | undefined;
}) {
  const { finding, count, paths } = group;
  const ordinary = finding.ordinary === undefined ? undefined : ownLabel(ORDINARY_LABEL, finding.ordinary);
  const means = ownLabel(KIND_MEANS, finding.kind);
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
      {count > 1 && <span className="ref-scan-count">{count} times</span>}
      {ordinary !== undefined && <span className="ref-scan-tag">{ordinary}</span>}
      {visible ? (
        <q className="ref-scan-text"><bdi>{visibleEvidence(finding.text)}</bdi></q>
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
      {opinion !== undefined && <Opinion opinion={opinion} />}
      <span className="ref-scan-source">
        In the source:{" "}
        {paths.map((path, i) => (
          <span key={path}>
            {i > 0 ? "; " : ""}
            <bdi className="ref-scan-where">{visibleEvidence(path, MAX_EVIDENCE_TEXT)}</bdi>
          </span>
        ))}{" "}
        ·{" "}
        <bdi className="ref-scan-detail">{visibleEvidence(finding.detail, MAX_EVIDENCE_TEXT)}</bdi>
      </span>
    </li>
  );
}

/* ------------------------------------------------- Ask Opus about these -- */

/** The words a referee reads for each verdict. Ours, never the model's. */
export const VERDICT_WORDS: Record<HiddenVerdict, string> = {
  "probably-harmless": "probably harmless",
  "worth-a-look": "worth a look",
};

/** What the button does and cannot do, under it. */
export const ASK_OPUS_NOTE =
  "Opus reads only the flagged bits below, never the rest of the article, and gives its opinion " +
  "on each row. It can be fooled by the very text it is judging, so every row stays listed.";

/**
 * **The judgment for this row, if one was made from exactly what it shows.**
 *
 * `null` — *not checked* — when none was, including a judgment whose key
 * matches but whose paths or counts do not: the group key leaves those out, so
 * an opinion about one set of places is not shown beside another
 * (`sameInputs`, src/scan-groups.ts).
 */
export function opinionFor(group: ScanGroup, judgments: readonly HiddenJudgment[]): HiddenJudgment | null {
  const inputs = checkedInputs(group);
  return judgments.find((j) => sameInputs(j.row, inputs)) ?? null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The summary over the rows, counted from the lines the panel actually draws —
 * so it cannot say "2 harmless" over a panel showing one.
 */
export function checkSummary(groups: readonly ScanGroup[], judgments: readonly HiddenJudgment[]): string {
  let worth = 0;
  let harmless = 0;
  let unchecked = 0;
  for (const group of groups) {
    const opinion = opinionFor(group, judgments);
    if (opinion === null) unchecked++;
    else if (opinion.verdict === "worth-a-look") worth++;
    else harmless++;
  }
  if (worth + harmless === 0) return "Opus did not check any of these rows.";
  const judged =
    worth > 0 && harmless > 0
      ? `${plural(worth, "row", "rows")} worth a look and ${harmless} harmless`
      : worth > 0
        ? `${plural(worth, "row", "rows")} worth a look`
        : `${plural(harmless, "row", "rows")} harmless`;
  return `Opus judged ${judged}${unchecked > 0 ? `, and did not check ${unchecked}` : ""}.`;
}

function AskOpus({ check, groups }: { check: HiddenCheckApi; groups: readonly ScanGroup[] }) {
  const running = check.status === "running";
  return (
    <div className="ref-scan-ask">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ref-scan-ask-btn"
        onClick={check.ask}
        disabled={running}
      >
        Ask Opus about these
      </Button>
      <p className="ref-scan-line ref-scan-note">{ASK_OPUS_NOTE}</p>
      {running && (
        <p className="ref-scan-line ref-scan-progress">
          {check.chars === 0 ? "Reading the flagged bits…" : `Answering… ${check.chars} characters`}
        </p>
      )}
      {check.status === "failed" && check.error && <p className="ref-scan-line ref-scan-warn">{check.error}</p>}
      {check.status === "done" && check.result && (
        <p className="ref-scan-line ref-scan-summary">{checkSummary(groups, check.result.judgments)}</p>
      )}
    </div>
  );
}

/**
 * Characters that draw nothing or reorder what is around them: format
 * characters (zero-width spaces and joiners, soft hyphens, tag characters,
 * the bidi embeddings and isolates), default-ignorable characters (including
 * variation selectors and blank fillers), and controls. A model's reason
 * may quote the fragment it judged, and the fragment may be built of exactly
 * these, so they are shown as code points rather than left to act.
 */
const INVISIBLE_OR_REORDERING = /[\p{Cf}\p{Cc}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}\u{E0000}-\u{E007F}]/gu;

/** The model's reason, with every invisible or reordering character printed as its code point. */
export function visibleReason(reason: string): string {
  return reason.replace(INVISIBLE_OR_REORDERING, (ch) => {
    const codePoint = ch.codePointAt(0);
    return codePoint === undefined ? "" : `⟦U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}⟧`;
  });
}

/**
 * **One row's line**: the app's words for the verdict, then, on the line
 * under them, the model's reason in the model's face (docs/project/fonts.md),
 * isolated in a `<bdi>` and inside a box that clips, so a stack of combining marks cannot paint over the row
 * above. Says how many places were shown when the row has more than were sent.
 */
function Opinion({ opinion }: { opinion: HiddenJudgment | null }) {
  if (opinion === null) {
    return (
      <p className="ref-scan-opinion" data-verdict="none">
        Opus: not checked.
      </p>
    );
  }
  const { row, verdict, reason } = opinion;
  const who = row.totalPaths > row.paths.length ? `Opus, from ${row.paths.length} of ${row.totalPaths} places` : "Opus";
  return (
    <p className="ref-scan-opinion" data-verdict={verdict}>
      <span className="ref-scan-opinion-verdict">
        {who}: {VERDICT_WORDS[verdict]}
        {" — "}
      </span>
      <bdi className="ref-scan-opinion-reason">{visibleReason(reason)}</bdi>
    </p>
  );
}
