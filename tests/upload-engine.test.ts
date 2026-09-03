/**
 * **The upload engine, with no React and no network.**
 *
 * The one thing this file exists to pin is the headline behaviour: `send`
 * resolves with an upload id **while the PUT is still going**, and the ingest is
 * queued when the bytes land whether or not anything is watching. Everything
 * else here is a phase boundary that the plan's review found by name.
 *
 * > I'd like to be able to upload and then click Add immediately, which would
 * > then wait for the upload to finish and run the ingestion queue immediately,
 * > so I could go off and do something else in the meantime.
 * >
 * > — Greg, 2026-09-03
 *
 * Written against `createUploadEngine`'s injected dependencies rather than the
 * singleton, for the reason `tests/job-engine-drives-with-no-view.test.ts`
 * gives: the assertion that means something is *the absence of a component*, and
 * that is only writable because the engine takes its transport as an argument.
 *
 * ## Watched red
 *
 * 2026-09-03, one mutation at a time. The report is in the plan's stage notes;
 * each case names its own where it is not obvious.
 */
import { describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
import {
  createUploadEngine,
  type Transfer,
  type UploadEngineDeps,
} from "../src/web/uploadEngine.js";
import type { Grant, UploadProgress } from "../src/web/upload.js";

const UPLOAD_ID = "up-1";

const grantFor = (id = UPLOAD_ID): Grant => ({
  uploadId: id,
  url: `https://storage.test/staging/${id}?token=x`,
  expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
  slug: "a-paper",
});

const job = (id: string): Job => ({ id, slug: "a-paper", status: "queued", steps: [] }) as unknown as Job;

/** A `File` without a DOM: the engine only ever reads `name` and `size`. */
const aFile = (name = "paper.pdf", size = 11_000_000): File =>
  ({ name, size, type: "application/pdf" }) as unknown as File;

/** A promise somebody else resolves, which is how a transfer is held mid-flight. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Harness {
  engine: ReturnType<typeof createUploadEngine>;
  /** Every `POST /api/jobs {uploadId}` the engine made, in order. */
  queued: string[];
  /** Every PUT it started, in order. Length is how many times it re-sent. */
  puts: number;
  /** Resolve or reject the PUT that is currently in flight. */
  put: ReturnType<typeof deferred<void>>;
  /** Move the progress bar, as `xhr.upload.onprogress` would. */
  progress(sent: number): void;
  /** Answer the next queue POST with this, instead of a job. */
  answerQueueWith(answer: unknown): void;
  transfer(): Transfer | null;
  /** `[message, status, epoch]` for every `actionFailed`. */
  failures: Array<[string, number | null, number]>;
  successes: number[];
  /** How many times a `beforeunload` guard is currently registered. */
  guards(): number;
  /** Whether `jobEngine.start` was reached, which it never may be. */
  started: number;
}

function harness(options: { grant?: () => Promise<Grant> } = {}): Harness {
  const state = {
    queued: [] as string[],
    puts: 0,
    put: deferred<void>(),
    onProgress: undefined as ((p: UploadProgress) => void) | undefined,
    answer: undefined as unknown,
    failures: [] as Array<[string, number | null, number]>,
    successes: [] as number[],
    guardCount: 0,
    started: 0,
  };

  const deps: UploadEngineDeps = {
    requestGrant: options.grant ?? (async () => grantFor()),
    putFile: (_grant, _file, opts) => {
      state.puts += 1;
      state.put = deferred<void>();
      state.onProgress = opts.onProgress;
      /* A real abort rejects the PUT with an `AbortError`, which is what the
         engine reads to tell a Stop from a failure. */
      opts.signal?.addEventListener("abort", () => {
        state.put.reject(
          Object.assign(new Error("Upload cancelled"), { name: "AbortError" }),
        );
      });
      return state.put.promise;
    },
    queue: async (uploadId) => {
      state.queued.push(uploadId);
      if (state.answer !== undefined) {
        const answer = state.answer;
        state.answer = undefined;
        if (answer instanceof Error) throw answer;
        return answer as Job;
      }
      return job("job-1");
    },
    jobs: {
      epoch: () => 7,
      actionSucceeded: (epoch) => state.successes.push(epoch),
      actionFailed: (message, status, epoch) => state.failures.push([message, status, epoch]),
    },
    guardUnload: () => {
      state.guardCount += 1;
      return () => {
        state.guardCount -= 1;
      };
    },
  };

  const engine = createUploadEngine(deps);
  engine.start("reader-a");

  return {
    engine,
    get queued() {
      return state.queued;
    },
    get puts() {
      return state.puts;
    },
    get put() {
      return state.put;
    },
    get failures() {
      return state.failures;
    },
    get successes() {
      return state.successes;
    },
    get started() {
      return state.started;
    },
    progress: (sent) => state.onProgress?.({ sent, total: 11_000_000 }),
    answerQueueWith: (answer) => {
      state.answer = answer;
    },
    transfer: () => engine.getSnapshot().transfer,
    guards: () => state.guardCount,
  };
}

