/**
 * **Debate's third call: the themes the sources share, and the key sources**
 * (plan 260930j, SPIDERYARN-READING2-6M). The model is stubbed; nothing here
 * spends.
 *
 * Four things, each the half the others cannot see:
 *
 * - `workIds` — which rows are the same work, the rule a theme and a key pick
 *   are counted in;
 * - `readSynthesisAnswer` — the model's answer through `settleSynthesis`, and
 *   a malformed one stored as `failed` rather than as an empty finding;
 * - `readStoredSynthesis` — the same rules on the way out of the database;
 * - `synthesiseDebate` — every outcome named, a refusal stored as `failed`,
 *   and anything else, an abort included, still thrown.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let answer: () => Promise<unknown> = () => Promise.reject(new Error("no answer set"));
let callCount = 0;

vi.mock("../src/ai-call.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/ai-call.js")>();
  return {
    ...real,
    openRouterJson: () => {
      callCount += 1;
      return answer().then((json) => ({ json, answeredBy: null, generationId: null }));
    },
  };
});

const { synthesiseDebate } = await import("../src/debate.js");
const { readSynthesisAnswer, SYNTHESIS_MIN_ROWS } = await import("../src/debate-themes.js");
const { canonicalAddress, keyCap, readStoredSynthesis, titleKey, workIds } = await import(
  "../src/debate-synthesis.js"
);
const { ProviderRefused } = await import("../src/ai-call.js");
import type { ClaimDebateRow } from "../src/types.js";

const row = (id: string, url: string, title = `A distinct title for ${id}`): ClaimDebateRow => ({
  id,
  url,
  title,
  sourceQuote: "a passage quoted from the page",
  relation: "qualifies",
  lean: "neither",
  applies: "it bears on the claim",
  claimQuote: "the article's claim",
  blockId: "spya-aaaaaa",
});

/* Six rows, five works: r3 and r4 are one page. */
const rows = [
  row("spya-r00001", "https://a.example/one"),
  row("spya-r00002", "https://b.example/two"),
  row("spya-r00003", "https://c.example/three"),
  row("spya-r00004", "https://c.example/three"),
  row("spya-r00005", "https://d.example/four"),
  row("spya-r00006", "https://e.example/five"),
];

let n = 0;
const MINTED = ["spya-thaaaa", "spya-thbbbb", "spya-thcccc", "spya-thdddd", "spya-theeee", "spya-thffff", "spya-thgggg", "spya-thhhhh"];
const mint = () => MINTED[n++] ?? "spya-thzzzz";

beforeEach(() => {
  n = 0;
  callCount = 0;
});

function made(result: ReturnType<typeof readSynthesisAnswer>) {
  if (result.kind !== "made") throw new Error(`expected made, got ${result.kind}`);
  return result;
}

describe("which rows are one work", () => {
  it("treats the obvious aliases of an address as one", () => {
    expect(canonicalAddress("https://www.Example.org/a/b/?x=1#y")).toBe("example.org/a/b");
    expect(canonicalAddress("https://arxiv.org/abs/2407.09450v2")).toBe("arxiv:2407.09450");
    expect(canonicalAddress("https://arxiv.org/pdf/2407.09450.pdf")).toBe("arxiv:2407.09450");
  });

  it("matches titles past case, punctuation and a site suffix, but not a cut-short one", () => {
    expect(titleKey("Human-inspired Episodic Memory for Infinite Context LLMs")).toBe(
      titleKey("Human-inspired episodic memory for infinite-context LLMs | Project page"),
    );
    expect(titleKey("Memory Sources Associated with REM and NREM Dream Reports ...")).toBeNull();
    expect(titleKey("Short")).toBeNull();
  });

  it("joins rows by address or by title, transitively — the first measured pass's two copies", () => {
    const works = workIds([
      row("spya-w00001", "https://arxiv.org/abs/2407.09450", "Human-inspired Episodic Memory for Infinite Context LLMs"),
      row("spya-w00002", "https://em-llm.github.io/", "Human-inspired Episodic Memory for Infinite Context LLMs"),
      row("spya-w00003", "https://arxiv.org/pdf/2407.09450v1", "(no title)"),
      row("spya-w00004", "https://aclanthology.org/2023.emnlp-main.495/"),
    ]);
    expect(works.get("spya-w00001")).toBe(works.get("spya-w00002"));
    expect(works.get("spya-w00001")).toBe(works.get("spya-w00003"));
    expect(works.get("spya-w00004")).not.toBe(works.get("spya-w00001"));
  });
});

