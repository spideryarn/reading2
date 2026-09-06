/**
 * **Fetching the article's own images** — the `assets` step, stage 4.5.
 *
 * The impure half of hosting them. [`src/assets.ts`](assets.ts) is the pure
 * half: which URLs a block would have the reader's browser fetch, what a
 * downloaded file turns out to be, and the map the reading view looks a URL up
 * in. This file is the network, the budget and the bucket, and it owns nothing
 * that could have lived there.
 *
 * Step 6 of docs/plans/260829b-hosting-the-articles-images.md. The reasoning is in the
 * plan; five things are worth knowing before editing anything here.
 *
 * ## 1. The URLs come from a DOM, never from the stored string
 *
 * `blocks.json` holds `…&amp;s=3a2bee…`; `getAttribute("src")` returns
 * `…&s=3a2bee…`. The reading view will look this manifest up with the second
 * spelling, so the manifest is keyed on the second spelling — which means
 * parsing the block HTML here exactly as the browser will, and reading the
 * attribute exactly as the browser will. Both halves of that live in
 * `imageSourcesIn`, once, so they cannot drift. Five of the corpus's thirteen
 * images carry a query string like that, and the failure mode is not an error:
 * it is every entry missing, the publisher's URL left in place, and a feature
 * that appears to do nothing.
 *
 * ## 2. One bad image must never fail the step
 *
 * An article is readable with a broken figure and unreadable with no article.
 * So every per-image failure — a 404, a timeout, a blocked address, a format we
 * do not host, a corrupt object at a canonical name — is recorded as a `failed`
 * entry and the loop carries on. The manifest's three states do the rest: a
 * `stored` entry is served from us, a `failed` entry stays hot-linked, and a
 * URL with **no entry at all** means this step never looked at it.
 *
 * That third state is why the wall-clock budget below writes `out-of-time`
 * entries rather than simply stopping. Every URL the article has gets an entry
 * on every run, including the ones the clock beat — leave them out and they
 * read as an article ingested before this step existed.
 *
 * ## 3. The article budget is reserved before a fetch starts, not charged after
 *
 * The plan says the byte counter must charge bytes *as they arrive*, because
 * summing finished downloads lets two concurrent responses overshoot the cap
 * between them. The agreed `AssetFetch` seam hands back a whole buffer, so
 * arrival is not observable from here — and the fix is stronger than the rule
 * rather than weaker. Each fetch **reserves** its slice of what is left before
 * it starts and is given that slice as its own `maxBytes`, so the bytes on the
 * wire at any instant can never exceed the article's remaining budget. On
 * completion the reservation is released and the real size charged. Two
 * downloads cannot overshoot between them because neither was ever allowed to
 * start without room for its worst case.
 *
 * ## 4. The queue is global and it is the whole of our politeness
 *
 * There is no per-host throttle anywhere in this repo; job concurrency has been
 * 1 and that was the entire story. One article is now up to 200 requests, so
 * `GATE` is module-level and admits two at a time **across the process** — not
 * two per article, which is the same unbounded number wearing a limit's name.
 *
 * ## 5. Nothing here trusts the origin's `Content-Type`
 *
 * Publishers serve PNGs as `application/octet-stream`; bot walls serve HTML as
 * `image/jpeg`. The stored extension and the stored content type both come from
 * `sniffImage`, over the bytes. This is the lesson `sniffKind` already encodes
 * for documents, and content addressing is what makes it non-negotiable: the
 * name we store *is* a claim about the contents.
 */
/* jsdom on first use rather than at module scope — src/jsdom-lazy.ts says why.
   `imageUrlsIn` below stays synchronous. */
import { jsdom } from "./jsdom-lazy.js";

import { createHash } from "node:crypto";

import {
  type AssetEntry,
  type AssetFailure,
  type Assets,
  imageSourcesIn,
  type PdfFigureMarker,
  /* Aliased because this module exports the *blocks* walk under that name and
     the two would collide. Same distinction as `imageSourcesIn` (a root) and
     `imageUrlsIn` (an article) above it. */
  pdfFigureMarkersIn as pdfFigureMarkersInRoot,
  sniffImage,
} from "./assets.js";
import { type AssetFetch, fetchAsset, FetchFailure, type FetchFailureCode } from "./fetch.js";
import { RESERVED_ATTRS } from "./reserved.js";
import { type RawSourceStore, storeRawSource } from "./store/blobs.js";
import type { Block } from "./types.js";

/**
 * The artefact's own version, and it is a **string** because `stampOf`
 * (src/store/artifacts.ts) reads `version` only `if (typeof a.version ===
 * "string")`. A number here would be silently dropped, and then a change to URL
 * selection, sniffing or failure handling would leave every existing manifest
 * reporting itself current on `sourceHash` alone — no article would ever re-run
 * the step. GPT Sol, 2026-08-29.
 *
 * Bump it when what this step *decides* changes: which URLs it picks, which
 * formats it hosts, how it classifies a failure.
 *
 * **Deliberately not bumped for `ASSETS_BUDGET_MS`, which is a new failure
 * classification and looks like it qualifies.** The test is whether a re-run
 * would decide *differently about an article that already has a manifest*, and
 * it would not: an article that finished inside the budget produces the
 * identical manifest, and one that did not finish never wrote a manifest at all
 * — the platform killed the invocation — so it re-runs on its own. Bumping
 * would re-fetch every image of every article to reach the same answer, and on
 * a slow article it could reach a *worse* one, replacing `stored` entries with
 * `out-of-time`. 2026-08-30.
 *
 * **Bumped to `assets/2` on 2026-09-06**, and this one does qualify twice over:
 * the step now recovers a PDF's own figures as well as fetching web images, and
 * `sourceHash` stopped meaning `hashBlocks` and started meaning
 * `assetsInputHash`. An unbumped manifest would compare a new-style hash
 * against an old-style one and answer *stale* for every article in the library
 * anyway — bumping is what makes that honest rather than accidental.
 */
