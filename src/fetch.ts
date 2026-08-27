/**
 * Stage 1 — get the bytes, and know what they are.
 *
 * This is the only place in the repo that talks to the open web on a reader's
 * behalf, and it is the stage most exposed to other people's servers: every
 * failure here is somebody else's misconfiguration arriving as a surprise. So
 * it is written to fail *legibly* — a typed code and a sentence a human can act
 * on — rather than to fail rarely. See docs/project/fetching.md, which records
 * the evidence behind every number and rule below.
 *
 * Three things it does that a bare `fetch(url).then(r => r.text())` does not,
 * each of which was a real observed bug rather than a precaution:
 *
 *  1. **It counts bytes as they arrive.** `Content-Length` describes the
 *     *compressed* wire size when the server compresses — google.com reports
 *     86,616 and hands you 285,514 — so a cap read off the header is a cap on
 *     the wrong number, and under chunked encoding there is no header at all.
 *  2. **It decodes with the page's own encoding.** `res.text()` always assumes
 *     UTF-8. A Shift_JIS page that declares itself only in a `<meta>` tag comes
 *     back as mojibake, silently, with every downstream stage none the wiser.
 *  3. **It knows a PDF from an HTML page by looking at the bytes**, because
 *     publishers serve PDFs as `application/octet-stream` and error pages as
 *     `application/pdf`.
 *
 * **Everything it touches from outside is injectable** — the fetch itself, the
 * clock, the sleep between retries, the DNS lookup, the jitter. That is not
 * ceremony: it is the only way the interesting cases (an incomplete certificate
 * chain, a redirect loop, a 4.9 MB PDF, a lying `Content-Length`) become
 * deterministic tests instead of a network flake in CI. See tests/fetch.test.ts.
 *
 * Nothing here is top-level `await`, deliberately — for the reason spelled out
 * at `main()` in src/blocks.ts. With one, this module becomes an async module,
 * and importing it would also *run* it.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { TextDecoder as SpecTextDecoder } from "@exodus/bytes/encoding.js";
import sniffHTMLEncoding from "html-encoding-sniffer";
import { slugFromUrl } from "./ingest.js";
import { storeRawSource } from "./store/blobs.js";

/* ------------------------------------------------------------------ *
 * What comes back
 * ------------------------------------------------------------------ */

/** The two things we can do anything with. Everything else is refused by name. */
export type DocumentKind = "html" | "pdf";

export interface FetchedDocument {
  /** What the caller asked for, verbatim. */
  requestedUrl: string;
  /**
   * Where we ended up after redirects.
   *
   * **This is the URL to keep**, not `requestedUrl`. It is the base relative
   * links resolve against, and a `doi.org` or `t.co` address is not what anyone
   * means by "where this article lives".
   */
  url: string;
  /** Every URL in the chain, requested first, final last. One entry if no redirect. */
  chain: string[];
  status: number;
  kind: DocumentKind;
  /** The `Content-Type` header verbatim, or `null` — some servers send none at all. */
  contentType: string | null;
  bytes: Uint8Array;
  /** HTML only, decoded with `encoding` below. `null` for a PDF. */
  text: string | null;
  /** The WHATWG encoding name actually used. `null` for a PDF. */
  encoding: string | null;
  fetchedAt: string;
}

/**
 * **What stage 1 left on disk, and which file is authoritative.**
 *
 * Written as `raw.json` beside the bytes. Stage 2 reads this rather than
 * looking to see which raw file exists, and that difference is the whole reason
 * it exists: a re-fetch of a URL that used to serve HTML and now serves a PDF
 * leaves `raw.html` and `raw.pdf` side by side, and "whichever is there" then
 * makes a stale file authoritative by accident — silently, with the article
 * still rendering. Found by a GPT Sol review of the plan before it was built.
 *
 * It is also where the fields `fetchDocument` already returns and the pipeline
 * used to throw away finally survive: the final URL after redirects, the
 * content type the server claimed, the byte length and the hash. Those are the
 * provenance the Postgres migration needs and could not get
 * (docs/plans/postgres-migration.md § raw.html is not raw).
 */
export interface RawManifest {
  kind: DocumentKind;
  /** The file beside this manifest that holds the bytes — `raw.html` or `raw.pdf`. */
  file: string;
  /**
   * How we came by this document. **Absent means `"url"`**, which is what every
   * manifest written before uploads existed is.
   *
   * The two origins are the same artefact from stage 2 onwards, so this field
   * exists for the three things that genuinely have to know: the acquisition
   * step (src/pipeline.ts), `GET /api/source/:slug`, and anything asking "can a
   * refresh re-fetch this?" — for an upload the answer is no, and saying so is
   * better than a refresh that fails.
   */
  origin?: "url" | "upload";
  /**
   * The two URLs, present **only for a fetched document**.
   *
   * Optional since uploads arrived, and deliberately optional rather than
   * filled with a placeholder: `file://…` or `upload://…` reads as an address
   * to every caller downstream, and not one of them would have complained.
   * Making the typechecker ask instead is the entire benefit.
   */
  requestedUrl?: string;
  url?: string;
  /** Upload only — our id for the attempt, and the reader's own name for the file. */
  uploadId?: string;
  filename?: string;
  contentType: string | null;
  encoding: string | null;
  bytes: number;
  /**
   * SHA-256 of the fetched bytes.
   *
   * `null` only in a **backfilled** manifest — one written for an article
   * fetched before manifests existed, where the bytes are gone and only the
   * decoded string survives. Hashing that instead would produce a real-looking
   * number that answers a different question, which is worse than admitting we
   * do not know.
   */
  sha256: string | null;
  /**
   * SHA-256 of the bytes **we stored**, which is the key of the object in the
   * `sources` bucket — `canonicalKey(storedSha256, kind)`.
   *
   * Not the same question as `sha256` above, and the two names are deliberately
   * not near-identical: that one is what the server sent, this is what is on
   * disk and in the bucket. For a PDF they are equal. For HTML they are equal
   * only when the page was already UTF-8, because `writeRaw` stores the decoded
   * string — src/fetch.ts's own comment has said "raw.html is therefore not
   * raw" for longer than this field has existed.
   *
   * Optional, because every manifest written before 2026-08-27 has no object
   * behind it. Absent means *we have not put this document in the bucket*,
   * which is a fact rather than a gap. docs/plans/raw-bytes-in-storage.md.
   */
  storedSha256?: string;
  /**
   * How many bytes are at `storedSha256` — the size of the object in the
   * `sources` bucket, which is **not** `bytes` above.
   *
   * `bytes` counts what the network sent. This counts what we kept, and for any
   * page that was not already UTF-8 those differ for exactly the reason the two
   * hashes do: `writeRaw` stores the decoded string. `raw_sources.bytes`
   * describes the object, so it needs this number and cannot use the other one
   * — which the first version of the storage plan assumed it could.
   *
   * Optional, alongside `storedSha256` and for the same reason: every manifest
   * written before 2026-08-27 has no object behind it, and absent is the honest
   * way to say so. GPT Sol, 2026-08-28;
   * docs/plans/artifacts-pg-has-sol.md.
   */
  storedBytes?: number;
  fetchedAt: string;
  /** Present only on a backfilled manifest, saying so in a sentence. */
  backfilled?: string;
}

