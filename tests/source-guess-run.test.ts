/**
 * **Looking for an uploaded paper on the web, once** — the orchestration in
 * src/source-guess-run.ts, with the search, the page read and the store
 * injected. docs/plans/260929g-canonical-link-for-an-uploaded-paper.md § Stages 2.
 *
 * The judge's own truth table is tests/source-guess.test.ts; this file is about
 * what gets *spent* and *stored* around it: nothing is searched for a slug the
 * caller does not own, an article that was not uploaded, an upload already
 * answered, or a title that cannot be matched; a refused allowance spends
 * nothing and gives its attempt back; a provider failure on the first attempt
 * is handed back for the next open, and on the last one settles.
 *
 * The Postgres half — the claim race, the fence, the cap, the payload and the
 * public projection — is tests/source-guess-pg.test.ts.
 */
import { describe, expect, it } from "vitest";

import type { FoundWorkPage, WorkToFind } from "../src/citation-find.js";
import type { PaperText } from "../src/paper-text.js";
import {
  defaultFirstPages,
  GUESS_RATE_POLICY,
  isAnUpload,
  makeGuessSource,
  openingProse,
} from "../src/source-guess-run.js";
import type {
  AllowanceTaken,
  RatePolicy,
  RawSource,
  SourceGuessOutcome,
  SourceGuessStore,
} from "../src/store/contracts.js";
import type { Article, Block, BlockId, Meta, SourceGuess, Tree } from "../src/types.js";

const TITLE = "Oscillatory Coupling Between Hippocampus and Prefrontal Cortex During Memory Consolidation";
const DOI = "10.1234/hpc.2024.5678";
const PAGE = "https://www.example-journal.org/articles/hpc-coupling";

/** Ordinary sentences, well past the thirty-word bar, mostly lower case. */
const ABSTRACT =
  "Abstract: memory consolidation is thought to depend on coordinated activity between the " +
  "hippocampus and the prefrontal cortex during sleep. we recorded local field potentials in both " +
  "regions while rats slept after learning a spatial task, and found that theta and gamma " +
  "oscillations became more tightly coupled across regions in the hour after training. the strength " +
  "of this coupling predicted how well each animal remembered the task the following day, and " +
  "disrupting it with brief stimulation impaired later recall without changing sleep architecture. " +
  "these results suggest that cross regional oscillatory coupling is a mechanism through which " +
  "recent experience is transferred into durable cortical memory traces.";

