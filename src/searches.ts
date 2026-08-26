/**
 * Saved meaning-searches on disk — `data/<slug>/searches.json`.
 *
 * The third file with this exact shape, after src/comments.ts and src/chat.ts:
 * reader state beside the article rather than in it, one JSON file, an atomic
 * write, and a serialised read-modify-write queue. That repetition is
 * deliberate. A second good way to store reader state would be one way too
 * many, and when this all moves to Postgres
 * (docs/plans/postgres-migration.md) three identical shapes become three
 * identical tables and none of these modules' interfaces change.
 *
 * ## Why searches are saved at all
 *
 * Because the version this is borrowed from did not save them, and its own
 * write-up is unusually clear about what that cost:
 *
 * > Theirs vanished on reload, which quietly makes the feature a toy — nothing
 * > you produce with it can be returned to.
 * >
 * > — docs/project/original-version/highlighting.md
 *
 * A meaning-search costs a model call and half a minute. Throwing the result
 * away when the reader closes the panel means the second time they want it they
 * pay again. Greg's call, 2026-08-25: saved beside the article, listed when you
 * come back, and re-opening one repaints the page with no model call at all.
 *
 * **Only the meaning half is stored.** Matching on the letters you typed is
 * done in the browser, costs nothing, and is entirely described by `?find=` in
 * the URL — storing it would be caching an instant computation.
 *
 * ## What may be logged from this file
 *
 * Ids, slugs, counts, statuses. **Never `criterion`, never a hit's `quote` or
 * `reasoning`.** A criterion is what somebody was looking for and a quote is
 * the author's prose; both are exactly the kind of string that ends up in a log
 * line that felt harmless. `redact` in log.ts matches key paths and never
 * message strings, so the only thing keeping prose out of the log is not
 * putting it in. Same rule as src/comments.ts and src/chat.ts.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SearchRun } from "./types.js";
import { isSpideryarnId, mintUniqueId } from "./ids.js";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import { assertSlug } from "./slug.js";

const ROOT = path.resolve(import.meta.dirname, "..");

const fileFor = (slug: string) => path.join(ROOT, "data", slug, "searches.json");

/**
 * How many saved searches one article keeps.
 *
 * A cap, because nothing else in the feature deletes anything and a file that
 * only grows is a slow leak with a reader's afternoon in it. The oldest go
 * first, which is the right end: the searches you come back to are the ones you
 * ran recently, and the panel lists them newest-first for the same reason.
 *
 * Generous enough that hitting it is a surprise. If somebody genuinely wants
 * fifty saved searches on one article, that is a signal worth having rather
 * than a limit worth raising quietly.
 */
export const MAX_RUNS = 30;

/**
 * Read-modify-write serialised per process — see src/comments.ts for the full
 * reasoning.
 *
 * It matters here for the same reason it matters in src/chat.ts: a run is
 * written **twice**, tens of seconds apart, with the reader free to start a
 * second search in between. Without the chain, the second search reads the file
 * as it was before the first run landed and writes it back that way. Both
 * writes succeed. One search is simply gone.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

export async function loadRuns(slug: string): Promise<SearchRun[]> {
  assertSlug(slug);
  try {
    /* `parseJsonFrom`, not `JSON.parse`: V8's own parse error quotes the first
       characters of the malformed input back, and those characters are the
       reader's search criteria and the passages they matched. The `error` line
       below keeps `message` and `stack`, so it would have been written down
       twice. src/parse-json.ts, and the same change in src/comments.ts and
       src/chat.ts. */
    const parsed = parseJsonFrom<{ runs?: SearchRun[] }>(
      await readFile(fileFor(slug), "utf8"),
      `searches.json for ${slug}`,
    );
    return parsed.runs ?? [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    // No file yet is normal. A file that will not parse means every saved
    // search for this article is unreadable at once — the same highest-stakes
    // line src/comments.ts carries, and for the same reason.
    log("store").error({ slug, ...errorFields(err) }, "searches file unreadable");
    throw err;
  }
}

