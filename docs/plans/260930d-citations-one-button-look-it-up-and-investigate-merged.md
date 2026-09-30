# Citations: one button — *Look it up* and *Investigate* merged

Status: **planned 2026-09-30, not built.** Feedback report SPIDERYARN-READING2-75 (`spya-mbgnwh`),
from Greg, relayed by the Overseer; sent 2026-09-30 05:19 from production `a522ba8c`, on
`dongetal25-spya-vfmvmm` in Citations mode:

> In Citations mode, can we amalgamate "Look it up" and "Investigate" buttons to get the best of
> both worlds?

It builds on [260930a](260930a-citations-investigate-one-work-on-demand.md) (*Investigate*,
shipped this morning) and [260929g](260929g-check-a-cited-paper-supports-the-claim.md) (*Look it
up*), and it answers the first of the two calls 260930a left for Greg in
[awaiting-approval.md](../user-feedback/awaiting-approval.md): *offer Investigate only once Look it
up has identified the work, so code rather than the model decides which search result is the
paper*. Merged, that stops being a second paid press and becomes the first step of the one press.

## What each button is best at today

| | *Look it up* | *Investigate* |
|---|---|---|
| finds the work's page, identity checked **by code** (5G's two-gate rule) | yes | no — says "could not confirm" unless a Look it up already matched |
| gives an unlinked row a link | yes | no |
| verbatim evidence | one quote, **found by code** in the page's extract | none (it is forbidden to quote) |
| a verdict on the claim | supports / partly / extract doesn't show it | in prose |
| how else it bears on the article, and *for you* | no | yes |
| streams | no (JSON, ~6 s) | yes |
| cost a press | ~3¢ | ~12¢ (15¢ at worst) |

The best of both is: code identifies the page and quotes it, then the reading is written knowing
which page that is.

## The merged press

One button per owner row, **Investigate**. One press:

1. **Find the work** — only if the row has no current *Look it up* reading. This is exactly *Look
   it up*'s call (`findWorkPage` + `judgeLookup`), its identity rule, its verified quotes and its
   store, unchanged. A searched row takes the found page as its link, as before. The reader sees
   *Finding the work…* and then, when it lands, the row's link and verdict update at once (an SSE
   `lookup` frame carrying the same body `POST …/find` returned).
2. **Write the reading** — *Investigate*'s streamed call, now always knowing what step 1 found:
   the matched branch when a page was identified (its URL, title and verified quotes go into the
   prompt and are the only outside words the quote guard allows), the unconfirmed branch when
   none was. Provenance, guard, storage and fingerprint unchanged.

A row that already has a current reading skips step 1, so *Investigate again* costs what it costs
today. A step-1 failure (the search found nothing, or a provider error) does not stop step 2: the
reading runs in the unconfirmed branch, and the provenance line already says so. A step-1 *save*
failure is a failure of the press, as it is of *Look it up* today.

### What goes

- The **Look it up** button, and the *Look it up* offer line under an investigation.
- `POST /api/citations/:slug/:id/find` — its only caller was that button. `findWorkPage` stays (the
  uploaded-paper guess uses it). The `citation-find` allowance bucket stays in the database's CHECK
  (rows exist) but is no longer taken; the merged press takes only `citation-investigate`.

### Cost and limits

About 15¢ a press when step 1 runs, 12¢ when it is skipped; worst case about $0.33. The
`citation-investigate` bucket is unchanged — one at a time, 8 an hour, 20 a day per reader, 60 a day
globally — which puts the worst day at about $20, the ceiling 260930a set.

### The one product call in this, taken the simple way

A reader who wanted only the link, or only the quick verdict, used to pay 3¢ and now pays 15¢.
Greg asked for the two to be merged, the lookup's result is still drawn on its own the moment
step 1 lands, and the difference is 12¢ a press; so this is recorded here as an assumption rather
than put to him as a question. If the cheap press matters, the fallback is one line of UI: a
second, quieter *Just find it* link that calls step 1 alone.

## Stages

1. **Server.** `makeFindCitation` split into the lookup core (no allowance, no route) and nothing
   else — the route goes. `makeInvestigateCitation` runs the core inside its stream, after its own
   allowance, when the row has no current reading; emits `stage` and `lookup` frames; computes the
   matched page, the request, the allowed quote texts and the fingerprint **after** step 1. Tests
   red-first: step 1 runs only without a current reading; its result feeds the matched branch and
   the guard; a no-match or provider error still streams the reading; a save failure fails the
   press; `done` only after both saves; only one allowance is taken. GPT Sol code review.
2. **Client.** One button; *Finding the work…* then the stream; the `lookup` frame applied to the row
   as the old response was; the offer line removed; the ControlTip says both steps and the cost.
   The first-tap/second-tap rule on touch stays. Browser check. GPT Sol code review.
3. **Docs and note.** citations.md (*Look it up* and *Investigate* sections become one press),
   the note, awaiting-approval.md.

## Deferred

A *Just find it* link (above). Reading the paper itself stays 5G's proposed stage.

## Review log

(to be filled)
