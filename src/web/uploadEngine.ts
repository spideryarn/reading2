/**
 * **The thing that actually gets a PDF from the reader's disk into an article.**
 *
 * Hash it, ask for a grant, PUT the bytes, queue the ingest. All four, for the
 * whole tab, independent of which page is on screen.
 *
 * Until 2026-09-03 the middle two lived inside `UploadPicker`, which aborted the
 * transfer when it unmounted — so pressing Add on a URL, or clicking through to
 * anything else, silently threw away a 40 MB upload that was nearly done. And
 * the reader could not leave anyway, because the navigation to
 * `/add/upload/<id>` only happened once the last byte had gone:
 *
 * > sometimes it takes a while to upload over a slow connection. I have to wait
 * > before I can then click the Add button … I'd like to be able to upload and
 * > then click Add immediately, which would then wait for the upload to finish
 * > and run the ingestion queue immediately, so I could go off and do something
 * > else in the meantime.
 * >
 * > — Greg, 2026-09-03
 *
 * docs/plans/260903j-background-pdf-upload-so-add-does-not-wait.md.
 *
 * ## A module singleton, not a React provider
 *
 * The same argument [`jobEngine.ts`](jobEngine.ts) makes for itself, one step
 * earlier in the chain, and here it is not an argument about tidiness: if the
 * page owned the wait, then *going off and doing something else* would unmount
 * the only thing that was ever going to `POST /api/jobs`. The ingest would
 * never start, which is the whole request. A background worker holding a
 * transfer is not view state.
 *
 * `createUploadEngine(deps)` takes its dependencies so the tests can drive it
 * with no React and no network at all — the thing that makes
 * `tests/upload-engine.test.ts` mean something.
 *
 * ## What it is bound to
 *
 * A **reader**, through `start(readerId)` / `stop()` in `useJobSession`
 * (useJobs.ts), exactly as the job engine is. Without that, signing out
 * mid-transfer leaves one reader's filename and bytes in a singleton that then
 * posts `/api/jobs` as whoever signs in next — GPT Sol, reviewing the plan.
 * Every network reply is fenced, so a PUT that lands after a sign-out — or after
 * a cancel, or after the reader chose a different file — cannot write into
 * whatever the engine is doing now. See `fence`.
 *
 * ## What it never does
 *
 * **Navigate.** The address is minted before the bytes move and the caller goes
 * there immediately, so by the time this finishes there is nothing to navigate
 * to. That is also why deleting `UploadPicker`'s abort-on-unmount is safe: the
 * cleanup existed so a completed transfer could not pull somebody who had left
 * onto a page they had walked away from, and no completion here goes anywhere.
 *
 * **Wake the job engine with `start()`.** That takes a session key and rebinding
 * it under anything else tears down the poller. `epoch()` plus
 * `actionSucceeded`/`actionFailed` is the seam for an action's outcome; it pokes
 * the poll, lifts an authentication pause on success and starts one on a 401,
 * all session-fenced.
 */
import type { Job } from "../types.js";
import { jobEngine } from "./jobEngine.js";
import { apiFetch, readJson, statusOf } from "./lib/api.js";
import {
  type Grant,
  type UploadProgress,
  type UploadRefused,
  putFile,
  requestGrant,
} from "./upload.js";

/**
 * What `POST /api/jobs { uploadId }` answers when there is no job to give —
 * the file became this article a while ago and retention took its job record.
 * Mirrors `AlreadyAnArticle` in useJobs.ts.
 */
interface AlreadyAnArticle {
  article: string;
}

/**
 * Where a transfer has got to.
 *
 * **A discriminated union rather than a bag of optionals**, because the phases
 * differ in what they are allowed to carry and, more importantly, in what
 * *retrying* means — see `retry`. A `failed` with no phase would leave the
 * retry guessing, which is the bug review finding 4 was about.
 */
