/**
 * **The author's own page, read for an address the search could not see** —
 * plan docs/plans/261024j-author-lookup-tries-harder-reads-the-author-s-page-and-proposes-likely-addresses.md § D2.
 *
 * The lookup's search sees only the provider's text extracts, and an extract
 * drops images. Greg's example (#686) wrote `alexwarth`, then an image of an
 * `@`, then `gmail.com`, in three table cells: no address token anywhere in
 * the text, so the lookup could not see it. This file fetches the page itself,
 * renders it to text with each image kept as a marker (an `@` drawn as an
 * image becomes `[at]`), and scans that text for addresses, plain or
 * disguised.
 *
 * **Deterministic on purpose.** No model reads the page, so a stranger's page
 * adds no prompt-injection surface: the worst it can do is put a wrong address
 * among the candidates, which Greg reads, each labelled with where it was
 * found. Nothing found here fills the draft (§ D2: a homepage can carry a lab
 * manager's address, and choosing the author's is Greg's).
 *
 * The fetch is `fetchDocument`'s, with its scheme list, private-address guard,
 * redirect limit and size cap (src/chat-tools.ts § readWebPage says why a bare
 * `fetch` here would be an SSRF hole). A page that cannot be read is a reason,
 * never a thrown error: the lookup goes on without it.
 */

import { type FetchOptions, FetchFailure, fetchDocument } from "./fetch.js";
import { jsdom } from "./jsdom-lazy.js";
import { looksLikeEmail, normaliseEmail } from "./email-address.js";

/** Per page. Nobody is waiting (it runs after the response), but a stuck host should not hold the lookup. */
export const PAGE_TIMEOUT_MS = 10_000;
/** A homepage is small; this is a ceiling against a hostile one. */
export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
/** How many distinct addresses one page may contribute. */
export const PAGE_ADDRESSES_MAX = 6;

/** An image whose name or alt text is an `@`: `at.gif`, `at-sign.png`, `alt="@"`, `arroba.png`. */
const AT_IMAGE = /^(?:@|at|at[-_ ]?sign|arroba|atmark)(?:\.(?:gif|png|jpe?g|svg|webp|bmp))?$/i;
/** The same for a `.` drawn as an image. */
const DOT_IMAGE = /^(?:\.|dot|period|point)(?:\.(?:gif|png|jpe?g|svg|webp|bmp))?$/i;

/** Elements whose text never runs into the next element's. */
const BREAKS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE",
  "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P",
  "PRE", "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);
/** Table cells are one local chunk: Greg's example deliberately spans three. Every other block ends one. */
const CELL_SPACES = new Set(["TD", "TH"]);
/* Private-use, not whitespace: regexes cannot cross it. If a page contains one itself, it only creates a safe false boundary. */
const CHUNK_BREAK = "\uE000";
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"]);

