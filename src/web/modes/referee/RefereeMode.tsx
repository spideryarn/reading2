/**
 * **Referee mode's controller.** The band, the sub-mode chips, the two total
 * `Record`s behind them, and the exhaustive `switch` that picks a panel.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established two days earlier: a mode's controller, its visitor twin and its
 * hook move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. Referee is
 * owner-only, so there is one band and no visitor twin. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md,
 * and docs/project/referee-mode.md for the mode itself.
 */

import { type ReactNode, useState } from "react";
import { useQueryState } from "nuqs";
import { Info, TriangleAlert } from "lucide-react";
import type { Block, BlockId, Comment } from "../../../types.js";
import { LINKAGE_NOT_ADEQUACY } from "../../../referee-claims.js";
import {
  REFEREE_CANDIDATES_REACHES_SEARCH,
  REFEREE_DECLARE_IT,
  REFEREE_TEXT_ALREADY_SENT,
} from "../../../messages.js";
import type { Found } from "../../search-hits.js";
import { REFEREE_VIEWS, refereeParam, type RefereeView } from "../../params.js";
import { armActivationForRefereeView } from "../../activation.js";
import { REFEREE_SUB_MODES } from "../../sub-modes.js";
import { useRenderCount } from "../../perf.js";
import { ControlTip, Tooltip, TooltipGroup } from "../../Tooltip.js";
import { usePressToggle } from "../../usePressToggle.js";
/* Referee mode's rule 5: the deterministic scan of the document's own source,
   the Hidden text sub-mode since 2026-10-07 (plan 261007h). It was inside
   Notices before that. src/injection-scan.ts is the scanner and it calls no
   model. */
import { type SourceScanMark, SourceScanNotice, sourceScanMark } from "../../SourceScanNotice.js";
import { type SourceScanState, useSourceScan } from "../../useSourceScan.js";
import { CriteriaBand, WHAT_THE_RANK_IS, WHAT_THE_TICK_DOES } from "../../CriteriaPanel.js";
import { ClaimsBand } from "../../ClaimsPanel.js";
import { MIRROR_IS_NOT_GIVEN_THE_PAPER, MirrorBand } from "../../MirrorPanel.js";
import { CandidatesBand } from "../../CandidatesPanel.js";
import { ModeSurface } from "../../ModeSurface.js";

