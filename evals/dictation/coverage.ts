/**
 * **How much of the run actually came back, stated once for both benchmarks.**
 *
 * [`bench-models.ts`](bench-models.ts) and
 * [`bench-vocabulary-sources.ts`](bench-vocabulary-sources.ts) both end by
 * saying something about how the run went, and both used to be able to say it
 * over nothing:
 *
 * - the first set `clean = true` and falsified it only from `odd`, the answers
 *   naming a model other than the arm's own — so an arm whose every call was
 *   lost had an empty map, produced an empty `odd`, and was reported under
 *   *"every call named the model it was sent to"*;
 * - the second wrote `calls: CONDITIONS.length * utterances.length * RUNS` into
 *   its results file, which is what the run *intended*, under a field name that
 *   claims to say what happened.
 *
 * That is the class in
 * [260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md](../../docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md)
 * — a clean bill computed over the collection the failure emptied — and the
 * shape of the fix is [`evals/quiz.ts`](../quiz.ts)'s: obtained counted against
 * attempted, an explicit sentence when nothing was measured, and an exit code
 * on total failure.
 *
 * **Why a module rather than four lines in each script.** Both benchmarks load
 * `.env.local`, throw without an API key and make paid calls at import, so
 * nothing can import one in order to test it. That is why the previous fix here
 * — GPT Sol's item 4, whose comment still stands above the check in
 * `bench-models.ts` — could come back one block later with no test able to
 * notice. A function can be handed an arm that answered nothing;
 * [`tests/dictation-bench-coverage.test.ts`](../../tests/dictation-bench-coverage.test.ts)
 * hands it one.
 *
 * **`clean` here is a positive statement**, not the absence of one complaint:
 * there was at least one arm, and every one of them answered every call it was
 * sent, under the name it was sent to, in numbers that are whole and positive.
 * It is computed from what must be *true* rather than from a list of what might
 * be wrong, so a state nobody thought to enumerate lands on the unclean side —
 * which is the half of this that a fourth instance of the bug would need.
 * `arms.length > 0` is what rejects the empty run; nothing about the arithmetic
 * would, since an empty collection has `answered === attempted === 0`.
 */

/** The name the table prints, and the calls the run set out to make for it. */
interface Sent {
  name: string;
  /**
   * Planned, not observed. It is the denominator, and it is the one number
   * here that is allowed to be a product of lengths.
   */
  attempted: number;
}

/**
 * One arm or condition, and what came back for it.
 *
 * **A union rather than an optional**, so a harness cannot half-supply the
 * misnaming check. `bench-models.ts` knows both which model it asked for and
 * what each response called itself, so it gives the tally;
 * `bench-vocabulary-sources.ts` holds the model fixed and does not carry
 * `answeredBy` at all, so it gives a count and gets the coverage half only —
 * and cannot silently be read as having checked something it never saw.
 */
export type Attempt =
  | (Sent & {
      /** The model this arm was sent to. */
      sentTo: string;
      /**
       * What answered, by the name it gave itself, and how often — `(none)`
       * included, because a response naming no model is not a confirmation.
       * The counts sum to what came back; an **empty map is an arm that
       * answered nothing**, which is the case this file exists for.
       */
      answers: ReadonlyMap<string, number>;
    })
  | (Sent & {
      /** What came back, when there is nothing to say about who sent it. */
      answered: number;
    });

export interface ArmCoverage {
  name: string;
  attempted: number;
  /** What came back, whatever named it. */
  answered: number;
  /**
   * What answered and how often, in insertion order — carried through so the
   * caller can print the tally beside the count without walking two arrays in
   * step. Empty for a harness that does not record who answered.
   */
  answers: [string, number][];
  /** The model asked for, where the harness could tell. */
  sentTo?: string;
  /** Answers naming something other than `sentTo`, `(none)` included. */
  misnamed: [string, number][];
}

export interface Coverage {
  arms: ArmCoverage[];
  /** Arms that answered nothing at all. */
  silent: string[];
  /** Arms that answered some but not all of what they were sent. */
  short: string[];
  /**
   * Arms that answered *more* than they were sent — impossible unless the
   * denominator is wrong, and named because the other direction is the one
   * nobody gets bitten by and so nobody writes down
   * (`docs/reusable/silent-success.md`, *enumerate both failure directions*).
   * A run whose `attempted` is miscomputed would otherwise pass as clean.
   */
  over: string[];
  /**
   * Arms whose numbers are not whole and positive — `NaN`, a fraction, a
   * negative. No caller can produce one today; it is here because `clean` must
   * be a statement about numbers that mean something, and `NaN` compares false
   * to everything, so it slips through every comparison above. GPT Sol's
   * review, item 3.
   */
  invalid: string[];
  /** Arms where something other than the model asked for answered. */
  misnamed: string[];
  attempted: number;
  answered: number;
  /**
   * Whether every arm could say who answered it. False for a harness that does
   * not carry `answeredBy`, so the closing line does not claim a check nobody
   * made.
   */
  namesChecked: boolean;
  /**
   * Every arm answered every call it was sent, under the name it was sent to —
   * and there was at least one arm. False over an empty run by construction.
   */
  clean: boolean;
}