/** The bytes and the manifest, together, so the two cannot disagree. */
export async function writeRaw(dir: string, doc: FetchedDocument): Promise<RawManifest> {
  const file = doc.kind === "pdf" ? "raw.pdf" : "raw.html";
  await mkdir(dir, { recursive: true });
  /* HTML is written as the decoded string, not the fetched bytes — every later
     stage wants text, and the encoding sniff above is the only place that knows
     how to decode it. The manifest records the encoding so that stays visible;
     `raw.html` is therefore not raw, which src/db/schema.ts says out loud. */
  /* One value written to two places, rather than the same expression twice.
     The file and the object have to be the same bytes or the hash below is
     about something nobody has. */
  const storedBytes =
    doc.kind === "pdf" ? doc.bytes : new TextEncoder().encode(doc.text ?? "");
  await writeFile(path.join(dir, file), storedBytes);
  /* **The object goes to the blob store too, keyed by the hash of what we
     actually stored.**
     
     Not `manifest.sha256`, which hashes the bytes off the *network* — and for
     HTML those are not the bytes above, because this function writes the
     decoded string. Two different questions, and conflating them puts bytes
     under a name that does not describe them, which is the one thing content
     addressing must never do. docs/plans/raw-bytes-in-storage.md § The backfill
     can put the wrong bytes under a hash is the same mistake found the other
     way round. For a PDF, and for a page that was already UTF-8, the two hashes
     are equal.

     Here rather than at the two call sites, so `npm run fetch` and the pipeline
     cannot drift again — they already did once, and this function is the fix
     for that. Idempotent and outside any transaction, which is safe because the
     key is the contents: writing twice is a no-op, and an object nothing
     references is one we keep on purpose. `storeRawSource` verifies a dedup hit
     rather than trusting it. */
  const stored = await storeRawSource(storedBytes, doc.kind);

  const manifest: RawManifest = {
    kind: doc.kind,
    file,
    requestedUrl: doc.requestedUrl,
    url: doc.url,
    contentType: doc.contentType,
    encoding: doc.encoding,
    bytes: doc.bytes.byteLength,
    sha256: createHash("sha256").update(doc.bytes).digest("hex"),
    storedSha256: stored.sha256,
    /* The length of what was written above, not of what arrived. `writeRaw`
       computes `storedBytes` and recorded only its hash until now, so
       `raw_sources.bytes` had no source but a second call to the bucket. */
    storedBytes: storedBytes.byteLength,
    fetchedAt: doc.fetchedAt,
  };
  await writeFile(path.join(dir, "raw.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

/**
 * The manifest, or `null` where a fetch predates it.
 *
 * **Null must mean "assume HTML", not "fail".** Every article ingested before
 * this existed has a `raw.html` and no `raw.json`, and refusing to extract
 * those would turn a new field into a migration. The caller decides; this
 * function only reports.
 */
export async function readRaw(dir: string): Promise<RawManifest | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "raw.json"), "utf8")) as RawManifest;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * How it fails
 * ------------------------------------------------------------------ */

/**
 * Why a fetch failed, as something to switch on.
 *
 * These exist because **every network and TLS failure in Node arrives as the
 * identical `TypeError: fetch failed`** — DNS, refused connection, expired
 * certificate, self-signed certificate and a missing intermediate are one
 * string at the top level, and the difference lives only in `err.cause.code`.
 * Code that matches on the message learns nothing, which is exactly the trap
 * the previous version fell into (docs/project/original-version/extraction.md).
 */
export type FetchFailureCode =
  | "invalid-url"
  | "unsupported-scheme"
  | "blocked-address"
  | "dns"
  | "connection"
  | "certificate"
  | "timeout"
  | "too-many-redirects"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "server-error"
  | "http-error"
  | "too-large"
  | "unsupported-type"
  | "empty";

export class FetchFailure extends Error {
  readonly code: FetchFailureCode;
  readonly url: string;
  /** The HTTP status, where there was one. `null` for anything that never got a response. */
  readonly status: number | null;
  /** Whether trying the identical request again could plausibly work. */
  readonly retryable: boolean;
  /** What the server asked us to wait, from `Retry-After`, in ms. */
  readonly retryAfterMs: number | null;

