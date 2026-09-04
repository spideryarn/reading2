/**
 * How an article gets in: what it will be called, and whether that name is safe
 * to use as a path.
 *
 * A module of its own because **three things have to agree and they run in
 * different processes**: the extractor picks the slug when it writes
 * `output/<slug>.html` (src/extract.ts), the add box shows you the slug you are
 * about to get (src/web/AddArticle.tsx), and the server derives the one it
 * actually uses when you submit (src/routes.ts). If those disagreed, the box
 * would name a directory other than the one the article landed in — and nothing
 * would report an error, because every half would have done exactly what it was
 * told.
 *
 * No dependencies but src/ids.ts, which is pure and on the same client
 * allowlist: the browser imports this too. See docs/project/library.md and
 * docs/project/ingest-queue.md.
 *
 * `pipelineCommands` used to live here, printing the four commands for the add
 * box to show. The queue (src/jobs.ts) runs them now, so the box submits
 * instead of instructing, and a list of shell commands nothing executed would
 * have drifted from the pipeline silently. The stages are documented in
 * docs/project/setup-dev.md#the-pipeline-stages, which is where they belong.
 */

import { ID_PREFIX, isSpideryarnId, mintId } from "./ids.js";

/** Long enough to stay readable, short enough for a directory name. */
const MAX = 60;

/**
 * A scheme, in the shape the URL spec says one has.
 *
 * Used to decide whether the reader typed one. It deliberately matches more
 * than `http` and `https` — `javascript:`, `mailto:`, `data:` all match — so
 * that `normaliseUrl` hands them straight to the http/https test below rather
 * than gluing `https://` onto the front of them.
 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The query parameters a share button staples on, which are about *how you
 * arrived* rather than *what you are reading*.
 *
 * Dropped from `urlKey` only — never from the URL we actually fetch. A short,
 * unambiguous list on purpose: `ref`, `s`, `id` and `source` are all used as
 * tracking parameters *and* as real ones, and a key that dropped a real
 * parameter would merge two genuinely different pages, which is the one
 * mistake here that loses an article rather than duplicating one.
 */
const TRACKING = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "yclid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "ref_src",
  "ref_url",
  "vero_id",
  "wt_mc",
]);

/** Enough of a host to be a host, rather than a typo we would rather refuse. */
function looksLikeHost(authority: string): boolean {
  const host = authority.replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  return /^[^\s.]+(\.[^\s.]+)+$/.test(host);
}

/**
 * A host on this machine or this network, which we will not fetch.
 *
 * **This is a smaller claim than "no SSRF", and the difference matters.** An
 * `/add/…` link is something a stranger can send, and opening it starts a
 * server-side fetch without a second click — so `/add/http://169.254.169.254/…`
 * would have pointed our server at a cloud metadata endpoint. This closes the
 * literal-address version of that, including the compressed spellings, because
 * `new URL` has already expanded `127.1` and `0x7f.0.0.1` to `127.0.0.1` by the
 * time we look.
 *
 * What it does **not** close is a name that resolves to one of these — a DNS
 * record pointing at `10.0.0.1`, a redirect into the private range, or a rebind
 * between our check and the fetch. Those can only be stopped at connect time,
 * in the fetch stage, and are written up as open in docs/project/security.md.
 *
 * `localhost` goes with them, which costs the ability to add a page from a dev
 * server on this machine. That is a real loss and a small one: this reads
 * published articles.
 */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  /* Everything in `::/96`, which is `::`, `::1`, and the two forms that carry
     an IPv4 address inside an IPv6 one. **The mapped form is the hole this
     closes**, and it is worth naming because the obvious version of this
     function has it: `http://[::ffff:127.0.0.1]/` is loopback, and `new URL`
     re-spells it as `[::ffff:7f00:1]` — which is neither a dotted quad nor
     `::1`, so a check for those two waves it through. Found by GPT Sol,
     2026-08-26. A mapped address gets its IPv4 half checked properly (so
     `::ffff:8.8.8.8` is still fetchable); the rest of `::/96` is not routable
     at all and is simply refused. */
  if (host.startsWith("::")) {
    const embedded = mappedIPv4(host);
    return embedded === null ? true : isLocalIPv4(embedded);
  }
  return isLocalIPv4(host);
}

