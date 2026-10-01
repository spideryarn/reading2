// Read-only survey for 5Z (docs/plans/261001a-article-markup-keeps-only-what-we-allow-of-data-attributes-and-classes.md).
// Run from the repo root: node docs/plans/261001a-article-markup-allowlist-production-survey.mjs <env file>
// Every query runs inside BEGIN READ ONLY and ends in ROLLBACK; read its Target line.
import fs from "node:fs";
const W = process.cwd();
const pg = (await import(W + "/node_modules/pg/lib/index.js")).default;
const envFile = process.argv[2];
const url = fs.readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim();
const remote = !url.includes("127.0.0.1");
const client = new pg.Client({
  connectionString: url,
  ssl: remote ? { ca: fs.readFileSync(W + "/certs/supabase-ca.crt", "utf8") } : false,
});
await client.connect();
console.log("Target:", new URL(url).host);
await client.query("begin read only");
try {
  const q = async (label, sql) => {
    const r = await client.query(sql);
    console.log("\n==", label, `(${r.rows.length} rows)`);
    for (const row of r.rows) console.log(JSON.stringify(row));
  };
  await q("revision_blocks total", "select count(*) as blocks from spideryarn.revision_blocks");
  await q(
    "data-* attr names",
    `select lower(m[1]) as attr, count(*) n from spideryarn.revision_blocks b, regexp_matches(b.html, '\\s(data-[A-Za-z0-9_.:-]+)\\s*=', 'g') m group by 1 order by 2 desc limit 80`,
  );
  await q(
    "class tokens",
    `select tok, count(*) n from (select regexp_split_to_table(trim(m[1]), '\\s+') tok from spideryarn.revision_blocks b, regexp_matches(b.html, '\\sclass\\s*=\\s*"([^"]*)"', 'g') m) t where tok <> '' group by 1 order by 2 desc limit 80`,
  );
  await q(
    "forged client markings (attr)",
    `select b.block_id, substring(b.html from '(data-(block-link|block-preview|block-missing|xref|comment|mark-end|term|chat|hit|hues|dir|quote|wash|cite|zoom-kind)[^ >]*)') hit from spideryarn.revision_blocks b where b.html ~* '\\sdata-(block-link|block-preview|block-missing|xref|comment|mark-end|term|chat|chat-end|hit|hues|dir|quote|quote-start|quote-end|wash|cite|zoom-kind|open|[a-z]+-open)[\\s=>]' limit 40`,
  );
  await q(
    "forged client markings (class)",
    `select b.block_id, substring(b.html from 'class="[^"]*"') cls from spideryarn.revision_blocks b where b.html ~ 'class="([^"]*\\s)?(cmt|chat|term|hit|cite|xref|zoomable|zoom-btn|block-ref[a-z-]*)(\\s[^"]*)?"' limit 40`,
  );
  await q(
    "CONTROL attr (same shape, names known present)",
    `select count(*) from spideryarn.revision_blocks b where b.html ~* '\\sdata-(track-action|spya-note-ref)[\\s=>]'`,
  );
  await q(
    "CONTROL class (same shape, pdf-uncertain)",
    `select count(*) from spideryarn.revision_blocks b where b.html ~ 'class="([^"]*\\s)?(pdf-uncertain)(\\s[^"]*)?"'`,
  );
} finally {
  await client.query("rollback");
  await client.end();
}
