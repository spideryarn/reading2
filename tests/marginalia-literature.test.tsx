// @vitest-environment jsdom
/**
 * **Marginalia's `literature` kind** — Situate's findings beside their blocks
 * (plan docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md
 * § Marginalia: a `literature` kind; docs/project/marginalia.md).
 *
 * Four claims, each a rule a quiet mistake would break:
 *
 * - **the shut line stamps the strongest finding** — `strong` before
 *   `suggestive`, then the dossier's order of kinds — and counts several;
 * - **a finding is placed only while its quoted words are in its block**;
 * - **opened**, its sources are links that send no referrer and can't reach
 *   back (`noreferrer noopener`), *From the web* says where it came from, and
 *   *Open in Sources* names the finding, so Where it sits can land on it;
 * - **owner only, whatever the experimental switch says** (since 2026-10-26,
 *   spya-pkpqch): the owner's feed reads the stored dossier and starts
 *   nothing, and a stale dossier is not drawn.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, SituateFinding } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "lit-margin";
const trace: string[] = [];
let situateBody: unknown = null;
let experimentalOn = false;

vi.mock("../src/web/useExperimental.js", () => ({
  useExperimental: () => ({ on: experimentalOn, since: null, loaded: true }),
}));

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    trace.push(`${method} ${url}`);
    if (url === "/api/jobs" && method === "GET") return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    if (url.startsWith("/api/situate/")) {
      return situateBody === null
        ? new Response("null", { status: 200 })
        : new Response(JSON.stringify(situateBody), { status: 200 });
    }
    /* The relation words are stored, so opening the column starts nothing
       (tests/marginalia-live-refresh.test.tsx says why). */
    if (url.startsWith("/api/relations/")) {
      return new Response(JSON.stringify({ relations: { relations: {} }, stale: false, outdated: false }), {
        status: 200,
      });
    }
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init) };
});

const { marginaliaNotes, strongestFirst } = await import("../src/web/marginalia/notes.js");
const { MarginNotesSlot, OwnerMarginFeed, literatureShut } = await import(
  "../src/web/marginalia/MarginaliaColumn.js"
);
type MarginFeed = import("../src/web/marginalia/MarginaliaColumn.js").MarginFeed;
type MarginaliaNote = import("../src/web/marginalia/notes.js").MarginaliaNote;
const { jobEngine } = await import("../src/web/jobEngine.js");

const ids = ["spya-aaaaa1", "spya-aaaaa2", "spya-aaaaa3"];
const blocks = ids.map((id, i) => ({
  id,
  text: `Paragraph ${i} says something particular about topic ${i}.`,
  html: "",
  kind: "text",
  gistable: true,
  words: 40,
})) as unknown as Block[];
const say = (i: number) => `something particular about topic ${i}`;

function finding(over: Partial<SituateFinding> & Pick<SituateFinding, "id">): SituateFinding {
  return {
    kind: "since",
    blockId: "spya-aaaaa2",
    quote: say(1),
    note: `Note for ${over.id}.`,
    strength: "strong",
    sources: [{ origin: "web", url: `https://example.org/${over.id}`, title: `Source ${over.id}`, quote: "q" }],
    ...over,
  };
}
const SEARCHED = "2026-10-24T09:00:00.000Z";

describe("strongestFirst — which finding a shut line stamps", () => {
  it("puts strong before suggestive, then the dossier's order of kinds, then the stored order", () => {
    const order = strongestFirst([
      finding({ id: "a", kind: "supported", strength: "strong" }),
      finding({ id: "b", kind: "challenged", strength: "suggestive" }),
      finding({ id: "c", kind: "since", strength: "strong" }),
      finding({ id: "d", kind: "challenged", strength: "strong" }),
      finding({ id: "e", kind: "since", strength: "strong" }),
    ]).map((f) => f.id);
    expect(order).toEqual(["d", "c", "e", "a", "b"]);
  });

  it("sorts a kind or strength from a newer server last rather than throwing", () => {
    const order = strongestFirst([
      finding({ id: "x", kind: "brand-new" as SituateFinding["kind"] }),
      finding({ id: "y", kind: "supported" }),
    ]).map((f) => f.id);
    expect(order).toEqual(["y", "x"]);
  });
});

