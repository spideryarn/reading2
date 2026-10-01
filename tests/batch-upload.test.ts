/**
 * **The batch upload, driven with no network** — `createBatchUpload(deps)`.
 *
 * Plan 261001m § The batch, in the browser: at most three files in flight,
 * where in flight lasts until the file's job has ENDED; identical bytes in one
 * drop are one paper; a duplicate is said, not failed; the allowance stops the
 * rest with nothing half-sent; an error or a cancel does not stall the queue;
 * a sign-out fences everything; Retry starts from where it failed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "../src/types.js";
import {
  BATCH_CONCURRENCY,
  BATCH_MAX_FILES,
  type BatchState,
  type BatchUploadDeps,
  createBatchUpload,
} from "../src/web/batchUpload.js";
import type { TerminalOutcome } from "../src/web/jobEngine.js";
import { HttpError } from "../src/web/lib/api.js";
import type { Grant } from "../src/web/upload.js";

const pdf = (name: string, content = name) =>
  new File([content], name, { type: "application/pdf" });

const job = (id: string, status: Job["status"], extra: Partial<Job> = {}): Job =>
  ({ id, slug: `slug-${id}`, status, steps: [], ...extra }) as unknown as Job;

/** Let every pending promise settle. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

interface World {
  deps: BatchUploadDeps;
  grants: string[];
  hashes: string[];
  puts: { name: string; signal?: AbortSignal }[];
  queued: string[];
  retried: string[];
  cancelledUploads: string[];
  /** End a watched job. */
  end(jobId: string, outcome: TerminalOutcome): void;
  watching(): string[];
  /** What the next grant for this filename does instead of succeeding. */
  grantFails: Map<string, Error>;
  queueFails: Map<string, Error>;
  /** Grants held open until released. */
  holdGrants: boolean;
  heldGrants: (() => void)[];
  holdPuts: boolean;
  heldPuts: (() => void)[];
  holdHashes: boolean;
  heldHashes: (() => void)[];
  guards: number;
  jobAuthFailed: boolean;
}

function world(): World {
  const watchers = new Map<string, (o: TerminalOutcome) => void>();
  const w: World = {
    grants: [],
    hashes: [],
    puts: [],
    queued: [],
    retried: [],
    cancelledUploads: [],
    grantFails: new Map(),
    queueFails: new Map(),
    holdGrants: false,
    heldGrants: [],
    holdPuts: false,
    heldPuts: [],
    holdHashes: false,
    heldHashes: [],
    guards: 0,
    jobAuthFailed: false,
    end(jobId, outcome) {
      const cb = watchers.get(jobId);
      if (!cb) throw new Error(`nobody is watching ${jobId}`);
      watchers.delete(jobId);
      cb(outcome);
    },
    watching: () => [...watchers.keys()],
    deps: {
      hash: async (file) => {
        w.hashes.push(file.name);
        if (w.holdHashes) await new Promise<void>((resolve) => w.heldHashes.push(resolve));
        return `sha-${await file.text()}`;
      },
      requestGrant: async (file, signal, claim) => {
        expect(claim.level).toBe("minimal");
        expect(claim.sha256).toMatch(/^sha-/);
        w.grants.push(file.name);
        if (w.holdGrants) await new Promise<void>((r) => w.heldGrants.push(r));
        const fail = w.grantFails.get(file.name);
        if (fail) throw fail;
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        return { uploadId: `u-${file.name}`, url: "x", expiresAt: "", slug: file.name } as Grant;
      },
      putFile: async (_grant, file, options) => {
        w.puts.push({ name: file.name, ...(options.signal ? { signal: options.signal } : {}) });
        if (w.holdPuts) {
          await new Promise<void>((resolve, reject) => {
            w.heldPuts.push(resolve);
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("Upload cancelled", "AbortError")),
            );
          });
        }
      },
      queue: async (uploadId) => {
        w.queued.push(uploadId);
        const fail = w.queueFails.get(uploadId);
        if (fail) throw fail;
        return job(`j-${uploadId}`, "queued");
      },
      retryJob: async (jobId) => {
        w.retried.push(jobId);
        return job(`${jobId}-again`, "queued");
      },
      cancelUpload: async (uploadId) => {
        w.cancelledUploads.push(uploadId);
      },
      jobs: {
        epoch: () => 1,
        authFailed: () => w.jobAuthFailed,
        actionSucceeded: () => {},
        actionFailed: () => {},
        watchTerminal: (jobId, onEnd) => {
          watchers.set(jobId, onEnd);
          return () => watchers.delete(jobId);
        },
      },
      guardUnload: () => {
        w.guards += 1;
        return () => {
          w.guards -= 1;
        };
      },
    },
  };
  return w;
}

