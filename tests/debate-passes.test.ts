/**
 * **The two passes, and the fact that they are one step.** The model is stubbed;
 * nothing here spends.
 *
 * `tests/debate.test.ts` is the pure half — the refusals and the counts. This
 * file is about the half those cannot see: what goes out on the wire, and what
 * happens when a pass comes back wrong.
 *
 * ## Why atomicity is a test rather than a comment
 *
 * The plan's first draft said a failed pass A "writes no conclusion" and stopped
 * there, which left three bad options for whoever built it: show the empty
 * sentence over a failure, throw pass B away silently, or invent a half-artefact
 * nobody designed. Sol's F16. So a failure of **either** pass fails the whole
 * step and writes nothing, and the panel gets the ordinary job-failure state.
 *
 * Every one of those failures is invisible from the outside, because the honest
 * output of this mode is usually an empty list. *"The search found nothing"* and
 * *"the search never ran"* and *"the answer was cut off mid-row"* look identical
 * on screen unless the step refuses — which is what these cases assert.
 *
 * ## And why pass A failing must cost one call rather than two
 *
 * Up to $0.135 a pass (Stage 0b). The sequencing is the mitigation, and a
 * sequencing that quietly became concurrent would still pass every assertion
 * about the artefact.
 *
 * docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md § 2
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { job: string; body: Record<string, unknown> }[] = [];
/** What the stub answers next, one entry per call, oldest first. */
let answers: unknown[] = [];

vi.mock("../src/ai-call.js", () => ({
  openRouterJson: (job: string, body: Record<string, unknown>) => {
    calls.push({ job, body });
    const next = answers.shift();
    if (next === undefined) throw new Error("the stub was asked for more answers than it has");
    return Promise.resolve({ json: next, answeredBy: null, generationId: null });
  },
}));

const { generateDebate, MAX_CLAIM_SEARCH_RESULTS, MAX_DIRECT_SEARCH_RESULTS, PROMPT_VERSION } =
  await import("../src/debate.js");
const { readerFailureOf } = await import("../src/job-failure.js");
const { worthRetrying } = await import("../src/messages.js");
import type { Article } from "../src/article-input.js";
import type { Block, Meta, Tree } from "../src/types.js";

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
  /** `null` sends **no** `finish_reason` at all, which is a real wire state. */
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

const REVIEW = {
  url: "https://bakingreview.example/on-gregs-notes",
  title: "On Greg's starter notes",
  content:
    "Greg's Notes on my sourdough starter, week 3 argues for twice-daily feeding, which is " +
    "true in a cool kitchen and wrong in a warm one.",
};

const BLOG = {
  url: "https://myeclecticbites.com/sourdough-starter-notes",
  title: "Sourdough starter notes",
  content: "A starter kept on the counter will collapse in about a week if you feed it once a day.",
};

const DIRECT_ROW = JSON.stringify([
  {
    url: REVIEW.url,
    sourceQuote: "true in a cool kitchen and wrong in a warm one",
    articleReferenceQuote: "Notes on my sourdough starter, week 3",
    relation: "qualifies",
    valence: "negative",
    applies: "It accepts the schedule only for cool kitchens.",
  },
]);

const CLAIM_ROW = JSON.stringify([
  {
    url: BLOG.url,
    blockId: "spya-aaaaaa",
    claimQuote: "fall apart within a week",
    sourceQuote: "collapse in about a week",
    relation: "corroborates",
    valence: "positive",
    applies: "It reports the same collapse.",
  },
]);

beforeEach(() => {
  calls.length = 0;
  answers = [];
});

/* ------------------------------------------------------------ the happy path -- */