describe("marginaliaNotes, Situate's findings", () => {
  it("places a finding beside its block, strongest first, in one line per block", () => {
    const notes = marginaliaNotes(null, blocks, null, {
      literature: {
        findings: [
          finding({ id: "weak", kind: "challenged", strength: "suggestive" }),
          finding({ id: "strong", kind: "supported" }),
        ],
        searchedAt: SEARCHED,
      },
    });
    const here = notes.get("spya-aaaaa2") ?? [];
    expect(here).toHaveLength(1);
    expect(here[0]?.kind === "literature" && here[0].items.map((i) => i.finding.id)).toEqual(["strong", "weak"]);
    expect(here[0]?.kind === "literature" && here[0].items[0]?.searchedAt).toBe(SEARCHED);
  });

  it("leaves out a finding whose quoted words are no longer in its block, or whose block is gone", () => {
    const notes = marginaliaNotes(null, blocks, null, {
      literature: {
        findings: [
          finding({ id: "moved", blockId: "spya-aaaaa2", quote: "words this block never said" }),
          finding({ id: "gone", blockId: "spya-zzzzzz", quote: say(1) }),
          finding({ id: "kept", blockId: "spya-aaaaa3", quote: say(2) }),
        ],
        searchedAt: SEARCHED,
      },
    });
    expect([...notes.keys()]).toEqual(["spya-aaaaa3"]);
  });

  it("draws nothing without findings — a visitor's margin is never handed any", () => {
    expect(marginaliaNotes(null, blocks, null, { literature: null }).size).toBe(0);
    expect(marginaliaNotes(null, blocks, null, {}).size).toBe(0);
  });

  it("sits after Others say and before Cites on its block", () => {
    const kinds = (
      marginaliaNotes(null, blocks, null, {
        literature: { findings: [finding({ id: "f" })], searchedAt: SEARCHED },
        citations: [{ id: "c", title: "W", why: "w", citedAt: ["spya-aaaaa2"], mentions: [] }] as never,
        claims: [{ url: "u", blockId: "spya-aaaaa2", claimQuote: say(1), relation: "disputes" }] as never,
      }).get("spya-aaaaa2") ?? []
    ).map((n) => n.kind);
    expect(kinds).toEqual(["reception", "literature", "citation"]);
  });
});

describe("literatureShut — the shut line's words", () => {
  it("is the lone finding's stamp and note, in the model's face", () => {
    expect(literatureShut([{ finding: finding({ id: "a", kind: "challenged", note: "Later work disputes it." }) }])).toEqual({
      stamp: "Challenged",
      line: "Later work disputes it.",
      lineVoice: "ai",
    });
  });

  it("counts several under the strongest's stamp, in ours", () => {
    expect(
      literatureShut([{ finding: finding({ id: "a", kind: "missing" }) }, { finding: finding({ id: "b" }) }]),
    ).toEqual({ stamp: "Not cited?", line: "2 from the literature", lineVoice: "ui" });
  });
});

