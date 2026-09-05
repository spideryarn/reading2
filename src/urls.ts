/**
 * Is a URL one we are willing to put in an `href`?
 *
 * **A module of its own because both sides need it and neither may import the
 * other.** The server refuses a bad citation URL before storing it
 * (src/converse.ts), and the panel refuses it again before rendering it
 * (src/web/ChatPanel.tsx) — and the obvious way to share one function between
 * those two, importing the server file from the client one, quietly bundles the
 * whole of `converse.ts` into the browser. That was measured, not feared: the
 * client bundle grew 24KB and the string `OPENROUTER_API_KEY` appeared in it.
 * The secret itself was never there — it is read from `process.env` at runtime,
 * and there is no `process.env` in a browser — but the system prompt and the
 * request shape were, and one more careless edit in that direction is a real
 * leak. Same reason `Block` lives in src/types.ts rather than beside the code
 * that reads it.
 *
 * So: no imports, no side effects, nothing but the standard library.
 */

/**
 * `http` and `https`, and nothing else.
 *
 * An allowlist rather than a blocklist, because the set of dangerous schemes is
 * open-ended and browser-specific — `javascript:`, `data:`, `vbscript:`, and
 * whatever a future browser adds — while the set of useful ones here is exactly
 * two. A blocklist has to be kept up to date by someone who remembers it
 * exists.
 *
 * Parsing is the second half of the job. `new URL()` **throws** on an
 * unparseable string rather than returning null, and these URLs are parsed
 * again during render to show a hostname — so one malformed citation used to
 * take a whole chat panel down mid-render. Anything that survives this function
 * parses, which is a property the callers rely on.
 *
 * See docs/project/security.md.
 */
export function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * **The production origin, written down rather than taken from the request.**
 *
 * Everything built on this is published metadata: an `og:url` a link preview
 * records as the article's address, a link inside an export a reader keeps for
 * years. Building it from the `Host` header — or from `X-Forwarded-Host`, which
 * is the version that looks more careful — hands that choice to whoever sent the
 * request. A stranger can send any `Host` they like to an edge function, and the
 * reply would then contain their domain, attributed to us, in a field whose
 * entire purpose is to be believed.
 *
 * So it is a constant. This is exactly the kind of line somebody later
 * "improves" into a header read so that preview deployments unfurl with their
 * own hostname; the cost of that convenience is above, and a preview
 * deployment's link previews are not worth it.
 *
 * **It lives here, not beside its first caller.** It began in
 * [`src/public/page-head.ts`](public/page-head.ts), which was its only user; the
 * export bundle wanted the same string on 2026-09-02 and a second copy of a
 * hostname is the kind of drift nothing catches until a domain moves. This file
 * is where URL facts live and it imports nothing, so both a server renderer and
 * the store can reach it.
 */
export const PUBLIC_ORIGIN = "https://www.spideryarn.com";

/**
 * **Where this article lives on Spideryarn** — the link back, from anywhere.
 *
 * One function rather than the same template written at each site, because
 * `og:url` is *parsed* back out by the client
 * ([`src/web/page-title.ts`](web/page-title.ts) § `serverComposedHead`, which
 * reads the last path segment), and a second spelling of the path is how the
 * writer and the reader come to disagree about where the slug is.
 *
 * `encodeURIComponent`, so a slug is one path segment whatever is in it: it is
 * a database column, not a checked identifier, and a `/` in one would otherwise
 * silently produce an address naming a different article. That is the whole of
 * the escaping — `"`, `%`, a backslash, a newline and every control character
 * come out percent-encoded, so nothing here can leave the path segment or reach
 * the origin.
 *
 * ## It takes an `isSlug` value, and `.` is why that is a contract rather than a hope
 *
 * `encodeURIComponent` leaves a dot alone, so a slug of `..` would compose to
 * `…/read/..` — which a browser resolves to the library, and `.` to a dead end.
 * A link that quietly names the wrong page is worse than one that fails.
 *
 * **And it cannot be escaped away.** The obvious fix is to percent-encode the
 * dots, and it does nothing: the URL standard counts `%2e` as a dot segment
 * exactly as it counts `.`, so `new URL("https://x/read/%2E%2E").pathname` is
 * `/` too. That guard was written here, looked right, and was deleted the same
 * afternoon when the test refused to go green — docs/reusable/silent-success.md
 * is the general case.
 *
 * So this is a precondition instead: **the slug must satisfy `isSlug`**
 * ([`src/ingest.ts`](ingest.ts), `^[a-z0-9][a-z0-9-]*$`), which admits no dot
 * and no empty string, and which every minted slug already satisfies. Not
 * asserted here, for two reasons: this file imports nothing on purpose (see the
 * top), and a throw inside `og:url` composition would trade a bad link for a
 * blank page. `tests/page-head.test.ts` pins the guarantee where it actually
 * lives. GPT Sol found the hole, 2026-09-02.
 *
 * Not escaped for HTML — the caller does that once at the markup boundary, for
 * the reason `safePublicCanonical` gives below.
 */