/** Let every already-resolved promise settle, without any timers. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("send", () => {
  it("hands back the upload id while the bytes are still going", async () => {
    /* **The whole feature, in one assertion.** Before this, `uploadPdf`
       resolved its grant only after `await put(...)`, so the address the reader
       navigates to did not exist until the last byte had gone — and there was
       nothing to do but watch a bar. Watched red by awaiting the PUT inside
       `send`: the `expect` below never ran, and the test timed out. */
    const h = harness();
    const id = await h.engine.send(aFile());

    expect(id).toBe(UPLOAD_ID);
    expect(h.transfer()?.phase.kind, "the PUT had already finished").toBe("sending");
    expect(h.queued, "the ingest was queued before the bytes were there").toEqual([]);
  });

  it("reports progress in bytes as the transfer makes it", async () => {
    const h = harness();
    await h.engine.send(aFile());

    h.progress(2_100_000);
    expect(h.transfer()?.phase).toEqual({ kind: "sending", sent: 2_100_000 });
    expect(h.transfer()?.bytes, "the total is the file's own size").toBe(11_000_000);
  });

  it("queues the ingest when the PUT lands, with nothing subscribed at all", async () => {
    /* The other half of the point, and the reason this is an engine rather than
       a hook: nobody is watching. No component is mounted, no subscriber is
       registered, and the reader is three pages away. */
    const h = harness();
    await h.engine.send(aFile());
    expect(h.queued).toEqual([]);

    h.put.resolve();
    await settle();

    expect(h.queued).toEqual([UPLOAD_ID]);
    expect(h.transfer()?.phase).toEqual({ kind: "queued", job: job("job-1") });
  });

  it("records `already an article` as itself, not as a job", async () => {
    /* Retention has taken the ingest's job record and the upload still names
       the article it became — `queueAnUpload` in src/routes.ts answers 200
       `{article}` rather than 202. The page navigates straight there, so
       flattening this into a job would send it looking for one that is gone. */
    const h = harness();
    h.answerQueueWith({ article: "a-paper-spya-k3m9qt" });
    await h.engine.send(aFile());
    h.put.resolve();
    await settle();

    expect(h.transfer()?.phase).toEqual({ kind: "article", slug: "a-paper-spya-k3m9qt" });
  });

  it("refuses a second file while one is in flight", async () => {
    const h = harness();
    await h.engine.send(aFile("first.pdf"));

    await expect(h.engine.send(aFile("second.pdf"))).rejects.toThrow(/still going/);
    expect(h.transfer()?.filename, "the second file took the first one's place").toBe("first.pdf");
    expect(h.puts, "a second transfer started underneath the first").toBe(1);
  });

  it("stays on the shelf when the grant itself is refused", async () => {
    /* A quota refusal, a file the server will not take: decided before any bytes
       move and before the navigation, which is where the plan says every
       refusal the reader can act on up front belongs. */
    const h = harness({ grant: async () => Promise.reject(new Error("No room left. [bill-out]")) });
    const id = await h.engine.send(aFile());

    expect(id).toBeNull();
    expect(h.transfer()?.phase).toEqual({
      kind: "failed",
      at: "granting",
      reason: "No room left. [bill-out]",
    });
    expect(h.puts).toBe(0);
  });
});

