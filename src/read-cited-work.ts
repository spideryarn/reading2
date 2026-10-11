/**
 * **`read_cited_work`: chat reads a paper the article cites**, aimed at one
 * claim the article makes with it. Plan
 * docs/plans/261011w-does-the-cited-work-say-that-at-the-citing-sentence.md.
 *
 * `read_web_page` refuses a PDF, and most cited papers are PDFs, so until this
 * a chat asked *does the cited work say that?* answered from search snippets
 * and abstracts. This is Dig deeper's paper read (src/paper-evidence.ts), the
 * half that survived its button (plan 261009k, D5: *"reuse it as a chat
 * tool"*), handed to chat:
 *
 * - **which work** is a row of the stored Bibliography, matched by its title
 *   and nothing else (Sol S3); the model never supplies an address;
 * - **which address** is the row's DOI or arXiv link, or the page a current
 *   quick check matched, never a row's other links (Sol S2), exactly as the
 *   Dig deeper press chose it;
 * - **whether it is the work** is code's: `confirmIdentity` on page one;
 * - **what is sent** is the title and abstract and the chunks that share the
 *   most words with the row's own context and the model's `claim`, within
 *   `CITED_WORK_WORDS`.
 *
 * The paper's words are a stranger's, so they go inside `untrusted()`; the
 * provenance line is ours and sits outside it. That is `read_web_page`'s
 * mitigation and its residual risk, not link-summary's (whose model has no
 * tools): a hostile PDF can still ask for a later `read_web_page` (Sol S5,
 * docs/project/security.md § Chat tools).
 *
 * Every outcome that is not a read is a sentence, never a throw
 * (src/chat-tools.ts § rule 3).
 */
import { lookupWork } from "./bibliographic.js";
import { investigateContext, matchedPageOf } from "./citation-investigate-context.js";
import { errorFields, log, since } from "./log.js";
import { paperUnreadableSentence } from "./messages.js";
import {
  readPaperEvidence,
  type NotConfirmedWhy,
  type PaperEvidence,
  type PaperEvidenceInput,
} from "./paper-evidence.js";
import { BibliographyListNotFound } from "./store/bibliography-list-not-found.js";
import { citationFindStore, loadBibliography } from "./store/index.js";
import type { Block, BibliographyFound, CitationFind, CitedWork } from "./types.js";
import { untrusted } from "./untrusted-fence.js";

/**
 * **How much of the paper is sent.** Two-fifths of Dig deeper's 5,000: a chat
 * tool's output is appended to the conversation and re-sent on every later
 * round (src/chat-tools.ts § rule 2). About `WEB_PAGE_CHARS`, so a paper read
 * here costs what a page read costs. Sol S7.
 */
export const CITED_WORK_WORDS = 2_000;

/**
 * **The whole read's deadline**, registry and paper together. The paper's own
 * `PAPER_READ_MS` (25 s) starts only after the registry answers, which can take
 * as long again on a cold DOI (Sol S4); a reader is watching this.
 */
export const CITED_WORK_DEADLINE_MS = 40_000;

/** Candidate titles named back when a `work` matches several rows. */
const MAX_CANDIDATES = 8;

export interface ReadCitedWorkDeps {
  loadBibliography(slug: string): Promise<BibliographyFound>;
  /** The stored quick-check find for one row, for `matchedPageOf`. */
  loadFind(slug: string, entryId: string): Promise<CitationFind | null>;
  readPaper(input: PaperEvidenceInput, signal: AbortSignal): Promise<PaperEvidence>;
  deadlineMs?: number;
}

export const readCitedWorkDeps: ReadCitedWorkDeps = {
  loadBibliography,
  loadFind: (slug, entryId) => citationFindStore.load(slug, entryId),
  readPaper: (input, signal) => readPaperEvidence(input, { lookup: lookupWork, signal }),
};

export interface CitedWorkOutcome {
  /** The detail line under the tool's row in the transcript. */
  detail: string;
  /** The `tool` message's content. */
  content: string;
}

/** Lower case, letters and digits only, single-spaced: how a title is compared. */
export function titleKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * **Which row the model means**, by title only (Sol S3): an exact title wins;
 * otherwise every title containing the words, as a run. `article_citations`'
 * query also searches `why`, which is the model's own sentence, and could pick
 * a work because its paraphrase happened to contain the words.
 */
export function matchWork(works: readonly CitedWork[], wanted: string): CitedWork[] {
  const key = titleKey(wanted);
  if (key === "") return [];
  const exact = works.filter((w) => titleKey(w.title) === key);
  if (exact.length > 0) return exact;
  /* A complete one-word title such as *The* is still exact and wins above. As
     a partial query, though, an article or preposition is not enough identity
     to choose a paper merely because only one stored title happens to contain
     it. Content words — including a single distinctive one — keep the useful
     containment path. */
  const common = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
  if (key.split(" ").every((word) => common.has(word))) return [];
  return works.filter((w) => ` ${titleKey(w.title)} `.includes(` ${key} `));
}

