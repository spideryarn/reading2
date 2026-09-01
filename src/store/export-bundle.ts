/**
 * **One article as a zip the reader downloads** — the faithful projection.
 *
 * The other projection is [`export.ts`](export.ts), and the two share
 * [`readArticleRows`](article-rows.ts) and nothing else. That is deliberate and
 * it is the whole design: `exportArticle` is the *rollback*, its output is
 * pinned byte for byte by `tests/store-roundtrip.test.ts` against what the
 * filesystem store writes, and it is therefore lossy in ways that cannot be
 * fixed in place — a `candidates` thread comes out as `chat`, `passages` and
 * `interrupted` are dropped from every message, `extractedHtml` is never written
 * at all. **The rollback's data model is not "my article data", and must not
 * become its definition.** docs/plans/260901h-export-article-data.md.
 *
 * ## Rows out, not fields out
 *
 * Everything below serialises a **whole row**, minus a named few, rather than
 * naming the fields it wants. That is the opposite of what `export.ts` does, and
 * it is on purpose: a hand-written field list is how `tools`, `stance`,
 * `criterionId` and `valence` each went missing from an export for weeks, each
 * time silently. The rollback has to keep its lists because a byte-comparison
 * pins them; this file does not, so a column added to `src/db/schema.ts` arrives
 * in the reader's download without anybody remembering it.
 *
 * ## It never touches the bucket
 *
 * No image bytes and no original document (Greg's call), so nothing here reads
 * Supabase Storage — which is what lets the route stay a plain owner-scoped
 * database read. Note this is a stronger claim than "we do not write them":
 * `export.ts`'s `writeRawDocument` calls `readRawDocument` *before* it writes,
 * so a sink that merely discarded the bytes would still have paid for the fetch.
 * `tests/store-export-bundle.test.ts` holds the claim by making both store
 * constructors hand back one that refuses, and watching the rollback fall into
 * that trap on the same article.
 */

import { zip } from "fflate";

import {
  ARTICLE_TABLE_COVERAGE,
  type ArticleRows,
  messagesOfThread,
  readArticleRows,
} from "./article-rows.js";
import { log } from "../log.js";

const logger = log("store");

/**
 * The version of this layout, in every manifest **from day one**.
 *
 * A format that starts without one can never add a version later without every
 * existing file being ambiguous. Bump it when an importer written against the
 * old layout would get something wrong — not for a new optional file.
 */
export const BUNDLE_FORMAT = 1;

/**
 * **What a Vercel function may return in one buffered response: 4.5 MB.**
 * https://vercel.com/docs/functions/limitations
 *
 * Measured over the local database, the largest article (`scaling-hypothesis`,
 * 12.6k words) is 307 KB zipped — 7% of this — and the median is far under. So
 * buffering is right, and this constant exists so the route can answer a
 * readable 413 rather than have the platform truncate the download: stored HTML
 * artefacts may be up to 32 MiB, so the case is not hypothetical. Streaming is
 * the named fix if it ever fires, and it is not built.
 */
export const BUNDLE_BYTE_CAP = 4_500_000;

/**
 * Too big to send in one buffered response.
 *
 * A function rather than a comparison written twice — the route has to answer
 * 413 on the same number this file reports `overCap` from, and two `>` in two
 * files is how one of them ends up `>=`. It is also the only part of the cap
 * that can be watched failing without a five-megabyte fixture.
 */
export function overBundleCap(byteLength: number): boolean {
  return byteLength > BUNDLE_BYTE_CAP;
}

/** One file in the zip, and how big it is uncompressed. */
export interface BundleEntry {
  readonly path: string;
  readonly bytes: number;
}

export interface ArticleBundle {
  readonly slug: string;
  /** What the download should be called. The route puts this in the header. */
  readonly filename: string;
  readonly bytes: Uint8Array;
  /** `bytes.byteLength`, said out loud so a caller need not measure it. */
  readonly byteLength: number;
  /**
   * Over `BUNDLE_BYTE_CAP` — **assembled, and too big to send**.
   *
   * Reported rather than thrown, because the caller is what knows whether it is
   * an HTTP response with a 4.5 MB ceiling or a CLI writing to disk. A warning
   * log would not have done: the reader's request still fails.
   */
  readonly overCap: boolean;
  readonly entries: readonly BundleEntry[];
}

