# Debate refused quotes from a later extract of the same page

Up: [postmortems.md](../project/postmortems.md) · plan
[261002i](../plans/261002i-debate-leads-with-who-has-cited-this-article.md) · feedback
[261001_1914](../user-feedback/261001_1914-debate-leads-with-who-has-cited-this.md)

**What happened.** Since Debate was wired up on 2026-09-05, it has checked every quotation the model
reported against only the *first* extract the search returned for that page. The search often
returns one page several times in one answer, each time with a different extract, and the model
reads all of them. So a quotation copied correctly from a later extract was refused, and the whole
row with it. It reached readers only as absence: fewer rows, and a panel that looked like "the web
has little to say about this piece". Nothing wrong was ever shown. Found on 2026-10-02 while working
on Greg's feedback SPIDERYARN-READING2-9D (Debate should lead with who has cited the article).

## What happened

Debate keeps a row only if its `sourceQuote` is found in the extract of the page it cites. For a
row about the piece itself, the `articleReferenceQuote` must also be found there and must name the
article by its title or address. A miss drops the row, counted as `unverifiedSource` or
`directnessUnverified` (`readShared` and `readDirectGroup` in src/debate.ts).

The extracts come from `admissibleSources`, which called `collectSearchEvidence`, which shares
`collectAnnotated` with `collectCitations` in src/openrouter-stream.ts. That loop dedupes on the
URL, and the first sighting wins: a URL already in the map is skipped, extract and all.

The concrete case: on Ioannidis 2005, *Why Most Published Research Findings Are False*, his
published reply to Goodman and Greenland came back twice. The only line giving the article's title,
*"Citation: Ioannidis JPA (2007) Why Most Published Research Findings Are False: Author's Reply to
Goodman and Greenland…"*, was in the second extract. The row was refused as not naming the article.
It was exactly the row the feedback asked for.

**Measured** over 48 recorded Debate journals on the box (`output/debate-runs/*/journal.jsonl`, in
the primary checkout and the worktrees), 2026-10-02:

- 75 of 565 returned pages came back with more than one distinct extract.
- Of 399 quotations, 76 were not in their page's first extract, and **33 of those 76 (43%) were in
  a later extract of the same page**. Each of the 33 was a correct copy, refused.
- Re-scoring 12 recorded runs (two papers, old and new prompt) with the fix: rows kept about the
  piece went from 4 to 7 on the old prompt and from 7 to 10 on the new one. Claims rows were
  unchanged or slightly up.

## The class: a checker that sees less than the producer saw

The model wrote its rows from every extract. The checker judged them against one. When the checker
is handed a subset of the producer's evidence, every refusal it makes looks like the producer's
fault, and some of them are not.

How it got that way is a second, smaller class: **a dedupe keyed coarser than the data, inherited
from a caller with a different need.** Keying on the URL is right for a citation list, where a page
is the unit. For an extract it is not, because one URL carries several extracts. The rule came over
with the shared code, and with it a reason that held for the original callers and not for Debate.

## Which commit introduced it

- `20f8eeaee` (2026-09-05, *Keep the search's page extract, for the one caller that has to read
  it*) added `collectSearchEvidence` over the shared `collectAnnotated`, on purpose: *"The
  discriminator, the dedupe and the `isWebUrl` refusal have one implementation and cannot be varied
  per caller."* Sharing the security rule was right. Sharing the dedupe meant one URL kept one
  extract.
- The same commit added the test *"keeps one entry per url, and the first extract"* in
  tests/collect-citations.test.ts, with the reason *"so the extract cannot change under a row that
  has already been checked against it"*. That reason is about a streaming caller checking rows as
  they arrive. Debate checks once, after the whole answer is in, so the reason does not apply to it.
  I found no caller, then or now, that checks a row against an extract before the answer is
  complete. The rule's justification described a caller that does not exist.
- `39701ce73` (2026-09-05, *The debate stage*) wired Debate to it.

## Why nothing went red

- **The failure is silent in the safe direction, by design.** A refused row is counted, not shown.
  Debate's design makes an honest empty panel the expected case ("the right direction to fail in",
  in `readDirectGroup`'s docblock). So losing true rows looked exactly like a web with little to
  say.
