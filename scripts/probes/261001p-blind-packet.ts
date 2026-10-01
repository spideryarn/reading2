/**
 * **A blind-read packet for plan 261001p** — Opus against Sonnet, writer hidden.
 *
 *   npx tsx scripts/probes/261001p-blind-packet.ts   # free
 *
 * Takes runs 1–3 of `high-none-opus` / `high-none-opusctl` and
 * `high-none-sonnetnow` / `high-none-sonnetctl` on the PID paper, Olah and Gwern,
 * every level, shuffles them under neutral keys, and writes to
 * `data/probes/261001p-blind/` (gitignored, since it holds article text):
 * `articles.md` (every body block, by id), `levels.md` (what to read) and
 * `key.json` (which writer wrote each key — not for the reader).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";

const REPO = path.join(import.meta.dirname, "..", "..");
const RESULTS = path.join(REPO, "evals", "results", "simple");
const OUT = path.join(REPO, "data", "probes", "261001p-blind");
const PID = "entropy-24-00930-spya-pywwkq";
const SLUGS = [PID, "olah-a4-spya-ujr7p0", "scaling-hypothesis"];
const LEVELS = [["brief", "brief"], ["simple", "paragraphs"], ["fuller", "fuller"]] as const;

loadEnvLocal();
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const { loadArticle } = await import("../../src/store/index.js");
const { isBodyEvidence } = await import("../../src/block-policy.js");
const { closeDb } = await import("../../src/db/client.js");

type Para = { text: string; ids: string[] };
const items: { slug: string; level: string; writer: string; arm: string; paragraphs: Para[] }[] = [];
for (const [writer, pidArm, ctlArm] of [["opus", "high-none-opus", "high-none-opusctl"], ["sonnet", "high-none-sonnetnow", "high-none-sonnetctl"]] as const) {
  for (const i of [1, 2, 3]) {
    for (const slug of SLUGS) {
      const arm = `${slug === PID ? pidArm : ctlArm}${i}`;
      const run = JSON.parse(fs.readFileSync(path.join(RESULTS, arm, `${slug}.json`), "utf8")) as Record<string, unknown> & { ok: boolean };
      if (!run.ok) throw new Error(`${arm} ${slug} failed`);
      for (const [level, field] of LEVELS) items.push({ slug, level, writer, arm, paragraphs: run[field] as Para[] });
    }
  }
}
/* A fixed shuffle: sort by a hash of each item's identity. */
const h = (s: string) => createHash("sha256").update(`261001p:${s}`).digest("hex");
items.sort((a, b) => h(`${a.arm}/${a.slug}/${a.level}`).localeCompare(h(`${b.arm}/${b.slug}/${b.level}`)));

fs.mkdirSync(OUT, { recursive: true });
const key: Record<string, { writer: string; arm: string; slug: string; level: string }> = {};
const levels: string[] = [];
items.forEach((it, n) => {
  const k = `L${String(n + 1).padStart(2, "0")}`;
  key[k] = { writer: it.writer, arm: it.arm, slug: it.slug, level: it.level };
  levels.push(`## ${k} — article \`${it.slug}\``, "");
  it.paragraphs.forEach((p, j) => levels.push(`${j + 1}. ${p.text}  _(cites ${p.ids.join(", ")})_`, ""));
});
await runAsOwner(environmentOwnerId(), async () => {
  const art: string[] = [];
  for (const slug of SLUGS) {
    const a = await loadArticle(slug);
    art.push(`# Article \`${slug}\``, "");
    for (const b of a.blocks.filter(isBodyEvidence)) art.push(`[${b.id}] ${b.text}`, "");
  }
  fs.writeFileSync(path.join(OUT, "articles.md"), art.join("\n"));
});
fs.writeFileSync(path.join(OUT, "levels.md"), levels.join("\n"));
fs.writeFileSync(path.join(OUT, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
console.log(`${items.length} levels`);
await closeDb();
