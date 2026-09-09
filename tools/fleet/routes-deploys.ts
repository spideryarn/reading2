/**
 * `GET /api/deploys` — the most recent production deploys, and how stale the
 * record of them is.
 *
 * A route module rather than lines in `server.ts`, for the reason
 * `routes-health-history.ts` states: importing `server.ts` binds port 8787, so
 * anything living there cannot be driven by a test. `deploysPayload` below takes
 * its file and its git probe as parameters and is pure given both, which is the
 * half worth testing.
 *
 * ## Two arms, and the one they must not become
 *
 * `{ kind: "deploys", versions: [] }` says *we read the record and it is empty*.
 * `{ kind: "unreadable", why }` says *we could not read it*. Drawn the same way
 * those become one claim — "nothing has ever been deployed" — which is false in
 * both directions and reassuring in the wrong one. Same distinction, same
 * reasons, as the health chart's blank day.
 *
 * ## What this route does NOT do
 *
 * **It does not call Vercel**, because this box has no `VERCEL_TOKEN` and the
 * CLI is logged out there; the committed NDJSON is the whole record available.
 *
 * **And it does not read production's own build stamp, which it could.**
 * Production publishes two token-free stamps — `/build.json` for the client
 * bundle (vite.config.ts) and `/api/health` for the function
 * (src/vercel-health.ts) — and `scripts/deploy.ts` already fetches and
 * cross-checks both. They cannot enumerate deploys or recover their timestamps,
 * so they do not replace the record; but they do name **the sha currently
 * serving**, which would split the vague count above into *commits included in
 * the serving build* and *commits that are not*. That is the honest improvement
 * to make next, and it is left out of this pass on purpose: it is an outbound
 * network call from the dashboard, so it needs its own unavailable / malformed /
 * client-disagrees-with-API arms, its own cache, and it must never delay or
 * prevent rendering the recorded list. GPT Sol's P1 finding 1, 2026-09-09.
 * **It does not fetch**, because a dashboard polled from a phone must not write
 * refs in a checkout eight other agents are editing — git-probe.ts. **It does
 * not deploy and does not run the changelog job**: both are Greg's, and step 7
 * of changelog.md § Running it is a person reading public claims a model wrote,
 * which a dashboard cannot be.
 *
 * ## The claim in the header, and why it is worded weakly
 *
 * The tab wants to say how far the record has fallen behind. What it can measure
 * is the non-merge distance from the newest recorded deploy to this checkout's
 * cached `origin/main`.
 *
 * **That number is not "undeployed work", and it is not "shipped work"
 * either.** An earlier draft of this comment said everything on `main` has
 * shipped or is shipping, because `main` is written only by `npm run deploy`.
 * That is false, and GPT Sol caught it: `deploy.ts` pushes to `main` and only
 * *then* waits for Vercel (deploy.ts § Push), so a build that failed or timed
 * out leaves `main` advanced with nothing serving from it. The count therefore
 * mixes three things — deploys that happened and have not been written up, a tip
 * that has not been deployed, and pushes whose build never succeeded — and
 * nothing this route asks can separate them.
 *
 * So the payload names the number for what it literally is, *later non-merge
 * commits in the cached ref*, and the panel says "some may already have
 * deployed; this view cannot tell which". **There is a token-free way to do
 * better** and it is deliberately not taken here — see § What this route does
 * not do. docs/plans/260909b.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { lastGeneratedAt, newestDeploy, readDeploys } from "./deploys.js";
import type { GitProbe } from "./git-probe.js";
import type { DeploysPayload } from "./wire.js";

export type { DeploysPayload };

export const DEPLOYS_PATH = "/api/deploys";

/** How many deploys the tab shows before somebody asks for more. */
export const DEFAULT_LIMIT = 10;

/**
 * The most it will serve at once.
 *
 * Not a security limit — this server has no untrusted caller — but a limit on
 * how much of a growing file gets serialised into one response because somebody
 * typed a number into a URL. The whole file is ~210 KB of changelog copy and
 * grows by roughly eleven deploys a day.
 */
export const MAX_LIMIT = 200;

/** Compress above this. Below it the header costs more than it saves. */
const GZIP_ABOVE_BYTES = 8 * 1024;

export type DeploysRouteDeps = {
  /** The record's text, or why it could not be read. Injected so a test needs no file. */
  readRecord(): { ok: true; text: string } | { ok: false; why: string };
  git: GitProbe;
  nowMs(): number;
};

/**
 * How many the caller asked for, clamped, never NaN.
 *
 * A missing or unparseable `limit` is the default rather than an error: this is
 * a list, and refusing to draw because a query string was odd helps nobody. The
 * same call `windowHoursFrom` makes in routes-health-history.ts.
 */
