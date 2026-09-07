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

import { useState } from "react";
import { useQueryState } from "nuqs";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Block, BlockId, Comment } from "../../../types.js";
import {
  REFEREE_CANDIDATES_REACHES_SEARCH,
  REFEREE_DECLARE_IT,
  REFEREE_TEXT_ALREADY_SENT,
  REFEREE_TEXT_ALREADY_SENT_SHORT,
} from "../../../messages.js";
import type { Found } from "../../search-hits.js";
import { REFEREE_VIEWS, refereeParam, type RefereeView } from "../../params.js";
import { armActivationForRefereeView } from "../../activation.js";
import { useRenderCount } from "../../perf.js";
import { ControlTip, Tooltip, TooltipGroup } from "../../Tooltip.js";
/* Referee mode's rule 5, and the one thing in the band that is not a sub-mode:
   the deterministic scan of the document's own source, drawn above the chips
   because a hidden instruction bears on all four panels. src/injection-scan.ts
   is the scanner and it calls no model. */
import { SourceScanNotice } from "../../SourceScanNotice.js";
import { useSourceScan } from "../../useSourceScan.js";
import { RefereeHowButton, RefereeHowCard, useHowCard } from "../../RefereeCard.js";
import { CriteriaBand } from "../../CriteriaPanel.js";
import { ClaimsBand } from "../../ClaimsPanel.js";
import { MirrorBand } from "../../MirrorPanel.js";
import { CandidatesBand } from "../../CandidatesPanel.js";
import { ModeSurface } from "../../ModeSurface.js";

