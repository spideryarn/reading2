/**
 * **The sub-modes, named once** — the chips inside a mode that change the whole
 * band: Remember's Recall | Quiz, Diagram's five pictures, Referee's four views,
 * Summary's three plain-words levels.
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
 * **Not a sub-mode, deliberately**: Summary's outline (`?summary=gists`), which
 * has no control of its own since 2026-10-01 — pressing Parts or Sections is
 * what chooses it, and the Summary mode row is the way there — and the
 * orderings inside a mode (Quotes' rank, Glossary's sort, Search's matcher),
 * which reorder a band rather than replace it.
 * docs/plans/261001d-command-bar-lists-sub-modes.md.
 */
import type { Mode } from "../modes.js";
import { SIMPLE_LEVELS, type SimpleLevel } from "../types.js";
import { DIAGRAMS, type DiagramKind } from "./diagram.js";
import type { RememberView, StructureView } from "./params.js";
import { REFEREE_VIEWS, type RefereeView } from "./referee-views.js";

/**
 * **One sub-mode, as the mode it is in and which one.** A discriminated union
 * rather than `{ mode: Mode; view: string }`, so `{ mode: "remember", view:
 * "illustrated" }` does not compile.
 */
export type SubMode =
  | { readonly mode: "remember"; readonly view: RememberView }
  | { readonly mode: "diagram"; readonly view: DiagramKind }
  | { readonly mode: "referee"; readonly view: RefereeView }
  | { readonly mode: "summary"; readonly view: SimpleLevel }
  | { readonly mode: "structure"; readonly view: StructureView };

/** The modes that have sub-modes. */
export type ModeWithSubModes = SubMode["mode"];

/**
 * **What a sub-mode is called, and what the bar says about it.**
 *
 * `description` is the bar's one line, in the voice of `MODE_CATALOG`'s; the
 * chips keep their own longer tooltips. `experimental` is whether the chip is
 * behind the experimental-features switch *within* its mode — only Diagram's
 * pictures are; the other three modes put the whole mode behind it or none.
 */
export interface SubModeWords {
  readonly label: string;
  readonly description: string;
  readonly experimental: boolean;
}

/** Remember's two halves. The chip's words, QuizPanel.tsx § `RememberSubModeToggle`. */
export const REMEMBER_SUB_MODES: Readonly<Record<RememberView, SubModeWords>> = {
  recall: {
    label: "Recall",
    description: "Say what you took from the piece, and find out where it holds up",
    experimental: false,
  },
  quiz: {
    label: "Quiz",
    description: "The piece asks you questions, and your answers are marked against it",
    experimental: false,
  },
};

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

/** Referee's four views. The chips, RefereeMode.tsx § `RefereeViews`. */
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
};

/** Summary's plain-words levels. The slider, SummaryMode.tsx § `SummaryControls`. */
export const SUMMARY_SUB_MODES: Readonly<Record<SimpleLevel, SubModeWords>> = {
  brief: {
    label: "Brief",
    description: "The piece in plain words, short and very simple",
    experimental: false,
  },
  simple: {
    label: "Simple",
    description: "The piece in plain words, a few short paragraphs",
    experimental: false,
  },
  fuller: {
    label: "Fuller",
    description: "The piece in plain words, a little longer and keeping more of its terms",
    experimental: false,
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

/** The words for one sub-mode. A `switch` so a sixth mode with sub-modes fails to compile here. */
export function subModeWords(sub: SubMode): SubModeWords {
  switch (sub.mode) {
    case "remember":
      return REMEMBER_SUB_MODES[sub.view];
    case "diagram":
      return DIAGRAM_SUB_MODES[sub.view];
    case "referee":
      return REFEREE_SUB_MODES[sub.view];
    case "summary":
      return SUMMARY_SUB_MODES[sub.view];
    case "structure":
      return STRUCTURE_SUB_MODES[sub.view];
    default: {
      const never: never = sub;
      return never;
    }
  }
}

/**
 * **A mode's sub-modes, in the order its chips are drawn.** Empty for a mode
 * without any. The orders are the vocabularies' own (`DIAGRAMS`,
 * `REFEREE_VIEWS`, `SIMPLE_LEVELS`) — Greg's chip order, which DiagramPanel's
 * refusal sentences depend on — and Remember's is the record's, which is the
 * toggle's (`REMEMBER_VIEWS` lives in params.ts, which this pure module may not
 * import as a value).
 */
export function subModesOf(mode: Mode): readonly SubMode[] {
  switch (mode) {
    case "remember":
      return (Object.keys(REMEMBER_SUB_MODES) as RememberView[]).map((view) => ({ mode, view }));
    case "diagram":
      return DIAGRAMS.map((view) => ({ mode, view }));
    case "referee":
      return REFEREE_VIEWS.map((view) => ({ mode, view }));
    case "summary":
      return SIMPLE_LEVELS.map((view) => ({ mode, view }));
    case "structure":
      return (Object.keys(STRUCTURE_SUB_MODES) as StructureView[]).map((view) => ({ mode, view }));
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
 * Parser defaults are `null` here, just as nuqs writes them: Recall, Sketch
 * and Criteria disappear from the address rather than leaving a redundant
 * explicit default in metadata-page links. Remember's Quiz also clears `thread`: Remember's rule 1
 * (ConversationModes.tsx § RememberBand) — no frame in which the URL says both,
 * and one Back undoes the whole trip.
 */
export interface SubModeParams {
  readonly mode: ModeWithSubModes;
  readonly remember?: RememberView | null;
  readonly thread?: null;
  readonly diagram?: DiagramKind | null;
  readonly referee?: RefereeView | null;
  readonly summary?: SimpleLevel;
  readonly structure?: StructureView | null;
}

export function subModeParams(sub: SubMode): SubModeParams {
  switch (sub.mode) {
    case "remember":
      return sub.view === "quiz"
        ? { mode: "remember", remember: "quiz", thread: null }
        : { mode: "remember", remember: null };
    case "diagram":
      return { mode: "diagram", diagram: sub.view === "sketch" ? null : sub.view };
    case "referee":
      return { mode: "referee", referee: sub.view === "criteria" ? null : sub.view };
    case "summary":
      return { mode: "summary", summary: sub.view };
    case "structure":
      return { mode: "structure", structure: sub.view === "fisheye" ? null : sub.view };
    default: {
      const never: never = sub;
      return never;
    }
  }
}

/** `search` with a sub-mode's parameters written into it. Leading `?` kept when there is anything. */
export function withSubMode(search: string, sub: SubMode): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(subModeParams(sub))) {
    if (value === null) params.delete(key);
    else if (value !== undefined) params.set(key, value);
  }
  const out = params.toString();
  return out === "" ? "" : `?${out}`;
}
