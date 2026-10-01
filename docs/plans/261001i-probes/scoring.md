# Scoring rubric

The same rubric scores both rounds, by a fresh agent each time, reading only `key-PNN.md` and the
round's `<round>-PNN.md`.

Per probe, score against the key:

- **Docs (0–4):** of the key's MUST docs, the share the probe opened (or reached the decisive
  section of by grep), scaled to 0–4. USEFUL docs don't count against. **A plan the
  probe was barred from opening** (named 260929…, 260930…, 2610…) is left out of the denominator in
  both rounds: the bar is the probe's, not the docs' (the before-round scorer counted them as
  misses, which cost about 0.5 of the mean).
- **Reuse (0–4):** of the key's "existing code it must reuse", the share the probe named, scaled to
  0–4. If the key lists nothing, 4. Subtract 2 (floor 0) if the probe says it would write a new
  helper that the key says already exists — a second copy.
- **Rules (0–3):** of the key's applicable rules, the share the probe named, scaled to 0–3.
- **Disposition (0–2):** the key's expected disposition — implement, already done, diagnose, or ask
  Greg first. 2 if the probe reached it; 1 if it noticed the issue but planned the wrong response;
  0 otherwise. (Was a 0–1 "premise" point before Sol's plan review, R2.)
- **Precision (0 to −2):** −1 for each wrong or duplicative action the key lists that the probe
  planned, and −1 if more than half the docs it opened were dead ends by its own account. Floor −2.
- **Traps (0–2):** of the key's traps, the share the probe anticipated, scaled to 0–2.

Total out of 15 (4 + 4 + 3 + 2 + 2, less up to 2 for precision). Also record the probe's tool-call count where it states one, and its own confidence.

Guard against teaching to the test (from the plan review): a doc added or changed in this sweep
counts only if it is a general signpost. A sentence that names one probe's specific answer, and
would serve no other task, is flagged as **leak** and its credit is removed in the after round.
The scorer is told which docs changed, and checks each credited after-round find against that list.

**The final score is blind.** At the end, both rounds' result files are copied under shuffled names
(the mapping is kept by the orchestrator, not given to the scorer), and one fresh scorer scores all
of them against the keys with this rubric. `score-before.md`, written mid-run from the earlier
version of the rubric, is a diagnostic only.

Output: a table (probe, docs, reuse, rules, disposition, traps, precision, total, confidence), the round's mean,
and for each probe one line on the biggest miss.
