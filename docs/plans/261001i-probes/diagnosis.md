# 261001i probes: diagnosis, before vs after

`before-<id>.md` vs `after-<id>.md`, checked against `git diff 4a7862f3 b4f4e9f4`; blind files
mapped back to rounds by diffing them against the result files. Blind totals:

| Task | P01 | P02 | P03 | P04 | P05 | P06 | P07 | P08 | P09 | P10 | P11 | P12 | H1 | H2 | H3 | H4 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 11.1 | 10.2 | 12.9 | 9.4 | 6.7 | 12.3 | 10.4 | 10.1 | 12.4 | 12.2 | 9.1 | 10.1 | 9.1 | 11.7 | 11.8 | 11.5 |
| After | 9.4 | 11.0 | 13.5 | 11.3 | 10.1 | 9.4 | 10.4 | 9.4 | 11.3 | 10.4 | 8.2 | 10.6 | 11.7 | 11.2 | 12.8 | 12.0 |
| Δ | −1.7 | +0.8 | +0.6 | +1.9 | +3.4 | −2.9 | 0 | −0.7 | −1.1 | −1.8 | −0.9 | +0.5 | +2.6 | −0.5 | +1.0 | +0.5 |

P tasks net −1.9, H tasks +3.6. Of the H gain only H3's +1.0 traces to a changed doc; H1's +2.6
came through `citations.md` and `copy.md`, which the sweep did not touch.

## Per task

**P01 (−1.7).** Fixed: before, the probe complained that `library.md` was 1,204 lines with no table
of contents. The new "Where to look" list at the top of `library.md` sent the after probe straight
to `relative-time.ts`. Worse: it stopped after one doc. It never opened `tooltips.md` and lost the
before probe's finding that the table cell's hover was removed on purpose (260928a, `rowCardFacts`).
The signpost's "the exact time on hover" is not true of the table cell: it ended the search early
and slightly misled.

**P02 (+0.8).** Fixed: before said "nothing says plainly a one-off non-mode step". The after probe
used `new-mode.md` § Adjacent shapes ("a pipeline step with no band (a line on the Metadata
page…)"), the `architecture.md` § Shared code (server) list (`streamMessage`, `parseJsonAnswer`,
`articleFingerprint`) and `prompting-guide.md`, which it now opened (Docs 2.0 → 3.0). Still hit:
how `Metadata.tsx` gets its data. It also used `arc.ts`, not `simple-summary.ts`, as the template.

**P03 (+0.6).** Fixed: before found `accountEmail` only by grepping `src/store`. After got it from
`email.md`'s new paragraph "Where the existing mail paths get a reader's address". Before also
could not find where a job's success is committed; after got that from `ingest-queue.md`'s new
"Where a job's life is decided" (`pgStoreSession`, `noteEnded`). Still hit, both rounds:
consent and unsubscribe for the first mail to a reader, and the at-most-once trap.

**P04 (+1.9).** Fixed: before said `narrow-windows.md` "says little about band rows at phone width".
After used the new `narrow-windows.md` § A row that pushes a phone page sideways: the injection
method and `tests/masthead-facts-wrap-in-chrome.test.tsx` as a pattern with a control. Reuse,
traps and precision rose; Docs fell 2.7 → 1.3, as it no longer opened `browser-testing.md`.

**P05 (+3.4, the largest swing).** Fixed: before "would write a small one" (a third clipboard
helper, −2). After reused `Tweets.tsx` § `CopyButton`, which it found through the new sentence in
`quotes.md` § What is still open. `web-client.md` § Shared code (client) now says the same thing in
general form ("No shared copy button…"), but the probe did not reach it. Still hit: there is no
shortcut registry to pick a free key from.

**P06 (−2.9).** Fixed: the stale `band()` name and the "sixteen"/"fourteen" mode counts in
`new-mode.md`, which before flagged, were corrected, and after did not hit them. Worse, but by
interpretation, not docs: before said it would ask Greg (Disposition 2); after committed to "the
Socratic questions" and built (Disposition 1), dropping the read/job hooks from reuse. Still hit, both rounds: `question` is Chat's
alias, which is only in a comment in `mode-catalog.ts`, and there is no `annotations.md`.

**P07 (0).** Fixed: before said nothing signposts the add page's auto-start. After answered it from
one new sentence in `faq.md` ("Almost nowhere lost"). The general version, `new-mode.md` § Where
else to look ("A mode can start without being opened"), was not opened. Unchanged total: the
direct answer ended the search, so it skipped `experimental-features.md` and missed `modeStep`,
`STEP_READS` and StrictMode.

**P08 (−0.7).** Fixed: before found no doc on "add a per-reader setting". After treated
`experimental-features.md`, with its new "This setting crosses every layer…" paragraph, as the
template. It never opened `new-mode.md` § Adjacent shapes, and did not pick up the new
`localStorage` sentence. Still hit, both rounds: what "summary depth" means. `url-state.md` was
never opened, and neither round asked Greg. Worse: it skipped `sql.md`, which is noise.

**P09 (−1.1).** `quiz.md`, `evals/README.md` untouched. Both found `quiz-build-up.ts` only by `ls`
(the README lists it at line 1093); after lost the `quiz-reading-goal*` hint. Variance.

**P10 (−1.8).** A pointer was added but not seen. `glossary.md` gained a pointer to `web-client.md` §
The waiting state at line 109, but after read its head and reported "no loading-state detail". It
again found the rule by grepping, then confirmed it with `new-mode.md` § Where else to look. Worse:
`web-client.md` § Shared code (client) names `useSlow` and `LoaderCircle`/`cmt-spinner`, and the
probe stopped there instead of opening `icons.md`, a MUST.

