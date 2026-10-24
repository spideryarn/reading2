/**
 * **The article a bug report may carry: the canonical source Spideryarn read,
 * and the payload the reading page loaded.**
 *
 * docs/plans/260913a-send-the-source-file-and-the-article-with-extra-diagnostics.md.
 * Reports are worked by agents that read Sentry and hold no production
 * database or bucket credentials, so a report that names an article and
 * carries nothing of it ends at a wall — every "this PDF extracted badly"
 * report so far did. With the PDF or web page the pipeline read and the reading
 * page's own payload attached, the problem can be reproduced from Sentry alone.
 *
 * ## Who decides that this runs
 *
 * Not this file. `mirrorFeedback` (src/feedback.ts) calls it only when there is
 * a Sentry client, the reader ticked *Send extra diagnostics*, and the report
 * names an article; otherwise it is not called and nothing is read at all.
 * **Ownership is decided by the reads themselves**: `loadSourcePages`, `loadArticle`
 * and `articleMetadata` all resolve through `ownedSlug` and answer 404 for an
 * article that is not the caller's, and the owner box `handleApi` opened is
 * still open while the mirror runs. So there is no second ownership question
 * here to get wrong.
 *
 * ## Four outcomes, and why two of them look alike on purpose
 *
 * `none` covers *not yours*, *no such article* and *no source document held*,
 * because the owner-filtered reads cannot tell those apart — and a tag that
 * could would be a way to learn whether somebody else's slug exists. `failed`
 * is a read that threw for any other reason, which is itself worth knowing.
 * `too_large` is a cap, below. Every one is a value on a tag, so a missing
 * file is a Sentry filter rather than a silence.
 *
 * ## Two caps, and what each is protecting
 *
 * Sentry drops the **whole event** when a compressed envelope passes 20 MB,
 * and a dropped event takes the reader's own words with it — the one failure
 * that matters here. So the source is capped at 10 MiB (a PDF is already
 * compressed and counts nearly in full) — **every page of it together**, for a
 * piece split over several (plan 261024p), with a later page that would pass
 * it left out and counted — and `article.json` at 5 MiB, which
 * gzips to well under one. The JSON is capped on **encoded bytes**: `.length`
 * counts UTF-16 units and undercounts non-Latin text by up to three times.
 *
 * ## It never throws
 *
 * The report is filed and the reader answered before this runs; a broken
 * bucket must cost the attachment, never the report.
 */
import type { AllowedAttachment } from "./feedback-envelope.js";
import type { DocumentKind } from "./fetch.js";
import { articleMetadata, loadArticle, loadSourcePages } from "./store/index.js";
import { NotProcessed } from "./not-processed.js";
import { RawObjectTooLarge } from "./store/raw-document.js";
import type { Article, ArticleMetadata, StepName, Visibility } from "./types.js";

/** What happened to one of the two attachments. The tags' closed vocabulary. */
export type FeedbackArticleOutcome = "attached" | "too_large" | "none" | "failed";

/** The source document's cap. See the header for why 10 MiB. */
export const SOURCE_FILE_MAX_BYTES = 10 * 1024 * 1024;

/** `article.json`'s cap, on UTF-8 bytes. */
export const ARTICLE_JSON_MAX_BYTES = 5 * 1024 * 1024;

/**
 * **How many of a split piece's later pages went** (plan 261024p), each as its
 * own `source.part-<page>.html`. `total` is how many the revision lists, so
 * `0/0` is a single page — or no source read at all, which `sourceFile` says.
 * Fewer attached than listed means the 10 MiB, which is all the pages'
 * together, ran out.
 */
export interface SourcePartsSent {
  attached: number;
  total: number;
}

export interface FeedbackArticle {
  attachments: AllowedAttachment[];
  /** Page 1's outcome — the document itself, whatever its later pages did. */
  sourceFile: FeedbackArticleOutcome;
  sourceParts: SourcePartsSent;
  articleJson: FeedbackArticleOutcome;
}

const NO_PARTS: SourcePartsSent = { attached: 0, total: 0 };

