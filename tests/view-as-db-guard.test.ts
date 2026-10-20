/** The SQL effect guard refuses unsupported lexical forms before any driver call. */
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const driver = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
  release: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    on() { return this; }
    query = driver.query;
    async connect() { return { query: driver.query, release: driver.release }; }
    async end() {}
  },
}));

import { closeDb, getDb } from "../src/db/client.js";
import type { OwnerId } from "../src/owner.js";
import { RefusedWhileViewingAs, runViewingAs, type ViewingAs } from "../src/view-as-scope.js";

const marker: ViewingAs = { actorId: "actor" as OwnerId, subjectId: "subject" as OwnerId, sessionId: "session" };
const pool = (getDb() as unknown as { $client: Pool }).$client;

beforeEach(() => vi.clearAllMocks());
afterAll(closeDb);

describe("the view-as SQL effect guard", () => {
  it.each([
    "select '\\', pg_notify('view_as_probe', 'x')",
    'select U&"pg\\005fnotify"(\'view_as_probe\', \'x\')',
    "-- comment\rnotify view_as_probe, 'x'",
    "prepare view_as_probe as select 1",
    "execute view_as_probe",
    "deallocate view_as_probe",
    "declare view_as_probe cursor with hold for select 1",
    "fetch all from view_as_probe",
    "move all from view_as_probe",
    "close view_as_probe",
    "load 'view_as_probe'",
    "explain (analyze) execute view_as_probe",
  ])("refuses unsupported syntax or known effects before execution: %s", async (text) => {
    await expect(runViewingAs(marker, () => pool.query(text))).rejects.toBeInstanceOf(RefusedWhileViewingAs);
    expect(driver.query).not.toHaveBeenCalled();
  });

  it("refuses protocol prepared-statement names before execution", async () => {
    await expect(runViewingAs(marker, () => pool.query({ text: "select 1", name: "view_as_probe" })))
      .rejects.toBeInstanceOf(RefusedWhileViewingAs);
    expect(driver.query).not.toHaveBeenCalled();
  });

  it("keeps a backslash in a bound value as data", async () => {
    await runViewingAs(marker, () => pool.query("select $1::text", ["\\ pg_notify U&\"pg\\005fnotify\""]));
    expect(driver.query).toHaveBeenCalledWith(
      expect.objectContaining({ text: "select $1::text", queryMode: "extended" }),
      ["\\ pg_notify U&\"pg\\005fnotify\""],
    );
  });

  it("leaves ordinary requests unchanged", async () => {
    const text = "select '\\', pg_notify('view_as_probe', 'x')";
    await pool.query(text);
    expect(driver.query).toHaveBeenCalledWith(text);
  });
});