export function articleUrl(slug: string): string {
  return `${PUBLIC_ORIGIN}/read/${encodeURIComponent(slug)}`;
}

/**
 * **The article's own address, or nothing — for a `<link rel="canonical">`.**
 *
 * Stricter than `isWebUrl` above, and every extra rule is about the fact that
 * this one is *published*: a canonical tag is a public statement, made in a
 * document a stranger's link preview will fetch, about a URL we did not write.
 * `meta.url` is the final address the fetcher landed on after redirects, so it
 * carries whatever the site put there.
 *
 * The policy, and the one clause that is a judgement rather than a rule:
 *
 * 1. It must parse, and be `http:` or `https:`.
 * 2. **No username or password.** `https://user:pw@example.com/a` is a valid
 *    URL and publishing it hands out a credential.
 * 3. **Any query string at all and we emit nothing.** This is the judgement.
 *    The tempting move is to strip the query and publish the rest, and it is
 *    wrong in both directions: a signed or tracking query is unsafe to publish,
 *    and on a great many sites `?id=123` *is* the article's identity, so the
 *    stripped URL names a different document — usually a section index. A
 *    canonical pointing at the wrong page is worse than no canonical, because a
 *    search engine believes it. Refusing is the honest answer to *I cannot tell
 *    which of those this is*. GPT Sol, 2026-08-29.
 * 4. **The fragment goes.** `#section-3` never identifies a different document,
 *    and it is the one part of a URL droppable without changing which page is
 *    meant.
 * 5. **2,048 characters**, on the serialised result. Not a security limit — a
 *    URL that long is a tracking payload in disguise, not a canonical address.
 *
 * Escaping is **not** done here. The caller escapes once at the HTML boundary
 * ([`src/html.ts`](html.ts) § `escapeHtml`), because a function returning
 * pre-escaped text is the kind that gets escaped twice by the next person.
 *
 * Returns the URL to publish, or `null` to omit the tag. There is no third
 * answer: this is only ever called to decide whether one line goes into a head.
 */
export function safePublicCanonical(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  /* Both, and not only `username`: a URL may carry a password with an empty
     username, and `new URL` keeps them in separate fields. */
  if (url.username !== "" || url.password !== "") return null;
  /* `search` is `""` when there is no query — **including** for a bare trailing
     `?`, which the URL standard parses to an empty query rather than to a
     one-character one. So that case reaches here, and the assignment below is
     what removes the stray `?` from the serialisation: `url.toString()` keeps
     it otherwise, and `https://example.com/a?` is a worse canonical than
     `https://example.com/a` for no gain. Nothing is being decided away — a bare
     `?` carries no information, which is exactly what makes it different from
     the queries above. Found by the test, which had been written to expect a
     refusal. */
  if (url.search !== "") return null;
  url.search = "";
  url.hash = "";
  const out = url.toString();
  return out.length > 2048 ? null : out;
}

