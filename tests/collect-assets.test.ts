/**
 * The `assets` step: what it fetches, what it refuses, and what it records.
 *
 * Offline throughout. The network is the injected `AssetFetch` seam and the
 * bucket is a `RawSourceStore` in a `Map`, so nothing here reaches a publisher
 * or a container.
 *
 * ## Two things this file is deliberately built around
 *
 * **The value that crosses the seam is exercised, not just typed.** Stage A
 * wrote `fetchAsset` and stage B wrote the consumer, against one agreed
 * `AssetFetch`. That is exactly the shape where both sides go green and the
 * thing passing between them is never once run — so `the real fetchAsset`
 * below hands `collectAssets` the *actual* function (through `fetch.ts`'s own
 * injected `fetchImpl`, so still no network), on a success and on a failure. A
 * compile-time check would not catch it: the failure would be a runtime shape.
 * docs/reusable/silent-success.md.
 *
 * **Every guard here has been watched go red.** The list of which break
 * reddens which test is in the stage-B report; the ones worth knowing while
 * reading are called out in comments where they are not obvious — the budget
 * arithmetic in particular, where taking the reservation before the queue
 * permit rather than after made an article of ten small images come back with
 * six of them refused for budget.
 */
import { describe, expect, it } from "vitest";

import type { Assets } from "../src/assets.js";
import {
  ASSETS_BUDGET_MS,
  ASSETS_VERSION,
  collectAssets,
  GATE,
  imageUrlsIn,
  MAX_ARTICLE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
} from "../src/collect-assets.js";
import {
  type AssetFetch,
  type AssetFetchOptions,
  fetchAsset,
  FetchFailure,
  type FetchLike,
} from "../src/fetch.js";
import { hashBlocks } from "../src/source-hash.js";
import type { BlobHead, PutResult, RawSourceStore } from "../src/store/blobs.js";
import type { Block } from "../src/types.js";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** Real signatures, so `sniffImage` is doing its actual job rather than a stub's. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 7, 7]);
/** An SVG — a real format, and one we deliberately do not host. */
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

let n = 0;
function block(html: string): Block {
  n += 1;
  const id = `spya-b${String(n).padStart(5, "0")}`;
  return { id, tag: "p", kind: "text", text: "x", words: 1, html, gistable: true };
}

function img(src: string, extra = ""): Block {
  return block(`<p><img src="${src}"${extra ? ` ${extra}` : ""} alt=""></p>`);
}

/** A bucket in a Map. `putIfAbsent` is create-only, exactly like the real one. */
function fakeBlobs(): RawSourceStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async head(key): Promise<BlobHead | null> {
      const there = objects.get(key);
      return there ? { bytes: there.byteLength, contentType: null } : null;
    },
    async get(key): Promise<Uint8Array | null> {
      return objects.get(key) ?? null;
    },
    async putIfAbsent(key, bytes): Promise<PutResult> {
      if (objects.has(key)) return "already-there";
      objects.set(key, bytes);
      return "stored";
    },
    async remove(key): Promise<void> {
      objects.delete(key);
    },
  };
}

/** A network that answers from a table, and remembers what it was asked. */
function scripted(
  table: Record<string, Uint8Array | Error | { bytes: Uint8Array; contentType: string | null }>,
): { impl: AssetFetch; asked: string[]; opts: { maxBytes: number; timeoutMs: number }[] } {
  const asked: string[] = [];
  const opts: { maxBytes: number; timeoutMs: number }[] = [];
  const impl: AssetFetch = async (url, o) => {
    asked.push(url);
    opts.push({ maxBytes: o.maxBytes, timeoutMs: o.timeoutMs });
    const answer = table[url];
    if (answer === undefined) throw new FetchFailure("not-found", url, "nothing scripted", { status: 404 });
    if (answer instanceof Error) throw answer;
    const body = answer instanceof Uint8Array ? answer : answer.bytes;
    /* **The fake honours `maxBytes`, because the real one does** — `readBody`
       refuses a body that arrives over the cap rather than truncating it. A
       fake that ignored it would let every budget assertion below pass while
       the article quietly went past its cap, which is the failure the budget
       exists to prevent, hiding inside the test for it. */
    if (body.byteLength > o.maxBytes) {
      throw new FetchFailure("too-large", url, `over ${o.maxBytes} bytes`);
    }
    if (answer instanceof Uint8Array) return { bytes: answer, contentType: null, finalUrl: url };
    return { ...answer, finalUrl: url };
  };
  return { impl, asked, opts };
}

/**
 * **A network that takes its time, and lets go the moment the signal fires.**
 *
 * The abort path is the whole point of this fixture. Without it a test cannot
 * tell an image that was *abandoned mid-flight* from one that was *never asked
 * for*, and those are the two halves of what the wall-clock budget has to
 * record — the first is the one a fixture usually cannot reach.
 *
 * `asked` is every URL a request went out for; `aborted` is the subset that was
 * still on the wire when the deadline bit. What it rejects with is copied from
 * the real thing: a caller's signal comes back out of `fetchAsset` as
 * `FetchFailure("timeout", …, "Fetch cancelled.")` — src/fetch.ts `abortFailure`
 * — which is *not* distinguishable from a slow origin by its code alone. That
 * is exactly why `collectAssets` has to decide by asking its own deadline
 * rather than by reading the error.
 */
function slow(
  delayMs: number,
  answer: Uint8Array,
): { impl: AssetFetch; asked: string[]; aborted: string[] } {
  const asked: string[] = [];
  const aborted: string[] = [];
  const impl: AssetFetch = (url, o) => {
    asked.push(url);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => resolve({ bytes: answer, contentType: null, finalUrl: url }),
        delayMs,
      );
      const giveUp = (): void => {
        clearTimeout(timer);
        aborted.push(url);
        reject(new FetchFailure("timeout", url, "Fetch cancelled."));
      };
      if (o.signal?.aborted) giveUp();
      else o.signal?.addEventListener("abort", giveUp, { once: true });
    });
  };
  return { impl, asked, aborted };
}

