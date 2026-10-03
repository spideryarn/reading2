import { readFileSync } from "node:fs";
// The numbers in docs/investigations/261002r-gpt-live-spike.md. node evals/live/results/261002r-gpt-live-spike/analyse.mjs
const root = new URL(".", import.meta.url).pathname;
const load = (d) => readFileSync(`${root}/${d}-sessions.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const recs = [...load("main").filter((r) => r.config === "A" || r.config === "B"), ...load("c-rerun")];
const med = (xs) => {
  const s = xs.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const p90 = (xs) => {
  const s = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)] : null;
};
const max = (xs) => {
  const s = xs.filter((x) => x !== null && Number.isFinite(x));
  return s.length ? Math.max(...s) : null;
};
const COST_IDS = new Set(["spya-ewxv9q", "spya-c5ejjt"]);
const right = (t) =>
  t.passages.some((p) => p.right || (t.question.startsWith("Why does he say GPT-3") && p.blockIds.some((id) => COST_IDS.has(id))));
const FILLER = /\b(let me|let's|i'll|one (sec|second|moment)|hang on|hold on|just a (sec|moment)|checking|check(ing)?|look(ing)?|pull(ing)?|give me a|sure|okay|ok|mm+|hmm+|uh|got it|good question|right|yeah|alright|on it|see)\b/i;
const isBack = (text) => {
  const w = text.trim().split(/\s+/).filter(Boolean);
  return w.length <= 2 || (w.length <= 9 && FILLER.test(text));
};
const turns = recs.flatMap((r) => r.turns);
const kind = (t) => (t.scenario === 1 ? "follow-up" : t.scenario === 3 ? "correction" : "article");
const sub = (t) => (kind(t) === "correction" ? t.afterCorrectionSubstantiveMs : t.firstSubstantiveMs);
console.log("config|kind\tn\tfirst audio med/p90/worst\tfirst SUBSTANTIVE med/p90/worst");
for (const c of ["A", "B", "C", "Cin"])
  for (const k of ["follow-up", "article", "correction"]) {
    const ts = turns.filter((t) => t.config === c && kind(t) === k);
    if (!ts.length) continue;
    const fa = ts.map((t) => t.firstAudioMs);
    const fs = ts.map(sub);
    console.log(`${c}|${k}\t${ts.length}\t${med(fa)}/${p90(fa)}/${max(fa)}\t${med(fs)}/${p90(fs)}/${max(fs)}\tnull ${fs.filter((x) => x == null).length}`);
  }
console.log("\nby article, article-question turns (s2+s4):");
for (const c of ["A", "B", "C", "Cin"])
  for (const a of ["short", "long"]) {
    const ts = turns.filter((t) => t.config === c && t.article === a && kind(t) === "article");
    if (!ts.length) continue;
    const fs = ts.map(sub);
    console.log(`${c}|${a}\t${ts.length}\tsubst ${med(fs)}/${max(fs)}\tshow_passage ${ts.filter((t) => t.passages.length).length}/${ts.length}\tright ${ts.filter(right).length}/${ts.length}`);
  }
console.log("\ngrounding + style per config (all turns):");
for (const c of ["A", "B", "C", "Cin"]) {
  const ts = turns.filter((t) => t.config === c);
  const art = ts.filter((t) => kind(t) === "article");
  const fu = ts.filter((t) => kind(t) === "follow-up");
  const words = ts.map((t) => {
    const us = t.utterances.filter((u) => !isBack(u.text));
    const last = kind(t) === "correction" ? us.slice(-1) : us;
    return last.map((u) => u.text).join(" ").split(/\s+/).filter(Boolean).length;
  });
  const fillerTurns = ts.filter((t) => t.utterances.some((u) => isBack(u.text))).length;
  const preamble = ts.filter((t) => t.utterances[0] && /\b(let me|let's|let’s|i'll|i’ll|checking|look)\b/i.test(t.utterances[0].text) ).length;
  console.log(
    `${c}\tturns ${ts.length}\tarticle show_passage ${art.filter((t) => t.passages.length).length}/${art.length} right ${art.filter(right).length}/${art.length}\tfollow-up show_passage ${fu.filter((t) => t.passages.length).length}/${fu.length}, delegated ${fu.filter((t) => (t.delegations ?? []).length).length}/${fu.length}\tanswer words med ${med(words)} p90 ${p90(words)}\tturns with a filler utterance ${fillerTurns}/${ts.length}\topening line announces a lookup ${preamble}/${ts.length}\tother tools ${ts.flatMap((t) => t.otherTools).length}`,
  );
}
console.log("\ncorrections (s3): did the final answer follow the correction (pointer to the corrected passage)?");
for (const c of ["A", "B", "C"]) {
  const ts = turns.filter((t) => t.config === c && t.scenario === 3);
  console.log(`${c}\t${ts.filter(right).length}/${ts.length}\tdelegations per turn ${JSON.stringify(ts.map((t) => (t.delegations ?? []).length))}`);
}
console.log("\ndelegation timeline (C, Cin; ms after question end):");
const ds = turns.filter((t) => t.config.startsWith("C") && kind(t) === "article").map((t) => t.delegations[0]).filter(Boolean);
for (const k of ["createdMs", "functionCallMs", "continuedMs", "firstTextMs", "completedMs"]) console.log(`${k}\tmed ${med(ds.map((d) => d[k]))}\tworst ${max(ds.map((d) => d[k]))}`);
const lag = turns.filter((t) => t.config.startsWith("C") && kind(t) === "article" && t.answerAvailableMs != null).map((t) => t.firstSubstantiveMs - t.answerAvailableMs);
console.log(`backend text starts -> voice speaks it: med ${med(lag)} worst ${max(lag)}`);
console.log("\ncost:");
for (const c of ["A", "B", "C", "Cin"]) {
  const rs = recs.filter((r) => r.config === c);
  const total = rs.reduce((a, r) => a + r.costUsd, 0);
  const mins = rs.reduce((a, r) => a + (r.billedSeconds ?? r.wallSeconds) / 60, 0);
  const n = rs.reduce((a, r) => a + r.turns.length, 0);
  for (const a of ["short", "long"]) {
    const ra = rs.filter((r) => r.article === a);
    if (!ra.length) continue;
    const ta = ra.reduce((x, r) => x + r.costUsd, 0);
    const na = ra.reduce((x, r) => x + r.turns.length, 0);
    console.log(`  ${c}|${a}\tper turn $${(ta / na).toFixed(4)}\tsessions ${ra.length}\tstartup med ${med(ra.map((r) => r.startupMs))} worst ${max(ra.map((r) => r.startupMs))}`);
  }
  console.log(`${c}\ttotal $${total.toFixed(3)}\tminutes ${mins.toFixed(1)}\tper minute $${(total / mins).toFixed(3)}\tper turn $${(total / n).toFixed(4)}\tparts ${JSON.stringify(Object.fromEntries(Object.entries(rs.reduce((a, r) => { for (const [k, v] of Object.entries(r.costParts)) a[k] = (a[k] ?? 0) + v; return a; }, {})).map(([k, v]) => [k, Number(v.toFixed(3))])))}`);
  if (c.startsWith("C")) {
    const bt = rs.reduce((a, r) => { for (const [k, v] of Object.entries(r.backendTokens ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {});
    console.log(`   backend tokens ${JSON.stringify(bt)}; max context ratio ${max(rs.map((r) => r.maxContextRatio))}`);
  } else {
    const bt = rs.reduce((a, r) => { for (const [k, v] of Object.entries(r.realtimeTokens ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {});
    console.log(`   realtime tokens ${JSON.stringify(bt)}`);
  }
}
