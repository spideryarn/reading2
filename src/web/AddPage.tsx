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
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "./Link.js";
import { JobCard } from "./AddArticle.js";
import { normaliseUrl, slugFromUrl } from "../ingest.js";
import { formatBytes } from "../uploads.js";
import { KEEP_A_TAB_OPEN } from "../job-state.js";
import {
  ADDING_SENDS_TEXT_AWAY,
  codeOfMessage,
  DIRECT_ADD_SENT_TEXT_AWAY,
  UPLOAD_STILL_ARRIVING,
  ADD_IMPORT_LOST,
  REPEAT_PASTE_ON_THE_SHELF,
  worthRetrying,
} from "../messages.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { QuotaNotice } from "./QuotaNotice.js";
import { LIBRARY_HREF, navigate, readHref } from "./router.js";
import type { Job } from "../types.js";
import { useJobs } from "./useJobs.js";
import { jobEngine } from "./jobEngine.js";
import { type Transfer, uploadEngine } from "./uploadEngine.js";
import { useUpload } from "./useUpload.js";
import { apiFetch, readJson } from "./lib/api.js";
import { AUTO_MODES_LABEL, autoModesDetail } from "./auto-modes.js";
import { useAutoModesSetting } from "./auto-modes-setting.js";
import { MAX_PURPOSE_CHARS } from "../types.js";
import { leavePurpose, savePurpose } from "./purpose.js";
import {
  type AddPurposeIo,
  AddPurposeSession,
  type AddPurposeSnapshot,
} from "./add-purpose.js";
import { SaveStatus, useUnsavedWarning } from "./ProfileBox.js";
import { markAskPurpose } from "./ask-purpose.js";
import { Button } from "@/components/ui/button";
import { withVoice } from "./voice.js";
import { HighPowerIntent, mayHaveStartedOnStandard, type PutHighPower } from "./add-high-power.js";
import { AddHighPower } from "./AddHighPower.js";
import { asVisibilityState } from "./AccessSharing.js";
import { type Probe, type ShareAtAdd, shareAtAddFor, type ShareIo, shareUnsettled } from "./add-share.js";
import { type LinkAtAdd, linkAtAddFor, type LinkIo, linkUnsettled } from "./add-share-link.js";
import { addSharingEpoch, subscribeAddSharing } from "./add-sharing-session.js";
import { AddSharing } from "./AddSharing.js";
import { asShareLinkState } from "./PrivateLink.js";

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

/**
 * The code on `UPLOAD_STILL_ARRIVING`, which is what the waiting page matches on.
 *
 * **The code and not the sentence.** Comparing prose means a client on an older
 * bundle, mid-deploy, holds one wording while the server has sent another — and
 * then a page that should be waiting for a file simply never starts, silently.
 * The bracketed codes exist for exactly this (docs/project/copy.md), and
 * `codeOfMessage` is how you read one. GPT Sol, finding 4.
 *
 * Derived from the message rather than written out, so the two cannot drift.
 */
const UPLOAD_WAIT_CODE = codeOfMessage(UPLOAD_STILL_ARRIVING.message);

/**
 * One way the add finished, and the article it became.
 *
 * `key` names *which* finish — `job:<id>` or `article:<slug>` — and is what the
 * once-guard compares, because StrictMode and a double press both arrive as
 * the same finish twice.
 */
interface Completion {
  key: string;
  slug: string;
  /** Which `/add/` address produced it, so an older address cannot finish this one. */
  source: string;
  /**
   * **A repeat paste**: the address was an article the reader already has, and
   * the server answered with it, free and with nothing queued. The page stops
   * at `repeat` to say so rather than opening by itself.
   * docs/plans/261007k-repeat-paste-is-free-and-says-so.md.
   */
  repeat?: true;
}

/**
 * **Between "the import is running" and "the article is open".**
 *
 * The page can stop between the two, and since plan 261004l it stops only
 * when it has to: the purpose box saves as it is typed, so at the end of the
 * import there is usually nothing left to decide and the article opens by
 * itself. It waits at *ready* when the box is focused, or holds words the
 * server does not have, or a save was refused, with one button: **Open the
 * article**. `opening` is that button pressed and waiting for the save it
 * started to land. A union rather than booleans so *ready* carries the
 * completion it is about, and *opened* cannot also be waiting.
 *
 * The first modes were queued when the import published, with the profile as
 * it stood then (plan 261004h § The purpose box). Saving as it is typed is
 * what puts the purpose in before that; a reader still typing at the end
 * misses them with whatever came after the last save.
 *
 * `running` covers everything before a completion, failed imports included.
 * docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md § 4.
 */
type Phase =
  | { kind: "running" }
  | { kind: "ready"; completion: Completion; opening: boolean }
  /** The article was already on the shelf: one sentence and one button. See `Completion.repeat`. */
  | { kind: "repeat"; completion: Completion }
  | { kind: "opened" };

/**
 * **The terminal act, and the only place the page leaves.** Open the article.
 *
 * **It queues no modes.** The server queued them when the import published
 * (src/store/pg-revisions.ts § `publishRevisionIn`), if the reader's setting
 * says so, and the app-wide job engine drives them from the reading view.
 * `replace`, so Back leaves the reading view for wherever the reader came from
 * rather than for a finished import.
 *
 * Callers take the once-guard (`claimed`) first; this does not check it.
 */
function openArticle(completion: Completion, highPower: HighPowerIntent): void {
  /* **A High-powered tick in the last second is still sent**, and not waited
     for. Each mode step reads the article's power as it starts, and none
     starts until the `labels` job ahead of it has ended, so a switch that has
     been committed by then is the one they run on. A step starting before
     the switch commits uses the standard model; later steps read it again
     (docs/project/high-powered-ai.md). `settle` never rejects. */
  void highPower.settle(completion.slug);
  navigate(readHref(completion.slug), { replace: true });
}

/**
 * The Metadata switch's own request — src/web/HighPowerSwitch.tsx — **made
 * for one reader**. The intent it is given to outlives the page and retries
 * each second, so without the reader a tick reader A made would be sent with
 * whoever's token is current by then: a spend reader B never chose. Sent as
 * anybody else it is not sent (`NotThisReader` in lib/api.ts), and a rejection
 * with no status stops the intent's retries.
 * docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md § 2.
 */
const putHighPowerFor =
  (readerId: string | null): PutHighPower =>
  (slug, on) =>
    apiFetch(
      `/api/article/${encodeURIComponent(slug)}/high-power`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on }),
      },
      readerId,
    ).then((r) => readJson<{ highPowerSince: string | null }>(r));

/**
 * *Make it public*'s two requests, and what the tab remembers
 * (src/web/add-share.ts).
 *
 * **The probe is the read Metadata's sharing card is drawn from**,
 * `GET /api/metadata/:slug`: 404 until the slug has a published revision, 200
 * once it has. Only a fresh server answer counts, and the body is never read:
 * `stillOnTheServer` in Metadata.tsx asks the same question the same way and
 * says why at length. `apiFetch` answers a GET it could not send from the
 * offline cache, as a 200 with a header on it, and a copy from last week does
 * not say there is an article here now.
 *
 * **The write is the card's own**, with its reply checked by the card's own
 * parser. `rightsConfirmed` goes on the publish only: the server refuses it on
 * an unpublish (AccessSharing.tsx § `set`).
 *
 * **The marks are `sessionStorage`, one key per slug**: this tab made that
 * slug public, or may have. They are what a reload has in place of a read
 * (GPT Sol's code review, F10) and are only ever a hint, so a storage that
 * throws (a private window, blocked site data) is a tab with no marks, and
 * the box then starts at off as it does in any other tab.
 */
const SHARE_MARK_PREFIX = "spideryarn.share-at-add.";

