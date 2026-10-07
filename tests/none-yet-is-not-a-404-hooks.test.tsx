// @vitest-environment jsdom
/**
 * **The three always-mounted reads ask for `200 null`, and read it as "none
 * yet"** — `useQuizRead`, `useCitationsRead`, `useCrossrefs`.
 * docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md § Stage 1.
 *
 * 1. Each sends the opt-in header on its GET.
 * 2. A `200` with a `null` body is the same state a 404 was: Quiz and
 *    Citations offer their button (`status: "none"`), the prose draws no
 *    underlines.
 * 3. **A 404 still is**, for the minutes of a deploy when the new client meets
 *    the old server.
 *
 * **And the other seven since** — Simple, Ideas, FAQ, Timeline, Debate,
 * Glossary, Quotes: the same three, and two more that the first three's review
 * found (docs/postmortems/261006k-a-null-sentinel-is-widened-by-a-truthiness-check.md):
 *
 * 4. **Only `null` is "none yet".** `false`, `0` and `""` are a broken reply.
 * 5. **A reply without its artefact does not replace one already on screen.**
 *
 * docs/plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md.
 *
 * The route's half is tests/none-yet-is-not-a-404-route.test.ts. Harness after
 * tests/always-mounted-reads-refresh.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flat } from "./helpers/ideas-read-fields.js";
import { NONE_YET_AS_NULL_HEADER } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "none-yet";

interface Asked {
  url: string;
  header: string | null;
}
const asked: Asked[] = [];
let answer: () => Response;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    if (url === "/api/jobs") return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    asked.push({ url, header: new Headers(init?.headers).get(NONE_YET_AS_NULL_HEADER) });
    return answer();
  };
  return { ...real, apiFetch, fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init) };
});

const { useQuizRead } = await import("../src/web/useQuiz.js");
const { useCitationsRead } = await import("../src/web/useCitations.js");
const { useCrossrefs } = await import("../src/web/useCrossrefs.js");
const { useSimple } = await import("../src/web/useSimple.js");
/* `useIdeas` keeps its read as one value (src/web/read-state.ts); `flat` puts
   the fields this file reads by name beside it. tests/helpers/ideas-read-fields.ts. */
const { useIdeasRead: useIdeasReadAsItIs } = await import("../src/web/useIdeas.js");
const useIdeasRead = (slug: string) => flat(useIdeasReadAsItIs(slug));
const { useFaqRead } = await import("../src/web/useFaq.js");
const { useTimelineRead } = await import("../src/web/useTimeline.js");
const { useDebateRead } = await import("../src/web/useDebate.js");
const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { useQuotesRead } = await import("../src/web/useQuotes.js");

const nullBody = () =>
  new Response("null", { status: 200, headers: { "content-type": "application/json" } });
const notFound = () => new Response(JSON.stringify({ error: "none" }), { status: 404 });

let host: HTMLDivElement;
let root: Root;
let seen: unknown;

