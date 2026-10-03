/**
 * SPIKE driver. Start spike-server.ts first, then e.g.
 *   npx tsx evals/live/gpt-live-spike/spike-drive.ts --name=typed --audio=tone --ask="What does the article say about the lighthouse?" --seconds=30
 *   npx tsx evals/live/gpt-live-spike/spike-drive.ts --name=spoken --audio=mic --wav=evals/live/gpt-live-spike/spike-question.wav --seconds=35
 * Flags: --delay=ms --allow=1|min --bigInstr=words --bigBackend=words --askAfter=ms --headed=1
 * Writes evals/live/gpt-live-spike/spike-out-<name>.json (every data-channel event, both directions).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const arg = (k: string, d = "") => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const name = arg("name", "run");
const seconds = Number(arg("seconds", "30"));
const wav = arg("wav");
const qs = new URLSearchParams({ auto: "1", audio: arg("audio", "tone") });
for (const k of ["ask", "delay", "allow", "bigInstr", "bigBackend", "askAfter", "extra"]) if (arg(k)) qs.set(k, arg(k));

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: arg("headed") !== "1",
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    ...(wav ? [`--use-file-for-fake-audio-capture=${path.resolve(wav)}%noloop`] : []),
  ],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://127.0.0.1:5398/?${qs}`);
const flag = (k: string) => page.evaluate((key) => (window as any)[key] === true, k);
const until = async (k: string, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await flag(k)) return true;
    if (await flag("__failed")) return false;
    if (await flag("__closed")) return k === "__closed";
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
const started = await until("__started", 20_000);
console.log("started:", started);
if (started) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end && !(await flag("__closed"))) await new Promise((r) => setTimeout(r, 500));
  if (!(await flag("__closed"))) {
    await page.evaluate(() => (window as any).closeSession());
    console.log("closed after session.close:", await until("__closed", 15_000));
  } else console.log("session closed by itself");
}
const dump = await page.evaluate(() => ({ notes: (window as any).__notes, events: (window as any).__events, levels: (window as any).__levels }));
const out = `evals/live/gpt-live-spike/spike-out-${name}.json`;
writeFileSync(out, JSON.stringify(dump, null, 1));
console.log("wrote", out, "events:", dump.events.length);
await browser.close();