let w: World;
let batch: ReturnType<typeof createBatchUpload>;

beforeEach(() => {
  w = world();
  batch = createBatchUpload(w.deps);
  batch.start("reader-1");
});

const states = () => batch.getSnapshot().rows.map((r) => r.state.kind);
const stateOf = (name: string): BatchState => {
  const row = batch.getSnapshot().rows.find((r) => r.filename === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row.state;
};

describe("the batch", () => {
  it("holds three in flight until their jobs END, not until they are queued", async () => {
    batch.add(["a", "b", "c", "d", "e"].map((n) => pdf(`${n}.pdf`)));
    await settle();
    expect(BATCH_CONCURRENCY).toBe(3);
    expect(states()).toEqual(["reading", "reading", "reading", "waiting", "waiting"]);
    expect(w.grants, "a fourth file was started while three jobs were running").toEqual([
      "a.pdf",
      "b.pdf",
      "c.pdf",
    ]);
    expect(w.guards, "the tab is not held open while files are in flight").toBe(1);

    w.end("j-u-a.pdf", { kind: "done", job: job("j-u-a.pdf", "done", { slug: "a-paper" }) });
    await settle();
    expect(stateOf("a.pdf")).toEqual({ kind: "shelved", slug: "a-paper" });
    expect(stateOf("d.pdf").kind).toBe("reading");
    expect(stateOf("e.pdf").kind).toBe("waiting");
  });

  it("treats identical bytes in one drop as one paper", async () => {
    batch.add([pdf("one.pdf", "same"), pdf("copy-of-one.pdf", "same"), pdf("two.pdf", "other")]);
    await settle();
    expect(stateOf("copy-of-one.pdf")).toEqual({ kind: "same-file", as: "one.pdf" });
    expect(w.grants).toEqual(["one.pdf", "two.pdf"]);
  });

  it("hashes one file at a time, and only once when a send is retried", async () => {
    w.holdHashes = true;
    batch.add([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")]);
    await settle();
    expect(w.hashes).toEqual(["a.pdf"]);

    w.heldHashes.shift()?.();
    await settle();
    expect(w.hashes).toEqual(["a.pdf", "b.pdf"]);
    w.heldHashes.shift()?.();
    await settle();
    expect(w.hashes).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    w.holdHashes = false;
    for (const release of w.heldHashes.splice(0)) release();
    await settle();

    /* A fresh send attempt reuses the digest already held on the row. */
    w.grantFails.set("retry.pdf", new Error("The network dropped. [net-down]"));
    const separate = createBatchUpload(w.deps);
    separate.start("reader-1");
    separate.add([pdf("retry.pdf")]);
    await settle();
    expect(separate.getSnapshot().rows[0]?.state.kind).toBe("failed");
    w.grantFails.delete("retry.pdf");
    separate.retry(separate.getSnapshot().rows[0]?.id ?? -1);
    await settle();
    expect(w.hashes.filter((name) => name === "retry.pdf")).toHaveLength(1);
    expect(separate.getSnapshot().rows[0]?.state.kind).toBe("reading");
  });

  it("deduplicates within one drop, but lets a later drop ask the server again", async () => {
    batch.add([pdf("one.pdf", "same"), pdf("copy.pdf", "same")]);
    await settle();
    expect(stateOf("copy.pdf").kind).toBe("same-file");

    batch.add([pdf("later.pdf", "same")]);
    await settle();
    expect(stateOf("later.pdf").kind).toBe("reading");
    expect(w.grants).toContain("later.pdf");
  });

  it("says a duplicate the server found, with its slug, and moves on", async () => {
    w.grantFails.set(
      "a.pdf",
      new HttpError("That file is already on your shelf, so it was not added again. [up-dup]", 409, {
        code: "duplicate",
        article: "the-paper",
      }),
    );
    batch.add([pdf("a.pdf"), pdf("b.pdf")]);
    await settle();
    const a = stateOf("a.pdf");
    expect(a.kind).toBe("duplicate");
    expect(a.kind === "duplicate" && a.slug).toBe("the-paper");
    expect(a.kind === "duplicate" && a.message).toContain("[up-dup]");
    expect(stateOf("b.pdf").kind).toBe("reading");
    expect(w.puts.map((p) => p.name), "a duplicate's bytes were sent").toEqual(["b.pdf"]);
  });

  it("hears a duplicate from the job POST too", async () => {
    w.queueFails.set(
      "u-a.pdf",
      new HttpError("That file is already being added. [up-dup-wait]", 409, { code: "duplicate" }),
    );
    batch.add([pdf("a.pdf")]);
    await settle();
    expect(stateOf("a.pdf")).toMatchObject({ kind: "duplicate", slug: null });
  });

  it("stops the rest when the allowance says no, sending nothing more", async () => {
    w.holdPuts = true;
    batch.add(["a", "b", "c", "d", "e", "f"].map((n) => pdf(`${n}.pdf`)));
    await settle();
    /* a, b and c are mid-PUT. */
    expect(states().slice(0, 3)).toEqual(["sending", "sending", "sending"]);
    w.holdPuts = false;
    for (const release of w.heldPuts.splice(0)) release();
    await settle();
    /* The next file's grant is refused 402. */
    w.grantFails.set(
      "d.pdf",
      new HttpError("A paper added without AI processing counts as 1/100 … [pay-minimal]", 402),
    );
    w.end("j-u-a.pdf", { kind: "done", job: job("j-u-a.pdf", "done") });
    await settle();
    expect(stateOf("d.pdf").kind).toBe("no-room");
    expect(stateOf("e.pdf").kind).toBe("no-room");
    expect(stateOf("f.pdf").kind).toBe("no-room");
    expect(stateOf("f.pdf")).toMatchObject({ message: expect.stringContaining("[pay-minimal]") });
    /* The two still running are left to finish. */
    expect(stateOf("b.pdf").kind).toBe("reading");
    w.end("j-u-b.pdf", { kind: "done", job: job("j-u-b.pdf", "done") });
    w.end("j-u-c.pdf", { kind: "done", job: job("j-u-c.pdf", "done") });
    await settle();
    expect(w.grants, "a file was started after the allowance said no").toEqual([
      "a.pdf",
      "b.pdf",
      "c.pdf",
      "d.pdf",
    ]);
    expect(w.guards).toBe(0);
  });

  it("aborts grant requests that have not answered when a 402 stops the queue", async () => {
    w.holdGrants = true;
    w.queueFails.set(
      "u-a.pdf",
      new HttpError("A paper added without AI processing counts as 1/100 … [pay-minimal]", 402),
    );
    batch.add(["a", "b", "c", "d"].map((name) => pdf(`${name}.pdf`)));
    await settle();
    expect(w.grants).toEqual(["a.pdf", "b.pdf", "c.pdf"]);

    /* Let a receive its grant and reach the refusing job POST. Hashing then
       advances b and c to their own held grant requests. */
    w.heldGrants.shift()?.();
    await settle();
    expect(stateOf("a.pdf").kind).toBe("no-room");
    expect(stateOf("b.pdf").kind).toBe("no-room");
    expect(stateOf("c.pdf").kind).toBe("no-room");
    expect(stateOf("d.pdf").kind).toBe("no-room");

    w.holdGrants = false;
    for (const release of w.heldGrants.splice(0)) release();
    await settle();
    expect(w.puts.map((put) => put.name), "a file without a grant at the 402 was sent").toEqual([
      "a.pdf",
    ]);
  });

  it.each([
    ["error", { kind: "failed" }],
    ["cancelled", { kind: "stopped" }],
    ["vanished", { kind: "lost" }],
  ] as const)("frees the slot when a job ends %s", async (how, expected) => {
    batch.add(["a", "b", "c", "d"].map((n) => pdf(`${n}.pdf`)));
    await settle();
    const outcome: TerminalOutcome =
      how === "vanished"
        ? { kind: "vanished" }
        : { kind: how, job: job("j-u-a.pdf", how, { error: "It could not be read. [x-y]" }) };
    w.end("j-u-a.pdf", outcome);
    await settle();
    expect(stateOf("a.pdf")).toMatchObject(expected);
    expect(stateOf("d.pdf").kind, "the queue stalled behind an ending that was not done").toBe(
      "reading",
    );
  });

  it("retries a failed job through /retry, and follows the new job", async () => {
    batch.add([pdf("a.pdf")]);
    await settle();
    w.end("j-u-a.pdf", {
      kind: "error",
      job: job("j-u-a.pdf", "error", { error: "The AI service is busy. [ai-busy]" }),
    });
    await settle();
    const failed = stateOf("a.pdf");
    expect(failed).toMatchObject({ kind: "failed", retry: { from: "job", jobId: "j-u-a.pdf" } });
    const row = batch.getSnapshot().rows[0];
    batch.retry(row?.id ?? -1);
    await settle();
    expect(w.retried).toEqual(["j-u-a.pdf"]);
    expect(stateOf("a.pdf")).toEqual({ kind: "reading", jobId: "j-u-a.pdf-again" });
    w.end("j-u-a.pdf-again", { kind: "done", job: job("j-u-a.pdf-again", "done", { slug: "a" }) });
    await settle();
    expect(stateOf("a.pdf")).toEqual({ kind: "shelved", slug: "a" });
    expect(w.grants, "a retry of the job sent the file again").toEqual(["a.pdf"]);
  });

  it("keeps Retry inside the three-file concurrency cap", async () => {
    batch.add(["a", "b", "c", "d", "e"].map((n) => pdf(`${n}.pdf`)));
    await settle();
    w.end("j-u-a.pdf", {
      kind: "error",
      job: job("j-u-a.pdf", "error", { error: "The AI service is busy. [ai-busy]" }),
    });
    await settle();
    expect(stateOf("d.pdf").kind).toBe("reading");
    const a = batch.getSnapshot().rows.find((row) => row.filename === "a.pdf");
    batch.retry(a?.id ?? -1);
    await settle();
    expect(stateOf("a.pdf").kind).toBe("waiting");
    expect(w.retried, "Retry made a fourth live job").toEqual([]);

    w.end("j-u-b.pdf", { kind: "done", job: job("j-u-b.pdf", "done") });
    await settle();
    expect(w.retried).toEqual(["j-u-a.pdf"]);
    expect(stateOf("a.pdf").kind).toBe("reading");
  });

  it("retries a failed job POST without sending the bytes again", async () => {
    w.queueFails.set("u-a.pdf", new HttpError("That upload is still arriving. [up-x]", 409));
    batch.add([pdf("a.pdf")]);
    await settle();
    expect(stateOf("a.pdf")).toMatchObject({ kind: "failed", retry: { from: "queue" } });
    w.queueFails.clear();
    batch.retry(batch.getSnapshot().rows[0]?.id ?? -1);
    await settle();
    expect(w.puts).toHaveLength(1);
    expect(w.queued).toEqual(["u-a.pdf", "u-a.pdf"]);
    expect(stateOf("a.pdf").kind).toBe("reading");
  });

  it("pauses the whole batch on a final 401 and resumes at the failed phase", async () => {
    w.queueFails.set("u-a.pdf", new HttpError("Your session has expired. [auth-expired]", 401));
    batch.add([pdf("a.pdf")]);
    await settle();
    expect(stateOf("a.pdf")).toMatchObject({ kind: "auth-paused", retry: { from: "queue" } });

    batch.add([pdf("b.pdf")]);
    await settle();
    expect(stateOf("b.pdf").kind).toBe("waiting");
    expect(w.grants, "the paused queue sent another file").toEqual(["a.pdf"]);

    w.queueFails.clear();
    batch.resume();
    await settle();
    expect(w.puts.filter((put) => put.name === "a.pdf"), "resume sent a.pdf twice").toHaveLength(1);
    expect(w.queued.filter((id) => id === "u-a.pdf")).toHaveLength(2);
    expect(stateOf("a.pdf").kind).toBe("reading");
    expect(stateOf("b.pdf").kind).toBe("reading");
  });

  it("starts no more files while an advance 401 has paused the job engine", async () => {
    batch.add(["a", "b", "c", "d"].map((name) => pdf(`${name}.pdf`)));
    await settle();
    w.jobAuthFailed = true;
    w.end("j-u-a.pdf", {
      kind: "error",
      job: job("j-u-a.pdf", "error", { error: "Your session has expired. [auth-expired]" }),
    });
    await settle();
    expect(stateOf("d.pdf").kind, "the batch ignored the job engine's auth pause").toBe("waiting");

    w.jobAuthFailed = false;
    batch.resume();
    await settle();
    expect(stateOf("d.pdf").kind).toBe("reading");
  });

  it("Stop ends what has not been queued, gives back its grant, and leaves running jobs alone", async () => {
    w.holdPuts = true;
    batch.add(["a", "b", "c", "d"].map((n) => pdf(`${n}.pdf`)));
    await settle();
    /* Let a through to its job; b and c are mid-PUT; d waits. */
    w.heldPuts.shift()?.();
    await settle();
    expect(states()).toEqual(["reading", "sending", "sending", "waiting"]);
    batch.cancel();
    await settle();
    expect(states()).toEqual(["reading", "stopped", "stopped", "stopped"]);
    expect(w.puts[1]?.signal?.aborted, "the PUT was not aborted").toBe(true);
    expect(w.cancelledUploads.sort()).toEqual(["u-b.pdf", "u-c.pdf"]);
    expect(w.queued).toEqual(["u-a.pdf"]);
    w.end("j-u-a.pdf", { kind: "done", job: job("j-u-a.pdf", "done", { slug: "a" }) });
    await settle();
    expect(stateOf("a.pdf").kind).toBe("shelved");
    expect(stateOf("d.pdf").kind, "Stop was undone by a slot coming free").toBe("stopped");
    expect(w.grants).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });

  it("is fenced by a sign-out: nothing lands in the next reader's batch", async () => {
    w.holdGrants = true;
    batch.add([pdf("a.pdf"), pdf("b.pdf")]);
    await settle();
    batch.stop();
    batch.start("reader-2");
    for (const release of w.heldGrants.splice(0)) release();
    await settle();
    expect(batch.getSnapshot().rows).toEqual([]);
    expect(w.puts, "a signed-out reader's bytes went up").toEqual([]);
    expect(w.queued).toEqual([]);
    expect(w.guards).toBe(0);
  });

  it("does nothing with no reader bound", async () => {
    batch.stop();
    batch.add([pdf("a.pdf")]);
    await settle();
    expect(batch.getSnapshot().rows).toEqual([]);
    expect(w.grants).toEqual([]);
  });

  it("refuses a file a single upload would refuse, and takes the rest", async () => {
    batch.add([new File(["x"], "notes.txt", { type: "text/plain" }), pdf("a.pdf")]);
    await settle();
    expect(stateOf("notes.txt").kind).toBe("refused");
    expect(stateOf("a.pdf").kind).toBe("reading");
  });

  it("takes an HTML file beside the PDFs", async () => {
    batch.add([new File(["<html>"], "page.html", { type: "text/html" }), pdf("a.pdf")]);
    await settle();
    expect(stateOf("page.html").kind).toBe("reading");
  });

  it(`takes ${BATCH_MAX_FILES} files from one drop, and counts the rest`, () => {
    w.holdGrants = true;
    const files = Array.from({ length: BATCH_MAX_FILES + 2 }, (_, i) => pdf(`${i}.pdf`));
    batch.add(files);
    expect(batch.getSnapshot().rows).toHaveLength(BATCH_MAX_FILES);
    expect(batch.getSnapshot().overflow).toBe(2);
  });

  it("clears a finished batch, and not a live one", async () => {
    batch.add([pdf("a.pdf")]);
    await settle();
    batch.dismiss();
    expect(batch.getSnapshot().rows).toHaveLength(1);
    w.end("j-u-a.pdf", { kind: "done", job: job("j-u-a.pdf", "done") });
    await settle();
    batch.dismiss();
    expect(batch.getSnapshot().rows).toEqual([]);
  });
});
