/**
 * Stage 6 (server side) — the article store.
 *
 * Two reads: one article in full (`loadArticle`), and the shelf of them the
 * homepage lists (`listArticles`). Deliberately transport-free — these are plain
 * async functions, mounted at `GET /api/article/:slug` and `GET /api/library` by
 * src/routes.ts. When a standalone Node server arrives (architecture.md §
 * Server and client) it wraps these rather than reimplementing the reads.
 *
 * Lookup for one article: data/<slug>/ (the real pipeline output), and for the
 * fixture's own slug the hand-authored example/ placeholder. **Not a fallback
 * for anything else** — see `candidateDirs`, which is where that used to be a
 * fallback and where the reasoning for taking it away is written down.
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
import {
  isStale as arcIsStale,
  PROMPT_VERSION as ARC_PROMPT_VERSION,
} from "./arc.js";
import { loadLookups } from "./glossary-lookups.js";
import { isStale as glossaryIsStale, PROMPT_VERSION, readGlossary } from "./glossary.js";
import {
  isStale as ideasAreStale,
  PROMPT_VERSION as IDEAS_PROMPT_VERSION,
  readIdeas,
} from "./ideas.js";
import {
  isStale as quotesAreStale,
  PROMPT_VERSION as QUOTES_PROMPT_VERSION,
  readQuotes,
} from "./quotes.js";
import {
  isStale as timelineIsStale,
  PROMPT_VERSION as TIMELINE_PROMPT_VERSION,
  readTimeline,
} from "./timeline.js";
import {
  isStale as quizIsStale,
  PROMPT_VERSION as QUIZ_PROMPT_VERSION,
  readQuiz,
} from "./quiz.js";
import {
  isStale as sketchIsStale,
  PROMPT_VERSION as SKETCH_PROMPT_VERSION,
  readSketchFile,
} from "./sketch.js";
import {
  isStale as illustratedIsStale,
  PROMPT_VERSION as ILLUSTRATED_PROMPT_VERSION,
} from "./illustrated.js";
import type { Illustrated } from "./illustrated-plate.js";
import { readRaw } from "./fetch.js";
import { isSlug } from "./ingest.js";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import { contextPaths, STEP_ORDER, STEPS, stepIsDone, type StepContext } from "./pipeline.js";
import { createFsArtifactStore } from "./store/artifacts-fs.js";
import type { RawSource } from "./store/contracts.js";
import { deriveLibraryScalars, headingTitleOf, type LibraryScalars } from "./library-scalars.js";
import { readingMinutes } from "./reading-time.js";
import { sanitizeStoredBlocks } from "./sanitize.js";
import { isStale } from "./tweets.js";
import type { Assets } from "./assets.js";
import type {
  Arc,
  ArcFound,
  Article,
  ArticleMetadata,
  Block,
  GlossaryFound,
  IdeasFound,
  QuotesFound,
  IllustratedFound,
  SketchFound,
  QuizFound,
  TimelineFound,
  LibraryEntry,
  ListOptions,
  Meta,
  ShelfState,
  StageState,
  ThreadFound,
  Tree,
  TweetThread,
  Visibility,
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

/** The fixture's slug, which is its directory name and NOT the slug in its own
    meta.json — that one names the real article it is an excerpt of, and listing
    it under that would collide with the full piece in data/. `loadArticle`
    resolves "example" through `candidateDirs` below, so the slug that lists is
    the slug that opens. */
const FIXTURE_SLUG = "example";

