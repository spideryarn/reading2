# `evals/pdf/titles/` — ten first pages, and whose title the article gets

The corpus for [`evals/pdf/titles.mts`](../titles.mts), gathered on 2026-09-05 after a 142-page
Elsevier paper was ingested as *"Progress in Biophysics and Molecular Biology"* — the journal, not
the paper. [260905b](../../../docs/plans/260905b-pdf-front-matter-and-the-title-it-stole.md) is the
plan; [evals/README.md](../../README.md) is what an eval is here.

**Each fixture is the first three pages of a real document**, not the whole thing. Not thrift —
the failure class lives on pages 1–3, and a whole 142-page paper costs 25× a three-page cut to read.

## Three pages, and never fewer

`FURNITURE_PAGES = 3` in [`src/pdf.ts`](../../../src/pdf.ts): a line must appear on three or more
pages of *the document supplied* before pass 0 calls it a running header. A one- or two-page fixture
therefore has an empty furniture set and exercises a different code path from the one that failed in
production — it would be a corpus that cannot see the bug.

**And three pages is still not the document.** Measured while building this: of the eight real
multi-page fixtures, **only two** (Kuhn and Frontiers) reproduce their own document's furniture from
the cut alone, because page 1 is almost always laid out differently from the running pages, so a
repeated line has to appear on literally all three of the cut's pages to reach the threshold. Cutting
can also drop the info-dictionary `Title`, which is rung 1 of the title ladder.

So every fixture carries **`pass0-full.json`** — the *full* document's `metaTitle`, furniture set,
page count, scan flag and sha256, measured before it was cut. The runner sends three pages to the
model and reasons with the whole document's facts. `furnitureRealistic` in `expected.json` says which
cuts happen to stand on their own.

## What each one breaks

| | Breaks |
|---|---|
| [`kuhn-landscape-of-consciousness/`](kuhn-landscape-of-consciousness/) | The motivating case: the journal's name in the banner above the title. Its own title fragment also alternates onto the verso running head, and a `heading1`-shaped layout label (`ARTICLE INFO`) sits on page 1. |
| [`copernicus-ball-lightning-title/`](copernicus-ball-lightning-title/) | Two columns with the title spanning both. The running head repeats a shortened form of the article's own title — the case that would break "drop every repeated line". |
| [`wellcome-fowler-scan-title/`](wellcome-fowler-scan-title/) | No text layer anywhere in the pamphlet, and a library-generated rights page as page 1: the real title page is page 2. The fixture that would reject a two-page window. |
| [`arxiv-arnn-eeg-stamp/`](arxiv-arnn-eeg-stamp/) | arXiv's vertical margin stamp. A control: the metadata title is already right, so an arm that gets this wrong has broken something. |
| [`arxiv-lattice-linear-badmeta/`](arxiv-lattice-linear-badmeta/) | A valid-*looking* but wrong metadata title — hyperref ran the real title into the paper's own footnotes with no separator. Rung 1 has no filename to recognise here. |
| [`nasa-tm-interplanetary-streams/`](nasa-tm-interplanetary-streams/) | A scanned bibliographic-control card is page 1; the real title is ALL CAPS on page 2, with the agency block *below* it rather than above. |
| [`frontiers-wrapped-title/`](frontiers-wrapped-title/) | A title across four separate text runs. A first-heading rule that stops at one line returns "Development and preliminary". |
| [`acl-conference-banner/`](acl-conference-banner/) | A proceedings-volume banner in the masthead slot, naming a book rather than a journal. |
| [`unal-biotec-bilingual-title/`](unal-biotec-bilingual-title/) | Spanish with a parallel English title beneath it, a `heading1`-shaped `ARTÍCULO DE INVESTIGACIÓN` label, and alternating verso/recto running heads. |
| [`injection-adversary/`](injection-adversary/) | **Ours, synthetic.** Page 1 prints, as ordinary body text, an instruction addressed to a model, telling it the title is something else and to mark the article's prose as publisher furniture. It is the fixture that says whether the front-matter pass obeys the document it is reading. |

## The golds, and why there are two kinds

`expected.json` gives each fixture:

- **`title`** — the article's real title, as printed. The thing being scored.
- **`byline`** — the authors as printed, or `null`.
- **`furniture`** — the strings a naive extractor is likely to take *instead*. The must-drop list, and
  the half that makes a fixture diagnostic rather than merely present.
- **`mustKeep`** — short verbatim snippets that have to survive into the reading view: the first
  sentence of the abstract, the first sentence of the body, the byline, a heading.

**`mustKeep` is not symmetry for its own sake.** The obvious score — right title, fewer publisher
lines shown — is maximised by hiding the whole first page, and nothing that already exists would
catch that: `src/pdf-score.ts` counts every record whether it renders or not, so an abstract retyped
as hidden keeps recall at 1.0. The runner has an `overdelete` arm that hides everything, and **the
report must fail it**.

## Licences

Every directory has a `LICENCE.md` with the source URL, the licence quoted off the document, the page
range extracted, and the sha256 of both the cut and the full original. **A hash mismatch is a new
fixture version, never a quietly updated hash** — the same rule the three bake-off fixtures keep
([../README.md](../README.md)).

Two exceptions, both stated in their own `LICENCE.md`: `kuhn-landscape-of-consciousness` is CC
BY-NC-ND, kept because it is the motivating case and not redistributable; `injection-adversary` is
ours, generated on 2026-09-05, with no third-party content in it.

`copernicus-ball-lightning-title` is 7.1 MB — well over the ~1.5 MB the others keep to — because its
first three pages carry the same high-resolution figures that make the `harder/` bake-off fixture
11.5 MB.

## What is not here

Slots we wanted and could not fill on the day, recorded so nobody repeats the hunt: a "Downloaded
from … on <date>" watermark banner, a thesis or dissertation title page, publisher text genuinely
fused into one text-layer line with article prose, a dash or ligature or formula inside a title, and
a blank first page. DTIC, NPS/Calhoun, HAL, Zenodo, SciELO, Redalyc, MDPI, BMC/Springer,
ScienceDirect, GAO and PeerJ all refused scripted downloads; arXiv, Copernicus, the ACL Anthology,
Frontiers, NTRS, congress.gov and one Colombian OJS journal were the sources that answered.