export const ASSETS_VERSION = "assets/2" as const;

/* ------------------------------------------------------------------ *
 * Limits — policy, not measurement
 * ------------------------------------------------------------------ */

/**
 * The four caps and the timeout.
 *
 * **None of these is derived from the corpus**, and the plan's first draft
 * implied they were. The measurements say 899 KB largest image, 2.46 MB per
 * article, 13 images. These are generous guards chosen on purpose, so that a
 * hostile or broken page cannot cost us an unbounded amount, and so that the
 * numbers we actually see clear them by a wide margin rather than sitting near
 * them. docs/plans/260829b-hosting-the-articles-images.md#limits--policy-not-measurement.
 */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const MAX_ARTICLE_BYTES = 64 * 1024 * 1024;
/** A runaway guard rather than a budget: no real article has 200 figures. */
export const MAX_IMAGES = 200;
export const IMAGE_TIMEOUT_MS = 15_000;
/** One queue for the whole process. See the header, point 4. */
export const CONCURRENCY = 2;

/**
 * **How long the whole step may take, wall clock.**
 *
 * Every limit above bounds what one *image* may cost. None of them bounds what
 * the *article* may cost in time, and multiplying them out is alarming:
 *
 *     200 images ÷ 2 at a time × 2 attempts × 15s = 3,000s
 *
 * A step gets `LEASE_MS - DEADLINE_MARGIN_MS` = **740s** before the claimant
 * aborts it (src/jobs.ts), and the platform kills the whole invocation at
 * `maxDuration: 800` (vercel.json). So the worst case is seven and a half times
 * the step's own deadline — and the way it ends is a platform kill, which is
 * the worst available ending: it takes every other step in the invocation with
 * it and reports nothing about why. GPT Sol, 2026-08-30.
 *
 * **180s, and it was 300s until the step was actually run.** Every earlier
 * figure here came from the policy constants — 200 images, 2 concurrent, 2
 * attempts, 15s each — which is a ceiling nobody approaches. The corpus's worst
 * article has **10** images, not 200, and **no article in `data/` had an
 * `assets.json` at all**, so the step had never completed on anything and every
 * number about it was derived rather than measured.
 *
 * Measured on 2026-08-30 against the 10-image article: **7.1 seconds**, 8
 * stored, 2 blocked, 240 KB. So the normal case is two orders of magnitude
 * inside this budget, and the budget exists only to bound the pathological one:
 * a publisher that hangs costs `15s × 2 attempts` per image at 2 concurrent, so
 * 180s covers a fully-hanging article of our real size and caps a 200-image one
 * at about a dozen images before it stops.
 *
 * Sizing it against the ceiling rather than the corpus was the wrong
 * denominator, and it cost the whole ingest 120s of budget it did not need.
 *
 * **What actually constrains this number is the whole job, not one step.** The
 * default ingest sums to roughly `10 + 5 + 5 + 320.4 + this`, and that sum has
 * to fit inside `maxDuration` — so at 180s it is ~520s against 800s. The
 * per-step deadline is the looser bound of the two and quoting it here is what
 * let an earlier guard in `tests/collect-assets.test.ts` go quiet when
 * `LEASE_MS` moved for unrelated reasons. The single binding assertion lives in
 * `tests/jobs-lease-budget.test.ts`.
 *
 * The remainder is for the parts of the step this number cannot
 * govern: `storeRawSource` takes no `AbortSignal` at all, so a slow bucket runs
 * past the deadline no matter what the fetches do, and the unwinding of
 * whatever was on the wire when it bit has to fit somewhere too.
 *
 * `tests/collect-assets.test.ts` pins the *relationship* to the job deadline
 * rather than the number, in the shape `tests/jobs-lease-budget.test.ts` uses
 * for the lease and `maxDuration` — so tuning this is free and letting it drift
 * past the deadline it exists to stay inside is not. Not imported from
 * src/jobs.ts: this file is a pipeline stage and the job runner is what calls
 * it, so the dependency would point the wrong way.
 */
export const ASSETS_BUDGET_MS = 180_000;

/* ------------------------------------------------------------------ *
 * The global queue
 * ------------------------------------------------------------------ */

/**
 * Admit at most `limit` callers at once, process-wide.
 *
 * Deliberately the smallest thing that can be one: a count and a queue of
 * resolvers. `release` is returned rather than exposed as a method so that a
 * caller cannot release a permit it does not hold, and every caller releases in
 * a `finally`.
 */
