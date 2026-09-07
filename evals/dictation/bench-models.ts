/**
 * **Which model should transcribe a reader's voice?**
 *
 *   npm run eval:dictation-models                    # 3 runs
 *   RUNS=5 npm run eval:dictation-models
 *
 * The sibling of [`bench-vocabulary-sources.ts`](bench-vocabulary-sources.ts),
 * which holds the model fixed and varies the vocabulary. This one holds the
 * vocabulary fixed — the shipped composition, `vocabularyTermsFor` — and varies
 * the model, because that is the question that has never actually been asked.
 *
 * **The `$0.1283 on 2026-09-03` that used to be on the line above is gone with
 * the chat endpoint.** `/v1/audio/transcriptions` reports `usage.cost: 0` on
 * every call — measured at 3 seconds and at 22 on 2026-09-07 — so a run's spend
 * is not something this file can be told. It comes from the account:
 * `npm run cost -- --reconcile`.
 *
 * ## The question the first bake-off could not answer, and the one it answered wrong
 *
 * [260827x](../../docs/plans/260827x-dictation-two-pass.md) picked
 * `gemini-3.1-flash-lite` and its table was the reason it stayed the default for
 * ten days. But that table compared **Gemini models with a vocabulary against
 * everybody else's without one** — the nineteen dedicated transcribers were held
 * to have nowhere to put a term list, which is the finding that chose the route.
 * So it settled *route*, and it never settled *model*: no non-Google model was
 * ever scored on this app's own request. `openai/gpt-transcribe` bare (3.6% WER)
 * matched Gemini bare (3.6–7.3%), and nothing followed that up.
 *
 * **The finding that chose the route was wrong**, and it said so itself: it
 * ruled the transcribers out on `prompt`, while noting that nothing had tried a
 * provider's own biasing parameter. `openai/gpt-transcribe` takes a `keywords`
 * array, and dictation moved onto `POST /v1/audio/transcriptions` on 2026-09-07
 * (docs/plans/260907c-dictation-onto-an-openai-transcriber.md). So the arms
 * below are transcribers now, and every Gemini row in the git history of this
 * file was a measurement of a door the app has stopped using.
 *
 * Run [`gate-models.ts`](gate-models.ts) first. It is the cheap half of this
 * one: a candidate that cannot be routed is not a candidate, and finding that
 * out here costs an hour of rows marked "lost" instead of a minute.
 *
 * ## Every arm sends the app's own request
 *
 * Through `transcribeWith`, with `model` as an option — so the endpoint, the
 * `keywords` block, the refusal handling and `tidy()` are the shipped ones. The
 * option exists for this file and the comment on it in
 * [`src/transcribe.ts`](../../src/transcribe.js) says why: the other benchmark's
 * `MODEL` was a label, not a parameter, so a results file could name one model
 * and have measured another.
 *
 * ## What is here that the other benchmark does not have
 *
 * - **`answeredBy` is counted, not asserted.** OpenRouter may serve a request
 *   from somewhere other than the model it was addressed to, and an arm scored
 *   while a fallback answered is an arm nobody measured. Every answer is tallied by the name it
 *   gave, `(none)` included — the first version checked `if (got.answeredBy &&
 *   …)`, so a response naming no model at all passed the test and the run still
 *   announced a clean bill of health.
 * - **A split by whether the clip had its vocabulary**, which turned out to
 *   decide the whole question. See the comment on `UNSUPPLIED` below.
 * - **Latency at p90, not only the median.** The median is the run that felt
 *   fine; p90 is the one a reader remembers, and the first plan's own numbers
 *   swung 2.4s to 8.8s on the same clip two hours apart. A single median from
 *   this file should be read as an order of magnitude, and the spread as the
 *   real finding.
 * - **A `none` arm per model**, which separates a better ear from a better ear
 *   for hints. It is diagnostic rather than decisive: the vocabulary is not
 *   optional, so the arm that decides anything is the one with it.
 * - **The incumbent, twice.** Byte for byte the same arm, so the gap between
 *   those two rows is one observation of what this measurement cannot tell
 *   apart. One replicate pair is a sample of the noise, not a bound on it —
 *   but a difference smaller than that gap is not a difference.
 *
 * ## And what it still cannot tell you
 *
 * The same limit the other benchmark has, and it bears repeating because this
 * file's whole subject is *capability*: **the clips are `say` output.** A
 * synthetic voice is the easiest input an ASR model will ever get. Nothing here
 * speaks to accents, a room, a real microphone, or a one-word dictation into a
 * laptop fan. What it measures well is whether a model takes a term list and
 * spells this app's own words — which is the axis the feature was built on, and
 * not the only one that matters. See [`README.md`](README.md).
 */