/**
 * The IPv4 address inside an IPv4-mapped IPv6 one, in both the spelling a
 * person writes and the one `new URL` hands back.
 */
function mappedIPv4(host: string): string | null {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (dotted?.[1]) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!hex) return null;
  const high = Number.parseInt(hex[1] as string, 16);
  const low = Number.parseInt(hex[2] as string, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** Loopback, link-local, or one of the private ranges. */
function isLocalIPv4(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * The URL we will actually fetch and store, given whatever the reader typed.
 *
 * > And will this de-dupe correctly if near-identical versions of the url are
 * > used, e.g. http vs https or without url protocol or capitalised similar
 * > non-significant changes, or if we already have the article?
 * >
 * > — Greg, 2026-08-26
 *
 * That question has two halves and **they must not be answered by one
 * function**, which is why there are two here. This one is the conservative
 * half: it may tidy an address but it may never turn it into a *different*
 * address, because whatever comes out is what gets fetched. So it fixes only
 * what the URL spec itself calls insignificant —
 *
 *  - a missing scheme becomes `https://` (`example.com/x`, `//example.com/x`)
 *  - the scheme and host are lower-cased; **the path is not**, because plenty
 *    of servers are case-sensitive about theirs and mean it
 *  - a default port goes (`:443` on https, `:80` on http); any other stays
 *  - an empty path becomes `/`
 *  - the fragment goes — it is never sent to a server, so an article whose
 *    stored URL carried one would be claiming we fetched something we did not
 *
 * — and leaves everything else, `http` included. Turning `http` into `https` is
 * a different request to a possibly different server, and this is not the place
 * to make that call. `urlKey` is where http and https become one article.
 *
 * Anything we will not fetch comes back as **`""`** — not a URL at all, a
 * scheme we cannot fetch, credentials in the address, or a host on this machine
 * or this network. One rule with one answer, which is what makes it safe for
 * `slugFromUrl` to be built on: an early version returned the input unchanged
 * for a refusal, which reads well in an error message and is indistinguishable
 * from *"already normal"* — so `http://127.0.0.1/x` was refused here and then
 * happily slugged as `x` one function later. The caller still has the string
 * the reader typed, and shows that.
 *
 * Two things it deliberately does not rescue, both rare and both better refused
 * than guessed at: a scheme-less host with a port (`example.com:8080/x`, whose
 * `example.com:` parses as a scheme), and a fragment-routed page
 * (`example.com/#!/article/1` — we could not have fetched the right thing
 * anyway, since a fragment never leaves the browser).
 */
export function normaliseUrl(input: string): string {
  const text = input.trim();
  if (text === "") return "";

  let candidate = text;
  if (!HAS_SCHEME.test(text)) {
    const bare = text.startsWith("//") ? text.slice(2) : text;
    const authority = bare.split(/[/?#]/)[0] ?? "";
    if (!looksLikeHost(authority)) return "";
    candidate = `https://${bare}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return "";
  }
  // `new URL` has already done the scheme case, the host case, the default port
  // and the empty path. The rest is ours.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  /* Credentials in the address are refused rather than carried. Two reasons and
     both are about this being a *shareable* link now: an `/add/…` URL lives in
     browser history and in whatever access log sees the request, and percent-
     encoding hides a password from nobody. And they are part of the address, so
     `urlKey` would either have to keep them — making one article two — or drop
     them, making two readers' private views one article. Refusing is the only
     answer that is not a choice between those. */
  if (parsed.username !== "" || parsed.password !== "") return "";
  if (isLocalHost(parsed.hostname)) return "";
  parsed.hash = "";
  return parsed.href;
}

/**
 * The identity of an article, for the one question "do we already have this?".
 *
 * The aggressive half of the pair above, but **only where being wrong is cheap**,
 * and that asymmetry is the whole rule this function is written to:
 *
 * - Failing to merge two spellings of one article costs a **duplicate** — a
 *   second card on the shelf, visible, deletable, and paid for once.
 * - Merging two different articles costs **the wrong article**, silently, under
 *   the headline the reader pasted. Nothing errors and the shelf looks right.
 *
 * So a merge has to be one the URL spec or universal practice actually
 * guarantees, not one that is usually true. On top of `normaliseUrl` this drops
 * the scheme entirely (so `http` and `https` are one article), a leading
 * `www.`, one trailing slash, and the tracking parameters above.
 *
 * **Four things it deliberately does not do**, each of which the first version
 * of this function did, and each of which GPT Sol's review (2026-08-26) showed
 * merges pages that can genuinely differ:
 *
 * - **It does not lower-case the path.** Plenty of servers are case-sensitive
 *   and mean it. The argument for lower-casing was that `slugFromUrl` already
 *   does, so `/Why-Trees` and `/why-trees` collide on the slug anyway — but
 *   that is exactly what `freeSlug` exists to resolve, and it resolves it into
 *   the cheap failure rather than the expensive one.
 * - **It does not sort the query string.** Sorting made `?a=1&b=2` match
 *   `?b=2&a=1`, which nobody has ever needed, and made `?tag=a&tag=b` match
 *   `?tag=b&tag=a`, which is a different request.
 * - **It does not decode the query string.** Decoding and re-joining on `=` and
 *   `&` is ambiguous: `?a=x%26b%3Dy` is one parameter whose value contains an
 *   ampersand, and it came back out identical to the two-parameter `?a=x&b=y`.
 *   The raw text is compared instead.
 * - **It does not drop userinfo** — `normaliseUrl` refuses those URLs outright,
 *   so they never reach here. Dropping them would have made one reader's
 *   credentialled view of a page the same article as another's.
 *
 * `www.` is the only subdomain treated as decoration. `blog.example.com` is a
 * different site and stays one.
 *
 * Junk that is not a URL keys as its own trimmed, lower-cased text, so two
 * spellings of the same nonsense still match and nothing throws.
 */
export function urlKey(url: string): string {
  const normalised = normaliseUrl(url);
  // Not a URL we would fetch — so it has no article to be the identity of, and
  // the honest key is the text itself. Tidied only enough that two spellings of
  // one piece of nonsense still match.
  if (normalised === "") return url.trim().toLowerCase();
  let parsed: URL;
  try {
    parsed = new URL(normalised);
  } catch {
    return url.trim().toLowerCase();
  }

  const host = parsed.hostname.replace(/^www\./, "");
  const port = parsed.port ? `:${parsed.port}` : "";
  // **One** trailing slash, so `/a/` and `/a` match and the root `/` becomes
  // nothing — but `/a//` stays its own path, because it is one.
  const route = parsed.pathname.replace(/\/$/, "");

  /* The raw query text, split but never decoded, and kept in the order it
     arrived. See the four paragraphs above for why each of those is deliberate.

     **Only tracking pairs are dropped — an empty one is kept.** Filtering `""`
     out as well made `?a=1&&b=2` and `?a=1&b=2` one article, and they are two
     different request targets. The `raw === ""` guard is what an empty filter
     needs instead, since `"".split("&")` is `[""]` rather than `[]`. */
  const raw = parsed.search.replace(/^\?/, "");
  const pairs =
    raw === "" ? [] : raw.split("&").filter((pair) => !isTracking(pair.split("=")[0] ?? ""));
  const query = pairs.length > 0 ? `?${pairs.join("&")}` : "";

  return `${host}${port}${route}${query}`;
}

function isTracking(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING.has(lower);
}

/** Lower-case, ASCII, single dashes, no leading or trailing dash. */
function kebab(text: string): string {
  return text
    .normalize("NFKD")
    // Strip combining marks so "café" becomes "cafe" rather than "caf".
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX)
    .replace(/-+$/, "");
}

/**
 * The slug an article fetched from `url` gets.
 *
 * The last path segment, which is what publishers put the headline in. Two
 * cases it has to survive, both common:
 *
 *  - **A bare domain** (`https://example.com/`) — no segment to use, so the
 *    host stands in.
 *  - **A numeric id** (`https://site.com/2026/08/12345`) — a directory called
 *    `12345` tells nobody anything, so the host is prefixed.
 *
 * Returns `""` for anything that isn't a URL, which is what lets the add box
 * stay quiet until you have pasted something real.
 *
 * **Through `normaliseUrl` since 2026-08-26**, which buys two things. A URL
 * with no scheme now gets a slug, because that is how people write them down
 * — `example.com/why-trees` is a URL and used to be nothing. And a scheme we
 * could never fetch now gets none: `javascript:alert(1)` used to come back as
 * `alert-1`, because `new URL` accepts it and this only ever read the last path
 * segment. Harmless in itself, but it meant the add page needed a scheme check
 * of its own, and two places deciding what counts as a URL is how they come to
 * disagree.
 */
export function slugFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(normaliseUrl(url));
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";

  const host = kebab(parsed.hostname.replace(/^www\./, "").replace(/\.[a-z]+$/, ""));
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  // `new URL` accepts a malformed percent escape that `decodeURIComponent`
  // throws on — `https://x.test/%E0%A4%A` is a valid URL and an invalid escape.
  // That URIError used to be thrown during a React render, which blanks the
  // homepage, and through POST /api/jobs it came back as a 500. Undecoded is a
  // perfectly good slug source; `kebab` strips the percent signs anyway.
  let decoded: string;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }
  // `.html`, `.php`, `.amp` — the extension is about the server, not the piece.
  const name = kebab(decoded.replace(/\.[a-z0-9]{1,5}$/i, ""));

  if (!name) return host;
  if (/^\d+$/.test(name)) return kebab(`${host}-${name}`);
  return name;
}


/**
 * The slug an uploaded file gets, from the name the reader gave it.
 *
 * The filename with its extension off, kebab-cased by the same function
 * `slugFromUrl` uses — so `Bergson — Matter & Memory (1911).pdf` becomes
 * `bergson-matter-memory-1911`, which is a directory name a person recognises.
 *
 * **`""` for anything that leaves nothing**, which is a real case rather than a
 * theoretical one: `.pdf`, `2026.pdf`, `文档.pdf` all kebab to nothing at all,
 * because `kebab` is ASCII-only by design. The caller substitutes a default
 * rather than this function inventing one, for the same reason `slugFromUrl`
 * returns `""` — a function that always succeeds cannot be asked whether it
 * did, and the add box's preview needs to be able to stay quiet.
 *
 * It is here, beside `slugFromUrl`, and not in src/uploads.ts, because this is
 * the module that owns "what will this article be called" and the answer has to
 * be the same in the browser and on the server. See the note at the top.
 */
export function slugFromFilename(filename: string): string {
  const last = filename.split(/[/\\]/).pop() ?? "";
  return kebab(last.replace(/\.[a-z0-9]{1,5}$/i, ""));
}

/**
 * Whether a string is a slug we are willing to turn into a path.
 *
 * **This is a path-traversal guard, not a tidiness check.** A slug arrives from
 * the client on `POST /api/jobs` and is joined onto `data/` and `output/`, so
 * `../../.ssh` has to be refused here or it is refused nowhere. `slugFromUrl`
 * can only produce strings that pass, which is exactly why the check belongs
 * beside it: the two must not drift apart.
 */
export function isSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

/**
 * **Names an article may not be given, because `/read/<name>` is already a page.**
 *
 * Exactly one entry today: `/read/public` is the shelf of public articles
 * (docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 3b), and the
 * two routers that answer that address — `parseRoute` in src/web/router.ts and
 * `decidePublicPage` in src/public/page.ts — match it **before** `/read/:slug`.
 * An article called `public` would therefore exist and be unreachable at its own
 * canonical address, which is a worse failure than refusing the name: nothing
 * errors, the shelf card links to a page about something else, and the owner has
 * no way to tell.
 *
 * ## This is not `RESERVED` in src/slug.ts, and the difference cost a review
 *
 * The first draft of the plan said to add `"public"` to that set. It would have
 * changed nothing while looking exactly as if it had: `RESERVED` belongs to
 * `assertSlug`, which guards *reading* a filesystem path, and `isSlug` above —
 * the function `parseRoute`, the edge and `POST /api/jobs` all ask — has never
 * consulted it. Verified 2026-09-04.
 *
 * ## And it is not folded into `isSlug` either
 *
 * `isSlug` answers *may this string be turned into a path*, and it is asked at
 * every **read** as well as at minting. Refusing `public` there would refuse it
 * on the way out too, so a row that somehow held the name could never be read
 * back or repaired. Two questions, two functions — the same split src/slug.ts
 * argues for at length.
 *
 * Enforced at the one seam where an `articles` row is born: `lockOrCreateArticle`
 * in src/store/pg-revisions.ts. Deliberately **not** enforced when *locking* an
 * existing row, so that an article that already holds the name on some
 * deployment goes on working rather than becoming unwritable the day this
 * shipped.
 */
export const PUBLIC_LIBRARY_SLUG = "public";

/**
 * The whole set, built from the constant above rather than repeating it — two
 * spellings of one reserved name is one place for the reservation and the route
 * to come apart.
 */
const RESERVED_SLUGS = new Set([PUBLIC_LIBRARY_SLUG]);

/**
 * Is this a name the app has already spent on a page of its own?
 *
 * Lower-cased before the comparison for the reason src/slug.ts gives about its
 * own reserved set: a case-sensitive reservation is one a different spelling
 * walks straight past. `isSlug` already refuses uppercase, so today this can
 * only differ for a string that was never going to be minted anyway — which is
 * exactly when a guard should still be right.
 */
export function isReservedSlug(value: string): boolean {
  return RESERVED_SLUGS.has(value.toLowerCase());
}

/**
 * **The short id every new slug ends with**, and the reason it is there.
 *
 * > Yes, let's add a short id — and actually then we could in future allow
 * > users to rename the slug, and redirect/find it from the short id. So make
 * > sure it's globally unique. I'm fine with adding that to all slugs.
 * >
 * > — Greg, 2026-08-31
 *
 * So `why-trees` becomes `why-trees-spya-k3m9qt`, and two articles can never
 * want the same name — which is what deleted the collision ladder `freeSlug`
 * used to walk (host prefix, then `-2`…`-99`) and the whole of
 * `freeUploadSlug` with it. docs/plans/260831b-finish-the-database-move.md
 * § Stage 3 item 0.
 *
 * **`mintId` rather than a second id shape**, because the codebase already has
 * one and a slug id that looked different from a block id would be a second
 * thing to learn for no gain. src/ids.ts.
 *
 * **The base is trimmed to make room**, not the whole thing afterwards: a slug
 * is a path segment and `isSlug` caps it at `MAX`, so appending twelve
 * characters to a sixty-character base would produce something the
 * path-traversal guard refuses. Trailing dashes go with the trim, since
 * `a-long-name-` + id reads as two dashes.
 *
 * The id is *also* stored in its own column (`articles.short_id`), and that is
 * the copy that matters: a slug the reader has renamed no longer contains one,
 * and the column is what a rename would redirect through.
 */
export function slugWithShortId(base: string, id: string = mintId()): string {
  const trimmed = base.slice(0, MAX - (id.length + 1)).replace(/-+$/, "");
  return trimmed ? `${trimmed}-${id}` : id;
}

/**
 * The short id on the end of a slug, if it has one.
 *
 * `undefined` for every slug minted before 2026-08-31, which is why
 * `articles.short_id` is nullable and nothing backfills it.
 *
 * Deliberately strict about the boundary: the id has to be a whole
 * dash-separated tail, so `notes-spya-thing` (a headline that happens to
 * contain the words) is not mistaken for one. `isSpideryarnId` is the same
 * check block ids go through, so the two cannot drift.
 */
export function shortIdInSlug(slug: string): string | undefined {
  const at = slug.lastIndexOf(`-${ID_PREFIX}`);
  if (at < 1) return undefined;
  const tail = slug.slice(at + 1);
  return isSpideryarnId(tail) ? tail : undefined;
}
