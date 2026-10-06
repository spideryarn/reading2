/**
 * **Many files at once, each added with only its title, authors and abstract
 * read** — the browser half of a bulk import. Plan
 * docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md § The batch,
 * in the browser; the story is in docs/project/ingest-queue.md § Many at once.
 *
 * > if you upload multiple PDFs at the same time, ideally it would be possible
 * > to do that. … by default, maybe it wouldn't run AI processing when you do
 * > that, only when you open each of them for the first time.
 * >
 * > — Greg, 2026-10-01 (report `spya-eym66s`)
 *
 * For each file: hash it once, ask for a minimal grant, PUT the bytes, queue
 * the minimal job, and **hold the slot until that job has ended**, however it
 * ends. Three files at most are in that state at once — backpressure, not a
 * defence (the allowance is the defence).
 *
 * ## A module singleton, like `uploadEngine`
 *
 * For `uploadEngine`'s reason: the reader goes off and does something else,
 * which unmounts the shelf, and whatever is holding the queue must not unmount
 * with it. It is bound to a reader through `start` / `stop` in `useJobSession`
 * (useJobs.ts), and every reply is fenced by the session and by the row's own
 * attempt, so a sign-out mid-batch cannot post the next file as whoever signs
 * in next. `createBatchUpload(deps)` is what the tests drive, with no network.
 *
 * ## Memory
 *
 * One hashing worker. A file's `arrayBuffer()` is read only when the file
 * reaches the front of the hashing line, the digest is kept, and the buffer
 * goes — so a drop of a thousand PDFs is never in memory together. The PUT
 * sends the `File` itself, which the browser streams. GPT Sol, plan review P2-7.
 *
 * ## What Stop means
 *
 * The single upload's Stop, applied to every file that has not yet been
 * queued: one waiting stops, one being hashed or sent is aborted and its grant
 * given back (`DELETE /api/uploads/:id`). **A file whose job is already
 * running is left to finish**, for the reason `uploadEngine.cancel` refuses
 * during `queueing`: by then the reservation is made and the work is seconds
 * long, and saying *stopped* about a paper that then lands on the shelf is the
 * worst state available.
 */
import { uploadProblem } from "../uploads.js";
import type { Job } from "../types.js";
import { jobEngine, type TerminalOutcome } from "./jobEngine.js";
import { apiFetch, detailsOf, readJson, statusOf } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { warnBeforeUnload } from "./unload-guard.js";
import { type Grant, type UploadProgress, putFile, requestGrant, sha256Hex } from "./upload.js";

/** How many files are in flight at once. In flight lasts until the job has ended. */
export const BATCH_CONCURRENCY = 3;

/** The most files one drop takes. The panel's sake; the allowance is the defence. */
export const BATCH_MAX_FILES = 1000;

/** What a retry of a failed row starts again from. */
export type RetryFrom =
  /** Nothing reached the server that can be reused: hash, grant and send again. */
  | { from: "start" }
  /** The bytes are in Storage; only `POST /api/jobs` failed. */
  | { from: "queue"; uploadId: string }
  /** The job ran and failed: `POST /api/jobs/:id/retry`. */
  | { from: "job"; jobId: string };

/**
 * Where one file has got to. A union, for `TransferPhase`'s reason in
 * uploadEngine.ts: the states differ in what they carry and in what a retry
 * means.
 */
export type BatchState =
  /** Not started: waiting for one of the three slots. */
  | { kind: "waiting" }
  /** Its bytes are being read to take the digest. */
  | { kind: "hashing" }
  /** The grant is asked for, or the PUT is going. */
  | { kind: "sending"; sent: number }
  /** Queued, and its job is running — `jobId` is null while the POST is out. */
  | { kind: "reading"; jobId: string | null }
  /** On the shelf. */
  | { kind: "shelved"; slug: string }
  /** Already on the shelf (or archived, or on its way from another upload). The server's sentence. */
  | { kind: "duplicate"; slug: string | null; message: string }
  /** The same bytes as a file earlier in this drop. */
  | { kind: "same-file"; as: string }
  /** Not a file an upload takes — the same check a single upload makes. */
  | { kind: "refused"; message: string }
  /** Not started, or not queued, because the allowance has no room. The server's `[pay-…]` sentence. */
  | { kind: "no-room"; message: string }
  /** It failed, with the sentence, and where Retry starts from. */
  | { kind: "failed"; message: string; retry: RetryFrom }
  /** A final 401: keep the file and wait for a fresh session token. */
  | { kind: "auth-paused"; message: string; retry: RetryFrom }
  /** Its job left the list before this tab saw how it ended. */
  | { kind: "lost" }
  /** Stop was pressed before it was queued, or its job was cancelled. */
  | { kind: "stopped" };