/** The last path segment of an image's `src`, without its query. */
function fileName(src: string): string {
  const path = src.split(/[?#]/)[0] ?? "";
  const last = path.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** What an image stands for in the text: `[at]`, `[dot]`, or a marker naming it. */
function imageWord(alt: string, src: string): string {
  const name = fileName(src);
  for (const label of [alt.trim(), name]) {
    if (AT_IMAGE.test(label)) return " [at] ";
    if (DOT_IMAGE.test(label)) return " [dot] ";
  }
  return ` [image: ${(alt.trim() || name).slice(0, 60)}] `;
}

export interface PageText {
  /** The page as text, whitespace collapsed, images as markers. */
  readonly text: string;
  /** The same text with block boundaries kept, so an address cannot be assembled across unrelated blocks. */
  readonly scanText: string;
  /** Every valid `mailto:` link's decoded address, capped with the page's output. */
  readonly mailtos: readonly string[];
}

/** One decoded, shaped address from a mailto href; null for a malformed escape or non-address. */
function mailtoAddress(href: string): string | null {
  const encoded = href.trim().slice(7).split(/[?#]/)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  const address = normaliseEmail(decoded);
  return looksLikeEmail(address) ? address : null;
}

function takeMailto(el: Element, mailtos: string[]): void {
  if (el.tagName !== "A" || mailtos.length >= PAGE_ADDRESSES_MAX) return;
  const href = el.getAttribute("href") ?? "";
  if (!/^mailto:/i.test(href.trim())) return;
  const address = mailtoAddress(href);
  if (address !== null && !mailtos.includes(address)) mailtos.push(address);
}

function separatorFor(tagName: string): string | null {
  if (!BREAKS.has(tagName)) return null;
  return CELL_SPACES.has(tagName) ? " " : CHUNK_BREAK;
}

/**
 * **The page as text, images kept.** jsdom parses (no scripts run, nothing is
 * fetched); the walk writes text nodes, a space at every block or table cell
 * so `alexwarth` and `gmail.com` never fuse, and a marker for every image.
 */
export function pageText(html: string): PageText {
  const { JSDOM } = jsdom();
  const doc = new JSDOM(html).window.document;
  const parts: string[] = [];
  const mailtos: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (SKIP.has(el.tagName)) return;
    if (el.tagName === "IMG") {
      parts.push(imageWord(el.getAttribute("alt") ?? "", el.getAttribute("src") ?? ""));
      return;
    }
    takeMailto(el, mailtos);
    const separator = separatorFor(el.tagName);
    if (separator !== null) parts.push(separator);
    for (const child of el.childNodes) walk(child);
    if (separator !== null) parts.push(separator);
  };
  if (doc.body) walk(doc.body);
  const scanText = parts
    .join("")
    .replace(/[^\S\uE000]+/g, " ")
    .replace(/ *\uE000+ */g, CHUNK_BREAK)
    .replace(/^\uE000+|\uE000+$/g, "");
  return { text: scanText.replace(/\uE000/g, " ").replace(/\s+/g, " ").trim(), scanText, mailtos };
}

/* ------------------------------------------------------------- decoding -- */

const LOCAL = "[A-Za-z0-9][A-Za-z0-9._%+'-]*";
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
const TLD = "[A-Za-z]{2,24}";
/** `@`, `[at]`, `(at)`, `{at}`, `<at>`, with any spacing. */
const AT_MARK = String.raw`\s*(?:@|\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\}|<\s*at\s*>)\s*`;
/** `.`, `[dot]`, `(dot)`, `{dot}`, ` dot `. */
const DOT_ANY = String.raw`(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\})\s*|\s+dot\s+|\.)`;
const DOT_WORD = String.raw`(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\})\s*|\s+dot\s+)`;

/**
 * A marked *at* takes any dot. A bare ` at ` between words takes only a
 * spelled-out dot: *"slides available at example.com"* is prose, and *"jane at
 * example dot com"* is an address.
 */
const DISGUISED = new RegExp(
  String.raw`(?<![A-Za-z0-9._%+'-])(${LOCAL})(?:${AT_MARK}((?:${LABEL}${DOT_ANY})+${TLD})|\s+at\s+((?:${LABEL}${DOT_WORD})+${TLD}))(?![A-Za-z0-9-])`,
  "gi",
);

/** Every spelling of a dot, back to `.`. */
function undot(domain: string): string {
  return domain.replace(new RegExp(DOT_ANY, "gi"), ".");
}

export interface PageAddress {
  /** Normalised. */
  readonly address: string;
  /** False when written plainly (or in a `mailto:`); true when it had to be decoded. */
  readonly disguised: boolean;
}

/**
 * **The addresses a page's text holds**, plain first, then decoded, each once,
 * at most `PAGE_ADDRESSES_MAX`. A plain address the disguise pattern also
 * matches is reported plain.
 */
export function pageAddresses(page: PageText): PageAddress[] {
  const found = new Map<string, PageAddress>();
  const add = (raw: string, disguised: boolean) => {
    const address = normaliseEmail(raw);
    if (!looksLikeEmail(address) || found.has(address)) return;
    found.set(address, { address, disguised });
  };
  const done = () => found.size >= PAGE_ADDRESSES_MAX;
  for (const m of page.mailtos) {
    add(m, false);
    if (done()) return [...found.values()];
  }
  const chunks = page.scanText.split(CHUNK_BREAK);
  for (const chunk of chunks) {
    for (const m of chunk.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) {
      add(m[0], false);
      if (done()) return [...found.values()];
    }
  }
  for (const chunk of chunks) {
    for (const m of chunk.matchAll(DISGUISED)) {
      const local = m[1] ?? "";
      const domain = m[2] ?? m[3] ?? "";
      add(`${local}@${undot(domain)}`, true);
      if (done()) return [...found.values()];
    }
  }
  return [...found.values()];
}

/* ----------------------------------------------------------- confidence -- */

/** Lower-case letters only, accents folded: `Müller-Lüdenscheidt` → `mullerludenscheidt`. */
function letters(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * **Whether an address's local part names the author** — their surname or
 * first name (three letters or more), or their initials with the surname.
 * `alexwarth` for *Alessandro Warth*: yes, by the surname.
 */
export function addressNamesAuthor(address: string, authorName: string | null): boolean {
  if (!authorName) return false;
  const local = letters(address.split("@")[0] ?? "");
  const words = authorName
    .split(/[\s,]+/)
    .map(letters)
    .filter((w) => w !== "");
  if (local === "" || words.length === 0) return false;
  if (words.some((w) => w.length >= 3 && local.includes(w))) return true;
  const surname = words[words.length - 1] ?? "";
  const initials = words.slice(0, -1).map((w) => w[0]).join("");
  return surname.length >= 2 && initials !== "" && local.startsWith(`${initials}${surname}`);
}

/* ----------------------------------------------------------------- read -- */

export type PageRead =
  /** `url` is where the fetch ended, after redirects (plan 261024j, R2): the page the addresses were on. */
  | { readonly kind: "read"; readonly url: string; readonly addresses: PageAddress[]; readonly text: string }
  | { readonly kind: "unread"; readonly url: string; readonly reason: string };

/** How a page is fetched. Injectable so a test reads a page without a network. */
export type PageFetch = (
  url: string,
  options: FetchOptions,
) => Promise<{ kind: "html"; text: string; finalUrl: string } | { kind: "pdf" }>;

const defaultFetch: PageFetch = async (url, options) => {
  const doc = await fetchDocument(url, options);
  return doc.kind === "html" ? { kind: "html", text: doc.text, finalUrl: doc.url } : { kind: "pdf" };
};

/**
 * **Read one page for addresses. Never throws**; one try, 2 MB, 10 seconds
 * (plan 261024j, R5): a failure is a short reason
 * — a fetch failure's code, `not-html`, `timeout` — that the notes say.
 */
export async function readAuthorPage(url: string, fetchPage: PageFetch = defaultFetch): Promise<PageRead> {
  try {
    const doc = await fetchPage(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: PAGE_MAX_BYTES,
      attempts: 1,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (doc.kind !== "html") return { kind: "unread", url, reason: "not-html" };
    const page = pageText(doc.text);
    return { kind: "read", url: doc.finalUrl, addresses: pageAddresses(page), text: page.text };
  } catch (err) {
    const reason =
      err instanceof FetchFailure ? err.code : err instanceof Error ? (err.name === "TimeoutError" ? "timeout" : err.name) : "unknown";
    return { kind: "unread", url, reason };
  }
}
