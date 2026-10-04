# Debate on a thinly received paper: what Reception finds, how claims spread, and what the default bar hides

Up: [investigations.md](../project/investigations.md) · for
[plan 261003o](../plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md)

Greg, 2026-10-03 (report `spya-caue42`), on Levin 2024, *Self-Improvising Memory* (Entropy 26(6),
481): Debate showed him one claim, the RNA and *C. elegans* one, and "doesn't tell me anything about
how the paper has been received more generally". He asked for "some quick evals". These are quick:
six paid runs, $1.29, two runs an arm. Read the counts as direction, not as rates.

## What was run

`npm run eval:debate -- run --slug <slug>` on the box: production's own `generateDebate`, journalled
to `output/debate-runs/` (gitignored; the six journals are kept on the box, in the primary checkout's `output/debate-runs/2026-10-03T21-5*`). Each journal was then replayed with
`npm run eval:debate -- replay --run <dir> --rows`. The `--rows` flag is new here and lists every
kept row with its identification level or its claim.

| Arm | Article | Runs |
|---|---|---|
| Baseline | Levin 2024, imported from Europe PMC's open full text (57 blocks, no address, like Greg's upload) | 2 |
| Baseline | Jain & Wallace 2019, *Attention is not Explanation* (arXiv abstract page) | 2 |
| One chosen claim | Levin 2024, the claims search asked about the RNA memory-transfer claim only | 2 |

The third arm changed one string, the claims search's user message, through a temporary hook that
was not committed. The message named the claim and its paragraph and said to search only for work
that tested, replicated or disputed it.

A separate web check by hand (a Sonnet subagent, about seven searches and the OpenAlex API) looked
for what really exists about the Levin paper, to judge the reception search against.

## Findings

**1. On Levin 2024 the reception search keeps nothing, and the open web has close to nothing.**
The hand check found no review, reply, commentary, blog post, forum thread or news piece about the
paper. It found the author's own announcement, an aggregator's repost of the abstract, and **39
citing papers** in OpenAlex (Europe PMC counts 25). The four runs on this paper reported 1, 1, 0 and
0 reception rows, the same LinkedIn post both times, refused because its quotation was not in the
extract the search returned. None of the 39 citers was offered. So "how has it been received" has
an answer for this paper, the citing papers, and a web search does not reach it.

**2. The claims search spreads over several claims; it was the panel that showed one.** The two
baseline runs on Levin reported 6 and 3 rows over 4 and 3 different paragraphs (metamorphosis,
memory after the brain is replaced, RNA transfer, the colour phi illusion). One of the two failed
whole with "the answer carried no closed fence", although the list in it was complete; a run that
fails this way costs about $0.19 and stores nothing. Greg's address carried `debatethread=key`,
which narrows the list to the two or three key sources. Nothing on the panel lists the claims, so
a narrowed list looks like the whole search.

**3. The default identification bar hides the reply a reader most needs.** Both runs on *Attention
is not Explanation* kept exactly one reception row: *Attention is not not Explanation* on the ACL
Anthology, the paper's best-known published reply. Both times its identification level was
`named`. The bar's default is `quoted`, so the row is stored and not shown until the reader moves
a slider labelled "identification". This is general, not a property of this paper: since
2026-10-02 the search is told to find work that cites the piece and to witness it by a title or a
reference-list entry, and a row kept that way is `named` unless the page also happens to quote the
article's own words. [Postmortem 261003h](../postmortems/261003h-debate-default-bar-hides-the-citing-papers-the-search-was-changed-to-find.md).

**4. Asking about one chosen claim reports more on that claim, and keeps about as many.** Rows on the RNA
memory-transfer paragraph:

| | Reported | Kept |
|---|---|---|
| Broad search, run 1 | 3 | 3 |
| Broad search, run 2 (failed whole; counted from the journal) | 1 | 0 stored |
| One chosen claim, run 1 | 6 | 4 |
| One chosen claim, run 2 | 7 | 3 (one of them on a neighbouring paragraph) |

The focused runs brought in sources the broad ones did not: a bioRxiv preprint and a *Scientific
American* piece disputing the transfer results, and a PubMed record. Cost and time per run did not
change (about $0.22, 80–95 s). More of the focused rows were refused (2 and 4, quotation not in
the extract), which is the known limit of checking against extracts. Neither arm found the *C.
elegans* dispute Greg mentioned (Hunter lab against Murphy lab), which his own production run did.
So the gain from focusing is different sources, not clearly more of them, and two runs an arm
cannot say more than that. What it does show is that a reader-chosen claim is a workable input to
the existing search with no other change.

## What this decided

- The panel splits into Reception and Claims, and Claims lists the claims (plan 261003o).
- The default bar moves to `named` (the plan, and the postmortem).
- Listing citers from a citation index is re-asked of Greg with finding 1 as the case for it.
- A claims picker, or a box to steer the search, is put to Greg with finding 4.
- The unclosed-fence failure is queued, not fixed here.
