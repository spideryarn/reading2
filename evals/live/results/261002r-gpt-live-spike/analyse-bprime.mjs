// B against B' ("speak, then point"), the follow-up to docs/investigations/261002r-gpt-live-spike.md.
// node evals/live/results/261002r-gpt-live-spike/analyse-bprime.mjs
import { readFileSync } from "node:fs";
const root = new URL(".", import.meta.url).pathname;
const load = (f) => readFileSync(`${root}/${f}`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const recs = [...load("bprime-short-sessions.jsonl"), ...load("bprime-long-sessions.jsonl")];
const med = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)) : null;
};
const max = (xs) => Math.max(...xs.filter(Number.isFinite));
const turns = recs.flatMap((r) => r.turns);
for (const art of ["short", "long"])
  for (const c of ["B", "Bp"])
    for (const k of ["follow-up", "article"]) {
      const ts = turns.filter((t) => t.config === c && t.article === art && (k === "follow-up" ? t.scenario === 1 : t.scenario !== 1));
      if (!ts.length) continue;
      const fa = ts.map((t) => t.firstAudioMs);
      const words = ts.map((t) => t.utterances.map((u) => u.text).join(" ").split(/\s+/).filter(Boolean).length);
      const right = ts.filter((t) => t.passages.some((p) => p.right)).length;
      const pre = ts.filter((t) => t.utterances.length > 1).length;
      console.log(
        `${art}\t${c}\t${k}\tn=${ts.length}\tfirst audio med ${med(fa)} worst ${max(fa)}\tshow_passage ${ts.filter((t) => t.passages.length).length}/${ts.length}\tright ${k === "article" ? `${right}/${ts.length}` : "n/a"}\twords med ${med(words)}\tturns with a separate preamble ${pre}/${ts.length}`,
      );
    }
const cost = (c) => recs.filter((r) => r.config === c).reduce((a, r) => a + r.costUsd, 0);
console.log(`spend: B $${cost("B").toFixed(3)}, B' $${cost("Bp").toFixed(3)}`);