describe("when it stops", () => {
  it("treats a cancel as the reader's doing, and queues nothing", async () => {
    const h = harness();
    await h.engine.send(aFile());
    h.engine.cancel();
    await settle();

    expect(h.transfer()?.phase).toEqual({ kind: "cancelled" });
    expect(h.queued, "a cancelled transfer was queued anyway").toEqual([]);
    /* And it stays cancelled: the object never arrives, so the readiness gate
       on the server refuses it for ever even if something did post.
       tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts. */
    h.put.resolve();
    await settle();
    expect(h.queued).toEqual([]);
  });

  it("cancels during hashing or granting, where there is no PUT to abort", async () => {
    /* A Stop that did nothing visible is the worst button on the page. The
       grant is held open here, so the transfer is stuck in `granting` with no
       `AbortController` in existence. Watched red by cancelling only through the
       controller: the phase stayed `granting` for ever. */
    const held = deferred<Grant>();
    const h = harness({ grant: () => held.promise });
    const sending = h.engine.send(aFile());

    h.engine.cancel();
    expect(h.transfer()?.phase).toEqual({ kind: "cancelled" });

    held.resolve(grantFor());
    await sending;
    await settle();
    expect(h.puts, "the grant arrived after the cancel and started a transfer").toBe(0);
  });

  it("keeps a Storage failure on the transfer, with the sentence Storage earned", async () => {
    const h = harness();
    await h.engine.send(aFile());
    h.put.reject(new Error("The upload stopped before it finished. [st-net]"));
    await settle();

    expect(h.transfer()?.phase).toEqual({
      kind: "failed",
      at: "sending",
      reason: "The upload stopped before it finished. [st-net]",
    });
    expect(h.queued).toEqual([]);
  });
});

describe("retry knows which phase failed", () => {
  it("re-POSTs and does not re-PUT when it was the queueing that failed", async () => {
    /* Review finding 4, and the case a reader actually reaches: refused for
       quota, upgraded, pressed Try again. The bytes are in Storage. A retry that
       re-PUT first would get `409 Duplicate` from its own staging key and strand
       the reader short of the thing that actually failed.

       Watched red by making `retry` always call `sendBytes`: `puts` was 2. */
    const h = harness();
    h.answerQueueWith(Object.assign(new Error("No room left. [bill-out]"), { status: 402 }));
    await h.engine.send(aFile());
    h.put.resolve();
    await settle();

    expect(h.transfer()?.phase).toMatchObject({ kind: "failed", at: "queueing" });
    expect(h.failures).toEqual([["No room left. [bill-out]", 402, 7]]);

    h.engine.retry();
    await settle();

    expect(h.puts, "the retry sent the bytes again").toBe(1);
    expect(h.queued).toEqual([UPLOAD_ID, UPLOAD_ID]);
    expect(h.transfer()?.phase).toEqual({ kind: "queued", job: job("job-1") });
  });

  it("re-PUTs with the same grant when it was the sending that failed", async () => {
    /* Which works, and it is measured rather than assumed: a grant is a JWT with
       a two-hour expiry, not a one-shot token, and an aborted PUT leaves no
       object at all. The table is in the plan. */
    const h = harness();
    await h.engine.send(aFile());
    h.put.reject(new Error("The upload stopped before it finished. [st-net]"));
    await settle();

    h.engine.retry();
    await settle();
    expect(h.puts).toBe(2);

    h.put.resolve();
    await settle();
    expect(h.queued).toEqual([UPLOAD_ID]);
  });

  it("reads a duplicate at our own staging key as the bytes having landed", async () => {
    /* The ambiguous completion: Storage committed the object and the browser saw
       `onerror`, so a retry PUTs into a key that is already occupied. Only this
       grant can write that key, so `409` there can mean nothing except *it is
       already yours*. Showing `[st-dup]` and telling the reader to choose the
       file again would make a good upload permanently unqueueable.

       Watched red by treating every non-abort rejection the same: the phase
       stayed `failed` and `queued` was empty. */
    const h = harness();
    await h.engine.send(aFile());
    h.put.reject(Object.assign(new Error("That file has already been sent. [st-dup]"), {
      status: 409,
    }));
    await settle();

    expect(h.queued, "a duplicate was read as a refusal").toEqual([UPLOAD_ID]);
    expect(h.transfer()?.phase).toEqual({ kind: "queued", job: job("job-1") });
  });
});

