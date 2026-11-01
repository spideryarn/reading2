# Ground truth for the citations-recall eval (261101a)

Every distinct work each article's **body** cites, one JSON file per article, for
[plan 261101a](../../../../docs/plans/261101a-citations-every-work-cheaply-with-haiku.md). Built
2026-11-01 from the articles' blocks, before any arm ran.

## How it was built

1. The blocks were read from the local stack (six articles) and from production read-only (LeCun,
   `BEGIN READ ONLY`, rolled back; the article is saved for the eval at
   `data/evals/261101a/lecun-article.json`, gitignored, as `{ slug, meta, tree, blocks }` with
   blocks mapped by `blockOf` and meta rebuilt as `readMeta` does).
2. Scripts proposed candidates: author–year regexes (surname forms, `et al.`, `and`/`&`, lists
   split by `;` and `,`, `2021a, b`), bracketed numbers with ranges, glued superscript digits.
3. Every candidate block was read. False hits were dropped (dates, grant numbers `ERC-2020`,
   table text `ILSVRC-2012`, `Text 2000`, decimals, `cm2`, `S1`, `eNpHR3.0`, `CA1`, statistics,
   the author-affiliation line), and what the regexes missed was added by hand (below).
4. **No model's list was used to build it.** The stored `bibliography` was compared only at the
   end, as a check; it added nothing (see *Cross-check*).

The counting rules are the 261027a hand count's
([261027a-hand-count.md](../261027a-hand-count.md)): a work is (first-author surname, year with
letter suffix) for author–year, or the number for numbered styles; identical repeats count once;
two works sharing surname and year count twice when the citing words show they differ.

## The format

```
{ slug, style, n, notes, works: [ {
    key,          "Surname:Year" (author–year) or "#n" (numbered). Two works with the same
                  Surname:Year get "/<second author>", "/et-al" or "/sole" appended.
    surname,      first author as written in the body (numbered: parsed from the entry; null if none)
    year,         as written ("2017a", "forthcoming"); null if none
    number?,      numbered styles
    inList,       the article's own reference list / footnotes hold it
    refBlock?,    that entry's block id
    aliases?,     [{number, refBlock}] when several numbers are one source (first = number/refBlock)
    ambiguous?,   true when another truth work shares surname (accent-folded) + year without letter,
                  so a scorer must match it exactly (letter, co-author, entry), not by surname+year
    listYear?, listSurname?, note?   Butlin only: the list dates/spells it differently
    citedIn,      body block ids that cite it
    citingWords   the citing string (numbered: ~40 chars before the marker)
} ] }
```

Butlin also has `listEntries` and `listOnly` (list entries no body block cites); Synesthesia has
`citationNumbers` and `canonicalWorks`. `n` is always the number of truth works.

## Per article

| article | n | hand count N | reconciles |
|---|---|---|---|
| LeCun (production) | 105 | 105 | same 105 keys |
| Srivastava, *Dropout* | 36 | 36 | yes |
| Vaswani, *Attention* | 40 | 40 | yes, [1]–[40] all cited |
| Layfield (glued digits) | 70 | 70 | yes, 1–70 all cited |
| Clark & Chalmers | 17 | 17 | yes |
| *Synesthesia* | 148 works / 152 numbers | 152 numbers | numbers yes; works differ, below |
| Butlin, Long et al. | 251 body works | (261029b: 243 list works) | different unit, below |

- **LeCun.** No reference list in the blocks. `Henaff:2019` (Henaff et al., model-predictive
  policy learning) and `Hénaff:2019` (CPC) are two works, as in the hand count — both
  `ambiguous`, and any accent-folding matcher will collide them. Other ambiguous pairs:
  Chen, Lake, Gregor, Goroshin, Ha (letter suffixes).
- **Dropout.** Cites inside tables count. Three regex hits dropped (`ILSVRC-2010/2012`,
  `Text 2000`); `However, Wang and Manning (2013)` is Wang 2013. `Hinton:2006/Salakhutdinov`
  and `Hinton:2006/et-al` are two works, as in the hand count.
- **Vaswani.** Surname/year parsed from each entry; entry 37 is printed "Vinyals & Kaiser, …".
- **Layfield.** No reference list in the blocks, so `surname`/`year` are null and there is no
  `refBlock`: a scorer has to match on the entry number. 43 is cited only once, in `test41–43`.
- **Clark & Chalmers.** Footnotes count as body. Added by hand: `Chalmers (forthcoming)` (no
  year). `David Kirsh and Paul Maglio (1994)` is keyed `Kirsh:1994` (first author).
  Blocks `spya-swankj` and `spya-fpgbaw` are the same paragraph twice; both are in `citedIn`.
