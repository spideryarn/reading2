/**
 * **The command bar's Metadata rows, checked without rendering anything** —
 * the section rows, Archive and Export, stage B of
 * docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md.
 *
 * Greg, 2026-10-01 (SPIDERYARN-READING2-8D): *"Add a lot more Metadata
 * functionality to Commands … look for ways to make Commands more powerful and
 * universal and an easy-to-use way to do most things."*
 *
 * The words live in src/web/article-commands.ts, a leaf for rerun-commands.ts's
 * reason, so the ranking can be stated on exactly the rows production builds.
 * What Enter does — the address, the PATCH, the download — is the bar's, and
 * is in tests/command-bar-metadata-rows.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { METADATA_RERUN_STEPS } from "../src/rerun-steps.js";
import { MODES } from "../src/modes.js";
import { type Command, commandText, modeCommand, rankCommands } from "../src/web/command-match.js";
import {
  SECTION_ROWS,
  archiveCommand,
  exportCommand,
  sectionCommand,
} from "../src/web/article-commands.js";
import { METADATA_SECTIONS } from "../src/web/params.js";
import { rerunCommand } from "../src/web/rerun-commands.js";

const close = () => ({ kind: "close" }) as const;

/** The list in the order the bar hands it over, for one archive state. */
function list(archived: boolean): readonly Command[] {
  return [
    ...MODES.map(modeCommand),
    ...SECTION_ROWS.map((row) => sectionCommand(row, close)),
    archiveCommand(archived, close),
    exportCommand(close),
    ...METADATA_RERUN_STEPS.map((step) => rerunCommand(step, close)),
  ];
}

const labels = (commands: readonly Command[]): string[] => commands.map((c) => commandText(c).label);
const first = (query: string, archived = false): string | undefined =>
  labels(rankCommands(query, list(archived)))[0];

describe("the section rows", () => {
  it("are High-powered AI, AI processing and Access & sharing — not Export, not What it cost", () => {
    expect(SECTION_ROWS.map((row) => row.label)).toEqual([
      "High-powered AI",
      "AI processing",
      "Access & sharing",
    ]);
  });

  it("land only in sections the page accepts as an address", () => {
    for (const row of SECTION_ROWS) {
      expect(METADATA_SECTIONS as readonly string[], row.label).toContain(row.section);
    }
    /* High-powered AI has no section of its own: its switch is the first thing
       in AI processing (high-powered-ai.md). */
    expect(SECTION_ROWS.find((r) => r.label === "High-powered AI")?.section).toBe("ai-processing");
    expect(SECTION_ROWS.find((r) => r.label === "Access & sharing")?.section).toBe("access-sharing");
  });

  it("answer to the words a reader would use for a stronger model", () => {
    for (const query of [
      "high-powered",
      "high power",
      "opus",
      "more powerful ai",
      "stronger model",
      "better model",
    ]) {
      expect(first(query), query).toBe("High-powered AI");
    }
  });

  it("answer to the words for sharing, without taking `public` from the shared shelf", () => {
    for (const query of ["access", "share", "sharing", "publish", "private", "make public"]) {
      expect(first(query), query).toBe("Access & sharing");
    }
    /* Still listed for `public`, below anything that has the word as a name or
       a nickname of its own (the shared-articles page, in the real bar). */
    expect(labels(rankCommands("public", list(false)))).toContain("Access & sharing");
  });

  it("answer to AI processing by name, and leave every compound re-run phrase to its row", () => {
    expect(first("ai processing")).toBe("AI processing");
    expect(first("pipeline")).toBe("AI processing");
    for (const query of ["rerun glossary", "regenerate terms", "glossary again", "redo quotes"]) {
      expect(first(query), query).toMatch(/› Run again$/);
    }
    expect(first("glossary")).toBe("Glossary");
  });
});

describe("Archive", () => {
  it("is named for what pressing it does, which follows the state", () => {
    expect(commandText(archiveCommand(false, close)).label).toBe("Archive this article");
    expect(commandText(archiveCommand(true, close)).label).toBe("Unarchive this article");
  });

  it("is found by its words in each state", () => {
    for (const query of ["archive", "hide", "put away", "remove from shelf"]) {
      expect(first(query, false), query).toBe("Archive this article");
    }
    for (const query of ["unarchive", "restore", "put back", "put back on shelf"]) {
      expect(first(query, true), query).toBe("Unarchive this article");
    }
  });

  it("never answers the opposite word with the opposite act", () => {
    /* `unarchive` over a live article, and `hide` over an archived one, must
       not reach a row whose Enter does the other thing. */
    expect(labels(rankCommands("unarchive", list(false)))).not.toContain("Archive this article");
    expect(labels(rankCommands("put back", list(false)))).not.toContain("Archive this article");
    expect(labels(rankCommands("hide", list(true)))).not.toContain("Unarchive this article");
  });

  it("has one id whichever way round, so the selection does not jump when it flips", () => {
    const a = archiveCommand(false, close);
    const b = archiveCommand(true, close);
    expect(a.kind === "action" && b.kind === "action" && a.id === b.id).toBe(true);
  });
});

describe("Export", () => {
  it("is found by its words", () => {
    for (const query of ["export", "download", "zip", "backup", "export this article"]) {
      expect(first(query), query).toBe("Export this article");
    }
  });
});

describe("every new row", () => {
  it("spends nothing, and waits for a query", () => {
    const rows = [
      ...SECTION_ROWS.map((row) => sectionCommand(row, close)),
      archiveCommand(false, close),
      archiveCommand(true, close),
      exportCommand(close),
    ];
    for (const row of rows) {
      expect(row.kind).toBe("action");
      if (row.kind !== "action") continue;
      expect(row.generates, row.label).toBe(false);
      expect(row.typedOnly, row.label).toBe(true);
    }
    expect(rankCommands("", list(false))).toHaveLength(MODES.length);
  });
});
