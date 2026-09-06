/**
 * **What a saved meaning-search *is*** — the cap, the palette rule and the
 * mint-or-retry decision that `pgSearchStore` (src/store/pg-searches.ts) is
 * written against.
 *
 * The third file with this shape, after src/comments.ts and src/chat.ts, and
 * for the same reason: the rules live in one place and the store runs them.
 * Every write goes to Postgres, and the file-writing half of this module went
 * with `src/store/fs.ts` on 2026-09-05
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G).
 * `loadRuns` stays for one caller — `tests/helpers/seed-reader-state.ts`, which
 * reads a fixture's `data/<slug>/searches.json` into rows.
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
import { readFile } from "node:fs/promises";
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
 * **An id already stored, with the same criterion, on a run that FAILED, is a
 * retry rather than a collision.** All three conditions, and the third took a
 * second pass to get right — see the comment at the check itself. This is the
 * branch `pgCommentStore.create` has always had, and its absence here was a
 * real bug:
 * the client's `retry()` resends the failed run's own id, so treating that as
 * taken minted a *second* run and answered under the new id. The old row was never
 * named again, which left the spinner the reader was watching turning forever —
 * the exact failure `finishRun`'s comment below says appending must never cause,
 * arriving from the other end of the same run's life. See
 * docs/postmortems/260826f-search-retry-remints-instead-of-resetting.md.
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
  sourceHash?: string,
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
      /* **The reader's colour survives the retry**, and it is the one field
         here that must. Everything else is rebuilt field by field precisely so
         the failed attempt cannot leave anything behind — but a colour is not
         part of the attempt, it is a property of the question, and the question
         is the thing a retry keeps (`createdAt` is kept for the same reason two
         lines up). Dropping it made the filesystem store disagree with the
         Postgres one, whose reset simply does not name the column: press ↺ on a
         search you had coloured and the colour was gone on files and kept on
         Postgres. GPT Sol's review, 2026-08-27. */
      ...(existing.colour === undefined ? {} : { colour: existing.colour }),
      /* The **new** attempt's article, not the failed one's. A retry is a fresh
         model call over whatever the article says today, so carrying the old
         hash forward would date the answer to a version of the piece this
         attempt never saw. Rebuilt field by field, like everything else here,
         so a stale hash cannot survive underneath a later answer either. */
      ...(sourceHash === undefined ? {} : { sourceHash }),
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
    // Absent, not `undefined` — `exactOptionalPropertyTypes`, and the file on
    // disk gets no `"sourceHash": null` for a store that could not answer.
    ...(sourceHash === undefined ? {} : { sourceHash }),
  };
  // Newest last on disk, oldest dropped first — the panel sorts for display,
  // so the file stays in the order things happened, which is the order that
  // makes it readable when somebody opens it in an editor.
  return { runs: [...runs, run].slice(-MAX_RUNS), run, kind: "minted" };
}


/**
 * The ceiling on a stored colour — **not** the size of the palette.
 *
 * The palette is eight hues (`CATEGORICAL_SLOTS`, src/web/hit-colours.ts) and
 * that number lives in the browser and in styles/colourscales.css, which is
 * the seam that whole file exists to keep: *the colour belongs to the design
 * tokens*. So the server deliberately does not know how many hues there are.
 * What it knows is that a slot is a small non-negative integer, and that is
 * enough to keep nonsense — a float, a negative, a hex string, a number with
 * eleven digits — out of the store.
 *
 * The two ways to be wrong are not symmetrical, which is why the bound is
 * loose rather than tight. Too loose and a reader picking colour 9 in some
 * future nine-hue build stores a 9 that today's `assignSlots` ignores, so the
 * row goes back to its automatic hue — visible, harmless, self-correcting.
 * Too tight and the day the palette grows, every choice past the old end is
 * refused by a server nobody thought to change, which looks like a broken
 * button.
 */
export const MAX_STORED_COLOUR = 64;

/** Is this something we are willing to write into `SearchRun.colour`? */
export function isStorableColour(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < MAX_STORED_COLOUR
  );
}

/**
 * Refuse a colour neither store is willing to write. Tagged `400`, so
 * `httpErrorFrom` in src/routes.ts answers with the same 400 the route's own
 * check gives — see src/profile.ts for the same shape.
 *
 * **The route checks this too, and that is not redundancy to tidy away.** The
 * route is the only place that can refuse *before* anything is read, and this
 * is the only place that covers a caller that is not a route: the importer
 * writes this column, and so does anything anybody adds next. A contract that
 * says both stores validate has to be true of the stores.
 */
export function requireColour(colour: number | null): void {
  if (colour !== null && !isStorableColour(colour)) {
    throw Object.assign(
      new Error(`Not a storable colour: ${JSON.stringify(colour)}`),
      { status: 400 },
    );
  }
}

