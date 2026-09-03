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

/** The shape `POST /api/jobs` answers when the file is already an article. */
interface AlreadyAnArticleShape {
  article: string;
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
  /** Every `DELETE /api/uploads/:id` the engine sent, in order. */
  cancelled: string[];
  /** Make the next queue POST hang, so a test can act during `queueing`. */
  holdTheQueueRequest(): void;
  /** Let it finish. */
  releaseTheQueueRequest(): void;
}

function harness(options: { grant?: () => Promise<Grant> } = {}): Harness {
  const state = {
    queued: [] as string[],
    cancelled: [] as string[],
    holdQueue: false,
    queueHeld: undefined as ReturnType<typeof deferred<Job | AlreadyAnArticleShape>> | undefined,
    puts: 0,
    put: deferred<void>(),
    onProgress: undefined as ((p: UploadProgress) => void) | undefined,
    answer: undefined as unknown,
    failures: [] as Array<[string, number | null, number]>,
    successes: [] as number[],
    guardCount: 0,
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
      /* **Holdable.** It used to settle immediately, and that is why no test
         could reach the `queueing` phase to press Stop in it — which is exactly
         where GPT Sol found the engine saying "cancelled" while the server made
         the job anyway. A mock that cannot be paused hides the states worth
         testing. */
      if (state.holdQueue) {
        state.queueHeld = deferred<Job | AlreadyAnArticleShape>();
        return state.queueHeld.promise as Promise<Job>;
      }
      if (state.answer !== undefined) {
        const answer = state.answer;
        state.answer = undefined;
        if (answer instanceof Error) throw answer;
        return answer as Job;
      }
      return job("job-1");
    },
    cancelUpload: async (uploadId) => {
      state.cancelled.push(uploadId);
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

  depsShape = deps;
  const engine = createUploadEngine(deps);
  engine.start("reader-a");

  return {
    engine,
    get queued() {
      return state.queued;
    },
    /** Every `DELETE /api/uploads/:id` the engine sent. */
    get cancelled() {
      return state.cancelled;
    },
    holdTheQueueRequest: () => {
      state.holdQueue = true;
    },
    releaseTheQueueRequest: () => state.queueHeld?.resolve(job("job-1")),
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
    progress: (sent) => state.onProgress?.({ sent, total: 11_000_000 }),
    answerQueueWith: (answer) => {
      state.answer = answer;
    },
    transfer: () => engine.getSnapshot().transfer,
    guards: () => state.guardCount,
  };
}

/**
 * The last deps object built, so a case can assert over its **shape**.
 *
 * Used once, for the guarantee that the engine has no way to restart the job
 * poller: that is a property of the seam rather than of a run, and a counter
 * would only ever record that this particular test did not trip it.
 */
let depsShape: UploadEngineDeps;

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
      status: null,
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
      status: null,
    });
    expect(h.queued).toEqual([]);
  });
});

describe("Stop, once the bytes are safe", () => {
  it("is refused while the ingest is being queued", async () => {
    /* **The state Sol found, and the reason `cancel` now declines.** By
       `queueing` the bytes are in Storage and `POST /api/jobs` is in flight:
       nothing can be aborted that would undo anything, and the server may
       already have made the job. Marking the transfer `cancelled` there gave the
       worst state available — a client saying *nothing was added* while the job
       poll found the ingest and drove it to completion. Finding 2.

       Watched red by letting `cancel` run in every phase: the phase became
       `cancelled` and the job below still arrived. */
    const h = harness();
    h.holdTheQueueRequest();
    await h.engine.send(aFile());
    h.put.resolve();
    await settle();
    expect(h.transfer()?.phase.kind).toBe("queueing");

    h.engine.cancel();
    expect(h.transfer()?.phase.kind, "Stop cancelled a request it could not undo").toBe("queueing");
    expect(h.cancelled, "a DELETE went out for an upload that is being claimed").toEqual([]);

    h.releaseTheQueueRequest();
    await settle();
    expect(h.transfer()?.phase.kind).toBe("queued");
  });

  it("tells the server, so a reload is answered rather than polled at", async () => {
    /* Cancelling used to be a fact this tab knew and nobody else did. A reload
       of `/add/upload/<id>` then found a `pending` record with no object and sat
       polling for the two hours of the grant, saying the file was still on its
       way — measured in a browser, 2026-09-03. `DELETE /api/uploads/:id` moves
       it to `expired`, which the waiting page reads and stops on. */
    const h = harness();
    await h.engine.send(aFile());
    h.engine.cancel();
    await settle();

    expect(h.cancelled, "the server was never told the reader pressed Stop").toEqual([UPLOAD_ID]);
    expect(h.transfer()?.phase).toEqual({ kind: "cancelled" });
  });

  it("aborts the grant request, not only the transfer that would follow it", async () => {
    /* Finding 6. The controller used to be created inside `sendBytes`, so a Stop
       during hashing or granting had nothing to fire — the fence stopped the
       *PUT*, and could not stop a grant request already on its way. Hashing a
       50 MB file is seconds, so this is a real window, and what came out of it
       was an upload row minted for a transfer the reader had stopped.

       The signal is asserted rather than the outcome: an aborted `apiFetch` is
       `lib/api.ts`'s business, and what this engine owes is having handed one
       over and fired it. */
    let seen: AbortSignal | undefined;
    const held = deferred<Grant>();
    const h = harness({
      grant: ((_file: File, signal?: AbortSignal) => {
        seen = signal;
        return held.promise;
      }) as unknown as () => Promise<Grant>,
    });
    const sending = h.engine.send(aFile());

    expect(seen, "the grant request was made with no signal at all").toBeDefined();
    expect(seen?.aborted).toBe(false);

    h.engine.cancel();
    expect(seen?.aborted, "Stop did not reach the grant request").toBe(true);

    held.resolve(grantFor());
    await sending;
    await settle();
    expect(h.puts, "a cancelled transfer started sending anyway").toBe(0);
  });
});