function Probe({ use, slug = SLUG }: { use: (slug: string) => unknown; slug?: string }) {
  seen = use(slug);
  return null;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(use: (slug: string) => unknown): Promise<void> {
  await act(async () => root.render(createElement(Probe, { use })));
  await settle();
}

beforeEach(() => {
  asked.length = 0;
  seen = undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const ANSWERS = [
  ["a 200 null", nullBody],
  ["a 404, from a server that has not heard of the header", notFound],
] as const;

describe.each(ANSWERS)("%s is none yet", (_name, reply) => {
  beforeEach(() => {
    answer = reply;
  });

  it("quiz: the panel's button, not an error", async () => {
    await mount(useQuizRead);
    expect(asked).toEqual([{ url: `/api/quiz/${SLUG}`, header: "1" }]);
    const read = seen as { status: string; quiz: unknown; error: unknown };
    expect({ status: read.status, quiz: read.quiz, error: read.error }).toEqual({
      status: "none",
      quiz: null,
      error: null,
    });
  });

  it("citations: the panel's button, not an error", async () => {
    await mount(useCitationsRead);
    expect(asked).toEqual([{ url: `/api/citations/${SLUG}`, header: "1" }]);
    const read = seen as { status: string; citations: unknown; error: unknown };
    expect({ status: read.status, citations: read.citations, error: read.error }).toEqual({
      status: "none",
      citations: null,
      error: null,
    });
  });

  it("crossrefs: no underlines", async () => {
    await mount(useCrossrefs);
    expect(asked).toEqual([{ url: `/api/crossrefs/${SLUG}`, header: "1" }]);
    expect(seen).toBeNull();
  });
});

const READERS = [
  ["quiz", useQuizRead, { quiz: { batchId: "batch", slug: SLUG, questions: [] }, stale: false, outdated: false, profileChanged: false, attempts: [] }],
  ["citations", useCitationsRead, { citations: { slug: SLUG, citations: [] }, stale: false, outdated: false }],
] as const;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe.each(READERS)("%s reads distinguish absence from a broken reply", (kind, use, body) => {
  const artefact = (body as Record<string, unknown>)[kind];
  it("accepts a real response", async () => {
    answer = () => json(body);
    await mount(use);
    expect(seen).toMatchObject({ status: "ready", error: null, [kind]: artefact });
  });

  for (const malformed of [false, 0, "", {}, { [kind]: null }]) {
    it(`reports ${JSON.stringify(malformed)} as a failed opening read`, async () => {
      answer = () => json(malformed);
      await mount(use);
      expect(seen).toMatchObject({ status: "error", [kind]: null });
      expect((seen as { error: unknown }).error).toBeTruthy();
    });

    it(`keeps a real response when revalidation returns ${JSON.stringify(malformed)}`, async () => {
      answer = () => json(body);
      await mount(use);
      answer = () => json(malformed);
      await act(async () => (seen as { refresh(): Promise<void> }).refresh());
      await settle();
      expect(seen).toMatchObject({ status: "ready", [kind]: artefact });
      expect((seen as { error: unknown }).error).toBeTruthy();
    });
  }
});

it("crossrefs draws the real response's fresh links", async () => {
  const links = [{ from: "spya-k3m9qt", to: "spya-p7w2dn", phrase: "see below" }];
  answer = () => json({ crossrefs: { slug: SLUG, links }, stale: false, outdated: false });
  await mount(useCrossrefs);
  expect(seen).toEqual(links);
});

it.each([false, 0, "", {}, { crossrefs: null }])("crossrefs draws nothing for a malformed body %j", async (body) => {
  answer = () => json(body);
  await mount(useCrossrefs);
  expect(seen).toBeNull();
});

/* ------------------------------------------------------ the other seven --
   One row each: the URL's name, the hook, the field the hook publishes the
   artefact under, and a reply the route could really send. */
const AT = "2026-10-06T00:00:00.000Z";
const FLAGS = { stale: false, outdated: false, profileChanged: false };
const SEVEN = [
  ["simple", useSimple, "simple", { simpleSummary: { slug: SLUG, generatedAt: AT, profileHash: null, levels: {} }, ...FLAGS }, "simpleSummary"],
  ["ideas", useIdeasRead, "ideas", { ideas: { slug: SLUG, generatedAt: AT, profileHash: null, ideas: [] }, ...FLAGS }, "ideas"],
  ["faq", useFaqRead, "faq", { faq: { slug: SLUG, generatedAt: AT, questions: [] }, ...FLAGS }, "faq"],
  ["timeline", useTimelineRead, "timeline", { timeline: { slug: SLUG, generatedAt: AT, events: [] }, ...FLAGS }, "timeline"],
  ["debate", useDebateRead, "debate", { debate: { slug: SLUG, generatedAt: AT, direct: { rows: [] }, claims: { rows: [] } }, ...FLAGS }, "debate"],
  ["glossary", useGlossaryRead, "glossary", { glossary: { slug: SLUG, generatedAt: AT, profileHash: null, entries: [] }, ...FLAGS }, "glossary"],
  ["quotes", useQuotesRead, "quotes", { quotes: { slug: SLUG, generatedAt: AT, profileHash: null, quotes: [] }, ...FLAGS }, "quotes"],
] as const;

interface SevenRead {
  status: string;
  error: unknown;
  retryRead(): Promise<void>;
}

describe.each(SEVEN)("%s", (name, use, held, body, sent) => {
  const url = `/api/${name}/${SLUG}`;
  const artefact = (body as Record<string, unknown>)[sent];
  const read = () => seen as SevenRead & Record<string, unknown>;

  for (const [what, reply] of ANSWERS) {
    it(`${what} is none yet: the panel's button, not an error`, async () => {
      answer = reply;
      await mount(use);
      expect(asked.filter((ask) => ask.url === url)).toEqual([{ url, header: "1" }]);
      expect({ status: read().status, artefact: read()[held], error: read().error }).toEqual({
        status: "none",
        artefact: null,
        error: null,
      });
    });
  }

  it("accepts a real response", async () => {
    answer = () => json(body);
    await mount(use);
    expect(read()).toMatchObject({ status: "ready", error: null, [held]: artefact });
  });

  for (const late of [null, body]) {
    it(`ignores ${late === null ? "absence" : "an artefact"} parsed after moving to another article`, async () => {
      let release!: (text: string) => void;
      const pending = new Promise<string>((resolve) => { release = resolve; });
      answer = () => {
        const response = json(body);
        response.text = () => pending;
        return response;
      };
      await mount(use);
      expect(read().status).toBe("loading");
      expect(asked.some((ask) => ask.url === url)).toBe(true);

      const nextArtefact = { ...artefact as object, slug: "next-article" };
      const next = { ...body, [sent]: nextArtefact };
      answer = () => json(next);
      await act(async () => root.render(createElement(Probe, { use, slug: "next-article" })));
      await settle();
      expect(read()).toMatchObject({ status: "ready", [held]: nextArtefact });
      expect(asked.some((ask) => ask.url === `/api/${name}/next-article`)).toBe(true);

      await act(async () => release(JSON.stringify(late)));
      await settle();
      expect(read()).toMatchObject({ status: "ready", error: null, [held]: nextArtefact });
    });
  }

  for (const [what, reply] of ANSWERS) {
    it(`${what} clears an earlier artefact and its flags`, async () => {
      answer = () => json({ ...body, [sent]: { ...artefact as object, profileHash: "earlier-profile" },
        stale: true, outdated: true, profileChanged: true, panelRun: "rewrite" });
      await mount(use);
      expect(read()).toMatchObject({ status: "ready", stale: true, outdated: true });
      if ("profileChanged" in read()) expect(read().profileChanged).toBe(true);
      if ("profiled" in read()) expect(read().profiled).toBe(true);
      if (name === "glossary") expect(read().panelRun).toBe("rewrite");
      answer = reply;
      await act(async () => read().retryRead());
      await settle();
      expect(read()).toMatchObject({ status: "none", error: null, [held]: null, stale: false, outdated: false });
      if ("profileChanged" in read()) expect(read().profileChanged).toBe(false);
      if ("profiled" in read()) expect(read().profiled).toBe(false);
      if (name === "glossary") expect(read().panelRun).toBeUndefined();
    });
  }

  it("accepts a saved real copy served offline", async () => {
    answer = () => new Response(JSON.stringify(body), { status: 200, headers: {
      "content-type": "application/json", "x-spideryarn-offline": "copy", "x-spideryarn-saved-at": "123",
    } });
    await mount(use);
    expect(read()).toMatchObject({ status: "ready", error: null, [held]: artefact });
  });

  for (const malformed of [false, 0, "", {}, { [sent]: null }]) {
    it(`reports ${JSON.stringify(malformed)} as a failed opening read, not as none yet`, async () => {
      answer = () => json(malformed);
      await mount(use);
      expect(read()).toMatchObject({ status: "error", [held]: null });
      expect(read().error).toBeTruthy();
    });

    it(`keeps a real response when the next read returns ${JSON.stringify(malformed)}`, async () => {
      answer = () => json(body);
      await mount(use);
      answer = () => json(malformed);
      await act(async () => read().retryRead());
      await settle();
      expect(read()).toMatchObject({ status: "ready", [held]: artefact });
      expect(read().error).toBeTruthy();
    });
  }
});
