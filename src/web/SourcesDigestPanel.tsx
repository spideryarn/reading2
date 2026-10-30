/**
 * **Sources › Digest** — one text to read about the piece's sources, written
 * by the `sources-digest` step (src/sources-digest.ts). Plan
 * docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md
 * § On screen and § Stages, 2.
 *
 * ```
 *  ┌ Where it sits │ Digest │ Bibliography 42 │ Links 61 ┐            (i)
 *  │ What its sources say · from 2023
 *  │ Two to four sentences: the shape of it, each a door to its passage.
 *  │ WHAT IT BUILDS ON (i)
 *  │   A short paragraph, its sentences doors.   k3m9qt  ▸ More
 *  │     the detail, then each source ↗ and the words checked in it
 *  │ WHO HAS TAKEN IT UP (i) · WHAT IT MAY HAVE MISSED (i) · WORTH CHECKING (i)
 *  │ ▸ What was searched (14 questions, 30 searches)
 *  │ [Write it again]  Written 30 Oct 2026
 * ```
 *
 * **Every sentence is a door, by drawing it as Summary does** — SimplePanel.tsx
 * § `Sentence`, shared: a sentence with a block id is a `BlockRef`, so the
 * band's on-screen wash lights it while its passage is on screen and a press
 * jumps there (on-screen.ts § `onScreenLinkCss`), with no lighting code here.
 * The paragraph's ids are the usual chips under it.
 *
 * **Whose words** (docs/project/fonts.md): the overview, the paragraphs and
 * the detail are the model's (`.simple-text`); a source's quote is a
 * stranger's page, drawn in the UI face as the dossier draws its quotes
 * (`.rcp-quote`). Every word is a React child, never markup.
 *
 * **Owner only** (plan § On screen, F3): mounted by `DigestBand`
 * (SourcesMode.tsx); a visitor's band never draws it.
 *
 * No ask box and no chat buttons yet: Stage 3 of the plan.
 */
import { ChevronRight, ExternalLink, Info, ScrollText } from "lucide-react";
import { Fragment, type ReactNode, useId, useState } from "react";
import type {
  BlockId,
  SourcesDigest,
  SourcesDigestAngle,
  SourcesDigestEvidence,
  SourcesDigestParagraph,
  SourcesDigestSections,
  SourcesDigestSentence,
  SourcesDigestVerdict,
} from "../types.js";
import { MODE_LABEL } from "../title-text.js";
import { isWebUrl } from "../urls.js";
import { AboutMade } from "./BandAbout.js";
import { BandWaiting } from "./BandWaiting.js";
import { BlockRef } from "./BlockRef.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { dayOf } from "./relative-time.js";
import { Sentence } from "./SimplePanel.js";
import { SITUATE_ABSENCE, SITUATE_CITERS_SKIPPED, SITUATE_OUTCOME_LABEL, sourceHost } from "./situate-dossier.js";
import { DismissibleNotice, STALE_NOTICE_LABEL, STALE_NOTICE_TOOLTIP } from "./StaleNotice.js";
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";
import { useRenderCount } from "./perf.js";
import type { UseSourcesDigest } from "./useSourcesDigest.js";
import { WrittenForYou } from "./WrittenForYou.js";

/* ------------------------------------------------------------ the words -- */

/** The head line over the overview. */
export const DIGEST_HEAD = "What its sources say";
/** The button that writes it, and the one that writes it again. */
export const DIGEST_RUN = "Write the digest";
export const DIGEST_AGAIN = "Write it again";
/** Before anything is stored: what it is. */
export const DIGEST_WHAT =
  "A few paragraphs on what this piece builds on, who has taken it up since, what it may have missed, and which of its citations are worth checking, each sentence tied to the passage it is about.";
/**
 * **What leaves**, under the button (privacy.md; plan § Stage 4 writes the
 * policy's lines). The planner and the readers never see the profile; only
 * the writer does.
 */