class Gate {
  private free: number;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {
    this.free = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.free > 0) this.free -= 1;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    let released = false;
    return () => {
      /* Idempotent, because the alternative is a permit handed out twice by a
         double release in a `finally` that ran twice — a limit that quietly
         stops being one, which is the failure this whole class exists for. */
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.free += 1;
    };
  }

  /** How many are in flight. Exported for the test that watches the limit hold. */
  get inFlight(): number {
    return this.limit - this.free;
  }
}

/** The one queue. Module-level on purpose — see the header, point 4. */
export const GATE = new Gate(CONCURRENCY);

/**
 * **`fetchAsset`, with this caller's retry budget said out loud.**
 *
 * `fetchAsset` inherits `attempts: 3` from `FetchOptions`' defaults, which is
 * right for the thing those defaults document: one document a person pasted and
 * is waiting for. It is wrong here, and invisibly so — the `AssetFetch` seam
 * exposes only `maxBytes`, `timeoutMs` and `signal`, so the multiplier does not
 * appear at the call site at all.
 *
 * The arithmetic is the problem. The plan's politeness budget counts **images**
 * — 200 per article, two at a time — and a retryable failure turns each of
 * those into three requests. 200 images at one host becomes up to 600, which is
 * a limit that has quietly stopped being one (`trap 6`, and there is no
 * per-host throttle anywhere in this repo to catch it).
 *
 * **Two, not three, and not one.** One would drop an image on a single
 * connection reset, and a lost figure is permanent until somebody re-runs the
 * step. Two keeps the one retry that buys most of the reliability and halves
 * the worst case a publisher can see. Three is a *document's* budget: there is
 * one of those per article and a person is watching it.
 *
 * Stated here rather than by changing the default in src/fetch.ts, which
 * belongs to stage A and to `fetchDocument`. This is the caller deciding, which
 * is where a budget belongs.
 */
const politeFetch: AssetFetch = (url, opts) => fetchAsset(url, { ...opts, attempts: 2 });

/* ------------------------------------------------------------------ *
 * Finding the images
 * ------------------------------------------------------------------ */

/**
 * Every image URL in the article, in document order, each once.
 *
 * **One jsdom for the whole article**, with an inert `<template>` reused per
 * block — the pattern `articleLinks` (src/chat-tools.ts) established, and for
 * the same two reasons. A `<base>` element inside a block would change
 * `document.baseURI` and therefore every resolved URL in it; template content
 * is parsed into an inert fragment where nothing is connected, so it cannot.
 * And jsdom runs no scripts and fetches no subresources unless asked, which it
 * is not.
 *
 * The dedupe is across the whole article rather than per block: one picture
 * used in two places is one object and one request, and the manifest is keyed
 * by URL, so two entries for one key is a shape `assetIndex` could not
 * represent honestly.
 */
export function imageUrlsIn(blocks: readonly Block[]): string[] {
  const { JSDOM } = jsdom();
  const dom = new JSDOM("<!doctype html><template></template>");
  const template = dom.window.document.querySelector("template");
  if (!template) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    /* Case-insensitive, and a shortcut past the parse rather than a rule:
       `<IMG SRC=…>` is valid markup, and while this corpus serialises lowercase
       that is a property of the serialiser and not a promise. Being wrong here
       silently drops every image in the block. */
    if (!block.html || !/<img[\s>]/i.test(block.html)) continue;
    template.innerHTML = block.html;
    for (const url of imageSourcesIn(template.content)) {
      if (seen.has(url)) continue;
      seen.add(url);
      found.push(url);
    }
  }
  return found;
}

/**
 * Every PDF figure marker in the article, in document order, each once.
 *
 * The twin of `imageUrlsIn` above, sharing its one-jsdom-and-an-inert-template
 * shape and its case-insensitive shortcut past the parse — which is a shortcut
 * and not a rule, so being wrong about it silently drops every figure in the
 * block.
 *
 * Two things this deliberately does not do. It does not read the caption, which
 * is `pdfFigureRef`'s input and not this step's business — the ref already
 * carries a digest of it. And it does not check that the markers come from
 * *this* revision's PDF: they cannot not, because a ref folds in the raw PDF's
 * sha256, so a marker minted against a different document is a lookup that
 * misses rather than a mismatch anybody has to detect.
 */
export function pdfFigureMarkersIn(blocks: readonly Block[]): PdfFigureMarker[] {
  const { JSDOM } = jsdom();
  const dom = new JSDOM("<!doctype html><template></template>");
  const template = dom.window.document.querySelector("template");
  if (!template) return [];
  const found: PdfFigureMarker[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (!block.html || !MARKER_IN_HTML.test(block.html)) continue;
    template.innerHTML = block.html;
    for (const marker of pdfFigureMarkersInRoot(template.content)) {
      if (seen.has(marker.ref)) continue;
      seen.add(marker.ref);
      found.push(marker);
    }
  }
  return found;
}

/**
 * The cheap look before the parse — built once, from the registered name rather
 * than from a copy of it (src/reserved.ts is the only file allowed to spell one,
 * and tests/reserved.test.ts scans this one to be sure).
 *
 * Case-insensitive for the reason `imageUrlsIn` gives about `<IMG SRC=…>`, and
 * with the same standing: a shortcut past the parse, not a rule. It is safe to
 * be *loose* here — a block that has no marker costs one wasted parse — and it
 * is not safe to be tight, because a marker this misses is a figure nobody ever
 * looks for.
 */
const MARKER_IN_HTML = new RegExp(RESERVED_ATTRS.pdfFigure, "i");

