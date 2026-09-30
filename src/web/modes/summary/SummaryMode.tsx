/**
 * **Summary mode's controller.** The band, and the hook underneath it:
 * `?deep=`, `?summary=`, the summary tree, and the row the reader is standing
 * on.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established two days earlier: a mode's controller, its visitor twin and its
 * hook move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them.
 * See docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 *
 * **Two sub-modes since 2026-09-30**: Gists, the tree's own sentences, and
 * Simple, a few paragraphs in everyday words that a model writes on a press
 * (docs/plans/260930i-simple-summaries-eli15-sub-mode.md). Gists fetch nothing,
 * so for them owner and visitor are the same. Simple is an artefact, so it
 * brought the owner/visitor pair the other artefact modes have: the owner's
 * `OwnerSimple` mounts `useSimple` (a GET, a job, the press), and the
 * visitor's band hands the panel the stored paragraphs off the public payload
 * with no hook at all.
 */

import { useMemo } from "react";
import { useQueryState } from "nuqs";
import type { Article, BlockId } from "../../../types.js";
import type { PublicSimpleSummary } from "../../../public-types.js";
import { armActivation } from "../../activation.js";
import { currentAt, deepParam, SUMMARY_VIEWS, type SummaryView, summaryParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { buildSummaryTree } from "../../tree.js";
import { SimplePanel } from "../../SimplePanel.js";
import { SummaryPanel } from "../../SummaryPanel.js";
import { ControlTip, Tooltip, TooltipGroup } from "../../Tooltip.js";
import { useSimple } from "../../useSimple.js";

/**
 * The owner's Summary band.
 *
 * Gists are drawn from the tree the page already holds; Simple is `OwnerSimple`
 * below, mounted only while it is the sub-mode open, so its GET and its
 * `useAutoRun` owner exist exactly as long as the view does.
 *
 * See docs/project/summaries.md.
 */
export function SummaryBand({
  slug,
  article,
  onJump,
}: {
  slug: string;
  article: Article;
  onJump(id: BlockId): void;
}) {
  useRenderCount("SummaryBand");
  const [view, setView] = useQueryState("summary", summaryParam);
  return (
    <SummaryPanel
      /* Keyed on the sub-mode so the outline's scroller is a fresh element
         each time Gists comes back — `useFollow` attaches its wheel listener
         once per mount. */
      key={view}
      {...useSummaryMode(article)}
      onJump={onJump}
      subMode={<SummarySubModeToggle slug={slug} value={view} onChange={(next) => void setView(next)} />}
      simple={view === "simple" ? <OwnerSimple slug={slug} onJump={onJump} /> : null}
    />
  );
}

/** Simple's owner half: the read, the job and the press. */
function OwnerSimple({ slug, onJump }: { slug: string; onJump(id: BlockId): void }) {
  useRenderCount("OwnerSimple");
  const owner = useSimple(slug);
  return <SimplePanel access={{ kind: "owner", owner }} onJump={onJump} />;
}

/**
 * **The same band, for somebody who does not own the article.**
 *
 * Simple's paragraphs came in the page's own payload (`simpleSummary`), or
 * did not, which means nobody has made them. No `useSimple`, so no read of
 * `/api/simple/:slug`, no `useAutoRun` and no job, and the switch arms nothing
 * — nothing here can ask the model. A second band rather than a flag because a
 * hook cannot be called conditionally (src/web/reader-capability.ts).
 */
export function VisitorSummaryBand({
  article,
  simple,
  onJump,
}: {
  article: Article;
  simple: PublicSimpleSummary | undefined;
  onJump(id: BlockId): void;
}) {
  useRenderCount("VisitorSummaryBand");
  const [view, setView] = useQueryState("summary", summaryParam);
  return (
    <SummaryPanel
      key={view}
      {...useSummaryMode(article)}
      onJump={onJump}
      subMode={<SummarySubModeToggle slug={null} value={view} onChange={(next) => void setView(next)} />}
      simple={
        view === "simple" ? (
          <SimplePanel access={{ kind: "visitor", simple: simple ?? null }} onJump={onJump} />
        ) : null
      }
    />
  );
}

/** Each chip's card: what it is, then what a press would not have told you. */
const SUB_MODE: Record<SummaryView, { label: string; what: string; how: string }> = {
  gists: {
    label: "Gists",
    what: "One sentence for the whole article and for each of its parts and sections, as deep as you choose.",
    how: "Read from the outline built when the article was added; nothing is written for it.",
  },
  simple: {
    label: "Simple",
    what: "Explain it like I'm 15: what this is about, why it matters, and its key ideas, in a few short paragraphs of everyday words.",
    how: "One model pass over the article, written once and kept. Each paragraph links to the passages it rests on.",
  },
};

/**
 * **Gists | Simple.** A row like the Depth row beneath it, because it is the
 * same gesture: one of these is on, you press another, the band changes.
 *
 * @param slug the article, **only so a press can be recorded** — null for a
 *   visitor, whose press must arm nothing (there is no `useAutoRun` to claim
 *   it, and a token nobody claims is a spend still owed).
 */
export function SummarySubModeToggle({
  slug,
  value,
  onChange,
}: {
  slug: string | null;
  value: SummaryView;
  onChange(next: SummaryView): void;
}) {
  return (
    <fieldset className="summ-row summ-views">
      <legend className="summ-label">View</legend>
      {/* `keepSide` for the reason RefereeViews gives: the band sits at the
          right of the window and a card flung to the cross axis would land on
          the chips being read. */}
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {SUMMARY_VIEWS.map((view) => (
          <Tooltip
            key={view}
            placement="bottom"
            keepSide
            className="tip-soon"
            content={<ControlTip head={SUB_MODE[view].label} what={SUB_MODE[view].what} how={SUB_MODE[view].how} />}
          >
            <button
              type="button"
              className={`summ-pill${value === view ? " on" : ""}`}
              aria-pressed={value === view}
              onClick={() => {
                /* **The gesture seam for Simple.** Pressing it with nothing
                   stored writes it — Greg's rule about opening a mode, one level
                   down (src/web/activation.ts). Here, in the `onClick`, and not
                   in `onChange`: `?summary=` is query state, so Back, Forward, a
                   pasted link and a last-view restore move it too, and none of
                   them may buy a model call.

                   **Armed before the `value === view` check**, so pressing
                   Simple while already in Simple mints a fresh press — the only
                   way back from a failed read, as QuizPanel.tsx §
                   `RememberSubModeToggle` has it. */
                if (view === "simple" && slug !== null) armActivation(slug, "simple");
                if (value !== view) onChange(view);
              }}
            >
              {SUB_MODE[view].label}
            </button>
          </Tooltip>
        ))}
      </TooltipGroup>
    </fieldset>
  );
}

/**
 * Everything the gists outline does that is not rendering.
 *
 * `?deep=` lives here for the reason it used to live in the band: it is
 * meaningless outside summary mode, and reading it in `Reader` would put a
 * parameter subscription on every render of the reading view for a value only
 * this mode uses.
 */
function useSummaryMode(article: Article) {
  const [deep, setDeep] = useQueryState("deep", deepParam);

  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks),
    [article.tree, article.blocks],
  );

  /* Read, never written, and not a subscription — see `currentAt` in
     params.ts.

     Turned into a row index here rather than passed down as an id, because the
     panel's question is "is the reader inside this range", and a range is a
     pair of row indices — comparing ids would be comparing random strings for
     order, which is the one thing block-ids.md forbids. */
  const at = currentAt();
  const atRow = useMemo(() => {
    if (at === null) return null;
    const i = article.blocks.findIndex((b) => b.id === at);
    return i === -1 ? null : i;
  }, [at, article.blocks]);

  return { root, deep, onDeep: (next: number) => void setDeep(next), atRow };
}
