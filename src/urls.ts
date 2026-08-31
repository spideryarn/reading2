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

