/**
 * Stage 6 (server side) — the article store.
 *
 * Two reads: one article in full (`loadArticle`), and the shelf of them the
 * homepage lists (`listArticles`). Deliberately transport-free — these are plain
 * async functions, mounted at `GET /api/article/:slug` and `GET /api/library` by
 * src/routes.ts. When a standalone Node server arrives (architecture.md §
 * Server and client) it wraps these rather than reimplementing the reads.
 *
 * Lookup order for one article: data/<slug>/ (the real pipeline output) then
 * example/ (the hand-authored placeholder). So the moment stages 3–5 write
 * data/<slug>/, the client picks it up with no changes here or in the UI.
 *
 * **This file is the seam Postgres goes behind.** Nothing above it knows there
 * are directories: the client sees `Article` and `LibraryEntry`, and both are
 * shaped as rows rather than as files (see the note on `LibraryEntry` in
 * types.ts). See docs/project/library.md § When this becomes Postgres.
 */
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { loadComments } from "./comments.js";
import { isStale as glossaryIsStale, readGlossary } from "./glossary.js";
import { isSlug } from "./ingest.js";
import { errorFields, log } from "./log.js";
import { contextPaths, STEP_ORDER, STEPS, stepIsDone, type StepContext } from "./pipeline.js";
import { readingMinutes } from "./reading-time.js";
import { isStale } from "./tweets.js";
import type {
  Arc,
  Article,
  ArticleMetadata,
  Block,
  GlossaryResponse,
  LibraryEntry,
  Meta,
  StageState,
  ThreadResponse,
  Tree,
  TweetThread,
} from "./types.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Read a JSON artefact, or null if it isn't there.
 *
 * **`null` means absent and nothing else.** A file that exists and won't parse,
 * or won't open, throws — and that distinction is the reason for the log line:
 * absent is the ordinary case (`meta.json` and `arc.json` are both optional, and
 * half the callers below treat a missing file as "skip this"), whereas a
 * `blocks.json` that is on disk and unreadable is a corrupted artefact. The
 * throw is loud at the route, but by then it is one 500 among many; the line
 * here is what names the file.
 *
 * The path is logged relative to the repo root, because an absolute one is
 * mostly the reader's home directory.
 */
async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    log("store").warn(
      { file: path.relative(ROOT, file), ...errorFields(err) },
      "artefact exists but could not be read or parsed",
    );
    throw err;
  }
}

/**
 * Directories to try, in order, for a given slug.
 *
 * **`path.join` is where a traversal lands**, so nothing may reach this
 * function unvalidated. `..` segments are normalised away by `join` rather than
 * rejected by it, so `../../..` walks straight out of the repo. Every exported
 * function below checks the slug before calling this; `slugPart` in
 * src/routes.ts checks it again at the door, which is where a bad one becomes a
 * 400 instead of a stack trace. See docs/project/security.md § The URL.
 */
function candidateDirs(slug: string): string[] {
  return [path.join(ROOT, "data", slug), path.join(ROOT, "example")];
}

/**
 * A slug that is about to become a directory name, or a 400.
 *
 * Every read in this file that joins a slug onto a path calls this first. It is
 * belt and braces over `slugPart` in src/routes.ts — the route is what turns a
 * bad slug into an HTTP status, and this is what stops the hole reopening the
 * next time somebody calls one of these functions from somewhere that is not a
 * route. `answer()` in routes.ts already does exactly that.
 */
function requireSlug(slug: string): void {
  if (isSlug(slug)) return;
  throw Object.assign(new Error(`Not a slug: ${JSON.stringify(slug)}`), { status: 400 });
}