/**
 * **The name and type a source goes out under, per kind.** A `Record` over
 * `DocumentKind`, so a third kind is a compile error here rather than a file
 * sent under a guessed name.
 *
 * HTML goes as `text/plain`: it is a page we fetched from somebody else's
 * site, and nothing that opens this attachment should render it — the same
 * reason `SourceStore.readPdf` refuses to serve HTML from our origin at all.
 */
const SOURCE_ATTACHMENT: Record<DocumentKind, { filename: string; contentType: string }> = {
  pdf: { filename: "source.pdf", contentType: "application/pdf" },
  html: { filename: "source.html", contentType: "text/plain" },
};

/** The facts about the source that go in `article.json` whether or not it went. */
interface SourceFacts {
  kind: DocumentKind;
  /** Page 1's size. */
  bytes: number;
  /** Only for a piece with later pages, so a single page's facts read as they always did. */
  parts?: SourcePartsSent;
}

/** A later page's attachment name: numbered by its page, page 1 being `source.html`. */
export function partFilename(page: number): string {
  return `source.part-${page}.html`;
}

/**
 * **What `article.json` holds, version 1.** Built, not copied: `metadata` is a
 * field-by-field pick, so a field added to `ArticleMetadata` does not ride
 * along until somebody decides it should.
 *
 * What is left out of the metadata, and why:
 * - `profile` and `purpose` — the reader's own "about you" and "why this one"
 *   text. The copy on the tick-box promises they never go.
 * - `dir`, and each stage's `label` and `outputs` — ours, but fixed by the step
 *   name (`STEPS`, `STEP_STORAGE`), so they tell a reader of the report nothing.
 * - `sharing.available` — which artefacts a visitor would see, for the sharing
 *   dialog; `stages` already says what exists.
 */
interface ArticleJson {
  version: 1;
  article: {
    meta: Omit<Article["meta"], "filename">;
    blocks: Article["blocks"];
    tree: Article["tree"];
    arc?: Article["arc"];
    assets: Article["assets"];
    navLabelStatus: Article["navLabelStatus"];
    visibility?: Article["visibility"];
  };
  metadata: {
    slug: string;
    stages: {
      step: StepName;
      done: boolean;
      ranAt: string | null;
      startedAt: string | null;
      bytes: number | null;
    }[];
    comments: number;
    archivedAt: string | null;
    sharing: { visibility: Visibility; publicAt: string | null; personalised: StepName[] } | null;
  };
  /**
   * The source's kind and size, from the source read — `null` when there was
   * none or it failed. Present when it was too large to send, which is when
   * the size is most worth knowing.
   */
  source: SourceFacts | null;
}

/** One read's result. An attachment exists only on the `attached` arm. */
type Gathered =
  | { outcome: "attached"; attachment: AllowedAttachment }
  | { outcome: Exclude<FeedbackArticleOutcome, "attached"> };

/** The two store reads needed before `article.json` can be built. */
type ArticleRead =
  | { outcome: "ready"; article: Article; metadata: ArticleMetadata }
  | { outcome: "none" | "failed" };

/**
 * Resolve one outcome inside the mirror's gathering budget. The underlying
 * store operation may not be abortable, but it can no longer hold the report:
 * a late result is ignored and the caller gets its explicit fallback.
 */
