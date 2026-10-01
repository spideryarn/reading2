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
 * **One row of controls since 2026-10-01**: the outline (the tree's gists, at
 * Parts or Sections), and a slider over three plain-words levels — Brief,
 * Simple, Fuller — that a model writes on a press
 * (docs/plans/260930i-simple-summaries-eli15-sub-mode.md,
 * docs/plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md).
 *
 * ```
 *  [ Parts | Sections ]   ○──●──○ Simple   ⓤ
 * ```
 *
 * The outline fetches nothing, so for it owner and visitor are the same. The
 * plain-words levels are one artefact, so they brought the owner/visitor pair
 * the other artefact modes have: the owner's `OwnerSimple` mounts `useSimple`
 * (a GET, a job, the press) and supplies the badge, and the visitor's band
 * hands the panel the stored paragraphs off the public payload with no hook at
 * all.
 */

import type { ReactNode } from "react";
import { useMemo, useRef } from "react";
import { useQueryState, useQueryStates } from "nuqs";
import type { Article, BlockId, SimpleLevel } from "../../../types.js";
import { SIMPLE_LEVELS } from "../../../types.js";
import type { PublicSimpleSummary } from "../../../public-types.js";
import { armActivation } from "../../activation.js";
import { currentAt, deepParam, isPlainLevel, type SummaryView, summaryParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { buildSummaryTree } from "../../tree.js";
import { SimplePanel } from "../../SimplePanel.js";
import { SummaryPanel } from "../../SummaryPanel.js";
import { ControlTip, Tooltip } from "../../Tooltip.js";
import { useSimple } from "../../useSimple.js";
import { WrittenForYou } from "../../WrittenForYou.js";

/**
 * The owner's Summary band.
 *
 * The outline is drawn from the tree the page already holds; a plain-words
 * level is `OwnerSimple` below, mounted only while one is open, so its GET and
 * its `useAutoRun` owner exist exactly as long as the view does — and stay
 * mounted across a switch between the three levels, which share one artefact.
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
  const { view, setView, onDeep } = useSummaryView();
  const mode = useSummaryMode(article);
  const panel = (plain: ReactNode, badge: ReactNode) => (
    <SummaryPanel
      {...mode}
      onDeep={onDeep}
      onJump={onJump}
      subMode={<SummaryControls slug={slug} value={view} onChange={setView} badge={badge} />}
      simple={plain}
    />
  );
  return isPlainLevel(view) ? (
    <OwnerSimple slug={slug} level={view} onJump={onJump} render={panel} />
  ) : (
    panel(null, null)
  );
}

/**
 * The plain-words levels' owner half: the read, the job and the press — and
 * the *written for you* badge, which belongs in the row above the panel and
 * needs this hook's answer, so the band hands a `render` in rather than the
 * row reaching down.
 */
function OwnerSimple({
  slug,
  level,
  onJump,
  render,
}: {
  slug: string;
  level: SimpleLevel;
  onJump(id: BlockId): void;
  render(plain: ReactNode, badge: ReactNode): ReactNode;
}) {
  useRenderCount("OwnerSimple");
  const owner = useSimple(slug);
  /* Provenance, not a warning — GlossaryPanel.tsx's reasoning. Owner-only:
     `profileHash` never reaches a visitor. */
  const badge =
    owner.simple && owner.profiled ? (
      <WrittenForYou written changed={owner.profileChanged} slug={slug} compact />
    ) : null;
  return <>{render(<SimplePanel access={{ kind: "owner", owner }} level={level} onJump={onJump} />, badge)}</>;
}

/**
 * **The same band, for somebody who does not own the article.**
 *
 * The paragraphs came in the page's own payload (`simpleSummary`), or did
 * not, which means nobody has made them. No `useSimple`, so no read of
 * `/api/simple/:slug`, no `useAutoRun` and no job, and the pills arm nothing
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
  const { view, setView, onDeep } = useSummaryView();
  return (
    <SummaryPanel
      /* Keyed on outline-or-not so the outline's scroller is a fresh element
         each time it comes back — `useFollow` attaches its wheel listener once
         per mount. The owner's band gets the same from `OwnerSimple`'s mount. */
      key={isPlainLevel(view) ? "plain" : "outline"}
      {...useSummaryMode(article)}
      onDeep={onDeep}
      onJump={onJump}
      subMode={<SummaryControls slug={null} value={view} onChange={setView} badge={null} />}
      simple={
        isPlainLevel(view) ? (
          <SimplePanel access={{ kind: "visitor", simple: simple ?? null }} level={view} onJump={onJump} />
        ) : null
      }
    />
  );
}

/**
 * `?summary=` and `?deep=`, and the one verb that writes both: pressing Parts
 * or Sections under a plain-words level goes back to the outline *at* that
 * depth, in one history entry, so one Back undoes one press.
 */
function useSummaryView() {
  const [view, setView] = useQueryState("summary", summaryParam);
  const [, setOutline] = useQueryStates({
    summary: summaryParam,
    deep: deepParam,
  });
  return {
    view,
    setView: (next: SummaryView) => void setView(next),
    onDeep: (deep: number) => void setOutline({ summary: "gists", deep }),
  };
}

/**
 * Each level's name and what it is. Short, very simple, just under, just over
 * — Greg's words for the three stops (SPIDERYARN-READING2-7J).
 */
const PLAIN: Record<SimpleLevel, { label: string; what: string }> = {
  brief: {
    label: "Brief",
    what: "Short and very simple: what it is about, why it matters, and a key idea or two.",
  },
  simple: {
    label: "Simple",
    what: "Fairly simple: what it is about, why it matters and its key ideas, in a few short paragraphs of everyday words.",
  },
  fuller: {
    label: "Fuller",
    what: "Moderately complex: a little longer, keeping more of the piece's own terms, still in plain words.",
  },
};

