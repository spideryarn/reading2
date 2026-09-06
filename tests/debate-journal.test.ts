/**
 * **The capture journal: what it records, and the two things it must never say.**
 *
 * Stage A of
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md
 * § *Capture, as a two-event journal*. The model is stubbed; nothing here spends.
 *
 * `tests/debate-passes.test.ts` is about what goes out on the wire and what
 * happens when a pass comes back wrong. This file is about the record of that,
 * and the two rules GPT Sol's F40 and F52 put in the plan:
 *
 * 1. **An abort with no response gets metadata and an abort outcome and no
 *    invented response fields.**
 * 2. **An unmatched `attempt-started` means the process died or the outcome is
 *    unknown**, and nothing may report it as captured. On 2026-09-05 an OOM kill
 *    between the two passes billed pass A and wrote nothing at all.
 *
 * The third case worth its own test is a **non-2xx**, because the capture that
 * motivated all of this — $0.6252 that bought no replayable evidence — has to
 * survive the path where the provider refuses before there is any body to read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { job: string; body: Record<string, unknown> }[] = [];
/** What the stub answers next, one entry per call, oldest first. A thrower throws. */
let answers: (unknown | (() => never))[] = [];
/** How many journal lines had been written when each call was dispatched. */
const journalDepthAtCall: number[] = [];

vi.mock("../src/ai-call.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/ai-call.js")>();
  return {
    ...actual,
    openRouterJson: (job: string, body: Record<string, unknown>) => {
      calls.push({ job, body });
      journalDepthAtCall.push(written.length);
      const next = answers.shift();
      if (next === undefined) throw new Error("the stub was asked for more answers than it has");
      if (typeof next === "function") (next as () => never)();
      return Promise.resolve({ json: next, answeredBy: "anthropic/stub", generationId: "gen-1" });
    },
  };
});

const { generateDebate, DIRECT_SYSTEM, directPrompt } = await import("../src/debate.js");
const { ProviderRefused } = await import("../src/ai-call.js");
const { reconcile, reconciliationLines, sha256Of } = await import("../src/debate-journal.js");
import type { DebateJournal, DebateJournalEvent } from "../src/debate-journal.js";
import type { Article } from "../src/article-input.js";
import type { Block, Meta, Tree } from "../src/types.js";

/* --------------------------------------------------------------- the article -- */

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const blocks: Block[] = [
  block("spya-aaaaaa", "A starter left at room temperature will fall apart within a week."),
  block("spya-bbbbbb", "Rye flour ferments faster than white."),
];

const tree: Tree = {
  version: "t/1",
  generator: "test",
  slug: "starter-week-3",
  rootId: "spya-root00",
  nodes: {
    "spya-root00": {
      id: "spya-root00",
      depth: 0,
      parent: null,
      children: [],
      range: ["spya-aaaaaa", "spya-bbbbbb"],
      title: "The whole thing",
    },
  },
};

const meta = {
  slug: "starter-week-3",
  title: "Notes on my sourdough starter, week 3",
  byline: "Greg Detre",
  siteName: "Private baking notes",
  url: "https://gregs-private-baking-notes.example/starter-week-3",
} as Meta;

const article: Article = { slug: "starter-week-3", blocks, tree, meta };

/** A whole chat completion, as `openRouterJson` hands it back. */
function answer(opts: {
  fenced?: string;
  content?: string;
  finish?: string | null;
  searches?: number | null;
  annotations?: { url: string; title?: string; content?: string }[];
}): unknown {
  const content =
    opts.content ?? "Here is what I found.\n\n```debate\n" + (opts.fenced ?? "[]") + "\n```";
  return {
    choices: [
      {
        ...(opts.finish === null ? {} : { finish_reason: opts.finish ?? "stop" }),
        message: {
          content,
          annotations: (opts.annotations ?? []).map((a) => ({
            type: "url_citation",
            url_citation: a,
          })),
        },
      },
    ],
    ...(opts.searches === null
      ? { usage: { prompt_tokens: 1 } }
      : { usage: { server_tool_use: { web_search_requests: opts.searches ?? 4 } } }),
  };
}

const BLOG = {
  url: "https://myeclecticbites.com/sourdough-starter-notes",
  title: "Sourdough starter notes",
  content: "A starter kept on the counter will collapse in about a week if you feed it once a day.",
};

