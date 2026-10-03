/** SPIKE: the evidence from one run. npx tsx evals/live/gpt-live-spike/spike-summary.ts <name> [full] */
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(`evals/live/gpt-live-spike/spike-out-${process.argv[2]}.json`, "utf8"));
const full = process.argv[3] === "full";
const J = (x: unknown) => JSON.stringify(x);
console.log(`\n===== ${process.argv[2]} =====`);
console.log("notes:", J({ ...d.notes, sessionHttp: d.notes.sessionHttp && { ...d.notes.sessionHttp } }));
const counts: Record<string, number> = {};
let outT = "", inT = "";
for (const e of d.events) {
  const ev = e.ev;
  const inner = ev.type === "response.event" ? `/${ev.event?.type}` : "";
  const k = `${e.dir} ${ev.type}${inner}`;
  counts[k] = (counts[k] ?? 0) + 1;
  if (ev.type === "session.started") {
    const s = ev.session;
    console.log(`${e.t} session.started keys=${J(Object.keys(ev))} session keys=${J(Object.keys(s))} expires_at-now=${s.expires_at - Math.round(e.wall / 1000)}s client=${J(s.client)}`);
    if (full) console.log(J({ ...ev, session: { ...s, instructions: "<cut>", delegation: "<cut>" } }));
  } else if (ev.type === "session.output_transcript.delta") outT += `[${e.t}|${ev.start_ms}-${ev.end_ms}]${ev.delta}`;
  else if (ev.type === "session.input_transcript.delta") { inT += `[${e.t}|${ev.start_ms}-${ev.end_ms}]${ev.delta}`; if (full) console.log(e.t, J(ev)); }
  else if (ev.type === "session.delegation.created" || ev.type === "session.usage.updated" || ev.type === "error" || ev.type === "info") console.log(e.t, e.dir, J(ev));
  else if (ev.type === "session.closed") console.log(e.t, e.dir, J({ ...ev, session: { id: ev.session.id, expires_at: ev.session.expires_at, status: ev.session.status, "...": "cut" } }));
  else if (e.dir === "out") console.log(e.t, "out", J(ev));
  else if (ev.type === "response.event") {
    const b = ev.event;
    if (b.type === "response.output_item.done") console.log(e.t, "in", J(ev));
    else if (b.type === "response.completed" || b.type === "response.failed" || b.type === "response.incomplete" || b.type === "error")
      console.log(e.t, "in", `response.event/${b.type} delegation_id=${ev.delegation_id} id=${b.response?.id} status=${b.response?.status} usage=${J(b.response?.usage)} model=${b.response?.model}` + (full ? ` FULL=${J(ev)}` : ""));
    else if (b.type === "response.created") console.log(e.t, "in", `response.event/response.created delegation_id=${ev.delegation_id} id=${b.response?.id}`);
  } else if (e.dir === "in") console.log(e.t, "in (other)", J(ev).slice(0, 400));
}
console.log("INPUT TRANSCRIPT:", inT || "(none)");
console.log("OUTPUT TRANSCRIPT:", outT || "(none)");
console.log("counts:", J(counts));
console.log("REMOTE AUDIO peak>0.02 at t(ms):", (d.levels ?? []).filter((l: any) => l.peak > 0.02).map((l: any) => l.t).join(" ") || "(never)", `samples=${(d.levels ?? []).length}`);