  constructor(
    code: FetchFailureCode,
    url: string,
    message: string,
    extra: {
      status?: number | null;
      retryable?: boolean;
      retryAfterMs?: number | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = "FetchFailure";
    this.code = code;
    this.url = url;
    this.status = extra.status ?? null;
    this.retryable = extra.retryable ?? false;
    this.retryAfterMs = extra.retryAfterMs ?? null;
  }
}

/* ------------------------------------------------------------------ *
 * Knobs
 * ------------------------------------------------------------------ */

/**
 * What we tell the far end we are.
 *
 * A browser string, not an honest one, and that is a deliberate and slightly
 * uncomfortable call — docs/project/fetching.md#the-user-agent-question has the
 * argument. The short version: a reader pasting one URL they want to read is
 * doing what a browser does, and an honest `Spideryarn/1.0` gets a stub or a
 * 403 from a meaningful share of publishers. Override it in one line if you
 * disagree; nothing else depends on the value.
 */
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * The defaults, exported so tests and docs can quote them rather than repeat them.
 *
 * `maxBytes` is 32 MB and the number has a source: the previous version capped
 * at 4 MB, and one of the three articles Greg named as a representative hard
 * case — the Nagel PDF at `sas.upenn.edu` — is 4,930,377 bytes. A cap chosen
 * without a real document in front of you rejects real documents.
 */
export const DEFAULTS = {
  timeoutMs: 30_000,
  maxBytes: 32 * 1024 * 1024,
  attempts: 3,
  maxRedirects: 5,
  userAgent: USER_AGENT,
} as const;

/** Just the part of `fetch` we use, so a test can supply a function instead of a network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Total tries, not extra tries. 1 disables retrying. */
  attempts?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** Cancellation from above — the ingest queue's, in practice. */
  signal?: AbortSignal;
  /* --- seams, for tests --- */
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Hostname → IP addresses. Injected so the address guard can be tested without DNS. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Jitter source. Injected so retry delays are assertable. */
  random?: () => number;
}

interface Resolved {
  timeoutMs: number;
  maxBytes: number;
  attempts: number;
  maxRedirects: number;
  userAgent: string;
  signal: AbortSignal | null;
  fetchImpl: FetchLike;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  resolve: (hostname: string) => Promise<string[]>;
  random: () => number;
}

/**
 * A caller's number, or the default — but never a value that turns a bound into
 * no bound.
 *
 * Each of these numbers is a safety limit that something else compares against,
 * so the ways they can be wrong are not symmetrical. `NaN` is the sharp one:
 * `total > NaN` is false for every total, so a `NaN` byte cap doesn't raise the
 * ceiling, it **removes** it, silently, with the code still reading as though a
 * cap were in force. `Infinity` retries forever. Nonsense falls back to the
 * default; a real number is clamped to a range this module can defend.
 */
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function withDefaults(options: FetchOptions): Resolved {
  return {
    timeoutMs: bounded(options.timeoutMs, DEFAULTS.timeoutMs, 1, 10 * 60_000),
    maxBytes: bounded(options.maxBytes, DEFAULTS.maxBytes, 1, 2 * 1024 * 1024 * 1024),
    attempts: bounded(options.attempts, DEFAULTS.attempts, 1, 5),
    maxRedirects: bounded(options.maxRedirects, DEFAULTS.maxRedirects, 0, 20),
    userAgent: options.userAgent ?? DEFAULTS.userAgent,
    signal: options.signal ?? null,
    fetchImpl: options.fetchImpl ?? ((url, init) => fetch(url, init)),
    sleep: options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    now: options.now ?? (() => new Date()),
    resolve: options.resolve ?? defaultResolve,
    random: options.random ?? Math.random,
  };
}

/**
 * A `FetchFailure` for a signal that fired, told apart by what fired it.
 *
 * `AbortSignal.timeout` sets a `TimeoutError` as the reason; a caller's own
 * cancellation sets something else or nothing. One is worth retrying and the
 * other emphatically is not.
 */
function abortFailure(signal: AbortSignal, url: string): FetchFailure {
  const reason: unknown = signal.reason;
  const timedOut = reason instanceof Error ? reason.name === "TimeoutError" : false;
  return timedOut
    ? new FetchFailure("timeout", url, "That site took too long to answer.", { retryable: true })
    : new FetchFailure("timeout", url, "Fetch cancelled.");
}

/**
 * Run a promise under a signal, so work that doesn't take one still stops.
 *
 * `fetch` honours an `AbortSignal`; `dns.lookup` and a `setTimeout` sleep do
 * not. Without this, a deadline of 30 seconds is really "30 seconds, plus
 * however long the resolver feels like taking" — and a hung resolver is a real
 * thing rather than a hypothetical one. The losing promise is left to settle on
 * its own; nothing is waiting on it any more.
 */
function underSignal<T>(work: Promise<T>, signal: AbortSignal, url: string): Promise<T> {
  if (signal.aborted) return Promise.reject(abortFailure(signal, url));
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(abortFailure(signal, url)), { once: true });
    }),
  ]);
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const found = await dnsLookup(hostname, { all: true });
  return found.map((entry) => entry.address);
}

/* ------------------------------------------------------------------ *
 * The URL, before we dial it
 * ------------------------------------------------------------------ */

/**
 * Parse and vet a URL, or say why not.
 *
 * The scheme allow-list is the whole of the cheap half of SSRF defence, and it
 * is worth having even here: `file:///etc/passwd` pasted into the add box
 * should be a sentence, not a read.
 */
