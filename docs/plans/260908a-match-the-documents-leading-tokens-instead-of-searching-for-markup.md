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

### What Stage 1 actually landed, and where it departed

Built 2026-09-08, **uncommitted at the time of writing** and awaiting Sol's end-of-stage review. Three
departures from the plan above, all of which stand, and one measurement that corrects it.

1. **The fetched evidence set is a *subset* of the WHATWG table**, not the whole of it — `<A`, `<B`,
   `<P`, `<DIV`, `<BR`, `<H1`, `<TABLE`, `<FONT`, `<IFRAME` and `<!--` are dropped. **The plan
   contradicted itself here**: it says "the anchored WHATWG signature table, and nothing else" and
   also requires a `<div>` fragment to stay `null` on the fetched path, and `<DIV TT` is in the
   table. The subset wins, and the *reason* has changed rather than survived — it is no longer
   "short strings turn up in JSON", which anchoring retired, but "a body-level tag opens a fragment
   as readily as a document".
2. **The XML veto accepts a leading `<!doctype html>` as well as `<html`.** The plan's rule was
   "root is not `<html`", and real XHTML is `<?xml?><!DOCTYPE html PUBLIC …><html>` — which the same
   plan lists as a must-pass. Pinned both ways.
3. **The XML veto is asked of the decoded text as well as the raw bytes**, or a BOM'd UTF-16 Atom
   feed named `.html` walks through — the same *the scan cannot see markup it should* class this
   whole thread is about.

**And the plan's performance instruction was wrong — twice, and the second correction supersedes the
first.** F6 said walk with a cursor rather than materialise a Latin-1 string; a hand-written cursor
walk over a 50 MB unterminated comment measured **838 ms**, an order of magnitude *worse* than the
~79 ms the string materialisation cost. `Buffer.indexOf` over a **view** fixed that at **7.9 ms** —
and then produced F17 and F23 in turn.

**The settled answer is that no native search belongs here at all**, and the measurement that
establishes it:

| | measured |
|---|---|
| `Buffer.indexOf`, per call, any size | ~300 ns |
| `indexOf("-->")` over 16 MiB of `-` | 151 ms — the repeated-prefix worst case |
| `indexOf("-->")` over 16 MiB of `>` or `x` | 2 ms |
| one `unit()` closure read | 6.6 ns |

That explains all four review rounds at once. The per-call cost punishes documents of many small
constructs; the repeated-prefix cost punishes dash runs; so **every native-search design has some
filler character that defeats it** — the first version's was empty comments, the `>`-scan's was `>`,
and the bounded search I specified after F23 has `-` (16 MiB of dashes: 4 ms → 689 ms, and many tiny
comments 830 ms → 2965 ms; built and measured rather than reasoned about).

`commentEnd` is therefore **a three-character window slid one unit at a time**, reading each byte of
the comment exactly once, and `CodeUnits.indexOf` is deleted — which removes the UTF-16
needle-straddling bug class rather than guarding against it. At 16 MiB it measures 78–90 ms across
every shape, against 4–2965 ms for the native designs depending on filler. Slower than a native scan
at its best and faster than all of them at their worst, with **no repeated-prefix or candidate-density
bad case** — Sol's wording, and better than the "a function of length alone" this doc first claimed,
since branch frequency and encoding do move the constant.

**One test outside the two scoped files had to change**, found by running them rather than by
reading: `tests/an-uploaded-html-file-becomes-an-article.test.ts` had *"refuses a file that is
neither"* built on prose named `notes.html` — exactly what the new predicate deliberately accepts.
It also guards that the refusal reaches `uploads.reason`, so it was re-pointed at PNG-plus-binary
rather than deleted, and a sibling now pins that prose passes stage 1.

**Worth knowing about the mutation testing.** Nine mutants, all killed — but the harness reported all
nine surviving on its first run, because it grepped for vitest's `FAIL` lines, which only appear on a
TTY. Piped, vitest prints `×`. Silent success inside the tool built to detect it. And one mutant
genuinely survived at first: deleting the raw `EF BB BF` skip changed nothing, because the decoded
fallback strips the BOM itself and answered for it — so there is now a case only the byte walk can
pass (a BOM followed by a 20 KB comment, past the decoded cap).

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

### What Stage 2 landed, and where it departed

Built 2026-09-08. The acceptance criterion is met and its test is
[`tests/job-failure.test.ts`](../../tests/job-failure.test.ts) § *tells a reader who uploaded a file
with too little text in it how little* — a `<div>` fragment, through the real `extract` step, with
the reader's sentence read rather than only its kind. **Three departures, all of which stand.**

