/**
 * **`GET /api/overseer/schedule`** — plan 260910e § D6, D7, Stage 3.
 *
 * The daemon writes `schedule.json` every checkpoint tick; this route reads it,
 * bounded, and forwards it. What these tests pin down:
 *
 * - **every kind of nothing is its own answer** — no file, a file it could not
 *   read, a file too large to read, a schema this build does not know — and a
 *   store directory that could not even be resolved answers too, rather than
 *   taking the dashboard down;
 * - **the join is the production one**: the store is read through
 *   `makeSchedule()`, the composition `server.ts` calls, over a file Stage 2's
 *   own `writeSchedulePreview` wrote from the daemon's own `schedulePreview`;
 * - **the browser reads what the CLI reads**: the route's body, handed to the
 *   browser's client, parses to exactly what `overseer status` gets from
 *   `readSchedulePreviewFile` over the same file;
 * - **`server.ts` mounts it in code, not in a comment**
 *   (docs/project/fleet-dashboard-modes.md § The test).
 *
 * Every store root is a temp directory; `~/.overseer` is never touched. No id in
 * this file is a uuid (`tests/fixture-ids.test.ts`).
 */
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_SCHEDULE_FILE_BYTES,
  readScheduleFile,
  SCHEDULE_PATH,
  schedulePayload,
  scheduleRoute,
  type ScheduleRouteDeps,
} from "../tools/fleet/routes-schedule.js";
import { parseSchedulePreview, SCHEDULE_PREVIEW_SCHEMA } from "../tools/fleet/schedule-parse.js";
import { makeSchedule } from "../tools/fleet/schedule-wiring.js";
import { makeScheduleApi, parseSchedulePayload } from "../tools/fleet/web/src/schedule-client";
import type { SchedulePreview } from "../tools/fleet/wire.js";
import { behaviourHash, type AuthorisedJob, type JobBehaviour, type JobDocument } from "../tools/overseer/jobs.js";
import { evidenceAsBuilt, type DocumentEvidence } from "../tools/overseer/schedule-plan.js";
import {
  listRevision,
  readSchedulePreviewFile,
  SCHEDULE_PREVIEW_FILE,
  schedulePreview,
  writeSchedulePreview,
} from "../tools/overseer/schedule-preview.js";
import { hours } from "../tools/overseer/schedules.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fleet-schedule-route-test-"));
  roots.push(root);
  return root;
}

const NOW = new Date("2026-09-10T12:00:00.000Z");
const SERVED_MS = Date.parse("2026-09-10T12:00:20.000Z");
const RECEIVED_MS = 1_789_100_000_000;

/* ------------------------------------------------------------------ *
 * A preview the daemon's own function computed, over two jobs: one whose
 * document moved since it was pinned, and one in dry-run.
 * ------------------------------------------------------------------ */

const DOC: JobDocument = { path: "docs/fixture/route-test-job.md", sha256: "b".repeat(64) };

function job(id: string, dispatch: JobBehaviour["dispatch"]): AuthorisedJob {
  const behaviour: JobBehaviour = { id, what: `run ${id}`, documents: [DOC], work: { kind: "session" }, dispatch };
  return {
    definition: { behaviour, schedule: { everyMs: hours(24), leaseMs: hours(1), initialDelayMs: hours(2) } },
    authorisedHash: behaviourHash(behaviour),
    authorisedDocuments: [DOC],
  };
}

function daemonPreview(): SchedulePreview {
  const definitions = [job("route-edited-job", { kind: "live" }), job("route-dry-job", { kind: "dry-run", why: "a route fixture" })];
  const evidence: DocumentEvidence = new Map([
    ...evidenceAsBuilt(definitions),
    ["route-edited-job", [{ kind: "read" as const, path: DOC.path, sha256: "c".repeat(64) }]],
  ]);
  return schedulePreview({
    instanceId: "route-test-instance",
    now: NOW,
    list: { kind: "given", definitions, listRevision: listRevision(definitions), evidence },
    occurrences: new Map(),
    history: { kind: "intact" },
    arming: { kind: "armed", at: "2026-09-01T00:00:00.000Z" },
    launchSeparationMs: 0,
    capabilities: { session: true, rules: true },
    headline: { kind: "armed", why: "a route test", at: NOW.toISOString() },
  });
}

