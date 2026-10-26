/**
 * **The literature search in Sources › *Where it sits*** — the dossier the
 * `situate` step writes (src/situate.ts), drawn for every owner since plan
 * docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md
 * (decision 5) moved it out of the experimental switch and out of the top of
 * Investigate. Plan
 * docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md
 * § The dossier made it.
 *
 * ```
 *  SEARCH OF THE LITERATURE
 *  A review from 2023: what has happened since
 *  The report became a reference point … (overview, the model's face)
 *  CHALLENGED · 2
 *   “Ignition is a step-function …”  k3m9qt                         [💬]
 *   The 2025 adversarial collaboration found little ignition …
 *   Nature ↗ · ▸ What it says
 *  SINCE · 4  …  NOT CITED? · 1  …
 *  ▸ 16 searches (15 ran), 76 pages, 40 later papers
 *  [Search again]  Searched 24 Oct 2026
 * ```
 *
 * **Every word a model wrote is text, never markup**: the overview, each note
 * and each question are React children, and a source's quote is a stranger's
 * page's characters. A `dangerouslySetInnerHTML` added here would be an
 * injection. The finding's quote is the article's own characters, stored by
 * the step after it re-found them in the block (block-ids.md), drawn with
 * `Excerpt` as Claims draws its quotes.
 *
 * **Ask in chat stores the finding's own origin** (`findingOrigin`,
 * `{ mode: "situate", itemId }`, since plan 261025h, decision 9): the chat is
 * found again by the finding's id, so a re-run that rewords the note keeps
 * its mark, and its way back opens *Where it sits* on the finding. A chat
 * started before then stored a lens and is still found by it
 * (`findingLensOrigin`), as long as the note reads the same. The overview's
 * chat uses the same origin mode with `situateOverviewId(generatedAt)`, so a
 * new dossier gets a new conversation and its way back lands on the summary.
 */
import { ChevronRight, ExternalLink, Globe } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type BlockId,
  type Situate,
  type SituateFinding,
  type SituateFindingKind,
  type SituateSource,
  situateOverviewId,
  type ThreadSummary,
} from "../types.js";
import { isWebUrl } from "../urls.js";
import { BandWaiting } from "./BandWaiting.js";
import { BlockRef } from "./BlockRef.js";
import { Excerpt } from "./Excerpt.js";
import { JobProgress } from "./JobProgress.js";
import { AskInChatButton, OriginChatMark } from "./OriginChat.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { dayOf } from "./relative-time.js";
import {
  ASK_FINDING_IN_CHAT,
  ASK_OVERVIEW_IN_CHAT,
  OPEN_FINDING_CHAT,
  OPEN_OVERVIEW_CHAT,
  type PassageCluster,
  SITUATE_ABSENCE,
  SITUATE_AGAIN,
  SITUATE_CITERS_SKIPPED,
  SITUATE_COUNTS_LABEL,
  SITUATE_DISCLOSURE,
  SITUATE_FINDING_TIP,
  SITUATE_GROUP_LABEL,
  SITUATE_HEAD,
  SITUATE_NOTHING_FOUND,
  SITUATE_OUTCOME_LABEL,
  SITUATE_QUESTIONS_HEAD,
  SITUATE_RUN,
  SITUATE_SOURCE_SAYS,
  SITUATE_STALE,
  SITUATE_WHAT,
  SITUATE_WORKING,
  findingLensOrigin,
  findingOrigin,
  groupFindings,
  overviewOrigin,
  passageClusters,
  searchedLine,
  situateHeadLine,
  sourceHost,
} from "./situate-dossier.js";
import { DismissibleNotice, STALE_NOTICE_LABEL, STALE_NOTICE_TOOLTIP } from "./StaleNotice.js";
import { type ItemFocus, useLandOnItem } from "./item-focus.js";
import { threadForOrigin } from "./useChatAnchors.js";
import type { UseSituate } from "./useSituate.js";
import { WrittenForYou } from "./WrittenForYou.js";

/** What a finding's chat needs: the summaries, its sender, and the way back (Reader.tsx § `askFinding`). */
export interface SituateChats {
  summaries: readonly ThreadSummary[];
  /** Start this finding's chat with its question, or reopen the one it has. */
  onFinding(finding: SituateFinding): void;
  /** Start the overview's chat, or reopen the one it has (Reader.tsx § `askOverview`). */
  onOverview(situate: Situate): void;
  onOpen(threadId: string): void;
}

