// Splits Realtime latency into semantic-VAD wait and model time. Needs a full run directory
// (sessions.jsonl + events/) as written by evals/live/gpt-live-spike.mts; only samples of the events are committed.
import { readFileSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const recs = readFileSync(path.join(dir, "sessions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const med = (xs) => {
  const s = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const rows = [];
for (const r of recs.filter((r) => r.config === "A" || r.config === "B")) {
  const ev = readFileSync(path.join(dir, "events", `${r.config}-${r.article}-s${r.scenario}-r${r.rep}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  for (const t of r.turns) {
    const u = t.utterances.find((x) => x.firstAudioMs === t.firstAudioMs);
    if (!u) continue;
    const a = ev.find((e) => e.type === "response.output_audio.delta" && e.response_id === u.responseId);
    if (!a) continue;
    const qEnd = a.ms - t.firstAudioMs;
    const stops = ev.filter((e) => e.type === "input_audio_buffer.speech_stopped" && e.ms <= a.ms && e.ms > qEnd - 3000);
    const stop = stops[stops.length - 1];
    const created = ev.find((e) => e.type === "response.created" && e.response?.id === u.responseId);
    const fn = ev.filter((e) => e.type === "response.done" && e.ms < a.ms && e.ms > qEnd && (e.response?.output ?? []).some((o) => o.type === "function_call"));
    rows.push({
      k: `${t.config}|s${t.scenario}`,
      vadWait: stop ? stop.ms - qEnd : null,
      afterVad: stop ? a.ms - stop.ms : null,
      createdAfterVad: stop && created ? created.ms - stop.ms : null,
      toolFirst: fn.length > 0,
      total: t.firstAudioMs,
      t,
    });
  }
}
const g = new Map();
for (const r of rows) g.set(r.k, [...(g.get(r.k) ?? []), r]);
for (const [k, rs] of [...g].sort()) {
  console.log(
    `${k}\tn=${rs.length}\tVAD wait med ${med(rs.map((r) => r.vadWait))}\tVAD-stop→audio med ${med(rs.map((r) => r.afterVad))} (tool-first ${rs.filter((r) => r.toolFirst).length}/${rs.length})\ttotal med ${med(rs.map((r) => r.total))}`,
  );
}
const all = (c) => rows.filter((r) => r.k.startsWith(c));
for (const c of ["A", "B"]) {
  const rs = all(c);
  console.log(`${c} all: VAD wait med ${med(rs.map((r) => r.vadWait))}, stop→audio med ${med(rs.map((r) => r.afterVad))} worst ${Math.max(...rs.map((r) => r.afterVad ?? 0))}; tool-first turns ${rs.filter((r) => r.toolFirst).length}/${rs.length}; stop→audio when tool-first ${med(rs.filter((r) => r.toolFirst).map((r) => r.afterVad))} vs not ${med(rs.filter((r) => !r.toolFirst).map((r) => r.afterVad))}`);
}
for (const r of rows.filter((r) => r.total > 9000)) console.log("outlier", r.k, r.t.article, r.t.rep, r.t.turn, r.total, r.vadWait, r.afterVad, r.t.inputTranscript);
