/** SPIKE: print a run compactly. npx tsx evals/live/gpt-live-spike/spike-show.ts <name> [maxChars] */
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(`evals/live/gpt-live-spike/spike-out-${process.argv[2]}.json`, "utf8"));
const max = Number(process.argv[3] ?? 260);
for (const e of d.events) {
  const inner = e.ev.type === "response.event" ? `/${e.ev.event?.type}` : "";
  console.log(String(e.t).padStart(6), e.dir.padEnd(4), `${e.ev.type}${inner}`, JSON.stringify(e.ev).slice(0, max));
}