export function parseTarget(input: string): URL {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new FetchFailure("invalid-url", trimmed, `That isn't a URL: ${trimmed}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchFailure(
      "unsupported-scheme",
      trimmed,
      `Only http and https are fetched, not ${url.protocol.replace(":", "")}.`,
    );
  }
  return url;
}

/**
 * Is this address one we should refuse to dial?
 *
 * Loopback, private, link-local, multicast and the reserved ranges. The point
 * is not a hardened SSRF boundary — this app is one person's, and the URL comes
 * from their own text box — it is that `http://localhost:5273/` and
 * `http://169.254.169.254/` are never articles, and refusing them by name costs
 * one function.
 *
 * **The known gap, stated on purpose:** we resolve the hostname and then let
 * `fetch` resolve it again to connect, so a DNS answer that changes in between
 * slips past. Closing that means pinning the resolved address through a custom
 * undici dispatcher, which is a dependency and a lot of machinery for an
 * attacker who would already need to control both a domain's DNS and Greg's
 * clipboard. Revisit if this ever accepts a URL from anyone else.
 */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isBlockedIPv4(address);
  if (kind === 6) return isBlockedIPv6(address);
  return false;
}

function isBlockedIPv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a = 0, b = 0, c = 0] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  /* 192.0.0.0/24 and 192.0.2.0/24, and note the mask: this said `b === 0` at
     first, which is 192.0.0.0/**16** and blocks 192.0.78.0/24 — Automattic's
     range, so every WordPress.com blog. An over-wide block here refuses real
     articles and says "not a public address", which is both wrong and confusing. */
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * The 128 bits of an IPv6 address as eight groups, `::` expanded.
 *
 * Written out rather than pattern-matched because the interesting addresses
 * here are the ones wearing a disguise, and there are several disguises: the
 * WHATWG URL parser turns `[::127.0.0.1]` into `[::7f00:1]`, so a check that
 * looks for a dotted quad misses a loopback address that arrived as hex.
 * Returns null for anything malformed, which `isIP` has already ruled out.
 */
function expandIPv6(address: string): number[] | null {
  let text = address;

  /* A trailing dotted quad — ::ffff:127.0.0.1 — is two groups written in
     decimal. Fold it into hex so the rest of this only handles one notation. */
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (dotted?.[1]) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    const hex = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    text = text.slice(0, dotted.index) + hex;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const split = (part: string | undefined): string[] => (part ? part.split(":") : []);
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const groups = halves.length === 2 ? head.length + tail.length : head.length;
  if (groups > 8 || (halves.length === 1 && groups !== 8)) return null;

  const parse = (group: string): number => Number.parseInt(group, 16);
  const filled = [...head.map(parse), ...new Array<number>(8 - groups).fill(0), ...tail.map(parse)];
  return filled.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff) ? null : filled;
}

function isBlockedIPv6(address: string): boolean {
  const groups = expandIPv6(address.toLowerCase());
  if (!groups) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;

  /* An IPv4 address wearing an IPv6 coat: ::ffff:0:0/96 (mapped) and ::/96
     (the deprecated compatible form). Judge it as the IPv4 address it is. */
  const topIsZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (topIsZero && (g5 === 0xffff || g5 === 0)) {
    const packed = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
    /* ::0 and ::1 land here as 0.0.0.0 and 0.0.0.1, and 0.0.0.0/8 is blocked
       anyway — so the unspecified and loopback addresses need no special case. */
    return isBlockedIPv4(packed);
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local, fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local, fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return true; // site-local, fec0::/10 — deprecated, still routed on some networks
  if ((g0 & 0xff00) === 0xff00) return true; // multicast, ff00::/8
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation, 2001:db8::/32
  return false;
}

async function guardAddress(url: URL, opts: Resolved, signal: AbortSignal): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new FetchFailure("blocked-address", url.toString(), `${host} is not a public address.`);
    }
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new FetchFailure("blocked-address", url.toString(), "localhost is not an article.");
  }

  let addresses: string[];
  try {
    addresses = await underSignal(opts.resolve(host), signal, url.toString());
  } catch (err) {
    throw classifyNetworkError(err, url.toString());
  }
  const blocked = addresses.find((address) => isBlockedAddress(address));
  if (blocked !== undefined) {
    throw new FetchFailure(
      "blocked-address",
      url.toString(),
      `${host} resolves to ${blocked}, which is not a public address.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Reading the response
 * ------------------------------------------------------------------ */

/**
 * Read a body, counting as we go, and give up the moment it is too big.
 *
 * The counting is the point. By the time bytes reach here they are already
 * decompressed — undici does that for us — so this caps the size that actually
 * matters rather than the size the server advertised. `cancel()` closes the
 * socket rather than politely draining however many gigabytes are still coming.
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number, url: string): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new FetchFailure(
          "too-large",
          url,
          `That page is over the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
        );
      }
      chunks.push(value);
    }
  } catch (err) {
    /* Every way out of that loop except a clean finish leaves a socket open —
       going over the cap, and also the read itself failing mid-body, which is
       the one easy to forget. Cancelling twice is harmless; not cancelling
       leaves the server streaming into nothing. */
    await reader.cancel().catch(() => {});
    throw err;
  } finally {
    /* Without this the stream stays locked after we are done with it, so
       nothing else can ever read or cancel it. */
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** The MIME type on its own, lower-cased, without the parameters. */
export function mimeType(contentType: string | null): string | null {
  if (!contentType) return null;
  const [type = ""] = contentType.split(";");
  const trimmed = type.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * The charset parameter of a `Content-Type`, or `null`.
 *
 * The quote-stripping is not defensive programming: Instagram serves
 * `text/html; charset="utf-8"`, quotes included, and a decoder handed `"utf-8"`
 * with the quotes attached either throws or quietly falls back.
 */
export function charsetFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;

  /* Split on semicolons that are not inside a quoted string. A regex cannot do
     this, and the failure is not theoretical: in
     `text/html; note="x;charset=shift_jis"; charset=utf-8` a regex finds the
     semicolon inside the quotes, reads the decoy, and decodes the whole page as
     Shift_JIS. HTTP explicitly allows semicolons inside quoted values
     (RFC 9110 §5.6.6). */
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < contentType.length; i++) {
    const char = contentType[i];
    if (char === undefined) break;
    if (quoted && char === "\\" && i + 1 < contentType.length) {
      current += contentType[i + 1];
      i++;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  for (const part of parts.slice(1)) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim().toLowerCase() !== "charset") continue;
    /* Double quotes were consumed above, as HTTP says they should be. Single
       quotes are not legal here at all, but they turn up, and stripping them
       costs a line. */
    const value = part.slice(at + 1).trim().replace(/^'(.*)'$/, "$1").trim();
    return value === "" ? null : value;
  }
  return null;
}

