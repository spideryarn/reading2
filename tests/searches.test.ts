/**
 * Saved-search storage — src/searches.ts. See docs/project/search.md.
 *
 * Deterministic: no network, no model. The nondeterministic half of the feature
 * — what the model says about a paragraph — is not tested here, for the reason
 * testing.md gives; what `findPassages` does with the answer once it has it is
 * in tests/search.test.ts.
 *
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 * Same shape as tests/comments.test.ts, because src/searches.ts is the same
 * shape as src/comments.ts.
 */
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { beginRun, deleteRun, finishRun, loadRuns, MAX_RUNS, update } from "../src/searches.js";
import type { SearchHit } from "../src/types.js";

const SLUG = "test-searches-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
const FILE = path.join(DIR, "searches.json");

const HIT: SearchHit = {
  blockId: "spya-k3m9qt",
  quote: "mind is software",
  confidence: 85,
  reasoning: "States the position being rejected.",
};

afterEach(() => rm(DIR, { recursive: true, force: true }));

describe("saved-search storage", () => {
  it("is empty for an article nobody has searched", async () => {
    expect(await loadRuns(SLUG)).toEqual([]);
  });

  it("refuses a slug that is not a path segment, rather than sanitising one", async () => {
    // A slug becomes a directory name. Refusing is the whole defence; a
    // sanitiser is a thing that can be wrong about one case.
    await expect(loadRuns("../etc")).rejects.toThrow(/Not a valid slug/);
    await expect(loadRuns("..")).rejects.toThrow(/Not a valid slug/);
  });

  /**
   * The ordering that is the reason `beginRun` exists at all: the criterion is
   * on disk **before** the model is called, so a crash leaves a visible
   * unfinished search rather than a question that evaporated with the process.
   */
  it("stores a run as pending, before any model has been called", async () => {
    const run = await beginRun(SLUG, "arguments against the main claim");
    expect(run.status).toBe("pending");
    expect(run.hits).toEqual([]);
    expect(await loadRuns(SLUG)).toEqual([run]);
  });

  it("accepts an id the client minted, so ?run= can name it from the first frame", async () => {
    const run = await beginRun(SLUG, "evidence", "spya-k3m9qt");
    expect(run.id).toBe("spya-k3m9qt");
  });

  it("mints its own id rather than trusting one that is not ours", async () => {
    const run = await beginRun(SLUG, "evidence", "../../etc/passwd");
    expect(run.id).not.toBe("../../etc/passwd");
    expect(run.id).toMatch(/^spya-[a-z0-9]{6}$/);
  });

  it("mints its own id rather than overwriting a run that already has that one", async () => {
    // What makes a duplicate send harmless instead of a way to write over
    // somebody else's saved search.
    const first = await beginRun(SLUG, "evidence", "spya-k3m9qt");
    const second = await beginRun(SLUG, "something else", "spya-k3m9qt");
    expect(second.id).not.toBe(first.id);
    expect(await loadRuns(SLUG)).toHaveLength(2);
  });

  it("writes the answer over the pending row rather than appending a second one", async () => {
    // Appending would leave the pending row behind as a permanent spinner that
    // nothing can ever clear.
    const run = await beginRun(SLUG, "evidence");
    const after = await finishRun(SLUG, run.id, { status: "done", hits: [HIT], model: "m" });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: run.id, status: "done", model: "m" });
    expect(after[0]!.hits).toEqual([HIT]);
  });

  it("keeps the criterion the reader typed, whatever a patch tries to say", async () => {
    const run = await beginRun(SLUG, "the original question");
    const [stored] = await finishRun(SLUG, run.id, {
      status: "done",
      hits: [],
      criterion: "something else entirely",
    } as never);
    expect(stored!.criterion).toBe("the original question");
  });

  it("stores a failure on the run rather than throwing it away", async () => {
    const run = await beginRun(SLUG, "evidence");
    const [stored] = await finishRun(SLUG, run.id, { status: "error", error: "the model timed out" });
    expect(stored).toMatchObject({ status: "error", error: "the model timed out" });
  });

  /**
   * The delete-during-search race, from the storage end.
   *
   * A search takes tens of seconds and the reader can delete it while it is
   * out. `finishRun` must not resurrect what they removed — the client's
   * tombstone (useSearch.ts) is the other half of the same guarantee, and this
   * is the half that means the file on disk is right even if the client is
   * closed.
   */
  it("does not bring back a run that was deleted while the model was thinking", async () => {
    const run = await beginRun(SLUG, "evidence");
    await deleteRun(SLUG, run.id);
    const after = await finishRun(SLUG, run.id, { status: "done", hits: [HIT] });
    expect(after).toEqual([]);
  });

  it("deletes one run without touching its neighbours", async () => {
    const a = await beginRun(SLUG, "first");
    const b = await beginRun(SLUG, "second");
    const left = await deleteRun(SLUG, a.id);
    expect(left.map((r) => r.id)).toEqual([b.id]);
  });

  it("drops the oldest once the cap is reached", async () => {
    // The oldest end, deliberately: the searches you come back to are the ones
    // you ran recently.
    for (let i = 0; i < MAX_RUNS + 3; i++) await beginRun(SLUG, `criterion ${i}`);
    const runs = await loadRuns(SLUG);
    expect(runs).toHaveLength(MAX_RUNS);
    expect(runs[0]!.criterion).toBe("criterion 3");
    expect(runs[MAX_RUNS - 1]!.criterion).toBe(`criterion ${MAX_RUNS + 2}`);
  });

  it("survives a file that has the key but no runs in it", async () => {
    await update(SLUG, () => []);
    expect(await loadRuns(SLUG)).toEqual([]);
    expect(JSON.parse(await readFile(FILE, "utf8"))).toEqual({ runs: [] });
  });

  it("throws rather than silently emptying itself when the file will not parse", async () => {
    // Every saved search for the article is unreadable at once, and a `[]`
    // here would look exactly like "you have never searched this" — then the
    // next write would make that true.
    await update(SLUG, () => []);
    await readFile(FILE, "utf8"); // the file exists
    const { writeFile } = await import("node:fs/promises");
    await writeFile(FILE, "{ not json", "utf8");
    await expect(loadRuns(SLUG)).rejects.toThrow();
  });

  /**
   * The serialised queue, which matters more here than it looks.
   *
   * A run is written twice, tens of seconds apart, with the reader free to
   * start a second search in between. Without the chain the second read sees
   * the file as it was before the first write landed and puts it back that way:
   * both writes succeed, and one search is simply gone.
   */
  it("does not lose a run to a concurrent write", async () => {
    const [a, b, c] = await Promise.all([
      beginRun(SLUG, "one"),
      beginRun(SLUG, "two"),
      beginRun(SLUG, "three"),
    ]);
    const runs = await loadRuns(SLUG);
    expect(runs).toHaveLength(3);
    expect(new Set(runs.map((r) => r.id))).toEqual(new Set([a.id, b.id, c.id]));
  });

  it("resets a run in place when the retry sends its own id back", async () => {
    /* The shape of a retry: beginRun, then finishRun with an error — the failed
       row stays on disk, same as any other failure — then beginRun again with
       the *same* id, which is exactly what useSearch.ts's retry() sends.

       beginRun used to read any id already in the file as a collision to defend
       against, so a retry minted a second run and answered under the new id.
       The old row was never named again, so the spinner the reader was looking
       at never stopped, and a reload showed an unexplained duplicate beside the
       failure. createComment has had the reset-in-place branch all along; this
       is the same rule for the same reason.
       docs/postmortems/search-retry-remints-instead-of-resetting.md */
    const first = await beginRun(SLUG, "arguments against the main claim", "spya-k3m9qt");
    await finishRun(SLUG, first.id, { status: "error", error: "the model timed out" });

    const retried = await beginRun(SLUG, "arguments against the main claim", "spya-k3m9qt");

    expect(retried.id).toBe(first.id);
    expect(retried.status).toBe("pending");
    expect(retried.hits).toEqual([]);
    const runs = await loadRuns(SLUG);
    expect(runs).toHaveLength(1);
  });
});