**P11 (−0.9).** Fixed: before called `public-shelf.md` the wrong doc and said "no doc says Ideas is
public-visible". After got it from the new `ideas.md` sentence and `new-mode.md` § Where else to
look. Worse: that section leads with `REVISION_READ_POLICY` in `pg.ts`. The probe named it in place
of the key's `public-reader.ts` § `PUBLIC_PROJECTIONS`, which before had named, and lost the reuse
credit. Still hit: there is no single table of which
modes a visitor sees, and neither round opened `security-map.md`.

**P12 (+0.5).** Fixed: before said "`search.md` has no troubleshooting section". After opened the new
`search.md` lead "When a search returns nothing, or less than it should", and Traps rose 0.3 →
1.5 (`?conf=`, dropped-hit counts). Still hit: how to tell from a report's `url` tag which search
the reader used. `sentry-error-monitoring.md` and `silent-success.md` were unopened in both rounds.

**H1 (+2.6), H2 (−0.5), H4 (+0.5).** No sweep doc involved in any: variance. H1's after found
`sayToReader` in code; H2 took identical paths; H4's after spotted a stale `admin.md` line (~760,
"No model spend per user").

**H3 (+1.0).** Fixed: before's three dead ends (`ingest-queue.md`, `performance.md` and
`debugging.md`, by grep) became one useful read of `ingest-queue.md` "Where a job's life is
decided" (`runStep`, `walkClaim`, `noteEnded`), and the precision penalty went. This is the one gain
on the held-out tasks that a sweep change explains. Still hit, both rounds: `logging.md` does not
name the `step done` line or its `ms` field.

## Leak check

- **P05, leak.** `quotes.md`: "`src/web/Tweets.tsx` already has a private `CopyButton`, with its card
  and its touch behaviour." It serves only "add a copy button to Quotes"; the general twin
  in `web-client.md` § Shared code (client) is fine, but the probe credited `quotes.md`. Most of
  P05's +3.4 (Reuse 0.4 → 1.6, no −1 precision) flows through it.
- **P07, leak.** `faq.md`: "which is also why the add page's *generate the main modes* box does not
  make one after an import: that list is every mode outside the switch that makes something,
  derived in `src/web/auto-modes.ts`". P07's answer; the total did not move, but the
  `ingest-queue.md` Docs credit was reached through it.
- **P11, leak-shaped, no credit at stake.** `ideas.md`: "A visitor to a public article sees a
  stored list (`VisitorIdeasBand`, from the page's payload) and can never start one." P11's answer.
- **Borderline, not leaks.** Each mirrors its task's wording, but the section is a general index or
  lesson: `library.md` "added 3 days ago… the exact time on hover" (P01); `narrow-windows.md` "its
  header and sort rows are rows like the shelf's" (P04); `search.md` "When a search returns
  nothing" (P12); `new-mode.md` "(a line on the Metadata page…)" (P02); the `localStorage` sentences
  in `new-mode.md` and `experimental-features.md`, aimed at P08's key and used by no probe.
- **Clean:** `email.md`, `ingest-queue.md` "Where a job's life is decided", the shared-code lists.

## Across all 16

**The three signposts that did the most work:**

1. `ingest-queue.md` "Where a job's life is decided": P03 and held-out H3, the only change with
   held-out evidence.
2. `new-mode.md` § Adjacent shapes and § Where else to look: P02, P10, P11; under-opened by P07/P08.
3. Symptom-first leads: `search.md` "When a search returns nothing" (P12) and `narrow-windows.md` §
   A row that pushes a phone page sideways (P04). (`quotes.md`'s `CopyButton` line did more, but leaks.)

**The three gaps still most often hit:**

1. **"Already built" with no status line.** The premise was false in P01, P05, P07, P11, H1, H2,
   H3 and H4. Only `export.md` and `admin.md` say so plainly. P11 and H3 both said no doc records
   that it is done, or when.
2. **Facts only in code comments or at the bottom of long files**, hit in both rounds: `question`
   as Chat's alias (P06), the quiz evals at line 1093 of `evals/README.md` (P09), the `step done`
   log line (H3), and which modes a visitor sees as one table (P11).
3. **Ambiguous tasks with no doc that lists the candidates.** This covers which "Questions" (P06),
   which "summary depth" (P08), which search (P12), which "header row" (P04) and which lookup (H1).
   Disposition swings on the guess.

**Signs the new material made things worse:**

- **A shortcut ends the search early.** A summary signpost answered enough that the probe skipped a
  MUST doc: `tooltips.md` and 260928a (P01), `icons.md` (P10), `browser-testing.md` (P04),
  `experimental-features.md` (P07). The likeliest cause of the flat P aggregate: Docs and Traps fell
  where Reuse rose.
- **A signpost that names the wrong or a weaker thing.** `library.md` says "exact time on hover"
  across both views (P01). `new-mode.md` § Where else to look leads with `REVISION_READ_POLICY`
  rather than `PUBLIC_PROJECTIONS` (P11).
- **Pointers buried below the head.** `glossary.md` line 109 was missed (P10). A pointer past line 100 acts like none.
- **Length and dead ends: no harm visible yet.** `new-mode.md` grew 393 → 472 lines,
  `architecture.md` +177, `web-client.md` +89; `ingest-queue.md` is 2,207. Length complaints did
  not rise, and no after probe called a new doc a dead end.
