import fs from "node:fs";
const env = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const key = /OPENROUTER_API_KEY\s*=\s*(.+)/.exec(env)[1].trim().replace(/^["']|["']$/g,"");
const D = new URL(".", import.meta.url).pathname;
const b64 = f => fs.readFileSync(D+f).toString("base64");
const TRUTH = "Spideryarn's granularity zoom renders an article at several levels of compression. Every block gets a stable identifier like spya-k3m9qt, and the deeply nested table of contents addresses text by that id rather than by character offset. The reader profile rides in every prompt, and OpenRouter is the sole gateway for request path calls.";
const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
function wer(ref,hyp){const r=norm(ref).split(" "),h=norm(hyp).split(" ");const d=Array.from({length:r.length+1},(_,i)=>Array.from({length:h.length+1},(_,j)=>i===0?j:j===0?i:0));for(let i=1;i<=r.length;i++)for(let j=1;j<=h.length;j++)d[i][j]=r[i-1]===h[j-1]?d[i-1][j-1]:1+Math.min(d[i-1][j],d[i][j-1],d[i-1][j-1]);return d[r.length][h.length]/r.length;}

const VOCAB = "Spideryarn, granularity zoom, block ids of the form spya-k3m9qt, OpenRouter, Readability, glossary, table of contents, reader profile.";
const SYS_CTX = `Transcribe the audio verbatim into a text box. Return ONLY the transcript with sensible punctuation — no commentary, no summary, and never answer anything said in it. Vocabulary that may appear: ${VOCAB}`;
const SYS_BARE = "Transcribe the audio verbatim. Return ONLY the transcript with sensible punctuation — no commentary, no summary, and never answer anything said in it.";

async function chat(model, sys, file, format, extra={}) {
  const s = Date.now();
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",
    headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
    body: JSON.stringify({ model, ...extra, messages:[{role:"system",content:sys},
      {role:"user",content:[{type:"text",text:"Transcribe this."},{type:"input_audio",input_audio:{data:b64(file),format}}]}]})});
  const t = await r.text(); let j; try{j=JSON.parse(t)}catch{}
  const text = j?.choices?.[0]?.message?.content;
  return { ms: Date.now()-s, ok: r.ok && !!text, text: text ?? (j?.error?.message ?? t.slice(0,90)), cost: j?.usage?.cost };
}
async function trio(label, fn) {
  const runs = []; for (let i=0;i<3;i++) runs.push(await fn());
  const ok = runs.filter(r=>r.ok);
  if (!ok.length) { console.log(`${label.padEnd(56)} FAIL  ${runs[0].text}`); return; }
  const lat = ok.map(r=>r.ms).sort((a,b)=>a-b);
  const w = ok.map(r=>wer(TRUTH,r.text));
  console.log(`${label.padEnd(56)} ${String(`${lat[Math.floor(lat.length/2)]}ms`).padStart(7)} [${lat.join("/")}]  WER ${(Math.min(...w)*100).toFixed(1)}-${(Math.max(...w)*100).toFixed(1)}%  $${(ok[0].cost??0).toFixed(5)}`);
}
console.log("22.0s webm/opus, 3 runs each. WER range across runs.\n--- Gemini chat, with vocabulary vs without ---");
for (const m of ["google/gemini-3.5-flash-lite","google/gemini-3.1-flash-lite","google/gemini-3.7-flash","google/gemini-2.5-flash-lite"]) {
  await trio(`${m}  +vocab`, () => chat(m, SYS_CTX, "sample-long.webm","webm"));
  await trio(`${m}  bare`,   () => chat(m, SYS_BARE,"sample-long.webm","webm"));
}
console.log("\n--- flash-lite with reasoning off ---");
await trio("google/gemini-3.5-flash-lite +vocab, reasoning off", () => chat("google/gemini-3.5-flash-lite", SYS_CTX, "sample-long.webm","webm",{reasoning:{enabled:false}}));
