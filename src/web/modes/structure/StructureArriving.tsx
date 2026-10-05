/**
 * **The line at the top of the Structure band while the real structure is on
 * its way.**
 *
 * A first import opens the article before its structure is built: the band
 * draws a stand-in outline cut from the headings, and a queued job replaces it
 * live a few seconds later (src/web/article/useLateStructure.ts). Until then
 * the rows are not the structure the reader will end up with, and this says so
 * above them, in every presentation — columns, list and Expanded.
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md
 * § Stage 2.
 *
 * ## One component for owner and visitor, and one thing only an owner has
 *
 * The Structure band is the same component on both footings
 * (StructureMode.tsx § Owner and visitor get the same component), and **Build
 * it** starts a paid job. So nothing here subscribes to the job engine or
 * knows how to start one: the press is `build`, handed in from the owned side
 * (ArticlePage.tsx § `OwnedReader`), and a visitor's is `null` — a different
 * member of the union, not a flag to remember to test. GPT Sol's plan review,
 * F10; the same seam as reader-capability.ts.
 *
 * ## Not the final fallback
 *
 * `tree.provisional === "headings"` is a tree nothing is coming to replace
 * (src/types.ts § `Tree.provisional`). This component says nothing about it;
 * that line, with its own *Try again*, is another piece of work.
 */
import {
  STRUCTURE_ARRIVING,
  STRUCTURE_BUILD,
  STRUCTURE_CHECK_FAILED,
  STRUCTURE_READY_RELOAD,
  STRUCTURE_STALLED,
} from "../../../messages.js";
import { awaitingStructure, type Tree } from "../../../types.js";

/** An owner's way to start the structure job again. */
export interface StructureBuild {
  press(): void;
  /** The request has gone and the queue has not shown the job yet. */
  starting: boolean;
  /** Why the last press was refused, in the server's words, or null. */
  failed: string | null;
}

/**
 * What the band has to say. There is no member for *the structure is in*: that
 * is `null` at the call site, and nothing is drawn.
 */
export type StructureArrival =
  | { state: "building" }
  /** `build` is null for a visitor, who can start nothing. */
  | { state: "stalled"; build: StructureBuild | null }
  | { state: "unread"; retry(): void }
  | { state: "mismatch" };

/**
 * **What a visitor is told**, from the payload alone: the line while the tree
 * is the stand-in, and nothing otherwise.
 *
 * A visitor has no job list to consult, so the line says only that the full
 * structure is unavailable. Their next load reads the latest tree.
 */
export function visitorArrival(tree: Pick<Tree, "provisional">): StructureArrival | null {
  return awaitingStructure(tree) ? STRUCTURE_BUILDING : null;
}

/** One object, so a caller that builds this on every render hands down one identity. */
export const STRUCTURE_BUILDING: StructureArrival = { state: "building" };

/** The fixed sentence for a state — the app's own words (src/messages.ts). */
function sentence(arrival: StructureArrival): string {
  switch (arrival.state) {
    case "building":
      return STRUCTURE_ARRIVING;
    case "stalled":
      return STRUCTURE_STALLED;
    case "mismatch":
      return STRUCTURE_READY_RELOAD;
    case "unread":
      return STRUCTURE_CHECK_FAILED;
    default: {
      const unreachable: never = arrival;
      throw new Error(`Unknown structure arrival: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function StructureArriving({ arrival }: { arrival: StructureArrival }) {
  const build = arrival.state === "stalled" ? arrival.build : null;
  return (
    /* `role="status"`: the sentence changes under a reader who did nothing,
       and that is news. Polite,
       so it never interrupts the prose being read aloud. */
    <div className="struct-arriving-note" role="status">
      <p className="struct-empty struct-arriving">{sentence(arrival)}</p>
      {build ? (
        <button
          type="button"
          /* The band's own chip (structure-mode.css § `.struct-view-btn`),
             rather than a fourth button look in one head row. */
          className="struct-view-btn struct-arriving-build"
          disabled={build.starting}
          onClick={build.press}
        >
          {STRUCTURE_BUILD}
        </button>
      ) : null}
      {arrival.state === "unread" ? (
        <button type="button" className="struct-view-btn" onClick={arrival.retry}>
          Try again
        </button>
      ) : null}
      {/* The server's own sentence for a refused press — a quota, usually. It
          is the app's voice like the line above it: nothing a model wrote. */}
      {build?.failed ? <p className="struct-empty struct-arriving-failed">{build.failed}</p> : null}
    </div>
  );
}