import fs from "node:fs";
import { loadEnvLocal } from "../../src/env.js";
import { transcribeWith } from "../../src/transcribe.js";
/* **The terms, not the joined line.** `transcribeWith` takes the list, because
   `keywords` is an array and joining only to split again would turn a term
   containing a comma into two. `vocabularyFor` — which this file used to call —
   is this function with a `.join(", ")` on the end; where a line is still wanted
   it is derived below, so there is one vocabulary here rather than two. */
import { vocabularyTermsFor } from "../../src/vocabulary-sources.js";
/* **What came back, against what was sent**, shared with the other benchmark
   so neither can report a clean run over an arm that answered nothing. */
import { callCounts, coverageLines, coverageOf, exitCodeFor } from "./coverage.js";
import { checkInventedDetectorWorks, edits, has, invented } from "./score.js";

loadEnvLocal();
if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

const DIR = new URL(".", import.meta.url).pathname;
const RUNS = Number(process.env.RUNS ?? 3);
/* **The denominator, so it is checked where it is read.** `for (run = 0; run <
   RUNS; run++)` runs `ceil(RUNS)` times, so `RUNS=1.5` would make two calls per
   clip and record one and a half as attempted — every rate below then over a
   population that never existed. GPT Sol's review, item 1. */
if (!Number.isInteger(RUNS) || RUNS < 1) {
  throw new Error(`RUNS must be a positive whole number, not ${JSON.stringify(process.env.RUNS)}`);
}

/**
 * The candidates, and **not yet the survivors of a gate run**.
 *
 * This list used to be three Gemini models, chosen from the eight of fifteen
 * that answered a chat-endpoint gate on 2026-09-03, with the five slower ones
 * dropped on one call each. All of that is now history: dictation left the chat
 * endpoint on 2026-09-07, and not one of those fifteen appears among the models
 * OpenRouter documents as serving `/v1/audio/transcriptions`.
 *
 * What is here instead is [`gate-models.ts`](gate-models.ts)'s candidate list,
 * hand-collected on 2026-09-07 from OpenRouter's zero-data-retention endpoint
 * list and its speech-to-text guide. **Nobody has gated it.** So this is a list
 * of models believed to be reachable, not a list measured to be — run the gate
 * first and cut this to what answered, or the first thing this benchmark
 * produces is an hour of rows marked "lost". Five models is also two more than
 * the table has ever carried: at ten clips, three runs and two vocabulary
 * conditions that is 330 calls, and thinning on the gate is what keeps it
 * honest rather than merely long.
 */
const MODELS = [
  /** The incumbent since 2026-09-07 — the one arm that is about what we ship. */
  "openai/gpt-transcribe",
  /** The open baseline, and the model most other transcribers are compared to. */
  "openai/whisper-large-v3",
  "mistralai/voxtral-mini-transcribe",
  "microsoft/mai-transcribe-2",
  "fish-audio/transcribe-1",
] as const;

interface Utterance {
  id: string;
  slug: string | null;
  voice: string;
  source: string;
  text: string;
  hard: string[];
}
const { utterances } = JSON.parse(fs.readFileSync(`${DIR}utterances.json`, "utf8")) as {
  utterances: Utterance[];
};

/**
 * One row of the table: a model, and whether it was told the words.
 *
 * The incumbent appears twice with an identical body. That is the noise floor
 * and it is deliberate — see the file comment.
 */
