/**
 * **The sub-modes, named once** — the chips inside a mode that change the whole
 * band: Learn's Recall | Tutorial | Explore | Quiz, Diagram's five pictures, Referee's four views,
 * Summary's Brief | Fuller | Thread, Structure's Fisheye | Expanded, Debate's Reception | Claims.
 *
 * Greg, 2026-10-01 (SPIDERYARN-READING2-77):
 *
 * > In the Command bar, include sub-modes, e.g. Quiz mode, Illustrated diagram, etc.
 *
 * Until then each sub-mode's name lived in a private table inside the panel that
 * draws its chip (QuizPanel, DiagramPanel, RefereeMode, SummaryMode). The bar
 * needed the same words, so they moved here and the panels import them: a chip
 * and the bar row that opens it cannot be called different things.
 *
 * **Pure, and that is a constraint rather than a style**: command-match.ts ranks
 * these and must import no React (its own header says why), so nothing here may
 * either. The URL vocabularies themselves stay where they are parsed
 * (params.ts, diagram.ts, referee-views.ts, types.ts); this file only names
 * them. What a sub-mode *arms* is activation.ts § `subModeTarget`, next to the
 * mode table it extends.
 *
 * **Not a sub-mode, deliberately**: the orderings inside a mode (Quotes' rank,
 * Glossary's sort, Search's matcher), which reorder a band rather than replace
 * it. Summary's outline (`?summary=gists`) was the other, until it was removed
 * on 2026-10-01 (docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md).
 * docs/plans/261001d-command-bar-lists-sub-modes.md.
 */
import type { Mode } from "../modes.js";
import { DIAGRAMS, type DiagramKind } from "./diagram.js";
import { shownBehindTheSwitch } from "./experimental-visibility.js";
import type { DebateView, LearnView, StructureView, SummaryView } from "./params.js";
import { REFEREE_VIEWS, type RefereeView } from "./referee-views.js";

/**
 * **One sub-mode, as the mode it is in and which one.** A discriminated union
 * rather than `{ mode: Mode; view: string }`, so `{ mode: "learn", view:
 * "illustrated" }` does not compile.
 */
export type SubMode =
  | { readonly mode: "learn"; readonly view: LearnView }
  | { readonly mode: "diagram"; readonly view: DiagramKind }
  | { readonly mode: "referee"; readonly view: RefereeView }
  | { readonly mode: "summary"; readonly view: SummaryView }
  | { readonly mode: "structure"; readonly view: StructureView }
  | { readonly mode: "debate"; readonly view: DebateView };

/** The modes that have sub-modes. */
export type ModeWithSubModes = SubMode["mode"];

/**
 * **What a sub-mode is called, and what the bar says about it.**
 *
 * `description` is the bar's one line, in the voice of `MODE_CATALOG`'s; the
 * chips keep their own longer tooltips. `experimental` is whether the chip is
 * behind the experimental-features switch *within* its mode — four of Diagram's
 * pictures are, and Learn's Explore (since 2026-10-05); every other mode
 * puts the whole mode behind it or none.
 *
 * `aliases` is for a sub-mode a reader knows by another word, and one has them:
 * Summary's Thread, which was the Tweets mode until 2026-10-03. They are the
 * row's own and not its parent's, because the parent's catalog aliases find the
 * *mode* row, which opens whatever view the address already names — typing
 * `tweets` would open Summary at Brief (GPT Sol, F3 of the 261003l review;
 * command-match.ts § `commandText`).
 */
export interface SubModeWords {
  readonly label: string;
  readonly description: string;
  readonly experimental: boolean;
  readonly aliases?: readonly string[];
}

