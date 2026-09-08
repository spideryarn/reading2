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

Stop searching. **One tokenizer, two predicates** — settled 2026-09-08 after Sol refused the
single-predicate version (F4) and Fable arbitrated. The first draft of this section had one rule for
both callers; the argument that changed it is below under *Why two predicates and not one*.

```
tokenize (shared):  skip BOM · whitespace · <!-- … --> · <?xml … ?> → the first real token

fetched, vague mime:   POSITIVE evidence. The anchored WHATWG signature table, and nothing
                       else. We are guessing, so we need a reason to say yes.

upload claiming .html: NEGATIVE evidence. Refuse only what proves it is something else —
                       (a) the WHATWG binary-data-byte test, and
                       (b) an <?xml prolog whose first root tag is not <html.
                       Otherwise accept, and let stage 2 say whether there is an article.
```

**The veto is a closed rule, not a list of formats.** This is Fable's correction to my own plan and
it is the part worth reading. The WHATWG standard has two halves, and this design takes one each: the
pattern table is positive evidence, and the **binary-data byte** — any of `0x00–0x08`, `0x0B`,
`0x0E–0x1A`, `0x1C–0x1F` in the first 1445 bytes, tested *after* a UTF-16 BOM check — is the spec's
own answer to *"is this text at all"*. One rule covers PNG, JPEG, GIF, ZIP and everything built on it
(docx, epub), gzip, MP4, WebM, legacy Office and a renamed video, **without anybody enumerating
them** — which matters, because an enumeration is the open-ended blocklist this plan already rejected
two sections down, and forgetting an entry is exactly how the original bug was made.

The one text rule beside it — an `<?xml` prolog whose root is not `<html` — is a rule *about XML*
rather than a list of XML vocabularies, so it catches Atom, RSS, RDF and SVG-with-a-prolog in one
line.

**What is deliberately not in the veto**: `<div`, `<p`, `<main`, a custom-element root, plain prose,
JSON, and a prolog-less SVG or feed. Anything textual that does not declare itself another vocabulary
goes to stage 2. JSON is the instructive case: `{"template":"<p>hello</p>"}` is 27 characters and
stage 2 refuses it on length alone, so a `{` in the veto would be a blocklist entry buying nothing.

**One edge, decided rather than discovered later:** BOM-less UTF-16 HTML fails the binary-byte test,
because UTF-16 is full of `0x00`. We accept that refusal. A BOM-less UTF-16 file declares nothing
about itself and is vanishingly rare; BOM'd UTF-16 is handled, because the spec's UTF-16 BOM check
runs first. **Pinned with a test**, so the next person finds a decision rather than a gap.

### Why two predicates and not one

The first draft argued that two spellings of one question become two answers, and kept one rule. The
answer to that — Fable's, and it is sharper than "header versus filename", because both of those are
merely claims:

> The two callers are asking **different predicates**. `sniffKind` on a vague content type asks *is
> there positive evidence this is HTML?* `uploadedDocumentKind` should ask *is there positive
> evidence this is something else?* Those are not two spellings of one question, and the drift worry
> only applies to two spellings of one question.

The part that genuinely is one question — skip the skippable, hand back the first real token — gets
one spelling, in the tokenizer. Everything that shares an answer is shared; nothing that does not is
forced to.

**And the failure asymmetries are opposite**, which is what makes the different predicates correct
rather than merely permitted. On the fetched path the markup sniff is a tiebreaker for the rare case
where a server shrugged, and a false negative costs one odd URL a reader can route around. On the
upload path it is the whole decision on every file, and a false negative is a legal file refused with
copy that says *"sending it again will not help"*. Look for evidence **for** HTML when the header is
missing; look for evidence **against** it when the reader has already told you what the file is.

