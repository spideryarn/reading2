/**
 * **Two places decide whether a step's output is fresh, and this file holds
 * them to one answer.**
 *
 * - **The queue** skips a step when `stepIsDone` says yes (src/pipeline.ts): a
 *   `done` run row, readable artefacts, and the step's `stamp` — what it would
 *   write today — equal to what the store recorded.
 * - **The reader** is told a step is current when
 *   `articleMetadata(...).stages[].done` says yes (src/store/pg.ts): a `done`
 *   run row and `isCurrent(step)`, a switch with an arm of its own per step.
 *
 * Nothing joins them. Each arm of `isCurrent` re-derives its step's expected
 * stamp by hand, from the revision row rather than through the store, and they
 * have drifted before — the Tweets arm compared only the article until
 * 2026-10-01, so a thread from an older prompt was "current" on the page for
 * ever while the queue rewrote it. tests/store-revision-columns.test.ts proves
 * each stamped step HAS an arm; it reads the source and cannot say whether the
 * arm gives the same answer. This file asks both, of the same rows.
 *
 * ## The shape of every case
 *
 * One fixture article, published, in the local Postgres. Each step's artefact
 * and its run row are seeded with the stamp the step itself expects today, so
 * both deciders must say yes. Then one recorded field is made stale —
 * **in every copy at once** — and both must say no.
 *
 * "Every copy" is load-bearing. The artefact carries `sourceHash`, `version`
 * and `generator`; `revision_step_runs` carries the same three. Change only one
 * and `stampForStep` throws `StampDisagrees` inside `stepIsDone`, so the case
 * would be exercising the fixture's inconsistency rather than either decider
 * (GPT Sol's plan review, PF3). For the same reason every comparison first
 * asserts that **both calls resolved**: a throw is not an answer of "no".
 *
 * ## What is deliberately kept out of the agreement
 *
 * The reader profile and the illustration note. The queue knows the profile and
 * the note a job would run with today (`ctx.profile`, `ctx.illustrationNote`);
 * the metadata page does not, and says so — it compares the artefact's own
 * value on both sides (`ideasAreCurrent`, `illustratedIsCurrent`). So a new
 * profile or a new note makes the queue re-run a step the page still calls
 * current, on purpose. The fixture's context matches its artefacts (no profile,
 * no note), and the last `describe` pins those two differences separately so
 * they cannot be mistaken for the currency disagreement this file looks for.
 *
 * ## The two disagreements found, 2026-10-04
 *
 * In opposite directions, and both on a step that is not stamped:
 *
 * - **`structure`: the queue says done, the page says not.** It has no `stamp`,
 *   on purpose (src/pipeline.ts § `structure` says why at length), so
 *   `stepIsDone` is presence alone; its `isCurrent` arm compares the run row's
 *   `input_hash` with the blocks.
 * - **`blocks`: the queue says not done, the page says done.** It has an
 *   `isDone` (`blocksMatchTheirHtml`: would stage 3 produce this artefact again
 *   from stage 2's HTML?) and no `isCurrent` arm at all — it falls to
 *   `default: true`, under a comment that says there is *"nothing to compare"*.
 *
 * Both are pinned below as the exact observed pair, in ordinary tests — see
 * `DISAGREEMENTS`.
 *
 * ## Seeded by SQL, and why that is right here
 *
 * tests/shared-site-run-row-gate.test.ts drives `beginStep`/`write`/`finishStep`
 * because its subject is the write path. This file's subject is two *readers*,
 * and the states it needs — an artefact from an older prompt, a row from an
 * older model — are ones the write path will not produce today. The article
 * itself arrives through the production path (`scratchArticleInPg`).
 *
 * docs/plans/261004b-sweep-clusters-9-15-16-21-frozen-control-lock-tests-script-fixes-freshness-agreement.md § Stage D
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isBodyEvidence } from "../src/block-policy.js";
import { BLOCKS_INPUT_HTML, splitIntoBlocks } from "../src/blocks.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  revisionBlocks,
  revisionStepRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { inputFingerprint as illustratedFingerprint } from "../src/illustrated.js";
import { figuresFingerprint } from "../src/illustrated-figures.js";
import { mintId } from "../src/ids.js";
import { CAPABLE_MODEL, HIGH_POWER_MODEL, sameGenerator } from "../src/models.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEP_ORDER, STEPS, stepIsDone, type StepContext } from "../src/pipeline.js";
import { hashProfile } from "../src/profile.js";
import { NO_INPUT_HASH, PIPELINE_RUN, STAMP_SOURCE, type StepStamp } from "../src/store/artifacts.js";
import { readsPgArtifacts, siteFor, type JobDraftRef } from "../src/store/artifacts-pg.js";
import { pgArticleReader } from "../src/store/pg.js";
import { SIMPLE_ARTIFACT_VERSION, type Block, type StepName, type Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/freshness-deciders-agree.test.ts",
  tables: [
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_blocks",
    "spideryarn.revision_step_runs",
  ],
});

/* One run's suffix, so two processes running this file cannot delete each
   other's article (tests/fixture-ids.test.ts § the same file, in two processes). */