interface Arm {
  name: string;
  model: string;
  vocabulary: boolean;
}
const ARMS: Arm[] = [
  ...MODELS.map((model) => ({ name: `${short(model)} +vocab`, model, vocabulary: true })),
  ...MODELS.map((model) => ({ name: `${short(model)} bare`, model, vocabulary: false })),
  { name: `${short(MODELS[0])} +vocab (again)`, model: MODELS[0], vocabulary: true },
];
/* Any vendor prefix, rather than a list of the two vendors that used to be in
   the table — a name that keeps its `mistralai/` because nobody updated a regex
   is a column that no longer lines up, and the arm names are what the results
   file is keyed by. */
function short(model: string) {
  return model.replace(/^[^/]+\//, "");
}

/* --------------------------------------------------------------------- main */

checkInventedDetectorWorks();

const audioOf = new Map<string, string>();
for (const u of utterances) {
  audioOf.set(u.id, fs.readFileSync(`${DIR}clips/${u.id}.webm`).toString("base64"));
}

/* **Built once, and shared by every arm.** The vocabulary is the thing this
   benchmark is *not* varying, so it must be identical across models rather than
   rebuilt per call — `vocabularyTermsFor` reads `data/`, and another agent's
   test fixture landing mid-run would otherwise show up as a model difference. */
const vocabularyOf = new Map<string, string[]>();
for (const u of utterances) {
  vocabularyOf.set(
    u.id,
    await vocabularyTermsFor(u.slug ? { kind: "article", slug: u.slug } : { kind: "profile" }),
  );
}
/* **The same list as the line it would be if it were joined**, for the two
   things that still want characters: the size report below, whose threshold is
   in characters because `packTerms` budgets in characters, and `invented`,
   which takes the joined form. Derived from the terms rather than kept
   alongside them, so the two cannot drift. */
const joined = (terms: readonly string[]) => terms.join(", ");

console.log(
  `${ARMS.length} arms, ${utterances.length} clips, ${RUNS} runs — ${ARMS.length * utterances.length * RUNS} calls.\n`,
);
/**
 * **Which clips actually had the words they were about to be scored on.**
 *
 * This is the most important thing this file prints, and it took a GPT Sol
 * review to find out why. `vocabularyFor` never throws — a source with nothing
 * to say returns nothing, which is what makes a recipe a list of names rather
 * than a pile of conditionals. The cost lands here: a clip whose terms are not
 * in this box's store gets a *short* vocabulary rather than an error, the run
 * completes, and it is scored anyway.
 *
 * A clip like that is not measuring what this benchmark is for. It measures how
 * a model guesses at proper nouns it was never told, from a synthetic voice —
 * and because models guess differently, **it does move the ranking**. The first
 * write-up of the 2026-09-03 run claimed the opposite, on the reasoning that
 * every arm saw identical input. Identical input, different sensitivity: the
 * bare-versus-told arms in this very table are the proof, and on that run
 * *every* apparent difference between the models lived in two such clips.
 *
 * Two ways a clip lands here, and the second is invisible without saying it:
 *
 * - **its article is not in this store.** The store is incomplete on this box,
 *   so this is a fact about the fixtures.
 * - **its terms come from a source nothing here supplies.** `purpose-box` says
 *   four things that live only in the "why you're reading this one" box, and no
 *   article on this machine has one — so it is unanswerable by design, for
 *   every arm, and its errors are noise wearing a model's name.
 *
 * **A clip with no hard terms can never land here**, however thin its
 * vocabulary looks. `control-no-hard-terms` exists to be dictated *against* a
 * loaded vocabulary and say nothing jargonish, so its word errors are the harm
 * number — and a rule that measured only characters dropped it out of the
 * headline table, taking the harm signal with it. The question is not "was this
 * vocabulary big" but "could this clip have been told the words it is scored
 * on", and a clip scored on no words always could.
 */
const UNSUPPLIED = new Set<string>();
console.log("Vocabulary characters/terms per clip, shared by every arm:");
const baseline = Math.min(...[...vocabularyOf.values()].map((v) => joined(v).length));
for (const u of utterances) {
  const v = vocabularyOf.get(u.id) as string[];
  /* `purpose-box` by name: its terms are in no store on any machine, so no
     length threshold can catch it. The others by measurement — in characters,
     which is what `packTerms` spends its budget in, so the comparison is
     against the same quantity the cap bounded. */
  if (u.hard.length && (u.id === "purpose-box" || (u.slug !== null && joined(v).length <= baseline)))
    UNSUPPLIED.add(u.id);
  console.log(
    `  ${u.id.padEnd(22)} ${v.length ? `${joined(v).length}/${v.length}` : "0"}${UNSUPPLIED.has(u.id) ? "   ← scored without the terms it exists to say" : ""}`,
  );
}
/** The clips a difference between models may honestly be read from. */
const SUPPLIED = utterances.filter((u) => !UNSUPPLIED.has(u.id)).map((u) => u.id);
console.log(
  `\n  ${UNSUPPLIED.size} of ${utterances.length} clips were scored without the vocabulary they need:\n  ${[...UNSUPPLIED].join(", ")}. Read the second table, not the first.\n`,
);

/* **No `usd` here, and the absence is the finding.** It held OpenRouter's own
   per-call figure so the headline total could be re-summed from the file (GPT
   Sol's second review item 7, then its third review item 2). The transcription
   endpoint answers `cost: 0` for every call, so keeping the field would have
   stored an array of zeroes, summed it, and printed a total that was wrong by
   the whole of what the run cost. `npm run cost -- --reconcile` asks the account,
   which is now the only thing that knows. */
interface Row {
  words: number[];
  edits: number[];
  recallHit: number;
  recallTotal: number;
  invented: string[];
  ms: number[];
  transcripts: string[];
}
const results = new Map<string, Map<string, Row>>();
for (const a of ARMS) {
  const perClip = new Map<string, Row>();
  for (const u of utterances) {
    perClip.set(u.id, {
      words: [],
      edits: [],
      recallHit: 0,
      recallTotal: 0,
      invented: [],
      ms: [],
      transcripts: [],
    });
  }
  results.set(a.name, perClip);
}

/* **Interleaved by arm, which here means interleaved by model.** The other
   benchmark rotates its conditions for the same reason and against a smaller
   risk: a slow half-hour upstream landing on one *vocabulary* is a wrong
   number, and landing on one *model* is a wrong number in the column this file
   exists to report. Deterministic, so a re-run is comparable. */
const lost: string[] = [];
/** Per arm, what each answering model called itself and how often — `(none)` included. */
const whoAnswered = new Map<string, Map<string, number>>();
let done = 0;
for (let run = 0; run < RUNS; run++) {
  for (const [clipIndex, u] of utterances.entries()) {
    for (let k = 0; k < ARMS.length; k++) {
      const arm = ARMS[(k + clipIndex + run) % ARMS.length] as Arm;
      const vocabulary = arm.vocabulary ? (vocabularyOf.get(u.id) as string[]) : [];
      const row = (results.get(arm.name) as Map<string, Row>).get(u.id) as Row;

      /* Five attempts, then recorded as lost and the run continues — the same
         rule and the same reason as the other benchmark: on 2026-08-28 one 502
         at call 369 of 650 ended a 55-minute run with nothing written down. A
         thinned table and a full one must not look alike. */
      let got: Awaited<ReturnType<typeof transcribeWith>> | null = null;
      let last: unknown;
      for (let attempt = 0; attempt < 5 && !got; attempt++) {
        try {
          got = await transcribeWith(audioOf.get(u.id) as string, "webm", vocabulary, {
            model: arm.model,
          });
        } catch (err) {
          last = err;
          if (attempt < 4) await new Promise((r) => setTimeout(r, 3_000 * (attempt + 1)));
        }
      }
      if (!got) {
        lost.push(`${arm.name}::${u.id}`);
        console.log(`  lost ${arm.name} / ${u.id}: ${(last as Error)?.message?.slice(0, 60)}`);
        continue;
      }
      /* **A fallback is not the model you asked for**, and *no answer* is not a
         confirmation. The first version read `if (got.answeredBy && …)`, so a
         response that named no model at all fell through the check and the run
         still ended by announcing that every call was answered by the model it
         was sent to — a clean bill of health from a test that had not run. GPT
         Sol's review, item 4. What is recorded is now what was actually seen,
         including the word `(none)`, and the summary counts rather than
         asserts.

         What this does **not** see: OpenRouter's `provider` is parsed in
         `ai-call.ts` and not carried on `JsonCall`, so an upstream swap serving
         the same model — the ordinary kind of fallback, and the kind that moves
         latency — is invisible here. Naming that is the point; a check whose
         limits are unwritten gets read as covering more than it does. */
      const answered = got.answeredBy ?? "(none)";
      const seen = whoAnswered.get(arm.name) ?? new Map<string, number>();
      seen.set(answered, (seen.get(answered) ?? 0) + 1);
      whoAnswered.set(arm.name, seen);
      const scored = edits(u.text, got.text);
      row.words.push(scored.words);
      row.edits.push(scored.edits);
      row.ms.push(got.ms);
      row.transcripts.push(got.text);
      for (const term of u.hard) {
        row.recallTotal++;
        if (has(got.text, term)) row.recallHit++;
      }
      /* `invented` reads the joined line, because it is shared with the other
         benchmark and that one still composes its conditions as text. */
      if (vocabulary.length)
        row.invented.push(...invented(joined(vocabulary), u.text, got.text));
      done++;
      if (done % 20 === 0) process.stdout.write(`${done} `);
    }
  }
}
process.stdout.write(`${done}\n`);

/* -------------------------------------------------------------------- table */

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const rowsOf = (name: string) => [...(results.get(name) as Map<string, Row>).values()];
/** Nearest-rank, which needs no interpolation and no apology at n = 30. */
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] as number) : Number.NaN;
};