export type TransferPhase =
  /** Reading the file to hash it. Tens of milliseconds per megabyte, and nothing
      is on the wire yet — but the reader has pressed Add, so it is not idle. */
  | { kind: "hashing" }
  /** `POST /api/uploads` is out. The address does not exist yet. */
  | { kind: "granting" }
  /** The PUT is going. `sent` is bytes, not a percentage — see `UploadPicker`. */
  | { kind: "sending"; sent: number }
  /** `POST /api/jobs` is out. The bytes are safe whatever happens now. */
  | { kind: "queueing" }
  /** Done: there is an ingest, and `jobEngine` is driving it. */
  | { kind: "queued"; job: Job }
  /** Done: this file was already that article, and its job has been trimmed. */
  | { kind: "article"; slug: string }
  /** The reader pressed Stop. Nothing was queued and nothing will be. */
  | { kind: "cancelled" }
  /**
   * It stopped. `at` is the phase it stopped in, which is what `retry` needs.
   *
   * `reason` is a whole sentence for the reader — from `uploadFailure` for a
   * Storage refusal, or from the server for a queue refusal, which is how a
   * quota 402 arrives with its `[bill-…]` code intact so `QuotaNotice` can put
   * the link to `/profile` beside it.
   */
  | {
      kind: "failed";
      at: "hashing" | "granting" | "sending" | "queueing";
      reason: string;
      /**
       * The HTTP status, when the failure had one.
       *
       * Carried for one caller: `resume` retries a **401** queue phase and
       * nothing else, because a refused token is the one failure a fresh token
       * fixes by itself. Reading it back out of the sentence would mean matching
       * on prose, which is what `codeOfMessage` exists to stop.
       */
      status: number | null;
    };

/** One transfer, as anything watching it sees it. */
export interface Transfer {
  uploadId: string | null;
  filename: string;
  /** The file's own size. The honest total for a progress bar. */
  bytes: number;
  phase: TransferPhase;
}

/** Nothing is going on. A stable object, so `useSyncExternalStore` sees no change. */
const IDLE: { transfer: Transfer | null } = { transfer: null };

export type UploadSnapshot = typeof IDLE;

export interface UploadEngineDeps {
  requestGrant(file: File, signal?: AbortSignal): Promise<Grant>;
  putFile(
    grant: Grant,
    file: File,
    options: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal },
  ): Promise<void>;
  /** `POST /api/jobs { uploadId }`. Separated so a test needs no network. */
  queue(uploadId: string): Promise<Job | AlreadyAnArticle>;
  /**
   * `DELETE /api/uploads/:id` — tell the server the reader pressed Stop.
   *
   * Fire-and-forget as far as the screen is concerned: the transfer reads as
   * cancelled the instant the button is pressed, whatever the network then does.
   * What this buys is durable: a **reload** of the address is answered rather
   * than polled at for the two hours of the grant, and *"nothing was added"*
   * becomes the server's position rather than an assertion this tab makes about
   * itself. See `cancelUpload` in src/upload-records.ts.
   */
  cancelUpload(uploadId: string): Promise<void>;
  /** The job engine's action seam, so a test can assert it was used correctly. */
  jobs: {
    epoch(): number;
    actionSucceeded(epoch: number): void;
    actionFailed(message: string, status: number | null, epoch: number): void;
  };
  /** Registered while unrecoverable work is in flight. Returns the way to undo it. */
  guardUnload(): () => void;
}

