/**
 * **Candidates — who could review this paper, and what expertise it would take.**
 *
 * Referee mode's fourth sub-mode, and the one that is not for the referee: it
 * answers an *editor's* question. Greg overruled the plan's own cut of it, and
 * then said what shape it should be:
 *
 * > Probably this should be a special reuse of Chat mode, to get access to
 * > tools and make it interactive and potentially multiple messages back and
 * > forth.
 * >
 * > — Greg, 2026-09-01
 *
 * So underneath this panel is a **chat thread of kind `candidates`**
 * (src/types.ts § ThreadKind), answered by src/converse.ts with a third system
 * prompt, streamed and stored by the machinery every other conversation uses.
 * Nothing here re-implements any of that.
 *
 * ## Chat steers; a list is what you look at
 *
 * The one design decision in this file, and it is the research's rather than
 * mine. There is no prior art for chat plus reviewer-finding, and the nearest
 * analogues — Elicit, Consensus, ReviewerNet — all default to a structured
 * surface with conversation secondary. The HCI evidence is that people *like*
 * chat and *perform worse* with it on comparison tasks, which is exactly what
 * choosing between candidates is
 * (docs/research/260831e-helping-peer-reviewers/editors-and-finding-reviewers.md
 * § 7). So the transcript is how the editor steers — *not that lab, prefer
 * early-career, exclude anyone who trained under X* — and the **shortlist above
 * it is what they read**. A name that scrolls away up a transcript is a name
 * nobody can compare.
 *
 * The shortlist is parsed out of the newest answer that carries one, so "each
 * turn revises it" is a property of reading rather than of a second store to
 * keep in step. src/referee-candidates.ts is the parser and the four rules.
 *
 * ## Why this is not `ChatPanel`
 *
 * `ChatPanel` is the reader's own conversation surface: a thread list, a live
 * voice session, a stance picker, dictation, per-turn profile. None of that
 * belongs to an editor working through names, and the two features that would
 * actively mislead here are the thread list (there is one Candidates thread per
 * paper and the reader never chooses it) and the live session (this
 * conversation is a search, not a talk). It shares what is worth sharing —
 * `useChat`, `CitedMarkdown`, and the `chat-tool*` styles for the strip below —
 * and nothing else.
 *
 * The tool strip is **not decoration**. `CANDIDATES_SYSTEM` inherits chat's
 * "never claim a tool you did not run" rule, and that rule's whole force is the
 * sentence *the reader is shown a list of exactly which tools ran*. A panel
 * that hid the strip would make that sentence false and the rule unenforceable.
 *
 * docs/project/referee-mode.md § 4.
 */
import { useMemo, useState } from "react";
import { Globe, LoaderCircle, SendHorizontal, Square } from "lucide-react";
import type { Block, BlockId, ChatMessage, ChatThread, Citation } from "../types.js";
import {
  ALL_DROPPED,
  COI_NOT_CHECKED,
  CANDIDATES_OPENING,
  INDEXING_SKEW,
  MAX_CANDIDATES,
  NO_BYLINE_TO_EXCLUDE,
  NO_NAMES_YET,
  type Candidate,
  type DroppedCandidates,
  type Shortlist,
  anyDropped,
  authorKeys,
  citedUrls,
  excludedByByline,
  nameKey,
  readShortlist,
  redactNames,
  withoutShortlist,
} from "../referee-candidates.js";
import { CitedMarkdown } from "./Cited.js";
import { ControlTip, Tooltip } from "./Tooltip.js";
import { BlockRef } from "./BlockRef.js";
import { hostOf } from "../urls.js";
import { useChat } from "./useChat.js";
import { useRenderCount } from "./perf.js";

/**
 * The band: the thread, the fetch that belongs to it, and the opening turn
 * behind its button.
 *
 * **There is no automatic turn any more**, and this docstring said there was
 * until 2026-09-02. The opening ask used to fire from a `useEffect` on mount;
 * it now fires from `StartBrief`'s press and from nothing else — see
 * `startBrief` below.
 *
 * A component of its own for `ConversationBand`'s reason — `useChat` fetches on
 * mount, and a reader who never opens this sub-mode should not pay for it.
 */
