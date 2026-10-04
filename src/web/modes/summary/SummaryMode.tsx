/**
 * **Summary mode's controller.** The band, its owner/visitor pair, and the
 * three-way control over its views.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established two days earlier: a mode's controller, its visitor twin and its
 * hook move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them.
 * See docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 *
 * **The piece restated, three ways, since 2026-10-03**: in plain words at two
 * lengths, or as a numbered thread. One row of controls — Brief | Fuller |
 * Thread — and the chosen view under it. Greg (spya-thpsnd):
 *
 * > I was thinking about putting the tweet thread as a submode of summary,
 * > because they kind of serve related purposes. … I quite like the shortest
 * > and the longest, so what is that, briefer and fuller. So it could just be
 * > briefer, fuller, and tweet thread as three buttons somehow. Not buttons,
 * > like group buttons. Not radio buttons exactly, but like, you know, a sense
 * > that you can have one of those three. … keep all of the tweet thread.
 * > Functionality and UI, just put it within as a submode within summary.
 *
 * ```
 *  [ Brief | Fuller | Thread ]
 *  the paragraphs, each with the passages it rests on — or the thread
 * ```
 *
 * docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md.
 * Before that it was a slider over three plain-words levels
 * (docs/plans/260930i-simple-summaries-eli15-sub-mode.md,
 * docs/plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md);
 * the middle one, Simple, is still written and stored and is not shown. And
 * before 2026-10-01 it also drew the tree's gists as an outline, which Greg
 * took out: *"We already have the structure mode, and so I think that probably
 * overlaps with the summary parts and sections, and so let's just get rid of
 * parts and sections"* (spya-b3ggv4,
 * docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md).
 *
 * **Two artefacts, so two owner halves.** The plain-words lengths are one
 * artefact: the owner's `OwnerSimple` mounts `useSimple` (a GET, a job, the
 * press) and supplies the badge. The thread is another, and its band is the
 * one it had as a mode — `TweetsBand` (src/web/modes/summary/TweetsMode.tsx),
 * with `useTweets` and its write-on-arrival — handed this file's control row
 * to draw above itself. Each mounts only while its view is showing, so each
 * hook's `useAutoRun` owner lives exactly as long as what it would fill. The
 * visitor's band takes both off the public payload with no hook at all.
 */

