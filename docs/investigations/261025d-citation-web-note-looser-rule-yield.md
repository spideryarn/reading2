# 261025d How many cited works get a web note, before and after the looser page rule

Up: [investigations.md](../project/investigations.md). The plan is
[261025d](../plans/261025d-citation-web-note-looser-page-rule.md); the area is
[bibliography.md § A note from one web search](../project/bibliography.md#a-note-from-one-web-search).
Report `spya-m53cdk`, question [q-x9srvv](../user-feedback/questions/q-x9srvv.md) part 2.

**The looser rule took the Butlin paper from 4 web notes to 14, out of the 42 cited works that had
no note from an abstract, at the same cost per press (0.8 ¢).** An Opus judge found every one of
the 14 notes on the right work, 24 of their 25 sentences supported by the page's extract, and no
praise. Ten of the 14 came from pages that only *look like* the work's own and are labelled so.

## What was measured

The Butlin et al. paper, *Consciousness in AI* (`arxiv-2308-08708-spya-xax6v4`), the article the
report was filed on. Its citation list (70 works) was read from production with one read-only
transaction and nothing written there. Locally, the shipped abstract-note pipeline
(`evals/citation-blurbs-spike.ts production`, $0.018) gave 28 works a note, which left **42 with
none**: the works a reader could press *Open in Sources* on. Only one of the 42 carries a DOI or
arXiv id in the list itself; the rest are cited by title, and the registries' title search finds
an identifier for some.

Then [`evals/citation-web-note-yield.ts`](../../evals/citation-web-note-yield.ts) pressed every one
of the 42 through the shipped `makeCitationWebNote` (src/citation-web-note.ts): the free refusals,
the identifier, the writer (Haiku with one Exa search), every code clause and the separate check,
with the stores in memory. Local dev, no OpenAlex key (so OpenAlex's title search was off, as it
was for every earlier Butlin measurement), the local copy of the article for the *not the article*
refusal.

| | Before (strict rule, `dev` at da7c997a) | After (plan 261025d, final prompt) |
|---|---|---|
| **Notes** | **4 (10%)** | **14 (33%)** |
| …from the work's doi.org or arXiv page (`own`) | 4 | 4 |
| …from a page that looks like the work's own (`looks-like`) | – | 10 |
| Refused for nothing, no identifier | 26 | 1 (no title to search) |
| Searched, no page passed code (`not-the-work`) | 2 | 17 |
| Searched, the note failed code's quote or length rules | 2 | 7 |
| Searched, the writer declined or picked none | 8 | 1 |
| Searched, the check said not supported | 0 | 2 |
| Writer calls / check calls | 16 / 4 | 41 / 16 |
| **Spend** (ledger) | **$0.130** | **$0.347** |

Per searched press the cost is unchanged, about $0.008; the after column costs more because it
searches 41 works instead of 16. A first after-run, with the prompt still sending the writer to the
doi.org result first, gave 10 notes ($0.344); in 8 works a page that would have passed was among the
results but the writer named the doi.org page, whose extract does not name the author. The final
prompt asks, when there is no identifier, for a page whose text names the first author, and the
second run gave 14. Two notes from the before run (Goodfellow's GAN paper, Graziano 2017) fell out
of the first after-run to a *not supported* check and a different pick, so a single run moves by a
note or two either way.

## The judge

An Opus subagent, given each note, its page's extract and every result of its search, labelled
both runs ([labels](../../evals/results/citation-web-note-yield-judge-2026-10-25.json)):

| | Before | After |
|---|---|---|
| Notes on the cited work | 4 of 4 | **14 of 14** |
| Sentences supported by the extract | 7 of 7 | **24 of 25** |
| Sentences that give praise or a verdict | 0 | 0 |
| Notes that only restate the title | 0 | 0 |

**The kinds of page the 10 `looks-like` notes came from**: arXiv's own abstract page found by title
(4 — Chalmers's *Could a large language model be conscious?*, Friedrich, Perceiver, Finn: the work's
own page, but with no identifier in the list code cannot prove it, so the label under-claims),
publishers (4 — *Nature Reviews Neuroscience*, Oxford Academic, Harvard University Press,
transformer-circuits.pub), an author's own site (consc.net) and Google Books. **None was an
encyclopedia, a review or a citing paper.**

The cases worth knowing:

- **Chalmers, *Absent qualia, fading qualia, dancing qualia*** (consc.net): one sentence describes
  dancing qualia, which is true of the paper but not in the extract, which stops before that
  section — the model's memory leaked past the quote rule and the check. The 1-in-25 rate is in
  line with the abstract notes' 1.3% after their check, and the card says the note can be wrong.
- **Baars, *A Cognitive Theory of Consciousness*** (Google Books): the note copies the blurb's typo
  *global workplace*. Faithful to the page, odd to a reader.
- **Hurley, *Consciousness in Action*** (Harvard University Press): a thin sentence that says one
  thing twice; the page calls the book "important" and the note did not carry it over.

## What still refuses, and why

The 17 `not-the-work` presses, read result by result:

- **The list's title is not the work's** in about half: *"Birch: Global workspace theory and animal
  consciousness"*, *"Dehaene, Lau, Kouider: What is consciousness…"*, *"Visual functions generate
  conscious seeing"* for *Generating*, two titles run together, a missing leading *The*, a title
  without its subtitle. Code is right to refuse: the rule's one sign of identity is the title, and
  the list misquotes it. Repairing the list's titles is the bibliography step's business, not this
  press's.
- **The search engine's extract does not name the author** on many good pages — doi.org, PubMed,
  JSTOR, Cambridge Core for Searle, Nagel's *Bat*. The surname clause is the one Greg named
  (*"names the first author"*) and it is what keeps a same-titled stranger out, so it stays.
- **The page is refused by host**: Wikipedia for *Being You* and *What is it like to be a bat?*, as
  intended.

## Reproduce

```
# the list, read-only from production: [{slug, title, bibliography}] (not committed: article data)
npx tsx evals/citation-blurbs-spike.ts production --fixture <butlin.json> --slug arxiv-2308-08708-spya-xax6v4 --work <dir>
npx tsx evals/citation-web-note-yield.ts --fixture <butlin.json> --slug arxiv-2308-08708-spya-xax6v4 \
  --production <dir>/production-arxiv-2308-08708-spya-xax6v4.json \
  --article <a local copy's slug> --owner <its owner> --label after --work <dir>   # spends ~$0.35
# judge: an Opus subagent over <dir>/web-notes-<label>.json
```

Results: [before](../../evals/results/citation-web-note-yield-before-2026-10-25T11-30-57.json),
[after, first prompt](../../evals/results/citation-web-note-yield-after-2026-10-25T11-54-41.json),
[after, final prompt](../../evals/results/citation-web-note-yield-after2-2026-10-25T12-03-46.json).
**Spend for this investigation: $0.84** (the abstract notes $0.018, before $0.130, the two after
runs $0.344 and $0.347); the judge was a Claude subagent, not in it.