export function CandidatesBand({
  slug,
  blocks,
  byline,
  onJump,
}: {
  slug: string;
  /** The article, so a cited block id can be checked and jumped to. */
  blocks: Block[];
  /**
   * **The paper's byline, for rule 2 and for nothing else.**
   *
   * This is the one call in Referee mode that legitimately sees who wrote the
   * paper — a stated exception to the mode's identity-stripping rule
   * (docs/project/referee-mode.md, rule 4) — and it sees it *in order to leave
   * those people out*. The model is told the same thing through the ordinary
   * article prompt; this copy is what actually removes a row.
   */
  byline?: string | undefined;
  onJump(id: BlockId): void;
}) {
  useRenderCount("CandidatesBand");
  const { threads, loaded, loadFailed, send, stop, error } = useChat(slug);

  const thread = useMemo(() => firstCandidatesThread(threads), [threads]);

  /**
   * **The thread opens with the fit brief — and it opens on a press.**
   *
   * The brief itself is the safe half of the feature: what a competent reviewer
   * of this paper would need to know, every requirement anchored to the passage
   * that motivates it. It has no hallucinated-person failure mode, it is useful
   * on its own, and it is the query the conversation then refines — so if the
   * names layer disappoints, this still stands.
   *
   * **What changed on 2026-09-02 is when it runs.** It used to fire from a
   * `useEffect` the moment this sub-mode first mounted, which made Candidates
   * the one chip in the radiogroup that spends money on being looked at — the
   * other three are inert to a press. A first-time referee clicking along the
   * row to find out what the four words mean paid for a run and, worse, sent
   * search terms drawn from an unpublished manuscript to a search engine. That
   * is **a different third party at a different time** from the model provider
   * the band's notice is about, and the notice cannot cover it: the notice is in
   * the past tense, and this had not happened yet.
   * docs/plans/260902f-make-referee-mode-understandable.md § Stage 3.
   *
   * So `startBrief` is what the button below calls, and nothing else calls it.
   * `loaded` still guards it for `ConversationBand`'s reason — without it "no
   * Candidates thread" and "the fetch has not come back" are the same state, and
   * a press in that window would mint a second thread beside the stored one —
   * but it now also guards the *button*, which is not drawn until the fetch has
   * answered. Everything after the first press is exactly as it was: the thread
   * is stored, and coming back to the sub-mode finds it and asks nothing.
   */
  const startBrief = () => {
    if (!loaded || thread) return;
    /* `null` for the thread id mints one; `false` for the profile because this
       answer is for an editor deciding who to invite, and how the reader likes
       their own reading explained has no bearing on it. No `at`: the brief is
       about the whole paper. */
    send(null, CANDIDATES_OPENING, null, false, undefined, undefined, "candidates");
  };

  return (
    <CandidatesPanel
      thread={thread}
      loaded={loaded}
      loadFailed={loadFailed}
      blocks={blocks}
      byline={byline}
      error={error}
      onAsk={(question) => {
        if (!thread) return;
        send(thread.id, question, null, false, undefined, undefined, "candidates");
      }}
      onStop={(messageId) => thread && stop(thread.id, messageId)}
      onStart={startBrief}
      onJump={onJump}
    />
  );
}

/**
 * **The most recently updated Candidates thread**, and there is normally exactly
 * one.
 *
 * Nothing offers to start a second: the band creates one when there is none and
 * then uses it for ever. More than one can still exist — two tabs open on a new
 * paper at the same moment, each minting an id before either had fetched — so
 * this picks rather than asserting, and picks the one the editor last spoke to.
 */
function firstCandidatesThread(threads: ChatThread[]): ChatThread | null {
  const mine = threads.filter((t) => t.kind === "candidates");
  if (mine.length === 0) return null;
  return (
    [...mine].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null
  );
}

/**
 * The panel, as a pure function of what it is given.
 *
 * Exported for tests/referee-candidates-panel.test.tsx, which renders it with no
 * router and no fetch — the seam every other referee panel already has.
 */