/**
 * What the foot under the paragraphs used to say, now said where it is asked
 * for (Greg, SPIDERYARN-READING2-7B; docs/project/new-mode.md).
 */
const PLAIN_HOW =
  "Written by AI once, at all three levels, and kept. Each paragraph links to the passages it rests on — the article says it better.";

/**
 * **The plain-words slider, and the badge** — the right half of Summary's one
 * row (SummaryPanel.tsx draws the Parts | Sections half beside it). Greg,
 * 2026-09-30 (SPIDERYARN-READING2-7J): *"let's provide a UI-slider with 3
 * level"*. A slider rather than three pills because the three are one scale —
 * shorter and plainer to the left, longer and fuller to the right — and a
 * slider is the control that says so.
 *
 * ```
 *  [ Parts | Sections ]   ○──●──○ Simple   ⓤ
 * ```
 *
 * **Idle while the outline shows**: drawn faint, sitting on Simple (or where
 * the reader left it), and touching it — a click, a drag or an arrow key —
 * opens that level. The native `<input type="range">`, so the keyboard and a
 * screen reader get a real slider (`aria-valuetext` names the level).
 *
 * @param slug the article, **only so a press can be recorded** — null for a
 *   visitor, whose press must arm nothing (there is no `useAutoRun` to claim
 *   it, and a token nobody claims is a spend still owed).
 */
export function SummaryControls({
  slug,
  value,
  onChange,
  badge,
}: {
  slug: string | null;
  value: SummaryView;
  onChange(next: SummaryView): void;
  /** The owner's *written for you* badge, or null. */
  badge?: ReactNode;
}) {
  const on = isPlainLevel(value);
  const level: SimpleLevel = on ? value : "simple";

  /* **The gesture seam.** Choosing a level with nothing stored writes all
     three — Greg's rule about opening a mode, one level down
     (src/web/activation.ts). Here, on the slider's own input events, and not
     in `onChange` of the query state: `?summary=` moves on Back, Forward, a
     pasted link and a last-view restore too, and none of them may buy a model
     call. Every level arms the one `simple` step, which writes them all.

     **Armed before the "already there" check**, so touching the level already
     open mints a fresh press — the only way back from a failed read, as
     QuizPanel.tsx § `RememberSubModeToggle` has it. A pointer gesture emits
     input events and then a click; it arms once on pointer-up and suppresses
     that trailing click, while keyboard and assistive clicks arm here. */
  const choose = (next: SimpleLevel) => {
    if (slug !== null) armActivation(slug, "simple");
    if (value !== next) onChange(next);
  };
  const at = (input: HTMLInputElement): SimpleLevel => SIMPLE_LEVELS[Number(input.value)] ?? "simple";
  const pointerActive = useRef(false);
  const pointerChanged = useRef(false);
  const suppressClick = useRef(false);

  return (
    <>
      <fieldset className={`summ-seg summ-slider${on ? " on" : ""}`}>
        <legend className="sr-only">In plain words</legend>
        {/* `keepSide` for the reason RefereeViews gives: the band sits at the
            right of the window and a card flung to the cross axis would land on
            the controls being read. */}
        <Tooltip
          placement="bottom"
          keepSide
          className="tip-soon"
          content={
            <ControlTip
              head="In plain words"
              what={SIMPLE_LEVELS.map((l) => `${PLAIN[l].label} — ${PLAIN[l].what}`).join(" ")}
              how={PLAIN_HOW}
            />
          }
        >
          <label className="summ-slider-track">
            <input
              type="range"
              min={0}
              max={SIMPLE_LEVELS.length - 1}
              step={1}
              value={SIMPLE_LEVELS.indexOf(level)}
              aria-label="In plain words: how simple"
              aria-valuetext={`${PLAIN[level].label}${on ? "" : " (not showing)"}`}
              onPointerDown={() => {
                pointerActive.current = true;
                pointerChanged.current = false;
                suppressClick.current = false;
              }}
              onPointerUp={(e) => {
                pointerActive.current = false;
                suppressClick.current = true;
                if (slug !== null) armActivation(slug, "simple");
                /* Clicking the resting thumb emits no input event, but still
                   opens that level (or retries one already open). */
                if (!pointerChanged.current && value !== at(e.currentTarget)) onChange(at(e.currentTarget));
              }}
              onPointerCancel={() => {
                pointerActive.current = false;
                pointerChanged.current = false;
              }}
              onChange={(e) => {
                const next = at(e.currentTarget);
                if (pointerActive.current) {
                  pointerChanged.current = true;
                  if (value !== next) onChange(next);
                } else {
                  choose(next);
                }
              }}
              /* A click on the thumb where it already sits changes nothing, so
                 `change` never fires; this is how the idle slider opens the
                 level it is resting on. */
              onClick={(e) => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  pointerChanged.current = false;
                  return;
                }
                choose(at(e.currentTarget));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  choose(at(e.currentTarget));
                }
              }}
            />
            <span className="summ-slider-name" aria-hidden="true">
              {PLAIN[level].label}
            </span>
          </label>
        </Tooltip>
      </fieldset>
      {badge ? <span className="summ-badge">{badge}</span> : null}
    </>
  );
}

/**
 * Everything the gists outline does that is not rendering.
 *
 * `?deep=` lives here for the reason it used to live in the band: it is
 * meaningless outside summary mode, and reading it in `Reader` would put a
 * parameter subscription on every render of the reading view for a value only
 * this mode uses. Its writer is `useSummaryView`'s `onDeep`, which also leaves
 * a plain-words level.
 */
function useSummaryMode(article: Article) {
  const [deep] = useQueryState("deep", deepParam);

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

  return { root, deep, atRow };
}
