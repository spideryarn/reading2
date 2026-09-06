/**
 * **The capture journal for Debate mode: two events per attempted pass, appended
 * as they happen, and never one record written afterwards.**
 *
 * Stage A of
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md
 * § *Capture, as a two-event journal*. It exists because $0.6252 of live runs
 * bought no replayable evidence: only *kept* rows reach `debate.json`, so every
 * refused row, every raw annotation and every extract the model was actually
 * reading was gone the moment the step finished.
 *
 * ## Why two events and not one
 *
 * GPT Sol refused the single-record design twice.
 *
 * - **F40** — a record written after the provider answered sits *downstream* of
 *   the failures it was supposed to preserve. `runPass` throws on an unreadable
 *   answer, a bad `finish_reason`, a zero search count and a broken fence, so
 *   the paid failure that motivated capture would have been captured as nothing.
 * - **F52** — one immutable record written after the answer cannot represent an
 *   abort *before* any answer, cannot survive process death, and cannot also
 *   carry a classification that is only decided later.
 *
 * So: `attempt-started` goes down **before dispatch**, `provider-response` goes
 * down **at the gateway boundary before any debate validation**, and a terminal
 * `attempt-finished` goes down in a `finally`.
 *
 * ## The two rules that are the whole point
 *
 * 1. **An abort with no response gets metadata and an abort outcome and no
 *    invented response fields.** There is no "empty response" arm in
 *    `DebateProviderResponse` for that reason: an attempt that never heard back
 *    simply has no `provider-response` line.
 * 2. **An unmatched `attempt-started` means the process died, or the outcome is
 *    unknown.** `reconcile` below is the only thing allowed to say what a
 *    journal contains, and it has no path that calls such an attempt captured.
 *    On 2026-09-05 an OOM kill between the two passes billed pass A and wrote
 *    nothing at all; that is the case this rule exists for.
 *
 * ## The documented gap: a 2xx body that will not parse
 *
 * `openRouterJson` (src/ai-call.ts) returns `json: null` for a 2xx whose body is
 * not JSON, and **does not hand back the bytes** — deliberately, and the comment
 * there says why: V8 puts a prefix of the offending input into the `SyntaxError`,
 * and on this wire that input is an article, a reader's question, or a
 * stranger's web page. So this case is journalled as a `body` response whose
 * `json` is `null`, with a `body-not-json` failure class, **and the bytes are
 * not available to replay**.
 *
 * We did not change the gateway to return them. `src/ai-call.ts` is the one
 * place money is spent — one key, one `Meter`, one `finally` — and the whole
 * reason it holds together is that no caller gets a hook into it. Widening its
 * return type so an eval could see raw provider bytes would put a stranger's
 * page and the reader's article on a path a log line can reach, which is the
 * exact boundary that file is built to hold.
 *
 * **The same gap, one level up, for a non-2xx.** `ProviderRefused` takes the
 * body in its constructor and keeps only the status, a recognised `kind` and a
 * parsed `Retry-After` — the words never leave `ai-call.ts`. So a refusal is
 * journalled by status and classification and not by body, for the same reason
 * and by the same deliberate design.
 *
 * ## What is *not* here
 *
 * No IO. The sink is an interface, production passes none, and nothing about
 * what is stored on the article changes — a reader's artefact is not a debugging
 * record. The file-backed sink lives in `evals/debate/journal-file.ts`, where
 * the output path is gitignored, because a journal carries article prose and
 * whole page extracts.
 */
import { createHash } from "node:crypto";

/** Which of the two passes an attempt is. */
export type DebatePassKind = "direct" | "claims";

/**
 * **Why an attempt did not end `ok`**, named at the throw site rather than
 * recovered from an error message afterwards.
 *
 * A classification read back out of a `stageFailure`'s prose would go quietly
 * wrong the day somebody rewords a sentence, and the reader-facing sentences
 * here are deliberately vague about what the provider did — `PROVIDER_UNREADABLE`
 * covers five different things. So `runPass` says which one as it throws.
 */
export type DebateFailureClass =
  /** A non-2xx. `ProviderRefused`; the body is not available — see the header. */
  | "provider-refused"
  /** A 2xx whose body was not JSON. The bytes are not available — see the header. */
  | "body-not-json"
  /** JSON, but no `choices[0]`. */
  | "no-choices"
  /** `finish_reason: "length"` — the answer hit the fixed ask. */
  | "answer-overflowed"
  /** `finish_reason: "content_filter"`. */
  | "content-filtered"
  /** Any other `finish_reason` that is not `"stop"`, including a missing one. */
  | "unclean-finish"
  /** Zero searches, or no search count in the usage at all. */
  | "search-did-not-run"
  /** No closed fence, unparseable fenced text, or a fence that is not a list. */
  | "answer-not-parseable"
  /** Something else threw. The journal says so rather than guessing. */
  | "other";

