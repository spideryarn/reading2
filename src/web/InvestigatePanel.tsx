/**
 * **Sources › Investigate** — the owner's questions for Chat about the piece and what
 * others say about it. A tool reached from *Where it sits* since plan 261025h
 * (no longer a chip), which also moved the literature search's dossier out
 * of its top. Plan
 * docs/plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md
 * § Stage 2.
 *
 * > let's also add a new Chat sub-mode to the Sources mode (pick a name for
 * > it) for basically doing lots of searching to try and figure out what
 * > people think about the article, about the articles it has cited, and
 * > whether its claims have been supported
 * >
 * > — Greg, 2026-10-19 (spya-x4xpw4)
 *
 * ```
 *  ┌ Where it sits │ Bibliography │ Links ┐  Where it sits › Ask your own question  (i)
 *  │ [ Ask about this piece and what others say…   ] [💬 Ask in chat]
 *  │ YOUR QUESTIONS                    ← every chat started here, newest first
 *  │  💬 “replication attempts”                                       2
 *  │ SUGGESTED FOR THIS PIECE          ← the literature search's, once it has run
 *  │ SUGGESTED
 *  │  💬 How has this piece been received, and by whom?
 *  │ ABOUT ITS CLAIMS                  ← only when Claims' list has been made
 *  │  💬 Is “a starter needs cool water” borne out?     (or its chat's mark)
 *  │ ABOUT THE WORKS IT CITES          ← the three it leans on most
 *  │  💬 How has “Starter hydration” (Smith et al. 2019) held up? (or its chat's mark)
 * ```
 *
 * **Arriving opens the newest of *Your questions* beside Sources** (plan
 * 261021b, § `useReopenNewest` below), so coming back to Investigate shows the
 * conversation rather than only the launcher.
 *
 * **A press sends.** Every row and the box hand a question to Chat
 * (Reader.tsx § `handToChat`), which opens on a fresh conversation and asks
 * it with a web search; nothing on this panel spends until a press, so
 * arriving here, Back and a restore buy nothing (activation.ts §
 * `activationForSources` answers `null` for Investigate). Each press is one ordinary
 * chat turn through Chat's own route and limits (GPT Sol's F9 on the plan).
 *
 * **Where each question's words come from, and what its chat remembers**:
 *
 * - the box and a suggested question: the words themselves, stored as a
 *   `reception` lens (`{ mode: "reception", lens }`), sent by
 *   chat-handoff.ts § `askInSources`. They come back under *Your questions*;
 * - a claim: Claims' own sender (`onCheck`, a `ClaimOrigin`), so Claims shows
 *   the same mark for it, and a press on a claim that has a chat shows that
 *   chat's mark here instead of a button;
 * - a work: Bibliography's own sender (`onAskWork`, the work's
 *   `bibliography` origin), the same way.
 *
 * **Tailored without a model call.** The claims come from Claims' stored
 * list, when the owner has made it (this panel never buys it), the first
 * `INVESTIGATE_CLAIMS_SHOWN` in article order; the works are Bibliography's
 * `INVESTIGATE_WORKS_SHOWN` it leans on most (`relevance`). Both lists are read by
 * the band already. The only questions a model writes are *Suggested for
 * this piece*, the literature search's (`pieceQuestions`).
 *
 * **Owner only.** A visitor has no chat, so their chip row has no Investigate and a
 * shared `?sources=investigate` draws Bibliography (params.ts § `visitorSourcesView`).
 *
 * The box is Glossary's *Look up a term* (`.gloss-ask`), as Reception's
 * angle box was until this sub-mode took it: the same field, the reader's
 * face from voices.css, and room left for the band's (i). No sentence under
 * it (docs/project/mode.md): what a press does is in each control's tooltip.
 */
import { MessagesSquare } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { CitedWork, ClaimOrigin, ListedClaim, SituateFinding, ThreadSummary } from "../types.js";
import { MAX_LENS_CHARS } from "../types.js";
import { MODE_LABEL } from "../title-text.js";
import { shortTitle, workShortName } from "./cited-in-paragraph.js";
import { isImeComposing } from "./key-chord.js";
import { ModeSurface } from "./ModeSurface.js";
import { OPEN_WORK_CHAT, OriginChatMark, originChatTip } from "./OriginChat.js";
import { SOURCES_CLAIMS_OPEN_CLAIM_CHAT } from "./ReceptionAndClaimsPanel.js";
import { lensThreads, threadForOrigin } from "./useChatAnchors.js";
import { itemOrigin } from "./chat-handoff.js";
import { SituateQuestions } from "./SituateDossier.js";

