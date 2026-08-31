# GPT Sol's third review: the seven fixes, and the table that says something different

The answer to [260828l-dictation-vocabulary-review-3-prompt.md](260828l-dictation-vocabulary-review-3-prompt.md),
verbatim except that its links have been rewritten relative to this file so that
`tests/doc-links.test.ts` passes. Verdict: **not ready**, eight findings, all of them right.
What each one changed is in
[260828l-dictation-vocabulary.md § The third review](260828l-dictation-vocabulary.md#the-third-review-of-the-fixes-and-the-new-table).

1. **High — the replicate pair is still used as a statistical threshold.** The plan first admits it is “one realised contrast, not a bound,” then concludes that any gap no larger than it “is not a finding” ([260828l-dictation-vocabulary.md](260828l-dictation-vocabulary.md), lines 314–317). That is exactly what the second review rejected. It is then used to dismiss the profile movement and support the size conclusion. The pair can flag those differences as unresolved; it cannot retire them.

2. **High — the results artifact is still not fully auditable.** The five recorded fingerprints match the current files, but the harness hashes only its source, the utterance manifest, and three production files ([bench-vocabulary-sources.ts](../../evals/dictation/bench-vocabulary-sources.ts), lines 612–650; [results-vocabulary-sources.json](../../evals/dictation/results-vocabulary-sources.json), lines 10–15). It does not hash:

   - the ten audio clips;
   - the article `blocks.json`, `glossary.json`, `meta.json`, or `reader.json` inputs;
   - shared request code such as `src/ai-call.ts`.

   Changing an audio clip would materially change the measurement without changing any recorded hash. Also, `$0.1834` is genuinely summed from `out.usd`, but only the aggregate is stored; the 650 per-call values cannot be independently re-summed ([bench-vocabulary-sources.ts](../../evals/dictation/bench-vocabulary-sources.ts), lines 443–453). The second review table’s “hash of each file that decided what the run measured” is false ([260828l-dictation-vocabulary.md](260828l-dictation-vocabulary.md), line 441).

3. **Medium — the wrong-article vocabulary is not disjoint.** It contains the term `In` ([results-vocabulary-sources.json](../../evals/dictation/results-vocabulary-sources.json), lines 3837–3848), which occurs as a word in `constitution-mixed` and `profile` ([utterances.json](../../evals/dictation/utterances.json), lines 63 and 93). It shares no scored hard term, so this small contamination probably does not explain the large degradation, but “Nothing in it was said in any clip” is false ([260828l-dictation-vocabulary.md](260828l-dictation-vocabulary.md), lines 265–266). `NOT_NAMES` notably omits `in`, despite the nearby comment naming `In` as something the two-character rule should not admit ([vocabulary.ts](../../src/vocabulary.ts), lines 174–182).

4. **Medium — the size arm is cleaner than before, but “costs nothing” is too strong and two counts are wrong.** The cap is not dropping its tail: the enlarged vocabularies are 1,147–1,796 characters, below 2,000, and each has the smaller arm as an exact prefix. That part is fine.

   However, it adds 72 or 73 terms, not 70, and its actual range is 86–132 terms, not 86–130 ([260828l-dictation-vocabulary.md](260828l-dictation-vocabulary.md), lines 298–310). Aggregate corpus WER is identical, but that hides offsetting clip results: `fowler-glossary` improves by two edits while `purpose-box` worsens by two. Recall differs by one hit, 174 versus 175. The honest conclusion is “no detectable aggregate cost in this five-run contrast at up to 132 terms,” not “size costs nothing” or “there is no need to tune the cap.”

5. **Medium — `MAX_TERM` still silently consumes wrong-shaped inputs.** `phrases()` fixes the two prose boxes, but title, byline, glossary entries, and extracted multi-word names still reach `fit()` raw ([vocabulary-sources.ts](../../src/vocabulary-sources.ts), lines 156–166 and 261–278). `fit()` slices them at 80 characters, mid-word if necessary, and discards the tail ([vocabulary.ts](../../src/vocabulary.ts), lines 326–351). A long article title is prose just as the profile was.

   Direct edge-case behavior of `phrases()` is:

   - ordinary unpunctuated prose with spaces: preserved in ≤80-character chunks;
   - a 400-character token: split every 80 characters, despite the word-boundary claim;
   - URL containing a comma: split at the comma;
   - em-dash list: not split at the dashes;
   - CJK: retained but cut mechanically every 80 UTF-16 units because CJK punctuation is unrecognised;
   - `Washington, D.C.`: becomes separate `Washington` and `D.C.` terms.

   Some may be acceptable 80/20 behavior, but they need explicit decisions and tests. The lookbehind itself is fine: this ships on Node 24, where it is supported ([deployment.md](../../docs/project/deployment.md), line 24).

6. **Medium — the profile description is honest; the retention rationale is not evidence.** Saying the profile is untested rather than disproved is correct: the existing profile clip is perfect without vocabulary. But purpose proves that a relevant supplied spelling can help; it does not prove that a global biography predicts article dictation. Keeping profile is defensible as a cheap product hypothesis, not “on the mechanism the purpose row demonstrates.”

   It is also not a read already made in this request: `profileTerms()` calls `readerStore.readProfile()` ([vocabulary-sources.ts](../../src/vocabulary-sources.ts), lines 107–118), which performs its own database query ([pg-reader.ts](../../src/store/pg-reader.ts), lines 27–32).

   The cheapest honest test is one synthetic profile containing three or four acoustically ambiguous, profile-only terms, with one matching clip, and two otherwise byte-identical arms with and without the profile. Five interleaved runs cost ten calls.

7. **The deadline implementation is acceptable, with one documentation correction.** `Promise.race` attaches rejection handling, every current source catches failures, and the timer’s `unref()` works on the deployed Node runtime ([vocabulary-sources.ts](../../src/vocabulary-sources.ts), lines 226–242). There is no unhandled rejection and the race timer will not hold Node open.

   The underlying database operation is not cancelled, however. It may continue consuming a connection, and only the article-name path writes a cache. Vercel may freeze or terminate work after the response, so “the next press … has what it fetched” is not guaranteed ([260828l-dictation-vocabulary.md](260828l-dictation-vocabulary.md), lines 164–168). The 1.5-second value is a reasonable policy choice, though not established by this benchmark.

8. **The perfect purpose result is not a scoring bug.** All five stored `purpose-box` transcripts contain the four target terms correctly, including British `realisation`. The `+purpose` and production vocabularies are byte-identical for every other clip; only `purpose-box` differs. Its recall moves from 5/20 to 20/20. One unrelated Fowler edit also happens to disappear between the replicate calls, so attribute the 15 hard-term hits and the purpose clip’s correction to the box—not every last bit of the aggregate 0.0%.

The remaining table misstatements are the unresolved noise-threshold claim and the incomplete fingerprint claim above. The first review table’s item 4 is also stale when it says the wrong-list arm shows only a short-utterance failure ([260828l-dictation-vocabulary.md](260828l-dictation-vocabulary.md), line 415).

Targeted tests passed: 56/56.

**Verdict: not ready.**