/**
 * Columns that are ours rather than the reader's, dropped from every row.
 *
 * A short list, and each has a reason: `ownerId` is an auth uuid that says
 * nothing about the article, `articleId` and `revisionId` are internal keys the
 * bundle addresses nothing by, and `fts` is a generated `tsvector` — a search
 * index, unreadable, and large enough to double the size of `blocks.json`.
 *
 * **Block ids, thread ids and comment ids stay**, because they are the join keys
 * the whole format is built on (docs/project/block-ids.md).
 */
const OURS_NOT_THEIRS = new Set(["ownerId", "articleId", "revisionId", "fts"]);

/** JSON the way the pipeline writes it: two-space indent, trailing newline. */
function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * One row as plain JSON: every column, `Date`s as ISO strings.
 *
 * `drop` is per-file rather than global — `articles.id` is meaningless to an
 * importer while `comments.id` is what a reply points at, so "id" cannot be in
 * the shared set.
 */
function rowJson(row: object, drop: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (OURS_NOT_THEIRS.has(key) || drop.includes(key)) continue;
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

/** Something an importer should know is absent, rather than infer from silence. */
interface Omission {
  readonly kind: "table" | "content";
  readonly what: string;
  readonly why: string;
}

/**
 * The omissions that are not tables — Greg's three calls, in the manifest so an
 * importer can check what it is missing rather than guess from absent files.
 */
const CONTENT_OMISSIONS: readonly Omission[] = [
  {
    kind: "content",
    what: "image-bytes",
    why:
      "content/assets.json names every image the article referenced — source URL, " +
      "content hash, type and size — but the bytes are not in the zip. The URLs are " +
      "the originals, so most images can be re-fetched.",
  },
  {
    kind: "content",
    what: "original-document",
    why:
      "The PDF or web page as it was fetched. Left out because you already have the " +
      "URL and the original is easy to fetch again; content/stamped.html is the " +
      "version Spideryarn actually read.",
  },
  {
    kind: "content",
    what: "earlier-revisions",
    why:
      "Only the current extraction is exported. Earlier revisions do exist and carry " +
      "lineage, so this is a deliberate product choice rather than an impossibility.",
  },
];

/** The tables the coverage record says the bundle leaves out, and why. */
function tableOmissions(): Omission[] {
  const out: Omission[] = [];
  for (const [name, coverage] of Object.entries(ARTICLE_TABLE_COVERAGE)) {
    /* Bound to a local so the compiler narrows the union on `exported`; it does
       not do that through a property access. */
    const destination = coverage.bundle;
    if (destination.exported) continue;
    out.push({ kind: "table", what: name, why: destination.why });
  }
  return out;
}

/**
 * Build the zip for one article, in memory, owner-scoped.
 *
 * Throws `ArticleNotFound` (from `readArticleRows`) for a slug that is not this
 * reader's, which a route turns into a 404.
 */
export async function articleBundle(slug: string): Promise<ArticleBundle> {
  const rows = await readArticleRows(slug);
  const exportedAt = new Date();

  /* Insertion-ordered, so the entry list in the manifest reads in the order the
     README describes the layout. */
  const files = new Map<string, string>();
  const put = (path: string, text: string) => files.set(path, text);

  put("README.md", readme());
  put("article.json", articleJson(rows));
  for (const [path, text] of contentFiles(rows)) put(path, text);
  for (const [path, text] of augmentationFiles(rows)) put(path, text);

  const encoder = new TextEncoder();
  const encoded = new Map<string, Uint8Array>();
  for (const [path, text] of files) encoded.set(path, encoder.encode(text));

  const entries: BundleEntry[] = [...encoded].map(([path, bytes]) => ({
    path,
    bytes: bytes.byteLength,
  }));

  /* The manifest lists everything but itself — it cannot state its own size
     without changing it. Built last, written first. */
  const manifest = encoder.encode(json(manifestJson(rows, exportedAt, entries)));

  const zippable: Record<string, [Uint8Array, { mtime: Date }]> = {
    "manifest.json": [manifest, { mtime: exportedAt }],
  };
  for (const [path, bytes] of encoded) zippable[path] = [bytes, { mtime: exportedAt }];

  /* **`zip`, not `zipSync`.** fflate's own docs recommend the async API beyond
     a single file, and the synchronous one blocks the event loop while holding
     the sources, the encoded bytes and the output all at once — on a server
     answering other readers. */
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(zippable, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });

  const byteLength = bytes.byteLength;
  const overCap = overBundleCap(byteLength);
  logger.info(
    { slug, entries: entries.length + 1, byteLength, overCap },
    "article bundle built",
  );
  return {
    slug,
    filename: `spideryarn-${slug}.zip`,
    bytes,
    byteLength,
    overCap,
    entries: [{ path: "manifest.json", bytes: manifest.byteLength }, ...entries],
  };
}