export interface BatchRow {
  readonly id: number;
  readonly filename: string;
  readonly bytes: number;
  readonly state: BatchState;
}

export interface BatchSnapshot {
  readonly rows: readonly BatchRow[];
  /** Files beyond `BATCH_MAX_FILES` in the last drop, which were not taken. */
  readonly overflow: number;
}

const EMPTY: BatchSnapshot = { rows: [], overflow: 0 };

/** What `POST /api/jobs { uploadId }` answers when the file is already that article. */
interface AlreadyAnArticle {
  article: string;
}

export interface BatchUploadDeps {
  /** SHA-256 of the file as hex. Called by one worker, one file at a time. */
  hash(file: File): Promise<string>;
  requestGrant(
    file: File,
    signal: AbortSignal,
    claim: { sha256: string; level: "minimal" },
  ): Promise<Grant>;
  putFile(
    grant: Grant,
    file: File,
    options: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal },
  ): Promise<void>;
  /** `POST /api/jobs { uploadId, level: "minimal" }`. */
  queue(uploadId: string): Promise<Job | AlreadyAnArticle>;
  /** `POST /api/jobs/:id/retry` — the replacement job. */
  retryJob(jobId: string): Promise<Job>;
  /** `DELETE /api/uploads/:id`, for the reader whose operation minted it. */
  cancelUpload(uploadId: string, madeFor: string | null): Promise<void>;
  /** The job engine's action seam and its terminal seam. */
  jobs: {
    epoch(): number;
    /** A final 401 from polling, advancing, or an action pauses all producers. */
    authFailed(): boolean;
    actionSucceeded(epoch: number): void;
    actionFailed(message: string, status: number | null, epoch: number): void;
    watchTerminal(jobId: string, onEnd: (outcome: TerminalOutcome) => void): () => void;
  };
  /** Registered while files are in flight. Returns the way to undo it. */
  guardUnload(): () => void;
}

export interface BatchUpload {
  /** Bind to a reader. Idempotent for the same key; a different one tears down first. */
  start(readerId: string): void;
  /** The reader it is bound to right now, or `null`. For the live requests below. */
  reader(): string | null;
  /** Sign-out: fence everything, abort every transfer, and forget the batch. */
  stop(): void;
  subscribe(onChange: () => void): () => void;
  getSnapshot(): BatchSnapshot;
  /** Take these files. Beyond `BATCH_MAX_FILES` they are counted, not taken. */
  add(files: readonly File[]): void;
  /** The Stop button — see the header. */
  cancel(): void;
  /** Another go at a failed row, from where it failed. */
  retry(rowId: number): void;
  /** Fresh credentials arrived: continue anything a final 401 paused. */
  resume(): void;
  /** Clear a batch that has nothing left in flight. */
  dismiss(): void;
  /** Back to a fresh engine. For tests of the singleton. */
  reset(): void;
}

/** Whether a row still holds a slot or is waiting for one. */
export function rowIsLive(state: BatchState): boolean {
  return (
    state.kind === "waiting" ||
    state.kind === "hashing" ||
    state.kind === "sending" ||
    state.kind === "reading" ||
    state.kind === "auth-paused"
  );
}

/** What the engine keeps about a row that nothing renders. */
interface Inner {
  file: File;
  /** Files deduplicate only against others from this same picker/drop gesture. */
  drop: number;
  sha: string | null;
  uploadId: string | null;
  controller: AbortController | null;
  /** Bumped by Stop and by Retry; a reply from an older attempt writes nothing. */
  attempt: number;
  unwatch: (() => void) | null;
}

