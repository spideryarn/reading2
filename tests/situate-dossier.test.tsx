// @vitest-environment jsdom
/**
 * **The literature search in Sources › *Where it sits*** — the dossier the
 * `situate` step writes, drawn in *Where it sits* for every owner since plan
 * docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md
 * (at the top of Investigate, behind the experimental switch, before). Plan
 * docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md
 * § The dossier; § Stages, 2.
 *
 * - The words and the order, without React (situate-dossier.ts): the head
 *   line, the groups in the reader's order with counts, a finding's chat
 *   question and origin, the fold's summary.
 * - The section (SituateDossier.tsx through WhereItSitsPanel): the press
 *   before it has run, the working state, the findings, a finding's chat by
 *   its id, the honest nothing-found, the fold, Search again, the stale
 *   banner, and model text never drawn as HTML. Investigate keeps only the
 *   search's questions.
 * - The hook (useSituate.ts): reads, and spends only on a press — unforced for
 *   the first, `force: ["situate"]` for Search again.
 *
 * Mounting from SourcesBand with the switch off is
 * tests/reception-lens-in-chat.test.tsx § Where it sits.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourcesHead } from "./helpers/sources-head.js";
import type { BlockId, Job, Situate, SituateFinding, ThreadSummary } from "../src/types.js";
import { MAX_LENS_CHARS } from "../src/types.js";
import type { UseSituate } from "../src/web/useSituate.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const asked: { url: string; method: string; body: unknown }[] = [];
let stored: unknown = null;
/** Set to hold `GET /api/situate/a-piece` open until the test answers it. */
let situateReply: Promise<Response> | null = null;
/** The same seam for a slug-change race. */
let otherSituateReply: Promise<Response> | null = null;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    asked.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.startsWith("/api/jobs") && method === "POST") {
      return new Response(JSON.stringify({ id: "job-1" }), { status: 200 });
    }
    if (url.startsWith("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    if (url === "/api/situate/a-piece") {
      if (situateReply) return situateReply;
      return new Response(JSON.stringify(stored), { status: 200 });
    }
    if (url === "/api/situate/another-piece") {
      if (otherSituateReply) return otherSituateReply;
      return new Response(JSON.stringify(null), { status: 200 });
    }
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init) };
});

/* Which rows a focus landed on (item-focus.ts § `useLandOnItem` flashes the row it lands on). */
const flashed: string[] = [];
vi.mock("../src/web/flash.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/flash.js")>("../src/web/flash.js");
  return { ...real, flashElement: (el: HTMLElement) => flashed.push(el.getAttribute("data-finding") ?? "?") };
});

