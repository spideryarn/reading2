# PDF author lists: stacked NeurIPS-style bylines, v1

Report: SPIDERYARN-READING2-69, note
[260930_0850-pdf-transcription-glitches.md](../user-feedback/260930_0850-pdf-transcription-glitches.md).
Follows [260930e § Deferred, and named](260930e-pdf-transcription-glitches.md#deferred-and-named)
and its finding C4.

> perhaps gather a whole bunch of different examples of different ways authors can be presented and
> create a little eval of this. It's not super-important though, so maybe start with just a v1
> improvement, and defer more complicated improvements to a future plan.
>
> — Greg, 2026-10-01

## The problem

`verifyAuthors` ([`src/pdf-authors.ts`](../../src/pdf-authors.ts)) holds the model's author list
to the byline text. Its **"nobody skipped"** rule says the words between two names, or before the
first, may only be footnote markers and glue (`and`, `1`, `a`). That rule is what stops an author
being silently dropped from the byline, and it is the one thing this plan must not weaken.

Two failures, both from the same blind spot — the rule cannot tell an affiliation from a person:

1. **A stacked byline is refused.** NeurIPS and ICML print name / institution / email per author,
   so the byline record reads `Qihong Lu Princeton University qlu@princeton.edu Po-Hsuan Chen …`.
   Between `Qihong Lu` and `Po-Hsuan Chen` are `Princeton University qlu princeton edu`, which the
   rule reads as a skipped person. The list is refused and the reader gets the raw run of names,
   institutions and emails as the byline (Lu et al., found in 260930e).
2. **A trailing author can be dropped (C4).** After the last name the model gave, the ordinary list
   checks nothing — because the words there are often an affiliation fused onto the byline record.
   So `[Mei-jun Ou]` against a five-name byline stores one author.

## The change

**Revised after the plan review** (below): the first draft let any affiliation the page verified
account for gap words, and Sol showed one segmentation slip defeats that — the model gives Alice the
affiliation `Bob Brown Beta Institute`, which is printed, and Bob vanishes. A model-labelled
affiliation cannot prove that words are not a person. So v1 accepts only shapes with a delimiter
the model did not choose.

The words in a gap — between two names, or after the last — are still refused unless they are
markers and glue, **or** one of exactly two shapes:

- **A block's institutions and addresses** (between two names, or after the last). The *block* is
  the authors since the last gap that held anything: one author in NeurIPS's name / institution /
  email, several when the names are printed together and their institutions and addresses after
  (BERT's `Jacob Devlin Ming-Wei Chang … Google AI Language {jacobdevlin,…}@google.com`, or a grid
  read row by row). The gap may hold those authors' own verified affiliations, each at most once,
  then email addresses numbering **exactly** the block's authors, then glue. The count is the
  delimiter: a dropped author still has an address on the page, so the gap holds one too many.
  `Qihong Lu Princeton University qlu@princeton.edu Po-Hsuan Chen …` is taken; the review's
  `Alice Adams Acme University alice@acme.edu Bob Brown Beta Institute bob@beta.edu Carol Clark`
  without Bob is not. **Institutions before addresses:** after the first address no affiliation
  counts. The eval found why — the row-major Attention byline ends `… lukaszkaiser@google.com ∗ ‡
  Illia Polosukhin`, and with Illia dropped and his name passed off as Kaiser's affiliation, the
  count still came out right.

  *This is wider than the plan Sol reviewed* (exactly one address after author *i*'s
  affiliations). It came from the eval: the narrow rule took 18 of 39 real bylines, against 25 for
  the old check, because the inline-names-then-braced-emails shape is common in ML papers. The
  count of addresses is the same delimiter, counted over a block instead of one author; the code
  review was asked to attack it.
- **A marked affiliation block** (after the last name only): verified affiliations of any author,
  each at most once, each led by a footnote marker the page printed on that author's name —
  `aDepartment of …` after `Rukhsara`, `1 Head and Neck …` after `Ou1`. The marker is the
  delimiter: a person is not printed with an affiliation marker in front of them.

**After the last name, anything else now refuses — for every list (C4).** Today the ordinary list
checks nothing there, so `[Mei-jun Ou]` against a five-name byline stores one author.

**Emails** are read on the byline's own characters with a strict grammar: whitespace (or the start)
before, a local part or a braced group (`{qlu,pchen}`, counted as two addresses) then `@`, dot-
separated domain labels, an all-lower-case top-level label, and whitespace, `,`, `;` or the end
after. `alice@acme.eduDeepMind` is not an email, so it is unaccounted and the list is refused.

To have affiliations to account with, every author's affiliations are now verified even after one
fails (today the loop stops at the first failure). The first failure still decides the names-only
arm, as before.

### What v1 still gets wrong, named

- **A person printed with no address of their own, before the addresses, passed off as an
  affiliation**: `Alice Adams Acme University Bob Brown alice@acme.edu` with the model calling
  `Acme University Bob Brown` Alice's affiliation. Needs a layout with an address-less author in
  that position *and* that misreading; not guarded, and not seen in the eval.
- **An email fused to a lower-case word** (`alice@acme.edudeepmind`) reads as one address.
- **Single letters are glue** (existing): `Alice Adams, J., Carol Clark` passes without `J.` — an
  initials-only author. Pre-existing, kept because spaced letter markers are common (Elsevier).
- **Some refusals the old check did not make, deliberately.** Trailing text that is neither shape
  now refuses, and the reader gets the byline as printed instead of clean names: an unmarked shared
  affiliation (`Agam Shah , Suvan Paturi , Sudheer Chava Georgia Institute of Technology`; the
  all-caps Ross and Holland shape), fewer addresses than authors (`{jasonwei,dennyzhou}@google.com`
  under nine names), more (LoRA's second address for one author), `∗ equal technical contribution`.
  Six of the eval's 39 bylines; every one of them, under the old check, also let a dropped author
  through. That is the trade 260930e's C2 already made for the names-only arm, now made for both.

### Simpler options passed over

- Accept any gap that ends in an email. Accounts for nothing between the name and the email, so a
  co-author printed there vanishes; and does nothing for C4.
- The first draft: any verified affiliation of an earlier author accounts for gap words. Covers
  grids, but cannot keep the invariant (review P1-1).

## The eval

[`evals/pdf/bylines/cases.json`](../../evals/pdf/bylines/cases.json) — 39 real bylines, each the
byline text and first-page text as the PDF's text layer gives them (pdfjs `getTextContent`, stream
order; four "rows" variants sorted by position to reproduce a grid read row by row), with the answer
a correct model gives. Shapes: stacked, grid, inline-then-braced-emails, digit, letter, symbol and
superscript markers, ORCID glyphs, `and`- and `&`-joined, equal-contribution and corresponding marks,
institutions fused into the byline, up to 21 authors. Sources: the `evals/pdf/titles/` fixtures,
Lu et al., arXiv, and J Neurosci. Each case's `source` is its URL or path. No all-caps case was
found that could be fetched here (PMC is behind Cloudflare), and the text layer gives ORCID glyphs
and letter markers spaced (`X Aya Ben-Yakov`, `Rukhsar a`), not glued as the transcription does —
the glued forms are in the unit tests.

It is deterministic — the model's answer is fixed in the case — so it measures the check, not the
model, and runs in `npm test` (`tests/pdf-bylines-eval.test.ts`) as well as by hand
(`evals/pdf/bylines.mts`, old vs new). Two scores per case:

- **accepted**: the correct answer is taken whole (positives);
- **no silent drop**: for every author in a multi-author case, the same answer with that author
  removed is refused (derived negatives). This is the score that must not go down. Plus the
  review's harder negatives (P1-3), derived the same way: the dropped author's name and
  affiliation handed to the previous author as an affiliation; the same with an unrelated failing
  affiliation added, so the names-only arm is exercised; and two adjacent authors dropped.

Hand-written adversarial cases live in the unit tests: an email fused to a one-word author, a
braced group of two in one stacked gap.

Removing an author from a fixed answer measures the checker, not the model's segmentation; running
the real authors pass over the eval PDFs is listed under Future.

### Result

```
npx tsx evals/pdf/bylines.mts --old=src/pdf-authors-old.ts     # old = origin/dev before this plan
old: 25 list, 1 names only, 13 refused of 39; silent drops 60 of 738
new: 26 list, 1 names only, 12 refused of 39; silent drops 0 of 738
```

Newly taken: both Attention variants, Lu et al., PyTorch (21 authors), DDPM, word2vec, Christiano,
Karras (rows). Newly refused, each one a case where the old check also took dropped-author answers:
R&D rows, chain-of-thought, DPO, ViT, LoRA, the ACL fused affiliation (the list above). Still
refused under both, for reasons outside this plan: two names the shape check rejects (accents the
text layer split, `M ˛ adry`), a stacked block whose braced addresses sit under the first author
only (Karras, stream order), and two bylines that put institutions between names with no address.

`tests/pdf-bylines-eval.test.ts` pins each case's outcome and requires zero silent drops. Three
mutations of the new code were each caught (`=== block.length` → `>=`; the
institutions-before-addresses rule removed; the trailing check removed — 2, 2 and 8 tests red).

## Tests, red first

In [`tests/pdf-authors.test.ts`](../../tests/pdf-authors.test.ts), red before the change: the Lu
et al. stacked byline is taken; names printed together with braced addresses after are taken, and
refused with one author out; an author dropped from a stacked byline is still refused, including
with their name passed off as the previous author's affiliation, and with a fused email tail;
`[Mei-jun Ou]` against the five-name Frontiers byline is refused (C4); a fused trailing affiliation
led by its author's marker (ARNN) is still taken. Four older tests passed one author against a
multi-author byline for convenience — a C4 drop — and now use a byline cut to that author.

## Future (not v1)

- **Shared affiliation with fewer addresses than authors** (chain-of-thought, ViT, DPO) and
  **addresses under the first author only** (Karras): no delimiter that counts. Probably needs the
  next item.
- **Stacked blocks without emails** (`Alice Adams Acme University Bob Brown Beta Institute`): no
  delimiter the model did not choose. Needs layout evidence (line breaks or positions from pass 0).
- **Unmarked affiliations fused after the last name** (the all-caps Ross and Holland shape).
- `Equal contribution`, `Corresponding author`, `These authors contributed equally` and similar
  notes fused into the byline record: account for them by a short phrase list, if the eval shows
  they cost real refusals.
- A gap that holds a person's name printed twice (a grid's header row repeated) — not seen yet.
- Running the real authors pass (the model, not a fixed answer) over the eval's PDFs.