export interface UploadEngine {
  /** Bind to a reader. Idempotent for the same key; a different one tears down first. */
  start(readerId: string): void;
  /** Fence everything in flight, abort the transfer, and forget it. */
  stop(): void;
  subscribe(onChange: () => void): () => void;
  getSnapshot(): UploadSnapshot;
  /**
   * Take this file and see it through.
   *
   * Resolves with the **upload id** as soon as the grant is in hand — which is
   * the point of the whole exercise: the caller navigates to
   * `/add/upload/<id>` with zero bytes sent and the transfer carries on here.
   *
   * `null` means it never got that far, and the reason is on the snapshot,
   * where the shelf is already rendering it.
   */
  send(file: File): Promise<string | null>;
  /** Stop the transfer. Nothing is queued, now or later. */
  cancel(): void;
  /** Another go at whichever phase failed. See the comment on the method. */
  retry(): void;
  /** Drop a finished, cancelled or failed transfer from the snapshot. */
  forget(): void;
  /** Retry a queue request that was refused 401, now that there is a new token. */
  resume(): void;
  /** Back to the state a fresh engine is in. For tests of the singleton. */
  reset(): void;
}

/** Storage's answer when the object is already at the key we asked for. */
const DUPLICATE = 409;

/**
 * The sentence for a second file while one is still going.
 *
 * Here rather than in src/messages.ts because it is not a failure — nothing
 * refused anything and nothing went wrong — and everything in that module is a
 * `ReaderFacingFailure` with a bracketed code for somebody to quote. This is the
 * add box declining a gesture, which is the same category as *"One at a time,
 * please"* in UploadPicker.tsx, and it lives beside its own rule for the same
 * reason.
 */
export const ONE_UPLOAD_AT_A_TIME =
  "That upload is still going. Wait for it, or stop it first.";