/**
 * The first `hangCount` requests never answer; every later one answers at once.
 *
 * Built for one job: making the *drain after the deadline* visible. The hanging
 * pair keeps two permits until the clock fires, and the instant answers mean
 * that if the queue goes on handing permits to callers that dial, it reaches
 * every remaining URL in about a millisecond — so a count taken a moment after
 * the step returned separates "stopped" from "returned and carried on".
 */
function hangsThenAnswers(hangCount: number): { impl: AssetFetch; asked: string[] } {
  const asked: string[] = [];
  const impl: AssetFetch = (url, o) => {
    asked.push(url);
    if (asked.length > hangCount) {
      return Promise.resolve({ bytes: PNG, contentType: null, finalUrl: url });
    }
    return new Promise((_, reject) => {
      const giveUp = (): void => reject(new FetchFailure("timeout", url, "Fetch cancelled."));
      if (o.signal?.aborted) giveUp();
      else o.signal?.addEventListener("abort", giveUp, { once: true });
    });
  };
  return { impl, asked };
}

const stored = (a: Assets, url: string) => a.entries.find((e) => e.url === url);

/** Every reason in the manifest, in document order, with `stored` for the rest. */
const reasons = (a: Assets): string[] =>
  a.entries.map((e) => (e.status === "failed" ? e.reason : "stored"));

/* ------------------------------------------------------------------ *
 * Finding the URLs
 * ------------------------------------------------------------------ */

describe("which URLs the step goes after", () => {
  /**
   * **The trap that would make the whole feature do nothing, silently.**
   *
   * `blocks.json` stores `&amp;`; the browser's `getAttribute("src")` returns
   * `&`. Build the manifest from the stored string and look it up from the DOM
   * and every entry misses — no error, no broken picture, just the publisher's
   * URL left where it was. Five of the corpus's thirteen images carry a query
   * string like this one.
   */
  it("keys on the URL a DOM hands back, not the one in the file", () => {
    const raw = "https://cdn.test/a.jpg?fm=pjpg&amp;s=7a8b90d8";
    const decoded = "https://cdn.test/a.jpg?fm=pjpg&s=7a8b90d8";
    expect(imageUrlsIn([img(raw)])).toEqual([decoded]);
  });

  it("takes `img` and nothing else, however much else has a src", () => {
    const blocks = [
      block('<iframe src="https://youtube.test/embed/x"></iframe>'),
      block('<video poster="https://cdn.test/poster.jpg"><source src="https://cdn.test/v.mp4"></video>'),
      img("https://cdn.test/real.png"),
    ];
    expect(imageUrlsIn(blocks)).toEqual(["https://cdn.test/real.png"]);
  });

  it("takes each URL once, across the whole article", () => {
    const same = "https://cdn.test/logo.png";
    expect(imageUrlsIn([img(same), block("<p>text</p>"), img(same)])).toEqual([same]);
  });

  /**
   * A `data:` URI is already inline; a relative `src` after stage 2 means
   * Readability had no base and is a different bug; a protocol-relative one
   * would have to be guessed at, and a guess fetches a real file from a real
   * server. All three get **no entry at all**, which is the third state: this
   * step did not look at them, and the reader hot-links as before.
   */
  it("leaves data:, relative and protocol-relative alone, with no entry", async () => {
    const blocks = [
      img("data:image/png;base64,iVBOR"),
      img("/images/local.png"),
      img("//cdn.test/scheme-less.png"),
      img("https://cdn.test/ok.png"),
    ];
    expect(imageUrlsIn(blocks)).toEqual(["https://cdn.test/ok.png"]);

    const net = scripted({ "https://cdn.test/ok.png": PNG });
    const run = await collectAssets({ blocks, fetchImpl: net.impl, blobs: fakeBlobs() });
    expect(net.asked).toEqual(["https://cdn.test/ok.png"]);
    expect(run.assets.entries).toHaveLength(1);
  });

  it("keeps document order in the manifest, whatever order the fetches finish in", async () => {
    const urls = ["https://cdn.test/1.png", "https://cdn.test/2.png", "https://cdn.test/3.png"];
    /* The second one is slow, so completion order is 1, 3, 2. */
    const impl: AssetFetch = async (url) => {
      if (url.endsWith("2.png")) await new Promise((r) => setTimeout(r, 20));
      return { bytes: PNG, contentType: null, finalUrl: url };
    };
    const run = await collectAssets({
      blocks: urls.map((u) => img(u)),
      fetchImpl: impl,
      blobs: fakeBlobs(),
    });
    expect(run.assets.entries.map((e) => e.url)).toEqual(urls);
  });
});

/* ------------------------------------------------------------------ *
 * What the bytes turn out to be
 * ------------------------------------------------------------------ */