/** Learn's four parts. The chip's words, QuizPanel.tsx § `LearnSubModeToggle`. */
export const LEARN_SUB_MODES: Readonly<Record<LearnView, SubModeWords>> = {
  recall: {
    label: "Recall",
    description: "Say what you took from the piece, and find out where it holds up",
    experimental: false,
  },
  tutorial: {
    label: "Tutorial",
    description: "Short turns: a little of the piece at a time, then a question for you to answer in your own words",
    experimental: false,
  },
  explore: {
    label: "Explore",
    /* Widened 2026-10-05 (Greg, spya-mvmpks): not only the reader's own ideas
       but *"potential problems and criticisms and concerns"* about the piece. */
    description: "Think it through for yourself: your own ideas, where the piece may be weak, and what others say. Starts from what you have marked and discussed",
    /* The one part of Learn still behind the switch. Greg named Recall,
       Quiz and Tutorial for the mainstream features on 2026-10-04
       (spya-cnqcjf) and left this one out; it is two days old.
       docs/project/experimental-features.md. */
    experimental: true,
  },
  quiz: {
    label: "Quiz",
    description: "The piece asks you questions, and your answers are marked against it",
    experimental: false,
  },
};

/**
 * **The parts of Learn to draw**, in chip order: every part that is not
 * behind the experimental-features switch, plus all of them when the switch is
 * on, plus the one the reader is in (`current`) — the bar's own rule,
 * experimental-visibility.ts. So an old `?learn=explore` link still shows
 * its chip pressed with the switch off.
 *
 * One function for the two places in the band that list the parts, the chips
 * (QuizPanel.tsx § `LearnSubModeToggle`) and the (i) (LearnAbout.tsx),
 * so they cannot show different sets. The command bar applies the same rule to
 * every mode's sub-modes at once (CommandBar.tsx § `subModeRows`).
 */
export function visibleLearnViews(on: boolean, current: LearnView): readonly LearnView[] {
  return (Object.keys(LEARN_SUB_MODES) as LearnView[]).filter((view) =>
    shownBehindTheSwitch({
      experimental: LEARN_SUB_MODES[view].experimental,
      on,
      current: view === current,
    }),
  );
}

/**
 * Diagram's five pictures. The chips (DiagramPanel.tsx § `KIND_UI`) read their
 * label and their place behind the switch from here and keep their icon and
 * their longer tooltip there. Sketch alone is not experimental — params.ts §
 * `diagramParam` says why it is the default for everybody.
 */
export const DIAGRAM_SUB_MODES: Readonly<Record<DiagramKind, SubModeWords>> = {
  force: {
    label: "Force",
    description: "Sections as bubbles that pull together where they talk about the same things",
    experimental: true,
  },
  drift: {
    label: "Drift",
    description: "One dot per paragraph, down the page in order and sideways by subject",
    experimental: true,
  },
  trail: {
    label: "Trail",
    description: "Drift's dots joined in reading order — does the piece travel or circle back",
    experimental: true,
  },
  sketch: {
    label: "Sketch",
    description: "A model reads the argument and draws its shape",
    experimental: false,
  },
  illustrated: {
    label: "Illustrated",
    description: "The Sketch, painted — an interpretation of the argument's shape",
    experimental: true,
  },
};

/** Referee's five views. The chips, RefereeMode.tsx § `RefereeViews`. */
export const REFEREE_SUB_MODES: Readonly<Record<RefereeView, SubModeWords>> = {
  criteria: {
    label: "Criteria",
    description: "Your own reviewing criteria, run over the piece",
    experimental: false,
  },
  claims: {
    label: "Claims",
    description: "What the piece promises, against the passages meant to deliver it",
    experimental: false,
  },
  mirror: {
    label: "Mirror",
    description: "Your own review comments, read back to you — never a verdict on the paper",
    experimental: false,
  },
  candidates: {
    label: "Candidates",
    description: "Who could review this piece, and what expertise it would take",
    experimental: false,
  },
  hidden: {
    label: "Hidden text",
    description: "Text the document hides from a reader but a model would read, found in its source",
    experimental: false,
  },
};

/**
 * Summary's three views: two plain-words lengths and the thread. The band's
 * segmented control, SummaryMode.tsx § `SummaryControls`; the order is the
 * control's (`SUMMARY_VIEWS`, params.ts). The Simple level left on 2026-10-03,
 * and stopped being written on 2026-10-04 (plan 261004f).
 * docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md.
 */
