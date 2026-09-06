/**
 * **A journal and a small web, built by hand, so `verify-fallback.ts` can be
 * proved before it is pointed at anything real.**
 *
 * There is no paid journal yet. Every seam of the verification tool —
 * `fetchDocument` through its own guards, the type sniff, JSDOM, Readability,
 * `findQuote`, the budget, every named outcome — therefore has to be exercised
 * against something local, and this is that something.
 *
 * **The whole file is offline by construction.** `fixtureFetch()` returns a
 * `FetchLike` that answers from the map below and nothing else; an unexpected
 * URL is a thrown error rather than a request. It is handed to `fetchDocument`
 * as `fetchImpl`, which is one of that function's own test seams — so the real
 * fetch path runs, with every private-address check, redirect rule, byte cap and
 * type sniff in place, and no socket is opened. `resolve` is injected for the
 * same reason: a DNS lookup for `slowrise.example` would be a network call.
 *
 * ## The cases, and which one each page is for
 *
 * | page | the case |
 * |---|---|
 * | `bakingreview.example` | the quotation **is** in the extract — production keeps it today |
 * | `slowrise.example` | absent from the extract, present in the article body — **the recovery case** |
 * | `kitchennotes.example` | absent from the extract, present only in a comment thread Readability discards — **whole-body text recovers it, Readability does not** |
 * | `paraphrase.example` | absent from both — the paraphrase reading, and the one that would defer Stage F |
 * | `blockjoin.example` | absent from both, but only because `textContent` welds two paragraphs together — the **diagnostic** case, which must not be reported as a paraphrase |
 * | `archive.example` | a PDF — `unsupported`, and never an empty page |
 * | `gone.example` | a 404 — `not-found`, and never "not recovered" |
 *
 * Two rows need no page at all: one cites a URL the search never returned
 * (`noExtract`), and one quotes two words (`belowFloor`).
 *
 * Nothing here is committed as a fixture of production behaviour — it is a rig
 * for a tool, and the strings in it are invented.
 */
import type { FetchLike, FetchOptions } from "../../src/fetch.js";
import type { DebateJournalEvent } from "../../src/debate-journal.js";

/* ------------------------------------------------------------------ *
 * Who the article is
 * ------------------------------------------------------------------ */

export const FIXTURE_ARTICLE = {
  slug: "starter-week-3",
  url: "https://example.invalid/starter-week-3",
  title: "Notes on my sourdough starter, week 3",
  byline: "Greg Detre",
  inputFingerprint: "fixture-fingerprint",
};

/* ------------------------------------------------------------------ *
 * The quotations, named so a test can say which case it means
 * ------------------------------------------------------------------ */

export const QUOTES = {
  /** In `bakingreview.example`'s extract. */
  inExtract: "true in a cool kitchen and wrong in a warm one",
  /** Absent from `slowrise.example`'s extract; in its article body. */
  recoverable: "the schedule collapses the moment the kitchen goes above twenty-two degrees",
  /** Absent from `kitchennotes.example`'s extract; only in its comment thread. */
  inCommentsOnly: "I ran his schedule for a fortnight and the jar never doubled once",
  /** On `paraphrase.example`, and nowhere on it. */
  paraphrase: "he concedes that the whole method is guesswork dressed as measurement",
  /** Straddles two paragraphs on `blockjoin.example`. */
  acrossBlocks: "feed it twice a day. Never once, and never three times",
  /** Two words: under `MIN_QUOTE_WORDS`/`MIN_QUOTE_CHARS`, so production drops it regardless. */
  belowFloor: "fed twice",
  /** The article's own title, which is what an `articleReferenceQuote` usually is. */
  namesArticle: FIXTURE_ARTICLE.title,
} as const;

/* ------------------------------------------------------------------ *
 * The small web
 * ------------------------------------------------------------------ */