/**
 * A PDF header, as the format actually defines it: `%PDF-` and a version.
 *
 * Bare `%PDF-` anywhere in the first kilobyte is far looser than the spec, and
 * loose enough to be wrong — an HTML page containing
 * `<script>const h = "%PDF-1.7"</script>` in its head would be classified as a
 * PDF and never rendered.
 */
const PDF_HEADER = /%PDF-\d\.\d/;

/**
 * HTML, PDF, or something we can't read — decided by the bytes first.
 *
 * Header and body disagree often enough that one of them has to win, and the
 * body wins. A PDF served as `application/octet-stream` is still a PDF; a
 * Cloudflare challenge page served as `application/pdf` is still HTML.
 */
export function sniffKind(contentType: string | null, bytes: Uint8Array): DocumentKind | null {
  const mime = mimeType(contentType);

  /* 1030 rather than 1024, so a header starting at byte 1021 isn't cut in half
     by the window it is being looked for in. */
  const head = latin1(bytes.subarray(0, 1030));
  const pdfAt = PDF_HEADER.exec(head)?.index ?? -1;

  /* The spec puts the header on the first line. Real files sometimes carry a
     little junk in front, so a header further in is still believed — unless the
     server said HTML, in which case a `%PDF-1.7` in the middle of the page is
     far more likely to be text about PDFs than a PDF. */
  const declaredHtml = mime === "text/html" || mime === "application/xhtml+xml";
  if (pdfAt === 0 || (pdfAt > 0 && !declaredHtml)) return "pdf";

  if (declaredHtml) return "html";

  /* No usable header, or a server shrugging with octet-stream: believe the
     markup, but only a **document-level** marker. Matching `<p>` or `<div>`
     would classify `{"template":"<p>hello</p>"}` as a web page. */
  const looksLikeHtml = /<\s*(!doctype\s+html|html[\s>]|head[\s>]|body[\s>])/i.test(head);
  const mimeIsVague =
    mime === null || mime === "text/plain" || mime === "application/octet-stream" || mime === "application/pdf";
  if (looksLikeHtml && mimeIsVague) return "html";
  return null;
}

/** Bytes as characters, one for one. Only ever used to look at markup, never to keep. */
function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/**
 * Decode HTML bytes with the encoding the page actually uses.
 *
 * The order — BOM, then the `Content-Type` charset, then a prescan of the first
 * kilobyte for `<meta charset>`, then a default — is the HTML spec's own
 * algorithm, and `html-encoding-sniffer` is the implementation jsdom uses for
 * exactly this. It is already in the tree as jsdom's dependency; declaring it
 * directly is what stops us reaching through jsdom for it.
 *
 * The default is windows-1252 rather than UTF-8 because that is what the spec
 * and every browser do for `text/html` with nothing declared. It costs nothing
 * on an ASCII page, which is what pages that declare nothing almost always are.
 *
 * **The decoder is not Node's**, and the reason has moved since it was written.
 * Originally: `new TextDecoder("windows-1252")` reported its encoding as
 * `windows-1252` and then decoded the C1 range the way ISO-8859-1 does, so byte
 * 0x93 became U+0093, an invisible control character, where every browser gives
 * U+201C. That is the punctuation of ordinary English prose going missing with
 * nothing raised and nothing logged — docs/reusable/silent-success.md in its
 * purest form. **Node fixed the single-byte encodings in 24.13.1**, and this
 * paragraph no longer describes any Node we would run on.
 *
 * What it still describes is the multi-byte legacy encodings. Those go through
 * ICU, and ICU is not the WHATWG index: Shift_JIS 0x1A/0x1C/0x7F come back
 * rotated and 0x80 is refused, Big5 accepts 0x80 and 0xFF that the spec calls
 * errors, EUC-JP and EUC-KR pass the whole C1 range through. Same failure
 * shape, different alphabet. So `@exodus/bytes` stays. It implements the WHATWG
 * indexes properly, is already in the tree as html-encoding-sniffer's own
 * dependency, and is what that package's README tells you to pair it with.
 *
 * docs/project/fetching.md#the-decoder-is-not-nodes has the measurements and
 * the command to re-run them; the postmortem is
 * docs/postmortems/windows-1252-node-caught-up.md.
 */
export function decodeHtml(bytes: Uint8Array, contentType: string | null): { text: string; encoding: string } {
  const label = charsetFromContentType(contentType);
  /* XHTML is XML, and XML's rules are not HTML's: no `<meta charset>` prescan,
     and UTF-8 rather than windows-1252 when nothing says otherwise. Handing XML
     to the HTML algorithm turns a perfectly ordinary UTF-8 document into
     `caf├⌐`, because windows-1252 will decode any byte sequence at all and so
     can never fail loudly. */
  const xml = mimeType(contentType) === "application/xhtml+xml";
  const encoding = sniffHTMLEncoding(bytes, {
    xml,
    defaultEncoding: xml ? "UTF-8" : "windows-1252",
    ...(label === null ? {} : { transportLayerEncodingLabel: label }),
  });
  try {
    return { text: new SpecTextDecoder(encoding).decode(bytes), encoding };
  } catch {
    /* An encoding the sniffer named and the decoder doesn't know — which should
       be impossible, since both implement the same WHATWG list. Mojibake beats
       nothing, but record the encoding we actually used so the artefact says
       the text is suspect rather than implying it is fine. */
    return { text: new SpecTextDecoder("UTF-8").decode(bytes), encoding: "UTF-8" };
  }
}