/**
 * **The article's own address, published to whoever can read the article.**
 *
 * Greg, 2026-08-30:
 *
 * > I think Public-readable articles *should* show their provenance-url to all
 * > reader[s].
 *
 * That is the product decision `public-reader.ts` was waiting on. Its
 * `PUBLIC_PROJECTIONS` comment had held `final_url` back and said so in as many
 * words — *"a visible 'read the original' link is a separate product decision
 * and would want its own named field rather than this one leaking sideways into
 * a DTO"* — so this is that named field's policy, and the column still does not
 * reach the wire as itself.
 *
 * ## It is `safePublicCanonical`, and the first draft of it was not
 *
 * A separate policy was written first, differing in one clause: **keep the query
 * string**, on the reasoning that a canonical tag is a machine's claim about
 * which document this is, whereas this is a person clicking through to read the
 * piece — and on a great many sites `?id=123` *is* the article, so refusing
 * would leave a chunk of the library with no way back to the original.
 *
 * `tests/public-visibility-pg.test.ts` § the eight canaries went red on it, and
 * it was right to. Its fixture's `final_url` is `…/piece?sig=SECRETSIGNATURE`,
 * and *signed* is the case the argument above skips: a tracking parameter is
 * noise, an id is the article, and a signature is **a capability the owner
 * holds** — very often their own paywall bypass. Publishing an essay is a
 * decision about the essay. Nothing in it implies handing out the key that got
 * us in, and from here the three are indistinguishable.
 *
 * So the honest answer to *I cannot tell which of those this is* stays the one
 * `safePublicCanonical` already gives, and the cost was measured rather than
 * assumed: **of the twenty articles in `data/` with a URL, none carries a
 * query** (2026-08-30). The clause defended against a case that does not arise
 * and would have cost a real credential when it did.
 *
 * ## Then why a second name at all
 *
 * Because the two are one policy by *coincidence of the current rules*, not by
 * definition — they are published for different purposes, and the query clause
 * is the one that could ever come apart (a canonical must never name the wrong
 * page; a reader's link merely disappoints). This is the seam that argument
 * would need, and the header it would need to be written in. Delegating rather
 * than copying is what stops the two silently disagreeing in the meantime.
 *
 * Returns the URL to publish, or `null` to publish none. A `null` here does
 * **not** mean the article was uploaded — that inference needs a reader who owns
 * the article, and `OriginMark` in src/web/Masthead.tsx says why.
 */
export function publicSourceUrl(value: string): string | null {
  const safe = safePublicCanonical(value);
  if (safe === null) return null;
  return publishableHost(new URL(safe)) ? safe : null;
}

/**
 * **Is this host one a stranger could have reached anyway?**
 *
 * Stage 1 already refuses to *fetch* a private destination — `guardAddress` in
 * src/fetch.ts resolves the name and checks every address, which is the real
 * SSRF guard and is far stronger than anything here. But not every revision is
 * written by stage 1: `copyArtefacts` (src/store/copy-artefacts.ts) copies a
 * manifest's `url` verbatim, with no fetch and so no `guardAddress`, and
 * `scripts/db-seed-dev.ts` drives it on every `npm run setup`. So a `final_url`
 * of `http://10.0.0.5/token` or `http://localhost/private` can exist in a
 * database, and this is the boundary that would publish it to the world. Raised
 * by GPT Sol, 2026-08-30.
 *
 * **The writer it was written about has been replaced by a narrower one, and
 * the reason survived the replacement.** The original was `src/store/import.ts`,
 * which took any `DATABASE_URL` — production included — and was deleted on
 * 2026-09-01 (`b73ad746`). Its successor reaches only a local database
 * (`isLocalDatabaseUrl` in scripts/db-reown-rules.ts) and only the committed
 * fixture corpus, so what stands between here and a bad URL in a reader's
 * database is now two guards rather than one. That is a smaller hole, not a
 * closed one, and it is why this function is still here.
 *
 * **A shape rule, not an address rule**, and deliberately the blunter of the
 * two. The honest version needs DNS — a public name can resolve to 10.0.0.5 —
 * and this runs inside a synchronous DTO with no network and no `await` to
 * spare. So it refuses by the only evidence it has:
 *
 *  - **Any IP literal, public ones included.** Enumerating RFC 1918, loopback,
 *    link-local, CGNAT and their six IPv6 counterparts is a list to keep right
 *    forever, and getting one range wrong fails open. An article addressed by
 *    bare IP is not a thing anybody publishes, so the whole class goes.
 *  - **Any host with no dot in it** — `localhost`, a container name, an
 *    intranet short name. Every public site has one.
 *  - **`.local`, `.localhost`, `.internal`**, which have dots and are not public.
 *
 * What it does **not** catch is a public name pointing inward. That is the
 * narrower hole and it is stage 1's to close for everything it fetches; saying
 * so here is better than a comment implying this function is a security
 * boundary it cannot be.
 */
