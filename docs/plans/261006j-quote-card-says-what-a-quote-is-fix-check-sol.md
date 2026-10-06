F8 **closed**.

- **Both scores:** `priorityOf` uses their maximum; `quoteTier` and `quoteAlpha` both strengthen monotonically with that value.
- **One score:** `priorityOf` filters out the missing score and uses the sole available Importance or Striking score. The sentence remains accurate.
- **No scores:** `scores.length === 0`, so the purple sentence is omitted and the card says “Not scored.”

The test would fail if the purple sentence appeared on the unscored fixture: that paragraph must not match `/purple|scor/i`. The separate “Not scored.” paragraph is outside the assertion’s scope. The suite passes: **18/18**.

VERDICT: F8 closed