/**
 * Directories to try, in order, for a given slug.
 *
 * **`path.join` is where a traversal lands**, so nothing may reach this
 * function unvalidated. `..` segments are normalised away by `join` rather than
 * rejected by it, so `../../..` walks straight out of the repo. Every exported
 * function below checks the slug before calling this; `slugPart` in
 * src/routes.ts checks it again at the door, which is where a bad one becomes a
 * 400 instead of a stack trace. See docs/project/security.md § The URL.
 *
 * **`example/` is a candidate for its own slug and for no other**, and that is
 * a fix rather than the original design. This used to append the fixture
 * unconditionally, so *any* slug with no `blocks.json` + `tree.json` of its own
 * was answered with the fixture's prose under the reader's name — an article
 * that does not exist, and an article whose blocks are written but whose tree
 * is not. The second is the one that stopped being hypothetical: the ToC is
 * moving off the critical path (docs/plans/260830am-faster-ingest-and-concurrency.md),
 * so "blocks yes, tree no" is a normal few seconds of every ingest, and a
 * reader opening their own article early would have read somebody else's.
 *
 * It was already load-bearing before that. Nothing about the fixture's response
 * distinguishes it from a correct refusal, which is exactly how a shallow
 * `../../etc` probe reported this API safe while a deeper one walked out of the
 * repo and got HTTP 200 (docs/project/security.md § Why it survived being
 * looked at). A 404 is the answer that can be told apart.
 *
 * The fixture itself stays: it is what a fresh clone with no `data/` opens, six
 * test files read it as static data, and docs/plans/260825f-postgres-migration.md keeps
 * it. Only its reach changes.
 */
function candidateDirs(slug: string): string[] {
  const own = path.join(ROOT, "data", slug);
  return slug === FIXTURE_SLUG ? [own, path.join(ROOT, "example")] : [own];
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

    /* **The standing alarm for the fallback that hid a path traversal, kept as
       an assertion now that the fallback is gone.**
       `candidateDirs` no longer offers `example/` to anything but the fixture's
       own slug, so this can only fire if that rule is loosened again — and the
       reason it is worth a line rather than a comment is that the symptom is
       invisible: the fixture's 200 and a correct refusal look identical from
       outside, which is how a shallow `../../etc` probe reported this API safe
       while a deeper one walked out of the repo (docs/project/security.md § Why
       it survived being looked at). The log is the only place the difference
       has ever been visible. */
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

    /* The image manifest, and **absent is a third state rather than an empty
       one**: no `assets.json` means the step has never run on this article —
       every article ingested before it existed — and the reading view must
       hot-link exactly as it always did. An `Assets` whose `entries` is empty
       means it ran and the article has no images. Collapsing those two is how a
       feature that has not shipped gets reported as one that failed
       (src/assets.ts). */
    const assets = (await readJson<Assets>(path.join(dir, "assets.json"))) ?? undefined;

    /* The one read of blocks.json that hands `html` to a renderer, and so the
       one that has to answer for an artefact written before the sanitiser it
       is being trusted against. `sanitizeStoredBlocks` compares the stamp and
       cleans only when it disagrees — measured at 33ms and ~130MB of jsdom
       retention per article to do it unconditionally, which is a real cost on
       every page load forever to cover a case that is rare and bounded. The
       other three reads here (loadTweets, loadGlossary, describeDir) take
       `text`, not `html`. A glossary lookup used to be a
       fourth; since 2026-08-26 it asks for the article through this function
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

    /* `assets` is named rather than spread conditionally, because the key is
       required on `Article` and the omission this guards against is silent —
       see the field's note in src/types.ts. `readJson` answers `null` for a
       file that is not there, and the reader's third state is `undefined`. */
    return { meta, blocks, tree, ...(arc ? { arc } : {}), assets };
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
 * nowhere — see docs/plans/260825g-tweet-thread-page.md.
 *
 * **`articleDir`, not a directory of its own.** The thread has to come from the
 * same place the article does, or `stale` is computed against somebody else's
 * `blocks.json` and means nothing. The fixture comes out right for free:
 * `example/` has no thread, so `example` answers 404 and the page offers to
 * write one.
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
  /* The tree and the metadata as well, since 2026-08-31: the thread's prompt is
     built from `partsOf(tree)` and carries the `TITLE:`/`BY:`/`PUBLISHED IN:`
     head, so all three are what it was written from — src/source-hash.ts §
     `articleFingerprint`. The metadata is optional by design, like the arc's. */
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  const meta = await readJson<Meta>(path.join(dir, "meta.json"));
  return {
    thread,
    stale: !blocksFile || !tree || isStale(thread, blocksFile.blocks, tree, meta ?? null),
  };
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

  /* Blocks, tree and metadata head — all three go into this stage's prompt, so
     all three are in its fingerprint. src/source-hash.ts § `articleFingerprint`. */
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  const meta = await readJson<Meta>(path.join(dir, "meta.json"));

  return {
    glossary: { ...glossary, entries },
    stale:
      !blocksFile || !tree || glossaryIsStale(glossary, blocksFile.blocks, tree, meta ?? null),
    /* Two different facts, computed side by side, both at read time for the
       reason the header gives: a flag stored at generation time is right until
       the moment it matters. `stale` is about the article; this is about us. */
    outdated: glossary.version !== PROMPT_VERSION,
  };
}

