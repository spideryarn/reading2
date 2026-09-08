# A heuristic promoted to a gate

Uploading an HTML file shipped on the morning of 2026-09-07
([260907b](../plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md)). That evening Greg uploaded
one of our own tutorial pages and got the refusal the same commit had just reworded:

> That file isn't a PDF or a web page inside, whatever its name says. … `[up-pdf]`

**Nothing reached another reader** — an upload is one reader's file and the refusal releases their
slot. What it cost was the feature itself: for about fourteen hours, "upload an HTML file" refused a
shape of HTML file we generate ourselves, and the first person to try it was the person who asked
for it.

It is also the second bug in one day in the same twelve lines, which is the reason this file exists.
The first — a UTF-16 page the Latin-1 scan could not see — was caught by a GPT Sol review before it
shipped. Both are the same shape. Only one of them was recognised as a shape.

## What happened

`uploadedDocumentKind` refused the file. Reproduced against the real 108 KB upload, both versions in
one process so the control is the code and not the file:

```
bytes            = 108335
first tag offset = 4106
worktree (fixed) = html
primary (old)    = null
```

**Two independent causes, either sufficient.**

1. The file has no `<!doctype>`, no `<html>`, no `<head>` and no `<body>` **anywhere in 108 KB**. It
   opens with a comment, then `<title>`, `<meta>`, `<style>`, `<main>`. That is not malformed:
   [tag omission](https://html.spec.whatwg.org/multipage/syntax.html#optional-tags) is in the HTML
   spec, all three start tags are optional, and every browser builds the same tree. `DOCUMENT_MARKUP`
   matched only those four markers.
2. Its first tag is at byte 4106, behind 4102 bytes of comment. The raw scan looked at 1030 bytes and
   the decoded fallback at 4096 — so the marker was **ten bytes** past the end of the only window
   that could have seen it.

Either one alone refuses the file, which is why the fix is two changes and the test pins both.

## The class, named: a heuristic promoted to a gate

The regex is not new. It was written inline on 2026-08-25 in `841ed6bd` ("Fetch a page properly,
because other people's servers lie") as the **last** branch of `sniffKind` — the guess you fall
through to when a server sends no content type, or shrugs with `octet-stream`. In that position it is
a tiebreaker over a case that barely arises: nearly every server says `text/html`, and `sniffKind`
returns on `declaredHtml` before the regex is ever reached. A false negative meant one odd URL out of
thousands was refused, and none ever was.

`30154bfa` this morning named it `DOCUMENT_MARKUP` and gave it a second caller. An upload has **no
header at all** — the only claim is a filename — so for the upload path that fall-through branch is
not the last resort. It is the whole decision, on every file, for a reader who chose the file
deliberately.

**The class: a check keeps its old standard of evidence when it is moved to a position that demands a
new one.** Nothing about the regex changed and nothing about it needed to; what changed was how much
now rested on it. The review, the tests and the plan all examined the *new* code carefully. Nobody
re-asked whether the *old* line was good enough for the new job, because it was not part of the
diff — it was the thing the diff reused, and reuse is what we tell ourselves to do.

Two properties turn a heuristic into a gate, and this move had both:

- **The evidence got weaker.** A URL carries a header; an upload carries a filename the reader typed.
  The branch that ran when evidence was missing became the branch that always runs.
- **The consequence got worse.** A refused fetch is one URL a reader can work around. A refused
  upload is a file the reader is holding, with no other way in, and our own copy says *"sending it
  again will not help"* — which was true and unhelpful.

**A sibling hunt found none.** Grepping `src/` for other format detection turns up only `PDF_HEADER`,
and that one is keyed on `%PDF-\d\.\d` — something the format *requires*, at a position the format
*specifies*. So the second half of the concrete error is worth stating on its own, because it is what
made the promotion fatal rather than merely risky: **`DOCUMENT_MARKUP` was keyed on what HTML makes
optional.** A sniffer must key on what a format guarantees. HTML guarantees almost nothing
structurally — that is exactly the trap, and it is why the fix takes its tag list from the WHATWG
MIME Sniffing Standard rather than from another guess.

## Why nothing went red

Every check ran, and every one of them was satisfied.

- **The unit tests passed** — including three written that morning specifically to pin what gets
  refused. Every fixture in `tests/fetch.test.ts` was built from `page`, a string that begins
  `<!doctype html><html><head>`. The suite proved the check accepts documents shaped like the one the
  author had in mind, which is the check agreeing with the code about what a document looks like:
  [silent-success.md](../reusable/silent-success.md) exactly.
- **`npm run typecheck` and `npm run check` passed.** Nothing here is a type error.
- **The GPT Sol review raised the sibling and was acted on — narrowly.** Sol found that a UTF-16LE
  page's markup is invisible to a Latin-1 scan, and the fix was a decode fallback. That finding was
  *"your markup scan has a blind spot"*. It was read as *"your markup scan has this blind spot"*, and
  the response fixed the one instance named. The tag list and the window were never re-examined,
  though both were blind spots of the same kind sitting in the same function.

  **This is a different failure from nobody seeing it, and it deserves a different fix.** A reviewer
  did see it. What was missing was the step after: when a review names a defect, ask what class it is
  an instance of before writing the patch.
- **The end-to-end test passed** — `tests/an-uploaded-html-file-becomes-an-article.test.ts`, built
  from the same well-formed fixture.

## What would have caught it, ranked by ease against value

1. **Take the tag list from the spec, not from memory.** Done. `whatwg-mimetype/lib/sniff.js` — a
   faithful implementation of the WHATWG MIME Sniffing Standard's pattern table — is already in
   `node_modules` under jsdom, and its list is quoted in the `DOCUMENT_MARKUP` docstring. One lookup,
   and the "which tags actually mark a document" question stops being answered by whoever is typing.
2. **Test a format detector on files the project already contains, not on a fixture the author
   wrote.** A fixture written by the author of the check inherits the author's mental model of the
   format; a corpus does not. `docs/tutorials/*.html` is six files and would have taken one loop:

   ```
   for f in docs/tutorials/*.html; do … uploadedDocumentKind …; done
   ```

   **And it would have found this, but only just** — measured rather than assumed: **one of the six**
   lacks all four markers, and it is the very file Greg uploaded. The other five carry `<!doctype>`.
   So a corpus of six catches it and a corpus of five does not, which is a thin margin to praise. The
   habit is still the cheapest thing here and still the one worth carrying — **when you write a
   detector, feed it something you did not author** — but it is worth being honest that this
   particular corpus would have squeaked.

   What makes the shape recur rather than be a one-off is where that file came from.
   [write-tutorial.md](../reusable/write-tutorial.md)'s Structure block prescribes both ingredients
   in its first two lines — a head given as bare `<title>` and `<meta name="description">` with no
   document skeleton named, then *"HTML comment — the user's exact request"* — so a tutorial that
   omits the wrapper and opens with 4 KB of quoted request is the template being followed, not
   ignored. Five of six authors added a doctype anyway. The sixth did not, and was not wrong to.
3. **When a review finding is a blind spot, patch the class.** Stated as a rule: a finding of the form
   *"X cannot see Y"* is a claim about X's coverage, and the response is to enumerate what else X
   cannot see. Belongs in
   [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md) beside "check each finding
   yourself; some are wrong" — because "some are narrower than the problem they found" is the same
   discipline.
4. **A named window per question, rather than a number in scope.** Done, as `MARKUP_WINDOW`. `1030`
   was correct for a PDF header and was reused for markup because it was the slice already in hand.
   The constant now carries its own justification, and a justification is a thing a reader can
   disagree with.
5. **Adopt `whatwg-mimetype`'s `computedMIMEType` wholesale — rejected**, and worth recording so it
   is not proposed again. Its step 1 returns a declared `text/html` *without sniffing*, which is the
   exact opposite of this module's rule that the body wins over the header. Adopting it would silently
   stop catching the Cloudflare-challenge-page-served-as-`application/pdf` case `sniffKind` was built
   for. A spec-blessed **list** is worth having; the spec's **precedence** is not ours, because a
   browser and an ingest pipeline are answering different questions.
6. **A general MIME-detection layer — rejected.** The gap was never that we lacked machinery. Two
   regexes and two windows were the right size for this job; one of them was simply wrong about HTML.

## The fix that shipped, and the fix that is right

**These are not the same thing here, and the gap is the most useful part of this file.**

What shipped, on Greg's instruction to unblock the upload now and correct it properly afterwards:

- `DOCUMENT_MARKUP` gains the head-level elements — `title`, `meta`, `style`, `script`, `link`,
  `base` — as a **subset** of the WHATWG list, because the spec's full list includes `<A`, `<B`,
  `<P`, `<DIV`, `<BR`, `<!--`, which would reopen `{"template":"<p>hello</p>"}` outright.
- One `MARKUP_WINDOW` (16 KB) for both the raw and the decoded scan, kept separate from the PDF
  header's 1030.

**It is knowingly wrong, and here is the measurement.** GPT Sol's review of this change came back
*ship-with-changes*, blocking, on the ground that widening a **substring search** admits things that
are not documents. Verified rather than accepted — old code against new, vague content type:

| input | old | new |
|---|---|---|
| JSON containing `<script>` | `null` | `html` |
| Atom feed (`<title>`, `<link>`) | `null` | `html` |
| RSS feed (`<title>`) | `null` | `html` |
| SVG (`<title>`, `<style>`) | `null` | `html` |

Four inputs the old code refused correctly. And the argument this file made for tolerating that —
*a false positive is only a later "no article here" message* — **is false**: Sol fed each of them
enough text to clear Readability's threshold and got publishable articles. That claim was an
assumption about a downstream stage that nobody ran, which is the same mistake as the bug it was
excusing, one section further down the page.

Two things narrow the blast radius without excusing it: on the fetched path this branch is reached
only for a vague content type, so a feed served as `application/rss+xml` is still refused; the real
exposure is the upload path, which has no content type at all.

**The fix that is right: stop searching, and look at what the document starts with.** Skip a BOM,
whitespace, comments and an XML declaration, then match the **first real tag**. That accepts the file
this postmortem is about (comment skipped, `<title>` found), refuses all four rows above (`<feed>`,
`<rss>` and `<svg>` are not document tags, and JSON does not begin with a tag at all), fixes the
`<\s*` defect that lets `< html>` through, and makes `MARKUP_WINDOW`'s exact size stop being
load-bearing. It is also what the standard actually says: the WHATWG algorithm ignores *leading*
whitespace and then matches **at that position**. It never searches the resource, which means the
sentence above about taking the list from the spec was half a citation — the list is the spec's, the
substring semantics never were.

Its one real cost, named so the next person does not discover it: a page with stray junk before its
doctype — a broken PHP include emitting a `<br>` — is tolerated by a substring search and refused by
this. That is the trade being made, and it is the right way round, because junk-before-doctype is
rare and a feed becoming an article is not.

**The one thing still not done after that**, deliberately: `sniffKind` has two callers with different
evidence — a fetched page has a header, an upload has only a filename — and one shared standard. A
cleaner design gives the upload path its own threshold. Passed over because two regexes drift and the
docstring already argues that one question deserves one spelling. If a third caller appears, revisit.

## The thing I would tell myself

I had the answer in my hands and used it once. Sol told me the markup scan could not see UTF-16
markup, and I wrote a decode fallback, ran the test, watched it go green, and moved on — pleased,
because a reviewer had found a real bug before it shipped and I had fixed it. What I never did was
sit with the sentence *the markup scan cannot see some real markup* and ask what **else** it could
not see. Ten minutes on that question would have produced both remaining causes, because they were
sitting in the same twelve lines, and one of them was a `<title>` away.

The other thing: I wrote the tests and the fixture in the same sitting as the check, from the same
picture in my head of what an HTML file looks like — `<!doctype html><html><head>`. That picture is
of a *typical* file, and a detector's whole job is the untypical ones. Every one of the fixtures
proved the check agreed with me; none of them asked whether either of us was right about HTML. The
answer was a `for` loop over six files in this repo, and it did not occur to me to write it, because
the fixtures were already green and green is what I was checking for.
