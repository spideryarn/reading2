/**
 * `/add/<a whole URL>` — the add box, given an address.
 *
 * > Add a url that I can use to add something directly, e.g.
 * > `/add/[my-full-url-here]` or `/?add=[my-full-url-here]` or similar … And
 * > then modify the Home page so that when you add a url and click add, it
 * > takes you to this page.
 * >
 * > — Greg, 2026-08-26
 *
 * Two things at once, and the second is why this is a page rather than a
 * redirect. **A bookmarklet or a share sheet can now hand us an article** —
 * `spideryarn/add/` + wherever you are — and that only works if the whole
 * request fits in an address. And **an ingest now has somewhere to be**: the
 * homepage's progress list was fine for something you were watching, but it
 * could not be reloaded, bookmarked or sent, because it was a state of that
 * page rather than a place.
 *
 * ## What it does with the URL
 *
 * Queues it once, watches that one job, and goes to the article when the job
 * succeeds. All three of those have a trap in them:
 *
 *  - **Once.** The effect is guarded by a ref, because StrictMode mounts,
 *    unmounts and mounts again in development, and a plain effect would POST
 *    twice. `enqueue` in src/jobs.ts happens to hand back the *same* job for an
 *    identical second request, so this would have looked fine and been wrong
 *    only in the log — the kind of silent success this repo keeps writing up
 *    (docs/reusable/silent-success.md).
 *  - **That one.** By job id, from what `queue.add` returned. Not by slug:
 *    `useJobs` polls the whole queue, and an article being re-run in another
 *    tab has the same slug and a different job.
 *  - **Goes to the article.** With `replace`, so Back leaves the reading view
 *    for wherever you came from rather than dropping you here to watch a
 *    finished job. See `navigate` in router.ts.
 *
 * An article that is already on the shelf takes about a second — every step
 * finds its artefact and skips — so the common case of pasting a URL twice is
 * a blink and then the article, rather than an error saying you already have it.
 *
 * ## Why it does not just show the shelf's add box
 *
 * It nearly does — the progress card is literally `JobCard` from
 * AddArticle.tsx, so the step names and the Stop and Retry buttons are the same
 * ones in both places. What is different is that this page has exactly one job
 * and no input: there is nothing to type, because the address already said it.
 *
 * See docs/project/ingest-queue.md and docs/project/library.md.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "./Link.js";
import { JobCard } from "./AddArticle.js";
import { normaliseUrl, slugFromUrl } from "../ingest.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { LIBRARY_HREF, navigate, readHref } from "./router.js";
import type { Job } from "../types.js";
import { useJobs } from "./useJobs.js";

/**
 * Which of the two origins this page is starting.
 *
 * A union rather than two components, because everything that is hard here is
 * shared and none of it is about URLs: post exactly once across StrictMode's
 * double mount, watch **that** job by id rather than by slug, and navigate on
 * success with `replace`. Each of those has a bug in it that was found the hard
 * way (see the comments below), and a second copy would have to find them
 * again. What actually differs is three lines: what gets posted, what the
 * subtitle says, and whether "that isn't a web address" can apply at all.
 */
export type AddSource = { kind: "url"; url: string } | { kind: "upload"; uploadId: string };