**One thing here is the standard's and the rest is ours**, and conflating them is how the last
version went wrong. What we take from the WHATWG MIME Sniffing Standard's
[pattern-matching algorithm](https://mimesniff.spec.whatwg.org/#pattern-matching-algorithm) is its
**positional rule**: signatures are matched at the leading position after MIME whitespace, never
searched for later in the resource. Skipping BOMs, comments and an XML declaration, and choosing a
narrower or wider evidence set than its table, are **Spideryarn policy rather than WHATWG
behaviour** — the spec treats a leading `<!--` as positive HTML evidence rather than something to
skip, and classifies `<?xml` as XML rather than looking past it at the root. ⟨Sol F7, and it is the
same mistake as last time one level up: the landed change took the spec's tag *list* and kept our own
substring *semantics*, and cited the spec for both.⟩

**Why this is simpler, not more elaborate.** One question with one answer — *what does this document
open with* — replacing a fuzzy one: *does anything document-shaped appear anywhere in 16 KB*. It also
fixes the `<\s*` defect for free, because there is no longer a search that can land mid-string.

**The window still has to be defended, and the plan was wrong to say otherwise.** ⟨Sol F6.⟩ An
unterminated or very long leading comment pushes the first tag past any prefix cap, and a 20 KB
licence header is not exotic — the file that started all this had a 4 KB one. So the rule is: **walk
the already size-capped input to the first non-skippable token or EOF**, with a cursor and a byte
search, in linear time, and **do not materialise a second file-sized Latin-1 string** to do it. The
32 MB fetch cap and the 50 MB upload cap are what bound the worst case; Sol measured a deliberately
unterminated 50 MB comment at ~79 ms and found no denial of service, but it retained another 50 MB
doing it, and that allocation is avoidable. If a smaller prefix cap is kept instead, the plan must
name the cap and the false negative it buys.

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

## The bug the review found that nobody was looking for

⟨Sol F5, established, and **it is live on `dev` right now** — it predates all of this work and is not
something either version of the fix introduced.⟩

`PDF_HEADER` is consulted and returned **before** any HTML evidence, so a new detector placed further
down would never run. Measured against the current code:

```
sniffKind(null, "<!doctype html><html><body><p>About %PDF-1.7 files.</p></body></html>")  =  pdf
```

A properly-formed page that merely **mentions** a PDF version string in its first 1030 bytes is
classified a PDF whenever the content type is vague or absent, and goes to the transcriber — money
spent to produce nothing readable.

**Why the suite is green over it.** `tests/fetch.test.ts` has a case named *"is not fooled by a page
that talks about PDFs"* — and it passes `"text/html"` as the content type, so `declaredHtml`
short-circuits and the branch under test never runs. A test that shares an assumption with the code
it checks, for the third time in this one function
([silent-success.md](../reusable/silent-success.md)).

**The fix**, and it belongs in Stage 1 because the ordering *is* the detector's contract: keep the
unconditional PDF answer only at **byte zero**, where the format actually puts it, and let positive
leading HTML evidence beat a `%PDF-` found further in.

```ts
if (pdfAt === 0) return "pdf";
if (declaredHtml) return "html";
if (looksLikeHtml && mimeIsVague) return "html";
if (pdfAt > 0) return "pdf";
return null;
```

## Stages

Two, each ending with the suite green and the tree safe to commit.

### Stage 1 — the detector, and both callers

- A new function in [`src/fetch.ts`](../../src/fetch.ts) replacing `DOCUMENT_MARKUP`, used by
  `sniffKind` and `uploadedDocumentKind` — the **tokenizer** shared, the two **predicates** not.
- **Two tests in the suite have to be reversed, and the reversal is the point.**
  `tests/fetch.test.ts` currently pins `part.html` (a `<div>` fragment) and `notes.html` (prose) as
  `null`. Under the upload predicate both become `"html"` and go to stage 2. Those fixtures were
  written by the author of the check, from the author's picture of an HTML file — which is the last
  paragraph of the postmortem, so reversing them is the fix landing rather than a regression. **Say
  that in the test**, and keep both refused on the *fetched* path, where nothing claimed anything.
- **Negative tests are the point of this stage**, and they are the six rows of the table above plus
  the ones already in the suite (`{"template":"<p>hello</p>"}`, a renamed video, prose, a zip) —
  each now asked of the *right* caller, since the two no longer agree by construction.
- **Positive tests must not regress**: the tutorial page, XHTML with an `<?xml` prolog, a
  Chrome-saved page with its `<!-- saved from url -->` comment, UTF-16LE and BE, a page opening at
  `<meta charset>`, a bare `<body>`.
- **Split the combined regression test** ⟨Sol F3⟩. As it stands it would pass under an implementation
  that treats a leading `<!--` as *positive* HTML evidence instead of skipping it — and that mistake
  accepts `<!-- generated --><feed>…`. Three independent cases instead:
  ```ts
  expect(uploadedDocumentKind("page.html", enc.encode("<title>T</title><main>…"))).toBe("html");
  expect(uploadedDocumentKind("page.html", enc.encode(`<!--${"x".repeat(5000)}--><title>T</title>…`))).toBe("html");
  expect(sniffKind(null, enc.encode("<!-- generated --><feed><title>Atom</title></feed>"))).toBeNull();
  ```
  Plus a **real UTF-8 BOM byte fixture**, because a shared string helper has to tell a decoded
  `U+FEFF` from the raw Latin-1 rendering of `EF BB BF`, and only real bytes prove it does.
- Done when: every row of the table matches the *wanted* column, F5's three PDF-mention cases are
  pinned, `tests/fetch.test.ts` green, full suite green, `npm run check` clean, and the real 108 KB
  file still ingests end to end.

#### Folded into Stage 1: the bytes beat the name and the header, which they currently do not

Sol's F2, non-blocking then and in scope now because it is another instance of the **same class**:
*the markup scan cannot see markup it should*.

**Folded into Stage 1 rather than kept separate** ⟨Sol, and agreed: decoding, leading-token detection
and PDF precedence all interact, so splitting them means Stage 1 lands with a detector whose
behaviour Stage 2 then changes.⟩ It stays written down here as its own thing because its acceptance
test is different.

**And the fix is bigger than the plan first said.** The original criterion only covered
`uploadedDocumentKind("a.pdf", <utf-16 html>)`. Sol showed UTF-16LE and BE also return `null` from
`sniffKind` itself with an absent, `text/plain`, `octet-stream` or `application/pdf` header — so a
*fetched* UTF-16 page with a vague header is refused too, and that is the body-wins rule broken on
the path it was written for. The decoded fallback therefore belongs in `sniffKind`'s shared evidence
path, not bolted on after its result:

```ts
const prefix = bytes.subarray(0, limit);
const looksLikeHtml =
  leadingHtml(latin1(prefix)) || leadingHtml(decodeHtml(prefix, contentType).text);
```

Measured: a UTF-16 HTML page uploaded as `a.pdf` returns `null`, because `sniffKind`'s Latin-1 scan
cannot see UTF-16 markup and `uploadedDocumentKind` gives up before reaching the decoder. So the
**filename overrules the bytes**, which is the opposite of what this module's docstrings say it does
in three places.

- Done when: UTF-16LE **and** BE reach `"html"` through **both** public functions — with an absent,
  `octet-stream` and `application/pdf` header for `sniffKind`, and named `a.pdf` for
  `uploadedDocumentKind` — each with a test that was red first, and the docstrings' claim is true
  rather than aspirational.

### Stage 2 — the sentence an upload gets when there is no article in it

**A copy bug that exists today**, found by Fable while arbitrating F4, and made much more visible by
Stage 1: under the new upload predicate, far more odd files reach stage 2, and stage 2's refusals are
written for a **fetched page**. Verified in [`src/messages.ts`](../../src/messages.ts):

| constant | what it tells somebody who uploaded a file |
|---|---|
| `PAGE_HAS_NO_ARTICLE` | *"no article to find on the page that was fetched … it is the address it came from that needs looking at"* |
| `pageHadTooLittleText` | the same, plus *"a login wall … once its own scripts have run"* |

An upload has **no address**, no login wall and no scripts. Both sentences send the reader to look at
something that does not exist — and the first draft of this plan leaned on those very messages,
asserting stage 2 "already refuses with a good sentence". That was a claim about a downstream stage
nobody ran, which is precisely the class
[260907c](../postmortems/260907c-a-heuristic-promoted-to-a-gate.md) names. Twice in two days.

- An upload-aware variant of each, chosen by the same `cameOffADisk`/`filename` evidence the masthead
  already uses rather than by a new flag. The honest sentence for a fragment is roughly *"That file
  opens, but only N characters of it could be read as article text"* — `pageHadTooLittleText` with
  the fetched-page framing removed.
- Follow [copy.md](../project/copy.md); keep the `[jb-no-article]` and `[jb-too-little-text]` codes,
  because a code is what a reader quotes.
- Done when: uploading a `<div>` fragment produces a sentence with no address in it, pinned by a test
  that reads the message rather than only the failure kind.

## Review ledger

Round 1 on this plan: `sol-answer-plan-260908a-r1.md`, verdict **changes required, do not build as
written**. IDs continue from the review of the superseded fix.

| ID | Sev | Finding | Disposition |
|----|-----|---------|-------------|
| F1 | P1 | Substring search admits JSON/Atom/RSS/SVG | The reason for this plan. Anchoring fixes all four — Sol confirms. |
| F2 | P1 | UTF-16 blind spot is in `sniffKind`, not just the upload path | Accepted, widened, folded into Stage 1. |
| F3 | P2 | Combined regression test passes if `<!--` is treated as evidence rather than skipped | Accepted; three split tests plus a real BOM fixture, in Stage 1. |
| F4 | P1 | **No fixed leading-tag list can prove documenthood in either direction** | Accepted. Settled as two predicates over one tokenizer — see § Why two predicates and not one. |
| F8 | P1 | Stage 2's refusals say "the page that was fetched" and "the address it came from", which an upload does not have | Found by Fable, verified in `src/messages.ts`. Now Stage 2 of this plan. |
| F5 | P1 | `PDF_HEADER` pre-empts the detector; a page mentioning `%PDF-1.7` is classified `pdf` | Accepted, verified independently, now its own section. Live bug, predates this work. |
| F6 | P1 | The window is still load-bearing; don't materialise a file-sized Latin-1 string | Accepted; the design section now says walk the capped input with a cursor. |
| F7 | P3 | The plan over-claimed WHATWG authorship of the whole approach | Accepted; the paragraph now separates the spec's positional rule from our policy. |

**F4 is the one that changes the shape of the work.** Sol ran `<p>…`, `<main>…`, a custom-element
root, plain text, and `<template>`/`<noscript>`/`<iframe>` prefixes through JSDOM *and* through this
project's own `readArticle`, and they parse as documents and clear the Readability floor at ~2,440
characters. Meanwhile `<script>`/`<style>` — which the accept-list contains — is how a Svelte or Vue
component file opens. So the list is simultaneously too mean and too generous, and **the plan's two
stated invariants are incompatible**: something has to give, explicitly.

> use your judgment. ask Fable if in doubt
>
> — Greg, 2026-09-08, asked which way to take F4

**Settled: Sol's two-threshold reframing, with Fable's correction to the veto.** Fable arbitrated,
picked it over the single strict rule, and changed one thing that matters — *"do not write a
magic-number list at all"*, use the spec's binary-data-byte test plus one XML rule. Its reasoning is
in § Why two predicates and not one and § The veto is a closed rule.

**The strongest argument against, recorded because it is real and we are proceeding anyway:** this
does not stop a feed becoming an article, it moves the knowingly-imperfect label from stage 1 to
stage 2 — Readability accepts a text-heavy feed, so a prolog-less feed uploaded as `.html` becomes a
junk article. The answer is bounded harm: one person, their own chosen file, their own slot, visible
to nobody else — against the unbounded alternative of a valid file with no route in, which is the bug
this whole thread started with.

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