function manifestJson(
  rows: ArticleRows,
  exportedAt: Date,
  entries: readonly BundleEntry[],
): unknown {
  const { article, revision } = rows;
  return {
    format: BUNDLE_FORMAT,
    kind: "spideryarn-article-snapshot",
    exportedAt: exportedAt.toISOString(),
    slug: article.slug,
    shortId: article.shortId,
    /* The extraction's own title. The reader's rename, if there is one, is
       `titleOverride` in article.json — two different facts, and collapsing them
       here would lose whichever one lost. */
    title: revision.title,
    url: revision.finalUrl ?? revision.requestedUrl,
    entries: [...entries].sort((a, b) => a.path.localeCompare(b.path)),
    omitted: [...tableOmissions(), ...CONTENT_OMISSIONS],
  };
}

/**
 * `article.json` — the article as a thing on your shelf, not as prose.
 *
 * Identity (`shortId`), shelf state (`opens`, `purpose`, `archivedAt`, …) and
 * sharing state (`visibility`, `publicAt`). None of the last two reaches the
 * rollback at all: `data/` has no public sharing to read them back into.
 */
function articleJson(rows: ArticleRows): string {
  /* `id` and `currentRevisionId` are internal uuids that name nothing else in
     the zip; `fixture` says this is the shipped demo, which is about our
     deployment rather than about the reader's article. */
  return json(rowJson(rows.article, ["id", "currentRevisionId", "fixture"]));
}

function contentFiles(rows: ArticleRows): Map<string, string> {
  const { revision, blocks } = rows;
  const out = new Map<string, string>();
  if (revision.stampedHtml) out.set("content/stamped.html", revision.stampedHtml);
  /* **The rollback never writes this one** — `grep extractedHtml src/store/export.ts`
     returns nothing — so it is one of the three fidelity claims
     tests/store-export-bundle.test.ts holds. It is stage 2's output before stage
     3 stamped ids on it, and it is the only thing that shows what the stamping
     changed. */
  if (revision.extractedHtml) out.set("content/extracted.html", revision.extractedHtml);
  if (blocks.length) {
    out.set("content/blocks.json", json({ blocks: blocks.map((row) => rowJson(row)) }));
  }
  /* **Always written, even empty, unlike everything else here.**
     `block_identities` is every id this article has ever minted, including ones
     no longer in the current revision — and a comment or a chat thread can be
     anchored to exactly such an id. Without this file the bundle contains
     anchors pointing at nothing, and an importer has no way to tell a dangling
     anchor from a corrupted one. An absent file would be ambiguous between "no
     ids" and "this export predates the file", so it is present at zero rows. */
  out.set(
    "content/block-identities.json",
    json({ identities: rows.blockIdentities.map((row) => rowJson(row)) }),
  );
  /* The manifest only, matching the rollback: the bytes are content-addressed
     objects in a bucket this code deliberately cannot reach. */
  if (revision.assets) out.set("content/assets.json", json(revision.assets));
  return out;
}

