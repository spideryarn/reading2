/**
 * **Score the saved answers** — free, no model call. Plan 261003k Stage 1.
 *
 *     npx tsx evals/command-pick/summarise.ts                    # writes results/<the current run>/summary.md and prints it
 *     npx tsx evals/command-pick/summarise.ts --results 261003   # an older run: printed, NOT written
 *
 * **An older run is printed only.** It is scored against today's list and
 * today's phrases, which is not what its saved `summary.md` was made from, so
 * that file is left as it was.
 *
 * Only the arrangements with saved answers are shown: the 2026-10-04 run made
 * production's two calls and nothing else. When the run before it is on disk
 * the summary ends with what moved between the two.
 *
 * **An arrangement is scored on its whole outcome**, after the check
 * production will make (GPT Sol's F2 on the plan):
 *
 * 1. an id that was not offered is `none`;
 * 2. an argument id whose words are empty, or are not in the sentence
 *    (compared without case), is `none`;
 * 3. the outcome is right when that id is one the phrase accepts **and**, for
 *    an argument id, the words are the ones we expected (trimmed, without
 *    case).
 *
 * So `jev-pick` on its own is never right on an argument request: it has no
 * words. The hybrids are `jev-pick`'s id with a second model's words, and
 * their latency and cost are the two calls added — the second one counted
 * whenever Jev chose an argument command, rightly or wrongly.
 *
 * The rule that reads the table is `SELECTION` below, fixed before any answer
 * was scored.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { barAnswersIt, isArgumentId, NONE, rowFor, runsAtOnce, VALID_IDS, writesOrSpends } from "./catalogue.js";
import { type Phrase, PHRASES, wantsArgument, wantsNone } from "./phrases.js";
import { ALL_ARMS, bare, CHAT_ARMS, CURRENT_RUN, loadRows, PREVIOUS_RUN, RESULTS_DIR, type Row, resultsDir, RUN } from "./run.js";

/** GPT Sol's F6, as the coordinator froze it on 2026-10-03. */
const SELECTION = { floorAccuracy: 0.85, ceilingP90Ms: 1200, oneCallWithinPoints: 3 };
const THRESHOLDS = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
const WORD_THRESHOLDS = [0.3, 0.5, 0.7];

const rows = new Map(ALL_ARMS.map((arm) => [arm, new Map(loadRows(arm).map((r) => [r.phrase, r]))]));
const row = (arm: string, p: Phrase): Row | undefined => rows.get(arm)?.get(p.id);

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
const pct = (n: number, d: number): string => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "—");
const inSentence = (p: Phrase, words: string | null): boolean => !!words && norm(words) !== "" && norm(p.text).includes(norm(words));
const expected = (p: Phrase): string[] => [p.argument, ...(p.argumentAlso ?? [])].filter((x): x is string => x !== undefined).map(norm);
const exact = (p: Phrase, words: string | null): boolean => words !== null && expected(p).includes(norm(words));

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? Number.NaN;
}

/* --------------------------------------------------------- arrangements -- */

interface Outcome {
  /** What the model said, before any check. */
  rawPick: string | null;
  /** After production's check: an unknown id or an unusable argument is `none`. */
  pick: string;
  words: string | null;
  confidence: number | null;
  latencyMs: number;
  costUsd: number;
  calls: number;
  right: boolean;
}

interface Arrangement {
  name: string;
  calls: 1 | 2;
  what: string;
  outcome(p: Phrase): Outcome | null;
}

function settle(
  p: Phrase,
  rawPick: string | null,
  words: string | null,
  rest: Pick<Outcome, "confidence" | "latencyMs" | "costUsd" | "calls">,
  /** The ids that were offered. The run before was offered two that have since gone. */
  offered: (id: string) => boolean = (id) => VALID_IDS.has(id),
): Outcome {
  let pick = rawPick !== null && offered(rawPick) ? rawPick : NONE;
  if (isArgumentId(pick) && !inSentence(p, words)) pick = NONE;
  const right = p.accept.includes(pick) && (!isArgumentId(pick) || exact(p, words));
  return { rawPick, pick, words: isArgumentId(pick) ? words : null, right, ...rest };
}

