/**
 * `npm run db:start`'s refusals, as a pure decision — nothing here starts
 * Supabase, and nothing here may: the local stack is shared by every session.
 * docs/plans/261025i-guard-the-shared-local-supabase-against-being-mounted-from-a-worktree.md.
 */
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decideStart } from "../scripts/db-start.js";

const ours = (workdir: string | undefined) => ({
  Name: "/supabase_kong_spideryarn2",
  Config: {
    Labels: { "com.supabase.cli.project": "spideryarn2", ...(workdir === undefined ? {} : { "com.supabase.cli.workdir": workdir }) },
  },
});

describe("decideStart", () => {
  let primary: string;
  beforeEach(() => {
    primary = realpathSync(mkdtempSync(path.join(tmpdir(), "db-start-")));
  });
  afterEach(() => rmSync(primary, { recursive: true, force: true }));

  const base = () => ({ here: primary, primary, linked: false, args: [] as string[], containers: [] as unknown[] | undefined });

  it("starts from the primary when nothing is running, passing the args on", () => {
    expect(decideStart({ ...base(), args: ["-x", "vector"] })).toEqual({ kind: "start", args: ["-x", "vector"], warnings: [] });
  });

  it("refuses in a linked worktree, naming the primary", () => {
    const d = decideStart({ ...base(), here: "/srv/wt/tree", linked: true });
    expect(d.kind).toBe("refuse");
    if (d.kind !== "refuse") return;
    expect(d.lines.join("\n")).toContain(primary);
    expect(d.lines.join("\n")).toContain("npm run db:start");
  });

  it("refuses a forwarded --workdir, in both spellings", () => {
    expect(decideStart({ ...base(), args: ["--workdir", "/srv/wt/tree"] }).kind).toBe("refuse");
    expect(decideStart({ ...base(), args: ["--workdir=/srv/wt/tree"] }).kind).toBe("refuse");
  });

  it("refuses when the existing stack was started from somewhere else", () => {
    const d = decideStart({ ...base(), containers: [ours("/srv/wt/gone-tree")] });
    expect(d.kind).toBe("refuse");
    if (d.kind !== "refuse") return;
    const text = d.lines.join("\n");
    expect(text).toContain("/srv/wt/gone-tree");
    expect(text).toContain("npm run db:stop && npm run db:start");
  });

  it("refuses a workdir that is merely under this checkout — equality, not containment", () => {
    expect(decideStart({ ...base(), containers: [ours(path.join(primary, "sub"))] }).kind).toBe("refuse");
  });

  it("accepts its own workdir, however it is spelled", () => {
    const alias = `${primary}-alias`;
    symlinkSync(primary, alias);
    try {
      expect(decideStart({ ...base(), containers: [ours(alias), ours(`${primary}/`)] }).kind).toBe("start");
    } finally {
      rmSync(alias);
    }
  });

  it("warns, and still starts, on a container with no workdir label", () => {
    const d = decideStart({ ...base(), containers: [ours(undefined)] });
    expect(d.kind).toBe("start");
    if (d.kind !== "start") return;
    expect(d.warnings.join("\n")).toContain("supabase_kong_spideryarn2");
  });

  it("ignores another project's containers", () => {
    const theirs = {
      Name: "/supabase_db_hellozenno",
      Config: { Labels: { "com.supabase.cli.project": "hellozenno", "com.supabase.cli.workdir": "/elsewhere" } },
    };
    expect(decideStart({ ...base(), containers: [theirs] }).kind).toBe("start");
  });

  it("starts when Docker could not be asked, and leaves supabase to say so", () => {
    expect(decideStart({ ...base(), containers: undefined }).kind).toBe("start");
  });
});