export function createBatchUpload(deps: BatchUploadDeps): BatchUpload {
  let snapshot: BatchSnapshot = EMPTY;
  const subscribers = new Set<() => void>();
  let readerId: string | null = null;
  /** The session fence. Bumped by `stop` and `reset`. */
  let fence = 0;
  let nextId = 1;
  let nextDrop = 1;
  const inner = new Map<number, Inner>();
  /** Rows holding one of the slots, from hashing until their job has ended. */
  const active = new Set<number>();
  /** Which row first had these bytes, within each picker/drop gesture. */
  const seen = new Map<number, Map<string, number>>();
  /** A retry waiting for one of the three slots. */
  const pending = new Map<number, RetryFrom>();
  /** The allowance said no: start nothing more from this drop. */
  let outOfRoom: string | null = null;
  /** A final 401 starts nothing more until `resume`. */
  let authPaused = false;
  let hashTail: Promise<unknown> = Promise.resolve();
  let releaseGuard: (() => void) | null = null;

  const notify = (): void => {
    for (const s of subscribers) s();
  };

  const setRow = (id: number, state: BatchState): void => {
    snapshot = {
      ...snapshot,
      rows: snapshot.rows.map((r) => (r.id === id ? { ...r, state } : r)),
    };
    notify();
  };

  const stateOf = (id: number): BatchState | undefined =>
    snapshot.rows.find((r) => r.id === id)?.state;

  const guard = (): void => {
    const on = snapshot.rows.some((row) => rowIsLive(row.state));
    if (on && !releaseGuard) releaseGuard = deps.guardUnload();
    if (!on && releaseGuard) {
      releaseGuard();
      releaseGuard = null;
    }
  };

  /** One worker: each file's bytes are read only when it is this file's turn. */
  const hashInTurn = (file: File): Promise<string> => {
    const turn = hashTail.then(() => deps.hash(file));
    hashTail = turn.catch(() => undefined);
    return turn;
  };

  /**
   * Mark everything not past its grant as out of room.
   *
   * A row waiting on the grant already says `sending`, so looking only for
   * `waiting` would let that reply land after the 402 and begin a PUT. Once the
   * server has answered the grant, `uploadId` is set and the file is allowed to
   * finish; before then it is fenced and its request is aborted.
   */
  const noRoomForTheRest = (message: string, exceptId: number): void => {
    outOfRoom = message;
    snapshot = {
      ...snapshot,
      rows: snapshot.rows.map((r) => {
        if (r.id === exceptId) return r;
        const it = inner.get(r.id);
        const beforeGrant =
          r.state.kind === "waiting" ||
          r.state.kind === "hashing" ||
          (r.state.kind === "sending" && it?.uploadId === null);
        if (!beforeGrant) return r;
        if (it) {
          it.attempt += 1;
          it.controller?.abort();
          it.controller = null;
        }
        active.delete(r.id);
        pending.delete(r.id);
        return { ...r, state: { kind: "no-room", message } };
      }),
    };
    notify();
  };

  /**
   * A refusal from one of our routes, sorted into the three answers that are
   * not *failed*: the allowance (402), and a duplicate (409 `code:
   * "duplicate"`, with the slug it already is when there is one).
   */
  const refused = (id: number, err: unknown, retry: RetryFrom): void => {
    const message = describeFetchFailure(err instanceof Error ? err : new Error(String(err)));
    const status = statusOf(err);
    if (status === 402) {
      setRow(id, { kind: "no-room", message });
      noRoomForTheRest(message, id);
      return;
    }
    const details = detailsOf(err);
    if (status === 409 && details.code === "duplicate") {
      const slug = typeof details.article === "string" ? details.article : null;
      setRow(id, { kind: "duplicate", slug, message });
      return;
    }
    setRow(id, { kind: "failed", message, retry });
  };

  /** Start rows while there is a slot and something waiting. */
  const pump = (): void => {
    if (readerId === null || authPaused || deps.jobs.authFailed()) {
      guard();
      return;
    }
    /* Explicit retries go first, but still take an ordinary slot. Calling
       `run` directly here used to let a Retry make four jobs live at once. */
    const ordered = [
      ...snapshot.rows.filter((row) => pending.has(row.id)),
      ...snapshot.rows.filter((row) => !pending.has(row.id)),
    ];
    for (const row of ordered) {
      if (active.size >= BATCH_CONCURRENCY) break;
      if (row.state.kind !== "waiting" || active.has(row.id)) continue;
      const from = pending.get(row.id) ?? { from: "start" as const };
      pending.delete(row.id);
      void run(row.id, from);
    }
    guard();
  };

  /** Keep this row and the rest of the queue still until credentials change. */
  const pauseForAuth = (id: number, message: string, retry: RetryFrom): void => {
    authPaused = true;
    pending.set(id, retry);
    setRow(id, { kind: "auth-paused", message, retry });
  };

  /** The second way out of a pause: another authenticated action succeeded. */
  const resumeAuthPause = (): void => {
    if (!authPaused || deps.jobs.authFailed()) return;
    authPaused = false;
    snapshot = {
      ...snapshot,
      rows: snapshot.rows.map((row) =>
        row.state.kind === "auth-paused" ? { ...row, state: { kind: "waiting" } } : row,
      ),
    };
    notify();
    pump();
  };

  /** Wait for the job to end, and say how it ended on the row. */
  const follow = (
    id: number,
    it: Inner,
    job: Job,
    epoch: number,
    live: () => boolean,
  ): Promise<void> =>
    new Promise<void>((resolve) => {
      setRow(id, { kind: "reading", jobId: job.id });
      /* Watched **before** the engine is poked, so the list that poke asks for
         is one that began after the watcher — the only kind allowed to say the
         job has vanished. */
      it.unwatch = deps.jobs.watchTerminal(job.id, (ended) => {
        it.unwatch = null;
        if (live()) {
          switch (ended.kind) {
            case "done":
              setRow(id, { kind: "shelved", slug: ended.job.slug });
              break;
            case "error":
              setRow(id, {
                kind: "failed",
                message: ended.job.error ?? COULD_NOT_READ,
                retry: { from: "job", jobId: ended.job.id },
              });
              break;
            case "cancelled":
              setRow(id, { kind: "stopped" });
              break;
            case "vanished":
              setRow(id, { kind: "lost" });
              break;
            default: {
              const unreachable: never = ended;
              throw new Error(`Unknown ending: ${String(unreachable)}`);
            }
          }
        }
        resolve();
      });
      deps.jobs.actionSucceeded(epoch);
      resumeAuthPause();
    });

  /**
   * Hash, grant and PUT: the part of a row before its job. The upload id once
   * the bytes are in Storage, or null when the row has already been given its
   * ending (a duplicate, the allowance, a failure, a Stop).
   */
  const sendIt = async (
    id: number,
    it: Inner,
    epoch: number,
    live: () => boolean,
  ): Promise<string | null> => {
    // Cleanup can outlive this binding: retain the reader whose grant this is.
    const madeFor = readerId;
    if (it.sha === null) {
      setRow(id, { kind: "hashing" });
      let sha: string;
      try {
        sha = await hashInTurn(it.file);
      } catch {
        if (live()) {
          setRow(id, { kind: "failed", message: COULD_NOT_READ_FILE, retry: { from: "start" } });
        }
        return null;
      }
      if (!live()) return null;
      it.sha = sha;
    }
    const inDrop = seen.get(it.drop) ?? new Map<string, number>();
    seen.set(it.drop, inDrop);
    const first = inDrop.get(it.sha);
    if (first !== undefined && first !== id) {
      const of = snapshot.rows.find((r) => r.id === first);
      setRow(id, { kind: "same-file", as: of?.filename ?? "another file" });
      return null;
    }
    inDrop.set(it.sha, id);
    /* The allowance said no while this one was being hashed. */
    if (outOfRoom !== null) {
      setRow(id, { kind: "no-room", message: outOfRoom });
      return null;
    }

    const controller = new AbortController();
    it.controller = controller;
    setRow(id, { kind: "sending", sent: 0 });
    let grant: Grant;
    try {
      grant = await deps.requestGrant(it.file, controller.signal, {
        sha256: it.sha,
        level: "minimal",
      });
    } catch (err) {
      if (live()) {
        const message = describeFetchFailure(err instanceof Error ? err : new Error(String(err)));
        if (statusOf(err) === 401) {
          deps.jobs.actionFailed(message, 401, epoch);
          pauseForAuth(id, message, { from: "start" });
        } else {
          refused(id, err, { from: "start" });
        }
      }
      return null;
    }
    if (!live()) {
      /* Stopped while the grant was out: give it straight back. */
      void deps.cancelUpload(grant.uploadId, madeFor).catch(() => {});
      return null;
    }
    it.uploadId = grant.uploadId;
    try {
      await deps.putFile(grant, it.file, {
        onProgress: (p) => {
          if (live()) setRow(id, { kind: "sending", sent: p.sent });
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (!live()) return null;
      if ((err as Error).name === "AbortError") {
        setRow(id, { kind: "stopped" });
        return null;
      }
      /* A 409 from Storage means the bytes are already at our key — see
         `sendBytes` in uploadEngine.ts. Anything else is a failure. */
      if (statusOf(err) !== 409) {
        setRow(id, { kind: "failed", message: (err as Error).message, retry: { from: "start" } });
        return null;
      }
    }
    if (!live()) return null;
    it.controller = null;
    return grant.uploadId;
  };

  const run = async (id: number, from: RetryFrom): Promise<void> => {
    const it = inner.get(id);
    if (!it) return;
    it.attempt += 1;
    const attempt = it.attempt;
    const session = fence;
    const live = () => session === fence && it.attempt === attempt;
    active.add(id);
    guard();
    const epoch = deps.jobs.epoch();

    try {
      let step: RetryFrom = from;

      if (step.from === "start") {
        const uploadId = await sendIt(id, it, epoch, live);
        if (!live() || uploadId === null) return;
        step = { from: "queue", uploadId };
      }

      setRow(id, { kind: "reading", jobId: null });
      let job: Job;
      try {
        if (step.from === "queue") {
          const outcome = await deps.queue(step.uploadId);
          if (!live()) return;
          if ("article" in outcome) {
            deps.jobs.actionSucceeded(epoch);
            resumeAuthPause();
            setRow(id, { kind: "shelved", slug: outcome.article });
            return;
          }
          job = outcome;
        } else {
          job = await deps.retryJob(step.jobId);
          if (!live()) return;
        }
      } catch (err) {
        if (!live()) return;
        const message = describeFetchFailure(err instanceof Error ? err : new Error(String(err)));
        deps.jobs.actionFailed(message, statusOf(err), epoch);
        if (statusOf(err) === 401) pauseForAuth(id, message, step);
        else refused(id, err, step);
        return;
      }
      await follow(id, it, job, epoch, live);
    } finally {
      /* Only the attempt that is still current gives the slot back: a Stop has
         already taken it, and a Retry holds it now. */
      if (live()) {
        active.delete(id);
        it.controller = null;
        /* The bytes are not wanted once the row is done with; the digest stays. */
        pump();
      }
    }
  };

  const clear = (): void => {
    fence += 1;
    for (const it of inner.values()) {
      it.controller?.abort();
      it.unwatch?.();
    }
    inner.clear();
    active.clear();
    seen.clear();
    pending.clear();
    outOfRoom = null;
    authPaused = false;
    hashTail = Promise.resolve();
    if (releaseGuard) {
      releaseGuard();
      releaseGuard = null;
    }
    snapshot = EMPTY;
  };

  return {
    start(key) {
      if (readerId === key) return;
      clear();
      readerId = key;
      notify();
    },

    reader: () => readerId,

    stop() {
      clear();
      readerId = null;
      notify();
    },

    subscribe(onChange) {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    },

    getSnapshot: () => snapshot,

    add(files) {
      if (readerId === null || files.length === 0) return;
      /* A new drop is a new question for the allowance: the reader may have
         made room since the last one said no. */
      outOfRoom = null;
      const drop = nextDrop++;
      const taken = files.slice(0, BATCH_MAX_FILES);
      const rows: BatchRow[] = taken.map((file) => {
        const id = nextId++;
        const wrong = uploadProblem({ name: file.name, type: file.type, size: file.size });
        if (!wrong) {
          inner.set(id, {
            file,
            drop,
            sha: null,
            uploadId: null,
            controller: null,
            attempt: 0,
            unwatch: null,
          });
        }
        return {
          id,
          filename: file.name,
          bytes: file.size,
          state: wrong ? { kind: "refused", message: wrong } : { kind: "waiting" },
        };
      });
      snapshot = {
        rows: [...snapshot.rows, ...rows],
        overflow: Math.max(0, files.length - BATCH_MAX_FILES),
      };
      notify();
      pump();
    },

    cancel() {
      let changed = false;
      const rows = snapshot.rows.map((r) => {
        const s = r.state.kind;
        if (s !== "waiting" && s !== "hashing" && s !== "sending" && s !== "auth-paused") return r;
        const it = inner.get(r.id);
        if (it) {
          it.attempt += 1;
          it.controller?.abort();
          it.controller = null;
          if (it.uploadId) void deps.cancelUpload(it.uploadId, readerId).catch(() => {});
        }
        active.delete(r.id);
        pending.delete(r.id);
        changed = true;
        return { ...r, state: { kind: "stopped" } as BatchState };
      });
      if (!changed) return;
      snapshot = { ...snapshot, rows };
      notify();
      guard();
    },

    retry(rowId) {
      const state = stateOf(rowId);
      if (state?.kind !== "failed" || !inner.has(rowId)) return;
      /* Ahead of the waiting rows: the reader asked for this one by name. */
      pending.set(rowId, state.retry);
      setRow(rowId, { kind: "waiting" });
      pump();
    },

    resume() {
      /* `useJobSession` lifts the job engine first. If it is still paused,
         credentials did not actually change and this queue stays still too. */
      if (deps.jobs.authFailed()) return;
      resumeAuthPause();
      pump();
    },

    dismiss() {
      if (snapshot.rows.some((r) => rowIsLive(r.state))) return;
      for (const it of inner.values()) it.unwatch?.();
      inner.clear();
      seen.clear();
      pending.clear();
      outOfRoom = null;
      snapshot = EMPTY;
      notify();
    },

    reset() {
      clear();
      readerId = null;
      subscribers.clear();
    },
  };
}

/** A job that failed with no sentence of its own. Should not happen; said plainly if it does. */
const COULD_NOT_READ = "This file could not be read. Trying again sometimes works.";

/** The browser could not read the file off the disk to take its digest. */
const COULD_NOT_READ_FILE =
  "This browser could not read that file off your disk. Choosing it again usually works.";

/**
 * As the reader the batch is bound to, or not at all. Not `send` from
 * jobEngine.ts, which names the *job* engine's reader: the three are bound
 * and unbound together (`useJobSession`), one after another, and a request
 * should name the engine that made it.
 */
const post = async <T>(url: string, body: unknown): Promise<T> =>
  readJson<T>(
    await apiFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      batchUpload.reader(),
    ),
  );

/**
 * The live one.
 *
 * **Every request names the reader the batch is bound to**, read when the
 * call is made, as uploadEngine.ts § the live one says and for its reason
 * (docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md § 2).
 */
export const batchUpload: BatchUpload = createBatchUpload({
  /* Arrows rather than the functions themselves, so this module can be
     imported where upload.ts is mocked without the mock naming all three. */
  hash: (file) => sha256Hex(file),
  requestGrant: (file, signal, claim) => requestGrant(file, signal, claim, batchUpload.reader()),
  putFile: (grant, file, options) => putFile(grant, file, options),
  queue: (uploadId) => post<Job | AlreadyAnArticle>("/api/jobs", { uploadId, level: "minimal" }),
  retryJob: async (jobId) =>
    readJson<Job>(
      await apiFetch(
        `/api/jobs/${encodeURIComponent(jobId)}/retry`,
        { method: "POST" },
        batchUpload.reader(),
      ),
    ),
  cancelUpload: async (uploadId, madeFor) => {
    await apiFetch(
      `/api/uploads/${encodeURIComponent(uploadId)}`,
      { method: "DELETE" },
      madeFor,
    );
  },
  jobs: {
    epoch: () => jobEngine.epoch(),
    authFailed: () => jobEngine.getSnapshot().authFailed,
    actionSucceeded: (epoch) => jobEngine.actionSucceeded(epoch),
    actionFailed: (message, status, epoch) => jobEngine.actionFailed(message, status, epoch),
    watchTerminal: (jobId, onEnd) => jobEngine.watchTerminal(jobId, onEnd),
  },
  /* The same warning uploadEngine.ts raises, and the fact safe-to-reload.ts
     reads — unload-guard.ts. */
  guardUnload: () => warnBeforeUnload("upload"),
});