**1. The uploaded branches get their own codes**, `[jb-file-no-article]` and
`[jb-file-too-little-text]`, where this plan said to keep the two existing ones. The plan was wrong
and [copy.md](../project/copy.md) says why in one line: *"what must never happen is two different
sentences sharing a code"*, which `tests/messages.test.ts` enforces — so keeping the codes was only
available if the two sentences stayed one sentence, which is the bug. The rule the plan appealed to
(*a code is what a reader quotes*) is satisfied anyway: `[jb-no-article]` keeps exactly the meaning
it shipped with, so nothing quoted in a support conversation is orphaned, and the new code tells
whoever is helping that this was a file before they have to ask.

**2. One factory over an origin, not two constants.** `PAGE_HAS_NO_ARTICLE` and
`pageHadTooLittleText` became `documentHasNoArticle(origin)` and `documentHadTooLittleText(origin,
chars)`. The pair is one fact: a third framing, or a change to the named causes, has one place to go
and cannot land in half of them. It also makes the coverage compulsory rather than remembered —
`FROM_FACTORIES` in `tests/messages.test.ts` is keyed by a mapped type over the module's exports, so
a constant that quietly grows a second sentence skips every invariant in that file, and a factory
cannot.

**3. `DocumentOrigin` is declared in `src/messages.ts` and checked in `src/source.ts`**, rather than
aliased from `SourceOrigin["kind"]` where the fact belongs. A **type-only** import of it fails the
build: `messages.ts` is in the browser client's type closure, `source.ts` reaches `fetch.ts` and its
untyped packages, and `tsc` walks a type-only import for its types like any other. `src/web/tsconfig.json`
predicts this failure in its own comment and names the remedy — *the fix, then and next time, is to
move the shared piece into a module that imports nothing*. So the union is declared in `messages.ts`,
and `source.ts` — which already imports that module's refusals — holds a two-element tuple asserting
the spellings agree in both directions. **Verified red both ways** before it was left green: widening
`DocumentOrigin` fails at that assertion, narrowing it fails at the branch sites.

**The origin is read once, in `src/pipeline.ts`**, from `cameFromAnUpload(manifest)` — the same
evidence that decides whether there is a base URL for relative links, and the same fact the masthead
uses to say *"you uploaded this"*. It is `filename`, not `origin`, because that field does not
survive the store; `cameFromAnUpload`'s header is the story. The log's own diagnostic said *"the
fetched page"* too, and now says *"the document stage 1 stored"*.

**Mutation, and it found a hole in a test that predates this stage.** Forcing `origin` to `"url"`
kills both new cases and nothing else. Forcing it to `"upload"` killed only *one* of the two
fetched cases: *calls a page Readability will not parse `blocked`* asserted `/no article/i`, which
matches *"there was no article to find in the file you uploaded"* just as well. So a mutation handing
every fetched reader the wrong sentence was invisible to it. It now asserts the code and the phrase
that separates the branches, and both fetched cases go red. Found by mutation rather than by reading,
which is [re-reading your own work is a zero check](../reusable/silent-success.md) in its usual shape.

**One fixture is not the obvious one, deliberately.** A `<div>` fragment does not reach
`ReadabilityRefused` — the library parses it and hands back 31 characters, so it lands on the
capability floor. The no-article case uses empty bytes, as its fetched sibling already did. Written
down because the plan's own acceptance sentence points at the fragment, and a later reader moving it
to the other test would find it green for the wrong reason.

#### Round 1 on the built Stage 2, and the third sentence

Sol refused it: **not landable, one established P1**. The finding is the one that matters here.

| ID | Sev | Finding | Disposition |
|----|-----|---------|-------------|
| F24 | **P1** | `ARTICLE_HAD_NO_TEXT` — **stage 3's** refusal — still says *"the address the article came from"*, and it is reachable from an upload | Fixed. See below. |
| F25 | P2 | The two-way assignability assertion works but was one union short: `RawManifest.origin` is a third hand-written `"url" \| "upload"` | Fixed by Sol's own suggestion — a leaf module. |
| F26 | P3 | Stale records: a `PAGE_HAS_NO_ARTICLE` reference, `content-extraction.md` naming only the URL codes, a present-tense claim in 260904e | Fixed. Stage 2's before-state above keeps the old names: that is history, not a stale record. |
| F27 | P3 | Copy: *"nobody uploads one on purpose"* too absolute; *"the page"* ambiguous between the file and the original; *"because it will be the same file"* reads as a lecture | All three taken. |

