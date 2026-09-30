# PDF footnotes: shown at the end, and linked from their markers

**Status: built (plan reviewed by GPT Sol; code review below). Stage 2, the re-render, stopped at
the write-up — § Stage 2.** Follow-up to SPIDERYARN-READING2-69
([the note](../user-feedback/260930_0850-pdf-transcription-glitches.md)), Stage 3 of
[260930e](260930e-pdf-transcription-glitches.md#deferred-and-named), which left it for Greg.

> yeah, we could list them at the end somehow. and/or perhaps better still, make them clickable
> inline with a tooltip, then no need to list them at the end? go with whatever's simplest
>
> — Greg, 2026-09-30 (relayed by the Overseer)

> sure, sounds good, but as i say, i'm more worried about things working well going forwards
>
> — Greg, 2026-09-30, on re-rendering the PDF articles already on shelves

## The problem

A PDF's footnotes are transcribed (type `footnote`), checked against the text layer, and then
dropped by `RENDERED` in [`src/pdf.ts`](../../src/pdf.ts). The prose keeps the bare marker —
`…a more familiar situation.1 This` — pointing at nothing.

## What already exists, and why that decides it

Web articles already have the whole feature. Stage 2's [`src/notes.ts`](../../src/notes.ts)
rewrites every footnote shape into one canonical form:

```
  in the prose:   <sup><a data-spya-note-ref="spya-note-…" id="spya-noteref-3" href="#spya-note-…">3</a></sup>
  at the end:     <section data-spya-notes><ol>
                    <li id="spya-note-…" data-spya-note="spya-note-…">the note … <a data-spya-note-back=… href="#spya-noteref-3">↩</a></li>
                  </ol></section>
```

and from there on it is free: stage 3 marks the note blocks `role: "footnote"`, `treatment:
"supplement"` (so summaries and the clock leave them alone) and keeps paragraph ids stable across
renumbering; the reading view hovers a marker into a card showing the whole note, sets the notes
apart at the end with their numbers and a "back to your place" link
([links.md § A footnote marker](../project/links.md#a-footnote-marker-is-one-of-those-links-and-it-gets-the-note-instead)).

So the PDF renderer, which writes its own HTML, **writes that same markup**. Nothing new in the
reading view, stage 3 or the tooltip machinery. Listed-at-the-end and clickable-with-a-tooltip come
together, because they are the same markup: the note has to be somewhere in the document for the
card to show it.

## The one new piece: which digits are markers

The transcription does not say; rule 1 of the prompt copies `1` and `¹` alike. Read-only survey of
production's 319 cached PDF chunks (every `pdf-chunk` checkpoint), 2026-09-30:

- **312 of 319 footnote records start with their label** — `25 Seth first heard…`, `1Max Planck…`,
  `5. This observation…`.
- **For 178 of them a glued marker is on the same page** (`…nonphysicalists13 [Birth`,
  `…hard problem.14`, `…Buckner, 2013),28 thus`, `…memory limits³.`). The model keeps a superscript
  glued to the word before it, which is what makes it findable.
- The misses are mostly **endnotes**: the MDPI *Entropy* paper prints its 63 notes on a page after
  the references, with the markers (`vulnerable4 agents`, `Selfhood5.`) spread over earlier pages.
  The rest are a verse book whose notes are keyed to verse ranges (`1-2: …`), letter labels (`a To
  test…`), and a few Kuhn notes whose marker page is not in the stored chunks.

So the matching is **deterministic code over the records, no prompt change**, beside `renderHtml`
in [`src/pdf-read.ts`](../../src/pdf-read.ts) (`collectNotes`, `candidatesIn`, `findMarkers`,
`renderNotes`). The rules as built, after the plan review:

1. A note's **label** is its leading `1`–`999`, superscript digits, or `* † ‡ § ¶`, followed by a
   space, a full stop and a space, or a letter. `1-2:` and `1970 was` are not labels, nor is a
   letter (`a To test`). A footnote record with `continues: true` joins the note before it.
2. A **marker** for label `N` is `N` (or its superscript form) glued to what precedes it — a letter,
   closing punctuation or quote, or `. , ; : ! ?` — and not followed by a digit or a letter, and
   never inside `\(…\)` or `\[…\]`. For **plain digits** two more refusals: after `.` or `,` with a
   digit before it (`3.5`, `1,000`, `[24,25]`), and on a **capital** (`CO2`, `BRCA1`, `CD4`). A
   superscript is a marker by its shape and is exempt from both (`in 2020.¹`, `claims.²,³`).
3. **Two kinds of note, two cursors**, each moving only forward, and one set of claimed places so
   no marker is taken twice. A **footnote** looks on its own page and links only when **exactly one**
   unclaimed place there reads as its marker. An **endnote** — a note on a page with no body prose,
   such as the notes after the references — looks from its cursor through every page up to its own
   and takes the first; uniqueness over a whole paper would link almost nothing.
4. **Matched:** the digits become the marker, the label comes off the note's text (the reading view
   draws the number from the marker), and the note gets a back-link. **Unmatched:** still listed; a
   numeric label comes off the text and goes on the `<li>` as its standard `value`, which
   [`notes-view.ts`](../../src/web/notes-view.ts) now falls back to before counting, so an uncited
   note printed `25` is drawn `25` and not `3`. A symbol keeps its place in the text.
5. **An uncited note on the article's first page is left out**, as all footnotes were before: the
   front-matter pass never sees a `footnote` record, so affiliations, correspondence lines and
   "these authors contributed equally" arrive as notes whose markers sit in the byline.
6. A note's id is `mintNoteId` of its text **without the label**, so whether its marker was found
   never changes its id.

**What it can still get wrong, and why that is the cheap direction.** On an endnotes paper, a
lower-case formula written outside maths delimiters (`log2`, from the older prompt) before the real
marker would take the link; the note behind it is still right. A paper that uses superscript
numeric citations *and* numbered footnotes would have its citations read as markers. A missed
marker costs only the link, and the note is still listed.

### What the measurement found

Every stored production record set (the 319 cached `pdf-chunk` checkpoints, 10 articles with
footnotes), rendered with the new code, offline and free: **314 notes shown, 238 linked**. An Opus
subagent read 234 of the links one by one — marker, sentence and note — and I read the other four
(the `kernel35]` case below): **238 right, 0 wrong**. Re-run after the review's stricter rules, the
set of links was identical.

- The *Entropy* paper's endnotes: 61 of 63 linked. Kuhn's footnotes: 80–82%.
- Unlinked, by reading: the Dhammapada's 31 notes are keyed to verse ranges (`1-2:`), not markers,
  and cannot be linked this way; the rest are letter labels, table notes (`Note: …`) and Kuhn notes
  whose marker is not in the transcription at all (17, 24, 26), which no rule here can fix.
- One rule came out of the measurement: the first draft fenced off `[…]` as citation lists, which
  cost Kuhn's `[bare/naked grain/ kernel35]` in all four copies. Numeric citation lists are already
  refused by rule 2, so the fence went.

Tests: [`tests/pdf-footnotes.test.ts`](../../tests/pdf-footnotes.test.ts), nineteen cases, each red
before the code, run through `splitIntoBlocks` so they check what the reading view gets.

## Options passed over

- **Listed at the end, unlinked** — the "(a) alone" of 260930e. Simpler by the matching functions,
  but it writes the same markup, and the link is the part Greg called better. Not taken because the
  extra piece is small, free to run, and measured right every time it fires.
- **Ask the model to mark the markers** (e.g. wrap them in a sentinel) — a `PROMPT_VERSION` bump.
  Every future PDF import pays for it, and every existing article's cached chunks go stale, so even a
  re-render of a current-prompt article stops being free. More reliable on the misses above, but the
  misses that matter are markers the model dropped entirely. Not taken; this measurement is what
  would reopen it.
- **The text layer's font sizes** (a superscript is smaller) — pass 0 does not keep glyph heights,
  and the model's text and the text layer would have to be aligned first. More moving parts for the
  same answer on the cases measured.

**Cost: no extra transcription cost on any import.** No prompt, schema or model change;
`promptFingerprint()` does not move, so every cached chunk stays valid. (Sol's F6: that is not "zero
for re-rendering an existing article", which re-buys the front-matter and authors calls and cascades
through every later stage — § Stage 2.)

## What stays as it was, named

- `RENDERED` is unchanged, and so is the check. Footnotes are now visible and still scored as unshown,
  so an invented value in a note is reported rather than failing the article. Written at `RENDERED`
  in [`src/pdf.ts`](../../src/pdf.ts) as the stated gap (Sol's F5); tightening it would buy re-reads
  on every import.
- A multi-paragraph note without `continues` comes out as two notes, the second unlabelled.
- Continued notes are joined with a space, like continued paragraphs.

## The plan review, and what was done with it

GPT Sol, read-only, 2026-09-30 —
[260930k-pdf-footnotes-shown-and-linked-plan-review-sol.md](260930k-pdf-footnotes-shown-and-linked-plan-review-sol.md).
Verdict *"revise before build"*. The code had been drafted alongside; each finding was checked
against it.

| | Finding | Done |
|---|---|---|
| F1 | One forward cursor cannot serve footnotes and endnotes in one paper (notes `1, 3, 2`, markers `1, 2, 3`) | Two cursors and a shared claimed set; the exact sequence is a test |
| F2 | `BRCA1`, `CD4` match; `in 2020.¹` and `claim¹,²` are refused; first-wins is too confident | Capitals refused for plain digits; superscripts exempt from the number rules; a footnote links only when its page has exactly one candidate; every link in the corpus hand-read (not a sample of 20). Endnotes keep first-wins, named above |
| F3 | The plan's claim that page-1 affiliation footnotes are set aside was **false** — the front-matter window is `RENDERED` only | Uncited notes on the first page are left out; test from the real affiliation |
| F4 | An uncited note shows the view's ordinal *and* its printed label; its id depended on whether it matched | Label always off the id; numeric label carried on `<li value>` and read by `notes-view.ts` |
| F5 | Visible notes still scored as hidden | Accepted and written down at `RENDERED` |
| F6 | "Zero per import" is true of transcription only | Wording corrected; re-render costed in Stage 2 |
| F7 | Stage 3, the client and citations say every note stamp came through `canonicaliseNotes` | The three comments name the PDF renderer as the second writer |

## The code review, and what was done with it

GPT Sol, write-enabled, 2026-10-01 —
[260930k-pdf-footnotes-shown-and-linked-code-review-sol.md](260930k-pdf-footnotes-shown-and-linked-code-review-sol.md).
Verdict *"approve after one low-severity fix"*: a label of `0` (or `⁰`) was accepted, outside the
stated `1–999`; tightened, with a test red first. Read and kept. It also probed the piece spans, the
two cursors, escaping, several markers in one block, `<li value>` surviving stage 3 and being read
by `buildNoteIndex`, and the downstream consumers (titles, figures, assets, word counts, scoring),
and found nothing else. Its advisory: `renderHtml`, `candidatesIn` and `findMarkers` are over the
lint's complexity notice; left as they are.

## Stage 2 (optional) — re-rendering the PDF articles already on the shelf: stopped at the write-up

Greg said yes, and that going forwards matters more. Scoped read-only against production on
2026-09-30, it is **not simple**, so per the brief it stops here:

- **It needs this code in production first**, since the re-run is a production job (a reset, or
  `{ steps, force: ["extract"] }`). Only the Overseer deploys.
- **Most of them would need a fresh transcription.** 23 PDF articles (all one owner; 9 archived).
  Chunk caches are keyed on the prompt, so only the **9 on `pdf-v4`** (6 live, 3 archived)
  re-render from cache. The other 14 are on `pdf-v1`–`v3` and would be read again from
  scratch — the 142-page Kuhn paper alone was $0.49–$0.63 on Luna — and would come back as a
  *different* transcription, not only a re-rendered one.

  | prompt | live | archived | pages (live) |
  |---|---|---|---|
  | `pdf-v4` | 6 | 3 | 79 |
  | `pdf-v3` | 6 | 3 | 202 |
  | `pdf-v2` | 2 | 1 | 159 |
  | `pdf-v1` | 0 | 2 | — |

- **Every later stage re-runs.** Forcing `extract` forces everything after it (`cascadeForce`,
  [ingest-queue.md](../project/ingest-queue.md)), and a reset regenerates each article's extras
  (quotes, glossary, quiz …): paid hierarchy, arc, label and mode calls per article, largest on the
  long ones.
- **What is not a risk:** comments. Only one PDF article has any (2, on an archived `pdf-v1`
  article), so re-minted block ids would orphan nothing a reader wrote.

The simple route, when Greg wants it and after a deploy: he owns all 23, so **"Start this article
again"** on an article's Metadata page does exactly this, one article at a time, with his eyes on
the cost. The six live `pdf-v4` articles are the free-transcription ones: `arxiv-2508-spya-wrzxkg`,
`dongetal25-spya-vfmvmm`, `9689-full-spya-m43th2`, `bf03197835-spya-qfwsw2`,
`s41598-023-33209-9-spya-hxekgz`, `arxiv-1811-spya-vw9rn6`.