/**
 * The article's quotes, and whether they still describe it.
 *
 * The read half of stage 5h, and the same shape as `loadGlossary` above for the
 * same reason: two functions answering the same question about different
 * artefacts must not be allowed to drift.
 *
 * **`stale` carries more weight here than for any of its neighbours.** A stale
 * glossary entry is a definition that still reads correctly; a stale quote list
 * holds block ids that may have gone *and* strings that were verified against a
 * version of the article that no longer exists. It is the one artefact in the
 * band whose staleness can make it false rather than merely dated, which is why
 * the panel puts the banner above the list rather than beside it.
 */
export async function loadQuotes(slug: string): Promise<QuotesFound> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const quotes = await readQuotes(dir);
  if (!quotes) {
    throw Object.assign(
      new Error(
        `No quotes for "${slug}" yet. Choose them with ` +
          `POST /api/jobs { "slug": "${slug}", "steps": ["quotes"] }.`,
      ),
      { status: 404 },
    );
  }
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  /* The metadata as well as the blocks and the tree: `articleText` puts the
     title, the byline and the site at the head of this prompt, and those are
     stage 2's fields — a re-extraction moves them. (Not the reader's own
     rename, which an earlier version of this comment cited: that is a shelf
     override no generator reads. src/shelf.ts.) Optional by design — the stage
     tolerates a missing `meta.json`. */
  const quotesMeta = await readJson<Meta>(path.join(dir, "meta.json"));
  // Unknown counts as stale — the honest answer, and the safe way round to be
  // wrong: the cost is a banner offering a regeneration nobody needed.
  return {
    quotes,
    stale:
      !blocksFile || !tree || quotesAreStale(quotes, blocksFile.blocks, tree, quotesMeta ?? null),
    outdated: quotes.version !== QUOTES_PROMPT_VERSION,
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
  /* The metadata too, since 2026-08-31 — `articleWithIds` puts the title, the
     byline and the site at the head of this prompt, and the reading view
     are stage 2's fields, so a re-extraction moves them. Optional by design:
     the stage tolerates a missing `meta.json`, and for these two the
     fingerprint hashes the synthetic `TITLE: <tree.slug>` they fall back to
     rather than treating it as no input at all. */
  const ideasMeta = await readJson<Meta>(path.join(dir, "meta.json"));
  // Unknown counts as stale — the honest answer, and the safe way round to be
  // wrong: the cost is a banner offering a regeneration nobody needed.
  return {
    ideas,
    stale:
      !blocksFile || !tree || ideasAreStale(ideas, blocksFile.blocks, tree, ideasMeta ?? null),
    outdated: ideas.version !== IDEAS_PROMPT_VERSION,
  };
}

/**
 * **The raw document this article was made from — the filesystem half.**
 *
 * `null` is *this article kept no source*, which is every HTML article fetched
 * before manifests and every article whose `raw.json` names a file that is not
 * there. A 404 for the reader, and an ordinary state.
 *
 * **It reads the filesystem and nothing else**, which is the whole point of it
 * being the filesystem adapter: `sendSource` in src/routes.ts used to do this
 * unconditionally, so a Postgres deployment on Vercel — which has no such disk —
 * answered every *view the original* with a 404 while a laptop worked
 * perfectly. The Postgres half is `pgArticleReader.loadSource`, and neither
 * falls back to the other (src/store/fs.ts § this is not where a fallback
 * lives).
 *
 * The kind comes off the manifest, which stage 1 wrote and which is the only
 * recorded answer there is here.
 *
 * **The route does not call this any more**, and that is a merge rather than a
 * mistake. `GET /api/source/:slug` goes through `SourceStore.readPdf`
 * (docs/plans/260831b-finish-the-database-move.md, stage 1b), which is narrower
 * on purpose: it hands back the one kind a route may set a content type for.
 * This stays because it is the whole-document read — both kinds, with the
 * manifest's own answer for which — and `db:export` and the Postgres half are
 * built on the same question.
 */
