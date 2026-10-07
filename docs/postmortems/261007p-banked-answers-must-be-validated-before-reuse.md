# Banked answers must be validated before reuse

2026-10-07. Found during the [261007l code review](../plans/261007l-illustrated-fits-a-claim-and-a-late-stop-says-so.md).
Root cause independently checked by the timing-audit subagent. This was introduced by the
uncommitted Part 1 implementation on top of `12198fcaf`; no introducing commit exists yet.

The checkpoint bank checked that `raw` was a string, and the generator treated that as a reusable
brief before parsing it. Invalid JSON failed the step; parseable junk became an empty illustration
through the deliberately tolerant `readModelBrief`, leaving rejection to the later postcondition.
Fresh raw answers were banked before either check, so the code could also create the bad entries.

The class is **validating the cache envelope instead of the cached answer**. Whole JSON storage
does not establish that a model answer is usable. The happy-path checkpoint test checked identity
and reuse, but never changed the value behind the envelope.

The fix uses the same parser and brief reader for cache hits and fresh answers. A cached answer
needs at least one surviving plate; malformed or unusable hits become misses, and a fresh usable
answer replaces them. Fresh answers are banked only after validation. Fresh malformed output
still fails normally. This keeps one interpretation of the brief and the existing article/scene
checks, rather than introducing a second schema for the cache.

Countermeasures, ranked by ease against value:

1. **Exercise corrupt values through the existing bank port.** Done: seven cases in
   `tests/illustrated-run.test.ts` were all observed red before the fix and green afterwards.
   They cover malformed JSON, valid but unusable JSON, insufficient time to regenerate, and
   fresh answers that must not be saved. Pipeline cases also check replacement and reuse;
   their execution remains blocked by the sandbox's refusal of local Postgres connections.
2. **Validate at the consumer with the existing reader.** Done. A checkpoint store promises
   whole storage, not domain validity; the generator knows which plates remain usable.
3. **Give checkpoints their own strict domain schema.** Rejected here: it would duplicate the
   brief reader and reject useful partial answers that the drawing path already handles safely.
