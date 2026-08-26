/**
 * What can be said about where a link goes **without asking anybody**.
 *
 * The reading view underlines the article's own hyperlinks and shows a card on
 * hover. This module is the part of that card which costs nothing: it reads the
 * href and says what is in it. No fetch, no API, no third party told that this
 * reader hovered this link — which matters, because a card that fetched on
 * hover would report the reader's browsing to a stranger's server on a gesture
 * they did not think of as a visit. docs/project/logging.md § never a reader's
 * URLs.
 *
 * **It is deliberately the whole of the first version.** A survey on 2026-08-27
 * (docs/research/link-previews.md) put four sources of card content in order,
 * and this is the first: the free one, which has to render instantly and is the
 * entire card for every link we choose not to fetch. The richer three — an
 * article already in this library, Wikipedia's CORS-open summary API, and our
 * own server fetching the page once and caching it for everybody — sit on top
 * of this rather than replacing it.
 *
 * ## What it says, and why those things
 *
 * A URL is mostly noise to a reader mid-sentence. `https://philpapers.org/rec/
 * BUTAAT` has one useful word in it. So the card answers the three questions a
 * reader actually has about a link they are deciding whether to follow:
 *
 *  - **Where does it go** — the host, without `www.`.
 *  - **Does it leave this publication** — the fact the bare host cannot give
 *    you, because you have to know where you *are* to know that. An essay
 *    linking to its own magazine's back catalogue and an essay linking out to
 *    arXiv are different acts, and the reader is deciding between them.
 *  - **What will I get** — a PDF is not a web page, and finding that out by
 *    following the link is the rudest way to find it out.
 *
 * The path trail is there for the cases where the URL really does say something
 * (`/2024/03/the-title-of-the-piece`), and is dropped when it does not.
 */
import { hostOf } from "../urls.js";

/** A link this view resolves inside the article — see `internalTarget`. */
export interface AnchorPreview {
  kind: "anchor";
}

export interface ExternalPreview {
  kind: "external";
  /** `philpapers.org`. Never empty — an unparseable URL is `other` instead. */
  host: string;
  /**
   * The link stays on the site the article itself came from.
   *
   * Null when we do not know where the article came from — a PDF upload has no
   * source host — and null is *not* false: "I cannot tell" and "it leaves" are
   * different answers and the card must not print the second for the first.
   */
  sameSite: boolean | null;
  /** Readable path segments, longest-first noise removed. Empty for a bare host. */
  trail: string[];
  /** `PDF`, `EPUB` — upper-cased, and only when the path really ends in one. */
  file: string | null;
  /** Shown in full on the card's foot, so the reader can read it if they want. */
  url: string;
}

/** `mailto:`, `tel:`, a `javascript:` the sanitiser should have taken. */
export interface OtherPreview {
  kind: "other";
  scheme: string;
  url: string;
}

export type LinkPreview = AnchorPreview | ExternalPreview | OtherPreview;

/**
 * File extensions worth naming, and nothing else.
 *
 * A short list on purpose. The question the card is answering is "will this be
 * a web page or a download", so `.pdf` earns its place and `.html` does not —
 * printing "HTML" beside a link tells the reader what they already assumed and
 * spends a line doing it.
 */
const FILE_KINDS = new Set(["pdf", "epub", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "zip", "csv"]);

/**
 * Path segments that are the site's filing system rather than anything a reader
 * wants: `nature.com/articles/…`, `philpapers.org/rec/…`, `en.wikipedia.org/wiki/…`.
 *
 * Kept short on purpose. Guessing wrong here deletes the one informative word in
 * a URL, which is a worse outcome than leaving a dull one in — so a segment
 * earns a place on this list only by having been seen doing this job on a real
 * host in the corpus.
 */
const NOISE = new Set([
  "www", "en", "index", "html", "htm", "php",
  "abs", "rec", "doi", "full", "pdf", "wiki", "watch",
  "article", "articles", "paper", "papers", "entries", "titles",
]);