export const URLS = {
  inExtract: "https://bakingreview.example/on-gregs-notes",
  recoverable: "https://slowrise.example/against-the-schedule",
  comments: "https://kitchennotes.example/a-fortnight-of-it",
  paraphrase: "https://paraphrase.example/loose-summary",
  blockJoin: "https://blockjoin.example/the-rhythm",
  pdf: "https://archive.example/paper.pdf",
  gone: "https://gone.example/missing",
  /** Never returned by the search, so there is no extract to check against. */
  uncited: "https://uncited.example/nowhere",
} as const;

/** Enough surrounding prose that Readability treats a `<div>` as the article. */
function padding(subject: string): string {
  return [
    `<p>${subject} is one of those subjects where everybody has a rule and nobody has a reason, and the rules contradict each other in ways that are easy to miss until you write them down side by side.</p>`,
    `<p>What follows is an attempt to write them down side by side, with the arguments for each set out at enough length that a reader can disagree with a specific sentence rather than with a general impression.</p>`,
    `<p>None of it is measurement. It is a fortnight of notes and a kitchen thermometer, which is a good deal more than most of what gets published about ${subject.toLowerCase()} and a good deal less than an experiment.</p>`,
  ].join("\n");
}

const PAGE_IN_EXTRACT = `<!doctype html><html><head><title>On Greg's starter notes</title></head><body>
<article>
${padding("Feeding schedules")}
<p>Greg's ${FIXTURE_ARTICLE.title} argues for twice-daily feeding, which is ${QUOTES.inExtract}.</p>
${padding("Room temperature")}
</article>
</body></html>`;

const PAGE_RECOVERABLE = `<!doctype html><html><head><title>Against the schedule</title></head><body>
<nav><a href="/">Home</a> <a href="/archive">Archive</a></nav>
<article>
<h1>Against the schedule</h1>
${padding("Twice-daily feeding")}
<p>Greg Detre's ${FIXTURE_ARTICLE.title} sets out a rule that works in his kitchen and, I think, only in his kitchen.</p>
<p>My objection is narrow and I will state it once: ${QUOTES.recoverable}, and the piece never says what to do then.</p>
${padding("Warm kitchens")}
</article>
<footer><p>Written in a cold flat.</p></footer>
</body></html>`;

const PAGE_COMMENTS = `<!doctype html><html><head><title>A fortnight of it</title></head><body>
<article>
<h1>A fortnight of it</h1>
${padding("Sourdough")}
<p>I have been keeping notes, and they mostly agree with the received wisdom, which is a dull result to report.</p>
${padding("Hydration")}
</article>
<div id="comments" class="comments discussion">
<h2>Comments</h2>
<p>Reply from a reader: ${QUOTES.inCommentsOnly}. So much for ${FIXTURE_ARTICLE.title}.</p>
</div>
</body></html>`;

const PAGE_PARAPHRASE = `<!doctype html><html><head><title>Loose summary</title></head><body>
<article>
<h1>Loose summary</h1>
${padding("Starters")}
<p>The piece is honest about how little of this is measured, and I take that as the main thing worth saying about it.</p>
${padding("Method")}
</article>
</body></html>`;

const PAGE_BLOCK_JOIN = `<!doctype html><html><head><title>The rhythm</title></head><body>
<article>
<h1>The rhythm</h1>
${padding("Rhythm")}
<p>The instruction, stated plainly, is this: feed it twice a day.</p><p>Never once, and never three times, whatever the weather is doing outside.</p>
${padding("Weather")}
</article>
</body></html>`;

/** The bytes of something that is a PDF and is not a web page. */
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");

/* ------------------------------------------------------------------ *
 * Serving it
 * ------------------------------------------------------------------ */

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * The little web above, as a `FetchLike`.
 *
 * **An address that is not in the map throws** rather than 404-ing, because a
 * silent 404 for a URL the tool was not supposed to ask for would look exactly
 * like a page that is genuinely gone. `asked` records what was requested so a
 * test can assert the budget stopped a fetch, or that a URL was fetched once
 * rather than once per row.
 */
