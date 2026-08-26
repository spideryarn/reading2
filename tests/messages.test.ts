/**
 * What the reader is told when a model call fails.
 *
 * These are the tests docs/project/copy.md's rules imply. Note what they do
 * *not* do: none of them pins a sentence. Copy should stay rewritable, so the
 * assertions are about the bracketed code, the `kind`, and one invariant that
 * connects the two — see "the sentence must agree with the kind" below, which
 * is the test that would have caught the bug this file was written after.
 */
import { describe, expect, it } from "vitest";
import {
  ANSWER_OVERFLOWED,
  canRetry,
  CODE_KINDS,
  kindOfMessage,
  worthRetrying,
  ENDED_UNFINISHED,
  MODEL_REFUSED,
  NOT_CONFIGURED,
  UNEXPECTED_FAILURE,
  type FailureKind,
  PROVIDER_FAILED_MID_ANSWER,
  PROVIDER_UNREADABLE,
  providerHttpFailure,
  type ReaderFacingFailure,
  saidNothing,
  tookTooLong,
  wentQuiet,
} from "../src/messages.js";

/** Every failure this module can produce, so the invariants below can sweep. */
const EVERY: ReaderFacingFailure[] = [
  ...[400, 401, 402, 403, 404, 408, 409, 413, 418, 422, 429, 451, 500, 502, 503, 504, 599].map(
    providerHttpFailure,
  ),
  PROVIDER_FAILED_MID_ANSWER,
  PROVIDER_UNREADABLE,
  ENDED_UNFINISHED,
  MODEL_REFUSED,
  NOT_CONFIGURED,
  ANSWER_OVERFLOWED,
  MODEL_REFUSED,
  UNEXPECTED_FAILURE,
  tookTooLong(60),
  wentQuiet(20),
  saidNothing(null),
  saidNothing("content_filter"),
  saidNothing("length"),
];

const codeOf = (m: string) => m.match(/\[([a-z0-9-]+)\]$/)?.[1];

describe("the shape every message keeps", () => {
  it("ends with a bracketed code, so a reader can quote it instead of the sentence", () => {
    for (const f of EVERY) expect(codeOf(f.message), f.message).toBeTruthy();
  });

  it("gives each distinct message its own code", () => {
    /* A code names a *branch*, not a status: 500, 502 and 503 share
       `[ai-upstream]` on purpose, because there is one thing to say about all
       three. What must not happen is two different sentences answering to the
       same code, which makes it useless for the one job it has — telling
       whoever is helping which branch fired. */
    const byCode = new Map<string, string>();
    for (const f of EVERY) {
      const code = codeOf(f.message) as string;
      const seen = byCode.get(code);
      if (seen) expect(f.message, `two messages share [${code}]`).toBe(seen);
      else byCode.set(code, f.message);
    }
  });

  it("never repeats the raw status number as the explanation", () => {
    /* The status may appear in the *code* (`[ai-418]`) — that is a reference.
       It may not be the sentence's account of what happened. */
    for (const f of EVERY) {
      const sentence = f.message.replace(/\s*\[[a-z0-9-]+\]$/, "");
      expect(sentence, sentence).not.toMatch(/\b[45]\d\d\b/);
    }
  });
});

describe("the kind survives being stored as a bare sentence", () => {
  /* src/messages.ts § kindOfMessage: the interface only ever gets the string,
     so the code in it has to carry the kind. This is the test that makes that
     safe rather than merely clever — a code that stops agreeing with its own
     message fails here instead of showing a Retry button that cannot work. */
  it("reads every message back to the kind it was declared with", () => {
    for (const f of EVERY) expect(kindOfMessage(f.message), f.message).toBe(f.kind);
  });

  it("says nothing about a message it did not write", () => {
    /* Which callers must read as "offer the retry" — see the docstring. */
    expect(kindOfMessage("The server is not running.")).toBeNull();
    expect(kindOfMessage("Something [not-a-code] went wrong")).toBeNull();
    expect(kindOfMessage("")).toBeNull();
  });

  it("keeps its answer for a status it has no branch for", () => {
    expect(kindOfMessage(providerHttpFailure(451).message)).toBe("blocked");
    expect(kindOfMessage(providerHttpFailure(599).message)).toBe("retry");
  });
});

describe("the code table and the messages are one fact, not two", () => {
  /* `CODE_KINDS` and `EVERY` were both maintained by discipline: a new failure
     that skipped `EVERY` skipped every invariant in this file, and a new code
     that skipped the table fell quietly through to the status heuristic or to
     null. Neither omission had a symptom. So the two lists check each other. */
  it("has a table entry for every fixed code the messages carry", () => {
    const fromMessages = new Set(
      EVERY.map((f) => codeOf(f.message) as string)
        // The `[ai-409]` family is minted from a status and belongs to the
        // heuristic in `kindOfMessage`, not to the table.
        .filter((c) => !/^ai-\d{3}$/.test(c)),
    );
    expect([...fromMessages].sort()).toEqual(Object.keys(CODE_KINDS).sort());
  });
});

