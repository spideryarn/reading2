# Scores: before round

Scored against `scoring.md`, one key and one result per probe, read literally. A doc counts only if
the probe lists it as opened or quotes its decisive section; a helper only if named by file and
symbol. No leak check this round. No probe stated a tool-call count, so that column is left out.

**One thing about the rubric itself.** The brief bars probes from opening any plan named 260929,
260930 or 2610. Five MUST docs fall under that bar, so no probe could ever score them:
`260930i-changelog…` (P01), `260930i-email-admin…` and `261001b-sign-up-mail…` (P03), `261001e-masthead…`
(P04), `260930c-auto-generate…` (P07). The scores below count them as missed, as the rubric
says. Leaving them out of the denominator would raise the mean to **9.4**. The bar is the same in
both rounds, so the before/after comparison still holds. But it caps those four probes, and the
lessons those plans hold can only reach a probe if they are promoted into a project doc.

| Probe | Docs /4 | Reuse /4 | Rules /3 | Premise /1 | Traps /2 | Total /14 | Conf. |
|---|---|---|---|---|---|---|---|
| P01 shelf relative date | 2.0 | 3.0 | 0.75 | 1 | 1.33 | 8.1 | 8 |
| P02 "why this matters" call | 2.0 | 3.33 | 2.1 | 1 | 0.2 | 8.6 | 6 |
| P03 email on PDF import | 2.0 | 3.2 | 3.0 | 1 | 0.5 | 9.7 | 6 |
| P04 Citations head overflow | 2.0 | 0.67 (2.67 − 2) | 2.0 | 1 | 0.5 | 6.2 | 5 (3 on rule) |
| P05 Quotes copy tooltip | 2.2 | 0 (1.6 − 2) | 1.71 | 1 | 1.2 | 6.1 | 5 |
| P06 Questions mode | 3.6 | 3.33 | 2.7 | 1 | 0.4 | 11.0 | 6 (3 on intent) |
| P07 FAQ after import | 2.75 | 2.0 | 2.2 | 1 | 0.8 | 8.75 | 7 |
| P08 summary-depth setting | 2.5 | 3.5 | 2.06 | 0 | 0.33 | 8.4 | 6 |
| P09 quiz avoids examples | 4.0 | 2.4 | 3.0 | 1 | 0.86 | 11.3 | 7 |
| P10 Glossary spinner | 4.0 | 3.2 | 1.5 | 1 | 2.0 | 11.7 | 7 |
| P11 visitor sees Ideas | 1.33 | 4.0 | 0.75 | 1 | 0.8 | 7.9 | 6 |
| P12 search empty, one article | 2.5 | 3.3 | 2.25 | 1 | 0.25 | 9.3 | 4 |

**Mean: 8.9 / 14** (107.0 / 12). Mean by column: docs 2.6/4, reuse 2.7/4, rules 2.0/3, premise
0.92/1, traps 0.76/2. **Traps is the weakest column by a distance.**

Judgement calls:
- P04 loses 2 because it would copy `.gloss-sort` into a Citations-only fix ("pattern to copy",
  "preferred: Citations-only fix"). The key names that as the trap.
- P05 loses 2 for "I would write a small one" when `src/web/Tweets.tsx` § `CopyButton` exists.
- P08 scores 0 on premise. It noted it did not know what "depth" meant, but then picked `deep`
  without seeing the second axis (the Simple level) or planning to ask Greg.
- P10's "if it came via Feedback" rule does not apply, so it is out of the denominator.

## Biggest miss per probe

- **P01**: It saw the feature is already built, but it missed every rule about the hover. It would
  allow a native `title`, which `tooltips.md` forbids, and it never mentions the `en` pinning trap.
- **P02**: It said visitors should not see the line in v1, which is the opposite of the
  visitor-readable default. It also missed that Simple's second paragraph already says why the piece
  matters, and it never opened `prompting-guide.md` or `vision.md` § Anti-goals.
- **P03**: Its traps. It said nothing about once-only sending when a job is retried, and nothing
  about `skipped` meaning a misconfiguration (both are in the barred `261001b` and `260930i`).
- **P04**: It planned a CSS-reading test and a Citations-only copy of the shared row. The key wants a
  real-Chrome test with a control, and the injection method for finding the culprit.
- **P05**: It never found `src/web/Tweets.tsx` § `CopyButton`, and planned a fourth copy-to-clipboard
  implementation.
- **P06**: The traps. It missed the `question` alias tie with Chat, the `MODE_CONTAINMENT` `WITNESS`,
  and what happens to an open mode when the switch goes off.
- **P07**: It never named the cost of a per-import FAQ. It said "nothing to do, `runStep`
  attributes", when the key wants the cost measured. It missed `STEP_READS` and the StrictMode
  once-guard.