export const SUMMARY_SUB_MODES: Readonly<Record<SummaryView, SubModeWords>> = {
  brief: {
    label: "Brief",
    description: "The piece in plain words, short and very simple",
    experimental: false,
  },
  fuller: {
    label: "Fuller",
    description: "The piece in plain words, longer and with more of the detail",
    experimental: false,
  },
  thread: {
    label: "Thread",
    description: "The article as a numbered thread of short posts",
    experimental: false,
    /* The Tweets mode's own name and its catalog aliases, until 2026-10-03.
       `tweets` first: it is the word on every old link and in every reader's
       habit. */
    aliases: ["tweets", "tweet thread", "twitter", "x", "social"],
  },
};

/**
 * Structure's two views. The chips' words, StructureMode.tsx §
 * `StructureViewToggle`. Greg, 2026-10-01 (spya-gxyhcc); the order is the
 * toggle's, Fisheye first because it is the default.
 */
export const STRUCTURE_SUB_MODES: Readonly<Record<StructureView, SubModeWords>> = {
  fisheye: {
    label: "Fisheye",
    description: "Every part, opened up around the one you are reading",
    experimental: false,
  },
  expanded: {
    label: "Expanded",
    description: "Every part and section, each with its summary, in one list",
    experimental: false,
  },
};

/**
 * Debate's two sub-modes, one per search. The band's segmented control,
 * DebatePanel.tsx § `DebateViews`; Reception first because it is the default.
 * Greg, 2026-10-03 (spya-caue42): *"there could be a claims submode … And then
 * there's a section, a separate submode besides claims for reception"*.
 * docs/plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md.
 */
export const DEBATE_SUB_MODES: Readonly<Record<DebateView, SubModeWords>> = {
  reception: {
    label: "Reception",
    description:
      "What others have written about this piece itself: replies, reviews, and work that cites it and says something about it",
    experimental: false,
  },
  claims: {
    label: "Claims",
    description: "What has been written about the claims it makes, by people who may never have read it",
    experimental: false,
  },
};

/** The words for one sub-mode. A `switch` so a seventh mode with sub-modes fails to compile here. */
export function subModeWords(sub: SubMode): SubModeWords {
  switch (sub.mode) {
    case "learn":
      return LEARN_SUB_MODES[sub.view];
    case "diagram":
      return DIAGRAM_SUB_MODES[sub.view];
    case "referee":
      return REFEREE_SUB_MODES[sub.view];
    case "summary":
      return SUMMARY_SUB_MODES[sub.view];
    case "structure":
      return STRUCTURE_SUB_MODES[sub.view];
    case "debate":
      return DEBATE_SUB_MODES[sub.view];
    default: {
      const never: never = sub;
      return never;
    }
  }
}

/**
 * **A mode's sub-modes, in the order its chips are drawn.** Empty for a mode
 * without any. The orders are the vocabularies' own (`DIAGRAMS`,
 * `REFEREE_VIEWS`) — Greg's chip order, which DiagramPanel's refusal sentences
 * depend on — and Learn's, Summary's and Structure's are the record's, which
 * is the toggle's (`LEARN_VIEWS` and `SUMMARY_VIEWS` live in params.ts, which
 * this pure module may not import as a value).
 */
export function subModesOf(mode: Mode): readonly SubMode[] {
  switch (mode) {
    case "learn":
      return (Object.keys(LEARN_SUB_MODES) as LearnView[]).map((view) => ({ mode, view }));
    case "diagram":
      return DIAGRAMS.map((view) => ({ mode, view }));
    case "referee":
      return REFEREE_VIEWS.map((view) => ({ mode, view }));
    case "summary":
      return (Object.keys(SUMMARY_SUB_MODES) as SummaryView[]).map((view) => ({ mode, view }));
    case "structure":
      return (Object.keys(STRUCTURE_SUB_MODES) as StructureView[]).map((view) => ({ mode, view }));
    case "debate":
      return (Object.keys(DEBATE_SUB_MODES) as DebateView[]).map((view) => ({ mode, view }));
    default:
      return [];
  }
}