/* ---------------------------------------------------------------- drawn -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  trace.length = 0;
  situateBody = null;
  experimentalOn = false;
  jobEngine.reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
});

function draw(notes: MarginaliaNote[], onOpenFinding?: (id: string) => void): void {
  act(() =>
    root.render(
      createElement(MarginNotesSlot, { blockId: "spya-aaaaa2", notes, viewer: "owner", onOpenFinding }),
    ),
  );
}

describe("the literature line, drawn", () => {
  const two: MarginaliaNote = {
    kind: "literature",
    items: [
      { finding: finding({ id: "f1", kind: "challenged", note: "A 2025 study found little ignition." }), searchedAt: SEARCHED },
      {
        finding: finding({
          id: "f2",
          strength: "suggestive",
          sources: [
            { origin: "web", url: "https://www.nature.com/x", title: "", quote: "q" },
            { origin: "citer", url: "https://pmc.example/y", title: "A later paper", quote: "q", year: 2025 },
          ],
        }),
        searchedAt: SEARCHED,
      },
    ],
  };

  it("is shut on the strongest's stamp and a count, and says what it is and when on hover", () => {
    draw([two]);
    const button = host.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(button?.textContent).toContain("Challenged");
    expect(button?.textContent).toContain("2 from the literature");
    expect(button?.getAttribute("data-marg-tip")).toBe("literature");
    expect(button?.getAttribute("data-marg-when")).toMatch(/2026/);
    expect(host.textContent).not.toContain("A 2025 study");
  });

  it("opens to each note in the model's face, its sources as safe links, and From the web", () => {
    draw([two]);
    act(() => host.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    const note = [...host.querySelectorAll(".marg-open .voice-ai")].map((n) => n.textContent);
    expect(note).toContain("A 2025 study found little ignition.");
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".marg-open a")];
    expect(links.map((a) => a.textContent)).toEqual(["Source f1", "nature.com", "A later paper"]);
    for (const a of links) {
      expect(a.rel).toContain("noreferrer");
      expect(a.rel).toContain("noopener");
      expect(a.target).toBe("_blank");
    }
    expect(host.textContent).toContain("From the web");
    expect(host.textContent).toContain("From the web · suggestive");
  });

  it("draws a model's markup as text, never as HTML", () => {
    draw([
      {
        kind: "literature",
        items: [{ finding: finding({ id: "f9", note: "<img src=x onerror=alert(1)>" }), searchedAt: SEARCHED }],
      },
    ]);
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("never makes a stored non-web source address into a link", () => {
    draw([
      {
        kind: "literature",
        items: [
          {
            finding: finding({
              id: "unsafe",
              sources: [
                {
                  origin: "web",
                  url: "javascript:alert(1)",
                  title: "A stored source",
                  quote: "q",
                },
              ],
            }),
            searchedAt: SEARCHED,
          },
        ],
      },
    ]);
    act(() => host.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    expect(host.querySelector(".marg-literature-sources a")).toBeNull();
    expect(host.querySelector(".marg-literature-sources")?.textContent).toContain("A stored source");
  });

  it("Open in Sources names the finding it was pressed on", () => {
    const opened: string[] = [];
    draw([two], (id) => opened.push(id));
    act(() => host.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    const presses = [...host.querySelectorAll<HTMLButtonElement>(".marg-literature-open")];
    expect(presses).toHaveLength(2);
    act(() => presses[1]?.click());
    expect(opened).toEqual(["f2"]);
  });

  it("has no Open in Sources without a sender", () => {
    draw([two]);
    act(() => host.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    expect(host.querySelector(".marg-literature-open")).toBeNull();
  });
});

/* ----------------------------------------------------------- the feed -- */

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let feed: MarginFeed | null = null;
const onFeed = (next: MarginFeed) => {
  feed = next;
};
async function openMargin(): Promise<void> {
  await act(async () => root.render(createElement(OwnerMarginFeed, { slug: SLUG, bibliography: { status: "ready", retryRead: async () => {} }, shown: true, onFeed })));
  await settle();
}
const situateReads = () => trace.filter((l) => l === `GET /api/situate/${SLUG}`).length;
const dossier = (stale: boolean) => ({
  situate: {
    generatedAt: SEARCHED,
    outcome: "read",
    findings: [finding({ id: "f1" })],
  },
  stale,
  outdated: false,
  profileChanged: false,
});

describe("the owner's feed", () => {
  /* **Not behind the switch since 2026-10-26** (spya-pkpqch): Greg asked for
     what Where it sits found to show in the margin as he reads, and the
     dossier itself left the switch on 2026-10-25 (plan 261025h). */
  it("with the switch off, reads the dossier, hands on its findings and starts nothing", async () => {
    situateBody = dossier(false);
    await openMargin();
    expect(situateReads()).toBe(1);
    expect(feed?.literature?.findings.map((f) => f.id)).toEqual(["f1"]);
    expect(feed?.literature?.searchedAt).toBe(SEARCHED);
    expect(trace.filter((l) => l.startsWith("POST "))).toEqual([]);
  });

  it("with the switch on, the same", async () => {
    experimentalOn = true;
    situateBody = dossier(false);
    await openMargin();
    expect(situateReads()).toBe(1);
    expect(feed?.literature?.findings.map((f) => f.id)).toEqual(["f1"]);
    expect(trace.filter((l) => l.startsWith("POST "))).toEqual([]);
  });

  it("does not hand on a stale dossier", async () => {
    situateBody = dossier(true);
    await openMargin();
    expect(situateReads()).toBe(1);
    expect(feed?.literature ?? null).toBeNull();
  });

  it("hands on nothing when no search has run", async () => {
    situateBody = null;
    await openMargin();
    expect(feed?.literature ?? null).toBeNull();
    expect(trace.filter((l) => l.startsWith("POST "))).toEqual([]);
  });
});