const SLUG = `test-freshness-agree-${randomUUID().slice(0, 8)}`;

/* ------------------------------------------------------------ the cases -- */

/** The three fields both an artefact and its run row record. */
type Field = "inputHash" | "promptVersion" | "model";

/**
 * **Which recorded fields each step can go stale on** — one stale case per
 * field, per step.
 *
 * Written down rather than read off `STEPS[step].stamp` at run time, because
 * vitest collects the cases before any `beforeAll` has run. The first test
 * below holds this table to the stamps themselves: a step that gains a field,
 * or a new stamped step with no row here, goes red.
 *
 * Two rows have no `stamp` behind them. `structure` is here because it has an
 * `isCurrent` arm, and the only thing that arm compares is the run row's
 * `input_hash`. `blocks` is here because it has an `isDone`; nothing it is
 * judged on is a recorded field, so its list is empty and its one stale case —
 * stage 2's HTML moving underneath it — is written out in a `describe` of its
 * own further down.
 */
const CASES: Partial<Record<StepName, readonly Field[]>> = {
  blocks: [],
  structure: ["inputHash"],
  labels: ["inputHash", "promptVersion", "model"],
  assets: ["inputHash", "promptVersion"],
  arc: ["inputHash", "promptVersion", "model"],
  tweets: ["inputHash", "promptVersion", "model"],
  glossary: ["inputHash", "promptVersion", "model"],
  quotes: ["inputHash", "promptVersion", "model"],
  ideas: ["inputHash", "promptVersion", "model"],
  timeline: ["inputHash", "promptVersion", "model"],
  quiz: ["inputHash", "promptVersion", "model"],
  faq: ["inputHash", "promptVersion", "model"],
  relations: ["inputHash", "promptVersion", "model"],
  simple: ["inputHash", "promptVersion", "model"],
  sketch: ["inputHash", "promptVersion", "model"],
  illustrated: ["inputHash", "promptVersion", "model"],
  skim: ["inputHash", "promptVersion", "model"],
  debate: ["inputHash", "promptVersion", "model"],
  citations: ["inputHash", "promptVersion", "model"],
  crossrefs: ["inputHash", "promptVersion", "model"],
};

/**
 * **Steps this file cannot make current-then-stale in a fixture, by name and
 * with the reason.** Empty today. The count check reads it, so a step moved
 * here is a visible decision and a step in neither table is a red test — the
 * one thing this must never become is a silent skip.
 */
const EXCLUDED: Partial<Record<StepName, string>> = {};

/** What the two deciders said, in the order this file always writes them. */
interface Pair {
  /** `stepIsDone` — would the queue skip this step? */
  queue: boolean;
  /** `articleMetadata(...).stages[].done` — is the reader told it is current? */
  page: boolean;
}

/**
 * **FINDINGS: the stale cases where the two deciders do not agree today.**
 *
 * Each is asserted as the exact pair observed, in an ordinary test, so that a
 * change in either direction — the disagreement closing, or flipping — is
 * noticed. Nothing here is a fix and nothing here is `it.fails`: an
 * encompassing expected-failure would also pass on a fixture error.
 *
 * - **`structure:inputHash`** — the blocks moved after the tree was cut. The
 *   queue says *done* (`structure` has no `stamp`, so `stepIsDone` is presence
 *   plus a `done` row); the page says *not current* (`structureCurrency`
 *   compares the row's `input_hash` with the blocks). src/pipeline.ts §
 *   `structure` explains why the stamp was withdrawn on 2026-08-27 — a re-cut
 *   tree silently drops `arc` entries — so this is a known gap rather than an
 *   accident, but it is still two answers to one question: Metadata reports a
 *   stage out of date that no unforced job will ever re-run.
 * - **`blocks:extractedHtml`** — stage 2's HTML is no longer the document these
 *   blocks were cut from (or the block rows are no longer what stage 3 would
 *   cut). The queue says *not done* (`blocksMatchTheirHtml`, the step's
 *   `isDone`); the page says *current*, because `blocks` has no arm in
 *   `isCurrent` and lands on `default: true`. That arm's comment — *"fetch,
 *   extract, blocks — nothing to compare, in either store"* — is not true of
 *   `blocks`. The cost is small in the direction it is wrong (stage 3 makes no
 *   model call), but it is the `default: true` shape that caught `ideas`,
 *   `sketch` and `timeline` in turn: tests/store-revision-columns.test.ts
 *   requires an arm for every step with a `stamp`, and a step that decides with
 *   `isDone` instead is invisible to it.
 */
const DISAGREEMENTS: Record<string, Pair> = {
  "structure:inputHash": { queue: true, page: false },
  "blocks:extractedHtml": { queue: false, page: true },
};

