/**
 * **`GET /api/overseer/occurrences`** and **`GET /api/overseer/occurrences/<id>/answer`**
 * — plan 260910f-scheduled-dispatch § D7, Stage A.
 *
 * The list route mirrors `/api/overseer/schedule`: one bounded read of the
 * daemon's file, forwarded as the file's own JSON with the one parser's arm.
 * The answer route is the durable result link, and it is the one route here
 * that serves a file named by the request, so most of these tests are about
 * what it refuses:
 *
 * - an id that is not `lo-<20 hex>`, a `..`, and an encoded traversal — 400;
 * - a symlink at any level it opens (the launches tree, the id's directory,
 *   the attempt directory, the answer itself) — refused, never followed, and
 *   never "fall back to the attempt before";
 * - a file past 256 KB — 413, without reading it;
 * - no answer — 404 with a sentence.
 *
 * It picks the HIGHEST `a<n>`, numerically, not lexically. Every store root is a
 * temp directory; `~/.overseer` is never touched. No id is a uuid.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { OCCURRENCES_FILE, parseOccurrencesFile } from "../tools/fleet/occurrences-parse.js";
import { makeOccurrences } from "../tools/fleet/occurrences-wiring.js";
import {
  MAX_ANSWER_BYTES,
  MAX_OCCURRENCES_FILE_BYTES,
  OCCURRENCES_PATH,
  occurrencesPayload,
  occurrencesRoute,
  readAnswerFile,
  type OccurrencesRouteDeps,
} from "../tools/fleet/routes-occurrences.js";
import { answerUrlOf, makeOccurrencesApi, parseOccurrencesPayload } from "../tools/fleet/web/src/occurrences-client";
import type { ScheduledOccurrence, ScheduledOccurrencesFile } from "../tools/fleet/wire.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fleet-occurrences-route-test-"));
  roots.push(root);
  return root;
}

const SERVED_MS = Date.parse("2026-09-10T12:00:20.000Z");
const RECEIVED_MS = 1_789_100_000_000;
const ID = "lo-0123456789abcdef0123";

const OCCURRENCE: ScheduledOccurrence = {
  launchOccurrenceId: ID,
  schedulerOccurrenceId: "route-occ-job@2026-09-10T11:00:00.000Z#465648545712",
  scheduledAt: "2026-09-10T11:00:00.000Z",
  behaviourHash: "465648545712",
  plannedAt: "2026-09-10T11:00:01.000Z",
  updatedAt: "2026-09-10T11:03:00.000Z",
  attempts: 2,
  state: "completed",
  run: { timeoutMinutes: 5, access: "read-only" },
  result: { kind: "succeeded", why: "exit 0, a usable answer", at: "2026-09-10T11:03:00.000Z" },
  answer: { kind: "present", attempt: 2, bytes: 21, usable: true },
  transcriptPath: null,
  tmuxSession: null,
  commands: { cancel: null, dispose: null },
};

const FILE: ScheduledOccurrencesFile = {
  schema: 1,
  writtenAt: "2026-09-10T12:00:00.000Z",
  instanceId: "route-occ-instance",
  journal: { kind: "whole" },
  jobs: [
    {
      jobId: "route-occ-job",
      dispatch: { kind: "live" },
      run: { timeoutMinutes: 5, access: "read-only" },
      next: { kind: "next-due", at: "2026-09-11T11:00:00.000Z" },
      occurrences: [OCCURRENCE, { ...OCCURRENCE, launchOccurrenceId: "lo-cccccccccccccccccccc", state: "launching", result: { kind: "succeeded", why: "a lie", at: null } }],
      omitted: 0,
    },
  ],
};

/* ------------------------------------------------------------------ *
 * Driving a route without a socket — the shape fleet-schedule-route.test.ts uses.
 * ------------------------------------------------------------------ */

type Answer = { handled: boolean; status: number; headers: Record<string, string>; raw: string };

function call(route: ReturnType<typeof occurrencesRoute>, url: string, method = "GET"): Answer {
  let status = 0;
  let headers: Record<string, string> = {};
  let raw = "";
  const res = {
    writeHead(code: number, next: Record<string, string>) {
      status = code;
      headers = next;
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) raw = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      return res;
    },
  };
  const handled = route.handle({ method, url, headers: {} } as unknown as IncomingMessage, res as unknown as ServerResponse);
  return { handled, status, headers, raw };
}

function file(answer: Answer): Record<string, unknown> {
  return (JSON.parse(answer.raw) as Record<string, unknown>)["file"] as Record<string, unknown>;
}

function fetchFrom(route: ReturnType<typeof occurrencesRoute>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const answer = call(route, `/${String(input)}`);
    return new Response(answer.raw, { status: answer.status, headers: answer.headers });
  }) as typeof fetch;
}

