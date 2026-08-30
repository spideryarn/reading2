/**
 * With the filesystem store, the finalizer does not exist.
 *
 * The other half of `tests/jobs-publish-finalizer.test.ts`, and it is a separate
 * file because `src/store/live.ts` reads `SPIDERYARN_STORE` **once**, at module
 * load — so one file cannot be both stores.
 *
 * The claim: on a laptop with the flag unset, a job behaves exactly as it did
 * before the finalizer landed. No draft, no publication, no database, nothing
 * new. That is what local development runs, and it must not change under people
 * (docs/plans/v1-imports-on-vercel.md).
 *
 * ## How this proves it without a database, and why that matters
 *
 * By taking `DATABASE_URL` away. `getDb()` builds its pool lazily, on first use,
 * and throws a named error when the variable is unset — so **any** step of the
 * finalizer would fail loudly the moment it ran. A job that ends `done` with no
 * `DATABASE_URL` in the environment is therefore a job that never went near
 * Postgres.
 *
 * A test that merely asserted "no article row appeared" would need a live
 * database and would skip without one — and a skipped test protects nothing.
 * This one runs everywhere, and it is armed rather than assumed: the first case
 * below checks that `getDb()` really does throw, because a control that cannot
 * fire is not a control (docs/reusable/silent-success.md).
 *
 * ## The mutation that reddened it, watched on 2026-08-30
 *
 * Delete the `if (STORE !== "postgres") return inner;` line from `claimSession`
 * in src/jobs.ts. Two of the three cases go red: the walk reaches
 * `publishingSession`, which asks for `getDb()`, which throws `DATABASE_URL is
 * not set` at `src/store/publish-session.ts:135` — so the job ends `error`, and
 * the session it ran on is guarded rather than plain.
 */
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The flag **deleted**, and a scratch `data/` root, before any import.
 *
 * Deleted rather than set to `"files"`, because unset is the state every laptop
 * and every fresh clone is actually in, and `storeFromEnv` treats the two the
 * same on purpose (src/store/live.ts).
 */
const HOISTED = vi.hoisted(() => {
  const previousStore = process.env.SPIDERYARN_STORE;
  const previousRoot = process.env.SPIDERYARN_DATA_ROOT;
  delete process.env.SPIDERYARN_STORE;
  /* A path string and nothing more: `vi.hoisted` runs before every import, so
     `node:fs` is not available in here. Nothing needs to exist yet — `dataRoot()`
     is read at the moment a path is wanted, and the filesystem store makes its
     directories on the way past. */
  const tmp = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");
  const root = `${tmp}/spya-finalizer-files-${process.pid}-${Date.now()}`;
  process.env.SPIDERYARN_DATA_ROOT = root;
  return { previousStore, previousRoot, root };
});

import { getDb } from "../src/db/client.js";
import { mintId } from "../src/ids.js";
import { advanceJobWith, claimSession } from "../src/jobs.js";
import type { LabelsFile } from "../src/labels.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepProduct } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { fsArtifacts } from "../src/store/artifacts-fs.js";
import { fsJobStore } from "../src/store/jobs-fs.js";
import { isGuardedStore } from "../src/store/db-errors.js";
import { STORE } from "../src/store/live.js";
import type { ArtifactKind } from "../src/store/artifacts.js";
import type { Block, Job, JobStep, StepName, Tree } from "../src/types.js";

if (HOISTED.previousStore !== undefined) process.env.SPIDERYARN_STORE = HOISTED.previousStore;

const SLUG = "finalizer-files-only";

/* -------------------------------------------------------------- the article -- */

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: `<p id="${id}">${text}</p>`,
    gistable: true,
  };
}

const BLOCKS: Block[] = [
  block("spya-fabaa2", "The opening paragraph of an article that exists only for this test."),
  block("spya-fabaa3", "The closing paragraph, which says nothing either."),
];

const TREE: Tree = {
  version: "toc/1",
  generator: "fixture",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: ["n1", "n2"],
      range: [BLOCKS[0]!.id, BLOCKS[1]!.id],
      title: "A fixture article",
      gist: "A fixture built by tests/jobs-publish-finalizer-files.test.ts and nothing else.",
    },
    ...Object.fromEntries(
      BLOCKS.map((b, i) => [
        `n${i + 1}`,
        {
          id: `n${i + 1}`,
          depth: 1,
          parent: "n0",
          children: [],
          range: [b.id, b.id],
          title: "A paragraph",
          navLabel: "One paragraph of a fixture article that exists only for this test",
        },
      ]),
    ),
  },
} as Tree;