/**
 * **Referee mode — for somebody who has been asked to peer-review this piece.**
 *
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md. The band itself is
 * stage 1 — the confidentiality notice, the four buttons, and a line per panel
 * saying what that panel will do — and it still calls no model. All four panels
 * underneath it can: Criteria, Claims, Mirror and Candidates.
 *
 * There are **four** of them and the plan on disk says three: `candidates` was
 * added on Greg's say-so the same night, overruling the cut the plan's appendix
 * argues for. It is the only one that is not the referee's own question —
 * see `CandidatesPanel`.
 *
 * The design problem the whole mode is built around is Greg's, 2026-08-31:
 *
 * > it felt like a useful service to help them scan a document efficiently, and
 * > flag useful/relevant stuff. At the same time, I'm wary about handing off too
 * > much of the intellectual labour to AI and leading to cognitive surrender.
 *
 * Which is why **no verdict, ever** is the rule every one of these panels will
 * be built under — no accept/reject, no score, no per-criterion grade. Ranking
 * within the paper is the only ordering the mode offers.
 *
 * ## The actions come first, and the notices are one press away
 *
 * Greg, 2026-10-03 (`spya-vbeyse`): *"It seems to bury the actual actions and
 * useful stuff underneath a whole bunch of warnings. I mean, maybe those
 * warnings are necessary, but perhaps we could hide them inside the information
 * tooltip or something, or create a warning tooltip."* Measured that day at
 * 1280 × 800: the criterion box started 607px down a 760px band.
 *
 * So the top of the band is one row — the chips and a **Notices** button —
 * and the panel starts under it. Notices opens `.ref-brief`, which holds the
 * confidentiality sentences. *How Referee mode works* is the band's (i), in the
 * corner where every other mode keeps its own.
 * docs/plans/261003k-referee-mode-puts-the-actions-first-and-the-notices-behind-one-button.md.
 *
 * The source scan was in Notices too, and opened it whenever it found
 * anything — which on arXiv HTML, where a typesetter's zero-width spaces count,
 * was nearly every paper. Greg, 2026-10-07 (`spya-y6590g`): *"Perhaps squirrel
 * this info away as a sub-mode? It doesn't seem important enough to be right
 * at the top of Criteria."* So it is the fifth chip, **Hidden text**, which
 * carries a dot when the scan found something with no everyday explanation.
 * docs/plans/261007h-referee-hidden-instructions-become-a-sub-mode-in-plain-words.md.
 *
 * ## What the notice still is: past tense, never dismissed, nothing remembered
 *
 * **Past tense** because by the time anybody is looking at this band the
 * article's text has already gone to the model provider — ingest ran
 * extraction, structure and gists on it, and a PDF was read by a model before
 * it was anything else. A notice here saying *this will send your manuscript to
 * a third party* would be warning about something the app has already done. The
 * present-tense half of the same fact belongs at the point of adding an
 * article, and is there: `ADDING_SENDS_TEXT_AWAY` in src/web/AddArticle.tsx.
 *
 * **No acknowledgement**, which the plan's first draft asked for. A box that
 * says "I understand" in front of something already done would imply that
 * ticking it makes prohibited use permissible.
 *
 * **A collapse, not a dismissal.** Nothing is remembered: the box is shut on
 * every visit and one press opens it, so there is no state in which a referee
 * has made it go away for good. It no longer opens itself: what it holds is
 * the same on every paper, and the one thing that was news about a particular
 * document, the scan, has its own chip.
 *
 * It is styled as a notice and not as an error — src/web/styles/referee.css
 * § referee mode. Nothing has gone wrong.
 */