function deps(over: Partial<OccurrencesRouteDeps> = {}): OccurrencesRouteDeps {
  return { readFile: () => ({ kind: "absent" }), readAnswer: () => ({ kind: "absent", why: "no answer in this fake" }), nowMs: () => SERVED_MS, ...over };
}

/** `<store>/launches/o/<id>/a<n>/answer.md`, with the given text. */
function writeAnswer(storeDir: string, id: string, attempt: string, text: string): string {
  const dir = join(storeDir, "launches", "o", id, attempt);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "answer.md");
  writeFileSync(path, text, "utf8");
  return path;
}

function answerPath(id = ID): string {
  return `${OCCURRENCES_PATH}/${id}/answer`;
}

/* ------------------------------------------------------------------ */

describe("the list payload over a real store directory, through makeOccurrences()", () => {
  it("forwards the file's own JSON, and the browser reads it exactly as the one parser does", async () => {
    const storeDir = tempRoot();
    writeFileSync(join(storeDir, OCCURRENCES_FILE), JSON.stringify(FILE), "utf8");
    const composed = makeOccurrences({ storeDir, nowMs: () => SERVED_MS });

    const answer = call(composed.route, OCCURRENCES_PATH);
    expect(answer.handled).toBe(true);
    expect(answer.status).toBe(200);
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(file(answer)["kind"]).toBe("occurrences");
    expect(file(answer)["occurrences"]).toEqual(FILE);

    const view = await makeOccurrencesApi(fetchFrom(composed.route), () => RECEIVED_MS).read();
    const direct = parseOccurrencesFile(FILE);
    if (view.kind !== "occurrences" || direct.kind !== "parsed") throw new Error(`expected occurrences from both readers, got ${view.kind}`);
    expect(view.file).toEqual(direct.file);
    expect(view.servedAt).toBe(new Date(SERVED_MS).toISOString());
    expect(view.receivedAtMs).toBe(RECEIVED_MS);
    /* THE PAGE SEES THE PER-ROW REFUSAL TOO: `succeeded` on a launching record. */
    const job = view.file.jobs[0];
    if (job?.kind !== "job") throw new Error("expected the job row");
    expect(job.job.occurrences.map((row) => row.kind)).toEqual(["occurrence", "unreadable"]);
  });

  it("resolves the store with storeRoot(), and answers `unreadable` rather than throwing when it cannot", () => {
    const storeDir = tempRoot();
    expect(makeOccurrences({ env: { OVERSEER_STORE_DIR: storeDir } }).storeDir).toBe(storeDir);
    const relative = makeOccurrences({ env: { OVERSEER_STORE_DIR: "relative/overseer-store" }, nowMs: () => SERVED_MS });
    expect(relative.storeDir).toBeNull();
    const answer = call(relative.route, OCCURRENCES_PATH);
    expect(answer.status).toBe(200);
    expect(file(answer)["kind"]).toBe("unreadable");
    expect(String(file(answer)["why"])).toContain("absolute");
    /* …and the answer route says so too: 503, "could not look", never a 404's
       "looked and found nothing", and never a 500. */
    const link = call(relative.route, answerPath());
    expect(link.status).toBe(503);
    expect(link.raw).toContain("absolute");
  });

  it("says a missing file is its own absence, with a sentence", () => {
    const answer = call(makeOccurrences({ storeDir: tempRoot(), nowMs: () => SERVED_MS }).route, OCCURRENCES_PATH);
    expect(file(answer)["kind"]).toBe("absent");
    expect(String(file(answer)["why"])).toContain(OCCURRENCES_FILE);
  });

  it("refuses a file over the bound without reading it, and a file that is not JSON, each with a sentence", () => {
    const big = tempRoot();
    writeFileSync(join(big, OCCURRENCES_FILE), "x".repeat(MAX_OCCURRENCES_FILE_BYTES + 1), "utf8");
    const tooBig = file(call(makeOccurrences({ storeDir: big }).route, OCCURRENCES_PATH));
    expect(tooBig["kind"]).toBe("unreadable");
    expect(String(tooBig["why"])).toContain(`${MAX_OCCURRENCES_FILE_BYTES + 1} bytes`);

    const junk = tempRoot();
    writeFileSync(join(junk, OCCURRENCES_FILE), "{ not json", "utf8");
    expect(file(call(makeOccurrences({ storeDir: junk }).route, OCCURRENCES_PATH))["kind"]).toBe("unreadable");
  });

  it("does not follow occurrences.json outside the store", () => {
    const storeDir = tempRoot();
    const outside = join(tempRoot(), OCCURRENCES_FILE);
    writeFileSync(outside, JSON.stringify(FILE), "utf8");
    symlinkSync(outside, join(storeDir, OCCURRENCES_FILE));
    const answer = file(call(makeOccurrences({ storeDir }).route, OCCURRENCES_PATH));
    expect(answer["kind"]).toBe("unreadable");
    expect(String(answer["why"])).toContain("regular file");
  });

  it("names a schema this build does not read, with both numbers", () => {
    const storeDir = tempRoot();
    writeFileSync(join(storeDir, OCCURRENCES_FILE), JSON.stringify({ schema: 9 }), "utf8");
    expect(file(call(makeOccurrences({ storeDir }).route, OCCURRENCES_PATH))).toEqual({ kind: "unsupported-schema", schema: 9, known: 1 });
  });

  it("turns a reader that throws into `unreadable`, never a 500", () => {
    const payload = occurrencesPayload(
      deps({
        readFile: () => {
          throw new Error("the disk went away");
        },
      }),
    );
    expect(payload.file).toEqual({ kind: "unreadable", why: expect.stringContaining("the disk went away") });
  });
});