const dossier = await import("../src/web/situate-dossier.js");
const {
  SITUATE_HEAD,
  SITUATE_RUN,
  SITUATE_AGAIN,
  SITUATE_DISCLOSURE,
  SITUATE_WHAT,
  SITUATE_WORKING,
  SITUATE_NOTHING_FOUND,
  SITUATE_ABSENCE,
  SITUATE_QUESTIONS_HEAD,
  SITUATE_STALE,
  ASK_FINDING_IN_CHAT,
  OPEN_FINDING_CHAT,
  findingLens,
  findingOrigin,
  groupFindings,
  groupHeading,
  searchedLine,
  situateHeadLine,
} = dossier;
const { InvestigatePanel, SOURCES_INVESTIGATE_SUGGESTED_HEAD } = await import("../src/web/InvestigatePanel.js");
const { WhereItSitsPanel } = await import("../src/web/WhereItSitsPanel.js");
const { useSituate } = await import("../src/web/useSituate.js");
const { dayOf } = await import("../src/web/relative-time.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

const A = "spya-aaaaaa" as BlockId;
const B = "spya-bbbbbb" as BlockId;

function finding(over: Partial<SituateFinding> & Pick<SituateFinding, "id" | "kind">): SituateFinding {
  return {
    blockId: A,
    quote: "ignition is a step function",
    note: "A 2025 adversarial collaboration found little ignition at stimulus offset.",
    strength: "strong",
    sources: [
      {
        origin: "web",
        url: "https://www.nature.com/articles/x",
        title: "Adversarial testing of theories",
        quote: "we found little evidence of ignition at offset in any region",
      },
    ],
    ...over,
  };
}

const FINDINGS: SituateFinding[] = [
  finding({ id: "s1", kind: "supported", blockId: B, quote: "the workspace is global" }),
  finding({ id: "c1", kind: "challenged" }),
  finding({ id: "m1", kind: "missing", note: "Predictive processing accounts are not cited." }),
  finding({ id: "c2", kind: "challenged", blockId: B, quote: "broadcast is all or none" }),
  finding({ id: "n1", kind: "since" }),
];

function situate(over: Partial<Situate> = {}): Situate {
  return {
    version: "situate/1",
    generator: "t",
    slug: "a-piece",
    sourceHash: "h",
    profileHash: null,
    generatedAt: "2026-10-24T10:00:00.000Z",
    elapsedMs: 1000,
    kind: "review",
    year: 2023,
    angle: "since",
    outcome: "read",
    overview: "The report became a reference point. The live disputes are about ignition.",
    findings: FINDINGS,
    questions: ["Do the Cogitate results weaken the ignition claim?", "Who has replicated the masking studies?"],
    searched: {
      queries: [
        { q: "global workspace review 2023", for: "the piece", group: "piece", outcome: "found", pages: 6 },
        { q: "ignition adversarial collaboration", for: "a claim", group: "claim", outcome: "empty", pages: 0 },
        { q: "masking replication", for: "a citation", group: "citation", outcome: "failed", pages: 0 },
      ],
      pages: 6,
      citers: 40,
      cited: 0,
    },
    counts: {
      written: 5,
      kept: 5,
      malformed: 0,
      unknownBlock: 0,
      unquoted: 0,
      unknownSource: 0,
      sourceUnquoted: 0,
      noSource: 0,
      citationRule: 0,
      perBlock: 0,
      overCap: 0,
      duplicate: 0,
      queriesRefused: 0,
    },
    ...over,
  };
}

describe("the words and the order", () => {
  it("heads the dossier with the kind, the year and what it looked for", () => {
    expect(situateHeadLine({ kind: "review", year: 2023, angle: "since" })).toBe(
      "A review from 2023: what has happened since",
    );
    expect(situateHeadLine({ kind: "empirical", year: 2026, angle: "now" })).toBe("A study from 2026: where it sits now");
    expect(situateHeadLine({ kind: "theory", year: null, angle: "now" }), "a year it could not tell is left out").toBe(
      "A theoretical piece: where it sits now",
    );
  });

  it("groups by kind in the reader's order, strongest first within, with no empty groups", () => {
    const groups = groupFindings(FINDINGS);
    expect(groups.map((g) => g.kind)).toEqual(["challenged", "since", "missing", "supported"]);
    expect(groups[0]?.findings.map((f) => f.id), "stored order kept").toEqual(["c1", "c2"]);
    expect(groups.map((g) => groupHeading(g))).toEqual(["Challenged · 2", "Since · 1", "Not cited? · 1", "Supported · 1"]);
    expect(groupFindings([finding({ id: "x", kind: "citation" })])[0]?.label).toBe("Citation?");
    expect(groupFindings([])).toEqual([]);
  });

  it("asks about a finding in words that fit a lens, keep the question, and are the same every time", () => {
    const long = finding({ id: "l", kind: "since", note: "word ".repeat(400), quote: "q ".repeat(200) });
    const lens = findingLens(long);
    expect(lens.length).toBeLessThanOrEqual(MAX_LENS_CHARS);
    expect(lens).toBe(lens.trim());
    expect(lens.endsWith("what else bears on it?")).toBe(true);
    expect(findingLens(long)).toBe(lens);
    expect(findingLens(FINDINGS[1] as SituateFinding)).toContain("“ignition is a step function”");
  });

  it("says what was searched, counting only the searches that searched", () => {
    expect(searchedLine(situate().searched)).toBe("3 searches (2 ran), 6 pages, 40 later papers");
    expect(
      searchedLine({ queries: [{ q: "a b c", for: "x", group: "piece", outcome: "found", pages: 1 }], pages: 1, citers: 1, cited: 2 }),
    ).toBe("1 search, 1 page, 1 later paper, 2 cited abstracts");
  });
});

/* ------------------------------------------------------------------ panel -- */

let host: HTMLDivElement;
let root: Root;
const questions: string[] = [];
/** The findings a press on *Ask in chat* handed to the sender. */
const askedFindings: string[] = [];
const opened: string[] = [];
const jumped: string[] = [];
const pressed: string[] = [];

function owner(over: Partial<UseSituate> = {}): UseSituate {
  return {
    status: "ready",
    situate: situate(),
    stale: false,
    outdated: false,
    profileChanged: false,
    slug: "a-piece",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    rewriting: false,
    refresh: async () => {},
    retryRead: async () => {},
    ensure: async () => {
      pressed.push("ensure");
    },
    regenerate: async () => {
      pressed.push("regenerate");
    },
    cancel: () => {},
    ...over,
  };
}

/** *Where it sits*, with the dossier, and with its two free lists empty and quiet. */
function panel(
  situateOwner: UseSituate,
  summaries: ThreadSummary[] = [],
  focus: { findingFocus: { id: string; n: number }; onFindingFocusTaken(f: { id: string }): void } | null = null,
): ReactElement {
  return createElement(WhereItSitsPanel, {
    head: sourcesHead({ view: "where", onView: () => {}, ownerSlug: "a-piece" }),
    situate: situateOwner,
    citers: { result: { kind: "no-doi" }, retry: () => {} },
    before: { status: "none", works: null, listing: false },
    articleYear: null,
    chats: {
      summaries,
      onFinding: (f: SituateFinding) => askedFindings.push(f.id),
      onOpen: (id: string) => opened.push(id),
    },
    onJump: (id: BlockId) => jumped.push(id),
    onOpenWork: () => {},
    onView: () => {},
    ...(focus ?? {}),
  });
}

/** Investigate, which keeps the search's questions and no longer draws its dossier. */
function investigate(pieceQuestions: readonly string[]): ReactElement {
  return createElement(InvestigatePanel, {
    head: sourcesHead({ view: "investigate", onView: () => {}, ownerSlug: "a-piece" }),
    chats: {
      summaries: [],
      loaded: false,
      occupied: false,
      onQuestion: (q: string) => questions.push(q),
      onCheck: () => {},
      onAskWork: () => {},
      onFinding: () => {},
      onOpen: (id: string) => opened.push(id),
    },
    claims: null,
    works: null,
    pieceQuestions,
  });
}

function paint(situateOwner: UseSituate, summaries: ThreadSummary[] = []): void {
  act(() => {
    root.render(panel(situateOwner, summaries));
  });
}

beforeEach(() => {
  asked.length = 0;
  stored = null;
  situateReply = null;
  otherSituateReply = null;
  jobEngine.reset();
  questions.length = 0;
  askedFindings.length = 0;
  opened.length = 0;
  jumped.length = 0;
  pressed.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const section = () => host.querySelector<HTMLElement>(".where-situate");
const text = () => (section()?.textContent ?? "").replace(/\s+/g, " ");
const buttonCalled = (words: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === words);
const groupHeads = () => [...host.querySelectorAll<HTMLElement>(".situate-group-head")].map((h) => h.textContent);

describe("a finding asked for from the margin or its chat's way back (plan 261024o § Marginalia; 261025h)", () => {
  function paintFocused(id: string, taken: string[], summaries: ThreadSummary[] = []): void {
    act(() => {
      root.render(panel(owner(), summaries, { findingFocus: { id, n: 1 }, onFindingFocusTaken: (f) => taken.push(f.id) }));
    });
  }

  it("lands on that finding's row, and hands the request back", () => {
    flashed.length = 0;
    const taken: string[] = [];
    paintFocused("c2", taken);
    expect(flashed).toEqual(["c2"]);
    expect(taken).toEqual(["c2"]);
  });

  it("drops a finding this dossier no longer has, landing nowhere", () => {
    flashed.length = 0;
    const taken: string[] = [];
    paintFocused("replaced-by-a-newer-search", taken);
    expect(flashed).toEqual([]);
    expect(taken).toEqual(["replaced-by-a-newer-search"]);
  });

  it("opens no conversation over the finding it is landing on", () => {
    const taken: string[] = [];
    const chat: ThreadSummary = {
      id: "newest",
      title: "Newest Investigate chat",
      createdAt: "2026-10-24T10:00:00.000Z",
      updatedAt: "2026-10-24T10:00:00.000Z",
      kind: "chat",
      turns: 1,
      origin: { mode: "reception", lens: "What bears on this?" },
    };
    paintFocused("c2", taken, [chat]);
    expect(taken).toEqual(["c2"]);
    expect(opened).toEqual([]);
  });
});

describe("the section", () => {
  it("is not in Investigate any more, which keeps only the search's questions (plan 261025h)", () => {
    act(() => root.render(investigate(situate().questions)));
    expect(section()).toBeNull();
    expect(host.textContent).not.toContain(SITUATE_HEAD);
    expect(host.textContent).not.toContain(SITUATE_RUN);
    expect(host.textContent).toContain(SITUATE_QUESTIONS_HEAD);
    /* Investigate itself is all there. */
    expect(host.textContent).toContain(SOURCES_INVESTIGATE_SUGGESTED_HEAD);
  });

  it("carries no Experimental badge: it is out of the switch (plan 261025h, decision 5)", () => {
    paint(owner({ status: "none", situate: null }));
    expect(section()?.textContent).not.toMatch(/experimental/i);
    expect(host.querySelector(".situate-experimental")).toBeNull();
  });

  it("before it has run: the heading, what it does, the button and what it sends; a press starts it once", () => {
    paint(owner({ status: "none", situate: null }));
    expect(section()?.querySelector("h3")?.textContent).toContain(SITUATE_HEAD);
    expect(text()).toContain(SITUATE_WHAT);
    expect(text()).toContain(SITUATE_DISCLOSURE);
    expect(SITUATE_DISCLOSURE).toMatch(/title/);
    expect(SITUATE_DISCLOSURE).toMatch(/web search engine/);
    act(() => buttonCalled(SITUATE_RUN)?.click());
    expect(pressed).toEqual(["ensure"]);
    expect(host.textContent).not.toContain(SITUATE_QUESTIONS_HEAD);
  });

  it("sits above After it and Before it once it has run (plan 261025h, decision 1)", () => {
    paint(owner());
    const after = host.querySelector(".where-after");
    expect(section()?.compareDocumentPosition(after as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("says it is working while the job starts", () => {
    paint(owner({ status: "none", situate: null, starting: true }));
    expect(text()).toContain(SITUATE_WORKING);
    expect(buttonCalled(SITUATE_RUN)).toBeUndefined();
  });

  it("when done: the head line, the overview, and the findings grouped in the reader's order with counts", () => {
    paint(owner());
    expect(text()).toContain("A review from 2023: what has happened since");
    expect(text()).toContain("The report became a reference point.");
    expect(groupHeads()).toEqual(["Challenged · 2", "Since · 1", "Not cited? · 1", "Supported · 1"]);
    /* The model's words in the model's face. */
    expect(section()?.querySelector(".situate-overview")?.classList.contains("voice-ai")).toBe(true);
    expect(section()?.querySelector(".situate-note")?.classList.contains("voice-ai")).toBe(true);
  });

  it("jumps to a finding's passage", () => {
    paint(owner());
    const first = section()?.querySelector<HTMLAnchorElement>(".situate-finding a.block-ref");
    act(() => first?.click());
    expect(jumped).toEqual([A]);
  });

  it("links each source and shows what it says one press away", () => {
    paint(owner());
    const finding = section()?.querySelector(".situate-finding") as HTMLElement;
    const link = finding.querySelector<HTMLAnchorElement>("a.situate-source-link");
    expect(link?.getAttribute("href")).toBe("https://www.nature.com/articles/x");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
    const quote = finding.querySelector<HTMLElement>(".situate-source-quote");
    expect(quote?.hidden).toBe(true);
    const toggle = finding.querySelector<HTMLButtonElement>("button.situate-source-toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle?.click());
    expect(quote?.hidden).toBe(false);
    expect(quote?.textContent).toContain("we found little evidence of ignition");
  });

  it("never makes a stored non-web source address into a link", () => {
    paint(
      owner({
        situate: situate({
          findings: [
            finding({
              id: "unsafe",
              kind: "since",
              sources: [
                {
                  origin: "web",
                  url: "javascript:alert(1)",
                  title: "A stored <b>source</b>",
                  quote: "<img src=x onerror=alert(1)> is still only quoted text",
                },
              ],
            }),
          ],
        }),
      }),
    );
    const source = section()?.querySelector<HTMLElement>(".situate-source");
    expect(source?.querySelector("a")).toBeNull();
    expect(source?.querySelector("b, img")).toBeNull();
    expect(source?.textContent).toContain("A stored <b>source</b>");
    act(() => source?.querySelector<HTMLButtonElement>("button")?.click());
    expect(source?.textContent).toContain("<img src=x onerror=alert(1)> is still only quoted text");
  });

  it("asks about a finding in chat through its sender, and shows its chat's mark, found by the finding's id", () => {
    paint(owner());
    const ask = () => section()?.querySelector<HTMLButtonElement>(`.situate-finding button[aria-label="${ASK_FINDING_IN_CHAT}"]`);
    act(() => ask()?.click());
    expect(askedFindings).toEqual(["c1"]);

    const chat: ThreadSummary = {
      id: "t1",
      title: "A chat",
      createdAt: "2026-10-24T10:00:00.000Z",
      updatedAt: "2026-10-24T10:00:00.000Z",
      kind: "chat",
      turns: 1,
      origin: findingOrigin(FINDINGS[1] as SituateFinding),
    };
    /* A Search again that rewords the note keeps the same id, and the mark
       with it (queue item qi-mmtsxdhg): it was found by the note's words. */
    const reworded = FINDINGS.map((f) => (f.id === "c1" ? { ...f, note: "Reworded by a newer search." } : f));
    paint(owner({ situate: situate({ findings: reworded }) }), [chat]);
    const first = section()?.querySelector(".situate-finding") as HTMLElement;
    expect(first.querySelector(`button[aria-label="${ASK_FINDING_IN_CHAT}"]`)).toBeNull();
    const mark = first.querySelector<HTMLButtonElement>(`button[aria-label="${OPEN_FINDING_CHAT}"]`);
    act(() => mark?.click());
    expect(opened).toEqual(["t1"]);
  });

  it("still finds a finding's chat started before it had an origin of its own, by the lens it stored", () => {
    const chat: ThreadSummary = {
      id: "old",
      title: "A chat",
      createdAt: "2026-10-24T10:00:00.000Z",
      updatedAt: "2026-10-24T10:00:00.000Z",
      kind: "chat",
      turns: 1,
      origin: { mode: "reception", lens: findingLens(FINDINGS[1] as SituateFinding) },
    };
    paint(owner(), [chat]);
    const first = section()?.querySelector(".situate-finding") as HTMLElement;
    expect(first.querySelector(`button[aria-label="${OPEN_FINDING_CHAT}"]`)).not.toBeNull();
  });

  it("puts the model's questions above Investigate's own, each a press", () => {
    act(() => root.render(investigate(situate().questions)));
    const heads = [...host.querySelectorAll("h3")].map((h) => h.textContent);
    expect(heads.indexOf(SITUATE_QUESTIONS_HEAD)).toBeGreaterThan(-1);
    expect(heads.indexOf(SITUATE_QUESTIONS_HEAD)).toBeLessThan(heads.indexOf(SOURCES_INVESTIGATE_SUGGESTED_HEAD));
    const row = [...host.querySelectorAll<HTMLButtonElement>(".investigate-situate-questions button.investigate-q")];
    expect(row.map((b) => b.textContent)).toEqual(situate().questions);
    act(() => row[0]?.click());
    expect(questions).toEqual([situate().questions[0]]);
  });

  it("says honestly when the searches found nothing", () => {
    paint(owner({ situate: situate({ outcome: "nothing-found", overview: "", findings: [], questions: [] }) }));
    expect(text()).toContain(SITUATE_NOTHING_FOUND);
    expect(groupHeads()).toEqual([]);
    act(() => root.render(investigate([])));
    expect(host.textContent).not.toContain(SITUATE_QUESTIONS_HEAD);
  });

  it("folds what was searched at the foot, with the sentence about absence", () => {
    paint(owner());
    const fold = section()?.querySelector<HTMLButtonElement>("button.situate-searched-toggle");
    expect(fold?.textContent).toContain("3 searches (2 ran), 6 pages, 40 later papers");
    const body = section()?.querySelector<HTMLElement>(".situate-searched");
    expect(body?.hidden).toBe(true);
    act(() => fold?.click());
    expect(body?.hidden).toBe(false);
    expect(body?.textContent).toContain("ignition adversarial collaboration");
    expect(body?.textContent).toContain("found nothing");
    expect(body?.textContent).toContain(SITUATE_ABSENCE);
  });

  it("searches again on a press, forced", () => {
    paint(owner());
    act(() => buttonCalled(SITUATE_AGAIN)?.click());
    expect(pressed).toEqual(["regenerate"]);
    expect(text()).toContain(`Searched ${dayOf(situate().generatedAt)}`);
  });

  it("says so when the article has moved under it", () => {
    paint(owner({ stale: true }));
    expect(text()).toContain(SITUATE_STALE);
  });

  it("never draws model text as markup", () => {
    paint(
      owner({
        situate: situate({
          overview: "<b>bold</b> overview",
          findings: [finding({ id: "h", kind: "since", note: "<img src=x onerror=alert(1)> note" })],
          questions: ["<i>q</i>?"],
        }),
      }),
    );
    expect(host.querySelector("b, img, i")).toBeNull();
    expect(text()).toContain("<b>bold</b> overview");
  });
});

/* ------------------------------------------------------------------- hook -- */

let seen: UseSituate | null = null;
function Probe(): ReactElement | null {
  seen = useSituate("a-piece");
  return null;
}
async function mountHook(): Promise<void> {
  await act(async () => root.render(createElement(Probe)));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}
const jobPosts = () => asked.filter((r) => r.method === "POST" && r.url === "/api/jobs");

describe("useSituate", () => {
  it("reads none, and a mount buys nothing", async () => {
    await mountHook();
    expect(seen?.status).toBe("none");
    expect(asked.filter((r) => r.url.startsWith("/api/situate/"))).toHaveLength(1);
    expect(jobPosts()).toEqual([]);
  });

  it("reads a dossier with its three freshness facts", async () => {
    stored = { situate: situate(), stale: false, outdated: true, profileChanged: true };
    await mountHook();
    expect([seen?.status, seen?.situate?.kind, seen?.stale, seen?.outdated, seen?.profileChanged]).toEqual([
      "ready",
      "review",
      false,
      true,
      true,
    ]);
    expect(jobPosts()).toEqual([]);
  });

  it("starts the step unforced on the first press, and names it forced on Search again", async () => {
    await mountHook();
    await act(async () => {
      await seen?.ensure();
    });
    expect(jobPosts().map((r) => r.body)).toEqual([{ slug: "a-piece", steps: ["situate"] }]);
    stored = { situate: situate(), stale: false, outdated: false, profileChanged: false };
    await act(async () => {
      await seen?.refresh();
    });
    await act(async () => {
      await seen?.regenerate();
    });
    expect(jobPosts().map((r) => r.body)[1]).toEqual({ slug: "a-piece", steps: ["situate"], force: ["situate"] });
  });

  /* Between the job leaving the queue and the read it sets off landing, the
     section is still working: without that it drew the before-run press for
     one poll (stage 4's browser run). useSituate.ts § `landing`. */
  describe("a run finishing while its read is still out", () => {
    const doneJob = {
      id: "situate-run",
      slug: "a-piece",
      status: "done",
      steps: [{ name: "situate", status: "done" }],
      createdAt: "2026-10-24T10:00:00Z",
    } as Job;

    /** The real hook driving the real section, as Investigate mounts it. */
    function Drawn({ slug = "a-piece" }: { slug?: string }): ReactElement {
      seen = useSituate(slug);
      return panel(seen);
    }

    /** Mount on "none", hold the next read, and announce the job as done through the real engine. */
    async function finishWithTheReadHeld(): Promise<(res: Response) => void> {
      await act(async () => root.render(createElement(Drawn)));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      expect(seen?.status).toBe("none");
      /* The first list is the engine's baseline, not news (jobEngine.ts § `recordCompletions`). */
      await act(async () => jobEngine.receive([]));
      let land!: (res: Response) => void;
      situateReply = new Promise<Response>((resolve) => {
        land = resolve;
      });
      const reads = () => asked.filter((r) => r.url === "/api/situate/a-piece").length;
      const before = reads();
      await act(async () => jobEngine.receive([doneJob]));
      expect(reads(), "the finished job sent a read out").toBe(before + 1);
      return land;
    }

    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

    it("stays starting until the dossier lands, then is ready", async () => {
      const land = await finishWithTheReadHeld();
      expect([seen?.status, seen?.job, seen?.starting]).toEqual(["none", null, true]);
      /* What the section draws in that window: the working line, not the press. */
      expect(text()).toContain(SITUATE_WORKING);
      expect(buttonCalled(SITUATE_RUN)).toBeUndefined();
      expect(text()).not.toContain(SITUATE_DISCLOSURE);

      const body = { situate: situate(), stale: false, outdated: false, profileChanged: false };
      await act(async () => land(new Response(JSON.stringify(body), { status: 200 })));
      await settle();
      expect([seen?.status, seen?.situate?.kind, seen?.starting]).toEqual(["ready", "review", false]);
      expect(text()).not.toContain(SITUATE_WORKING);
      expect(text()).toContain("The report became a reference point.");
    });

    it("lets go of starting when that read fails", async () => {
      const land = await finishWithTheReadHeld();
      expect(seen?.starting).toBe(true);
      await act(async () => land(new Response("no", { status: 500 })));
      await settle();
      expect(seen?.starting).toBe(false);
      expect(seen?.status).toBe("none");
      expect(seen?.error).not.toBeNull();
      expect(text()).not.toContain(SITUATE_WORKING);
    });

    it("does not carry one article's landing onto another or let the old read clear the new one", async () => {
      const landFirst = await finishWithTheReadHeld();
      await act(async () => root.render(createElement(Drawn, { slug: "another-piece" })));
      await settle();
      expect([seen?.slug, seen?.status, seen?.starting]).toEqual(["another-piece", "none", false]);

      let landSecond!: (res: Response) => void;
      otherSituateReply = new Promise<Response>((resolve) => {
        landSecond = resolve;
      });
      const secondJob = { ...doneJob, id: "situate-run-2", slug: "another-piece" };
      await act(async () => jobEngine.receive([secondJob, doneJob]));
      expect(seen?.starting).toBe(true);

      await act(async () => landFirst(new Response(JSON.stringify(null), { status: 200 })));
      await settle();
      expect(seen?.starting, "the old article's read must not clear this one's landing").toBe(true);

      await act(async () => landSecond(new Response(JSON.stringify(null), { status: 200 })));
      await settle();
      expect(seen?.starting).toBe(false);
    });

    it("does not revive an obsolete landing after navigating away and back", async () => {
      const landOld = await finishWithTheReadHeld();
      await act(async () => root.render(createElement(Drawn, { slug: "another-piece" })));
      await settle();

      let landCurrent!: (res: Response) => void;
      situateReply = new Promise<Response>((resolve) => {
        landCurrent = resolve;
      });
      await act(async () => root.render(createElement(Drawn)));
      await act(async () => landCurrent(new Response(JSON.stringify(null), { status: 200 })));
      await settle();
      expect(seen?.starting, "the discarded read no longer belongs to this visit").toBe(false);

      /* Let the discarded request finish too; its finalizer must remain harmless. */
      await act(async () => landOld(new Response(JSON.stringify(null), { status: 200 })));
      await settle();
      expect(seen?.starting).toBe(false);
    });
  });
});