describe("who it belongs to", () => {
  it("aborts and forgets everything when the reader signs out", async () => {
    const h = harness();
    await h.engine.send(aFile());

    h.engine.stop();
    await settle();

    expect(h.transfer(), "one reader's file survived into the next reader's engine").toBeNull();
    h.put.resolve();
    await settle();
    expect(h.queued, "a PUT that landed after the sign-out queued an ingest").toEqual([]);
  });

  it("fences a reply that arrives after the reader changed", async () => {
    /* The generation, rather than merely clearing the snapshot: a PUT can land
       minutes after a sign-out, and without the fence it writes a finished
       transfer into whoever is signed in now. `jobEngine` guards its own
       requests the same way. */
    const h = harness();
    await h.engine.send(aFile());
    h.engine.stop();
    h.engine.start("reader-b");

    h.put.resolve();
    await settle();

    expect(h.transfer()).toBeNull();
    expect(h.queued).toEqual([]);
  });

  it("reports the queue POST through the job engine's action seam", async () => {
    /* Never `jobEngine.start()`, which takes a session key — calling it with
       anything else tears the poller down and rebinds it under a wrong key,
       weakening the signed-out guarantee `tests/public-network-trace.test.tsx`
       pins. `epoch` + `actionSucceeded` is the seam for an action's outcome: it
       pokes the poll and lifts an authentication pause. Review finding 7. */
    const h = harness();
    await h.engine.send(aFile());
    h.put.resolve();
    await settle();

    expect(h.successes, "the queued job was not announced to the job engine").toEqual([7]);
    expect(h.started, "the upload engine restarted the job engine").toBe(0);
  });
});

describe("the tab-close guard", () => {
  it("is up while work would be lost and down the moment it would not", async () => {
    /* The plan's first boundary was `sending` only, and the review was right
       that it was too narrow: hashing a 50 MB file and waiting on the grant are
       both several seconds in which the reader has committed and nothing is
       recoverable. And it must come *off* on every terminal state, or a finished
       import nags the reader on their way out. */
    const h = harness();
    expect(h.guards()).toBe(0);

    await h.engine.send(aFile());
    expect(h.guards(), "no guard while the bytes are moving").toBe(1);

    h.put.resolve();
    await settle();
    expect(h.guards(), "the guard outlived the transfer").toBe(0);
  });

  it("comes off after a cancel and after a failure, not only after a success", async () => {
    for (const stop of ["cancel", "fail"] as const) {
      const h = harness();
      await h.engine.send(aFile());
      if (stop === "cancel") h.engine.cancel();
      else h.put.reject(new Error("gone [st-net]"));
      await settle();
      expect(h.guards(), stop).toBe(0);
    }
  });
});

describe("forget", () => {
  it("clears a finished transfer and refuses to clear a live one", async () => {
    /* Forgetting a live transfer would hide a PUT that is still running and
       still going to queue something — a card the reader dismissed while the
       work it described carried on. */
    const h = harness();
    await h.engine.send(aFile());

    h.engine.forget();
    expect(h.transfer(), "a running transfer was dismissed").not.toBeNull();

    h.engine.cancel();
    h.engine.forget();
    expect(h.transfer()).toBeNull();
  });
});

describe("the singleton", () => {
  it("does not reach for the DOM when nothing is uploading", async () => {
    /* `guardUnload` in the live engine touches `window`, and the engine is a
       module singleton imported by the client bundle. Constructing one must not
       do anything at all — the guard is registered on the first `send`, which
       only ever happens in a browser. */
    const spy = vi.fn();
    const engine = createUploadEngine({
      requestGrant: async () => grantFor(),
      putFile: async () => {},
      queue: async () => job("j"),
      jobs: { epoch: () => 0, actionSucceeded: () => {}, actionFailed: () => {} },
      guardUnload: () => {
        spy();
        return () => {};
      },
    });
    engine.start("reader-a");
    expect(spy).not.toHaveBeenCalled();
    expect(engine.getSnapshot().transfer).toBeNull();
  });
});