export function fixtureFetch(): { impl: FetchLike; asked: string[] } {
  const asked: string[] = [];
  const impl: FetchLike = async (url) => {
    asked.push(url);
    switch (url) {
      case URLS.inExtract:
        return htmlResponse(PAGE_IN_EXTRACT);
      case URLS.recoverable:
        return htmlResponse(PAGE_RECOVERABLE);
      case URLS.comments:
        return htmlResponse(PAGE_COMMENTS);
      case URLS.paraphrase:
        return htmlResponse(PAGE_PARAPHRASE);
      case URLS.blockJoin:
        return htmlResponse(PAGE_BLOCK_JOIN);
      case URLS.pdf:
        return new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf" } });
      case URLS.gone:
        return new Response("no such page", { status: 404, headers: { "content-type": "text/html" } });
      default:
        throw new Error(`the fixture web has no ${url} — nothing should have asked for it`);
    }
  };
  return { impl, asked };
}

/**
 * `FetchOptions` that keep `fetchDocument` on the real path and off the network.
 *
 * A public-looking address from the injected resolver, so the private-address
 * guard runs and passes on its merits rather than being skipped.
 */
export function fixtureFetchOptions(impl: FetchLike): FetchOptions {
  return {
    fetchImpl: impl,
    resolve: async () => ["93.184.216.34"],
    sleep: async () => {},
    attempts: 1,
  };
}

/* ------------------------------------------------------------------ *
 * The journal
 * ------------------------------------------------------------------ */

interface FixtureRow {
  url: string;
  sourceQuote: string;
  articleReferenceQuote?: string;
  relation?: string;
  valence?: string;
  applies?: string;
}

/** A whole chat completion, in the shape a journal holds one. */
function answer(rows: FixtureRow[], annotations: { url: string; title: string; content: string }[]): unknown {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: `Here is what the search returned.\n\n\`\`\`debate\n${JSON.stringify(rows)}\n\`\`\``,
          annotations: annotations.map((a) => ({ type: "url_citation", url_citation: a })),
        },
      },
    ],
    usage: { server_tool_use: { web_search_requests: 4 } },
  };
}

/**
 * The extracts, which are the point: each is a short slice of its page, and four
 * of the six deliberately stop short of the sentence the model quoted. That is
 * the shape the live run produced — a 236-character window over a 4,000-word
 * page — and it is what the whole question is about.
 */
const ANNOTATIONS = [
  {
    url: URLS.inExtract,
    title: "On Greg's starter notes",
    content: `Greg's ${FIXTURE_ARTICLE.title} argues for twice-daily feeding, which is ${QUOTES.inExtract}.`,
  },
  {
    url: URLS.recoverable,
    title: "Against the schedule",
    content: `Greg Detre's ${FIXTURE_ARTICLE.title} sets out a rule that works in his kitchen and, I think, only in his kitchen.`,
  },
  {
    url: URLS.comments,
    title: "A fortnight of it",
    content: `I have been keeping notes, and they mostly agree with the received wisdom, which is a dull result to report.`,
  },
  {
    url: URLS.paraphrase,
    title: "Loose summary",
    content: `The piece is honest about how little of this is measured, and I take that as the main thing worth saying about it.`,
  },
  {
    url: URLS.blockJoin,
    title: "The rhythm",
    content: `The instruction, stated plainly, is this: and never three times, whatever the weather is doing outside.`,
  },
  {
    url: URLS.pdf,
    title: "A fortnight of feeding (PDF)",
    content: "Abstract: we report on a fortnight of twice-daily feeding at three ambient temperatures.",
  },
  {
    url: URLS.gone,
    title: "Missing",
    content: "A page that used to answer this piece and no longer resolves.",
  },
];

/**
 * The synthetic journal: one direct pass carrying every case, and two attempts
 * that must contribute nothing.
 *
 * `claims-1` is a claims pass, which this tool does not read — group two is not
 * the question. `dead-1` is the OOM shape: a start and nothing after it. Both
 * must appear in the report as *not read*, with the reason in words, so the
 * denominator cannot be mistaken for the whole journal.
 */