**F24 is the finding, and both of us had to be shown it.** I swept `src/messages.ts` for *"address"*,
found this line, and filed it as out of scope on a guess: *you would have to get past two earlier
refusals to reach it*. That guess is the postmortem's own mistake — declaring an input unreachable
because I could not picture it — made for the third time in two days, in the stage written to fix the
first one. Sol did not guess. It found the path: **an uploaded PDF**, not a web page. A scan whose
only text is a `publisher` record passes stage 2's floor, `renderHtml`
([`src/pdf-read.ts`](../../src/pdf-read.ts)) withholds that record on purpose, and stage 3 is handed
a document with no prose in it. It ran the real renderer into the block builder to check.

So `ARTICLE_HAD_NO_TEXT` is now `articleHadNoText(origin)`, `[jb-file-no-text]` is its uploaded code,
and the uploaded sentence names **a scan or a picture of a page** — a cause with no fetched
equivalent, and the likeliest true one. `src/pipeline.ts`'s `blocks` step reads stage 1's manifest
**inside the catch**, since that is the only branch that wants it, and falls back to the fetched
wording when there is no manifest to read — named in place, because a step whose stage-1 product has
vanished is looking at a different failure that this catch is not entitled to report.

**F25's fix is [`src/document-origin.ts`](../../src/document-origin.ts)**, a module holding one union
and importing nothing. It replaced three hand-written copies and the assertion holding two of them
together; `SourceOrigin`'s discriminant is the only spelling left that it cannot own — `kind: "url"`
cannot be written `kind: DocumentOrigin` without collapsing the union's arms — so that one keeps a
two-way check, verified red both ways. `tests/client-imports.test.ts` had to allow the new leaf, and
in doing so caught a stale claim of its own: its note said `messages.js` *"imports nothing at all"*,
which stopped being true some time ago and stayed green because everything it reaches is allowlisted.

**Mutation, again, on the new branch.** Forcing the `blocks` step's origin to `"url"` kills only the
new uploaded case; forcing it to `"upload"` kills only the fetched one. The fetched case now asserts
its code and its distinguishing phrase, like the two in stage 2.

#### Round 2: **approve and land**, with one P2 taken on the way

| ID | Sev | Finding | Disposition |
|----|-----|---------|-------------|
| F28 | P2 | The uploaded stage-3 sentence named a scan and then offered the *saved page's* remedy | Taken. Two causes, two remedies. |

**F28 is the more interesting half of F24.** Having split the sentence by origin, I gave the uploaded
branch one way out — *open the original in a browser and save it again* — which for an image-only PDF
produces the identical image-only PDF. Correct origin, correct code, correct kind, and advice that
cannot work: docs/project/copy.md § rule 2, arrived at by a route the rule does not describe. So that
sentence now carries a remedy per cause, and the clause *"an image of the words rather than the words
themselves"*, without which *"a copy whose words can be selected"* reads as nonsense to somebody
looking at a page covered in words.

**The sweep question, answered over a closed set this time.** Two sweeps of the message *text* had
each missed one. The enumerable thing is the refusal *sites*: `src/pipeline.ts` has fourteen
`stageFailure` calls, of which six are reader-facing, and the other three of those six —
`pdfTooManyPages`, `SOURCE_DOCUMENT_GONE`, `SOURCE_DOCUMENT_DAMAGED` — are already origin-neutral.
`SOURCE_DOCUMENT_GONE` even says *"from its address or by uploading the file"*; somebody had already
thought about it. Sol found no fourth either.

**Sol's suggestion for making this checkable rather than swept**, recorded and not built: an
exhaustive `reason × origin` matrix behind one formatter, so every cell is a compile error until it
is written and a test can exercise all of them. All three of these findings would pass through it.
That is a good idea and it is a different piece of work — it touches every reader-facing pipeline
refusal, not the three this stage is about.