export async function loadArticle(slug: string): Promise<Article> {
  requireSlug(slug);
  for (const dir of candidateDirs(slug)) {
    const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
    const tree = await readJson<Tree>(path.join(dir, "tree.json"));
    if (!blocksFile || !tree) continue;

    // **The standing alarm for the fallback that hid a path traversal.**
    //
    // When data/<slug>/ has no artefacts we fall through to example/ and serve
    // the fixture — and the response looks exactly like the endpoint correctly
    // refusing an unknown slug. That is precisely how a shallow `../../etc`
    // probe reported this API safe while a deeper one walked out of the repo
    // and got HTTP 200 (docs/project/security.md § Why it survived being looked
    // at). Nothing about the response distinguishes the two cases, so the log is
    // the only place the difference can be seen at all.
    //
    // Asking for "example" is not a fallback — that is the fixture's own slug,
    // and falling through is how it is meant to open (see FIXTURE_SLUG below).
    if (dir !== path.join(ROOT, "data", slug) && slug !== FIXTURE_SLUG) {
      log("store").warn(
        { slug, dir: path.relative(ROOT, dir) },
        "article served from the fixture, not from its own directory",
      );
    }

    // meta.json is optional — stages 3-5 don't all write one yet. Falling back
    // to the slug puts "noema-mythology-of-conscious-ai" at the top of the
    // reading view, so derive a real title from the article's own first heading
    // instead, and keep the slug only as the last resort.
    const stored = await readJson<Meta>(path.join(dir, "meta.json"));
    // debug, not warn: a missing meta.json is expected for anything stages 3-5
    // built without stage 2. It is worth a line only because the title the
    // reader ends up looking at was invented here rather than extracted, and
    // "the heading is wrong" is otherwise a mystery.
    if (!stored) {
      log("store").debug({ slug, dir: path.relative(ROOT, dir) }, "no meta.json; title derived");
    }
    const meta =
      stored ??
      ({
        slug,
        title:
          blocksFile.blocks.find((b) => b.kind === "heading" && b.level === 1)?.text ??
          slug,
      } satisfies Meta);

    // Optional, and stays optional: the arc (stage 5b, src/arc.ts) is a
    // second model pass, so an article can be perfectly readable without one.
    // Absent means the L0 column falls back to the root gist.
    const arc = await readJson<Arc>(path.join(dir, "arc.json"));

    return { meta, blocks: blocksFile.blocks, tree, ...(arc ? { arc } : {}) };
  }
  // Tagged 404 rather than left for routes.ts to infer. Inferring it meant
  // every unclassified fault — a corrupt tree.json, a permissions problem —
  // also came back "no such article", which is the wrong thing to investigate.
  throw Object.assign(
    new Error(
      `No article artefacts for "${slug}". Looked in:\n  ${candidateDirs(slug).join("\n  ")}\n` +
        `Each needs blocks.json + tree.json.`,
    ),
    { status: 404 },
  );
}


/**
 * The article's thread, and whether it still describes the article.
 *
 * The read half of stage 5c. `src/tweets.ts` writes `tweets.json`; nothing
 * could get it back out until this existed, which made the generator a write to
 * nowhere — see docs/plans/tweet-thread-page.md.
 *
 * **`articleDir`, not a directory of its own.** The thread has to come from the
 * same place the article does, or `stale` is computed against somebody else's
 * `blocks.json` and means nothing. That also inherits the fixture fallback for
 * free: `example/` has no thread, so the fixture answers 404 and the page
 * offers to write one.
 *
 * `stale` is computed here rather than stored, because a flag written at
 * generation time is right until the moment it matters. 404 for "no thread yet"
 * is the ordinary case, not a fault — it is what the page's button is for, and
 * the message says how to ask for one.
 */
export async function loadTweets(slug: string): Promise<ThreadResponse> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const thread = await readJson<TweetThread>(path.join(dir, "tweets.json"));
  if (!thread) {
    throw Object.assign(
      new Error(
        `No thread for "${slug}" yet. Write one with ` +
          `POST /api/jobs { "slug": "${slug}", "steps": ["tweets"] }.`,
      ),
      { status: 404 },
    );
  }
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  // `articleDir` already proved blocks.json is there, so the fallback is for a
  // file that has become unreadable between the two reads. Unknown counts as
  // stale: the honest answer, and the safe way round to be wrong.
  return { thread, stale: !blocksFile || isStale(thread, blocksFile.blocks) };
}

/**
 * The article's glossary, and whether it still describes the article.
 *
 * The read half of stage 5d. Everything about the shape of this function is
 * borrowed from `loadTweets` above deliberately, because the two answer the
 * same question about different artefacts and the day they stop agreeing is the
 * day one of them is wrong:
 *
 *  - **`articleDir`, not a directory of its own**, or `stale` is computed
 *    against somebody else's `blocks.json` and means nothing. That also
 *    inherits the fixture fallback for free — `example/` has no glossary, so it
 *    answers 404 and the panel offers to find one.
 *  - **`stale` is computed here rather than stored**, because a flag written at
 *    generation time is right until the moment it matters.
 *  - **404 for "no glossary yet" is the ordinary case, not a fault.** Most
 *    articles have none; it is what the panel's button is for, and the message
 *    says how to ask for one.
 */