const single = (arm: string, what: string, withWords: boolean): Arrangement => ({
  name: arm,
  calls: 1,
  what,
  outcome(p) {
    const r = row(arm, p);
    if (!r) return null;
    return settle(p, r.pick, withWords ? r.argument : null, {
      confidence: r.confidence,
      latencyMs: r.latencyMs ?? Number.NaN,
      costUsd: r.costUsd ?? 0,
      calls: 1,
    });
  },
});

const hybrid = (chat: string): Arrangement => ({
  name: `jev-pick + ${chat}`,
  calls: 2,
  what: `Jev picks; when it picks an argument command, ${chat} is asked for the words`,
  outcome(p) {
    const j = row("jev-pick", p);
    if (!j) return null;
    const second = j.pick !== null && isArgumentId(j.pick) ? row(`hyb-${chat}`, p) : undefined;
    if (j.pick !== null && isArgumentId(j.pick) && !second) return null;
    return settle(p, j.pick, second?.argument ?? null, {
      confidence: j.confidence,
      latencyMs: (j.latencyMs ?? Number.NaN) + (second?.latencyMs ?? 0),
      costUsd: (j.costUsd ?? 0) + (second?.costUsd ?? 0),
      calls: second ? 2 : 1,
    });
  },
});

const has = (arm: string): boolean => (rows.get(arm)?.size ?? 0) > 0;
const ARRANGEMENTS: Arrangement[] = [
  single("jev-pick", "Jev, one `choice` question; no words, so an argument pick is incomplete", false),
  single("jev-words", "Jev, the `choice` and a yes/no per word in one request", true),
  ...CHAT_ARMS.map((a) => single(a.name, `\`${a.model}\`, JSON \`{id, argument, confidence}\`; ${a.setting}`, true)),
  ...CHAT_ARMS.map((a) => hybrid(a.name)),
].filter((a) => (a.calls === 1 ? has(a.name) : has("jev-pick") && has(`hyb-${a.name.slice("jev-pick + ".length)}`)));
/** Where a table is about the answer a reader gets: Jev alone is left out once a hybrid supplies its words. */
const WHOLE = ARRANGEMENTS.filter((a) => a.name !== "jev-pick" || !ARRANGEMENTS.some((b) => b.calls === 2));

/* --------------------------------------------------------------- the sets -- */

const CANNOT = PHRASES.filter((p) => !barAnswersIt(p.text));
const SETS: [string, Phrase[]][] = [
  ["all", [...PHRASES]],
  ["the bar cannot answer itself", CANNOT],
  ["blind set", PHRASES.filter((p) => p.set === "blind")],
  ["wants an argument", PHRASES.filter(wantsArgument)],
  ["wants an argument, bar cannot answer", CANNOT.filter(wantsArgument)],
  ["no right answer", PHRASES.filter(wantsNone)],
  ["first run's 72", PHRASES.filter((p) => p.set === "round1" || p.set === "round2")],
  ["new, ours", PHRASES.filter((p) => p.set === "new")],
  ["2026-10-03's 192", PHRASES.filter((p) => p.set !== "more")],
  ["2026-10-04's, Find more and nicknames", PHRASES.filter((p) => p.set === "more")],
  ["2026-10-04's, bar cannot answer", CANNOT.filter((p) => p.set === "more")],
];

const out: string[] = [];
out.push(
  `# Command pick — summary, run ${RUN}`,
  "",
  `Generated by \`summarise.ts\` from \`results/${RUN}/*.json\`. ${PHRASES.length} phrases; the bar's own matching answers ${PHRASES.length - CANNOT.length} of them, so **${CANNOT.length} are the ones production would send to a model**.`,
  "",
  "An outcome is right when the id is accepted and, for an argument command, the words are exactly the expected ones — after production's check (an unknown id, or words not in the sentence, become `none`).",
  "",
  "## The arrangements",
  "",
  ...ARRANGEMENTS.map((a) => `- **${a.name}** (${a.calls} call${a.calls > 1 ? "s" : ""}): ${a.what}`),
);

