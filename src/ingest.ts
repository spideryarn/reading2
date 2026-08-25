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
 * No dependencies: the browser imports this too. See docs/project/library.md
 * and docs/project/ingest-queue.md.
 *
 * `pipelineCommands` used to live here, printing the four commands for the add
 * box to show. The queue (src/jobs.ts) runs them now, so the box submits
 * instead of instructing, and a list of shell commands nothing executed would
 * have drifted from the pipeline silently. The stages are documented in
 * docs/project/setup-dev.md#the-pipeline-stages, which is where they belong.
 */

/** Long enough to stay readable, short enough for a directory name. */
const MAX = 60;

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
 */
export function slugFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "";
  }

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