/** A finding's chat: by its id, else (a chat started before plan 261025h) by the lens it stored then. */
export function findingChat(summaries: readonly ThreadSummary[], finding: SituateFinding): ThreadSummary | undefined {
  return threadForOrigin(summaries, findingOrigin(finding)) ?? threadForOrigin(summaries, findingLensOrigin(finding));
}

export function SituateDossier({
  owner,
  articleYear,
  chats,
  onJump,
  focus = null,
  onFocusTaken,
}: {
  owner: UseSituate;
  /**
   * The piece's year from its metadata, or `null` — the only year the head
   * line prints. The planner's own `year` is its reading of the text, and
   * printing it said *from 1998* beside Not cited's *we do not know when this
   * piece was published* (situate-dossier.ts § `situateHeadLine`).
   */
  articleYear: number | null;
  chats: SituateChats;
  onJump(id: BlockId): void;
  /**
   * **One dossier item to bring into view, once** — a margin *literature*
   * line's *Open in Sources*, or a finding/overview chat's way back. Its `id`
   * is the finding's stable id or the overview id; each target carries it as
   * `data-finding`. An item this dossier no longer has is handed back
   * unserved (item-focus.ts).
   */
  focus?: ItemFocus | null;
  onFocusTaken?: ((focus: ItemFocus) => void) | undefined;
}) {
  const made = owner.status === "ready" ? owner.situate : null;
  const surface = useRef<HTMLElement>(null);
  const groups = useMemo(() => (made === null ? [] : groupFindings(made.findings)), [made]);
  const groupId = useId();
  /* **Which groups are open**: the first in the reader's order, and the rest
     shut until pressed (plan 261026g § Stage 2) — component state, not the
     address, as *Papers that cite it*'s view is. Keyed to the dossier it was opened on,
     so a new search starts from its own first group. */
  const [opened, setOpened] = useState<{ at: string; kinds: ReadonlySet<SituateFindingKind> } | null>(null);
  /* Memoised so `setKindOpen`, and therefore the focus-opening effect below,
     does not acquire a new dependency merely because the default set was
     reconstructed during an unrelated render. */
  const initiallyOpen = useMemo<ReadonlySet<SituateFindingKind>>(
    () => new Set(groups[0] ? [groups[0].kind] : []),
    [groups],
  );
  const openKinds: ReadonlySet<SituateFindingKind> =
    made !== null && opened?.at === made.generatedAt
      ? opened.kinds
      : initiallyOpen;
  const setKindOpen = useCallback(
    (kind: SituateFindingKind, open: boolean) => {
      if (made === null || openKinds.has(kind) === open) return;
      const kinds = new Set(openKinds);
      if (open) kinds.add(kind);
      else kinds.delete(kind);
      setOpened({ at: made.generatedAt, kinds });
    },
    [made, openKinds],
  );
  /* **The count strip**: open the group and bring its heading to the top of
     the band. The band's own scroller only, never `scrollIntoView`, which
     can move the article and the page as well (GPT Sol's F5 on the plan). */
  const showGroup = (kind: SituateFindingKind) => {
    setKindOpen(kind, true);
    requestAnimationFrame(() => {
      const group = surface.current?.querySelector<HTMLElement>(`details[data-situate-kind="${kind}"]`);
      const scroller = group?.closest<HTMLElement>(".where-scroll");
      if (!group || !scroller) return;
      /* A little room above, so the heading is not flush under the chips. */
      scroller.scrollTop += group.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
    });
  };
  const overviewId = made === null ? null : situateOverviewId(made.generatedAt);
  const focusIsOverview = focus !== null && focus.id === overviewId;
  const focusFinding = focus === null ? undefined : made?.findings.find((f) => f.id === focus.id);
  const focusKnown = focusIsOverview || focusFinding !== undefined;
  /* A finding focus (the margin's *Open in Sources*, a chat's way back) opens
     its group first; an overview focus can land immediately on the summary. */
  const focusKind = focusFinding?.kind;
  useEffect(() => {
    if (focusKind !== undefined) setKindOpen(focusKind, true);
  }, [focusKind, setKindOpen]);
  useLandOnItem({
    focus,
    /* An answer, not a failed read: a focus is not spent on an error, so a
       retry still lands it (GPT Sol's F5 on the plan). */
    ready: owner.status === "ready" || owner.status === "none",
    known: focusKnown,
    drawn: focusIsOverview || (focusKind !== undefined && openKinds.has(focusKind)),
    scope: surface,
    attribute: "data-finding",
    onTaken: onFocusTaken,
  });
  /* **The stale banner's ×, for this page view only.** The kept dismissals
     (useStaleNotices.ts) are keyed by a closed list of modes that the database
     checks (src/stale-notice.ts), and `situate` is not on it yet; until it is,
     the × hides the banner until the reader leaves *Where it sits*. */
  const [staleHidden, setStaleHidden] = useState<string | null>(null);
  const staleShowing = made !== null && owner.stale && staleHidden !== made.generatedAt;

  /* A forced run has finished and its result is not here yet: the forced
     button gives way to a read, never to a second paid run — rewrite-hold.ts. */
  const waiting = owner.rewriting && !owner.job && !owner.starting && !owner.failed;
  const working = owner.job !== null || owner.starting;
  const run = (again: boolean) =>
    again && waiting && !owner.error ? (
      <RewriteWaiting line="The new search hasn't loaded yet." onRead={owner.refresh} className="tw:m-0" />
    ) : (
      <JobProgress
        job={owner.job}
        starting={owner.starting}
        failed={owner.failed}
        stalled={owner.stalled}
        onRun={() => (again ? owner.regenerate() : owner.ensure())}
        runDisabled={again && owner.rewriting}
        onCancel={owner.cancel}
        label={again ? SITUATE_AGAIN : SITUATE_RUN}
        step="situate"
        icon={<Globe size={13} />}
        runningLabel="Searching…"
      />
    );

  return (
    <section ref={surface} className="where-section where-situate" aria-labelledby="where-situate-head">
      <h3 id="where-situate-head" className="rcp-group-head where-head">
        {SITUATE_HEAD}
      </h3>

      {owner.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}
      {owner.status === "loading" && <BandWaiting className="gloss-quiet">Looking for an earlier search…</BandWaiting>}

      {owner.status === "none" && (
        <div className="situate-before">
          <p className="gloss-hint situate-what">{SITUATE_WHAT}</p>
          {run(false)}
          {working ? (
            <p className="gloss-quiet situate-working">{SITUATE_WORKING}</p>
          ) : (
            <p className="gloss-quiet situate-disclosure">{SITUATE_DISCLOSURE}</p>
          )}
        </div>
      )}

      {made !== null && (
        <>
          {staleShowing && (
            <DismissibleNotice
              mode="situate"
              onDismiss={() => setStaleHidden(made.generatedAt)}
              tooltip={STALE_NOTICE_TOOLTIP}
              label={STALE_NOTICE_LABEL}
              failed={null}
              action={run(true)}
            >
              {SITUATE_STALE}
            </DismissibleNotice>
          )}
          {/* No banner for an outdated dossier (older prompt, same article):
              Greg, 2026-09-29, *"it's not worth bugging the user about it"*
              (plan 260929c). Search again is at the foot. */}
          {/* **The summary in a box** (plan 261026g § Stage 2): what the
              planner made of the piece, the overview, its chat, and the
              count strip — the shape of the result on one screen, before any
              finding. */}
          <div className="situate-summary" data-finding={overviewId ?? undefined}>
            <p className="situate-headline">
              <span>{situateHeadLine(made, articleYear)}</span>
              <WrittenForYou
                written={made.profileHash !== null}
                changed={owner.profileChanged}
                slug={owner.slug}
                regenerate={{
                  run: () => void owner.regenerate(),
                  busy: working || owner.rewriting,
                  refresh: () => owner.refresh(),
                }}
              />
            </p>
            {made.outcome === "nothing-found" ? (
              <p className="rcp-empty situate-nothing">{SITUATE_NOTHING_FOUND}</p>
            ) : (
              <>
                {made.overview.trim() !== "" && (
                  <div className="situate-note-row situate-overview-row">
                    <p className="situate-overview voice-ai">{made.overview}</p>
                    <OverviewChat situate={made} chats={chats} />
                  </div>
                )}
                {groups.length > 0 && (
                  <nav className="situate-counts" aria-label={SITUATE_COUNTS_LABEL}>
                    {groups.map((group) => (
                      <button
                        key={group.kind}
                        type="button"
                        className="situate-count"
                        data-situate-kind={group.kind}
                        data-tip={SITUATE_FINDING_TIP[group.kind]}
                        aria-controls={`${groupId}-${group.kind}`}
                        aria-expanded={openKinds.has(group.kind)}
                        onClick={() => showGroup(group.kind)}
                      >
                        {group.label}
                        <span className="rcp-section-count">{group.findings.length}</span>
                      </button>
                    ))}
                  </nav>
                )}
              </>
            )}
          </div>
          {made.outcome !== "nothing-found" &&
            groups.map((group) => {
              const isOpen = openKinds.has(group.kind);
              return (
                <details
                  key={group.kind}
                  id={`${groupId}-${group.kind}`}
                  className="rcp-section situate-group"
                  data-situate-kind={group.kind}
                  open={isOpen}
                  onToggle={(e) => setKindOpen(group.kind, e.currentTarget.open)}
                >
                  <summary className="rcp-section-head situate-group-head">
                    <span className="rcp-section-label">
                      <span className="rcp-section-name">{group.label}</span>
                      <span className="rcp-section-count">{group.findings.length}</span>
                    </span>
                    <span className="rcp-section-gist">{SITUATE_FINDING_TIP[group.kind]}</span>
                  </summary>
                  {isOpen && (
                    <ul className="situate-findings">
                      {passageClusters(group.findings).map((cluster) => (
                        <Passage
                          key={cluster.findings[0]?.id ?? `${cluster.blockId} ${cluster.quote}`}
                          cluster={cluster}
                          chats={chats}
                          onJump={onJump}
                        />
                      ))}
                    </ul>
                  )}
                </details>
              );
            })}
          <Searched situate={made} />
          {!staleShowing && (
            <div className="situate-again">
              {run(true)}
              {!working && <span className="gloss-quiet situate-when">Searched {dayOf(made.generatedAt)}</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * **One passage, as a card**: the article's words, which are themselves the
 * way to the passage as well as its id (plan 261026g § Stage 2: a reader
 * did not know the quote led anywhere), then each finding about it — the
 * model's note, its chat, the sources it rests on. Usually one finding; two
 * when the search found two things about the same words (`passageClusters`).
 */
function Passage({
  cluster,
  chats,
  onJump,
}: {
  cluster: PassageCluster;
  chats: SituateChats;
  onJump(id: BlockId): void;
}) {
  return (
    <li className="situate-finding situate-passage">
      <p className="situate-finding-head">
        <FindingPassage blockId={cluster.blockId} quote={cluster.quote} onJump={onJump} />
      </p>
      {cluster.findings.map((finding) => (
        <Finding key={finding.id} finding={finding} chats={chats} />
      ))}
    </li>
  );
}

/** What pressing a finding's quote does. */
export const SITUATE_QUOTE_JUMP = "Go to this passage in the article";

/** **One finding about a passage**: the model's note and its chat, then its sources. */
function Finding({ finding, chats }: { finding: SituateFinding; chats: SituateChats }) {
  const chat = findingChat(chats.summaries, finding);
  return (
    <div className="situate-finding-body" data-finding={finding.id}>
      <div className="situate-note-row">
        {/* The model's words in the model's face (docs/project/fonts.md). */}
        <p className="situate-note voice-ai">
          {finding.note}
          {finding.strength === "suggestive" && <span className="situate-strength"> · suggestive</span>}
        </p>
        {chat ? (
          <OriginChatMark chat={chat} label={OPEN_FINDING_CHAT} className="situate-chat" onOpen={chats.onOpen} />
        ) : (
          <AskInChatButton label={ASK_FINDING_IN_CHAT} className="situate-ask" onAsk={() => chats.onFinding(finding)} />
        )}
      </div>
      <ul className="situate-sources">
        {finding.sources.map((source) => (
          <SourceRow key={source.url} source={source} />
        ))}
      </ul>
    </div>
  );
}

/**
 * **The overview's chat** (spya-mfuz6g): its own origin (`overviewOrigin`),
 * so its mark is found by the dossier's overview id, as a finding's is by its.
 */
function OverviewChat({ situate, chats }: { situate: Situate; chats: SituateChats }) {
  const chat = threadForOrigin(chats.summaries, overviewOrigin(situate));
  return chat ? (
    <OriginChatMark chat={chat} label={OPEN_OVERVIEW_CHAT} className="situate-chat" onOpen={chats.onOpen} />
  ) : (
    <AskInChatButton label={ASK_OVERVIEW_IN_CHAT} className="situate-ask" onAsk={() => chats.onOverview(situate)} />
  );
}

/**
 * **A finding's passage, and the way to it** — the quoted words are
 * themselves the jump (a button with a dotted underline, plan 261026g §
 * Stage 2), and the passage's block id follows as the house's block link
 * (`BlockRef`), because every mode shows it: controls.md § Controls that do
 * the same job look the same. Shared with the experiments
 * (SourcesExperiments.tsx), so a passage looks the same in both.
 *
 * Plan 261025h's Stage 5 briefly made the quote itself the `BlockRef` and
 * dropped the id; 261026g's layout, from Greg's later reports, kept the id.
 */
export function FindingPassage({
  blockId,
  quote,
  onJump,
}: {
  blockId: BlockId;
  quote: string;
  onJump(id: BlockId): void;
}) {
  return (
    <>
      <button type="button" className="rcp-group-quote situate-quote" data-tip={SITUATE_QUOTE_JUMP} onClick={() => onJump(blockId)}>
        “<Excerpt blockId={blockId} words={quote} />”
      </button>
      <BlockRef id={blockId} onJump={onJump} />
    </>
  );
}

/**
 * **One source**: its title as the link out, and *What it says* — the quote
 * the step found in that source's own text — one press away. Rendered closed
 * with `hidden`, so `aria-controls` always names an element that exists.
 * Also the experiments' row once revealed (SourcesExperiments.tsx).
 */
export function SourceRow({ source }: { source: SituateSource }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const title = source.title.trim() || sourceHost(source.url);
  /* A generated row reaches storage only after the server's shared `isWebUrl`
     gate, but this is the active sink. Re-check it here so an older, imported
     or damaged row cannot turn `javascript:` (or another future scheme) into
     a live link. Chat's citations and Citation Investigation keep the same
     two-sided rule. */
  const href = isWebUrl(source.url) ? source.url : null;
  const linkedTitle = (
    <>
      {title}
      {source.year !== undefined ? ` (${source.year})` : ""}
      {href !== null && <span className="situate-source-host"> · {sourceHost(href)}</span>}
    </>
  );
  return (
    <li className="situate-source">
      {href !== null ? (
        <a
          className="situate-source-link"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          data-tip={href}
        >
          {linkedTitle}
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : (
        <span className="situate-source-link">{linkedTitle}</span>
      )}
      <button
        type="button"
        className="situate-source-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
      >
        <ChevronRight size={12} aria-hidden="true" />
        {SITUATE_SOURCE_SAYS}
      </button>
      <blockquote id={id} className="rcp-quote situate-source-quote" hidden={!open}>
        “{source.quote}”
      </blockquote>
    </li>
  );
}

/**
 * **What was searched**, folded at the foot: each query with what it was for
 * and what came of it, the counts, and the sentence that finding nothing is
 * not the same as nothing being there.
 */
function Searched({ situate }: { situate: NonNullable<UseSituate["situate"]> }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { searched } = situate;
  return (
    <div className="situate-searched-wrap">
      <button
        type="button"
        className="situate-searched-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
      >
        <ChevronRight size={12} aria-hidden="true" />
        What was searched: {searchedLine(searched)}
      </button>
      <div id={id} className="situate-searched" hidden={!open}>
        <ul className="situate-queries">
          {searched.queries.map((query) => (
            <li key={query.q} className="situate-query" data-outcome={query.outcome}>
              <span className="situate-query-q">{query.q}</span>
              <span className="situate-query-meta">
                {" "}
                · about {SITUATE_GROUP_LABEL[query.group]} · {SITUATE_OUTCOME_LABEL[query.outcome]}
                {query.pages > 0 ? ` (${query.pages} new ${query.pages === 1 ? "page" : "pages"})` : ""}
              </span>
            </li>
          ))}
        </ul>
        {searched.citersSkipped && <p className="gloss-quiet">{SITUATE_CITERS_SKIPPED[searched.citersSkipped]}</p>}
        <p className="gloss-quiet">{SITUATE_ABSENCE}</p>
      </div>
    </div>
  );
}

/**
 * **Suggested for this piece** — the model's questions, above Investigate's
 * fixed five, each a press that hands itself to Chat as they do. `row` is
 * Investigate's own row, so the two lists look and behave alike. They stay in
 * Investigate, the place for questions, when the dossier moved to *Where it
 * sits* (plan 261025h).
 */
export function SituateQuestions({
  questions,
  row,
}: {
  questions: readonly string[];
  row(question: string): ReactNode;
}) {
  if (questions.length === 0) return null;
  return (
    <section className="investigate-section investigate-situate-questions" aria-labelledby="investigate-situate-questions-head">
      <h3 id="investigate-situate-questions-head" className="rcp-group-head investigate-head">
        {SITUATE_QUESTIONS_HEAD}
      </h3>
      <ul className="investigate-list">
        {questions.map((question) => (
          <li key={question}>{row(question)}</li>
        ))}
      </ul>
    </section>
  );
}