/* ------------------------------------------------------------- headline -- */

interface Scored {
  a: Arrangement;
  accuracy: number;
  p90: number;
}
const scored: Scored[] = [];

out.push("", "## Whole outcome right", "", `| arrangement | ${SETS.map(([n, ps]) => `${n} (${ps.length})`).join(" | ")} |`, `|---|${SETS.map(() => "---").join("|")}|`);
for (const a of ARRANGEMENTS) {
  out.push(`| ${a.name} | ${SETS.map(([, ps]) => pct(ps.filter((p) => a.outcome(p)?.right).length, ps.length)).join(" | ")} |`);
}

out.push(
  "",
  "## Latency and cost of an arrangement, on the phrases the bar cannot answer",
  "",
  "For a two-call arrangement the latency is the two calls added, the second made whenever Jev picked an argument command.",
  "",
  "| arrangement | right | id right (ignoring words) | median ms | p90 ms | p90 ms, argument requests | mean $ per request | second call made |",
  "|---|---|---|---|---|---|---|---|",
);
for (const a of ARRANGEMENTS) {
  const os = CANNOT.map((p) => ({ p, o: a.outcome(p) })).filter((x): x is { p: Phrase; o: Outcome } => x.o !== null);
  const lat = os.map((x) => x.o.latencyMs).filter((x) => Number.isFinite(x));
  const argLat = os.filter((x) => wantsArgument(x.p)).map((x) => x.o.latencyMs);
  const nRight = os.filter((x) => x.o.right).length;
  const idRight = os.filter((x) => x.o.rawPick !== null && x.p.accept.includes(x.o.rawPick)).length;
  const cost = os.reduce((s, x) => s + x.o.costUsd, 0) / os.length;
  const p90 = quantile(lat, 0.9);
  scored.push({ a, accuracy: nRight / CANNOT.length, p90 });
  out.push(
    `| ${a.name} | ${pct(nRight, CANNOT.length)} | ${pct(idRight, CANNOT.length)} | ${quantile(lat, 0.5)} | ${p90} | ${quantile(argLat, 0.9)} | ${cost.toFixed(5)} | ${a.calls === 2 ? pct(os.filter((x) => x.o.calls === 2).length, os.length) : "—"} |`,
  );
}

/* ------------------------------------------------------------ selection -- */

out.push(
  "",
  "## The predeclared reading",
  "",
  `Floors: whole outcome right on at least ${SELECTION.floorAccuracy * 100}% of the ${CANNOT.length} phrases the bar cannot answer, and p90 latency at most ${SELECTION.ceilingP90Ms} ms. Among those meeting both, one call is preferred over two when within ${SELECTION.oneCallWithinPoints} points; otherwise the more accurate.`,
  "",
  "| arrangement | accuracy | p90 ms | accuracy floor | latency floor |",
  "|---|---|---|---|---|",
);
for (const s of scored) {
  out.push(
    `| ${s.a.name} | ${(100 * s.accuracy).toFixed(1)}% | ${s.p90} | ${s.accuracy >= SELECTION.floorAccuracy ? "meets" : "**misses**"} | ${s.p90 <= SELECTION.ceilingP90Ms ? "meets" : "**misses**"} |`,
  );
}
const meeting = scored.filter((s) => s.accuracy >= SELECTION.floorAccuracy && s.p90 <= SELECTION.ceilingP90Ms);
if (meeting.length === 0) {
  const closest = [...scored].sort(
    (x, y) =>
      Math.max(0, SELECTION.floorAccuracy - x.accuracy) + Math.max(0, x.p90 / SELECTION.ceilingP90Ms - 1) -
      (Math.max(0, SELECTION.floorAccuracy - y.accuracy) + Math.max(0, y.p90 / SELECTION.ceilingP90Ms - 1)),
  )[0];
  out.push("", `**Nothing meets both floors.** The closest (smallest combined shortfall, accuracy in points and latency as a fraction of the ceiling) is **${closest?.a.name}**.`);
} else {
  const best = Math.max(...meeting.map((s) => s.accuracy));
  const oneCall = meeting.filter((s) => s.a.calls === 1 && (best - s.accuracy) * 100 <= SELECTION.oneCallWithinPoints).sort((x, y) => y.accuracy - x.accuracy || x.p90 - y.p90);
  const pick = oneCall[0] ?? meeting.filter((s) => s.accuracy === best).sort((x, y) => x.p90 - y.p90)[0];
  out.push("", `Meeting both: ${meeting.map((s) => s.a.name).join(", ")}. **The rule selects ${pick?.a.name}.**`);
}

