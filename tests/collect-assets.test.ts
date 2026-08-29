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

const stored = (a: Assets, url: string) => a.entries.find((e) => e.url === url);

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
});