export function RefereeBand({
  slug,
  blocks,
  byline,
  comments,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  slug: string;
  blocks: Block[];
  /**
   * Who wrote the paper — **passed through to Candidates and read nowhere
   * else**.
   *
   * Rule 4 is that referee calls are identity-stripped, and Candidates is its
   * one stated exception: it sees the byline in order to exclude the paper's own
   * authors from the names it puts forward, and for nothing else. The exception
   * is written here, in the prop, rather than left to be discovered in a diff.
   */
  byline?: string | undefined;
  /**
   * This reader's comments — **passed through to Criteria and read nowhere
   * else**, and read-only there.
   *
   * A comment with a `criterionId` is the referee's own placement of a passage
   * on one of their criteria, and the panel puts it beside the model's on the
   * same block. One without is an ordinary reading note and is none of Referee
   * mode's business. docs/project/comments.md § the referee's own placement.
   */
  comments: readonly Comment[];
  onJump(blockId: BlockId): void;
  /** `Reader` owns the prose — the seam described on `found` above. */
  onFound(next: Found[]): void;
  /**
   * The marked passage the referee last pressed — **Criteria's, and read
   * nowhere else**, like `comments` above.
   *
   * Claims paints marks too and does not have one yet; it is the same wiring
   * when somebody wants it. Mirror and Candidates paint nothing at all.
   */
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("RefereeBand");
  const [view, setView] = useQueryState("referee", refereeParam);
  /* Held by the band rather than by a panel: the answer is about the document,
     not about a sub-mode, and a hook inside `RefereeSubMode` would re-run the
     scan every time the referee pressed a different chip. */
  const scan = useSourceScan(slug);

  return (
    <RefereeFrame slug={slug} view={view} onView={(next) => void setView(next)} scan={scan}>
      <RefereeSubMode
        view={view}
        slug={slug}
        blocks={blocks}
        byline={byline}
        comments={comments}
        onJump={onJump}
        onFound={onFound}
        openKey={openKey}
        onOpenKey={onOpenKey}
        scan={scan}
      />
    </RefereeFrame>
  );
}

/**
 * **Everything in the band that is not a sub-mode's panel**: the top row, the
 * Notices box and the lead line, as a function of the view and the scan.
 *
 * Split from `RefereeBand` and exported for tests/referee-notices.test.tsx,
 * which hands it a scan state and no router — the band itself wants `?referee=`,
 * a fetch and the reader's comments.
 */
export function RefereeFrame({
  slug,
  view,
  onView,
  scan,
  children,
}: {
  slug: string;
  view: RefereeView;
  onView(next: RefereeView): void;
  scan: SourceScanState;
  /** The selected sub-mode's panel. */
  children: ReactNode;
}) {
  /* Shut until the referee presses Notices. Local state and not a `?`
     parameter: a shut box is not view state (docs/project/url-state.md). It
     opened itself for a finding until 2026-10-07, when the scan left it for
     the Hidden text chip (plan 261007h). */
  const [noticesOpen, setNoticesOpen] = useState(false);
  /* The mark on the Hidden text chip, and the one sentence a screen reader
     hears about a finding from any other sub-mode. */
  const mark = sourceScanMark(scan);

  return (
    <ModeSurface label="Referee" feature="gloss referee" mode="referee" about={<RefereeAbout />}>
      {/* **One row: the chips, and the one button the notices are behind.** The
          button is a sibling of the radiogroup rather than inside it, because it
          is not one of the sub-modes. */}
      <div className="ref-top">
        {/* Keep a live region present before the asynchronous result arrives:
            one that mounts with its message already in it announces nothing
            (postmortem 261003e). Silent inside Hidden text, whose own panel
            is a live region and says it in full. */}
        <span className="sr-only" role="status" aria-live="polite">
          {mark !== "none" && view !== "hidden" ? "The source check found text to look at, under Hidden text." : ""}
        </span>
        <RefereeViews slug={slug} view={view} onView={onView} mark={mark} />
        <Tooltip
          placement="bottom"
          keepSide
          className="tip-soon"
          /* Only while shut: the card says what is inside, and once the box is
             open it is the box's own first lines the card would be covering —
             seen in Chrome at 1280 × 800, 2026-10-03. */
          enabled={!noticesOpen}
          content={
            <ControlTip
              head="Notices"
              what="Where this article's text has already been sent, and which manuscripts this mode is meant for."
              how="The same on every paper, and nothing in it is a judgement about this one. The check for hidden text is the Hidden text chip."
            />
          }
        >
          <button
            type="button"
            className="ref-notices-btn"
            aria-expanded={noticesOpen}
            onClick={() => setNoticesOpen(!noticesOpen)}
          >
            <TriangleAlert size={13} aria-hidden="true" /> Notices
          </button>
        </Tooltip>
      </div>

      {/* **What belongs to the mode rather than to a sub-mode**, in a box that
          is given a share of the band and made to scroll inside it: the wrapper
          is what stops it pushing the panel off the bottom of a
          `position: fixed` band that clips nothing and scrolls nowhere.
          src/web/styles/referee.css § referee mode, `.ref-brief`, has the
          measurements. src/messages.ts owns the sentences. */}
      {noticesOpen && (
        <div className="ref-brief">
          <div className="ref-notice">
            <p>{REFEREE_TEXT_ALREADY_SENT}</p>
            <p className="ref-notice-also">{REFEREE_DECLARE_IT}</p>
            {/* The search engine is reached only from inside Candidates, which says
                so again beside its own controls (CandidatesPanel.tsx). */}
            <p className="ref-notice-also">{REFEREE_CANDIDATES_REACHES_SEARCH}</p>
          </div>
        </div>
      )}

      <div className="ref-panel">
        {/* **What to do here, in one visible line** — the first sentence of the
            chip's own card, from the same constant, so a referee on a touch
            device (no hover) is told what the sub-mode is for. Inside the
            scroller, so it gives its height back once there are results. */}
        <p className="ref-lead">
          {REFEREE_VIEW_TIP[view].what}{" "}
          {/* Keyed by the view, so an open card shuts when the sub-mode
              changes rather than showing one panel's rules over another. */}
          <HowToRead key={view} view={view} />
        </p>
        {children}
      </div>
    </ModeSurface>
  );
}

/**
 * **How to read each panel, one press away** — the sentences that used to open
 * the panel as visible text, word for word, from the constants the panels
 * printed.
 *
 * Greg, 2026-10-03, on [Q-referee-panel-rules]: *"B"*, the option that moves
 * them out of the panel. They are what stops a list of passages reading as a
 * verdict, so `HowToRead` puts them behind a button a finger can press rather
 * than in a hover card a phone never shows.
 * docs/plans/261003m-referee-panels-how-to-read-sentences-behind-a-tap-to-open-button.md,
 * which also says what was not moved: the notes that sit beside results
 * (Claims' order, Mirror's evidence, Criteria's key).
 *
 * Criteria's two are both here from the start, where the panel printed each
 * only once it had a criterion or a result: a card whose contents changed
 * between two presses would be harder to trust than one that mentions a number
 * a moment early.
 *
 * A total `Record`, `REFEREE_VIEW_TIP`'s reason. Candidates is empty and draws
 * no button: nothing of its was moved, and `COI_NOT_CHECKED` stays printed.
 */
const REFEREE_HOW_TO_READ: Record<RefereeView, readonly string[]> = {
  criteria: [WHAT_THE_TICK_DOES, WHAT_THE_RANK_IS],
  claims: [LINKAGE_NOT_ADEQUACY],
  mirror: [MIRROR_IS_NOT_GIVEN_THE_PAPER],
  candidates: [],
  /* The panel says what it is for at its own foot, in every state
     (`WHAT_THIS_IS` in SourceScanNotice.tsx), so there is nothing to move. */
  hidden: [],
};

/**
 * **The button at the end of a panel's lead line, and its card.**
 *
 * `BandAbout`'s shape (docs/project/tooltips.md § Where the code is): a
 * *controlled* `Tooltip` on a real `<button>`, so a tap toggles it on a device
 * with no hover, and hover and keyboard focus open it too. Words beside the
 * icon, because the band's corner already holds a bare (i) that says what the
 * mode is, and two identical marks a few lines apart would mean two things.
 */
function HowToRead({ view }: { view: RefereeView }) {
  // usePressToggle.ts says why a press that closes has to be remembered.
  const { open, onOpenChange, trigger } = usePressToggle();
  const sentences = REFEREE_HOW_TO_READ[view];
  if (sentences.length === 0) return null;
  return (
    <Tooltip
      placement="bottom"
      keepSide
      open={open}
      onOpenChange={onOpenChange}
      className="ref-rules-card"
      content={sentences.map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
    >
      <button
        type="button"
        className={`ref-rules${open ? " on" : ""}`}
        aria-expanded={open}
        {...trigger}
      >
        <Info size={13} aria-hidden="true" /> How to read this
      </button>
    </Tooltip>
  );
}

/**
 * **What the band's (i) adds after the mode's own words** — what the colours
 * mean, which is the half of the old *How Referee mode works* card that
 * `MODE_CATALOG`'s sentences (no verdict, no score) do not already say.
 *
 * It names the shape of the rule rather than red and green: `?refscale=br`
 * paints the same two directions blue and red, and the key the Criteria panel
 * prints (`TheKey`) draws swatches for the same reason.
 */
function RefereeAbout() {
  return (
    <p>
      <b>What the colours mean.</b> On a for/against criterion, colour is direction rather than
      identity: one end of the scale counts against, the other counts for, in the panel and the
      paper alike. The panel prints the key, and each mark carries − or + as well. Every other
      colour just says <i>which</i> of your criteria or claims made a mark, and carries no
      judgement.
    </p>
  );
}

/**
 * **The sub-mode chips**, and they are `DiagramPanel`'s exactly —
 * `role="radiogroup"` with `role="radio"` children, each its own tab stop, and
 * no arrow-key handling of any kind.
 *
 * That combination looks like a mistake and is not. The ARIA roles are the
 * honest description of the control: one of these is on, and choosing another
 * turns this one off. What Greg had removed on 2026-08-31 was arrow-key
 * *selection* — the roving tabindex and its handler — because on this page the
 * arrows belong to the article: up and down step it, left and right choose the
 * stride, and a group that swallowed them left the reader's keyboard dead while
 * a chip had focus. He met it as a bug. So the roles stay and the keys go, every
 * chip is tabbable, and Enter, Space or a click selects.
 * docs/project/keyboard.md, and tests/arrows-belong-to-the-article.test.tsx,
 * which sweeps every `role="radio"` in the client for exactly this and renders
 * these to check the arrows still reach the window.
 *
 * **Exported for that test**, and it is a seam worth having anyway: this
 * component is a pure function of its two props, where `RefereeBand` above owns
 * the `?referee=` parameter — the same band-owns-the-URL, panel-is-pure split
 * every other mode in this file makes.
 */
export function RefereeViews({
  slug,
  view,
  onView,
  mark = "none",
}: {
  /**
   * **Only so that a press can be recorded**, and read nowhere else in here.
   *
   * This component was a pure function of two props until 2026-09-06, when the
   * chips started running what they open (`onView` below). Arming at the click
   * rather than one level up is the call `Dock` and `DiagramPanel` already made,
   * and it is the one that keeps the seam testable: the button and the token are
   * in the same file, so a test that clicks the real chip is a test of the real
   * rule.
   */
  slug: string;
  view: RefereeView;
  onView(next: RefereeView): void;
  /**
   * What the source scan found, as the Hidden text chip shows it
   * (`sourceScanMark`). Optional only so the tests that render the chips
   * alone need not invent a scan.
   */
  mark?: SourceScanMark;
}) {
  return (
    <div className="ref-views" role="radiogroup" aria-label="What Referee is showing">
      {/* **A card on every chip**, which until 2026-09-02 was the one radiogroup
          in this app with nothing on it at all — four one-word labels naming four
          sub-modes that do four unrelated things, one of which spends money and
          one of which is never given the paper. Greg met the whole mode as
          *"very confusing"*.

          `TooltipGroup` so that reading along the row is one gesture rather than
          four waits, and `keepSide` for DiagramPanel's measured reason: the band
          sits at the right of the window, a card wider than a chip is otherwise
          thrown onto the cross axis, and it lands on top of the chips the reader
          is reading towards (Tooltip.tsx § keepSide). */}
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {REFEREE_VIEWS.map((v) => (
          <Tooltip
            key={v}
            placement="bottom"
            keepSide
            className="tip-soon"
            content={
              <ControlTip
                head={REFEREE_VIEW_LABEL(v)}
                what={REFEREE_VIEW_TIP[v].what}
                how={REFEREE_VIEW_TIP[v].how}
              />
            }
          >
            {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern and the call DiagramPanel.tsx, Dock.tsx and SearchPanel.tsx already make — a real <input type="radio"> cannot be styled as a chip without hiding the input and faking every state it already had */}
            <button
              type="button"
              role="radio"
              aria-checked={v === view}
              /* **Its own tab stop, and no key handler.** A roving `tabIndex` is
                 inseparable from arrow navigation — it is one tab stop for the whole
                 group and only navigable because the arrows move within it — so
                 leaving it here while removing the handler would make all but one
                 of them unreachable by keyboard altogether. */
              tabIndex={0}
              className={`ref-view-btn${v === view ? " on" : ""}`}
              onClick={() => {
                /* **The gesture seam for Claims.** Pressing its chip with
                   nothing there starts it — Greg's rule about opening a mode,
                   one level down. The other three chips arm nothing; Candidates
                   waits for Build the reviewer brief. The table is
                   src/web/activation.ts § REFEREE_TARGET, which is also where
                   the note about Candidates and the search engine lives.

                   Here, in the `onClick`, and deliberately **not** in `onView`'s
                   `setView` one level up: `?referee=` is query state, so Back and
                   Forward move it too, and retracing your steps through the four
                   chips must not buy a claims run or a web search. */
                armActivationForRefereeView(slug, v);
                onView(v);
              }}
            >
              {REFEREE_VIEW_LABEL(v)}
              {/* The one mark a finding leaves outside its own sub-mode
                  (plan 261007h): a dot, or a ring when every finding wears
                  an everyday label. Words for a screen reader, since a dot
                  is only a shape. */}
              {v === "hidden" && mark !== "none" && (
                <span className={`ref-view-dot ${mark}`}>
                  <span className="sr-only">
                    {mark === "found" ? " (something found)" : " (found, each with an everyday explanation)"}
                  </span>
                </span>
              )}
            </button>
          </Tooltip>
        ))}
      </TooltipGroup>
    </div>
  );
}

/**
 * **What each sub-mode is, and the thing about it a press would not tell you.**
 *
 * `ControlTip`'s rule, which is the whole reason the second sentence is worth a
 * hover: `what` is what the reader could have worked out by pressing the chip
 * and looking; `how` is what they could not — where the answer comes from, what
 * it costs, or what the sub-mode does *not* promise. Each of these four `how`s
 * is a refusal:
 *
 * - **Criteria** never scores the paper, and the run is a model call over the
 *   whole of it, so pressing Run is not free.
 * - **Claims** asserts linkage and never adequacy — `LINKAGE_NOT_ADEQUACY` in
 *   src/referee-claims.ts says the same thing behind the panel's *How to read
 *   this* button (`HowToRead` above).
 * - **Mirror** is never given the paper (src/referee-mirror.ts § the three
 *   constraints) and keeps nothing (`useMirror.ts`: *one button, one run,
 *   nothing stored*).
 * - **Candidates** searches the web, which is a third party at a moment none of
 *   the other three reaches one, and checks no conflicts of interest
 *   (`COI_NOT_CHECKED`).
 *
 * A total `Record`, beside `REFEREE_VIEW_LABEL` and for its reason: a fifth
 * sub-mode is a red compile here rather than a chip that silently explains
 * nothing.
 */
const REFEREE_VIEW_TIP: Record<RefereeView, { what: string; how: string }> = {
  criteria: {
    what: "Write what you have been asked to judge this paper against. Each criterion becomes a re-runnable pass that marks the passages bearing on it.",
    how: "Each run is a model call over the whole paper. It never scores the paper: which way a passage cuts is marked, and what that adds up to is yours.",
  },
  claims: {
    what: "What the paper claims up front, and where it takes each claim up — in the paper's own order, never a ranking.",
    how: "It asserts only that a passage takes a claim up, never whether the passage carries it. That judgement is the review.",
  },
  mirror: {
    what: "The model reads your own comments back to you and points at ones an author could not act on.",
    how: "It is never given the paper, so it can hold no opinion about it. The answer is not stored — leaving this sub-mode loses it.",
  },
  candidates: {
    what: "For an editor: who could review this paper, and what expertise it would take.",
    how: "It searches the web as you talk to it, and every name carries a link a search returned. Conflicts of interest are not checked by anything here.",
  },
  hidden: {
    what: "Text in this document's source that a reader would not see but a model would read — white on white, too small to read, invisible characters, instructions written to a model.",
    how: "No model is involved: it reads the original web page, before any call. It reports and blocks nothing, a PDF is not checked, and the chip carries a dot when something was found that has no everyday explanation.",
  },
};

/**
 * What each button says — the registry's words since 2026-10-01, so the chip
 * and the command bar's row for it say the same thing (src/web/sub-modes.ts;
 * docs/plans/261001d-command-bar-lists-sub-modes.md). Still a total `Record`
 * there, so a fifth sub-mode is a red compile as well as in the switch below.
 */
const REFEREE_VIEW_LABEL = (v: RefereeView): string => REFEREE_SUB_MODES[v].label;

/**
 * The selected sub-mode's panel.
 *
 * An exhaustive `switch` with a `never` in the default, so a fifth member of
 * `RefereeView` cannot be added without a panel to draw for it — which is not
 * hypothetical: `candidates` was added the same night, and this is what said
 * where. The alternative
 * — a lookup keyed by the view — would compile with a hole in it under
 * `noUncheckedIndexedAccess` and render nothing at runtime, which is the shape
 * docs/reusable/silent-success.md is about.
 */
function RefereeSubMode({
  view,
  slug,
  blocks,
  byline,
  comments,
  onJump,
  onFound,
  openKey,
  onOpenKey,
  scan,
}: {
  view: RefereeView;
  slug: string;
  blocks: Block[];
  byline?: string | undefined;
  /** The source scan, held by `RefereeBand`; read only by the Hidden text panel. */
  scan: SourceScanState;
  /** The referee's own placements. See `RefereeBand`, which says why. */
  comments: readonly Comment[];
  onJump(blockId: BlockId): void;
  onFound(next: Found[]): void;
  /** Criteria's pressed passage. See `RefereeBand`, which says why. */
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  switch (view) {
    case "criteria":
      /* **Stage 3.** Its band owns `?crits=` and pushes the marked passages up;
         src/web/CriteriaPanel.tsx is the whole of it, including the three
         visual rules it is under. */
      return (
        <CriteriaBand
          slug={slug}
          blocks={blocks}
          comments={comments}
          onJump={onJump}
          onFound={onFound}
          openKey={openKey}
          onOpenKey={onOpenKey}
        />
      );
    case "claims":
      /* **Stage 4.** What the paper claims about itself and where it takes each
         claim up, in the paper's own order and never ranked by how much was
         found. src/web/ClaimsPanel.tsx is the whole of it, including the three
         rules and where each one is enforced rather than asked for. */
      return <ClaimsBand slug={slug} blocks={blocks} onJump={onJump} onFound={onFound} />;
    case "mirror":
      /* **Stage 5b**, and the second sub-mode to become reachable. It takes no
         `blocks` and pushes nothing up: a Mirror remark is about a sentence the
         referee wrote, so it belongs beside that sentence in the panel with a
         jump into the piece, and nothing is painted on the prose.
         src/web/MirrorPanel.tsx. */
      return <MirrorBand slug={slug} onJump={onJump} />;
    case "candidates":
      /* **Stage 6 and 7, and somebody else's stage.** The one sub-mode that is
         not the referee's question: it answers an *editor's* — who could review
         this paper, and what expertise it would take. Greg overruled the plan's
         own cut of it and then said it should be a reuse of Chat, so underneath
         it is a chat thread of a third `ThreadKind` and a shortlist parsed out of
         the transcript under four rules that are code rather than prompt.
         src/web/CandidatesPanel.tsx and src/referee-candidates.ts.

         It pushes nothing up: a candidate's anchor is a *fit requirement's*
         block, drawn as a citation chip in the panel, and washing the paper with
         it would say the paragraph is about a person. */
      return <CandidatesBand slug={slug} blocks={blocks} byline={byline} onJump={onJump} />;
    case "hidden":
      /* **The source scan, in a sub-mode of its own since 2026-10-07.** The
         scan is the band's (`RefereeBand` fetches it once), so pressing this
         chip runs nothing; it only shows the answer. Rule 5's five rules are
         the component's, and moving it here changed none of them
         (docs/project/referee-mode.md § rule 5). */
      return <SourceScanNotice state={scan} />;
    default: {
      const unknown: never = view;
      throw new Error(`unknown referee view: ${String(unknown)}`);
    }
  }
}
