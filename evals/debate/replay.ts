/**
 * **Layer 1 — re-run the validation over a journalled answer, with no model and
 * no network.**
 *
 * The plan's cheapest layer:
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md
 * § *Layer 1 — replay the validation, no model at all*. Journal records →
 * `admissibleSources` → `parsePass` → `readDirectGroup` / `readClaimGroup`.
 * Deterministic, free, milliseconds — the regression test for every change to
 * the validation layer.
 *
 * **Stage A builds only as much of it as the free mode needs**: enough to prove
 * a journal on disk really is replayable, and to say which attempts are not.
 * Stage B is where it becomes an instrument, with `evals/debate/score.ts` in
 * front of it and the Layer 0 packets behind it.
 *
 * ## Every road to "we cannot replay this" is named
 *
 * A replay that quietly returned an empty group for an attempt whose bytes are
 * gone would be the shape this whole eval exists to catch: an empty group is
 * this mode's commonest *honest* answer, so nothing would look wrong. Every
 * attempt therefore comes back either replayed or with a `skipped` reason.
 *
 * ## The one thing this file adapts, and the reason it is here rather than there
 *
 * A journal is a **stored artefact**, and every journal on disk was written
 * before `valence` became `lean` on 2026-09-08. `readShared` (src/debate.ts) is
 * strict about that vocabulary on purpose — a row arriving *today* in the old
 * words is a prompt that has stopped emitting what we asked for — so replaying a
 * historical journal through it turned all 26 stored rows into `cannot-tell`,
 * silently, and every stance figure Layer 1 produced was about the rename.
 *
 * So the adapter sits **at the boundary**: `readStoredVocabulary` below, between
 * `parsePass` and the readers, exactly where production puts `readStoredLean`
 * for the panel. Live strictness is untouched, the adapted rows are counted
 * rather than quietly rewritten, and `supersededLeans` rides on the result and
 * into `replayLines` — because a replay that rewrote rows and did not say so is
 * the same silent success one level down.
 */
import {
  admissibleSources,
  type ArticleIdentity,
  type ChatAnnotation,
  parsePass,
  readClaimGroup,
  readDirectGroup,
} from "../../src/debate.js";
import type {
  DebateAttemptStarted,
  DebateJournalEvent,
  DebatePassKind,
  DebateProviderResponse,
} from "../../src/debate-journal.js";
import { whereSearchCountCameFrom, type Usage } from "../../src/openrouter-stream.js";
import type { ArticleBlockText } from "../../src/shingles.js";
import type { ClaimDebateRow, DebateGroup, DirectDebateRow } from "../../src/types.js";
import { supersededLean } from "./score.js";

/** The half of a chat completion a replay reads. Structural, so a journal from an older run still parses. */
interface JournalledAnswer {
  choices?: {
    message?: { content?: string; annotations?: ChatAnnotation[] };
  }[];
  usage?: Usage;
}

/** One attempt, re-read. */
export type ReplayedAttempt =
  | {
      ok: true;
      attemptId: string;
      pass: DebatePassKind;
      /** `admissible.size` — the foot line's *"the search returned evidence from N pages"*. */
      returnedSources: number;
      /**
       * **How many rows were read forward from the pre-2026-09-08 `valence`
       * vocabulary** before the readers saw them — see `readStoredVocabulary`.
       *
       * Carried on every replayed attempt, `0` included, so that *"nothing was
       * adapted"* is a thing this type can say rather than a thing a reader
       * infers from silence.
       */
      supersededLeans: number;
      group: DebateGroup<DirectDebateRow> | DebateGroup<ClaimDebateRow>;
    }
  | { ok: false; attemptId: string; pass: DebatePassKind | null; skipped: string };

/**
 * Replay every attempt a journal holds.
 *
 * `blockText` is the article's blocks by id — the same map `generateDebate`
 * builds with `blockTextById`. Without it an attempt is skipped rather than
 * replayed, because the replay would report facts about itself rather than about
 * the run: a **claims** pass would come back entirely `unknownBlockId`, and
 * since 2026-09-06 a **direct** pass would come back clean with no `quoted`
 * signal on any row and no copy refused — the quieter of the two failures, and
 * the reason the guard moved above the branch.
 */
export function replayJournal(
  events: readonly DebateJournalEvent[],
  opts: { blockText?: ReadonlyMap<string, ArticleBlockText> } = {},
): ReplayedAttempt[] {
  const starts = new Map<string, DebateAttemptStarted>();
  const responses = new Map<string, DebateProviderResponse>();
  const order: string[] = [];
  for (const event of events) {
    if (event.event === "attempt-started") {
      if (!starts.has(event.attemptId)) {
        starts.set(event.attemptId, event);
        order.push(event.attemptId);
      }
    } else if (event.event === "provider-response") {
      if (!responses.has(event.attemptId)) responses.set(event.attemptId, event);
    }
  }

  return order.map((attemptId) => {
    /* `order` is built from the starts, so this is always present — asserted
       rather than assumed because `noUncheckedIndexedAccess` is on and a
       silently-skipped attempt is exactly what this file refuses to produce. */
    const start = starts.get(attemptId);
    if (!start) return { ok: false, attemptId, pass: null, skipped: "no attempt-started" };
    return replayOne(start, responses.get(attemptId), opts.blockText);
  });
}

