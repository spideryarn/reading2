// @vitest-environment jsdom
/**
 * **Criteria's starters wait for a criterion of the referee's own** — plan
 * docs/plans/261011g-referee-claims-become-promises-and-starter-criteria-wait-for-the-referee-own.md
 * § Part 2, from Greg's answer to q-fkq30v (4A): offer starters only after the
 * reviewer has written one criterion of their own, so we do not anchor them.
 *
 * Until 2026-10-11 the form's presets were drawn on an empty band, which is
 * what the first test here was red against.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId } from "../src/types.js";

let answer: (url: string, init: RequestInit) => Promise<Response> = () =>
  Promise.resolve(json({ criteria: [] }));
const calls: { url: string; method: string }[] = [];

/* `apiFetch` and `fetchOk` both, for the reason tests/referee-criteria-panel.test.tsx gives. */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    return answer(url, init);
  };
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { CriteriaBand, STARTER_GROUPS, STARTERS_WAIT } = await import("../src/web/CriteriaPanel.js");

const BLOCK = "spya-k3m9qt" as BlockId;
const SLUG = "a-paper";
const BLOCKS: Block[] = [
  {
    id: BLOCK,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
];

const OWN = {
  id: "spya-crt2aa",
  criterion: "Is the exposure measured the same way in both arms?",
  config: { kind: "single" },
  createdAt: "2026-10-11T09:00:00.000Z",
  status: "done",
  results: [],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  answer = () => Promise.resolve(json({ criteria: [] }));
  calls.length = 0;
  history.replaceState(null, "", `/read/${SLUG}`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function paint(): void {
  act(() => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(CriteriaBand, {
          slug: SLUG,
          blocks: BLOCKS,
          comments: [],
          onJump: () => {},
          onFound: () => {},
          openKey: null,
          onOpenKey: () => {},
        }),
      ),
    );
  });
}

const starters = () => [...host.querySelectorAll(".crit-preset")];
const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("Criteria's starters", () => {
  it("draws no starter before the referee has a criterion of their own, and says why", async () => {
    paint();
    await flush();
    expect(starters(), "a starter is on screen before the referee wrote anything").toHaveLength(0);
    expect(flat(host.querySelector(".crit-starters-wait")?.textContent)).toBe(STARTERS_WAIT);
  });

  it("draws neither starters nor the wait line while the saved list is still out", async () => {
    answer = () => new Promise(() => {});
    paint();
    await flush();
    expect(starters()).toHaveLength(0);
    expect(host.querySelector(".crit-starters-wait")).toBeNull();
  });

  it("draws both groups, headed, once one criterion is saved", async () => {
    answer = () => Promise.resolve(json({ criteria: [OWN] }));
    paint();
    await flush();
    expect(host.querySelector(".crit-starters-wait")).toBeNull();
    const headings = [...host.querySelectorAll(".crit-starter-heading")].map((h) => flat(h.firstChild?.textContent));
    expect(headings).toEqual(STARTER_GROUPS.map((g) => g.heading));
    expect(headings).toContain("Worth a second look");
    const labels = starters().map((b) => flat(b.textContent));
    expect(labels).toEqual(STARTER_GROUPS.flatMap((g) => g.starters.map((s) => s.label)));
  });

  it("fills the form from a second-look starter and runs nothing", async () => {
    answer = () => Promise.resolve(json({ criteria: [OWN] }));
    paint();
    await flush();
    const conclusions = starters().find((b) => flat(b.textContent) === "Conclusions");
    expect(conclusions, "the Conclusions starter is not drawn").toBeDefined();
    const before = calls.length;
    act(() => (conclusions as HTMLButtonElement).click());
    await flush();
    const box = host.querySelector<HTMLTextAreaElement>("#crit-text");
    expect(box?.value).toMatch(/^Do the conclusions follow from the results/);
    expect(host.querySelector<HTMLInputElement>("#crit-against")?.value).toBe("goes further than the results");
    expect(calls.slice(before).filter((c) => c.method !== "GET"), "a starter ran something").toEqual([]);
  });

  /* A latch (GPT Sol's plan review, F3): deleting the criterion cannot undo
     the anchoring the starters were held back to avoid, so they stay. */
  it("keeps the starters once unlocked, after the last criterion is deleted", async () => {
    answer = (_url, init) =>
      Promise.resolve(
        (init.method ?? "GET") === "DELETE" ? json({ ok: true }) : json({ criteria: [OWN] }),
      );
    paint();
    await flush();
    expect(starters().length).toBeGreaterThan(0);
    const del = host.querySelector<HTMLButtonElement>(".crit-del");
    expect(del, "the saved row draws no delete").not.toBeNull();
    act(() => (del as HTMLButtonElement).click());
    await flush();
    expect(host.querySelector(".crit-del"), "the row was not deleted").toBeNull();
    expect(starters().length, "the starters flickered off with the row").toBeGreaterThan(0);
  });
});