export async function loadGlossary(slug: string): Promise<GlossaryResponse> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const glossary = await readGlossary(dir);
  if (!glossary) {
    throw Object.assign(
      new Error(
        `No glossary for "${slug}" yet. Find one with ` +
          `POST /api/jobs { "slug": "${slug}", "steps": ["glossary"] }.`,
      ),
      { status: 404 },
    );
  }
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  // `articleDir` already proved blocks.json is there, so the fallback is for a
  // file that has become unreadable between the two reads. Unknown counts as
  // stale: the honest answer, and the safe way round to be wrong.
  return { glossary, stale: !blocksFile || glossaryIsStale(glossary, blocksFile.blocks) };
}

/**
 * Throw the glossary away.
 *
 * **The one destructive read-side operation in this file, and the reason it
 * exists.** Asking for the step again does not replace a glossary, it *appends*
 * to it (src/glossary.ts § `generateGlossary`) — which is right for "find more
 * terms" and leaves no way at all to say "this list is wrong, start over". A
 * reader who dislikes what the model found could otherwise only fix it by
 * changing the article underneath it.
 *
 * So: delete, then ask for the step. Two explicit acts rather than one flag
 * that means different things on different days, and the panel puts a confirm
 * in front of it.
 *
 * A missing file is a success. The caller asked for the glossary to be gone and
 * it is gone; reporting 404 would make the panel show an error for the outcome
 * it wanted.
 */
export async function deleteGlossary(slug: string): Promise<{ deleted: boolean }> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  /* The fixture is not the reader's to delete. `articleDir` falls through to
     `example/` for any slug with no pipeline output of its own — including a
     slug that does not exist at all — so without this the one committed
     directory in the repo is one DELETE away from an unknown article. It has no
     glossary.json today, which is exactly the kind of "it can't happen" that
     stops being true the first time somebody hand-authors one. */
  const own = path.join(ROOT, "data", slug);
  if (dir !== own) {
    throw Object.assign(
      new Error(`"${slug}" is the built-in example. Its glossary is not yours to delete.`),
      { status: 403 },
    );
  }
  try {
    await rm(path.join(dir, "glossary.json"));
    return { deleted: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { deleted: false };
    throw err;
  }
}

/* ----------------------------------------------------------- provenance --
   What the metadata page needs and the article payload does not carry: which
   of the pipeline's stages have actually run for this article.

   Kept behind this seam like everything else here, because a directory walk is
   exactly the sort of thing that has to be. See docs/plans/metadata-page.md. */

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where this article's artefacts actually are, or null if there aren't any.
 *
 * `candidateDirs` again, so this and `loadArticle` cannot come to disagree
 * about which directory an article opens from. Two cases make it matter, and
 * the second is easy to get wrong: `example/` is not under `data/`, and an
 * *unknown* slug falls through to the fixture as well. The metadata page has to
 * describe whatever the reading view is actually showing, so it inherits both —
 * and `ArticleMetadata.dir` is what says where the files came from.
 */
async function articleDir(slug: string): Promise<string | null> {
  for (const dir of candidateDirs(slug)) {
    const [blocks, tree] = await Promise.all([
      exists(path.join(dir, "blocks.json")),
      exists(path.join(dir, "tree.json")),
    ]);
    if (blocks && tree) return dir;
  }
  return null;
}

/**
 * Which stages have run for one article, and what each of them writes.
 *
 * **The list comes from `STEPS[…].outputs()` and `stepIsDone`**, never from a
 * list written out here. Two copies of "what stage 4 produces" would agree on
 * the day they were written and drift silently afterwards — and a page whose
 * job is telling you what happened to your article is the last place that
 * should be guessing. `stepIsDone` also owns the all-of-them-not-any-of-them
 * rule, which is the one that makes `extract` honest: it writes the HTML *and*
 * `meta.json`, and a crash between the two must not report a finished stage.
 *
 * ## What this deliberately does not answer
 *
 * **Whether an artefact is stale.** The obvious check — is `tree.json` older
 * than the `blocks.json` it was built from — is wrong here, and wrong in the
 * direction that matters: a *successful* toc run writes `tree.json` first and
 * copies `blocks.json` second (src/toc.ts), so every correct run would come
 * back marked stale. An earlier version of this function shipped that check.
 *
 * The deeper problem is that mtimes cannot prove provenance at all. They record
 * when a file was written, not what it was written *from* — a `touch`, a copy,
 * or a checkout reorders them, and two files written in the same second are
 * indistinguishable. `tweets.json` is the one artefact that can answer the
 * question, because it stores `sourceHash`, a fingerprint of the blocks it was
 * written from (src/tweets.ts). Until `tree.json` and `arc.json` record the
 * same thing, the honest answer is silence: a confident wrong verdict on this
 * page is worse than no verdict, because this is the page you open when you
 * have stopped trusting the others.
 *
 * File sizes and per-file timestamps went with it. They are operational
 * diagnostics — `ls -l` answers them, and a reader does not need to know that
 * `raw.html` is 412 KB.
 */
