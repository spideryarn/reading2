import fs from "node:fs";
const env = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const key = /OPENROUTER_API_KEY\s*=\s*(.+)/.exec(env)[1].trim().replace(/^["']|["']$/g,"");
const D = new URL(".", import.meta.url).pathname;
const bytes = fs.readFileSync(`${D}sample-long.webm`);
const TRUTH = "Spideryarn's granularity zoom renders an article at several levels of compression. Every block gets a stable identifier like spya k3m9qt, and the deeply nested table of contents addresses text by that id rather than by character offset. The reader profile rides in every prompt, and OpenRouter is the sole gateway for request path calls.";

const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
function wer(ref, hyp) {
  const r = norm(ref).split(" "), h = norm(hyp).split(" ");
  const d = Array.from({length:r.length+1},(_,i)=>Array.from({length:h.length+1},(_,j)=> i===0?j: j===0?i:0));
  for (let i=1;i<=r.length;i++) for (let j=1;j<=h.length;j++)
    d[i][j] = r[i-1]===h[j-1] ? d[i-1][j-1] : 1+Math.min(d[i-1][j],d[i][j-1],d[i-1][j-1]);
  return d[r.length][h.length]/r.length;
}
async function run(model) {
  const fd = new FormData();
  fd.set("file", new Blob([bytes], {type:"audio/webm"}), "a.webm");
  fd.set("model", model);
  const s = Date.now();
  try {
    const r = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", { method:"POST", headers:{Authorization:`Bearer ${key}`}, body: fd });
    const ms = Date.now()-s;
    const t = await r.text();
    if (!r.ok) return { model, ms, err: t.slice(0,90) };
    const j = JSON.parse(t);
    return { model, ms, wer: wer(TRUTH, j.text ?? ""), cost: j.usage?.cost, text: j.text };
  } catch (e) { return { model, ms: Date.now()-s, err: e.message }; }
}
const models = ["openai/gpt-4o-mini-transcribe","openai/gpt-4o-transcribe","openai/whisper-large-v3-turbo","openai/whisper-large-v3","openai/whisper-1","qwen/qwen3-asr-flash-2026-02-10","qwen/qwen3-asr-1.7b","mistralai/voxtral-mini-transcribe","deepgram/nova-3","nvidia/parakeet-tdt-0.6b-v3","google/chirp-3","microsoft/mai-transcribe-1.5","fish-audio/transcribe-1","x-ai/grok-stt-1.0","nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b","openai/gpt-transcribe"];
console.log("22.0s of speech, 95KB webm/opus. 3 runs each, median latency.\n");
for (const m of models) {
  const runs = [];
  for (let i=0;i<3;i++) runs.push(await run(m));
  const ok = runs.filter(r=>!r.err);
  const lat = ok.map(r=>r.ms).sort((a,b)=>a-b);
  if (!ok.length) { console.log(`${m.padEnd(50)} FAIL ${runs[0].err}`); continue; }
  console.log(`${m.padEnd(50)} ${String(`${lat[Math.floor(lat.length/2)]}ms`).padStart(7)} [${lat.join("/")}]  WER ${(ok[0].wer*100).toFixed(1)}%  $${(ok[0].cost??0).toFixed(6)}`);
}
console.log("\n--- sample outputs ---");
for (const m of ["openai/gpt-4o-mini-transcribe","openai/whisper-large-v3-turbo","qwen/qwen3-asr-flash-2026-02-10","deepgram/nova-3"]) {
  const r = await run(m); console.log(`\n${m}:\n  ${r.text ?? r.err}`);
}