describe("what gets stored, and under what name", () => {
  it("earns the extension from the bytes and ignores what the origin claimed", async () => {
    /* The exact lie publishers tell: a PNG served as octet-stream. And the
       sharper one: a bot wall's HTML page served as `image/jpeg`. */
    const blobs = fakeBlobs();
    const net = scripted({
      "https://cdn.test/a.png": { bytes: PNG, contentType: "application/octet-stream" },
      "https://cdn.test/b.jpg": {
        bytes: new TextEncoder().encode("<html>Are you a robot?</html>"),
        contentType: "image/jpeg",
      },
    });
    const run = await collectAssets({
      blocks: [img("https://cdn.test/a.png"), img("https://cdn.test/b.jpg")],
      fetchImpl: net.impl,
      blobs,
    });

    const png = stored(run.assets, "https://cdn.test/a.png");
    expect(png).toMatchObject({ status: "stored", ext: "png", contentType: "image/png" });
    /* And the object really is at a name that describes it. */
    expect([...blobs.objects.keys()]).toEqual([
      `sha256/${(png as { sha256: string }).sha256}.png`,
    ]);

    expect(stored(run.assets, "https://cdn.test/b.jpg")).toMatchObject({
      status: "failed",
      reason: "unsupported-format",
    });
  });

  it("hosts png, jpeg and gif, and refuses everything else by name", async () => {
    const net = scripted({
      "https://cdn.test/a.png": PNG,
      "https://cdn.test/b.jpg": JPEG,
      "https://cdn.test/c.gif": GIF,
      "https://cdn.test/d.svg": SVG,
    });
    const run = await collectAssets({
      blocks: [
        img("https://cdn.test/a.png"),
        img("https://cdn.test/b.jpg"),
        img("https://cdn.test/c.gif"),
        img("https://cdn.test/d.svg"),
      ],
      fetchImpl: net.impl,
      blobs: fakeBlobs(),
    });
    expect(run.assets.entries.map((e) => (e.status === "stored" ? e.ext : e.reason))).toEqual([
      "png",
      "jpeg",
      "gif",
      "unsupported-format",
    ]);
  });

  it("counts a second article's identical image as a dedup hit, not a second object", async () => {
    const blobs = fakeBlobs();
    const net = scripted({ "https://cdn.test/logo.png": PNG, "https://cdn.test/other.png": PNG });
    const first = await collectAssets({
      blocks: [img("https://cdn.test/logo.png")],
      fetchImpl: net.impl,
      blobs,
    });
    expect(first.deduped).toBe(0);

    /* A different URL carrying the same bytes — which is what a publisher's
       logo across forty articles actually is. */
    const second = await collectAssets({
      blocks: [img("https://cdn.test/other.png")],
      fetchImpl: net.impl,
      blobs,
    });
    expect(second.deduped).toBe(1);
    expect(second.stored).toBe(1);
    expect(blobs.objects.size).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Failure
 * ------------------------------------------------------------------ */

describe("one bad image never fails the step", () => {
  it("records the failure and stores the others", async () => {
    const net = scripted({
      "https://cdn.test/good.png": PNG,
      "https://cdn.test/gone.png": new FetchFailure("not-found", "https://cdn.test/gone.png", "404", {
        status: 404,
      }),
      "https://cdn.test/also-good.gif": GIF,
    });
    const run = await collectAssets({
      blocks: [
        img("https://cdn.test/good.png"),
        img("https://cdn.test/gone.png"),
        img("https://cdn.test/also-good.gif"),
      ],
      fetchImpl: net.impl,
      blobs: fakeBlobs(),
    });
    expect(run.stored).toBe(2);
    expect(run.failed).toBe(1);
    expect(stored(run.assets, "https://cdn.test/gone.png")).toMatchObject({
      status: "failed",
      reason: "not-found",
    });
  });

  it("maps each fetch failure to the reason a reader of the manifest can act on", async () => {
    const cases: [string, ConstructorParameters<typeof FetchFailure>[0], string][] = [
      ["https://cdn.test/1.png", "not-found", "not-found"],
      ["https://cdn.test/2.png", "too-large", "too-big"],
      ["https://cdn.test/3.png", "blocked-address", "blocked"],
      ["https://cdn.test/4.png", "forbidden", "blocked"],
      ["https://cdn.test/5.png", "timeout", "network"],
      ["https://cdn.test/6.png", "dns", "network"],
    ];
    const table = Object.fromEntries(
      cases.map(([url, code]) => [url, new FetchFailure(code, url, code)]),
    );
    const run = await collectAssets({
      blocks: cases.map(([url]) => img(url)),
      fetchImpl: scripted(table).impl,
      blobs: fakeBlobs(),
    });
    expect(
      run.assets.entries.map((e) => (e.status === "failed" ? e.reason : e.status)),
    ).toEqual(cases.map(([, , reason]) => reason));
  });

  /**
   * **A storage fault is not a network fault**, and it is the one failure here
   * that is about us. A `CorruptObject` means something is sitting at a
   * canonical name that does not hash to it, which needs a person with the
   * service key — filing it under "try again later" would lose that.
   */
  it("catches a storage throw, records `storage`, and hands the name back to log", async () => {
    const broken: RawSourceStore = {
      ...fakeBlobs(),
      async putIfAbsent(): Promise<PutResult> {
        const err = new Error("the object at sha256/… does not hash to its own name");
        err.name = "CorruptObject";
        throw err;
      },
    };
    const run = await collectAssets({
      blocks: [img("https://cdn.test/a.png"), img("https://cdn.test/b.gif")],
      fetchImpl: scripted({ "https://cdn.test/a.png": PNG, "https://cdn.test/b.gif": GIF }).impl,
      blobs: broken,
    });
    expect(run.failed).toBe(2);
    expect(run.assets.entries.every((e) => e.status === "failed" && e.reason === "storage")).toBe(
      true,
    );
    /* Deduplicated names, and no message and no URL — a message can carry a
       key and a URL is somebody's reading. */
    expect(run.storageErrors).toEqual(["CorruptObject"]);
  });
});

/* ------------------------------------------------------------------ *
 * The limits
 * ------------------------------------------------------------------ */

describe("the limits", () => {
  it("admits at most two fetches at a time, across the whole process", async () => {
    let live = 0;
    let peak = 0;
    const impl: AssetFetch = async (url) => {
      live += 1;
      peak = Math.max(peak, live);
      /* Two ticks, so the scheduler really has the chance to start a third. */
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return { bytes: PNG, contentType: null, finalUrl: url };
    };
    const blocks = Array.from({ length: 12 }, (_, i) => img(`https://cdn.test/${i}.png`));
    const run = await collectAssets({ blocks, fetchImpl: impl, blobs: fakeBlobs() });
    expect(run.stored).toBe(12);
    expect(peak).toBe(2);
    /* And the queue is given back, so the next article is not starved. */
    expect(GATE.inFlight).toBe(0);
  });

  /**
   * **The bug this test was written after finding.**
   *
   * `Promise.all` starts every call at once and everything before the first
   * `await` runs synchronously for all of them. Reserving the article budget
   * ahead of the queue permit therefore had ten images each reserve 16 MiB
   * against 64 MiB — four proceeding and six coming back `budget` — on an
   * article whose images are a few bytes each. The reservation has to be taken
   * by the caller that is actually about to fetch.
   *
   * The probe: move `reserved += budget` above `await GATE.acquire()` in
   * src/collect-assets.ts and this goes red at `stored`.
   */
  it("does not starve an article by reserving for images that have not started", async () => {
    const blocks = Array.from({ length: 10 }, (_, i) => img(`https://cdn.test/${i}.png`));
    const net = scripted(
      Object.fromEntries(blocks.map((_, i) => [`https://cdn.test/${i}.png`, PNG])),
    );
    const run = await collectAssets({ blocks, fetchImpl: net.impl, blobs: fakeBlobs() });
    expect(run.stored).toBe(10);
    expect(run.failed).toBe(0);
    /* Every one was handed the whole per-image cap, because two 16 MiB
       reservations never come close to 64 MiB. */
    expect(net.opts.every((o) => o.maxBytes === MAX_IMAGE_BYTES)).toBe(true);
    expect(net.opts.every((o) => o.timeoutMs === 15_000)).toBe(true);
  });

  /**
   * The article cap, with numbers small enough to count.
   *
   * `limits` exists for this: with the real 16 MiB / 64 MiB the arm below needs
   * 64 MiB of fixtures to exercise four bytes of arithmetic, and every fixture
   * would sit under the limit — a cap tested by nothing.
   * docs/reusable/silent-success.md.
   */
  /**
   * **Two things at once, and the second is the whole design.**
   *
   * A fetch is handed the room the article has left rather than the per-image
   * cap, so a download that would run the article past its budget is refused by
   * the fetcher on arrival instead of being noticed afterwards. And because the
   * room is taken *before* the request starts, two responses in flight cannot
   * overshoot between them — which is the hazard the plan names and which
   * summing finished downloads cannot close.
   *
   * The assertions are invariants rather than a predicted sequence on purpose:
   * which of two concurrent fetches settles first is the scheduler's business,
   * and a test that pins it would be pinning V8 rather than the budget.
   */
  it("hands each fetch only the room the article has left", async () => {
    const urls = [0, 1, 2, 3].map((i) => `https://cdn.test/${i}.png`);
    const net = scripted(Object.fromEntries(urls.map((u) => [u, PNG])));
    const run = await collectAssets({
      blocks: urls.map((u) => img(u)),
      fetchImpl: net.impl,
      blobs: fakeBlobs(),
      /* `PNG` is 11 bytes. A 25-byte image cap and a 30-byte article, so the
         article is the binding constraint and the `Math.min` arm has to run. */
      limits: { maxImageBytes: 25, maxArticleBytes: 30 },
    });

    /* **The invariant.** Not one byte over, however the fetches interleave. */
    expect(run.bytes).toBeLessThanOrEqual(30);
    /* At least one fetch was handed less than the image cap — that is the
       `Math.min(limits.maxImageBytes, room)` arm. Reduce it to
       `limits.maxImageBytes` and every value here becomes 25 and this goes
       red, while `run.bytes` climbs to 44 and the assertion above goes red
       too. */
    expect(net.opts.some((o) => o.maxBytes < 25)).toBe(true);
    expect(net.opts.every((o) => o.maxBytes > 0 && o.maxBytes <= 25)).toBe(true);
    /* And it really did fetch something, so none of the above is vacuous. */
    expect(run.stored).toBeGreaterThan(0);
  });

  it("refuses outright once the article has no room left", async () => {
    const urls = ["https://cdn.test/a.png", "https://cdn.test/b.png"];
    const net = scripted(Object.fromEntries(urls.map((u) => [u, PNG])));
    const run = await collectAssets({
      blocks: urls.map((u) => img(u)),
      fetchImpl: net.impl,
      blobs: fakeBlobs(),
      /* Room for exactly one image. The second is admitted to the queue, finds
         the whole budget reserved by the first, and never goes out. */
      limits: { maxImageBytes: 11, maxArticleBytes: 11 },
    });
    expect(net.asked).toHaveLength(1);
    expect(run.stored).toBe(1);
    expect(run.bytes).toBe(11);
    expect(run.assets.entries.map((e) => (e.status === "failed" ? e.reason : "stored"))).toEqual([
      "stored",
      "budget",
    ]);
  });

  it("charges a too-large refusal rather than refunding it", async () => {
    const urls = [0, 1, 2].map((i) => `https://cdn.test/${i}.png`);
    const run = await collectAssets({
      blocks: urls.map((u) => img(u)),
      fetchImpl: scripted({
        /* One server that keeps sending after the cap bit, then two ordinary
           11-byte images. */
        [urls[0]!]: new FetchFailure("too-large", urls[0]!, "over the cap"),
        [urls[1]!]: PNG,
        [urls[2]!]: PNG,
      }).impl,
      blobs: fakeBlobs(),
      limits: { maxImageBytes: 20, maxArticleBytes: 40 },
    });
    /* The refused download reserved 20 and really did put at least that many
       bytes on the wire, so it is charged rather than refunded. That 20, plus
       the 20 the second image is still holding while the third is admitted to
       the queue, is the whole 40 — so the third never goes out at all.

       Delete `if (err.code === "too-large") charge = budget` and the third one
       stores instead: a server that ignores the cap could then walk an article
       past its budget indefinitely, one refusal at a time, for free. */
    expect(run.assets.entries.map((e) => (e.status === "failed" ? e.reason : "stored"))).toEqual([
      "too-big",
      "stored",
      "budget",
    ]);
  });

  it("records every URL past the runaway guard rather than dropping it", async () => {
    const urls = [0, 1, 2, 3].map((i) => `https://cdn.test/${i}.png`);
    const net = scripted(Object.fromEntries(urls.map((u) => [u, PNG])));
    const run = await collectAssets({
      blocks: urls.map((u) => img(u)),
      fetchImpl: net.impl,
      blobs: fakeBlobs(),
      limits: { maxImages: 2 },
    });
    /* Only two requests go out — the guard is a guard, not a label. */
    expect(net.asked).toEqual([urls[0], urls[1]]);
    /* And all four have an entry, because "no entry" has to keep meaning
       "this step never looked at it". Slice them off instead of recording
       them and the last two become indistinguishable from an article ingested
       before this step existed. */
    expect(run.assets.entries.map((e) => (e.status === "failed" ? e.reason : "stored"))).toEqual([
      "stored",
      "stored",
      "budget",
      "budget",
    ]);
  });

  it("keeps the published policy numbers where the plan put them", () => {
    expect(MAX_IMAGE_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_ARTICLE_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_IMAGES).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * The wall clock
 * ------------------------------------------------------------------ */

/**
 * **The one limit that is about the article rather than the image.**
 *
 * The four caps above bound what a single picture may cost. None of them bounds
 * what the *step* may cost, and multiplying them out gives
 * `200 / 2 × 2 × 15s = 3,000s` — seven and a half times the 400s a step gets
 * before the claimant aborts it, on an article of slow images. The way that
 * ends is a platform kill, which takes the whole invocation with it and reports
 * nothing. GPT Sol, 2026-08-30.
 *
 * Real timers throughout, with `limits.budgetMs` turned down to a number a test
 * can wait out. Fake timers would be worse here rather than better: the thing
 * under test is a `setTimeout` racing real promise scheduling and a real
 * `AbortSignal`, and mocking the clock would leave the test agreeing with the
 * implementation about when the deadline fires instead of measuring it.
 * The elapsed-time assertions are therefore ceilings with a lot of slack, not
 * predictions.
 */
describe("the wall-clock budget", () => {
  const article = (n: number): { blocks: Block[]; urls: string[] } => {
    const urls = Array.from({ length: n }, (_, i) => `https://cdn.test/${i}.png`);
    return { blocks: urls.map((u) => img(u)), urls };
  };

  /**
   * **The bug, in the smallest form that shows it.**
   *
   * Forty images at 200ms each, two at a time, is eight seconds of work — the
   * 3,000s worst case in miniature. The budget is 100ms. Delete the deadline
   * and this runs the whole eight seconds.
   *
   * The count is the load-bearing assertion and the clock is the corroboration,
   * not the other way round. Elapsed time on a machine with several agents
   * building on it is noisy by hundreds of milliseconds — so the ceiling is
   * fifteen times the budget and still a twentieth of the unbudgeted run, and
   * jsdom is warmed *outside* the measurement because its first parse alone can
   * cost two seconds and belongs to neither reading.
   */
  it("stops when the clock runs out instead of running the article to completion", async () => {
    const { blocks, urls } = article(40);
    const net = slow(200, PNG);
    expect(imageUrlsIn(blocks)).toHaveLength(urls.length);

    const began = Date.now();
    const run = await collectAssets({
      blocks,
      fetchImpl: net.impl,
      blobs: fakeBlobs(),
      limits: { budgetMs: 100 },
    });
    const elapsed = Date.now() - began;

    /* **It stopped starting fetches**, rather than starting all forty and
       merely returning early. Nothing completes inside 100ms at 200ms each, so
       the only requests that ever go out are the two the queue admits at t=0.
       Forty would mean the budget bounded nothing. */
    expect(net.asked.length).toBeLessThanOrEqual(4);
    expect(net.aborted.length).toBeGreaterThan(0);
    /* And the wall clock agrees: ~8,000ms unbudgeted, ~100ms budgeted. */
    expect(elapsed).toBeLessThan(1_500);
    expect(run.elapsedMs).toBeLessThan(1_500);
  });

  /**
   * **The step returning is not the same as the step stopping.**
   *
   * Found by probe rather than by reading: with the deadline check inside `one`
   * deleted, every test above still passed. The race hands the manifest back at
   * the deadline, and the thirty-eight callers still queued on `GATE` go on
   * draining *in the background afterwards* — each one dialling the publisher
   * for a step that already ended. The manifest is right, the timing is right,
   * and the article has quietly sent two hundred requests.
   *
   * So the count is taken again after a pause long enough for that drain to
   * finish. The first two images hang until the signal fires and every later
   * one answers instantly, so an unguarded drain reaches all forty within a
   * millisecond or two of the deadline and a guarded one never leaves two.
   */
  /**
   * **Do not delete this as redundant — it is the only thing holding the guard
   * it tests, and that guard was dead when it was written.**
   *
   * Deleting the deadline check inside `one` changed **nothing**: every other
   * test in this file still passed. The race hands the manifest back on time,
   * so the manifest was right and the timing was right — and the ~38 fetches
   * still queued behind the concurrency gate went on draining afterwards, each
   * dialling the publisher for a step that had already ended. An article
   * quietly sent 200 requests to a CDN after we said we had stopped.
   *
   * That is the leak `assets` exists to close, arriving through the moment we
   * claim to have closed it. Nothing that asserts on the manifest can see it,
   * because the manifest is correct; only re-reading what the network was asked
   * for, **after** the step returned, can.
   *
   * The session working on opening an article before its ToC depends on this
   * directly: their suppression lifts when assets reports done, so "done" has
   * to mean the dialling stopped. Found 2026-08-30 by probing each new guard by
   * breaking it, which is the only reason it was found at all.
   */
  it("stops dialling once the clock runs out, not once the step returns", async () => {
    const { blocks, urls } = article(40);
    const net = hangsThenAnswers(2);
    const run = await collectAssets({
      blocks,
      fetchImpl: net.impl,
      blobs: fakeBlobs(),
      limits: { budgetMs: 60 },
    });
    const atReturn = [...net.asked];
    /* Long enough for thirty-eight instant fetches to have gone out, if the
       queue were still handing out permits to callers that dial. */
    await new Promise((r) => setTimeout(r, 150));

    expect(atReturn).toEqual([urls[0], urls[1]]);
    expect(net.asked).toEqual([urls[0], urls[1]]);
    expect(run.assets.entries).toHaveLength(urls.length);
    expect(GATE.inFlight).toBe(0);
  });

  /**
   * The same drain, seen from the caller's side.
   *
   * `onProgress` is `ctx.report` in the pipeline (src/pipeline.ts, the `assets`
   * stage), which writes progress against the *job*. Thirty-eight of those
   * arriving after the manifest has been handed back means an article that ran
   * out of time reports "31/40 images" while the next step is the one actually
   * running — a step's progress bar describing a different step's work.
   */
  it("reports no more progress once the manifest has been handed back", async () => {
    const { blocks } = article(40);
    const seen: number[] = [];
    const run = await collectAssets({
      blocks,
      fetchImpl: hangsThenAnswers(2).impl,
      blobs: fakeBlobs(),
      limits: { budgetMs: 60 },
      onProgress: (n) => void seen.push(n),
    });
    const atReturn = seen.length;
    await new Promise((r) => setTimeout(r, 150));

    expect(seen.length).toBe(atReturn);
    /* Not vacuous: progress really was reported while the step was running. */
    expect(atReturn).toBeGreaterThan(0);
    expect(run.assets.entries).toHaveLength(40);
  });

  /**
   * **The half that matters more than the timing.**
   *
   * An image dropped silently is indistinguishable from an article that never
   * had it — `assetIndex` gives "failed" and "never looked at" the same answer
   * on purpose, so the manifest is the only place the difference survives. Both
   * kinds are asserted separately below because they reach the failure by
   * different paths: two were abandoned with a request already on the wire, the
   * other eight never got a queue permit at all.
   */
  it("records every unvisited and abandoned image as an explicit out-of-time failure", async () => {
    const { blocks, urls } = article(10);
    const net = slow(250, PNG);
    const run = await collectAssets({
      blocks,
      fetchImpl: net.impl,
      blobs: fakeBlobs(),
      limits: { budgetMs: 80 },
    });

    expect(run.assets.entries).toHaveLength(urls.length);
    expect(reasons(run.assets)).toEqual(urls.map(() => "out-of-time"));
    expect(run.stored).toBe(0);
    expect(run.failed).toBe(urls.length);

    /* The two halves, told apart by the fixture rather than by the manifest. */
    expect(net.aborted.length).toBeGreaterThan(0);
    expect(net.asked.length).toBeLessThan(urls.length);
    for (const url of net.aborted) {
      expect(stored(run.assets, url)).toMatchObject({ status: "failed", reason: "out-of-time" });
    }
    for (const url of urls.filter((u) => !net.asked.includes(u))) {
      expect(stored(run.assets, url)).toMatchObject({ status: "failed", reason: "out-of-time" });
    }
  });

  /**
   * **`network` is what an abandoned image lands on if nobody decides.**
   *
   * `fetchAsset` turns a caller's signal into `FetchFailure("timeout", …)`
   * (src/fetch.ts `abortFailure`), and `FAILURE_FOR.timeout` is `network` —
   * "the far end was slow, try later", which is a lie about an image we never
   * gave a chance. Reuse `budget` instead and it collapses into the
   * *image-count* overflow, which is a different decision with a different fix.
   * Both of those are silent; this test is the thing that is not.
   */
  /**
   * **The classifier, on the shape the real one actually produces.**
   *
   * Measured against `fetchAsset` itself (scripts under
   * `docs/plans/…`; the run is in the report): `undici` rejects a fetch with the
   * signal's **abort reason**, and that lands in `classifyNetworkError`, not in
   * `abortFailure`. So the code depends on what the aborting party passed to
   * `.abort()`:
   *
   *     per-image AbortSignal.timeout -> TimeoutError -> code "timeout"
   *     our deadline's .abort(Error)  -> plain Error  -> code "connection"
   *
   * `connection` maps to `network`. Every other test in this block uses a fake
   * that rejects with `FetchFailure("timeout")`, which is the *other* branch —
   * so the branch that ships was tested by nothing. This fake rejects with the
   * real branch's shape, and quickly enough to reach `one`'s catch before the
   * race hands the manifest back, which is what makes the classifier
   * observable at all.
   */
  it("calls an abandoned image out-of-time on the shape the real classifier emits", async () => {
    const { blocks, urls } = article(4);
    const impl: AssetFetch = (url, o) =>
      new Promise((_, reject) => {
        const giveUp = (): void =>
          /* Exactly what `classifyNetworkError` builds for our abort reason:
             code "connection", not "timeout", carrying the reason as `cause`. */
          reject(
            new FetchFailure("connection", url, `Couldn't reach cdn.test`, {
              cause: o.signal?.reason,
            }),
          );
        if (o.signal?.aborted) giveUp();
        else o.signal?.addEventListener("abort", giveUp, { once: true });
      });

    const run = await collectAssets({
      blocks,
      fetchImpl: impl,
      blobs: fakeBlobs(),
      limits: { budgetMs: 60 },
    });
    expect(reasons(run.assets)).toEqual(urls.map(() => "out-of-time"));
    expect(reasons(run.assets)).not.toContain("network");
  });

  it("does not file a deadline as a network fault, nor a real fault as a deadline", async () => {
    const { blocks, urls } = article(10);
    const gone = new Set([urls[0], urls[1]]);
    const late = slow(250, PNG);
    const impl: AssetFetch = (url, o) =>
      gone.has(url)
        ? Promise.reject(new FetchFailure("not-found", url, "404", { status: 404 }))
        : late.impl(url, o);

    const run = await collectAssets({
      blocks,
      fetchImpl: impl,
      blobs: fakeBlobs(),
      limits: { budgetMs: 100 },
    });

    /* The two images that really were missing keep saying so. A deadline that
       relabelled every failure after it fired would pass "everything is
       out-of-time" while destroying the only signal that says re-running will
       not help. */
    expect(reasons(run.assets).slice(0, 2)).toEqual(["not-found", "not-found"]);
    /* And the eight the clock beat say the clock beat them — not `network`,
       which promises the far end might answer next time, and not `budget`,
       which is the image-count overflow wearing the same word. */
    expect(reasons(run.assets).slice(2)).toEqual(urls.slice(2).map(() => "out-of-time"));
    expect(reasons(run.assets)).not.toContain("network");
    expect(reasons(run.assets)).not.toContain("budget");
  });

  /**
   * The conservation law: nothing is dropped, in the run where the deadline
   * lands *between* images rather than before all of them.
   *
   * The first two answer instantly, so they are stored whatever the machine is
   * doing — a version of this that let the scheduler decide how many got
   * through would be flaky in exactly the direction that hides the bug.
   */
  it("keeps the images that finished, and accounts for every URL the article had", async () => {
    const { blocks, urls } = article(12);
    const instant = new Set([urls[0], urls[1]]);
    const late = slow(250, PNG);
    const impl: AssetFetch = (url, o) =>
      instant.has(url)
        ? Promise.resolve({ bytes: PNG, contentType: null, finalUrl: url })
        : late.impl(url, o);

    const run = await collectAssets({
      blocks,
      fetchImpl: impl,
      blobs: fakeBlobs(),
      limits: { budgetMs: 100 },
    });

    /* Every URL the article had, once, in document order — nothing dropped and
       nothing invented. */
    expect(run.assets.entries.map((e) => e.url)).toEqual(urls);
    expect(run.stored + run.failed).toBe(urls.length);
    expect(run.stored).toBe(2);
    expect(reasons(run.assets).slice(0, 2)).toEqual(["stored", "stored"]);
    expect(reasons(run.assets).slice(2).every((r) => r === "out-of-time")).toBe(true);
  });

  /**
   * **The control, and it matters as much as the tests above.**
   *
   * A budget that quietly degraded the ordinary article would be worse than the
   * bug it fixes. This runs a normal article under the *real* default budget
   * and asserts the manifest is exactly what it was before the deadline
   * existed — and, in particular, that the step returns as soon as the work is
   * done rather than sitting on its timer for five minutes.
   */
  it("leaves an article that finishes comfortably inside the budget completely alone", async () => {
    const urls = ["https://cdn.test/a.png", "https://cdn.test/b.jpg", "https://cdn.test/c.gif"];
    const net = scripted({ [urls[0]!]: PNG, [urls[1]!]: JPEG, [urls[2]!]: GIF });
    const began = Date.now();
    const run = await collectAssets({
      blocks: urls.map((u) => img(u)),
      fetchImpl: net.impl,
      blobs: fakeBlobs(),
      /* No `limits` at all — the production numbers, deadline included. */
    });
    const elapsed = Date.now() - began;

    expect(run.stored).toBe(3);
    expect(run.failed).toBe(0);
    expect(reasons(run.assets)).toEqual(["stored", "stored", "stored"]);
    expect(run.assets.entries.map((e) => (e.status === "stored" ? e.ext : e.status))).toEqual([
      "png",
      "jpeg",
      "gif",
    ]);
    /* Every fetch was handed the untouched per-image policy — the deadline is
       an extra signal, not a smaller cap or a shorter per-image timeout. */
    expect(net.opts.every((o) => o.maxBytes === MAX_IMAGE_BYTES)).toBe(true);
    expect(net.opts.every((o) => o.timeoutMs === 15_000)).toBe(true);
    /* It came back now, not in five minutes. `await`ing the deadline instead of
       racing it, or forgetting to `clearTimeout`, would pass every assertion
       above and hang the pipeline for `ASSETS_BUDGET_MS` on every article. */
    expect(elapsed).toBeLessThan(5_000);
    expect(GATE.inFlight).toBe(0);
  });

  /**
   * **The real bound lives in `tests/jobs-lease-budget.test.ts`, and this is a
   * pointer to it rather than a second copy.**
   *
   * There used to be an assertion here that `ASSETS_BUDGET_MS` was under 90% of
   * one step's deadline. It went **quiet** on 2026-08-30 without anyone
   * touching it: `LEASE_MS` was raised 420s → 760s in `38ea362` for reasons
   * that had nothing to do with this step, and the bound is derived from
   * `LEASE_MS`, so it silently loosened from permitting 340s to permitting
   * **666s** — while the arithmetic that actually constrains this constant
   * leaves it **399.6s** (740s deadline, less `hierarchy` at 320.4s, less the cheap
   * steps). It would have gone green on a budget 266s too large, and it was
   * still passing when it was found.
   *
   * That is the failure this repo keeps writing up, in a new costume: not a
   * guard that was deleted, but one whose *input* moved underneath it in
   * another workstream, leaving something green, load-bearing-looking, and
   * enforcing nothing. Nobody in either workstream could see it, because each
   * side's own tests were correct.
   *
   * So the bound is asserted **once**, over the sum of every default step,
   * against `maxDuration` — the one number that binds whether a job runs as one
   * claim or several. Duplicating it here would put a second source of truth
   * beside the constant, which is exactly how the first one drifted.
   */
  it("is bounded by the whole-job budget, asserted in tests/jobs-lease-budget.test.ts", () => {
    /* Kept local because it is about this constant and cannot drift: a budget
       of zero or less never bites, whatever the job model is. */
    expect(ASSETS_BUDGET_MS).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * The artefact
 * ------------------------------------------------------------------ */

describe("the manifest itself", () => {
  it("stamps itself with the blocks it was built from and a string version", async () => {
    const blocks = [img("https://cdn.test/a.png")];
    const run = await collectAssets({
      blocks,
      fetchImpl: scripted({ "https://cdn.test/a.png": PNG }).impl,
      blobs: fakeBlobs(),
      now: () => new Date("2026-08-29T10:00:00.000Z"),
    });
    expect(run.assets.sourceHash).toBe(hashBlocks(blocks));
    expect(run.assets.fetchedAt).toBe("2026-08-29T10:00:00.000Z");
    /* **A string, and `stampOf` is why.** It reads `version` only
       `if (typeof a.version === "string")`, so a number here would be dropped
       and no article would ever re-run this step after a change to what it
       decides. src/store/artifacts.ts. */
    expect(typeof run.assets.version).toBe("string");
    expect(run.assets.version).toBe(ASSETS_VERSION);
  });

  it("says the step ran and found nothing, which is not the same as never running", async () => {
    const run = await collectAssets({
      blocks: [block("<p>No pictures here.</p>")],
      fetchImpl: scripted({}).impl,
      blobs: fakeBlobs(),
    });
    expect(run.assets.entries).toEqual([]);
    /* An `Assets` exists. The third state — no manifest at all — is the caller's
       `undefined`, and `assetIndex` gives both the same empty map on purpose. */
    expect(run.assets.version).toBe(ASSETS_VERSION);
  });
});

/* ------------------------------------------------------------------ *
 * The seam, with the real function on the other side of it
 * ------------------------------------------------------------------ */

/**
 * **The two sides, joined, with the real value crossing between them.**
 *
 * Stage A built `fetchAsset` and stage B built this consumer against one agreed
 * `AssetFetch`. Both suites can be green with nothing ever having passed
 * between them, and the failure would be a runtime shape — a missing field, a
 * `Buffer` where a `Uint8Array` was promised — which no type annotation catches.
 * So these two drive the actual `fetchAsset` through `collectAssets`'s own
 * `fetchImpl` parameter, with `fetch.ts`'s injected `fetchImpl` underneath so
 * nothing touches a network.
 */
describe("the real fetchAsset satisfies the seam", () => {
  /** The real function, wearing the seam's narrow shape. */
  function realFetch(underlying: FetchLike): AssetFetch {
    return (url, opts) => {
      const full: AssetFetchOptions = {
        maxBytes: opts.maxBytes,
        timeoutMs: opts.timeoutMs,
        ...(opts.signal ? { signal: opts.signal } : {}),
        fetchImpl: underlying,
        /* No retries and no waiting: the failure case below is a plain 404,
           which is not retryable anyway, and a real `sleep` would only make
           the suite slower. */
        attempts: 1,
        sleep: async () => undefined,
        resolve: async () => ["93.184.216.34"],
      };
      return fetchAsset(url, full);
    };
  }

  it("stores what it hands back, on a success", async () => {
    const underlying: FetchLike = async () =>
      new Response(PNG, { status: 200, headers: { "content-type": "application/octet-stream" } });
    const blobs = fakeBlobs();
    const run = await collectAssets({
      blocks: [img("https://cdn.test/real.png")],
      fetchImpl: realFetch(underlying),
      blobs,
    });

    const entry = stored(run.assets, "https://cdn.test/real.png");
    expect(entry).toMatchObject({ status: "stored", ext: "png", contentType: "image/png" });
    /* The bytes really made it through the seam and into the bucket, at a name
       that is their hash. `bytes` proves it is the whole file and not an empty
       buffer that would have sniffed as nothing. */
    expect((entry as { bytes: number }).bytes).toBe(PNG.byteLength);
    expect(blobs.objects.size).toBe(1);
    expect([...blobs.objects.values()][0]).toEqual(PNG);
  });

  it("classifies what it throws, on a failure", async () => {
    const underlying: FetchLike = async () => new Response("gone", { status: 404 });
    const run = await collectAssets({
      blocks: [img("https://cdn.test/missing.png")],
      fetchImpl: realFetch(underlying),
      blobs: fakeBlobs(),
    });
    /* `FetchFailure` really reaches the `instanceof` arm, with a code the map
       covers. Return a plain `Error` from `fetchAsset` instead and this comes
       back `storage` — which is the whole point of asserting the reason rather
       than only that it failed. */
    expect(stored(run.assets, "https://cdn.test/missing.png")).toMatchObject({
      status: "failed",
      reason: "not-found",
    });
    expect(run.storageErrors).toEqual([]);
  });

  /**
   * **The deadline, across the seam, with the real classifier on the far side.**
   *
   * Every other wall-clock test above uses a fake that rejects with
   * `FetchFailure("timeout", …)`, because that is what a caller's abort *looks
   * like* from `abortFailure` (src/fetch.ts:415). It is not what the real path
   * produces. `undici` rejects a fetch with the signal's **abort reason**, and
   * that reason goes to `classifyNetworkError`, not to `abortFailure` — so the
   * code depends on what the aborting party passed to `.abort()`. Measured:
   *
   *     per-image AbortSignal.timeout  -> TimeoutError -> code "timeout"
   *     .abort(new Error("…"))         -> plain Error  -> code "connection"
   *
   * `connection` maps to `network`, so every image abandoned at the deadline
   * would be filed as "the far end was slow, try later" — the exact lie this
   * whole change exists to stop, on the only path that ships. Both sides green,
   * the value crossing between them never once exercised.
   * docs/reusable/silent-success.md.
   *
   * The fake below rejects with `signal.reason`, which is what undici does.
   */
  it("still calls an abandoned image out-of-time when the real classifier sees it", async () => {
    const underlying: FetchLike = (_url, init) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        const giveUp = (): void => reject(signal?.reason);
        if (signal?.aborted) giveUp();
        else signal?.addEventListener("abort", giveUp, { once: true });
      });

    const urls = [0, 1, 2, 3].map((i) => `https://cdn.test/hang${i}.png`);
    const run = await collectAssets({
      blocks: urls.map((u) => img(u)),
      fetchImpl: realFetch(underlying),
      blobs: fakeBlobs(),
      limits: { budgetMs: 80 },
    });

    expect(reasons(run.assets)).toEqual(urls.map(() => "out-of-time"));
    expect(reasons(run.assets)).not.toContain("network");
    expect(run.storageErrors).toEqual([]);
  });
});