/**
 * **Differences on a recorded field that are meant**, pinned as the exact pair
 * so neither side can drift into the other's answer. Not findings.
 *
 * - **`simple:promptVersion`** — a summary written by an older prompt. The
 *   queue says *done*: an unforced job never rewrites a stored summary for the
 *   prompt's age, because `simple`'s stamp expects the stored summary's own
 *   version (src/pipeline.ts § `simple`). The page says *not current*: Metadata
 *   still shows it as out of date and its Rerun, which is forced, writes the
 *   new one. docs/plans/261004f-stop-writing-the-simple-summary-level.md §
 *   Stage 2, GPT Sol's S1. Until 2026-10-04 both said no, and any unforced job
 *   naming `simple` rewrote every summary after a prompt bump.
 * - **`simple:model`** — the same write-once rule for a usable summary from an
 *   earlier model generation. The queue preserves it; Metadata still compares
 *   its provenance against today's expected model. The article hash must
 *   still match on both paths.
 */
const BY_DESIGN: Record<string, Pair> = {
  "simple:promptVersion": { queue: true, page: false },
  "simple:model": { queue: true, page: false },
};

/* -------------------------------------------------------------- fixture -- */

let article: ScratchArticle | undefined;
let ref: JobDraftRef;
let blocks: readonly Block[] = [];

/** No profile and no illustration note: the fixture's artefacts record neither. */
function ctxFor(extra: Partial<StepContext> = {}): StepContext {
  return {
    power: "standard",
    slug: SLUG,
    report: () => undefined,
    preview: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
    ...extra,
  };
}

const store = () => readsPgArtifacts(ref, getDb());

type Artefact = Record<string, unknown>;
type RunRow = typeof revisionStepRuns.$inferInsert;

/** The revision column a step's stamped artefact lives in, from the store's own map. */
function columnOf(step: StepName): keyof typeof articleRevisions.$inferInsert {
  const kind = STAMP_SOURCE[step];
  if (!kind) throw new Error(`${step} has no stamped artefact`);
  const site = siteFor(step, kind);
  if (site.at !== "column") throw new Error(`${step}'s stamped artefact is not a column`);
  return site.column;
}

async function writeArtefact(step: StepName, artefact: Artefact): Promise<void> {
  await getDb()
    .update(articleRevisions)
    .set({ [columnOf(step)]: artefact } as Partial<typeof articleRevisions.$inferInsert>)
    .where(eq(articleRevisions.id, ref.revisionId));
}

async function writeRow(row: RunRow): Promise<void> {
  const { revisionId: _r, stepName: _s, ...rest } = row;
  await getDb()
    .insert(revisionStepRuns)
    .values(row)
    .onConflictDoUpdate({
      target: [revisionStepRuns.revisionId, revisionStepRuns.stepName],
      set: rest,
    });
}

async function rowOf(step: StepName): Promise<RunRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(revisionStepRuns)
    .where(and(eq(revisionStepRuns.revisionId, ref.revisionId), eq(revisionStepRuns.stepName, step)))
    .limit(1);
  return row;
}

/**
 * Put a stamp's fields into an artefact **under the names `stampOf` reads**
 * (src/store/artifacts.ts): `sourceHash`, `generator`, and the prompt version in
 * `promptVersion` where the artefact has that key (Simple, whose `version` is
 * its document version) and in `version` everywhere else.
 */
function withStamp(artefact: Artefact, stamp: StepStamp): Artefact {
  const out: Artefact = { ...artefact };
  if (stamp.inputHash !== undefined) out.sourceHash = stamp.inputHash;
  if (stamp.promptVersion !== undefined) {
    out[typeof out.promptVersion === "string" ? "promptVersion" : "version"] = stamp.promptVersion;
  }
  if (stamp.model !== undefined) out.generator = stamp.model;
  if (stamp.profileHash !== undefined) out.profileHash = stamp.profileHash;
  return out;
}

function rowFor(step: StepName, stamp: StepStamp, status = "done"): RunRow {
  const now = new Date();
  return {
    revisionId: ref.revisionId,
    stepName: step,
    inputHash: stamp.inputHash ?? NO_INPUT_HASH,
    implementationVersion: PIPELINE_RUN,
    promptVersion: stamp.promptVersion ?? null,
    model: stamp.model ?? null,
    status,
    startedAt: now,
    finishedAt: now,
  };
}

/**
 * The smallest artefact the store will read back, for the kinds the corpus
 * article does not carry. Each satisfies `SHAPE` (src/store/artifacts.ts) and
 * the extra guard its `isCurrent` arm or its `stamp` applies — a sketch has a
 * scene, a quote names a real block — and nothing more: neither decider reads
 * the content, only the stamp.
 */
