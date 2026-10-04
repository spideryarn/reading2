/** CLI boundaries, with no network, database, or real credentials. */
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  articleId: crypto.randomUUID(),
  revisionId: crypto.randomUUID(),
  output: [] as string[],
  saved: "",
  hasErrorListener: false,
  emittedError: null as unknown,
  connectedAfterTarget: false,
  client: null as { emit: (event: string, error: Error) => boolean; listenerCount: (event: string) => number } | null,
}));
const LOCAL = "postgres://postgres:not-a-real-password@127.0.0.1:54362/postgres";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    default: {
      ...fs,
      existsSync: (file: string) => file.endsWith(".env.local"),
      readFileSync: (file: string) => {
        if (file.endsWith(".env.local")) return `DATABASE_URL=${LOCAL}\n`;
        if (file.endsWith("plan.json"))
          return JSON.stringify({
            version: 1,
            target: { host: "127.0.0.1", port: "54362", database: "postgres", user: "postgres" },
            rows: [
              {
                slug: "gone",
                articleId: state.articleId,
                revisionId: state.revisionId,
                write: { journal: "Journal" },
              },
            ],
          });
        throw new Error("unexpected file read");
      },
      mkdirSync: () => {},
      writeFileSync: (_file: string, text: string) => {
        state.saved = text;
      },
    },
  };
});
vi.mock("../src/env.js", async (original) => {
  const env = await original<typeof import("../src/env.js")>();
  return {
    ...env,
    loadEnvLocal: () => {
      console.warn("[env] mock warning");
    },
    resolveTargetUrl: () => LOCAL,
    readEnvProd: () => {
      throw new Error("production must not be selected");
    },
  };
});
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  class Client extends EventEmitter {
    constructor() {
      super();
      state.client = this;
    }
    async connect() {
      state.connectedAfterTarget = state.output[0]?.startsWith("Target:") === true;
    }
    async end() {}
    async query(sql: string) {
      if (sql.includes("current_database")) return { rows: [{ db: "postgres" }] };
      if (sql.includes("information_schema")) return { rows: [{}] };
      if (sql.includes("join spideryarn.article_revisions"))
        return {
          rows: [
            {
              articleId: state.articleId,
              revisionId: state.revisionId,
              slug: "paper",
              title: "A distinctive paper about memory consolidation",
              byline: "Nicolas Maingret",
              authors: null,
              doi: null,
              journal: null,
              publishedAt: null,
              publishedYear: null,
              finalUrl: null,
              requestedUrl: null,
              uploaded: true,
              rawSourceSha256: "a".repeat(64),
              rawSourceKind: "html",
              hasTimeline: false,
              hasDraft: false,
            },
          ],
        };
      if (sql === "rollback") throw new Error("connection died while asking registry");
      return { rows: [] };
    }
  }
  return { Client };
});
vi.mock("../src/store/blobs.js", () => ({ postgresBlobStore: () => ({}) }));
vi.mock("../src/store/raw-document.js", () => ({
  readRawDocument: async () => ({
    kind: "html",
    bytes: new TextEncoder().encode('<meta name="citation_doi" content="10.1234/real">'),
  }),
}));
vi.mock("../src/backfill-registry-facts.js", async (original) => {
  const backfill = await original<typeof import("../src/backfill-registry-facts.js")>();
  return {
    ...backfill,
    registryLookup: () => async () => {
      state.hasErrorListener = (state.client?.listenerCount("error") ?? 0) > 0;
      try {
        state.client?.emit("error", new Error("idle connection terminated"));
      } catch (error) {
        state.emittedError = error;
      }
      return {
        kind: "found",
        record: {
          id: "doi:10.1234/real",
          source: "crossref",
          doi: "10.1234/real",
          title: "A distinctive paper about memory consolidation",
          authors: [{ family: "Maingret", given: "Nicolas" }],
          venue: "Journal",
          year: 2016,
        },
      };
    },
  };
});

describe("backfill CLI", () => {
  it("prints Target before connecting or env warnings, and saves the plan after an idle error", async () => {
    const argv = process.argv;
    const log = vi.spyOn(console, "log").mockImplementation((...args) => {
      state.output.push(args.join(" "));
    });
    const warn = vi.spyOn(console, "warn").mockImplementation((...args) => {
      state.output.push(args.join(" "));
    });
    const error = vi.spyOn(console, "error").mockImplementation((...args) => {
      state.output.push(args.join(" "));
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("unexpected exit");
    });
    try {
      process.argv = ["node", "scripts/backfill-registry-facts.ts", "--out", "/tmp/fake-plan.json"];
      await import("../scripts/backfill-registry-facts.js");
      await vi.waitFor(() => {
        expect(state.saved).not.toBe("");
      });
      expect(state.hasErrorListener).toBe(true);
      expect(state.emittedError).toBeNull();
      expect(state.connectedAfterTarget).toBe(true);
      expect(state.output[0]).toMatch(/^Target:/);
      expect(state.output.join(" ")).not.toContain("not-a-real-password");
      expect(state.saved).not.toContain("not-a-real-password");
      expect(JSON.parse(state.saved).rows[0].write).toEqual({
        doi: "10.1234/real",
        journal: "Journal",
        published_year: 2016,
      });
    } finally {
      process.argv = argv;
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
      exit.mockRestore();
    }
  });
});

describe("apply CLI outcome", () => {
  it("exits nonzero when every planned write is refused", async () => {
    vi.resetModules();
    const argv = process.argv;
    const exitCode = process.exitCode;
    const output: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "));
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation((...args) => {
      output.push(args.join(" "));
    });
    try {
      process.exitCode = 0;
      process.argv = ["node", "scripts/backfill-registry-facts.ts", "--apply", "/tmp/plan.json"];
      await import("../scripts/backfill-registry-facts.js");
      await vi.waitFor(() => {
        expect(process.exitCode).toBe(1);
      });
      expect(output.join(" ")).toContain("written 0, already as the plan says 0, refused 1");
      expect(output.join(" ")).not.toContain("committed");
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