/* ------------------------------------------------------------------ *
 * Classifying what went wrong
 * ------------------------------------------------------------------ */

/** `Retry-After`, as milliseconds. Accepts both the seconds form and the HTTP-date form. */
export function retryAfterMs(header: string | null, now: Date): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - now.getTime());
}

/**
 * An HTTP status we didn't want, as a failure worth reading.
 *
 * The distinctions that matter to a reader are "the site is blocking software
 * like this", "you need to be logged in", and "it isn't there" — three
 * different next actions. Everything else can share a sentence.
 */
export function classifyStatus(status: number, url: string, retryAfter: number | null): FetchFailure {
  const extra = { status, retryAfterMs: retryAfter };
  if (status === 401) {
    return new FetchFailure("unauthorized", url, "That page wants you logged in.", extra);
  }
  if (status === 403) {
    return new FetchFailure(
      "forbidden",
      url,
      "That site refused the request. Sites that police automated readers usually answer this way.",
      extra,
    );
  }
  if (status === 404 || status === 410) {
    return new FetchFailure("not-found", url, "There's nothing at that address.", extra);
  }
  if (status === 429) {
    return new FetchFailure("rate-limited", url, "That site is asking us to slow down.", {
      ...extra,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new FetchFailure("server-error", url, `That site is having trouble (HTTP ${status}).`, {
      ...extra,
      retryable: status === 502 || status === 503 || status === 504,
    });
  }
  return new FetchFailure("http-error", url, `Couldn't fetch that page (HTTP ${status}).`, extra);
}

/** Node error codes that mean "the same request might work in a moment". */
const RETRYABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "UND_ERR_SOCKET"]);

/**
 * A thrown `fetch` error, as a failure worth reading.
 *
 * This is the function the whole error taxonomy exists for. Every case below
 * arrives as the same `TypeError: fetch failed`, and `cause.code` is the only
 * thing that separates them.
 */
