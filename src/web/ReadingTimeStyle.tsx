/**
 * **The gutter's reading-time hairlines**, as one style element — the rules
 * `gutterCss` writes, and gutter.css § reading time is what they drive.
 *
 * A component of its own, and `memo`ised on the level map, so that a block
 * crossing a step re-renders this and nothing in the table: `TableView` never
 * sees reading time at all. reading-time.ts § `gutterCss` has the argument.
 */
import { memo, useMemo } from "react";
import type { BlockId } from "../types.js";
import { gutterCss, type ReadLevel } from "./reading-time.js";

function ReadingTimeStyleInner({ levels }: { levels: ReadonlyMap<BlockId, ReadLevel> }) {
  const css = useMemo(() => gutterCss(levels), [levels]);
  return css ? <style data-reading-time="">{css}</style> : null;
}

export const ReadingTimeStyle = memo(ReadingTimeStyleInner);