export function createUploadEngine(deps: UploadEngineDeps): UploadEngine {
  let snapshot: UploadSnapshot = IDLE;
  const subscribers = new Set<() => void>();

  /**
   * **Which attempt is the current one.** Every reply checks it before writing.
   *
   * Bumped by *four* things, and the first draft only had the first: `stop`,
   * `send`, `cancel` and `retry`. It was a session generation, so a Stop pressed
   * while the grant request was still out left the fence unchanged — the grant
   * arrived a second later, found nothing to stop it, and started a 40 MB PUT
   * for a transfer the reader had already cancelled. Nothing rendered it and
   * nothing could stop it again. Found by
   * `tests/upload-engine.test.ts` § *cancels during hashing or granting*.
   *
   * One counter rather than a session generation plus an attempt number,
   * because everything that invalidates work in flight invalidates all of it:
   * there is only ever one transfer, and any of these four means *whatever is
   * still out there is no longer the thing we are doing*.
   */
  let fence = 0;
  let readerId: string | null = null;

  /* The `File` and the grant, held for the life of the transfer so `retry` has
     something to retry *with*. Deliberately not on the snapshot: nothing renders
     them, and a `File` on a value that is compared by identity is a large object
     kept alive by a stale render. */
  let file: File | null = null;
  let grant: Grant | null = null;
  let abort: AbortController | null = null;
  let releaseGuard: (() => void) | null = null;

  const notify = (): void => {
    for (const s of subscribers) s();
  };

  const set = (transfer: Transfer | null): void => {
    snapshot = transfer === null ? IDLE : { transfer };
    notify();
  };

  /** The current transfer with one field changed. Null if there isn't one. */
  const phase = (next: TransferPhase): void => {
    const now = snapshot.transfer;
    if (!now) return;
    set({ ...now, phase: next });
  };

  /**
   * Whether this reply still belongs to the engine that made the request.
   *
   * A sign-out, a cancel, a new file or a retry all bump the fence, so a PUT
   * that lands afterwards — and they can land minutes afterwards — finds itself
   * stale and writes nothing.
   */
  const mine = (token: number): boolean => token === fence && snapshot.transfer !== null;

  /**
   * **Hold the tab open while work would be lost by closing it.**
   *
   * Every phase up to and including `queueing` qualifies, and the review was
   * right that the plan's first boundary (`sending` only) was too narrow:
   * hashing a 50 MB file and waiting on the grant are both several seconds in
   * which the reader has committed and nothing is recoverable. It comes off on
   * every terminal state, so a finished or cancelled transfer never nags.
   *
   * Best-effort by nature — a browser may decline to show the dialog at all, and
   * an in-app navigation does not trigger it, which is exactly right here: going
   * to another page is the thing this whole feature is for.
   */
  const guard = (on: boolean): void => {
    if (on && !releaseGuard) releaseGuard = deps.guardUnload();
    if (!on && releaseGuard) {
      releaseGuard();
      releaseGuard = null;
    }
  };

  /** Everything a terminal state does, whatever kind of terminal it is. */
  const settle = (next: TransferPhase): void => {
    guard(false);
    abort = null;
    phase(next);
  };

  /**
   * `POST /api/jobs { uploadId }`, and what to do with each of its three answers.
   *
   * Reported through `jobEngine`'s action seam rather than merely awaited: that
   * is what pokes the poller so the new job appears without waiting for the idle
   * tick, and what lifts an authentication pause when a queue POST succeeds
   * after a token refresh.
   */
  const queueIt = async (uploadId: string, token: number): Promise<void> => {
    if (!mine(token)) return;
    phase({ kind: "queueing" });
    const jobsEpoch = deps.jobs.epoch();
    try {
      const outcome = await deps.queue(uploadId);
      if (!mine(token)) return;
      deps.jobs.actionSucceeded(jobsEpoch);
      settle(
        "article" in outcome ? { kind: "article", slug: outcome.article } : { kind: "queued", job: outcome },
      );
    } catch (err) {
      if (!mine(token)) return;
      const reason = (err as Error).message;
      const status = statusOf(err);
      deps.jobs.actionFailed(reason, status, jobsEpoch);
      /* **`queueing`, so `retry` re-POSTs and does not re-PUT.** The bytes are in
         Storage; a re-PUT would come back `409 Duplicate` and strand the retry
         short of the thing that actually failed. Review finding 4. */
      settle({ kind: "failed", at: "queueing", reason, status });
    }
  };

  /**
   * PUT the bytes, then queue.
   *
   * **A `409` here is not a refusal.** The staging key is ours and only this
   * grant can write it, so *the object is already there* can only mean the
   * bytes landed and the browser was told otherwise — a lost response on a
   * flaky connection, or a retry of a PUT that quietly succeeded. Treating it
   * as a failure would leave a perfectly good upload permanently unqueueable,
   * showing `[st-dup]` and telling the reader to choose the file again.
   * Measured on 2026-09-03: a *partial* PUT leaves no object at all, so this
   * cannot be a half-written file — see the plan's table.
   */
  const sendBytes = async (
    theGrant: Grant,
    theFile: File,
    controller: AbortController,
    token: number,
  ): Promise<void> => {
    phase({ kind: "sending", sent: 0 });
    abort = controller;
    try {
      await deps.putFile(theGrant, theFile, {
        onProgress: (p) => {
          if (mine(token)) phase({ kind: "sending", sent: p.sent });
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (!mine(token)) return;
      if ((err as Error).name === "AbortError") {
        settle({ kind: "cancelled" });
        return;
      }
      if ((err as UploadRefused).status !== DUPLICATE) {
        settle({
          kind: "failed",
          at: "sending",
          reason: (err as Error).message,
          status: statusOf(err),
        });
        return;
      }
    }
    await queueIt(theGrant.uploadId, token);
  };

  const engine: UploadEngine = {
    start(key) {
      if (readerId === key) return;
      engine.stop();
      readerId = key;
    },

    stop() {
      fence += 1;
      guard(false);
      /* Aborted, not merely fenced. The reader has gone; the bytes are still
         going, and nobody is going to want them. */
      abort?.abort();
      abort = null;
      file = null;
      grant = null;
      readerId = null;
      set(null);
    },

    subscribe(onChange) {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    },

    getSnapshot: () => snapshot,

    async send(chosen) {
      const busy = snapshot.transfer?.phase.kind;
      /* **A transfer in flight owns this engine until it is done.** The same
         rule `take()` enforced in UploadPicker before the engine existed, and
         for the same reason: a second file used to overwrite the name on screen
         while the *first* one went on uploading underneath it. */
      if (busy === "hashing" || busy === "granting" || busy === "sending" || busy === "queueing") {
        set({
          ...(snapshot.transfer as Transfer),
        });
        throw new Error(ONE_UPLOAD_AT_A_TIME);
      }

      fence += 1;
      const token = fence;
      file = chosen;
      grant = null;
      /* **The controller is created here, not in `sendBytes`.** It used to be,
         and that left `cancel()` with nothing to abort during hashing and
         granting — so a Stop pressed while a 50 MB file was being hashed let the
         grant request go out anyway and mint an upload row for a transfer the
         reader had already stopped. The fence stopped the *PUT*; it could not
         stop an external mutation that was already on its way. GPT Sol, finding
         6. Owning it from the first line means one signal covers every phase. */
      const controller = new AbortController();
      abort = controller;
      set({
        uploadId: null,
        filename: chosen.name,
        bytes: chosen.size,
        phase: { kind: "hashing" },
      });
      guard(true);

      let minted: Grant;
      try {
        phase({ kind: "granting" });
        minted = await deps.requestGrant(chosen, controller.signal);
      } catch (err) {
        if (mine(token)) {
          settle({
            kind: "failed",
            at: "granting",
            reason: (err as Error).message,
            status: statusOf(err),
          });
        }
        return null;
      }
      /* **A cancel during the grant request lands here.** The fence has moved,
         so this returns before starting a PUT for a transfer the reader has
         already stopped — and before overwriting the `cancelled` phase they can
         see. */
      if (!mine(token)) return null;
      grant = minted;
      set({ ...(snapshot.transfer as Transfer), uploadId: minted.uploadId });

      /* **Not awaited.** This is the whole point: the caller gets the id and
         navigates, and the bytes go on moving wherever they go next. Nothing
         downstream rejects — `sendBytes` puts every outcome on the snapshot — so
         there is no unhandled rejection to catch. */
      void sendBytes(minted, chosen, controller, token);
      return minted.uploadId;
    },

    /**
     * Stop, and mean it.
     *
     * **Not during `queueing`**, and that refusal is the point rather than a
     * missing feature. By then the bytes are in Storage and `POST /api/jobs` is
     * in flight: there is nothing to abort that would undo anything, and the
     * server may already have made the job. Marking the transfer `cancelled`
     * then produced the worst state of all — a client saying *nothing was
     * added* while the ordinary job poll found the ingest and drove it to
     * completion. GPT Sol, finding 2. The window is one small request wide, so
     * the honest answer is that Stop is no longer offered.
     *
     * **The server is told.** `DELETE /api/uploads/:id` moves the record
     * `pending → expired`, which is what makes *nothing was added* a claim we
     * are entitled to make: without it, a Stop pressed after the object had
     * quietly landed left a record a second tab could still queue, and a reload
     * of the address polled at a `pending` row for the two hours of the grant.
     * If a queue request beat us to the claim, the server says so by leaving it
     * claimed and the reader sees the running job — the ingest wins, correctly.
     */
    cancel() {
      const now = snapshot.transfer;
      if (!now || now.phase.kind === "queueing") return;
      fence += 1;
      abort?.abort();
      const id = now.uploadId;
      /* Fire and forget: the screen must not wait on the network to say the
         thing the reader just did. A failed DELETE leaves exactly the state we
         had before it existed, which is survivable — the object never arrives,
         so nothing can be made from the record anyway. */
      if (id) void deps.cancelUpload(id).catch(() => {});
      /* **Set here as well as in `sendBytes`'s catch**, because there may be no
         PUT to abort yet: cancelling during `hashing` or `granting` fires the
         controller but has no rejection to catch, and a Stop that did nothing
         visible is the worst button on the page. */
      settle({ kind: "cancelled" });
    },

    /**
     * **A fresh token, and a queue request that was refused for want of one.**
     *
     * The mirror of `jobEngine.resume`, and it exists because the two engines
     * fail differently: a job whose `/advance` 401s is retried by the poller for
     * ever, where a queue POST happens exactly once and then sits `failed`. So a
     * reader whose session lapsed during a long upload had their file safely in
     * Storage, an ingest nobody would ever queue, and no way back to it except
     * returning to the page and pressing Try again. GPT Sol, finding 5.
     *
     * **Only a 401, and only the queue phase.** Every other failure is either
     * something a new token does not fix (a quota 402, a Storage refusal) or
     * something that would re-send the bytes, and neither should happen because
     * a token happened to refresh while the reader was reading something else.
     */
    resume() {
      const now = snapshot.transfer;
      if (now?.phase.kind !== "failed") return;
      if (now.phase.at !== "queueing" || now.phase.status !== 401) return;
      if (!grant) return;
      fence += 1;
      guard(true);
      void queueIt(grant.uploadId, fence);
    },

    /**
     * Another go at **the phase that failed**, and only that one.
     *
     * - `queueing` — the bytes are in Storage. Re-POST `/api/jobs`. This is the
     *   path a reader takes after a quota refusal they have since fixed by
     *   upgrading, and re-PUTting first would turn it into `409 Duplicate`.
     * - `sending` — re-PUT with the same grant, which works: a grant is a JWT
     *   with a two-hour expiry, not a one-shot token, and an aborted PUT leaves
     *   no object (measured 2026-09-03, the table is in the plan). If the object
     *   *did* land, `sendBytes` reads the duplicate as success and goes on to
     *   queue.
     * - `hashing` / `granting` — there is no address, so this transfer has
     *   nothing to resume. The shelf still holds the file; choosing it again is
     *   the recovery, and it is one gesture.
     */
    retry() {
      const now = snapshot.transfer;
      if (now?.phase.kind !== "failed") return;
      if (!file || !grant) return;
      fence += 1;
      const token = fence;
      guard(true);
      if (now.phase.at === "queueing") {
        void queueIt(grant.uploadId, token);
        return;
      }
      if (now.phase.at === "sending") {
        /* A fresh controller: the previous one is spent, and a retry the reader
           cannot then Stop is the button this engine already refuses to ship. */
        const controller = new AbortController();
        abort = controller;
        void sendBytes(grant, file, controller, token);
      }
    },

    forget() {
      const kind = snapshot.transfer?.phase.kind;
      /* Only a transfer that has stopped. Forgetting a live one would hide a
         PUT that is still running and still going to queue something. */
      if (kind === "hashing" || kind === "granting" || kind === "sending" || kind === "queueing") {
        return;
      }
      file = null;
      grant = null;
      set(null);
    },

    reset() {
      fence += 1;
      guard(false);
      abort = null;
      file = null;
      grant = null;
      readerId = null;
      snapshot = IDLE;
      subscribers.clear();
    },
  };

  return engine;
}

/** The live one. */
export const uploadEngine: UploadEngine = createUploadEngine({
  requestGrant,
  putFile,
  queue: async (uploadId) =>
    readJson<Job | AlreadyAnArticle>(
      await apiFetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      }),
    ),
  cancelUpload: async (uploadId) => {
    await apiFetch(`/api/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
  },
  jobs: {
    epoch: () => jobEngine.epoch(),
    actionSucceeded: (epoch) => jobEngine.actionSucceeded(epoch),
    actionFailed: (message, status, epoch) => jobEngine.actionFailed(message, status, epoch),
  },
  guardUnload() {
    const warn = (e: BeforeUnloadEvent): void => {
      /* `preventDefault` is the modern spelling and `returnValue` the one older
         browsers still read. Both, because the cost of the dead one is a line
         and the cost of missing the live one is a lost upload. The string is
         never shown — browsers replaced it with their own wording years ago. */
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  },
});