export async function loadSource(slug: string): Promise<RawSource | null> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const manifest = await readRaw(dir);
  if (!manifest) return null;
  /* `ENOENT` is the article that has a manifest and no file beside it — a
     half-written directory, or one restored without its payload. Absent, not a
     fault: there is nothing here to serve and nothing to repair on the server.
     Anything else is a real filesystem failure and is allowed to throw. */
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path.join(dir, manifest.file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return {
    bytes,
    kind: manifest.kind,
    filename: manifest.origin === "upload" ? (manifest.filename ?? null) : null,
  };
}

/**
 * The article's timeline, and whether it still describes it — the filesystem
 * half. docs/project/timeline.md.
 *
 * Shaped on `loadIdeas` above, and it differs in exactly two places.
 *
 * **The publication date is in the staleness comparison**, which is true of no
 * other artefact here. `inputFingerprint` in src/timeline.ts is
 * `datedArticleFingerprint`, because the date is the reference frame every
 * year-less date in the artefact was read against: a publisher re-dating a post
 * changes almost every row of this and not one word of anything else.
 *
 * **And an empty `events` list is not a 404.** Most articles are not
 * chronological, so a timeline with nothing in it is the expected answer for
 * them and the panel has a sentence for it; sending the reader to a POST would
 * pay for the same empty answer on every open.
 */
export async function loadTimeline(slug: string): Promise<TimelineFound> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const timeline = await readTimeline(dir);
  if (!timeline) {
    throw Object.assign(
      new Error(
        `No timeline for "${slug}" yet. Build one with ` +
          `POST /api/jobs { "slug": "${slug}", "steps": ["timeline"] }.`,
      ),
      { status: 404 },
    );
  }
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  /* **Optional, and the absent case is the common one** — `publishedAt` only
     arrives on re-extraction, so most of the shelf has no date and every
     year-less expression in those articles stays undated. The fingerprint
     hashes "no metadata" as a legitimate input rather than as no input at all,
     which is what lets this comparison mean the same thing on both sides. */
  const timelineMeta = await readJson<Meta>(path.join(dir, "meta.json"));
  // Unknown counts as stale, the same way round as the ideas above.
  return {
    timeline,
    stale:
      !blocksFile ||
      !tree ||
      timelineIsStale(timeline, blocksFile.blocks, tree, timelineMeta ?? null),
    outdated: timeline.version !== TIMELINE_PROMPT_VERSION,
  };
}

/**
 * The article's questions, and whether they still describe it — the filesystem
 * half. docs/plans/260831al-review-quiz-sub-mode.md.
 *
 * Shaped exactly on `loadIdeas` above, including the "unknown counts as stale"
 * rule, and differing in two places.
 *
 * **A 404 is the ordinary case.** `quiz` is off `DEFAULT_INGEST_STEPS`, so most
 * articles have never had questions written, and the panel's job on a 404 is to
 * offer the button rather than to report a failure.
 *
 * **And no third staleness fact.** This stage was not written for a profile, so
 * `QuizResponse` has two fields where `IdeasResponse` has three and the route
 * sends no `withProfileChanged`.
 */
export async function loadQuiz(slug: string): Promise<QuizFound> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const quiz = await readQuiz(dir);
  if (!quiz) {
    throw Object.assign(
      new Error(
        `No quiz for "${slug}" yet. Build one with ` +
          `POST /api/jobs { "slug": "${slug}", "steps": ["quiz"] }.`,
      ),
      { status: 404 },
    );
  }
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  /* The **cited** head — this stage sends `articleWithIds`, which prints a
     `URL:` line the four `articleText` stages never send. Absent metadata is a
     legitimate input rather than no input at all, which is what lets this
     comparison mean the same thing on both sides. */
  const quizMeta = await readJson<Meta>(path.join(dir, "meta.json"));
  // Unknown counts as stale, the same way round as the ideas above.
  return {
    quiz,
    stale: !blocksFile || !tree || quizIsStale(quiz, blocksFile.blocks, tree, quizMeta ?? null),
    outdated: quiz.version !== QUIZ_PROMPT_VERSION,
  };
}