export function AddPage({ source: origin }: { source: AddSource }) {
  const queue = useJobs();
  const [started, setStarted] = useState<string | null>(null);
  const url = origin.kind === "url" ? origin.url : "";

  /* What the server will actually fetch, worked out here so the page can show
     it. Typing `example.com/an-essay` into the address bar is meant to work
     (Greg, 2026-08-26), and the reader should be able to see the `https://`
     they did not type before the fetch rather than after it.

     There is deliberately no scheme check beside this. `slugFromUrl` refuses
     anything it could not fetch — `javascript:`, `file:`, a mistyped `htp:` —
     and it is the same function the server derives the slug with, so a second
     opinion here could only ever be a way for the two to disagree. */
  const source = normaliseUrl(url);
  /* An upload has nothing to validate here — the file is already in the object
     store and the server has already refused everything it could refuse before
     minting the grant. So `ok` is about the *address*, and an upload simply has
     not got one. */
  const ok = origin.kind === "upload" || slugFromUrl(source) !== "";

  /* What the "have we posted this one already" guard compares. Not a boolean —
     see the note on `posted` below — and not the URL, because for an upload
     there isn't one. The id and the normalised address are both stable strings
     that identify exactly one thing to queue. */
  const wanted = origin.kind === "upload" ? origin.uploadId : source;
  /* Named separately because the effect's dependency list needs it and cannot
     narrow a union inside one — `origin.uploadId` does not typecheck against
     the URL arm. Undefined for a URL, which is a perfectly stable value. */
  const uploadId = origin.kind === "upload" ? origin.uploadId : undefined;

  /* Which URL we have already posted, **not a boolean**. It was a boolean, and
     the difference is a bug GPT Sol found (2026-08-26): this component does not
     remount when only the URL changes, so going from one `/add/…` address to
     another left the flag set and the second article was never queued — a page
     that says "Adding an article" and is not. Holding the URL means "have we
     posted *this* one", which is the question the effect is actually asking.

     A ref rather than state for two reasons: it must be read and written inside
     the effect without re-running it, and it has to survive StrictMode's
     remount, which state does not. */
  const posted = useRef<string | null>(null);

  /* Bumped by Retry. The effect's guard is on the URL, and after a failed POST
     the URL is the same one — so without something that changes, pressing Retry
     would do nothing at all. */
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  // Through a ref, the same way `useJobs` holds `onFinished`. `queue.add` is a
  // fresh closure on every poll, so depending on it directly would re-run this
  // effect once a second — harmless only because of the guard above, which is
  // not a thing to rely on. The ref is also what stops the linter offering the
  // fix that would do exactly that.
  const addRef = useRef(queue.add);
  addRef.current = queue.add;
  const uploadRef = useRef(queue.addUpload);
  uploadRef.current = queue.addUpload;

  useEffect(() => {
    /* Cleared rather than simply skipped. Going from a URL we would add to one
       we would not — by editing the address bar, which does not remount this
       component — used to leave the previous job on screen, still running, and
       still able to navigate away when it finished. */
    if (!ok) {
      setStarted(null);
      setFailed(false);
      return;
    }
    const want = `${attempt}\u0000${wanted}`;
    if (posted.current === want) return;
    posted.current = want;
    setStarted(null);
    setFailed(false);
    /* On `uploadId` rather than on `origin.kind`, so the effect reads only
       plain strings it also depends on — and so the union narrows, which
       `origin.kind === "upload"` does not do for a field read inside a
       dependency list. */
    const queueIt =
      uploadId !== undefined ? uploadRef.current(uploadId) : addRef.current(source);
    void queueIt.then((job) => {
      /* **Only if this is still the POST we are waiting for.** Two `/add/`
         addresses in quick succession, or Retry, leave two requests in flight,
         and the first can land last — which would put the *first* article's job
         on screen and then navigate to it. The ref is the current request's
         name, so comparing against it is the check. GPT Sol, 2026-08-26.

         `null` means the POST itself failed, and `useJobs` has put the reason
         in `queue.error`. Without that branch the page sat on "Queueing it…"
         for ever, with the error above it and no way to try again. */
      if (posted.current !== want) return;
      if (job) setStarted(job.id);
      else setFailed(true);
    });
    /* The two plain strings, never `origin` itself. That object is a fresh
       literal on every render of the component above, so depending on it would
       re-run this effect once a second — harmless only because of the guard,
       which is not a thing to rely on. `uploadId` and `source` are strings (or
       `undefined`), so they are stable, and `wanted` is derived from them.
       Biome asks for them by name and it is right to. */
  }, [wanted, ok, attempt, uploadId, source]);

  const job = queue.jobs.find((j) => j.id === started) ?? null;

  useEffect(() => {
    if (job?.status !== "done") return;
    navigate(readHref(job.slug), { replace: true });
  }, [job?.status, job?.slug]);

  /* The tab, naming what is being added — the host for an address, the filename
     for an upload. The filename only exists once the first poll has come back,
     which is why this reads the same fallback the subtitle does rather than
     going quiet. See src/web/page-title.ts. */
  useDocumentTitle(
    pageTitle({
      kind: "add",
      source: origin.kind === "upload" ? (job?.upload?.filename ?? null) : ok ? source : url,
    }),
  );

  return (
    <main className="tw:mx-auto tw:max-w-2xl tw:px-6 tw:py-10 tw:font-sans">
      <header className="tw:mb-6">
        <h1 className="tw:font-prose tw:text-2xl tw:text-foreground">Adding an article</h1>
        {/* The URL as text rather than as a link. It is not somewhere we are
            sending the reader, it is what they asked us to read — and a live
            link to an unvisited address on a page they may have arrived at from
            a bookmarklet is a click we have no reason to offer.

            For an upload it is the filename, which the *job* carries rather
            than the address — so until the first poll comes back there is
            genuinely nothing to name, and saying "your file" is better than an
            empty line that fills in a second later. */}
        <p className="tw:mt-2 tw:mb-0 tw:font-mono tw:text-[13px] tw:break-all tw:text-muted-foreground">
          {origin.kind === "upload" ? (job?.upload?.filename ?? "your file") : ok ? source : url}
        </p>
      </header>

      {!ok && (
        <p className="tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground">
          That isn't a web address we can fetch. A host and a path is enough —{" "}
          <code className="tw:font-mono">example.com/an-essay</code> — and the{" "}
          <code className="tw:font-mono">https://</code> is optional.
        </p>
      )}

      {queue.error && (
        <p className="tw:mb-4 tw:text-sm tw:text-destructive">{queue.error}</p>
      )}

      {/* From the first render until the poll brings the job back — the POST
          and one poll, usually a fraction of a second. Deliberately *not*
          behind `useSlow` like the shelf's "Reading the shelf…": there the page
          is full of cards while you wait, and here it would be a heading and
          nothing else. */}
      {ok && !job && !failed && (
        <p className="tw:text-sm tw:text-muted-foreground">Queueing it…</p>
      )}

      {failed && (
        <p className="tw:mb-0 tw:text-sm tw:text-muted-foreground">
          It didn't get as far as the queue.{" "}
          <button
            type="button"
            className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-highlight tw:underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
          .
        </p>
      )}

      {job && <JobCard job={job} queue={queue} onHide={() => navigate(LIBRARY_HREF)} />}

      {job?.status === "done" && <Done job={job} />}

      <p className="tw:mt-6 tw:mb-0 tw:text-sm">
        <Link href={LIBRARY_HREF} className="tw:text-muted-foreground tw:hover:text-highlight">
          ← Back to the shelf
        </Link>
      </p>
    </main>
  );
}

/**
 * The moment between the last step going green and the navigation landing.
 *
 * Usually invisible — the effect above fires on the same render — but it is not
 * nothing: if the navigation is ever blocked or slow, this is a link rather
 * than a page that stopped. A finished job with no way onward would be the
 * worst version of this screen.
 */
function Done({ job }: { job: Job }) {
  return (
    <p className="tw:mt-4 tw:mb-0 tw:text-sm tw:text-muted-foreground">
      Done —{" "}
      <Link href={readHref(job.slug)} className="tw:text-highlight">
        read it
      </Link>
      .
    </p>
  );
}
