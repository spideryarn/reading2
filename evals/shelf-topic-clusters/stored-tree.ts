/**
 * **One reader's stored topic tree in production, as it is.** Read-only.
 *
 *     npx tsx evals/shelf-topic-clusters/stored-tree.ts --report spya-d4tp0y
 *     npx tsx evals/shelf-topic-clusters/stored-tree.ts --report <id> --find levin --json out.json
 *
 * The owner is whoever filed `--report` (a row in production `feedback`), so no
 * address or uuid is typed. Prints the tree with how many articles each topic
 * holds, the articles in no topic, and, with `--find <words>`, every article
 * whose title matches and the topics it is in. `--json <file>` also writes the
 * shelf (title, gist, stored topic labels) for an eval to replay.
 *
 * Every query runs inside one `begin read only` transaction that ends in
 * `rollback`, on the one production client `scripts/feedback-reporter.ts`
 * builds from `.env.prod`. Written for docs/plans/261004j (Greg's report
 * d4tp0y: the pills take in too few articles).
 */
import { writeFileSync } from "node:fs";

import { productionClient } from "../../scripts/feedback-reporter.js";

interface TopicRow {
  id: string;
  key: string;
  label: string;
  parent: string | null;
  depth: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const report = arg("report");
  if (!report) throw new Error("--report <feedback id> is required");
  const find = arg("find")?.toLowerCase();
  const json = arg("json");
  const { client, target } = productionClient();
  console.log(`Target: ${target}`);
  await client.connect();
  try {
    await client.query("begin read only");
    const owners = await client.query<{ owner_id: string }>("select owner_id from spideryarn.feedback where id = $1", [report]);
    if (owners.rows.length !== 1) throw new Error(`${owners.rows.length} feedback rows have that id`);
    const owner = owners.rows[0]!.owner_id;
    const set = (
      await client.query<{
        topics: TopicRow[] | null;
        members: Record<string, string[]> | null;
        works: number | null;
        unplaced: number | null;
        prompt_version: number | null;
        model: string | null;
        rethought_at: Date | null;
        filed_at: Date | null;
      }>(
        "select topics, members, works, unplaced, prompt_version, model, rethought_at, filed_at from spideryarn.shelf_topic_sets where owner_id = $1",
        [owner],
      )
    ).rows[0];
    const articles = (
      await client.query<{ id: string; archived: boolean; title: string | null; gist: string | null }>(
        `select a.id, a.archived_at is not null as archived,
                coalesce(a.title_override, r.title, a.slug) as title, coalesce(r.root_gist, r.abstract) as gist
           from spideryarn.articles a
           join spideryarn.article_revisions r on r.id = a.current_revision_id
          where a.owner_id = $1 and left(a.slug, 1) <> '_' and r.tree is not null
          order by coalesce(r.fetched_at, a.created_at) desc, a.slug asc`,
        [owner],
      )
    ).rows;
    const profile = (await client.query<{ profile: string | null }>("select profile from spideryarn.reader_profiles where owner_id = $1", [owner])).rows[0]?.profile ?? null;

    if (!set?.topics || !set.members) {
      console.log("No stored tree for this reader.");
      return;
    }
    const { topics, members } = set;
    console.log(
      `Tree:   ${topics.length} topics, prompt v${set.prompt_version}, ${set.model}; re-thought ${set.rethought_at?.toISOString()}, filed ${set.filed_at?.toISOString() ?? "never"}; ${set.works} works, ${set.unplaced} unplaced then.`,
    );
    console.log(`Shelf:  ${articles.length} articles (${articles.filter((a) => a.archived).length} archived).\n`);
    const byTopic = new Map<string, string[]>(topics.map((t) => [t.id, []]));
    const labelOf = new Map(topics.map((t) => [t.id, t.label]));
    let unfiled = 0;
    const nowhere: string[] = [];
    for (const a of articles) {
      const ids = members[a.id];
      if (!ids) unfiled += 1;
      else if (ids.length === 0) nowhere.push(a.title ?? "");
      else for (const id of ids) byTopic.get(id)?.push(a.title ?? "");
    }
    const walk = (parent: string | null): void => {
      for (const t of topics.filter((x) => x.parent === parent)) {
        console.log(`${"  ".repeat(t.depth)}${t.label}  (${byTopic.get(t.id)?.length ?? 0})`);
        walk(t.id);
      }
    };
    walk(null);
    const perArticle = articles.filter((a) => members[a.id]).map((a) => members[a.id]!.length);
    const mean = perArticle.reduce((s, n) => s + n, 0) / Math.max(1, perArticle.length);
    console.log(`\nTopics per filed article: mean ${mean.toFixed(2)}; in no topic: ${nowhere.length}; not yet filed: ${unfiled}.`);
    for (const t of nowhere) console.log(`  (no topic) ${t.slice(0, 100)}`);

    if (find) {
      console.log(`\nArticles matching "${find}":`);
      for (const a of articles.filter((x) => (x.title ?? "").toLowerCase().includes(find))) {
        const ids = members[a.id];
        console.log(`- ${a.title}\n    gist: ${a.gist ?? "(none)"}\n    in: ${ids ? ids.map((id) => labelOf.get(id)).join(" · ") || "(no topic)" : "(not yet filed)"}`);
      }
      console.log(`\nTopics matching "learn" or "memory", with their articles:`);
      for (const t of topics.filter((x) => /learn|memory/i.test(x.label))) {
        console.log(`- ${t.label} (depth ${t.depth})`);
        for (const title of byTopic.get(t.id) ?? []) console.log(`    · ${title.slice(0, 100)}`);
      }
    }
    if (json) {
      writeFileSync(
        json,
        JSON.stringify(
          {
            profile,
            topics,
            works: articles.map((a) => ({ id: a.id, title: a.title, gist: a.gist, archived: a.archived, stored: members[a.id] ?? null })),
          },
          null,
          1,
        ),
      );
      console.log(`\nWrote ${json}`);
    }
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