/** The two sharing controls' requests, for one reader. */
interface SharingIo {
  share: ShareIo;
  link: LinkIo;
}

/**
 * **One per reader** (GPT Sol's stage 2 plan review, F1), for the two things
 * in it that outlive a request:
 *
 *  - **the marks** carry the reader's id in their key, so what reader A's tab
 *    remembers is never read as a hint about reader B's article of the same
 *    slug;
 *  - **the probe in flight** is shared by the two controls, which ask at the
 *    same moment about the same slug: one request, not two. Shared only
 *    within one reader's object, so reader B's controllers never wait on a
 *    request sent as reader A.
 *
 * ***Create a private link*'s three requests are the Metadata card's own**
 * (PrivateLink.tsx), and its replies go through that card's own parser,
 * which is what makes sure a key is a key. The read's `404` is *no row yet*.
 * `apiFetch` never keeps a copy of this route (lib/api.ts § `NEVER_KEPT`), so
 * there is no offline copy to mistake for an answer. The key is in what
 * these return and nowhere else.
 *
 * **And every request here is sent as this reader or not at all** (plan
 * 261006e § 2, GPT Sol's F2). Retiring a controller stops its answer being
 * drawn; it cannot stop a *Make it public* that is still waiting for its
 * token, which would otherwise publish the next reader's article of the same
 * slug on this reader's confirmation.
 */
function sharingIo(readerId: string | null): SharingIo {
  /* `null` only where there is no session to name, which is a test. */
  const mark = (slug: string): string =>
    readerId === null ? SHARE_MARK_PREFIX + slug : `${SHARE_MARK_PREFIX}${readerId}.${slug}`;
  const probing = new Map<string, Promise<Probe>>();
  const probe = (slug: string): Promise<Probe> => {
    const out = probing.get(slug);
    if (out) return out;
    const asked = (async (): Promise<Probe> => {
      const res = await apiFetch(`/api/metadata/${encodeURIComponent(slug)}`, {}, readerId);
      if (res.headers.get("x-spideryarn-offline") === "copy") return "unknown";
      if (res.status === 404) return "none";
      return res.status === 200 ? "article" : "unknown";
    })();
    probing.set(slug, asked);
    const done = (): void => {
      if (probing.get(slug) === asked) probing.delete(slug);
    };
    void asked.then(done, done);
    return asked;
  };
  const linkPath = (slug: string): string => `/api/article/${encodeURIComponent(slug)}/share-link`;
  return {
    share: {
      marks: {
        recall(slug) {
          try {
            return window.sessionStorage.getItem(mark(slug)) !== null;
          } catch {
            return false;
          }
        },
        remember(slug) {
          try {
            window.sessionStorage.setItem(mark(slug), "1");
          } catch {
            /* Not remembered: a reload shows the box off, as another tab would. */
          }
        },
        forget(slug) {
          try {
            window.sessionStorage.removeItem(mark(slug));
          } catch {
            /* A storage that cannot be written held no mark we could have set. */
          }
        },
      },
      probe,
      put: (slug, to) =>
        apiFetch(
          `/api/article/${encodeURIComponent(slug)}/visibility`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              to === "public" ? { visibility: to, rightsConfirmed: true } : { visibility: to },
            ),
          },
          readerId,
        ).then(async (r) => asVisibilityState(await readJson<unknown>(r))),
    },
    link: {
      probe,
      async read(slug) {
        const res = await apiFetch(linkPath(slug), {}, readerId);
        if (res.status === 404) return "none";
        return asShareLinkState(await readJson<unknown>(res));
      },
      create: (slug) =>
        apiFetch(
          linkPath(slug),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            /* Exactly this. The server refuses any other body. */
            body: JSON.stringify({ rightsConfirmed: true }),
          },
          readerId,
        ).then(async (r) => asShareLinkState(await readJson<unknown>(r))),
      remove: (slug) =>
        apiFetch(linkPath(slug), { method: "DELETE" }, readerId).then(async (r) =>
          asShareLinkState(await readJson<unknown>(r)),
        ),
    },
  };
}

/** The object above for each reader this tab has had. Small, and holds nothing of theirs but an id. */
const sharingIos = new Map<string | null, SharingIo>();
function sharingIoFor(readerId: string | null): SharingIo {
  let io = sharingIos.get(readerId);
  if (!io) {
    io = sharingIo(readerId);
    sharingIos.set(readerId, io);
  }
  return io;
}

/**
 * The purpose session's three requests (src/web/add-purpose.ts). `save` and
 * `leave` are the ones Metadata's box, the first-open prompt and the profile
 * panel use: an empty box clears, and the answer is what the server stored.
 *
 * **For one reader**, the one the session was made for. A retired session
 * still sends its last words, by design, and by then the page may be gone and
 * somebody else signed in: each of the three is sent as this reader or not at
 * all (plan 261006e § 2). A refused send rejects, and the session's `flush`
 * swallows a failure.
 */
const purposeIoFor = (readerId: string | null): AddPurposeIo => ({
  async read(slug, signal) {
    const res = await apiFetch(
      `/api/reader?slug=${encodeURIComponent(slug)}`,
      { signal },
      readerId,
    );
    /* `apiFetch` answers a GET it could not send from the offline cache, as a
       200 with this header on it. A copy from last week does not say the
       article exists now, so the session does not seed from one (Sol's F5). */
    const fresh = res.headers.get("x-spideryarn-offline") !== "copy";
    const body = await readJson<{ purpose?: string | null; purposeFailed?: unknown }>(res);
    return { fresh, purpose: body.purpose ?? null, purposeFailed: body.purposeFailed };
  },
  save: async (slug, text) =>
    (await savePurpose(slug, text === "" ? null : text, readerId)) ?? "",
  leave: (slug, text) => leavePurpose(slug, text, readerId),
});

/**
 * **Sessions still finishing their last write, by reader and article.** A
 * retired session sends its latest words after any write in flight, and a new
 * session for the same article must not read or write until that has settled
 * (Sol's F9: `/add/https://example.com/paper` and the same with a trailing
 * slash are two addresses and one slug). At module level so it also holds
 * between a page that unmounted and the next one mounted on the same article.
 *
 * **The reader is in the key** (plan 261006e, GPT Sol's F4). Two readers can
 * each have an article under one slug, and they are two articles: reader B's
 * session has nothing to wait for in reader A's unanswered save, and keyed by
 * slug alone it waited for as long as that save took.
 */
const retiringPurposes = new Map<string, Promise<void>>();
const retiringKey = (reader: string | null, slug: string): string => JSON.stringify([reader, slug]);

function retirePurpose(held: PurposeHeld): void {
  const done = held.session.retire();
  const slug = held.session.slug;
  if (slug === null) return;
  const key = retiringKey(held.reader, slug);
  if (retiringPurposes.get(key) === done) return;
  retiringPurposes.set(key, done);
  void done.then(() => {
    if (retiringPurposes.get(key) === done) retiringPurposes.delete(key);
  });
}

/** For a test that left a write unanswered: later tests must not wait behind it. */
export function resetAddPurposeForTests(): void {
  retiringPurposes.clear();
}

/** The page's current purpose session, and the `/add/` address it belongs to. */
interface PurposeHeld {
  source: string;
  /** Who the session's requests are made for, and whose barrier it waits behind. */
  reader: string | null;
  session: AddPurposeSession;
  /** Release the read barrier only after this session's render commits. */
  activate(): void;
}