/* ------------------------------------------------------------ arguments -- */

const ARG_PHRASES = PHRASES.filter(wantsArgument);
out.push(
  "",
  `## The words, on the ${ARG_PHRASES.length} requests that want an argument`,
  "",
  "*Exact*: the expected words, trimmed and without case. *In the sentence*: not empty and found in the sentence, the check production makes. For a pick arm, only where it chose an argument command at all.",
  "",
  "| arm | chose an argument command | exact | in the sentence | not in the sentence |",
  "|---|---|---|---|---|",
);
for (const arm of ["jev-words", ...CHAT_ARMS.map((a) => a.name), ...CHAT_ARMS.map((a) => `arg-${a.name}`), ...CHAT_ARMS.map((a) => `hyb-${a.name}`)].filter(has)) {
  const rs = ARG_PHRASES.map((p) => ({ p, r: row(arm, p) })).filter((x): x is { p: Phrase; r: Row } => x.r !== undefined);
  const chose = arm.startsWith("arg-") ? rs : rs.filter((x) => x.r.pick !== null && isArgumentId(x.r.pick));
  out.push(
    `| ${arm} | ${chose.length}/${ARG_PHRASES.length} | ${pct(chose.filter((x) => exact(x.p, x.r.argument)).length, chose.length)} | ${pct(chose.filter((x) => inSentence(x.p, x.r.argument)).length, chose.length)} | ${chose.filter((x) => !inSentence(x.p, x.r.argument)).length} |`,
  );
}

out.push("", "### Jev's word questions: the span at each cut", "", "The words scored at or above the cut, in order, with the punctuation round each taken off.", "", "| cut | exact | of |", "|---|---|---|");
for (const t of has("jev-words") ? WORD_THRESHOLDS : []) {
  const rs = ARG_PHRASES.map((p) => ({ p, r: row("jev-words", p) })).filter((x): x is { p: Phrase; r: Row } => x.r?.words != null);
  const span = (r: Row) =>
    (r.words ?? [])
      .filter((w) => (w.p ?? 0) >= t)
      .map((w) => bare(w.word))
      .join(" ");
  out.push(`| ${t} | ${rs.filter((x) => exact(x.p, span(x.r))).length} | ${rs.length} |`);
}

out.push("", "### Every argument that was not exact", "", "| phrase | text | expected | arm | got |", "|---|---|---|---|---|");
for (const p of ARG_PHRASES) {
  for (const arm of ["jev-words", ...CHAT_ARMS.map((a) => a.name), ...CHAT_ARMS.map((a) => `arg-${a.name}`), ...CHAT_ARMS.map((a) => `hyb-${a.name}`)]) {
    const r = row(arm, p);
    if (!r) continue;
    if (!arm.startsWith("arg-") && !(r.pick !== null && isArgumentId(r.pick))) continue;
    if (!exact(p, r.argument)) out.push(`| ${p.id} | ${p.text} | ${p.argument} | ${arm} | ${r.argument === null || r.argument === "" ? "(nothing)" : r.argument} |`);
  }
}