function minimal(step: StepName): Artefact {
  const body = blocks.filter((b) => isBodyEvidence(b) && b.kind !== "heading");
  const last = body.at(-1);
  if (!last) throw new Error("the fixture has no body block to anchor a quote to");
  const paragraph = (n: number) => ({ text: `Paragraph ${n} of a summary.`, ids: [last.id] });
  const made = { slug: SLUG, generatedAt: new Date().toISOString(), elapsedMs: 1 };
  switch (step) {
    case "assets":
      return { slug: SLUG, entries: [] };
    case "quotes":
      return { ...made, quotes: [{ id: mintId(), blockId: last.id, text: last.text.slice(0, 40) }] };
    case "timeline":
      return { ...made, events: [] };
    case "faq":
      return { ...made, questions: [] };
    case "relations":
      return { ...made, relations: {} };
    case "citations":
      return { ...made, citations: [] };
    case "crossrefs":
      return { ...made, links: [] };
    case "debate":
      return { ...made, direct: { rows: [] }, claims: { rows: [] } };
    case "sketch":
      return { ...made, scenes: [{ id: mintId(), title: "One scene" }] };
    case "illustrated":
      return { ...made, plates: [{ id: mintId(), brief: "One plate" }] };
    case "skim":
      return { ...made, stops: [{ id: mintId() }] };
    case "simple":
      return {
        ...made,
        version: SIMPLE_ARTIFACT_VERSION,
        promptVersion: "to be stamped",
        profileHash: null,
        levels: {
          brief: [paragraph(1), paragraph(2)],
          simple: [paragraph(1), paragraph(2)],
          fuller: [paragraph(1), paragraph(2), paragraph(3)],
        },
      };
    default:
      throw new Error(`no minimal artefact written for ${step}`);
  }
}

/** Each covered step as it stands when current, so a case can put it back. */
const current = new Map<StepName, { artefact: Artefact | null; row: RunRow; stamp: StepStamp }>();

function currentOf(step: StepName) {
  const held = current.get(step);
  if (!held) throw new Error(`${step} was never seeded`);
  return held;
}

async function restore(step: StepName): Promise<void> {
  const { artefact, row } = currentOf(step);
  if (artefact) await writeArtefact(step, artefact);
  await writeRow(row);
}

/**
 * Record different values for this step, **in the artefact and the row
 * together**, run `fn`, and put the step back whatever happened.
 */
async function recordedAs<T>(step: StepName, patch: StepStamp, fn: () => Promise<T>): Promise<T> {
  const { artefact, row } = currentOf(step);
  try {
    if (artefact) await writeArtefact(step, withStamp(artefact, patch));
    await writeRow({
      ...row,
      ...(patch.inputHash === undefined ? {} : { inputHash: patch.inputHash }),
      ...(patch.promptVersion === undefined ? {} : { promptVersion: patch.promptVersion }),
      ...(patch.model === undefined ? {} : { model: patch.model }),
    });
    return await fn();
  } finally {
    await restore(step);
  }
}

/**
 * Ask both deciders about one step.
 *
 * **Both must resolve before their answers mean anything.** `allSettled` rather
 * than two awaits so a throw from either is reported as a throw, with its
 * message, and never reaches the comparison looking like a `false`.
 */
async function ask(step: StepName, ctx: StepContext = ctxFor()): Promise<Pair> {
  const [queue, page] = await Promise.allSettled([
    stepIsDone(STEPS[step], ctx, store()),
    runAsOwner(DEV_OWNER_ID, () => pgArticleReader.articleMetadata(SLUG)).then((meta) => {
      const stage = meta.stages.find((s) => s.step === step);
      if (!stage) throw new Error(`the metadata page has no stage for ${step}`);
      return stage.done;
    }),
  ]);
  const threw = (r: PromiseSettledResult<boolean>) =>
    r.status === "rejected" ? String(r.reason) : null;
  expect(
    { queue: threw(queue), page: threw(page) },
    `${step}: a decider threw instead of answering`,
  ).toEqual({ queue: null, page: null });
  if (queue.status !== "fulfilled" || page.status !== "fulfilled") throw new Error("unreachable");
  return { queue: queue.value, page: page.value };
}

/** Both deciders, for every step, in one read of the metadata page. */
async function askAll(): Promise<Record<string, Pair>> {
  const out: Record<string, Pair> = {};
  for (const step of STEP_ORDER) out[step] = await ask(step);
  return out;
}

/**
 * A prompt version this step really did have: the one before today's.
 *
 * Not an arbitrary string, because one arm reads the number — `tweets` picks
 * which fingerprint a thread was written against by its parsed version
 * (src/tweets.ts § `fingerprintFor`), and a made-up `"stale"` would send that
 * arm down its pre-`tweets/5` path and make the article comparison answer no
 * before the version comparison was ever reached.
 */
function olderVersion(version: string): string {
  const m = /^(.*?)(\d+)$/.exec(version);
  if (!m) return `${version}-older`;
  const n = Number(m[2]);
  return `${m[1]}${n > 1 ? n - 1 : n + 1}`;
}

/** A model from before the capable generation, which no decider should accept. */
const OLDER_MODEL = "claude-sonnet-4-5";

function staleValue(step: StepName, field: Field): string {
  const { stamp, row } = currentOf(step);
  if (field === "inputHash") return "0000000000000000";
  if (field === "promptVersion") return olderVersion(stamp.promptVersion ?? row.promptVersion ?? "");
  return OLDER_MODEL;
}

/**
 * **Give the fixture a stage-3 HTML that stage 3 would write today.**
 *
 * The corpus article's `output/<slug>.html` was serialised by an older stage 3,
 * and the loader puts that one file in both HTML columns
 * (tests/helpers/load-article.ts § *`extractedHtml` is still stage 3's HTML*).
 * Re-splitting it gives the same nineteen blocks and the same ids but not the
 * same string, so as loaded the `blocks` step is not done to the queue — a fact
 * about the fixture's age, not about either decider. Writing today's
 * serialisation into `stamped_html` is what a re-run of stage 3 would do, and it
 * makes the three questions `blocksMatchTheirHtml` asks all answer yes.
 */