/**
 * **The session for this address and this article**, the held one or its
 * successor. One per `(source, slug)`:
 *
 *  - **a new address** starts with an empty box, and the old session is
 *    retired, which sends its last words to its own article;
 *  - **a new slug within one address** (the first job arriving, or a Retry
 *    that comes back with another article: `slugForRetry`) carries only words
 *    the reader typed. A box still showing a stored purpose they never edited
 *    is emptied, so one article's purpose is never written to another;
 *  - **no slug** (a poll that briefly has no matching job) keeps the session
 *    it has, as `HighPowerIntent.observe` keeps its slug;
 *  - **a retired session under the same address** is StrictMode's
 *    unmount-and-mount-again, or a page restored: succeeded like any other.
 */
function purposeFor(
  held: PurposeHeld | null,
  source: string,
  slug: string | null,
  reader: string | null,
): PurposeHeld {
  if (held === null) return prospectivePurpose(source, slug, "", reader);
  const same = held.source === source;
  const target = slug ?? (same ? held.session.slug : null);
  if (same && target === held.session.slug && !held.session.isRetired) return held;
  const text = same ? held.session.carried() : "";
  return prospectivePurpose(source, target, text, reader);
}

/** Creating a candidate during render must neither retire nor start a session. */
function prospectivePurpose(
  source: string,
  slug: string | null,
  text: string,
  reader: string | null,
): PurposeHeld {
  let release: () => void = () => {};
  const after = new Promise<void>((resolve) => { release = resolve; });
  return {
    source,
    reader,
    session: new AddPurposeSession(slug, purposeIoFor(reader), { after, text }),
    activate() {
      const previous =
        slug === null ? undefined : retiringPurposes.get(retiringKey(reader, slug));
      if (previous) void previous.then(release);
      else release();
    },
  };
}

/** Whether the file-owning tab still has a live add rather than an outcome. */
function transferIsActive(transfer: Transfer | null): boolean {
  const kind = transfer?.phase.kind;
  return (
    kind === "hashing" ||
    kind === "granting" ||
    kind === "sending" ||
    kind === "queueing" ||
    kind === "queued"
  );
}

/** The whole interval in which the reader can still choose what follows the add. */
function offerAutoModes(
  job: Job | null,
  transfer: Transfer | null,
  alreadyArticle: string | null,
  ok: boolean,
  failed: boolean,
  stillArriving: boolean,
): boolean {
  const activeJob = job?.status === "queued" || job?.status === "running";
  const awaitingJob =
    job === null &&
    alreadyArticle === null &&
    ok &&
    (transferIsActive(transfer) || (transfer === null && (!failed || stillArriving)));
  return activeJob || awaitingJob;
}

/**
 * **The job this page is watching, and what it is the answer to.**
 *
 * `source` and `reader` are what make a record inert when it is not this
 * page's any more: state updates run after render, so the first render at a
 * new address, or for a new reader, still holds the old record.
 *
 * `job` is the job as the POST (or Retry, or the upload engine) answered
 * with it, **held so the card does not wait for the list** (plan 261005l
 * § 2a): the list is polled, and its next answer can be eight seconds away,
 * which is most of a web import. It is drawn only until the list has a job
 * with this id; from then on the list's copy is the job.
 */
interface Started {
  id: string;
  source: string;
  reader: string | null;
  job: Job;
  vanished?: true;
}

/** Whether a POST's answer has what `JobCard` reads: see `heldJob` in `AddPage`. */
function isDrawableJob(job: unknown): job is Job {
  if (job === null || typeof job !== "object") return false;
  const { id, slug, status, steps } = job as Record<string, unknown>;
  return typeof id === "string" && typeof slug === "string" && typeof status === "string" && Array.isArray(steps);
}

