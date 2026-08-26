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
 * Three copies of this live in the client (ChatPanel, CommentDialog,
 * GlossaryPanel). ChatPanel's now points here; the other two should follow when
 * somebody is next in those files.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
