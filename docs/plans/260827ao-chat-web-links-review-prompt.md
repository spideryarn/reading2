# Review: letting a chat answer link to the web

You are reviewing a small feature in **Spideryarn**, a TypeScript/React reading app. Be adversarial.
I want defects, not encouragement. If you think something is fine, say so briefly and move on.

## What was asked for

Greg, 2026-08-27:

> Allow chat responses to include hyperlinks to the web (e.g. in response to searching the web if it
> found something useful). These should reuse our tooltips machinery for previewing hyperlinks that
> we use in the main text.

## What the app already had

- **Chat** answers stream from a model (via OpenRouter) into a panel beside the article. Until now
  the panel rendered model output as **text only**: `splitCitations` turns this article's own block
  ids (`spya-k3m9qt`) into pressable chips, `splitEmphasis` turns `**bold**` into `<strong>`, and
  everything else is a string React escapes. Never `dangerouslySetInnerHTML`.
- Web pages the model consulted appear as a **bibliography list** under the answer, built from
  OpenRouter `url_citation` annotations. Nothing inline.
- **A hover card over hyperlinks in the article's prose** — `ProseHoverCard.tsx` +
  `useHoverCard.ts`. It is *one* Floating UI panel for the whole page, driven by a **delegated
  `pointerover` listener on `document`** filtered by a CSS selector, because the prose is injected
  HTML with hundreds of targets. The card shows: host, whether the link leaves the site the article
  came from, any scholarly id in the path (arXiv/DOI/PhilPapers), an entry from the reader's own
  library if we already have that page, a Wikipedia summary if it is a Wikipedia article, and the
  full URL.

## What was built

1. `splitLinks` in `src/web/citations.ts` — a new first pass over a paragraph of model prose,
   producing runs of text and runs of link. Markdown links and bare URLs. `isWebUrl` (http/https
   allowlist) gates every match.
2. `CitedText` in `src/web/Cited.tsx` now runs **links → citations → emphasis** in that order, and
   renders a link as `<a class="cited-link" target="_blank" rel="noopener noreferrer">`.
3. `ChatPanel.tsx`'s `Answer` passes `partial` for the last paragraph while an answer is streaming.
4. `src/converse.ts` — a `LINKING TO THE WEB` block added to the system prompt (verbatim below).
5. `ProseHoverCard.tsx` — the hover selector was **narrowed** from `"mark.term, a[href]"` to
   `"mark.term, .prose a[href], a.cited-link, .chat-sources a[href]"`, and a new `host` option was
   added to `useHoverCard` for the MutationObserver that closes a card when its anchor is replaced.
6. CSS for `.cited-link`; tests; docs.

## Read these

- The plan, which states the reasoning and what was deliberately not built:
  `docs/plans/260827ao-chat-web-links.md`
- The scoped diff, handed over as a scratch file: only the hunks belonging to this piece of
  work, since three of the touched files carry other agents' in-flight changes — see the warning
  below.
- The tests: `tests/chat-web-links.test.ts`, `tests/chat-web-links-render.test.tsx`
- Existing context you may want: `src/web/citations.ts` (whole file), `src/web/Cited.tsx`,
  `src/web/useHoverCard.ts`, `src/web/ProseHoverCard.tsx`, `src/web/link-preview.ts`,
  `src/urls.ts`, `docs/project/links.md`, `docs/project/security.md`.

**A warning about the diff.** This repository is worked on by several agents at once, and three of
the touched files carry *other people's* in-flight work in the same hunks:

- `src/converse.ts` — a peer is rewriting large parts of the streaming code. **The only change of
  mine in that file is the `LINKING TO THE WEB` block**, reproduced below. Ignore everything else
  you see there.
- `src/web/useHoverCard.ts` — a peer is adding **touch/tap support** (`tapSelector`, `onCommit`,
  `TAP_SLOP`, `SWALLOW`, `pointerUp`). **My changes there are only the `host` option and the
  MutationObserver's `watched` lookup.** Ignore the touch code.
- `src/web/ChatPanel.tsx` and `src/web/styles.css` similarly carry peer edits.

The prompt block I added, in full:

```
LINKING TO THE WEB

When a page is worth the reader's click, link it in the sentence that mentions
it: [what the page is](https://example.com/the-piece). The label says what they
would be opening, not "here" or "this link", and not the bare address.

- NEVER invent a URL. Link only an address that came back from a tool on this
  turn. A URL you half-remember is the same failure as a made-up block id, with
  one difference that makes it worse: nothing on our side can check it, so a
  reader finds out by following it.
- http and https only.
- Link a page once. A wall of links reads as a search result, not an answer.
```

## What I most want you to attack

1. **The regexes.** `MD_LINK`, `BARE_URL`, `LINKED`, `TRAILING` in `citations.ts`. Find inputs that
   produce a wrong `href`, lose text from the model's answer, or produce a link whose visible label
   and actual destination disagree in a way a reader could not notice. Catastrophic backtracking is
   a live concern: `LINKED` is an alternation of two patterns that each contain a starred group
   over a character class, applied to model output. Is there an input that blows up?
2. **Text loss.** `splitCitations` had a real bug once where a bracket containing an id *and* prose
   was replaced whole and the prose was deleted. Can `splitLinks` lose or duplicate characters? The
   `stop` arithmetic after trimming trailing punctuation is where I'd look first.
3. **Interaction between the three passes.** Links are extracted before citations specifically
   because a URL path can contain `spya-` + 6 chars. Is there a case where the new ordering breaks
   something citations or emphasis used to get right? What about `**` spanning a link, e.g.
   `**see [here](https://x.example/y) now**`?
4. **The `partial` rule** (a bare URL touching the end of the last paragraph of a streaming answer
   is left as text). Is it right? Is it in the right place — `Answer` computes
   `partial={live && p === paras.length - 1}`. Does that hold when the model writes a trailing blank
   line, or when `text.split(/\n{2,}/)` produces a trailing empty string?
5. **Security.** This is model output reaching an `href`, and the model reads untrusted web pages
   before writing. Is the `isWebUrl` gate actually sufficient at this boundary? Consider unusual
   URL forms: `https:/\/\evil.example`, embedded credentials (`https://user:pass@host/`), unicode
   and IDN homographs, `%00`, whitespace inside the address, a `data:` payload smuggled after a
   valid-looking prefix. Note that we *do* deliberately allow a deceptive label and rely on the
   hover card to expose the real host — tell me if that reliance is misplaced.
6. **The selector narrowing.** Did I break anything by removing the blanket `a[href]`? Are there
   anchors in the article prose that are *not* inside `.prose`? Is `a.cited-link` the right hook,
   given the same class now appears in the summary panel too (`CitedText` is shared) — and the
   summary panel is not inside `.prose`, so its links get a card via `a.cited-link`; is that right
   or surprising?
7. **The `host` option and the MutationObserver.** I claim that a chat answer's `<p>` is replaced
   during streaming and that an observer on the detached old `<p>` never fires for the `<p>`'s own
   removal, so the card would stay pinned to a node out of the document. Is that reasoning correct?
   Is `.prose, .chat-turn` the right pair, and does `closest()` with a comma selector do what I
   think? Also: the effect's dependency array is `[shown, host]` — is that right?
8. **Streaming cost.** Every token re-renders the answer, and `splitLinks` now runs on every
   paragraph on every token. `LINKED` is a module-level regex with the `g` flag used via
   `matchAll` — is `lastIndex` state a hazard here? Is the per-token cost acceptable?
9. **Anything in the plan doc that is wrong, overclaimed, or that documents a decision I have not
   actually implemented.**

## What I do not want

- Style opinions, naming preferences, or suggestions to add a Markdown library. The house rule is
  "prefer boring", and pulling in a full Markdown renderer for model output is exactly the thing
  `docs/project/security.md` argues against.
- Suggestions that require a React testing library. This repo deliberately has none beyond
  `react-dom/client` + jsdom.

## Output

For each finding: the file and line, what breaks, a concrete input or sequence that produces it, how
bad it is, and the smallest fix. Rank by severity. If you find nothing in a numbered area above, say
so explicitly for that area — a review that returns nothing looks exactly like one that found
nothing.