/**
 * Write the file so a reader never sees a half-written one.
 *
 * `writeFile` truncates before it writes, so there is a window where the file
 * is empty or cut off mid-object; land in it and every later read throws,
 * wedging every saved search rather than losing the one being written. Writing
 * a neighbour and renaming over the top makes the swap atomic. The temp file
 * goes in the same directory because `rename` is only atomic within one
 * filesystem.
 */
async function save(slug: string, runs: SearchRun[]): Promise<void> {
  const file = fileFor(slug);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ runs }, null, 2), "utf8");
    await rename(temp, file);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/** Apply `mutate` to the stored runs and write the result back. */
export function update(
  slug: string,
  mutate: (runs: SearchRun[]) => SearchRun[],
): Promise<SearchRun[]> {
  assertSlug(slug);
  return serialised(async () => {
    const next = mutate(await loadRuns(slug));
    await save(slug, next);
    return next;
  });
}

/**
 * Store the criterion and a `pending` run, before the model is called.
 *
 * The ordering is the whole reason this exists rather than the route appending
 * when the answer lands: if the process dies mid-search, the file still holds
 * what the reader asked for and a run that never finished, so they see a search
 * that failed and can run it again — rather than a criterion that vanished with
 * the process.
 *
 * The id is **minted by the client** so `?run=` can name something real from
 * the first frame, exactly as a comment id and a thread id are.
 *
 * **An id already in the file, with the same criterion, on a run that FAILED, is
 * a retry rather than a collision.** All three conditions, and the third took a
 * second pass to get right — see the comment at the check itself. This is the
 * branch `createComment` has always had, and its absence here was a real bug:
 * the client's `retry()` resends the failed run's own id, so treating that as
 * taken minted a *second* run and answered under the new id. The old row was never
 * named again, which left the spinner the reader was watching turning forever —
 * the exact failure `finishRun`'s comment below says appending must never cause,
 * arriving from the other end of the same run's life. See
 * docs/postmortems/search-retry-remints-instead-of-resetting.md.
 *
 * `createdAt` is kept from the original on a reset, because it is still the same
 * search the reader asked for; only the attempt is new.
 *
 * Anything that is not one of our ids still gets a minted one back, and the
 * caller is expected to believe the response rather than its own guess.
 */
/**
 * Which run a `beginRun` produces, as a value. **Pure — no clock, no disk.**
 *
 * Lifted out of `beginRun`'s `update` callback so both stores share one copy of
 * the decision. The three-condition retry rule below is the one this file
 * carries a postmortem for; having it in two implementations is how it comes
 * back.
 *
 * `kind` tells the caller which branch ran, because in SQL the two branches are
 * different statements — an `UPDATE` that must name the status it expects, and
 * an `INSERT` followed by a trim. A store that reads `run.status` to work that
 * out would get it wrong: both branches produce `pending`.
 */
export function withRun(
  runs: SearchRun[],
  criterion: string,
  wantedId: string | undefined,
  at: string,
): { runs: SearchRun[]; run: SearchRun; kind: "reset" | "minted" } {
  /* A retry: the same id, the same criterion, **and a row that actually
     failed**. All three, and the third is the one that took two goes to get
     right.

     The criterion stops a send that asks a *different* question under an id
     somebody already holds from overwriting it — that is still a collision and
     still gets a minted id. But criterion equality only proves "same
     question", never "this request is a retry": a double-clicked POST, a
     stale tab retrying after another tab succeeded, and a replayed request all
     match on both fields. Without the status check, each of those would reset
     a `pending` or `done` row — abandoning a call in flight, or throwing away
     an answer the reader already has, and paying for another one either way.

     Only a run that failed is retryable. A `pending` row that is stuck because
     the server died is not covered here and is deliberately left to delete and
     search again, which costs one call rather than risking one. */
  const existing = wantedId
    ? runs.find((r) => r.id === wantedId && r.criterion === criterion && r.status === "error")
    : undefined;
  if (existing) {
    /* Rebuilt field by field rather than spread, and that is the whole point:
       `hits`, `model` and `error` are absent from this object, so the failed
       attempt's error cannot survive underneath a later successful answer.
       `createdAt` is kept, because it is still the same search the reader
       asked for and only the attempt is new — the exact opposite of
       `withRetry` in src/chat.ts, where the reply's `createdAt` IS the
       attempt's clock and has to move. Both are deliberate. */
    const run: SearchRun = {
      id: existing.id,
      criterion,
      createdAt: existing.createdAt,
      status: "pending",
      hits: [],
    };
    return { runs: runs.map((r) => (r.id === run.id ? run : r)), run, kind: "reset" };
  }

  const taken = new Set(runs.map((r) => r.id));
  const run: SearchRun = {
    id:
      wantedId && isSpideryarnId(wantedId) && !taken.has(wantedId)
        ? wantedId
        : mintUniqueId(taken),
    criterion,
    createdAt: at,
    status: "pending",
    hits: [],
  };
  // Newest last on disk, oldest dropped first — the panel sorts for display,
  // so the file stays in the order things happened, which is the order that
  // makes it readable when somebody opens it in an editor.
  return { runs: [...runs, run].slice(-MAX_RUNS), run, kind: "minted" };
}