export function CandidatesPanel({
  thread,
  loaded,
  loadFailed,
  blocks,
  byline,
  error,
  onAsk,
  onStop,
  onStart,
  onJump,
}: {
  thread: ChatThread | null;
  loaded: boolean;
  loadFailed: boolean;
  blocks: Block[];
  byline?: string | undefined;
  error: string | null;
  onAsk(question: string): void;
  onStop(messageId: string): void;
  /**
   * **Start the first turn** — the one press that spends the money.
   *
   * Only ever called from `StartBrief` below, and only while there is no
   * thread. See `CandidatesBand` for what used to call it and why that was
   * wrong.
   */
  onStart(): void;
  onJump(id: BlockId): void;
}) {
  const messages = thread?.messages ?? [];
  const last = messages.at(-1);
  const busy = last?.status === "pending";

  /** Id to text, which is both the jump target and `Cited`'s "is this real" check. */
  const blockText = useMemo(
    () => new Map(blocks.map((b) => [b.id, b.text])),
    [blocks],
  );

  /**
   * The shortlist, everything the four rules needed to decide it, and the names
   * they refused.
   *
   * Recomputed on every streamed token, which is cheap and is also the point:
   * an unclosed fence parses to nothing, so the list on screen stays the
   * previous turn's until this turn's is complete and checked. There is no
   * frame in which an unvalidated name is visible — in the list *or*, since
   * 2026-09-01, in the prose beside it.
   */
  const { shortlist, refused } = useMemo(
    () => latestShortlist(messages, blocks, byline),
    [messages, blocks, byline],
  );

  return (
    <div className="cnd">
      <p className="cnd-what">
        Who could review this paper, and what expertise it would take — the editor's question
        rather than the referee's. It searches the web; every name it shows carries a link the
        search returned.
      </p>

      {!loaded && !loadFailed && (
        <p className="cnd-quiet">
          <LoaderCircle className="cmt-spinner" size={13} aria-hidden /> opening…
        </p>
      )}
      {loadFailed && <p className="cnd-error">Could not load this conversation.</p>}
      {error && <p className="cnd-error">{error}</p>}

      {/* **Nothing has been asked yet, and nothing will be until this is
          pressed.** Drawn only once the fetch has answered, so it never appears
          in front of a thread that is on its way — a press in that window would
          mint a second thread beside the stored one. */}
      {loaded && !loadFailed && !thread && <StartBrief onStart={onStart} />}

      {/* **The shortlist above the transcript**, because it is the thing being
          compared and the transcript is the thing being steered. See the header. */}
      <Shortlisted shortlist={shortlist} byline={byline} onJump={onJump} />

      <ol className="cnd-turns">
        {messages.map((m) => (
          <li key={m.id} className={`cnd-turn ${m.role}`}>
            <Turn
              message={m}
              blocks={blockText}
              refused={refused}
              shown={shortlist?.candidates ?? EMPTY}
              onJump={onJump}
              onStop={onStop}
            />
          </li>
        ))}
      </ol>

      <Composer busy={busy} disabled={!thread} onAsk={onAsk} />
    </div>
  );
}

/**
 * **The press that starts it**, and the sentence that says what the press costs.
 *
 * Two facts, both of them before the money rather than after it, and the second
 * is the one a cost line would normally leave out: this is the only place in
 * Referee mode that reaches a **search engine**, which is a different third
 * party from the model provider the band's notice is about. A referee who has
 * read that notice has not been told about this one.
 *
 * **The words are on the screen, not in a card.** There is a card as well, for
 * the detail — but a tooltip is not read by anybody in a hurry, and what it
 * would be hiding here is that pressing this sends terms drawn from an
 * unpublished manuscript out to be searched. docs/project/copy.md.
 *
 * ## What the button said until 2026-09-02, and why it was false both ways
 *
 * It said *"Find reviewers — one model call and a web search"*, and a
 * cross-family review took that apart. Both halves were wrong, in opposite
 * directions:
 *
 * - **Not "find reviewers".** `CANDIDATES_OPENING` in src/referee-candidates.ts
 *   asks for the fit brief and ends *"No names yet."* The press buys the brief;
 *   the names come from a turn the editor asks for afterwards.
 * - **Not "one … and a web search".** Web search is offered on every round and
 *   the model decides whether to use it, so on this opening turn it may run
 *   **zero** times — while the conversation loop makes a fresh provider request
 *   per tool round, up to `MAX_TOOL_ROUNDS + 1` of them (src/converse.ts). A
 *   disclosure that names a count is a disclosure that can be wrong, and this
 *   one was wrong at both ends.
 *
 * **The honest-labelling route was taken rather than the other one on offer**,
 * which was to suppress search and multi-round tools for this opening turn so
 * the one-call promise came true. That would have meant a per-turn tool policy
 * threaded from this button through `useChat`, the chat route and into
 * `converse`, so that a *client* could decide what a *server* may call — a new
 * seam in the one place where "what did this cost" has to stay answerable from
 * the server alone. The words were the thing that was wrong; the words are what
 * changed.
 *
 * So it names the product (the brief), and it says *may* about the search
 * because *may* is the truth. The third-party warning stays exactly as strong:
 * when search does run it really does reach Exa through OpenRouter, and a
 * referee cannot know in advance which turn will.
 *
 * No `disabled` state and no busy state: the button is unmounted the moment a
 * thread exists, which `send` makes true synchronously (`useChat` § the
 * optimistic insert), so there is no window in which it can be pressed twice.
 */