/** One arm's numbers over a chosen set of clips. */
function score(arm: string, clips: string[]) {
  const per = results.get(arm) as Map<string, Row>;
  const rows = clips.map((c) => per.get(c) as Row);
  return {
    corpus: sum(rows.flatMap((r) => r.edits)) / sum(rows.flatMap((r) => r.words)),
    edits: sum(rows.flatMap((r) => r.edits)),
    mean: mean(rows.flatMap((r) => r.edits.map((e, i) => e / (r.words[i] as number)))),
    hit: rows.reduce((x, r) => x + r.recallHit, 0),
    total: rows.reduce((x, r) => x + r.recallTotal, 0),
    invented: rows.reduce((x, r) => x + r.invented.length, 0),
  };
}
const ALL = utterances.map((u) => u.id);

console.log("=== Accuracy over all ten clips ===");
console.log("Includes the clips nobody had the words for, so a difference here may be");
console.log("about guessing rather than about hearing. The next table is the one to read.\n");
console.log(
  `${"arm".padEnd(30)} ${"corpus".padStart(7)} ${"mean".padStart(7)} ${"recall".padStart(15)} ${"invented".padStart(9)} ${"control".padStart(8)}`,
);
for (const a of ARMS) {
  const s = score(a.name, ALL);
  const control = (results.get(a.name) as Map<string, Row>).get("control-no-hard-terms") as Row;
  console.log(
    `${a.name.padEnd(30)} ${pct(s.corpus).padStart(7)} ${pct(s.mean).padStart(7)} ${`${s.hit}/${s.total} ${pct(s.hit / s.total)}`.padStart(15)} ${String(s.invented).padStart(9)} ${pct(sum(control.edits) / sum(control.words)).padStart(8)}`,
  );
}