/**
 * **What this step's inputs hash to** — the image URLs and the figure markers
 * in the blocks, and nothing else.
 *
 * This replaced `hashBlocks(blocks)` on 2026-09-06, and the bug it fixes is a
 * named family rather than an oversight. `hashBlocks` canonicalises `id`,
 * `text`, `role` and `treatment` (src/source-hash.ts) and **not** `block.html`,
 * so adding a figure marker to a captioned figure changed nothing it hashed: a
 * carried-forward empty manifest would have gone on reporting itself current
 * and this step would never have run against a PDF's figures at all. That is
 * exactly what src/pipeline.ts § `articleInputHash` records three stages doing,
 * for the same reason — stamping a hash whose inputs are not the step's inputs.
 * GPT Sol, D1-4; docs/reusable/silent-success.md.
 *
 * **Both halves are read through a DOM**, because both are looked up through
 * one later: `blocks.json` stores `…&amp;s=3a2bee…` and `getAttribute("src")`
 * returns `…&s=3a2bee…`, and a fingerprint built from the other spelling would
 * be a second way of reading the same fact. src/assets.ts § 1.
 *
 * **The raw PDF's hash is in here, transitively and exactly once**: every ref
 * folds it in, so a re-ingest of a *different* PDF changes every marker and
 * therefore this hash. Sol's D1-4 asks for `storedSha256` as a third input;
 * adding it would also make every *web* article's hash depend on a field it has
 * no images from, which is the kind of over-triggering that costs a refetch of
 * the whole corpus to buy nothing.
 *
 * `spya-assets/1` is a framing prefix and a version of the *canonical form*,
 * not of the step: it is what stops a document with one image URL and no
 * markers from ever hashing the same as one with no images and a marker
 * spelling that URL. Bump it if the shape below changes; `ASSETS_VERSION` is
 * the separate question of whether the step would decide differently.
 */