describe("readSynthesisAnswer", () => {
  it("keeps a theme over two works and mints it an id", () => {
    const got = made(
      readSynthesisAnswer(
        { themes: [{ label: "L", gist: "G", sources: ["spya-r00001", "spya-r00002"] }], key: [] },
        rows,
        mint,
      ),
    );
    expect(got.themes).toEqual([
      { id: "spya-thaaaa", label: "L", gist: "G", rowIds: ["spya-r00001", "spya-r00002"] },
    ]);
  });

  it("drops a theme whose rows are all one work, however many rows", () => {
    const got = made(
      readSynthesisAnswer(
        {
          themes: [
            { label: "one page", gist: "G", sources: ["spya-r00003", "spya-r00004"] },
            { label: "kept", gist: "G", sources: ["spya-r00001", "spya-r00005"] },
          ],
          key: [],
        },
        rows,
        mint,
      ),
    );
    expect(got.themes.map((t) => t.label)).toEqual(["kept"]);
  });

  it("drops ids that are not rows, and duplicates, before counting works", () => {
    const got = made(
      readSynthesisAnswer(
        {
          themes: [
            { label: "L", gist: "G", sources: ["spya-r00001", "spya-r00001", "spya-nope00"] },
            { label: "M", gist: "H", sources: ["spya-r00001", "spya-nope00", "spya-r00005", 7] },
          ],
          key: [],
        },
        rows,
        mint,
      ),
    );
    expect(got.themes.map((t) => t.rowIds)).toEqual([["spya-r00001", "spya-r00005"]]);
  });

  it("drops a theme with an empty or overlong label, and caps the count at four", () => {
    const two = ["spya-r00001", "spya-r00002"];
    const themes = [
      { label: "  ", gist: "G", sources: two },
      { label: "x".repeat(81), gist: "G", sources: two },
      ...Array.from({ length: 6 }, (_, i) => ({ label: `T${i}`, gist: "G", sources: two })),
    ];
    const got = made(readSynthesisAnswer({ themes, key: [] }, rows, mint));
    expect(got.themes.map((t) => t.label)).toEqual(["T0", "T1", "T2", "T3"]);
  });

  it("keeps key sources with a real row and a known role, one per work, up to the cap", () => {
    const got = made(
      readSynthesisAnswer(
        {
          themes: [],
          key: [
            { source: "spya-r00003", role: "dissents", why: "W" },
            { source: "spya-r00004", role: "advances", why: "same page again" },
            { source: "spya-nope00", role: "responds", why: "W" },
            { source: "spya-r00002", role: "praises", why: "W" },
            { source: "spya-r00001", role: "origin", why: "" },
            { source: "spya-r00005", role: "origin", why: "W" },
            { source: "spya-r00006", role: "responds", why: "past the cap" },
          ],
        },
        rows,
        mint,
      ),
    );
    /* Five works: a cap of one. */
    expect(got.key).toEqual([{ rowId: "spya-r00003", role: "dissents", why: "W" }]);
  });

  it("stores an answer that offered nothing as an empty made", () => {
    expect(readSynthesisAnswer({ themes: [], key: [] }, rows, mint)).toEqual({
      kind: "made",
      themes: [],
      key: [],
    });
  });

  it("stores a malformed answer, or one where nothing survived, as failed", () => {
    for (const junk of [
      null,
      3,
      "text",
      [],
      {},
      { themes: [] },
      { themes: "no", key: {} },
      { themes: [{ label: "L", gist: "G", sources: ["spya-nope00", "spya-nope01"] }], key: [] },
      { themes: [], key: [{ source: "spya-r00001", role: "praises", why: "W" }] },
    ]) {
      expect(readSynthesisAnswer(junk, rows, mint)).toEqual({ kind: "failed" });
    }
  });
});

describe("keyCap", () => {
  it("is about one work in three, at least one and at most three", () => {
    expect([3, 5, 6, 9, 12, 24].map(keyCap)).toEqual([1, 1, 2, 3, 3, 3]);
  });
});