/**
 * The Sketch picture, plus whether the article has moved underneath it — the
 * filesystem half. docs/project/diagram.md § Sketch.
 *
 * Shaped exactly on `loadIdeas` above, including the "unknown counts as stale"
 * rule, and differing in one place: a **404 here is the ordinary case**. Sketch
 * is off `DEFAULT_INGEST_STEPS`, so most articles have never had one drawn, and
 * the panel's job on a 404 is to offer the button rather than to report a
 * failure.
 */
export async function loadSketch(slug: string): Promise<SketchFound> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const sketch = await readSketchFile(dir);
  if (!sketch) {
    throw Object.assign(
      new Error(
        `No sketch for "${slug}" yet. Draw one with ` +
          `POST /api/jobs { "slug": "${slug}", "steps": ["sketch"] }.`,
      ),
      { status: 404 },
    );
  }
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  /* And the metadata, for the reason `loadIdeas` gives: the same prompt
     builder, the same head, the same rename. */
  const sketchMeta = await readJson<Meta>(path.join(dir, "meta.json"));
  return {
    sketch,
    stale:
      !blocksFile || !tree || sketchIsStale(sketch, blocksFile.blocks, tree, sketchMeta ?? null),
    outdated: sketch.version !== SKETCH_PROMPT_VERSION,
  };
}

/**
 * The Illustrated plates on their own — the filesystem half of
 * `loadIllustrated`. docs/project/diagram.md § Illustrated.
 *
 * Shaped on `loadSketch` directly above, and differing in the one way that
 * matters: **it reads `sketch.json` rather than the blocks and the tree**,
 * because what this artefact was painted from is the scene. src/illustrated.ts
 * § `inputFingerprint`.
 *
 * `stale` is true in two cases and they are not the same fact, but the panel
 * has one sentence for both: the Sketch on disk is not the one this was painted
 * from, **or** that Sketch has itself gone stale against the article. The
 * second is what stops a picture two hops from the article reporting itself
 * current because nobody has pressed the Sketch button.
 *
 * A **404 is the ordinary case**, exactly as for Sketch: this step is off
 * `DEFAULT_INGEST_STEPS` and most articles have never had a plate painted.
 */
export async function loadIllustrated(slug: string): Promise<IllustratedFound> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const illustrated = await readJson<Illustrated>(path.join(dir, "illustrated.json"));
  /* **An empty plate list counts as none**, the same rule `SHAPE` keeps at the
     store boundary and `readSketchFile` keeps for the scene: a file can arrive
     from an import or a hand edit with nothing in it, and a panel handed that
     would draw an empty band and report success. */
  if (!illustrated || !Array.isArray(illustrated.plates) || illustrated.plates.length === 0) {
    throw Object.assign(
      new Error(
        `No illustration for "${slug}" yet. Paint one with ` +
          `POST /api/jobs { "slug": "${slug}", "steps": ["illustrated"] }.`,
      ),
      { status: 404 },
    );
  }
  const sketch = await readSketchFile(dir);
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  const sketchMeta = await readJson<Meta>(path.join(dir, "meta.json"));
  /* No Sketch at all is stale rather than an error: there is still a picture to
     look at, and "we cannot tell" has to answer not-current here as it does
     everywhere else in this file. */
  const stale =
    !sketch ||
    illustratedIsStale(illustrated, sketch) ||
    !blocksFile ||
    !tree ||
    sketchIsStale(sketch, blocksFile.blocks, tree, sketchMeta ?? null);
  return {
    illustrated,
    stale,
    outdated: illustrated.version !== ILLUSTRATED_PROMPT_VERSION,
  };
}

/**
 * The arc on its own — the filesystem half of `loadArc`.
 *
 * **Why a read of its own, when the arc already travels in the article
 * payload:** since 2026-08-29 the arc is not built by every ingest, so a reader
 * can open an article that has none, ask for one, and need to collect it when
 * the job finishes. Refetching `/api/article/:slug` for that would re-read every
 * block and the whole tree to pick up one small object — the cost
 * docs/plans/260827am-glossary-read-latency.md exists to describe. Modelled on
 * `loadIdeas` directly above; the differences are noted where they occur.
 */