function StartBrief({ onStart }: { onStart(): void }) {
  return (
    <div className="cnd-start">
      <Tooltip
        placement="bottom"
        keepSide
        className="tip-soon"
        content={
          <ControlTip
            head="Build the reviewer brief"
            what="The answer is a description of the reader this paper needs — each requirement tied to the passage that asks for it — and no names at all. Names come from a follow-up you ask for, each one with a source."
            how="An AI turn over the whole paper, which may take several provider requests and may run a web search; either way it costs money. A search sends terms drawn from the paper to a search engine, which is a different third party from the model. Nothing here has run until you press it."
          />
        }
      >
        <button type="button" className="cnd-start-btn" onClick={onStart}>
          <Globe size={13} aria-hidden="true" /> Build the reviewer brief
        </button>
      </Tooltip>
      <p className="cnd-start-note">
        Nothing has been asked yet. Pressing this starts an AI turn over the paper, and it may run a
        web search — which would send terms drawn from the paper to a search engine, as well as to
        the model.
      </p>
    </div>
  );
}

/**
 * The newest answer that carries a shortlist, validated — **and every name this
 * thread refused**, which is what the prose is then cut against.
 *
 * **Newest that carries one, not simply newest.** The editor asks follow-up
 * questions — *what would it take to judge the statistics?* — and the model
 * answers them in prose with no fence. Reading only the last answer would blank
 * the list every time they asked something, and re-populate it whenever they
 * asked for names again, which reads as the app losing the work.
 *
 * One forward walk rather than a backward one, because the two things it
 * returns want opposite directions: the shortlist is the *last* fence, and the
 * refused set is *every* fence, since every turn's prose is on screen at once.
 * Walking forward also gives the citation pool its scope for free.
 */
function latestShortlist(
  messages: readonly ChatMessage[],
  blocks: readonly Block[],
  byline: string | null | undefined,
): { shortlist: Shortlist | null; refused: string[] } {
  const blockIds = new Set(blocks.map((b) => b.id));
  const authors = authorKeys(byline);

  /* **Only what had come back by the time each answer was written.** Built up
     as the walk goes forward rather than gathered from the whole thread first,
     which is the whole of the fix: every earlier turn's citations count, because
     the model re-emits the whole list each turn and a person found in turn two
     is still in turn five's fence — but nothing from *after* an answer may
     validate it, or a search run at turn five stands up a name written at turn
     two, and a rule that can be satisfied by waiting is not one. The unsliced
     version shipped and a cross-family review found it, 2026-09-01.
     src/referee-candidates.ts § citedUrls. */
  const allowed = new Map<string, Citation>();
  let shortlist: Shortlist | null = null;
  /* Every name any answer in this thread put forward and did not get shown for.
     Collected across the whole thread because the *prose* of every turn is on
     screen at once, not just the newest — see `Turn`. */
  const refused = new Set<string>();

  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const [url, c] of citedUrls([m])) if (!allowed.has(url)) allowed.set(url, c);
    const list = readShortlist(m.text, { allowed, blockIds, authors });
    if (!list) continue;
    shortlist = list;
    for (const name of list.refused) refused.add(name);
  }

  /* A name refused at turn two and shown at turn five is shown: the later fence
     is the current shortlist, and blanking it out of the older paragraph would
     be the panel disagreeing with itself. */
  const standing = new Set(
    (shortlist?.candidates ?? []).map((c) => nameKey(c.name)).filter((k): k is string => k !== null),
  );
  return {
    shortlist,
    refused: [...refused].filter((n) => {
      const k = nameKey(n);
      return k === null || !standing.has(k);
    }),
  };
}

