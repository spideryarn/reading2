/**
 * **The headings breadcrumb** — one line in the controls bar saying where in
 * the article's structure the reader is: part › section. For a reader with
 * Experimental features on; Reader.tsx decides when it is drawn.
 *
 * > I sometimes feel as though I lose track of where I am. The structure mode
 * > helps a lot, but then I have to have it open.
 * >
 * > — Greg, 2026-09-29 (spya-m3pteb)
 *
 * **Where the reader is comes from `useColumnContext`**, Structure's own "you
 * are here": the same sampler, the same 40% focus line and the same fold rule,
 * so this bar and an open Structure band cannot name different sections. The
 * path is crumbs.ts, over the tree Structure draws.
 *
 * **A `nav` with an ordered list, and no live region.** The last crumb is
 * `aria-current="location"`; announcing every section boundary as the page
 * scrolls would talk over the article.
 *
 * docs/plans/261002h-headings-breadcrumb-at-the-top-of-the-reading-view.md
 */
import { useMemo } from "react";
import type { BlockId } from "../types.js";
import { crumbPath, type Crumb } from "./crumbs.js";
import type { Section } from "./position.js";
import type { SummaryNode } from "./tree.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { useColumnContext } from "./useColumnContext.js";
import { voiceClass, withVoice } from "./voice.js";

export function HeadingsCrumbs({
  root,
  sections,
  layoutKey,
  onJump,
}: {
  /** The tree, cut at the section depth — Reader.tsx § `crumbsRoot`. */
  root: SummaryNode | null;
  sections: Section[];
  layoutKey: string;
  onJump: (blockId: BlockId) => void;
}) {
  /* **A second sampler while Structure is open, and that is deliberate.**
     Structure owns its hooks (Reader.tsx § the `structure` arm, which says why
     its sampler left Reader on 2026-09-10); sharing one would put it back up
     there and thread a `focusRow` through the band, to save one rect scan for
     the few readers with the switch on and Structure open. GPT Sol's plan
     review of 261002h asked for the share; this is why not. The two cannot
     disagree in practice: the
     same function, the same focus line, rAF-scheduled off the same scroll
     event, reading rects with no writes between. */
  const { focusRow } = useColumnContext({ sections, enabled: true, layoutKey });
  const path = useMemo(() => crumbPath(root, focusRow), [root, focusRow]);

  return (
    <nav className="crumbs" aria-label="Where you are">
      {/* Structure's delays, so the two kinds of card open alike. */}
      <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
        <ol>
          {path.map((crumb, i) => (
            <li key={crumb.id}>
              <Tooltip
                placement="bottom"
                className="tip-struct"
                content={<CrumbCard crumb={crumb} />}
              >
                <button
                  type="button"
                  {...(i === path.length - 1 ? { "aria-current": "location" as const } : {})}
                  onClick={() => onJump(crumb.blockId)}
                >
                  {crumb.number ? <span className="crumb-num">{crumb.number}</span> : null}
                  <span className={withVoice("crumb-text", crumb.voice)}>{crumb.text}</span>
                </button>
              </Tooltip>
            </li>
          ))}
        </ol>
      </TooltipGroup>
    </nav>
  );
}

/** The card: what Structure's row card says, less the children list. */
function CrumbCard({ crumb }: { crumb: Crumb }) {
  return (
    <>
      <div className="tip-title">
        {crumb.number ? <span className="tip-num">{crumb.number}</span> : null}
        <span className={voiceClass(crumb.voice)}>{crumb.text}</span>
      </div>
      {crumb.gist ? <p className="tip-gist">{crumb.gist}</p> : null}
    </>
  );
}
