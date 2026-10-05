import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "../src/types.js";

const fake = vi.hoisted(() => ({
  rows: [] as { archivedAt: Date | null }[],
  entries: [] as LibraryEntry[],
  list: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../src/db/client.js", () => ({
  getDb: () => ({
    select: fake.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => fake.rows }) }),
    })),
  }),
}));
vi.mock("../src/store/pg.js", async (original) => ({
  ...await original<typeof import("../src/store/pg.js")>(),
  pgArticleReader: { listArticles: fake.list.mockImplementation(async () => fake.entries) },
}));

const { pgShelfStore } = await import("../src/store/pg-shelf.js");

beforeEach(() => {
  fake.rows = [];
  fake.entries = [];
  fake.list.mockClear();
  fake.select.mockClear();
});

describe("an empty shelf patch still establishes which row it describes", () => {
  it("rejects a missing owned row rather than answering null", async () => {
    await expect(pgShelfStore.patch("missing-article", {})).rejects.toMatchObject({ status: 404 });
    expect(fake.list).not.toHaveBeenCalled();
  });

  it("reads the archived half for an archived row", async () => {
    fake.rows = [{ archivedAt: new Date("2026-10-04T12:00:00Z") }];
    fake.entries = [{ slug: "archived-article" } as LibraryEntry];
    await expect(pgShelfStore.patch("archived-article", {})).resolves.toBe(fake.entries[0]);
    expect(fake.list).toHaveBeenCalledWith({ archived: true });
  });

  it("can answer null for an existing unpublished row", async () => {
    fake.rows = [{ archivedAt: null }];
    await expect(pgShelfStore.patch("importing-article", {})).resolves.toBeNull();
    expect(fake.select).toHaveBeenCalledOnce();
  });
});