/**
 * **What Investigate's rows are handed**: the reading view's thread summaries, the
 * three senders, and the way back. Built by `Reader` from the raw
 * `chatSummaries` and the same senders Claims and Bibliography are handed, so
 * a press here and a press there record the same origin and find the same
 * mark (docs/project/chat-from-a-mode.md, step 10).
 */
export interface SourcesInvestigateChats {
  summaries: readonly ThreadSummary[];
  /**
   * Whether `summaries` has answered at least once (useChatAnchors.ts §
   * `loaded`). Until it has, an empty list means "not known yet", and the
   * arrival below waits rather than deciding there is nothing to open.
   */
  loaded: boolean;
  /**
   * Whether something already holds the place beside the mode: a `?thread=`
   * (a conversation shown there, or Chat's state still carried across while
   * no dialog draws it), an unsent passage chat, an open note, or an annotation
   * in progress. The arrival never opens over any of them.
   */
  occupied: boolean;
  /** Hand this question to Chat and send it, stored as a `reception` lens (Reader.tsx § `askSourcesQuestion`). */
  onQuestion(question: string): void;
  /** Claims' sender: start this claim's chat, or reopen it (Reader.tsx § `checkClaim`). */
  onCheck(origin: ClaimOrigin): void;
  /** Bibliography's sender: start this work's chat, or reopen it (Reader.tsx § `askWork`). */
  onAskWork(work: CitedWork): void;
  /**
   * A literature-search finding's sender, for *Where it sits*' dossier: start
   * its chat, or reopen it (Reader.tsx § `askFinding`, plan 261025h). Carried
   * in this bundle because it is built from the same summaries and senders.
   */
  onFinding(finding: SituateFinding): void;
  /** Open a conversation already started, beside Sources. */
  onOpen(threadId: string): void;
}

/** The box: its accessible name, and (with an ellipsis) its placeholder. */
export const SOURCES_INVESTIGATE_LABEL = "Ask about this piece and what others say";
/** The box's button. The words Glossary's handoff to Chat already uses. */
export const SOURCES_INVESTIGATE_SEND = "Ask in chat";
/** The tooltip on the button and on every question row: where a press goes, and that it asks at once. */
export const SOURCES_INVESTIGATE_TIP = "Opens Chat and asks this straight away, with a web search.";

/** The fixed questions, in the order a reader new to the debate would ask them. */
export const SOURCES_INVESTIGATE_SUGGESTED: readonly string[] = [
  "How has this piece been received, and by whom?",
  "Are its main claims borne out by later work?",
  "Who disagrees with it most strongly, and on what grounds?",
  "Have the studies it leans on been replicated, challenged or retracted?",
  "What has been published since that changes the picture?",
];

/** The section headings, in our voice. */
export const SOURCES_INVESTIGATE_SUGGESTED_HEAD = "Suggested";
export const SOURCES_INVESTIGATE_CLAIMS_HEAD = "About its claims";
export const SOURCES_INVESTIGATE_WORKS_HEAD = "About the works it cites";
export const SOURCES_INVESTIGATE_YOURS_HEAD = "Your questions";
/** A line of *Your questions*: its accessible name. */
export const SOURCES_INVESTIGATE_OPEN_CHAT = "Open the chat about this question";

/** How many claims, at most, in article order. */
export const INVESTIGATE_CLAIMS_SHOWN = 4;
/** How many cited works, at most, most leaned on first. */
export const INVESTIGATE_WORKS_SHOWN = 3;
/** How many of *Your questions* are on screen before *Show all*. */
export const INVESTIGATE_YOURS_SHOWN = 3;

/**
 * **The claims Investigate offers**: the first few of Claims' list, which is stored in
 * document order (src/types.ts § `SourcesClaimList.claims`), so the first are
 * the article's earliest. `null` (no list, or not current) offers none.
 */
export function investigateClaims(claims: readonly ListedClaim[] | null): readonly ListedClaim[] {
  return claims === null ? [] : claims.slice(0, INVESTIGATE_CLAIMS_SHOWN);
}

/**
 * **The works Investigate offers**: the few the piece leans on most, by the model's
 * `relevance`, ties in the bibliography's order. A work with no score is left
 * out rather than ranked, because "leans on most" is the score's claim.
 * *Where it sits*' *What it builds on* is the same ranking, with its own length
 * (WhereItSitsPanel.tsx, plan 261025h).
 */