export const DIGEST_DISCLOSURE =
  "It starts by itself when you press Digest. It sends this piece through OpenRouter to an AI, which writes questions and short searches from its text. Those searches go through OpenRouter to Exa, a web search engine, and the piece's DOI or title goes to OpenAlex to find papers that cite it. A smaller AI reads what each search found; the article, those readings and what you wrote about yourself or why you are reading then go to the AI that writes the digest.";
/** While the job runs. */
export const DIGEST_WORKING =
  "This takes a few minutes: many searches, each read before the digest is written. You can keep reading; it appears here when it is done.";
/** The stale banner's words. */
export const DIGEST_STALE =
  "The article has changed since this digest was written, so some of it may be about something the piece no longer says.";
/** `outcome: "nothing-found"`: what the searches did, never "all clear". */
export const DIGEST_NOTHING_FOUND =
  "The searches ran and found nothing that could be read about this piece's sources, so no digest was written. That does not mean there is nothing to find.";
/** The fold under each paragraph. */
export const DIGEST_MORE = "More";
/** A paragraph's sources, under its detail. */
export const DIGEST_SOURCES_HEAD = "Sources";

/** The four sections, in the order the panel draws them. */
const SECTION_ORDER = ["cites", "citedBy", "missed", "check"] as const satisfies readonly (keyof SourcesDigestSections)[];
type SectionKey = (typeof SECTION_ORDER)[number];

/** Each section's heading, and its (i): what it is, and how it was found. */
export const DIGEST_SECTION: Readonly<Record<SectionKey, { head: string; what: string; how: string }>> = {
  cites: {
    head: "What it builds on",
    what: "What the works this piece cites actually say, where it leans on them.",
    how: "An AI planned searches for the works the piece cites; a smaller AI read what each search found; the digest is written only from quotes the app found word for word in those pages.",
  },
  citedBy: {
    head: "Who has taken it up",
    what: "What later work has made of this piece: who cites it, replies to it, or builds on it.",
    how: "From the papers OpenAlex lists as citing it and from web searches about the piece; each page was read by a smaller AI, and only quotes the app found in the page are used.",
  },
  missed: {
    head: "What it may have missed",
    what: "Relevant work this piece does not cite. A suggestion to look at, not a fault found.",
    how: "An AI asked where well-known work on the piece's questions might be; searches went out, a smaller AI read the results, and only quotes the app found in the pages are used.",
  },
  check: {
    head: "Worth checking: citations that may not say that",
    what: "Places where a cited work may say less than, or something other than, what the passage uses it for. Something to check, never a verdict.",
    how: "For each, a smaller AI read what the searches found of the cited work and answered says it, partly, does not say it, or could not tell; the quotes it rests on were found in the pages by the app.",
  },
};

/** A lead's angle, said as the section it feeds. */
const ANGLE_LABEL: Readonly<Record<SourcesDigestAngle, string>> = {
  cites: "what it builds on",
  "cited-by": "who has taken it up",
  missed: "what it may have missed",
  check: "worth checking",
};

/** A reader's verdict, in plain words. */
export const DIGEST_VERDICT_LABEL: Readonly<Record<SourcesDigestVerdict, string>> = {
  "says-it": "says it",
  partly: "partly",
  "does-not": "does not say it",
  "could-not-tell": "could not tell",
  found: "found something",
  "nothing-found": "found nothing",
};

/** *What was searched*'s own count: questions asked, searches sent. */
export function digestSearchedLine(digest: SourcesDigest): string {
  const questions = digest.leads.length;
  const searches = digest.counts.searches;
  return `${questions} ${questions === 1 ? "question" : "questions"}, ${searches} ${searches === 1 ? "search" : "searches"}`;
}

/** The head line: the piece's year from its metadata, never a model's guess. */
export function digestHeadLine(digest: SourcesDigest): string {
  return digest.year === null ? DIGEST_HEAD : `${DIGEST_HEAD} · a piece from ${digest.year}`;
}

