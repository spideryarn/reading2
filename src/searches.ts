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
import type { Block, SearchRun } from "./types.js";
import { isSpideryarnId, mintUniqueId } from "./ids.js";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import { assertSlug } from "./slug.js";
import { isStale } from "./search-stale.js";
import { hashBlocks } from "./source-hash.js";

const ROOT = path.resolve(import.meta.dirname, "..");

const fileFor = (slug: string) => path.join(ROOT, "data", slug, "searches.json");

/** The one slug whose article lives outside `data/` — the committed `example/`
    fixture. A second copy of `FIXTURE_SLUG` in src/api.ts, for the same reason
    `currentSourceHash` below is a second copy of `candidateDirs`: importing it
    would pull that module's whole graph into a storage module. */
const FIXTURE_SLUG = "example";

/**
 * The fingerprint of the article as it stands right now, or `undefined` if the
 * blocks cannot be read.
 *
 * `hashBlocks`, the same function a tweet thread, a glossary and a set of
 * summaries are fingerprinted with — deliberately, and it is worth saying why a
 * *narrower* hash was rejected. A search's hits are anchored to particular
 * blocks, so the obvious economy is to hash only the blocks it cited: then a
 * re-extraction that leaves those paragraphs alone would not disturb the run.
 *
 * That is wrong twice.
 *
 * **A search was answered over the whole article, so the whole article is what
 * it depends on.** The model was shown every block and chose these; add a new
 * section and its answer is now incomplete in a way no hash over the old hits
 * could ever notice. The run would report itself current while the passage the
 * reader is actually looking for sits in text nothing has searched.
 *
 * **And it would be a second definition of "current" for one article.** That is
 * exactly what src/source-hash.ts was pulled out of src/tweets.ts to stop: two
 * fingerprints of the same thing can only ever disagree, and the day they do,
 * one artefact reports itself fresh against a rule nothing else uses.
 *
 * **It has to look where `loadArticle` looks.** `candidateDirs` in src/api.ts
 * tries `data/<slug>/`, adds `example/` for the fixture's own slug and for no
 * other, and accepts a directory only when it holds *both* `blocks.json` and
 * `tree.json`. Hashing `data/<slug>/blocks.json` unconditionally would be right
 * for every real article and wrong for exactly one: the demo, whose files are
 * not under `data/` — no file, no hash, and every saved search on it reads as
 * out of date for ever with nothing saying why. That the rule is written out
 * twice is the cost of not dragging src/api.ts's module graph — pipeline,
 * glossary, summaries — into a storage module; the two are pinned against each
 * other by a test rather than left to agree by memory.
 *
 * `example/` used to be tried for *every* slug here, mirroring the fallback
 * src/api.ts had at the time. When that fallback went, this had to go with it:
 * a slug the reader is now refused must not still have a fingerprint, and one
 * taken from prose they are not being shown is the worst kind to have.
 *
 * The Postgres half is src/store/pg-searches.ts, which asks its own store the
 * same question and gets the same number (tests/store-parity.test.ts).
 */
export async function currentSourceHash(slug: string): Promise<string | undefined> {
  assertSlug(slug);
  const dirs = [path.join(ROOT, "data", slug)];
  if (slug === FIXTURE_SLUG) dirs.push(path.join(ROOT, "example"));
  for (const dir of dirs) {
    const hash = await hashDir(dir, slug);
    if (hash !== undefined) return hash;
  }
  return undefined;
}

/** One candidate directory: its blocks, hashed, or `undefined` if it is not an article. */
async function hashDir(dir: string, slug: string): Promise<string | undefined> {
  try {
    /* `tree.json` too, because that is what `articleDir` requires before it
       will serve a directory. Without the check, a `data/<slug>/` holding a
       half-finished ingest would be hashed here while the reader is being shown
       the fixture — the fingerprint and the article on screen would be of two
       different pieces, which is the one thing this number must never be. */
    await readFile(path.join(dir, "tree.json"), "utf8");
    const parsed = parseJsonFrom<{ blocks?: Block[] }>(
      await readFile(path.join(dir, "blocks.json"), "utf8"),
      `blocks.json for ${slug}`,
    );
    return parsed.blocks ? hashBlocks(parsed.blocks) : undefined;
  } catch {
    /* Swallowed, and this is the one place in this module that swallows. An
       article with no blocks.json is an article with no reading view, so the
       panel is not on screen to be told anything; and a read failure here must
       not take down the list of saved searches, which is what a throw would do.
       `undefined` is the honest answer and `isStale` treats it as stale. */
    return undefined;
  }
}

