# Word lists: sources, licences, credit

The two generated modules beside this file are built by
[`scripts/build-word-lists.ts`](../../../scripts/build-word-lists.ts) from the published files,
which are downloaded by hand and not committed. The chooser reads them to hold vague single words
to a higher per-article density threshold; phrases are unchanged
([plan 260929a](../../../docs/plans/260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle.md)).

## `concreteness.ts` — the Glasgow Norms

Scott, G. G., Keitel, A., Becirspahic, M., Yao, B., & Sereno, S. C. (2019). The Glasgow Norms:
Ratings of 5,500 words on nine scales. *Behavior Research Methods*, 51(3), 1258–1270.
<https://doi.org/10.3758/s13428-018-1099-3>

Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**,
<https://creativecommons.org/licenses/by/4.0/> — the article and its supplementary material are
published open access under it. Source file: supplementary material 2,
`13428_2018_1099_MOESM2_ESM.csv`.

**Changes made:** only the concreteness (CNC) means are kept, rounded to one decimal; the rows
that rate one sense of an ambiguous word (*bank (river)*) are dropped in favour of the row rating
the bare word; words are lowercased.

## `common-words.ts` — SUBTLEX-US

Brysbaert, M., & New, B. (2009). Moving beyond Kučera and Francis: A critical evaluation of
current word frequency norms and the introduction of a new and improved word frequency measure
for American English. *Behavior Research Methods*, 41(4), 977–990.
<https://doi.org/10.3758/BRM.41.4.977>

SUBTLEX-US is freely available data, from
<https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus>
(`subtlexus2.zip`, `SUBTLEXus74286wordstextversion.txt`). Marc Brysbaert has given written
permission for the SUBTLEX lists to be redistributed and used for any purpose, not only academic
use, on condition that the SUBTLEX authors are credited and that it stays clear SUBTLEX is freely
available data — recorded in `wordfreq`'s notice,
<https://github.com/rspeer/wordfreq/blob/master/NOTICE.md>. That permission was given to
`wordfreq` and code derived from it; we rely on it as the author's stated terms for the list.

**Changes made:** only the set of words whose frequency is Zipf ≥ 4.0
(log10(per-million frequency) + 3, van Heuven et al. 2014) is kept, lowercased — no counts.

## Not used

The Brysbaert, Warriner & Kuperman (2014) concreteness ratings for 40 thousand English lemmas —
the better-known and larger list — are **not** used: they are published with no licence, so we
have no right to redistribute them. Norvig's word-count lists are derived from the LDC's Google
Web 1T corpus and are ruled out for the same reason.