describe("resume, when the token comes back", () => {
  it("retries a queue request that was refused 401, and nothing else", async () => {
    /* Finding 5. A job whose `/advance` 401s is retried by the poller for ever;
       a queue POST happens once and then sits `failed`. So a reader whose
       session lapsed during a long upload had their file safely in Storage and
       an ingest nobody would ever queue. `useJobSession` calls this beside
       `jobEngine.resume()` on a fresh token.

       **Never re-PUTs**, which is the half that would be expensive to get
       wrong. */
    const h = harness();
    h.answerQueueWith(Object.assign(new Error("Not signed in. [auth-401]"), { status: 401 }));
    await h.engine.send(aFile());
    h.put.resolve();
    await settle();
    expect(h.transfer()?.phase).toMatchObject({ kind: "failed", at: "queueing", status: 401 });

    h.engine.resume();
    await settle();
    expect(h.queued).toEqual([UPLOAD_ID, UPLOAD_ID]);
    expect(h.puts, "resume sent the bytes again").toBe(1);
    expect(h.transfer()?.phase.kind).toBe("queued");
  });

  it("leaves a quota refusal alone", async () => {
    /* A new token does not buy a slot, and silently re-posting on every hourly
       refresh would be a request that cannot succeed, forever. The reader's own
       Try again is the way out of this one, once they have upgraded. */
    const h = harness();
    h.answerQueueWith(Object.assign(new Error("No room left. [bill-out]"), { status: 402 }));
    await h.engine.send(aFile());
    h.put.resolve();
    await settle();

    h.engine.resume();
    await settle();
    expect(h.queued, "a fresh token re-posted a request the quota had refused").toEqual([
      UPLOAD_ID,
    ]);
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

  it("fences a queue reply that lands after the reader changed", async () => {
    /* **The PUT is let finish first**, and that ordering is the whole case. An
       earlier version stopped the engine while the PUT was still open — but
       `stop` aborts, so the posed PUT rejected immediately with an `AbortError`
       and the later `resolve()` was a no-op. It stayed green with the fence
       removed, which Sol pointed out and which makes it worse than no test.

       So: let the PUT land, hold the *queue* request open, and only then sign
       out. The reply that arrives afterwards is a real one for real work, and
       the fence is the only thing between it and the next reader's engine. */
    const h = harness();
    h.holdTheQueueRequest();
    await h.engine.send(aFile());
    h.put.resolve();
    await settle();
    expect(h.transfer()?.phase.kind, "the queue request did not stay open").toBe("queueing");

    h.engine.stop();
    h.engine.start("reader-b");
    h.releaseTheQueueRequest();
    await settle();

    expect(h.transfer(), "one reader's finished upload landed in the next one's engine").toBeNull();
  });

  it("reports the queue POST through the job engine's action seam", async () => {
    /* `epoch` + `actionSucceeded` is the seam for an action's outcome: it pokes
       the poll and lifts an authentication pause, session-fenced. Review
       finding 7 was that the plan said `jobEngine.start()`, which takes a
       session key — calling it with anything else tears the poller down and
       rebinds it under a wrong key.

       **The guarantee that it cannot is structural, not a runtime count.** An
       earlier version of this case asserted `started === 0` against a counter
       nothing ever incremented — vacuous, as Sol pointed out, and it would have
       stayed green through any change. What actually holds the line is that
       `UploadEngineDeps.jobs` has no `start` on it at all, so reaching for one
       is a compile error rather than a test failure. The line below says that in
       the only way a test can. */
    const h = harness();
    await h.engine.send(aFile());
    h.put.resolve();
    await settle();

    expect(h.successes, "the queued job was not announced to the job engine").toEqual([7]);
    expect(
      Object.keys(depsShape.jobs),
      "the job-engine seam grew a way to restart the poller",
    ).toEqual(["epoch", "actionSucceeded", "actionFailed"]);
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
      cancelUpload: async () => {},
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