describe("whether the interface offers another go", () => {
  it("offers one exactly when the message says one could work", () => {
    for (const f of EVERY) expect(worthRetrying(f.message), f.message).toBe(canRetry(f.kind));
  });

  it("offers one for anything it does not recognise", () => {
    /* The safe direction. A withheld retry costs the reader the feature; an
       offered one that fails costs a click. */
    for (const m of ["The server is not running.", "", null, undefined, "no code here"]) {
      expect(worthRetrying(m), String(m)).toBe(true);
    }
  });

  it("withholds one for the three failures a reader cannot retry past", () => {
    for (const m of [
      providerHttpFailure(402).message, // out of credit
      providerHttpFailure(403).message, // refused
      providerHttpFailure(413).message, // too big
    ]) {
      expect(worthRetrying(m), m).toBe(false);
    }
  });
});

describe("the sentence must agree with the kind", () => {
  /* The bug this catches: `kind` says "do not retry" and the prose says "try
     again", or the reverse. Either way the reader is told two things and the
     interface acts on the one they cannot see. */
  it("always gives a retryable failure something to do", () => {
    /* Required, not conditional. The first version of this asked "if the message
       invites another go, is it retryable?" — and matched a hand-written list of
       phrases, so rewording a message quietly dropped it out of the check and
       the test went on passing. A test that stops testing and stays green is the
       silent-success shape this repo has a whole document about.

       So: state the requirement, and let a message that meets it in some new
       wording widen the pattern deliberately rather than fall out of it. */
    for (const f of EVERY) {
      if (!canRetry(f.kind)) continue;
      expect(f.message, `nothing for the reader to do: ${f.message}`).toMatch(
        /again|narrower|shorter/i,
      );
    }
  });

  it("never invites another go when another go cannot work", () => {
    /* The direction the sibling tests did not cover, and it let one straight
       through: `UNEXPECTED_FAILURE` shipped as kind `bug` — so no retry button —
       while its own sentence said "trying again is worth a go". The reader is
       then told two things and can act on neither. Exactly the contradiction
       this whole file exists to prevent, written by the person fixing it. */
    for (const f of EVERY) {
      if (canRetry(f.kind)) continue;
      expect(f.message, f.message).not.toMatch(
        /trying again is worth a go|trying again often works|asking again (usually|generally) (works|gets)/i,
      );
    }
  });

  it("says so out loud when retrying cannot work", () => {
    for (const f of EVERY) {
      if (canRetry(f.kind)) continue;
      /* Deliberately broad. A narrow list of exact phrases is what let a
         reworded message drop silently out of the sibling test above — see its
         comment. "the same" catches every honest way of saying "this will come
         back identical"; "needs fixing"/"needs somebody" catch the two that are
         about setup rather than repetition. */
      expect(f.message, f.message).toMatch(/will not help|the same|needs fixing|needs somebody/i);
    }
  });
});

describe("the status mapping", () => {
  const kind = (status: number): FailureKind => providerHttpFailure(status).kind;

  it("treats busy, slow and broken-upstream as worth retrying", () => {
    for (const s of [429, 408, 504, 500, 502, 503]) expect(kind(s), `${s}`).toBe("retry");
  });

  it("blames this app's account for no-credit, bad-key and missing-model", () => {
    for (const s of [402, 401, 404]) expect(kind(s), `${s}`).toBe("ours");
  });

  it("calls a malformed request what it is — a bug here", () => {
    for (const s of [400, 422]) expect(kind(s), `${s}`).toBe("bug");
  });

  it("does not report 403 as a broken key", () => {
    /* OpenRouter uses 403 for guardrails, spend limits and model allowlists as
       well as for auth. Reported as [ai-key] it sent somebody to check a key
       that was fine, and claimed every AI feature was down when one call had
       been refused. */
    expect(kind(403)).toBe("blocked");
    expect(providerHttpFailure(403).message).not.toMatch(/key/i);
  });

  it("does not tell the reader to resend something that was too big", () => {
    expect(kind(413)).toBe("blocked");
  });

  it("does not promise a retry for a refusal it does not recognise", () => {
    for (const s of [409, 418, 451]) expect(kind(s), `${s}`).toBe("blocked");
  });
});

describe("saying nothing", () => {
  it("does not invent a reason for the safety filter", () => {
    const filtered = saidNothing("content_filter");
    expect(filtered.kind).toBe("blocked");
    /* It used to explain the refusal as misread quoted material. We do not know
       that, cannot check it, and a reader might repeat it. */
    expect(filtered.message).not.toMatch(/quoted|out of context|harmful/i);
  });

  it("keeps a plain empty answer retryable", () => {
    expect(saidNothing(null).kind).toBe("retry");
  });
});
