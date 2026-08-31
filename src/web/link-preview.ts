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
 * **It is the floor the rest stands on.** A survey on 2026-08-27
 * (docs/research/260827a-link-previews.md) put four sources of card content in order,
 * and this is the first: the free one, which has to render instantly and is the
 * entire card for every link nobody can tell us anything more about. Two of the
 * richer three are now built — an article already in this library, and
 * Wikipedia's CORS-open summary API, both in link-facts.ts — and they sit on
 * top of this rather than replacing it. The fourth, our own server fetching an
 * arbitrary page, is still not built and links.md says why.
 *
 * This file stays synchronous and pure. What it added for those two is only
 * *naming*: `wiki` says which Wikipedia article a URL is, because deciding that
 * is reading an href, and the fetching code should be handed a title rather
 * than left to parse the URL a second time.
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

/**
 * A scholarly identifier the path is carrying — `arXiv 2212.13345`.
 *
 * **The answer to this file's own complaint.** The paragraph above says
 * `https://philpapers.org/rec/BUTAAT` has one useful word in it, and the trail
 * rule below duly deletes `BUTAAT` for being a catalogue key rather than prose.
 * That is right about the *words* and wrong about the *value*: a catalogue key
 * is exactly what you paste into a search box, and telling the reader which
 * catalogue it belongs to costs nothing and is read off the same string.
 *
 * Measured on this corpus (2026-08-27): 16 of 62 distinct external links carry
 * one — 7 PhilPapers records, 5 DOIs, 3 arXiv ids, and the one that is both.
 * Those are also the links whose host is nearly the whole of what the free card
 * could say, so this is the shape it helps most.
 *
 * **It is a claim about the address, never about the paper.** Nothing here is
 * resolved or registered — `DOI` means "this path is shaped like a DOI", and a
 * hostile article could put `/10.1234/invented` in one and get the word `DOI`
 * printed beside it. That is why the line is the raw id in monospace under the
 * host and beside the full URL, rather than anything that reads like a
 * citation: it shows the reader what is in the link, in the place they are
 * already judging the link. Raised by a GPT Sol review, 2026-08-27.
 */