export async function articleMetadata(slug: string): Promise<ArticleMetadata> {
  // This one enumerates files for a living, which raises the stakes over a read
  // that merely fails to find something.
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(
      new Error(
        `No article artefacts for "${slug}". Looked in:\n  ${candidateDirs(slug).join("\n  ")}\n` +
          `Each needs blocks.json + tree.json.`,
      ),
      { status: 404 },
    );
  }

  // `outputs()` reads nothing but `dir` and `htmlFile`; the rest is here because
  // the type asks for it. Nothing is run, so the abort signal never fires and
  // there is no progress to report.
  const ctx: StepContext = {
    slug,
    dir,
    htmlFile: contextPaths(slug).htmlFile,
    report: () => undefined,
    signal: new AbortController().signal,
  };

  const stages: StageState[] = await Promise.all(
    STEP_ORDER.map(async (step) => ({
      step,
      label: STEPS[step].label,
      outputs: STEPS[step].outputs(ctx).map((file) => path.relative(ROOT, file)),
      done: await stepIsDone(STEPS[step], ctx),
    })),
  );

  // `loadComments` for the same reason `describeArticle`'s caller uses it: the
  // file is `{ comments: [...] }` rather than a bare array, and reader state
  // lives under `data/<slug>/` even for the fixture, whose article artefacts do
  // not. Reading it here is what lets the page say "7 questions asked" without
  // the client fetching the comments themselves.
  const comments = (await loadComments(slug)).length;

  return { slug, dir: path.relative(ROOT, dir), stages, comments };
}

/* ------------------------------------------------------------ the library --
   Everything below serves the homepage: docs/project/library.md. */

/** The fixture's slug, which is its directory name and NOT the slug in its own
    meta.json — that one names the real article it is an excerpt of, and listing
    it under that would collide with the full piece in data/. `loadArticle`
    resolves "example" by falling through, so the slug that lists is the slug
    that opens. */
const FIXTURE_SLUG = "example";

/**
 * One shelf-ready record, derived from artefacts already in memory.
 *
 * Pure, so it can be tested without a filesystem, and so the derivation stays in
 * one place when the reads move to SQL.
 *
 * The blurb is the tree root's `gist` — the whole piece in one sentence, which
 * is exactly what a card wants and is already generated. Note what is *not* a
 * fallback for it: the first arc entry. An arc sentence says where the argument
 * stands at the end of part one, so using it here would put a sentence about the
 * opening where the reader expects a sentence about the article, and it would
 * look right. `summary` then Readability's `excerpt` instead, both of which at
 * least mean the whole thing.
 */
export function describeArticle(input: {
  slug: string;
  meta: Meta;
  blocks: Block[];
  tree: Tree;
  comments: number;
  addedAt: string;
  fixture?: boolean;
}): LibraryEntry {
  const { slug, meta, blocks, tree } = input;
  const words = blocks.reduce((n, b) => n + b.words, 0);

  // One pass rather than two filters: the tree of a long article is thousands
  // of nodes, and this runs once per article per homepage load.
  let parts = 0;
  let sections = 0;
  for (const node of Object.values(tree.nodes)) {
    if (node.depth === 1) parts++;
    else if (node.depth === 2) sections++;
  }

  const gist = tree.nodes[tree.rootId]?.gist ?? tree.nodes[tree.rootId]?.summary ?? meta.excerpt;

  // Conditional spreads, not `byline: meta.byline` — exactOptionalPropertyTypes
  // is on, so an explicitly-undefined property is not the same as an absent one.
  // See docs/project/typechecking.md.
  return {
    slug,
    title: meta.title,
    ...(meta.byline ? { byline: meta.byline } : {}),
    ...(meta.siteName ? { siteName: meta.siteName } : {}),
    ...(meta.url ? { url: meta.url } : {}),
    addedAt: input.addedAt,
    words,
    minutes: readingMinutes(words),
    blocks: blocks.length,
    parts,
    sections,
    comments: input.comments,
    ...(gist ? { gist } : {}),
    ...(input.fixture ? { fixture: true as const } : {}),
  };
}