const LABELS: LabelsFile = {
  version: "labels/1",
  generator: "fixture",
  slug: SLUG,
  sourceHash: hashBlocks(BLOCKS),
  structureHash: "fixture-structure",
  structureVersion: "toc/1",
  labels: Object.fromEntries(BLOCKS.map((b) => [b.id, "A paragraph"])),
  batches: null,
};

/** The same shape as the real unconverted stages: write inside `run`, return a detail. */
function writingStep(name: StepName, parts: Partial<Record<ArtifactKind, unknown>>): PipelineStep {
  return {
    name,
    label: STEPS[name].label,
    outputs: () => [],
    produces: STEPS[name].produces,
    async run(): Promise<StepProduct> {
      await fsArtifacts.write(SLUG, name, parts as never, {});
      return { detail: `${name} ran` };
    },
  } as PipelineStep;
}

const FAKE_STEPS = {
  blocks: writingStep("blocks", {
    blocks: { blocks: BLOCKS },
    stampedHtml: `<html><body>${BLOCKS.map((b) => b.html).join("")}</body></html>`,
  }),
  toc: writingStep("toc", { tree: TREE, labels: LABELS, blocks: { blocks: BLOCKS } }),
};

const MADE: string[] = [];

async function queueJob(names: StepName[]): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug: SLUG,
    steps: names.map((name): JobStep => ({ name, label: STEPS[name].label, status: "pending" })),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await fsJobStore.enqueueOrGet(wanted, `finalizer-files-${wanted.id}`);
  MADE.push(job.id);
  return job;
}

/* ------------------------------------------------------------------ the cases -- */

describe("a job under the filesystem store", () => {
  let previousUrl: string | undefined;

  beforeAll(() => {
    /* The control, armed here rather than at module load: `getDb` memoises its
       pool on first use, and nothing in this file has asked for one. Taking the
       variable away now means any database call made from here on throws. */
    previousUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
  });

  afterAll(async () => {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    /* `fsJobStore` writes to the repository's own `data/_jobs/`, not to the
       scratch root — its directory is a module-level constant — so the records
       have to be taken out by hand, exactly as tests/jobs-walk.test.ts does. */
    const jobsDir = path.resolve(import.meta.dirname, "..", "data", "_jobs");
    for (const file of await readdir(jobsDir).catch(() => [])) {
      const full = path.join(jobsDir, file);
      const record = JSON.parse(await readFile(full, "utf8").catch(() => "{}")) as { id?: string };
      if (record.id !== undefined && MADE.includes(record.id)) await rm(full, { force: true });
    }
    await rm(HOISTED.root, { recursive: true, force: true });
    if (HOISTED.previousRoot === undefined) delete process.env.SPIDERYARN_DATA_ROOT;
    else process.env.SPIDERYARN_DATA_ROOT = HOISTED.previousRoot;
  });

  it("is the filesystem store, and the database control is armed", () => {
    /* Both halves, because either one alone would let the two cases below pass
       for the wrong reason. A flag that failed to take would exercise Postgres;
       a `DATABASE_URL` still set would let the finalizer run and succeed. */
    expect(STORE).toBe("files");
    expect(() => getDb()).toThrow(/DATABASE_URL is not set/);
  });

  it("runs on the plain filesystem session, with no publishing wrapper round it", async () => {
    const job = await queueJob(["blocks", "toc"]);
    const session = await claimSession(job, "not-a-real-attempt");
    /* `guardDbStore` marks what it wrapped, and the publishing session is the
       only thing in this path that is wrapped. Structural, and it is here as the
       *reason* the behavioural case below passes rather than as the case itself
       — a session that merely happened not to publish would satisfy that one. */
    expect(isGuardedStore(session)).toBeUndefined();
  });

  it("ends done having published nothing and touched no database", async () => {
    const job = await queueJob(["blocks", "toc"]);

    const advanced = await runAsOwner(DEV_OWNER_ID, () =>
      advanceJobWith(job.id, {
        session: claimSession,
        steps: { ...STEPS, ...FAKE_STEPS } as never,
      }),
    );

    /* If the gate went, `publishingSession` would ask for `getDb()` on the last
       step's commit, throw `DATABASE_URL is not set`, and this would be
       `"error"` with `done` still true. So the status is the assertion and
       `done` is not. */
    expect(advanced?.job.status).toBe("done");
    expect(advanced?.job.error).toBeUndefined();
    expect(advanced?.done).toBe(true);

    /* And the artefacts stayed where the stages put them, which is the other
       half of "behaviour is exactly what it is today". */
    expect(await fsArtifacts.has(SLUG, "toc", ["tree", "labels", "blocks"])).toBe(true);
  }, 30_000);
});