describe("the answer route: the durable result link", () => {
  it("serves the newest attempt's answer, as plain text that is never sniffed or cached", () => {
    const storeDir = tempRoot();
    writeAnswer(storeDir, ID, "a1", "the first attempt's answer");
    writeAnswer(storeDir, ID, "a2", "schedule fixture ran");
    const answer = call(makeOccurrences({ storeDir }).route, answerPath());
    expect(answer.status).toBe(200);
    expect(answer.raw).toBe("schedule fixture ran");
    expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(answer.headers["cache-control"]).toBe("no-store");
  });

  it("picks the highest attempt numerically, and ignores names that are not a1..a999", () => {
    const storeDir = tempRoot();
    writeAnswer(storeDir, ID, "a9", "nine");
    writeAnswer(storeDir, ID, "a10", "ten");
    writeAnswer(storeDir, ID, "a1000", "not an attempt");
    writeAnswer(storeDir, ID, "a0", "not an attempt");
    writeAnswer(storeDir, ID, "a011", "not an attempt");
    writeAnswer(storeDir, ID, "b99", "not an attempt");
    expect(readAnswerFile(storeDir, ID)).toEqual({ kind: "read", attempt: 10, body: Buffer.from("ten") });
  });

  it("refuses an id that is not the protocol's shape, a `..`, and an encoded traversal, with 400 and without touching the disk", () => {
    const route = occurrencesRoute(
      deps({
        readAnswer: () => {
          throw new Error("the disk must not be read for a bad id");
        },
      }),
    );
    for (const id of ["lo-XYZ", "lo-0123456789abcdef012", "..", "%2e%2e", "..%2F..%2Fetc", "lo-0123456789abcdef0123%2F..", "lo-0123456789ABCDEF0123"]) {
      const answer = call(route, answerPath(id));
      expect(answer.status, id).toBe(400);
      expect(answer.headers["x-content-type-options"], id).toBe("nosniff");
    }
    /* A path with more segments under the id is not this route at all. */
    expect(call(route, `${OCCURRENCES_PATH}/${ID}/../answer`).status).toBe(404);
    expect(call(route, `${OCCURRENCES_PATH}/../../etc/passwd`).status).toBe(404);
  });

  it("refuses a symlinked answer, and does not fall back to an older attempt", () => {
    const storeDir = tempRoot();
    writeAnswer(storeDir, ID, "a1", "older");
    const outside = join(tempRoot(), "secret.md");
    writeFileSync(outside, "a file outside the store", "utf8");
    mkdirSync(join(storeDir, "launches", "o", ID, "a2"));
    symlinkSync(outside, join(storeDir, "launches", "o", ID, "a2", "answer.md"));
    const answer = call(makeOccurrences({ storeDir }).route, answerPath());
    expect(answer.status).toBe(403);
    expect(answer.raw).not.toContain("outside the store");
    expect(answer.raw).not.toContain("older");
  });

  it("refuses a symlinked attempt directory, a symlinked id directory and a symlinked launches tree", () => {
    const elsewhere = tempRoot();
    writeAnswer(elsewhere, ID, "a1", "a file outside the store");

    const attempt = tempRoot();
    mkdirSync(join(attempt, "launches", "o", ID), { recursive: true });
    symlinkSync(join(elsewhere, "launches", "o", ID, "a1"), join(attempt, "launches", "o", ID, "a1"));

    const idDir = tempRoot();
    mkdirSync(join(idDir, "launches", "o"), { recursive: true });
    symlinkSync(join(elsewhere, "launches", "o", ID), join(idDir, "launches", "o", ID));

    const tree = tempRoot();
    symlinkSync(join(elsewhere, "launches"), join(tree, "launches"));

    for (const storeDir of [attempt, idDir, tree]) {
      const answer = call(makeOccurrences({ storeDir }).route, answerPath());
      expect(answer.status).toBe(403);
      expect(answer.raw).not.toContain("outside the store");
    }
  });

  it("refuses an answer over 256 KB with 413, without reading it", () => {
    const storeDir = tempRoot();
    writeAnswer(storeDir, ID, "a1", "x".repeat(MAX_ANSWER_BYTES + 1));
    expect(MAX_ANSWER_BYTES).toBe(256 * 1024);
    const answer = call(makeOccurrences({ storeDir }).route, answerPath());
    expect(answer.status).toBe(413);
    expect(answer.raw).toContain(`${MAX_ANSWER_BYTES + 1} bytes`);
  });

  it("answers 404 with a sentence when there is no launch, no attempt, or an attempt with no answer", () => {
    const none = tempRoot();
    const noAttempt = tempRoot();
    mkdirSync(join(noAttempt, "launches", "o", ID), { recursive: true });
    const noAnswer = tempRoot();
    mkdirSync(join(noAnswer, "launches", "o", ID, "a1"), { recursive: true });
    for (const storeDir of [none, noAttempt, noAnswer]) {
      const answer = call(makeOccurrences({ storeDir }).route, answerPath());
      expect(answer.status).toBe(404);
      expect(answer.raw).toContain(ID);
      expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
    }
  });

  it("the page's link is the route's own path, relative", () => {
    expect(answerUrlOf(ID)).toBe(`api/overseer/occurrences/${ID}/answer`);
    expect(`/${answerUrlOf(ID)}`).toBe(answerPath());
  });
});

