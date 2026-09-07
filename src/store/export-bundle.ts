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
 * **That was a claim before it was true.** For the first day of this feature
 * `article_revisions` — the biggest table here, and the one carrying the
 * article's own identity — was the one table `rowJson` was never called on:
 * `manifest.json` named `title` and a url, `contentFiles` named the HTML
 * columns, `augmentationFiles` named the ten artefact columns, and the other
 * thirty were in no JSON file in the zip at all. It is `content/revision.json`
 * now, built the same way as every other table. Two things ship by field list
 * and both are deliberate: `manifest.json` (`title` and the url, so an importer
 * knows what it has before opening anything) and `index.html` (a page for a
 * person). Neither is where a table's data lives.
 *
 * The guard that missed it is fixed too, and that is the more important half:
 * `tests/store-export-covers-tables.test.ts` now compares the keys each file
 * actually carries against `getTableColumns`, rather than looking for one
 * sentinel string somewhere in it.
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
import { escapeHtml, normaliseText } from "../html.js";
import { log } from "../log.js";
import { articleUrl, isWebUrl } from "../urls.js";

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

/**
 * **There is deliberately no `filename` here.**
 *
 * There was one — `spideryarn-${slug}.zip` — with a comment saying the route put
 * it in the header. The route did not: `sendExport` sends
 * `contentDisposition(`${slug}.zip`, "attachment")`, the client sets its own
 * `download` attribute, and `spideryarn-<slug>.zip` appeared nowhere else in the
 * repo. A field nothing read, under a comment that was false, and a *third*
 * spelling of a name the two live call sites already agree on.
 *
 * It could have been made the source of truth instead, and was not: the client
 * cannot read the header through a blob, so it would still need the name from
 * somewhere — and the thing that caused the confusion was a third spelling, not
 * a missing one.
 */
export interface ArticleBundle {
  readonly slug: string;
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
  /* **These two sentences were true until 2026-09-06 and are not any more**, which
     is worth stating rather than quietly rewriting: both promised the importer
     that what is missing can be fetched back from the web, and a figure cut out
     of an uploaded PDF can be fetched back from nowhere. It never had a source
     URL — `content/assets.json`'s `pdfFigures` names a content hash, a page and
     an opaque ref, and the bytes are in our bucket or they are gone.
     docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md. */
  {
    kind: "content",
    what: "image-bytes",
    why:
      "content/assets.json lists every image the article referenced, but the bytes are " +
      "not in the zip. One we stored carries its content hash, type and size; one we " +
      "could not carries the reason instead, and there is nothing to fetch back. An " +
      "image the article hot-linked carries its source URL and can be re-fetched. A " +
      "figure recovered from an uploaded PDF has no source URL and cannot: it is named " +
      "by its page and content hash only.",
  },
  {
    kind: "content",
    what: "original-document",
    why:
      "The PDF or web page as it was fetched. content/stamped.html is the version " +
      "Spideryarn actually read. A web article can be fetched again from its URL; " +
      "an uploaded PDF cannot, so for those this is the one copy and it is not here.",
  },
  {
    kind: "content",
    what: "earlier-revisions",
    why:
      "Only the current extraction is exported. Earlier revisions do exist and carry " +
      "lineage, so this is a deliberate product choice rather than an impossibility.",
  },
];

/**
 * **Everything the bundle leaves out, in one list** — the manifest's `omitted`
 * and the "What is not here" section of `index.html` are the same list, read
 * twice, so the page cannot say something different from the machine-readable
 * answer beside it.
 */