export function AddPage({
  source: origin,
  readerId = null,
}: {
  source: AddSource;
  /**
   * **Who is adding**: `user.id` from `App`. A direct change of account can
   * leave this page mounted, and three things on it belong to one reader: the
   * held job, and the two sharing controllers, one of which holds a private
   * link's key (GPT Sol's stage 2 plan review, F1). Each is tagged or keyed
   * with this, so nothing of reader A's is drawn for reader B.
   *
   * **And every request the page makes is made for this reader**: the purpose
   * session's, High-powered AI's, the sharing controls' and the upload poll's
   * are sent as them or not at all (`NotThisReader` in lib/api.ts), because
   * several of those are sent after the page has gone. Since plan 261006e
   * `App` also gives the page a `key` of this id and stops the visit when it
   * changes (add-visit.ts), so a mounted page no longer sees it change; the
   * tags stay, as the page's own account of whose each thing is.
   *
   * `null` only where there is no session to name, which is a test.
   */
  readerId?: string | null;
}) {
  const queue = useJobs("watches-queue");
  const [started, setStarted] = useState<Started | null>(null);
  /* Read when a POST is sent, so its answer is tagged with the reader it was
     sent for and not with whoever is here when it lands. */
  const readerRef = useRef(readerId);
  readerRef.current = readerId;
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
   * that meant the refusal — and the link to the plans that the whole
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
   * **Generate the main modes once it is in** — Greg's tick box, on unless the
   * reader has switched it off. It is their setting, on their own row
   * (src/web/auto-modes-setting.ts): each change is a `PATCH`, and the server
   * reads the row when the import publishes. This page queues nothing.
   */
  const autoModes = useAutoModesSetting();

  /**
   * **High-powered AI for this add**, one intent per address — plan 261002k.
   * Replaced (and the old one's retries stopped) only when the address
   * changes, not on unmount: a reader who ticked it and then left has still
   * asked for it, and a request in flight finishes either way.
   */
  const highPowerRef = useRef<{ source: string; intent: HighPowerIntent } | null>(null);
  if (highPowerRef.current?.source !== wanted) {
    highPowerRef.current?.intent.dispose();
    highPowerRef.current = {
      source: wanted,
      intent: new HighPowerIntent(putHighPowerFor(readerId)),
    };
  }
  const highPower = highPowerRef.current.intent;
  const highPowerNow = useSyncExternalStore(highPower.subscribe, highPower.get);

  /**
   * **Why the reader is reading this**, asked while the import runs: the one
   * moment answering costs nothing extra (plan 260930e § Stage 1). The text
   * itself is in the purpose session, further down, once the slug is known.
   *
   * Focus is read through a ref at completion, because one of the three
   * completions arrives in a promise made by the posting effect (Sol's F2).
   * It counts, because a reader with the caret in an empty box may be about
   * to type, and navigating out from under them is not a decision they made.
   */
  const focusedRef = useRef(false);
  /**
   * **Whether the reader has ever been in the box** — focus or a keystroke —
   * for this source. Monotonic: a blur does not undo it, and only a new
   * address does. `focusedRef` is "in the box right now", which is the right
   * question for *waiting* and the wrong one for *asking again later*: a reader
   * who clicked in, thought, and clicked out has seen the question and passed
   * on it. Plan 261001s § Stage 3, GPT Sol's plan review item 2.
   */
  const purposeTouchedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>({ kind: "running" });
  /**
   * **The once-guard on the terminal decision**, holding the completion's key.
   * Synchronous, so StrictMode's second effect, or the two buttons pressed in
   * one frame, find it taken before anything has re-rendered. It is taken only
   * at the moment the article opens: the save decides *when*, this decides
   * *once*.
   */
  const claimed = useRef<string | null>(null);
  /* The retention-path `{article}` answer to this page's own POST, recorded
     rather than acted on — see `completion` below. */
  const [articleAnswer, setArticleAnswer] = useState<{
    slug: string;
    source: string;
    repeat: boolean;
  } | null>(null);

  /* The component is reused when the address after `/add/` changes. What the
     reader did in the old article's box must not follow it to the new one, and
     an old save answering later must not open the old article over the new
     page. The text goes with the session (`purposeFor`). This is keyed only by
     the source, not `attempt`: Retry is still the same add and deliberately
     keeps the draft. */
  const sourceRef = useRef(wanted);
  useLayoutEffect(() => { sourceRef.current = wanted; }, [wanted]);
  const draftSource = useRef(wanted);
  useEffect(() => {
    /* StrictMode repeats effect setup for the same mount; that is not a new
       address and must not release the terminal once-guard. */
    if (draftSource.current === wanted) return;
    draftSource.current = wanted;
    focusedRef.current = document.activeElement?.id === "add-purpose";
    purposeTouchedRef.current = focusedRef.current;
    setPhase({ kind: "running" });
    claimed.current = null;
  }, [wanted]);

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
    setArticleAnswer(null);
    setPhase({ kind: "running" });
    claimed.current = null;
    const reader = readerRef.current;
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
         show and nothing to wait for, so this is a completion arriving a step
         earlier — recorded, and decided with the other two below. */
      /* **Or the address was already one of the reader's articles** — a repeat
         paste, answered `{ article, repeat: true }` with nothing spent and
         nothing queued. The same completion, marked, so the page says so. */
      if ("article" in queued) {
        setArticleAnswer({ slug: queued.article, source: wanted, repeat: queued.repeat === true });
        return;
      }
      /* The job itself is kept, and not only its id: it is what the page
         draws until the polled list has it (`Started`). */
      setStarted({ id: queued.id, source: wanted, reader, job: queued });
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
  const queuedJob = mine?.phase.kind === "queued" ? mine.phase.job : null;
  const queuedJobId = queuedJob?.id ?? null;
  /* The engine's own copy of the job goes with the id, so an upload's card
     does not wait for the list either (GPT Sol's stage 2 plan review, F4).
     Through a ref: the effect is about a new id, and must not run again, over
     a Retry's replacement, because the snapshot object was rebuilt. */
  const queuedJobRef = useRef(queuedJob);
  queuedJobRef.current = queuedJob;
  useEffect(() => {
    const job = queuedJobRef.current;
    if (queuedJobId && job) {
      setStarted({ id: queuedJobId, source: wanted, reader: readerRef.current, job });
    }
  }, [queuedJobId, wanted]);

  /* The file turned out to be an article the reader already has, and retention
     has taken its job — `queueAnUpload` answers 200 `{article}`. Nothing to
     watch: it is a completion, decided below with the other two. */
  const alreadyArticle = mine?.phase.kind === "article" ? mine.phase.slug : null;

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
  const stillArriving =
    failure?.reason !== undefined &&
    failure.reason !== null &&
    codeOfMessage(failure.reason) === UPLOAD_WAIT_CODE;
  useEffect(() => {
    if (!stillArriving || uploadId === undefined) return;
    let live = true;
    const timer = setInterval(() => {
      void (async () => {
        /* As the reader who is waiting, or not at all (plan 261006e § 2).
           One chain, so a request that was refused or never left is caught
           with a body that could not be read: `readJson(await …).catch` let
           the first of those out as an unhandled rejection. */
        const seen = await apiFetch(`/api/uploads/${encodeURIComponent(uploadId)}`, {}, readerId)
          .then((r) => readJson<{ arrived?: boolean; status?: string }>(r))
          .catch(() => null);
        if (!live || !seen) return;
        /* Nothing to act on yet, and the timer stays armed. */
        const done = seen.status === "expired" || seen.arrived === true;
        if (!done) return;
        /* **Closed synchronously, before either branch below acts.** A `GET`
           slower than the interval leaves two callbacks in flight, and if both
           come back `arrived` both bump `attempt` — two POSTs for one upload,
           which at the reader's last quota slot can hand the loser a 402 about a
           job the winner has already made. `resolveExistingUpload` closes
           *sequential* repeats; it cannot close two requests that both read
           `pending`. GPT Sol, finding 4. */
        live = false;
        clearInterval(timer);
        if (seen.status === "expired") {
          /* Stopped by the reader, or its grant swept — `cancelUpload` in
             src/upload-records.ts puts a record here. `null` rather than a
             sentence: the page's own line plus a Try again is the honest
             rendering, and `UPLOAD_MISSING`'s words belong to a job that in this
             case was never made. */
          setFailure({ reason: null });
          return;
        }
        /* `attempt` is what the posting effect's guard compares, so bumping it
           is how this asks for another go — the same door Retry knocks on. */
        setAttempt((n) => n + 1);
      })();
    }, ARRIVAL_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [stillArriving, uploadId, readerId]);

  /* State updates run after render, so an old `started` can still be present in
     the first render for a new address. The source tag makes it inert during
     that render instead of letting its completed job reopen the old article. */
  /* And the reader tag does the same across a change of account, which can
     leave this page mounted: reader A's job is not reader B's to see (F1). */
  const current = started?.source === wanted && started.reader === readerId ? started : null;
  const startedId = current?.id ?? null;
  const vanished = current?.vanished === true;
  const failed = failure !== null || vanished;
  /* **The list's copy, and until it has one, the copy the POST answered
     with** (plan 261005l § 2a). Everything keyed on the job's slug below
     (the card and its link button, High-powered AI, Sharing, the purpose
     box) so starts with the POST's answer and not a poll later. The held
     copy follows every newer list answer; it never reverts to POST-time
     status when a later list omits a dismissed job. */
  const listed = queue.jobs.find((j) => j.id === startedId) ?? null;
  /* **Only a reply that is a job is drawn as one.** `queue.add`'s answer is
     read off the wire unchecked, and `JobCard` reads `steps`: a 2xx of another
     shape used to cost nothing here, because only its id was kept, and must
     not now take the page down. Without a drawable copy the page waits for
     the list, as it did before it held one. Found by
     tests/dock-corner-controls.test.tsx in the full suite. */
  const heldJob = current && isDrawableJob(current.job) ? current.job : null;
  const heldStatus = heldJob?.status;
  const heldEnded = heldStatus === "done" || heldStatus === "error" || heldStatus === "cancelled";
  /* An advance may report an ending before the list catches up. A terminal
     job never becomes active under the same id; Retry makes a new id. */
  const listedIsOlder = heldEnded && (listed?.status === "queued" || listed?.status === "running");
  const newerList = listedIsOlder ? null : listed;
  const job = vanished ? null : newerList ?? heldJob;
  useLayoutEffect(() => {
    if (!newerList) return;
    setStarted((held) =>
      held?.id === startedId && held.source === wanted && held.reader === readerId && held.job !== newerList
        ? { ...held, job: newerList }
        : held,
    );
  }, [newerList, startedId, wanted, readerId]);

  /* A fresh omission, or an advance ending while list polling is paused,
     must also supersede the provisional POST answer. The engine already
     fences lists requested before this watcher; an old empty list is not
     evidence of disappearance. Every callback belongs to this attachment. */
  useLayoutEffect(() => {
    if (!startedId || vanished || (heldStatus !== "queued" && heldStatus !== "running")) return;
    let live = true;
    const stop = jobEngine.watchTerminal(startedId, (outcome) => {
      if (!live) return;
      setStarted((held) => {
        if (held?.id !== startedId || held.source !== wanted || held.reader !== readerId) return held;
        return outcome.kind === "vanished"
          ? { ...held, vanished: true }
          : { ...held, job: outcome.job };
      });
    });
    return () => { live = false; stop(); };
  }, [startedId, heldStatus, vanished, wanted, readerId]);

  /**
   * **The three ways an add finishes, as one value.** A job reaching `done`, the
   * engine's upload answered with an existing article, and this page's own POST
   * answered the same way. Each used to queue and navigate by itself; now they
   * only *say* the add is finished, and the one effect below decides what that
   * means — so the rule about the purpose box cannot be kept by two of them and
   * forgotten by the third (Sol's F2).
   */
  const completion: Completion | null =
    job?.status === "done"
      ? { key: `job:${job.id}`, slug: job.slug, source: wanted }
      : alreadyArticle
        ? { key: `article:${wanted}:${alreadyArticle}`, slug: alreadyArticle, source: wanted }
        : articleAnswer?.source === wanted
          ? {
              key: `article:${wanted}:${articleAnswer.slug}`,
              slug: articleAnswer.slug,
              source: wanted,
              ...(articleAnswer.repeat ? { repeat: true as const } : {}),
            }
          : null;
  const completionKey = completion?.key ?? null;
  const completionSlug = completion?.slug ?? null;
  const completionRepeat = completion?.repeat === true;
  /* Published with the committed screen. A prospective completion in a
     suspended render must not disable the old screen's Open button. */
  const activeCompletionKey = useRef<string | null>(completionKey);
  useLayoutEffect(() => { activeCompletionKey.current = completionKey; }, [completionKey]);

  /* **What High-powered AI may send to, and whether a 404 is *not yet*.** The
     job's own slug, or the completion's — never one derived from the address.
     Alive until the job ends; before there is a job, alive while nothing has
     finished. Every render: `observe` only sends when there is something to. */
  const highPowerSlug = job?.slug ?? completion?.slug ?? null;
  const highPowerAlive = !vanished && (job ? job.status === "queued" || job.status === "running" : completion === null);
  const highPowerLate = mayHaveStartedOnStandard(job?.steps, Boolean(job?.upload)) || (job === null && completion !== null);
  useEffect(() => {
    highPower.observe(highPowerSlug, highPowerAlive, highPowerLate);
  }, [highPower, highPowerSlug, highPowerAlive, highPowerLate]);

  /**
   * ***Make it public* for this add** — plan 261005l § 3. The tab keeps one
   * controller per slug (add-share.ts § `shareAtAddFor`), and this page shows
   * the one for its article: the job's own slug, or the completion's, never
   * one derived from the address — the same rule as High-powered AI above.
   *
   *  - **Looked up by slug alone, not by address.** Two addresses that name
   *    one article show the same controller with the state it has, so there
   *    is one writer per slug (GPT Sol's code review, F12).
   *  - **A Retry that comes back under another slug** (`slugForRetry`) shows
   *    that slug's own controller, unticked. Nothing is sent about the old
   *    slug: its controller stays in the registry as it was (F11).
   *  - **No slug** (a poll that briefly has no matching job) keeps the one
   *    this address last had, as `purposeFor` keeps its session. A new
   *    address shows none until its own job has a slug.
   *
   * Looking one up starts nothing. The committed render starts its probe and
   * attaches it; leaving it, by unmount or for another slug, pauses its
   * unsent retries without undoing anything it shared. Effect replay under
   * StrictMode reattaches the same controller.
   */
  /*
   * **And *Create a private link* beside it** (plan 261005l § 2b): its own
   * controller, `LinkAtAdd`, looked up, attached, paused and settled exactly
   * as the one above, for the same slug.
   *
   * **Both belong to this reader** (GPT Sol's stage 2 plan review, F1). The
   * registries are keyed by reader and slug, and a session change retires
   * every controller in them (add-sharing-session.ts). The epoch read here
   * is what makes this page look its controllers up again when that happens
   * while it is on screen; the slug it remembers is tagged with the reader
   * for the same reason `started` is.
   */
  useSyncExternalStore(subscribeAddSharing, addSharingEpoch);
  const shareSlugRef = useRef<{ source: string; reader: string | null; slug: string } | null>(null);
  const shareSlug =
    highPowerSlug ??
    (shareSlugRef.current?.source === wanted && shareSlugRef.current.reader === readerId
      ? shareSlugRef.current.slug
      : null);
  const sharingIo = sharingIoFor(readerId);
  const share = shareSlug === null ? null : shareAtAddFor(shareSlug, sharingIo.share, readerId);
  const link = shareSlug === null ? null : linkAtAddFor(shareSlug, sharingIo.link, readerId);
  /* What the completion effect reads: the controllers on the committed screen. */
  const shareRef = useRef<ShareAtAdd | null>(null);
  const linkRef = useRef<LinkAtAdd | null>(null);
  useLayoutEffect(() => {
    shareSlugRef.current =
      shareSlug === null ? null : { source: wanted, reader: readerId, slug: shareSlug };
    shareRef.current = share;
    linkRef.current = link;
  }, [share, link, shareSlug, wanted, readerId]);
  useLayoutEffect(() => {
    share?.start();
    share?.resume();
    return () => share?.pause();
  }, [share]);
  useLayoutEffect(() => {
    link?.start();
    link?.resume();
    return () => link?.pause();
  }, [link]);
  /* Whether a 404 from either is *not yet*: the same question High-powered
     AI asks, with the same answer. */
  useEffect(() => {
    share?.observe(highPowerAlive);
    link?.observe(highPowerAlive);
  }, [share, link, highPowerAlive]);

  /**
   * **The purpose session for this address and this article** (plan 261004l
   * § 1). The job's own slug, or the completion's, never one derived from the
   * address: the same rule as High-powered AI above. Render selects a candidate;
   * only a committed render retires the previous session and releases the
   * candidate's read barrier. A suspended render may leave the old box in use.
   */
  const purposeRef = useRef<PurposeHeld | null>(null);
  const purposeHeld = purposeFor(
    purposeRef.current,
    wanted,
    job?.slug ?? completion?.slug ?? null,
    readerId,
  );
  const purpose = purposeHeld.session;
  useLayoutEffect(() => {
    if (purposeRef.current === purposeHeld) return;
    if (purposeRef.current) retirePurpose(purposeRef.current);
    purposeRef.current = purposeHeld;
    purposeHeld.activate();
  }, [purposeHeld]);
  const purposeNow = useSyncExternalStore(purpose.subscribe, purpose.get);

  /* The read of the stored purpose runs while the add is alive: a job queued
     or running, or a completion. A stopped job gets one last try, and its
     Retry a fresh run (add-purpose.ts § `observe`). */
  const purposeAlive =
    completion !== null || job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    purpose.observe(purposeAlive);
  }, [purpose, purposeAlive]);
  /* And a read that gave up while the job sat queued starts again once there
     is a completion, because the row exists by then. */
  useEffect(() => {
    if (completionKey !== null) purpose.completed();
  }, [purpose, completionKey]);

  /* The session owns its pause, including edits while React is rendering a
     replacement that has not committed. */
  /* The browser's own question on closing the tab. It covers words typed
     before there is an article to save them to. A click on *Back to the shelf*
     is not stopped; unmounting sends what can be sent. */
  useUnsavedWarning(purposeNow.unsaved);

  /* **And on the way out.** A hidden tab saves while there is still time;
     `pagehide` sends the `keepalive` write at once; unmounting retires the
     session, which is ordered after any write in flight because the page
     lives on. Through the ref, so each reaches whichever session is current. */
  const [, renewPurpose] = useState(0);
  useEffect(() => {
    /* StrictMode ran the cleanup below and then this again. The retired
       session needs its successor, and only a render makes one. */
    if (purposeRef.current?.session.isRetired) renewPurpose((n) => n + 1);
    const hidden = (): void => {
      if (document.visibilityState === "hidden") purposeRef.current?.session.commit();
    };
    const leaving = (): void => purposeRef.current?.session.leaveNow();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
      if (purposeRef.current) retirePurpose(purposeRef.current);
    };
  }, []);

  /** Open it, once. Callers have checked the fences; this takes the guard. */
  const finish = (done: Completion): void => {
    claimed.current = done.key;
    setPhase({ kind: "opened" });
    openArticle(done, highPower);
  };

  useEffect(() => {
    if (completionKey === null || completionSlug === null) return;
    if (claimed.current === completionKey) return;
    const finished: Completion = {
      key: completionKey,
      slug: completionSlug,
      source: wanted,
      ...(completionRepeat ? { repeat: true as const } : {}),
    };
    /* A different completion supersedes a press still waiting on the old one.
       The waiting effect below checks this guard before doing anything. */
    claimed.current = null;
    /* **The import has finished, so the article's row exists**: a share still
       waiting for it is sent now, and one that gave up while the job sat
       queued is sent again (add-share.ts § `settle`). Here and not in
       `openArticle`, because what it answers decides whether the page leaves.
       Only the share for this completion's own article. */
    const sharing = shareRef.current?.slug === completionSlug ? shareRef.current : null;
    if (sharing) void sharing.settle();
    /* The private link's controller the same, for the same reason. A create
       that did not come back is not among what it sends (add-share-link.ts). */
    const linking = linkRef.current?.slug === completionSlug ? linkRef.current : null;
    if (linking) void linking.settle();
    /* **A third reason not to leave by itself**: the sharing confirmation is
       open, or there is an answer about sharing the reader has not had the
       chance to read. A fast import would otherwise navigate out from under
       the question. A share that is on, or a box never touched, holds nothing
       up. GPT Sol's plan review, P2-5. */
    const sharingUnsettled =
      (sharing !== null && shareUnsettled(sharing.get())) ||
      (linking !== null && linkUnsettled(linking.get()));
    /* **A repeat paste never leaves by itself**: nothing was imported, and
       opening at once would show the reader nothing they could notice. Greg
       asked for the repeat to be signalled (plan 261007k). */
    if (completionRepeat) {
      /* The request can be slow enough for the reader to enter a purpose.
         Keep their draft and the save controls instead of hiding a refused save. */
      setPhase(
        purposeTouchedRef.current || purposeRef.current?.session.get().unsaved
          ? { kind: "ready", completion: finished, opening: false }
          : { kind: "repeat", completion: finished },
      );
      return;
    }
    /* **Nothing to wait for**: the box is not focused, and it holds nothing
       the server does not have. Never typed in, or typed and saved with no
       write in flight. Read from the session in this tick, not from a render. */
    if (
      !focusedRef.current &&
      !purposeRef.current?.session.get().unsaved &&
      !sharingUnsettled
    ) {
      /* **And ask once, when it opens**, if the reader never so much as
         clicked into the box: the "didn't notice it" case. Greg, 2026-10-01,
         spya-hbqezu; plan 261001s § Stage 3. Only here: either button is a
         reader who saw the box. A re-add of an article already on the shelf is
         marked too, on purpose (Sol's item 1): the reading view asks only if
         it has no purpose. */
      if (!purposeTouchedRef.current) markAskPurpose(completionSlug);
      claimed.current = completionKey;
      setPhase({ kind: "opened" });
      openArticle(finished, highPower);
      return;
    }
    /* Otherwise wait, indefinitely. A blur saves; it is not a decision to leave. */
    setPhase({ kind: "ready", completion: finished, opening: false });
  }, [completionKey, completionSlug, completionRepeat, wanted, highPower]);

  const mayOpen = (done: Completion): boolean =>
    claimed.current !== done.key &&
    activeCompletionKey.current === done.key &&
    sourceRef.current === done.source;

  /**
   * **Open the article**: commit, and open once nothing is unsaved and no
   * write is in flight, the latch `PurposePrompt`'s *Done* uses. With nothing
   * to save that is this tick. Otherwise `opening` waits for the save, and
   * the effect below opens when it lands or lets go when it is refused.
   */
  const openTheArticle = (): void => {
    if (phase.kind !== "ready" || !mayOpen(phase.completion)) return;
    purpose.commit();
    const now = purpose.get();
    if (!now.unsaved) {
      finish(phase.completion);
      return;
    }
    /* The read of the stored purpose gave up, so no save can start. */
    if (cannotSave(now)) return;
    setPhase({ kind: "ready", completion: phase.completion, opening: true });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `purposeNow` is the trigger. What is decided on is read from the session in this tick.
  useEffect(() => {
    if (phase.kind !== "ready" || !phase.opening || !mayOpen(phase.completion)) return;
    const now = purposeRef.current?.session.get();
    if (!now) return;
    if (!now.unsaved) {
      finish(phase.completion);
      return;
    }
    /* A refusal lets go: the reason is in the status line, the words are in
       the box, and *Open without saving* appears beside the button. */
    if (cannotSave(now)) setPhase({ kind: "ready", completion: phase.completion, opening: false });
  }, [phase, purposeNow]);

  /** A repeat's *Open the article*: nothing was imported, so there is nothing of the import's to save. */
  const openTheRepeat = (): void => {
    if (phase.kind !== "repeat" || !mayOpen(phase.completion)) return;
    finish(phase.completion);
  };

  /** **Open without saving**: give the draft up, so retiring does not send it, and open. */
  const openWithoutSaving = (): void => {
    if (phase.kind !== "ready" || !mayOpen(phase.completion)) return;
    purpose.abandon();
    finish(phase.completion);
  };

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

  /* Before a job exists, a URL is waiting for its POST and an upload is either
     moving in this tab or still arriving in another one. The choice matters in
     all of those states, especially the minutes-long file transfer; showing it
     only once a job row appeared made the upload path needlessly different. */
  /* A repeat offers no new import choices. A purpose already entered or a
     High-powered choice made while awaiting the answer still needs its controls. */
  const repeated = completionRepeat;
  const showAutoModes =
    !repeated && offerAutoModes(job, mine, alreadyArticle, ok, failed, stillArriving);
  /* Waiting on the reader, with the add finished. The tick box stays up
     through this too: it is the reader's setting and can still be changed. */
  const deciding = phase.kind === "ready";
  /* **Drawn from the phase, not from `offerAutoModes`** (Sol's F4): that is
     false for a finished job and for an existing-article answer, which are
     exactly when the box has to stay. While running it also stays over a failed
     job, whose card has a Retry that may yet finish it (F3). */
  const showPurpose = deciding || (phase.kind === "running" && (showAutoModes || job !== null));
  /* A failed or stopped job is not on its way to making the article: its
     card's Retry may yet, but "it saves once the article exists" would be a
     promise. The 261001s browser check found that line under a failed import. */
  const jobStopped = job?.status === "error" || job?.status === "cancelled";
  const uploadFilename =
    origin.kind === "upload" ? (mine?.filename ?? job?.upload?.filename) : undefined;
  const originLabel =
    origin.kind === "upload"
      ? uploadFilename
        ? { text: uploadFilename, voice: "reader" as const }
        : { text: "your file", voice: "ui" as const }
      : { text: ok ? source : url, voice: "reader" as const };

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
        <p
          className={withVoice(
            "tw:mt-2 tw:mb-0 tw:text-[13px] tw:break-all tw:text-muted-foreground",
            originLabel.voice,
          )}
        >
          {originLabel.text}
        </p>
      </header>

      {/* **The transfer, while it is this tab's to show.** Everything below
          this is about a job, and until the bytes have landed there is no job —
          which is the whole difference the background upload made to this page.
          Above the disclosure sentence rather than below it, because it is what
          the reader came here to watch. */}
      {mine && <Sending transfer={mine} />}
      {/* **Queueing gets a line and no button.** One small request, and it
          cannot be undone — see `cancel` in uploadEngine.ts. Saying so beats
          both a Stop that declines and a bar that has silently stopped moving. */}
      {mine?.phase.kind === "queueing" && (
        <p className="tw:mb-4 tw:mt-0 tw:text-sm tw:text-muted-foreground">
          Your file is safely uploaded. Starting the import…
        </p>
      )}

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

          **And the question is "has this been queued", not "has the transfer
          stopped"** — see `textHasGone`. Asking it the other way round, which is
          what the first version did, put the past tense over a file the reader
          had just pressed Stop on, over a queue request refused 402, and in a
          second tab that then said the text had gone and that the file was still
          arriving in consecutive sentences. GPT Sol, 2026-09-03, finding 3.

          **Not over a repeat paste**, which sent nothing anywhere: the server
          answered with the article already on the shelf (plan 261007k). */}
      {ok && !repeated && (
        <p className="tw:mb-4 tw:mt-0 tw:text-sm tw:text-muted-foreground">
          {textHasGone(mine, origin.kind === "upload", startedId !== null)
            ? DIRECT_ADD_SENT_TEXT_AWAY
            : ADDING_SENDS_TEXT_AWAY}
        </p>
      )}

      {/* **This is where a 402 lands for a pasted URL.** The shelf's Add button
          navigates here and the effect above posts, so the quota's refusal is
          read on this page rather than on the shelf — which is why the link to
          the plans has to be here too, and not only in the add box.
          QuotaNotice.tsx.

          `failure.reason` first and `queue.error` behind it: the first is the
          durable record of *this* POST's refusal and the second is whatever the
          engine is unhappy about right now, which is the right thing to show
          when nothing was refused (a poll that cannot reach the server). Taking
          them the other way round is the bug this pair was written to fix —
          see `failure` above. */}
      <QuotaNotice
        message={engineFailure(mine) ?? failure?.reason ?? (vanished ? ADD_IMPORT_LOST : queue.error)}
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
      {/* And not once the POST has answered with an article, which is a
          completion with no job: the upload retention path, or a repeat. */}
      {ok && !job && !failed && !mine && !completion && (
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
      {failed && !vanished && !stillArriving && worthRetrying(failure?.reason) && (
        <p className="tw:mb-0 tw:text-sm tw:text-muted-foreground">
          It didn't get as far as the queue.{" "}
          <button
            type="button"
            className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-highlight-text tw:underline"
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
          connection this feature exists for.

          **A `queueing` failure always gets one, even a quota refusal**, and
          that is the exception `worthRetrying` cannot make for itself. Its rule
          is right everywhere else: a quota code is `blocked`, because the count
          will be the same next time, and offering a retry under a sentence that
          has just said trying again will not help teaches the reader to distrust
          the sentence. But this button is *precisely* what a reader presses
          after upgrading — their file is already in Storage, and the alternative
          is uploading 40 MB again to reach a POST that costs nothing. Hiding it
          made the recovery this whole feature promises reachable only from
          DevTools. GPT Sol, finding 1. */}
      {mine?.phase.kind === "failed" &&
        (mine.phase.at === "queueing" || worthRetrying(mine.phase.reason)) && (
        <p className="tw:mb-0 tw:text-sm tw:text-muted-foreground">
          <button
            type="button"
            className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-highlight-text tw:underline"
            onClick={() => uploadEngine.retry()}
          >
            Try again
          </button>
          {mine.phase.at === "queueing"
            ? " — the file is safely uploaded, so this only asks again."
            : " — this sends the file again from the start."}
        </p>
      )}

      {/* Stopped, and it stays stopped — and since 2026-09-03 that is the
          **server's** position rather than this tab's. `cancel()` sends
          `DELETE /api/uploads/:id`, which moves the record `pending → expired`,
          so a reload of this address is answered instead of polled at, and a
          second tab cannot queue an upload whose object happened to land in the
          moment before Stop was pressed. Without that DELETE, *"nothing was
          added"* was a claim only the browser was making. GPT Sol, finding 2. */}
      {mine?.phase.kind === "cancelled" && (
        <p className="tw:mb-0 tw:text-sm tw:text-muted-foreground">
          You stopped that upload, so nothing was added. Choosing the file again on the shelf
          starts over.
        </p>
      )}

      {/* `onRetried`: a retry is a new job with a new id, and this page watches
          one id — without following it, a retried import that succeeds never
          opens (Sol's F3, watched red in tests/add-page-purpose.test.tsx). */}
      {job && (
        <JobCard
          job={job}
          queue={queue}
          onHide={() => navigate(LIBRARY_HREF)}
          /* The replacement itself is held, as the add POST's answer is: the
             card moves to it, under its own id and slug, without waiting for
             the list to have it (GPT Sol's stage 2 plan review, F4). */
          onRetried={(replacement) =>
            setStarted({ id: replacement.id, source: wanted, reader: readerId, job: replacement })
          }
        />
      )}

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

      {/* Offered for the whole add — including a file transfer before its job
          exists. Each change is sent to the reader's setting, and the server
          reads the committed choice when the import publishes.
          src/web/auto-modes-setting.ts. */}
      {!repeated && (showAutoModes || deciding) && (
        <label className="tw:mt-3 tw:flex tw:items-start tw:gap-2 tw:text-sm">
          <input
            type="checkbox"
            className="tw:mt-0.5"
            checked={autoModes.on}
            onChange={(event) => autoModes.set(event.target.checked)}
          />
          <span>
            {AUTO_MODES_LABEL}
            <span className="tw:block tw:text-muted-foreground">{autoModesDetail()}</span>
            {autoModes.saving && (
              <span role="status" className="tw:block tw:text-muted-foreground">
                Saving your choice. The import uses the last saved choice when it finishes.
              </span>
            )}
            {autoModes.loadError && (
              <span role="alert" className="tw:block tw:text-muted-foreground">
                Could not read your saved choice. Reload to try again.
              </span>
            )}
            {autoModes.error && (
              <span role="alert" className="tw:block tw:text-muted-foreground">
                The save request failed. Check the choice above and try again.
              </span>
            )}
          </span>
        </label>
      )}
      {((!repeated && (showAutoModes || deciding)) || (repeated && highPowerNow.kind !== "off")) && (
        <AddHighPower intent={highPower} repeat={repeated} />
      )}
      {/* Under High-powered AI, once the job has a slug to share: one row,
          shut until the reader opens it or a control has something to say
          (AddSharing.tsx). `offer` is the interval the two boxes above are
          drawn for; sharing that has been asked for stays up outside it.
          Keyed on the reader and the slug, so the row's own open-or-shut
          belongs to one article and one reader. */}
      {share && link && (
        <AddSharing
          key={JSON.stringify([readerId, share.slug])}
          share={share}
          link={link}
          offer={!repeated && (showAutoModes || deciding)}
        />
      )}

      {showPurpose && (
        <PurposeBox
          now={purposeNow}
          stopped={jobStopped}
          onChange={(value) => {
            /* Straight into the session, which is what a completion landing
               before the next render will read. */
            purposeTouchedRef.current = true;
            purpose.setText(value, true);
          }}
          onFocusChange={(focused) => {
            focusedRef.current = focused;
            if (focused) purposeTouchedRef.current = true;
            /* A blur saves. While waiting at the end it still does not open. */
            else purpose.commit();
          }}
          /* ⌘/Ctrl+Enter saves while the import runs, and is *Open the
             article* once it is in. */
          onShortcut={phase.kind === "ready" ? openTheArticle : purpose.commit}
        />
      )}

      {phase.kind === "ready" && (
        <div className="tw:mt-3">
          <p className="tw:mt-0 tw:mb-2 tw:text-sm tw:text-foreground">
            {phase.completion.repeat
              ? REPEAT_PASTE_ON_THE_SHELF
              : "Ready. Any first modes that were queued use the reason saved when the import finished. Changes saved after that reach chat and anything you generate later."}
          </p>
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <Button type="button" size="sm" disabled={phase.opening} onClick={openTheArticle}>
              {phase.opening ? "Saving…" : "Open the article"}
            </Button>
            {/* Only when the words cannot be saved from here: a refusal, or
                the read of the stored purpose gave up. */}
            {cannotSave(purposeNow) && (
              <Button type="button" variant="ghost" size="sm" onClick={openWithoutSaving}>
                Open without saving
              </Button>
            )}
          </div>
        </div>
      )}

      {phase.kind === "repeat" && (
        <div data-add-repeat className="tw:mt-3">
          <p className="tw:mt-0 tw:mb-2 tw:text-sm tw:text-foreground">{REPEAT_PASTE_ON_THE_SHELF}</p>
          <Button type="button" size="sm" onClick={openTheRepeat}>
            Open the article
          </Button>
        </div>
      )}

      {job?.status === "done" && phase.kind === "opened" && <Done job={job} />}

      <p className="tw:mt-6 tw:mb-0 tw:text-sm">
        <Link href={LIBRARY_HREF} className="tw:text-muted-foreground tw:hover:text-highlight-text">
          ← Back to the shelf
        </Link>
      </p>
    </main>
  );
}

/**
 * Whether the words in the box cannot be saved from here: the save was
 * refused, or the read of the stored purpose gave up. What offers *Open
 * without saving*, and what lets go of a pressed *Open the article*.
 */
function cannotSave(now: AddPurposeSnapshot): boolean {
  return now.state.kind === "error" || now.gaveUp;
}

/**
 * **"Why are you reading this?"**: a plain textarea in `ProfileBox`'s clothes,
 * saving as it is typed (plan 261004l).
 *
 * Not `ProfileBox` itself: that brings dictation, which the add page has never
 * loaded, and a microphone running while the page opens the article by itself
 * is a new way to lose words (the plan's § The simpler option passed over).
 * It uses the leave warning and status line exported from there. The session
 * in add-purpose.ts owns the save timer so it also runs during suspended renders.
 *
 * Capped rather than counted past: the server refuses more than
 * `MAX_PURPOSE_CHARS`, and the box is a better place to learn that than a
 * refusal.
 *
 * **It says whether the words have been saved.** Greg, 2026-10-01,
 * spya-hbqezu: *"it doesn't have a UI indication of when/whether it has saved
 * it or not."* `PurposeLine` below.
 */
function PurposeBox({
  now,
  stopped,
  onChange,
  onFocusChange,
  onShortcut,
}: {
  now: AddPurposeSnapshot;
  /** The job failed or was stopped, so nothing is on its way to making the article. */
  stopped: boolean;
  onChange: (value: string) => void;
  onFocusChange: (focused: boolean) => void;
  onShortcut: () => void;
}) {
  return (
    <div className="prof-box tw:mt-4">
      <div className="prof-box-head">
        <label className="prof-box-label" htmlFor="add-purpose">
          Why are you reading this?
        </label>
      </div>
      <textarea
        id="add-purpose"
        className="prof-box-input"
        rows={2}
        maxLength={MAX_PURPOSE_CHARS}
        placeholder="e.g. I want to know how they handled missing data"
        value={now.text}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        onKeyDown={(e) => {
          /* Plain Enter is a newline: this is prose. */
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onShortcut();
          }
        }}
      />
      <div className="prof-box-foot">
        {/* Each sentence has to be true with automatic modes off, on a re-add,
            and when the import failed after its row was made (Sol's F8). */}
        <p className="prof-box-hint">
          Optional. Saves by itself after a short pause, once the article exists. If first modes
          are generated automatically, they use the reason saved when the import finishes. For
          this article only. Never what the article says. You can change it later on the article's
          Metadata page.
        </p>
        <span className="prof-count">
          {now.text.length} / {MAX_PURPOSE_CHARS}
        </span>
      </div>
      <PurposeLine now={now} stopped={stopped} />
    </div>
  );
}

