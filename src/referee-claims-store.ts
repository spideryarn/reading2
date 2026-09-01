/**
 * A paper's claims run on disk — `data/<slug>/referee-claims.json`.
 *
 * **The fifth file with this shape**, after src/comments.ts, src/chat.ts,
 * src/searches.ts and src/referee-criteria-store.ts: reader state beside the
 * article rather than in it, one JSON file, an atomic write, and a serialised
 * read-modify-write queue. The repetition is the point, and src/searches.ts
 * carries the full argument for every line of it. What is written out here is
 * only what differs.
 *
 * ## What differs from the criteria store
 *
 * **There is one run, not a list.** A referee writes several criteria and asks
 * the paper what *it* claims exactly once, so there is no id, no minting, no
 * three-condition retry rule and no `MAX_` cap: running it again **replaces**
 * what is there. That is also why a retry is not a special case — a second run
 * is simply a run, and the row it overwrites was a failed attempt at the same
 * question rather than a different question somebody might still want.
 *
 * The corollary, and it is the part worth reading before changing anything here:
 * `begin` writes `status: "pending"` over whatever was stored, so **a run that
 * is started throws away the last answer before the new one exists.** That is
 * deliberate — the alternative is a panel showing yesterday's claims under
 * today's spinner, which is the one state a referee cannot interpret — and it is
 * survivable because the whole thing is one model call away from being rebuilt.
 *
 * ## What may be logged from this file
 *
 * Slugs, statuses, counts. **Never a claim, never a quote, never a passage's
 * reasoning.** A paper under review is somebody else's unpublished work, and the
 * same rule the criteria store keeps applies with the volume turned up: this
 * artefact is nothing but quotations from it.
 *
 * The stored `error` string is deliberately **not** logged, for the reason
 * src/searches.ts § `finishRun` sets out and which has now been got wrong in
 * three files: the string is whatever the call threw, and a provider that echoes
 * the request back would put the article's prose into a field a comment claimed
 * could never hold it.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import type { ClaimsRun } from "./referee-claims.js";
import { assertSlug } from "./slug.js";

const ROOT = path.resolve(import.meta.dirname, "..");

const fileFor = (slug: string) => path.join(ROOT, "data", slug, "referee-claims.json");

/**
 * Read-modify-write serialised per process — src/comments.ts has the full
 * reasoning. It matters less here than in the criteria store (there is one row,
 * so no second row can be lost) and is kept anyway, because the failure it
 * prevents is a `finish` and a `begin` interleaving into a file that holds
 * neither answer.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

/** The stored run, or `null` when this paper has never been asked. */
export async function loadClaimsRun(slug: string): Promise<ClaimsRun | null> {
  assertSlug(slug);
  try {
    /* `parseJsonFrom`, not `JSON.parse`: V8 quotes the first characters of the
       malformed input back, and those characters are the paper's own sentences.
       Same change as src/searches.ts. */
    const parsed = parseJsonFrom<{ run?: ClaimsRun }>(
      await readFile(fileFor(slug), "utf8"),
      `referee-claims.json for ${slug}`,
    );
    return parsed.run ?? null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    log("store").error({ slug, ...errorFields(err) }, "referee claims file unreadable");
    throw err;
  }
}

/** Write a neighbour and rename over the top — src/searches.ts § `save`. */
async function save(slug: string, run: ClaimsRun): Promise<void> {
  const file = fileFor(slug);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ run }, null, 2), "utf8");
    await rename(temp, file);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/**
 * Store a `pending` run, **before** the model is called.
 *
 * The ordering is the whole reason this exists rather than the route writing
 * when the answer lands: if the process dies mid-run, the file holds a run that
 * never finished rather than nothing at all, and the sweep below can turn that
 * into something a referee can act on.
 */
export async function beginClaimsRun(
  slug: string,
  now: () => string = () => new Date().toISOString(),
  sourceHash?: string,
): Promise<ClaimsRun> {
  assertSlug(slug);
  const run: ClaimsRun = {
    status: "pending",
    createdAt: now(),
    claims: [],
    // Absent, not `undefined` — `exactOptionalPropertyTypes`, and no
    // `"sourceHash": null` on disk for a store that could not answer.
    ...(sourceHash === undefined ? {} : { sourceHash }),
  };
  await serialised(() => save(slug, run));
  log("store").info({ slug }, "claims run started");
  return run;
}

/**
 * Write the finished (or failed) run over the `pending` one.
 *
 * `createdAt` and `sourceHash` are taken from the row on disk rather than from
 * the patch, so a `finish` cannot quietly re-date a run or claim it was answered
 * against a different version of the paper than the one `begin` fingerprinted.
 * If the file has gone — the referee deleted the article's data underneath us —
 * this writes nothing and answers `null`, rather than resurrecting a row nobody
 * has.
 */
export async function finishClaimsRun(
  slug: string,
  patch: Pick<ClaimsRun, "status"> & Partial<ClaimsRun>,
): Promise<ClaimsRun | null> {
  assertSlug(slug);
  return serialised(async () => {
    const current = await loadClaimsRun(slug);
    if (!current) return null;
    const next: ClaimsRun = {
      ...current,
      ...patch,
      createdAt: current.createdAt,
      ...(current.sourceHash === undefined ? {} : { sourceHash: current.sourceHash }),
    };
    await save(slug, next);
    if (next.status === "error") log("store").warn({ slug }, "claims run failed");
    return next;
  });
}

/** What a sweep writes over an abandoned `pending` run. */
export const CLAIMS_SWEPT = "The server stopped before the claims run finished.";

/**
 * Turn an abandoned `pending` run into an `error`, so it can be run again.
 *
 * `live` is whether *this* process is running it right now, which is the only
 * thing the filesystem store can know — `graceMs` is deliberately absent here
 * for the reason the criteria sweep gives about its own: the filesystem has no
 * other processes to be wrong about, and giving it a grace window would be an
 * improvement smuggled in under a migration.
 *
 * Returns the run as it now stands, so a GET is one call.
 */
export async function sweepClaimsRun(slug: string, live: boolean): Promise<ClaimsRun | null> {
  const current = await loadClaimsRun(slug);
  if (!current || current.status !== "pending" || live) return current;
  const swept = await finishClaimsRun(slug, { status: "error", error: CLAIMS_SWEPT });
  log("store").warn({ slug }, "swept an abandoned claims run");
  return swept;
}