describe("the route's edges", () => {
  const route = occurrencesRoute(deps());

  it("answers HEAD with the status and no body, and is read-only", () => {
    const head = call(route, OCCURRENCES_PATH, "HEAD");
    expect(head.status).toBe(200);
    expect(head.raw).toBe("");
    expect(call(route, OCCURRENCES_PATH, "POST").status).toBe(405);
    expect(call(route, answerPath(), "DELETE").status).toBe(405);
  });

  it("matches its paths exactly, and claims no sibling", () => {
    expect(call(route, `${OCCURRENCES_PATH}?x=1`).status).toBe(200);
    expect(call(route, `${OCCURRENCES_PATH}/${ID}`).status).toBe(404);
    expect(call(route, `${OCCURRENCES_PATH}/${ID}/transcript`).status).toBe(404);
    expect(call(route, "/api/overseer/occurrencesx").handled).toBe(false);
    expect(call(route, "/api/overseer/schedule").handled).toBe(false);
  });
});

describe("occurrences-client", () => {
  const served = new Date(SERVED_MS).toISOString();

  it("says, in the page's voice, that it could not reach the route when fetch fails", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const view = await makeOccurrencesApi(failing).read();
    expect(view.kind).toBe("no-answer");
    expect(view.kind === "no-answer" && view.why).toContain("Failed to fetch");
  });

  it("refuses a payload version it does not know, and a servedAt it cannot read", () => {
    expect(parseOccurrencesPayload({ schema: 2, servedAt: served, file: { kind: "absent", why: "x" } }, RECEIVED_MS).kind).toBe("no-answer");
    expect(parseOccurrencesPayload({ schema: 1, servedAt: "1e300", file: { kind: "absent", why: "x" } }, RECEIVED_MS).kind).toBe("no-answer");
  });

  it("re-parses the forwarded file, and says so in its own voice when the page's build disagrees", () => {
    expect(parseOccurrencesPayload({ schema: 1, servedAt: served, file: { kind: "occurrences", occurrences: { schema: 2 } } }, RECEIVED_MS)).toEqual({
      kind: "unsupported-schema",
      source: "page",
      schema: 2,
      known: 1,
      servedAt: served,
    });
    const damaged = parseOccurrencesPayload({ schema: 1, servedAt: served, file: { kind: "occurrences", occurrences: { schema: 1 } } }, RECEIVED_MS);
    expect(damaged.kind === "unreadable" && damaged.source).toBe("page");
  });
});

describe("server.ts", () => {
  /* COMMENTS STRIPPED FIRST, for the reason fleet-schedule-route.test.ts gives. */
  const code = readFileSync(join(REPO, "tools", "fleet", "server.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  it("mounts the occurrences route in uncommented request-path code, once", () => {
    expect(code).toContain("if (occurrences.route.handle(req, res)) return;");
    expect(code.filter((line) => line.includes("makeOccurrences("))).toHaveLength(1);
  });
});