describe("two passes, one artefact", () => {
  it("writes both groups, stamped and dated", async () => {
    answers = [
      answer({ fenced: DIRECT_ROW, searches: 3, annotations: [REVIEW] }),
      answer({ fenced: CLAIM_ROW, searches: 5, annotations: [BLOG] }),
    ];

    const run = await generateDebate({ article });

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.job === "debate")).toBe(true);
    expect(run.debate.version).toBe(PROMPT_VERSION);
    expect(run.debate.slug).toBe("starter-week-3");
    expect(run.debate.sourceHash).toMatch(/\w/);
    /* An ISO instant, and the only clock on this artefact — its neighbours carry
       a `generatedAt` as well, which here would be a second copy of one fact. */
    expect(Date.parse(run.debate.searchedAt)).not.toBeNaN();
    expect(run.debate.direct.counts.keptRows).toBe(1);
    expect(run.debate.claims.counts.keptRows).toBe(1);
    /* **Per group, never only summed** — a foot line cannot otherwise say which
       of the two searches lost rows. */
    expect(run.debate.direct.counts.webSearches).toBe(3);
    expect(run.debate.claims.counts.webSearches).toBe(5);
    /* The total is the alarm the log line carries. */
    expect(run.webSearches).toBe(8);
  });

  /**
   * **The two passes are asked different questions, and only one of them sees
   * the article.**
   *
   * Pass A is the article's identity and nothing else to search for; pass B
   * carries the paragraphs with their ids on, because a `claimQuote` has to be
   * locatable in a block the model was actually shown.
   */
  it("sends the identity to pass A and the article to pass B", async () => {
    answers = [answer({ searches: 2 }), answer({ searches: 2 })];
    await generateDebate({ article });

    const [passA, passB] = calls.map((c) => JSON.stringify(c.body));
    expect(passA).toContain("gregs-private-baking-notes.example");
    expect(passA).not.toContain("spya-aaaaaa");
    expect(passB).toContain("spya-aaaaaa");
    expect(passB).toContain("Rye flour ferments faster");
  });

  /**
   * The search tool, and the two caps whose scope the plan states because it is
   * otherwise ambiguous: one number read as covering both passes permits twice
   * what it says.
   */
  it("asks for the web search on both passes, each with its own result cap", async () => {
    answers = [answer({ searches: 2 }), answer({ searches: 2 })];
    await generateDebate({ article });

    const tools = calls.map(
      (c) => (c.body.tools as { type: string; parameters: Record<string, number | string> }[])[0]!,
    );
    for (const tool of tools) {
      expect(tool.type).toBe("openrouter:web_search");
      /* Exa on **cost** — $0.066 against $0.115 in one matched comparison — and
         provisional. Not because the default engine returns no annotations,
         which was a streaming measurement and is not what happens here. */
      expect(tool.parameters.engine).toBe("exa");
    }
    expect(tools[0]!.parameters.max_total_results).toBe(MAX_DIRECT_SEARCH_RESULTS);
    expect(tools[1]!.parameters.max_total_results).toBe(MAX_CLAIM_SEARCH_RESULTS);
  });

  /**
   * `returnedSources` counts what the **search** returned, not what the model
   * said — and the article's own page is refused before it is counted, so the
   * sentence *"the search returned evidence from N pages"* never counts the
   * piece the reader is already holding.
   */
  it("counts the pages the search returned, minus the article itself", async () => {
    const itself = { url: meta.url!, title: meta.title!, content: "A starter left at room" };
    answers = [
      answer({ fenced: DIRECT_ROW, searches: 3, annotations: [REVIEW, BLOG, itself] }),
      answer({ fenced: "[]", searches: 2, annotations: [BLOG] }),
    ];

    const run = await generateDebate({ article });

    expect(run.debate.direct.counts.returnedSources).toBe(2);
    expect(run.debate.direct.counts.reportedRows).toBe(1);
    expect(run.debate.claims.counts.returnedSources).toBe(1);
  });

  /**
   * The commonest correct outcome, and the reason the artefact is written at all
   * rather than refused: an empty group one on a successful pass is a *fact*,
   * and storing it is what stops the reader paying up to $0.27 for the same
   * honest answer on every open.
   */
  it("stores an artefact when a successful pass A kept nothing", async () => {
    answers = [
      answer({ fenced: "[]", searches: 4, annotations: [BLOG] }),
      answer({ fenced: CLAIM_ROW, searches: 4, annotations: [BLOG] }),
    ];

    const run = await generateDebate({ article });

    expect(run.debate.direct.rows).toEqual([]);
    expect(run.debate.direct.counts.reportedRows).toBe(0);
    /* A search DID run, which is what makes "this search did not find any
       responses" a sentence we are entitled to print. */
    expect(run.debate.direct.counts.webSearches).toBe(4);
  });
});

/* ------------------------------------------------------------- the fence -- */

/**
 * **The fence is line-delimited, and the comment that said otherwise was
 * simply untrue** (GPT Sol's F26).
 *
 * The old regex matched a ``` sequence *anywhere*, and its comment claimed a
 * stray one inside a JSON string "would be an escaped one". JSON does not
 * escape backticks and never has, so an answer whose prose quoted a fenced
 * block was cut mid-document and refused — and, worse in the other direction, a
 * closed `[]` followed by a truncated correction was read as a complete empty
 * answer. Both are in this file: the truncation cases are in the atomicity list
 * below, and the valid answer is here.
 */
describe("the fence the answer is read out of", () => {
  it("keeps a row whose prose contains a literal fence", async () => {
    const row = JSON.stringify([
      {
        url: BLOG.url,
        blockId: "spya-aaaaaa",
        claimQuote: "fall apart within a week",
        sourceQuote: "collapse in about a week",
        relation: "corroborates",
        valence: "positive",
        /* The characters the old parser cut the document at. */
        applies: "It sets the claim in a ``` block and reports the same collapse.",
      },
    ]);
    answers = [
      answer({ fenced: "[]", searches: 3, annotations: [BLOG] }),
      answer({ fenced: row, searches: 3, annotations: [BLOG] }),
    ];

    const run = await generateDebate({ article });

    expect(run.debate.claims.counts.keptRows).toBe(1);
    expect(run.debate.claims.rows[0]?.applies).toContain("```");
  });

  /** The last closed fence still wins, which is what lets a model correct itself. */
  it("reads the last closed fence, not the first", async () => {
    answers = [
      answer({
        searches: 3,
        annotations: [REVIEW],
        content: "```debate\n[]\n```\n\nOn reflection:\n\n```debate\n" + DIRECT_ROW + "\n```",
      }),
      answer({ fenced: "[]", searches: 3, annotations: [BLOG] }),
    ];

    const run = await generateDebate({ article });

    expect(run.debate.direct.counts.keptRows).toBe(1);
  });
});

