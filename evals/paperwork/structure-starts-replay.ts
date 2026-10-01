/**
 * **Replay every retained `toc/10` Structure answer with its ends deleted.**
 *
 * ```
 * npx tsx evals/paperwork/structure-starts-replay.ts
 * ```
 *
 * The corpus is the parseable `before-*.raw.txt` answers plus every local
 * `hierarchy-structure` checkpoint. Each is built through today's ranged path,
 * then transformed mechanically to the starts-only DTO and built through
 * `modelNodeFromStarts`. The command is read-only: the direct checkpoint query
 * deliberately does not use `CheckpointStore.read`, whose contract updates
 * `last_used_at`.
 *
 * Article prose and model text are never printed. Equality includes titles, but
 * a readable diff identifies them only by a short SHA-256 fingerprint; ranges,
 * depths, child positions and aggregate counts are safe to report.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BuildReport, ModelNode } from "../../src/hierarchy.js";
import { buildTree } from "../../src/hierarchy.js";
import {
  modelNodeFromStarts,
  type StartsOnlyNode,
  type StartsOnlyRoot,
  type StartsOnlyStructureAnswer,
} from "../../src/hierarchy-starts.js";
import type { Block, Tree } from "../../src/types.js";

interface FlatNode {
  depth: number;
  title: string;
  range: [string, string];
}

export interface ReplayResult {
  label: string;
  baselineBuildable: boolean;
  newlyUnbuildable: boolean;
  additionalDroppedChildren: number;
  lostAuthoredHeadings: number;
  identical: boolean | null;
  diff: string[];
}

export interface ReplayGate {
  pass: boolean;
  reasons: string[];
}

function emptyReport(): BuildReport {
  return {
    repairs: [],
    droppedChildren: [],
    droppedHeadings: [],
    collapsedRungs: [],
    droppedQuestions: [],
  };
}

function fieldsWithoutRange(node: ModelNode): Omit<StartsOnlyRoot, "children"> {
  return {
    title: node.title,
    ...(node.gist !== undefined ? { gist: node.gist } : {}),
    ...(node.question !== undefined ? { question: node.question } : {}),
    ...(node.sourceHeading !== undefined ? { sourceHeading: node.sourceHeading } : {}),
  };
}

function childWithoutEnd(node: ModelNode): StartsOnlyNode {
  return {
    ...fieldsWithoutRange(node),
    start: node.range[0],
    ...(node.children !== undefined
      ? { children: node.children.map(childWithoutEnd) }
      : {}),
  };
}

/** Mechanically delete every range end, including all nested children. */
export function rangedAnswerWithoutEnds(answer: { root: ModelNode }): StartsOnlyStructureAnswer {
  return {
    root: {
      ...fieldsWithoutRange(answer.root),
      ...(answer.root.children !== undefined
        ? { children: answer.root.children.map(childWithoutEnd) }
        : {}),
    },
  };
}

function flatten(tree: Tree): FlatNode[] {
  const flat: FlatNode[] = [];
  const visit = (id: string): void => {
    const node = tree.nodes[id];
    if (node === undefined) throw new Error(`Tree refers to missing node ${id}.`);
    flat.push({ depth: node.depth, title: node.title, range: node.range });
    node.children.forEach(visit);
  };
  visit(tree.rootId);
  return flat;
}

function titleFingerprint(title: string): string {
  return createHash("sha256").update(title).digest("hex").slice(0, 10);
}

function safeNode(node: FlatNode | undefined): string {
  if (node === undefined) return "(missing)";
  return `depth=${node.depth} title#${titleFingerprint(node.title)} range=${node.range[0]}..${node.range[1]}`;
}

function diffFlat(before: readonly FlatNode[], after: readonly FlatNode[]): string[] {
  const lines: string[] = [];
  const count = Math.max(before.length, after.length);
  for (let i = 0; i < count; i++) {
    const left = before[i];
    const right = after[i];
    if (
      left?.depth === right?.depth &&
      left?.title === right?.title &&
      left?.range[0] === right?.range[0] &&
      left?.range[1] === right?.range[1]
    ) {
      continue;
    }
    lines.push(`#${i + 1} - ${safeNode(left)}`);
    lines.push(`#${i + 1} + ${safeNode(right)}`);
  }
  return lines;
}

function authoredHeadings(tree: Tree): string[] {
  return Object.values(tree.nodes).flatMap((node) =>
    node.sourceHeading === undefined ? [] : [node.sourceHeading],
  );
}

