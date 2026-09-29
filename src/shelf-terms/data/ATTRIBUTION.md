# Word lists: sources, licences, credit

The generated module beside this file is built by
[`scripts/build-word-lists.ts`](../../../scripts/build-word-lists.ts) from the published file,
which is downloaded by hand and not committed. The chooser reads it to hold vague single words to a
higher per-article density threshold; phrases are unchanged
([plan 260929a](../../../docs/plans/260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle.md)).

## `glasgow-norms.ts` — the Glasgow Norms

Scott, G. G., Keitel, A., Becirspahic, M., Yao, B., & Sereno, S. C. (2019). The Glasgow Norms:
Ratings of 5,500 words on nine scales. *Behavior Research Methods*, 51(3), 1258–1270.
<https://doi.org/10.3758/s13428-018-1099-3>

Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**,
<https://creativecommons.org/licenses/by/4.0/> — the article and its supplementary material are
published open access under it. Source file: supplementary material 2,
`13428_2018_1099_MOESM2_ESM.csv`.

**Changes made:** only the concreteness (CNC) and familiarity (FAM) means are kept, each rounded to
one decimal; the rows that rate one sense of an ambiguous word (*bank (river)*) are dropped in
favour of the row rating the bare word; words are lowercased.

## Considered and not shipped

- **SUBTLEX-US** word frequencies (Brysbaert & New, 2009, *Behavior Research Methods* 41(4),
  977–990). The first version of this rule used it to tell common words from rare ones. It is
  freely available from Ghent University, but Ghent publishes no licence to redistribute it, and
  the written permission Marc Brysbaert gave to redistribute the SUBTLEX lists for any purpose
  (recorded in [`wordfreq`'s notice](https://github.com/rspeer/wordfreq/blob/master/NOTICE.md))
  covers `wordfreq` and code derived from it, not our own processing of the original file. So it
  is not shipped, not even as a derived list of common words (GPT Sol's review of plan 260929a,
  finding S1-1).
- The **Brysbaert, Warriner & Kuperman (2014)** concreteness ratings for 40 thousand English
  lemmas — the better-known and larger list — are published with no licence, so we have no right
  to redistribute them.
- **Norvig's** word-count lists are derived from the LDC's Google Web 1T corpus and are ruled out
  for the same reason.