## The plan review, and what was done with it

GPT Sol, read-only, 2026-10-01 —
[261001l-pdf-stacked-bylines-review-sol.md](261001l-pdf-stacked-bylines-review-sol.md). Verdict
*"revise before build"*; every finding checked and held.

| | Finding | Done |
|---|---|---|
| P1-1 | A model-proposed affiliation (`Bob Brown Beta Institute`) verifies on the page and then accounts for the author it swallowed — one segmentation slip, not two mistakes | Revised: only author *i*'s own affiliations, and only with exactly one email after them; trailing affiliations must be marker-led |
| P1-2 | A greedy email regex eats a fused one-word author (`alice@acme.eduDeepMind`) | Strict grammar: whitespace before, lower-case TLD, whitespace or `,;` or end after; tests |
| P1-3 | Drop-one negatives remove the dropped author's affiliation too, so they miss the real failure | Harder derived negatives added to the eval |
| P2-4 | Earlier/all-author scopes right only with safe evidence; use one-use permissions | Grids deferred; each affiliation accounts once |
| P2-5 | Single letters as glue can drop an initials-only author | Pre-existing; named above, not changed |
| P2-6 | A narrower v1: email-delimited stacked blocks only, C4 closed conservatively | Taken |

## Shipped

(filled in when it lands)
