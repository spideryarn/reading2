import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import type { Db } from "../src/db/client.js";
import {
  deleteDraftBacklog, draftBacklogTarget, surveyDraftBacklog,
  type BacklogSurvey,
} from "../scripts/draft-sweep-backlog.js";
import { readEnvProd } from "../src/env.js";
import { DRAFT_SWEEP_BATCH } from "../src/store/pg-revisions.js";
import { READ_COMMITTED } from "../src/store/isolation.js";

vi.mock("node:fs", async (original) => {
  const real = await original<typeof import("node:fs")>();
  return { ...real, readFileSync: vi.fn(real.readFileSync) };
});
vi.mock("../src/env.js", async (original) => ({
  ...await original<typeof import("../src/env.js")>(), readEnvProd: vi.fn(),
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const surveyTotals = { failed: 0, draft: 0, blocks: 0, bytes: 0, role: "fixture", mayDelete: true };

describe("backlog safety boundaries without a database", () => {
  it("the survey itself requests a read-only transaction", async () => {
    const transaction = vi.fn().mockRejectedValue(new Error("transaction reached"));
    const db = { transaction } as unknown as Db;
    await expect(surveyDraftBacklog(db)).rejects.toThrow("transaction reached");
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { accessMode: "read only" });
  });

  it("refuses an unproven survey before opening any deleting transaction", async () => {
    const transaction = vi.fn();
    const db = { transaction } as unknown as Db;
    await expect(deleteDraftBacklog(db, { proven: false } as BacklogSurvey))
      .rejects.toThrow("the survey is not proven");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses a newly protected locked batch before reaching the sweep's delete", async () => {
    const originalProof = {
      seen: 1, notDraftOrFailed: 0, current: 0, jobNamed: 0, young: 0, baseOfASurvivor: 0,
    };
    const proofQuery = vi.fn().mockResolvedValueOnce({ rows: [{
      seen: 1, not_draft_or_failed: 0, current: 0, job_named: 0, young: 0, base_of_a_survivor: 1,
    }] }).mockResolvedValue({ rows: [{ level: "read committed" }] });
    const rows = [{ id: "locked-revision" }];
    const selection = {
      from: () => selection, where: () => selection,
      orderBy: () => selection, limit: () => selection,
      for: vi.fn().mockResolvedValue(rows),
      // biome-ignore lint/suspicious/noThenProperty: Drizzle selections are deliberately awaitable.
      then: (resolve: (value: typeof rows) => unknown) => resolve(rows),
    };
    const tx = {
      select: () => selection, execute: proofQuery,
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({ rowCount: 1 }) }),
    };
    const db = { transaction: async (body: (tx: unknown) => unknown) => await body(tx) } as unknown as Db;
    const survey: BacklogSurvey = {
      ...surveyTotals,
      proven: true, revisions: 1, proof: originalProof,
      articles: [{ articleId: "article", revisionIds: ["locked-revision"], revisions: 1, blocks: 0, bytes: 0 }],
    };
    await expect(deleteDraftBacklog(db, survey)).rejects.toThrow("a locked batch is protected");
    expect(proofQuery).toHaveBeenCalledOnce();
    expect(selection.for).toHaveBeenNthCalledWith(2, "update", { skipLocked: true });
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("bounds attempts by surveyed batches even when every candidate is locked", async () => {
    let active = false;
    const transaction = vi.fn(async (body: (tx: unknown) => unknown, _config?: unknown) => {
      expect(active).toBe(false);
      active = true;
      const selection = {
        from: () => selection, where: () => selection,
        for: vi.fn().mockResolvedValue([]),
      };
      try { return await body({ select: () => selection }); }
      finally { active = false; }
    });
    const db = { transaction } as unknown as Db;
    const ids = Array.from({ length: DRAFT_SWEEP_BATCH + 1 }, (_, i) => `revision-${i}`);
    const survey: BacklogSurvey = {
      ...surveyTotals,
      proven: true, revisions: ids.length * 2,
      proof: { seen: ids.length * 2, notDraftOrFailed: 0, current: 0, jobNamed: 0, young: 0, baseOfASurvivor: 0 },
      articles: ["first", "second"].map((articleId) => ({ articleId, revisionIds: ids, revisions: ids.length, blocks: 0, bytes: 0 })),
    };
    await expect(deleteDraftBacklog(db, survey)).resolves.toEqual([
      { articleId: "first", deleted: 0 }, { articleId: "second", deleted: 0 },
    ]);
    expect(transaction).toHaveBeenCalledTimes(4);
    for (const call of transaction.mock.calls) expect(call[1]).toEqual(READ_COMMITTED);
    expect(active).toBe(false);
  });

  it("reads the local file even when shell DATABASE_URL is pinned", () => {
    vi.stubEnv("DATABASE_URL", "postgres://shell:secret@remote.invalid/db");
    vi.stubEnv("SPIDERYARN_ENV_PINNED", "DATABASE_URL");
    vi.mocked(fs.readFileSync).mockReturnValueOnce("DATABASE_URL='postgres://local:secret@localhost/db'");
    const target = draftBacklogTarget(false);
    expect(target.url).toBe("postgres://local:secret@localhost/db");
    expect(target.file).toMatch(/\/\.env\.local$/);
  });

  it("a missing local file never falls back to shell DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "postgres://shell:secret@remote.invalid/db");
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    expect(draftBacklogTarget(false).url).toBeUndefined();
  });

  it("reads the production file and retains its provenance", () => {
    vi.stubEnv("DATABASE_URL", "postgres://shell:secret@wrong.invalid/db");
    vi.mocked(readEnvProd).mockReturnValueOnce({
      file: "/fixture/.env.prod", values: { DATABASE_URL: "postgres://prod:secret@prod.invalid/db" },
    });
    expect(draftBacklogTarget(true)).toEqual({
      file: "/fixture/.env.prod", url: "postgres://prod:secret@prod.invalid/db",
    });
  });
});