- **The loss counters named the wrong suspect.** `unverifiedSource` and `directnessUnverified` read
  as "the model misquoted" or "the model did not name the article". Nobody checked a counted loss
  against the raw journal, where the quote was sitting in the page's second extract.
- **No fixture had two extracts for one URL.** Every test gave each page one extract, so the
  first-wins rule could never cost a test anything. The one test that did have two extracts asserted
  first-wins as correct.
- **The eval replay shares the collector.** `evals/debate/replay.ts` rebuilds the map through
  `admissibleSources`, so replaying a journal reproduced the loss instead of measuring it. The
  check shared the assumption with the code it checked
  ([silent-success.md](../reusable/silent-success.md)).

## What would have caught it, ranked by ease against value

1. **Test fixtures shaped like the live wire.** Several annotations per URL, with different
   extracts, is the normal shape of an Exa answer, not an edge case. A fixture built from one real
   journal would have failed on the first quote from a second extract. Done for this case: tests in
   tests/debate.test.ts (*"a page the search returned twice, with two different extracts"*) and
   tests/collect-citations.test.ts (*`collectSearchEvidence with extracts: "all"`*).
2. **Audit a loss counter against the raw journal before believing its name.** For a sample of
   refused rows, look for the quote anywhere in what the model was shown. A loss that the raw data
   does not explain is a bug in the checker. This is a habit, it costs a few minutes, and it is how
   this was found.
3. **When code is shared, check each inherited rule's reason against the new caller.** A rule
   written with a reason, like "so the extract cannot change under a checked row", can be tested:
   does this caller check rows mid-stream? Debate does not.
4. Rejected: **merging every extract for every caller.** The other callers check nothing against
   the extract (§ Other callers), and keeping more third-party page text than a caller needs was
   refused once already (Sol's F5, 2026-09-05). Opt-in keeps the cost on the caller that needs it.

## The fix

Built under plan 261002i, commit `177b69c58` and its review fixes: `collectSearchEvidence(annotations, into, onDropped, { extracts:
"all" })`. Later distinct extracts of a URL already accepted are appended in arrival order, joined by
`EXTRACT_SEPARATOR` (`"\n\n⁂\n\n"`), and the joined text is capped at `MAX_EVIDENCE_EXCERPT` (8,000).
The separator is not blank lines, because the quote matchers collapse whitespace and a quote could
then stitch two extracts together; a test proves it. Debate's `admissibleSources` asks for it. The
default stays first-wins, so other callers are unchanged.

**Right for the long term, and what it does not yet do.** The 8,000 cap now covers the joined text,
so a page with several long extracts loses its later ones to the cap, and a quote there is still
refused. That is the safe direction and is counted, but it is the same loss at a larger size. A
cleaner shape would keep the extracts as a list and match a quote against each one. That would also
remove the separator. It was not done because the cap is not known to bite in the measured runs.

## Other callers

None of the other three checks quotations, but one of them does make a refusal from the first
extract:

- **src/citation-find.ts:373, then :395.** Non-streaming, checked after the whole answer: the find
  is refused as `title-mismatch` unless `pageNamesTitle` (src/citations.ts:902) finds the work's
  title in the result's title or excerpt. If the title words were only in a page's second extract,
  and the search result's own title did not carry them, the find would be refused. It is the same
  shape, with a smaller exposure because a page's title usually names the work. Not measured.
- **src/dig-deeper.ts:422.** Nothing is checked. The first extract of each page, clipped, becomes
  the findings shown to the explaining model (`findingsPart`, :500). The later model sees less than
  the search returned; nothing is refused.
- **src/stream-run.ts:238**, used only by citation-investigate (`collectEvidence: true`,
  src/citation-investigate.ts:1102). Nothing is checked. The evidence feeds `provenanceOf` (:646),
  which reports how many extracts were read and the longest in words. That under-reports what the
  model read, but refuses nothing.

None was changed here.

## The thing I would tell myself

The model's quotation failing to match should have been a question about what the checker had
been given, not a fact about the model. The counter's name said whose fault it was, and I believed
the name. One look at the raw journal for one refused row would have shown the quote sitting in the
page's second extract.