export function limitFrom(url: string): number {
  const value = new URL(url, "http://fleet.invalid").searchParams.get("limit");
  if (value === null) return DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/** Read the record off disk, as a `readRecord` dep. */
export function readRecordFrom(recordPath: string): DeploysRouteDeps["readRecord"] {
  return () => {
    try {
      return { ok: true, text: readFileSync(recordPath, "utf8") };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      /* The path, because the commonest way this breaks is the dashboard being
         started from somewhere the repo is not, and "ENOENT" alone sends
         somebody looking at the changelog job instead. */
      return {
        ok: false,
        why:
          code === "ENOENT"
            ? `there is no deploy record at ${recordPath} — this dashboard may be running outside the repository`
            : `the deploy record at ${recordPath} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

/**
 * Build the payload. **Pure given its deps** — no request, no response, no clock
 * of its own — so the interesting half of this route is testable directly.
 *
 * **A git probe that fails does not take the list down with it.** The file read
 * and the comparison are independent axes: a readable record with an
 * unavailable git still answers `deploys`, with the readings saying they could
 * not be taken. Collapsing those would let a `git` that would not run blank a
 * perfectly good list of deploys. GPT Sol's P2 finding 5.
 *
 * **The whole file is parsed before `limit` is applied**, so a corrupt line
 * older than the page's cut still counts towards `recordLines` and still holds
 * its release number. Slicing first would make the denominator depend on how
 * many rows somebody asked for.
 */
export async function deploysPayload(deps: DeploysRouteDeps, limit: number): Promise<DeploysPayload> {
  const record = deps.readRecord();
  if (!record.ok) return { schema: 1, kind: "unreadable", why: record.why };

  const read = readDeploys(record.text);
  const newest = newestDeploy(read);

  /* One await, one snapshot, one tip. The probe holds the arm for "the record
     names no deploy to measure from" so that the reason a reading is missing
     lives in one place rather than being invented twice.

     **A null watermark when the newest LINE did not parse.** `newestDeploy()`
     would hand back the newest line that *survived*, and comparing against that
     produces a confident distance from the wrong deploy — a number nobody could
     tell was wrong. Refusing to measure is the honest answer, and the page says
     which. GPT Sol's P1 finding 4. */
  const watermark = read.newestLineRead ? (newest?.sha ?? null) : null;
  const git = await deps.git.snapshot(watermark);

  return {
    schema: 1,
    kind: "deploys",
    versions: read.versions.slice(0, limit),
    total: read.versions.length,
    limit,
    unreadable: read.unreadable,
    recordLines: read.lines,
    lastGeneratedAt: lastGeneratedAt(read),
    newestRecordedSha: newest?.sha ?? null,
    newestLineRead: read.newestLineRead,
    git,
    servedAtMs: deps.nowMs(),
  };
}

/**
 * Mount it. Returns false when the request is not this route's — the same shape
 * as `healthHistoryRoute().handle`, so `server.ts` keeps holding nothing but
 * wiring.
 */
export function deploysRoute(deps: DeploysRouteDeps): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(DEPLOYS_PATH)) return false;
      /* An exact path, so the `startsWith` that mounts it cannot quietly widen
         into `/api/deploys/../something`. The rule routes-new.ts states. */
      const path = url.split("?")[0] ?? "";
      if (path !== DEPLOYS_PATH) {
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ schema: 1, kind: "unreadable", why: `no such route: ${path}` }));
        return true;
      }

      /* `void` because the work is async, **plus a `catch` because "never
         rejects" was an assertion rather than a fact.** The try/catch inside
         `answer` used to end before the gzip and the send, so a throw from
         `gzipSync`, `writeHead` or `end` escaped as an unhandled rejection and
         left the request unanswered — which on a phone is indistinguishable
         from the box being down. GPT Sol, 2026-09-09.

         Nothing is written here: by the time this fires the response may be
         half-sent, and a second `writeHead` would throw again. Destroying the
         socket is what tells the client to stop waiting. */
      void answer(deps, url, req, res).catch((err: unknown) => {
        try {
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify({ schema: 1, kind: "unreadable", why: "the deploys route failed while answering" }));
          } else {
            res.destroy(err instanceof Error ? err : undefined);
          }
        } catch {
          /* The response is beyond saving. Better a dropped socket, which a
             client sees as a failed request, than a hang. */
          res.destroy();
        }
      });
      return true;
    },
  };
}

/**
 * Serialise and send. Separate from `handle` only so the `await` has somewhere
 * to live without making the mount point async.
 */
async function answer(
  deps: DeploysRouteDeps,
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: string;
  try {
    body = JSON.stringify(await deploysPayload(deps, limitFrom(url)));
  } catch (err) {
    /* Every failure below this is meant to be an arm, so this is for the case
       where that is itself wrong. */
    res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(
      JSON.stringify({
        schema: 1,
        kind: "unreadable",
        why: `building the deploys answer threw: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
    return;
  }

  const accepts = String(req.headers["accept-encoding"] ?? "").includes("gzip");
  if (accepts && body.length > GZIP_ABOVE_BYTES) {
    const packed = gzipSync(body);
    res.writeHead(200, {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "cache-control": "no-store",
      vary: "accept-encoding",
      "content-length": String(packed.length),
    });
    res.end(packed);
    return;
  }
  res.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store",
    vary: "accept-encoding",
  });
  res.end(body);
}
