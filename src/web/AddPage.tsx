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
import { slugFromUrl } from "../ingest.js";
import { LIBRARY_HREF, navigate, readHref } from "./router.js";
import type { Job } from "../types.js";
import { useJobs } from "./useJobs.js";

/**
 * Whether we are willing to hand this to the queue.
 *
 * The scheme test is the half the homepage got for free and this page does not:
 * there the box is an `<input type="url">`, which the browser will not submit
 * without one. Here the string came out of the address bar, so `javascript:`
 * and `file:` can reach us — and `slugFromUrl` says yes to both, because it
 * only ever looks at the last path segment. Neither would do any harm (the
 * fetch happens on the server and would simply fail), but "Fetching the page"
 * followed a minute later by a stack-shaped error is a much worse answer than
 * "that is not a web address".
 */
function addable(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return slugFromUrl(url) !== "";
}

export function AddPage({ url }: { url: string }) {
  const queue = useJobs();
  const [started, setStarted] = useState<string | null>(null);
  const ok = addable(url);

  // Not state: it must be read and written inside the effect below without
  // re-running it, and it has to survive StrictMode's remount, which state
  // does not.
  const posted = useRef(false);

  // Through a ref, the same way `useJobs` holds `onFinished`. `queue.add` is a
  // fresh closure on every poll, so depending on it directly would re-run this
  // effect once a second — harmless only because of the guard above, which is
  // not a thing to rely on. The ref is also what stops the linter offering the
  // fix that would do exactly that.
  const addRef = useRef(queue.add);
  addRef.current = queue.add;

  useEffect(() => {
    if (!ok || posted.current) return;
    posted.current = true;
    void addRef.current(url).then((job) => {
      if (job) setStarted(job.id);
    });
  }, [url, ok]);

  const job = queue.jobs.find((j) => j.id === started) ?? null;

  useEffect(() => {
    if (job?.status !== "done") return;
    navigate(readHref(job.slug), { replace: true });
  }, [job?.status, job?.slug]);

  return (
    <main className="tw:mx-auto tw:max-w-2xl tw:px-6 tw:py-10 tw:font-sans">
      <header className="tw:mb-6">
        <h1 className="tw:font-prose tw:text-2xl tw:text-foreground">Adding an article</h1>
        {/* The URL as text rather than as a link. It is not somewhere we are
            sending the reader, it is what they asked us to read — and a live
            link to an unvisited address on a page they may have arrived at from
            a bookmarklet is a click we have no reason to offer. */}
        <p className="tw:mt-2 tw:mb-0 tw:font-mono tw:text-[13px] tw:break-all tw:text-muted-foreground">
          {url}
        </p>
      </header>

      {!ok && (
        <p className="tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground">
          That isn't a web address we can fetch. It needs to start with{" "}
          <code className="tw:font-mono">http://</code> or{" "}
          <code className="tw:font-mono">https://</code>.
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
      {ok && !job && <p className="tw:text-sm tw:text-muted-foreground">Queueing it…</p>}

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
