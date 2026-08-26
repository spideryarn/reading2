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
import { loadShelf } from "./shelf.js";
import { loadReaderProfile } from "./profile.js";
import { loadLookups } from "./glossary-lookups.js";
import { isStale as glossaryIsStale, PROMPT_VERSION, readGlossary } from "./glossary.js";
import {
  isStale as ideasAreStale,
  PROMPT_VERSION as IDEAS_PROMPT_VERSION,
  readIdeas,
} from "./ideas.js";
import { isStale as summariesStale, readSummaries } from "./summarise.js";
import { isSlug } from "./ingest.js";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import { contextPaths, STEP_ORDER, STEPS, stepIsDone, type StepContext } from "./pipeline.js";
import { createFsArtifactStore } from "./store/artifacts-fs.js";
import { readingMinutes } from "./reading-time.js";
import { sanitizeStoredBlocks } from "./sanitize.js";
import { isStale } from "./tweets.js";
import type {
  Arc,
  Article,
  ArticleMetadata,
  Block,
  GlossaryFound,
  IdeasFound,
  SummariesFound,
  LibraryEntry,
  ListOptions,
  Meta,
  ShelfState,
  StageState,
  ThreadFound,
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
 *
 * `parseJsonFrom` rather than `JSON.parse`, because V8's own parse error quotes
 * the malformed input back — and the input here is the article. See
 * src/parse-json.ts. `ENOENT` still arrives from `readFile` with its `code`
 * intact, so the "absent means null" contract above is unchanged.
 *
 * ## `unreadable`, and why the caller decides
 *
 * Pass an array and the file's name is pushed onto it **instead of** being
 * logged here; the throw is unchanged either way. That is not a switch for
 * turning the warning off — every caller that passes one is required to report
 * what it collected — it is a switch for *who says it*.
 *
 * It exists because one line per unreadable file is exactly right for the seven
 * callers below that read one article (four files at worst, and the line names
 * the file that broke the request), and exactly wrong for `listArticles`, which
 * calls this three times per directory inside a `Promise.all`. A shelf of 300
 * corrupt articles emitted 300 warnings on a single homepage load — past
 * Vercel's 256-line-per-request ceiling, so the *tail of that request's logs was
 * dropped*, including whatever else it wanted to say. Measured, not estimated;
 * docs/project/logging.md § Vercel has the rule, and
 * tests/library-log-volume.test.ts is the guard.
 *
 * A helper that logs is convenient until it is called in a loop, and the loop is
 * always somewhere else.
 */
async function readJson<T>(file: string, unreadable?: string[]): Promise<T | null> {
  const relative = path.relative(ROOT, file);
  try {
    return parseJsonFrom<T>(await readFile(file, "utf8"), relative);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (unreadable) unreadable.push(relative);
    else {
      log("store").warn(
        { file: relative, ...errorFields(err) },
        "artefact exists but could not be read or parsed",
      );
    }
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
    const blocksFile = await readJson<{ blocks: Block[]; sanitizer?: number }>(
      path.join(dir, "blocks.json"),
    );
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
    const extracted =
      stored ??
      ({
        slug,
        title:
          blocksFile.blocks.find((b) => b.kind === "heading" && b.level === 1)?.text ??
          slug,
      } satisfies Meta);

    /* The reader's own title wins here too, not only on the shelf.
       `describeArticle` already applied it to the card, and for a while that
       was ALL it applied to — so renaming an article on the shelf left the
       reading view's masthead still calling it whatever the site called it,
       while docs/project/library.md promised the two agreed. Caught by a
       cross-family review, 2026-08-26. src/shelf.ts, and `titleFor` below,
       which is the one place the precedence is written down. */
    const meta = titleFor(extracted, await loadShelf(slug));

    // Optional, and stays optional: the arc (stage 5b, src/arc.ts) is a
    // second model pass, so an article can be perfectly readable without one.
    // Absent means the L0 column falls back to the root gist.
    const arc = await readJson<Arc>(path.join(dir, "arc.json"));

    /* The one read of blocks.json that hands `html` to a renderer, and so the
       one that has to answer for an artefact written before the sanitiser it
       is being trusted against. `sanitizeStoredBlocks` compares the stamp and
       cleans only when it disagrees — measured at 33ms and ~130MB of jsdom
       retention per article to do it unconditionally, which is a real cost on
       every page load forever to cover a case that is rare and bounded. The
       other four reads here (loadTweets, loadGlossary, loadSummaries,
       describeDir) take `text`, not `html`. A glossary lookup used to be a
       fifth; since 2026-08-26 it asks for the article through this function
       instead (src/term-lookup.ts), so it is covered by this line rather than
       standing beside it.

       The warn is the point as much as the cleaning is: a stale artefact is
       still stale after we have served it safely, and stage 3 is what actually
       fixes it. See docs/project/security.md. */
    const { blocks, stale } = sanitizeStoredBlocks(blocksFile.blocks, blocksFile.sanitizer);
    if (stale) {
      log("store").warn(
        { slug, dir: path.relative(ROOT, dir) },
        "article artefact predates the current sanitiser — re-run stage 3",
      );
    }

    return { meta, blocks, tree, ...(arc ? { arc } : {}) };
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
export async function loadTweets(slug: string): Promise<ThreadFound> {
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
export async function loadGlossary(slug: string): Promise<GlossaryFound> {
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
  /* Attached here, at the read seam, rather than stored on the entry. Lookups
     live in their own file for the three reasons src/glossary-lookups.ts sets
     out — the short one being that `glossary.json` has a writer holding a stale
     read across a ninety-second model call, so a second writer cannot be made
     safe by any lock. The panel sees `entry.lookup` either way. */
  const lookups = await loadLookups(slug);
  const entries = glossary.entries.map((entry) =>
    lookups[entry.id] ? { ...entry, lookup: lookups[entry.id]! } : entry,
  );

  return {
    glossary: { ...glossary, entries },
    stale: !blocksFile || glossaryIsStale(glossary, blocksFile.blocks),
    /* Two different facts, computed side by side, both at read time for the
       reason the header gives: a flag stored at generation time is right until
       the moment it matters. `stale` is about the article; this is about us. */
    outdated: glossary.version !== PROMPT_VERSION,
  };
}

/**
 * The article's ideas, and whether they still describe it.
 *
 * The read half of stage 5f, and the same shape as `loadGlossary` above for the
 * same reason: two functions answering the same question about different
 * artefacts must not be allowed to drift.
 *
 * **One difference, and it is the tree.** Staleness here is computed against
 * the blocks *and* `tree.json`, because that is what the stage was written
 * from — `inputFingerprint` in src/ideas.ts has the argument. A blocks-only
 * comparison would report a re-sectioned article as unchanged, and the ideas
 * would go on claiming to say what *this* argument rests on while the argument
 * had been cut into different pieces.
 */
export async function loadIdeas(slug: string): Promise<IdeasFound> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const ideas = await readIdeas(dir);
  if (!ideas) {
    throw Object.assign(
      new Error(
        `No ideas for "${slug}" yet. Find them with ` +
          `POST /api/jobs { "slug": "${slug}", "steps": ["ideas"] }.`,
      ),
      { status: 404 },
    );
  }
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  // Unknown counts as stale — the honest answer, and the safe way round to be
  // wrong: the cost is a banner offering a regeneration nobody needed.
  return {
    ideas,
    stale: !blocksFile || !tree || ideasAreStale(ideas, blocksFile.blocks, tree),
    outdated: ideas.version !== IDEAS_PROMPT_VERSION,
  };
}

/**
 * The article's own directory, or a refusal — the guard the reader-facing
 * glossary writes share.
 *
 * `articleDir` falls through to `example/` for any slug with no pipeline output
 * of its own, **including a slug that does not exist at all**, so without this
 * the one committed directory in the repo is one request away from an unknown
 * article. It has no `glossary.json` today, which is exactly the kind of "it
 * can't happen" that stops being true the first time somebody hand-authors one.
 *
 * Exported because `lookUpTerm` no longer lives in this file: it is
 * store-independent now (src/term-lookup.ts) and takes this as its
 * `assertWritable`. Postgres has no fixture to fall into and needs no
 * counterpart — an unknown slug there has no row and 404s. **A stated
 * difference with a test on each side**, rather than something to discover.
 *
 * @param verb what the caller is about to do, for the 403's wording. The
 *   sentence a reader sees says which act was refused, and the two acts are not
 *   the same thing to be told about.
 */
export async function assertOwnArticle(slug: string, verb: string): Promise<void> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  if (dir !== path.join(ROOT, "data", slug)) {
    throw Object.assign(
      new Error(`"${slug}" is the built-in example. Its glossary is not yours to ${verb}.`),
      { status: 403 },
    );
  }
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

/**
 * The article's summaries, and whether they still describe the article.
 *
 * The read half of stage 5e, and the third copy of a shape that is now settled:
 * `loadTweets`, `loadGlossary` and this one answer the same question about
 * different artefacts, and the day they stop agreeing is the day one of them is
 * wrong. So the same three rules hold here — `articleDir` rather than a
 * directory of its own, `stale` computed at read time rather than stored, and
 * 404 for "nobody has asked for these yet", which is the ordinary case and what
 * the panel's button is for.
 *
 * **There is no `deleteSummaries` beside this, and the absence is deliberate.**
 * `deleteGlossary` exists because asking for that step again *appends* to the
 * list, so "start over" had no other spelling. This step replaces its artefact
 * wholesale, so running it again already means start over; a delete would be a
 * second way to say the same thing, and the only thing it would add is a way to
 * lose the summaries without getting new ones.
 */
export async function loadSummaries(slug: string): Promise<SummariesFound> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const summaries = await readSummaries(dir);
  if (!summaries) {
    throw Object.assign(
      new Error(
        `No summaries for "${slug}" yet. Write them with ` +
          `POST /api/jobs { "slug": "${slug}", "steps": ["summary"] }.`,
      ),
      { status: 404 },
    );
  }
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  // `articleDir` already proved blocks.json is there, so the fallback is for a
  // file that has become unreadable between the two reads. Unknown counts as
  // stale: the honest answer, and the safe way round to be wrong.
  return { summaries, stale: !blocksFile || summariesStale(summaries, blocksFile.blocks) };
}

/* ----------------------------------------------------------- provenance --
   What the metadata page needs and the article payload does not carry: which
   of the pipeline's stages have actually run for this article.

   Kept behind this seam like everything else here, because a directory walk is
   exactly the sort of thing that has to be. See docs/plans/metadata-page.md. */

/**
 * Is this file there — **and only that question**.
 *
 * `ENOENT` is absence. Every other `stat` failure is a real problem and is
 * thrown: a permissions error or a failing disk used to answer "not there",
 * which is how the metadata page fell through to the `example/` fixture and
 * returned a confident 200 describing somebody else's article, and how the
 * library reported an article's optional stages unbuilt when they were sitting
 * right there. Same rule as `readOne` in src/store/artifacts-fs.ts; this was
 * the copy of it that the 2026-08-26 review found still swallowing everything.
 */
async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
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
    // Nothing is sent to a model here, so there is nothing to cache.
    cacheArticle: false,
  };

  /* A store pinned to the directory we actually found, not to `data/<slug>/`.
     `articleDir` falls back to `example/` for an article with no directory of
     its own, and the default store would then report every stage of the fixture
     unfinished — the page saying nothing has run over an article it is
     displaying. Same `ctx.dir`, so the two halves of each row agree. */
  const store = createFsArtifactStore(() => ({ dir: ctx.dir, htmlFile: ctx.htmlFile }));

  const stages: StageState[] = await Promise.all(
    STEP_ORDER.map(async (step) => ({
      step,
      label: STEPS[step].label,
      outputs: STEPS[step].outputs(ctx).map((file) => path.relative(ROOT, file)),
      done: await stepIsDone(STEPS[step], ctx, store),
    })),
  );

  // `loadComments` for the same reason `describeArticle`'s caller uses it: the
  // file is `{ comments: [...] }` rather than a bare array, and reader state
  // lives under `data/<slug>/` even for the fixture, whose article artefacts do
  // not. Reading it here is what lets the page say "7 questions asked" without
  // the client fetching the comments themselves.
  const comments = (await loadComments(slug)).length;

  /* `profile` and `purpose` for the same reason as `comments` above: this
     endpoint already walks the article's directory, so both are one more read
     rather than a second endpoint. `profile` is global (`data/reader.json`)
     and `purpose` is this article's own (`shelf.json`) — see
     docs/plans/reader-profile.md. Both default to `null` via
     `normaliseProfileText`, which is what `loadReaderProfile` already
     returns and what an absent `shelf.purpose` collapses to here. */
  const [profile, shelf] = await Promise.all([loadReaderProfile(), loadShelf(slug)]);

  return {
    slug,
    dir: path.relative(ROOT, dir),
    stages,
    comments,
    profile,
    purpose: shelf.purpose ?? null,
  };
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
  /**
   * What the reader has done to the card — src/shelf.ts.
   *
   * Passed in rather than read here, because this function is shared by both
   * stores and each one fetches it its own way (a file, or four columns). It is
   * optional so that a caller who has not got round to it still gets an entry
   * rather than a type error, and the default is "never touched".
   */
  shelf?: ShelfState;
  /** Which optional stages have produced something. Absent means none of them. */
  has?: Partial<LibraryEntry["has"]>;
}): LibraryEntry {
  const { slug, meta, blocks, tree } = input;
  const shelf = input.shelf ?? { opens: 0 };
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
    // Through `titleFor`, which is also what `loadArticle` uses — so the card
    // and the masthead cannot end up calling one article two things.
    title: titleFor(meta, shelf).title,
    ...(shelf.title ? { titleOverridden: true as const } : {}),
    opens: shelf.opens,
    ...(shelf.lastOpenedAt ? { lastOpenedAt: shelf.lastOpenedAt } : {}),
    ...(shelf.archivedAt ? { archivedAt: shelf.archivedAt } : {}),
    has: {
      arc: input.has?.arc ?? false,
      tweets: input.has?.tweets ?? false,
      glossary: input.has?.glossary ?? false,
      summary: input.has?.summary ?? false,
    },
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
 * The title the reader should see, and the one place that precedence lives.
 *
 * Reader's override first, extractor's second. Called by `loadArticle` for the
 * masthead and by `describeArticle` for the card, so the two cannot disagree —
 * which they did, for exactly as long as only one of them knew about overrides.
 */
export function titleFor(meta: Meta, shelf: ShelfState | undefined): Meta {
  return shelf?.title ? { ...meta, title: shelf.title } : meta;
}

/** One directory's verdict: an article for the shelf, or the reason it isn't. */
type DirVerdict = { entry: LibraryEntry } | { skipped: string };

/**
 * Read one directory into an entry, or say why it isn't a complete article.
 *
 * Nothing here logs. One line per skip would be one line per *directory* per
 * homepage load, and this runs over the whole shelf — so the cost of the log
 * grows with the library while the information in it doesn't. The caller says
 * it once instead.
 *
 * The verdict is **returned** rather than pushed onto an array the caller
 * passes in, and that is the difference between a deterministic line and a line
 * that changes on every load. These run concurrently, so a shared array ends up
 * in completion order — and the caller reports only the first five names, which
 * meant the same broken shelf accused different directories each time. A name
 * you cannot search for twice is barely a name. Returned verdicts come back in
 * *input* order from `Promise.allSettled`, so the five are always the same five.
 *
 * `unreadable` is the one thing still collected out-of-band, because a corrupt
 * artefact leaves through a `throw` and a throw has no return value to carry it.
 * See `readJson`.
 */
async function describeDir(
  dir: string,
  slug: string,
  fixture: boolean,
  unreadable: string[],
): Promise<DirVerdict> {
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"), unreadable);
  const tree = await readJson<Tree>(path.join(dir, "tree.json"), unreadable);
  // A half-built directory — extracted but not yet given a tree — is skipped
  // rather than listed as an article that fails to open.
  //
  // Silent by design, and that is the problem: an ingest that died after stage 3
  // leaves a directory the shelf simply never mentions, so the article looks
  // like it was never added.
  if (!blocksFile || !tree) {
    return { skipped: slug };
  }

  const meta = await readJson<Meta>(path.join(dir, "meta.json"), unreadable);

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

  /* `fetchedAt` is the honest answer and stage 2 now records one
     (src/extract.ts). Before it did, the best available is when the blocks were
     last written — close enough to order a shelf by, and it degrades rather
     than disappearing.

     The `stat` is guarded because a directory can go away **between the readdir
     above and this line**: an ingest that failed and cleaned up, another agent,
     a test fixture being removed. Unguarded, that ENOENT leaves through
     `Promise.allSettled` and is rethrown by `listArticles`, so one directory
     disappearing at the wrong moment takes down the whole shelf with a 500 —
     for an article that no longer exists. Treated as "not an article", which
     is what it now is. */
  let addedAt = meta?.fetchedAt;
  if (!addedAt) {
    try {
      addedAt = (await stat(path.join(dir, "blocks.json"))).mtime.toISOString();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return { skipped: slug };
    }
  }

  /* Existence, not contents. Four `stat`s beside the three reads this function
     already does, and deliberately not four more `readJson`s: the tooltip asks
     "has a glossary been built", not "how many terms are in it", and parsing
     four artefacts per card per homepage load to answer a question nobody asked
     is how a shelf gets slow without anyone deciding it should.

     `Promise.all`, because they are independent and this already runs once per
     article; and `exists` rather than a try/catch each, so a missing file reads
     as `false` rather than as an error to be swallowed. */
  const [arc, tweets, glossaryFile, summary] = await Promise.all(
    ["arc.json", "tweets.json", "glossary.json", "summary.json"].map((name) =>
      exists(path.join(dir, name)),
    ),
  );

  /* Reader state lives under `data/<slug>/` even for the fixture, whose article
     artefacts do not — the same rule `loadComments` follows two paragraphs up,
     and for the same reason: the fixture is committed and shared, what the
     reader has done to it is neither. So this is keyed by SLUG, not by `dir`. */
  const shelf = await loadShelf(slug);

  return {
    entry: describeArticle({
      slug,
      meta: { ...(meta ?? { slug }), title, slug },
      blocks: blocksFile.blocks,
      tree,
      comments: (await loadComments(slug)).length,
      addedAt,
      fixture,
      shelf,
      has: {
        arc: arc ?? false,
        tweets: tweets ?? false,
        glossary: glossaryFile ?? false,
        summary: summary ?? false,
      },
    }),
  };
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
export async function listArticles(opts: ListOptions = {}): Promise<LibraryEntry[]> {
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

  /* Collected across the whole walk and said once below, not once per
     directory. Both of these are the same rule from docs/project/logging.md §
     Vercel: if the number of lines a piece of code emits grows with the data,
     the caller says it once instead. The loop that finds the problem is not the
     right place to report it.

     `allSettled`, not `all`, and that is the whole reason the second line below
     can exist. Every one of these can throw — a corrupt artefact leaves through
     `readJson` — and `Promise.all` rejects on the first one while the other 299
     are still running and still logging. So the aggregate line was unreachable
     on exactly the path that needed it most: the old code emitted 300 warnings
     and never got as far as summarising anything. */
  const unreadable: string[] = [];
  const settled = await Promise.allSettled([
    ...dirs.map((slug) => describeDir(path.join(ROOT, "data", slug), slug, false, unreadable)),
    describeDir(path.join(ROOT, "example"), FIXTURE_SLUG, true, unreadable),
  ]);

  /* warn, and one line however broken the shelf is. A corrupt artefact is a
     real problem and naming it is the only thing that makes it findable, so
     this is aggregated rather than dropped.

     Sorted before it is cut to five, because these names are collected as the
     concurrent reads fail rather than in the order they were started — so
     without this the same broken shelf accuses different directories on
     different loads, and a name that moves is one you cannot search for twice.
     The verdicts below get their order for free from `allSettled`; this one
     cannot, because it arrives through a throw. */
  if (unreadable.length > 0) {
    const names = [...unreadable].sort();
    log("store").warn(
      { count: names.length, files: names.slice(0, 5), of: dirs.length + 1 },
      `${names.length} artefacts could not be read or parsed`,
    );
  }

  const found: LibraryEntry[] = [];
  const skipped: string[] = [];
  for (const result of settled) {
    // Rejections are already accounted for in `unreadable` above. Nothing is
    // swallowed: the first one is rethrown below, once the log has been written.
    if (result.status !== "fulfilled") continue;
    if ("entry" in result.value) found.push(result.value.entry);
    else skipped.push(result.value.skipped);
  }

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

  /* Behaviour preserved exactly: a corrupt artefact still fails the whole
     request, as it did under `Promise.all`. Only the logging changed. Whether
     one bad file *should* blank the shelf rather than dropping one card is a
     real question and a separate decision — see docs/project/library.md. */
  const failed = settled.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;

  return (
    found
      /* Archived articles are filtered here rather than skipped in
         `describeDir`, so that `{ archived: true }` gets the same entries by
         the same route and there is no second walk that could disagree with
         this one about what an article is. */
      .filter((e) => !!e.archivedAt === !!opts.archived)
      // Real articles above the fixture, then newest first. Sorting ISO strings
      // works because they are ISO — no Date objects needed.
      .sort((a, b) => {
        if (!!a.fixture !== !!b.fixture) return a.fixture ? 1 : -1;
        return a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0;
      })
  );
}
