/**
 * **Every mode's band may break on its own**, and this is the one place that
 * decides it.
 *
 * `FeatureBoundary` was written for Ideas on 2026-09-05 and wrapped one case of
 * `Reader`'s band switch; Debate got the second on 2026-09-10. The other ten
 * bands still took the whole reader with them when they threw. Rather than ten
 * more copies of the same wrapper, the boundary moved **out of the switch to its
 * one call site** — `Reader` § `band()` wraps whatever `modeBand()` returns — so
 * a band is contained because it is a band, not because somebody remembered.
 * docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § B.
 *
 * ## What the boundary encloses, and what it cannot
 *
 * Everything each band component runs: its controller's hooks — the job poll,
 * `useAutoRun`, `useChat`, the passage publishing — and its panel. This also
 * includes `VisitorBand` when policy or a missing artefact puts that sentence
 * in the band's place. **Not**
 * anything a band reads from above it, because a boundary cannot catch a throw
 * from the component that renders it. Several modes depend on such state, and
 * wrapping the band does not protect it: `OwnedReader`'s opening reads for the
 * glossary and the quotes, `useComments` behind Referee's marks,
 * `useQuoteMarks` and the found-passage state `Reader` draws in the prose, and
 * the glossary's question on its way into chat. A throw in any of those is a
 * throw in `Reader`, and `AppBoundary` still takes it. The inventory, mode by
 * mode, is in the plan section above.
 *
 * ## Keyed on the mode, and the sub-mode is in the reset key
 *
 * `key={mode}` at the call site gives every mode its own boundary, so a broken
 * Quotes cannot follow the reader into Timeline. Within a mode, the sub-mode a
 * band is showing — Diagram's picture, Referee's view, Learn's part, Summary's
 * length, Structure's layout, Debate's view — goes in `resetKey`, which is
 * `FeatureBoundary`'s documented extension point for it: Back from broken
 * Claims to Criteria is a different band and gets a fresh start. For three of
 * the six a visitor's key omits it, because the parameter does not select their
 * band. Which three, and why, is `SUB_MODE_SELECTS_A_BAND_FOR` below — a
 * `Record` over every mode that has sub-modes, because the list was written by
 * hand until 2026-10-06 and Debate, the sixth, was not on it.
 *
 * ## And the press it retires is the press it would have claimed
 *
 * `bandTarget` (activation.ts) answers from the same tables the presses arm
 * from. It needs the sub-mode for Diagram, Referee, Learn and Summary (whose
 * thread arms nothing), and each also belongs in the boundary reset key.
 * This component therefore reads those parameters itself. That keeps them off
 * `Reader`'s own render, which the bands that own them each avoided for the
 * same reason (LearnBand, DiagramBand).
 */
import { useQueryStates } from "nuqs";
import type { ReactNode } from "react";
import { MODE_LABEL } from "../../title-text.js";
import { bandTarget } from "../activation.js";
import { FeatureBoundary } from "../FeatureBoundary.js";
import {
  diagramParam,
  type Mode,
  sourcesParam,
  refereeParam,
  learnParam,
  structureParam,
  summaryParam,
} from "../params.js";
import type { ModeWithSubModes } from "../sub-modes.js";

/**
 * **Whether each mode's band is inside a boundary, decided rather than fallen
 * into.** A `Record`, so a new mode is a compile error here until somebody has
 * said which — the `MODE_TARGET` idiom (activation.ts) for the containment
 * question. tests/a-broken-mode-leaves-the-article-readable.test.tsx derives its
 * completeness check from `MODES`, pins the exemptions by name, and throws inside
 * every `contained` band to show the fallback is really there.
 *
 * **One exemption, and it is the article.** Plain has no band: it is the prose
 * alone. A boundary around it would have to take the article with it, which is
 * the one thing this exists to prevent — so a throw there stays `AppBoundary`'s.
 * (Hierarchy, the gist columns, was the second exemption until it retired on
 * 2026-09-29.)
 */
export type Containment = { kind: "contained" } | { kind: "exempt"; reason: string };