function augmentationFiles(rows: ArticleRows): Map<string, string> {
  const { revision } = rows;
  const out = new Map<string, string>();
  const at = (name: string, value: unknown) => {
    if (value !== null && value !== undefined) out.set(`augmentations/${name}`, json(value));
  };

  /* The pipeline's artefact columns, verbatim — they are already the JSON the
     app reads, and re-shaping them here would produce a second dialect of a
     format that has one. `tree.json` is the hierarchy and the gists together,
     one structure and not two (docs/project/granularity-zoom.md § The tree). */
  at("tree.json", revision.tree);
  at("arc.json", revision.arc);
  at("tweets.json", revision.tweets);
  at("glossary.json", revision.glossary);
  at("ideas.json", revision.ideas);
  at("quotes.json", revision.quotes);
  at("timeline.json", revision.timeline);
  at("quiz.json", revision.quiz);
  at("sketch.json", revision.sketch);
  at("labels.json", revision.labels);

  if (rows.comments.length) {
    at("comments.json", { comments: rows.comments.map((row) => rowJson(row)) });
  }

  if (rows.chatThreads.length) {
    /* Messages nested under their thread, which is how both the app and the
       rollback shape it — a flat list keyed by `threadId` would be closer to the
       tables and further from anything an importer wants.

       **`kind` is written as it is stored.** The rollback flattens `candidates`
       to `chat` because the round-trip test compares its bytes against a file
       the filesystem store wrote; a reader's Candidates thread coming back as an
       ordinary chat is precisely the loss this file exists not to repeat, and
       `passages` and `interrupted` on each message are the other half of it.
       Nothing below names a field, so all three survive by construction. */
    const threads = rows.chatThreads.map((thread) => ({
      ...rowJson(thread),
      messages: messagesOfThread(rows, thread.id).map((row) => rowJson(row, ["threadId"])),
    }));
    at("chat.json", { threads });
  }

  if (rows.searchRuns.length) {
    at("searches.json", { runs: rows.searchRuns.map((row) => rowJson(row)) });
  }
  if (rows.refereeCriteria.length) {
    /* The four config columns (`kind`, the two poles, `scale`) go out as
       columns, not through `configFromRow`. The rollback has to rebuild the
       discriminated union because `src/referee-criteria-store.ts` reads that
       file back; nobody reads this one back into the app, and a row the current
       code cannot classify is still the referee's own words — dropping it, as
       the rollback does, would lose them. */
    at("referee-criteria.json", { criteria: rows.refereeCriteria.map((row) => rowJson(row)) });
  }
  const claims = rows.refereeClaims[0];
  if (claims) at("referee-claims.json", { run: rowJson(claims) });
  if (rows.glossaryLookups.length) {
    at("glossary-lookups.json", { lookups: rows.glossaryLookups.map((row) => rowJson(row)) });
  }
  return out;
}

/**
 * The file for whoever writes an importer.
 *
 * It leads on the block-id contract because that is the one thing that makes
 * the rest of the zip make sense, and it says out loud that ids carry no
 * ordering — the single easiest thing to get wrong here, and the one that
 * produces a shuffled article that still validates.
 */
