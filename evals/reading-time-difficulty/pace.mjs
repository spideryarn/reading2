// Read-only: per-article reading pace from spideryarn.reading_time.
// usage: node --env-file=<env> rtd-pace.mjs [--json out.json]

import { writeFileSync } from "node:fs";

import pg from "pg";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("no DATABASE_URL");
const host = new URL(url).host;
console.log("Target:", host);
const local = host.startsWith("127.0.0.1") || host.startsWith("localhost");
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
await client.connect();
await client.query("BEGIN READ ONLY");
try {
  const ro = await client.query("show transaction_read_only");
  if (ro.rows[0].transaction_read_only !== "on") throw new Error("not read only");
  const { rows } = await client.query(`
    select a.id as article_id, a.owner_id, r.title, r.word_count,
           b.block_id, b.kind, b.tag, b.words, b.text, b.role, coalesce(t.seconds, 0) as seconds
    from spideryarn.articles a
    join spideryarn.article_revisions r on r.id = a.current_revision_id
    join spideryarn.revision_blocks b on b.revision_id = r.id
    left join spideryarn.reading_time t on t.article_id = a.id and t.block_id = b.block_id
    where a.id in (select distinct article_id from spideryarn.reading_time)
    order by a.id, b.ordinal`);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.article_id)) by.set(r.article_id, { id: r.article_id, owner: r.owner_id, title: r.title, wordCount: r.word_count, blocks: [] });
    by.get(r.article_id).blocks.push(r);
  }
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
  };
  const out = [];
  for (const a of by.values()) {
    // body prose only: no role (notes/apparatus), a paragraph-ish block of 25+ words
    const body = a.blocks.filter((b) => !b.role && b.words >= 25 && b.tag !== "pre");
    let letters = 0;
    let words = 0;
    for (const b of body)
      for (const w of b.text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? []) {
        letters += w.replace(/['’]/g, "").length;
        words++;
      }
    const WL = words ? letters / words : NaN;
    // ratio = seconds spent / seconds at 238 wpm
    const timed = body.filter((b) => b.seconds > 0).map((b) => ({ words: b.words, ratio: b.seconds / ((b.words * 60) / 238) }));
    // "one honest read": between 0.5x and 3x the flat time. Below is a glance, above is a re-read or idling.
    const once = timed.filter((x) => x.ratio >= 0.5 && x.ratio <= 3);
    const sumW = once.reduce((s, x) => s + x.words, 0);
    const pooled = once.length ? once.reduce((s, x) => s + x.ratio * x.words, 0) / sumW : NaN;
    out.push({
      id: a.id.slice(0, 8),
      owner: a.owner.slice(0, 4),
      title: (a.title ?? "").slice(0, 60),
      wordCount: a.wordCount,
      bodyBlocks: body.length,
      timedBlocks: timed.length,
      onceBlocks: once.length,
      onceWords: sumW,
      WL: +WL.toFixed(2),
      brysbaert: +(WL / 4.6).toFixed(2),
      medianRatioOnce: +median(once.map((x) => x.ratio)).toFixed(2),
      pooledRatioOnce: +pooled.toFixed(2),
      medianRatioAll: +median(timed.map((x) => x.ratio)).toFixed(2),
    });
  }
  out.sort((x, y) => y.onceWords - x.onceWords);
  console.log("articles with reading time:", out.length);
  console.table(out.filter((o) => o.onceBlocks >= 15));
  console.log("articles with < 15 once-read blocks (left out):", out.filter((o) => o.onceBlocks < 15).length);
  const i = process.argv.indexOf("--json");
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 1));
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