export function investigateWorks(
  works: readonly CitedWork[] | null,
  shown: number = INVESTIGATE_WORKS_SHOWN,
): readonly CitedWork[] {
  if (works === null) return [];
  return works
    .map((work, at) => ({ work, at }))
    .filter((w): w is { work: CitedWork & { relevance: number }; at: number } => typeof w.work.relevance === "number")
    .sort((a, b) => b.work.relevance - a.work.relevance || a.at - b.at)
    .slice(0, shown)
    .map((w) => w.work);
}

export function InvestigatePanel({
  head,
  chats,
  claims,
  works,
  pieceQuestions = [],
}: {
  /** Sources' chip row (SourcesMode.tsx § `SourcesViews`), drawn as this band's header. */
  head: ReactNode;
  chats: SourcesInvestigateChats;
  /** Claims' stored list when it is current, else `null` (SourcesMode.tsx). */
  claims: readonly ListedClaim[] | null;
  /** Bibliography's works, else `null`. */
  works: readonly CitedWork[] | null;
  /**
   * *Suggested for this piece*: the questions the literature search wrote
   * (SituateDossier.tsx § `SituateQuestions`, plan 261024o), drawn above the
   * fixed five once it has run. Its dossier is *Where it sits*' since plan
   * 261025h; its questions stayed here, with the others.
   */
  pieceQuestions?: readonly string[];
}) {
  const shownClaims = investigateClaims(claims);
  const shownWorks = investigateWorks(works);
  useReopenNewest(chats);
  return (
    <ModeSurface
      label={MODE_LABEL.sources}
      feature="gloss investigate sources"
      mode="sources"
      about={
        <>
          <p>{SOURCES_INVESTIGATE_ABOUT}</p>
          {pieceQuestions.length > 0 && <p>{SOURCES_INVESTIGATE_SITUATE_ABOUT}</p>}
        </>
      }
      head={head}
    >
      <QuestionBox onQuestion={chats.onQuestion} />
      <div className="tl-scroll investigate-scroll">
        {/* The reader's own conversations before ours (plan 261021b). */}
        <YourQuestions chats={chats} />

        {/* The model's questions for this piece, above the fixed five (plan
            261024o); each a press, as they are. */}
        <SituateQuestions
          questions={pieceQuestions}
          row={(question) => <InvestigateRow onPress={() => chats.onQuestion(question)}>{question}</InvestigateRow>}
        />

        <section className="investigate-section" aria-labelledby="investigate-suggested-head">
          <h3 id="investigate-suggested-head" className="rcp-group-head investigate-head">
            {SOURCES_INVESTIGATE_SUGGESTED_HEAD}
          </h3>
          <ul className="investigate-list">
            {SOURCES_INVESTIGATE_SUGGESTED.map((question) => (
              <li key={question}>
                <InvestigateRow onPress={() => chats.onQuestion(question)}>{question}</InvestigateRow>
              </li>
            ))}
          </ul>
        </section>

        {shownClaims.length > 0 && (
          <section className="investigate-section investigate-claims" aria-labelledby="investigate-claims-head">
            <h3 id="investigate-claims-head" className="rcp-group-head investigate-head">
              {SOURCES_INVESTIGATE_CLAIMS_HEAD}
            </h3>
            <ul className="investigate-list">
              {shownClaims.map((claim) => {
                const origin: ClaimOrigin = { mode: "sources-claims", blockId: claim.blockId, quote: claim.quote };
                const chat = threadForOrigin(chats.summaries, origin);
                const words = (
                  <>
                    Is “<span className="investigate-quoted voice-author">{claim.quote}</span>” borne out?
                  </>
                );
                return (
                  <li key={claim.id} data-claim={claim.id}>
                    {chat ? (
                      <Asked chat={chat} label={SOURCES_CLAIMS_OPEN_CLAIM_CHAT} onOpen={chats.onOpen}>
                        {words}
                      </Asked>
                    ) : (
                      <InvestigateRow onPress={() => chats.onCheck(origin)}>{words}</InvestigateRow>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {shownWorks.length > 0 && (
          <section className="investigate-section investigate-works" aria-labelledby="investigate-works-head">
            <h3 id="investigate-works-head" className="rcp-group-head investigate-head">
              {SOURCES_INVESTIGATE_WORKS_HEAD}
            </h3>
            <ul className="investigate-list">
              {shownWorks.map((work) => {
                const origin = itemOrigin("bibliography", work.id, work.title);
                const chat = origin ? threadForOrigin(chats.summaries, origin) : undefined;
                /* The title, cut short, then the authors and year: two works
                   by one author in one year would otherwise read alike (the
                   browser pass on plan 261020n). The article's words, so the
                   author's face; the question around them is ours. */
                const byline = workShortName({
                  title: "",
                  ...(work.authors !== undefined ? { authors: work.authors } : {}),
                  ...(work.year !== undefined ? { year: work.year } : {}),
                }).trim();
                const words = (
                  <>
                    How has{" "}
                    <span className="investigate-quoted voice-author">
                      “{shortTitle(work.title.trim())}”{byline !== "" ? ` (${byline})` : ""}
                    </span>{" "}
                    held up?
                  </>
                );
                return (
                  <li key={work.id} data-citation-id={work.id}>
                    {chat ? (
                      <Asked chat={chat} label={OPEN_WORK_CHAT} onOpen={chats.onOpen}>
                        {words}
                      </Asked>
                    ) : (
                      <InvestigateRow onPress={() => chats.onAskWork(work)}>{words}</InvestigateRow>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </ModeSurface>
  );
}

/**
 * **Arriving on Investigate takes you back to your conversation.** Greg,
 * 2026-10-20 (spya-nhwy3d): *"I started an investigate chat … and I can see
 * it listed in the chat threads, but when I go to investigate, it just shows
 * me an empty thing."* So the newest chat under *Your questions* opens beside
 * Sources, where its line would open it (`onOpen`). Plan
 * docs/plans/261021b-investigate-takes-you-back-to-your-conversation.md.
 *
 * - **Once per visit**, a visit being one mount of this panel (the chip, a
 *   link, Back, the way back from Chat): closing the dialog keeps it closed
 *   until the reader leaves Investigate and comes back.
 * - **Only once the summaries have answered**, so a cold load waits and then
 *   opens rather than deciding on a list that has not arrived.
 * - **Never over anything already there** (`occupied`): any `?thread=`,
 *   including the one the reader came back from (Reader.tsx § `openOrigin`
 *   keeps it for a lens) and one Chat carries that no dialog draws; an
 *   unsent passage chat, whose words are kept in `chat-draft.ts`; a note; or an
 *   annotation in progress. Any of these decides the visit at once, before
 *   the summaries arrive (GPT Sol's F1 and F2 on the plan; built-code review).
 * - It opens a stored conversation and sends nothing.
 *
 * A margin finding's *Open in Sources* used to land here too, and this held
 * back for it; it lands on *Where it sits* since plan 261025h, where nothing
 * reopens a conversation.
 */
function useReopenNewest(chats: SourcesInvestigateChats): void {
  const decided = useRef(false);
  const { loaded, occupied, summaries, onOpen } = chats;
  useEffect(() => {
    if (decided.current) return;
    if (occupied) {
      decided.current = true;
      return;
    }
    if (!loaded) return;
    decided.current = true;
    const newest = lensThreads(summaries)[0];
    if (newest) onOpen(newest.id);
  }, [loaded, occupied, summaries, onOpen]);
}

/** The (i)'s paragraph: where the questions come from, and what a press costs. */
export const SOURCES_INVESTIGATE_ABOUT =
  "Each press opens Chat and asks one question with a web search, the same as Ask in chat anywhere else. The questions about claims come from Claims' list once you have made it, and the works are the ones Bibliography says the piece leans on most. No AI writes these questions.";

/** The (i)'s second paragraph, with *Suggested for this piece* on screen: who wrote those questions. */
export const SOURCES_INVESTIGATE_SITUATE_ABOUT =
  "The questions under Suggested for this piece were written by the AI that searched the literature from Where it sits, from the piece and what its searches found.";

/**
 * **A question that sends on a press**: Chat's two bubbles and the words.
 * A plain button rather than `AskInChatButton`'s tap-to-reveal: the row says
 * in full what it will ask, so the first tap is the decision.
 */
function InvestigateRow({ onPress, children }: { onPress(): void; children: ReactNode }) {
  return (
    <button type="button" className="investigate-q" data-tip={SOURCES_INVESTIGATE_TIP} onClick={onPress}>
      <MessagesSquare size={12} aria-hidden="true" />
      <span className="investigate-q-words">{children}</span>
    </button>
  );
}

/**
 * **A claim or a work that already has a chat**: its words, and the shared
 * mark in the button's place (OriginChat.tsx § `OriginChatMark`; plan
 * 261010s, D2: the button or the mark, never both).
 */
function Asked({
  chat,
  label,
  onOpen,
  children,
}: {
  chat: ThreadSummary;
  label: string;
  onOpen(threadId: string): void;
  children: ReactNode;
}) {
  return (
    <div className="investigate-asked">
      <span className="investigate-q-words">{children}</span>
      <OriginChatMark chat={chat} label={label} className="investigate-mark" onOpen={onOpen} />
    </div>
  );
}

/**
 * **The box**: the reader's own question. Enter or the button hands the
 * words to `Reader`, which opens Chat on a fresh conversation and sends them
 * (plan 261006j). It starts no job and has no waiting state: the answer
 * arrives in Chat, which the reader is by then looking at.
 */
function QuestionBox({ onQuestion }: { onQuestion(question: string): void }) {
  const [draft, setDraft] = useState("");
  const words = draft.trim();
  return (
    <div className="gloss-ask investigate-box">
      <form
        className="gloss-ask-row investigate-box-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (words === "") return;
          onQuestion(words);
          /* The words have become the fresh chat's first question. */
          setDraft("");
        }}
      >
        {/* `maxLength` is the origin's cap, counted here before trimming, so
            the box can only refuse what the route would refuse or a little
            more: the harmless direction (GlossaryPanel.tsx § `AskATerm`). */}
        <input
          className="gloss-ask-input"
          type="text"
          /* Enter submits this form and goes to Chat. */
          enterKeyHint="go"
          value={draft}
          maxLength={MAX_LENS_CHARS}
          placeholder={`${SOURCES_INVESTIGATE_LABEL}…`}
          aria-label={SOURCES_INVESTIGATE_LABEL}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            /* Accepting an IME candidate is not a request to open Chat.
               Cancel implicit submission, including engines that report 229
               instead of isComposing; an ordinary Enter still uses the form. */
            if (e.key === "Enter" && isImeComposing(e)) e.preventDefault();
          }}
        />
        <button type="submit" className="gloss-btn investigate-send" disabled={words === ""} data-tip={SOURCES_INVESTIGATE_TIP}>
          <MessagesSquare size={12} aria-hidden="true" />
          {SOURCES_INVESTIGATE_SEND}
        </button>
      </form>
    </div>
  );
}

/**
 * **Your questions** — one line per chat started from this panel's box or a
 * suggested question (and from Reception's angle box before it moved here,
 * plan 261005k), newest first, found in the reading view's thread summaries
 * (`lensThreads`), so nothing is stored on Sources' side. A line opens its
 * chat beside Sources, as a claim's mark does. The newest `INVESTIGATE_YOURS_SHOWN`
 * and then *Show all*, so a reader with many does not scroll past them on a
 * phone. It was Reception's *Your angles* until 2026-10-20.
 */
function YourQuestions({ chats }: { chats: SourcesInvestigateChats }) {
  const [all, setAll] = useState(false);
  const asked = useMemo(() => lensThreads(chats.summaries), [chats.summaries]);
  if (asked.length === 0) return null;
  const shown = all ? asked : asked.slice(0, INVESTIGATE_YOURS_SHOWN);
  return (
    <section className="investigate-section investigate-yours" aria-labelledby="investigate-yours-head">
      <h3 id="investigate-yours-head" className="rcp-group-head investigate-head">
        {SOURCES_INVESTIGATE_YOURS_HEAD}
      </h3>
      <ul className="investigate-list">
        {shown.map((chat) => (
          <li key={chat.id}>
            <button
              type="button"
              className="investigate-yours-line"
              aria-label={`${SOURCES_INVESTIGATE_OPEN_CHAT}: ${chat.origin.lens}`}
              aria-describedby={chat.gist ? `investigate-yours-gist-${chat.id}` : undefined}
              data-tip={originChatTip(SOURCES_INVESTIGATE_OPEN_CHAT, chat.turns, chat.gist ? "gist" : "none")}
              onClick={() => chats.onOpen(chat.id)}
            >
              <MessagesSquare size={12} aria-hidden="true" />
              {/* The question as it was asked, so in the reader's face
                  (docs/project/fonts.md). The quotation marks are ours. */}
              <span className="investigate-yours-quoted">
                “<span className="investigate-yours-words voice-reader">{chat.origin.lens}</span>”
              </span>
              <span className="investigate-yours-count">{chat.turns}</span>
              {/* The chat's gist under the question, as every other item's mark
                  shows it (OriginChat.tsx § OriginChatMark; Greg, 2026-10-10,
                  spya-rbp55k, plan 261011c). The model's words. */}
              {chat.gist && (
                <span id={`investigate-yours-gist-${chat.id}`} className="investigate-yours-gist origin-chat-gist voice-ai">
                  {chat.gist}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {!all && asked.length > INVESTIGATE_YOURS_SHOWN && (
        <button type="button" className="rcp-more investigate-yours-more" onClick={() => setAll(true)}>
          Show all {asked.length}
        </button>
      )}
    </section>
  );
}