describe("readStoredSynthesis", () => {
  const debate = (synthesis: unknown) => ({ synthesis, direct: { rows: [] }, claims: { rows } });

  it("is null for a debate searched before synthesis existed, and for a shape it does not know", () => {
    expect(readStoredSynthesis(debate(undefined))).toBeNull();
    expect(readStoredSynthesis(debate({ kind: "something-new" }))).toBeNull();
    expect(readStoredSynthesis(debate("made"))).toBeNull();
    expect(readStoredSynthesis(debate({ kind: "too-few", rows: -1 }))).toBeNull();
    expect(readStoredSynthesis(debate({ kind: "too-few", rows: 1.5 }))).toBeNull();
  });

  it("names failed and too-few, and reads a made without its lists as failed", () => {
    expect(readStoredSynthesis(debate({ kind: "failed" }))).toEqual({ kind: "failed" });
    expect(readStoredSynthesis(debate({ kind: "too-few", rows: 2 }))).toEqual({ kind: "too-few", rows: 2 });
    expect(readStoredSynthesis(debate({ kind: "made", themes: [] }))).toEqual({ kind: "failed" });
  });

  it("re-applies every live rule to what was stored", () => {
    const stored = readStoredSynthesis(
      debate({
        kind: "made",
        themes: [
          { id: "spya-thaaaa", label: "L", gist: "G", rowIds: ["spya-r00001", "spya-gone00", "spya-r00002"] },
          { id: "spya-thaaaa", label: "same id", gist: "G", rowIds: ["spya-r00001", "spya-r00002"] },
          { id: "spya-thbbbb", label: "one work", gist: "G", rowIds: ["spya-r00003", "spya-r00004"] },
          { id: "not-an-id", label: "L", gist: "G", rowIds: ["spya-r00001", "spya-r00002"] },
          { id: "spya-thcccc", label: "x".repeat(500), gist: "G", rowIds: ["spya-r00001", "spya-r00002"] },
          { label: "no id", gist: "G", rowIds: ["spya-r00001", "spya-r00002"] },
        ],
        key: [
          { rowId: "spya-gone00", role: "dissents", why: "W" },
          { rowId: "spya-r00002", role: "grumbles", why: "W" },
          { rowId: "spya-r00003", role: "advances", why: "W" },
          { rowId: "spya-r00005", role: "advances", why: "past the cap" },
        ],
      }),
    );
    expect(stored).toEqual({
      kind: "made",
      themes: [{ id: "spya-thaaaa", label: "L", gist: "G", rowIds: ["spya-r00001", "spya-r00002"] }],
      key: [{ rowId: "spya-r00003", role: "advances", why: "W" }],
    });
  });
});

describe("synthesiseDebate", () => {
  const stop = (content: unknown) => ({ choices: [{ finish_reason: "stop", message: { content } }] });
  const fenced = (body: unknown) => stop(`\`\`\`debate\n${JSON.stringify(body)}\n\`\`\``);

  it("asks nothing below the minimum, and says so", async () => {
    const few = rows.slice(0, SYNTHESIS_MIN_ROWS - 1);
    expect(await synthesiseDebate({ rows: few, model: "m" })).toEqual({ kind: "too-few", rows: few.length });
    expect(callCount).toBe(0);
  });

  it("reads a clean answer", async () => {
    answer = () =>
      Promise.resolve(
        fenced({
          themes: [{ label: "L", gist: "G", sources: ["spya-r00001", "spya-r00002"] }],
          key: [{ source: "spya-r00001", role: "dissents", why: "W" }],
        }),
      );
    const got = await synthesiseDebate({ rows, model: "m" });
    expect(got.kind).toBe("made");
    if (got.kind !== "made") return;
    expect(got.themes.map((t) => t.rowIds)).toEqual([["spya-r00001", "spya-r00002"]]);
    expect(got.key).toEqual([{ rowId: "spya-r00001", role: "dissents", why: "W" }]);
  });

  it("stores failed — not an empty made — for every unusable answer", async () => {
    const unusable: unknown[] = [
      { choices: [{ finish_reason: "length", message: { content: "```debate\n{" } }] },
      { choices: [] },
      null,
      stop("no fence at all"),
      stop("```debate\nnot json\n```"),
      stop("```debate\n[]\n```"),
      stop(["not", "a", "string"]),
      stop('```debate\n{"themes": [], "key": []}\n```\n```debate\n{"th'),
    ];
    for (const json of unusable) {
      answer = () => Promise.resolve(json);
      expect(await synthesiseDebate({ rows, model: "m" })).toEqual({ kind: "failed" });
    }
  });

  it("stores failed when the provider refuses", async () => {
    answer = () => Promise.reject(new ProviderRefused(502, "", new Headers()));
    expect(await synthesiseDebate({ rows, model: "m" })).toEqual({ kind: "failed" });
  });

  it("rethrows anything else — a transport error or a bug is not a missing box", async () => {
    const broken = new TypeError("fetch failed");
    answer = () => Promise.reject(broken);
    await expect(synthesiseDebate({ rows, model: "m" })).rejects.toBe(broken);
  });

  it("rethrows an abort rather than storing it", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    controller.abort(reason);
    answer = () => Promise.reject(reason);
    await expect(synthesiseDebate({ rows, model: "m", signal: controller.signal })).rejects.toBe(reason);
  });
});
