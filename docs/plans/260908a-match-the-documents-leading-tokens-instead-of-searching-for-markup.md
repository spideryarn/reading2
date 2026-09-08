# Match the document's leading tokens instead of searching for markup

**Status:** planned, 2026-09-08. Not started.

**Why:** the fix that landed the night before
([260907c](../postmortems/260907c-a-heuristic-promoted-to-a-gate.md)) was landed **knowingly
incomplete**, on Greg's call, to unblock an upload that was refused in production. GPT Sol's review
of it was *ship-with-changes*, blocking, and the finding is right — verified rather than accepted.

> land what you have now and push, then the structural rewrite
>
> — Greg, 2026-09-08

## The problem in one table

`DOCUMENT_MARKUP` is a **substring search** over the first 16 KB. Widening its tag list to fix a
valid page therefore widened what else it accepts. Measured, old code against new, with a vague
content type:

| input | old | new (landed) | wanted |
|---|---|---|---|
| the tutorial page that started this | `null` | `html` | `html` |
| JSON containing `<script>` | `null` | `html` | `null` |
| Atom feed (`<title>`, `<link>`) | `null` | `html` | `null` |
| RSS feed (`<title>`) | `null` | `html` | `null` |
| SVG (`<title>`, `<style>`) | `null` | `html` | `null` |
| `< html>` — a space after the `<` | `html` | `html` | `null` |

The reproduction is `verify-sol.mts` in the session scratchpad; it is four lines of `sniffKind` calls
and is worth re-typing rather than hunting for.

**And the excuse that was made for tolerating this is false.** The landed code's own comment argued a
false positive costs only a later *"no article here"* from stage 2. Sol fed each of those four inputs
enough text to clear Readability's threshold and got **publishable articles**. That was an assumption
about a downstream stage that nobody ran — the same mistake as the bug it was excusing.

**What narrows it, without excusing it:** on the fetched path this branch is reached only for a vague
content type (`null`, `text/plain`, `application/octet-stream`, `application/pdf`), so a feed served
honestly as `application/rss+xml` is still refused. The real exposure is the **upload** path, which
has no content type at all — and uploads are exactly where a reader hands us an arbitrary file.

## The design: ask what the document *starts with*

Stop searching. Skip a BOM, whitespace, comments and an XML declaration, then match the **first real
tag**. Everything else is not a document.

```
skip:   BOM · whitespace · <!-- … --> · <?xml … ?>
accept: <!doctype html · <html · <head · <body · <title · <meta · <link · <base · <style · <script
        …each followed by a tag-terminating byte
refuse: anything else, including <feed <rss <svg <div <p, and text that is not a tag at all
```

**This is what the standard actually says**, which the landed version half-cited. The WHATWG MIME
Sniffing Standard's
[pattern-matching algorithm](https://mimesniff.spec.whatwg.org/#pattern-matching-algorithm) ignores
*leading* whitespace and then matches **at that position**; it never searches the resource. The
landed change took the spec's tag *list* and kept our own substring *semantics*, and the semantics
were the half that was wrong.

**Why this is simpler, not more elaborate.** One question with one answer — *what does this document
open with* — replacing a fuzzy one: *does anything document-shaped appear anywhere in 16 KB*. It also
takes the load off `MARKUP_WINDOW`'s exact size, which stops being a number anybody has to defend,
and it fixes the `<\s*` defect for free because there is no longer a search that can land mid-string.

**The cost, named at the point of choosing.** A page with stray junk before its doctype — a broken
include emitting a `<br>`, a PHP notice — is tolerated by a substring search and refused by this.
That trade is the right way round: junk-before-doctype is rare, and a feed silently becoming an
article is not. If it turns out to bite, the recovery is a bounded skip of leading non-tag text, and
that is a change to make **on evidence**, not in advance.

### The simpler option passed over

**Keep the substring search and add a veto** for `<svg`, `<feed`, `<rss` roots. Rejected: it is more
parts, not fewer — a search plus a blocklist of things the search should not have matched — and a
blocklist is open-ended in a way the accept-list is not. The next false positive (MathML? a KML file?
an Atom feed with no `<?xml` prolog?) needs another entry, and nobody will think to add it until a
reader reports it. That is the shape of the bug we are already fixing.

## Stages

Two, each ending with the suite green and the tree safe to commit.

### Stage 1 — the detector, and both callers

- A new function in [`src/fetch.ts`](../../src/fetch.ts) replacing `DOCUMENT_MARKUP`, used by
  `sniffKind` and `uploadedDocumentKind` — one spelling, as the existing docstring argues.
- **Negative tests are the point of this stage**, and they are the six rows of the table above plus
  the ones already in the suite (`{"template":"<p>hello</p>"}`, a renamed video, prose, a zip).
- **Positive tests must not regress**: the tutorial page, XHTML with an `<?xml` prolog, a
  Chrome-saved page with its `<!-- saved from url -->` comment, UTF-16LE and BE, a page opening at
  `<meta charset>`, a bare `<body>`.
- Done when: every row of the table matches the *wanted* column, `tests/fetch.test.ts` green, full
  suite green, `npm run check` clean, and the real 108 KB file still ingests end to end.

### Stage 2 — the bytes beat the name, which they currently do not

Sol's second finding, non-blocking then and in scope now because it is the **third instance of the
same class** in this one function: *the markup scan cannot see markup it should*.

Measured: a UTF-16 HTML page uploaded as `a.pdf` returns `null`, because `sniffKind`'s Latin-1 scan
cannot see UTF-16 markup and `uploadedDocumentKind` gives up before reaching the decoder. So the
**filename overrules the bytes**, which is the opposite of what this module's docstrings say it does
in three places.

- Done when: `uploadedDocumentKind("a.pdf", <utf-16 html>)` is `"html"`, with a test that was red
  first, and the docstrings' claim is true rather than aspirational.

### Along the way

- Update [260907c](../postmortems/260907c-a-heuristic-promoted-to-a-gate.md) — its *"the fix that is
  right"* section is written as a proposal and becomes a description.
- Update this doc at the end of each stage: what landed, what changed, what is now known.

## Review

Sol at the start on this plan, and at the end of each stage on the diff — the second weighted higher.
Two rounds per stage, then settle and write down anything overruled.

## What this deliberately does not do

- **No general MIME framework, and no adopting `computedMIMEType`.** Its step 1 returns a declared
  `text/html` without sniffing, reversing this module's body-wins rule and un-catching the
  challenge-page-served-as-`application/pdf` case. Argued in full in
  [260907c](../postmortems/260907c-a-heuristic-promoted-to-a-gate.md); the library research behind it
  is summarised there too.
- **No new document kinds.** Still HTML and PDF.
- **No change to `GET /api/source/:slug`**, which is a stored-XSS boundary and out of scope for a
  detector change.