/* ------------------------------------------------------------------ *
 * Driving a route without a socket — the shape tests/fleet-admission-route.test.ts uses.
 * ------------------------------------------------------------------ */

type Answer = { handled: boolean; status: number; headers: Record<string, string>; raw: string };

function call(route: ReturnType<typeof scheduleRoute>, url: string, method = "GET"): Answer {
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

function body(answer: Answer): Record<string, unknown> {
  return JSON.parse(answer.raw) as Record<string, unknown>;
}

function file(answer: Answer): Record<string, unknown> {
  return body(answer)["file"] as Record<string, unknown>;
}

/** A `fetch` that answers from the route in-process, so the client is driven by the route's real bytes. */
function fetchFrom(route: ReturnType<typeof scheduleRoute>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = `/${String(input)}`;
    const answer = call(route, url);
    return new Response(answer.raw, { status: answer.status, headers: answer.headers });
  }) as typeof fetch;
}

function deps(over: Partial<ScheduleRouteDeps> = {}): ScheduleRouteDeps {
  return { readFile: () => ({ kind: "absent" }), nowMs: () => SERVED_MS, ...over };
}

/* ------------------------------------------------------------------ */

describe("the payload over a real store directory, through makeSchedule()", () => {
  it("serves the daemon's own file, and the browser reads it exactly as overseer status does", async () => {
    const storeDir = tempRoot();
    expect(writeSchedulePreview(storeDir, daemonPreview())).toEqual({ ok: true });
    const composed = makeSchedule({ storeDir, nowMs: () => SERVED_MS });

    const answer = call(composed.route, SCHEDULE_PATH);
    expect(answer.handled).toBe(true);
    expect(answer.status).toBe(200);
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(body(answer)["schema"]).toBe(1);
    expect(body(answer)["servedAt"]).toBe(new Date(SERVED_MS).toISOString());
    expect(file(answer)["kind"]).toBe("preview");

    /* THE TWO READERS AGREE, FIELD FOR FIELD. The CLI's read and the route's
       forwarded file go through the one parser and must come out identical. */
    const cli = readSchedulePreviewFile(storeDir);
    expect(parseSchedulePreview(file(answer)["preview"])).toEqual(cli);

    /* …and so does the browser's client, handed the route's real bytes. */
    const view = await makeScheduleApi(fetchFrom(composed.route), () => RECEIVED_MS).read();
    expect(view.kind).toBe("preview");
    if (view.kind !== "preview" || cli.kind !== "preview") throw new Error("expected a preview from both readers");
    expect(view.preview).toEqual(cli.preview);
    expect(view.servedAt).toBe(new Date(SERVED_MS).toISOString());
    expect(view.receivedAtMs).toBe(RECEIVED_MS);
    expect(view.preview.jobs.map((row) => (row.kind === "job" ? `${row.job.jobId}:${row.job.verdict.kind}:${row.job.dispatch.kind}` : "unreadable"))).toEqual([
      "route-edited-job:unauthorised:live",
      "route-dry-job:dry-run:dry-run",
    ]);
  });

  it("resolves the store with storeRoot(): OVERSEER_STORE_DIR when it is absolute", () => {
    const storeDir = tempRoot();
    writeSchedulePreview(storeDir, daemonPreview());
    const composed = makeSchedule({ env: { OVERSEER_STORE_DIR: storeDir }, nowMs: () => SERVED_MS });
    expect(composed.storeDir).toBe(storeDir);
    expect(file(call(composed.route, SCHEDULE_PATH))["kind"]).toBe("preview");
  });

  it("answers `unreadable` with the reason when OVERSEER_STORE_DIR is relative, rather than throwing", () => {
    const composed = makeSchedule({ env: { OVERSEER_STORE_DIR: "relative/overseer-store" }, nowMs: () => SERVED_MS });
    expect(composed.storeDir).toBeNull();
    const answer = call(composed.route, SCHEDULE_PATH);
    expect(answer.status).toBe(200);
    expect(file(answer)["kind"]).toBe("unreadable");
    expect(String(file(answer)["why"])).toContain("absolute");
  });

  it("says a missing file is a daemon that predates this build, not an unreadable one", () => {
    const composed = makeSchedule({ storeDir: tempRoot(), nowMs: () => SERVED_MS });
    const answer = call(composed.route, SCHEDULE_PATH);
    expect(file(answer)["kind"]).toBe("absent");
    expect(String(file(answer)["why"])).toContain("predates this build");
  });

  it("says a file that is not JSON could not be read, and names it", () => {
    const storeDir = tempRoot();
    writeFileSync(join(storeDir, SCHEDULE_PREVIEW_FILE), "{ this is not json", "utf8");
    const answer = call(makeSchedule({ storeDir, nowMs: () => SERVED_MS }).route, SCHEDULE_PATH);
    expect(file(answer)["kind"]).toBe("unreadable");
    expect(String(file(answer)["why"])).toContain(SCHEDULE_PREVIEW_FILE);
  });

  it("refuses a file over the bound with a sentence, without reading it", () => {
    const storeDir = tempRoot();
    const bytes = MAX_SCHEDULE_FILE_BYTES + 1;
    writeFileSync(join(storeDir, SCHEDULE_PREVIEW_FILE), "x".repeat(bytes), "utf8");
    expect(readScheduleFile(storeDir)).toEqual({ kind: "too-large", bytes });
    const answer = call(makeSchedule({ storeDir, nowMs: () => SERVED_MS }).route, SCHEDULE_PATH);
    expect(file(answer)["kind"]).toBe("unreadable");
    expect(String(file(answer)["why"])).toContain(`${bytes} bytes`);
    expect(String(file(answer)["why"])).toContain("not read");
  });

  it("does not follow schedule.json outside the store", () => {
    const storeDir = tempRoot();
    const elsewhere = tempRoot();
    const outside = join(elsewhere, SCHEDULE_PREVIEW_FILE);
    writeFileSync(outside, JSON.stringify(daemonPreview()), "utf8");
    symlinkSync(outside, join(storeDir, SCHEDULE_PREVIEW_FILE));

    const read = readScheduleFile(storeDir);
    expect(read.kind).toBe("unreadable");
    expect(read.kind === "unreadable" && read.why).toContain("regular file");
  });

  it("names a schema this build does not read as its own answer, with both numbers", () => {
    const storeDir = tempRoot();
    writeFileSync(join(storeDir, SCHEDULE_PREVIEW_FILE), JSON.stringify({ schema: 99 }), "utf8");
    const answer = call(makeSchedule({ storeDir, nowMs: () => SERVED_MS }).route, SCHEDULE_PATH);
    expect(file(answer)).toEqual({ kind: "unsupported-schema", schema: 99, known: SCHEDULE_PREVIEW_SCHEMA });
  });

  it("turns a reader that throws into `unreadable`, never a 500", () => {
    const payload = schedulePayload(
      deps({
        readFile: () => {
          throw new Error("the disk went away");
        },
      }),
    );
    expect(payload.file).toEqual({ kind: "unreadable", why: expect.stringContaining("the disk went away") });
  });

  it("classifies with the one parser: a file that parses as unreadable is forwarded as unreadable, not as a preview", () => {
    const payload = schedulePayload(deps({ readFile: () => ({ kind: "read", json: { schema: SCHEDULE_PREVIEW_SCHEMA } }) }));
    expect(payload.file.kind).toBe("unreadable");
  });
});

