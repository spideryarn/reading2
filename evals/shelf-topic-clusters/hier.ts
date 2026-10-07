/**
 * **The shipped re-think and filing, measured** — PAID, a few cents:
 *
 *     npx tsx evals/shelf-topic-clusters/hier.ts            # both shelves → results/hier-<shelf>.md
 *     npx tsx evals/shelf-topic-clusters/hier.ts --shelf expert
 *
 * It calls `rethink` and `fileWorks` from src/shelf-terms/model-topics.ts, so
 * what it measures is what ships. Two shelves, both of which record what each
 * article was written to be about, which the model never sees:
 *
 * - **greg-wide** (96 articles over twelve areas; ../shelf-topics/synthetic/).
 * - **expert** (172: 160 neuroscience over ten sub-areas, 7 Buddhism, 5
 *   carpentry; shelves/expert.json). Greg's own example of 2026-10-03.
 *   **Above the 150 works the product re-thinks** (`MAX_WORKS`), so this run
 *   exercises the sample-and-file path the product does not use yet.
 * - **expert-150**: the first 150 of that shelf, which is what ships.
 *
 * Two questions:
 *
 * 1. **Is the tree right?** The whole shelf is re-thought. For each intended
 *    category, the best F1 any topic reaches against that category's articles,
 *    and at which depth.
 * 2. **Is filing a new article right, judged against something other than the
 *    model's own earlier answer?** Every fifth article is held out. The other
 *    four fifths are re-thought; the held-out fifth is then filed. Each
 *    intended category is matched to its best topic on the four fifths, and a
 *    held-out article is scored on whether filing put it in the topics its own
 *    categories map to (recall), and on how many of the topics it was put in
 *    are **wrong**: neither one of its targets, nor above one, nor inside one.
 *    The same scores for the four fifths (where the re-think placed them) are
 *    the bar. A category with no topic matching at F1 ≥ 0.6 cannot be scored
 *    and is listed, as is every article left unscored because of it.
 *
 * One run each, one fixed hold-out (every fifth). It does not show variance
 * between runs, the effect of article order, whether a re-think keeps the
 * previous labels, or anything about a real shelf.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { openRouterJson } from "../../src/ai-call.js";
import { withLedger } from "../../src/cli-ledger.js";
import { loadEnvLocal } from "../../src/env.js";
import type { JsonGateway, TopicCalls, TopicSet, TopicWork } from "../../src/shelf-terms/model-topics.js";
import { EVAL_DIR as TOPICS_EVAL_DIR } from "../shelf-topics/case.js";

loadEnvLocal();

const HERE = import.meta.dirname;

/* **What is measured is the shipped module**, unless `--impl <file>` names
   another: the *before* arm of a prompt change, when the old module is kept
   beside this file for the length of the comparison (`git show
   <commit>:src/shelf-terms/model-topics.ts`, its imports repointed). */
const implAt = process.argv.indexOf("--impl");
const { fileBatch, fileWorks, granularityOf, nameTopics, rethink } = (await import(
  implAt >= 0 && process.argv[implAt + 1] ? path.resolve(process.argv[implAt + 1]!) : "../../src/shelf-terms/model-topics.js"
)) as typeof import("../../src/shelf-terms/model-topics.js");

interface Article extends TopicWork {
  /** The categories it was written for. */
  truth: string[];
}
interface Shelf {
  id: string;
  profile: string | null;
  articles: Article[];
}

function loadShelf(id: string): Shelf {
  if (id === "greg-wide") {
    const j = JSON.parse(readFileSync(path.join(TOPICS_EVAL_DIR, "synthetic", "greg-wide.json"), "utf8")) as {
      profile: string;
      articles: { slug: string; title: string; gist: string; intended: string[] }[];
    };
    return { id, profile: j.profile, articles: j.articles.map((a) => ({ id: a.slug, title: a.title, gist: a.gist, truth: a.intended })) };
  }
  const file = id === "expert-150" ? "expert" : id;
  const j = JSON.parse(readFileSync(path.join(HERE, "shelves", `${file}.json`), "utf8")) as {
    profile: string;
    articles: { slug: string; title: string; gist: string; area: string; sub: string[] }[];
  };
  return {
    id,
    profile: j.profile,
    articles: j.articles
      .slice(0, id === "expert-150" ? 150 : j.articles.length)
      .map((a) => ({ id: a.slug, title: a.title, gist: a.gist, truth: [...new Set([a.area, ...a.sub])] })),
  };
}