export async function loadArc(slug: string): Promise<ArcFound> {
  requireSlug(slug);

  const dir = await articleDir(slug);
  if (!dir) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  const arc = await readJson<Arc>(path.join(dir, "arc.json"));
  if (!arc) {
    throw Object.assign(
      new Error(
        `No arc for "${slug}" yet. Write one with ` +
          `POST /api/jobs { "slug": "${slug}", "steps": ["arc"] }.`,
      ),
      { status: 404 },
    );
  }
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  /* The metadata too, and unlike the three artefacts above this one is
     *optional by design* — `generateArc` tolerates a missing meta.json, so its
     fingerprint hashes "no meta" as a legitimate input rather than as a failure.
     `??` rather than a guard for exactly that reason. */
  const meta = await readJson<Meta>(path.join(dir, "meta.json"));
  // Unknown counts as stale, the same way round as the ideas: the cost of being
  // wrong is a wait nobody needed, not a column quietly missing its entries.
  return {
    arc,
    stale: !blocksFile || !tree || arcIsStale(arc, blocksFile.blocks, tree, meta ?? null),
    outdated: arc.version !== ARC_PROMPT_VERSION,
  };
}

/**
 * The article's own directory, or a refusal — the guard the reader-facing
 * glossary writes share.
 *
 * An unknown slug now 404s here rather than resolving to the fixture
 * (`candidateDirs`), so what is left for this to catch is the fixture's *own*
 * slug: `example/` opens for `example`, and it is nobody's to write to. It has
 * no `glossary.json` today, which is exactly the kind of "it can't happen" that
 * stops being true the first time somebody hand-authors one.
 *
 * Exported because `lookUpTerm` no longer lives in this file: it is
 * store-independent now (src/term-lookup.ts) and takes this as its
 * `assertWritable`. Postgres has no fixture at all and needs no counterpart —
 * an unknown slug there has no row and 404s, which is now what happens here
 * too. **A stated difference with a test on each side**, rather than something
 * to discover.
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
  /* The fixture is not the reader's to delete. An unknown slug 404s above now
     (`candidateDirs`), so the case this still guards is a DELETE addressed to
     `example` itself — the one committed directory in the repo. It has no
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
   exactly the sort of thing that has to be. See docs/plans/260825e-metadata-page.md. */

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
 * about which directory an article opens from. That sharing is the whole point:
 * the metadata page has to describe whatever the reading view is actually
 * showing, and `ArticleMetadata.dir` is what says where the files came from. It
 * was also the second door into the fixture fallback — `articleDir` had its own
 * copy of "then try example/" and the metadata page walked through it, so an
 * address with no article behind it got a confident 200 whose `dir` said
 * "example". One `candidateDirs` is why fixing that was one edit.
 *
 * `example/` is still not under `data/`, which is the case worth remembering
 * here — the two candidates are not two `data/` siblings.
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
 * direction that matters: a *successful* hierarchy run writes `tree.json` first and
 * copies `blocks.json` second (src/hierarchy.ts), so every correct run would come
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
 * ## The timestamps, and why they came back
 *
 * File sizes and per-file timestamps were dropped with the staleness check, on
 * the grounds that `ls -l` answers them. Greg, 2026-08-27, asked for them back:
 * *"add extra metadata (e.g. exact date times), perhaps in tooltips"*. They are
 * back as `ranAt` and `bytes` on each stage, and the reversal is narrower than
 * it looks — **what was wrong was the verdict, not the number**. Nothing here
 * compares two timestamps, and nothing infers anything from one; the page shows
 * when a stage last wrote, says so as a plain fact, and leaves the staleness
 * question exactly as unanswered as it was. A person reading "hierarchy ran 3 days
 * ago, arc ran in March" can draw their own conclusion, which is the thing this
 * page is for and the thing a red banner takes away from them.
 *
 * `stat` on the outputs that exist, whatever `stepIsDone` said about the set of
 * them: a stage that wrote two of its three files is not done, and when it
 * wrote them is still the most useful fact on the page. `weigh`, below, is the
 * one that does it.
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
     The two differ for the fixture, whose artefacts live in `example/`, and the
     default store would then report every stage of it unfinished — the page
     saying nothing has run over an article it is displaying. Same `ctx.dir`, so
     the two halves of each row agree. */
  const store = createFsArtifactStore(() => ({ dir: ctx.dir, htmlFile: ctx.htmlFile }));

  const stages: StageState[] = await Promise.all(
    STEP_ORDER.map(async (step) => {
      const files = STEPS[step].outputs(ctx);
      const [done, written] = await Promise.all([
        stepIsDone(STEPS[step], ctx, store),
        weigh(files),
      ]);
      return {
        step,
        label: STEPS[step].label,
        outputs: files.map((file) => path.relative(ROOT, file)),
        done,
        ...written,
      };
    }),
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
     docs/plans/260826t-reader-profile.md. Both default to `null` via
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
    // The same `shelf` read that answers `purpose`. See ArticleMetadata.
    archivedAt: shelf.archivedAt ?? null,

    /**
     * **`sharing` is absent here, and absent is the answer.**
     *
     * Not omitted for want of plumbing: this store has no `visibility` column
     * and nowhere to put one — `data/` is one directory per slug — so it cannot
     * answer the question at all — nor the personalisation one beside it, since
     * it has no artefacts to read a `profileHash` off either. One block, one
     * fact about the store.
     *
     * It briefly reported `private`, on the reasoning that nothing *can* be
     * shared here so `private` is the truth. That was wrong, and the argument
     * against it is the one `requirePostgres` already makes on the public route
     * (src/public/routes.ts): a store with no honest answer must refuse to
     * answer rather than supply a plausible one. `private` is a claim this store
     * is in no position to make, and the owner's sharing card would have drawn
     * *"Only you can read this"* — confidently, with no way to be right — over
     * every article in development. docs/reusable/silent-success.md.
     *
     * **Absent rather than thrown**, though, and that half of the earlier
     * reasoning stands. `visibilityStore.set` refuses with a 501 on this store,
     * which is right for a *write* with nowhere to land; doing the same for a
     * read would take the whole Metadata page down in development to be
     * principled about a field nobody can set there. The card has a "we could
     * not check" state already, and that state is true.
     *
     * **The two stores disagree about this field for every article, and no test
     * says so — because none compares them here.**
     *
     * Checked rather than assumed, and the first version of this comment got it
     * wrong: it said `tests/store-parity.test.ts` compares this response, and
     * that file does not mention `articleMetadata` at all. The only cross-store
     * comparison of it is `tests/store-carry-forward.test.ts`, which reads
     * `stages[].done` out of both and never looks at anything else. So the
     * divergence introduced here is invisible to the suite, which is why it is
     * written down here instead.
     *
     * A comment claiming a check that was never written is the failure this
     * repo keeps having, and asserting one while *introducing* the divergence it
     * was supposed to cover would have been a good example of it.
     *
     * If a whole-object comparison of `articleMetadata` is ever added, it will
     * go red on this field immediately — Postgres answers and this store does
     * not — and *that divergence is the feature working*. Whoever writes that
     * test should compare the fields both stores can answer, not the object.
     */
  };
}

