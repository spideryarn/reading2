// Read-only: GET stored source PDFs from production's `sources` bucket into the scratchpad.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const S = new URL(`file://${process.env.FD_DATA}/`);
const env = readFileSync(`${process.env.SPIDERYARN_PRIMARY ?? "/home/greg/code/spideryarn2"}/.env.prod`, "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const base = get("SUPABASE_URL");
const key = get("SUPABASE_SERVICE_ROLE_KEY");
const snap = JSON.parse(readFileSync(new URL("fd-snapshot.json", S), "utf8"));
const want = process.argv.slice(2);
console.log(`Target: ${new URL(base).host} storage (GET only)`);
for (const a of snap.articles) {
  if (!want.some((w) => a.slug.includes(w))) continue;
  for (const sha of new Set([a.raw_source_sha256, a.raw_sha256].filter(Boolean))) {
    const res = await fetch(`${base}/storage/v1/object/sources/sha256/${sha}.pdf`, { headers: { authorization: `Bearer ${key}`, apikey: key } });
    if (!res.ok) {
      console.log(`${a.slug.slice(0, 40)} ${sha.slice(0, 10)} -> ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const got = createHash("sha256").update(buf).digest("hex");
    const name = `fd-src-${a.slug.slice(0, 30)}.pdf`;
    writeFileSync(new URL(name, S), buf);
    console.log(`${a.slug.slice(0, 40)} ${buf.length} bytes sha ${got === sha ? "matches" : "DIFFERS"} -> ${name}`);
    break;
  }
}