async function makeBlocksCurrent(): Promise<void> {
  const extracted = await store().read(SLUG, "extract", BLOCKS_INPUT_HTML);
  const file = await store().read(SLUG, "blocks", "blocks");
  if (!extracted || !file?.blocks?.length) throw new Error("the fixture has no HTML or no blocks");
  const run = splitIntoBlocks(extracted, file.blocks);
  /* The premise the comment above claims: the same blocks, in the same order. */
  expect(run.blocks.map((b) => b.id)).toEqual(file.blocks.map((b) => b.id));
  await getDb()
    .update(articleRevisions)
    .set({ stampedHtml: run.html })
    .where(eq(articleRevisions.id, ref.revisionId));
}

beforeAll(async () => {
  /* Owned by `DEV_OWNER_ID` explicitly: the Postgres reader filters every
     article by owner, so a fixture seeded as anybody else would be a 404 to
     `articleMetadata` and every case would fail on a throw. */
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  blocks = article.blocks;

  const [row] = await getDb()
    .select({ revisionId: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article.articleId))
    .limit(1);
  if (!row?.revisionId) throw new Error(`"${SLUG}" was not published`);
  /* No read fences on `jobId` or `attemptId`; minted rather than written down
     because tests/fixture-ids.test.ts reads every uuid literal in a file. */
  ref = {
    slug: SLUG,
    articleId: article.articleId,
    revisionId: row.revisionId,
    jobId: randomUUID(),
    attemptId: randomUUID(),
  };

  await makeBlocksCurrent();

  /* In pipeline order, because two stamps are made from an earlier step's
     artefact: `illustrated` hashes the sketch, `skim` hashes the quotes and
     the ideas. Seeding out of order would stamp them against nothing. */
  for (const step of STEP_ORDER) {
    if (!CASES[step]) continue;
    const declared = STEPS[step].stamp;
    if (!declared) {
      /* `blocks` and `structure`: nothing to stamp. The row the loader wrote is
         the state. */
      const loaded = await rowOf(step);
      if (!loaded) throw new Error(`the fixture has no run row for ${step}`);
      current.set(step, { artefact: null, row: loaded, stamp: { inputHash: loaded.inputHash } });
      continue;
    }
    const kind = STAMP_SOURCE[step];
    if (!kind) throw new Error(`${step} declares a stamp and names no artefact to read it from`);
    const carried = (await store().read(SLUG, step, kind)) as Artefact | null;
    /* Twice: the artefact has to be in its column before a stamp that reads it
       (or a later step's stamp) can be computed. The stamp does not depend on
       the step's own artefact, so the first write only needs to be readable. */
    const base = carried ?? minimal(step);
    await writeArtefact(step, base);
    const stamp = await declared(ctxFor(), store());
    if (!stamp) throw new Error(`${step}'s stamp answered null on a readable fixture`);
    const artefact = withStamp(base, stamp);
    const run = rowFor(step, stamp);
    current.set(step, { artefact, row: run, stamp });
    await restore(step);
  }
}, 180_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
}, 60_000);

/* ------------------------------------------------------ the count check -- */

describe("the cases cover every step that can be stale", () => {
  it("has a row, or a named exclusion, for every step with a stamp, an isDone or an isCurrent arm", async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, "..", "src", "store", "pg.ts"),
      "utf-8",
    );
    /* The switch only — the anchors tests/store-revision-columns.test.ts uses. */
    const from = source.indexOf("const isCurrent = (step: StepName): boolean =>");
    const to = source.indexOf("const stages: StageState[]", from);
    expect({ from: from > 0, to: to > from }, "the anchors still exist").toEqual({
      from: true,
      to: true,
    });
    const arms = source.slice(from, to);

    /* Three ways a step can decide it is out of date, and any one puts it in
       scope: what it would stamp today, an `isDone` of its own, or an arm on
       the metadata page. `fetch`, `metadata` and `extract` have none — presence
       and a `done` row are all either side asks of them — and the sweep further
       down still asks both deciders about them. */
    const canBeStale = STEP_ORDER.filter(
      (name) =>
        STEPS[name].stamp !== undefined ||
        STEPS[name].isDone !== undefined ||
        arms.includes(`case "${name}"`),
    );
    /* The premise: an empty list here would make the equality below vacuous. */
    expect(canBeStale.length).toBeGreaterThanOrEqual(20);

    const accounted = [...Object.keys(CASES), ...Object.keys(EXCLUDED)];
    expect(new Set(accounted).size, "a step is both covered and excluded").toBe(accounted.length);
    expect([...accounted].sort()).toEqual([...canBeStale].sort());
  });

  it("lists, for each step, exactly the fields its own stamp declares", () => {
    const shared: readonly Field[] = ["inputHash", "promptVersion", "model"];
    const declared: Record<string, readonly Field[]> = {};
    const listed: Record<string, readonly Field[]> = {};
    for (const [step, fields] of Object.entries(CASES)) {
      if (!STEPS[step as StepName].stamp) continue;
      const { stamp } = currentOf(step as StepName);
      declared[step] = shared.filter((f) => stamp[f] !== undefined);
      listed[step] = fields;
    }
    expect(Object.keys(declared).length).toBeGreaterThanOrEqual(18);
    expect(listed).toEqual(declared);
  });

  it("pins a disagreement only for a case that exists", () => {
    for (const key of Object.keys(DISAGREEMENTS)) {
      const [step, field] = key.split(":") as [StepName, string];
      expect(CASES[step], key).toBeDefined();
      /* `blocks` goes stale on something that is not a recorded field. */
      if (step !== "blocks") expect(CASES[step], key).toContain(field);
    }
  });
});

