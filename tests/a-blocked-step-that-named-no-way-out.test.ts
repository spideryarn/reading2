/**
 * **A step told the reader "no" and did not say what to do instead.**
 *
 * `readerFailureOf` (src/job-failure.ts) has exactly two branches: the throw
 * site declared a sentence for the reader, or it did not and gets
 * `stepGaveUp(kind, step)`. When that fallback lands on **`blocked`** the step
 * has promised a way out — that is what `blocked` *means*, the one non-retryable
 * kind that admits one (src/messages.ts) — and named none. The reader sees
 * *"… could not be done for this article as it stands"*, no button, and nothing
 * to act on.
 *
 * It is a copy defect **no type can see**, because the throw may be a bare
 * `new Error(...)`, and TypeScript has no checked exceptions. So the instrument
 * is a log line, and it is recommendation 2 of
 * docs/postmortems/260904b-a-sentence-written-for-the-reader-was-thrown-away-at-the-seam.md
 * — *"first among the things not done"*, unbuilt when three consecutive
 * codebase sweeps looked for it (260905b § T2.1 d, 260906h § T3.2).
 *
 * **Log the ordinary case, not the exception — the miss, not the throw.**
 *
 * ## Why the decision is a function and not an expression at the call site
 *
 * `undeclaredBlocked` and `readerFailureOf` are both built on
 * `declaredFailure`, so the log line and the reader's sentence cannot come to
 * different conclusions about the same error. Writing the condition inline in
 * src/jobs.ts would have been two pieces of code answering one question, which
 * is the class docs/postmortems/260827d-toc-status-never-checked.md is about
 * and which this same job removes elsewhere.
 *
 * ## Volume, measured before this was built
 *
 * `readerFailureOf` has one production caller (src/jobs.ts § `runStep`), reached
 * once per **failed step**, so the ceiling is one line per failed step. On
 * 2026-09-07 there were **zero** `stageFailure("blocked", { generic })` sites in
 * `src/` — the eight generic sites are `ours` and the ninth is `bug` — so this
 * is a tripwire rather than a stream. It fires the day somebody reintroduces
 * the class, which is the whole point of it.
 *
 * ## What the line may carry, and what it may not
 *
 * The step **label** and the failure kind, both of them ours and both already
 * in the log on the neighbouring lines. Never the error's own message: a
 * step's diagnostic is free text and is exactly where a provider body or a
 * stretch of the article turns up (src/job-failure.ts § the detail goes on
 * verbatim; docs/project/logging.md). Pinned below.
 */
import { describe, expect, it } from "vitest";
import {
  declaredFailure,
  readerFailureOf,
  stageFailure,
  undeclaredBlocked,
} from "../src/job-failure.js";
import { noteUndeclaredBlocked } from "../src/jobs.js";
import { INTERRUPTED, MODEL_REFUSED, STEP_STOPPED, stepGaveUp } from "../src/messages.js";
import type { Log } from "../src/log.js";

const STEP = "Extracting the article";

/** A step that refused, and said what to do about it. */
const DECLARED_BLOCKED = stageFailure(
  { kind: "blocked", message: "This PDF has 142 pages and the limit is 100. [jb-pdf-pages]" },
  { authored: "142 pages, limit 100" },
);

/**
 * A step that refused and said nothing to the reader — the failure this file is
 * about. `{ generic }` is the spelling that means *this string is a note for the
 * log*, so nothing here is addressed to anybody reading a card.
 */
const UNDECLARED_BLOCKED = stageFailure("blocked", { generic: "checkTree rejected the tree" });

/** The same absence, at a kind whose generic sentence is the right answer. */
const UNDECLARED_OURS = stageFailure("ours", { generic: "no OPENROUTER_API_KEY" });

/** Nobody said anything at all — `failureKindOf` finds nothing and offers the retry. */
const BARE = new Error("ECONNRESET");

describe("declaredFailure — did the throw site write the reader a sentence", () => {
  it("hands back the declared sentence, and null when there is none", () => {
    expect(declaredFailure(DECLARED_BLOCKED)?.kind).toBe("blocked");
    expect(declaredFailure(DECLARED_BLOCKED)?.message).toContain("142 pages");
    expect(declaredFailure(UNDECLARED_BLOCKED)).toBeNull();
    expect(declaredFailure(UNDECLARED_OURS)).toBeNull();
    expect(declaredFailure(BARE)).toBeNull();
    /* Not an Error at all — the seam reads `readerFailure` off a thrown value,
       and anything can be thrown. */
    expect(declaredFailure(null)).toBeNull();
    expect(declaredFailure("a string")).toBeNull();
  });

  /**
   * **The equivalence that keeps the log line honest.** `readerFailureOf` is
   * defined in terms of `declaredFailure`, and this asserts the behaviour that
   * refactor had to preserve: the declared sentence is returned unchanged, and
   * its absence still falls through to the generic one for the kind.
   */
  it("still decides readerFailureOf, unchanged", () => {
    expect(readerFailureOf(DECLARED_BLOCKED, STEP).message).toContain("142 pages");
    expect(readerFailureOf(UNDECLARED_BLOCKED, STEP)).toEqual(stepGaveUp("blocked", STEP));
    expect(readerFailureOf(UNDECLARED_OURS, STEP)).toEqual(stepGaveUp("ours", STEP));
    expect(readerFailureOf(BARE, STEP)).toEqual(stepGaveUp("retry", STEP));
    /* A declared sentence wins over the field, which is the seam's whole rule. */
    expect(readerFailureOf(stageFailure(MODEL_REFUSED), STEP)).toEqual(MODEL_REFUSED);
  });
});