function lostAuthoredHeadingCount(before: Tree, after: Tree): number {
  const remaining = new Map<string, number>();
  for (const heading of authoredHeadings(after)) {
    remaining.set(heading, (remaining.get(heading) ?? 0) + 1);
  }
  let lost = 0;
  for (const heading of authoredHeadings(before)) {
    const count = remaining.get(heading) ?? 0;
    if (count === 0) lost += 1;
    else remaining.set(heading, count - 1);
  }
  return lost;
}

/** Build one paired replay and return only aggregate or privacy-safe evidence. */
export function replayStructureAnswer(
  label: string,
  answer: { root: ModelNode },
  blocks: readonly Block[],
): ReplayResult {
  const baselineReport = emptyReport();
  let baseline: Tree;
  try {
    baseline = buildTree(answer.root, {}, [...blocks], "offline-replay", baselineReport);
  } catch {
    return {
      label,
      baselineBuildable: false,
      newlyUnbuildable: false,
      additionalDroppedChildren: 0,
      lostAuthoredHeadings: 0,
      identical: null,
      diff: [],
    };
  }

  const candidateReport = emptyReport();
  let candidate: Tree;
  try {
    const starts = rangedAnswerWithoutEnds(answer);
    candidate = buildTree(
      modelNodeFromStarts(starts, blocks, candidateReport),
      {},
      [...blocks],
      "offline-replay",
      candidateReport,
    );
  } catch {
    return {
      label,
      baselineBuildable: true,
      newlyUnbuildable: true,
      additionalDroppedChildren: Math.max(
        0,
        candidateReport.droppedChildren.length - baselineReport.droppedChildren.length,
      ),
      lostAuthoredHeadings: authoredHeadings(baseline).length,
      identical: null,
      diff: [],
    };
  }

  const before = flatten(baseline);
  const after = flatten(candidate);
  const diff = diffFlat(before, after);
  return {
    label,
    baselineBuildable: true,
    newlyUnbuildable: false,
    additionalDroppedChildren: Math.max(
      0,
      candidateReport.droppedChildren.length - baselineReport.droppedChildren.length,
    ),
    lostAuthoredHeadings: lostAuthoredHeadingCount(baseline, candidate),
    identical: diff.length === 0,
    diff,
  };
}

/** Apply the plan's zero-loss gates and the 99% flattened-tree threshold. */
export function gateReplayResults(results: readonly ReplayResult[]): ReplayGate {
  const eligible = results.filter((result) => result.baselineBuildable);
  const newlyUnbuildable = eligible.filter((result) => result.newlyUnbuildable).length;
  const additionalDroppedChildren = eligible.reduce(
    (sum, result) => sum + result.additionalDroppedChildren,
    0,
  );
  const lostAuthoredHeadings = eligible.reduce((sum, result) => sum + result.lostAuthoredHeadings, 0);
  const identical = eligible.filter((result) => result.identical === true).length;
  const requiredIdentical = eligible.length < 100 ? eligible.length : Math.ceil(eligible.length * 0.99);
  const reasons = [
    ...(eligible.length === 0 ? ["no currently buildable answers were replayed"] : []),
    ...(newlyUnbuildable > 0 ? [`${newlyUnbuildable} newly unbuildable answer(s)`] : []),
    ...(additionalDroppedChildren > 0
      ? [`${additionalDroppedChildren} additional dropped child(ren)`]
      : []),
    ...(lostAuthoredHeadings > 0 ? [`${lostAuthoredHeadings} lost authored heading(s)`] : []),
    ...(identical < requiredIdentical
      ? [`${identical}/${eligible.length} identical flattened trees; need ${requiredIdentical}`]
      : []),
  ];
  return { pass: reasons.length === 0, reasons };
}

interface ReplaySource {
  label: string;
  slug: string;
  ownerId: string | undefined;
  raw: string;
}

function checkpointAnswer(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const answer = (value as Record<string, unknown>).answer;
  return typeof answer === "string" ? answer : null;
}

function slugFromBeforeFile(file: string): string | null {
  const match = /^before-(?:a[1-4]|o)-(.+)-\d+\.raw\.txt$/.exec(file);
  return match?.[1] ?? null;
}

