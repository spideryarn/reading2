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
 * Quotes cannot follow the reader into Timeline. Within an owner's mode, the
 * sub-mode a band is showing — Diagram's picture, Referee's view, Remember's
 * half — goes in `resetKey`, which is `FeatureBoundary`'s documented extension
 * point for it: Back from broken Claims to Criteria is a different band and
 * gets a fresh start. Visitors omit it because those parameters do not select
 * their band: Diagram is pinned to Sketch and the other two show `VisitorBand`.
 *
 * ## And the press it retires is the press it would have claimed
 *
 * `bandTarget` (activation.ts) answers from the same tables the presses arm
 * from. It needs the sub-mode for the three bands whose chips arm something, so
 * this component reads those three parameters itself. That keeps them off
 * `Reader`'s own render, which the bands that own them each avoided for the
 * same reason (RememberBand, DiagramBand).
 */
import { useQueryStates } from "nuqs";
import type { ReactNode } from "react";
import { MODE_LABEL } from "../../title-text.js";
import { bandTarget } from "../activation.js";
import { FeatureBoundary } from "../FeatureBoundary.js";
import { diagramParam, type Mode, refereeParam, rememberParam } from "../params.js";

/**
 * **Whether each mode's band is inside a boundary, decided rather than fallen
 * into.** A `Record`, so a new mode is a compile error here until somebody has
 * said which — the `MODE_TARGET` idiom (activation.ts) for the containment
 * question. tests/a-broken-mode-leaves-the-article-readable.test.tsx derives its
 * completeness check from `MODES`, pins the exemptions by name, and throws inside
 * every `contained` band to show the fallback is really there.
 *
 * **Two exemptions, and both are the article.** Neither has a band: Plain is the
 * prose alone and Hierarchy is the gist columns of the table the prose is in. A
 * boundary around either would have to take the article with it, which is the
 * one thing this exists to prevent — so a throw there stays `AppBoundary`'s.
 */
export type Containment = { kind: "contained" } | { kind: "exempt"; reason: string };

const BAND: Containment = { kind: "contained" };

export const MODE_CONTAINMENT: Record<Mode, Containment> = {
  plain: { kind: "exempt", reason: "no band: the prose alone, which is what a fallback protects" },
  hierarchy: {
    kind: "exempt",
    reason: "no band: the gist columns are the article's own table, not a band beside it",
  },
  chat: BAND,
  glossary: BAND,
  search: BAND,
  referee: BAND,
  summary: BAND,
  diagram: BAND,
  ideas: BAND,
  remember: BAND,
  quotes: BAND,
  timeline: BAND,
  debate: BAND,
  structure: BAND,
};

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
  const [sub] = useQueryStates({
    diagram: diagramParam,
    referee: refereeParam,
    remember: rememberParam,
  });
  /* Only an owner's band is selected by these parameters. A Diagram visitor
     is pinned to Sketch, and Referee/Remember visitors see `VisitorBand`, so an
     address change there is not a new band and must not retry a broken one. */
  const subMode = owner
    ? mode === "diagram"
      ? sub.diagram
      : mode === "referee"
        ? sub.referee
        : mode === "remember"
          ? sub.remember
          : ""
    : "";
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