/**
 * Read one directory into an entry, or null if it isn't a complete article.
 *
 * Skipped directories are pushed onto `skipped` rather than logged here. One
 * line per skip would be one line per *directory* per homepage load, and this
 * runs over the whole shelf — so the cost of the log grows with the library
 * while the information in it doesn't. The caller says it once instead.
 */
async function describeDir(
  dir: string,
  slug: string,
  fixture: boolean,
  skipped: string[],
): Promise<LibraryEntry | null> {
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  // A half-built directory — extracted but not yet given a tree — is skipped
  // rather than listed as an article that fails to open.
  //
  // Silent by design, and that is the problem: an ingest that died after stage 3
  // leaves a directory the shelf simply never mentions, so the article looks
  // like it was never added.
  if (!blocksFile || !tree) {
    skipped.push(slug);
    return null;
  }

  const meta = await readJson<Meta>(path.join(dir, "meta.json"));

  // `loadComments`, not a read of `dir/comments.json`. Two reasons, and the
  // first one bit: the file is `{ comments: [...] }` and not a bare array, so
  // parsing it here counted every article as having none and looked perfectly
  // plausible while doing it (docs/reusable/silent-success.md). The second is
  // that comments are READER state and always live under `data/<slug>/`, even
  // for the fixture, whose article artefacts do not. One owner, one shape.

  // Same fallback chain as loadArticle: the slug is the last resort, never the
  // first, because "noema-mythology-of-conscious-ai" is not a title.
  const title =
    meta?.title ??
    blocksFile.blocks.find((b) => b.kind === "heading" && b.level === 1)?.text ??
    slug;

  // `fetchedAt` is the honest answer and stage 2 now records one (src/extract.ts).
  // Before it did, the best available is when the blocks were last written —
  // close enough to order a shelf by, and it degrades rather than disappearing.
  const addedAt =
    meta?.fetchedAt ?? (await stat(path.join(dir, "blocks.json"))).mtime.toISOString();

  return describeArticle({
    slug,
    meta: { ...(meta ?? { slug }), title, slug },
    blocks: blocksFile.blocks,
    tree,
    comments: (await loadComments(slug)).length,
    addedAt,
    fixture,
  });
}

/**
 * Every article on the shelf, newest first.
 *
 * A directory walk per request. That is fine at ten articles and obviously not
 * fine at ten thousand, which is the point at which this function becomes one
 * `SELECT` and nothing else changes — see the file header.
 *
 * The committed `example/` fixture is always listed, and flagged, so a fresh
 * clone with no `data/` still has something to open rather than an empty shelf
 * that looks like a bug.
 */
export async function listArticles(): Promise<LibraryEntry[]> {
  let dirs: string[] = [];
  try {
    const entries = await readdir(path.join(ROOT, "data"), { withFileTypes: true });
    // `_`-prefixed directories are not articles — `data/_jobs/` is the ingest
    // queue's records (src/jobs.ts). Skipped by name rather than left to fail
    // the blocks.json check below, because "it happens not to look like an
    // article" is the kind of accident that stops being true quietly.
    dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name);
  } catch (err) {
    // No data/ at all is the fresh-clone case, not a failure.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Collected across the whole walk and said once below, not once per directory.
  const skipped: string[] = [];
  const found = await Promise.all([
    ...dirs.map((slug) => describeDir(path.join(ROOT, "data", slug), slug, false, skipped)),
    describeDir(path.join(ROOT, "example"), FIXTURE_SLUG, true, skipped),
  ]);

  // debug rather than warn: a run in progress hits this legitimately on every
  // homepage load until its toc lands, so at warn the shelf would cry wolf
  // through every ingest. It becomes interesting only when it doesn't go away.
  //
  // A count, and at most five names. The names are what make it actionable —
  // "three were skipped" sends you to read the whole of data/ — but all of them
  // would be a line that grows with the library, and a long line is the one
  // most likely to be truncated or dropped by whatever is collecting it.
  if (skipped.length > 0) {
    log("store").debug(
      { count: skipped.length, slugs: skipped.slice(0, 5), of: dirs.length + 1 },
      `${skipped.length} directories skipped: not complete articles`,
    );
  }

  return found
    .filter((e): e is LibraryEntry => e !== null)
    // Real articles above the fixture, then newest first. Sorting ISO strings
    // works because they are ISO — no Date objects needed.
    .sort((a, b) => {
      if (!!a.fixture !== !!b.fixture) return a.fixture ? 1 : -1;
      return a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0;
    });
}