async function sourcesFromLocalDatabase(): Promise<{
  sources: ReplaySource[];
  ownersBySlug: Map<string, string>;
}> {
  const [{ eq }, { getDb }, { articles, checkpoints }, { isLocalDatabaseUrl }] = await Promise.all([
    import("drizzle-orm"),
    import("../../src/db/client.js"),
    import("../../src/db/schema.js"),
    import("../../src/db/ssl.js"),
  ]);
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || !isLocalDatabaseUrl(databaseUrl)) {
    throw new Error("The Structure replay reads the local database only; DATABASE_URL is not local.");
  }
  const db = getDb();
  const articleRows = await db.select({ slug: articles.slug, ownerId: articles.ownerId }).from(articles);
  const ownersBySlug = new Map(articleRows.map((row) => [row.slug, row.ownerId]));
  const rows = await db
    .select({
      slug: articles.slug,
      ownerId: articles.ownerId,
      key: checkpoints.key,
      value: checkpoints.value,
    })
    .from(checkpoints)
    .innerJoin(articles, eq(checkpoints.articleId, articles.id))
    .where(eq(checkpoints.namespace, "hierarchy-structure"));
  const sources = rows.flatMap((row): ReplaySource[] => {
    const raw = checkpointAnswer(row.value);
    return raw === null
      ? []
      : [{ label: `checkpoint/${row.slug}/${row.key}`, slug: row.slug, ownerId: row.ownerId, raw }];
  });
  return { sources, ownersBySlug };
}

async function run(): Promise<void> {
  const [{ parseStructureAnswer }, { splitBlocks }, { loadArticle }, { runAsOwner }, { closeDb }] =
    await Promise.all([
      import("../../src/hierarchy.js"),
      import("../../src/supplement.js"),
      import("../../src/store/index.js"),
      import("../../src/owner.js"),
      import("../../src/db/client.js"),
    ]);
  const { sources: checkpoints, ownersBySlug } = await sourcesFromLocalDatabase();
  const rawDir = path.join(import.meta.dirname, "..", "results", "paperwork", "structure-parse");
  const raws = fs
    .readdirSync(rawDir)
    .filter((file) => /^before-.*\.raw\.txt$/.test(file))
    .sort()
    .flatMap((file): ReplaySource[] => {
      const slug = slugFromBeforeFile(file);
      const ownerId = slug === null ? undefined : ownersBySlug.get(slug);
      return slug === null || ownerId === undefined
        ? slug === null
          ? []
          : [{
              label: `raw/${file}`,
              slug,
              ownerId: undefined,
              raw: fs.readFileSync(path.join(rawDir, file), "utf8"),
            }]
        : [{
            label: `raw/${file}`,
            slug,
            ownerId,
            raw: fs.readFileSync(path.join(rawDir, file), "utf8"),
          }];
    });

  const results: ReplayResult[] = [];
  let parseSkipped = 0;
  let missingArticle = 0;
  for (const source of [...raws, ...checkpoints]) {
    if (source.ownerId === undefined) {
      missingArticle += 1;
      console.log(`SKIP ${source.label}: article is not in the local database`);
      continue;
    }
    let answer: { root: ModelNode };
    try {
      answer = parseStructureAnswer(source.raw);
    } catch {
      parseSkipped += 1;
      console.log(`SKIP ${source.label}: did not parse`);
      continue;
    }
    try {
      const article = await runAsOwner(source.ownerId as Parameters<typeof runAsOwner>[0], () =>
        loadArticle(source.slug),
      );
      const body = splitBlocks(article.blocks).body;
      const result = replayStructureAnswer(source.label, answer, body);
      results.push(result);
      console.log(
        `${result.baselineBuildable && !result.newlyUnbuildable ? "REPLAY" : "FAIL"} ${result.label}: ` +
          `baseline=${result.baselineBuildable ? "built" : "unbuildable"}, ` +
          `newly-unbuildable=${result.newlyUnbuildable ? 1 : 0}, ` +
          `dropped-children+=${result.additionalDroppedChildren}, ` +
          `lost-authored-headings=${result.lostAuthoredHeadings}, identical=${String(result.identical)}`,
      );
      if (result.identical === false) {
        for (const line of result.diff) console.log(`  ${line}`);
      }
    } catch {
      missingArticle += 1;
      console.log(`SKIP ${source.label}: article could not be read`);
    }
  }

  const eligible = results.filter((result) => result.baselineBuildable);
  const gate = gateReplayResults(results);
  console.log(
    `TOTAL answers=${results.length}, eligible=${eligible.length}, parse-skipped=${parseSkipped}, ` +
      `article-skipped=${missingArticle}, newly-unbuildable=${eligible.filter((r) => r.newlyUnbuildable).length}, ` +
      `dropped-children+=${eligible.reduce((sum, r) => sum + r.additionalDroppedChildren, 0)}, ` +
      `lost-authored-headings=${eligible.reduce((sum, r) => sum + r.lostAuthoredHeadings, 0)}, ` +
      `identical=${eligible.filter((r) => r.identical === true).length}/${eligible.length}`,
  );
  console.log(gate.pass ? "GATE PASS" : `GATE FAIL: ${gate.reasons.join("; ")}`);
  await closeDb();
  if (!gate.pass || missingArticle > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