/* ------------------------------------------------------- current, stale -- */

describe.each(Object.entries(CASES) as [StepName, readonly Field[]][])(
  "%s: the queue and the metadata page",
  (step, fields) => {
    it("both call it current when the artefact and the row carry today's stamp", async () => {
      expect(await ask(step)).toEqual({ queue: true, page: true });
    });

    for (const field of fields) {
      const meant = BY_DESIGN[`${step}:${field}`];
      const pinned = DISAGREEMENTS[`${step}:${field}`] ?? meant;
      const name = meant
        ? `differ on purpose when the recorded ${field} is stale: queue ${meant.queue}, page ${meant.page}`
        : pinned
          ? `FINDING — disagree when the recorded ${field} is stale: queue ${pinned.queue}, page ${pinned.page}`
          : `both call it stale when the recorded ${field} is stale`;
      it(name, async () => {
        const value = staleValue(step, field);
        /* The premise, so a "stale" value that happens to be today's cannot
           turn this into a second current case. */
        expect(value).not.toBe(currentOf(step).stamp[field]);
        const pair = await recordedAs(step, { [field]: value }, () => ask(step));
        expect(pair).toEqual(pinned ?? { queue: false, page: false });
        /* And the step was put back: a case that left it stale would make
           every later case's "current" a lie about the fixture. */
        expect(await ask(step)).toEqual({ queue: true, page: true });
      });
    }

    if (fields.includes("model")) {
      /* `sameStamp` compares the model by generation (plan 260930f): an
         artefact Opus wrote on a high-powered article is current against a
         Sonnet expectation. Both deciders have to make that same allowance —
         an arm comparing the string would report every high-powered article
         stale on the page alone. */
      it("both call it current when the same generation's other model wrote it", async () => {
        const expected = currentOf(step).stamp.model ?? "";
        expect(HIGH_POWER_MODEL).not.toBe(expected);
        expect(sameGenerator(HIGH_POWER_MODEL, expected)).toBe(true);
        const pair = await recordedAs(step, { model: HIGH_POWER_MODEL }, () => ask(step));
        expect(pair).toEqual({ queue: true, page: true });
      });
    }

    it.each(["running", "error"])("both refuse it while its run row says %s", async (status) => {
      const { row } = currentOf(step);
      try {
        await writeRow({ ...row, status });
        expect(await ask(step)).toEqual({ queue: false, page: false });
      } finally {
        await restore(step);
      }
    });
  },
);

/* ------------------------------------------------- blocks, on its own -- */

/**
 * `blocks` carries no stamp, so there is no recorded field to make stale. It
 * goes stale when the document it was cut from changes — `extract` ran again —
 * and the queue notices by re-splitting stage 2's HTML and comparing.
 */
describe("blocks: stage 2's HTML moves underneath a finished stage 3", () => {
  it("FINDING — disagree: the queue would re-run it, the page calls it current", async () => {
    const [was] = await getDb()
      .select({ html: articleRevisions.extractedHtml })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, ref.revisionId))
      .limit(1);
    if (!was?.html) throw new Error("the fixture has no extracted HTML");
    const set = (html: string) =>
      getDb()
        .update(articleRevisions)
        .set({ extractedHtml: html })
        .where(eq(articleRevisions.id, ref.revisionId));
    /* The premise: before the change, both call it current. */
    expect(await ask("blocks")).toEqual({ queue: true, page: true });
    try {
      await set(`${was.html}<p>A paragraph the re-extraction found.</p>`);
      expect(await ask("blocks")).toEqual(DISAGREEMENTS["blocks:extractedHtml"]);
    } finally {
      await set(was.html);
    }
    expect(await ask("blocks")).toEqual({ queue: true, page: true });
  });
});

/* -------------------------------------------------- the article moves -- */

/**
 * **The other way a step goes stale: nothing recorded changes, the article
 * does.** The cases above change what was recorded and so exercise each
 * comparison; these change one input and so exercise each side's own
 * *derivation* of the expected fingerprint — the pipeline's through the store
 * (`tryReadArticle`), the page's from the revision row (`metaFingerprintOf` and
 * its two siblings, `blocksFor`, `revision.tree`).
 *
 * Every step is asked, not only the ones expected to move: a step that reads
 * the publication date on one side and not the other shows up as a
 * disagreement on a step nobody thought to list. The named sets say which
 * steps each change was *observed* to stale on 2026-10-04, so a perturbation
 * that silently stopped reaching the database cannot pass as "everything
 * agrees, because nothing moved".
 */