/**
 * When these files were last written, and what they weigh together.
 *
 * The newest mtime rather than the oldest or the first: a stage writes its
 * files in whatever order suits it (src/hierarchy.ts writes the tree last on purpose),
 * so the only one that answers "when did this stage last run" is the last one
 * written.
 *
 * A missing file is skipped rather than failing the set, because half a stage
 * is exactly the state this page is opened to look at. Nothing at all on disk
 * gives `null` twice — which is *"we cannot say"*, and must not arrive as a zero
 * that reads like a real measurement.
 */
async function weigh(files: string[]): Promise<{ ranAt: string | null; bytes: number | null }> {
  const stats = await Promise.all(
    files.map((file) => stat(file).catch(() => null)),
  );
  const found = stats.filter((s): s is NonNullable<typeof s> => s !== null);
  if (!found.length) return { ranAt: null, bytes: null };
  return {
    ranAt: new Date(Math.max(...found.map((s) => s.mtimeMs))).toISOString(),
    bytes: found.reduce((total, s) => total + s.size, 0),
  };
}

/* ------------------------------------------------------------ the library --
   Everything below serves the homepage: docs/project/library.md. */

/**
 * One shelf-ready record, assembled from things already in memory.
 *
 * Pure, so it can be tested without a filesystem.
 *
 * The blurb, the word count and the three other numbers now arrive as
 * `scalars`; `deriveLibraryScalars` in src/library-scalars.ts is where the rules
 * for them live, including why the first arc entry is deliberately not a
 * fallback for the blurb.
 */