const BAND: Containment = { kind: "contained" };

export const MODE_CONTAINMENT: Record<Mode, Containment> = {
  plain: { kind: "exempt", reason: "no band: the prose alone, which is what a fallback protects" },
  chat: BAND,
  glossary: BAND,
  search: BAND,
  referee: BAND,
  summary: BAND,
  diagram: BAND,
  ideas: BAND,
  learn: BAND,
  quotes: BAND,
  timeline: BAND,
  sources: BAND,
  structure: BAND,
  faq: BAND,
  skim: BAND,
  /* No band, but a column of its own on the right, and that column is inside
     the same boundary at its own call site in Reader.tsx — so a throw in it
     leaves the article readable, as a band's would. */
  marginalia: BAND,
};

/**
 * **Each sub-mode's parameter, under its mode's own name** — `?diagram=`,
 * `?sources=` and so on, which is what lets `sub[mode]` below be the view that
 * mode is showing. `satisfies` and not an annotation, so nuqs still sees each
 * parser's own type and a seventh mode with sub-modes fails to compile here.
 */
const SUB_MODE_PARAMS = {
  diagram: diagramParam,
  referee: refereeParam,
  learn: learnParam,
  summary: summaryParam,
  structure: structureParam,
  sources: sourcesParam,
} satisfies Record<ModeWithSubModes, unknown>;

/**
 * **Whose band a sub-mode chooses**: `anyone`'s, or only the `owner`'s.
 *
 * A change of sub-mode is a different band, and a different band gets a fresh
 * start — but only for a reader whose band the parameter really selects. Where
 * it does not, an address change is not a new band and must not retry a broken
 * one behind the reader's back.
 *
 * - **`owner`**: Diagram (a visitor is pinned to Sketch), Referee and Learn
 *   (a visitor sees `VisitorBand` whatever the parameter says).
 * - **`anyone`**: Summary (a visitor gets the plain-words lengths and the
 *   thread too, off the payload — SummaryMode.tsx § `VisitorSummaryBand`),
 *   Structure (Fisheye and Expanded are two bands for anyone, off the payload)
 *   and Sources (Bibliography, Reception and Claims, read by both
 *   `SourcesBand` and `VisitorSourcesBand` — SourcesMode.tsx).
 *
 * A `Record`, so a new mode with sub-modes is a compile error until somebody
 * has said which. tests/a-broken-mode-leaves-the-article-readable.test.tsx.
 */
const SUB_MODE_SELECTS_A_BAND_FOR: Record<ModeWithSubModes, "anyone" | "owner"> = {
  diagram: "owner",
  referee: "owner",
  learn: "owner",
  summary: "anyone",
  structure: "anyone",
  sources: "anyone",
};

function hasSubModes(mode: Mode): mode is ModeWithSubModes {
  return Object.hasOwn(SUB_MODE_SELECTS_A_BAND_FOR, mode);
}

/**
 * `FeatureBoundary` for whichever band `mode` opened.
 *
 * `owner` decides whether there is a press to retire at all: a visitor's band
 * never auto-runs, so its target is `null` whatever the sub-mode.
 */
export function ModeBoundary({
  mode,
  slug,
  owner,
  onPlain,
  children,
}: {
  mode: Mode;
  slug: string;
  owner: boolean;
  onPlain(): void;
  children: ReactNode;
}) {
  const [sub] = useQueryStates(SUB_MODE_PARAMS);
  /* The view this reader's band is showing, or nothing when the mode has no
     sub-modes or its parameter does not choose this reader's band. */
  const subMode =
    hasSubModes(mode) && (owner || SUB_MODE_SELECTS_A_BAND_FOR[mode] === "anyone") ? sub[mode] : "";
  return (
    <FeatureBoundary
      name={MODE_LABEL[mode]}
      slug={slug}
      target={owner ? bandTarget(mode, sub) : null}
      resetKey={`${slug}|${owner ? "owner" : "visitor"}|${subMode}`}
      onPlain={onPlain}
    >
      {children}
    </FeatureBoundary>
  );
}