/* ------------------------------------------------------------- the test sink -- */

const written: DebateJournalEvent[] = [];
const journal: DebateJournal = {
  write: (event) => {
    written.push(event);
    return Promise.resolve();
  },
};

const of = <K extends DebateJournalEvent["event"]>(kind: K) =>
  written.filter((e): e is Extract<DebateJournalEvent, { event: K }> => e.event === kind);

beforeEach(() => {
  calls.length = 0;
  written.length = 0;
  journalDepthAtCall.length = 0;
  answers = [];
});

/* ------------------------------------------------------------- the happy path -- */

describe("a successful run", () => {
  it("writes three lines per pass, in order, the first of them before dispatch", async () => {
    answers = [answer({ searches: 3 }), answer({ searches: 4, annotations: [BLOG] })];

    await generateDebate({ article, journal });

    expect(written.map((e) => e.event)).toEqual([
      "attempt-started",
      "provider-response",
      "attempt-finished",
      "attempt-started",
      "provider-response",
      "attempt-finished",
    ]);
    /* **`attempt-started` is before dispatch and not merely before the answer.**
       F40 in one assertion: the first call went out with exactly one journal
       line already down, and the second with four. A record written after the
       provider answered would show 0 and 3. */
    expect(journalDepthAtCall).toEqual([1, 4]);
  });

  it("names the two passes and matches each response to its own start", async () => {
    answers = [answer({ searches: 3 }), answer({ searches: 4 })];

    await generateDebate({ article, journal });

    const starts = of("attempt-started");
    expect(starts.map((s) => s.pass)).toEqual(["direct", "claims"]);
    expect(new Set(starts.map((s) => s.attemptId)).size).toBe(2);
    for (const start of starts) {
      const mine = written.filter((e) => e.attemptId === start.attemptId);
      expect(mine).toHaveLength(3);
    }
  });

  it("records the search configuration that actually went on the wire", async () => {
    answers = [answer({ searches: 3 }), answer({ searches: 4 })];

    await generateDebate({ article, journal });

    const [direct] = of("attempt-started");
    const sent = calls[0]?.body as { tools: { parameters: Record<string, unknown> }[] };
    expect(direct?.search).toEqual({
      engine: sent.tools[0]?.parameters.engine,
      maxTotalResults: sent.tools[0]?.parameters.max_total_results,
      maxResults: sent.tools[0]?.parameters.max_results,
    });
    expect(direct?.search.engine).toBe("exa");
  });

  it("hashes the exact prompt strings, and stores neither of them", async () => {
    answers = [answer({ searches: 3 }), answer({ searches: 4 })];

    await generateDebate({ article, journal });

    const [direct] = of("attempt-started");
    const user = directPrompt(meta, tree);
    expect(direct?.prompt.systemSha256).toBe(sha256Of(DIRECT_SYSTEM));
    expect(direct?.prompt.userSha256).toBe(sha256Of(user));
    expect(direct?.prompt.systemChars).toBe(DIRECT_SYSTEM.length);
    /* The article's own sentences are what a prompt is made of, and this file
       gets read by a report. Nothing but hashes and lengths. */
    const dump = JSON.stringify(of("attempt-started"));
    expect(dump).not.toContain("Rye flour ferments faster");
    expect(dump).not.toContain(DIRECT_SYSTEM.slice(0, 40));
  });

  it("carries the article's identity and production's own fingerprint", async () => {
    answers = [answer({ searches: 3 }), answer({ searches: 4 })];

    const run = await generateDebate({ article, journal });

    for (const start of of("attempt-started")) {
      expect(start.article).toEqual({
        slug: "starter-week-3",
        url: meta.url,
        title: meta.title,
        byline: meta.byline,
        /* **The same value the artefact is stamped with** — F41. A journal
           pinned on anything else could go stale against the run it describes. */
        inputFingerprint: run.debate.sourceHash,
      });
    }
  });

  it("keeps the raw annotations, which is the whole point of capturing at all", async () => {
    answers = [answer({ searches: 3 }), answer({ searches: 4, annotations: [BLOG] })];

    await generateDebate({ article, journal });

    const [, claims] = of("provider-response");
    expect(claims?.response.kind).toBe("body");
    const body = claims?.response as { json: unknown };
    /* The extract survives verbatim. Only *kept* rows reach `debate.json`, so
       without this a refused row is unreplayable and the run bought nothing. */
    expect(JSON.stringify(body.json)).toContain(BLOG.content);
    expect(JSON.stringify(body.json)).toContain("web_search_requests");
  });

  it("finishes both attempts ok, with no failure class", async () => {
    answers = [answer({ searches: 3 }), answer({ searches: 4 })];

    await generateDebate({ article, journal });

    expect(of("attempt-finished").map((e) => [e.outcome, e.failure])).toEqual([
      ["ok", null],
      ["ok", null],
    ]);
    expect(reconcile(written).complete).toBe(true);
    expect(reconcile(written).captured).toBe(2);
  });

  it("writes nothing at all when no journal is passed — which is production", async () => {
    answers = [answer({ searches: 3 }), answer({ searches: 4 })];

    await generateDebate({ article });

    expect(written).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ the abort -- */

describe("an abort", () => {
  it("gets metadata and an abort outcome, and invents no response fields", async () => {
    const controller = new AbortController();
    answers = [
      () => {
        controller.abort();
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
      },
    ];

    await expect(
      generateDebate({ article, journal, signal: controller.signal }),
    ).rejects.toThrow();

    /* **Two lines, not three.** There is no "the response was empty" arm to
       fill in, because an attempt that never heard back writes no
       `provider-response` line at all. */
    expect(written.map((e) => e.event)).toEqual(["attempt-started", "attempt-finished"]);
    expect(of("provider-response")).toHaveLength(0);
    const [finished] = of("attempt-finished");
    expect(finished?.outcome).toBe("aborted");
    /* An abort is the caller's decision and not a failure class: filing it in
       the same column as a provider that broke would make a cancelled run look
       like a broken one for ever. */
    expect(finished?.failure).toBeNull();
  });

  it("is still a complete record — the attempt has an outcome", async () => {
    const controller = new AbortController();
    answers = [
      () => {
        controller.abort();
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
      },
    ];

    await expect(
      generateDebate({ article, journal, signal: controller.signal }),
    ).rejects.toThrow();

    const r = reconcile(written);
    expect(r.attempts[0]?.status).toBe("captured");
    expect(r.attempts[0]?.response).toBeNull();
    expect(r.unmatchedStarts).toBe(0);
  });
});

/* -------------------------------------------------------------- a refused call -- */

describe("a non-2xx", () => {
  it("is captured, with its status, before anything here judges it", async () => {
    answers = [
      () => {
        throw new ProviderRefused(
          429,
          "rate limited: too many requests from this key",
          new Headers({ "retry-after": "12" }),
        );
      },
    ];

    await expect(generateDebate({ article, journal })).rejects.toThrow();

    const [response] = of("provider-response");
    expect(response?.response).toEqual({
      kind: "refused",
      status: 429,
      refusalKind: null,
      retryAfterMs: 12_000,
      bodyUnavailable: expect.stringContaining("ProviderRefused"),
    });
    const [finished] = of("attempt-finished");
    expect(finished?.outcome).toBe("error");
    expect(finished?.failure).toBe("provider-refused");
  });

  it("does not smuggle the provider's words into the journal", async () => {
    answers = [
      () => {
        throw new ProviderRefused(
          404,
          "No endpoints available matching your guardrail restrictions",
          new Headers(),
        );
      },
    ];

    await expect(generateDebate({ article, journal })).rejects.toThrow();

    /* `ProviderRefused` keeps the status, a recognised `kind` and a parsed
       `Retry-After`, and never the body — src/ai-call.ts. The classification
       still arrives, which is the part a report needs. */
    const [response] = of("provider-response");
    expect(response?.response).toMatchObject({ refusalKind: "no-endpoints", status: 404 });
    expect(JSON.stringify(written)).not.toContain("guardrail");
  });
});

/* ----------------------------------------------------- the classified failures -- */

describe("every way a pass can fail names itself", () => {
  const cases: [string, unknown | (() => never), string][] = [
    ["a 2xx body that would not parse", null, "body-not-json"],
    ["no choices", { choices: [] }, "no-choices"],
    ["the answer was cut off", answer({ finish: "length" }), "answer-overflowed"],
    ["the provider filtered itself", answer({ finish: "content_filter" }), "content-filtered"],
    ["the finish reason is not stop", answer({ finish: "error" }), "unclean-finish"],
    ["zero searches", answer({ searches: 0 }), "search-did-not-run"],
    /* **The parse is inside the attempt.** It used to run in `generateDebate`
       after `runPass` returned, which would have journalled this attempt `ok`
       and then failed the step — a record saying the opposite of what happened. */
    ["no closed fence", answer({ content: "I could not find anything." }), "answer-not-parseable"],
    ["the fenced text is not JSON", answer({ fenced: "not json" }), "answer-not-parseable"],
    ["the fenced JSON is not a list", answer({ fenced: '{"rows": []}' }), "answer-not-parseable"],
  ];

  for (const [name, bad, expected] of cases) {
    it(`records ${name} as ${expected}`, async () => {
      answers = [bad];

      await expect(generateDebate({ article, journal })).rejects.toThrow();

      const [finished] = of("attempt-finished");
      expect(finished?.outcome).toBe("error");
      expect(finished?.failure).toBe(expected);
      /* Every one of these arrived *after* bytes did, so the response line is
         down whatever the verdict was. */
      expect(of("provider-response")).toHaveLength(1);
    });
  }

  it("records a 2xx that would not parse as a null body, and says so", async () => {
    answers = [null];

    await expect(generateDebate({ article, journal })).rejects.toThrow();

    const [response] = of("provider-response");
    expect(response?.response).toEqual({
      kind: "body",
      json: null,
      answeredBy: "anthropic/stub",
      generationId: "gen-1",
    });
  });
});

/* ----------------------------------------------------------- reconciliation -- */

describe("reconciling a journal against itself", () => {
  const started = (attemptId: string): DebateJournalEvent => ({
    event: "attempt-started",
    attemptId,
    at: "2026-09-06T00:00:00.000Z",
    pass: "direct",
    model: "stub",
    search: { engine: "exa", maxTotalResults: 12, maxResults: 5 },
    prompt: { systemSha256: "a", systemChars: 1, userSha256: "b", userChars: 1 },
    article: {
      slug: "s",
      url: null,
      title: null,
      byline: null,
      inputFingerprint: "f",
    },
  });
  const finished = (attemptId: string): DebateJournalEvent => ({
    event: "attempt-finished",
    attemptId,
    at: "2026-09-06T00:00:01.000Z",
    elapsedMs: 1000,
    outcome: "ok",
    failure: null,
  });

  it("refuses to call an unmatched start captured", () => {
    /* **The 2026-09-05 case.** An OOM kill between the two passes billed pass A
       and wrote nothing. A report that counted starts would have called this a
       clean two-attempt run. */
    const r = reconcile([started("a"), finished("a"), started("b")]);

    expect(r.captured).toBe(1);
    expect(r.unmatchedStarts).toBe(1);
    expect(r.complete).toBe(false);
    expect(r.attempts.map((a) => a.status)).toEqual(["captured", "unmatched-start"]);
  });

  it("says so in words a reader cannot mistake for a recorded failure", () => {
    const lines = reconciliationLines(reconcile([started("b")]));

    expect(lines.join("\n")).toContain("the process died or the outcome is unknown");
    expect(lines.join("\n")).toContain("NOT a complete record");
  });

  it("names an event whose start is missing as an orphan", () => {
    const r = reconcile([finished("ghost")]);

    expect(r.orphanEvents).toBe(1);
    expect(r.captured).toBe(0);
    expect(r.complete).toBe(false);
  });

  it("cannot be talked into promoting an unmatched start by concatenation", () => {
    /* Two runs' files appended: the same attempt id starts twice and finishes
       once. The first start is the one that owns the money, so folding the
       second must not turn "no outcome" into an outcome for the first. */
    const r = reconcile([started("a"), started("a"), finished("a")]);

    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]?.status).toBe("captured");
    expect(r.captured).toBe(1);
  });

  it("calls an empty journal incomplete rather than clean", () => {
    expect(reconcile([]).complete).toBe(false);
  });
});