/* ------------------------------------------------------- Jev's top three -- */

out.push("", "## When Jev's first choice is wrong, is a right row in its top three?", "");
for (const arm of ["jev-pick", "jev-words"].filter(has)) {
  const wrong = CANNOT.map((p) => ({ p, r: row(arm, p) })).filter((x): x is { p: Phrase; r: Row } => x.r !== undefined && !(x.r.pick !== null && x.p.accept.includes(x.r.pick)));
  const top3 = (r: Row) =>
    Object.entries(r.probabilities ?? {})
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3);
  const inTop = wrong.filter((x) => top3(x.r).some(([id]) => x.p.accept.includes(id)));
  out.push(`**${arm}**: id wrong on ${wrong.length} of the ${CANNOT.length}; a right id is in the top three on ${inTop.length} of those.`, "", "| phrase | text | accepted | top three |", "|---|---|---|---|");
  for (const x of wrong) out.push(`| ${x.p.id} | ${x.p.text} | ${x.p.accept.join(", ")} | ${top3(x.r).map(([id, pr]) => `${id} ${pr.toFixed(2)}`).join("; ")} |`);
  out.push("");
}

/* ------------------------------------------------------------ confidence -- */

out.push(
  "## Confidence cuts, on the phrases the bar cannot answer",
  "",
  "Keep an answer when its confidence is at or above the cut. *Would run at once*: a kept answer that is a row which only moves the reader — not an argument command (always proposed), not a row that generates, not Archive, Export or the Experimental switch. **The last column is the number the auto-run rule depends on.** Jev's confidence is the model's own probability; a chat model's is a number it was asked to write down.",
  "",
  "| arm | cut | kept | kept and right | would run at once | of those, wrong |",
  "|---|---|---|---|---|---|",
);
const wrongRuns: string[] = [];
for (const a of ARRANGEMENTS.filter((x) => x.calls === 1)) {
  for (const t of THRESHOLDS) {
    const os = CANNOT.map((p) => ({ p, o: a.outcome(p) })).filter((x): x is { p: Phrase; o: Outcome } => x.o !== null && x.o.pick !== NONE && (x.o.confidence ?? 0) >= t);
    const run = os.filter((x) => runsAtOnce(x.o.pick));
    const runWrong = run.filter((x) => !x.o.right);
    if (t === 0.8 || t === 0.9) for (const x of runWrong) wrongRuns.push(`| ${a.name} | ${t} | ${x.p.id} | ${x.p.text} | ${x.p.accept.join(", ")} | ${x.o.pick} | ${x.o.confidence?.toFixed(2)} |`);
    out.push(`| ${a.name} | ${t === 0 ? "none" : t} | ${os.length} | ${pct(os.filter((x) => x.o.right).length, os.length)} | ${run.length} | ${runWrong.length} |`);
  }
}
out.push("", "A `none` is never kept or run; it is excluded from *kept*.", "", "### The wrong answers that would have run at once, at 0.8 and at 0.9", "", "| arm | cut | phrase | text | accepted | ran | confidence |", "|---|---|---|---|---|---|---|", ...[...new Set(wrongRuns)]);

/* ----------------------------------------------------------------- risk -- */

out.push(
  "",
  "## Requests with no right answer: was anything risky picked?",
  "",
  "*Writes or spends*: Archive, the Experimental switch, a tag, any *Run again*. *Generates*: a mode whose row carries the bar's generates marker. Neither would run without a second Enter under the plan; this is how often that second Enter is all that stands in the way.",
  "",
  "| phrase | text | arm | picked | confidence | kind |",
  "|---|---|---|---|---|---|",
);
let risky = 0;
for (const p of PHRASES.filter(wantsNone)) {
  for (const a of WHOLE) {
    const o = a.outcome(p);
    if (!o || o.right || o.pick === NONE) continue;
    const kind = writesOrSpends(o.pick) ? "**writes or spends**" : rowFor(o.pick)?.generates ? "generates" : runsAtOnce(o.pick) ? "moves the reader" : "other";
    if (kind !== "moves the reader") risky += 1;
    out.push(`| ${p.id} | ${p.text} | ${a.name} | ${o.pick} | ${o.confidence?.toFixed(2) ?? "—"} | ${kind} |`);
  }
}
out.push("", `${risky} of those picks write, spend or generate.`);