const NOT_CONFIRMED: Record<NotConfirmedWhy, string> = {
  "different-identifier": "the PDF names a different DOI or arXiv id from the one the article gives",
  "title-not-found": "the work's title is not on the PDF's first page",
  "no-second-signal": "the title is there, but neither an identifier nor the first author's name backs it",
};

/** What to tell the model when the paper was not read: why, and what it may do instead. */
function notRead(evidence: Exclude<PaperEvidence, { state: "read" }>): CitedWorkOutcome {
  const unread = "Tell the reader plainly that the paper itself was not read, and do not describe what it says as if it had been.";
  switch (evidence.state) {
    case "no-address":
      return {
        detail: "no address to read",
        content:
          "The article gives no DOI or arXiv link for this work, and no page has been matched to it, so there " +
          `is nothing this tool can read. You may search the web for it. ${unread}`,
      };
    case "unreadable":
      return {
        detail: `could not read ${evidence.host}`,
        content: `The paper at ${evidence.host} could not be read: ${paperUnreadableSentence(evidence.why)} ${unread}`,
      };
    case "not-the-full-text":
      return {
        detail: `${evidence.host} is not a PDF`,
        content:
          `${evidence.host} served a web page rather than the paper's PDF, probably a landing page or a paywall. ` +
          `read_web_page may read its abstract. ${unread}`,
      };
    case "not-confirmed":
      return {
        detail: "could not confirm it is the work",
        content:
          `A PDF was fetched from ${evidence.host}, but code could not confirm it is this work: ` +
          `${NOT_CONFIRMED[evidence.why]}. Do not describe it as the work. ${unread}`,
      };
    case "identity-conflict":
      return {
        detail: "the identifier names another work",
        content:
          "The DOI or arXiv id the article gives for this work belongs, in the registry, to a work with a different " +
          `title, so the article's identifier is probably mistyped and nothing was read. ${unread}`,
      };
    default:
      return evidence satisfies never;
  }
}

/** Every canonical chunk is in `sentText`; counters alone cannot establish this. */
function sentTheWholePaper(evidence: Extract<PaperEvidence, { state: "read" }>): boolean {
  if (evidence.chunks.length === 0) return false;
  const selected = new Set(evidence.selected);
  return evidence.chunks.every((chunk) => selected.has(chunk.id));
}

/** The provenance line: ours, from what code did, outside the fence. */
function provenance(evidence: Extract<PaperEvidence, { state: "read" }>, complete: boolean): string {
  const how =
    evidence.matchedBy === "title-author"
      ? "its title and first author are on page one"
      : `its title is on page one and its ${evidence.matchedBy === "doi" ? "DOI" : "arXiv id"} matches the article's`;
  return [
    `We read the paper itself: a PDF from ${evidence.host}, ${evidence.pages} pages, ${evidence.words.toLocaleString("en-GB")} words` +
      `${evidence.referencesCut ? " before its references" : ""}. Code confirmed it is this work: ${how}.`,
    complete
      ? `You are shown all ${evidence.words.toLocaleString("en-GB")} words that code read${evidence.referencesCut ? " before the references" : ""}.`
      : `You are shown ${evidence.sentWords.toLocaleString("en-GB")} selected words: the opening (title and abstract), then the ` +
        "passages sharing the most words with the claim and with what the article cites it for. Each passage is " +
        "headed with its page.",
  ].join(" ");
}

const AFTER_PARTIAL_READ =
  "Quote the paper only from the text above, and give the page. If these passages do not speak to the claim, " +
  "say that the passages you were shown do not, never that the paper does not: you were shown part of it.";

const AFTER_COMPLETE_READ =
  "Quote the paper only from the text above, and give the page. If the paper text above does not speak to the claim, say so.";

/** Race even an un-abortable registry lookup against the turn's signal. */
async function readBeforeAbort(read: () => Promise<PaperEvidence>, signal: AbortSignal): Promise<PaperEvidence> {
  let stopListening = (): void => undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        const fail = () => reject(new Error("aborted"));
        if (signal.aborted) fail();
        else {
          signal.addEventListener("abort", fail, { once: true });
          stopListening = () => signal.removeEventListener("abort", fail);
        }
      }),
    ]);
  } finally {
    /* If the paper wins, the composite signal will not abort until the
       deadline. Promise.race already observes a later rejection from the
       losing read, so removing this listener creates no unhandled branch. */
    stopListening();
  }
}

/**
 * Run the tool. `blocks` are the article the reader has open, for the row's
 * citing passages; `signal` is the turn's.
 */