function readme(): string {
  return `# Your Spideryarn export

This is everything Spideryarn holds for one article, as of the date in \`manifest.json\`.
It is a plain zip of text files. Nothing here needs Spideryarn to read it.

If you are writing code to import this, read **The block id contract** below first. It is the
one thing that will make the rest of these files make sense.

## What's here

    manifest.json          What this export is, when it was made, and what was left out.
    article.json           The article on your shelf: your title for it, when you opened it,
                           your purpose for reading it, and whether it is shared.
    README.md              This file.

    content/
      stamped.html         The article as Spideryarn reads it, with a block id on every element.
                           This is the one to use.
      extracted.html       The same article before ids were stamped on. Rarely what you want.
      blocks.json          Every block as structured data: id, position, tag, kind, text,
                           word count, and the block's own HTML.
      block-identities.json Every block id this article has ever had, including ids whose
                           blocks are gone from the current version. Comments and chat threads
                           can be anchored to those, so this is how you tell an anchor that
                           points at removed text from one that is simply broken.
      assets.json          Every image the article referenced: source URL, hash, type, size.
                           A manifest only — see "What is not here".

    augmentations/         Everything Spideryarn or you added on top of the article.
      tree.json            The hierarchy, and the summaries. One nested structure, not two:
                           each node carries its own gist at each level of granularity.
      glossary.json        Terms the article assumes you know, and what they mean here.
      glossary-lookups.json Web lookups you asked for on a glossary term.
      ideas.json           Propositions the article takes as given.
      quotes.json          Lines worth keeping.
      timeline.json        When the article says things happened.
      sketch.json          The diagram.
      quiz.json            Questions generated from the article.
      arc.json             The shape of the argument.
      tweets.json          Short extracts.
      labels.json          Section labels.
      comments.json        Your comments, bookmarks and notes, each anchored to a block.
      chat.json            Your conversations about the article: threads, and every message
                           nested inside the thread it belongs to.
      searches.json        Meaning-searches you ran, and what they matched.
      referee-claims.json  Referee mode: what the paper claims.
      referee-criteria.json Referee mode: the criteria you set, and how the article scored.

\`manifest.json\` lists every file in the zip under \`entries\`, with its uncompressed size —
every file except itself, which cannot state its own size without changing it.

A file is absent when there is nothing in it. An article you never chatted about has no
\`chat.json\`. That is not an error, and an importer should treat every file as optional —
except \`manifest.json\`, \`article.json\`, \`README.md\` and \`content/block-identities.json\`,
which are always written, the last of them even when it is empty.

Every file holding a list wraps it in a single-key object — \`{ "comments": [...] }\`,
\`{ "threads": [...] }\` — so that the format has somewhere to grow. The artefact files
(\`tree.json\`, \`glossary.json\` and the rest of that group) are the app's own JSON, verbatim.

## The block id contract

Spideryarn splits an article into **blocks** — roughly, paragraphs and headings — and gives each
one a stable id that looks like \`spya-k3m9qt\`.

Every augmentation in this export addresses text **by that id**, never by character offset and
never by a CSS selector. A comment says "this is about block \`spya-k3m9qt\`". A summary says "these
blocks are the section I am summarising". So:

- \`content/stamped.html\` carries those ids as attributes. It is the join key for everything else.
- \`content/blocks.json\` is the same set of ids with the text already pulled out, if you would
  rather not parse HTML.
- Ids are minted once and preserved when an article is re-extracted, so they are safe to store in
  your own system and match against a later export.

Ids are random. **They carry no ordering.** \`blocks.json\` is written in document order and you must
preserve that order; if you load it into a map or a set and read it back, you will get a shuffled
article that still looks structurally valid. This is the single easiest thing to get wrong here.
Each block also carries its \`ordinal\`, so you can sort the order back if you lose it.

## What is not here, and why

- **The original PDF or web page.** Deliberately left out — you already have the URL, in
  \`manifest.json\`, and the original is easy to fetch again. What you get instead is
  \`content/stamped.html\`, which is the version Spideryarn actually read.
- **Image files.** \`content/assets.json\` names every image — its source URL, its content hash, its
  type and its size — but the image bytes themselves are not in this zip. The URLs in it are the
  originals, so most images can be re-fetched.
- **Earlier versions of the article.** Only the current extraction is exported. Spideryarn does
  keep earlier ones, so this is a decision about what belongs in an export rather than something
  it could not do.
- **What it cost.** Spideryarn's record of model spend isn't reliably attributable to a single
  article, so a per-article figure would be wrong rather than merely absent.
- **Pipeline machinery** — caches, queue state, and which step is up to date. None of it is
  anything you wrote, and none of it means anything outside Spideryarn.
- **Anything about you that isn't about this article** — your reader profile and settings are not
  in here. This file is one article's data.

\`manifest.json\` repeats this list in machine-readable form under \`omitted\`, so an importer can
check what it is missing rather than inferring it from absent files.
`;
}