export function classifyNetworkError(err: unknown, url: string): FetchFailure {
  if (err instanceof FetchFailure) return err;

  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") {
    return new FetchFailure("timeout", url, "That site took too long to answer.", {
      retryable: true,
      cause: err,
    });
  }
  if (name === "AbortError") {
    return new FetchFailure("timeout", url, "Fetch cancelled.", { cause: err });
  }

  /* Two shapes, because two different APIs throw here. `fetch` wraps the real
     error and puts the code on `cause`; `dns.lookup`, which the address guard
     calls first, puts it on the error itself. Reading only `cause.code` — the
     obvious spelling, and the one this had at first — turns every DNS failure
     into a generic connection failure, with the giveaway `getaddrinfo` text
     visible in the message and nothing acting on it. */
  const code = errorCode(err instanceof Error ? err.cause : undefined) || errorCode(err);

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new FetchFailure("dns", url, `Couldn't find the server for ${safeHost(url)}.`, {
      retryable: code === "EAI_AGAIN",
      cause: err,
    });
  }

  /* Certificate-specific codes, deliberately not `/SSL/`: that also matches
     ERR_SSL_WRONG_VERSION_NUMBER, which is a handshake failure with nothing
     wrong with the certificate, and telling someone their certificate is broken
     when it isn't sends them somewhere useless. */
  if (/^(UNABLE_TO_|CERT_|DEPTH_ZERO_|SELF_SIGNED_|ERR_TLS_CERT)/.test(code)) {
    return new FetchFailure("certificate", url, certificateMessage(code), { cause: err });
  }

  if (code !== "") {
    return new FetchFailure("connection", url, `Couldn't reach ${safeHost(url)} (${code}).`, {
      retryable: RETRYABLE_CODES.has(code),
      cause: err,
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new FetchFailure("connection", url, `Couldn't reach ${safeHost(url)}: ${message}`, {
    cause: err,
  });
}

/**
 * What to say about a certificate, and why the incomplete-chain case gets its
 * own paragraph.
 *
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE` means the server sent its own certificate
 * and forgot the intermediate one above it. Browsers and curl repair this
 * silently by fetching the missing certificate from the address written inside
 * the one they were given; **Node does not, and has no plan to**. So the site
 * works perfectly in the browser the reader just checked it in, and fails here,
 * which is the most confusing shape a bug can have. Say so.
 */
function certificateMessage(code: string): string {
  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return (
      "That site's certificate is incomplete — it didn't send the intermediate certificate. " +
      "Browsers fetch the missing one automatically and Node doesn't, which is why the page " +
      "opens fine in a browser. Running with NODE_OPTIONS=--use-system-ca sometimes works, " +
      "because the system may already hold the missing certificate."
    );
  }
  if (code === "CERT_HAS_EXPIRED") return "That site's certificate has expired.";
  return `That site's certificate couldn't be verified (${code}).`;
}

/** A Node error's `code`, wherever it was hung. */
function errorCode(value: unknown): string {
  if (typeof value === "object" && value !== null && "code" in value) {
    const code: unknown = (value as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * How long to wait before trying again.
 *
 * `Retry-After` wins where the server sent one — it is the only party that
 * knows. Otherwise exponential backoff with **full** jitter: a delay drawn
 * uniformly from zero to the ceiling, rather than the ceiling nudged a little.
 * Nobody is being thundered here, but it is one multiplication.
 */
export function retryDelayMs(attempt: number, serverAsked: number | null, random: () => number): number {
  if (serverAsked !== null) return Math.min(serverAsked, 10_000);
  const ceiling = Math.min(500 * 2 ** (attempt - 1), 4_000);
  return Math.round(random() * ceiling);
}

/* ------------------------------------------------------------------ *
 * The fetch itself
 * ------------------------------------------------------------------ */

/**
 * Let go of a response we aren't going to read.
 *
 * Every path that throws before reading the body has to do this or the socket
 * stays open with the server still streaming into it. `cancel()` can itself
 * reject on a body already disturbed or errored, and that rejection would
 * escape as an unclassified error on top of the real one — so it is swallowed
 * deliberately: we are discarding this response either way.
 */
async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch a URL and say what came back.
 *
 * Redirects are followed by hand rather than by `redirect: "follow"`, which is
 * a deliberate cost. Following them ourselves is the only way to cap the hops
 * at a number we chose, to check each new address before dialling it, and to
 * keep the chain — and the chain is worth keeping, because "this resolved
 * somewhere else" is most of the explanation when an article turns out to be a
 * paywall notice.
 */
export async function fetchDocument(input: string, options: FetchOptions = {}): Promise<FetchedDocument> {
  const opts = withDefaults(options);
  const target = parseTarget(input);

  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptFetch(target, input.trim(), opts);
    } catch (err) {
      const failure = classifyNetworkError(err, input.trim());
      if (!failure.retryable || attempt >= opts.attempts) throw failure;
      /* Under the caller's signal, not the attempt's: each attempt gets a fresh
         deadline, but a queue that has been cancelled should not sit out a
         four-second backoff first. */
      const waiting = opts.sleep(retryDelayMs(attempt, failure.retryAfterMs, opts.random));
      await (opts.signal ? underSignal(waiting, opts.signal, input.trim()) : waiting);
    }
  }
}

/** The same fetched thing? The fragment is never sent, so it cannot make it different. */
function sameResource(seen: string, candidate: URL): boolean {
  const bare = new URL(candidate.toString());
  bare.hash = "";
  try {
    const other = new URL(seen);
    other.hash = "";
    return other.toString() === bare.toString();
  } catch {
    return false;
  }
}

async function attemptFetch(target: URL, requestedUrl: string, opts: Resolved): Promise<FetchedDocument> {
  /* One deadline for the whole attempt, redirects included — a chain of five
     hops that are each just under the limit is still a page nobody is waiting
     for. `AbortSignal.any` folds in the queue's cancellation where there is one. */
  const deadline = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline;

  const chain: string[] = [];
  let current = target;

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    await guardAddress(current, opts, signal);
    const here = current.toString();
    chain.push(here);

    /* Classified here, against `here`, rather than in the retry loop above
       against the URL that was typed. After a redirect those are different
       servers, and "couldn't reach example.com" naming the site that answered
       correctly — and redirected us — sends the reader to debug the wrong end. */
    let res: Response;
    try {
      res = await opts.fetchImpl(here, {
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": opts.userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-GB,en;q=0.9",
          /* No Accept-Encoding on purpose. undici sets it and decompresses for
             us; setting it by hand is how you accidentally turn that off. */
        },
      });
    } catch (err) {
      throw classifyNetworkError(err, here);
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      await discard(res);
      if (!location) {
        throw new FetchFailure("http-error", here, `That site redirected without saying where (HTTP ${res.status}).`, {
          status: res.status,
        });
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        // **Not the header.** `location` is written by the remote server, and a
        // `FetchFailure` message is logged — a failed fetch step reaches
        // src/jobs.ts, which keeps a thrown error's `message` and its `stack`,
        // so anything quoted here is written down twice and redaction can reach
        // neither (docs/project/logging.md). A site that redirects to
        // `?token=…`, by malice or by bug, would have put it in the log.
        // The reader loses nothing: they cannot act on an address they never
        // chose to visit, and `code` already says which failure this was.
        throw new FetchFailure("invalid-url", here, "That site redirected somewhere unreadable.");
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new FetchFailure(
          "unsupported-scheme",
          here,
          `That site redirected to ${next.protocol.replace(":", "")}, which we don't follow.`,
        );
      }
      /* Compared without the fragment, because the fragment never reaches the
         server: `/a` → `/a#one` is a second request for the same resource, and
         a site that cycles fragments would otherwise eat the whole hop budget
         instead of being named as the loop it is. The chain keeps the real
         URLs. */
      if (chain.some((seen) => sameResource(seen, next))) {
        throw new FetchFailure("too-many-redirects", here, "That address redirects in a loop.");
      }
      current = next;
      continue;
    }

    try {
      return await readDocument(res, requestedUrl, here, chain, opts);
    } catch (err) {
      throw classifyNetworkError(err, here);
    }
  }

  throw new FetchFailure(
    "too-many-redirects",
    chain.at(-1) ?? requestedUrl,
    `That address redirected more than ${opts.maxRedirects} times.`,
  );
}