/** Rows as the readers should see them, and how many the age of the file changed. */
interface StoredRows {
  rows: unknown[];
  supersededLeans: number;
}

/**
 * **The journal/stored-artefact boundary: rows written before the rename, read
 * forward — and nothing else touched.**
 *
 * A row qualifies only if it has **no `lean` at all** and a `valence` that is
 * one of the four superseded words; `supersededLean` (score.ts) owns both
 * conditions and the mapping, and src/types.ts's `readStoredLean` is the
 * production copy of the same four-way map. Everything else is handed on
 * verbatim, which is the half that matters: a row answering `lean: "supportive"`
 * today is a prompt failure, and it must go on landing in `cannot-tell` and go
 * on being counted off-vocabulary by `vocabularyReport`. An adapter that reached
 * for `valence` whenever `lean` was merely *unrecognised* would swallow exactly
 * the failure the eval exists to find.
 */
function readStoredVocabulary(rows: readonly unknown[]): StoredRows {
  let supersededLeans = 0;
  const adapted = rows.map((row) => {
    /* Non-objects are `readGroupWith`'s to count as `malformed`; changing what
       it is handed here would move that number for no reason. */
    if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
    const lean = supersededLean(row);
    if (lean === null) return row;
    supersededLeans += 1;
    /* A copy, never a mutation: the journal's own rows are also what
       `journal-rows.ts` hands to `vocabularyReport`, which must go on seeing
       what was actually written. */
    return { ...row, lean };
  });
  return { rows: adapted, supersededLeans };
}

function replayOne(
  start: DebateAttemptStarted,
  response: DebateProviderResponse | undefined,
  blockText: ReadonlyMap<string, ArticleBlockText> | undefined,
): ReplayedAttempt {
  const skip = (why: string): ReplayedAttempt => ({
    ok: false,
    attemptId: start.attemptId,
    pass: start.pass,
    skipped: why,
  });

  if (!response) return skip("the attempt has no provider-response — it never heard back");
  if (response.response.kind === "refused") {
    return skip(`the provider refused with ${response.response.status} — there is no answer to read`);
  }
  if (response.response.json === null) {
    /* The documented gap. `openRouterJson` leaves a 2xx it could not parse as
       `json: null` and does not hand back the bytes — src/debate-journal.ts §
       the documented gap. */
    return skip("the body was not JSON and the bytes are not in the journal");
  }

  const answer = response.response.json as JournalledAnswer;
  const choice = answer.choices?.[0];
  if (!choice) return skip("the answer carried no choices");
  const { searches } = whereSearchCountCameFrom(answer.usage);
  if (searches === null) return skip("the answer carried no search count");

  const identity: ArticleIdentity = {
    url: start.article.url,
    title: start.article.title,
    byline: start.article.byline,
  };
  const admissible = admissibleSources(choice.message?.annotations, identity.url);

  let rows: unknown[];
  try {
    rows = parsePass(choice.message?.content ?? "");
  } catch {
    /* The message is deliberately not carried out of here: `parsePass`'s throw
       is authored, but the *fence* it failed on is a stranger's page and the
       article, and a replay report is a file somebody reads. */
    return skip("the answer's fence would not parse");
  }

  if (!blockText) {
    return skip("this pass needs the article's blocks, and none was supplied");
  }
  const stored = readStoredVocabulary(rows);
  if (start.pass === "direct") {
    return {
      ok: true,
      attemptId: start.attemptId,
      pass: "direct",
      returnedSources: admissible.size,
      supersededLeans: stored.supersededLeans,
      group: readDirectGroup(stored.rows, { admissible, article: identity, blockText }, searches),
    };
  }
  return {
    ok: true,
    attemptId: start.attemptId,
    pass: "claims",
    returnedSources: admissible.size,
    supersededLeans: stored.supersededLeans,
    group: readClaimGroup(stored.rows, { admissible, article: identity, blockText }, searches),
  };
}

/** One line per attempt, for a report. */
export function replayLines(replayed: readonly ReplayedAttempt[]): string[] {
  return replayed.map((r) => {
    const name = `${r.pass ?? "(unknown)"} ${r.attemptId.slice(0, 8)}`;
    if (!r.ok) return `  ${name.padEnd(24)} NOT REPLAYED — ${r.skipped}`;
    const lost = Object.entries(r.group.counts.lost)
      .filter(([, n]) => n > 0)
      .map(([reason, n]) => `${reason} ${String(n)}`)
      .join(", ");
    return (
      `  ${name.padEnd(24)} ${String(r.group.counts.keptRows).padStart(2)} kept of ` +
      `${String(r.group.counts.reportedRows).padStart(2)} reported, ` +
      `${String(r.returnedSources).padStart(2)} returned source(s), ` +
      `${String(r.group.counts.webSearches)} search(es)` +
      (lost ? `; lost: ${lost}` : "; nothing lost") +
      /* Said out loud, and only when it happened: a run of these lines with no
         such clause is a claim that every row was read exactly as written. */
      (r.supersededLeans > 0
        ? `; ${String(r.supersededLeans)} row(s) read forward from the pre-2026-09-08 valence vocabulary`
        : "")
    );
  });
}