/**
 * Does this segment read as words, or as a catalogue number?
 *
 * **The interesting half of this file, and it was wrong until a browser pass
 * caught it.** The first version dropped a segment only if it was entirely
 * numeric, which is true of `/2024/03/` and false of nearly every real
 * identifier: philpapers publishes `/rec/SHATRA-2`, and the card duly printed
 * "SHATRA 2" underneath the host as though it were a title. philpapers is the
 * commonest destination in this corpus, so the one host it most needed to get
 * right was the one it got wrong.
 *
 * Three tests, each of which earns its place against a real URL above:
 *
 *  - **Something has to be lower-case.** `NAGWII`, `VARTSP`, `SHATRA-2` are
 *    shouting because they are catalogue keys; prose is not.
 *  - **At least one run of ≥3 letters with no digits in it.** This is what
 *    separates `Turing_Paper_1936` (keep — "Turing", "Paper") from
 *    `s41928-020-0448-2` and `a496212ca3444e1e…` (drop — every token has a
 *    digit in it or is too short to be a word).
 *  - **Digits must not dominate.** `2025-berggruen-prize-essay-competition-winners`
 *    is a headline with a year on the front and survives; `9780262512398` is an
 *    ISBN and does not.
 *
 * A tilde segment is a user directory (`cs.virginia.edu/~robins/…`) — filing
 * again, and the one case where the shape rather than the contents gives it away.
 */
function readsAsWords(segment: string): boolean {
  if (segment.startsWith("~")) return false;
  if (segment === segment.toUpperCase()) return false;
  const tokens = segment.split(/[-_.+\s]+/).filter(Boolean);
  if (!tokens.some((t) => t.length >= 3 && /^[\p{L}]+$/u.test(t))) return false;
  const digits = (segment.match(/[0-9]/g) ?? []).length;
  return digits / segment.length < 0.4;
}

/**
 * What the href says about itself.
 *
 * `sourceUrl` is where the *article* came from, so the card can say whether the
 * link leaves it. Pass null when there isn't one (an uploaded PDF), and the
 * card says nothing about it rather than guessing.
 */
export function describeLink(href: string, sourceUrl: string | null): LinkPreview {
  const trimmed = href.trim();
  if (trimmed.startsWith("#")) return { kind: "anchor" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    /* A relative href that survived stage 3 — the extractor absolutises what it
       can against the article's own URL, so anything still relative here has no
       base to resolve against and we genuinely do not know where it goes. */
    return { kind: "other", scheme: "", url: trimmed };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { kind: "other", scheme: parsed.protocol.replace(/:$/, ""), url: trimmed };
  }

  const host = hostOf(trimmed);
  if (!host) return { kind: "other", scheme: parsed.protocol.replace(/:$/, ""), url: trimmed };

  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const dot = last.lastIndexOf(".");
  const ext = dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
  const file = FILE_KINDS.has(ext) ? ext.toUpperCase() : null;

  const trail = segments
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        /* A stray `%` is not a bug in the URL, it is a byte we cannot read —
           `decodeURIComponent` throws on it, and one bad segment must not take
           the whole card down with it. */
        return seg;
      }
    })
    /* An **alphabetic** extension only. `.html` and `.pdf` are file types and
       come off; the `.2306525120` in `pnas.2306525120` is half a DOI, and
       stripping it left the bare word "pnas" looking like a title — which is
       both noise and a restatement of the host it sits under. */
    .map((seg) => seg.replace(/\.[a-z]{2,5}$/i, ""))
    .filter((seg) => seg.length > 1 && !NOISE.has(seg.toLowerCase()) && readsAsWords(seg))
    .map((seg) => seg.replace(/[-_+.]+/g, " ").trim())
    .filter(Boolean);

  const source = sourceUrl ? hostOf(sourceUrl) : "";
  /* Registrable-suffix comparison is what this *wants*, and it is not available
     without a public-suffix list. So: exact host, or one being a subdomain of
     the other, which gets `www.noemamag.com` → `noemamag.com` right and gets
     two unrelated `.github.io` pages wrong. Wrong in the harmless direction —
     it claims "same site" for two pages that share a domain, which is what a
     reader would say too. */
  const sameSite = source
    ? host === source || host.endsWith(`.${source}`) || source.endsWith(`.${host}`)
    : null;

  return { kind: "external", host, sameSite, trail, file, url: trimmed };
}