describe("when the article itself moves, every step gets the same answer from both", () => {
  type Revision = typeof articleRevisions.$inferSelect;

  async function revision(): Promise<Revision> {
    const [row] = await getDb()
      .select()
      .from(articleRevisions)
      .where(eq(articleRevisions.id, ref.revisionId))
      .limit(1);
    if (!row) throw new Error("the fixture revision has gone");
    return row;
  }

  async function withRevision(
    change: (was: Revision) => Partial<typeof articleRevisions.$inferInsert>,
    fn: () => Promise<void>,
  ): Promise<void> {
    const was = await revision();
    const patch = change(was);
    const back = Object.fromEntries(
      Object.keys(patch).map((k) => [k, was[k as keyof Revision]]),
    ) as Partial<typeof articleRevisions.$inferInsert>;
    const set = (values: Partial<typeof articleRevisions.$inferInsert>) =>
      getDb().update(articleRevisions).set(values).where(eq(articleRevisions.id, ref.revisionId));
    try {
      await set(patch);
      await fn();
    } finally {
      await set(back);
    }
  }

  /**
   * Split what both said into the steps that went stale and any disagreement.
   *
   * "Went stale" is *both said no, and it is a step this fixture ever ran*:
   * the loader copies no `metadata` run, so that step is not done to either
   * side from the start, and the first case below says so rather than letting
   * it sit in every list.
   */
  const NEVER_RAN: readonly string[] = ["metadata"];
  function read(all: Record<string, Pair>) {
    const neither = Object.keys(all).filter((s) => !all[s]!.queue && !all[s]!.page);
    const disagree = Object.fromEntries(
      Object.entries(all).filter(([, p]) => p.queue !== p.page),
    );
    return { neither, stale: neither.filter((s) => !NEVER_RAN.includes(s)), disagree };
  }

  /** In pipeline order, which is the order `askAll` answers in. */
  const inOrder = (steps: readonly StepName[]) => STEP_ORDER.filter((s) => steps.includes(s));

  /** The steps whose prompt carries the article's head — `TITLE:` and what follows it. */
  const READS_THE_HEAD: readonly StepName[] = [
    "arc",
    "tweets",
    "glossary",
    "quotes",
    "ideas",
    "timeline",
    "quiz",
    "faq",
    "relations",
    "simple",
    "sketch",
    "debate",
    "citations",
    "crossrefs",
  ];
  const without = (steps: readonly StepName[], ...drop: StepName[]) =>
    steps.filter((s) => !drop.includes(s));

  it("starts from a fixture where every step that ran is current to both", async () => {
    const all = await askAll();
    const { neither, disagree } = read(all);
    expect(disagree).toEqual({});
    expect(neither).toEqual(NEVER_RAN);
    /* And "nothing is stale" is not "nothing was asked". */
    expect(Object.keys(all)).toEqual([...STEP_ORDER]);
  });

  it("a new title: every step that sends the head goes stale to both", async () => {
    await withRevision(
      (was) => ({ title: `${was.title ?? ""} (retitled)` }),
      async () => {
        const { stale, disagree } = read(await askAll());
        expect(disagree).toEqual({});
        expect(stale).toEqual(inOrder(READS_THE_HEAD));
      },
    );
  });

  it("a new final URL: only the steps whose head prints a URL line", async () => {
    await withRevision(
      () => ({ finalUrl: "https://example.invalid/moved" }),
      async () => {
        const { stale, disagree } = read(await askAll());
        expect(disagree).toEqual({});
        /* `arc`, `glossary` and `quotes` send `articleText`, whose head has no
           `URL:`; the rest send `articleWithIds` (src/source-hash.ts). Both
           deciders have to draw that line in the same place. */
        expect(stale).toEqual(inOrder(without(READS_THE_HEAD, "arc", "glossary", "quotes")));
      },
    );
  });

  it("a new publication date: only the timeline", async () => {
    await withRevision(
      () => ({ publishedAt: "1999-01-01" }),
      async () => {
        const { stale, disagree } = read(await askAll());
        expect(disagree).toEqual({});
        expect(stale).toEqual(["timeline"]);
      },
    );
  });

  it("a section renamed in the tree: every step that sends the skeleton", async () => {
    await withRevision(
      (was) => {
        const tree = structuredClone(was.tree) as Tree;
        const node = Object.values(tree.nodes).find((n) => n.id !== tree.rootId);
        if (!node) throw new Error("the fixture tree has no section to rename");
        node.title = `${node.title} (renamed)`;
        return { tree };
      },
      async () => {
        const { stale, disagree } = read(await askAll());
        expect(disagree).toEqual({});
        /* `relations` and `simple` send the paragraphs without the section
           titles; `skim` lays its route over them. `labels` and `assets` hash
           the blocks alone. */
        expect(stale).toEqual(inOrder([...without(READS_THE_HEAD, "relations", "simple"), "skim"]));
      },
    );
  });

  /**
   * The blocks hash moves, so every step stamped against the prose goes stale —
   * and both pinned disagreements show again, `structure`'s this time reached
   * the way it really happens (the blocks changed underneath a finished tree)
   * rather than by editing its row.
   */
  it("a paragraph's text changes — FINDING: blocks and structure disagree, the rest agree", async () => {
    const target = blocks.filter((b) => isBodyEvidence(b) && b.kind !== "heading").at(-1);
    if (!target) throw new Error("the fixture has no body block to edit");
    const where = and(
      eq(revisionBlocks.revisionId, ref.revisionId),
      eq(revisionBlocks.blockId, target.id),
    );
    try {
      await getDb()
        .update(revisionBlocks)
        .set({ text: `${target.text} And one more sentence.` })
        .where(where);
      const { stale, disagree } = read(await askAll());
      expect(disagree).toEqual({
        blocks: DISAGREEMENTS["blocks:extractedHtml"],
        structure: DISAGREEMENTS["structure:inputHash"],
      });
      /* Three stamped steps do not read a paragraph's text, on either side:
         `assets` hashes each block's HTML for its figures, `skim` hashes the
         quotes it was offered, and `illustrated` hashes the sketch. */
      expect(stale).toEqual(inOrder(["labels", ...READS_THE_HEAD]));
    } finally {
      await getDb().update(revisionBlocks).set({ text: target.text }).where(where);
    }
  });
});