/**
 * **What the address says once a sub-mode is open** — the query parameters to
 * write, `null` meaning *remove*. One function for both doors: the reading view
 * writes these through nuqs (Reader.tsx), the metadata page builds an href from
 * them (Dock.tsx), so the two cannot land in different places.
 *
 * Parser defaults are `null` here, just as nuqs writes them: Recall, Sketch,
 * Criteria and Brief disappear from the address rather than leaving a redundant
 * explicit default in metadata-page links. Learn's Quiz also clears `thread`: Learn's rule 1
 * (ConversationModes.tsx § LearnBand) — no frame in which the URL says both,
 * and one Back undoes the whole trip.
 */
export interface SubModeParams {
  readonly mode: ModeWithSubModes;
  readonly learn?: LearnView | null;
  readonly thread?: null;
  readonly diagram?: DiagramKind | null;
  readonly referee?: RefereeView | null;
  readonly summary?: SummaryView | null;
  readonly structure?: StructureView | null;
  readonly debate?: DebateView | null;
}

export function subModeParams(sub: SubMode): SubModeParams {
  switch (sub.mode) {
    case "learn": {
      /* Each view by name: Recall is the default and so absent, Quiz clears
         `thread` (rule 1), and Tutorial and Explore keep it as Recall does —
         each band overrules a stale one and writes its own. Mapping "not quiz" to Recall
         was right with two views and silently wrong with three. */
      const view = sub.view;
      switch (view) {
        case "quiz":
          return { mode: "learn", learn: "quiz", thread: null };
        case "tutorial":
          return { mode: "learn", learn: "tutorial" };
        case "explore":
          return { mode: "learn", learn: "explore" };
        case "recall":
          return { mode: "learn", learn: null };
        default: {
          const unknown: never = view;
          throw new Error(`unknown Learn view: ${String(unknown)}`);
        }
      }
    }
    case "diagram":
      return { mode: "diagram", diagram: sub.view === "sketch" ? null : sub.view };
    case "referee":
      return { mode: "referee", referee: sub.view === "criteria" ? null : sub.view };
    case "summary":
      return { mode: "summary", summary: sub.view === "brief" ? null : sub.view };
    case "structure":
      return { mode: "structure", structure: sub.view === "fisheye" ? null : sub.view };
    case "debate":
      return { mode: "debate", debate: sub.view === "reception" ? null : sub.view };
    default: {
      const never: never = sub;
      return never;
    }
  }
}

/**
 * **What a press on a mode alone must write beyond `mode`**, given the
 * sub-mode parameters the address has kept — or `null`, which is nearly always
 * the answer: write `mode` and nothing else.
 *
 * A sub-mode parameter outlives its mode on purpose (url-state.md § a sub-mode
 * parameter outlives its mode), so pressing Learn with `learn=quiz` still
 * in the address returns the reader to the Quiz. That return is a navigation
 * *to Quiz*, and Learn's rule 1 says Quiz and a cleared `thread` are one
 * navigation: coming from a Chat conversation, `mode` alone would mount the
 * Quiz with Chat's thread still selected, for `LearnBand` to drop an effect
 * later (GPT Sol, F2 of the 261004l plan review). So that one return is
 * `subModeParams`' answer for Quiz, the same as the chip and the command bar's
 * row write, rather than a second copy of the rule.
 *
 * Only Quiz. Recall, Tutorial and Explore each overrule a stale thread
 * themselves and write their own, and no other mode's sub-mode touches a second
 * key. Both doors ask this: Reader.tsx § the Dock's `onMode`, and Dock.tsx §
 * `modeLinkHref` for the metadata page's link.
 */
export function returnToSubMode(
  next: Mode,
  retained: { readonly learn: LearnView },
): SubModeParams | null {
  return next === "learn" && retained.learn === "quiz"
    ? subModeParams({ mode: "learn", view: "quiz" })
    : null;
}

/** `search` with a sub-mode's parameters written into it. Leading `?` kept when there is anything. */
export function withSubMode(search: string, sub: SubMode): string {
  return withSubModeParams(search, subModeParams(sub));
}

/** `withSubMode`'s second half, for a caller that already holds the parameters (`returnToSubMode`). */
export function withSubModeParams(search: string, written: SubModeParams): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(written)) {
    if (value === null) params.delete(key);
    else if (value !== undefined) params.set(key, value);
  }
  const out = params.toString();
  return out === "" ? "" : `?${out}`;
}