export function describeArticle(input: {
  slug: string;
  meta: Meta;
  /**
   * The five, **received rather than derived** — since 2026-08-28.
   *
   * This function used to take `blocks` and `tree` and compute them, which made
   * it the second implementation of `deriveLibraryScalars`; both files said so
   * in a comment, and a review had already caught them disagreeing about the
   * `excerpt` rung of the blurb. It is now one derivation reached from two
   * moments: the filesystem store calls `deriveLibraryScalars` on the artefacts
   * it has just read, and the Postgres store reads the columns the same
   * function wrote at publish. docs/plans/260828c-library-read-latency.md § 2.
   *
   * That mattered for latency as well as for correctness: on the Postgres side,
   * deriving here meant reading every block row and the whole tree of every
   * article — and sanitising each one through jsdom — on every homepage load.
   */
  scalars: LibraryScalars;
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
  /**
   * Whether anyone with the link can read it — **passed in, like `shelf`,
   * because only one of the two stores can answer.**
   *
   * The filesystem store has no visibility column, so it passes nothing and
   * every card off it is unshared, which is the truth: sharing there is refused
   * with a 501 (src/store/index.ts). Postgres reads the column the query
   * already selected.
   */
  visibility?: Visibility;
}): LibraryEntry {
  const { slug, meta, scalars } = input;
  const shelf = input.shelf ?? { opens: 0 };

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
    },
    ...(meta.byline ? { byline: meta.byline } : {}),
    ...(meta.siteName ? { siteName: meta.siteName } : {}),
    ...(meta.url ? { url: meta.url } : {}),
    addedAt: input.addedAt,
    words: scalars.wordCount,
    minutes: readingMinutes(scalars.wordCount),
    blocks: scalars.blockCount,
    parts: scalars.partCount,
    sections: scalars.sectionCount,
    comments: input.comments,
    ...(scalars.rootGist ? { gist: scalars.rootGist } : {}),
    /* **Only when it is public.** Spelling the private case out would put a
       `"private"` on every card that the filesystem store cannot produce, and
       tests/store-parity.test.ts compares whole entries — see
       `LibraryEntry.visibility` in src/types.ts. The shelf reads it as
       `=== "public"`, so an absence and a private article are the same
       question answered the same way. */
    ...(input.visibility === "public" ? { visibility: "public" as const } : {}),
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
  /* Through `headingTitleOf`, not a scan written here. The Postgres store needs
     the same rule and had its own copy; there were three, and one of them is
     SQL. src/library-scalars.ts. */
  const title = meta?.title ?? headingTitleOf(blocksFile.blocks) ?? slug;

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

  /* Existence, not contents. Three `stat`s beside the three reads this function
     already does, and deliberately not three more `readJson`s: the tooltip asks
     "has a glossary been built", not "how many terms are in it", and parsing
     three artefacts per card per homepage load to answer a question nobody asked
     is how a shelf gets slow without anyone deciding it should.

     `Promise.all`, because they are independent and this already runs once per
     article; and `exists` rather than a try/catch each, so a missing file reads
     as `false` rather than as an error to be swallowed. */
  const [arc, tweets, glossaryFile] = await Promise.all(
    ["arc.json", "tweets.json", "glossary.json"].map((name) =>
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
      /* Derived here, from the artefacts this walk has just read. The Postgres
         store reads the columns the *same* function wrote at publish, so the
         shelf cannot end up with two answers depending on which store served
         it — the divergence a review found once already, over the `excerpt`
         rung of the blurb. src/library-scalars.ts. */
      scalars: deriveLibraryScalars({
        blocks: blocksFile.blocks,
        tree,
        excerpt: meta?.excerpt,
      }),
      comments: (await loadComments(slug)).length,
      addedAt,
      fixture,
      shelf,
      has: {
        arc: arc ?? false,
        tweets: tweets ?? false,
        glossary: glossaryFile ?? false,
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
  // homepage load until its hierarchy lands, so at warn the shelf would cry wolf
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