/**
 * **Referee mode — for somebody who has been asked to peer-review this piece.**
 *
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md. The band itself is
 * stage 1 — the confidentiality notice, the four buttons, and a line per panel
 * saying what that panel will do — and it still calls no model. **Three of the
 * four panels underneath it now do**: Criteria (stage 3), Claims (stage 4) and
 * Mirror (stage 5b). Candidates is still its stage 1 placeholder.
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
 * ## The notice is in the past tense, is shut until asked for, and is never dismissed
 *
 * All three are deliberate. **Past tense** because by the time anybody is
 * looking at this band the article's text has already gone to the model
 * provider — ingest ran extraction, hierarchy and gists on it, and a PDF was
 * read by a model before it was anything else. A notice here saying *this will
 * send your manuscript to a third party* would be warning about something the
 * app has already done. The present-tense half of the same fact belongs at the
 * point of adding an article, and is there: `ADDING_SENDS_TEXT_AWAY` in
 * src/web/AddArticle.tsx.
 *
 * **No acknowledgement**, which the plan's first draft asked for. A box that
 * says "I understand" in front of something already done would imply that
 * ticking it makes prohibited use permissible. It would also have to be
 * remembered somewhere, and both places available are wrong: the URL is for
 * view state — *how you are looking at an article*, which has to survive a
 * reload and travel when the address is pasted (docs/project/url-state.md) —
 * and a column is a migration for a checkbox.
 *
 * **This comment used to say `localStorage` was "banned outright", and that was
 * the flat version of the rule rather than the rule.** It is banned for view
 * state, which is what the paragraph above is about; a per-device "I have read
 * this" bit is neither view state nor anything worth pasting to somebody else.
 * `InstallHint` was already the exception and the explainer card below is the
 * second — src/web/referee-card.ts draws the distinction in full. None of that
 * reaches this notice, which remembers nothing on purpose; see the collapse
 * paragraph at the end.
 *
 * **Not dismissible**, for the reason `SharedNotice` in src/web/PublicChrome.tsx
 * gives about itself: *it is what this page is, and a control to make it go away
 * would say otherwise.*
 *
 * **Shut by default, though**, since 2026-09-02, when Greg asked for it:
 * *"also default-collapse the message starting with 'This article's text has
 * already been sent to a third-party model...'"* The three sentences above are
 * unchanged and so is the reasoning; what changed is that the paragraph a
 * referee reads once no longer costs the band 214px on every visit.
 *
 * **A collapse is not a dismissal, and the two differences are what keep the
 * paragraph above true.** First, the *fact* is the label on the control —
 * `REFEREE_TEXT_ALREADY_SENT_SHORT` — so shutting the box hides which venues
 * call this a breach and which manuscripts the mode is for, never that the text
 * has gone. Second, nothing is remembered: `noticeOpen` is a `useState` that
 * dies with the mount, so every visit starts shut and one press opens it. That
 * is also why the storage objection this comment used to make against a
 * collapse — the URL is the wrong place for it, and a column is a migration for
 * a checkbox — does not apply: there is nothing to store.
 *
 * **The explainer card *is* remembered, and the difference between them is the
 * point.** "How Referee mode works" is something you read once; a notice about
 * where the manuscript has already gone is something the mode *is*, and a
 * referee arriving on their second paper meets it again. So the card keeps a bit
 * in `localStorage` (src/web/referee-card.ts) and this keeps none — and the two
 * live in different boxes, `.ref-brief` and `.ref-panel`, so that no press can
 * be mistaken for the other.
 *
 * It is styled as a notice and not as an error — src/web/styles.css § referee
 * mode. Nothing has gone wrong.
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
  /* **Shut, and not remembered** — see the header. Local state rather than a
     `?` parameter, for the reason `Section` in src/web/Metadata.tsx gives about
     itself: a shut box is not view state, nothing about it is worth linking to,
     and docs/project/url-state.md keeps the address bar for places you were. */
  const [noticeOpen, setNoticeOpen] = useState(false);

  /* **One bit, and it is on the device rather than in the URL** — the card is
     open until the referee shuts it, and the header button brings it back by
     clearing the same bit. Every read and write of it is inside `useHowCard`,
     so this component cannot change the screen and forget to write;
     src/web/referee-card.ts is why it is not a `?` parameter, and why it is not
     the flat ban this component's docstring used to assert. */
  const how = useHowCard();

  return (
    <ModeSurface
      label="Referee"
      feature="gloss referee"
      /* **A fragment, even though this header's one child is unconditional.**
         `ModeSurface` renders no `.band-head` at all for an absent, null or
         boolean `head`, and five bands ship an *empty* header row today whose
         children are all gated on an artefact — so `head={cond && <X/>}` is the
         shape that deletes a row a reader can see. Referee is not one of those:
         `RefereeHowButton` is always there. The fragment is defensive rather
         than necessary, so that every band reads the same way and making this
         child conditional one day cannot quietly remove the row.
         docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md
         § Stage 2. */
      head={
        <>
          {/* The mode's name went on 2026-09-05 — the Dock says it (§ Stage 5 of
              docs/plans/260905d-declutter-the-reading-view-top-bars.md). The row
              stays for the "how this works" button beside it. */}
          <RefereeHowButton
            open={how.open}
            onToggle={() => how.show(!how.open)}
            buttonRef={how.buttonRef}
          />
        </>
      }
    >

      {/* **The two things that belong to the mode rather than to a sub-mode**,
          in one box so that together they can be given a share of the band and
          made to scroll inside it. They are not merely two siblings that happen
          to be adjacent: the wrapper is what stops them from pushing the chips
          and the panel off the bottom of a `position: fixed` band that clips
          nothing and scrolls nowhere. src/web/styles.css § referee mode,
          `.ref-brief`, has the measurements. */}
      <div className="ref-brief">
        {/* Always, above everything, and before any sub-mode has been pressed.
            src/messages.ts owns both sentences. */}
        <div className="ref-notice">
          {/* **The fact is the label on the control**, so shutting the box does
              not take it away — only the venues and the audience, which is the
              part a referee reads once. src/messages.ts owns all three
              sentences. */}
          <button
            type="button"
            className="ref-notice-toggle"
            aria-expanded={noticeOpen}
            onClick={() => setNoticeOpen((was) => !was)}
          >
            <span>{REFEREE_TEXT_ALREADY_SENT_SHORT}</span>
            {noticeOpen ? (
              <ChevronDown size={12} aria-hidden="true" />
            ) : (
              <ChevronRight size={12} aria-hidden="true" />
            )}
          </button>
          {/* **Outside the collapse, and above it.**

              *Outside*, because the sentences below fold away into the label on
              the toggle and this one is about something that has **not**
              happened yet — that the next chip press would cause — and folding a
              warning about that is dismissing it.

              *Above*, because `.ref-brief` is a 40%-height scroller
              (styles.css § referee mode): put this after the two paragraphs and
              a referee who **expands** the notice pushes it below the fold while
              the Candidates chip stays in view, which is the one arrangement it
              must never be in. Measured in Chrome at 1400px and at 390px,
              2026-09-06. GPT Sol raised the scroller; the browser pass found the
              fold.

              src/messages.ts § `REFEREE_CANDIDATES_REACHES_SEARCH` carries the
              rest, including why it is not on the Candidates chip's tooltip. */}
          <p className="ref-notice-ahead">{REFEREE_CANDIDATES_REACHES_SEARCH}</p>
          {noticeOpen && (
            <>
              <p>{REFEREE_TEXT_ALREADY_SENT}</p>
              <p className="ref-notice-also">{REFEREE_DECLARE_IT}</p>
            </>
          )}
        </div>

        {/* **Above the chips, and outside `.ref-panel`**, so it is on screen
            whichever sub-mode is open — rule 5 says the scan runs before anything
            else, and a fifth chip would have made it one more thing a referee can
            fail to press. It is fetched beside the band rather than in front of
            it: the scan takes hundreds of milliseconds on a short paper and about
            nine seconds on a large one, and nothing here waits for it. */}
        <SourceScanNotice state={scan} />
      </div>

      <RefereeViews slug={slug} view={view} onView={(next) => void setView(next)} />

      <div className="ref-panel">
        {/* **Inside the scroller, under the chips, and above the sub-mode** —
            not in `.ref-brief` with the two notices that may never be
            dismissed. src/web/RefereeCard.tsx § where it sits. */}
        {how.open && <RefereeHowCard onClose={() => how.show(false)} />}
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
        />
      </div>
    </ModeSurface>
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
                head={REFEREE_VIEW_LABEL[v]}
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
                /* **The gesture seam for Claims and Candidates.** Pressing
                   either chip with nothing there starts it — Greg's rule about
                   opening a mode, one level down. Criteria and Mirror arm
                   nothing, and the table that says so is
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
              {REFEREE_VIEW_LABEL[v]}
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
 *   src/referee-claims.ts says the same thing in the panel, above the button.
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
};

/**
 * What each button says.
 *
 * A total `Record` rather than a `map` over capitalised keys, so a fifth
 * sub-mode is a red compile here as well as in the switch below —
 * docs/project/typechecking.md. Not in src/web/referee-views.ts: that file is the
 * vocabulary a URL is parsed against and nothing server-side needs these words,
 * where `MODE_LABEL` had a second reader on the far side of the client/server
 * line and had to move.
 */
const REFEREE_VIEW_LABEL: Record<RefereeView, string> = {
  criteria: "Criteria",
  claims: "Claims",
  mirror: "Mirror",
  candidates: "Candidates",
};

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
}: {
  view: RefereeView;
  slug: string;
  blocks: Block[];
  byline?: string | undefined;
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
    default: {
      const unknown: never = view;
      throw new Error(`unknown referee view: ${String(unknown)}`);
    }
  }
}