/** The (i)'s paragraph after the mode's own words. */
export const DIGEST_ABOUT =
  "Digest is behind the experimental switch. A press on its chip writes it when none is stored, which costs about a dollar of AI and searches; arriving by a link, a reload or Back starts nothing. It is written once and kept: Write it again is the only way to replace it.";

/* ------------------------------------------------------------ the panel -- */

export function SourcesDigestPanel({
  head,
  owner,
  onJump,
}: {
  /** Sources' chip row (SourcesMode.tsx § `SourcesViews`). */
  head: ReactNode;
  owner: UseSourcesDigest;
  onJump(id: BlockId): void;
}) {
  useRenderCount("SourcesDigestPanel");
  const made = owner.status === "ready" ? owner.digest : null;
  /* **The stale banner's ×, for this page view only**, as the dossier's: the
     kept dismissals (useStaleNotices.ts) are keyed by a closed list of modes
     the database checks (src/stale-notice.ts), and the digest is not on it. */
  const [staleHidden, setStaleHidden] = useState<string | null>(null);
  const staleShowing = made !== null && owner.stale && staleHidden !== made.generatedAt;

  /* A forced run has finished and its result is not here yet: the forced
     button gives way to a read, never to a second paid run — rewrite-hold.ts. */
  const waiting = owner.rewriting && !owner.job && !owner.starting && !owner.failed;
  const working = owner.job !== null || owner.starting;
  /**
   * @param again whether this is the button beside a digest already there.
   *   The empty state's button is `ensure` — the identical, unforced request
   *   the press's automatic run makes — or it would buy a second run.
   */
  const run = (again: boolean) =>
    again && waiting && !owner.error ? (
      <RewriteWaiting line="The new digest hasn't loaded yet." onRead={owner.refresh} className="tw:m-0" />
    ) : (
      <JobProgress
        job={owner.job}
        starting={owner.starting}
        failed={owner.failed}
        stalled={owner.stalled}
        onRun={() => (again ? owner.regenerate() : owner.ensure())}
        runDisabled={again && owner.rewriting}
        onCancel={owner.cancel}
        label={again ? DIGEST_AGAIN : DIGEST_RUN}
        step="sources-digest"
        icon={<ScrollText size={13} />}
        runningLabel="Writing the digest…"
      />
    );

  return (
    <ModeSurface
      label={MODE_LABEL.sources}
      feature="gloss digest sources"
      mode="sources"
      about={
        <>
          <p>{DIGEST_ABOUT}</p>
          {made !== null && (
            <AboutMade
              generator={made.phases.write ?? made.generator}
              version={made.version}
              generatedAt={made.generatedAt}
              elapsedMs={made.elapsedMs}
            />
          )}
        </>
      }
      profile={
        made !== null && (
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
        )
      }
      head={head}
    >
      <div className="tl-scroll where-scroll digest-scroll">
        <div className="where-section digest-body">
        {owner.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}
        {owner.status === "loading" && <BandWaiting className="gloss-quiet">Looking for an earlier digest…</BandWaiting>}

        {owner.status === "none" && (
          <div className="situate-before digest-before">
            <p className="gloss-hint situate-what">{DIGEST_WHAT}</p>
            {run(false)}
            {working ? (
              <p className="gloss-quiet situate-working">{DIGEST_WORKING}</p>
            ) : (
              <p className="gloss-quiet situate-disclosure">{DIGEST_DISCLOSURE}</p>
            )}
          </div>
        )}

        {made !== null && (
          <>
            {staleShowing && (
              <DismissibleNotice
                mode="sources-digest"
                onDismiss={() => setStaleHidden(made.generatedAt)}
                tooltip={STALE_NOTICE_TOOLTIP}
                label={STALE_NOTICE_LABEL}
                failed={null}
                action={run(true)}
              >
                {DIGEST_STALE}
              </DismissibleNotice>
            )}
            {/* No banner for an outdated digest (older prompt, same article):
                Greg, 2026-09-29, *"it's not worth bugging the user about it"*
                (plan 260929c). Write it again is at the foot. */}
            <p className="digest-headline">{digestHeadLine(made)}</p>
            {made.outcome === "nothing-found" ? (
              <p className="rcp-empty situate-nothing">{DIGEST_NOTHING_FOUND}</p>
            ) : (
              <TooltipGroup delay={{ open: 350, close: 120 }} timeoutMs={500}>
                {made.overview.length > 0 && (
                  <p className="simple-text digest-overview">
                    <Sentences sentences={made.overview} onJump={onJump} />
                  </p>
                )}
                {SECTION_ORDER.map((key) =>
                  made.sections[key].length === 0 ? null : (
                    <DigestSection
                      key={key}
                      section={key}
                      paragraphs={made.sections[key]}
                      evidence={made.evidence}
                      onJump={onJump}
                    />
                  ),
                )}
              </TooltipGroup>
            )}
            <Searched digest={made} />
            {!staleShowing && (
              <div className="situate-again">
                {run(true)}
                {!working && <span className="gloss-quiet situate-when">Written {dayOf(made.generatedAt)}</span>}
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </ModeSurface>
  );
}

/** Sentences as Summary draws them: a door each when it names its passage. */
function Sentences({ sentences, onJump }: { sentences: readonly SourcesDigestSentence[]; onJump(id: BlockId): void }) {
  /* Position distinguishes repeated sentences; a rewrite that changes a
     sentence's passage remounts its link (SimplePanel.tsx § `Paragraph`). */
  return (
    <>
      {sentences.map((s, i) => (
        <Fragment key={JSON.stringify([i, s.id, s.text])}>
          {i > 0 && " "}
          <Sentence sentence={s} onJump={onJump} />
        </Fragment>
      ))}
    </>
  );
}

/** One of the four sections: its heading with its (i), then its paragraphs. */
function DigestSection({
  section,
  paragraphs,
  evidence,
  onJump,
}: {
  section: SectionKey;
  paragraphs: readonly SourcesDigestParagraph[];
  evidence: readonly SourcesDigestEvidence[];
  onJump(id: BlockId): void;
}) {
  const words = DIGEST_SECTION[section];
  const headId = useId();
  return (
    <section className="digest-section" data-digest-section={section} aria-labelledby={headId}>
      <h3 id={headId} className="rcp-group-head where-head digest-head">
        {words.head}
        <Tooltip placement="top" content={<ControlTip head={words.head} what={words.what} how={words.how} />}>
          {/* A button rather than a bare icon, so the keyboard reaches the card
              (SettingsSection.tsx's (i), the same reason). */}
          <button type="button" className="digest-info" aria-label={`What ${words.head} is`}>
            <Info size={12} aria-hidden="true" />
          </button>
        </Tooltip>
      </h3>
      <div className="simple-paras">
        {paragraphs.map((p) => (
          <DigestParagraph key={p.text} paragraph={p} evidence={evidence} onJump={onJump} />
        ))}
      </div>
    </section>
  );
}

/**
 * **One paragraph**: its sentences as doors, its ids as the usual chips, and
 * *More*, which opens the detail and the sources it rests on. Rendered closed
 * with `hidden`, so `aria-controls` always names an element that exists (the
 * dossier's `SourceRow`, the same reason).
 */
function DigestParagraph({
  paragraph,
  evidence,
  onJump,
}: {
  paragraph: SourcesDigestParagraph;
  evidence: readonly SourcesDigestEvidence[];
  onJump(id: BlockId): void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const sources = paragraph.sources
    .map((sid) => evidence.find((e) => e.id === sid))
    .filter((e): e is SourcesDigestEvidence => e !== undefined);
  const hasMore = paragraph.more.trim() !== "" || sources.length > 0;
  return (
    <div className="simple-para digest-para">
      <p className="simple-text">
        <Sentences sentences={paragraph.sentences} onJump={onJump} />
      </p>
      <div className="simple-refs">
        {paragraph.ids.map((blockId) => (
          <BlockRef key={blockId} id={blockId} onJump={onJump} />
        ))}
        {hasMore && (
          <button
            type="button"
            className="situate-source-toggle digest-more-toggle"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((was) => !was)}
          >
            <ChevronRight size={12} aria-hidden="true" />
            {DIGEST_MORE}
          </button>
        )}
      </div>
      {hasMore && (
        <div id={id} className="digest-more" hidden={!open}>
          {paragraph.more.trim() !== "" && <p className="simple-text digest-more-text">{paragraph.more}</p>}
          {sources.length > 0 && (
            <ul className="situate-sources digest-sources" aria-label={DIGEST_SOURCES_HEAD}>
              {sources.map((source) => (
                <DigestSource key={source.id} source={source} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * **One source**: its title as the link out, then the words the app found in
 * it, each a stranger's page's characters in the UI face. The dossier's
 * `SourceRow` look; its own toggle is left out because *More* has already
 * been pressed to get here.
 */
function DigestSource({ source }: { source: SourcesDigestEvidence }) {
  const title = source.title.trim() || sourceHost(source.url);
  /* Re-checked at the sink, as `SourceRow` does: a damaged row must not turn
     `javascript:` into a live link. */
  const href = isWebUrl(source.url) ? source.url : null;
  const linkedTitle = (
    <>
      {title}
      {source.year !== undefined ? ` (${source.year})` : ""}
      {href !== null && <span className="situate-source-host"> · {sourceHost(href)}</span>}
    </>
  );
  return (
    <li className="situate-source digest-source">
      {href !== null ? (
        <a className="situate-source-link" href={href} target="_blank" rel="noreferrer noopener" data-tip={href}>
          {linkedTitle}
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : (
        <span className="situate-source-link">{linkedTitle}</span>
      )}
      {source.quoted.map((words) => (
        <blockquote key={words} className="rcp-quote situate-source-quote">
          “{words}”
        </blockquote>
      ))}
    </li>
  );
}

/**
 * **What was searched**, folded at the foot: each question with the section
 * it feeds, what its reader made of it, and its searches with what came of
 * each. The digest's working, one press away.
 */
function Searched({ digest }: { digest: SourcesDigest }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const verdicts = new Map(digest.reports.map((r) => [r.leadId, r.verdict]));
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
        What was searched ({digestSearchedLine(digest)})
      </button>
      <div id={id} className="situate-searched" hidden={!open}>
        <ul className="situate-queries digest-leads">
          {digest.leads.map((lead) => {
            const verdict = verdicts.get(lead.id);
            return (
              <li key={lead.id} className="digest-lead" data-angle={lead.angle}>
                <span className="digest-lead-q">{lead.question}</span>
                <span className="situate-query-meta">
                  {" "}
                  · {ANGLE_LABEL[lead.angle]}
                  {verdict !== undefined ? ` · ${DIGEST_VERDICT_LABEL[verdict]}` : ""}
                </span>
                {lead.searches.length > 0 && (
                  <ul className="situate-queries">
                    {lead.searches.map((search) => (
                      <li key={search.q} className="situate-query" data-outcome={search.outcome}>
                        <span className="situate-query-q">{search.q}</span>
                        <span className="situate-query-meta">
                          {" "}
                          · {SITUATE_OUTCOME_LABEL[search.outcome]}
                          {search.pages > 0 ? ` (${search.pages} new ${search.pages === 1 ? "page" : "pages"})` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {digest.citersSkipped && <p className="gloss-quiet">{SITUATE_CITERS_SKIPPED[digest.citersSkipped]}</p>}
        <p className="gloss-quiet">{SITUATE_ABSENCE}</p>
      </div>
    </div>
  );
}