describe("undeclaredBlocked — the one combination worth a log line", () => {
  it("is true only for a blocked failure that named no way out", () => {
    expect(undeclaredBlocked(UNDECLARED_BLOCKED, readerFailureOf(UNDECLARED_BLOCKED, STEP))).toBe(true);

    /* The three that must NOT fire, and each is a different reason not to.
       Without them this predicate could be `true` and still pass. */
    expect(undeclaredBlocked(DECLARED_BLOCKED, readerFailureOf(DECLARED_BLOCKED, STEP))).toBe(false);
    expect(undeclaredBlocked(UNDECLARED_OURS, readerFailureOf(UNDECLARED_OURS, STEP))).toBe(false);
    expect(undeclaredBlocked(BARE, readerFailureOf(BARE, STEP))).toBe(false);
  });
});

/** A `Log` that keeps what it was told, so an assertion can read it back. */
function recordingLog(): Log & { lines: { level: string; obj: object; msg: string }[] } {
  const lines: { level: string; obj: object; msg: string }[] = [];
  const at =
    (level: string) =>
    (a: object | string, b?: string): void => {
      lines.push(
        typeof a === "string" ? { level, obj: {}, msg: a } : { level, obj: a, msg: b ?? "" },
      );
    };
  const l = {
    lines,
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: () => l,
  };
  return l as unknown as Log & { lines: typeof lines };
}

describe("the log line src/jobs.ts writes", () => {
  it("warns once, naming the step, when a blocked step gave no sentence", () => {
    const l = recordingLog();
    noteUndeclaredBlocked(l, UNDECLARED_BLOCKED, readerFailureOf(UNDECLARED_BLOCKED, STEP), STEP);

    /* The positive control for everything below: a fake that recorded nothing
       would satisfy every `not.toContain` in this file. */
    expect(l.lines, "nothing was logged at all").toHaveLength(1);
    const [line] = l.lines;
    expect(line?.level).toBe("warn");
    expect(line?.obj).toMatchObject({ step: STEP, kind: "blocked" });
  });

  /**
   * **Never the error's own text.** `msg` is the one field
   * [`redact`](../src/log.ts) cannot reach, and a step's diagnostic is free
   * text — which is where a provider body or a stretch of the article arrives.
   * So the sentinel in the diagnostic must not come out either side.
   */
  it("carries neither the diagnostic nor anything off the error", () => {
    const l = recordingLog();
    const err = stageFailure("blocked", { generic: "ARTICLE_SENTINEL: the reader's own prose" });
    noteUndeclaredBlocked(l, err, readerFailureOf(err, STEP), STEP);

    const [line] = l.lines;
    expect(line?.msg).not.toContain("ARTICLE_SENTINEL");
    expect(JSON.stringify(line?.obj)).not.toContain("ARTICLE_SENTINEL");
  });

  /**
   * **A cancel cannot warn, and not because of the guard in front of it.**
   *
   * `src/jobs.ts` calls this under `if (!stopped)`. GPT Sol pointed out that a
   * unit test cannot prove that guard, since cancellation is decided inside the
   * private `runStep` — so what is pinned instead is that the guard is **belt
   * and braces**: when a step is stopped, `reader` is `INTERRUPTED` or
   * `STEP_STOPPED`, both of which are `retry`, so `undeclaredBlocked` is false
   * on the kind alone even for a `blocked` error that was in flight when Stop
   * landed.
   *
   * That race is not hypothetical. A refusal racing a Stop is exactly what left
   * *"asking again will be refused"* on a job about to be marked retryable, in
   * the seam's first six hours (src/messages.ts § `STEP_STOPPED`).
   */
  it("cannot warn for a stopped step, whatever was in flight", () => {
    for (const stopping of [STEP_STOPPED, INTERRUPTED]) {
      const l = recordingLog();
      noteUndeclaredBlocked(l, UNDECLARED_BLOCKED, stopping, STEP);
      expect(l.lines, `warned under ${stopping.message.slice(0, 20)}`).toHaveLength(0);
    }
  });

  it("says nothing for a declared blocked, an undeclared ours, or a bare throw", () => {
    for (const err of [DECLARED_BLOCKED, UNDECLARED_OURS, BARE]) {
      const l = recordingLog();
      noteUndeclaredBlocked(l, err, readerFailureOf(err, STEP), STEP);
      expect(l.lines, `logged for ${(err as Error).message}`).toHaveLength(0);
    }
  });
});