/* ------------------------------------------- unasked-for work, any request -- */

out.push(
  "",
  "## Any request: a row that writes, spends or generates, picked when it was not asked for",
  "",
  "The table above, over every phrase rather than only those with no right answer: a wrong answer whose row would start a model call or change the reader's data. *Bar answers* marks a sentence production never sends.",
  "",
  "| phrase | text | accepted | arrangement | picked | confidence | kind |",
  "|---|---|---|---|---|---|---|",
);
const unasked: number[] = [];
for (const p of PHRASES) {
  for (const a of WHOLE) {
    const o = a.outcome(p);
    if (!o || o.right || o.pick === NONE) continue;
    const kind = writesOrSpends(o.pick) ? "**writes or spends**" : rowFor(o.pick)?.generates ? "generates" : null;
    if (kind === null) continue;
    unasked.push(o.confidence ?? 0);
    out.push(`| ${p.id}${barAnswersIt(p.text) ? " (bar answers)" : ""} | ${p.text} | ${p.accept.join(", ")} | ${a.name} | ${o.pick} | ${o.confidence?.toFixed(2) ?? "—"} | ${kind} |`);
  }
}
out.push("", `${unasked.length} in all; ${unasked.filter((c) => c >= 0.9).length} at 0.9 or above, ${unasked.filter((c) => c >= 0.95).length} at 0.95 or above. None runs without a second Enter, whatever the confidence.`);

/* --------------------------------------------------------------- misses -- */

const SINGLES = WHOLE;
out.push("", "## Every miss", "", "✓ right, ✗ wrong; the id after production's check, the words, the confidence. A phrase is listed when any arrangement shown missed it.", "", `| phrase | text | accepted | ${SINGLES.map((a) => a.name).join(" | ")} |`, `|---|---|---|${SINGLES.map(() => "---").join("|")}|`);
for (const p of PHRASES) {
  const os = SINGLES.map((a) => a.outcome(p));
  if (os.every((o) => o?.right)) continue;
  const show = (o: Outcome | null) =>
    o === null
      ? "missing"
      : `${o.right ? "✓" : "✗"} ${o.pick}${o.rawPick !== o.pick ? ` (said ${o.rawPick})` : ""}${o.words ? ` “${o.words}”` : ""}${o.confidence != null ? ` ${o.confidence.toFixed(2)}` : ""}`;
  out.push(`| ${p.id}${barAnswersIt(p.text) ? " (bar answers)" : ""} | ${p.text} | ${p.accept.join(", ")}${p.argument ? ` “${p.argument}”` : ""} | ${os.map(show).join(" | ")} |`);
}