- **Synesthesia.** Body = blocks before *See also*; See also, Further reading and External links
  excluded, as in the hand count. Footnote *n* is the *n*-th `role: footnote` block — checked two
  ways: first appearances run 1…152 in order, and every footnote's backlink count equals its uses
  in the body. **152 citation numbers, 148 canonical works**:
  - 24 = 66 (Simner et al. 2006, same DOI) — as the hand count;
  - 62 = 69 (Baron-Cohen et al. 1996, same DOI) — the hand count missed this one;
  - 40 = 43 and 41 = 53: footnotes 40 and 41 are short forms (`Simner & Hubbard 2006.`,
    `Flournoy 2001.`) of full entries 43 and 53;
  - **the hand count's 48 = 49 is wrong**: they are two different Hauw et al. 2023 *Cortex*
    papers (different DOIs, volumes and titles). Kept as two works, both `ambiguous`.
  Also two works each, not duplicates: Galton 1880 / 1880a, van Campen 2009 / 2009b, Herman
  2018 / Cytowic 2018 (both titled *Synesthesia*), two "Linda Anderson" pages (different
  publishers). Matching was by DOI, PMID, ISBN, or a title of 25+ characters.
- **Butlin.** Body = blocks before the *Bibliography* heading; the list is the 251 blocks after
  it, one entry each. Truth is what the body cites, adjudicated there; **232 are in the list, 19
  are not** (`inList: false`: Block 2005, Block 2019, Hohwy 2013, Klein & Barron 2016, Andrews &
  Birch 2023, Morales & Lau 2021, Lau et al. 2022, Michel & Lau 2020, Lau & Michel 2021,
  DeepMind Adaptive Agents Team 2023, Bengio et al. 2022, Zhang et al. 2023, OpenAI 2023, Kahn
  et al. 2006, Lemoine 2022, LeCun 2022, Hilton 2022, Bostrom & Shulman 2022, AMCS 2023). **19
  list entries are cited nowhere in the body** (`listOnly`), so 232 + 19 = 251 entries.
  261029b's "243 distinct first-author-and-year works" is a different unit: four first-author+year
  pairs hold several entries (Birch 2020 ×3, Goyal 2022 ×2, Michel 2022 ×2, Seth 2021 ×2), which
  makes 246 by this parse; the remaining 3 are that plan's parse and are not reconciled here.
  Adjudications by reading the blocks:
  - added: `Michel forthcoming`; `Russell and Norvig` (blocks 264–266, a quote with
    `(2010, p. 34)`) → Russell & Norvig 2010; `Jaegle et al. 2021a, b` gives 2021b;
    possessives (`Marr's (1982)`, `Bryson's (2010)`, …);
  - same work, list dates or spells it differently (`listYear`/`listSurname`): Vaswani 2017
    (list 2023), Złotowski 2015 (Zlotowski), Zador 2022 (2023), Wu 2022 (2023, DayDreamer),
    Oprea 2020 (2022), Summerfield 2022 (2023), Clark & Kiverstein 2008 (2007);
    `Ji, Elmoznino et al. (2023)` is Ji 2023;
  - entries sharing first author and year, told apart by co-authors: `Birch 2020` (sole) and
    `Birch et al. 2020` (every context is unlimited associative learning, so Birch, Ginsburg &
    Jablonka; Birch, Schnell & Clayton 2020 is `listOnly`); Goyal & Bengio / Goyal et al. 2022;
    Michel / Michel & Doerig 2022; Seth / Seth & Hohwy 2021; Michel & Morales / Michel & Lau
    2020; Lau / Lau et al. 2022; Clark 2008 / Clark & Kiverstein 2008. All `ambiguous`.
  - judgement calls, marked with `note`: `Lau & Michel 2021` kept as written (possibly the
    list's Michel & Lau 2021 reversed); `Kahn et al. 2006` is not the list's Kahn et al. 2008;
    `Bostrom and Shulman (2022)` is not the list's Shulman & Bostrom 2021 (both are cited).
  - the local blocks have no text for Boxes 1–4 (261029b), so works cited only inside them are
    not in the truth.

## Cross-check against the stored lists (after the fact)

The stored `bibliography` rows (model output) were matched against the truth by surname and
year. Butlin 66/66, Dropout 35/35 and Clark & Chalmers 17/17 rows match a truth work. Vaswani's
two non-matching rows (Graves 2013, Chollet 2016) were a surname-parse bug in the builder, now
fixed. Synesthesia: Ramachandran & Hubbard 2001 was another parse bug (a `[dead link]` prefix),
fixed; Sinke et al. 2012 and Ward 2013 are *Further reading* entries, as the hand count said.
Layfield's rows cannot be matched by surname because the truth has none there. No work was added
from a stored list.
