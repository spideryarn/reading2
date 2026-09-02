/* Word/block counts for the articles named in the LOCAL Postgres ledger. */
import pgMod from "/home/greg/code/spideryarn2/node_modules/pg/lib/index.js";
const { Client } = pgMod;
const url = process.env.DATABASE_URL;
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("refusing non-local DATABASE_URL");
const c = new Client({ connectionString: url });
await c.connect();
const { rows: cols } = await c.query(`select table_name, string_agg(column_name,', ' order by ordinal_position) cols from information_schema.columns where table_schema='spideryarn' and table_name in ('articles','article_revisions','revision_blocks') group by 1`);
for (const r of cols) console.log(r.table_name, "=>", r.cols, "\n");
const { rows } = await c.query(`
  select a.slug, r.title, r.id rev, count(b.*)::int blocks,
         count(*) filter (where b.gistable)::int gistable,
         sum(coalesce(b.words,0))::int words
  from spideryarn.articles a
  join spideryarn.article_revisions r on r.article_id = a.id
  left join spideryarn.revision_blocks b on b.revision_id = r.id
  where a.slug in ('replication-crisis-spya-hrjamq','own-spya-bf6g9b','todo','read','scaling-hypothesis','fowler-phrenology','towards-a-theory-of-bugs-the-ruliology-of-the-unexpected','what-if-we-had-bigger-brains-imagining-minds-beyond-ours')
  group by 1,2,3 order by 1`);
for (const r of rows) console.log(`${r.slug.padEnd(58)} blocks=${String(r.blocks).padEnd(5)} gistable=${String(r.gistable).padEnd(5)} words=${r.words}  "${(r.title??'').slice(0,50)}"`);
await c.end();
