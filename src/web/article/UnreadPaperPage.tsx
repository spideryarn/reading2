/**
 * **A paper of yours that has not been read through yet** — what the reading
 * address shows for a minimal paper (plan
 * docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md § The thin
 * article). The owned route answers `409 not-processed` with the paper in the
 * body (src/not-processed.ts); `useArticleAccess` turns that into
 * `{ kind: "unread", paper }` and this draws it: the title, the authors, the
 * abstract, the DOI, the file, and *Read this*.
 *
 * > Opening a minimal paper does **not** start the full import by itself. It
 * > shows the paper — title, authors, abstract, the PDF — with *Read this* one
 * > click away.
 *
 * — the plan's answer 6, on Greg's report `spya-eym66s`. Opening it is free; the
 * button says what it costs.
 *
 * **When the job ends `done`, the article is loaded in place** (`onRead`, which
 * asks `useArticleAccess` again). It follows *any* *Read this* job on this
 * paper, not only one pressed here, so a paper whose import was started from
 * the shelf card opens by itself when it is ready.
 *
 * No `Dock`, so the corner pair is drawn here, as on ArticlePage's other
 * no-dock branches.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Circle, LoaderCircle } from "lucide-react";
import { APP_NAME, SEP, clamp } from "../../title-text.js";
import type { Job, UnreadPaper } from "../../types.js";
import { FeedbackTrigger } from "../FeedbackButton.js";
import { HomeLogo } from "../HomeLogo.js";
import { jobEngine } from "../jobEngine.js";
import { useDocumentTitle } from "../page-title.js";
import { ReadThisButton } from "../ReadThis.js";
import { readThisJobFor } from "../read-this.js";
import { NotProcessedBadge } from "../ShelfEntry.js";
import { SourceLink } from "../SourceLink.js";
import { articleTitleVoice, withVoice } from "../voice.js";

/** The DOI shape the metadata step keeps (src/paper-metadata.ts); anything else is not linked. */
const DOI_SHAPE = /^10\.\d{4,9}\/[^\s"'<>?#]+$/;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const MAX_DOI_CHARS = 296;

/** `https://doi.org/<doi>`, or null for a value that is not a DOI. */
export function doiHref(doi: string | undefined): string | null {
  if (
    !doi ||
    doi.length > MAX_DOI_CHARS ||
    !PRINTABLE_ASCII.test(doi) ||
    !DOI_SHAPE.test(doi)
  ) {
    return null;
  }
  return `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;
}

/** "A, B and C". */
function names(authors: readonly string[]): string {
  if (authors.length <= 1) return authors[0] ?? "";
  return `${authors.slice(0, -1).join(", ")} and ${authors[authors.length - 1]}`;
}

export function UnreadPaperPage({
  paper,
  onRead,
}: {
  paper: UnreadPaper;
  /** The *Read this* job is done: load the article. */
  onRead: () => void;
}) {
  useDocumentTitle([clamp(paper.title), APP_NAME].join(SEP));
  const snapshot = useSyncExternalStore(jobEngine.subscribeQuietly, jobEngine.getSnapshot);
  const [startedId, setStartedId] = useState<string | null>(null);
  const running = readThisJobFor(snapshot.jobs, paper.slug);
  const runningId = startedId ?? running?.id ?? null;

  /* Follow the running job to its end. `watchTerminal` hears `done` from the
     list and from `/advance` alike, and drops itself on a sign-out. */
  useEffect(() => {
    if (!runningId) return;
    return jobEngine.watchTerminal(runningId, (ended) => {
      setStartedId((id) => (id === runningId ? null : id));
      if (ended.kind === "done") onRead();
    });
  }, [runningId, onRead]);

  const doi = doiHref(paper.doi);

  return (
    <>
      <HomeLogo />
      <FeedbackTrigger variant="corner" />
      <main className="tw:mx-auto tw:max-w-2xl tw:px-4 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:pb-16 tw:font-sans">
        <p className="tw:m-0 tw:text-xs">
          <NotProcessedBadge />
        </p>
        {/* The paper's own title, or the reader's rename (voice.ts §
            `articleTitleVoice`). */}
        <h1
          className={withVoice(
            "tw:mt-3 tw:mb-0 tw:text-2xl tw:leading-snug tw:break-words",
            articleTitleVoice(paper.titleOverridden),
          )}
        >
          {paper.title}
        </h1>
        {paper.authors.length > 0 && (
          <p className="tw:mt-2 tw:mb-0 tw:break-words tw:text-sm tw:text-muted-foreground">
            {names(paper.authors)}
          </p>
        )}

        <p className="tw:mt-4 tw:mb-0 tw:text-sm tw:text-muted-foreground">
          Only its title, authors and abstract have been read so far. Read this reads the whole
          paper, so you can open it in every mode.
        </p>
        <div className="tw:mt-3">
          <ReadThisButton
            slug={paper.slug}
            size="default"
            onStarted={(job) => setStartedId(job.id)}
          />
        </div>
        {running && <Steps job={running} />}

        {paper.abstract && (
          <section className="tw:mt-8">
            <h2 className="tw:m-0 tw:text-sm tw:font-semibold">Abstract</h2>
            <p
              className={withVoice(
                "tw:mt-2 tw:mb-0 tw:break-words tw:text-[1.05rem] tw:leading-relaxed tw:whitespace-pre-line",
                "author",
              )}
            >
              {paper.abstract}
            </p>
          </section>
        )}

        <ul className="tw:mt-8 tw:mb-0 tw:flex tw:list-none tw:flex-col tw:gap-1.5 tw:p-0 tw:text-sm">
          {doi && (
            <li className="tw:break-words">
              DOI{" "}
              <a href={doi} target="_blank" rel="noreferrer noopener" className="tw:text-highlight-text">
                {paper.doi}
              </a>
            </li>
          )}
          {/* `GET /api/source/:slug` serves a PDF and nothing else
              (`readPdf`, src/store/pg-source.ts) — an HTML source from our own
              origin would be stored XSS — so a web page gets no link. */}
          {paper.kind === "pdf" && (
            <li>
              <SourceLink slug={paper.slug} className="tw:cursor-pointer tw:bg-transparent tw:border-0 tw:p-0 tw:text-highlight-text tw:underline">
                Open the PDF
              </SourceLink>
              {paper.filename && (
                <span className="tw:ml-2 tw:break-all tw:text-muted-foreground">{paper.filename}</span>
              )}
            </li>
          )}
          {paper.kind !== "pdf" && paper.filename && (
            <li className="tw:break-all tw:text-muted-foreground">{paper.filename}</li>
          )}
        </ul>
      </main>
    </>
  );
}

/** The import's steps as it runs, in the server's own words — the add card's account, compact. */
function Steps({ job }: { job: Job }) {
  return (
    <ol aria-label="Reading it through" className="tw:mt-4 tw:mb-0 tw:flex tw:list-none tw:flex-col tw:gap-1 tw:p-0 tw:text-xs">
      {job.steps.map((step) => (
        <li key={step.name} className="tw:flex tw:items-center tw:gap-2 tw:text-muted-foreground">
          {step.status === "running" ? (
            <LoaderCircle size={12} className="cmt-spinner" aria-hidden="true" />
          ) : step.status === "done" || step.status === "skipped" ? (
            <Check size={12} aria-hidden="true" className="tw:text-highlight-text" />
          ) : (
            <Circle size={12} aria-hidden="true" />
          )}
          <span className={step.status === "running" ? "tw:text-foreground" : undefined}>{step.label}</span>
        </li>
      ))}
      <li className="tw:mt-1 tw:text-muted-foreground">
        Keep a Spideryarn tab open while it reads. It opens here when it is done.
      </li>
    </ol>
  );
}