/** Written before the request goes out. Nothing here depends on the answer. */
export interface DebateAttemptStarted {
  event: "attempt-started";
  attemptId: string;
  /** ISO 8601, when the line was written — which is before dispatch. */
  at: string;
  pass: DebatePassKind;
  /** The model id **as sent**. Which model answered is on the response line. */
  model: string;
  /** The search tool's configuration, exactly as it goes on the wire. */
  search: {
    engine: string;
    maxTotalResults: number;
    maxResults: number;
  };
  /**
   * **Hashes of the exact prompt strings, never the strings.**
   *
   * A journal that carried the prompts would carry the article, and this file
   * gets read by an eval report. The hash is enough for what it is for: telling
   * a run made under today's prompts from a run made under yesterday's, and
   * pinning that two arms really did send the same bytes.
   */
  prompt: {
    systemSha256: string;
    systemChars: number;
    userSha256: string;
    userChars: number;
  };
  /**
   * Who the article is, and the fingerprint production itself computes.
   *
   * `inputFingerprint` rather than a hash of two files, because pass A searches
   * for the article's **URL** and every returned citation is compared against it
   * — so metadata can drift while a blocks-and-tree gate stays green (F41).
   */
  article: {
    slug: string;
    url: string | null;
    title: string | null;
    byline: string | null;
    inputFingerprint: string;
  };
}

/**
 * **What came back, before the debate layer judged any of it** — before the
 * `finish_reason` allowlist, before the search-count check, before
 * `collectSearchEvidence` and before the self-source filter.
 *
 * Two arms and no third. There is no "nothing came back" arm on purpose: an
 * attempt that never heard from the provider writes no line of this kind at all,
 * which is how rule 1 in the header is kept by construction rather than by
 * remembering to write `null` everywhere.
 */
export interface DebateProviderResponse {
  event: "provider-response";
  attemptId: string;
  at: string;
  response: DebateResponseBody | DebateResponseRefused;
}

/**
 * A 2xx. `json` is `JsonCall.json` **verbatim** — the raw assistant text, the
 * raw annotations with their extracts, the raw usage and the raw finish reason.
 * That is what makes Layer 1 replay possible with no network.
 *
 * `json: null` is the documented gap: a 2xx whose body would not parse. The
 * bytes are not recoverable from here.
 */
export interface DebateResponseBody {
  kind: "body";
  json: unknown;
  answeredBy: string | null;
  generationId: string | null;
}

/**
 * A non-2xx, as much of it as `ProviderRefused` carries.
 *
 * `body` is deliberately absent rather than `null`-and-hopeful: see the header.
 * `bodyUnavailable` is a sentence rather than a flag so that a report cannot
 * print "no body" and leave a reader thinking the response was empty.
 */
export interface DebateResponseRefused {
  kind: "refused";
  status: number;
  /** `ProviderRefused.kind` — `"no-endpoints"` or `null`. */
  refusalKind: "no-endpoints" | null;
  /** `Retry-After`, parsed to milliseconds, or `null`. */
  retryAfterMs: number | null;
  bodyUnavailable: string;
}

/** The terminal line, written in a `finally` on every path. */
export interface DebateAttemptFinished {
  event: "attempt-finished";
  attemptId: string;
  at: string;
  /** Wall clock from just before dispatch to the `finally`. */
  elapsedMs: number;
  outcome: "ok" | "aborted" | "error";
  /** `null` when the outcome is `ok` or `aborted`. */
  failure: DebateFailureClass | null;
}

export type DebateJournalEvent =
  | DebateAttemptStarted
  | DebateProviderResponse
  | DebateAttemptFinished;

/**
 * Where the events go.
 *
 * **`write` must not throw.** It is called from a `finally` in `runPass`, and an
 * exception raised there replaces the failure the pass was already reporting —
 * so a broken journal would hide the very failure it exists to record. An
 * implementation counts its own IO failures instead, and its runner refuses a
 * run that has any. `evals/debate/journal-file.ts` is the one implementation.
 */
export interface DebateJournal {
  write(event: DebateJournalEvent): Promise<void>;
}

/** Hex sha256 of a string, for the two prompt hashes. */
export function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * Was this throw the caller's own abort?
 *
 * The same two questions `abortedBy` asks in src/ai-call.ts, which is private to
 * that file and stays that way — this is a stage deciding what to write in its
 * own journal, not a second opinion about what the gateway bills. A signal that
 * is merely aborted is not enough: an unrelated failure that happens to land
 * after a deadline fired would otherwise be filed as a cancellation.
 */
export function wasAborted(err: unknown, signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  return err === signal.reason || (err as Error | undefined)?.name === "AbortError";
}