function publishableHost(url: URL): boolean {
  /* `hostname` keeps the brackets on an IPv6 literal, which is what makes the
     first test catch `[::1]` without parsing it. */
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[")) return false;
  if (/^[\d.]+$/.test(host)) return false;
  if (!host.includes(".")) return false;
  return !/\.(local|localhost|internal)$/.test(host);
}

/**
 * **A citation's URL, as a stranger may have it** — or `null` to publish none.
 *
 * Added 2026-09-04, when a shared link began carrying the owner's comments and
 * the model's answers to them
 * (docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3). Every
 * `Citation.url` in that payload was chosen by a model out of a web search, so
 * the ordinary case is a perfectly public page — and the ordinary case is not
 * what a boundary is for.
 *
 * **Three refusals, and the omission is the interesting one.**
 *
 *  - Not `http`/`https` — the same first gate as everywhere else.
 *  - Credentials in the address. `https://user:token@example.com/x` is a
 *    secret pasted into a URL, and publishing it hands it out.
 *  - A host a stranger could not have reached anyway — `publishableHost`, the
 *    shape rule `publicSourceUrl` already leans on, with its own honest account
 *    of what it cannot catch.
 *
 * **The query string is kept, and that is the difference from
 * `safePublicCanonical`, which drops any URL that has one.** A canonical is a
 * machine's claim about which document this *is*, so a query makes it the wrong
 * claim. A citation is "here is where that came from", and half the public web
 * addresses its articles with a query — refusing them would silently drop real
 * citations and leave the reader an answer whose sources had evaporated. GPT
 * Sol raised citation sanitising in review and named the two risks this
 * refuses; keeping the query is the deliberate half of the answer, written down
 * so the next reader does not "fix" it into `safePublicCanonical`.
 *
 * A tracking parameter therefore crosses. That is a privacy nuisance about the
 * *publisher*, not a leak of the owner's, and stripping `utm_*` here would be a
 * second, partial copy of a job nothing else in this repo does.
 */
export function publicCitationUrl(value: string): string | null {
  if (!isWebUrl(value)) return null;
  if (hasCredentials(value)) return null;
  try {
    return publishableHost(new URL(value)) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The hostname, with a leading `www.` dropped — or `""` if the string will not
 * parse.
 *
 * The label a reader recognises. `aeon.co`, not
 * `https://aeon.co/essays/the-hard-problem-is-a-distraction?utm_source=…`.
 *
 * **`""` rather than a throw, and rather than the URL itself.** Both callers use
 * this to build something a person reads — a link's text, a line saying which
 * page was fetched — and in both places the input has already been through
 * `isWebUrl` or `new URL`, so an unparseable string arriving here means
 * something upstream has changed. Returning the raw string would put the whole
 * URL, query parameters and all, where a hostname was meant to go; returning
 * `""` lets the caller say "that page" and move on. Throwing was the third
 * option and it is the one this module exists to avoid — see `isWebUrl`.
 *
 * Three copies of this used to live in the client (ChatPanel, CommentDialog,
 * GlossaryPanel). ChatPanel and GlossaryPanel now point here — the latter on
 * 2026-08-27, when the glossary's hover card became a second caller of its
 * private copy. CommentDialog is the last one, and should follow when somebody
 * is next in that file.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * One parenthesised group in a URL, itself allowed to hold one nested pair.
 *
 * Not pedantry: `…/wiki/Mercury_(planet)` is an ordinary Wikipedia title, and a
 * pattern that stops at the first `)` links to a 404 and leaves a stray bracket
 * in the sentence. Two levels covers everything seen in the wild; three or more
 * is refused rather than truncated — see `webLinks`.
 *
 * **The alternation is unambiguous on purpose.** `[^\s()]` and `\(` cannot
 * match the same character, so there is no input on which the engine has two
 * ways to consume the same text. That is what keeps this out of the
 * catastrophic-backtracking family.
 */
const PARENS = String.raw`\((?:[^\s()]|\([^\s()]*\))*\)`;

/** Inside `](…)` a URL may hold anything but whitespace and unpaired brackets. */
const MD_CHARS = String.raw`[^\s()]`;

/**
 * `[what the page is](https://…)`.
 *
 * **The label excludes `[` as well as `]`**, and that is a performance fix
 * rather than a nicety. With `[` allowed, an input of n opening brackets makes
 * every one of them scan the rest of the string looking for a `]` — quadratic,
 * and measured at 1.25s for 32k brackets on model output that re-parses on
 * every streamed token. Found by a GPT Sol review, 2026-08-27.
 */
const MD_LINK = String.raw`\[([^\[\]\n]+)\]\(\s*(https?://${MD_CHARS}*(?:${PARENS}${MD_CHARS}*)*)\s*\)`;

/**
 * A bare `https://…`.
 *
 * The excluded characters are the ones that are nearly always punctuation
 * *around* an address rather than in it. `*` is on the list because
 * `**https://x.example/y**` otherwise linked to a path ending in two asterisks
 * — a wrong destination, silently.
 */
const BARE_CHARS = String.raw`[^\s<>"'\`\[\]{}()*]`;
const BARE_URL = `https?://${BARE_CHARS}*(?:${PARENS}${BARE_CHARS}*)*`;

/** Case-insensitive: `HTTPS://example.com/x` is a valid address. */
const LINKED = new RegExp(`${MD_LINK}|${BARE_URL}`, "gi");

/** Sentence punctuation that followed a bare address rather than belonging to it. */
const TRAILING = /[.,;:!?'"”’»]+$/;

/**
 * The same, for an address that already carries a query.
 *
 * `?` and `!` are dropped from the list there, because in
 * `https://x.example/search?q=why?` the second `?` is query data and trimming it
 * shortens the clickable range to a different page while the visible text looks
 * unchanged. No `)` or `]` in either list: the patterns above cannot end in one
 * unless it closed a pair they opened.
 */
const TRAILING_IN_QUERY = /[.,;:'"”’»]+$/;

/** A link found in a run of model prose. */
export interface WebLink {
  /** Where the whole match starts. */
  index: number;
  /** Where it ends, after any trailing sentence punctuation was handed back. */
  end: number;
  /** The model wrote a bare address rather than `[label](url)`. */
  bare: boolean;
  /** The match ran to the end of the text, before any trimming. */
  toEnd: boolean;
  /** The model's words for the destination — the address itself, when bare. */
  label: string;
  url: string;
}

/**
 * Every link in a run of model prose, in order.
 *
 * **One definition for both sides of the wire.** The client turns these into
 * anchors (src/web/citations.ts § `splitLinks`) and the server subtracts them
 * before counting block-id citations (src/converse.ts) — and the two must agree
 * about where an address starts and stops, or an id inside a URL is a chip on
 * one side and a hallucination in the log on the other. Two regexes would have
 * drifted the first time either was touched. This file is where such a thing
 * goes: it imports nothing, so both sides can reach it
 * (tests/client-imports.test.ts says why that matters).
 *
 * Three things are refused rather than linked, and each is refused *whole* —
 * the characters stay where the model wrote them:
 *
 *  - **Anything that is not `http(s)`**, via `isWebUrl` above.
 *  - **An address carrying credentials.** `https://trusted.example@evil.example/`
 *    reads as a link to `trusted.example` and goes to `evil.example`. The form
 *    has no legitimate use in a chat answer, so it is not shown as a link at
 *    all. Raised by a GPT Sol review, 2026-08-27.
 *  - **A bare address we had to cut at an opening parenthesis.** That happens
 *    only when the parentheses nest deeper than `PARENS` handles, and the cut
 *    would produce a link to a *different, shorter* page — worse than no link.
 */
export function webLinks(text: string): WebLink[] {
  const out: WebLink[] = [];
  for (const match of text.matchAll(LINKED)) {
    const label = match[1];
    const marked = match[2];
    const rawEnd = match.index + match[0].length;

    let url = marked ?? match[0];
    let end = rawEnd;
    if (marked === undefined) {
      if (text[rawEnd] === "(") continue;
      /* Trim boldly, then look at what is left: an address that still has a
         `?` in it has a real query, and its own trailing `?` is data rather
         than the reader's question mark. Testing the untrimmed string instead
         gets `…/x?` wrong, because the `?` it finds is the one being asked
         about. */
      const bold = url.replace(TRAILING, "");
      const trimmed = bold.includes("?") ? url.replace(TRAILING_IN_QUERY, "") : bold;
      end -= url.length - trimmed.length;
      url = trimmed;
    }
    if (!isWebUrl(url) || hasCredentials(url)) continue;

    out.push({
      index: match.index,
      end,
      bare: marked === undefined,
      toEnd: rawEnd === text.length,
      label: label ?? url,
      url,
    });
  }
  return out;
}

/**
 * `https://user:pass@host/` — a label built into the address itself.
 *
 * Exported since 2026-08-31, because a link the *parser* found needs the same
 * two refusals a bare one gets. `mdast-util-from-markdown` hands back whatever
 * string was between the brackets, so `[here](javascript:…)` and
 * `[here](https://user:pass@host/)` both arrive as ordinary `link` nodes and are
 * checked in src/web/Cited.tsx § drawLink. Two kinds of link, one answer.
 */
export function hasCredentials(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.username !== "" || parsed.password !== "";
  } catch {
    return true;
  }
}

/**
 * The same text with every link blanked out, character for character.
 *
 * For the citation counters, which look for block-id *shapes* in an answer:
 * `https://example.com/notes/spya-k3m9qt` carries one, and counting it records
 * either a citation the reader never sees or a hallucinated id that was never
 * hallucinated — and both of those numbers are watched
 * (src/converse.ts § `unknownCitedIds`). The renderer takes links out before it
 * looks for citations; this is how the counters do the same thing, using the
 * same matcher rather than a second one that can disagree.
 *
 * **Its one caller is now `citableText` (src/citable.ts)**, which does the rest
 * of that job — a code span, a link's label and an image's alt text are not
 * citable either, and no regex can tell where those are once the renderer is
 * parsing. This is the bare-address half of the answer and it stays here,
 * beside the matcher, because the server and the renderer must agree about
 * where an address stops.
 *
 * Spaces rather than deletion so that every other offset in the string is
 * unchanged.
 */
export function withoutWebLinks(text: string): string {
  let out = text;
  for (const link of webLinks(text)) {
    out = out.slice(0, link.index) + " ".repeat(link.end - link.index) + out.slice(link.end);
  }
  return out;
}

/* ------------------------------------------------- what a GET asks for --- */

/**
 * **What a GET would actually ask for, or `null` if this is not a web URL.**
 *
 * The WHATWG serialization with the fragment cleared, and **nothing else
 * touched**. The fragment is the one part of a URL that is never sent — `…/x#a`
 * and `…/x` are the same request — and that is the whole and only merge this
 * function is allowed to make.
 *
 * **This is not `urlKey`, and the two must never be conflated.** `urlKey`
 * (src/ingest.ts) is the *shelf's* notion of sameness and is deliberately
 * generous — it folds `http` into `https`, `www.` into the bare host and drops
 * tracking parameters, because two spellings of one address should be one row on
 * a bookshelf. Every one of those is a false positive when the question is *what
 * did we ask the network for*: `http` and `https` can serve different pages, and
 * a query parameter we chose to ignore is a parameter the far end may act on. So
 * there are **two identities**, and which one a caller wants is a real decision:
 *
 * - `urlKey` for reader-facing equivalence — shelf membership, the Add button;
 * - this one for the fetch cache, the single-flight claim, and — through
 *   `articlePointsAt` in src/link-previews.ts — **whether this reader is allowed
 *   to make us fetch that address at all**.
 *
 * ## It used to decode the path, and that was wrong for this job
 *
 * Until 2026-09-05 this percent-decoded the pathname and dropped a trailing dot
 * from the host, so that `/%78` and `/x` were one request. Both merges are
 * **false**: `/a%2Fb` is not `/a/b`, `/a%3Fb` is not `/a?b`, and a trailing dot
 * is a distinguishable virtual host. That was harmless while the only consumer
 * was `read_web_page` refusing to re-fetch the open article, where merging too
 * much is the *conservative* direction — and it stopped being harmless the
 * moment the same key became an **authorization** key and a **global cache**
 * key, where merging too much means an article that links `…/a%3Fb` authorises a
 * fetch of the different address `…/a?b`, and one page's content is served for
 * another's. GPT Sol, 2026-09-05, finding P1-1.
 *
 * The generous version still exists, because the chat tool still wants it, and
 * it is `sameTarget` below — named for what it is rather than shared with this.
 *
 * `new URL` has already lowercased the host, dropped a default port, and
 * normalised the escapes it is allowed to normalise.
 *
 * **It lived in src/chat-tools.ts until 2026-09-05** and moved here at its
 * second caller. Moved rather than copied, and that is the same rule
 * `articleLinks` states about its own HTML parse: a second implementation that
 * could disagree with this one about what counts as the same request is exactly
 * what a cache key must not be built on.
 */
export function requestTarget(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/**
 * **Would fetching these two probably ask a server for the same thing?**
 *
 * *Probably*, and the difference from `requestTarget` is the whole point of this
 * being a second function rather than an equality test on the first.
 *
 * Its one caller is `read_web_page`'s refusal to fetch the article the reader
 * already has open (src/chat-tools.ts), and **there, merging too much is the
 * safe direction**: a false match costs the model one fetch it did not need of a
 * page it has already been given, and a false *miss* costs the reader ten
 * seconds and a request to their publisher saying somebody is reading this right
 * now. So this keeps the decoded path and the trailing-dot host that
 * `requestTarget` gave up on 2026-09-05 — `…/essays/%78` and `…/essays/x` are
 * one page as far as *that* refusal is concerned.
 *
 * **Do not use it as a cache key or an authorization key.** Over-matching there
 * means serving one page's content for another's, which is the direction
 * `requestTarget` exists to refuse. GPT Sol, P1-1.
 */
export function sameTarget(a: string, b: string): boolean {
  const one = generousTarget(a);
  return one !== null && one === generousTarget(b);
}

/** `sameTarget`'s key: `requestTarget`, then the two merges it will not make. */
function generousTarget(url: string): string | null {
  const exact = requestTarget(url);
  if (exact === null) return null;
  const u = new URL(exact);
  const host = u.hostname.replace(/\.$/, "");
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* A stray percent. The raw path is still a fine key; it just will not match
       its own decoded spelling, which is the conservative direction here. */
  }
  return `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}${path}${u.search}`;
}

/**
 * The query-parameter names that make a URL look like a key rather than an
 * address — see `carriesCredential`.
 *
 * Compared with punctuation and case stripped, so `X-Amz-Signature`,
 * `access_token` and `apiKey` all land on one entry.
 */
const CREDENTIAL_PARAMS = new Set([
  "token",
  "tokenhash",
  "accesstoken",
  "idtoken",
  "refreshtoken",
  "auth",
  "authkey",
  "authorization",
  "apikey",
  "key",
  "resourcekey",
  "rlkey",
  "secret",
  "clientsecret",
  "password",
  "passwd",
  "passcode",
  "pwd",
  "pin",
  "otp",
  "signature",
  "sig",
  "hmac",
  "jwt",
  "session",
  "sessionid",
  "sid",
  "ticket",
  "code",
  "invite",
  "share",
  "sharekey",
  "xamzsignature",
  "xamzcredential",
  "xamzsecuritytoken",
  "xgoogsignature",
  "xgoogcredential",
]);

/**
 * **Does this URL look like it carries something that works like a key?**
 *
 * A signed S3 link, an unsubscribe token, a password-reset address, a session id
 * in a query string. `link_previews` (src/db/schema.ts) is the first ownerless
 * table in this schema — a row in it outlives the article that introduced it and
 * answers to any reader who hovers the same address — so *the exact URL plus
 * what came back from it* is the worst available place to put a credential. Such
 * URLs are refused rather than cached. GPT Sol, 2026-09-05, finding P1-7.
 *
 * ## It is a heuristic and it cannot be complete, and that has to be said
 *
 * The first version of this comment claimed the guarantee outright —
 * *"credential-bearing URLs are refused"* — and a review was right that a
 * name-based denylist cannot support that sentence: a capability can live in a
 * path segment, or under a parameter name nobody has thought of. What this
 * *does* give is the common shapes, refused before the row is written, plus one
 * thing that matters more than the list: **the caller checks every URL in the
 * redirect chain**, not only the one the author published, because a harmless
 * published address can redirect into a signed one. GPT Sol, P1-3.
 *
 * Two rules, and both are deliberately over-eager. The cost of a false positive
 * is a card that stays exactly as it was, which is what the reader already sees
 * for any destination we cannot reach; the cost of a false negative is a secret
 * written into a shared table.
 *
 * 1. `user:pass@host` — `hasCredentials` above, which the chat renderer already
 *    uses for the same reason.
 * 2. A query parameter whose **name** is in `CREDENTIAL_PARAMS`. Names rather
 *    than value shapes, because a token is only a string and any entropy test
 *    would refuse ordinary article slugs. `code`, `key` and `share` are on the
 *    list knowing they have innocent uses: the cost of refusing one of those is
 *    a card that says a little less.
 */
export function carriesCredential(url: string): boolean {
  if (hasCredentials(url)) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Unparseable is somebody else's refusal to report; it is certainly not
    // something to write into a shared table.
    return true;
  }
  for (const name of parsed.searchParams.keys()) {
    if (CREDENTIAL_PARAMS.has(name.toLowerCase().replace(/[^a-z0-9]/g, ""))) return true;
  }
  return false;
}