export function assetsInputHash(blocks: readonly Block[]): string {
  const canonical = `spya-assets/1\n${JSON.stringify([
    imageUrlsIn(blocks),
    pdfFigureMarkersIn(blocks).map((m) => m.ref),
  ])}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

/* ------------------------------------------------------------------ *
 * Why an image is not stored
 * ------------------------------------------------------------------ */

/**
 * Every fetch failure, mapped to the reason the manifest records.
 *
 * **Exhaustive over `FetchFailureCode` on purpose**, with no default arm: a new
 * code in src/fetch.ts is a typecheck failure here rather than an image
 * silently classified as whatever the fallback happened to be. The grouping is
 * about what a *reader* of the manifest would do with it — `blocked` means the
 * far end or our own guard refused us and trying again changes nothing;
 * `network` means it might work later.
 */
const FAILURE_FOR: Record<FetchFailureCode, AssetFailure> = {
  "invalid-url": "blocked",
  "unsupported-scheme": "blocked",
  /* Our own address guard. The publisher's page chose this URL, so a private
     address in an `<img src>` is exactly the request shape the guard exists
     for, and recording it as a refusal rather than as a network fault is what
     keeps that visible. */
  "blocked-address": "blocked",
  unauthorized: "blocked",
  forbidden: "blocked",
  "rate-limited": "blocked",
  "not-found": "not-found",
  "too-large": "too-big",
  dns: "network",
  connection: "network",
  certificate: "network",
  timeout: "network",
  "too-many-redirects": "network",
  "server-error": "network",
  "http-error": "network",
  empty: "network",
  /* `fetchAsset` does not sniff, so it cannot raise this — but the code is on
     the shared type and a silent hole in an exhaustive map is worse than a
     debatable classification. */
  "unsupported-type": "network",
};

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

export interface CollectAssetsOptions {
  /** Stage 4's blocks — what the reader will actually render. */
  blocks: readonly Block[];
  /**
   * The network, injected.
   *
   * The seam is `AssetFetch` and the default is `politeFetch` below, which is
   * the real `fetchAsset` with this caller's retry budget stated. Tests pass a
   * fake; **`tests/collect-assets.test.ts` also drives the real one through
   * this same parameter**, because both sides going green while the value
   * crossing between them is never exercised is the exact failure this shape
   * invites.
   */
  fetchImpl?: AssetFetch;
  /** Where the bytes go, injected the same way `storeRawSource` takes it. */
  blobs?: RawSourceStore;
  signal?: AbortSignal;
  /** The clock, so a test can assert on `fetchedAt` and `at`. */
  now?: () => Date;
  onProgress?: (done: number, total: number) => void;
  /**
   * The caps, injected, defaulting to the policy above.
   *
   * **This exists so the budget arithmetic has a probe, and that is not a
   * convenience.** The guard being tested is "a fetch may not start unless the
   * article has room for its worst case", and the real numbers are 16 MiB and
   * 64 MiB — so exercising the arm where the article budget is the binding
   * constraint would mean allocating 64 MiB of fixtures to watch four bytes of
   * arithmetic. Every fixture would then sit under the limit and the cap would
   * be tested by nothing at all, which is a shape this repo has been bitten by
   * more than once (docs/reusable/silent-success.md). Production never passes
   * this; tests set it to numbers they can count.
   *
   * `budgetMs` is here for the same reason and it is the sharper case: the real
   * one is five minutes, so a test that waited it out would be a five-minute
   * test, and every fixture would finish long before it — a deadline exercised
   * by nothing.
   */
  limits?: Partial<Limits>;
}

/** The caps, as one thing, so a test can replace them together. */
export interface Limits {
  maxImageBytes: number;
  maxArticleBytes: number;
  maxImages: number;
  /** Wall clock for the whole step. See `ASSETS_BUDGET_MS`. */
  budgetMs: number;
}

const DEFAULT_LIMITS: Limits = {
  maxImageBytes: MAX_IMAGE_BYTES,
  maxArticleBytes: MAX_ARTICLE_BYTES,
  maxImages: MAX_IMAGES,
  budgetMs: ASSETS_BUDGET_MS,
};

export interface AssetsRun {
  assets: Assets;
  /** How many entries came back `stored`. */
  stored: number;
  failed: number;
  /** Of the stored ones, how many were already in the bucket. */
  deduped: number;
  /** Bytes actually downloaded. */
  bytes: number;
  /**
   * What went wrong behind every `storage` failure, for the caller to log —
   * see `describeStorageFailure`. Redacted: no URLs, which are somebody's
   * reading, and no tokens, which are keys. Deduplicated and capped by
   * `boundStorageErrors`, so a run of them ends `"+12 more"` rather than
   * putting twelve more strings in one log line.
   */
  storageErrors: string[];
  elapsedMs: number;
}

/** How much of a storage failure is worth a log line. */
const MAX_STORAGE_CHARS = 200;

/** How many *different* ones are worth a log line. */
const MAX_STORAGE_ENTRIES = 5;

/**
 * The distinct failures, capped, with a count of what was left out.
 *
 * **Deduplication stopped being a bound the moment the message came along.**
 * `err.name` collapsed every corrupt object in an article to one entry, so
 * `new Set` bounded the array as a side effect of tidying it. A message does
 * not collapse: `CorruptObject` names the key it is complaining about
 * (src/store/blobs.ts § `CorruptObject`), so N of them are N distinct
 * ~200-char strings, and how many there are is the environment's to choose
 * rather than ours. The 415 this was written for dedups to one string and is
 * not the case that needs the cap; a bad backfill is.
 *
 * Five, because the question a reader of this line is asking is "is this one
 * publisher or is it everything", and five answers it.
 */
function boundStorageErrors(all: readonly string[]): string[] {
  const distinct = [...new Set(all)];
  if (distinct.length <= MAX_STORAGE_ENTRIES) return distinct;
  /* Said rather than silently dropped: a truncated list that does not admit it
     is a smaller number reported as the whole number. */
  return [
    ...distinct.slice(0, MAX_STORAGE_ENTRIES),
    `+${distinct.length - MAX_STORAGE_ENTRIES} more`,
  ];
}

/**
 * Everything replaced on the way out, in the order it is applied.
 *
 * **Order is part of each rule, not an accident of the list.** The URL rules run
 * first so that a grant inside a query string is gone before anything has to
 * recognise it as a token; after that it does not matter which placeholder a
 * secret ends up under, only that it is one.
 *
 * The rule that matters is: **an earlier rule must never take a fragment of what
 * a later one would take whole.** A partial match strands the rest *and* leaves
 * the later rule with nothing to recognise, which is the same "a partly redacted
 * URL is still a URL" failure one level up. It has happened once already, on the
 * day these were written: the `eyJ` rule ran before the generic one and ate
 * `<payload>.<signature>` out of
 * `IHsiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpM` as a
 * two-segment JWS, leaving the header sitting in the log and the generic rule —
 * whose whole purpose is that token — unable to fire. Nothing secret survived,
 * but the clause did not do what its comment said. Found by probing, 2026-09-03.
 * So the **more general token rule goes first**, and both of them consume as
 * many dot-separated segments as are there rather than a fixed two.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  /* Any scheme, not just http — an error about our own bucket can name a
     `supabase:` or `postgres:` URL just as happily. */
  [/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, "<url>"],
  /* Protocol-relative, which the rule above cannot see because it has no
     scheme to anchor on. `//cdn.publisher.test/2026/09/scan.jpeg` is exactly as
     much of a reading history as the schemeful spelling, and it is what an
     `<img src="//…">` produces. The lookbehind keeps this off the second half
     of something that has already been redacted, and off a path like
     `sha256//x`. GPT Sol, 2026-09-03.

     **`:` is in that lookbehind on purpose.** Without it this rule also ate the
     `//host/path` out of a schemeful URL, leaving a bare `https:` — redacted,
     but it made the rule above unreddenable: deleting it broke no test, which
     is a clause nothing can prove is doing anything
     (docs/reusable/silent-success.md). Each rule now owns one shape. */
  [/(?<![A-Za-z0-9.:])\/\/[^\s/]+\.[^\s/]+\S*/g, "<url>"],
  /* Supabase's current key format, which is not a JWT at all: `sb_secret_…`
     for the service role and `sb_publishable_…` for the anon key. The rule
     below would never have matched one. */
  [/\bsb_[a-z]+_[A-Za-z0-9_-]{8,}/g, "<token>"],
  /* Any dot-separated run of base64url segments, whatever the first bytes
     decode to. `eyJ` is only base64 of `{"`, so a header serialised with a
     leading space encodes to `IHsi` instead and the rule below never sees it.
     Ten characters a segment because runs that long, three or more of them, are
     a token and not a sentence; `{2,}` rather than exactly two more so that a
     five-part JWE goes in one piece instead of leaving two segments behind.

     **Before the `eyJ` rule, and that is load-bearing** — see the header. */
  [/\b[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,}){2,}\b/g, "<token>"],
  /* A bare JWT that the rule above is too strict for: the `eyJ` start earns it
     shorter segments and as few as two of them, which is a JWS. */
  [/\beyJ[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]+)+/g, "<token>"],
];

