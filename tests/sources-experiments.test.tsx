// @vitest-environment jsdom
/**
 * **Sources' two experiments, Guess first and Evidence first**
 * (SourcesExperiments.tsx) — plan
 * docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md
 * § Stage 4 (GPT Sol's F12 and F13).
 *
 * - *Reveal* hides the search's reading until pressed, and shows it after.
 * - With no dossier, each says so and points at *Search the literature* with a
 *   plain move: nothing starts.
 * - Nothing the reader does is sent or kept: the fetch double and the
 *   browser's storage see nothing through a whole session of presses.
 * - A visitor never gets one, and neither has a command-bar row.
 *
 * The band mounted in the whole app, with the switch on and off, is
 * tests/reception-lens-in-chat.test.tsx § The experiments.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourcesHead } from "./helpers/sources-head.js";
import type { Situate, SituateFinding } from "../src/types.js";
import { pendingActivation, resetActivations } from "../src/web/activation.js";
import { SOURCES_EXPERIMENTS, type SourcesExperiment, type SourcesView, visitorSourcesView } from "../src/web/params.js";
import {
  EVIDENCE_REVEAL,
  EXPERIMENT_GO_SEARCH,
  EXPERIMENT_NO_DOSSIER,
  EXPERIMENT_NO_FINDINGS,
  type ExperimentRead,
  GUESS_HIDE,
  GUESS_REVEAL,
  SourcesExperimentPanel,
} from "../src/web/SourcesExperiments.js";
import { SITUATE_FINDING_LABEL } from "../src/web/situate-dossier.js";
import { subModesOf } from "../src/web/sub-modes.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const moved: SourcesView[] = [];
/** Every request the panels made, of any method. There should be none. */
const requests: string[] = [];
const stored: string[] = [];

beforeEach(() => {
  moved.length = 0;
  requests.length = 0;
  stored.length = 0;
  resetActivations();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${String(input)}`);
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  /* The prototype the page's storage really has: the bare `Storage` global is
     Node's under jsdom, and a spy on it never fires (tests/fleet-drafts.test.tsx).
     `window.sessionStorage`, because jsdom's `localStorage` reads undefined
     here; the two share the prototype in a browser. */
  vi.spyOn(Object.getPrototypeOf(window.sessionStorage) as Storage, "setItem").mockImplementation((key: string) => {
    stored.push(key);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetActivations();
});

const CHALLENGED_NOTE = "A 2020 replication found the effect does not survive.";
const SUPPORTED_NOTE = "Two later trials bear this out.";

function finding(id: string, kind: SituateFinding["kind"], quote: string, note: string, sourceQuote: string): SituateFinding {
  return {
    id,
    kind,
    blockId: "spya-aaaaaa" as SituateFinding["blockId"],
    quote,
    note,
    strength: "strong",
    sources: [{ origin: "web", url: `https://example.org/${id}`, title: `Source ${id}`, quote: sourceQuote }],
  };
}

const FINDINGS = [
  finding("si-000000000001", "challenged", "The effect is large and robust", CHALLENGED_NOTE, "the effect did not replicate in a larger sample"),
  finding("si-000000000002", "supported", "Sleep helps memory", SUPPORTED_NOTE, "sleep improved recall in both trials"),
];

function dossier(findings: SituateFinding[] = FINDINGS): Situate {
  return {
    version: "situate/2",
    generator: "a-model",
    slug: "a-piece",
    sourceHash: "hash",
    profileHash: null,
    generatedAt: "2026-10-24T10:00:00.000Z",
    elapsedMs: 1,
    kind: "empirical",
    year: 2008,
    angle: "since",
    outcome: findings.length > 0 ? "read" : "nothing-found",
    overview: "It is still argued over.",
    findings,
    questions: [],
    searched: { queries: [], pages: 0, citers: 0, cited: 0 },
    counts: {
      written: findings.length, kept: findings.length, malformed: 0, unknownBlock: 0, unquoted: 0, unknownSource: 0,
      sourceUnquoted: 0, noSource: 0, citationRule: 0, perBlock: 0, overCap: 0, duplicate: 0, queriesRefused: 0,
    },
  } as Situate;
}

function read(situate: Situate | null): ExperimentRead {
  return { status: situate === null ? "none" : "ready", situate, stale: false, error: null, retryRead: async () => {} };
}

function draw(experiment: SourcesExperiment, situate: Situate | null = dossier()): void {
  act(() =>
    root.render(
      createElement(SourcesExperimentPanel, {
        experiment,
        head: sourcesHead({ view: experiment, onView: (v) => moved.push(v), ownerSlug: "a-piece" }),
        read: read(situate),
        onJump: () => {},
        onView: (v) => moved.push(v),
      }),
    ),
  );
}
const text = () => (host.textContent ?? "").replace(/\s+/g, " ");
const button = (words: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim().startsWith(words));

