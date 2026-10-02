/**
 * **Summary mode's controller.** The band, its owner/visitor pair, and the
 * plain-words slider.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established two days earlier: a mode's controller, its visitor twin and its
 * hook move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them.
 * See docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 *
 * **The piece in plain words, and nothing else, since 2026-10-01.** One row of
 * controls — a slider over three levels, Brief, Simple and Fuller, that a model
 * writes on a press — and the chosen level's paragraphs under it
 * (docs/plans/260930i-simple-summaries-eli15-sub-mode.md,
 * docs/plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md).
 *
 * ```
 *  ▤ ○──●──○ ▤▤   ⓤ
 *  the paragraphs, each with the passages it rests on
 * ```
 *
 * It also drew the tree's gists as an outline, at Parts or Sections, until
 * Greg took that out the same day: *"We already have the structure mode, and
 * so I think that probably overlaps with the summary parts and sections, and
 * so let's just get rid of parts and sections"* (spya-b3ggv4,
 * docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md).
 *
 * The plain-words levels are one artefact, so they bring the owner/visitor pair
 * the other artefact modes have: the owner's `OwnerSimple` mounts `useSimple`
 * (a GET, a job, the press) and supplies the badge, and the visitor's band
 * hands the panel the stored paragraphs off the public payload with no hook at
 * all.
 */

import type { ReactNode } from "react";
import { useRef } from "react";
import { useQueryState } from "nuqs";
import { TextAlignJustify, TextAlignStart } from "lucide-react";
import type { BlockId, SimpleLevel } from "../../../types.js";
import { SIMPLE_LEVELS } from "../../../types.js";
import type { PublicSimpleSummary } from "../../../public-types.js";
import { armActivation } from "../../activation.js";
import { SUMMARY_SUB_MODES } from "../../sub-modes.js";
import { summaryParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { AboutMade } from "../../BandAbout.js";
import { ModeSurface } from "../../ModeSurface.js";
import { SimplePanel } from "../../SimplePanel.js";
import { ControlTip, TipNote, Tooltip } from "../../Tooltip.js";
import { useSimple } from "../../useSimple.js";
import { WrittenForYou } from "../../WrittenForYou.js";

/**
 * The owner's Summary band: `OwnerSimple` below, so its GET and its
 * `useAutoRun` owner exist exactly as long as the band does — and stay mounted
 * across a move between the three levels, which share one artefact.
 *
 * See docs/project/summaries.md.
 */
export function SummaryBand({ slug, onJump }: { slug: string; onJump(id: BlockId): void }) {
  useRenderCount("SummaryBand");
  const [level, setLevel] = useQueryState("summary", summaryParam);
  return (
    <OwnerSimple
      slug={slug}
      level={level}
      onJump={onJump}
      render={(body, badge, about) => (
        <SummarySurface
          controls={<SummaryControls slug={slug} value={level} onChange={(next) => void setLevel(next)} badge={badge} />}
          about={about}
        >
          {body}
        </SummarySurface>
      )}
    />
  );
}

/**
 * The plain-words levels' owner half: the read, the job and the press — and
 * the *written for you* badge, which belongs in the row above the paragraphs
 * and needs this hook's answer, so the band hands a `render` in rather than
 * the row reaching down.
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
  render(body: ReactNode, badge: ReactNode, about: ReactNode): ReactNode;
}) {
  useRenderCount("OwnerSimple");
  const owner = useSimple(slug);
  /* Provenance, not a warning — GlossaryPanel.tsx's reasoning. Owner-only:
     `profileHash` never reaches a visitor. Its panel's Regenerate is the
     forced run, which replaces the paragraphs (plan 261002b). */
  const badge =
    owner.simple && owner.profiled ? (
      <WrittenForYou
        written
        changed={owner.profileChanged}
        slug={slug}
        compact
        regenerate={{
          run: () => void owner.regenerate(),
          busy: owner.job !== null || owner.starting,
          refresh: () => void owner.refresh(),
        }}
      />
    ) : null;
  /* Who wrote the paragraphs, for the band's (i) — owner only, since a
     visitor's artefact carries no provenance (src/public-types.ts). Only once
     they are showing, so the card never dates a list still loading. */
  const made = owner.status === "ready" ? owner.simple : null;
  const about = made ? (
    <AboutMade
      generator={made.generator}
      version={made.version}
      generatedAt={made.generatedAt}
      elapsedMs={made.elapsedMs}
    />
  ) : null;
  return <>{render(<SimplePanel access={{ kind: "owner", owner }} level={level} onJump={onJump} />, badge, about)}</>;
}

/**
 * **The same band, for somebody who does not own the article.**
 *
 * The paragraphs came in the page's own payload (`simpleSummary`), or did
 * not, which means nobody has made them. No `useSimple`, so no read of
 * `/api/simple/:slug`, no `useAutoRun` and no job, and the slider arms nothing
 * — nothing here can ask the model. A second band rather than a flag because a
 * hook cannot be called conditionally (src/web/reader-capability.ts).
 */
export function VisitorSummaryBand({
  simple,
  onJump,
}: {
  simple: PublicSimpleSummary | undefined;
  onJump(id: BlockId): void;
}) {
  useRenderCount("VisitorSummaryBand");
  const [level, setLevel] = useQueryState("summary", summaryParam);
  return (
    <SummarySurface
      controls={<SummaryControls slug={null} value={level} onChange={(next) => void setLevel(next)} badge={null} />}
    >
      <SimplePanel access={{ kind: "visitor", simple: simple ?? null }} level={level} onJump={onJump} />
    </SummarySurface>
  );
}