let ids = 0;
function block(kind: Block["kind"], text: string): Block {
  ids += 1;
  return {
    id: `spya-t${String(ids).padStart(5, "a").replace(/[01ilo]/g, "a")}` as BlockId,
    tag: kind === "heading" ? "h1" : "p",
    kind,
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

const BLOCKS: Block[] = [
  block("heading", TITLE),
  block("text", "Ana Müller, Jonas Berg and Priya Raman"),
  block("text", "Department of Neuroscience, University of Somewhere, Somewhere Street, Big City, Country"),
  block("text", ABSTRACT),
  block("text", "Keywords: hippocampus; prefrontal cortex; sleep; oscillations"),
];

function article(meta: Partial<Meta> = {}, sourceGuess?: SourceGuess): Article {
  return {
    meta: {
      slug: "an-upload",
      title: TITLE,
      filename: "hpc-coupling-final.pdf",
      source: "pdf",
      authors: [{ name: "Ana Müller", affiliations: [] }],
      ...meta,
    } as Meta,
    blocks: BLOCKS,
    tree: {} as Tree,
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess,
  };
}

/** The candidate page, read: the same paper unless a test says otherwise. */
function readPage(over: Partial<Extract<PaperText, { kind: "read" }>> = {}): PaperText {
  return {
    kind: "read",
    url: PAGE,
    host: "example-journal.org",
    format: "html",
    text: `${TITLE}\nAna Müller, Jonas Berg, Priya Raman\n${ABSTRACT}\nIntroduction ...`,
    words: 200,
    title: TITLE,
    meta: { title: TITLE, authors: ["Müller, Ana", "Berg, Jonas"] },
    ...over,
  };
}

function kept(url = PAGE, title = TITLE): FoundWorkPage {
  return {
    reading: { verdict: { kind: "kept", page: { url, title } }, searches: 1, searchesFrom: "server_tool_use", results: 3 },
    model: "test/model",
  };
}

/** An in-memory store with the Postgres store's semantics, recording every call. */
function memoryStore(initial?: { settled: Extract<SourceGuess, { status: "found" | "none" }> } | { busy: true; attempts?: number }) {
  type Row =
    | { status: "searching"; token: string; attempts: number; stale: boolean }
    | { status: "found" | "none"; attempts: number; outcome?: SourceGuessOutcome; guess: Extract<SourceGuess, { status: "found" | "none" }> };
  let row: Row | undefined =
    initial && "settled" in initial
      ? { status: initial.settled.status, attempts: 1, guess: initial.settled }
      : initial && "busy" in initial
        ? { status: "searching", token: "theirs", attempts: initial.attempts ?? 1, stale: false }
        : undefined;
  let minted = 0;
  const log: string[] = [];
  const store: SourceGuessStore = {
    async read() {
      if (!row) return undefined;
      return row.status === "searching" ? { status: "searching" } : row.guess;
    },
    async claim() {
      log.push("claim");
      if (!row || (row.status === "searching" && row.stale)) {
        const attempts = (row?.attempts ?? 0) + 1;
        if (attempts > 2) {
          row = { status: "none", attempts: 2, guess: { status: "none" } };
          return { kind: "settled", guess: { status: "none" } };
        }
        minted += 1;
        row = { status: "searching", token: `tok-${minted}`, attempts, stale: false };
        return { kind: "claimed", token: row.token, attempt: attempts };
      }
      if (row.status === "searching") return { kind: "busy" };
      return { kind: "settled", guess: row.guess };
    },
    async finish(_slug, token, outcome) {
      log.push(`finish:${outcome.status}`);
      if (row?.status !== "searching" || row.token !== token) return false;
      const guess: Extract<SourceGuess, { status: "found" | "none" }> =
        outcome.status === "found"
          ? { status: "found", url: outcome.url, host: outcome.host, kind: outcome.kind, matchedBy: outcome.matchedBy }
          : { status: "none" };
      row = { status: outcome.status, attempts: row.attempts, outcome, guess };
      return true;
    },
    async release(_slug, token, { refund }) {
      log.push(`release:${refund ? "refund" : "keep"}`);
      if (row?.status !== "searching" || row.token !== token) return false;
      row = { ...row, stale: true, attempts: refund ? row.attempts - 1 : row.attempts };
      return true;
    },
  };
  return {
    store,
    log,
    row: () => row,
    /** A later claim takes over while ours is still running. */
    steal() {
      if (row?.status === "searching") row = { ...row, token: "stolen" };
    },
  };
}

interface HarnessOptions {
  article?: Article;
  source?: RawSource | null;
  firstPages?: string;
  find?: FoundWorkPage | Error;
  read?: PaperText;
  allowance?: AllowanceTaken;
  store?: ReturnType<typeof memoryStore>;
  onFind?: () => void;
  delay?: "identity" | "allowance" | "search" | "read";
  timeoutMs?: number;
}

function harness(opts: HarnessOptions = {}) {
  const store = opts.store ?? memoryStore();
  const finds: WorkToFind[] = [];
  const reads: string[] = [];
  const taken: { bucket: string; policy: RatePolicy }[] = [];
  const finished: string[] = [];
  const firstPagesCalls: RawSource[] = [];
  const guess = makeGuessSource({
    reader: {
      async loadArticle(slug) {
        if (slug === "not-mine") throw Object.assign(new Error(`No article "${slug}".`), { status: 404 });
        return opts.article ?? article();
      },
      async loadSource() {
        return opts.source === undefined
          ? { bytes: new Uint8Array([37, 80, 68, 70]), kind: "pdf", filename: "hpc-coupling-final.pdf" }
          : opts.source;
      },
    },
    guesses: store.store,
    allowance: {
      async take(bucket, policy) {
        if (opts.delay === "allowance") await new Promise((go) => setTimeout(go, 300));
        taken.push({ bucket, policy });
        return opts.allowance ?? { kind: "allowed", id: "lease-1" };
      },
      async finish(id) {
        finished.push(id);
      },
    },
    find: async (work) => {
      if (opts.delay === "search") await new Promise((go) => setTimeout(go, 300));
      finds.push(work);
      opts.onFind?.();
      const answer = opts.find ?? kept();
      if (answer instanceof Error) throw answer;
      return answer;
    },
    read: async (url) => {
      if (opts.delay === "read") await new Promise((go) => setTimeout(go, 300));
      reads.push(url);
      return opts.read ?? readPage();
    },
    firstPages: async (source) => {
      if (opts.delay === "identity") await new Promise((go) => setTimeout(go, 300));
      firstPagesCalls.push(source);
      return opts.firstPages ?? `${TITLE}\nAna Müller\nhttps://doi.org/${DOI}\nReceived 2024`;
    },
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  });
  return { guess, store, finds, reads, taken, finished, firstPagesCalls };
}

/* --------------------------------------------------------------- found -- */

describe("a page the judge accepts is stored — and only the address code chose", () => {
  it("stores the canonical DOI link when the candidate's own DOI is on the upload's first pages", async () => {
    const h = harness({ read: readPage({ meta: { title: TITLE, authors: ["Müller, Ana"], doi: DOI } }) });
    const got = await h.guess("an-upload");
    expect(got).toEqual({
      status: "found",
      url: `https://doi.org/${DOI}`,
      host: "doi.org",
      kind: "canonical",
      matchedBy: "doi",
    });
    expect(h.store.row()).toMatchObject({ status: "found", outcome: { searches: 1, model: "test/model" } });
    // The search was for the title and the authors, and the page read was the search result's.
    expect(h.finds).toEqual([{ title: TITLE, authors: "Ana Müller" }]);
    expect(h.reads).toEqual([PAGE]);
  });

  it("stores the search result's own address — not the read's — for a text match", async () => {
    /* The read followed a `citation_pdf_url` to a different address; what the
       reader is shown is still the page the search returned. */
    const h = harness({ firstPages: `${TITLE}\nAna Müller`, read: readPage({ url: `${PAGE}/pdf`, format: "pdf" }) });
    const got = await h.guess("an-upload");
    expect(got).toEqual({ status: "found", url: PAGE, host: "example-journal.org", kind: "matching", matchedBy: "content" });
  });
});

/* ---------------------------------------------------------------- none -- */

describe("anything short of the judge's yes settles as none", () => {
  it("when the judge says it is a different paper", async () => {
    const other = "Oscillatory Coupling Between Hippocampus and Prefrontal Cortex: A Review";
    const h = harness({ find: kept(PAGE, other), read: readPage({ title: other, meta: {} }) });
    expect(await h.guess("an-upload")).toEqual({ status: "none" });
    expect(h.store.row()).toMatchObject({ status: "none", outcome: { why: "judge:title-mismatch", searches: 1 } });
  });

  it("when the page cannot be read", async () => {
    const h = harness({
      read: { kind: "unreadable", url: PAGE, host: "example-journal.org", why: "paywall-or-empty" },
    });
    expect(await h.guess("an-upload")).toEqual({ status: "none" });
    expect(h.store.row()).toMatchObject({ outcome: { why: "read:paywall-or-empty" } });
  });

  it("when the search keeps nothing, without reading any page", async () => {
    const h = harness({
      find: {
        reading: { verdict: { kind: "none", why: "none-picked" }, searches: 2, searchesFrom: "server_tool_use", results: 5 },
        model: "test/model",
      },
    });
    expect(await h.guess("an-upload")).toEqual({ status: "none" });
    expect(h.reads).toEqual([]);
    expect(h.store.row()).toMatchObject({ outcome: { why: "search:none-picked", searches: 2 } });
  });

  it("with no identity — a filename for a title — without a search and without the allowance", async () => {
    const h = harness({ article: article({ title: "hpc-coupling-final", filename: "hpc-coupling-final.pdf" }) });
    expect(await h.guess("an-upload")).toEqual({ status: "none" });
    expect(h.finds).toEqual([]);
    expect(h.reads).toEqual([]);
    expect(h.taken).toEqual([]);
    expect(h.store.row()).toMatchObject({ status: "none", outcome: { why: "no-identity", searches: null } });
  });
});

/* ------------------------------------------------------ free refusals -- */

describe("the refusals that cost nothing come before anything is claimed", () => {
  it("is a 404 for a slug the caller does not own", async () => {
    const h = harness();
    await expect(h.guess("not-mine")).rejects.toMatchObject({ status: 404 });
    expect(h.store.log).toEqual([]);
    expect(h.finds).toEqual([]);
  });

  it("is a 409 for an article that was fetched from the web", async () => {
    const fetched = article({ url: "https://example.org/a-post" });
    delete fetched.meta.filename;
    delete fetched.meta.source;
    const h = harness({ article: fetched });
    await expect(h.guess("an-upload")).rejects.toMatchObject({ status: 409 });
    expect(h.store.log).toEqual([]);
    expect(h.taken).toEqual([]);
  });

  it("answers the settled guess on the payload without claiming or searching again", async () => {
    const settled = { status: "found", url: `https://doi.org/${DOI}`, host: "doi.org", kind: "canonical", matchedBy: "doi" } as const;
    const h = harness({ article: article({}, settled) });
    expect(await h.guess("an-upload")).toEqual(settled);
    expect(h.store.log).toEqual([]);
    expect(h.finds).toEqual([]);
  });

  it("answers a guess settled since the payload was read, without a second search", async () => {
    const h = harness({ store: memoryStore({ settled: { status: "none" } }) });
    expect(await h.guess("an-upload")).toEqual({ status: "none" });
    expect(h.store.log).toEqual(["claim"]);
    expect(h.finds).toEqual([]);
    expect(h.taken).toEqual([]);
  });

  it("answers searching, and spends nothing, while somebody else holds the claim", async () => {
    const h = harness({ store: memoryStore({ busy: true }) });
    expect(await h.guess("an-upload")).toEqual({ status: "searching" });
    expect(h.finds).toEqual([]);
    expect(h.taken).toEqual([]);
    expect(h.firstPagesCalls).toEqual([]);
  });
});

/* ---------------------------------------------------------- allowance -- */

describe("the allowance — every search is billed", () => {
  it("takes one fill from its own bucket before the search, and finishes it after", async () => {
    const h = harness();
    await h.guess("an-upload");
    expect(h.taken).toEqual([{ bucket: "upload-source-guess", policy: GUESS_RATE_POLICY }]);
    expect(h.finished).toEqual(["lease-1"]);
  });

  it.each([
    ["rate", 429],
    ["concurrency", 429],
    ["global", 503],
  ] as const)("a %s refusal is a %i: nothing searched, and the claim and its attempt given back", async (kind, status) => {
    const h = harness({ allowance: { kind } });
    await expect(h.guess("an-upload")).rejects.toMatchObject({ status });
    expect(h.finds).toEqual([]);
    expect(h.finished).toEqual([]);
    expect(h.store.log).toEqual(["claim", "release:refund"]);
    expect(h.store.row()).toMatchObject({ status: "searching", attempts: 0, stale: true });
  });
});

/* ---------------------------------------------------- provider failure -- */

describe("a provider failure is not 'no page matched'", () => {
  const refused = Object.assign(new Error("The AI service refused."), { status: 502 });

  it("on the first attempt, hands the claim straight back for the next open, and rethrows", async () => {
    const h = harness({ find: refused });
    await expect(h.guess("an-upload")).rejects.toMatchObject({ status: 502 });
    expect(h.store.log).toEqual(["claim", "release:keep"]);
    expect(h.store.row()).toMatchObject({ status: "searching", attempts: 1, stale: true });
    expect(h.finished).toEqual(["lease-1"]);
  });

  it("on the last attempt, settles as none", async () => {
    const store = memoryStore({ busy: true, attempts: 1 });
    const row = store.row();
    if (row?.status === "searching") row.stale = true;
    const h = harness({ find: refused, store });
    await expect(h.guess("an-upload")).rejects.toMatchObject({ status: 502 });
    expect(h.store.row()).toMatchObject({ status: "none", attempts: 2, outcome: { why: "provider-failed" } });
  });
});

/* ---------------------------------------------------------- deadline -- */

describe("the one deadline", () => {
  it.each(["identity", "allowance", "search", "read"] as const)("covers %s work", async (delay) => {
    const h = harness({ delay, timeoutMs: 100 });

    await expect(h.guess("an-upload")).rejects.toMatchObject({ status: 504 });
    expect(h.store.log).toEqual(["claim", "release:keep"]);
    expect(h.store.row()).toMatchObject({ status: "searching", attempts: 1, stale: true });
    if (delay === "identity") {
      expect(h.taken).toEqual([]);
      expect(h.finds).toEqual([]);
    } else {
      expect(h.taken).toHaveLength(1);
      expect(h.finished).toEqual(["lease-1"]);
    }
    if (delay === "allowance") expect(h.finds).toEqual([]);
    if (delay === "search") {
      await new Promise((go) => setTimeout(go, 250));
      expect(h.reads).toEqual([]);
    }
  });
});

/* --------------------------------------------------------------- fence -- */

describe("an answer written after the claim was lost is discarded", () => {
  it("returns what the row holds instead of what it found", async () => {
    let store: ReturnType<typeof memoryStore> | undefined;
    store = memoryStore();
    const h = harness({ store, onFind: () => store?.steal() });
    expect(await h.guess("an-upload")).toEqual({ status: "searching" });
    expect(h.store.log).toEqual(["claim", "finish:found"]);
    expect(h.store.row()).toMatchObject({ status: "searching", token: "stolen" });
  });
});

/* ------------------------------------------------------------- helpers -- */

describe("the opening prose", () => {
  it("skips the title, the byline, the affiliation and the keywords, and takes the abstract", () => {
    const opening = openingProse(BLOCKS);
    expect(opening.startsWith("Abstract: memory consolidation")).toBe(true);
    expect(opening).not.toContain("Müller");
    expect(opening).not.toContain("Department");
    expect(opening.split(" ").length).toBeLessThanOrEqual(150);
  });

  it("never takes a footnote or a boxed aside", () => {
    const note = { ...block("text", ABSTRACT), role: "footnote" as const };
    expect(openingProse([note])).toBe("");
  });

  it("never takes a licence or copyright paragraph, which many unrelated pages share (Sol code review F6)", () => {
    const licence = block(
      "text",
      "This article is an open access article distributed under the terms and conditions of the Creative Commons Attribution license, which permits unrestricted use, distribution and reproduction in any medium provided the original work is properly cited.",
    );
    const copyright = block(
      "text",
      "© 2021 the authors. all rights reserved by the publisher and no part of this work may be reproduced without the written permission of the copyright holder in any form whatsoever.",
    );
    expect(openingProse([licence, copyright])).toBe("");
  });
});

describe("what counts as an upload", () => {
  it("is a file off the owner's disk, or an old PDF with no address — never a fetched page", () => {
    expect(isAnUpload({ slug: "a", title: "t", filename: "x.html" } as Meta)).toBe(true);
    expect(isAnUpload({ slug: "a", title: "t", source: "pdf" } as Meta)).toBe(true);
    expect(isAnUpload({ slug: "a", title: "t", source: "pdf", url: "file:///Users/greg/paper.pdf" } as Meta)).toBe(true);
    expect(isAnUpload({ slug: "a", title: "t", source: "pdf", url: "https://x.org/a.pdf" } as Meta)).toBe(false);
    expect(isAnUpload({ slug: "a", title: "t", url: "https://x.org/a" } as Meta)).toBe(false);
  });
});

describe("an HTML upload's first pages", () => {
  it("are its text, without scripts or styles", async () => {
    const html = `<html><head><style>.a{}</style><script>var secret = 1;</script></head>
      <body><h1>${TITLE}</h1><p>doi: ${DOI}</p></body></html>`;
    const text = await defaultFirstPages({ bytes: new TextEncoder().encode(html), kind: "html", filename: "p.html" });
    expect(text).toContain(TITLE);
    expect(text).toContain(DOI);
    expect(text).not.toContain("secret");
  });
});