/** Counts every call's tokens, cost and time while passing it through unchanged. */
function metered(): { gateway: JsonGateway; calls: { usd: number; ms: number; tokensIn: number; tokensOut: number }[] } {
  const calls: { usd: number; ms: number; tokensIn: number; tokensOut: number }[] = [];
  const gateway: JsonGateway = async (job, body, options) => {
    const t0 = performance.now();
    const call = await openRouterJson(job, body, options);
    const u = (call.json as { usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; cost_details?: { upstream_inference_cost?: number } } } | null)?.usage;
    calls.push({
      usd: u?.cost || u?.cost_details?.upstream_inference_cost || 0,
      ms: performance.now() - t0,
      tokensIn: u?.prompt_tokens ?? 0,
      tokensOut: u?.completion_tokens ?? 0,
    });
    return call;
  };
  return { gateway, calls };
}

function callsWith(gateway: JsonGateway): TopicCalls {
  return {
    name: (works, name, forbidKey) => nameTopics(works, name, forbidKey, { gateway }),
    file: (tree, works, within) => fileBatch(tree, works, within, { gateway }),
  };
}

/** topic id → the article ids in it. */
function topicMembers(set: TopicSet): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(set.topics.map((t) => [t.id, new Set<string>()]));
  for (const [work, ids] of set.members) for (const id of ids) out.get(id)?.add(work);
  return out;
}

function f1(a: Set<string>, b: Set<string>): number {
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  if (hit === 0) return 0;
  const p = hit / a.size;
  const r = hit / b.size;
  return (2 * p * r) / (p + r);
}

/** For each intended category among `articles`: its best-matching topic. */
function bestTopics(set: TopicSet, articles: Article[]): Map<string, { topic: string; label: string; depth: number; f1: number; size: number }> {
  const cats = new Map<string, Set<string>>();
  for (const a of articles) for (const c of a.truth) cats.set(c, (cats.get(c) ?? new Set()).add(a.id));
  const members = topicMembers(set);
  const out = new Map<string, { topic: string; label: string; depth: number; f1: number; size: number }>();
  for (const [cat, ids] of cats) {
    let best = { topic: "", label: "(none)", depth: -1, f1: 0, size: ids.size };
    for (const t of set.topics) {
      const score = f1(members.get(t.id) ?? new Set(), ids);
      if (score > best.f1) best = { topic: t.id, label: t.label, depth: t.depth, f1: score, size: ids.size };
    }
    out.set(cat, best);
  }
  return out;
}