async function readDocument(
  res: Response,
  requestedUrl: string,
  finalUrl: string,
  chain: string[],
  opts: Resolved,
): Promise<FetchedDocument> {
  const contentType = res.headers.get("content-type");

  if (!res.ok) {
    const asked = retryAfterMs(res.headers.get("retry-after"), opts.now());
    await discard(res);
    throw classifyStatus(res.status, finalUrl, asked);
  }

  /* 206 is a success, and it is a success at sending part of a document. We
     never ask for a range, so a server sending one is misconfigured or a proxy
     is interfering — either way, storing half an article as though it were the
     whole one is the worst available outcome, because nothing downstream can
     tell. */
  if (res.status === 206) {
    await discard(res);
    throw new FetchFailure("http-error", finalUrl, "That server sent only part of the page.", {
      status: res.status,
    });
  }

  /* The cap is enforced in exactly one place: the bytes that actually arrive.
     There was a cheap refusal here first, reading `Content-Length` and giving
     up before downloading anything, justified as safe in one direction — a
     declared size over the cap means the real thing must be over it too. It
     isn't safe, and the argument for it was quietly at odds with the reason
     this module exists: `Content-Length` is a claim by the same server we have
     already established lies about it. A server that overstates would have had
     a perfectly good article refused with a confident number in the message,
     and no way to tell from the outside. What the check bought was skipping a
     download the cap already bounds at 32 MB — a few seconds, against a class
     of bug nobody could diagnose. */
  const bytes = await readCapped(res.body, opts.maxBytes, finalUrl);
  if (bytes.byteLength === 0) {
    throw new FetchFailure("empty", finalUrl, "That page came back empty.");
  }

  const kind = sniffKind(contentType, bytes);
  if (kind === null) {
    throw new FetchFailure(
      "unsupported-type",
      finalUrl,
      `That isn't something we can read${contentType ? ` (${mimeType(contentType)})` : ""} — only web pages and PDFs.`,
    );
  }

  const decoded = kind === "html" ? decodeHtml(bytes, contentType) : null;

  return {
    requestedUrl,
    url: finalUrl,
    chain,
    status: res.status,
    kind,
    contentType,
    bytes,
    text: decoded?.text ?? null,
    encoding: decoded?.encoding ?? null,
    fetchedAt: opts.now().toISOString(),
  };
}

/**
 * The HTML of a page, or a failure explaining why there isn't any.
 *
 * The convenience wrapper for **`src/extract.ts`'s command line**, which wants
 * a string and runs Readability over it. A PDF is a *successful* fetch that
 * Readability cannot use, so this fails by name rather than returning something
 * empty and letting Readability produce a blank article.
 *
 * **The ingest queue no longer comes through here.** It calls `fetchDocument`,
 * writes the manifest, and stage 2 branches on what arrived — a PDF goes to
 * src/pdf-read.ts instead. So the sentence below is now about one command
 * rather than about the product: `npm run extract -- <a-pdf-url>` is genuinely
 * the wrong command, and pasting that URL into the add box is not.
 */
export async function fetchHtml(url: string, options: FetchOptions = {}): Promise<string> {
  const doc = await fetchDocument(url, options);
  if (doc.kind !== "html" || doc.text === null) {
    throw new FetchFailure(
      "unsupported-type",
      doc.url,
      "That's a PDF, and this command runs Readability. Add it through the app, or run " +
        "`npm run pdf -- <file.pdf>` — see docs/plans/pdf-ingestion.md.",
      { status: doc.status },
    );
  }
  return doc.text;
}

/* ------------------------------------------------------------------ *
 * Stage 1 as a command
 * ------------------------------------------------------------------ */

/**
 * `npm run fetch -- <url> [dir]`
 *
 * Writes what came back to `data/<slug>/raw.html`, or `raw.pdf` — the same
 * place and name the ingest queue's fetch step writes, so running this by hand
 * satisfies that step and the queue skips straight to extraction
 * (docs/project/ingest-queue.md).
 *
 * Mostly, though, this exists for the other job: **finding out why a URL won't
 * come in.** It prints the chain, the type, the encoding and the size, which
 * between them explain nearly every failure — and on a failure it prints the
 * code and the sentence rather than a stack trace.
 *
 * The slug comes from the URL you typed, not from where you were redirected to,
 * so that it matches what the add box on the homepage shows for the same URL
 * (src/ingest.ts). Where the two differ, the line below says so.
 */
async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: tsx src/fetch.ts <url> [dir]");
    process.exit(1);
  }

  let doc: FetchedDocument;
  try {
    doc = await fetchDocument(url);
  } catch (err) {
    const failure = classifyNetworkError(err, url);
    console.error(`\n  ✗ ${failure.code}\n    ${failure.message}\n`);
    process.exit(1);
  }

  const slug = slugFromUrl(url) || "article";
  const dir = process.argv[3] ?? path.join("data", slug);
  /* **`writeRaw`, not a second copy of it.** This wrote `doc.bytes` by hand and
     no manifest at all, which made `npm run fetch` and the pipeline produce
     *different files at the same path*: undecoded bytes here against the
     decoded string there, and `extract` reads that path with `"utf8"`, so a
     page in any other encoding came out as mojibake one way and correctly the
     other. The absent `raw.json` then took the content type, the encoding and
     the hash with it.

     Not a decision that was made and later regretted — `writeRaw` arrived on
     2026-08-26 (b6e41b4) and this function was simply not moved onto it. There
     is one writer of a raw document now, which is the only version of this that
     stays true. */
  const manifest = await writeRaw(dir, doc);
  const file = path.join(dir, manifest.file);

  console.log(`Requested: ${doc.requestedUrl}`);
  if (doc.url !== doc.requestedUrl) {
    console.log(`Final:     ${doc.url}   (${doc.chain.length - 1} redirect(s))`);
  }
  console.log(`Type:      ${doc.kind}${doc.contentType ? `  (${doc.contentType})` : ""}`);
  if (doc.encoding) console.log(`Encoding:  ${doc.encoding}`);
  console.log(`Size:      ${(doc.bytes.byteLength / 1024).toFixed(1)} KB`);
  console.log(`\nWritten to: ${path.resolve(file)}`);
  if (doc.kind === "pdf") {
    console.log("\nNote: nothing downstream reads a PDF yet — see docs/project/fetching.md.");
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) void main();
