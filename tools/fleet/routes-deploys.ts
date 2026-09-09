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
 * **It does not fetch**, because a dashboard polled from a phone must not write
 * refs in a checkout eight other agents are editing — git-probe.ts. **It does
 * not deploy and does not run the changelog job**: both are Greg's, and step 7
 * of changelog.md § Running it is a person reading public claims a model wrote,
 * which a dashboard cannot be.
 *
 * ## The claim in the header, and why it is worded weakly
 *
 * The tab wants to say how far the record has fallen behind. What it can measure
 * is the non-merge distance from the newest recorded deploy to `origin/main`,
 * and **that number is not "undeployed work"** — everything on `main` has
 * shipped or is shipping, since `main` is written only by `npm run deploy`. It
 * lumps together deploys that happened and have not been through the changelog
 * job, and the tip that has not been deployed. Nothing on this box can separate
 * those without Vercel. So the payload names the number for what it is —
 * commits no recorded version accounts for — and the panel says the weaker true
 * thing rather than the stronger false one. docs/plans/260909b.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { lastGeneratedAt, newestDeploy, readDeploys } from "./deploys.js";
import type { GitProbe } from "./git-probe.js";
import type { AncestryReading, CountReading, DeploysPayload } from "./wire.js";

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
 */
export function deploysPayload(deps: DeploysRouteDeps, limit: number): DeploysPayload {
  const record = deps.readRecord();
  if (!record.ok) return { schema: 1, kind: "unreadable", why: record.why };

  const read = readDeploys(record.text);
  const newest = newestDeploy(read);

  /* **The git questions are only asked when there is a sha to ask about.** An
     empty record has no watermark, and probing from nothing would answer
     "0 commits behind", which is the most reassuring possible way to say "we
     have no idea". */
  const ancestry: AncestryReading =
    newest === null
      ? { kind: "unknown", why: "the record names no deploy to measure from" }
      : deps.git.isAncestor(newest.sha);
  const commitsSince: CountReading =
    newest === null
      ? { kind: "unknown", why: "the record names no deploy to measure from" }
      : deps.git.countSince(newest.sha);

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
    main: deps.git.mainRef(),
    ancestry,
    commitsSince,
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

      let body: string;
      try {
        body = JSON.stringify(deploysPayload(deps, limitFrom(url)));
      } catch (err) {
        /* Every failure below this is meant to be an arm, so this is for the
           case where that is itself wrong. A hung request is indistinguishable
           from a dead box on a phone. */
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(
          JSON.stringify({
            schema: 1,
            kind: "unreadable",
            why: `building the deploys answer threw: ${err instanceof Error ? err.message : String(err)}`,
          }),
        );
        return true;
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
        return true;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        vary: "accept-encoding",
      });
      res.end(body);
      return true;
    },
  };
}
