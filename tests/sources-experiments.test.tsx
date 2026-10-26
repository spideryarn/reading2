// @vitest-environment jsdom
/**
 * **Sources' two experiments, Guess first and Evidence first**
 * (SourcesExperiments.tsx) — plan
 * docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md
 * § Stage 4 (GPT Sol's F12 and F13).
 *
 * - *Reveal* hides the search's reading until pressed, and shows it after.
 * - Each passage takes the reader's guess or reading first, a radio in the
 *   house's part-switcher, and its reveal sets that beside the search's kind
 *   in plain words, marking nothing right or wrong.
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
  evidenceLine,
  EXPERIMENT_GO_SEARCH,
  EXPERIMENT_NO_DOSSIER,
  EXPERIMENT_NO_FINDINGS,
  type ExperimentRead,
  GUESS_CHOICE_LABEL,
  GUESS_CHOICES,
  GUESS_HIDE_ALL,
  GUESS_OF_KIND,
  GUESS_REVEAL,
  GUESS_REVEAL_ALL,
  guessLine,
  SourcesExperimentPanel,
} from "../src/web/SourcesExperiments.js";
import { SITUATE_FINDING_KINDS } from "../src/types.js";
import { SITUATE_FINDING_LABEL } from "../src/web/situate-dossier.js";
import { subModesOf } from "../src/web/sub-modes.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const moved: SourcesView[] = [];
/** Every request the panels made, of any method. There should be none. */
const requests: string[] = [];
const stored: string[] = [];
const addressWrites: string[] = [];