/**
 * The shortlist, and — always — what was not checked to produce it.
 *
 * Three sentences are printed whatever the list says, and none of them is the
 * model's:
 *
 * - **`COI_NOT_CHECKED`**, because half of what publishers call a conflict is
 *   mechanically checkable from public data and this app checks none of it, and
 *   the other half is not automatable by anybody. Saying nothing would read as a
 *   filter that ran, and presenting an algorithmic pass as though it caught
 *   everything is the specific move the research says editors already distrust.
 * - **`INDEXING_SKEW`**, which is the honest version of the bias finding and the
 *   useful one: it tells the editor what they are looking at.
 * - **which byline the author exclusion actually ran against**, or that there
 *   was none to run it against. Rule 2 has a code half and a prompt half and
 *   they are not the same strength.
 */
function Shortlisted({
  shortlist,
  byline,
  onJump,
}: {
  shortlist: Shortlist | null;
  byline?: string | undefined;
  onJump(id: BlockId): void;
}) {
  if (!shortlist) {
    return (
      <section className="cnd-list-box" aria-label="Shortlist">
        <p className="cnd-quiet">{NO_NAMES_YET}</p>
      </section>
    );
  }
  const { candidates, dropped, omitted } = shortlist;
  return (
    <section className="cnd-list-box" aria-label="Shortlist">
      {/* **Each turn replaces this list; it does not add to it.** That is a
          property of how the shortlist is read rather than stored — it is parsed
          out of the newest answer that carries one (`latestShortlist`) — and it
          is invisible on screen: an editor who says *"prefer early-career"* and
          watches four of the five names disappear has no way to tell a revision
          from a bug. The heading is where that belongs, because the heading is
          the thing the list is under. */}
      <Tooltip
        placement="left"
        className="tip-soon"
        content={
          <ControlTip
            head="Shortlist"
            what="Who the model thinks could review this paper, from the newest answer in the conversation below."
            how="Every answer that carries a list replaces this one whole — nothing accumulates, so steering the conversation can drop a name you liked. The order is the model's and is not a ranking, and no conflict-of-interest check has run."
          />
        }
      >
        <h3 className="cnd-list-head">
          Shortlist
          <span className="cnd-count">
            {candidates.length} {candidates.length === 1 ? "name" : "names"}
          </span>
        </h3>
      </Tooltip>
      {candidates.length === 0 ? (
        <p className="cnd-quiet">{ALL_DROPPED}</p>
      ) : (
        <ol className="cnd-list">
          {candidates.map((c) => (
            <CandidateRow key={c.name} candidate={c} onJump={onJump} />
          ))}
        </ol>
      )}
      <Dropped dropped={dropped} />
      {omitted > 0 && (
        /* **The cap says so.** Stopping at forty quietly would turn *position in
           the model's list* into a ranking, in the one panel built to have none —
           and a list that silently truncates is the exact shape
           docs/reusable/silent-success.md is about. Mirror prints
           `placementsOmitted` and Claims prints its drops for the same reason. */
        <p className="cnd-dropped">
          {omitted} more {omitted === 1 ? "name was" : "names were"} listed after the first{" "}
          {MAX_CANDIDATES} and {omitted === 1 ? "was" : "were"} not read. Narrow the search rather
          than reading this as the end of the list.
        </p>
      )}
      <p className="cnd-caveat">{INDEXING_SKEW}</p>
      <p className="cnd-caveat">{byline ? excludedByByline(byline) : NO_BYLINE_TO_EXCLUDE}</p>
      <p className="cnd-caveat">{COI_NOT_CHECKED}</p>
    </section>
  );
}

/**
 * One name: who, which requirement they answer, the passage behind it, and the
 * pages the search returned.
 *
 * **No ordinal and no score.** Referee mode's rule 1 is *no verdict, ever*, and
 * a number beside a person is one glance from a ranking of people — which is
 * also the thing the research says a matching tool must not do, since ordering
 * by anything that looks like prominence reproduces a measured bias
 * mechanically. The order the model chose is the order shown, and the panel
 * offers no way to re-sort it.
 */