/**
 * Does this run still describe the article on disk? — **re-exported.**
 *
 * The implementation is src/search-stale.ts, which imports nothing, because the
 * panel has to ask the identical question and nothing under `src/web/` may
 * reach this module (tests/client-imports.test.ts). Two implementations of a
 * rule this small is how a row and the marks it drew end up disagreeing about
 * whether they are out of date.
 *
 * Imported *and* re-exported rather than a bare `export … from`, so the name is
 * bound locally too — src/tweets.ts says why that matters where it does the
 * same for `hashBlocks`.
 */
export { isStale };

/**
 * The saved searches **and** the fingerprint to judge them against.
 *
 * One call rather than two, because the two halves have to be read close
 * together: the article can be re-extracted between them, and a list read
 * before a hash read would be compared against an article none of its runs ever
 * saw. Same shape and the same reasoning as `loadGlossary` and `loadTweets` in
 * src/api.ts, which attach `stale` at the read seam rather than storing it —
 * a flag stored at generation time is right until the moment it matters.
 *
 * The fingerprint is sent rather than a boolean per run so that the *reason*
 * travels with it: the client can tell "this run is old" from "we could not
 * check", and a run that arrives on the POST stream can be judged against the
 * same number without a second request.
 */
export async function readSearches(
  slug: string,
): Promise<{ runs: SearchRun[]; sourceHash: string | undefined }> {
  const runs = await loadRuns(slug);
  return { runs, sourceHash: await currentSourceHash(slug) };
}

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

export async function beginRun(
  slug: string,
  criterion: string,
  wantedId?: string,
  now: () => string = () => new Date().toISOString(),
): Promise<SearchRun> {
  /* Read **before** the update, not inside it: `update` holds the process-wide
     write queue, and a file read in there stalls every other search's write for
     the length of a disk read.

     Stamped at the start of the run rather than at the end of it. The blocks
     the model is actually shown are loaded a moment later (src/routes.ts §
     search), so there is a window — a re-extraction landing between these two
     reads dates the answer to the article as it was a few milliseconds before
     the model saw it. That window is milliseconds wide against a re-extraction
     that takes seconds, and being wrong inside it costs one run one wrong
     verdict. Closing it properly means the hash coming back from
     `findPassagesStream` with the answer, which is a change to the route this
     work was not allowed to touch. Written down rather than left to be found. */
  const sourceHash = await currentSourceHash(slug);
  let stored!: SearchRun;
  await update(slug, (runs) => {
    const { runs: next, run } = withRun(runs, criterion, wantedId, now(), sourceHash);
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
     of the provider's body in what it throws (`ProviderRefused` in
     src/ai-call.ts, `providerSpokeNonsense` in src/openrouter-stream.ts), so the string this line
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

/**
 * The reader's colour choice, applied to one run — pure, so both stores share it.
 *
 * `null` clears the override and puts the row back on the hash. Absent rather
 * than `colour: null` on the way out, because `exactOptionalPropertyTypes` is
 * on and because a `"colour": null` in searches.json would be a third state on
 * disk for a field that has two.
 *
 * A run id that names nothing is returned unchanged rather than thrown at: a
 * second tab can delete a search between this tab reading the list and pressing
 * a swatch, and recolouring a search that is gone is not a fault worth a 404 —
 * the list that comes back says it is gone, which is the answer.
 */
export function withColour(
  runs: SearchRun[],
  runId: string,
  colour: number | null,
): SearchRun[] {
  requireColour(colour);
  return runs.map((run) => {
    if (run.id !== runId) return run;
    const { colour: _old, ...rest } = run;
    return colour === null ? rest : { ...rest, colour };
  });
}

export async function recolourRun(
  slug: string,
  runId: string,
  colour: number | null,
): Promise<SearchRun[]> {
  return update(slug, (runs) => withColour(runs, runId, colour));
}
