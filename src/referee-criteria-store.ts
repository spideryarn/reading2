/**
 * A referee's saved criteria on disk — `data/<slug>/referee-criteria.json`.
 *
 * **The fourth file with this exact shape**, after src/comments.ts, src/chat.ts
 * and src/searches.ts: reader state beside the article rather than in it, one
 * JSON file, an atomic write, and a serialised read-modify-write queue. The
 * repetition is the point — a second good way to store reader state would be
 * one way too many — and src/searches.ts carries the full argument for every
 * line of it. What is written out here is only what differs.
 *
 * ## What differs from searches
 *
 * - A criterion has a **kind**, and `diverging` carries poles and a scale. So
 *   `withCriterion` takes a whole `RefereeCriterionConfig` where `withRun` took
 *   a string, and a reset adopts the **new** config — see the note there.
 * - The results are three shapes rather than one, discriminated by that kind,
 *   and `validateResults` in src/referee-criteria.ts stamps it. Nothing here
 *   looks inside a result.
 * - Everything else — the fingerprint, the retry rule, the colour, the trim —
 *   is deliberately identical, and where it is identical it is *imported* from
 *   src/searches.ts rather than copied. `currentSourceHash` especially: two
 *   fingerprints of one article can only ever disagree (src/source-hash.ts).
 *
 * ## What may be logged from this file
 *
 * Ids, slugs, counts, statuses, kinds. **Never `criterion`, never a pole,
 * never a result's `quote` or `reasoning`.** A criterion is what a referee has
 * been asked to judge a paper against — it is their own words about somebody
 * else's unpublished work, which is the most private string in this app. Same
 * rule as src/searches.ts, and the same reason its `finishRun` declines to log
 * a stored error string.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { isSpideryarnId, mintUniqueId } from "./ids.js";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import type { RefereeCriterionConfig } from "./referee-criteria.js";
import { MAX_CRITERIA, type SavedCriterion } from "./saved-criteria.js";
import { requireColour } from "./searches.js";
import { assertSlug } from "./slug.js";

const ROOT = path.resolve(import.meta.dirname, "..");

const fileFor = (slug: string) => path.join(ROOT, "data", slug, "referee-criteria.json");

/**
 * Read-modify-write serialised per process — src/comments.ts has the full
 * reasoning, and it matters here for src/searches.ts's reason exactly: a
 * criterion is written **twice**, tens of seconds apart, with the referee free
 * to add a second one in between. Without the chain the second read sees the
 * file as it was before the first write landed, both writes succeed, and one
 * criterion is simply gone.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

export async function loadCriteria(slug: string): Promise<SavedCriterion[]> {
  assertSlug(slug);
  try {
    /* `parseJsonFrom`, not `JSON.parse`: V8 quotes the first characters of the
       malformed input back, and those characters are the referee's criteria and
       the passages they matched. Same change as src/searches.ts. */
    const parsed = parseJsonFrom<{ criteria?: SavedCriterion[] }>(
      await readFile(fileFor(slug), "utf8"),
      `referee-criteria.json for ${slug}`,
    );
    return parsed.criteria ?? [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    log("store").error({ slug, ...errorFields(err) }, "referee criteria file unreadable");
    throw err;
  }
}

/** Write a neighbour and rename over the top — src/searches.ts § `save`. */
async function save(slug: string, criteria: SavedCriterion[]): Promise<void> {
  const file = fileFor(slug);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ criteria }, null, 2), "utf8");
    await rename(temp, file);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/** Apply `mutate` to the stored criteria and write the result back. */
export function update(
  slug: string,
  mutate: (criteria: SavedCriterion[]) => SavedCriterion[],
): Promise<SavedCriterion[]> {
  assertSlug(slug);
  return serialised(async () => {
    const next = mutate(await loadCriteria(slug));
    await save(slug, next);
    return next;
  });
}

/**
 * Which criterion a `begin` produces, as a value. **Pure — no clock, no disk.**
 *
 * `withRun` in src/searches.ts, one field wider, and it is lifted out for the
 * same reason: both stores call it, so the three-condition retry rule this repo
 * carries a postmortem for
 * (docs/postmortems/260826f-search-retry-remints-instead-of-resetting.md) has one
 * implementation rather than two behaviours.
 *
 * **The retry rule is the same three conditions**: the same id, the same
 * criterion text, *and* a row that actually failed. The criterion stops a
 * request asking a different question under an id somebody already holds from
 * overwriting it; the status stops a double-clicked POST, a stale tab and a
 * replayed request from resetting a row that is `pending` or `done`.
 *
 * **The config is NOT one of the three, and a reset adopts the new one.** That
 * is a deliberate difference from `withRun`, which has no config to adopt. A
 * `diverging` criterion whose run failed because its poles were nonsense is
 * exactly the row a referee edits and runs again, and refusing to take the new
 * poles would answer the fixed question with the broken configuration and store
 * it under the same id. The *question* — the criterion text — still has to
 * match, so this cannot silently repurpose somebody's row.
 *
 * `kind` tells the caller which branch ran, because in SQL the two are
 * different statements. A store reading `status` to work it out would get it
 * wrong: both branches produce `pending`.
 */