function CandidateRow({
  candidate,
  onJump,
}: {
  candidate: Candidate;
  onJump(id: BlockId): void;
}) {
  return (
    <li className="cnd-row">
      <p className="cnd-name">
        {candidate.name}
        {candidate.affiliation && (
          /* Labelled as the model's claim rather than printed as a fact: nothing
             here verified where anybody works. */
          <span className="cnd-affil"> — said to be at {candidate.affiliation}</span>
        )}
      </p>
      <p className="cnd-requirement">
        {candidate.requirement} <BlockRef id={candidate.blockId} onJump={onJump} />
      </p>
      {candidate.why && <p className="cnd-why">{candidate.why}</p>}
      <ul className="cnd-sources">
        {candidate.sources.map((s) => (
          <li key={s.url}>
            {/* `rel="noreferrer noopener"`, as everything the model can put an
                address into gets. The label is the **search result's** title and
                the host is printed beside it, so what the reader is about to open
                is not something the model chose the words for. */}
            <a href={s.url} target="_blank" rel="noreferrer noopener">
              {s.title ?? s.url}
            </a>
            <span className="cnd-host"> {hostOf(s.url)}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * What the rules threw away, by reason.
 *
 * Printed rather than swallowed, because a shortlist that silently shrank is the
 * failure docs/reusable/silent-success.md is about — and because the two
 * sentences it lets the panel tell apart are very different: *the model named
 * nobody* and *the model named eleven people and none of them could be shown*.
 * Criteria shipped without that distinction and a second cross-family review
 * reopened it.
 */
function Dropped({ dropped }: { dropped: DroppedCandidates }) {
  if (!anyDropped(dropped)) return null;
  const lines: string[] = [];
  if (dropped.uncited > 0) {
    lines.push(
      `${dropped.uncited} had no source link the web search returned, so ${dropped.uncited === 1 ? "it is" : "they are"} not shown`,
    );
  }
  if (dropped.authors > 0) lines.push(`${dropped.authors} matched the paper's own byline`);
  if (dropped.unanchored > 0) {
    lines.push(`${dropped.unanchored} named no passage in this paper`);
  }
  if (dropped.duplicate > 0) lines.push(`${dropped.duplicate} was already on the list`);
  if (dropped.malformed > 0) lines.push(`${dropped.malformed} could not be read`);
  return <p className="cnd-dropped">Dropped: {lines.join("; ")}.</p>;
}

/** Nothing shown yet, as a stable reference so `Turn` does not re-render on every paint. */
const EMPTY: Candidate[] = [];

/**
 * One turn — the editor's words, or the model's answer with its shortlist taken
 * out **and every refused name cut out of what is left**.
 *
 * The second half is the fix for the hole a cross-family review found on
 * 2026-09-01: hiding the JSON block hid the *evidence*, not the *names*, so a
 * model that listed six people in the fence and introduced the same six in the
 * paragraph above it put all six on screen beside an empty shortlist. The rule
 * was true of the data and false of the page.
 *
 * The paragraph itself stays, deliberately. What was searched, which subfields
 * were covered and why somebody fits is the point of this sub-mode, and an
 * editor who lost the transcript would be worse off than one reading a name too
 * many. src/referee-candidates.ts § redactNames.
 */
function Turn({
  message,
  blocks,
  refused,
  shown,
  onJump,
  onStop,
}: {
  message: ChatMessage;
  blocks: Map<string, string>;
  /** Every name this thread put forward and did not show. */
  refused: readonly string[];
  /** The names that *are* on the shortlist, so a refused surname cannot blank one of theirs. */
  shown: readonly Candidate[];
  onJump(id: BlockId): void;
  onStop(messageId: string): void;
}) {
  if (message.role === "user") return <p className="cnd-asked">{message.text}</p>;
  /* **The fence never reaches the screen.** `withoutShortlist` also cuts an
     *unclosed* one, which is what a streaming answer looks like for the second
     it takes the JSON to arrive — so the reader never watches raw JSON scroll
     past, and never sees a name before the four rules have looked at it. */
  const prose = redactNames(withoutShortlist(message.text), refused, shown);
  const thinking = message.status === "pending" && prose === "" && (message.tools?.length ?? 0) === 0;
  return (
    <>
      <Tools tools={message} />
      {thinking ? (
        <span className="chat-thinking">
          <LoaderCircle className="cmt-spinner" size={13} /> thinking…
        </span>
      ) : (
        prose !== "" && (
          <CitedMarkdown
            text={prose}
            blocks={blocks}
            onJump={onJump}
            live={message.status === "pending"}
            partial={message.status === "pending"}
            /* Chat's `LINKING TO THE WEB` rule governs this prompt too — it is
               interpolated into all three — so an address in the prose is one a
               tool returned. src/web/Cited.tsx § links. */
            links
          />
        )
      )}
      {message.status === "pending" && (
        <button type="button" className="cnd-stop" onClick={() => onStop(message.id)}>
          <Square size={11} aria-hidden /> Stop
        </button>
      )}
      {message.status === "error" && <p className="cnd-error">{message.error}</p>}
    </>
  );
}

/**
 * What this answer actually ran, above it.
 *
 * A cut-down `ToolStrip` rather than `ChatPanel`'s, and it reuses that
 * component's classes deliberately: two strips that look different would say the
 * two panels mean different things by "searched the web". Importing the real one
 * would mean importing `ChatPanel.tsx`, which brings the live voice session, the
 * dictation field and the thread list with it.
 *
 * It is load-bearing rather than decorative — see the file header.
 */
function Tools({ tools }: { tools: ChatMessage }) {
  const runs = tools.tools ?? [];
  const searches = tools.searches ?? 0;
  if (runs.length === 0 && searches === 0) return null;
  return (
    /* **The strip is the evidence for a rule, and nothing on it says so.** It
       reads as a progress indicator — a globe and the words "searched the web" —
       where what it actually is is the enforcement of `CANDIDATES_SYSTEM`'s
       "never claim a tool you did not run": the rule's whole force is that the
       reader is shown exactly which tools ran, so a strip nobody understands is
       a rule nobody can check. The card is on the list rather than on each row,
       because the fact is about the list. */
    <Tooltip
      placement="left"
      className="tip-soon"
      content={
        <ControlTip
          head="What this answer actually ran"
          what="Every tool call the model made while writing the answer below, listed as it ran."
          how="This is the check on the names, not decoration: the model is told never to claim a search it did not run, and this is where you see whether it did. A search sends terms drawn from the paper to a search engine — a third party the rest of Referee mode does not reach."
        />
      }
    >
      <ul className="chat-tools">
        {searches > 0 && (
          <li className="chat-tool">
            <Globe size={12} aria-hidden />
            <span className="chat-tool-label">
              searched the web{searches > 1 ? ` (${searches} searches)` : ""}
            </span>
          </li>
        )}
        {runs.map((run, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the same tool can legitimately run twice in one answer, so name-plus-label is not unique; useChat assigns into this array by index, so the index IS the row's identity. Same call as ChatPanel's ToolStrip.
          <li key={`${i}-${run.name}`} className={`chat-tool${run.status === "running" ? " running" : ""}`}>
            {run.status === "running" ? (
              <LoaderCircle className="cmt-spinner" size={12} aria-hidden />
            ) : (
              <Globe size={12} aria-hidden />
            )}
            <span className="chat-tool-label">{run.label}</span>
            {run.detail && <span className="chat-tool-detail">{run.detail}</span>}
          </li>
        ))}
      </ul>
    </Tooltip>
  );
}

/** Where the editor scopes the search. */
function Composer({
  busy,
  disabled,
  onAsk,
}: {
  busy: boolean;
  disabled: boolean;
  onAsk(question: string): void;
}) {
  const [text, setText] = useState("");
  const send = () => {
    const question = text.trim();
    if (question === "" || busy || disabled) return;
    setText("");
    onAsk(question);
  };
  return (
    <div className="cnd-composer">
      <textarea
        className="cnd-box"
        rows={2}
        value={text}
        placeholder="Scope the search — a method, a subfield, people to leave out…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          /* Enter sends, Shift+Enter is a newline — chat's own arrangement, so a
             reader who has used one composer in this app has used both. */
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button
        type="button"
        className="cnd-send"
        disabled={busy || disabled || text.trim() === ""}
        onClick={send}
      >
        <SendHorizontal size={13} aria-hidden /> Ask
      </button>
    </div>
  );
}