import type { ReactNode } from "react";
import { useQueryState } from "nuqs";
import type { Article, BlockId } from "../../../types.js";
import type { PublicSimpleSummary, PublicTweets } from "../../../public-types.js";
import { activationForSummary, armActivation } from "../../activation.js";
import { SUMMARY_SUB_MODES } from "../../sub-modes.js";
import { SUMMARY_VIEWS, type SummaryView, summaryParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { AboutMade } from "../../BandAbout.js";
import { ModeSurface } from "../../ModeSurface.js";
import { SimplePanel } from "../../SimplePanel.js";
import { ControlTip, Tooltip, TooltipGroup } from "../../Tooltip.js";
import { useSimple } from "../../useSimple.js";
import { notBuiltGap, visitorSentence } from "../../visitor.js";
import { WrittenForYou } from "../../WrittenForYou.js";
import { TweetsBand, VisitorTweetsBand } from "./TweetsMode.js";

/** The two views that are plain-words lengths — what `SimplePanel` can draw. */
type SummaryLength = Exclude<SummaryView, "thread">;

/**
 * The owner's Summary band. On a length it is `OwnerSimple` below, so its GET
 * and its `useAutoRun` owner exist exactly as long as the paragraphs' view
 * does — and stay mounted across a move between Brief and Fuller, which share
 * one artefact. On Thread it is the thread's own band.
 *
 * See docs/project/summaries.md and docs/project/tweets.md.
 */
export function SummaryBand({
  slug,
  article,
  onJump,
  onAskChat,
}: {
  slug: string;
  /** For the thread's copy text and its counts (Tweets.tsx). */
  article: Article;
  onJump(id: BlockId): void;
  /**
   * **Ask about a Brief or Fuller paragraph in chat.** `Reader` owns both the
   * mode and the handoff into a fresh conversation, so the press goes up to it
   * with the paragraph's text. The owner's band alone has this prop:
   * `VisitorSummaryBand` has none to pass, because a visitor has no chat. The
   * Thread is not given it — its posts have Copy.
   * docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md.
   */
  onAskChat?: ((paragraphText: string) => void) | undefined;
}) {
  useRenderCount("SummaryBand");
  const [view, setView] = useQueryState("summary", summaryParam);
  const controls = <SummaryControls slug={slug} value={view} onChange={(next) => void setView(next)} />;
  if (view === "thread") {
    return <TweetsBand slug={slug} article={article} onJump={onJump} controls={controls} />;
  }
  return (
    <OwnerSimple
      slug={slug}
      level={view}
      onJump={onJump}
      onAskChat={onAskChat}
      render={(body, badge, about) => (
        <SummarySurface controls={controls} about={about} profile={badge}>
          {body}
        </SummarySurface>
      )}
    />
  );
}

/**
 * The plain-words levels' owner half: the read, the job and the press — and
 * the *written for you* badge, which belongs in the band's corner and needs
 * this hook's answer, so the band hands a `render` in rather than
 * the row reaching down.
 */
function OwnerSimple({
  slug,
  level,
  onJump,
  onAskChat,
  render,
}: {
  slug: string;
  level: SummaryLength;
  onJump(id: BlockId): void;
  /** See `SummaryBand`. */
  onAskChat: ((paragraphText: string) => void) | undefined;
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
        regenerate={{
          run: () => void owner.regenerate(),
          busy: owner.job !== null || owner.starting || owner.rewriting,
          refresh: () => owner.refresh(),
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
  return (
    <>
      {render(
        <SimplePanel access={{ kind: "owner", owner }} level={level} onJump={onJump} onAskChat={onAskChat} />,
        badge,
        about,
      )}
    </>
  );
}

/**
 * **The same band, for somebody who does not own the article.**
 *
 * The paragraphs and the thread each came in the page's own payload
 * (`simpleSummary`, `tweets`), or did not, which means nobody has made that
 * one. No `useSimple` and no `useTweets`, so no read of `/api/simple/:slug` or
 * `/api/tweets/:slug`, no `useAutoRun` and no job, and the control arms nothing
 * — nothing here can ask the model. A second band rather than a flag because a
 * hook cannot be called conditionally (src/web/reader-capability.ts).
 *
 * **Summary is `available` to a visitor whatever is stored** (visitor.ts §
 * `POLICY`), so the absence of each artefact is said here, in the band, under
 * the control that could choose the other: `SimplePanel` for the paragraphs,
 * and one line below for the thread — the sentence a visitor read when Tweets
 * was a mode with nothing built.
 */
export function VisitorSummaryBand({
  slug,
  simple,
  thread,
  article,
  onJump,
}: {
  slug: string;
  simple: PublicSimpleSummary | undefined;
  thread: PublicTweets | undefined;
  article: Article;
  onJump(id: BlockId): void;
}) {
  useRenderCount("VisitorSummaryBand");
  const [view, setView] = useQueryState("summary", summaryParam);
  const controls = <SummaryControls slug={null} value={view} onChange={(next) => void setView(next)} />;
  if (view === "thread") {
    if (thread) {
      return <VisitorTweetsBand slug={slug} thread={thread} article={article} onJump={onJump} controls={controls} />;
    }
    return (
      <SummarySurface controls={controls}>
        <div className="summ-scroll">
          <p className="summ-quiet">{visitorSentence(notBuiltGap("tweets"))}</p>
        </div>
      </SummarySurface>
    );
  }
  return (
    <SummarySurface controls={controls}>
      <SimplePanel access={{ kind: "visitor", simple: simple ?? null }} level={view} onJump={onJump} />
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
  profile = null,
  children,
}: {
  controls: ReactNode;
  /**
   * What the band's (i) adds after the mode's own words (ModeSurface.tsx §
   * `about`): for the owner, who wrote the paragraphs and when.
   */
  about?: ReactNode;
  /** The owner's *written for you* badge, for the band's corner (ModeSurface.tsx § `profile`). */
  profile?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ModeSurface label="Summary" feature="summ" mode="summary" about={about} profile={profile}>
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
          avoid wasting vertical space"* (SPIDERYARN-READING2-7A). The three-way
          control and nothing else — the badge is in the band's corner since
          2026-10-02 (plan 261002e). The thread's band draws the same row, in
          the same class, so the control does not move between views
          (Tweets.tsx § `controls`). */}
      <div className="summ-controls">{controls}</div>
      {children}
    </ModeSurface>
  );
}

/**
 * Each view's name and what it is, for the card on its segment. Short and very
 * simple, a little longer — Greg's words for the two lengths
 * (SPIDERYARN-READING2-7J), until Fuller was made longer still on 2026-10-04
 * (spya-azft06, plan 261004b); the thread's are the Tweets mode's.
 */
const VIEW: Record<SummaryView, { label: string; what: string; how: string }> = {
  brief: {
    label: SUMMARY_SUB_MODES.brief.label,
    what: "Short and very simple: what it is about, why it matters, and a key idea or two.",
    how: "Written by AI once, with Fuller, and kept. Each paragraph links to the passages it rests on — the article says it better.",
  },
  fuller: {
    label: SUMMARY_SUB_MODES.fuller.label,
    what: "Longer and more detailed: how it was done, the evidence and the limits, still in plain words.",
    how: "Written by AI once, with Brief, and kept. Each paragraph links to the passages it rests on — the article says it better.",
  },
  thread: {
    label: SUMMARY_SUB_MODES.thread.label,
    what: "The article as a numbered thread of short posts, to copy whole or one at a time.",
    how: "Written by AI the first time you open it on an article of your own, and kept. Each post points to the passages it came from.",
  },
};

/**
 * **Brief | Fuller | Thread** — Summary's one row, a three-way segmented
 * control. Greg, 2026-10-03 (spya-thpsnd): *"three buttons somehow. Not
 * buttons, like group buttons. Not radio buttons exactly, but like, you know,
 * a sense that you can have one of those three."*
 *
 * ```
 *  [ Brief | Fuller | Thread ]
 * ```
 *
 * It replaces the slider of 2026-09-30 (three plain-words levels, with an icon
 * at each end), which said *one scale* — and a thread is not a point on a
 * scale of length. Built the way Structure's and Referee's sub-mode toggles
 * are (StructureMode.tsx § `StructureViewToggle`): a radiogroup of buttons,
 * each its own tab stop, labelled in words, with a card on each. Drawn joined,
 * so the three read as one choice (summary.css § `.summ-views`).
 *
 * @param slug the article, **only so a press can be recorded** — null for a
 *   visitor, whose press must arm nothing (there is no `useAutoRun` to claim
 *   it, and a token nobody claims is a spend still owed).
 */
export function SummaryControls({
  slug,
  value,
  onChange,
}: {
  slug: string | null;
  value: SummaryView;
  onChange(next: SummaryView): void;
}) {
  /* **The gesture seam.** Choosing a length with nothing stored writes the
     plain-words levels — Greg's rule about opening a mode, one level down
     (src/web/activation.ts). Here, in a real `onClick`, and not in `onChange`
     of the query state: `?summary=` moves on Back, Forward, a pasted link and
     a last-view restore too, and none of them may buy a model call.

     **What a segment arms is `activationForSummary` of the view it names**:
     `simple` for Brief and Fuller, which one job writes together, and nothing
     for Thread, whose band writes on arrival and claims no token.

     **Armed before the "already there" check**, so pressing the length already
     open mints a fresh press — the only way back from a failed read, as
     QuizPanel.tsx § `RememberSubModeToggle` has it. */
  const choose = (next: SummaryView) => {
    const target = activationForSummary(next);
    if (slug !== null && target !== null) armActivation(slug, target);
    /* Writing the value already open would push a history entry that goes
       nowhere. */
    if (value !== next) onChange(next);
  };

  return (
    <div className="summ-views" role="radiogroup" aria-label="Summary view">
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {SUMMARY_VIEWS.map((v) => (
          /* `keepSide` for the reason RefereeViews gives: the band sits at the
             edge of the window and a card flung to the cross axis would land on
             the controls being read. */
          <Tooltip
            key={v}
            placement="bottom"
            keepSide
            className="tip-soon"
            content={<ControlTip head={VIEW[v].label} what={VIEW[v].what} how={VIEW[v].how} />}
          >
            {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s, the call StructureMode.tsx, RefereeMode.tsx and DiagramPanel.tsx already make */}
            <button
              type="button"
              role="radio"
              aria-checked={v === value}
              tabIndex={0}
              className={`summ-view-btn${v === value ? " on" : ""}`}
              onClick={() => choose(v)}
            >
              {VIEW[v].label}
            </button>
          </Tooltip>
        ))}
      </TooltipGroup>
    </div>
  );
}