/**
 * Where the words stand before the article's stored purpose has been read.
 * After that the line is `ProfileBox`'s own.
 */
type Unseeded = "none" | "waiting" | "stopped" | "gave-up";

/**
 * A blank box says nothing: the hint already says *Optional*, and a blank box
 * takes whatever is stored when it is read.
 */
function unseededOf(now: AddPurposeSnapshot, stopped: boolean): Unseeded {
  if (now.text.trim() === "") return "none";
  if (now.gaveUp) return "gave-up";
  return stopped ? "stopped" : "waiting";
}

function unseededWords(kind: Unseeded): string | null {
  switch (kind) {
    case "none":
      return null;
    case "waiting":
      /* Nothing. This said *Not saved yet. It saves once the article exists, if
         you stay on this page.* until 2026-10-05, when Greg asked for "no scary
         'unsaved' indicator": it flashed on nearly every import, over words
         that were about to be saved. The hint above already says *once the
         article exists*, and leaving with them is still questioned
         (`useUnsavedWarning`). The two below are failures, and stay. */
      return null;
    case "stopped":
      /* Not "there is no article": an unread purpose does not prove that (F13). */
      return "Not saved. The import stopped before this article's saved reason could be read.";
    case "gave-up":
      return "Not saved. Could not read this article's saved reason.";
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/**
 * The status line: the add page's own sentences until the session is seeded,
 * then `SaveStatus`, the line every other purpose box has. `aria-live` either
 * way, so what is announced is the change.
 */
function PurposeLine({ now, stopped }: { now: AddPurposeSnapshot; stopped: boolean }) {
  if (now.seeded) return <SaveStatus save={now.state} />;
  const kind = unseededOf(now, stopped);
  return (
    <p className={`prof-save is-${kind}`} aria-live="polite">
      {unseededWords(kind)}
    </p>
  );
}

/**
 * Whether this tab is still moving bytes, or about to be.
 *
 * The three phases in which nothing has left the machine for a model provider —
 * hashing, asking for the grant, and the PUT to our own object store.
 * `Sending` renders on exactly these.
 */
function stillSending(transfer: Transfer | null): boolean {
  const kind = transfer?.phase.kind;
  return kind === "hashing" || kind === "granting" || kind === "sending";
}

/**
 * **Has the article's text actually gone to a model provider yet?**
 *
 * The predicate behind the disclosure sentence's tense, and it is asked the
 * right way round: *has an ingest been queued*, not *has the transfer stopped*.
 *
 * The first version asked `!stillSending(...)`, and that was false in four
 * ordinary states at once, every one of them a wrong statement about somebody's
 * manuscript. Press Stop halfway through the PUT and the page changed to *"the
 * article's text has been sent to a third-party model provider"* about a file
 * that never left the browser. So did a queue-time 402 or 503. So did a second
 * tab watching another tab's transfer — which said the text had been sent and
 * that the file was still arriving, in consecutive sentences. GPT Sol, finding
 * 3, and it is the finding I most wanted broken.
 *
 * So: past tense only once something **queued** it. For a URL that is the whole
 * page — the effect posts before the first paint, and there is no state in which
 * it has not. For an upload it is an engine outcome of `queued` or `article`, or
 * this page's own POST having come back with a job id.
 *
 * **`started`, not `job`.** `started` is set the instant `addUpload` resolves;
 * `job` waits for the next poll to bring that job back, up to a second later. A
 * second of present tense over a request that has already gone is the safe
 * direction to be wrong in, and it is still wrong. What it must not do is read
 * true when the POST was *refused* — a page that says the text has gone about a
 * file the server would not take is the same lie in the other direction, and
 * `addUpload` answers null there.
 */
function textHasGone(transfer: Transfer | null, isUpload: boolean, posted: boolean): boolean {
  if (!isUpload) return true;
  const kind = transfer?.phase.kind;
  return kind === "queued" || kind === "article" || posted;
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
          className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-highlight-text tw:underline"
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
      <Link href={readHref(job.slug)} className="tw:text-highlight-text">
        read it
      </Link>
      .
    </p>
  );
}