/* --------------------------------------------------------------- atomicity -- */

describe("either pass failing fails the whole step", () => {
  /** Every one of these is a way the panel would otherwise print a false sentence. */
  const passAFailures: [string, unknown][] = [
    ["the search reported zero searches", answer({ searches: 0 })],
    /* **F27, and the shape of the bug matters more than the case.** `runPass`
       refused `length` and `content_filter` by name and let everything else
       through, so a terminal provider failure arrived with a positive search
       count and a closed `[]` and was stored as a successful empty artefact —
       which is this mode's commonest *honest* answer, so nothing looked wrong.
       A blocklist is the wrong shape for a field whose values the provider
       chooses; only `stop` is a clean finish. */
    ["the provider ended in an error", answer({ fenced: "[]", searches: 4, finish: "error" })],
    ["the answer carries no finish reason", answer({ searches: 4, finish: null })],
    ["the provider stopped to call a tool", answer({ searches: 4, finish: "tool_calls" })],
    ["the finish reason is a word we have never seen", answer({ searches: 4, finish: "banana" })],
    ["the search count is not in the response at all", answer({ searches: null })],
    ["the answer was cut off", answer({ fenced: DIRECT_ROW, finish: "length" })],
    ["the provider filtered its own answer", answer({ finish: "content_filter" })],
    ["there is no fence", answer({ content: "I could not find anything." })],
    ["the fence is not closed", answer({ content: "```debate\n[{" })],
    /* **F26 — truncation dressed as a result.** A closed `[]`, then a second
       fence the answer was cut off inside. The old parser took the last
       *closed* fence and reported "nothing found" over an answer that was
       still being written. A later unmatched opener now fails the pass. */
    [
      "a closed empty list is followed by a correction that was cut off",
      answer({
        searches: 4,
        content: "```debate\n[]\n```\n\nActually, one more:\n\n```debate\n[{\"url\": \"https",
      }),
    ],
    /* A closing delimiter has to have its own line, so a ``` that is only part
       of a line does not end anything. */
    [
      "the fence is closed by something that is not a fence line",
      answer({ searches: 4, content: "```debate\n[]\n``` and that is all" }),
    ],
    ["the fenced text is not JSON", answer({ fenced: "not json at all" })],
    ["the fenced JSON is not a list", answer({ fenced: '{"rows": []}' })],
    ["the body is not JSON", null],
    ["there are no choices", { choices: [] }],
  ];

  for (const [name, bad] of passAFailures) {
    it(`refuses when ${name}, without buying pass B`, async () => {
      answers = [bad, answer({ fenced: CLAIM_ROW, searches: 4, annotations: [BLOG] })];

      await expect(generateDebate({ article })).rejects.toThrow();
      /* **One call, not two.** The sequencing is the mitigation the plan claims
         for a failed pass A, and a sequencing that quietly became concurrent
         would still satisfy every assertion about the artefact. */
      expect(calls).toHaveLength(1);
    });
  }

  it("refuses when pass B fails, after pass A succeeded", async () => {
    answers = [
      answer({ fenced: DIRECT_ROW, searches: 3, annotations: [REVIEW] }),
      answer({ searches: 0 }),
    ];

    await expect(generateDebate({ article })).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });

  /**
   * **The reader gets a sentence, and it is not the empty-result one.**
   *
   * `readerFailureOf` is the seam every step's failure reaches the panel
   * through, and the thing that must not happen is a reader being told the
   * search found nothing over a search that never ran.
   */
  it("gives the reader a retryable sentence about the search, not an empty result", async () => {
    answers = [answer({ searches: 0 })];

    const err = await generateDebate({ article }).catch((e: unknown) => e);
    const { message } = readerFailureOf(err, "debate");

    expect(message).toMatch(/did not run/i);
    expect(message).not.toMatch(/found nothing/i);
    expect(worthRetrying(message)).toBe(true);
  });

  /**
   * A diagnostic never carries the provider's words or the article's. The
   * failures above are thrown with authored strings; this asserts the one that
   * would most obviously be tempted to quote something.
   */
  it("says nothing about what the provider actually sent", async () => {
    answers = [answer({ fenced: "not json at all" })];

    const err = (await generateDebate({ article }).catch((e: unknown) => e)) as Error;

    expect(err.message).not.toContain("not json at all");
    expect(err.message).toMatch(/was not JSON/);
  });
});