/* --------------------------------------------- debate's model, overridden -- */

/**
 * `debate` is the one stamped step whose model the environment can change
 * (`SPIDERYARN_DEBATE_MODEL`), so both deciders have to ask the resolver
 * rather than compare against `CAPABLE_MODEL`, the constant every neighbouring
 * arm uses and the obvious thing to copy.
 *
 * **The override is set here, and that is the whole case.** On a bare machine
 * the resolver and the constant are the same generation, so an arm that had
 * copied the constant passes every case above. Mutated 2026-10-04: with the
 * page's arm comparing `CAPABLE_MODEL`, this is the only case in the file that
 * goes red.
 */
describe("debate, with its model overridden by the environment", () => {
  it("both call a debate that model wrote current", async () => {
    const override = "test-only/debate-override";
    vi.stubEnv("SPIDERYARN_DEBATE_MODEL", override);
    try {
      /* The premise: under the override the constant is the wrong answer. */
      expect(sameGenerator(override, CAPABLE_MODEL)).toBe(false);
      const pair = await recordedAs("debate", { model: override }, () => ask("debate"));
      expect(pair).toEqual({ queue: true, page: true });
      /* And what was current before the override is now stale, to both. */
      expect(await ask("debate")).toEqual({ queue: false, page: false });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await ask("debate")).toEqual({ queue: true, page: true });
  });
});

/* ------------------------------------------- deliberate, and kept apart -- */

/**
 * **Not findings.** The queue knows what a job would run with today; the page
 * is a read with no job behind it and compares the artefact with itself on
 * these two values, by design (`ideasAreCurrent` and `illustratedIsCurrent` in
 * src/store/pg.ts say so). They are pinned here so the difference is on record
 * as the *only* one of its kind, and so the agreement cases above can honestly
 * claim a context that matches the fixture.
 */
describe("what the two deciders are meant to answer differently", () => {
  it("a new reader profile: the queue re-runs ideas, the page still calls it current", async () => {
    const profile = "A reader who has changed their profile since.";
    const pair = await ask("ideas", ctxFor({ profile }));
    expect(pair).toEqual({ queue: false, page: true });

    /* And it is the profile, not something else about that context: record the
       same profile on the artefact and the queue is satisfied again. */
    const { artefact } = currentOf("ideas");
    if (!artefact) throw new Error("ideas has no seeded artefact");
    try {
      await writeArtefact("ideas", { ...artefact, profileHash: hashProfile(profile) });
      expect(await ask("ideas", ctxFor({ profile }))).toEqual({ queue: true, page: true });
    } finally {
      await restore("ideas");
    }
  });

  it("a new illustration note: the queue repaints, the page judges the picture by its own note", async () => {
    const note = "Moodier, and in ink.";
    expect(await ask("illustrated", ctxFor({ illustrationNote: note }))).toEqual({
      queue: false,
      page: true,
    });

    /* A picture painted WITH that note is current to both, under that note. */
    const { artefact, row } = currentOf("illustrated");
    if (!artefact) throw new Error("illustrated has no seeded artefact");
    const sketch = await store().read(SLUG, "sketch", "sketch");
    if (!sketch) throw new Error("the fixture has no sketch to paint from");
    const assets = await store().read(SLUG, "assets", "assets");
    const inputHash = illustratedFingerprint(sketch, undefined, figuresFingerprint(assets), note);
    try {
      await writeArtefact("illustrated", { ...artefact, note, sourceHash: inputHash });
      await writeRow({ ...row, inputHash });
      expect(await ask("illustrated", ctxFor({ illustrationNote: note }))).toEqual({
        queue: true,
        page: true,
      });
    } finally {
      await restore("illustrated");
    }
  });
});