**`src/document-origin.ts` must import nothing, and now that is executable.** The prose promise in
its header was the only thing holding it: the shared-module guard permits an allowlisted module to
import another allowlisted module, which is right everywhere else and not enough here — the closure
this leaf exists to break could come back through an intermediate the guard would pass.
`tests/client-imports.test.ts` now asserts the leaf's import list is empty, verified red.

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
| F9–F16 | P1/P2 | Round 1 on the Stage 1 code — `<script>` admitting components, PDF precedence, UTF-16, `--!>`, `<?xml-stylesheet`, the doctype root, test gaps, a BOM excusing binary | All fixed in round 2; each reproduced by me before and after. |
| F17 | **P0** | Repeated comments made detection quadratic — 6.5 s of blocked event loop at 128 KiB, reachable from any upload | **Caused by my own round-2 brief** ("take the earliest valid terminator"), which is why it is recorded here and not only in the postmortem. Fixed; 9 ms at 128 KiB. |
| F18 | P1 | `<!-->` is an abrupt close a browser honours; we refused it fetched and accepted it uploaded | Closed *by* F17's fix rather than patched onto it. |
| F19 | P1 | Valid XHTML internal subsets refused | Superseded by F22 — the first fix was incomplete. |
| F20 | P2 | The property test skipped every fixture whose fetched answer was `null`, so it could not see missed evidence — which is why F18 and F19 both passed it | Fixed: an expected answer per fixture, corpus 19 → 25. |
| F21 | P2 | Uploads walked the bytes twice | Fixed: one `classify()`. |
| F22 | P1 | A `]` inside a DTD comment inside a doctype's internal subset ends the doctype early | **Closed by deleting the DTD lexer** — see below. |
| F23 | P1 | One native search per `>` candidate: 2.7 s of blocked event loop at 32 MiB, inside the 50 MiB upload cap | The P0's fix was incomplete, again my algorithm rather than the implementation. Fixed — but **not** by the bounded search I specified; see below. 32 MiB of `>` is now 242 ms. |
| F14 | P1 | The XML veto accepted a doctype without checking the root | **Overruled 2026-09-08, on Fable's arbitration** — see below. |

### F22 and F14: the DTD lexer is deleted rather than fixed

Four review rounds each found another edge case in what had become a hand-written HTML/XML lexer. The
instinct at that point is to fix the next one; the arbitration says the treadmill is the finding, and
that it lives in exactly one function.

**Three things settle it, each measured rather than argued.**

1. **F22 has an easier sibling on a real authoring path.** `<!DOCTYPE html [<!ENTITY nbsp
   "&#160;"><!-- we can't use one here -->]>` is refused on both paths: the quote tracking sees the
   apostrophe in *can't*, opens a literal that never closes, and returns `-1`. An entity subset is the
   canonical reason to hand-write one in XHTML, and an English comment beside it is ordinary. **The
   nesting-depth fix we were about to build would not have fixed this** — the real gap is that
   comments and PIs *inside* the subset are lexed as declarations.
2. **`doctypeEnd` imitates a parser this pipeline never runs.** Stage 2 is `new JSDOM(html)` with no
   content type — the HTML parser, always — and its rule for `<!DOCTYPE html [` is bogus-DOCTYPE
   state, ending at the first `>`, so `]>` leaks into the body text either way. We were modelling an
   XML grammar nothing downstream applies. That is why this one function was a treadmill and
   `commentEnd` and the PI skip are not: those find **one delimiter** and cite a spec line; this
   parsed the *inside* of a construct.
3. **The root-after-doctype check defended a line the design does not hold**:

   ```
   fetch upload  input
   html  html    <!doctype html><feed>                 (no prolog)
   null  null    <?xml?><!doctype html><feed>          (the same document, plus 21 bytes)
   ```

   Without a prolog, `<!doctype html` was already sufficient positive evidence on both paths — in the
   round-2 snapshot, unobjected to. One document must not get two answers over a prolog.

So `xmlRootIsHtml` becomes *the first token after the prolog is `<html` or `<!doctype html`*, and
`doctypeEnd` goes. `<?xml?><!DOCTYPE svg …>` and `<?xml?><rss>` stay refused, checked.

**What it costs, stated because it is a real loosening on the fetched path**, where the plan's
principle is *positive evidence, because we are guessing*: a doctype that lies —
`<?xml?><!doctype html><feed>` from a vague-mime server — now becomes a junk article. The counters
are that the same document minus its prolog already got that treatment, that the harm is the bounded
one this plan already recorded and proceeded over, and that a false doctype is adversarial rather
than authored. **Sol pinned the opposite in F14 and is overruled**, per
[engineering-manager.md](../reusable/engineering-manager.md)'s two-rounds-then-settle rule. If Sol
re-objects on the narrow check, the objection is noted and overruled on the reasoning above.

**And the reason this was arbitrated rather than decided by me:** my own instinct was that F22 needed
XHTML *with* a subset *with* a comment *with* `]`, and was therefore unreachable. That is the same
sentence as "a tutorial page with no doctype and a 4 KB comment is unreachable", which is the mistake
[260907c](../postmortems/260907c-a-heuristic-promoted-to-a-gate.md) exists to record. It was wrong
again, and it took five minutes to disprove.
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