/**
 * The band itself, the same for owner and visitor: the surface, the one row of
 * controls, and the paragraphs under it.
 */
function SummarySurface({
  controls,
  about = null,
  children,
}: {
  controls: ReactNode;
  /**
   * What the band's (i) adds after the mode's own words (ModeSurface.tsx §
   * `about`): for the owner, who wrote the paragraphs and when.
   */
  about?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ModeSurface label="Summary" feature="summ" mode="summary" about={about}>
      {/* **No `head`, so there is no title row at all.** It said the mode's own
          name, which the Dock at the foot of the page is already saying — Greg,
          2026-09-05: *"I think we can rely on the bottom bar to tell us what
          mode we're in, so for example 'Summary' mode doesn't need to say
          `Summary` at the top, nor o any other modes."* Nothing else was in the
          row, so the row went with it and the band starts at its content. The
          surface's `label` above is what names the region, and always was — the
          `<h2>` was never carrying that.
          docs/plans/260905d-declutter-the-reading-view-top-bars.md § Stage 5. */}

      {/* **One row** — Greg, 2026-09-30: *"the main thing I'm trying to do is
          avoid wasting vertical space"* (SPIDERYARN-READING2-7A). The slider
          and the badge, and no labels: the group is named for a screen reader
          by its hidden legend, and the slider's card says what each level is. */}
      <div className="summ-controls">{controls}</div>
      {children}
    </ModeSurface>
  );
}

/**
 * Each level's name and what it is. Short, very simple, just under, just over
 * — Greg's words for the three stops (SPIDERYARN-READING2-7J).
 */
const PLAIN: Record<SimpleLevel, { label: string; what: string }> = {
  brief: {
    label: SUMMARY_SUB_MODES.brief.label,
    what: "Short and very simple: what it is about, why it matters, and a key idea or two.",
  },
  simple: {
    label: SUMMARY_SUB_MODES.simple.label,
    what: "Fairly simple: what it is about, why it matters and its key ideas, in a few short paragraphs of everyday words.",
  },
  fuller: {
    label: SUMMARY_SUB_MODES.fuller.label,
    what: "Moderately complex: a little longer, keeping more of the piece's own terms, still in plain words.",
  },
};

/**
 * What the foot under the paragraphs used to say, now said where it is asked
 * for (Greg, SPIDERYARN-READING2-7B; docs/project/mode.md).
 */
const PLAIN_HOW =
  "Written by AI once, at all three levels, and kept. Each paragraph links to the passages it rests on — the article says it better.";

/**
 * **The plain-words slider, and the badge** — Summary's one row. Greg,
 * 2026-09-30 (SPIDERYARN-READING2-7J): *"let's provide a UI-slider with 3
 * level"*. A slider rather than three pills because the three are one scale —
 * shorter and plainer to the left, longer and fuller to the right — and a
 * slider is the control that says so.
 *
 * ```
 *  ▤ ○──●──○ ▤▤   ⓤ
 * ```
 *
 * **Always live.** It was drawn faint while Summary's outline showed, resting
 * on a level rather than showing one; the outline went on 2026-10-01, so there
 * is nothing else for the band to be showing. The native
 * `<input type="range">`, so the keyboard and a screen reader get a real
 * slider (`aria-valuetext` names the level).
 *
 * **No level name beside it** — Greg, 2026-10-01: *"get rid of the "Simple"
 * text - perhaps replace with an icon or similar"* (SPIDERYARN-READING2-7R).
 * A small icon sits at each end instead: short lines at the Brief end, a full
 * block of text at the Fuller end. Each is a shortcut to that end's
 * level, through the same `choose` as the slider, so it arms exactly as the
 * slider does. They are real buttons, with names and cards of their own, so a
 * keyboard or screen reader gets the same shortcuts as a pointer. The slider's
 * card names all three levels and which one is showing.
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
  value: SimpleLevel;
  onChange(next: SimpleLevel): void;
  /** The owner's *written for you* badge, or null. */
  badge?: ReactNode;
}) {
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
  const shortest: SimpleLevel = "brief";
  const longest: SimpleLevel = "fuller";

  return (
    <>
      <fieldset className="summ-seg summ-slider">
        <legend className="sr-only">In plain words</legend>
        <Tooltip content={<TipNote>Show Brief summary</TipNote>} placement="bottom" keepSide>
          <button
            type="button"
            className="summ-slider-end"
            aria-label="Show Brief summary"
            onClick={() => choose(shortest)}
          >
            <TextAlignStart size={14} aria-hidden="true" />
          </button>
        </Tooltip>
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
              state={`Showing ${PLAIN[value].label}.`}
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
              value={SIMPLE_LEVELS.indexOf(value)}
              aria-label="In plain words: how long and how simple"
              aria-valuetext={PLAIN[value].label}
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
                 `change` never fires; this is how a press on the level already
                 showing still arms it — the retry after a failed read. */
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
          </label>
        </Tooltip>
        <Tooltip content={<TipNote>Show Fuller summary</TipNote>} placement="bottom" keepSide>
          <button
            type="button"
            className="summ-slider-end"
            aria-label="Show Fuller summary"
            onClick={() => choose(longest)}
          >
            <TextAlignJustify size={14} aria-hidden="true" />
          </button>
        </Tooltip>
      </fieldset>
      {badge ? <span className="summ-badge">{badge}</span> : null}
    </>
  );
}