function omissions(): Omission[] {
  return [...tableOmissions(), ...CONTENT_OMISSIONS];
}

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

  /* `index.html` states every other file's size, so it is built once those are
     encoded and — like the manifest, and for the same reason — does not list
     itself. `manifest.json` is not in here either, because it is built after
     this page and would be a size that changes while being written down; the
     page names it in prose instead. */
  const listed: BundleEntry[] = [...encoded].map(([path, bytes]) => ({
    path,
    bytes: bytes.byteLength,
  }));
  const index = encoder.encode(indexHtml(rows, exportedAt, listed));
  encoded.set("index.html", index);

  const entries: BundleEntry[] = [
    ...listed,
    { path: "index.html", bytes: index.byteLength },
  ];

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
    /* **Two different addresses, and the pair is the point.** `url` above is
       where the article came from; this is where it lives on Spideryarn, with
       every augmentation in this zip still attached to it. An importer that only
       had `url` could find the piece again but not the reading of it, and a
       person who kept the zip for a year would have no way back.

       Composed rather than stored: `articleUrl` (src/urls.ts) is the one place
       the path is spelled, and the origin is a constant there for the reason
       that file gives.

       **Written whatever the article's sharing state**, and that is safe rather
       than merely convenient. Only the owner can download this zip
       (`readArticleRows` scopes it), but they can forward it afterwards and a
       private URL is not a capability — anyone holding the file already has the
       article and the slug, and the address grants a stranger nothing. What it
       is not is guaranteed to *work* for whoever opens it, so `README.md` says
       plainly that it wants the account the export came from. GPT Sol,
       2026-09-02. */
    spideryarnUrl: articleUrl(article.slug),
    entries: [...entries].sort((a, b) => a.path.localeCompare(b.path)),
    omitted: omissions(),
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

/**
 * The revision's columns that are **already in the zip as their own file**, and
 * would otherwise be written twice.
 *
 * Two payloads and twelve artefacts: `stampedHtml` and `extractedHtml` are the
 * article's own markup, `assets` is the image manifest, and the ten artefact
 * columns from `tree` to `labels` are each a file under `augmentations/`. A zip
 * that carried them here as well would be roughly twice the size for nothing,
 * and would give an importer two copies to disagree about.
 *
 * **`id` is ours, not the reader's** — an internal uuid that names nothing else
 * in the zip. `basedOnRevisionId` stays, even though it names a revision the
 * bundle does not carry: it is the lineage of the piece, a fact about the
 * article rather than a key into our database, and only this export says it.
 *
 * Everything else ships, and it ships by not being named.
 */
const REVISION_WRITTEN_ELSEWHERE = [
  "id",
  "stampedHtml",
  "extractedHtml",
  "assets",
  "tree",
  "arc",
  "tweets",
  "glossary",
  "ideas",
  "quotes",
  "timeline",
  "quiz",
  "sketch",
  "illustrated",
  "labels",
] as const;