function drawTree(set: TopicSet): string[] {
  const members = topicMembers(set);
  const lines: string[] = [];
  const walk = (parent: string | null): void => {
    const kids = set.topics.filter((t) => t.parent === parent).sort((a, b) => (members.get(b.id)?.size ?? 0) - (members.get(a.id)?.size ?? 0));
    for (const t of kids) {
      lines.push(`${"    ".repeat(t.depth)}- ${t.label} ${members.get(t.id)?.size ?? 0} (granularity ${granularityOf(t.depth)})`);
      walk(t.id);
    }
  };
  walk(null);
  return lines;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

async function runShelf(id: string): Promise<void> {
  const shelf = loadShelf(id);
  const out: string[] = [`# ${id}: the shipped re-think and filing`, "", `Generated by \`evals/shelf-topic-clusters/hier.ts\`. ${shelf.articles.length} articles.`, ""];

  /* ── 1. the whole shelf ── */
  const whole = metered();
  const t0 = performance.now();
  const set = await rethink(shelf.articles, callsWith(whole.gateway), { profile: shelf.profile });
  const wallS = (performance.now() - t0) / 1000;
  const inAny = [...set.members.values()].filter((ids) => ids.length > 0).length;
  out.push("## The whole shelf, re-thought", "");
  out.push(
    `${set.topics.length} topics (${[0, 1, 2].map((d) => `${set.topics.filter((t) => t.depth === d).length} at depth ${d}`).join(", ")}). ` +
      `${inAny} of ${shelf.articles.length} articles are in at least one. ` +
      `${whole.calls.length} calls, $${sum(whole.calls.map((c) => c.usd)).toFixed(4)}, ${wallS.toFixed(0)} s wall clock ` +
      `(${sum(whole.calls.map((c) => c.tokensIn))} tokens in, ${sum(whole.calls.map((c) => c.tokensOut))} out).`,
    "",
    ...drawTree(set),
    "",
    "| intended category | articles | best topic | depth | F1 |",
    "|---|---|---|---|---|",
  );
  const best = bestTopics(set, shelf.articles);
  for (const [cat, b] of [...best].sort((a, b) => b[1].size - a[1].size)) out.push(`| ${cat} | ${b.size} | ${b.label} | ${b.depth} | ${b.f1.toFixed(2)} |`);
  const scores = [...best.values()].map((b) => b.f1);
  out.push("", `Mean F1 ${(sum(scores) / scores.length).toFixed(2)}; ${scores.filter((s) => s >= 0.6).length} of ${scores.length} categories matched at F1 ≥ 0.6.`, "");

  /* **How inclusive, and whether too inclusive** (plan 261004j; GPT Sol's
     plan review). The filing score below forgives any topic inside a right
     broad one, so an article put in every finer topic of its field would look
     fine there. Here nothing is forgiven: an article's *specific* topics are
     the ones it is in with no finer topic of its own beneath them, and one is
     right only if it is the best topic of a category the article was written
     for. */
  {
    const parentOf = new Map(set.topics.map((t) => [t.id, t.parent]));
    const targetOf = new Map([...best].filter(([, b]) => b.f1 >= 0.6).map(([cat, b]) => [cat, b.topic]));
    let specific = 0;
    let specificRight = 0;
    let want = 0;
    let got = 0;
    let total = 0;
    for (const a of shelf.articles) {
      const has = set.members.get(a.id) ?? [];
      total += has.length;
      const targets = new Set(a.truth.map((c) => targetOf.get(c)).filter((t): t is string => Boolean(t)));
      const parents = new Set(has.map((id) => parentOf.get(id)).filter(Boolean));
      for (const id of has) {
        if (parents.has(id)) continue;
        specific++;
        if (targets.has(id)) specificRight++;
      }
      want += targets.size;
      got += [...targets].filter((t) => has.includes(t)).length;
    }
    const members = topicMembers(set);
    const ratios = set.topics.filter((t) => t.parent).map((t) => (members.get(t.id)?.size ?? 0) / Math.max(1, members.get(t.parent!)?.size ?? 0));
    out.push(
      "## How inclusive",
      "",
      `Topics per article: ${(total / shelf.articles.length).toFixed(2)}. ` +
        `Share of each article's intended topics it is in: ${(want ? got / want : 0).toFixed(2)}. ` +
        `Share of its specific placements that are an intended topic (nothing forgiven): ${(specific ? specificRight / specific : 0).toFixed(2)} of ${specific}. ` +
        `Largest finer topic as a share of its parent: ${ratios.length ? Math.max(...ratios).toFixed(2) : "none"}.`,
      "",
    );
  }

  /* ── 2. hold out every fifth, re-think the rest, file the held-out ── */
  const held = shelf.articles.filter((_, i) => i % 5 === 4);
  const kept = shelf.articles.filter((_, i) => i % 5 !== 4);
  const base = metered();
  const baseSet = await rethink(kept, callsWith(base.gateway), { profile: shelf.profile });
  const filing = metered();
  const f0 = performance.now();
  const filed = await fileWorks(baseSet.topics, held, callsWith(filing.gateway));
  const fileS = (performance.now() - f0) / 1000;
  const map = bestTopics(baseSet, kept);
  /* Only categories the tree actually has a topic for can be scored. */
  const usable = new Map([...map].filter(([, b]) => b.f1 >= 0.6));
  const unmatched = [...map].filter(([, b]) => b.f1 < 0.6).map(([cat, b]) => `${cat} (${b.size} articles, best F1 ${b.f1.toFixed(2)})`);
  const parentOf = new Map(baseSet.topics.map((t) => [t.id, t.parent]));
  const above = (id: string): string[] => {
    const out: string[] = [];
    for (let p = parentOf.get(id); p; p = parentOf.get(p)) out.push(p);
    return out;
  };
  const score = (articles: Article[], topicsOf: (id: string) => string[]) => {
    let want = 0;
    let got = 0;
    let exact = 0;
    let n = 0;
    let placed = 0;
    let wrong = 0;
    for (const a of articles) {
      const targets = a.truth.map((c) => usable.get(c)?.topic).filter((t): t is string => Boolean(t));
      if (targets.length === 0) continue;
      n++;
      const has = topicsOf(a.id);
      const hits = targets.filter((t) => has.includes(t)).length;
      want += targets.length;
      got += hits;
      if (hits === targets.length) exact++;
      /* Fine: a target, a topic above a target, or a topic inside a target. Anything else is a wrong placement. */
      const fine = new Set([...targets, ...targets.flatMap(above)]);
      for (const t of has) {
        placed++;
        if (!fine.has(t) && !above(t).some((p) => targets.includes(p))) wrong++;
      }
    }
    return { n, recall: want ? got / want : 0, all: n ? exact / n : 0, wrong: placed ? wrong / placed : 0 };
  };
  const bar = score(kept, (id) => baseSet.members.get(id) ?? []);
  const got = score(held, (id) => filed.get(id) ?? []);
  const nowhere = held.filter((a) => (filed.get(a.id) ?? []).length === 0).length;
  out.push(
    "## Filing new articles, against what they were written to be about",
    "",
    `Every fifth article held out (${held.length}); the other ${kept.length} re-thought into ${baseSet.topics.length} topics; the held-out filed in ${filing.calls.length} calls, ` +
      `$${sum(filing.calls.map((c) => c.usd)).toFixed(4)} ($${(sum(filing.calls.map((c) => c.usd)) / held.length).toFixed(5)} an article), ${fileS.toFixed(0)} s.`,
    "",
    `${usable.size} of ${map.size} intended categories have a topic matching at F1 ≥ 0.6 in that tree; only those can be scored.` +
      (unmatched.length ? ` **Not matched, so not scored: ${unmatched.join("; ")}.**` : ""),
    "",
    "| | articles scored | not scored | share of their intended topics they are in | in all of them | share of their placements that are wrong |",
    "|---|---|---|---|---|---|",
    `| placed by the re-think (the bar) | ${bar.n} | ${kept.length - bar.n} | ${bar.recall.toFixed(2)} | ${bar.all.toFixed(2)} | ${bar.wrong.toFixed(2)} |`,
    `| **filed afterwards** | ${got.n} | ${held.length - got.n} | ${got.recall.toFixed(2)} | ${got.all.toFixed(2)} | ${got.wrong.toFixed(2)} |`,
    "",
    "A placement is wrong when the topic is neither one the article's categories map to, nor above one, nor inside one. Several intended categories may map to the same topic.",
    "",
    `${nowhere} of ${held.length} held-out articles were filed under no topic at all.`,
    "",
  );

  /* `--tag v2` writes hier-<shelf>-v2.md, so one arm never overwrites another
     (docs/project/prompting-guide.md § Measuring a prompt change). */
  const tagAt = process.argv.indexOf("--tag");
  const tag = tagAt >= 0 && process.argv[tagAt + 1] ? `-${process.argv[tagAt + 1]}` : "";
  writeFileSync(path.join(HERE, "results", `hier-${id}${tag}.md`), `${out.join("\n")}\n`);
  console.log(out.join("\n"));
}

async function main(): Promise<void> {
  const at = process.argv.indexOf("--shelf");
  const only = at >= 0 ? process.argv[at + 1] : undefined;
  for (const id of ["greg-wide", "expert-150", "expert"]) if (!only || only === id) await runShelf(id);
}

await withLedger("eval", main);