async function within<T>(read: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Read what a consented report may carry about `slug`. **Never throws**; every
 * failure is an outcome. Source and article reads start together and share the
 * same ceiling, so one hung store operation cannot hold the report or discard
 * the other attachment when it did finish.
 */
export async function gatherFeedbackArticle(slug: string, timeoutMs: number): Promise<FeedbackArticle> {
  try {
    const [source, article] = await Promise.all([
      within<SourceRead>(readSource(slug), timeoutMs, {
        gathered: { outcome: "failed" },
        parts: [],
        sent: NO_PARTS,
        facts: null,
      }),
      within(readArticle(slug), timeoutMs, { outcome: "failed" }),
    ]);
    const json =
      article.outcome === "ready"
        ? articleJson(article.article, article.metadata, source.facts)
        : { outcome: article.outcome };
    return {
      /* Page 1, its later pages in page order, then `article.json`. */
      attachments: [
        ...(source.gathered.outcome === "attached" ? [source.gathered.attachment] : []),
        ...source.parts,
        ...(json.outcome === "attached" ? [json.attachment] : []),
      ],
      sourceFile: source.gathered.outcome,
      sourceParts: source.sent,
      articleJson: json.outcome,
    };
  } catch {
    /* Both reads catch their own failures, so this is for a bug in this file.
       Rule 2 of src/monitoring.ts: the report must go whatever happens here. */
    return { attachments: [], sourceFile: "failed", sourceParts: NO_PARTS, articleJson: "failed" };
  }
}

/** Page 1's outcome, the later pages that went with it, and how many of how many. */
interface SourceRead {
  gathered: Gathered;
  parts: AllowedAttachment[];
  sent: SourcePartsSent;
  facts: SourceFacts | null;
}

/**
 * The source document and its later pages, from one revision, capped **by
 * the read**: `loadSourcePages` passes the cap to the bucket as a budget for
 * every page together, which refuses an oversized object on its
 * `Content-Length` rather than downloading it (src/store/raw-document.ts) and
 * leaves out a later page the budget cannot hold.
 */
async function readSource(slug: string): Promise<SourceRead> {
  let pages: Awaited<ReturnType<typeof loadSourcePages>>;
  try {
    pages = await loadSourcePages(slug, { maxBytes: SOURCE_FILE_MAX_BYTES });
  } catch (err) {
    if (err instanceof RawObjectTooLarge) {
      return { gathered: { outcome: "too_large" }, parts: [], sent: NO_PARTS, facts: { kind: err.kind, bytes: err.bytes } };
    }
    return { gathered: { outcome: outcomeOfThrow(err) }, parts: [], sent: NO_PARTS, facts: null };
  }
  if (pages === null) return { gathered: { outcome: "none" }, parts: [], sent: NO_PARTS, facts: null };

  const { source } = pages;
  const facts: SourceFacts = { kind: source.kind, bytes: source.bytes.byteLength };
  /* Checked again on what came back: the cap is this file's promise, and a read
     that ignored the option must not be what breaks it. */
  if (source.bytes.byteLength > SOURCE_FILE_MAX_BYTES) {
    return { gathered: { outcome: "too_large" }, parts: [], sent: NO_PARTS, facts };
  }
  /* The later pages, under what page 1 left of the same cap — checked here
     again for the same reason, so a page that would pass it is left out and a
     later one that fits still goes. */
  let spent = source.bytes.byteLength;
  const parts: AllowedAttachment[] = [];
  for (const part of pages.parts) {
    if (spent + part.bytes.byteLength > SOURCE_FILE_MAX_BYTES) continue;
    spent += part.bytes.byteLength;
    parts.push({ filename: partFilename(part.page), contentType: SOURCE_ATTACHMENT.html.contentType, data: part.bytes });
  }
  const sent: SourcePartsSent = { attached: parts.length, total: pages.partCount };
  if (sent.total > 0) facts.parts = sent;
  /* Not `source.filename`: that is what the reader called the file when they
     uploaded it, which is their text rather than a fact about the document. */
  const { filename, contentType } = SOURCE_ATTACHMENT[source.kind];
  return {
    gathered: { outcome: "attached", attachment: { filename, contentType, data: source.bytes } },
    parts,
    sent,
    facts,
  };
}

/**
 * The two owner-filtered reads behind `article.json`. Kept separate from its
 * encoding so the source and article outcomes can be timed concurrently and a
 * hung source does not throw away an article payload that finished.
 */
async function readArticle(slug: string): Promise<ArticleRead> {
  try {
    /* Settled rather than `all`, so that when one read says *not yours* and the
       other fails, the answer is `none` whichever of the two lost the race. */
    const [article, metadata] = await Promise.allSettled([loadArticle(slug), articleMetadata(slug)]);
    if (article.status === "rejected" || metadata.status === "rejected") {
      const reasons = [article, metadata].flatMap((one) => (one.status === "rejected" ? [one.reason] : []));
      return { outcome: reasons.some((reason) => outcomeOfThrow(reason) === "none") ? "none" : "failed" };
    }

    return { outcome: "ready", article: article.value, metadata: metadata.value };
  } catch {
    return { outcome: "failed" };
  }
}

/**
 * `article.json`, encoded once, capped on the bytes, and **those bytes**
 * attached — so the guard sends exactly what was measured.
 */
function articleJson(article: Article, metadata: ArticleMetadata, source: SourceFacts | null): Gathered {
  try {
    const payload: ArticleJson = {
      version: 1,
      article: pickArticle(article),
      metadata: pickMetadata(metadata),
      source,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (bytes.byteLength > ARTICLE_JSON_MAX_BYTES) return { outcome: "too_large" };
    return {
      outcome: "attached",
      attachment: { filename: "article.json", contentType: "application/json", data: bytes },
    };
  } catch {
    return { outcome: "failed" };
  }
}

/**
 * The reading payload without `Meta.filename`, the reader's exact uploaded
 * filename. Named field by field so another field on `Article` or `Meta` does
 * not silently become third-party diagnostics.
 */
function pickArticle(article: Article): ArticleJson["article"] {
  const { meta } = article;
  return {
    meta: {
      slug: meta.slug,
      title: meta.title,
      ...(meta.byline === undefined ? {} : { byline: meta.byline }),
      ...(meta.siteName === undefined ? {} : { siteName: meta.siteName }),
      ...(meta.lang === undefined ? {} : { lang: meta.lang }),
      ...(meta.url === undefined ? {} : { url: meta.url }),
      ...(meta.fetchedAt === undefined ? {} : { fetchedAt: meta.fetchedAt }),
      ...(meta.publishedAt === undefined ? {} : { publishedAt: meta.publishedAt }),
      /* The same fact at a coarser precision, so it follows the date. */
      ...(meta.publishedYear === undefined ? {} : { publishedYear: meta.publishedYear }),
      ...(meta.excerpt === undefined ? {} : { excerpt: meta.excerpt }),
      ...(meta.note === undefined ? {} : { note: meta.note }),
      ...(meta.source === undefined ? {} : { source: meta.source }),
      ...(meta.method === undefined ? {} : { method: meta.method }),
      ...(meta.pages === undefined ? {} : { pages: meta.pages }),
      ...(meta.rawSha256 === undefined ? {} : { rawSha256: meta.rawSha256 }),
      ...(meta.unverified === undefined ? {} : { unverified: meta.unverified }),
      ...(meta.recall === undefined ? {} : { recall: meta.recall }),
      ...(meta.pagesChecked === undefined ? {} : { pagesChecked: meta.pagesChecked }),
      ...(meta.quality === undefined ? {} : { quality: [...meta.quality] }),
    },
    blocks: article.blocks,
    tree: article.tree,
    ...(article.arc === undefined ? {} : { arc: article.arc }),
    assets: article.assets,
    navLabelStatus: article.navLabelStatus,
    ...(article.visibility === undefined ? {} : { visibility: article.visibility }),
  };
}

/** The pick. See `ArticleJson` for what is left out and why. */
function pickMetadata(metadata: ArticleMetadata): ArticleJson["metadata"] {
  const { sharing } = metadata;
  return {
    slug: metadata.slug,
    stages: metadata.stages.map((stage) => ({
      step: stage.step,
      done: stage.done,
      ranAt: stage.ranAt,
      startedAt: stage.startedAt,
      bytes: stage.bytes,
    })),
    comments: metadata.comments,
    archivedAt: metadata.archivedAt,
    sharing:
      sharing === undefined
        ? null
        : {
            visibility: sharing.visibility,
            publicAt: sharing.publicAt,
            personalised: [...sharing.personalised],
          },
  };
}

/**
 * A 404 is *not yours, or not there*; anything else is a failure. Optional
 * chaining because `throw null` is legal, and a bare `.status` on it would throw
 * from inside the code deciding what a throw means.
 *
 * **A paper not yet read through is `none` too** (`NotProcessed`, plan
 * 261001m): there is no article to attach, which is not a failure to attach
 * one. Its metadata still goes.
 */
function outcomeOfThrow(err: unknown): "none" | "failed" {
  if (err instanceof NotProcessed) return "none";
  return (err as { status?: unknown } | null | undefined)?.status === 404 ? "none" : "failed";
}
