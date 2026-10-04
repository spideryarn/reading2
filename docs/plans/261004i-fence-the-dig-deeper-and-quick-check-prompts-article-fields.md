# Fence the article's fields in the Dig deeper prompt and the quick check's

The finish of [261004h](261004h-fence-the-paper-passages-work-fields-and-stop-echoing-reader-values-in-errors.md)
§ Seen while here. Handed over by the Overseer on 2026-10-04 under Greg's:

> If you're confident, address all of the Q-queue-yeses
>
> — Greg, 2026-10-04

## What is wrong

261004h fenced the cited work's title, `why` and the citing passages in the paper-passages prompt.
Two more prompts, and a third that shares a file with one of them, write the same fields as if they
were our own lines:

| Prompt | Where | What was outside any fence |
|---|---|---|
| *Dig deeper*'s second part | `investigatePart`, `src/citation-investigate.ts` | title, authors, year, reference entry, the article's link, `why`, the citing passages, and the matched search result's address, title and quotes |
| The quick check (*Look it up*) | `lookupPrompt`, `src/citation-find.ts` | title, authors, year, DOI or arXiv id, reference entry, `why`, the citing passage |
| The page search | `findPrompt`, same file | title, authors, year, reference entry |

The first two groups of fields are the article's, and its author is untrusted
([security-map.md](../project/security-map.md)). The matched result is a stranger's web page. All
three calls have a web search tool, so an instruction that lands has something to reach: which
query is run, and what the answer says.

## The change

Each group goes inside `untrusted()` (`src/untrusted-fence.ts`, the helper 261004h used), our own
sentences stay outside, a reminder follows the last fence, and each system prompt gains a line
saying the details of the work are data.

- `investigatePart`: three regions, `cited work`, `matched result` (only when there is one) and
  `article citation`, then one reminder, before the paper's section.
- `lookupPrompt` and `findPrompt`: one `cited work` region and a reminder, through one small
  shared function.
- `paperSection`: the requested or fetched host in a `paper source` region, with our account of
  what was read outside it. A parsed hostname still comes from the article or the remote page.

`findPrompt` was not in the handover. It is here because it is the same class in the same file, and
`lookupRequest` is built on `findRequest`. It is also what an uploaded paper's own-page search
sends (`src/source-guess-run.ts`), with a title read from the upload.

## The versions

- **`CITATION_INVESTIGATE_VERSION` stays `/8`.** 261004h took it from `/7` to `/8` and that has not
  been deployed: `origin/main` still says `/7`. So this change rides on the same bump and readers'
  kept *Dig deeper* answers detach once. The Overseer is holding the deploy for that.
- **`CITATION_LOOKUP_VERSION` goes `/6` to `/7`.** `/6` is live. Every kept *Look it up* detaches
  and needs a new press. The reason is the one 261004h gave: a reading kept from the unfenced layout
  is not one today's prompt would write.
- `findPrompt` has no version. The upload-source job checks a found page's identity before saving
  it, then keeps settled guesses (`found` and `none`) without a prompt stamp or rechecking on later
  opens (`makeGuessSource`, `src/source-guess-run.ts`). This change applies to new searches; it does
  not invalidate those earlier guesses. Retrying old `none` guesses would be separate work.

## The simpler option passed over

Fence only title, `why` and the passages, as the handover's sentence says. Passed over because
authors, year, the reference entry and the matched result's title are the same untrusted text in
the same string, and a later second change to *Dig deeper*'s prompt would be a second detach.

## Not measured

No before-and-after eval of answer quality was run
([prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change)).
The bibliographic fields and evidence remain available, with markers and instructions identifying
them as data. Shipping this narrow boundary change without a live-model eval is reasonable, but
the tests establish the layout, not model obedience or unchanged answer quality. A model could
put marker text into a search query, or give less weight to fenced identity fields or evidence and
therefore choose a worse query, match or support reading. The DOI/arXiv search instruction remains
outside the fence. No live-model run measured those risks or resistance to semantic injection;
the fences prevent literal delimiter escape, not every way a document can influence a model.

## Red test

`tests/citation-prompt-fences.test.ts`: every field set to a hostile string, every fenced region
cut out of the prompt, and no hostile string may be left. Expected fence labels and raw delimiter
counts are checked first, so a leaked field cannot hide by supplying its own complete fake fence.
Controls cover plain leaks, complete fake fences and nested fake markers. All supplied fields must
also be present, so dropping one is not a passing fence test.
Thirteen of sixteen failed on the old layout.

## Log

- 2026-10-04: written and built; to GPT Sol for code review.
- 2026-10-04: review fixed the paper host in four states (new tests seen red first), and the regex
  oracle that accepted attacker-authored fence structure. Root-cause classes: derived external
  metadata treated as trusted prompt text; untrusted delimiters accepted as test structure.
  Corrected the upload-source retention claim and widened the unmeasured risks. `/8` stays put.