export async function beginRun(
  slug: string,
  criterion: string,
  wantedId?: string,
  now: () => string = () => new Date().toISOString(),
): Promise<SearchRun> {
  let stored!: SearchRun;
  await update(slug, (runs) => {
    const { runs: next, run } = withRun(runs, criterion, wantedId, now());
    stored = run;
    return next;
  });
  log("store").info({ slug, runId: stored.id }, "search started");
  return stored;
}

/**
 * Write the finished (or failed) result over the `pending` run.
 *
 * Never appends. The row is already there — `beginRun` put it there — and
 * appending on completion would leave the pending one behind as a permanent
 * spinner nothing can clear. Same rule as `finishTurn` in src/chat.ts.
 *
 * A run whose id is not there any more is **not** re-added: the reader deleted
 * it while the model was thinking, and bringing it back would undo a deliberate
 * act. `patch` returning the whole list is what lets the caller notice.
 */
export async function finishRun(
  slug: string,
  runId: string,
  patch: Partial<SearchRun>,
): Promise<SearchRun[]> {
  const next = await update(slug, (runs) =>
    runs.map((r) => (r.id === runId ? { ...r, ...patch, id: r.id, criterion: r.criterion } : r)),
  );
  /* The reader can see this — the run shows as failed — so it is not silent to
     them. It is silent to whoever is running the server, who is the one who can
     tell a bad API key from a model that timed out.

     **The stored `error` string is deliberately NOT logged.** This line used to
     carry it as `reason`, reasoning that it is "the stored error string, never
     the criterion and never a quote". True, and not the point: the string is
     whatever `search` threw, and one of the things it throws is
     `OpenRouter ${status}: ${detail.slice(0, 400)}` (src/search.ts) — four
     hundred characters of a provider's response body. A provider that echoes
     the request back in an error puts the criterion, and the article prose sent
     as context with it, into exactly the field this claimed could never hold it.
     Redaction could not have caught it: it is path-based, and `reason` is not a
     path anyone would think to list.

     Nothing is lost. src/search.ts logs its own failure line with the model, the
     HTTP status and the elapsed time, which is what separates a bad key from a
     slow model.

     **The durable fix landed on 2026-08-26.** src/search.ts no longer puts any
     of the provider's body in what it throws (`providerRefused` /
     `providerSpokeNonsense`, src/openrouter-stream.ts), so the string this line
     declines to log is safe today. It still declines, because a rule that holds
     only while every call site stays careful is not a rule.

     **This is the third file to carry this bug**, after src/comments.ts (where
     GPT/Codex found it) and src/chat.ts. All three were written by copying the
     one before, and each copy brought along a comment explaining why the field
     was safe. Keep all three in step, and see docs/project/logging.md — the
     durable fix is at the throw site, not here. */
  if (patch.status === "error") {
    log("store").warn({ slug, runId }, "search failed");
  }
  return next;
}

export async function deleteRun(slug: string, runId: string): Promise<SearchRun[]> {
  const remaining = await update(slug, (runs) => runs.filter((r) => r.id !== runId));
  // Destructive with no undo, so it is logged — and `remaining` is the count,
  // so a delete that removed nothing (a stale id from a second tab) can be told
  // apart from one that did.
  log("store").info({ slug, runId, remaining: remaining.length }, "search deleted");
  return remaining;
}