describe("Guess first", () => {
  it("shows the passages and hides every kind, note and source until Reveal, then shows them, then hides them again", () => {
    draw("guess-first");
    expect(text()).toContain("The effect is large and robust");
    expect(text()).toContain("Sleep helps memory");
    expect(text()).toMatch(/what do you think critics, supporters and later work said/i);
    const hidden = () => {
      expect(text()).not.toContain(CHALLENGED_NOTE);
      expect(text()).not.toContain(SUPPORTED_NOTE);
      expect(text()).not.toContain(SITUATE_FINDING_LABEL.challenged);
      expect(text()).not.toContain(SITUATE_FINDING_LABEL.supported);
      expect(text()).not.toContain("Source si-000000000001");
      expect(host.querySelector("[data-situate-kind]")).toBeNull();
    };
    hidden();
    act(() => button(GUESS_REVEAL)?.click());
    expect(text()).toContain(CHALLENGED_NOTE);
    expect(text()).toContain(SUPPORTED_NOTE);
    expect(text()).toContain(SITUATE_FINDING_LABEL.challenged);
    expect(text()).toContain("Source si-000000000001");
    act(() => button(GUESS_HIDE)?.click());
    hidden();
  });

  it("draws the passage in the author's face and the note in the model's", () => {
    draw("guess-first");
    act(() => button(GUESS_REVEAL)?.click());
    expect(host.querySelector(".rcp-group-quote")?.textContent).toContain("The effect is large and robust");
    expect(host.querySelector(".situate-note")?.classList.contains("voice-ai")).toBe(true);
  });
});

describe("Evidence first", () => {
  it("shows each passage beside its source's quote, with the kind and note hidden until that finding's Reveal", () => {
    draw("evidence-first");
    expect(text()).toContain("The effect is large and robust");
    expect(text()).toContain("the effect did not replicate in a larger sample");
    expect(text()).not.toContain(CHALLENGED_NOTE);
    expect(host.querySelector("[data-situate-kind]")).toBeNull();
    const rows = [...host.querySelectorAll<HTMLElement>(".experiment-evidence-row")];
    expect(rows).toHaveLength(2);
    /* The reader's choice first: local, pressed, and locked once revealed. */
    const challenges = [...(rows[0]?.querySelectorAll<HTMLButtonElement>(".gloss-sort-btn") ?? [])].find(
      (b) => b.textContent === "Challenges",
    );
    act(() => challenges?.click());
    expect(challenges?.getAttribute("aria-pressed")).toBe("true");
    act(() => rows[0]?.querySelector<HTMLButtonElement>(".experiment-reveal")?.click());
    expect(rows[0]?.textContent).toContain(CHALLENGED_NOTE);
    expect(rows[0]?.textContent).toContain(SITUATE_FINDING_LABEL.challenged);
    expect(challenges?.disabled).toBe(true);
    /* The other finding is still hidden. */
    expect(rows[1]?.textContent).not.toContain(SUPPORTED_NOTE);
    expect(button(EVIDENCE_REVEAL)).toBeDefined();
  });
});

describe("what they cost and keep", () => {
  it.each(SOURCES_EXPERIMENTS.map((e) => [e]))("%s with no dossier says so, points at Search the literature, and starts nothing", (experiment) => {
    draw(experiment, null);
    expect(text()).toContain(EXPERIMENT_NO_DOSSIER);
    act(() => button(EXPERIMENT_GO_SEARCH)?.click());
    expect(moved).toEqual(["where"]);
    expect(requests).toEqual([]);
    for (const target of ["bibliography", "reception", "sources-claims"] as const) {
      expect(pendingActivation("a-piece", target), target).toBeNull();
    }
  });

  it.each(SOURCES_EXPERIMENTS.map((e) => [e]))("%s says so when the search found nothing", (experiment) => {
    draw(experiment, dossier([]));
    expect(text()).toContain(EXPERIMENT_NO_FINDINGS);
  });

  it("sends nothing and stores nothing through every press in both", () => {
    draw("guess-first");
    act(() => button(GUESS_REVEAL)?.click());
    act(() => button(GUESS_HIDE)?.click());
    draw("evidence-first");
    for (const b of [...host.querySelectorAll<HTMLButtonElement>(".experiment-evidence-row .gloss-sort-btn")]) act(() => b.click());
    for (const b of [...host.querySelectorAll<HTMLButtonElement>(".experiment-reveal")]) act(() => b.click());
    expect(requests).toEqual([]);
    expect(stored).toEqual([]);
    expect(location.search).toBe("");
  });
});

describe("who reaches them", () => {
  it("gives a visitor Bibliography for either, and has no command-bar row for either", () => {
    for (const experiment of SOURCES_EXPERIMENTS) expect(visitorSourcesView(experiment)).toBe("bibliography");
    const rows = subModesOf("sources").map((sub) => sub.view);
    for (const experiment of SOURCES_EXPERIMENTS) expect(rows).not.toContain(experiment);
  });
});