export function fixtureJournal(): DebateJournalEvent[] {
  const at = "2026-09-06T12:00:00.000Z";
  const start = (attemptId: string, pass: "direct" | "claims"): DebateJournalEvent => ({
    event: "attempt-started",
    attemptId,
    at,
    pass,
    model: "(fixture — no model was called)",
    search: { engine: "exa", maxTotalResults: 12, maxResults: 5 },
    prompt: { systemSha256: "0".repeat(64), systemChars: 0, userSha256: "0".repeat(64), userChars: 0 },
    article: FIXTURE_ARTICLE,
  });

  const rows: FixtureRow[] = [
    /* 0 — both quotations are in the extract. Production keeps this row today. */
    {
      url: URLS.inExtract,
      sourceQuote: QUOTES.inExtract,
      articleReferenceQuote: QUOTES.namesArticle,
      relation: "qualifies",
      valence: "negative",
      applies: "It accepts the schedule only for cool kitchens.",
    },
    /* 1 — THE RECOVERY CASE. The extract stops before the objection; the page
       does not, and Readability keeps it. */
    {
      url: URLS.recoverable,
      sourceQuote: QUOTES.recoverable,
      articleReferenceQuote: QUOTES.namesArticle,
      relation: "disputes",
      valence: "negative",
      applies: "It says the rule fails above a temperature the piece never names.",
    },
    /* 2 — recovery, but only in whole-body text: the words are in a comment
       thread, which is exactly the section Readability throws away. */
    {
      url: URLS.comments,
      sourceQuote: QUOTES.inCommentsOnly,
      relation: "disputes",
      valence: "negative",
      applies: "A reader reports the schedule failing.",
    },
    /* 3 — the paraphrase case. Nothing on that page says this. */
    {
      url: URLS.paraphrase,
      sourceQuote: QUOTES.paraphrase,
      relation: "corroborates",
      valence: "neutral",
      applies: "It agrees the method is unmeasured.",
    },
    /* 4 — the diagnostic. The words are on the page, either side of a paragraph
       break, and `textContent` welds the two together. Not a paraphrase. */
    {
      url: URLS.blockJoin,
      sourceQuote: QUOTES.acrossBlocks,
      relation: "corroborates",
      valence: "positive",
      applies: "It restates the schedule.",
    },
    /* 5 — a PDF. `unsupported`, and never counted as a page that lacks the words. */
    {
      url: URLS.pdf,
      sourceQuote: "we report on a fortnight of twice-daily feeding at four ambient temperatures",
      relation: "extends",
      valence: "positive",
      applies: "It measures what the piece guesses at.",
    },
    /* 6 — a dead link. `not-found`, and it belongs in `not attempted`. */
    {
      url: URLS.gone,
      sourceQuote: "a page that used to answer this piece and has since been taken down entirely",
      relation: "disputes",
      valence: "negative",
      applies: "It answered the piece directly.",
    },
    /* 7 — a URL the search never returned: `uncited` in production, and here
       there is no extract to check against at all. Nothing may be fetched. */
    {
      url: URLS.uncited,
      sourceQuote: "a quotation attached to an address this run's search never returned at all",
      relation: "disputes",
      valence: "negative",
      applies: "It is a real-looking address the model supplied itself.",
    },
    /* 8 — two words. Under the floor, so production drops it whatever any page
       says, and no fallback could rescue it. */
    {
      url: URLS.inExtract,
      sourceQuote: QUOTES.belowFloor,
      relation: "corroborates",
      valence: "positive",
      applies: "It mentions the schedule.",
    },
  ];

  return [
    start("direct-1", "direct"),
    {
      event: "provider-response",
      attemptId: "direct-1",
      at,
      response: { kind: "body", json: answer(rows, ANNOTATIONS), answeredBy: "(fixture)", generationId: "gen-direct-1" },
    },
    { event: "attempt-finished", attemptId: "direct-1", at, elapsedMs: 1, outcome: "ok", failure: null },
    start("claims-1", "claims"),
    {
      event: "provider-response",
      attemptId: "claims-1",
      at,
      response: { kind: "body", json: answer([], []), answeredBy: "(fixture)", generationId: "gen-claims-1" },
    },
    { event: "attempt-finished", attemptId: "claims-1", at, elapsedMs: 1, outcome: "ok", failure: null },
    start("dead-1", "direct"),
  ];
}
