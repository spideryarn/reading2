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
import { formatBytes } from "../uploads.js";
import { KEEP_A_TAB_OPEN } from "../job-state.js";
import {
  ADDING_SENDS_TEXT_AWAY,
  DIRECT_ADD_SENT_TEXT_AWAY,
  UPLOAD_STILL_ARRIVING,
  worthRetrying,
} from "../messages.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { QuotaNotice } from "./QuotaNotice.js";
import { LIBRARY_HREF, navigate, readHref } from "./router.js";
import type { Job } from "../types.js";
import { useJobs } from "./useJobs.js";
import { type Transfer, uploadEngine } from "./uploadEngine.js";
import { useUpload } from "./useUpload.js";
import { apiFetch, readJson } from "./lib/api.js";

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

/**
 * How often a page waiting on another tab's transfer asks whether it has landed.
 *
 * Three seconds, and the number is picked from what it is waiting for rather
 * than from what feels responsive: the thing that ends the wait is a 40 MB
 * upload on a slow connection, so being three seconds late to notice it is
 * invisible, and asking ten times as often would be ten times the Storage
 * `head` for the same answer. The engine's own transfer needs none of this —
 * it knows.
 */
const ARRIVAL_POLL_MS = 3000;

export function AddPage({ source: origin }: { source: AddSource }) {
  const queue = useJobs();
  const [started, setStarted] = useState<string | null>(null);
  const url = origin.kind === "url" ? origin.url : "";
  /**
   * **This tab's transfer, if it is the one this address is about.**
   *
   * Since 2026-09-03 the reader arrives here with **zero bytes sent** — the
   * shelf mints the grant, navigates, and leaves `uploadEngine` to finish the
   * PUT and queue the ingest wherever they go next
   * (docs/plans/260903j-background-pdf-upload-so-add-does-not-wait.md). So there
   * are two quite different situations behind one address:
   *
   *  - **the engine has it** — this page is a window onto a transfer that is
   *    already being seen through. It must not post anything; the engine will,
   *    and posting alongside it is how one upload becomes two requests.
   *  - **nothing has it** — a reload, a second tab, a bookmark, a share sheet.
   *    Then this page posts, exactly as it always did. If the bytes are still
   *    moving in the *other* tab the server answers *still arriving* and takes
   *    nothing, and `stillArriving` below watches for them.
   *
   * Compared by upload id rather than merely "is there a transfer", because the
   * engine holds one at a time and it may be a different file entirely.
   */
  const transfer = useUpload();
  const mine =
    origin.kind === "upload" && transfer?.uploadId === origin.uploadId ? transfer : null;

  /* What the server will actually fetch, worked out here so the page can show
     it. Typing `example.com/an-essay` into the address bar is meant to work
     (Greg, 2026-08-26), and the reader should be able to see the `https://`
     they did not type before the fetch rather than after it.

     There is deliberately no scheme check beside this. `slugFromUrl` refuses
     anything it could not fetch — `javascript:`, `file:`, a mistyped `htp:` —
     and it is the same function the server derives the slug with, so a second
     opinion here could only ever be a way for the two to disagree. */
  const source = normaliseUrl(url);
  /* An upload has nothing to validate *here*: the checks that can be made from
     a filename and a size were made before the grant, and the ones over the
     bytes belong to the acquisition step. So `ok` is about the **address**, and
     an upload simply has not got one.

     It used to add "the file is already in the object store", which stopped
     being true on 2026-09-03 — this page is now reached at byte zero, and
     whether the bytes are there is a question the *server* answers, once, in
     `uploadHasArrived`. */
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
  /**
   * Why the POST failed, kept where no poll can clear it.
   *
   * **It was a boolean and `queue.error` was rendered beside it, and that was
   * the bug** — the same one the three artefact hooks met in August and the
   * thread page met after them, found here in a browser on 2026-09-03. `error`
   * is *engine* state shared with the poller, and `act`'s own `finally` starts
   * the poll that clears it (see `lastFailure` in useJobs.ts), so the server's
   * reason for refusing was replaced by the generic *"It didn't get as far as
   * the queue"* before anybody could read it. On a free account at its quota
   * that meant the refusal — and the link to `/profile` that the whole
   * `QuotaNotice` change is for — never appeared at all.
   *
   * `queue.lastFailure()` is the durable record and is snapshotted *here*, right
   * after the await, exactly as `useStepJob` does after the same discovery
   * (`tests/refused-job-reason-survives.test.tsx`). Reading it at render would
   * be reading a ref, which is the same race one layer along.
   *
   * **A wrapper object rather than `string | null`**, because `lastFailure()`
   * can itself answer `null` — a failure nobody wrote a sentence for — and the
   * two nulls mean opposite things. `null` here is "the POST has not failed".
   */
  const [failure, setFailure] = useState<{ reason: string | null } | null>(null);
  const failed = failure !== null;

  // Through a ref, the same way `useJobs` holds `onFinished`. `queue.add` is a
  // fresh closure on every poll, so depending on it directly would re-run this
  // effect once a second — harmless only because of the guard above, which is
  // not a thing to rely on. The ref is also what stops the linter offering the
  // fix that would do exactly that.
  const addRef = useRef(queue.add);
  addRef.current = queue.add;
  const uploadRef = useRef(queue.addUpload);
  uploadRef.current = queue.addUpload;
  /* Through a ref for the same reason the two above are: the effect must not
     re-run when the hook hands back a fresh closure on every poll. */
  const failureRef = useRef(queue.lastFailure);
  failureRef.current = queue.lastFailure;

  /**
   * Whether the engine is the one driving this address.
   *
   * A ref as well as the value, because the posting effect must **not** re-run
   * when a transfer finishes — it would see `posted.current` already set and do
   * nothing, which is right, but only by accident. Reading it through a ref
   * keeps the effect's dependency list honest about what it actually depends on.
   */
  const engineHasIt = mine !== null;
  const engineRef = useRef(engineHasIt);
  engineRef.current = engineHasIt;

  useEffect(() => {
    /* Cleared rather than simply skipped. Going from a URL we would add to one
       we would not — by editing the address bar, which does not remount this
       component — used to leave the previous job on screen, still running, and
       still able to navigate away when it finished. */
    if (!ok) {
      setStarted(null);
      setFailure(null);
      return;
    }
    /* **The engine owns this one.** It is going to post when the bytes land,
       and a second POST from here is how one upload turns into two requests for
       one claim. The server survives that — `queueAnUpload` answers the loser
       with the winner's job — but surviving a race is not a reason to run one. */
    if (engineRef.current) return;
    const want = `${attempt}\u0000${wanted}`;
    if (posted.current === want) return;
    posted.current = want;
    setStarted(null);
    setFailure(null);
    /* On `uploadId` rather than on `origin.kind`, so the effect reads only
       plain strings it also depends on — and so the union narrows, which
       `origin.kind === "upload"` does not do for a field read inside a
       dependency list. */
    const queueIt =
      uploadId !== undefined ? uploadRef.current(uploadId) : addRef.current(source);
    void queueIt.then((queued) => {
      /* **Only if this is still the POST we are waiting for.** Two `/add/`
         addresses in quick succession, or Retry, leave two requests in flight,
         and the first can land last — which would put the *first* article's job
         on screen and then navigate to it. The ref is the current request's
         name, so comparing against it is the check. GPT Sol, 2026-08-26.

         `null` means the POST itself failed. Without that branch the page sat
         on "Queueing it…" for ever, with no way to try again. */
      if (posted.current !== want) return;
      if (!queued) {
        /* **The reason is taken here and kept**, out of the durable
           `lastFailure` rather than the shared `error` — see `failure` above for
           the race, and `useStepJob` for the same fix on the thread page. */
        setFailure({ reason: failureRef.current() });
        return;
      }
      /* **Nothing was queued, because there was nothing left to queue.** A
         reload of `/add/upload/<id>` after retention has taken the ingest's job
         record away is answered with the article the file became rather than
         with a job — `queueAnUpload` in src/routes.ts. There is no card to
         show and nothing to wait for, so this is the same navigation the
         `done` effect below does, arriving a step earlier. */
      if ("article" in queued) {
        navigate(readHref(queued.article), { replace: true });
        return;
      }
      setStarted(queued.id);
    });
    /* The two plain strings, never `origin` itself. That object is a fresh
       literal on every render of the component above, so depending on it would
       re-run this effect once a second — harmless only because of the guard,
       which is not a thing to rely on. `uploadId` and `source` are strings (or
       `undefined`), so they are stable, and `wanted` is derived from them.
       Biome asks for them by name and it is right to. */
  }, [wanted, ok, attempt, uploadId, source]);

  /**
   * **The engine's outcome, adopted as this page's.**
   *
   * When the engine owns the transfer it is the thing that posted `/api/jobs`,
   * so the job id arrives on the snapshot rather than out of this page's own
   * request. Adopting it into `started` means everything below — the card, the
   * navigation on `done`, the tab title — goes on reading one variable and does
   * not have to know which of the two routes produced it.
   */
  const queuedJobId = mine?.phase.kind === "queued" ? mine.phase.job.id : null;
  useEffect(() => {
    if (queuedJobId) setStarted(queuedJobId);
  }, [queuedJobId]);

  /* The file turned out to be an article the reader already has, and retention
     has taken its job — `queueAnUpload` answers 200 `{article}`. Nothing to
     watch, so this is the same navigation the `done` effect below does,
     arriving earlier. `replace`, for the reason that effect gives. */
  const alreadyArticle = mine?.phase.kind === "article" ? mine.phase.slug : null;
  useEffect(() => {
    if (alreadyArticle) navigate(readHref(alreadyArticle), { replace: true });
  }, [alreadyArticle]);

  /**
   * **Waiting for a transfer this page cannot see.**
   *
   * Reload `/add/upload/<id>` while the original tab is still sending, or open
   * the address in a second one, and this page holds no `File` and no request in
   * flight — it cannot know when the bytes land. So the server refuses with
   * `UPLOAD_STILL_ARRIVING`, taking no claim and no quota slot
   * (`uploadHasArrived` in src/routes.ts), and this watches
   * `GET /api/uploads/:id` until the object is there, then asks for another go.
   *
   * **A GET on a timer rather than a POST on a timer.** Re-posting would be a
   * mutation in a loop, and the one thing it mutates is a claim that can be
   * taken exactly once.
   *
   * It gives up when the record can no longer become anything — the grant has
   * expired with nothing at that key, which is a transfer that is not coming
   * back. `asOf` reports that without writing anything, so asking is free.
   */
  const stillArriving = failure?.reason === UPLOAD_STILL_ARRIVING.message;
  useEffect(() => {
    if (!stillArriving || uploadId === undefined) return;
    let live = true;
    const timer = setInterval(() => {
      void (async () => {
        const seen = await readJson<{ arrived?: boolean; status?: string }>(
          await apiFetch(`/api/uploads/${encodeURIComponent(uploadId)}`),
        ).catch(() => null);
        if (!live || !seen) return;
        if (seen.status === "expired") {
          /* `null` rather than a sentence: `UPLOAD_MISSING` is the server's
             words for this and the reader gets them from the job if one is ever
             made. Here the honest thing is the page's own generic line plus the
             Try again, which is what a `null` reason renders. */
          setFailure({ reason: null });
          return;
        }
        /* `attempt` is what the posting effect's guard compares, so bumping it
           is how this asks for another go — the same door Retry knocks on. */
        if (seen.arrived) setAttempt((n) => n + 1);
      })();
    }, ARRIVAL_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [stillArriving, uploadId]);

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
          {origin.kind === "upload"
            ? /* The engine knows the filename from the moment the reader chose
                 it, where the job only learns it on the first poll — so when
                 this tab owns the transfer there is no second of "your file". */
              (mine?.filename ?? job?.upload?.filename ?? "your file")
            : ok
              ? source
              : url}
        </p>
      </header>

      {/* **The transfer, while it is this tab's to show.** Everything below
          this is about a job, and until the bytes have landed there is no job —
          which is the whole difference the background upload made to this page.
          Above the disclosure sentence rather than below it, because it is what
          the reader came here to watch. */}
      {mine && <Sending transfer={mine} />}

      {!ok && (
        <p className="tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground">
          That isn't a web address we can fetch. A host and a path is enough —{" "}
          <code className="tw:font-mono">example.com/an-essay</code> — and the{" "}
          <code className="tw:font-mono">https://</code> is optional.
        </p>
      )}

      {/* **What happened to the text, said on the page where it already has.**
          The shelf's add box says the present-tense half beside the Add button
          (`ADDING_SENDS_TEXT_AWAY`, src/web/AddArticle.tsx), because there the
          reader still has a choice to make. This page has no button and no
          form — a bookmarklet or a share sheet handed us an address, and the
          effect above queues it before the first paint — so by the time anyone
          reads this the POST has gone. Hence the past tense, and hence no
          checkbox: the two sentences differ on purpose, exactly as Referee
          mode's notice does (`REFEREE_TEXT_ALREADY_SENT`), and making them
          agree would mean making one of them false. A confirmation gate here
          is a product decision about a deliberately frictionless surface, and
          it is Greg's rather than ours.
          docs/plans/260831an-referee-mode-for-peer-reviewers.md § Confidentiality.

          Behind `ok`, because that is the flag on the effect that posts: an
          address we refused to queue is the one case where nothing was sent,
          and the past tense would be a lie about it. Above the progress card
          rather than under it, so it is read in the seconds spent watching the
          steps rather than after the navigation has already left.

          **And the tense goes back to the present while a file is still going
          up**, which is new on 2026-09-03 and is the same rule applied to a
          state that did not exist before. A reader who pressed Add ten seconds
          ago is watching their own bytes move towards *our* object store; not
          one word of the article has reached a model provider, and there is a
          Stop button on this page. Saying it "has been sent" then would be
          false in exactly the way this whole pair of sentences exists to
          prevent, and it would be false at the one moment the reader could
          still act on it. `ADDING_SENDS_TEXT_AWAY` is the shelf's wording and
          it is right here too, for the same reason: the choice is still open.
          `sending` covers hashing and granting as well, where nothing has left
          the machine at all. */}
      {ok && (
        <p className="tw:mb-4 tw:mt-0 tw:text-sm tw:text-muted-foreground">
          {stillSending(mine) ? ADDING_SENDS_TEXT_AWAY : DIRECT_ADD_SENT_TEXT_AWAY}
        </p>
      )}

      {/* **This is where a 402 lands for a pasted URL.** The shelf's Add button
          navigates here and the effect above posts, so the quota's refusal is
          read on this page rather than on the shelf — which is why the link to
          `/profile` has to be here too, and not only in the add box.
          QuotaNotice.tsx.

          `failure.reason` first and `queue.error` behind it: the first is the
          durable record of *this* POST's refusal and the second is whatever the
          engine is unhappy about right now, which is the right thing to show
          when nothing was refused (a poll that cannot reach the server). Taking
          them the other way round is the bug this pair was written to fix —
          see `failure` above. */}
      <QuotaNotice
        message={engineFailure(mine) ?? failure?.reason ?? queue.error}
        className="tw:mb-4 tw:text-sm tw:text-destructive"
      />

      {/* From the first render until the poll brings the job back — the POST
          and one poll, usually a fraction of a second. Deliberately *not*
          behind `useSlow` like the shelf's "Reading the shelf…": there the page
          is full of cards while you wait, and here it would be a heading and
          nothing else.

          **Not while a transfer is running**, which is the state `Sending`
          above is already describing at length. "Queueing it…" over a progress
          bar would be naming a request that has not been made and will not be
          for another two minutes. */}
      {ok && !job && !failed && !mine && (
        <p className="tw:text-sm tw:text-muted-foreground">Queueing it…</p>
      )}

      {/* **Waiting on a transfer in another tab.** This page posted, the server
          answered that the bytes are not there yet and took nothing, and the
          poll above is watching for them. Said out loud because the alternative
          is a page that looks stuck: no card, no bar, no error.
          `UPLOAD_STILL_ARRIVING` in src/messages.ts is the server's own words
          for the same state; this is the reader-side version, which can say
          *another tab* because it knows this one is not doing it. */}
      {stillArriving && (
        <p className="tw:text-sm tw:text-muted-foreground">
          Waiting for the file to finish arriving — it's being sent from another tab. This will
          start on its own.
        </p>
      )}

      {/* **Only when another go could come out differently.** `worthRetrying`
          is the one place that decides, and it says no to a `blocked` message —
          which every quota refusal is, because the count will be the same next
          time. A *Try again* under a sentence that has just said trying again
          will not help is a button that teaches the reader to distrust the
          sentence, and it is the same rule `JobCard` follows for the Retry on a
          failed step (src/job-failure.ts).

          The generic line goes with it: when the refusal above says what
          happened, "It didn't get as far as the queue" adds nothing. */}
      {failed && !stillArriving && worthRetrying(failure?.reason) && (
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

      {/* **The engine's own Try again, which is a different button.** It knows
          which phase failed and repeats only that: the bytes after a transport
          failure, or the queue request alone once the bytes have landed and
          `POST /api/jobs` was the thing refused. Re-PUTting a file that is
          already in Storage comes back `409 Duplicate` and would strand the
          reader short of the thing that actually broke — GPT Sol's finding 4 on
          the plan. The button above bumps `attempt` and re-posts, which is the
          right recovery for the pages the engine is not driving.

          It says which it will do, because the two differ by minutes on the
          connection this feature exists for. */}
      {mine?.phase.kind === "failed" && worthRetrying(mine.phase.reason) && (
        <p className="tw:mb-0 tw:text-sm tw:text-muted-foreground">
          <button
            type="button"
            className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-highlight tw:underline"
            onClick={() => uploadEngine.retry()}
          >
            Try again
          </button>
          {mine.phase.at === "queueing"
            ? " — the file is safely uploaded, so this only asks again."
            : " — this sends the file again from the start."}
        </p>
      )}

      {/* Stopped, and it stays stopped: nothing was queued, and nothing can be
          queued later either, because the object never arrived
          (`uploadHasArrived` in src/routes.ts). So this is a dead end, and it
          gets a way out rather than a state to wait in. */}
      {mine?.phase.kind === "cancelled" && (
        <p className="tw:mb-0 tw:text-sm tw:text-muted-foreground">
          You stopped that upload, so nothing was added. Choosing the file again on the shelf
          starts over.
        </p>
      )}

      {job && <JobCard job={job} queue={queue} onHide={() => navigate(LIBRARY_HREF)} />}

      {/* **The tab is the worker, said where somebody is watching it work.**
          `pump` in src/jobs.ts returns immediately on Vercel, so the only
          thing calling `/advance` in production is this page. The shelf's box
          says the same sentence over its own list (`JobList` in
          AddArticle.tsx); this page has one job and no list, so it says it
          here. Only while the job is going — it is advice about now, not a
          standing disclaimer under a finished import. */}
      {job && (job.status === "queued" || job.status === "running") && (
        <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:text-muted-foreground">{KEEP_A_TAB_OPEN}</p>
      )}

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
 * Whether this tab is still moving bytes, or about to be.
 *
 * The three phases in which **nothing of the article has left the machine for a
 * model provider** — the file is being hashed, the grant is being asked for, or
 * the PUT is going to our own object store. It is what decides the tense of the
 * disclosure sentence, so it is a function with a name rather than a condition
 * inlined in JSX: getting it wrong makes a false statement about a reader's
 * manuscript, which is what `DIRECT_ADD_SENT_TEXT_AWAY` exists to prevent.
 */
function stillSending(transfer: Transfer | null): boolean {
  const kind = transfer?.phase.kind;
  return kind === "hashing" || kind === "granting" || kind === "sending";
}

/** The sentence for a transfer that stopped, or null. `QuotaNotice` renders it. */
function engineFailure(transfer: Transfer | null): string | null {
  return transfer?.phase.kind === "failed" ? transfer.phase.reason : null;
}

/**
 * **The bytes, going.** The state this page did not have before 2026-09-03.
 *
 * Everything else here is about a job, and there is no job until the file has
 * landed — so without this the reader who pressed Add on a 40 MB PDF saw a
 * heading, a filename and nothing else for two minutes.
 *
 * A `<progress>` and bytes rather than a spinner and a percentage, matching the
 * shelf's own row exactly: the two questions during a long upload are *is it
 * moving* and *how much is left*, and a rounded percentage answers the first
 * badly — it sits on the same integer for seconds at a time.
 *
 * Stop is here as well as on the shelf because this is where the reader is. A
 * transfer nobody on this page can stop is a page they have to leave to escape.
 */
function Sending({ transfer }: { transfer: Transfer }) {
  if (!stillSending(transfer)) return null;
  const sent = transfer.phase.kind === "sending" ? transfer.phase.sent : 0;
  return (
    <div className="tw:mb-4" aria-live="polite">
      <div className="tw:flex tw:items-baseline tw:gap-3 tw:text-sm tw:text-muted-foreground">
        <span className="tw:flex-1">
          {transfer.phase.kind === "sending"
            ? `Sending your file — ${formatBytes(sent)} of ${formatBytes(transfer.bytes)}`
            : "Getting your file ready…"}
        </span>
        <button
          type="button"
          className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-highlight tw:underline"
          onClick={() => uploadEngine.cancel()}
        >
          Stop
        </button>
      </div>
      <progress
        className="tw:mt-2 tw:h-1 tw:w-full"
        value={sent}
        max={transfer.bytes}
        aria-label={`Uploading ${transfer.filename}`}
      />
      {/* **The tab has to stay open, and this is the one place it is true of the
          *file* rather than of the ingest.** `KEEP_A_TAB_OPEN` below says a
          Spideryarn tab must stay open for the job to keep advancing, and adds
          that it will continue when you return. That second half is false here:
          the bytes exist only in this browser until they reach Storage, so
          closing this tab loses them outright, and there is nothing to come back
          to. Hence its own sentence.

          Going to another page inside Spideryarn is fine, and saying so is most
          of the point — the whole change is that the reader may. */}
      <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-muted-foreground">
        Keep this tab open until the file has gone — you can carry on using
        Spideryarn in it. Closing it stops the upload.
      </p>
    </div>
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