console.log(`\n=== Accuracy over the ${SUPPLIED.length} clips that had their vocabulary ===`);
console.log("The headline. A model can only be blamed for a term it was told and still");
console.log("got wrong; the rest is a fact about the fixtures wearing a model's name.\n");
console.log(
  `${"arm".padEnd(30)} ${"corpus".padStart(7)} ${"edits".padStart(6)} ${"recall".padStart(15)} ${"invented".padStart(9)}`,
);
for (const a of ARMS) {
  const s = score(a.name, SUPPLIED);
  console.log(
    `${a.name.padEnd(30)} ${pct(s.corpus).padStart(7)} ${String(s.edits).padStart(6)} ${`${s.hit}/${s.total} ${pct(s.hit / s.total)}`.padStart(15)} ${String(s.invented).padStart(9)}`,
  );
}

/* **Latency only. There was a `$/call` column here and it had to go**: this
   endpoint reports `usage.cost: 0` on every call, so the column would have been
   `$0.00000` beside every arm — a number that looks measured, is not, and would
   have gone into a plan as "the challenger is free". The spend for a run is
   `npm run cost -- --reconcile`, which asks the account rather than the response. */
console.log("\n=== Latency ===");
console.log("p90 is the call a reader remembers. One sitting, one network — read the");
console.log("spread, not the median.\n");
console.log(
  `${"arm".padEnd(30)} ${"p50".padStart(8)} ${"p90".padStart(8)} ${"max".padStart(8)}`,
);
for (const a of ARMS) {
  const ms = rowsOf(a.name).flatMap((r) => r.ms);
  console.log(
    `${a.name.padEnd(30)} ${`${quantile(ms, 0.5)}ms`.padStart(8)} ${`${quantile(ms, 0.9)}ms`.padStart(8)} ${`${Math.max(...ms)}ms`.padStart(8)}`,
  );
}