/** One attempt, as the journal has it. */
export interface AttemptReconciliation {
  attemptId: string;
  /** `null` only for an orphan — an event whose `attempt-started` is not here. */
  pass: DebatePassKind | null;
  /** What kind of response line the attempt has, if any. */
  response: "body" | "refused" | null;
  outcome: "ok" | "aborted" | "error" | null;
  failure: DebateFailureClass | null;
  /**
   * **The only three states, and only one of them is captured.**
   *
   * - `captured` — a start and a terminal outcome. Say what happened.
   * - `unmatched-start` — a start and no terminal outcome. **The process died,
   *   or the outcome is unknown.** Never report this as captured, and never
   *   quietly count it as a failure either: an OOM kill between the two passes
   *   billed pass A and wrote nothing, and the money was real.
   * - `orphan-event` — a response or a terminal with no start. A truncated or
   *   concatenated file.
   */
  status: "captured" | "unmatched-start" | "orphan-event";
}

/** What a whole journal contains, and what it cannot vouch for. */
export interface JournalReconciliation {
  /** In first-seen order, so a report reads in the order the passes ran. */
  attempts: AttemptReconciliation[];
  captured: number;
  unmatchedStarts: number;
  orphanEvents: number;
  /**
   * True only when every attempt has both a start and a terminal outcome.
   *
   * A caller that wants to say "this run is a complete record" must ask this and
   * nothing else — counting `attempts.length` would call an OOM-killed run
   * complete.
   */
  complete: boolean;
}

/**
 * **Reconcile a journal against itself**, and refuse to flatter it.
 *
 * Pure, so `tests/debate-journal.test.ts` can drive every shape including the
 * ones a live run is not going to produce on demand. Duplicate events for one
 * attempt id are folded rather than rejected — a journal is append-only and a
 * second line about the same attempt is information, not corruption — but the
 * *first* start and the *first* terminal are what count, since a replayed or
 * concatenated file must not be able to promote an unmatched start to captured.
 */
export function reconcile(events: readonly DebateJournalEvent[]): JournalReconciliation {
  interface Row {
    attemptId: string;
    pass: DebatePassKind | null;
    started: boolean;
    response: "body" | "refused" | null;
    outcome: "ok" | "aborted" | "error" | null;
    failure: DebateFailureClass | null;
  }
  const rows = new Map<string, Row>();
  const row = (attemptId: string): Row => {
    const found = rows.get(attemptId);
    if (found) return found;
    const made: Row = {
      attemptId,
      pass: null,
      started: false,
      response: null,
      outcome: null,
      failure: null,
    };
    rows.set(attemptId, made);
    return made;
  };

  for (const event of events) {
    const r = row(event.attemptId);
    switch (event.event) {
      case "attempt-started":
        /* First start wins: a file with the same attempt twice is a file that
           was concatenated, and the earliest line is the one whose metadata
           belongs to the money that was spent. */
        if (!r.started) {
          r.started = true;
          r.pass = event.pass;
        }
        break;
      case "provider-response":
        r.response ??= event.response.kind;
        break;
      case "attempt-finished":
        if (r.outcome === null) {
          r.outcome = event.outcome;
          r.failure = event.failure;
        }
        break;
    }
  }

  const attempts: AttemptReconciliation[] = [...rows.values()].map((r) => ({
    attemptId: r.attemptId,
    pass: r.pass,
    response: r.response,
    outcome: r.outcome,
    failure: r.failure,
    status: !r.started ? "orphan-event" : r.outcome === null ? "unmatched-start" : "captured",
  }));

  const captured = attempts.filter((a) => a.status === "captured").length;
  const unmatchedStarts = attempts.filter((a) => a.status === "unmatched-start").length;
  const orphanEvents = attempts.filter((a) => a.status === "orphan-event").length;
  return {
    attempts,
    captured,
    unmatchedStarts,
    orphanEvents,
    complete: unmatchedStarts === 0 && orphanEvents === 0 && attempts.length > 0,
  };
}

/**
 * One line per attempt, for a report — and the wording is the point.
 *
 * An unmatched start says so in words a reader cannot misread as a failure that
 * was recorded. Kept here beside `reconcile` so that the sentence and the rule
 * it describes cannot drift apart.
 */
export function reconciliationLines(r: JournalReconciliation): string[] {
  const lines = r.attempts.map((a) => {
    const name = `${a.pass ?? "(unknown pass)"} ${a.attemptId.slice(0, 8)}`.padEnd(24);
    if (a.status === "unmatched-start") {
      return `  ${name} NO OUTCOME — the process died or the outcome is unknown; this attempt is not captured, and it may have been billed`;
    }
    if (a.status === "orphan-event") {
      return `  ${name} ORPHAN — events with no attempt-started; this file is truncated or concatenated`;
    }
    return `  ${name} ${String(a.outcome)}${a.failure ? ` (${a.failure})` : ""}, response: ${a.response ?? "none"}`;
  });
  lines.push(
    `  ${r.captured} captured, ${r.unmatchedStarts} unmatched start(s), ${r.orphanEvents} orphan(s)` +
      (r.complete ? "" : " — this journal is NOT a complete record"),
  );
  return lines;
}