export function withCriterion(
  criteria: SavedCriterion[],
  criterion: string,
  config: RefereeCriterionConfig,
  wantedId: string | undefined,
  at: string,
  sourceHash?: string,
): { criteria: SavedCriterion[]; row: SavedCriterion; kind: "reset" | "minted" } {
  const existing = wantedId
    ? criteria.find(
        (c) => c.id === wantedId && c.criterion === criterion && c.status === "error",
      )
    : undefined;

  if (existing) {
    /* Rebuilt field by field rather than spread, and that is the whole point:
       `results`, `model` and `error` are absent from this object, so the failed
       attempt cannot survive underneath a later successful answer. `createdAt`
       is kept, because it is still the same criterion the referee asked for and
       only the attempt is new. The **colour** is kept for the reason
       src/searches.ts records after getting it wrong once: a colour is not part
       of the attempt, it is a property of the question, and the two stores
       disagreeing about that is a hue that vanishes on files and survives on
       Postgres. */
    const row: SavedCriterion = {
      id: existing.id,
      criterion,
      config,
      createdAt: existing.createdAt,
      status: "pending",
      results: [],
      ...(existing.colour === undefined ? {} : { colour: existing.colour }),
      // The **new** attempt's article, not the failed one's.
      ...(sourceHash === undefined ? {} : { sourceHash }),
    };
    return {
      criteria: criteria.map((c) => (c.id === row.id ? row : c)),
      row,
      kind: "reset",
    };
  }

  const taken = new Set(criteria.map((c) => c.id));
  const row: SavedCriterion = {
    id:
      wantedId && isSpideryarnId(wantedId) && !taken.has(wantedId)
        ? wantedId
        : mintUniqueId(taken),
    criterion,
    config,
    createdAt: at,
    status: "pending",
    results: [],
    // Absent, not `undefined` — `exactOptionalPropertyTypes`, and no
    // `"sourceHash": null` on disk for a store that could not answer.
    ...(sourceHash === undefined ? {} : { sourceHash }),
  };
  // Newest last on disk, oldest dropped first. The panel sorts for display, so
  // the file stays in the order things happened.
  return { criteria: [...criteria, row].slice(-MAX_CRITERIA), row, kind: "minted" };
}

/**
 * The referee's colour choice, applied to one criterion — pure, so both stores
 * share it.
 *
 * `null` clears the override and puts the row back on the hash. Absent rather
 * than `colour: null` on the way out, for `exactOptionalPropertyTypes` and
 * because a `"colour": null` on disk would be a third state for a field with
 * two. An id that names nothing is returned unchanged rather than thrown at: a
 * second tab can delete a criterion between this tab reading the list and
 * pressing a swatch.
 */
export function withColour(
  criteria: SavedCriterion[],
  id: string,
  colour: number | null,
): SavedCriterion[] {
  requireColour(colour);
  return criteria.map((row) => {
    if (row.id !== id) return row;
    const { colour: _old, ...rest } = row;
    return colour === null ? rest : { ...rest, colour };
  });
}

/**
 * Store the criterion and a `pending` row, before the model is called.
 *
 * The ordering is the whole reason this exists rather than the route appending
 * when the answer lands: if the process dies mid-run, the file still holds what
 * the referee asked for and a run that never finished.
 *
 * The id is **minted by the client**, so the panel can name a real row from the
 * first frame — exactly as a comment id, a thread id and a search run id are.
 */
export async function beginCriterion(
  slug: string,
  criterion: string,
  config: RefereeCriterionConfig,
  wantedId?: string,
  now: () => string = () => new Date().toISOString(),
  sourceHash?: string,
): Promise<SavedCriterion> {
  let stored!: SavedCriterion;
  await update(slug, (criteria) => {
    const { criteria: next, row } = withCriterion(
      criteria,
      criterion,
      config,
      wantedId,
      now(),
      sourceHash,
    );
    stored = row;
    return next;
  });
  log("store").info({ slug, criterionId: stored.id, kind: config.kind }, "criterion started");
  return stored;
}

/**
 * Write the finished (or failed) result over the `pending` row.
 *
 * Never appends — the row is already there, and appending on completion would
 * leave the pending one behind as a permanent spinner nothing can clear. A row
 * whose id is not there any more is **not** re-added: the referee deleted it
 * while the model was thinking, and bringing it back would undo a deliberate
 * act.
 *
 * **The stored `error` string is deliberately not logged**, for the reason
 * src/searches.ts § `finishRun` sets out at length and which has now been got
 * wrong in three files: the string is whatever the call threw, and a provider
 * that echoes the request back would put the criterion and the article prose
 * into a field a comment claimed could never hold them.
 */
export async function finishCriterion(
  slug: string,
  id: string,
  patch: Partial<SavedCriterion>,
): Promise<SavedCriterion[]> {
  const next = await update(slug, (criteria) =>
    criteria.map((c) =>
      c.id === id ? { ...c, ...patch, id: c.id, criterion: c.criterion, config: c.config } : c,
    ),
  );
  if (patch.status === "error") log("store").warn({ slug, criterionId: id }, "criterion failed");
  return next;
}

export async function deleteCriterion(slug: string, id: string): Promise<SavedCriterion[]> {
  const remaining = await update(slug, (criteria) => criteria.filter((c) => c.id !== id));
  // Destructive with no undo, so it is logged — and `remaining` is the count,
  // so a delete that removed nothing can be told apart from one that did.
  log("store").info({ slug, criterionId: id, remaining: remaining.length }, "criterion deleted");
  return remaining;
}

export async function recolourCriterion(
  slug: string,
  id: string,
  colour: number | null,
): Promise<SavedCriterion[]> {
  return update(slug, (criteria) => withColour(criteria, id, colour));
}

/** What a sweep writes over an abandoned `pending` row. */
export const CRITERION_SWEPT = "The server stopped before this criterion finished.";