describe("the route's edges", () => {
  const route = scheduleRoute(deps());

  it("answers HEAD with the status and no body", () => {
    const answer = call(route, SCHEDULE_PATH, "HEAD");
    expect(answer.status).toBe(200);
    expect(answer.raw).toBe("");
  });

  it("is read-only", () => {
    const answer = call(route, SCHEDULE_PATH, "POST");
    expect(answer.status).toBe(405);
    expect(answer.headers["allow"]).toBe("GET, HEAD");
  });

  it("matches its path exactly: a query string is the same route, a sub-path is a 404, a sibling is not claimed", () => {
    expect(call(route, `${SCHEDULE_PATH}?x=1`).status).toBe(200);
    expect(call(route, `${SCHEDULE_PATH}/more`).status).toBe(404);
    expect(call(route, "/api/overseer/schedules").handled).toBe(false);
    expect(call(route, "/api/overseer").handled).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The browser's client: its own arm for "this page never got an answer".
 * ------------------------------------------------------------------ */

describe("schedule-client", () => {
  const served = new Date(SERVED_MS).toISOString();

  it("says, in the page's voice, that it could not reach the route when fetch fails", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const view = await makeScheduleApi(failing).read();
    expect(view).toEqual({ kind: "no-answer", why: expect.stringContaining("could not reach") });
    expect(view.kind === "no-answer" && view.why).toContain("Failed to fetch");
  });

  it("treats a non-200 as no answer, carrying the status and the server's reason", async () => {
    const erroring = (async () => new Response(JSON.stringify({ error: "internal-error", why: "it broke" }), { status: 500 })) as typeof fetch;
    const view = await makeScheduleApi(erroring).read();
    expect(view.kind).toBe("no-answer");
    expect(view.kind === "no-answer" && view.why).toContain("500");
    expect(view.kind === "no-answer" && view.why).toContain("it broke");
  });

  it("treats a body that is not JSON as no answer", async () => {
    const html = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
    expect((await makeScheduleApi(html).read()).kind).toBe("no-answer");
  });

  it("refuses a payload version it does not know before reading any arm", () => {
    const view = parseSchedulePayload({ schema: 2, servedAt: served, file: { kind: "absent", why: "x" } }, RECEIVED_MS);
    expect(view.kind).toBe("no-answer");
  });

  it("refuses a payload with no readable servedAt", () => {
    expect(parseSchedulePayload({ schema: 1, servedAt: "1e300", file: { kind: "absent", why: "x" } }, RECEIVED_MS).kind).toBe("no-answer");
    expect(parseSchedulePayload({ schema: 1, file: { kind: "absent", why: "x" } }, RECEIVED_MS).kind).toBe("no-answer");
  });

  it("keeps the server's arms in the server's voice", () => {
    expect(parseSchedulePayload({ schema: 1, servedAt: served, file: { kind: "absent", why: "no file" } }, RECEIVED_MS)).toEqual({
      kind: "absent",
      why: "no file",
      servedAt: served,
    });
    expect(parseSchedulePayload({ schema: 1, servedAt: served, file: { kind: "unreadable", why: "denied" } }, RECEIVED_MS)).toEqual({
      kind: "unreadable",
      source: "server",
      why: "denied",
      servedAt: served,
    });
    expect(parseSchedulePayload({ schema: 1, servedAt: served, file: { kind: "unsupported-schema", schema: 7, known: 1 } }, RECEIVED_MS)).toEqual({
      kind: "unsupported-schema",
      source: "server",
      schema: 7,
      known: 1,
      servedAt: served,
    });
  });

  it("re-parses the forwarded file with the one parser, and says so in its own voice when the page's build disagrees", () => {
    const newer = parseSchedulePayload({ schema: 1, servedAt: served, file: { kind: "preview", preview: { schema: 2 } } }, RECEIVED_MS);
    expect(newer).toEqual({ kind: "unsupported-schema", source: "page", schema: 2, known: SCHEDULE_PREVIEW_SCHEMA, servedAt: served });
    const damaged = parseSchedulePayload({ schema: 1, servedAt: served, file: { kind: "preview", preview: { schema: 1 } } }, RECEIVED_MS);
    expect(damaged.kind).toBe("unreadable");
    expect(damaged.kind === "unreadable" && damaged.source).toBe("page");
  });

  it("calls an arm it does not know no answer rather than guessing", () => {
    expect(parseSchedulePayload({ schema: 1, servedAt: served, file: { kind: "something-new" } }, RECEIVED_MS).kind).toBe("no-answer");
    expect(parseSchedulePayload("not an object", RECEIVED_MS).kind).toBe("no-answer");
  });
});

/* ------------------------------------------------------------------ *
 * server.ts — the mount, in code rather than in a comment.
 * ------------------------------------------------------------------ */

describe("server.ts", () => {
  /* COMMENTS STRIPPED FIRST. A needle inside a `//` survives commenting the
     mount out, which is how such a line actually dies — fleet-dashboard-modes.md
     § The test. Checked red by commenting the mount out. */
  const code = readFileSync(join(REPO, "tools", "fleet", "server.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  it("mounts the schedule route in uncommented request-path code", () => {
    expect(code).toContain("if (schedule.route.handle(req, res)) return;");
  });

  it("builds the schedule composition exactly once", () => {
    expect(code.filter((line) => line.includes("makeSchedule("))).toHaveLength(1);
  });
});