for (const a of ARRANGEMENTS.filter((x) => x.calls === 1)) {
  const bad = PHRASES.map((p) => ({ p, r: row(a.name, p) })).filter((x) => x.r?.pick != null && !VALID_IDS.has(x.r.pick));
  if (bad.length) out.push("", `**${a.name} answered with ids that were not offered:** ${bad.map((x) => `${x.p.id} → \`${x.r?.pick}\``).join(", ")}`);
}

/* ---------------------------------------------------------------- calls -- */

out.push("", "## Each arm's calls", "", "| arm | calls | errors | median ms | p90 ms | max ms | mean tokens in | thinking tokens, total | upstreams | mean $/call | total $ |", "|---|---|---|---|---|---|---|---|---|---|---|");
let grand = 0;
for (const arm of ALL_ARMS) {
  const rs = [...(rows.get(arm)?.values() ?? [])];
  if (rs.length === 0) continue;
  const lat = rs.map((r) => r.latencyMs).filter((x): x is number => x !== null);
  const total = rs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  grand += total;
  const ups = [...new Set(rs.map((r) => r.upstream).filter((x): x is string => x !== null))];
  out.push(
    `| ${arm} | ${rs.length} | ${rs.filter((r) => r.error).length} | ${quantile(lat, 0.5)} | ${quantile(lat, 0.9)} | ${Math.max(...lat)} | ${Math.round(rs.reduce((s, r) => s + (r.tokensIn ?? 0), 0) / rs.length)} | ${arm.startsWith("jev") ? "—" : rs.reduce((s, r) => s + (r.reasoningTokens ?? 0), 0)} | ${ups.join(", ") || "—"} | ${(total / rs.length).toFixed(5)} | ${total.toFixed(4)} |`,
  );
}
out.push("", `Total across the saved rows: $${grand.toFixed(4)}. The write-up gives the whole spend, which includes any call that was replaced and the probes.`);

/* ------------------------------------------------- against the run before -- */

const before = new Map(["jev-pick", ...CHAT_ARMS.map((a) => `hyb-${a.name}`)].map((arm) => [arm, new Map(loadRows(arm, resultsDir(PREVIOUS_RUN)).map((r) => [r.phrase, r]))]));
const extractor = CHAT_ARMS.map((a) => a.name).find((name) => has(`hyb-${name}`));
if (RUN !== PREVIOUS_RUN && extractor !== undefined && (before.get("jev-pick")?.size ?? 0) > 0) {
  const now = hybrid(extractor);
  /** The run before, the same arrangement, scored on today's labels; it was offered whatever it answered with. */
  const then = (p: Phrase): Outcome | null => {
    const j = before.get("jev-pick")?.get(p.id);
    if (!j) return null;
    const second = j.pick !== null && isArgumentId(j.pick) ? before.get(`hyb-${extractor}`)?.get(p.id) : undefined;
    return settle(
      p,
      j.pick,
      second?.argument ?? null,
      { confidence: j.confidence, latencyMs: (j.latencyMs ?? Number.NaN) + (second?.latencyMs ?? 0), costUsd: (j.costUsd ?? 0) + (second?.costUsd ?? 0), calls: second ? 2 : 1 },
      () => true,
    );
  };
  const both = PHRASES.map((p) => ({ p, a: then(p), b: now.outcome(p) })).filter((x): x is { p: Phrase; a: Outcome; b: Outcome } => x.a !== null && x.b !== null);
  const sent = both.filter((x) => !barAnswersIt(x.p.text));
  const tally = (xs: typeof both, f: (x: (typeof both)[number]) => boolean) => pct(xs.filter(f).length, xs.length);
  const stats = (rs: Row[]) => ({
    tokens: Math.round(rs.reduce((s, r) => s + (r.tokensIn ?? 0), 0) / rs.length),
    p50: quantile(rs.map((r) => r.latencyMs ?? Number.NaN), 0.5),
    p90: quantile(rs.map((r) => r.latencyMs ?? Number.NaN), 0.9),
    cost: rs.reduce((s, r) => s + (r.costUsd ?? 0), 0) / rs.length,
  });
  const was = stats(both.flatMap((x) => before.get("jev-pick")?.get(x.p.id) ?? []));
  const is = stats(both.flatMap((x) => row("jev-pick", x.p) ?? []));
  const nones = both.filter((x) => wantsNone(x.p));
  out.push(
    "",
    `## Against run ${PREVIOUS_RUN}: Jev picks, ${extractor} extracts, on the ${both.length} phrases both runs asked`,
    "",
    `Both scored on today's labels. *Sent* is the ${sent.length} of them the bar cannot answer itself today.`,
    "",
    `| | run ${PREVIOUS_RUN} | run ${RUN} |`,
    "|---|---|---|",
    `| whole outcome right, all ${both.length} | ${tally(both, (x) => x.a.right)} | ${tally(both, (x) => x.b.right)} |`,
    `| whole outcome right, the ${sent.length} sent | ${tally(sent, (x) => x.a.right)} | ${tally(sent, (x) => x.b.right)} |`,
    `| id right, the ${sent.length} sent | ${tally(sent, (x) => x.a.rawPick !== null && x.p.accept.includes(x.a.rawPick))} | ${tally(sent, (x) => x.b.rawPick !== null && x.p.accept.includes(x.b.rawPick))} |`,
    `| no right answer, and none given | ${tally(nones, (x) => x.a.right)} | ${tally(nones, (x) => x.b.right)} |`,
    `| Jev's call: mean tokens in | ${was.tokens} | ${is.tokens} |`,
    `| Jev's call: median / p90 ms | ${was.p50} / ${was.p90} | ${is.p50} / ${is.p90} |`,
    `| Jev's call: mean $ | ${was.cost.toFixed(5)} | ${is.cost.toFixed(5)} |`,
    "",
    "### What would have run at once, on the phrases sent",
    "",
    `| cut | run ${PREVIOUS_RUN}: would run | wrong | run ${RUN}: would run | wrong |`,
    "|---|---|---|---|---|",
  );
  for (const t of THRESHOLDS) {
    const at = (o: Outcome) => o.pick !== NONE && !isArgumentId(o.pick) && (o.confidence ?? 0) >= t && runsAtOnce(o.pick);
    const a = sent.filter((x) => at(x.a));
    const b = sent.filter((x) => at(x.b));
    out.push(`| ${t === 0 ? "none" : t} | ${a.length} | ${a.filter((x) => !x.a.right).length} | ${b.length} | ${b.filter((x) => !x.b.right).length} |`);
  }
  const changed = both.filter((x) => x.a.rawPick !== x.b.rawPick);
  const show = (o: Outcome) => `${o.right ? "✓" : "✗"} ${o.rawPick} ${o.confidence?.toFixed(2) ?? "—"}`;
  out.push(
    "",
    `### Every phrase whose pick changed (${changed.length} of ${both.length})`,
    "",
    `Right to wrong: ${changed.filter((x) => x.a.right && !x.b.right).length}. Wrong to right: ${changed.filter((x) => !x.a.right && x.b.right).length}. Right both times: ${changed.filter((x) => x.a.right && x.b.right).length}. Wrong both times: ${changed.filter((x) => !x.a.right && !x.b.right).length}.`,
    "",
    `| phrase | text | accepted | run ${PREVIOUS_RUN} | run ${RUN} |`,
    "|---|---|---|---|---|",
    ...changed.map((x) => `| ${x.p.id}${barAnswersIt(x.p.text) ? " (bar answers)" : ""} | ${x.p.text} | ${x.p.accept.join(", ")} | ${show(x.a)} | ${show(x.b)} |`),
  );
  const same = both.filter((x) => x.a.rawPick === x.b.rawPick && x.a.confidence !== null && x.b.confidence !== null);
  const drift = same.map((x) => (x.b.confidence ?? 0) - (x.a.confidence ?? 0));
  out.push(
    "",
    `On the ${same.length} whose pick did not change, confidence moved by a median of ${quantile(drift, 0.5).toFixed(3)} (10th to 90th percentile ${quantile(drift, 0.1).toFixed(3)} to ${quantile(drift, 0.9).toFixed(3)}); ${same.filter((x) => (x.a.confidence ?? 0) >= 0.95 && (x.b.confidence ?? 0) < 0.95).length} fell below 0.95 and ${same.filter((x) => (x.a.confidence ?? 0) < 0.95 && (x.b.confidence ?? 0) >= 0.95).length} rose to it.`,
  );
}

const text = `${out.join("\n")}\n`;
if (RUN === CURRENT_RUN) writeFileSync(path.join(RESULTS_DIR, "summary.md"), text);
console.log(text);
if (RUN !== CURRENT_RUN) console.error(`results/${RUN}/summary.md was NOT rewritten: it was made from the list and the phrases as they were for that run.`);