export interface Citation {
  /** `arXiv`, `DOI`, `PhilPapers`. Capitalised as the issuer writes it. */
  label: string;
  /** `2212.13345`, `10.1073/pnas.2306525120`, `BUTAAT`. */
  id: string;
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
  /** A scholarly id the path is carrying, or null. See `Citation`. */
  citation: Citation | null;
  /**
   * The Wikipedia article this URL names, for the summary API to ask about.
   *
   * Null for everything else, which is nearly everything — one link in this
   * corpus of 62. It is here rather than in the fetching code because deciding
   * *whether* a URL is a Wikipedia article is reading the href, which is what
   * this file does, and the fetching code should be handed a title rather than
   * left to parse a URL a second time.
   */
  wiki: { lang: string; title: string } | null;
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
 * A DOI is `10.` then four to nine digits, then `/`, then anything.
 *
 * That prefix rule is the registry's, not a guess: the number before the slash
 * is the registrant, assigned by the DOI foundation, and it has never been
 * shorter than four digits. Which is what makes a DOI findable in the *middle*
 * of a path — `science.org/doi/10.1126/science.aan8871` and
 * `link.springer.com/article/10.1007/s11229-022-03524-1` both carry one behind a
 * publisher's own routing, and five of the corpus's do.
 */
const DOI = /^10\.\d{4,9}$/;

/** The arXiv routes that name one paper. `/search`, `/list/…` name none. */
const ARXIV_ROUTES = new Set(["abs", "pdf", "html", "format"]);
/** `2212.13345`, `2411.00986v1` — everything since April 2007. */
const ARXIV_MODERN = /^\d{4}\.\d{4,5}(v\d+)?$/;
/** `math/0301234`, `cond-mat.stat-mech/0703470` — the archive is part of the id. */
const ARXIV_LEGACY = /^[a-z-]+(\.[A-Za-z-]{2,})?\/\d{7}(v\d+)?$/;

/**
 * Percent-decoded for display, or left alone if it will not decode.
 *
 * The segments reaching `citationOf` are still encoded, because that is how
 * `pathname` hands them over and because the DOI suffix is the one identifier
 * here that legitimately contains reserved characters — `10.1002/(SICI)1097-…`
 * is a real DOI and arrives as `10.1002/%28SICI%291097-…`. Showing the reader
 * the percent-escapes would be showing them the transport rather than the id.
 */
function readable(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** What catalogue this address belongs to, and its key there. */
function citationOf(host: string, segments: string[]): Citation | null {
  if (host === "arxiv.org") {
    /* **Two shapes, and only from the routes that name a paper.**

       The first version took the last path segment of any `arxiv.org` URL,
       which made `/search` into "arXiv search" and `/list/cs.AI/new` into
       "arXiv new" — a label that is not merely useless but confidently wrong,
       the reader having no way to tell an invented id from a real one. It also
       dropped the archive off a legacy id: `/abs/math/0301234` is the paper
       `math/0301234`, and `0301234` alone is nothing.

       So: the route has to be one that names a paper, and what follows has to
       look like an arXiv id — modern (`2212.13345`) or legacy
       (`cond-mat.stat-mech/0703470`). Anything else gets no citation line,
       which is the right answer for a search page.

       The version suffix is kept in both: `v1` and `v3` are different papers to
       anyone who has read both, and dropping it would quietly claim the reader
       is being sent to the latest. */
    if (!ARXIV_ROUTES.has(segments[0] ?? "")) return null;
    const id = readable(segments.slice(1).join("/")).replace(/\.pdf$/i, "");
    return ARXIV_MODERN.test(id) || ARXIV_LEGACY.test(id) ? { label: "arXiv", id } : null;
  }
  if (host === "philpapers.org" && segments[0] === "rec" && segments[1]) {
    return { label: "PhilPapers", id: readable(segments[1]) };
  }
  if (host === "doi.org" || host === "dx.doi.org") {
    /* The registrant alone is not a DOI — `doi.org/10.1073` names a publisher
       and no paper. Same `there must be something after it` rule as the
       mid-path case below, and it needs saying twice because the two branches
       find the prefix in different places. */
    if (segments.length < 2 || !DOI.test(segments[0] ?? "")) return null;
    return { label: "DOI", id: readable(segments.join("/")) };
  }
  const at = segments.findIndex((seg) => DOI.test(seg));
  if (at >= 0 && segments.length > at + 1) {
    return { label: "DOI", id: readable(segments.slice(at).join("/")) };
  }
  return null;
}

/**
 * The Wikipedia article a URL names, if it names one.
 *
 * `en.wikipedia.org/wiki/Antikythera_mechanism` → `{ lang: "en", title:
 * "Antikythera_mechanism" }`. The underscores stay: the summary API wants the
 * page title in exactly the form the URL spells it, and turning them into
 * spaces here would mean turning them back there.
 *
 * **A title with a colon in it is refused**, which is how the namespaces get
 * excluded — `Special:Random`, `Talk:…`, `File:…`, `Category:…` are not
 * articles and the summary endpoint answers oddly or not at all for them. The
 * cost is the handful of real articles whose names contain a colon; they lose
 * the extra section and keep the ordinary card, which is the harmless direction.
 */
function wikiOf(host: string, segments: string[]): { lang: string; title: string } | null {
  const match = /^([a-z]{2,3}(?:-[a-z]+)?)\.(?:m\.)?wikipedia\.org$/.exec(host);
  if (!match?.[1]) return null;
  if (segments[0] !== "wiki" || !segments[1] || segments.length > 2) return null;
  let title: string;
  try {
    title = decodeURIComponent(segments[1]);
  } catch {
    return null;
  }
  if (title.includes(":")) return null;
  return { lang: match[1], title };
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

  return {
    kind: "external",
    host,
    sameSite,
    trail,
    file,
    citation: citationOf(host, segments),
    wiki: wikiOf(host, segments),
    url: trimmed,
  };
}
