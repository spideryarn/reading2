/**
 * The describer's memory on disk.
 *
 * It is both the cache and the published artefact, so what it will and will not
 * read back is what the page will and will not show. Two rules carry that, and
 * both are here because the alternative is a row saying something confident
 * about a session it is not about:
 *
 *  - **A lost file is a cost, never a lie.** Missing or corrupt is replaced, and
 *    the arms stay distinct so a fresh box and a broken file are not one state.
 *  - **An empty string is not a description**, on the way in AND on the way out.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DESCRIPTIONS_FILE,
  DESCRIPTIONS_SCHEMA,
  descriptionsRoot,
  parseDescriptionMemory,
  readDescriptionMemory,
  writeDescriptionMemory,
  type DescriptionRecord,
} from "../tools/fleet/describe-store.js";

function root(): string {
  return mkdtempSync(path.join(tmpdir(), "fleet-descriptions-"));
}

function record(over: Partial<DescriptionRecord> = {}): DescriptionRecord {
  return {
    fingerprint: "abc123",
    executionToken: "boot:4242:99",
    describedAt: "2026-09-09T02:00:00.000Z",
    described: { title: "Fix the toc", description: "Repair the nested table of contents." },
    ...over,
  };
}

describe("what survives a round trip", () => {
  it("writes and reads a record back unchanged", () => {
    const dir = root();
    writeDescriptionMemory(dir, { records: new Map([[`$1 conv-1 ${record().executionToken}`, record()]]), refusals: new Map() });

    const read = readDescriptionMemory(dir);
    expect(read.kind).toBe("memory");
    if (read.kind !== "memory") return;
    expect(read.memory.records.get(`$1 conv-1 ${record().executionToken}`)).toEqual(record());
  });

  it("writes a file a person can read, with its schema on it", () => {
    const dir = root();
    writeDescriptionMemory(dir, { records: new Map([[`$1 conv-1 ${record().executionToken}`, record()]]), refusals: new Map() });
    const raw = JSON.parse(readFileSync(path.join(dir, DESCRIPTIONS_FILE), "utf8"));
    expect(raw.schema).toBe(DESCRIPTIONS_SCHEMA);
    expect(typeof raw.writtenAt).toBe("string");
  });
});

describe("the three answers a read can give", () => {
  it("says absent for a box that has never described anything", () => {
    expect(readDescriptionMemory(root()).kind).toBe("absent");
  });

  /**
   * Absent and unusable are different facts. Collapsing them would make a
   * corrupted memory indistinguishable from a fresh box, and the pass would
   * report "nothing described yet" about a file it could not read.
   */
  it("says unusable — not absent — for a file that is not JSON", () => {
    const dir = root();
    writeFileSync(path.join(dir, DESCRIPTIONS_FILE), "{{{");
    const read = readDescriptionMemory(dir);
    expect(read.kind).toBe("unusable");
  });

  it("refuses a schema this build does not read, rather than guessing at it", () => {
    const read = parseDescriptionMemory({ schema: 99, records: {} });
    expect(read.kind).toBe("unusable");
    if (read.kind === "unusable") expect(read.why).toContain("99");
  });

  it("refuses the whole file when one record is unreadable", () => {
    const read = parseDescriptionMemory({
      schema: DESCRIPTIONS_SCHEMA,
      records: { "$1 c boot:4242:99": record(), "$2 c boot:4242:99": { fingerprint: "x" } },
    });
    expect(read.kind).toBe("unusable");
    if (read.kind === "unusable") expect(read.why).toContain("$2");
  });

  /**
   * The arm Greg ruled out by name, defended on the way OUT as well as in. A
   * file holding an empty description was written by a build that allowed one,
   * and reading it back would reintroduce exactly what the parser refuses at the
   * source.
   */
  it("refuses a stored description that is an empty string", () => {
    const read = parseDescriptionMemory({
      schema: DESCRIPTIONS_SCHEMA,
      records: { "$1 c boot:4242:99": { ...record(), described: { title: "t", description: "   " } } },
    });
    expect(read.kind).toBe("unusable");
  });

  /**
   * INVERTED BY F20, and the old expectation was the hole.
   *
   * This used to accept a record with no execution token, on the reasoning that
   * "unverified is a real state". It is — but such a record cannot be *coherent*,
   * because a coherent record's token is the last field of the key it was filed
   * under. And an incoherent record is worse than useless: the pass looks its
   * cache up by fingerprint alone, so a record like this could be fetched by
   * content and then re-filed under a valid key and token, laundering a
   * description onto a session it is not about.
   */
  it("refuses a record with no execution token, because its key could not have contained one", () => {
    const read = parseDescriptionMemory({
      schema: DESCRIPTIONS_SCHEMA,
      records: { "$1": { ...record(), executionToken: null } },
    });
    expect(read.kind).toBe("unusable");
  });

  it("refuses a record whose token is not the one in its key", () => {
    const read = parseDescriptionMemory({
      schema: DESCRIPTIONS_SCHEMA,
      records: { "$1 conv-1 boot:1:1": { ...record(), executionToken: "boot:9:9" } },
    });
    expect(read.kind).toBe("unusable");
  });

  it("remembers a permanent refusal, so the same opening is not paid for twice", () => {
    const read = parseDescriptionMemory({
      schema: DESCRIPTIONS_SCHEMA,
      records: {},
      refusals: { abc123: "the opening is only machinery" },
    });
    expect(read.kind).toBe("memory");
    if (read.kind === "memory") expect(read.memory.refusals.get("abc123")).toContain("machinery");
  });

  /**
   * A bad refusal costs a model call, not a wrong sentence — so it is skipped
   * rather than failing the whole file, unlike a bad record.
   */
  it("skips an unreadable refusal rather than refusing the file for it", () => {
    const read = parseDescriptionMemory({
      schema: DESCRIPTIONS_SCHEMA,
      records: {},
      refusals: { good: "a reason", bad: 42 },
    });
    expect(read.kind).toBe("memory");
    if (read.kind === "memory") {
      expect(read.memory.refusals.get("good")).toBe("a reason");
      expect(read.memory.refusals.has("bad")).toBe(false);
    }
  });
});

describe("where it lives", () => {
  it("takes an absolute OVERSEER_STORE_DIR", () => {
    expect(descriptionsRoot({ OVERSEER_STORE_DIR: "/var/tmp/x" } as NodeJS.ProcessEnv)).toBe("/var/tmp/x");
  });

  /**
   * A relative override is refused rather than resolved against a working
   * directory nobody chose — the same rule the checkpoint reader applies, and
   * for the same reason: two processes with different cwds would disagree about
   * where the fleet's state is.
   */
  it("ignores a relative one rather than resolving it against the cwd", () => {
    const chosen = descriptionsRoot({ OVERSEER_STORE_DIR: "some/where" } as NodeJS.ProcessEnv);
    expect(chosen).not.toContain("some/where");
    expect(chosen.endsWith(".overseer")).toBe(true);
  });
});