beforeEach(() => {
  moved.length = 0;
  requests.length = 0;
  stored.length = 0;
  addressWrites.length = 0;
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
    stored.push(`storage:${key}`);
  });
  /* `setItem` is the app's ordinary storage path, but it is not the only
     browser persistence sink. An injected cookie write passed the old test
     while making the experiment's promise false. */
  vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
    stored.push(`cookie:${value}`);
  });
  /* The final address alone is not evidence: code could write a choice and
     remove it again during the same press. Refuse every history write. */
  vi.spyOn(history, "pushState").mockImplementation((_data: unknown, _unused: string, url?: string | URL | null) => {
    addressWrites.push(`push:${String(url)}`);
  });
  vi.spyOn(history, "replaceState").mockImplementation((_data: unknown, _unused: string, url?: string | URL | null) => {
    addressWrites.push(`replace:${String(url)}`);
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

/** A row's radio by its words (the part-switcher as a radio group, SourcesExperiments.tsx § `ChoiceBar`). */
const radio = (row: Element | undefined, words: string) =>
  [...(row?.querySelectorAll<HTMLButtonElement>('[role="radiogroup"] [role="radio"]') ?? [])].find((b) => b.textContent === words);
const rowsOf = (cls: string) => [...host.querySelectorAll<HTMLElement>(cls)];

describe("Guess first", () => {
  const hidden = () => {
    expect(text()).not.toContain(CHALLENGED_NOTE);
    expect(text()).not.toContain(SUPPORTED_NOTE);
    expect(text()).not.toContain("Source si-000000000001");
    expect(host.querySelector("[data-situate-kind]")).toBeNull();
  };

  it("shows the passages and hides every kind, note and source until Reveal them all, then shows them, then hides them again", () => {
    draw("guess-first");
    expect(text()).toContain("The effect is large and robust");
    expect(text()).toContain("Sleep helps memory");
    expect(text()).toMatch(/what do you think critics, supporters and later work said/i);
    hidden();
    act(() => button(GUESS_REVEAL_ALL)?.click());
    expect(text()).toContain(CHALLENGED_NOTE);
    expect(text()).toContain(SUPPORTED_NOTE);
    expect(host.querySelector('[data-situate-kind="challenged"]')).not.toBeNull();
    expect(text()).toContain("Source si-000000000001");
    act(() => button(GUESS_HIDE_ALL)?.click());
    hidden();
  });

  /* A persona review, 2026-10-26: with nothing to commit to, readers skipped
     straight to Reveal. A guess per passage, from words mapped onto the
     dossier's kinds, and a reveal per passage that sets it beside the search's. */
  it("takes a guess per passage, and that passage's Reveal shows it beside what the search found", () => {
    draw("guess-first");
    const rows = rowsOf(".experiment-guess-row");
    expect(rows).toHaveLength(2);
    const options = [...(rows[0]?.querySelectorAll('[role="radio"]') ?? [])].map((b) => b.textContent);
    expect(options).toEqual(GUESS_CHOICES.map((c) => GUESS_CHOICE_LABEL[c]));
    const supported = radio(rows[0], GUESS_CHOICE_LABEL.supported);
    act(() => supported?.click());
    expect(supported?.getAttribute("aria-checked")).toBe("true");
    expect(supported?.classList.contains("on")).toBe(true);
    act(() => [...(rows[0]?.querySelectorAll("button") ?? [])].find((b) => b.textContent === GUESS_REVEAL)?.click());
    expect(rows[0]?.textContent).toContain("You guessed Supported · the search found Challenged");
    expect(rows[0]?.textContent).toContain(CHALLENGED_NOTE);
    expect(supported?.disabled, "the guess is locked once revealed").toBe(true);
    /* The other passage is still hidden, and with no guess says only the search's half. */
    expect(rows[1]?.textContent).not.toContain(SUPPORTED_NOTE);
    act(() => [...(rows[1]?.querySelectorAll("button") ?? [])].find((b) => b.textContent === GUESS_REVEAL)?.click());
    expect(rows[1]?.textContent).toContain("The search found Supported");
    /* Both open now, so the foot offers to hide them. */
    expect(button(GUESS_HIDE_ALL)).toBeDefined();
  });

  it("maps every kind of the dossier onto one of the guesses", () => {
    for (const kind of SITUATE_FINDING_KINDS) expect(GUESS_CHOICES).toContain(GUESS_OF_KIND[kind]);
    expect(guessLine(null, "since")).toBe(`The search found ${SITUATE_FINDING_LABEL.since}`);
  });

  it("draws the passage in the author's face, as the link to it with no block id, and the note in the model's", () => {
    draw("guess-first");
    act(() => button(GUESS_REVEAL_ALL)?.click());
    const quote = host.querySelector(".rcp-group-quote");
    expect(quote?.textContent).toContain("The effect is large and robust");
    expect(quote?.querySelector("a.block-ref")?.textContent).toMatch(/^“.+”$/);
    expect(text()).not.toContain("aaaaaa");
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
    const rows = rowsOf(".experiment-evidence-row");
    expect(rows).toHaveLength(2);
    /* The reader's choice first: a radio in the house's part-switcher, chosen visibly, and locked once revealed. */
    const options = [...(rows[0]?.querySelectorAll('.summ-views[role="radiogroup"] .summ-view-btn') ?? [])].map((b) => b.textContent);
    expect(options).toEqual(["Supports it", "Challenges it", "Adds to it"]);
    const challenges = radio(rows[0], "Challenges it");
    act(() => challenges?.click());
    expect(challenges?.getAttribute("aria-checked")).toBe("true");
    expect(challenges?.classList.contains("on")).toBe(true);
    /* Reveal is a real button: the house's shadcn Button. */
    const reveal = rows[0]?.querySelector<HTMLButtonElement>(".experiment-reveal");
    expect(reveal?.getAttribute("data-slot")).toBe("button");
    act(() => reveal?.click());
    expect(rows[0]?.textContent).toContain("You said Challenges it; the search read it as Challenged");
    expect(rows[0]?.textContent).toContain(CHALLENGED_NOTE);
    expect(challenges?.disabled).toBe(true);
    /* No right or wrong mark: the six kinds do not map onto three words. */
    expect(rows[0]?.textContent).not.toMatch(/correct|right|wrong|✓|✗/i);
    /* The other finding is still hidden. */
    expect(rows[1]?.textContent).not.toContain(SUPPORTED_NOTE);
    expect(button(EVIDENCE_REVEAL)).toBeDefined();
    expect(evidenceLine(null, "supported")).toBe("The search read it as Supported");
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
    for (const b of [...host.querySelectorAll<HTMLButtonElement>('.experiment-guess-row [role="radio"]')]) act(() => b.click());
    for (const b of [...host.querySelectorAll<HTMLButtonElement>(".experiment-guess-row .experiment-reveal")]) act(() => b.click());
    act(() => button(GUESS_HIDE_ALL)?.click());
    act(() => button(GUESS_REVEAL_ALL)?.click());
    expect(host.querySelectorAll(".experiment-guess-row [data-situate-kind]"), "the presses did reveal").toHaveLength(2);
    draw("evidence-first");
    for (const b of [...host.querySelectorAll<HTMLButtonElement>('.experiment-evidence-row [role="radio"]')]) act(() => b.click());
    for (const b of [...host.querySelectorAll<HTMLButtonElement>(".experiment-reveal")]) act(() => b.click());
    expect(host.querySelectorAll(".experiment-evidence-row [data-situate-kind]"), "the presses did reveal").toHaveLength(2);
    expect(requests).toEqual([]);
    expect(stored).toEqual([]);
    expect(addressWrites).toEqual([]);
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
