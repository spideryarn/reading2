/**
 * **Sources › Investigate's *Where this piece sits*** — the dossier the
 * `situate` step writes (src/situate.ts), drawn at the top of Investigate for
 * the owner with the experimental switch on. Plan
 * docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md
 * § The dossier, at the top of Investigate.
 *
 * ```
 *  WHERE THIS PIECE SITS                                     EXPERIMENTAL
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
 * **Ask in chat sends a lens question** (`findingLens`, sent by Investigate's
 * own `onQuestion`, so Chat asks it through `askInSources`): the chat is an
 * Investigate chat, listed under *Your questions*, and found again here by
 * `threadForOrigin`, which draws its mark in the button's place (plan § The
 * dossier, Sol S8).
 */
import { ChevronRight, ExternalLink, Globe } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import type { BlockId, LensOrigin, SituateFinding, SituateSource, ThreadSummary } from "../types.js";
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
  OPEN_FINDING_CHAT,
  SITUATE_ABSENCE,
  SITUATE_AGAIN,
  SITUATE_CITERS_SKIPPED,
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
  findingLens,
  groupFindings,
  groupHeading,
  searchedLine,
  situateHeadLine,
  sourceHost,
} from "./situate-dossier.js";
import { DismissibleNotice, STALE_NOTICE_LABEL, STALE_NOTICE_TOOLTIP } from "./StaleNotice.js";
import { type ItemFocus, useLandOnItem } from "./item-focus.js";
import { threadForOrigin } from "./useChatAnchors.js";
import type { UseSituate } from "./useSituate.js";
import { WrittenForYou } from "./WrittenForYou.js";

/** What a finding's chat needs from Investigate: the summaries, its sender, and the way back. */
export interface SituateChats {
  summaries: readonly ThreadSummary[];
  onQuestion(question: string): void;
  onOpen(threadId: string): void;
}

/** The origin a finding's chat stores: the lens Investigate's own questions store. */
export function findingOrigin(finding: Pick<SituateFinding, "quote" | "note">): LensOrigin {
  return { mode: "reception", lens: findingLens(finding) };
}

export function SituateDossier({
  owner,
  chats,
  onJump,
  focus = null,
  onFocusTaken,
}: {
  owner: UseSituate;
  chats: SituateChats;
  onJump(id: BlockId): void;
  /**
   * **One finding to bring into view, once** — a margin *literature* line's
   * *Open in Sources* (plan 261024o § Marginalia). Its `id` is the finding's
   * stable id, which each row carries as `data-finding`; a finding this
   * dossier no longer has is handed back unserved (item-focus.ts).
   */
  focus?: ItemFocus | null;
  onFocusTaken?: ((focus: ItemFocus) => void) | undefined;
}) {
  const made = owner.status === "ready" ? owner.situate : null;
  const surface = useRef<HTMLElement>(null);
  const focusKnown = focus !== null && (made?.findings.some((f) => f.id === focus.id) ?? false);
  useLandOnItem({
    focus,
    ready: owner.status !== "loading",
    known: focusKnown,
    drawn: focusKnown,
    scope: surface,
    attribute: "data-finding",
    onTaken: onFocusTaken,
  });
  /* **The stale banner's ×, for this page view only.** The kept dismissals
     (useStaleNotices.ts) are keyed by a closed list of modes that the database
     checks (src/stale-notice.ts), and `situate` is not on it yet; until it is,
     the × hides the banner until the reader leaves Investigate. */
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
    <section
      ref={surface}
      className="investigate-section investigate-situate"
      aria-labelledby="investigate-situate-head"
    >
      <h3 id="investigate-situate-head" className="rcp-group-head investigate-head situate-head">
        <span>{SITUATE_HEAD}</span>
        <span className="situate-experimental">Experimental</span>
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
          <p className="situate-headline">
            <span>{situateHeadLine(made)}</span>
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
              {made.overview.trim() !== "" && <p className="situate-overview voice-ai">{made.overview}</p>}
              {groupFindings(made.findings).map((group) => (
                <div key={group.kind} className="situate-group" data-situate-kind={group.kind}>
                  <h4 className="rcp-group-head situate-group-head" data-tip={SITUATE_FINDING_TIP[group.kind]}>
                    {groupHeading(group)}
                  </h4>
                  <ul className="situate-findings">
                    {group.findings.map((finding) => (
                      <Finding key={finding.id} finding={finding} chats={chats} onJump={onJump} />
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
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
 * **One finding**: the article's passage, a jump to it, and its chat; the
 * model's note; the sources it rests on.
 */
function Finding({
  finding,
  chats,
  onJump,
}: {
  finding: SituateFinding;
  chats: SituateChats;
  onJump(id: BlockId): void;
}) {
  const lens = findingLens(finding);
  const chat = threadForOrigin(chats.summaries, findingOrigin(finding));
  return (
    <li className="situate-finding" data-finding={finding.id}>
      <p className="situate-finding-head">
        <span className="rcp-group-quote situate-quote">
          “<Excerpt blockId={finding.blockId} words={finding.quote} />”
        </span>
        <BlockRef id={finding.blockId} onJump={onJump} />
        {chat ? (
          <OriginChatMark chat={chat} label={OPEN_FINDING_CHAT} className="situate-chat" onOpen={chats.onOpen} />
        ) : (
          <AskInChatButton label={ASK_FINDING_IN_CHAT} className="situate-ask" onAsk={() => chats.onQuestion(lens)} />
        )}
      </p>
      {/* The model's words in the model's face (docs/project/fonts.md). */}
      <p className="situate-note voice-ai">
        {finding.note}
        {finding.strength === "suggestive" && <span className="situate-strength"> · suggestive</span>}
      </p>
      <ul className="situate-sources">
        {finding.sources.map((source) => (
          <Source key={source.url} source={source} />
        ))}
      </ul>
    </li>
  );
}

/**
 * **One source**: its title as the link out, and *What it says* — the quote
 * the step found in that source's own text — one press away. Rendered closed
 * with `hidden`, so `aria-controls` always names an element that exists.
 */
function Source({ source }: { source: SituateSource }) {
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
 * Investigate's own row, so the two lists look and behave alike.
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