export function coverageOf(attempts: readonly Attempt[]): Coverage {
  const arms: ArmCoverage[] = attempts.map((a) =>
    "answers" in a
      ? {
          name: a.name,
          attempted: a.attempted,
          answered: [...a.answers.values()].reduce((x, n) => x + n, 0),
          answers: [...a.answers],
          sentTo: a.sentTo,
          misnamed: [...a.answers].filter(([m]) => m !== a.sentTo),
        }
      : {
          name: a.name,
          attempted: a.attempted,
          answered: a.answered,
          answers: [],
          misnamed: [],
        },
  );
  const silent = arms.filter((a) => a.answered === 0).map((a) => a.name);
  const short = arms.filter((a) => a.answered > 0 && a.answered < a.attempted).map((a) => a.name);
  const over = arms.filter((a) => a.answered > a.attempted).map((a) => a.name);
  const whole = (n: number) => Number.isInteger(n) && n >= 0;
  const invalid = arms
    .filter((a) => !whole(a.attempted) || a.attempted === 0 || !whole(a.answered))
    .map((a) => a.name);
  const misnamed = arms.filter((a) => a.misnamed.length > 0).map((a) => a.name);
  return {
    arms,
    silent,
    short,
    over,
    invalid,
    misnamed,
    attempted: arms.reduce((x, a) => x + a.attempted, 0),
    answered: arms.reduce((x, a) => x + a.answered, 0),
    namesChecked: attempts.length > 0 && attempts.every((a) => "answers" in a),
    /* **Stated forwards.** Not "none of the complaints above fired" — that is
       the shape that let an empty map pass — but "every arm did the whole of
       what it was sent to do, in numbers that mean something". The lists above
       are for explaining a `false`, not for deciding it. */
    clean:
      arms.length > 0 &&
      arms.every(
        (a) =>
          whole(a.attempted) &&
          a.attempted > 0 &&
          whole(a.answered) &&
          a.answered === a.attempted &&
          a.misnamed.length === 0,
      ),
  };
}

/**
 * What goes in the results file, with both numbers named for what they are.
 *
 * `attempted` is the plan and `answered` is the outcome; neither can be read as
 * the other, which is the whole of the second bug. `lost` is derived from the
 * two rather than counted a third time, so these three cannot disagree among
 * themselves — though both scripts also write their own array of lost call
 * names beside this, and **nothing makes that agree with this**. It does under
 * every input the scripts can produce; that is a fact about them, not a
 * guarantee from here. GPT Sol's review, item 5.
 */
export function callCounts(c: Coverage): { attempted: number; answered: number; lost: number } {
  return { attempted: c.attempted, answered: c.answered, lost: c.attempted - c.answered };
}

/**
 * The closing lines, in `quiz.ts`'s voice: what was obtained over what was
 * attempted, and — when that is nothing — a sentence saying so rather than a
 * zero that reads as a pass.
 */
export function coverageLines(c: Coverage): string[] {
  if (c.arms.length === 0) {
    return ["  NO ARMS RAN AT ALL — nothing above describes a measurement."];
  }
  const lines = [`  ${c.answered} of ${c.attempted} calls came back.`];
  if (c.silent.length === c.arms.length) {
    lines.push(
      "  NOTHING WAS MEASURED. Every figure above is over an empty set, which is not",
      "  the same thing as clean — see the lost calls above.",
    );
  } else if (c.silent.length) {
    lines.push(
      `  ${c.silent.length} ARM(S) ANSWERED NOTHING AT ALL: ${c.silent.join(", ")}.`,
      "  Their rows are over an empty set and say nothing about the model they name.",
    );
  }
  if (c.short.length) {
    lines.push(
      `  thinned by lost calls, so scored over fewer: ${c.short.join(", ")}`,
    );
  }
  if (c.invalid.length) {
    lines.push(
      `  THE CALL COUNTS ARE NOT WHOLE POSITIVE NUMBERS: ${c.invalid.join(", ")} — check RUNS.`,
      "  Nothing above is over a population anybody can name.",
    );
  }
  if (c.over.length) {
    lines.push(
      `  MORE CALLS CAME BACK THAN WERE SENT: ${c.over.join(", ")} — the denominator is wrong,`,
      "  so nothing here is over the population it says it is.",
    );
  }
  if (c.misnamed.length) {
    lines.push(`  SOME ROWS ARE NOT ABOUT THE MODEL THEY NAME: ${c.misnamed.join(", ")}`);
  }
  if (c.clean) {
    lines.push(
      c.namesChecked
        ? "  — every call came back and named the model it was sent to (an upstream swap\n    serving the same model would not show here; see the comment at the check)"
        : "  — every call came back (who answered is not recorded by this harness, so\n    that is coverage and not agreement)",
    );
  }
  return lines;
}

/**
 * 1 when the run measured nothing it can be read on.
 *
 * The reasoning is `evals/quiz.ts`'s — an arm thinned by a lost call still has
 * something to read, and one that answered nothing does not — but **this is an
 * arm-level adaptation of that rule and not a copy of it.** `quiz.ts` exits 1
 * only when *every* case failed; this exits when *any* arm is silent, because
 * these two files exist to compare arms against each other, and a comparison
 * missing one of its sides is not a thin answer but an absent one. GPT Sol's
 * review, answer 2, correcting a comment that claimed the rule was copied
 * verbatim.
 *
 * `invalid` and `over` join it: both mean the denominator is wrong, so no rate
 * printed above is over the population it names. A merely thinned or misnamed
 * run still exits 0 — loudly labelled, but readable, which is what the old
 * behaviour was too.
 */
export function exitCodeFor(c: Coverage): 0 | 1 {
  return c.arms.length === 0 || c.silent.length > 0 || c.invalid.length > 0 || c.over.length > 0
    ? 1
    : 0;
}