- **P08**: It never saw that "depth" has two axes (`?deep=` and the Simple level), and never read
  `summaries.md` § "Why there is no Length control" or `url-state.md`. It also missed the door rule:
  a stored default of Fuller must not spend money just because the reader arrived.
- **P09**: It did not find `evals/quiz-reading-goal.ts`, the newest harness, with its `blindOrder`
  and source provenance. It did not plan to declare its bars before running.
- **P10**: Its rules. No browser check, and no mention that visitors never see a loading state.
- **P11**: It never opened `security-map.md` or the 260929a postmortem, and it did not plan to check
  that a visitor never triggers a paid call.
- **P12**: It missed `search.md` § "The four ways a filter lies". The prioritised default plus a
  leftover `?conf=` is the most likely "returns nothing", and so is the log line's dropped-hit
  counts.

## Cross-cutting misses (the useful part)

1. **Lessons that live only in recent plans.** P01 (`en` pinning), P03 (`SendResult`/`skipped`, at
   most once), P04 (find the culprit by injection; `inline-block` and `nowrap`; the control for a
   fallback font), P07 (`STEP_READS`, StrictMode guard, cost per import), P08 (a peer's unmerged
   migration blocks `db:migrate`), P09 (declare bars first; one round is noise). These are why the
   traps column is so low. **Cause: a missing doc.** The lesson never got promoted from the plan
   into the project doc that owns the area: `email.md`, `narrow-windows.md`, `ingest-queue.md`,
   `prompting-guide.md`, `database.md`.
2. **"Browser check in a Sonnet subagent"** was missed by P01, P05, P07, P08, P10, P11 and P12. Only
   P04 and P06 named it. **Cause: a missing signpost.** It lives only in CLAUDE.md § Delegating, and
   the feature docs and `code-quality-overview.md` checklists probes actually read don't repeat or
   link it.
3. **The visitor and security side of a change.** P02 got visitor-readable-by-default backwards.
   P11 never opened `security-map.md` or the 260929a postmortem. P10 and P11 missed "visitors never
   trigger a paid call". **Cause: a missing signpost** from the feature docs (`ideas.md`, the
   `cost-tracking.md` route) to `mode.md` § the artefact's visitor bullet and `security-map.md`.
   P11 also asked for a missing doc: one "which modes a visitor sees" table.
4. **Facts buried in over-long docs.**
   - `library.md` (1,204 lines): "Dates are relative" sits mid-section on sorting (P01).
   - `quotes.md`: "No copy button" is at about line 763 (P05).
   - `search.md` (1,278 lines): no troubleshooting or "returns nothing" entry, and the filter section
     was skipped (P12).
   - `web-client.md` § "The waiting state" was reached only by grepping "spinner" (P10).
   - `ingest-queue.md`: the finish path and the post-import box are buried in history (P03, P07).

   **Cause: buried facts.** Each wants a short "what is done / where to look" lead or a
   symptom-indexed section.
5. **Existing shared pieces that no doc names.** These are `src/web/Tweets.tsx` § `CopyButton` (P05),
   the real-Chrome layout test pattern in `tests/masthead-facts-wrap-in-chrome.test.tsx` (P04), the
   newest eval harness `evals/quiz-reading-goal.ts` (P09, and `evals/README.md` lists no quiz
   evals), and `src/store/admin-accounts.ts` § `accountEmail` (P03, found only by grep). **Cause: a
   missing signpost.** `icons.md`/`tooltips.md` should point to the copy button,
   `browser-testing.md` to the Chrome test, and `evals/README.md` to the quiz evals.
6. **Recipes for shapes that aren't modes.** P02 (a one-off paid pipeline step) and P08 (a
   per-reader setting) both had to infer their recipe from `mode.md` and
   `experimental-features.md`. **Cause: a missing signpost.** Each could be a short section in its
   host doc, or a line saying "the same recipe applies, minus these rows".
7. **Product ambiguity that the docs could have surfaced.** P02 (it overlaps Simple), P06 (the name
   "Questions" overlaps FAQ, Quiz and the Socratic questions), P08 (two depth axes). Only P06 asked
   Greg cleanly. **Cause: buried facts.** The overlap lives in `summaries.md` and `mode-catalog.ts`
   comments, not in an obvious place.
8. **Stale text that cost probes time.**
   - `mode.md` still says `band()` (now `modeBand()`) and counts modes despite its own rule (P06).
   - The `ReaderStore` and `pg-reader.ts` comments name the deleted filesystem store (P08).
   - The `auto-run-targets.ts` header says "Eleven" (P07).
   - `mode.md`/`faq.md` never mention the add page's auto-start box (P07).

   **Cause: stale docs** (and, for the last one, a missing signpost).