export async function readCitedWork(
  args: Record<string, unknown>,
  ctx: { slug: string; blocks: readonly Block[]; signal?: AbortSignal | undefined },
  deps: ReadCitedWorkDeps = readCitedWorkDeps,
): Promise<CitedWorkOutcome> {
  const wanted = typeof args.work === "string" ? args.work.trim() : "";
  const claim = typeof args.claim === "string" ? args.claim.trim().slice(0, 2_000) : "";
  if (wanted === "") {
    return {
      detail: "no work named",
      content: "No work was named. Pass the work's title as article_citations lists it.",
    };
  }

  let found: BibliographyFound;
  try {
    found = await deps.loadBibliography(ctx.slug);
  } catch (err) {
    if (err instanceof BibliographyListNotFound) {
      return {
        detail: "no citations list",
        content:
          "No citations list has been made for this article, so there is no work this tool can read. " +
          "Answer from the article itself, and do not pretend to have read the work.",
      };
    }
    log("model").warn({ tool: "read_cited_work", slug: ctx.slug, ...errorFields(err) }, "chat tool: could not read the citations list");
    return {
      detail: "could not read the list",
      content:
        "This article's citations list could not be read just now, so the work could not be found. " +
        "Tell the reader it could not be loaded; do not describe the work as if you had read it.",
    };
  }
  /* Stale: its works and block ids may describe an earlier article (Sol S3,
     the rule `article_citations` already keeps). */
  if (found.stale) {
    return {
      detail: "list out of date",
      content:
        "The citations list was made from an older version of this article, so it is not used. " +
        "Answer from the article itself, and do not describe the work as if you had read it.",
    };
  }

  const matches = matchWork(found.bibliography.citations, wanted);
  if (matches.length === 0) {
    return {
      detail: "no such work",
      content:
        "No work in this article's citations list has that title. Call article_citations to see the titles, " +
        "then pass one as it is listed.",
    };
  }
  if (matches.length > 1) {
    const titles = matches.slice(0, MAX_CANDIDATES).map((w) => `- ${w.title}`).join("\n");
    return {
      detail: `${matches.length} works match`,
      content:
        `${matches.length} works in the citations list match that. Call again with one of these titles, whole:\n\n` +
        untrusted("citation titles", titles),
    };
  }
  const work = matches[0]!;

  const text = new Map(ctx.blocks.map((b) => [b.id as string, b.text]));
  const context = investigateContext(work, (id) => text.get(id));
  let find: CitationFind | null = null;
  if (work.lookup) {
    try {
      find = await deps.loadFind(ctx.slug, work.id);
    } catch (err) {
      /* The matched page is a second route to the paper, not a gate. */
      log("model").warn({ tool: "read_cited_work", ...errorFields(err) }, "chat tool: could not load the quick check's find");
    }
  }
  const matched = matchedPageOf(work, find);

  const deadline = AbortSignal.timeout(deps.deadlineMs ?? CITED_WORK_DEADLINE_MS);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline;
  const started = Date.now();
  let evidence: PaperEvidence;
  try {
    /* Raced against the signal as well as handed it: the registry lookup is
       not abortable, so the signal alone would leave the turn waiting on it. */
    evidence = await readBeforeAbort(
      () =>
        deps.readPaper(
          {
            work: context,
            matchedPageUrl: matched?.url ?? null,
            ...(claim ? { claim } : {}),
            budgetWords: CITED_WORK_WORDS,
          },
          signal,
        ),
      signal,
    );
  } catch (err) {
    const timedOut = deadline.aborted;
    log("model").info(
      { tool: "read_cited_work", outcome: timedOut ? "timed-out" : "failed", ms: since(started), ...errorFields(err) },
      "chat tool: could not read a cited work",
    );
    return {
      detail: timedOut ? "took too long" : "could not read it",
      content:
        `Reading the paper ${timedOut ? "took too long and was stopped" : "failed"}. ` +
        "Tell the reader the paper itself was not read, and do not describe what it says as if it had been.",
    };
  }

  log("model").info(
    {
      tool: "read_cited_work",
      state: evidence.state,
      ...("host" in evidence ? { host: evidence.host } : {}),
      ...(evidence.state === "read" ? { words: evidence.words, sentWords: evidence.sentWords } : {}),
      claim: claim !== "",
      ms: since(started),
    },
    "chat tool: read a cited work",
  );
  if (evidence.state !== "read") return notRead(evidence);
  const complete = sentTheWholePaper(evidence);
  return {
    detail: `read ${evidence.sentWords.toLocaleString("en-GB")} of ${evidence.words.toLocaleString("en-GB")} words`,
    content: [
      `WORK: ${untrusted("citation title", work.title)}`,
      "",
      provenance(evidence, complete),
      "",
      untrusted("cited paper", evidence.sentText),
      "",
      complete ? AFTER_COMPLETE_READ : AFTER_PARTIAL_READ,
    ].join("\n"),
  };
}