/**
 * What a `storage` failure gets to tell the caller's log.
 *
 * **The name alone is not a diagnosis.** Until 2026-09-03 this was
 * `err.name`, which is `"Error"` for every refusal Storage issues — so a
 * production `sources` bucket that had allowed only `application/pdf` and
 * `text/html` since 2026-08-27 refused *every image of every article* with a
 * 415, and the only trace was one log line reading `storageErrors: ["Error"]`.
 * A repo-wide config break and one flaky publisher looked identical, for four
 * days, while the images that step exists to un-hot-link stayed hot-linked.
 * docs/plans/260903j-illustrated-415-and-one-click-paint.md.
 *
 * The message carries the status (`Storage put failed (415): …`, built by
 * `fail` in src/store/blobs-supabase.ts), which is the whole difference between
 * "the publisher" and "us", so the status has to survive the redaction.
 *
 * **So it is redacted before it goes anywhere**, because src/log.ts forbids two
 * things and a message can hold either. A signed upload grant is a URL with a
 * JWT in its query string, and anything thrown while holding the image's own
 * address puts a publisher URL in the text — which is a reading history one
 * step removed. Both are replaced wholesale rather than trimmed: a partly
 * redacted URL is still a URL. `data:` never appears, because `isRehostableUrl`
 * (src/assets.ts) admits only http and https in the first place.
 *
 * Bounded too, because the message is somebody else's and `fail`'s 200-char cap
 * on a foreign body is not a promise every thrower makes.
 *
 * ## Compose, then redact, then slice — and the first version did none of that
 *
 * It redacted `message` alone, joined the result to `name`, and returned `name`
 * on its own whenever the message was empty — skipping the redaction *and* the
 * cap on that path. `err.name` is not a constant: anything can be thrown, and
 * `name` is an ordinary writable property, so a publisher URL landing there
 * came out whole, 539 characters of it, straight into a log line. One string,
 * redacted as one string, cut once at the end is the only shape where a new
 * field cannot be forgotten. GPT Sol, reviewing stage 1, 2026-09-03.
 *
 * Exported for tests/collect-assets.test.ts, which drives it directly: an
 * `Error` normalises what you can put in `name`, and the holes were all in the
 * parts that are not the message.
 */
export function describeStorageFailure(err: unknown): string {
  const thrown = err as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof thrown?.name === "string" ? thrown.name.trim() : "";
  const said = typeof thrown?.message === "string" ? thrown.message.trim() : "";
  /* `Error: …` says nothing, so the generic name is dropped rather than
     prefixed; a real one (`CorruptObject`) is the diagnosis and stays. */
  const whole = said ? (name && name !== "Error" ? `${name}: ${said}` : said) : name;

  let safe = whole;
  for (const [pattern, replacement] of REDACTIONS) safe = safe.replace(pattern, replacement);
  /* The cap last, over the whole redacted line, so there is one place a length
     is decided and it is after everything that can lengthen or shorten it. */
  return safe.trim().slice(0, MAX_STORAGE_CHARS).trimEnd() || "Error";
}

/**
 * Fetch every image this article's blocks would have a browser fetch, and say
 * what became of each.
 *
 * Writes nothing to disk — the caller does that, so this stays testable without
 * one and so the step is the only thing that knows where an artefact lives.
 */