console.log(
  `\nlost ${lost.length} calls${lost.length ? `: ${lost.join(", ")}` : ""}. What it cost: npm run cost -- --reconcile`,
);

/* **Who answered, counted rather than asserted.** A row that is anything but
   the arm's own model at the full call count is a row measuring something else.
   `(none)` means the response named no model, which is not agreement.

   **And counted against what was sent, not only against itself.** The verdict
   used to be a `clean` flag falsified only by an answer naming another model,
   so an arm whose every call was lost had nothing to filter and was reported
   under "every call named the model it was sent to" — the same bug as the
   comment at the check above, one level up, which is why the judgement now
   lives in `coverage.ts` where a test can hand it an arm that answered
   nothing. */
console.log("\nWhat answered, per arm:");
const coverage = coverageOf(
  ARMS.map((a) => ({
    name: a.name,
    sentTo: a.model,
    attempted: utterances.length * RUNS,
    answers: whoAnswered.get(a.name) ?? new Map<string, number>(),
  })),
);
for (const row of coverage.arms) {
  console.log(
    `  ${row.name.padEnd(30)} ${`${row.answered}/${row.attempted}`.padStart(7)}  ${
      row.answered === 0
        ? "NOTHING CAME BACK"
        : row.answers.map(([m, n]) => `${m === row.sentTo ? "as sent" : m} ×${n}`).join(", ")
    }`,
  );
}
for (const line of coverageLines(coverage)) console.log(line);
/* Only ever raised, never cleared: an exit code already set is somebody else's
   failure and this is not the place to overrule it. */
if (exitCodeFor(coverage) === 1) process.exitCode = 1;

const out = `${DIR}results-models.json`;
fs.writeFileSync(
  out,
  `${JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      runs: RUNS,
      arms: ARMS,
      /* **`spentUsd: null`, rather than a number or a missing key.** It was a
         sum of OpenRouter's per-call figures, and on this endpoint every one of
         those is 0 — so the honest value is "this file does not know", said out
         loud. Dropping the key entirely would let a reader of an old results
         file and a new one both think they were looking at a total. Ask the
         account: `npm run cost -- --reconcile`. */
      spentUsd: null,
      /* **The plan and the outcome, each under its own name.** `attempted` is
         what the run set out to make and `answered` is what came back, so a
         thinned run cannot be read as a full one by anybody holding only this
         file. `lost` below is the same shortfall by name. */
      calls: callCounts(coverage),
      lost,
      /** Stored in full, so the "as sent" line in the output can be audited. */
      whoAnswered: Object.fromEntries(
        [...whoAnswered].map(([k, v]) => [k, Object.fromEntries(v)]),
      ),
      /** The clips a difference between models may honestly be read from. */
      suppliedClips: SUPPLIED,
      /* Vocabulary lengths rather than the vocabularies: the terms come out of
         readers' articles, and a results file is a thing that gets pasted into
         a plan. Their lengths are what a re-run needs to check it built the
         same prompt. */
      vocabularyChars: Object.fromEntries(
        [...vocabularyOf].map(([id, v]) => [id, joined(v).length]),
      ),
      /** And the count, which is now the shape the request is actually in. */
      vocabularyTerms: Object.fromEntries(
        [...vocabularyOf].map(([id, v]) => [id, v.length]),
      ),
      results: Object.fromEntries(
        [...results].map(([arm, perClip]) => [arm, Object.fromEntries(perClip)]),
      ),
    },
    null,
    2,
  )}\n`,
);
console.log(`\nwrote ${out}`);