function contentFiles(rows: ArticleRows): Map<string, string> {
  const { revision, blocks } = rows;
  const out = new Map<string, string>();
  /* **The revision's row, whole** — the piece's own identity and provenance:
     byline, site name, language, excerpt, the publisher's date, the note, both
     URLs, how it was fetched and how it was extracted, and the counts.

     It is here because for the first day of this feature it was **nowhere**.
     `manifest.json` named `title` and a url, `contentFiles` named the two HTML
     columns and `assets`, `augmentationFiles` named ten artefact columns, and
     the other thirty were not in any JSON file in the zip — they survived only
     incidentally inside the article's own prose. Meanwhile the rollback's
     `meta.json`, which this file's docstring calls the lossy one, wrote
     `byline`, `siteName`, `excerpt`, `publishedAt` and the rest. On this one
     table the faithful export was the less faithful of the two, and the guard
     could not see it because its sentinel went into `title` and `title` was one
     of the three fields that did ship. tests/store-export-covers-tables.test.ts
     now compares column names, not one string.

     `title` and the url are in `manifest.json` as well, and that is deliberate:
     the manifest is what an importer reads to know what it has before it opens
     anything else. Two small strings, said twice, from the same row. */
  out.set("content/revision.json", json(rowJson(revision, REVISION_WRITTEN_ELSEWHERE)));
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
  at("illustrated.json", revision.illustrated);
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

    index.html             Open this first if you are a person rather than a program: the
                           article's title, what is in the zip, and how much of each. It is
                           an index, not a reader — it does not show you the article.
    manifest.json          What this export is, when it was made, what was left out, and the
                           two addresses: the original's, and this article's on Spideryarn.
    article.json           The article on your shelf: your title for it, when you opened it,
                           your purpose for reading it, and whether it is shared.
    README.md              This file.

    content/
      revision.json        This reading of the article, as data: the byline, the site, the
                           language, the excerpt, the date the publisher gave it, the note, both
                           URLs, when it was fetched, how it was extracted, and the counts.
                           Everything about the piece that is not the piece itself.
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
      illustrated.json     The same argument painted, and where each plate's bytes are.
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
every file except itself, which cannot state its own size without changing it. \`index.html\`
lists the same files for a person to read, minus itself and the manifest, for the same reason.

## The two addresses

\`manifest.json\` carries two URLs and they are not the same thing.

- \`url\` is where the article came from: the publisher's page, as the fetcher finally landed on it.
- \`spideryarnUrl\` is where this article lives on Spideryarn — \`https://www.spideryarn.com/read/<slug>\`
  — with everything in this zip still attached to it, and more added since. Open that one to carry
  on reading rather than to re-read. You will need to be signed in as the account this export came
  from, unless the article has been shared publicly.

\`index.html\` shows both, labelled.

\`spideryarnUrl\` was added after the first exports were written, so treat it as optional: a
format 1 manifest may have only \`url\`. The format number did not change, because nothing an
importer already understood changed meaning.

A file is absent when there is nothing in it. An article you never chatted about has no
\`chat.json\`. That is not an error, and an importer should treat every file as optional —
except \`index.html\`, \`manifest.json\`, \`article.json\`, \`README.md\`,
\`content/revision.json\` and \`content/block-identities.json\`, which are always written, the
last of them even when it is empty.

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
  \`manifest.json\` as \`url\`, and the original is easy to fetch again. What you get instead is
  \`content/stamped.html\`, which is the version Spideryarn actually read.
- **Image files.** \`content/assets.json\` lists every image the article referenced, but the image
  bytes themselves are not in this zip. One we stored is named by its content hash, type and size;
  one we could not carries the reason instead. Where an entry has a source URL it is the publisher's
  original, so most of an ordinary web article's images can be re-fetched — but a figure recovered
  from a PDF you uploaded never had one, and cannot be fetched back from anywhere.
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

/* -------------------------------------------------------------------------- *
 * index.html — the page a person opens
 * -------------------------------------------------------------------------- */

/**
 * **Deliberately an index, not a reading client.**
 *
 * Greg asked for "perhaps also with a human-readable index .html", and GPT Sol's
 * review of the plan drew the line this section holds to:
 *
 * > I would make `index.html` a simple escaped file index in v1. Rendering every
 * > feature recreates a second reading client inside a ZIP.
 *
 * So the page says *what you have got*: the article's identity, a table of the
 * files with their sizes, counts of the things inside them, and what is not in
 * the zip. It renders **no article prose, no comment bodies and no chat**, and
 * in particular it never renders `extractedHtml` or `stampedHtml` — those are
 * the article's own markup, they are not ours, and putting them in a page is
 * exactly the thing this file is careful not to do. The reader already has both
 * as files; the browser will open either one directly.
 *
 * ## Why the escaping here is not the usual escaping
 *
 * Every string on this page is somebody else's: a title and a byline the site
 * wrote, a site name, a slug. Two of the four untrusted parties in
 * docs/project/security-map.md arrive here at once, and the page is opened from
 * a `file://` URL — where there is no origin to isolate, no CSP header from a
 * server, and a script that runs has the local filesystem in reach. So:
 *
 * 1. **`safe()` below, on every interpolated value, with no exceptions.** One
 *    function, so there is no second copy to drift, and nothing on this page is
 *    concatenated past it.
 * 2. **A `<meta>` CSP that forbids scripts and every network request**, as the
 *    second line rather than the first. It is real defence — it is why a hole in
 *    (1) would not also be an exfiltration channel — but `<meta>` CSP support on
 *    `file://` varies by browser, so it is not what the escaping rests on.
 * 3. **No JavaScript at all, and nothing external**: no fonts, no images, no
 *    stylesheets. The page works with the network unplugged, which is the point
 *    of a download you keep.
 */

/**
 * **The one escaper**, and everything interpolated into the page goes through it.
 *
 * [`escapeHtml`](../html.ts) rather than a private copy — it is the repo's
 * escaper, it handles all five characters (the two quote marks included, which
 * is what makes it safe in an attribute as well as in text), and its own doc
 * records what happened the last time this was written twice: two copies that
 * had already drifted, one of them missing `'`.
 *
 * `normaliseText` first, for the reason that file gives: escaping makes
 * `</title>` harmless and does nothing about a newline, a C1 control, or an RLO
 * override that reverses how the rest of the line reads. Those are not injection
 * — they are a string that is unsuitable for a table cell — and they survive
 * escaping untouched, because they are not markup.
 */
function safe(value: string): string {
  return escapeHtml(normaliseText(value));
}

/**
 * What each file is, in a few words, for the table.
 *
 * Short on purpose: `readme()` above is the format's documentation and the long
 * version, and this is the column beside a filename, read by somebody who has
 * just double-clicked the page. **A file the bundle writes and this record has
 * never heard of is a test failure** (`tests/store-export-bundle.test.ts`), so a
 * new file cannot arrive here unlabelled — which is the only thing keeping this
 * map and the layout in step.
 */
const FILE_NOTES: Readonly<Record<string, string>> = {
  "manifest.json": "What this export is, when it was made, what was left out, and the two addresses \u2014 the original\u2019s and this article\u2019s on Spideryarn.",
  "article.json": "The article on your shelf: your title, your purpose, sharing state.",
  "README.md": "The format, file by file, for whoever writes an importer.",
  "index.html": "This page.",
  "content/revision.json": "This reading of the article: byline, site, language, excerpt, published date, how it was fetched and extracted, and the counts.",
  "content/stamped.html": "The article as Spideryarn reads it, with a block id on every element. This is the one to open.",
  "content/extracted.html": "The same article before the ids were stamped on. Rarely what you want.",
  "content/blocks.json": "Every block as data: id, position, tag, kind, text, word count, and its own HTML.",
  "content/block-identities.json": "Every block id this article has ever had, including ids whose blocks are gone.",
  "content/assets.json": "Every image the article referenced: source URL, hash, type, size. Names only.",
  "augmentations/tree.json": "The hierarchy and the summaries — one nested structure, a gist on every node.",
  "augmentations/glossary.json": "Terms the article assumes you know, and what they mean here.",
  "augmentations/glossary-lookups.json": "Web lookups you asked for on a glossary term.",
  "augmentations/ideas.json": "Propositions the article takes as given.",
  "augmentations/quotes.json": "Lines worth keeping.",
  "augmentations/timeline.json": "When the article says things happened.",
  "augmentations/quiz.json": "Questions generated from the article.",
  "augmentations/sketch.json": "The diagram.",
  /* **The brief and the hashes, and not the pictures.** A plate's bytes are
     a content-addressed object in the blob store, so this file names them
     rather than carrying them — docs/project/export.md. */
  "augmentations/illustrated.json": "The same argument painted, and where each plate's bytes are.",
  "augmentations/arc.json": "The shape of the argument.",
  "augmentations/tweets.json": "Short extracts.",
  "augmentations/labels.json": "Section labels.",
  "augmentations/comments.json": "Your comments, bookmarks and notes, each anchored to a block.",
  "augmentations/chat.json": "Your conversations: threads, with every message nested inside its thread.",
  "augmentations/searches.json": "Meaning-searches you ran, and what they matched.",
  "augmentations/referee-claims.json": "Referee mode: what the paper claims.",
  "augmentations/referee-criteria.json": "Referee mode: the criteria you set, and how the article scored.",
};

/** The three groups the zip is laid out in, in the order the page shows them. */
const FILE_GROUPS: readonly { readonly prefix: string; readonly heading: string }[] = [
  { prefix: "", heading: "The export itself" },
  { prefix: "content/", heading: "content/ — the article as Spideryarn read it" },
  { prefix: "augmentations/", heading: "augmentations/ — everything added on top of it" },
];

/** Which group a path belongs to: its first path segment, or none. */
function groupOf(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(0, slash + 1);
}

/** Sizes a person reads, not a machine. Binary units, one decimal past a kilobyte. */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * How many things are in a JSON artefact, without knowing its type.
 *
 * The artefact columns are typed, so this could read `revision.quotes.quotes`
 * directly — but these numbers are **cosmetic**, and a shape that has moved
 * should make a count vanish from the page rather than throw on the way to a
 * download somebody is waiting for. The data itself is serialised whole, by
 * `rowJson`, and does not depend on any of this being right.
 *
 * A record counts as its keys, which is what makes `tree.nodes` answerable
 * alongside the plain arrays.
 */
function countOf(value: unknown, key: string): number {
  if (value === null || typeof value !== "object") return 0;
  const found = (value as Record<string, unknown>)[key];
  if (Array.isArray(found)) return found.length;
  if (found !== null && typeof found === "object") return Object.keys(found).length;
  return 0;
}

/**
 * **How many pictures this bundle actually names**, across both collections.
 *
 * Structural rather than typed on `Assets`, like `countOf` above and for the
 * same reason: these columns are `jsonb` and a bundle is built from rows of
 * unknown age, so a manifest written before either collection existed has to
 * count as none rather than throw.
 *
 * `status === "stored"` is the whole test. A `failed` entry is a record that we
 * looked and could not get the picture, and counting it would tell the reader
 * they have something they have not got.
 */
function storedIn(assets: unknown): number {
  if (assets === null || typeof assets !== "object") return 0;
  const box = assets as Record<string, unknown>;
  let n = 0;
  for (const key of ["entries", "pdfFigures"]) {
    const found = box[key];
    if (!Array.isArray(found)) continue;
    for (const entry of found) {
      if (entry !== null && typeof entry === "object") {
        if ((entry as Record<string, unknown>).status === "stored") n += 1;
      }
    }
  }
  return n;
}

/**
 * The counts, in the order the page shows them, with the empty ones dropped.
 *
 * Dropping zeroes rather than printing them: a page telling a reader they have
 * 0 quotes and 0 chat messages is a list of things they did not do. What is
 * here is what they have.
 */
function bundleCounts(rows: ArticleRows): { readonly label: string; readonly n: number }[] {
  const { revision } = rows;
  const all = [
    { label: "blocks", n: rows.blocks.length },
    { label: "words", n: rows.blocks.reduce((sum, block) => sum + block.words, 0) },
    { label: "nodes in the hierarchy", n: countOf(revision.tree, "nodes") },
    { label: "glossary terms", n: countOf(revision.glossary, "entries") },
    { label: "ideas", n: countOf(revision.ideas, "ideas") },
    { label: "quotes", n: countOf(revision.quotes, "quotes") },
    { label: "timeline events", n: countOf(revision.timeline, "events") },
    { label: "quiz questions", n: countOf(revision.quiz, "questions") },
    { label: "arc entries", n: countOf(revision.arc, "entries") },
    /* **Both collections, and only what is really named.** `assets` holds the
       article's own `<img src>`s in `entries` and the pictures recovered from a
       PDF in `pdfFigures`, and this counted the first only — so a paper, which
       by construction has no `<img>` in its blocks at all, reported *no images*
       however many figures came out of it. Since the zeroes are dropped below,
       the row then disappeared rather than reading 0.

       `storedIn` and not `countOf`, because the question the label asks is how
       many pictures this bundle *names*, and a `failed` entry names none: it is
       a record that we looked and could not get one. Counting it would tell the
       reader they have a picture that is not there — the same overstatement
       `assets.json`'s own note was corrected for. GPT Sol, 2026-09-07. */
    { label: "images named", n: storedIn(revision.assets) },
    { label: "comments and notes", n: rows.comments.length },
    { label: "chat threads", n: rows.chatThreads.length },
    { label: "chat messages", n: rows.chatMessages.length },
    { label: "searches", n: rows.searchRuns.length },
    { label: "referee criteria", n: rows.refereeCriteria.length },
    { label: "glossary lookups", n: rows.glossaryLookups.length },
    { label: "block ids ever minted", n: rows.blockIdentities.length },
  ];
  return all.filter((count) => count.n > 0);
}

/**
 * `2026-09-01 14:32 UTC` — deterministic, and not the machine's locale.
 *
 * `toLocaleString` would print in whatever locale the *server* runs in, which is
 * nobody's, and would make two exports of the same article differ by where they
 * were built.
 */
function stampedTime(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * **Plain, legible, and no dependencies.** System fonts because a downloaded
 * page cannot fetch one, and `color-scheme` plus a `prefers-color-scheme` block
 * so it is readable in both — a media query rather than `light-dark()`, since
 * this file may be opened years from now in whatever browser is to hand.
 */
const INDEX_CSS = `
:root { color-scheme: light dark; --ink: #17171a; --dim: #5c5c66; --line: #dcdce2; --bg: #fbfbfc; --panel: #fff; --link: #1a4fa0; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #e8e8ec; --dim: #9c9ca8; --line: #33333c; --bg: #16161a; --panel: #1d1d22; --link: #8fb4f2; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2.5rem 1.25rem 4rem; background: var(--bg); color: var(--ink);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width: 54rem; margin: 0 auto; }
a { color: var(--link); }
h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 .4rem; }
h2 { font-size: 1.05rem; margin: 2.4rem 0 .7rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); }
h3 { font-size: .82rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dim); margin: 1.5rem 0 .4rem; }
p { margin: .6rem 0; }
.sub { color: var(--dim); margin: 0 0 .2rem; }
.lede { max-width: 42rem; }
.counts { display: flex; flex-wrap: wrap; gap: .5rem; padding: 0; margin: .8rem 0 0; list-style: none; }
.counts li { background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: .45rem .7rem; min-width: 6.5rem; }
.counts b { display: block; font-size: 1.25rem; font-weight: 600; }
.counts span { color: var(--dim); font-size: .8rem; }
.files { width: 100%; border-collapse: collapse; margin-top: .3rem; }
.files th, .files td { text-align: left; padding: .38rem .6rem .38rem 0; border-bottom: 1px solid var(--line);
  vertical-align: top; }
.files th { font-size: .78rem; letter-spacing: .04em; text-transform: uppercase; color: var(--dim); font-weight: 600; }
.files code { font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
.files .size { text-align: right; white-space: nowrap; color: var(--dim);
  font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.omitted { padding-left: 1.1rem; margin: .6rem 0; max-width: 46rem; }
.omitted li { margin-bottom: .45rem; }
.omitted code { font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
footer { margin-top: 3rem; padding-top: .8rem; border-top: 1px solid var(--line);
  color: var(--dim); font-size: .85rem; }
`;

/**
 * The page itself.
 *
 * `listed` is every other file in the zip with its uncompressed size. It does
 * not contain this page, which cannot state its own size without changing it,
 * nor `manifest.json`, which is built afterwards for the same reason —
 * `articleBundle` says so at the call site, and `readme()` says so to the reader.
 */
function indexHtml(
  rows: ArticleRows,
  exportedAt: Date,
  listed: readonly BundleEntry[],
): string {
  const { article, revision } = rows;
  /* The reader's own name for it wins on the page, because that is what they
     call it. Both facts are in the files: `titleOverride` in article.json, the
     extraction's title in manifest.json. */
  const title = article.titleOverride ?? revision.title ?? article.slug;

  /* The byline and the site name. The separator appears only when both are
     there — a leading or trailing `·` is the untidiness this avoids, and most
     articles have one of the two rather than both. */
  const attribution = [revision.byline, revision.siteName]
    .filter((part): part is string => Boolean(part?.trim()))
    .map(safe)
    .join(" · ");

  /* **A validated URL or no `href` at all.** `isWebUrl` (src/urls.ts) is an
     allowlist of `http:` and `https:` rather than a blocklist, because the set
     of dangerous schemes is open-ended — `javascript:`, `data:`, `vbscript:` —
     and this is a link a person clicks from a local file. `finalUrl` is where
     the fetcher actually landed; the escaping is the caller's job, done here. */
  const url = revision.finalUrl ?? revision.requestedUrl;
  /* **Labelled, and it was not before.** One bare URL under a title reads fine;
     two do not, and the reader cannot tell which of them is the publisher's and
     which is ours. The label costs a word. */
  const source =
    url && isWebUrl(url)
      ? `<p class="sub">Original: <a href="${safe(url)}" rel="noreferrer noopener nofollow">${safe(url)}</a></p>`
      : url
        ? `<p class="sub">Original: ${safe(url)}</p>`
        : "";

  /* **The way back in** — Greg, 2026-09-02. A zip somebody keeps is read months
     later, from a folder, with no memory of which article it was; without this
     the only route back is searching the library for the title.

     Unconditional, unlike `source` above, and it needs none of that line's
     care: this string is composed by `articleUrl` (src/urls.ts) rather than
     read from a row a website wrote, so there is no scheme to check — the only
     untrusted part is the slug, and `encodeURIComponent` there plus `safe()`
     here each handle it. `nofollow` would be wrong on our own address; the
     `<meta name="referrer">` above already covers the rest, and `noreferrer`
     stays for the browsers that honour the attribute and not the tag. */
  const here = articleUrl(article.slug);
  const back = `<p class="sub">On Spideryarn: <a href="${safe(here)}" rel="noreferrer">${safe(here)}</a></p>`;

  /* Joined rather than interpolated line by line, so an article with no byline
     and no URL leaves no blank lines behind in the file somebody opens. */
  const header = [
    `<p class="sub">Spideryarn export · ${safe(stampedTime(exportedAt))}</p>`,
    `<h1>${safe(title)}</h1>`,
    attribution ? `<p class="sub">${attribution}</p>` : "",
    back,
    source,
  ]
    .filter(Boolean)
    .join("\n    ");

  const counts = bundleCounts(rows)
    .map(({ label, n }) => `<li><b>${safe(n.toLocaleString("en-GB"))}</b><span>${safe(label)}</span></li>`)
    .join("\n      ");

  const groups = FILE_GROUPS.map(({ prefix, heading }) => {
    const inGroup = listed.filter((entry) => groupOf(entry.path) === prefix);
    if (!inGroup.length) return "";
    const rowsHtml = inGroup
      .map(
        (entry) =>
          `<tr><td><code>${safe(entry.path)}</code></td>` +
          `<td>${safe(FILE_NOTES[entry.path] ?? "")}</td>` +
          `<td class="size">${safe(humanBytes(entry.bytes))}</td></tr>`,
      )
      .join("\n        ");
    return `<h3>${safe(heading)}</h3>
      <table class="files">
        <tr><th>File</th><th>What it is</th><th class="size">Size</th></tr>
        ${rowsHtml}
      </table>`;
  })
    .filter(Boolean)
    .join("\n      ");

  const omitted = omissions()
    .map((o) => `<li><code>${safe(o.what)}</code> — ${safe(o.why)}</li>`)
    .join("\n        ");

  /* The CSP is the second line of defence and the escaping above is the first —
     see the section comment. `default-src 'none'` refuses every fetch the page
     could make, which is what makes a mistake in the escaping unable to phone
     anywhere; `style-src 'unsafe-inline'` is the one exception, for the
     stylesheet below, and a stylesheet cannot execute or (with `img-src` and
     `font-src` denied by the default) fetch. */
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${safe(title)} — Spideryarn export</title>
<style>${INDEX_CSS}</style>
</head>
<body>
  <main>
    ${header}

    <p class="lede">This is everything Spideryarn holds for one article, as plain files.
    Nothing here needs Spideryarn to read it. <strong>This page is an index, not a reader</strong>
    — to read the article itself, open <code>content/stamped.html</code>.</p>

    <p class="lede">If you are writing code to import this, read <code>README.md</code>: it has
    the format file by file, and the <strong>block id contract</strong> that makes the rest of it
    make sense. Every note, comment, summary and search in here points at text by a stable block
    id such as <code>spya-k3m9qt</code> — never by position in the file. The ids are in
    <code>content/stamped.html</code> and in <code>content/blocks.json</code>, and they survive
    the article being re-read, so they are safe to store in your own system.</p>

    <h2>What is in it</h2>
    <ul class="counts">
      ${counts || "<li><b>0</b><span>nothing counted</span></li>"}
    </ul>

    <h2>The files</h2>
    <p class="sub">Sizes are uncompressed. This page and <code>manifest.json</code> are not in the
    table — neither can state its own size without changing it. <code>manifest.json</code> lists
    every file, this one included, in machine-readable form.</p>
    ${groups}

    <h2>What is not in it, and why</h2>
    <ul class="omitted">
      ${omitted}
    </ul>

    <footer>
      Format ${safe(String(BUNDLE_FORMAT))} · <code>${safe(article.slug)}</code>${
        article.shortId ? ` · ${safe(article.shortId)}` : ""
      } · exported ${safe(exportedAt.toISOString())}
    </footer>
  </main>
</body>
</html>
`;
}