export async function collectAssets(options: CollectAssetsOptions): Promise<AssetsRun> {
  const {
    blocks,
    fetchImpl = politeFetch,
    blobs,
    signal,
    now = () => new Date(),
    onProgress,
  } = options;
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const startedAt = Date.now();

  const urls = imageUrlsIn(blocks);
  /* Everything past the runaway guard is recorded rather than dropped, so that
     "no entry" keeps meaning "this step never looked at it" for every URL in
     the article. A dropped URL and an unvisited one are indistinguishable to
     every later reader, and only one of them is a decision. */
  const fetchable = urls.slice(0, limits.maxImages);
  const overflow = urls.slice(limits.maxImages);

  /**
   * The two halves of the article budget.
   *
   * `spent` is bytes that have finished arriving; `reserved` is the worst case
   * of everything still on the wire. A fetch may start only if
   * `maxArticleBytes - spent - reserved` is positive, and it is handed exactly
   * that much (capped at `maxImageBytes`) as its own limit. See the header,
   * point 3.
   */
  let spent = 0;
  let reserved = 0;

  const entries = new Map<string, AssetEntry>();
  let stored = 0;
  let failed = 0;
  let deduped = 0;
  let done = 0;
  const storageErrors: string[] = [];
  /**
   * Whether the manifest has been handed back.
   *
   * When the deadline wins the race there are still callers queued on `GATE`,
   * and they go on draining after this function has returned. Their bookkeeping
   * is harmless — it mutates locals nobody reads any more — but `onProgress` is
   * the caller's, and in the pipeline it is `ctx.report`, which writes progress
   * against the job. Left unguarded, an article that ran out of time reports
   * "31/200 images" while the *next* step is the one actually running.
   */
  let handedBack = false;

  const fail = (url: string, reason: AssetFailure): void => {
    entries.set(url, { url, status: "failed", reason, at: now().toISOString() });
    failed += 1;
  };

  for (const url of overflow) fail(url, "budget");

  /**
   * **The article's wall clock, as an `AbortSignal`.**
   *
   * One controller for the run, fired once by one timer, and it does three jobs
   * that would otherwise need three mechanisms:
   *
   *  1. every fetch already takes a signal, so aborting this one abandons
   *     whatever is on the wire — no second timeout machinery, and no waiting
   *     out the 15s per-image timeout that has already started;
   *  2. a caller that has been admitted to the queue reads `.aborted` and
   *     records itself out of time instead of dialling;
   *  3. `Promise.race` below uses it as the hard stop, for the parts of the
   *     step that take no signal at all.
   *
   * `AbortSignal.any` composes it with the caller's own cancellation rather
   * than replacing it — src/fetch.ts does the same thing one layer down. The
   * two are told apart afterwards by asking `deadline.signal`, never by reading
   * the error, because both arrive as `FetchFailure("timeout", …)`.
   */
  const deadline = new AbortController();
  const signalFor = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  /**
   * Our abort reason, kept so it can be recognised **by identity** below.
   *
   * `fetch` rejects with the signal's reason, and this object then travels back
   * as the `cause` of whatever `classifyNetworkError` builds. Identity is the
   * only reliable way to know the failure was ours: the *code* it arrives under
   * is not stable — see `reasonFor`.
   */
  const budgetSpent = new Error("assets budget spent");
  const timer = setTimeout(() => deadline.abort(budgetSpent), limits.budgetMs);
  const timeIsUp = new Promise<void>((resolve) => {
    deadline.signal.addEventListener("abort", () => resolve(), { once: true });
  });

  /**
   * What a throw from a fetch means, in the manifest's vocabulary. `null` is
   * "not a fetch failure at all", which is the storage arm.
   *
   * `FAILURE_FOR` answers this for everything except the clock, and the clock
   * cannot be read off the error: `fetchAsset` turns *any* caller-signal abort
   * into `FetchFailure("timeout", …)`, identical to a slow origin. So the
   * question is put to `deadline.signal` instead of to the error.
   *
   * **Recognised by identity, not by code, and that is the whole point.**
   * Measured against the real `fetchAsset`: `fetch` rejects with the signal's
   * abort reason, which reaches `classifyNetworkError` rather than
   * `abortFailure`, so the code depends on what the aborting party passed to
   * `.abort()` —
   *
   *     per-image AbortSignal.timeout -> TimeoutError -> code "timeout"
   *     our deadline's .abort(Error)  -> plain Error  -> code "connection"
   *
   * and `connection` maps to `network`. Reading the code would therefore file
   * every abandoned image as "the far end was slow, try later" on the only path
   * that ships, while every fake in the tests — which reject with a tidy
   * `FetchFailure("timeout")` — went green. So we look for `budgetSpent` in the
   * cause chain, which cannot be wrong about whose failure it was.
   *
   * The code is still consulted as a fallback, because one route loses the
   * cause: `underSignal` around the DNS phase builds its own `FetchFailure`
   * with no `cause` at all (src/fetch.ts `abortFailure`), and there the code is
   * the only evidence there is.
   *
   * **Nothing else is reinterpreted.** A `not-found` or a `too-large` that
   * lands after the deadline is still a fact about the image and keeps saying
   * so — relabelling every late failure would destroy the one signal that says
   * re-running will not help. And the *caller's* cancellation is not this: it
   * leaves `deadline.signal.aborted` false and falls through to `network`
   * exactly as before.
   */
  const reasonFor = (err: unknown): AssetFailure | null => {
    let ours = false;
    for (let e: unknown = err, hop = 0; e != null && hop < 4; hop++) {
      if (e === budgetSpent) {
        ours = true;
        break;
      }
      e = (e as { cause?: unknown }).cause;
    }
    if (!ours) {
      ours =
        err instanceof FetchFailure
          ? err.code === "timeout"
          : (err as Error | undefined)?.name === "AbortError";
    }
    if (deadline.signal.aborted && ours) return "out-of-time";
    return err instanceof FetchFailure ? FAILURE_FOR[err.code] : null;
  };

  const one = async (url: string): Promise<void> => {
    /*
     * **The queue first, the budget second, and the order is load-bearing.**
     *
     * `Promise.all` starts every one of these at once, and everything before
     * the first `await` runs synchronously for all of them. Reserving ahead of
     * the gate therefore has all 200 images reserve 16 MiB apiece against a
     * 64 MiB article — four get budget and the rest come back `budget` — on an
     * article whose images total 2.46 MB. The reservation has to be taken by
     * the caller that is actually about to fetch, which is the one holding a
     * permit. tests/collect-assets.test.ts pins this with an article of more
     * images than the reservation arithmetic would leave room for.
     */
    const release = await GATE.acquire();
    let budget = 0;
    let charge = 0;
    try {
      /* **Checked here, holding a permit, for the same reason the reservation
         is.** `Promise.all` runs everything before the first `await`
         synchronously, so a check placed before `GATE.acquire()` is taken by
         all 200 callers at once, at t=0, when no clock has run out yet — it
         would read clean for every image and bound nothing. This is the first
         moment a caller is actually about to dial. */
      if (deadline.signal.aborted) {
        fail(url, "out-of-time");
        return;
      }
      const room = limits.maxArticleBytes - spent - reserved;
      if (room <= 0) {
        fail(url, "budget");
        return;
      }
      budget = Math.min(limits.maxImageBytes, room);
      reserved += budget;

      const got = await fetchImpl(url, {
        maxBytes: budget,
        timeoutMs: IMAGE_TIMEOUT_MS,
        signal: signalFor,
      });
      charge = got.bytes.byteLength;

      const sniffed = sniffImage(got.bytes);
      if (!sniffed) {
        /* Every WebP, AVIF and SVG, and anything that is not an image at all —
           a bot wall's HTML page served as `image/jpeg` lands here too, which
           is the point of sniffing rather than believing the header. The image
           stays hot-linked. */
        fail(url, "unsupported-format");
        return;
      }

      const put = blobs
        ? await storeRawSource(got.bytes, sniffed.ext, blobs)
        : await storeRawSource(got.bytes, sniffed.ext);
      if (put.outcome === "already-there") deduped += 1;
      entries.set(url, {
        url,
        status: "stored",
        sha256: put.sha256,
        ext: sniffed.ext,
        contentType: sniffed.contentType,
        bytes: got.bytes.byteLength,
      });
      stored += 1;
    } catch (err) {
      const reason = reasonFor(err);
      if (reason) {
        /* A `too-large` refusal means at least the whole budget arrived before
           the cap bit, so it is charged rather than refunded. Every other typed
           failure either never got a body or got one we did not read — an image
           abandoned at the deadline included, which is why `out-of-time` leaves
           `charge` at zero. */
        if (err instanceof FetchFailure && err.code === "too-large") charge = budget;
        fail(url, reason);
        return;
      }
      /* Anything else — a `CorruptObject` at a canonical name, a Storage
         outage, a bug. **Recorded and carried past**, because one image must
         never fail the step.

         What went wrong is handed back for the caller to log, and nothing
         here logs it itself: this module is not in src/log.ts's component list
         and should not be, so the one place that already owns a `pipeline`
         logger does the saying. A corrupt canonical object needs a human, and a
         count with nothing in it would not tell anybody which human — nor
         whether a human is needed at all. `describeStorageFailure` above is
         what makes a message safe to hand over. */
      storageErrors.push(describeStorageFailure(err));
      fail(url, "storage");
    } finally {
      release();
      reserved -= budget;
      spent += charge;
      done += 1;
      if (!handedBack) onProgress?.(done, fetchable.length);
    }
  };

  /**
   * Run them through the queue.
   *
   * `Promise.all` over every URL at once is safe *because* `GATE` is what
   * bounds the concurrency — two in flight across the process, however many
   * promises are pending.
   */
  const everyImage = Promise.all(fetchable.map((url) => one(url)));
  /* A handler so that a rejection arriving *after* the race has been won by the
     deadline is not an unhandled rejection. This is a second, derived promise:
     `everyImage` itself still settles into the race, so a rejection that gets
     there first still propagates exactly as it did before. */
  void everyImage.catch(() => {});
  try {
    /**
     * **Raced, not awaited, and the race is the guarantee.**
     *
     * Aborting the signal is enough for every fetch, because a fetch takes one.
     * It is not enough for the step: `storeRawSource` takes no signal, so a
     * hung bucket walks straight past the deadline with the clock already
     * fired and nothing able to interrupt it. Racing the whole thing makes the
     * budget hold whatever any one image is stuck inside — which is the
     * difference between a limit and an intention.
     */
    await Promise.race([everyImage, timeIsUp]);
  } finally {
    /* Or the timer keeps the process alive for the rest of the five minutes,
       on every CLI run of an article that took two seconds. */
    clearTimeout(timer);
  }

  /**
   * Whatever the race left behind.
   *
   * If the deadline won, some images are still on the wire and some never got a
   * permit. **Both get an entry**, because "no entry" has to keep meaning "this
   * step never looked at it" — a missing entry and a failed one are the same
   * answer to `assetIndex` (src/assets.ts) and only the manifest keeps them
   * apart, so an image dropped here would be indistinguishable from an article
   * that never had it. Empty when `everyImage` won, which is the ordinary case.
   */
  for (const url of fetchable) {
    if (!entries.has(url)) fail(url, "out-of-time");
  }
  handedBack = true;

  /* Document order, not completion order. The manifest is read beside the
     article, and a list that reshuffles itself on every run is a diff nobody
     can read. */
  const ordered: AssetEntry[] = [];
  for (const url of urls) {
    const entry = entries.get(url);
    if (entry) ordered.push(entry);
  }

  return {
    assets: {
      version: ASSETS_VERSION,
      sourceHash: assetsInputHash(blocks),
      fetchedAt: now().toISOString(),
      entries: ordered,
    },
    stored,
    failed,
    deduped,
    bytes: spent,
    storageErrors: boundStorageErrors(storageErrors),
    elapsedMs: Date.now() - startedAt,
  };
}

