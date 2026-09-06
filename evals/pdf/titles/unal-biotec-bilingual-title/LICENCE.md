# `unal-biotec-bilingual-title/source.pdf`

**Nelson Alfonso Vega Contreras, María Angélica Farfan Casadiego, Angie Lisandra García Pabón,
"Efecto inhibidor de los extractos oleaginosos de *Coffea arabica* y *Ananas comosus* sobre
*Enterococcus faecalis*."** *Revista Colombiana de Biotecnología*, Vol. XXVII No. 1, Enero-Junio
2025, pp. 91–102. Universidad Nacional de Colombia. DOI: 10.15446/rev.colomb.biote.v27n1.119003.

<https://revistas.unal.edu.co/index.php/biotecnologia/article/view/119003>
PDF: <https://revistas.unal.edu.co/index.php/biotecnologia/article/download/119003/94784/729937>

```
full   sha256  b605cd5f3b13b0593801c8608fb97fd901fd1dd50730d9b5da2486a21a294e35
full   bytes   943,268
full   pages   10
cut    sha256  473a5ab8079ce78987bdcd1b78bfa956c47673f8d78991390f69966b225c88da
cut    bytes   245,677
cut    pages   3 (1–3)
```

**A hash mismatch is a new fixture version, not a hash to update.**

## Licence

Stated on the journal's own "About" page (`revistas.unal.edu.co/index.php/biotecnologia/about`):

> Esta obra está bajo una Licencia Creative Commons Atribución 4.0 Internacional.
> ("This work is under a Creative Commons Attribution 4.0 International Licence.")

CC BY 4.0, journal-wide — the same standard the existing `easy/` fixture relies on for a
journal-level rather than per-article notice.

## Why this document

Several things at once, which is what makes it one of the more valuable fixtures here:

- **Non-English, and bilingual/parallel-titled.** The Spanish title is set first and larger; the
  English translation is printed immediately beneath it, in the same position and a visually similar
  weight: `Efecto inhibidor de los extractos oleaginosos de Coffea arabica y Ananas comosus sobre
  Enterococcus faecalis` / `Inhibiting effect on oleaginous extracts of Coffea arabica and Ananas
  comosus on Enterococcus faecalis`. The gold in `expected.json` takes the Spanish line (printed
  first, and the language the DOI record and journal are in); the English line is recorded as
  `furniture` because it is exactly the string a naive extractor could plausibly return instead.
- **A heading1-shaped label on page 1** — `ARTÍCULO DE INVESTIGACIÓN` ("research article"), Spanish
  for exactly the `"Research Article"` / `"Original Investigation"` pattern
  `docs/plans/260905b-pdf-front-matter-and-the-title-it-stole.md` names as a furniture heading a
  naive rule could grab instead of the real title.
- **The article's own (Spanish) title is the running head on the odd-numbered pages, alternating
  with the journal citation on the even ones** — verified by rendering pages 1–3: page 1's footer is
  the Spanish title fragment plus a page number; page 2's is `Rev. Colomb. Biotecnol. Vol. XXVII
  No. 1  Enero - Junio 2025, 93 - 102`; page 3's is the Spanish title fragment again. Over the
  **full 10-page document** (`pass0-full.json`) both strings clear `FURNITURE_PAGES = 3`, appearing
  on the article's five odd and five even pages respectively — the alternating verso/recto pattern
  in full. Within just this **3-page cut**, the title fragment appears on only 2 of 3 pages and does
  not reach the threshold (`furnitureRealistic: false`), which is the same "a 3-page cut is not a
  small copy of the document" gap `copernicus-ball-lightning-title/` demonstrates.
